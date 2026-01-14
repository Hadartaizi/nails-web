import React, { useState } from "react";
import { View, Text, TextInput, Pressable, Alert, StyleSheet, Platform } from "react-native";
import { signInWithEmailAndPassword } from "firebase/auth";
import Ionicons from "@expo/vector-icons/Ionicons";
import { auth } from "../firebaseConfig";
import colors from "../styles/colors";

// ✅ מסיר תווי כיוון נסתרים (RTL/LTR marks) + רווחים
function cleanEmail(raw) {
  return (raw || "")
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .trim()
    .toLowerCase();
}

function showAlert(title, message) {
  if (Platform.OS === "web") {
    // eslint-disable-next-line no-alert
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleLogin = async () => {
    const e = cleanEmail(email);
    const p = password;

    if (!e || !p) {
      showAlert("שגיאה", "אנא מלא/י אימייל וסיסמה");
      return;
    }

    if (busy) return;
    setBusy(true);

    try {
      await signInWithEmailAndPassword(auth, e, p);

      // ✅ חשוב: לא עושים כאן navigation.reset בכלל!
      // AppNavigator מאזין ל-onAuthStateChanged ומעביר אוטומטית:
      // owner -> OwnerDashboard
      // customer -> BusinessHome (או מה שהגדרת ב-initialRouteName)
    } catch (error) {
      let msg = "אירעה שגיאה, נסי שוב";
      if (error?.code === "auth/invalid-credential") msg = "אימייל או סיסמה שגויים";
      else if (error?.code === "auth/invalid-email") msg = "כתובת אימייל לא תקינה";
      else if (error?.code === "auth/user-disabled") msg = "המשתמש נחסם";

      showAlert("שגיאה", msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>התחברות למערכת</Text>

      {/* ===== אימייל ===== */}
      <Text style={styles.label}>📧 אימייל</Text>
      <TextInput
        placeholder="הקלידי את האימייל שלך"
        placeholderTextColor="#666"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.emailInput}
      />

      {/* ===== סיסמה + עין ===== */}
      <Text style={styles.label}>🔒 סיסמה</Text>

      <View style={styles.passwordWrapper}>
        <TextInput
          placeholder="הקלידי את הסיסמה"
          placeholderTextColor="#666"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          style={[styles.input, { paddingLeft: 44 }]}
          autoCapitalize="none"
        />

        <Pressable
          onPress={() => setShowPassword((prev) => !prev)}
          style={styles.eyeButton}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={showPassword ? "הסתר סיסמה" : "הצג סיסמה"}
        >
          {Platform.OS === "web" ? (
            <Text style={styles.webToggle}>{showPassword ? "הסתר" : "הצג"}</Text>
          ) : (
            <Ionicons
              name={showPassword ? "eye" : "eye-off"}
              size={22}
              color={colors.primary}
            />
          )}
        </Pressable>
      </View>

      <Pressable
        style={[styles.button, busy && { opacity: 0.6 }]}
        onPress={handleLogin}
        disabled={busy}
      >
        <Text style={styles.buttonText}>{busy ? "מתחבר..." : "התחבר"}</Text>
      </Pressable>

      <Pressable onPress={() => navigation.navigate("Register")}>
        <Text style={styles.loginLink}>עדיין לא רשום/ה? הירשם/י כאן</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: colors.background,
    justifyContent: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.primary,
    textAlign: "center",
    marginBottom: 22,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.primary,
    marginTop: 12,
    marginBottom: 6,
    textAlign: "right",
  },

  input: {
    width: "100%",
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontSize: 17,
    fontWeight: "600",
    backgroundColor: "#FFF",
    textAlign: "right",
    writingDirection: "rtl",
    color: "#000",
  },

  emailInput: {
    width: "100%",
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontSize: 17,
    fontWeight: "600",
    backgroundColor: "#FFF",
    textAlign: "right",
    writingDirection: "ltr",
    color: "#000",
  },

  passwordWrapper: {
    position: "relative",
    width: "100%",
  },
  eyeButton: {
    position: "absolute",
    left: 12,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    minWidth: 44,
  },
  webToggle: {
    color: colors.primary,
    fontWeight: "800",
    fontSize: 14,
  },

  button: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    marginTop: 28,
    alignItems: "center",
  },
  buttonText: {
    color: colors.textLight,
    fontSize: 18,
    fontWeight: "700",
  },
  loginLink: {
    marginTop: 16,
    textAlign: "center",
    fontSize: 15,
    color: colors.primary,
    textDecorationLine: "underline",
  },
});
