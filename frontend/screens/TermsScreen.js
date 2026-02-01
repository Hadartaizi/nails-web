// frontend/screens/TermsScreen.js
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  ActivityIndicator,
  BackHandler,
} from "react-native";

import { doc, serverTimestamp, setDoc, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

import { auth, db } from "../firebaseConfig";
import globalStyles from "../styles/global";
import colors from "../styles/colors";
import AppBackground from "../components/AppBackground";

const DEFAULT_TERMS_TEXT = `
איחורים / ביטולים:
* במידה ואת מאחרת – להודיע מראש.
* איחור עד רבע שעה מהשעה שנקבעה, מעבר לכך ייחשב כביטול תור וייגבה תשלום דמי ביטול.
* ביטול תור יתאפשר עד 24 שעות לפני מועד התור.
* ביטול שלא נעשה בזמן – יחויב ב־50% ממחיר הטיפול.
* ללא הסדרת התשלום – לא ייקבע תור נוסף.

הודעה מראש:
* במידה ונשברה לך ציפורן או יותר – חובה לעדכן מראש כדי שאוכל לקבוע תור ארוך יותר.
* אם הגעת עם יותר מ־4–5 ציפורניים שבורות ללא הודעה – ייתכן שנאלץ להוריד את הכל.

הצהרת בריאות:
* באחריות הלקוחה לעדכן על רגישויות, אלרגיות ומצבים רפואיים רלוונטיים.

שינויים בתקנון:
* התקנון עשוי להשתנות מעת לעת, ובכל שינוי משמעותי תתבקשי לאשר מחדש.
`.trim();

function showMsg(title, msg) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${msg || ""}`);
  } else {
    alert(`${title}\n\n${msg || ""}`);
  }
}

export default function TermsScreen({ navigation }) {
  const [userId, setUserId] = useState(auth.currentUser?.uid || null);
  const [loading, setLoading] = useState(true);

  const [termsText, setTermsText] = useState(DEFAULT_TERMS_TEXT);
  const [termsVersion, setTermsVersion] = useState(1);

  const [alreadyAccepted, setAlreadyAccepted] = useState(false);
  const [alreadyAcceptedVersion, setAlreadyAcceptedVersion] = useState(0);

  // --- auth listener ---
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUserId(u?.uid || null);
    });
    return unsub;
  }, []);

  // --- listen to terms settings ---
  useEffect(() => {
    const ref = doc(db, "settings", "terms");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setTermsText(DEFAULT_TERMS_TEXT);
          setTermsVersion(1);
          return;
        }
        const data = snap.data() || {};
        setTermsText((data.text || "").trim() || DEFAULT_TERMS_TEXT);
        setTermsVersion(Number(data.version || 1));
      },
      () => {
        setTermsText(DEFAULT_TERMS_TEXT);
        setTermsVersion(1);
      }
    );
    return unsub;
  }, []);

  // --- listen to user acceptance ---
  useEffect(() => {
    if (!userId) {
      setAlreadyAccepted(false);
      setAlreadyAcceptedVersion(0);
      setLoading(false);
      return;
    }

    const ref = doc(db, "users", userId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setAlreadyAccepted(false);
          setAlreadyAcceptedVersion(0);
          setLoading(false);
          return;
        }
        const data = snap.data() || {};
        setAlreadyAccepted(!!data.termsAccepted);
        setAlreadyAcceptedVersion(Number(data.termsAcceptedVersion || 0));
        setLoading(false);
      },
      () => {
        setAlreadyAccepted(false);
        setAlreadyAcceptedVersion(0);
        setLoading(false);
      }
    );

    return unsub;
  }, [userId]);

  const hasAcceptedCurrentVersion = useMemo(
    () => alreadyAccepted && alreadyAcceptedVersion === termsVersion,
    [alreadyAccepted, alreadyAcceptedVersion, termsVersion]
  );

  const isUpdatedVersionPending = useMemo(
    () => alreadyAccepted && !hasAcceptedCurrentVersion,
    [alreadyAccepted, hasAcceptedCurrentVersion]
  );

  const mustAcceptNow = useMemo(() => {
    if (loading) return false;
    if (!userId) return false;
    return !hasAcceptedCurrentVersion;
  }, [loading, userId, hasAcceptedCurrentVersion]);

  // 🔒 חסימת יציאה
  useEffect(() => {
    if (!mustAcceptNow) return;

    const backSub = BackHandler.addEventListener("hardwareBackPress", () => {
      showMsg(
        "שימי לב",
        isUpdatedVersionPending
          ? "התקנון עודכן, יש לאשר את הגרסה החדשה לפני המשך שימוש במערכת."
          : "כדי להמשיך במערכת חובה לאשר את התקנון."
      );
      return true;
    });

    const unsubNav = navigation.addListener("beforeRemove", (e) => {
      e.preventDefault();
      showMsg(
        "שימי לב",
        isUpdatedVersionPending
          ? "התקנון עודכן, יש לאשר את הגרסה החדשה לפני המשך שימוש במערכת."
          : "כדי להמשיך במערכת חובה לאשר את התקנון."
      );
    });

    return () => {
      backSub.remove();
      unsubNav();
    };
  }, [mustAcceptNow, navigation, isUpdatedVersionPending]);

  async function handleAccept() {
    if (!userId) {
      showMsg("שגיאה", "חייבים להיות מחוברים כדי לאשר את התקנון.");
      return;
    }

    if (hasAcceptedCurrentVersion) return;

    try {
      await setDoc(
        doc(db, "users", userId),
        {
          termsAccepted: true,
          termsAcceptedVersion: termsVersion,
          termsAcceptedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setAlreadyAccepted(true);
      setAlreadyAcceptedVersion(termsVersion);

      showMsg("תודה 🙏", "התקנון אושר בהצלחה.");
      navigation.goBack();
    } catch (e) {
      showMsg("שגיאה", e?.message || "לא הצלחנו לשמור את האישור.");
    }
  }

  // מצב טעינה – אפשר להשאיר עם globalStyles.container
  if (loading) {
    return (
      <AppBackground>
        <View
          style={[
            globalStyles.container,
            { alignItems: "center", backgroundColor: "transparent" },
          ]}
        >
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ marginTop: 10 }}>טוען תקנון…</Text>
        </View>
      </AppBackground>
    );
  }

  return (
    <AppBackground>
      {/* 👇 במקום globalStyles.container – מגדירים container מותאם בלי רקע סגול */}
      <View
        style={{
          flex: 1,
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 16,
          backgroundColor: "transparent", // אין רקע סגול
        }}
      >
        {/* כותרת */}
        <View
          style={{
            backgroundColor: "rgba(255,255,255,0.9)",
            borderRadius: 12,
            padding: 12,
            marginBottom: 10,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text
            style={{
              fontSize: 22,
              fontWeight: "900",
              textAlign: "center",
              color: colors.primary,
            }}
          >
            תקנון המערכת
          </Text>
          <Text style={{ textAlign: "center", fontSize: 12, color: "#777" }}>
            גרסה {termsVersion}
          </Text>
        </View>

        {/* טקסט התקנון */}
        <ScrollView
          style={{
            flex: 1,
            padding: 12,
            backgroundColor: "rgba(255,255,255,0.92)", // לבן שקוף מאחורי הטקסט
            borderRadius: 14,
          }}
          contentContainerStyle={{ paddingBottom: 8 }}
        >
          <Text
            style={{
              lineHeight: 22,
              textAlign: "right",
              writingDirection: "rtl",
              color: "#222",
            }}
          >
            {termsText}
          </Text>
        </ScrollView>

        {/* כפתור אישור */}
        <Pressable
          onPress={hasAcceptedCurrentVersion ? null : handleAccept}
          disabled={!userId || hasAcceptedCurrentVersion}
          style={{
            marginTop: 12,
            backgroundColor: hasAcceptedCurrentVersion
              ? "#2e7d32"
              : colors.primary,
            paddingVertical: 12,
            borderRadius: 10,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>
            {hasAcceptedCurrentVersion
              ? "התקנון אושר ✅"
              : "אני מאשר/ת שקראתי את התקנון"}
          </Text>
        </Pressable>

        {/* כפתור חזרה – סגול בלבד */}
        {!mustAcceptNow && (
          <Pressable
            onPress={() => navigation.goBack()}
            style={{
              marginTop: 10,
              backgroundColor: colors.primary, // סגול
              paddingVertical: 10,
              borderRadius: 10,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900" }}>חזרה</Text>
          </Pressable>
        )}
      </View>
    </AppBackground>
  );
}
