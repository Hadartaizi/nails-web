// App.js
import React, { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { onAuthStateChanged } from "firebase/auth";

import { auth, setupWebPushForCurrentUser } from "./firebaseConfig";
import AppNavigator from "./navigation/AppNavigator";
import AddToHomeScreenBanner from "./components/AddToHomeScreenBanner";

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web") return;

    const unsub = onAuthStateChanged(auth, (user) => {
      console.log("global push, user:", user?.uid || null);

      if (user) {
        setIsLoggedIn(true);
        try {
          setupWebPushForCurrentUser();
        } catch (e) {
          console.log("❌ setupWebPushForCurrentUser error:", e);
        }
      } else {
        setIsLoggedIn(false);
      }
    });

    return () => unsub();
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <NavigationContainer
        documentTitle={{
          formatter: () => "Rotem Nails Studio",
        }}
      >
        <AppNavigator />
      </NavigationContainer>

      {Platform.OS === "web" && isLoggedIn && <AddToHomeScreenBanner />}
    </View>
  );
}
