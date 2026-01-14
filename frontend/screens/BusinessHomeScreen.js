// frontend/screens/BusinessHomeScreen.js
import React, { useEffect, useMemo, useState } from "react";
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
import globalStyles from "../styles/global";
import colors from "../styles/colors";

// ================== CONFIG ==================
const BUSINESS = {
  businessName: "ROTEM_NAILS_STUDIO",
  ownerName: "רותם בן צבי",

  phoneDial: "0547916054",
  phoneInternational: "972547916054",

  instagramHandle: "rotem_nails_studio",
  wazeAddress: "מגן",
};

// ================== ASSETS ==================
const LOGO = require("../assets/businessLogo.jpg");
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

// ================== helpers ==================
async function openUrl(url) {
  try {
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
      <Image source={icon} style={{ width: 38, height: 38 }} resizeMode="contain" />

      <Text style={{ fontWeight: "900", color: colors.textDark, textAlign: "center" }}>
        {title}
      </Text>

      {!!subtitle ? (
        <Text style={{ color: "#666", fontWeight: "700", fontSize: 12, textAlign: "center" }}>
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

// ================== screen ==================
export default function BusinessHomeScreen({ navigation }) {
  const userId = auth.currentUser?.uid || null;

  const links = useMemo(() => {
    const wa = `https://wa.me/${BUSINESS.phoneInternational}`;
    const tel = `tel:${BUSINESS.phoneDial}`;
    const igWeb = `https://instagram.com/${BUSINESS.instagramHandle}`;
    const igDeep = `instagram://user?username=${BUSINESS.instagramHandle}`;
    const waze = `https://waze.com/ul?q=${encodeURIComponent(BUSINESS.wazeAddress)}&navigate=yes`;
    return { wa, tel, igWeb, igDeep, waze };
  }, []);

  // ========= Reviews =========
  const [reviews, setReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);

  // “הביקורת שלי” (אם קיימת)
  const [myExistingReview, setMyExistingReview] = useState(null);

  // modal
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [myRating, setMyRating] = useState(5);
  const [myText, setMyText] = useState("");
  const [savingReview, setSavingReview] = useState(false);

  // listen reviews realtime
  useEffect(() => {
    const q = query(collection(db, "reviews"), orderBy("updatedAt", "desc"), limit(50));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setReviews(arr);
        setReviewsLoading(false);

        // לעדכן מצב "הביקורת שלי" מהרשימה (נוח)
        if (userId) {
          const mine = arr.find((x) => x.userId === userId || x.id === userId) || null;
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
      // שם משתמש
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

      // ✅ ביקורת אחת לכל משתמש: reviews/{userId}
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

  return (
    <View style={[globalStyles.container, { backgroundColor: "transparent" }]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View
          style={{
            backgroundColor: "#fff",
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 14,
            alignItems: "center",
          }}
        >
          <Image source={LOGO} style={{ width: 96, height: 96, borderRadius: 18 }} resizeMode="cover" />

          <Text style={{ marginTop: 10, fontSize: 22, fontWeight: "900", color: colors.primary, textAlign: "center" }}>
            {BUSINESS.businessName}
          </Text>

          <Text style={{ marginTop: 6, fontSize: 15, fontWeight: "800", color: colors.textDark, textAlign: "center" }}>
            בעלת העסק: {BUSINESS.ownerName}
          </Text>

          <Pressable
            onPress={() => navigation.navigate("Calendar")}
            style={({ pressed }) => [
              {
                marginTop: 14,
                backgroundColor: colors.primary,
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: 12,
                width: "100%",
                alignItems: "center",
                opacity: pressed ? 0.88 : 1,
              },
              Platform.OS === "web" ? { cursor: "pointer" } : null,
            ]}
          >
            <Text style={{ color: "#fff", fontWeight: "900" }}>מעבר לקביעת תור</Text>
          </Pressable>
        </View>

        {/* Actions */}
        <SectionTitle>יצירת קשר וניווט</SectionTitle>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <ActionCard title="וואטסאפ" subtitle="פתיחת צ'אט" icon={whatsappLogo} onPress={() => openUrl(links.wa)} />
          <ActionCard title="טלפון" subtitle={BUSINESS.phoneDial} icon={phoneLogo} onPress={() => openUrl(links.tel)} />
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <ActionCard
            title="אינסטגרם"
            subtitle={`@${BUSINESS.instagramHandle}`}
            icon={instagramLogo}
            onPress={async () => {
              const canDeep = await Linking.canOpenURL(links.igDeep);
              await openUrl(canDeep ? links.igDeep : links.igWeb);
            }}
          />
          <ActionCard title="Waze" subtitle="ניווט" icon={wazeLogo} onPress={() => openUrl(links.waze)} />
        </View>

        {/* Gallery */}
        <SectionTitle>גלריה</SectionTitle>
        <View
          style={{
            marginTop: 10,
            backgroundColor: "#fff",
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 12,
          }}
        >
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {NAILS_GALLERY.map((src, idx) => (
                <Image key={idx} source={src} style={{ width: 160, height: 160, borderRadius: 14 }} resizeMode="cover" />
              ))}
            </View>
          </ScrollView>
        </View>

        {/* Reviews */}
        <SectionTitle>ביקורות</SectionTitle>

        {/* כפתורים לביקורת שלי */}
        {!userId ? (
          <Text style={{ marginTop: 10, textAlign: "right", color: "#666", fontWeight: "700" }}>
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
              <Text style={{ fontWeight: "900", color: colors.primary }}>ערכי את הביקורת שלך ✏️</Text>
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
              <Text style={{ fontWeight: "900", color: "#c62828" }}>מחקי ביקורת 🗑️</Text>
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
            <Text style={{ fontWeight: "900", color: colors.primary }}>כתבי ביקורת ⭐</Text>
          </Pressable>
        )}

        {/* רשימת ביקורות */}
        <View style={{ marginTop: 10 }}>
          {reviewsLoading ? (
            <Text style={{ textAlign: "right", color: "gray" }}>טוען ביקורות…</Text>
          ) : reviews.length === 0 ? (
            <Text style={{ textAlign: "right", color: "gray" }}>אין עדיין ביקורות. תהיי הראשונה 🙂</Text>
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
                <Text style={{ fontWeight: "900", color: colors.textDark, width: "100%", textAlign: "right" }}>
                  {r.userName || "לקוחה"}
                </Text>

                <View style={{ marginTop: 6, width: "100%", flexDirection: "row", justifyContent: "flex-end" }}>
                  <StarsRow rating={Number(r.rating || 0)} />
                </View>

                <Text style={{ marginTop: 8, color: "#444", fontWeight: "700", width: "100%", textAlign: "right", lineHeight: 20 }}>
                  {String(r.text || "")}
                </Text>

                {/* סימון "שלי" */}
                {(userId && (r.userId === userId || r.id === userId)) ? (
                  <Text style={{ marginTop: 6, color: colors.primary, fontWeight: "900" }}>
                    הביקורת שלי
                  </Text>
                ) : null}
              </View>
            ))
          )}
        </View>

        <Text style={{ textAlign: "center", color: "#666", fontWeight: "700", marginTop: 6 }}>
          נתקלת בבעיה? אפשר לפנות אלינו דרך וואטסאפ או טלפון.
        </Text>
      </ScrollView>

      {/* ===== MODAL: כתיבה/עריכה ===== */}
      <Modal visible={reviewModalOpen} transparent animationType="fade" onRequestClose={() => setReviewModalOpen(false)}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 16 }}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ fontSize: 18, fontWeight: "900", textAlign: "center", color: colors.primary }}>
                  {myExistingReview ? "עריכת ביקורת" : "כתיבת ביקורת"}
                </Text>

                <Text style={{ marginTop: 10, fontWeight: "800", textAlign: "right" }}>
                  דירוג:
                </Text>

                <View style={{ marginTop: 8, alignItems: "flex-end" }}>
                  <StarsRow rating={myRating} onChange={setMyRating} size={26} />
                </View>

                <Text style={{ marginTop: 12, fontWeight: "800", textAlign: "right" }}>
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

                <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
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
                      Platform.OS === "web" ? { cursor: "pointer" } : null,
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
                        opacity: savingReview ? 0.6 : pressed ? 0.88 : 1,
                      },
                      Platform.OS === "web" ? { cursor: "pointer" } : null,
                    ]}
                  >
                    <Text style={{ fontWeight: "900", color: "#fff" }}>
                      {savingReview ? "שומר..." : "שמירה"}
                    </Text>
                  </Pressable>
                </View>

                {/* כפתור מחיקה גם בתוך מודאל, אם יש ביקורת קיימת */}
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
                      Platform.OS === "web" ? { cursor: "pointer" } : null,
                    ]}
                  >
                    <Text style={{ fontWeight: "900", color: "#c62828" }}>
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
  );
}
