// frontend/screens/BusinessHomeScreen.js
import React, { useEffect, useMemo, useState, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  Alert,
  Platform,
  Linking,
  TextInput,
  Modal,
  TouchableWithoutFeedback,
  Keyboard,
  useWindowDimensions,
  ImageBackground,
  StyleSheet,
  ActivityIndicator,
} from "react-native";

import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
} from "firebase/firestore";

import { auth, db } from "../firebaseConfig";
import colors from "../styles/colors";
import { setupWebPushForCurrentUser } from "../utils/setupWebPush";
import { onAuthStateChanged } from "firebase/auth";

// ================== ASSETS ==================

const whatsappLogo = require("../assets/whatsappLogo.png");
const phoneLogo = require("../assets/phoneLogo.jpg");
const instagramLogo = require("../assets/instegramLogo.jpg");
const wazeLogo = require("../assets/wazeLogo.png");

const NAILS_GALLERY = [
  require("../assets/imgNails/nails1.jpg"),
  require("../assets/imgNails/nails2.jpg"),
  require("../assets/imgNails/nails3.jpg"),
  require("../assets/imgNails/nails4.jpg"),
];

// 👇 תמונת ברירת מחדל אם אין רקע דינמי
const BG_FALLBACK = require("../assets/backgroundOpenRegisApp.jpg");

// ================== helpers ==================
async function openUrl(url) {
  try {
    if (!url) return;
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      Alert.alert("לא ניתן לפתוח", "המכשיר לא תומך בקישור הזה.");
      return;
    }
    await Linking.openURL(url);
  } catch {
    Alert.alert("שגיאה", "לא הצליח לפתוח קישור");
  }
}

function StarsRow({ rating = 0, onChange, size = 22 }) {
  const r = Math.max(0, Math.min(5, Number(rating) || 0));

  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      {Array.from({ length: 5 }).map((_, i) => {
        const starIndex = i + 1;
        const filled = starIndex <= r;
        return (
          <Pressable
            key={i}
            onPress={onChange ? () => onChange(starIndex) : undefined}
            style={({ pressed }) => [
              { opacity: pressed && onChange ? 0.7 : 1 },
              Platform.OS === "web" && onChange ? { cursor: "pointer" } : null,
            ]}
          >
            <Text
              style={{
                fontSize: size,
                fontWeight: "900",
                color: filled ? "#f4b400" : "#aaa",
              }}
            >
              ★
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ActionCard({ title, subtitle, icon, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          flex: 1,
          backgroundColor: "#fff",
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 14,
          paddingVertical: 14,
          paddingHorizontal: 12,
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          opacity: pressed ? 0.88 : 1,
        },
        Platform.OS === "web" ? { cursor: "pointer" } : null,
      ]}
    >
      <Image
        source={icon}
        style={{ width: 38, height: 38 }}
        resizeMode="contain"
      />

      <Text
        style={{
          fontWeight: "900",
          color: colors.textDark,
          textAlign: "center",
        }}
      >
        {title}
      </Text>

      {!!subtitle ? (
        <Text
          style={{
            color: "#666",
            fontWeight: "700",
            fontSize: 12,
            textAlign: "center",
          }}
        >
          {subtitle}
        </Text>
      ) : null}
    </Pressable>
  );
}

function SectionTitle({ children }) {
  return (
    <Text
      style={{
        fontWeight: "900",
        fontSize: 18,
        color: colors.primary,
        textAlign: "right",
        marginTop: 18,
      }}
    >
      {children}
    </Text>
  );
}

// ✅ לא מוסיפים cache-bust ל-data:image/...base64,...
function normalizeImgUri(uri, bustValue) {
  const u = String(uri || "");
  if (!u) return "";
  if (u.startsWith("data:image/")) return u;
  const sep = u.includes("?") ? "&" : "?";
  return `${u}${sep}t=${bustValue}`;
}

// ================== screen ==================
export default function BusinessHomeScreen({ navigation }) {
  const [userId, setUserId] = useState(null);
  const { width: screenWidth } = useWindowDimensions();

  // ====== רקע דינמי לכל האפליקציה (backgroundAllAppUrl) ======
  // undefined = עדיין לא נטען, null = אין ערך, string = URL
  const [backgroundAllAppUrl, setBackgroundAllAppUrl] = useState(undefined);
  const [bgUpdatedAt, setBgUpdatedAt] = useState(Date.now());

  useEffect(() => {
    // ✅ לפי הסקרינשוט – האוסף הוא settings והמסמך הוא business
    const ref = doc(db, "settings", "business");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setBackgroundAllAppUrl(null);
          setBgUpdatedAt(Date.now());
          return;
        }
        const data = snap.data() || {};
        const url =
          typeof data.backgroundAllAppUrl === "string" &&
          data.backgroundAllAppUrl.trim()
            ? data.backgroundAllAppUrl.trim()
            : null;

        setBackgroundAllAppUrl(url);
        setBgUpdatedAt(Date.now());
      },
      (err) => {
        console.log(
          "❌ app backgrounds (business doc) listen error:",
          err?.code,
          err?.message
        );
        setBackgroundAllAppUrl(null);
        setBgUpdatedAt(Date.now());
      }
    );
    return () => unsub();
  }, []);

  // מאזינים להתחברות / התנתקות של המשתמש
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUserId(user?.uid || null);
    });
    return () => unsub();
  }, []);

  // 🔔 Push ב-Web
  useEffect(() => {
    console.log("🔥 push effect, userId:", userId);
    if (Platform.OS === "web" && userId) {
      setupWebPushForCurrentUser();
    }
  }, [userId]);

  // ====== Business profile (from Firestore) ======
  const [business, setBusiness] = useState(null);
  const [logoUpdatedAt, setLogoUpdatedAt] = useState(Date.now());

  useEffect(() => {
    const ref = doc(db, "business", "profile");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setBusiness(snap.exists() ? snap.data() : null);
        setLogoUpdatedAt(Date.now());
      },
      (err) => {
        console.log(
          "❌ business/profile listen error:",
          err?.code,
          err?.message
        );
        setBusiness(null);
        setLogoUpdatedAt(Date.now());
      }
    );
    return () => unsub();
  }, []);

  const b = business || {};
  const hasLogo = !!b.logoDataUrl;

  const links = useMemo(() => {
    const wa = b.phoneInternational
      ? `https://wa.me/${b.phoneInternational}`
      : null;
    const tel = b.phoneDial ? `tel:${b.phoneDial}` : null;

    const igWeb = b.instagramHandle
      ? `https://instagram.com/${b.instagramHandle}`
      : null;
    const igDeep = b.instagramHandle
      ? `instagram://user?username=${b.instagramHandle}`
      : null;

    const waze = b.wazeAddress
      ? `https://waze.com/ul?q=${encodeURIComponent(
          b.wazeAddress
        )}&navigate=yes`
      : null;

    return { wa, tel, igWeb, igDeep, waze };
  }, [b.phoneInternational, b.phoneDial, b.instagramHandle, b.wazeAddress]);

  // ====== Gallery (Firestore: business/galleryMain) ======
  const [gallery, setGallery] = useState([]);
  const [galleryLoading, setGalleryLoading] = useState(true);
  const [galleryUpdatedAt, setGalleryUpdatedAt] = useState(Date.now());

  const [expandedKey, setExpandedKey] = useState(null);

  const galleryScrollRef = useRef(null);
  const itemLayouts = useRef({});
  const [galleryContainerWidth, setGalleryContainerWidth] = useState(null);

  useEffect(() => {
    const ref = doc(db, "business", "galleryMain");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.exists() ? snap.data() : null;
        const imgs = Array.isArray(data?.images) ? data.images : [];
        setGallery(imgs);
        setGalleryUpdatedAt(Date.now());
        setGalleryLoading(false);
      },
      (err) => {
        console.log("❌ galleryMain listen error:", err?.code, err?.message);
        setGallery([]);
        setGalleryUpdatedAt(Date.now());
        setGalleryLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const hasUploaded = Array.isArray(gallery) && gallery.length > 0;

  function scrollToImageCenter(itemKey) {
    const layout = itemLayouts.current[itemKey];
    if (!layout || !galleryScrollRef.current) return;

    const containerWidth = galleryContainerWidth || screenWidth;
    const centerX = layout.x + layout.width / 2;
    const targetX = Math.max(0, centerX - containerWidth / 2);

    galleryScrollRef.current.scrollTo({ x: targetX, animated: true });
  }

  // ========= Reviews =========
  const [reviews, setReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);

  const [myExistingReview, setMyExistingReview] = useState(null);

  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [myRating, setMyRating] = useState(5);
  const [myText, setMyText] = useState("");
  const [savingReview, setSavingReview] = useState(false);

  useEffect(() => {
    const q1 = query(
      collection(db, "reviews"),
      orderBy("updatedAt", "desc"),
      limit(50)
    );
    const unsub = onSnapshot(
      q1,
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setReviews(arr);
        setReviewsLoading(false);

        if (userId) {
          const mine =
            arr.find((x) => x.userId === userId || x.id === userId) || null;
          setMyExistingReview(mine);
        } else {
          setMyExistingReview(null);
        }
      },
      (err) => {
        console.log("❌ reviews listen error:", err?.code, err?.message);
        setReviews([]);
        setReviewsLoading(false);
        setMyExistingReview(null);
      }
    );

    return () => unsub();
  }, [userId]);

  async function openReviewModal(mode = "new") {
    if (!userId) {
      Alert.alert("צריך להתחבר", "כדי לכתוב ביקורת צריך להתחבר למערכת.");
      return;
    }

    if (mode === "edit" && myExistingReview) {
      setMyRating(Number(myExistingReview.rating || 5));
      setMyText(String(myExistingReview.text || ""));
    } else {
      setMyRating(5);
      setMyText("");
    }

    setReviewModalOpen(true);
  }

  async function saveReview() {
    if (!userId) return;

    const text = (myText || "").trim();
    const rating = Math.max(1, Math.min(5, Number(myRating) || 0));

    if (!text || text.length < 3) {
      Alert.alert("חסר טקסט", "כתבי לפחות כמה מילים על החוויה שלך 🙂");
      return;
    }

    setSavingReview(true);
    try {
      let userName = "לקוחה";
      try {
        const uSnap = await getDoc(doc(db, "users", userId));
        if (uSnap.exists()) {
          const u = uSnap.data();
          const full =
            `${u?.firstName || ""} ${u?.lastName || ""}`.trim() ||
            u?.displayName ||
            u?.name;
          if (full) userName = full;
        }
      } catch (e) {
        console.log("user name read error:", e?.message || e);
      }

      const reviewRef = doc(db, "reviews", userId);

      await setDoc(
        reviewRef,
        {
          userId,
          userName,
          rating,
          text,
          createdAt: myExistingReview?.createdAt || serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setReviewModalOpen(false);
      Alert.alert("נשמר ✅", "הביקורת שלך עודכנה בהצלחה");
    } catch (e) {
      console.log("❌ saveReview error:", e?.message || e);
      Alert.alert("שגיאה", "לא הצליח לשמור ביקורת");
    } finally {
      setSavingReview(false);
    }
  }

  async function deleteMyReview() {
    if (!userId) return;

    Alert.alert("מחיקת ביקורת", "למחוק את הביקורת שלך?", [
      { text: "ביטול", style: "cancel" },
      {
        text: "מחקי",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteDoc(doc(db, "reviews", userId));
            setReviewModalOpen(false);
            Alert.alert("נמחק", "הביקורת נמחקה");
          } catch (e) {
            console.log("❌ delete review error:", e?.message || e);
            Alert.alert("שגיאה", "לא הצליח למחוק ביקורת");
          }
        },
      },
    ]);
  }

  // 💡 עד ש־backgroundAllAppUrl לא נטען – לא מציגים רקע ישן
  if (backgroundAllAppUrl === undefined) {
    return (
      <View
        style={[
          styles.bg,
          {
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "#fff",
          },
        ]}
      >
        <ActivityIndicator />
      </View>
    );
  }

  const bgSource = backgroundAllAppUrl
    ? { uri: normalizeImgUri(backgroundAllAppUrl, bgUpdatedAt) }
    : BG_FALLBACK;

  return (
    <ImageBackground source={bgSource} style={styles.bg} resizeMode="cover">
      {/* שכבת לבן שקוף מעל הרקע (כמו בלוגין/הרשמה) */}
      <View style={styles.overlay}>
        <View
          style={{
            flex: 1,
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: 110, // מקום לכפתור התחתון
            backgroundColor: "transparent",
          }}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <View
              style={{
                backgroundColor: "rgba(255,255,255,0.95)",
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.border,
                padding: 14,
                alignItems: "center",
              }}
            >
                {hasLogo && (
                  <Image
                    source={{
                      uri: normalizeImgUri(b.logoDataUrl, logoUpdatedAt),
                    }}
                    style={{ width: 96, height: 96, borderRadius: 18 }}
                    resizeMode="cover"
                  />
                )}


              <Text
                style={{
                  marginTop: 10,
                  fontSize: 22,
                  fontWeight: "900",
                  color: colors.primary,
                  textAlign: "center",
                }}
              >
                {b.businessName || "העסק שלי"}
              </Text>

              <Text
                style={{
                  marginTop: 6,
                  fontSize: 15,
                  fontWeight: "800",
                  color: colors.textDark,
                  textAlign: "center",
                }}
              >
                בעלת העסק: {b.ownerName || "—"}
              </Text>
            </View>

            {/* Actions */}
            <SectionTitle>יצירת קשר וניווט</SectionTitle>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <ActionCard
                title="וואטסאפ"
                subtitle="פתיחת צ'אט"
                icon={whatsappLogo}
                onPress={() => openUrl(links.wa)}
              />
              <ActionCard
                title="טלפון"
                subtitle={b.phoneDial || "—"}
                icon={phoneLogo}
                onPress={() => openUrl(links.tel)}
              />
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <ActionCard
                title="אינסטגרם"
                subtitle={b.instagramHandle ? `@${b.instagramHandle}` : "—"}
                icon={instagramLogo}
                onPress={async () => {
                  if (!links.igWeb) return;
                  const canDeep = links.igDeep
                    ? await Linking.canOpenURL(links.igDeep)
                    : false;
                  await openUrl(canDeep ? links.igDeep : links.igWeb);
                }}
              />
              <ActionCard
                title="Waze"
                subtitle="ניווט"
                icon={wazeLogo}
                onPress={() => openUrl(links.waze)}
              />
            </View>

            {/* Gallery */}
            <SectionTitle>גלריה</SectionTitle>
            <View
              style={{
                marginTop: 10,
                backgroundColor: "rgba(255,255,255,0.95)",
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.border,
                padding: 12,
              }}
              onLayout={(e) =>
                setGalleryContainerWidth(e.nativeEvent.layout.width)
              }
            >
              {galleryLoading ? (
                <Text
                  style={{
                    textAlign: "right",
                    color: "gray",
                    fontWeight: "700",
                  }}
                >
                  טוען גלריה…
                </Text>
              ) : (
                <ScrollView
                  ref={galleryScrollRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    {hasUploaded
                      ? gallery.map((img, idx) => {
                          const keyId = String(img.id || idx);
                          const reactKey = `${keyId}_${galleryUpdatedAt}`;
                          const isExpanded = expandedKey === keyId;

                          const baseSize = 160;
                          const expandedSize = 260;

                          return (
                            <Pressable
                              key={reactKey}
                              onPress={() => {
                                setExpandedKey((prev) =>
                                  prev === keyId ? null : keyId
                                );
                                scrollToImageCenter(keyId);
                              }}
                              onLayout={(e) => {
                                const { x, width } = e.nativeEvent.layout;
                                itemLayouts.current[keyId] = { x, width };
                              }}
                              style={({ pressed }) => [
                                { opacity: pressed ? 0.88 : 1 },
                                Platform.OS === "web"
                                  ? { cursor: "pointer" }
                                  : null,
                              ]}
                            >
                              <Image
                                source={{
                                  uri: normalizeImgUri(
                                    img.dataUrl,
                                    galleryUpdatedAt
                                  ),
                                }}
                                style={{
                                  width: isExpanded ? expandedSize : baseSize,
                                  height: isExpanded ? expandedSize : baseSize,
                                  borderRadius: 14,
                                  backgroundColor: "#f2f2f2",
                                }}
                                resizeMode="cover"
                              />
                            </Pressable>
                          );
                        })
                      : NAILS_GALLERY.map((src, idx) => {
                          const keyId = `default_${idx}`;
                          const isExpanded = expandedKey === keyId;

                          const baseSize = 160;
                          const expandedSize = 260;

                          return (
                            <Pressable
                              key={keyId}
                              onPress={() => {
                                setExpandedKey((prev) =>
                                  prev === keyId ? null : keyId
                                );
                                scrollToImageCenter(keyId);
                              }}
                              onLayout={(e) => {
                                const { x, width } = e.nativeEvent.layout;
                                itemLayouts.current[keyId] = { x, width };
                              }}
                              style={({ pressed }) => [
                                { opacity: pressed ? 0.88 : 1 },
                                Platform.OS === "web"
                                  ? { cursor: "pointer" }
                                  : null,
                              ]}
                            >
                              <Image
                                source={src}
                                style={{
                                  width: isExpanded ? expandedSize : baseSize,
                                  height: isExpanded ? expandedSize : baseSize,
                                  borderRadius: 14,
                                }}
                                resizeMode="cover"
                              />
                            </Pressable>
                          );
                        })}
                  </View>
                </ScrollView>
              )}
            </View>

            {/* Reviews */}
            <SectionTitle>ביקורות</SectionTitle>

            {!userId ? (
              <Text
                style={{
                  marginTop: 10,
                  textAlign: "right",
                  color: "#666",
                  fontWeight: "700",
                }}
              >
                כדי לכתוב ביקורת צריך להתחבר.
              </Text>
            ) : myExistingReview ? (
              <View style={{ marginTop: 10, flexDirection: "row", gap: 10 }}>
                <Pressable
                  onPress={() => openReviewModal("edit")}
                  style={({ pressed }) => [
                    {
                      flex: 1,
                      backgroundColor: "#fff",
                      borderWidth: 1,
                      borderColor: colors.primary,
                      borderRadius: 14,
                      paddingVertical: 12,
                      alignItems: "center",
                      opacity: pressed ? 0.88 : 1,
                    },
                    Platform.OS === "web" ? { cursor: "pointer" } : null,
                  ]}
                >
                  <Text
                    style={{ fontWeight: "900", color: colors.primary }}
                  >
                    ערכי את הביקורת שלך ✏️
                  </Text>
                </Pressable>

                <Pressable
                  onPress={deleteMyReview}
                  style={({ pressed }) => [
                    {
                      flex: 1,
                      backgroundColor: "#fff",
                      borderWidth: 1,
                      borderColor: "#c62828",
                      borderRadius: 14,
                      paddingVertical: 12,
                      alignItems: "center",
                      opacity: pressed ? 0.88 : 1,
                    },
                    Platform.OS === "web" ? { cursor: "pointer" } : null,
                  ]}
                >
                  <Text
                    style={{ fontWeight: "900", color: "#c62828" }}
                  >
                    מחקי ביקורת 🗑️
                  </Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => openReviewModal("new")}
                style={({ pressed }) => [
                  {
                    marginTop: 10,
                    backgroundColor: "#fff",
                    borderWidth: 1,
                    borderColor: colors.primary,
                    borderRadius: 14,
                    paddingVertical: 12,
                    alignItems: "center",
                    opacity: pressed ? 0.88 : 1,
                  },
                  Platform.OS === "web" ? { cursor: "pointer" } : null,
                ]}
              >
                <Text style={{ fontWeight: "900", color: colors.primary }}>
                  כתבי ביקורת ⭐
                </Text>
              </Pressable>
            )}

            <View style={{ marginTop: 10 }}>
              {reviewsLoading ? (
                <Text style={{ textAlign: "right", color: "gray" }}>
                  טוען ביקורות…
                </Text>
              ) : reviews.length === 0 ? (
                <Text style={{ textAlign: "right", color: "gray" }}>
                  אין עדיין ביקורות. תהיי הראשונה 🙂
                </Text>
              ) : (
                reviews.map((r) => (
                  <View
                    key={r.id}
                    style={{
                      backgroundColor: "#fff",
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: colors.border,
                      padding: 12,
                      marginBottom: 10,
                      alignItems: "flex-end",
                    }}
                  >
                    <Text
                      style={{
                        fontWeight: "900",
                        color: colors.textDark,
                        width: "100%",
                        textAlign: "right",
                      }}
                    >
                      {r.userName || "לקוחה"}
                    </Text>

                    <View
                      style={{
                        marginTop: 6,
                        width: "100%",
                        flexDirection: "row",
                        justifyContent: "flex-end",
                      }}
                    >
                      <StarsRow rating={Number(r.rating || 0)} />
                    </View>

                    <Text
                      style={{
                        marginTop: 8,
                        color: "#444",
                        fontWeight: "700",
                        width: "100%",
                        textAlign: "right",
                        lineHeight: 20,
                      }}
                    >
                      {String(r.text || "")}
                    </Text>

                    {userId && (r.userId === userId || r.id === userId) ? (
                      <Text
                        style={{
                          marginTop: 6,
                          color: colors.primary,
                          fontWeight: "900",
                        }}
                      >
                        הביקורת שלי
                      </Text>
                    ) : null}
                  </View>
                ))
              )}
            </View>

            <Text
              style={{
                textAlign: "center",
                color: "#666",
                fontWeight: "700",
                marginTop: 6,
              }}
            >
              נתקלת בבעיה? אפשר לפנות אלינו דרך וואטסאפ או טלפון.
            </Text>
          </ScrollView>

          {/* כפתור תחתון למסך קביעת תור */}
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              padding: 14,
              borderTopWidth: 1,
              borderTopColor: colors.border,
            }}
          >
            <Pressable
              onPress={() => navigation.navigate("Calendar")}
              style={({ pressed }) => [
                {
                  backgroundColor: colors.primary,
                  paddingVertical: 14,
                  borderRadius: 14,
                  alignItems: "center",
                  opacity: pressed ? 0.88 : 1,
                },
                Platform.OS === "web" ? { cursor: "pointer" } : null,
              ]}
            >
              <Text
                style={{
                  color: "#fff",
                  fontWeight: "900",
                  fontSize: 16,
                }}
              >
                מעבר לקביעת תור 📅
              </Text>
            </Pressable>
          </View>

          {/* MODAL: כתיבה/עריכה */}
          <Modal
            visible={reviewModalOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setReviewModalOpen(false)}
          >
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
              <View
                style={{
                  flex: 1,
                  backgroundColor: "rgba(0,0,0,0.35)",
                  justifyContent: "center",
                  padding: 16,
                }}
              >
                <TouchableWithoutFeedback onPress={() => {}}>
                  <View
                    style={{
                      backgroundColor: "#fff",
                      borderRadius: 16,
                      padding: 16,
                      borderWidth: 1,
                      borderColor: colors.border,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 18,
                        fontWeight: "900",
                        textAlign: "center",
                        color: colors.primary,
                      }}
                    >
                      {myExistingReview ? "עריכת ביקורת" : "כתיבת ביקורת"}
                    </Text>

                    <Text
                      style={{
                        marginTop: 10,
                        fontWeight: "800",
                        textAlign: "right",
                      }}
                    >
                      דירוג:
                    </Text>

                    <View
                      style={{ marginTop: 8, alignItems: "flex-end" }}
                    >
                      <StarsRow
                        rating={myRating}
                        onChange={setMyRating}
                        size={26}
                      />
                    </View>

                    <Text
                      style={{
                        marginTop: 12,
                        fontWeight: "800",
                        textAlign: "right",
                      }}
                    >
                      טקסט:
                    </Text>

                    <TextInput
                      value={myText}
                      onChangeText={setMyText}
                      placeholder="איך הייתה החוויה?"
                      placeholderTextColor="#777"
                      multiline
                      style={{
                        marginTop: 8,
                        minHeight: 110,
                        borderWidth: 1,
                        borderColor: "#ddd",
                        borderRadius: 12,
                        padding: 12,
                        textAlign: "right",
                        writingDirection: "rtl",
                        backgroundColor: "#fff",
                        fontWeight: "700",
                        color: "#000",
                      }}
                    />

                    <View
                      style={{
                        flexDirection: "row",
                        gap: 10,
                        marginTop: 14,
                      }}
                    >
                      <Pressable
                        onPress={() => setReviewModalOpen(false)}
                        disabled={savingReview}
                        style={({ pressed }) => [
                          {
                            flex: 1,
                            paddingVertical: 12,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: "#bbb",
                            alignItems: "center",
                            opacity: pressed ? 0.88 : 1,
                          },
                          Platform.OS === "web"
                            ? { cursor: "pointer" }
                            : null,
                        ]}
                      >
                        <Text style={{ fontWeight: "900" }}>סגור</Text>
                      </Pressable>

                      <Pressable
                        onPress={saveReview}
                        disabled={savingReview}
                        style={({ pressed }) => [
                          {
                            flex: 1,
                            paddingVertical: 12,
                            borderRadius: 12,
                            backgroundColor: colors.primary,
                            alignItems: "center",
                            opacity: savingReview
                              ? 0.6
                              : pressed
                              ? 0.88
                              : 1,
                          },
                          Platform.OS === "web"
                            ? { cursor: "pointer" }
                            : null,
                        ]}
                      >
                        <Text
                          style={{
                            fontWeight: "900",
                            color: "#fff",
                          }}
                        >
                          {savingReview ? "שומר..." : "שמירה"}
                        </Text>
                      </Pressable>
                    </View>

                    {userId && myExistingReview ? (
                      <Pressable
                        onPress={deleteMyReview}
                        disabled={savingReview}
                        style={({ pressed }) => [
                          {
                            marginTop: 10,
                            paddingVertical: 12,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: "#c62828",
                            alignItems: "center",
                            opacity: pressed ? 0.88 : 1,
                          },
                          Platform.OS === "web"
                            ? { cursor: "pointer" }
                            : null,
                        ]}
                      >
                        <Text
                          style={{
                            fontWeight: "900",
                            color: "#c62828",
                          }}
                        >
                          מחיקת ביקורת
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </TouchableWithoutFeedback>
              </View>
            </TouchableWithoutFeedback>
          </Modal>
        </View>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.5)", // שכבה לבנה שקופה מעל הרקע
  },
});
