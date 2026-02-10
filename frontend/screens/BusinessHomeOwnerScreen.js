// frontend/screens/BusinessHomeOwnerScreen.js
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
  ActivityIndicator,
} from "react-native";

import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

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
  runTransaction,
} from "firebase/firestore";

import { auth, db } from "../firebaseConfig";
import globalStyles from "../styles/global";
import colors from "../styles/colors";


// ================== ASSETS ==================
// const LOGO_FALLBACK = require("../assets/businessLogo.jpg"); // fallback מקומי אם אין לוגו בדאטה
const whatsappLogo = require("../assets/whatsappLogo.png");
const phoneLogo = require("../assets/phoneLogo.jpg");
const instagramLogo = require("../assets/instegramLogo.jpg");
const wazeLogo = require("../assets/wazeLogo.png");

const NAILS_GALLERY_FALLBACK = [
  require("../assets/imgNails/nails1.jpg"),
  require("../assets/imgNails/nails2.jpg"),
  require("../assets/imgNails/nails3.jpg"),
  require("../assets/imgNails/nails4.jpg"),
];

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

// יצירת מזהה קצר לתמונות
function makeId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// ✅ חשוב: לא מוסיפים cache-bust ל-data:image/...base64,...
function normalizeImgUri(uri, bustValue) {
  const u = String(uri || "");
  if (!u) return "";
  if (u.startsWith("data:image/")) return u;
  const sep = u.includes("?") ? "&" : "?";
  return `${u}${sep}t=${bustValue}`;
}

// ================== screen ==================
export default function BusinessHomeOwnerScreen({ navigation }) {
  const userId = auth.currentUser?.uid || null;

  // ====== Owner check ======
  const [isOwner, setIsOwner] = useState(true);
  const [ownerCheckLoading, setOwnerCheckLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    async function checkOwner() {
      setOwnerCheckLoading(true);
      try {
        if (!userId) {
          if (alive) setIsOwner(false);
          return;
        }
        const uSnap = await getDoc(doc(db, "users", userId));
        if (!uSnap.exists()) {
          if (alive) setIsOwner(true);
          return;
        }
        const u = uSnap.data();
        const ok = u?.isOwner === true || u?.role === "owner";
        if (alive) setIsOwner(ok);
      } catch {
        if (alive) setIsOwner(true);
      } finally {
        if (alive) setOwnerCheckLoading(false);
      }
    }

    checkOwner();
    return () => {
      alive = false;
    };
  }, [userId]);

  // ====== Business profile ======
  const [business, setBusiness] = useState(null);
  const [logoUpdatedAt, setLogoUpdatedAt] = useState(Date.now()); // ✅ ריענון לוגו

useEffect(() => {
  const ref = doc(db, "business", "profile");
  const unsub = onSnapshot(
    ref,
    (snap) => {
      setBusiness(snap.exists() ? snap.data() : null);
      setLogoUpdatedAt(Date.now()); // ✅ רענון לוגו כשיש עדכון
    },
    (err) => {
      console.log("❌ business/profile listen error:", err?.code, err?.message);
      setBusiness(null);
      setLogoUpdatedAt(Date.now()); // ✅ שגם בשגיאה ירנדר מחדש
    }
  );
  return () => unsub();
}, []);


  const b = business || {};
  const hasLogo = !!b.logoDataUrl; // ✅ יש לוגו שהועלה ע"י בעלת העסק?

  const links = useMemo(() => {
    const wa = b.phoneInternational ? `https://wa.me/${b.phoneInternational}` : null;
    const tel = b.phoneDial ? `tel:${b.phoneDial}` : null;

    const igWeb = b.instagramHandle ? `https://instagram.com/${b.instagramHandle}` : null;
    const igDeep = b.instagramHandle ? `instagram://user?username=${b.instagramHandle}` : null;

    const waze = b.wazeAddress
      ? `https://waze.com/ul?q=${encodeURIComponent(b.wazeAddress)}&navigate=yes`
      : null;

    return { wa, tel, igWeb, igDeep, waze };
  }, [b.phoneInternational, b.phoneDial, b.instagramHandle, b.wazeAddress]);

  // ====== Edit business modal ======
  const [editOpen, setEditOpen] = useState(false);
  const [savingBusiness, setSavingBusiness] = useState(false);

  const [fBusinessName, setFBusinessName] = useState("");
  const [fOwnerName, setFOwnerName] = useState("");
  const [fPhoneDial, setFPhoneDial] = useState("");
  const [fPhoneInternational, setFPhoneInternational] = useState("");
  const [fInstagramHandle, setFInstagramHandle] = useState("");
  const [fWazeAddress, setFWazeAddress] = useState("");

  useEffect(() => {
    if (!editOpen) return;
    setFBusinessName(String(b.businessName || ""));
    setFOwnerName(String(b.ownerName || ""));
    setFPhoneDial(String(b.phoneDial || ""));
    setFPhoneInternational(String(b.phoneInternational || ""));
    setFInstagramHandle(String(b.instagramHandle || ""));
    setFWazeAddress(String(b.wazeAddress || ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editOpen]);

  async function saveBusiness() {
    const payload = {
      businessName: (fBusinessName || "").trim(),
      ownerName: (fOwnerName || "").trim(),
      phoneDial: (fPhoneDial || "").trim(),
      phoneInternational: (fPhoneInternational || "").trim(),
      instagramHandle: (fInstagramHandle || "").trim(),
      wazeAddress: (fWazeAddress || "").trim(),
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.uid || null,
    };

    if (!payload.businessName) {
      Alert.alert("חסר", "שם העסק חובה");
      return;
    }

    setSavingBusiness(true);
    try {
      await setDoc(doc(db, "business", "profile"), payload, { merge: true });
      setEditOpen(false);
      Keyboard.dismiss();
      Alert.alert("נשמר ✅", "פרטי העסק עודכנו");
    } catch (e) {
      console.log("❌ save business error:", e?.message || e);
      Alert.alert("שגיאה", e?.message || "לא הצליח לשמור");
    } finally {
      setSavingBusiness(false);
    }
  }

  // ====== Logo upload (Firestore בלי Storage) ======
  const [uploadingLogo, setUploadingLogo] = useState(false);

  async function ensureMediaPermission() {
    if (Platform.OS === "web") return true;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("הרשאה נדרשת", "צריך הרשאה לגלריה כדי לבחור תמונה.");
      return false;
    }
    return true;
  }

  async function pickAndUploadLogo() {
    if (!userId) {
      Alert.alert("צריך להתחבר", "כדי להעלות לוגו צריך להתחבר.");
      return;
    }

    const ok = await ensureMediaPermission();
    if (!ok) return;

    setUploadingLogo(true);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
        allowsEditing: true,
        aspect: [1, 1], // ✅ לוגו ריבועי
      });

      if (res.canceled) return;

      const asset = res.assets?.[0];
      if (!asset?.uri) return;

      // ✅ לוגו קטן יותר מהגלריה (כדי לא לפוצץ את המסמך)
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 400 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );

      if (!manipulated?.base64) {
        Alert.alert("שגיאה", "לא הצליח לעבד את הלוגו");
        return;
      }

      const logoDataUrl = `data:image/jpeg;base64,${manipulated.base64}`;

      await setDoc(
        doc(db, "business", "profile"),
        {
          logoDataUrl,
          logoUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        },
        { merge: true }
      );

      Alert.alert("עודכן ✅", "הלוגו עודכן בהצלחה");
    } catch (e) {
      console.log("❌ upload logo error:", e?.message || e);
      Alert.alert("שגיאה", "לא הצליח לעדכן לוגו");
    } finally {
      setUploadingLogo(false);
    }
  }

  async function removeLogo() {
    Alert.alert("מחיקת לוגו", "למחוק את הלוגו ולהחזיר לברירת מחדל?", [
      { text: "ביטול", style: "cancel" },
      {
        text: "מחקי",
        style: "destructive",
        onPress: async () => {
          try {
            await setDoc(
              doc(db, "business", "profile"),
              {
                logoDataUrl: null,
                logoUpdatedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                updatedBy: userId || null,
              },
              { merge: true }
            );
          } catch (e) {
            console.log("❌ remove logo error:", e?.message || e);
            Alert.alert("שגיאה", "לא הצליח למחוק לוגו");
          }
        },
      },
    ]);
  }

  // ====== Gallery (Firestore בלי Storage) ======
  const [gallery, setGallery] = useState([]);
  const [galleryLoading, setGalleryLoading] = useState(true);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [galleryUpdatedAt, setGalleryUpdatedAt] = useState(Date.now()); // ✅ ריענון גלריה

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
        console.log("❌ gallery listen error:", err?.code, err?.message);
        setGallery([]);
        setGalleryUpdatedAt(Date.now());
        setGalleryLoading(false);
      }
    );
    return () => unsub();
  }, []);

  async function pickAndUploadImage() {
    if (!userId) {
      Alert.alert("צריך להתחבר", "כדי להעלות תמונות צריך להתחבר.");
      return;
    }

    const ok = await ensureMediaPermission();
    if (!ok) return;

    setUploadingImg(true);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
        allowsEditing: true,
      });

      if (res.canceled) return;

      const asset = res.assets?.[0];
      if (!asset?.uri) return;

      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 900 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );

      if (!manipulated?.base64) {
        Alert.alert("שגיאה", "לא הצליח לעבד את התמונה");
        return;
      }

      const dataUrl = `data:image/jpeg;base64,${manipulated.base64}`;
      const newImg = {
        id: makeId(),
        dataUrl,
        createdAt: Date.now(),
        createdBy: userId,
      };

      const ref = doc(db, "business", "galleryMain");

      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const prev =
          snap.exists() && Array.isArray(snap.data()?.images) ? snap.data().images : [];

        const MAX = 12;
        const next = [newImg, ...prev].slice(0, MAX);

        tx.set(
          ref,
          {
            images: next,
            updatedAt: serverTimestamp(),
            updatedBy: userId,
          },
          { merge: true }
        );
      });

      Alert.alert("הועלה ✅", "התמונה נוספה לגלריה");
    } catch (e) {
      console.log("❌ upload gallery image error:", e?.message || e);
      Alert.alert("שגיאה", "לא הצליח להעלות תמונה (יתכן שהקובץ גדול מדי)");
    } finally {
      setUploadingImg(false);
    }
  }

  async function deleteGalleryImage(imgId) {
    // מחיקה בפועל מה-Firestore לפי המצב הנוכחי ב-state
    const doDelete = async () => {
      try {
        const ref = doc(db, "business", "galleryMain");

        // משתמשים ב-gallery מה-state
        const prev = Array.isArray(gallery) ? gallery : [];
        const next = prev.filter((x) => x?.id !== imgId);

        await setDoc(
          ref,
          {
            images: next,
            updatedAt: serverTimestamp(),
            updatedBy: userId || null,
          },
          { merge: true }
        );

        if (Platform.OS !== "web") {
          Alert.alert("נמחק ✅", "התמונה נמחקה מהגלריה");
        }
      } catch (e) {
        console.log("❌ delete image error:", e?.message || e);
        Alert.alert("שגיאה", "לא הצליח למחוק תמונה");
      }
    };

    // 🌐 Web – window.confirm
    if (Platform.OS === "web") {
      const ok = window.confirm("למחוק את התמונה מהגלריה?");
      if (ok) {
        doDelete();
      }
      return;
    }

    // 📱 מובייל – Alert עם כפתורים
    Alert.alert("מחיקת תמונה", "למחוק את התמונה מהגלריה?", [
      { text: "ביטול", style: "cancel" },
      { text: "מחקי", style: "destructive", onPress: doDelete },
    ]);
  }



  // ====== Reviews (owner can delete any) ======
  const [reviews, setReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);

  useEffect(() => {
    const q1 = query(collection(db, "reviews"), orderBy("updatedAt", "desc"), limit(50));
    const unsub = onSnapshot(
      q1,
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setReviews(arr);
        setReviewsLoading(false);
      },
      (err) => {
        console.log("❌ reviews listen error:", err?.code, err?.message);
        setReviews([]);
        setReviewsLoading(false);
      }
    );
    return () => unsub();
  }, []);

  async function deleteAnyReview(reviewId) {
    Alert.alert("מחיקת ביקורת", "למחוק את הביקורת הזו?", [
      { text: "ביטול", style: "cancel" },
      {
        text: "מחקי",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteDoc(doc(db, "reviews", reviewId));
            Alert.alert("נמחק ✅", "הביקורת נמחקה");
          } catch (e) {
            console.log("❌ owner delete review error:", e?.message || e);
            Alert.alert("שגיאה", "לא הצליח למחוק ביקורת");
          }
        },
      },
    ]);
  }

  // ✅ מעבר ליומן (אם השם אצלך שונה ב-Navigator – תשני כאן)
  function goToCalendar() {
    navigation.navigate("OwnerDashboard");
  }

  if (ownerCheckLoading) {
    return (
      <View style={[globalStyles.container, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator />
        <Text style={{ marginTop: 10, fontWeight: "800", color: "#666" }}>טוען…</Text>
      </View>
    );
  }

  if (!userId || !isOwner) {
    return (
      <View style={[globalStyles.container, { justifyContent: "center", padding: 16 }]}>
        <View
          style={{
            backgroundColor: "#fff",
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 16,
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: "900", color: colors.primary, textAlign: "center" }}>
            אין הרשאה
          </Text>
          <Text style={{ marginTop: 10, fontWeight: "800", color: "#444", textAlign: "center" }}>
            המסך הזה מיועד לבעלת העסק בלבד.
          </Text>
        </View>
      </View>
    );
  }

  const hasUploaded = Array.isArray(gallery) && gallery.length > 0;

  return (
    <View style={[globalStyles.container, { backgroundColor: "transparent" }]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 110 }} // ✅ מקום לכפתור בתחתית
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
          <Image
            source={hasLogo ? { uri: normalizeImgUri(b.logoDataUrl, logoUpdatedAt) } : LOGO_FALLBACK}
            style={{ width: 96, height: 96, borderRadius: 18, backgroundColor: "#f2f2f2" }}
            resizeMode="cover"
          />

          {/* ✅ ניהול לוגו */}
          <View style={{ width: "65%", marginTop: 10, flexDirection: "row", gap: 10 }}>
            <Pressable
              onPress={pickAndUploadLogo}
              disabled={uploadingLogo}
              style={({ pressed }) => [
                {
                  flex: 1,
                  backgroundColor: colors.primary,
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: "center",
                  opacity: uploadingLogo ? 0.6 : pressed ? 0.88 : 1,
                },
                Platform.OS === "web" ? { cursor: "pointer" } : null,
              ]}
            >
              <Text style={{ color: "#fff", fontWeight: "600" }}>
                {uploadingLogo ? "מעלה..." : "החלפת לוגו 🖼️"}
              </Text>
            </Pressable>

            <Pressable
              onPress={removeLogo}
              disabled={uploadingLogo}
              style={({ pressed }) => [
                {
                  width: 110,
                  backgroundColor: "#fff",
                  borderWidth: 1,
                  borderColor: "#c62828",
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: "center",
                  opacity: uploadingLogo ? 0.6 : pressed ? 0.88 : 1,
                },
                Platform.OS === "web" ? { cursor: "pointer" } : null,
              ]}
            >
              <Text style={{ color: "#c62828", fontWeight: "900" }}>מחיקה</Text>
            </Pressable>
          </View>

          <Text style={{ marginTop: 10, fontSize: 22, fontWeight: "900", color: colors.primary, textAlign: "center" }}>
            {b.businessName || "העסק שלי"}
          </Text>

          <Text style={{ marginTop: 6, fontSize: 15, fontWeight: "800", color: colors.textDark, textAlign: "center" }}>
            בעלת העסק: {b.ownerName || "—"}
          </Text>

          <Pressable
            onPress={() => setEditOpen(true)}
            style={({ pressed }) => [
              {
                marginTop: 10,
                backgroundColor: "#fff",
                borderWidth: 1,
                borderColor: colors.primary,
                paddingVertical: 12,
                borderRadius: 12,
                width: "100%",
                alignItems: "center",
                opacity: pressed ? 0.88 : 1,
              },
              Platform.OS === "web" ? { cursor: "pointer" } : null,
            ]}
          >
            <Text style={{ color: colors.primary, fontWeight: "900" }}>עריכת פרטי העסק ✏️</Text>
          </Pressable>
        </View>

        {/* Actions */}
        <SectionTitle>יצירת קשר וניווט</SectionTitle>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <ActionCard title="וואטסאפ" subtitle="פתיחת צ'אט" icon={whatsappLogo} onPress={() => openUrl(links.wa)} />
          <ActionCard title="טלפון" subtitle={b.phoneDial || "—"} icon={phoneLogo} onPress={() => openUrl(links.tel)} />
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <ActionCard
            title="אינסטגרם"
            subtitle={b.instagramHandle ? `@${b.instagramHandle}` : "—"}
            icon={instagramLogo}
            onPress={async () => {
              if (!links.igWeb) return;
              const canDeep = links.igDeep ? await Linking.canOpenURL(links.igDeep) : false;
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
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
            <Pressable
              onPress={pickAndUploadImage}
              disabled={uploadingImg}
              style={({ pressed }) => [
                {
                  flex: 1,
                  backgroundColor: colors.primary,
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: "center",
                  opacity: uploadingImg ? 0.6 : pressed ? 0.88 : 1,
                },
                Platform.OS === "web" ? { cursor: "pointer" } : null,
              ]}
            >
              <Text style={{ color: "#fff", fontWeight: "900" }}>
                {uploadingImg ? "מעלה..." : "העלאת תמונה +"}
              </Text>
            </Pressable>

          </View>

          {galleryLoading ? (
            <Text
              style={{ textAlign: "right", color: "gray", fontWeight: "700" }}
            >
              טוען גלריה…
            </Text>
          ) : !hasUploaded ? (
            <Text
              style={{ textAlign: "right", color: "gray", fontWeight: "700" }}
            >
              אין עדיין תמונות בגלריה.
            </Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: "row", gap: 10 }}>
                {gallery.map((img) => (
                  <View
                    key={`${img.id}_${galleryUpdatedAt}`}
                    style={{ width: 160 }}
                  >
                    <Image
                      source={{
                        uri: normalizeImgUri(img.dataUrl, galleryUpdatedAt),
                      }}
                      style={{
                        width: 160,
                        height: 160,
                        borderRadius: 14,
                        backgroundColor: "#f2f2f2",
                      }}
                      resizeMode="cover"
                    />

                    <Pressable
                      onPress={() => deleteGalleryImage(img.id)}
                      style={({ pressed }) => [
                        {
                          marginTop: 8,
                          backgroundColor: "#fff",
                          borderWidth: 1,
                          borderColor: "#c62828",
                          paddingVertical: 10,
                          borderRadius: 12,
                          alignItems: "center",
                          opacity: pressed ? 0.88 : 1,
                        },
                        Platform.OS === "web"
                          ? { cursor: "pointer" }
                          : null,
                      ]}
                    >
                      <Text
                        style={{ color: "#c62828", fontWeight: "900" }}
                      >
                        מחיקה 🗑️
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            </ScrollView>
          )}
        </View>

        {/* Reviews */}
        <SectionTitle>ביקורות</SectionTitle>

        <View style={{ marginTop: 10 }}>
          {reviewsLoading ? (
            <Text style={{ textAlign: "right", color: "gray" }}>טוען ביקורות…</Text>
          ) : reviews.length === 0 ? (
            <Text style={{ textAlign: "right", color: "gray" }}>אין עדיין ביקורות.</Text>
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

                <Pressable
                  onPress={() => deleteAnyReview(r.id)}
                  style={({ pressed }) => [
                    {
                      marginTop: 10,
                      backgroundColor: "#fff",
                      borderWidth: 1,
                      borderColor: "#c62828",
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderRadius: 12,
                      alignItems: "center",
                      opacity: pressed ? 0.88 : 1,
                    },
                    Platform.OS === "web" ? { cursor: "pointer" } : null,
                  ]}
                >
                  <Text style={{ color: "#c62828", fontWeight: "900" }}>מחיקת ביקורת 🗑️</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>

        <Text style={{ textAlign: "center", color: "#666", fontWeight: "700", marginTop: 6 }}>
          נתקלת בבעיה? אפשר לפנות אלינו דרך וואטסאפ או טלפון.
        </Text>
      </ScrollView>

      {/* ✅ כפתור תחתון קבוע למסך היומן */}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: 14,
          backgroundColor: "rgba(255,255,255,0.96)",
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        <Pressable
          onPress={goToCalendar}
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
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>מעבר ליומן 📅</Text>
        </Pressable>
      </View>

      {/* ===== MODAL: עריכת פרטי העסק ===== */}
      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 16 }}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ fontSize: 18, fontWeight: "900", textAlign: "center", color: colors.primary }}>
                  עריכת דף העסק
                </Text>

                <TextInput
                  value={fBusinessName}
                  onChangeText={setFBusinessName}
                  placeholder="שם העסק"
                  placeholderTextColor="#777"
                  style={[globalStyles.input, { marginTop: 12, textAlign: "right" }]}
                />

                <TextInput
                  value={fOwnerName}
                  onChangeText={setFOwnerName}
                  placeholder="שם בעלת העסק"
                  placeholderTextColor="#777"
                  style={[globalStyles.input, { marginTop: 8, textAlign: "right" }]}
                />

                <TextInput
                  value={fPhoneDial}
                  onChangeText={setFPhoneDial}
                  placeholder="טלפון (054...)"
                  placeholderTextColor="#777"
                  keyboardType="phone-pad"
                  style={[globalStyles.input, { marginTop: 8, textAlign: "right" }]}
                />

                <TextInput
                  value={fPhoneInternational}
                  onChangeText={setFPhoneInternational}
                  placeholder="טלפון בינלאומי (972...)"
                  placeholderTextColor="#777"
                  keyboardType="number-pad"
                  style={[globalStyles.input, { marginTop: 8, textAlign: "right" }]}
                />

                <TextInput
                  value={fInstagramHandle}
                  onChangeText={setFInstagramHandle}
                  placeholder="Instagram handle (בלי @)"
                  placeholderTextColor="#777"
                  style={[globalStyles.input, { marginTop: 8, textAlign: "right" }]}
                />

                <TextInput
                  value={fWazeAddress}
                  onChangeText={setFWazeAddress}
                  placeholder="כתובת ל-Waze"
                  placeholderTextColor="#777"
                  style={[globalStyles.input, { marginTop: 8, textAlign: "right" }]}
                />

                <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                  <Pressable
                    onPress={() => setEditOpen(false)}
                    disabled={savingBusiness}
                    style={({ pressed }) => [
                      {
                        flex: 1,
                        paddingVertical: 12,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: "#bbb",
                        alignItems: "center",
                        opacity: savingBusiness ? 0.6 : pressed ? 0.88 : 1,
                      },
                      Platform.OS === "web" ? { cursor: "pointer" } : null,
                    ]}
                  >
                    <Text style={{ fontWeight: "900" }}>ביטול</Text>
                  </Pressable>

                  <Pressable
                    onPress={saveBusiness}
                    disabled={savingBusiness}
                    style={({ pressed }) => [
                      {
                        flex: 1,
                        paddingVertical: 12,
                        borderRadius: 12,
                        backgroundColor: colors.primary,
                        alignItems: "center",
                        opacity: savingBusiness ? 0.6 : pressed ? 0.88 : 1,
                      },
                      Platform.OS === "web" ? { cursor: "pointer" } : null,
                    ]}
                  >
                    <Text style={{ fontWeight: "900", color: "#fff" }}>{savingBusiness ? "שומר..." : "שמירה"}</Text>
                  </Pressable>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}
