// frontend/navigation/AppNavigator.js
import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, Text } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "../firebaseConfig";

// Auth
import LoginScreen from "../screens/LoginScreen";
import RegistrationScreen from "../screens/RegistrationScreen";

// Customer / Business
import BusinessHomeScreen from "../screens/BusinessHomeScreen";
import CalendarScreen from "../screens/CalendarScreen";
import DayScreen from "../screens/DayScreen";
import HistoryScreen from "../screens/HistoryScreen";
import PricesScreen from "../screens/PricesScreen";

// Owner
import OwnerDashboard from "../screens/OwnerDashboard";
import BusinessHomeOwnerScreen from "../screens/BusinessHomeOwnerScreen"; // ✅ חדש

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);

      // לא מחובר
      if (!u) {
        setRole(null);
        setLoading(false);
        return;
      }

      // מחובר => מביא role מה-users/{uid}
      try {
        const snap = await getDoc(doc(db, "users", u.uid));
        const r = snap.exists() ? snap.data()?.role : null;
        setRole(r || "customer");
      } catch (e) {
        console.log("❌ role read error:", e?.message || e);
        setRole("customer");
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  // Loader
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // לא מחובר => Auth stack
  if (!user) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Register" component={RegistrationScreen} />
      </Stack.Navigator>
    );
  }

  // בעלת העסק => Owner stack
  if (role === "owner") {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="OwnerDashboard" component={OwnerDashboard} />
        {/* ✅ דף העסק עם עריכה לבעלת העסק בלבד */}
        <Stack.Screen name="BusinessHomeOwner" component={BusinessHomeOwnerScreen} />
      </Stack.Navigator>
    );
  }

  // לקוחות => Customer stack
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="BusinessHome" component={BusinessHomeScreen} />
      <Stack.Screen name="Calendar" component={CalendarScreen} />
      <Stack.Screen name="Day" component={DayScreen} />
      <Stack.Screen name="History" component={HistoryScreen} />
      <Stack.Screen name="Prices" component={PricesScreen} />
    </Stack.Navigator>
  );
}
