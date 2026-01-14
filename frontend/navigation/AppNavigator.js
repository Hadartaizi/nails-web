import React, { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";
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

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null); // "owner" | "customer"

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);

      if (!u?.uid) {
        setRole(null);
        setInitializing(false);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "users", u.uid));
        const r = snap.exists() ? snap.data()?.role : null;

        // רק owner מפורש ייחשב owner
        setRole(r === "owner" ? "owner" : "customer");
      } catch (e) {
        console.log("role read error:", e?.message || e);
        setRole("customer");
      } finally {
        setInitializing(false);
      }
    });

    return () => unsub();
  }, []);

  if (initializing) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  // לא מחובר
  if (!user) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Registration" component={RegistrationScreen} />
      </Stack.Navigator>
    );
  }

  // OWNER: גם OwnerDashboard וגם כל מסכי הלקוחה (כולל BusinessHome)
  if (role === "owner") {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="OwnerDashboard">
        <Stack.Screen name="OwnerDashboard" component={OwnerDashboard} />

        {/* מסך העסק שמוצג גם ללקוחה */}
        <Stack.Screen name="BusinessHome" component={BusinessHomeScreen} />

        {/* שאר מסכי הלקוחה */}
        <Stack.Screen name="Calendar" component={CalendarScreen} />
        <Stack.Screen name="Day" component={DayScreen} />
        <Stack.Screen name="History" component={HistoryScreen} />
        <Stack.Screen name="Prices" component={PricesScreen} />
      </Stack.Navigator>
    );
  }

  // CUSTOMER: דף ראשון BusinessHome
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="BusinessHome">
      <Stack.Screen name="BusinessHome" component={BusinessHomeScreen} />
      <Stack.Screen name="Calendar" component={CalendarScreen} />
      <Stack.Screen name="Day" component={DayScreen} />
      <Stack.Screen name="History" component={HistoryScreen} />
      <Stack.Screen name="Prices" component={PricesScreen} />
    </Stack.Navigator>
  );
}
