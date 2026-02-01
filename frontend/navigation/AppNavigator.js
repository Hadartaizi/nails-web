// frontend/navigation/AppNavigator.js
import React, { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "../firebaseConfig";

// 👇 הרקע לכל האפליקציה (חוץ מלוגין/רישום)
import AppBackground from "../components/AppBackground";

// Auth
import LoginScreen from "../screens/LoginScreen";
import RegistrationScreen from "../screens/RegistrationScreen";

// Customer / Business
import BusinessHomeScreen from "../screens/BusinessHomeScreen";
import CalendarScreen from "../screens/CalendarScreen";
import DayScreen from "../screens/DayScreen";
import HistoryScreen from "../screens/HistoryScreen";
import PricesScreen from "../screens/PricesScreen";
import TermsScreen from "../screens/TermsScreen";

// Owner
import OwnerDashboard from "../screens/OwnerDashboard";
import BusinessHomeOwnerScreen from "../screens/BusinessHomeOwnerScreen";

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setUser(null);
        setRole(null);
        setLoading(false);
        return;
      }

      setUser(u);
      setLoading(true);

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

  if (loading) {
    // בזמן טעינה – בלי רקע, מסך פשוט
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // לא מחובר → לוגין + רישום *בלי* רקע
  if (!user) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Register" component={RegistrationScreen} />
      </Stack.Navigator>
    );
  }

  // ===== בעלת העסק → עם רקע =====
  if (role === "owner") {
    return (
      <AppBackground>
        {/* 👈 חשוב: ה־Navigator בתוך View עם flex:1 */}
        <View style={{ flex: 1 }}>
          <Stack.Navigator
            initialRouteName="OwnerDashboard"
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: "transparent" },
            }}
          >
            <Stack.Screen name="OwnerDashboard" component={OwnerDashboard} />
            <Stack.Screen
              name="BusinessHomeOwner"
              component={BusinessHomeOwnerScreen}
            />
          </Stack.Navigator>
        </View>
      </AppBackground>
    );
  }

  // ===== לקוחה רגילה → עם רקע =====
  return (
    <AppBackground>
      <View style={{ flex: 1 }}>
        <Stack.Navigator
          initialRouteName="BusinessHome"
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "transparent" },
          }}
        >
          <Stack.Screen name="BusinessHome" component={BusinessHomeScreen} />
          <Stack.Screen name="Calendar" component={CalendarScreen} />
          <Stack.Screen name="Day" component={DayScreen} />
          <Stack.Screen name="History" component={HistoryScreen} />
          <Stack.Screen name="Prices" component={PricesScreen} />
          <Stack.Screen name="Terms" component={TermsScreen} />
        </Stack.Navigator>
      </View>
    </AppBackground>
  );
}
