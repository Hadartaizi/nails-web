// frontend/screens/PricesScreen.js
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  useWindowDimensions,
  ActivityIndicator,
  ImageBackground,
  StyleSheet,
} from "react-native";

import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebaseConfig";

import colors from "../styles/colors";

// 👇 תמונת ברירת מחדל כמו בשאר המסכים
const BG_FALLBACK = require("../assets/backgroundOpenRegisApp.jpg");

// ✅ לא מוסיפים cache-bust ל-data:image/...base64,...
function normalizeImgUri(uri, bustValue) {
  const u = String(uri || "");
  if (!u) return "";
  if (u.startsWith("data:image/")) return u;
  const sep = u.includes("?") ? "&" : "?";
  return `${u}${sep}t=${bustValue}`;
}

export default function PricesScreen({ navigation }) {
  const { width } = useWindowDimensions();

  // ✅ פונט רספונסיבי לפי רוחב מסך
  const rf = useMemo(() => {
    return (base) => {
      if (width < 340) return Math.max(12, base - 6);
      if (width < 380) return Math.max(12, base - 4);
      if (width < 420) return Math.max(12, base - 2);
      if (width < 768) return base;
      if (width < 1024) return base + 2;
      return base + 4;
    };
  }, [width]);

  // ====== רקע דינמי לכל האפליקציה (backgroundAllAppUrl) ======
  // undefined = עדיין לא נטען, null = אין ערך, string = URL
  const [backgroundAllAppUrl, setBackgroundAllAppUrl] = useState(undefined);
  const [bgUpdatedAt, setBgUpdatedAt] = useState(Date.now());

  useEffect(() => {
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

  // 💡 עד ש-backgroundAllAppUrl לא נטען – מסך טעינה קטן
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
      {/* שכבת לבן שקופה מעל הרקע (כמו בשאר המסכים) */}
      <View style={styles.overlay}>
        <View
          style={{
            flex: 1,
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: rf(24),
            backgroundColor: "transparent",
          }}
        >
          {/* בלוק כותרת נפרד */}
          <View
            style={{
              backgroundColor: "rgba(255,255,255,0.92)",
              borderRadius: rf(16),
              borderWidth: 1,
              borderColor: colors.border,
              paddingVertical: rf(14),
              paddingHorizontal: rf(16),
              alignItems: "center",
            }}
          >
            <Text
              style={{
                fontSize: rf(24),
                fontWeight: "900",
                color: colors.primary,
                textAlign: "center",
              }}
            >
              מחירים
            </Text>
          </View>

          {/* בלוק מחירים נפרד מתחת לכותרת */}
          <View
            style={{
              marginTop: rf(12),
              backgroundColor: "rgba(255,255,255,0.9)",
              borderRadius: rf(16),
              borderWidth: 1,
              borderColor: colors.border,
              paddingVertical: rf(14),
              paddingHorizontal: rf(16),
            }}
          >
            <Text
              style={{
                fontSize: rf(16),
                fontWeight: "800",
                color: colors.textDark,
                lineHeight: rf(26),
                textAlign: "right",
                writingDirection: "rtl",
              }}
            >
              מבנה אנטומי לציפורניים קצרות – 100₪{"\n"}
              מילוי בג'ל ארוכות – 130₪{"\n"}
              מילוי בטיפסים – 220₪{"\n"}
              בניה חדשה בגודל בינוני – 220₪{"\n"}
              בניה חדשה ארוכות – 250₪{"\n"}
              השלמת ציפורן – 10₪{"\n"}
              סדק – 5₪{"\n"}
              {"\n"}
              מחיר דוגמאות וציורים תלוי בדוגמא ולכן המחיר יקבע אינדיבידואלית
            </Text>
          </View>

          {/* כפתור חזרה */}
          <Pressable
            onPress={() => navigation.goBack()}
            style={{
              marginTop: rf(18),
              backgroundColor: colors.primary,
              paddingVertical: rf(12),
              borderRadius: rf(14),
              alignItems: "center",
            }}
          >
            <Text
              style={{
                color: "#fff",
                fontWeight: "900",
                fontSize: rf(15),
              }}
            >
              חזרה
            </Text>
          </Pressable>
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
