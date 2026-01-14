// frontend/screens/HistoryScreen.js
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";

import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebaseConfig";

import globalStyles from "../styles/global";
import colors from "../styles/colors";

export default function HistoryScreen({ navigation }) {
  const { width } = useWindowDimensions();

  const rf = useMemo(() => {
    return (base) => {
      if (width < 340) return Math.max(12, base - 6);
      if (width < 380) return Math.max(12, base - 4);
      if (width < 420) return Math.max(12, base - 2);
      if (width < 768) return base;
      if (width < 1024) return base + 2;
      return base + 4;
    };
  }, [width]);

  const [userId, setUserId] = useState(auth.currentUser?.uid || null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);

  // ✅ auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUserId(user?.uid || null);
    });
    return () => unsub();
  }, []);

  // ✅ history listener
  useEffect(() => {
    if (!userId) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const qRef = query(
      collection(db, "users", userId, "history"),
      orderBy("completedAt", "desc")
    );

    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setItems(all);
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsub();
  }, [userId]);

  return (
    <View style={[globalStyles.container, { backgroundColor: "transparent" }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: rf(24) }}
      >
        {/* Header */}
        <View
          style={{
            marginBottom: rf(14),
            paddingVertical: rf(14),
            paddingHorizontal: rf(14),
            backgroundColor: "#fff",
            borderRadius: rf(14),
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              fontSize: rf(24),
              fontWeight: "900",
              color: colors.primary,
              textAlign: "center",
              flexWrap: "wrap",
            }}
          >
            היסטוריית תורים
          </Text>

          <Text
            style={{
              marginTop: rf(6),
              fontSize: rf(14),
              color: colors.textDark,
              textAlign: "center",
              fontWeight: "600",
              flexWrap: "wrap",
            }}
          >
            כאן יופיעו כל התורים שעברו ✅
          </Text>
        </View>

        {/* Content */}
        {loading ? (
          <View style={{ marginTop: rf(20), alignItems: "center" }}>
            <ActivityIndicator size="large" />
          </View>
        ) : items.length === 0 ? (
          <View
            style={{
              backgroundColor: "#fff",
              borderRadius: rf(14),
              borderWidth: 1,
              borderColor: colors.border,
              padding: rf(16),
            }}
          >
            <Text
              style={{
                color: colors.textDark,
                fontWeight: "700",
                textAlign: "center",
                flexWrap: "wrap",
                fontSize: rf(14),
              }}
            >
              אין לך עדיין תורים בהיסטוריה 🙂
            </Text>
          </View>
        ) : (
          <View>
            {items.map((a) => (
              <View
                key={a.id}
                style={{
                  backgroundColor: "#fff",
                  borderRadius: rf(14),
                  borderWidth: 1,
                  borderColor: colors.border,
                  padding: rf(14),
                  marginBottom: rf(10),
                  alignItems: "flex-end",
                }}
              >
                <Text
                  style={{
                    fontSize: rf(16),
                    fontWeight: "900",
                    color: colors.primary,
                    textAlign: "right",
                    writingDirection: "rtl",
                    width: "100%",
                    flexWrap: "wrap",
                  }}
                >
                  {a.date} • {a.hour || ""}
                </Text>

                {!!a.serviceType && (
                  <Text
                    style={{
                      marginTop: rf(6),
                      color: colors.textDark,
                      fontWeight: "700",
                      textAlign: "right",
                      writingDirection: "rtl",
                      width: "100%",
                      flexWrap: "wrap",
                      fontSize: rf(14),
                    }}
                  >
                    טיפול: {a.serviceType}
                  </Text>
                )}

                <Text
                  style={{
                    marginTop: rf(6),
                    color: "gray",
                    fontWeight: "700",
                    textAlign: "right",
                    writingDirection: "rtl",
                    width: "100%",
                    flexWrap: "wrap",
                    fontSize: rf(14),
                  }}
                >
                  סטטוס: {a.status === "completed" ? "בוצע" : a.status || "—"}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Back */}
        <Pressable
          onPress={() => navigation.goBack()}
          style={{
            marginTop: rf(14),
            backgroundColor: colors.primary,
            paddingVertical: rf(12),
            borderRadius: rf(14),
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: rf(15), flexWrap: "wrap" }}>
            חזרה
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
