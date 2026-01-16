// frontend/screens/PricesScreen.js
import React, { useMemo } from "react";
import { View, Text, Pressable, useWindowDimensions } from "react-native";
import globalStyles from "../styles/global";
import colors from "../styles/colors";

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
    <View style={[globalStyles.container, { backgroundColor: "transparent" }]}>
      <View
        style={{
          backgroundColor: "#fff",
          borderRadius: rf(16),
          borderWidth: 1,
          borderColor: colors.border,
          padding: rf(16),
        }}
      >
        <Text
          style={{
            fontSize: rf(24),
            fontWeight: "900",
            color: colors.primary,
            textAlign: "center",
            flexWrap: "wrap",
          }}
        >
          מחירים
        </Text>

        <View style={{ marginTop: rf(14) }}>
          <Text
            style={{
              fontSize: rf(16),
              fontWeight: "800",
              color: colors.textDark,
              lineHeight: rf(26),
              textAlign: "right",
              writingDirection: "rtl",
              flexWrap: "wrap",
            }}
          >
            מבנה אנטומי לציפורניים קצרות – 100₪{"\n"}
            מילוי בג'ל ארוכות – 130₪{"\n"}
            מילוי בטיפסים – 220₪{"\n"}
            בניה חדשה בגודל בינוני – 220₪{"\n"}
            בניה חדשה ארוכות – 250₪{"\n"}
            השלמת ציפורן – 10₪{"\n"}
            סדק – 5₪{"\n"}{"\n"}
            מחיר דוגמאות וציורים תלוי בדוגמא ולכן המחיר יקבע אינדיבידואלית 

          </Text>
        </View>

        <Pressable
          onPress={() => navigation.goBack()}
          style={{
            marginTop: rf(18),
            backgroundColor: "#fff",
            borderRadius: rf(12),
            borderWidth: 1,
            borderColor: colors.primary,
            paddingVertical: rf(10),
            alignItems: "center",
          }}
        >
          <Text style={{ color: colors.primary, fontWeight: "900", fontSize: rf(15), flexWrap: "wrap" }}>חזרה</Text>
        </Pressable>
      </View>
    </View>
  );
}
