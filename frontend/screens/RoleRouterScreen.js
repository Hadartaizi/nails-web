import React, { useEffect } from "react";
import { View, ActivityIndicator, Text } from "react-native";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebaseConfig";
import colors from "../styles/colors";

export default function RoleRouterScreen({ navigation }) {
  useEffect(() => {
    (async () => {
      const uid = auth.currentUser?.uid;

      if (!uid) {
        navigation.replace("Login"); // אם יש לך מסך Login
        return;
      }

      const snap = await getDoc(doc(db, "users", uid));
      const role = snap.exists() ? snap.data().role : "user";

      if (role === "owner") {
        navigation.replace("OwnerDashboard");
      } else {
        navigation.replace("Calendar");
      }
    })();
  }, [navigation]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="large" />
      <Text style={{ marginTop: 10, color: colors.textDark }}>טוען...</Text>
    </View>
  );
}
