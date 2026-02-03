// frontend/screens/LoginScreen.js
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Alert,
  StyleSheet,
  Platform,
  ImageBackground,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from "firebase/auth";
import Ionicons from "@expo/vector-icons/Ionicons";
import { auth, db } from "../firebaseConfig";
import colors from "../styles/colors";

// 🔥 Firestore
import { doc, onSnapshot } from "firebase/firestore";

// 👇 תמונת ברירת מחדל מקומית
import bgImage from "../assets/backgroundOpenRegisApp.jpg";

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

// ✅ לא מוסיפים cache-bust ל-data:image/...base64,...
function normalizeImgUri(uri, bustValue) {
  const u = String(uri || "");
  if (!u) return "";
  if (u.startsWith("data:image/")) return u;
  const sep = u.includes("?") ? "&" : "?";
  return `${u}${sep}t=${bustValue}`;
}

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  // ✅ שכחת סיסמה
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  // ✅ כתובת רקע מה־Firestore (אם יש)
  // undefined = עדיין לא נטען, null = אין ערך, string = URL
  const [bgUrl, setBgUrl] = useState(undefined);
  const [bgUpdatedAt, setBgUpdatedAt] = useState(Date.now());

  // האזנה למסמך settings/business כדי לקבל backgroundOpenRegisAppUrl
  useEffect(() => {
    const ref = doc(db, "settings", "business");

    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setBgUrl(null);
          setBgUpdatedAt(Date.now());
          return;
        }
        const data = snap.data() || {};
        const url =
          typeof data.backgroundOpenRegisAppUrl === "string" &&
          data.backgroundOpenRegisAppUrl.trim()
            ? data.backgroundOpenRegisAppUrl.trim()
            : null;

        setBgUrl(url);
        setBgUpdatedAt(Date.now());
      },
      (err) => {
        console.log("❌ login background listen error:", err?.message || err);
        setBgUrl(null);
        setBgUpdatedAt(Date.now());
      }
    );

    return () => unsub();
  }, []);

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
      // AppNavigator מאזין ל-onAuthStateChanged ומנווט לבד
    } catch (error) {
      let msg = "אירעה שגיאה, נסי שוב";
      if (error?.code === "auth/invalid-credential")
        msg = "אימייל או סיסמה שגויים";
      else if (error?.code === "auth/invalid-email")
        msg = "כתובת אימייל לא תקינה";
      else if (error?.code === "auth/user-disabled") msg = "המשתמש נחסם";

      showAlert("שגיאה", msg);
    } finally {
      setBusy(false);
    }
  };

  // ✅ שחזור סיסמה
  const handlePasswordReset = async () => {
    const e = cleanEmail(resetEmail);

    if (!e) {
      showAlert("שחזור סיסמה", "אנא הזיני אימייל");
      return;
    }

    if (resetBusy) return;
    setResetBusy(true);

    try {
      await sendPasswordResetEmail(auth, e);
      showAlert(
        "נשלח מייל ✅",
        "שלחנו מייל עם קישור לאיפוס סיסמה.\nבדקי גם בתיקיית הספאם."
      );
      setShowResetModal(false);
      setResetEmail("");
    } catch (error) {
      let msg = "לא הצלחנו לשלוח מייל איפוס סיסמה";
      if (error?.code === "auth/user-not-found")
        msg = "לא קיים משתמש עם האימייל הזה";
      else if (error?.code === "auth/invalid-email")
        msg = "כתובת אימייל לא תקינה";

      showAlert("שגיאה", msg);
    } finally {
      setResetBusy(false);
    }
  };

  // 💡 עד ש־Firestore לא החזיר תשובה – לא מציגים את התמונה הישנה בכלל
  if (bgUrl === undefined) {
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

  // מקור הרקע בפועל – קודם מה־Firestore, אחרת קובץ מקומי
  const backgroundSource = bgUrl
    ? { uri: normalizeImgUri(bgUrl, bgUpdatedAt) }
    : bgImage;

  return (
    <ImageBackground
      source={backgroundSource}
      style={styles.bg}
      resizeMode="cover"
    >
      {/* שכבה לבנה שקופה שמכסה את כל המסך */}
      <View style={styles.overlay}>
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
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

          {/* ===== סיסמה ===== */}
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
            >
              {Platform.OS === "web" ? (
                <Text style={styles.webToggle}>
                  {showPassword ? "הסתר" : "הצג"}
                </Text>
              ) : (
                <Ionicons
                  name={showPassword ? "eye" : "eye-off"}
                  size={22}
                  color={colors.primary}
                />
              )}
            </Pressable>
          </View>

          {/* ===== שכחתי סיסמה ===== */}
          <Pressable onPress={() => setShowResetModal(true)}>
            <Text style={styles.forgotPassword}>שכחת סיסמה?</Text>
          </Pressable>

          <Pressable
            style={[styles.button, busy && { opacity: 0.6 }]}
            onPress={handleLogin}
            disabled={busy}
          >
            <Text style={styles.buttonText}>
              {busy ? "מתחבר..." : "התחבר"}
            </Text>
          </Pressable>

          <Pressable onPress={() => navigation.navigate("Register")}>
            <Text style={styles.loginLink}>
              עדיין לא רשום/ה? הירשם/י כאן
            </Text>
          </Pressable>
        </ScrollView>

        {/* ===== חלון איפוס סיסמה ===== */}
        {showResetModal && (
          <View style={styles.modalOverlay}>
            <View className="modalBox" style={styles.modalBox}>
              <Text style={styles.modalTitle}>איפוס סיסמה</Text>

              <Text style={styles.label}>📧 אימייל</Text>
              <TextInput
                placeholder="הקלידי את האימייל שלך"
                placeholderTextColor="#666"
                value={resetEmail}
                onChangeText={setResetEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.emailInput}
              />

              <Pressable
                style={[
                  styles.button,
                  resetBusy && { opacity: 0.6, marginTop: 18 },
                ]}
                onPress={handlePasswordReset}
                disabled={resetBusy}
              >
                <Text style={styles.buttonText}>
                  {resetBusy ? "שולח..." : "שליחת קישור"}
                </Text>
              </Pressable>

              <Pressable onPress={() => setShowResetModal(false)}>
                <Text style={styles.cancelText}>ביטול</Text>
              </Pressable>
            </View>
          </View>
        )}
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
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255, 255, 255, 0.5)",
  },
  container: {
    flexGrow: 1,
    padding: 20,
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
  forgotPassword: {
    marginTop: 8,
    textAlign: "left",
    color: colors.primary,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    marginTop: 22,
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
  modalOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalBox: {
    width: "90%",
    backgroundColor: "#FFF",
    padding: 20,
    borderRadius: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.primary,
    textAlign: "center",
    marginBottom: 14,
  },
  cancelText: {
    marginTop: 12,
    textAlign: "center",
    color: "#666",
    fontWeight: "700",
    textDecorationLine: "underline",
  },
});
