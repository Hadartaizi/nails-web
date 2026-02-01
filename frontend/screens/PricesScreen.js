// frontend/screens/PricesScreen.js
import React, { useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  useWindowDimensions,
} from "react-native";

import colors from "../styles/colors";
import AppBackground from "../components/AppBackground"; // ✅ רקע תמונה

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

  return (
    <AppBackground>
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

        {/* כפתור חזרה – כמו בהיסטוריית תורים (סגול מלא, טקסט לבן) */}
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
    </AppBackground>
  );
}
