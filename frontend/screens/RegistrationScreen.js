import React, { useState } from "react";
import {
  Text,
  TextInput,
  Pressable,
  Alert,
  StyleSheet,
  ScrollView,
  View,
} from "react-native";

import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import Ionicons from "@expo/vector-icons/Ionicons";
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "../firebaseConfig";
import colors from "../styles/colors";

export default function RegistrationScreen({ navigation }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // UID של בעלת המערכת
  const OWNER_UID = "iHJ54AXLKfhMdoRX3bWek01PqhO2";

  const handleRegister = async () => {
    const f = firstName.trim();
    const l = lastName.trim();
    const ph = phone.replace(/[^\d]/g, "");
    const e = email.trim().toLowerCase();
    const p = password;

    if (!f || !l || !ph || !e || !p) {
      Alert.alert("שגיאה", "אנא מלא/י את כל השדות");
      return;
    }

    if (ph.length < 9) {
      Alert.alert("שגיאה", "מספר טלפון לא תקין");
      return;
    }

    if (p.length < 6) {
      Alert.alert("שגיאה", "הסיסמה חייבת להכיל לפחות 6 תווים");
      return;
    }

    setLoading(true);

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, e, p);
      const user = userCredential.user;

      await updateProfile(user, { displayName: `${f} ${l}` });

      const role = user.uid === OWNER_UID ? "owner" : "customer";

      await setDoc(
        doc(db, "users", user.uid),
        {
          firstName: f,
          lastName: l,
          phone: ph,
          email: user.email,
          role,
          createdAt: Date.now(),
        },
        { merge: true }
      );

      Alert.alert(
        "🎉 ההרשמה בוצעה בהצלחה",
        "אפשר להתחבר למערכת",
        [{ text: "התחברות", onPress: () => navigation.navigate("Login") }]
      );
    } catch (error) {
      let msg = "אירעה שגיאה בהרשמה";
      if (error.code === "auth/email-already-in-use") msg = "המייל כבר קיים";
      else if (error.code === "auth/invalid-email") msg = "מייל לא תקין";
      else if (error.code === "auth/weak-password") msg = "סיסמה חלשה";

      Alert.alert("שגיאה", msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>הרשמה למערכת</Text>

      <Text style={styles.label}>👤 שם פרטי</Text>
      <TextInput
        value={firstName}
        onChangeText={setFirstName}
        style={styles.input}
        placeholder="שם פרטי"
        placeholderTextColor="#666"
      />

      <Text style={styles.label}>👥 שם משפחה</Text>
      <TextInput
        value={lastName}
        onChangeText={setLastName}
        style={styles.input}
        placeholder="שם משפחה"
        placeholderTextColor="#666"
      />

      <Text style={styles.label}>📱 טלפון</Text>
      <TextInput
        value={phone}
        onChangeText={setPhone}
        style={styles.input}
        placeholder="05XXXXXXXX"
        placeholderTextColor="#666"
        keyboardType="phone-pad"
      />

      <Text style={styles.label}>📧 אימייל</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        style={styles.emailInput}
        placeholder="example@mail.com"
        placeholderTextColor="#666"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>🔒 סיסמה</Text>

      {/* ===== סיסמה + עין ===== */}
      <View style={styles.passwordWrapper}>
        <TextInput
          value={password}
          onChangeText={setPassword}
          style={[styles.input, { paddingLeft: 48 }]} // ✅ לא מזיז מימין
          placeholder="סיסמה"
          placeholderTextColor="#666"
          secureTextEntry={!showPassword}
          autoCapitalize="none"
        />

        <Pressable
          onPress={() => setShowPassword((prev) => !prev)}
          style={styles.eyeButton}
          hitSlop={10}
        >
          <Ionicons
            name={showPassword ? "eye" : "eye-off"}
            size={22}
            color={colors.primary}
          />
        </Pressable>
      </View>

      <Pressable style={styles.button} onPress={handleRegister} disabled={loading}>
        <Text style={styles.buttonText}>
          {loading ? "טוען..." : "הרשמה"}
        </Text>
      </Pressable>

      <Pressable onPress={() => navigation.navigate("Login")} disabled={loading}>
        <Text style={styles.loginLink}>כבר יש לך חשבון? התחבר/י כאן</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 20,
    backgroundColor: colors.background,
    justifyContent: "center",
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: colors.primary,
    textAlign: "center",
    marginBottom: 18,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.primary,
    textAlign: "right",
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    width: "100%",
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
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
    paddingVertical: 12,
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
  },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    marginTop: 24,
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
