// frontend/components/AddToHomeScreenBanner.js
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  Platform,
  Image,
  useWindowDimensions,
} from "react-native";
import colors from "../styles/colors";

function isIos() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isAndroid() {
  if (typeof navigator === "undefined") return false;
  return /android/i.test(navigator.userAgent);
}

function isMobile() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod|android/i.test(navigator.userAgent);
}

function isInStandaloneMode() {
  if (typeof window === "undefined") return false;

  const standaloneByMedia =
    window.matchMedia &&
    window.matchMedia("(display-mode: standalone)").matches;

  const standaloneByNavigator = window.navigator.standalone === true;

  return standaloneByMedia || standaloneByNavigator;
}

export default function AddToHomeScreenBanner() {
  const [visible, setVisible] = useState(false);
  const { width: screenWidth } = useWindowDimensions();

  useEffect(() => {
    if (Platform.OS !== "web") return;

    if (isInStandaloneMode()) return;

    try {
      const done = window.localStorage.getItem("a2hs_done");
      if (done === "1") return;
    } catch {}

    setVisible(true);
  }, []);

  if (!visible) return null;

  const handleLater = () => setVisible(false);

  const handleDone = () => {
    try {
      window.localStorage.setItem("a2hs_done", "1");
    } catch {}
    setVisible(false);
  };

  const onMobile = isMobile();
  let instructionsTitle = "";
  let instructions = "";

  if (onMobile && isIos()) {
    instructionsTitle = "איך לשמור כאפליקציה באייפון:";
    instructions =
      "1. לחצי על כפתור השיתוף (ריבוע עם חץ ⬆️) בתחתית הדפדפן.\n" +
      "2. גללי למטה ובחרי - הוספה למסך הבית (Add to Home Screen).\n" +
      "3. אשרי את השם ולחצי על - הוספה.";
  } else if (onMobile && isAndroid()) {
    instructionsTitle = "איך לשמור כאפליקציה באנדרואיד:";
    instructions =
      "1. בכרום לחצי על תפריט ⋮ בצד ימין למעלה.\n" +
      "2. בחרי - הוסף למסך הבית או Install app.\n" +
      "3. אשרי את הפעולה.";
  } else {
    instructionsTitle = "איך להתקין את המערכת במחשב:";
    instructions =
      "1. בדפדפן (מומלץ Chrome) לחצי על כפתור ההתקנה ליד שורת הכתובת (אייקון של מסך עם חץ/פלוס).\n" +
      "2. בחרי Install app או התקן אפליקציה.\n" +
      "3. אשרי את ההתקנה.\n\n" +
      "לא רואה אייקון התקנה? נסי לפתוח את הקישור גם מהנייד 🙂";
  }

  // ===== רספונסיביות =====
  const isVerySmall = screenWidth <= 360;
  const isNarrow = screenWidth <= 320;
  const isTabletOrDesktop = screenWidth >= 768;

  const cardWidth = Math.min(screenWidth - 16, 430);
  const logoSize = isVerySmall ? 56 : isTabletOrDesktop ? 90 : 72;

  const titleFontSize = isVerySmall ? 16 : isTabletOrDesktop ? 20 : 18;
  const textFontSize = isVerySmall ? 12 : 14;
  const buttonFontSize = isVerySmall ? 12 : 13;

  const verticalPadding = isVerySmall ? 10 : 14;
  const horizontalPadding = isVerySmall ? 10 : 16;

  // במסכים ממש צרים – כפתורים אחד מתחת לשני
  const buttonsInColumn = isVerySmall || isNarrow;

  return (
    <View
      style={{
        position: "fixed",
        bottom: isVerySmall ? 6 : 14,
        left: 0,
        right: 0,
        zIndex: 9999,
        alignItems: "center",
        pointerEvents: "none",
      }}
    >
      <View
        style={{
          width: cardWidth,
          backgroundColor: "#fff",
          borderRadius: 20,
          borderWidth: 1,
          borderColor: colors.border || "#e0e0e0",
          paddingVertical: verticalPadding,
          paddingHorizontal: horizontalPadding,
          shadowColor: "#000",
          shadowOpacity: 0.18,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 5 },
          elevation: 8,
          pointerEvents: "auto",
        }}
      >
        {/* לוגו + כותרת */}
        <View style={{ alignItems: "center", marginBottom: 10 }}>
          <Image
            source={require("../assets/appLogoApp.png")}
            style={{
              width: logoSize,
              height: logoSize,
              borderRadius: logoSize / 2,
              marginBottom: 6,
            }}
            resizeMode="cover"
          />
          <Text
            style={{
              fontSize: titleFontSize,
              fontWeight: "900",
              color: colors.primary,
              textAlign: "center",
              marginBottom: 2,
            }}
          >
            Rotem Nails Studio
          </Text>
          <Text
            style={{
              fontSize: textFontSize,
              color: colors.textDark || "#555",
              textAlign: "center",
            }}
          >
            כמעט סיימנו! 📲{"\n"}
            שמרי את המערכת כאפליקציה כדי לראות תורים מהר ולקבל התראות בזמן.
          </Text>
        </View>

        {/* הוראות ברורות */}
        <View
          style={{
            backgroundColor: "#f9f9f9",
            borderRadius: 12,
            paddingVertical: isVerySmall ? 6 : 8,
            paddingHorizontal: isVerySmall ? 8 : 10,
            marginBottom: 10,
          }}
        >
          <Text
            style={{
              fontSize: textFontSize,
              fontWeight: "700",
              color: colors.textDark || "#333",
              textAlign: "right",
              marginBottom: 4,
            }}
          >
            {instructionsTitle}
          </Text>
          <Text
            style={{
              fontSize: textFontSize,
              color: colors.textDark || "#444",
              textAlign: "right",
              lineHeight: isVerySmall ? 17 : 19,
            }}
          >
            {instructions}
          </Text>
        </View>

        {/* כפתורים – רספונסיבי */}
        <View
          style={{
            flexDirection: buttonsInColumn ? "column" : "row",
            gap: 8,
          }}
        >
          <Pressable
            onPress={handleLater}
            style={{
              flex: 1,
              width: "100%",
              paddingVertical: isVerySmall ? 8 : 10,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border || "#ccc",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                fontWeight: "700",
                color: colors.textDark || "#333",
                fontSize: buttonFontSize,
                textAlign: "center",
              }}
            >
              תזכיר לי אחר כך
            </Text>
          </Pressable>

          <Pressable
            onPress={handleDone}
            style={{
              flex: 1,
              width: "100%",
              marginTop: buttonsInColumn ? 6 : 0,
              paddingVertical: isVerySmall ? 8 : 10,
              borderRadius: 12,
              backgroundColor: colors.primary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                fontWeight: "900",
                color: "#fff",
                fontSize: buttonFontSize,
                textAlign: "center",
              }}
            >
              סיימתי, אפשר לסגור ✅
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
