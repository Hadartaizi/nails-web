// frontend/components/AppBackground.js
import React from "react";
import { ImageBackground, StyleSheet, View } from "react-native";

// ⬇️ שימי כאן את תמונת הרקע שלך
const BG_IMAGE = require("../assets/backgroundAllApp.jpg");

export default function AppBackground({ children }) {
  return (
    <ImageBackground
      source={BG_IMAGE}
      style={styles.background}
      resizeMode="cover" // ✅ רספונסיבי, ממלא מסך בלי עיוות
    >
      {/* שכבת תוכן */}
      <View style={styles.overlay}>
        {children}
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,              // ✅ חובה לרספונסיביות
    width: "100%",
    height: "100%",
  },
  overlay: {
    flex: 1,
    backgroundColor: "transparent", // ❌ לא מכסה את התמונה
  },
});
