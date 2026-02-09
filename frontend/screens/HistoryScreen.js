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

import colors from "../styles/colors";
import AppBackground from "../components/AppBackground"; // ✅ רקע תמונה

// ✅ פונקציה יפה לשם סטטוס בעברית
function getStatusLabel(status) {
  switch (status) {
    case "completed":
      return "בוצע ✅";
    case "cancelled_by_owner":
      return "בוטל ע״י בעלת העסק";
    case "cancelled":
      return "בוטל";
    case "rejected":
      return "נדחה";
    case "pending":
      return "ממתין";
    case "approved":
      return "מאושר";
    default:
      return status || "—";
  }
}

// ✅ פונקציית עזר לשם טיפול
function getServiceText(item) {
  const arr = Array.isArray(item?.servicesSelected)
    ? item.servicesSelected
    : [];
  const names = arr.map((s) => s?.name).filter(Boolean);

  if (names.length > 0) return names.join(", ");
  return item?.serviceType || "";
}

export default function HistoryScreen({ navigation }) {
  const { width, height } = useWindowDimensions(); // ✅ גם גובה

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

  // ⭐ גובה לאזור הרשימה - לפי גובה המסך כדי שהכפתור לא ייצא החוצה
  const listMaxHeight = useMemo(() => {
    // שומרים מקום לכותרת, רווחים וכפתור חזרה
    const reservedSpace = 180; // אפשר לכוונן אם תרצי
    const max = height - reservedSpace;

    if (max < 200) return 200; // מינימום כדי שלא יהיה קטן מדי
    return max;
  }, [height]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUserId(user?.uid || null);
    });
    return () => unsub();
  }, []);

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
    <AppBackground>
      <View
        style={{
          flex: 1,
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: rf(24),
          backgroundColor: "transparent",
        }}
      >
        {/* Header */}
        <View
          style={{
            marginBottom: rf(14),
            paddingVertical: rf(14),
            paddingHorizontal: rf(14),
            backgroundColor: "rgba(255,255,255,0.92)",
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
              backgroundColor: "rgba(255,255,255,0.92)",
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
                fontSize: rf(14),
              }}
            >
              אין לך עדיין תורים בהיסטוריה 🙂
            </Text>
          </View>
        ) : (
          <View
            style={{
              backgroundColor: "rgba(255,255,255,0.9)",
              borderRadius: rf(14),
              borderWidth: 1,
              borderColor: colors.border,
              padding: rf(10),
              maxHeight: listMaxHeight, // ✅ מותאם לגובה המסך
            }}
          >
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: rf(8) }}
            >
              {items.map((a) => {
                const serviceText = getServiceText(a);
                const statusText = getStatusLabel(a.status);

                return (
                  <View
                    key={a.id}
                    style={{
                      backgroundColor: "#fff",
                      borderRadius: rf(14),
                      borderWidth: 1,
                      borderColor: colors.border,
                      padding: rf(14),
                      marginBottom: rf(10),
                    }}
                  >
                    <Text
                      style={{
                        fontSize: rf(16),
                        fontWeight: "900",
                        color: colors.primary,
                        textAlign: "right",
                      }}
                    >
                      {a.date || "—"}
                      {a.hour ? ` • ${a.hour}` : ""}
                    </Text>

                    {!!serviceText && (
                      <Text
                        style={{
                          marginTop: rf(6),
                          color: colors.textDark,
                          fontWeight: "700",
                          textAlign: "right",
                          fontSize: rf(14),
                        }}
                      >
                        טיפול: {serviceText}
                      </Text>
                    )}

                    <Text
                      style={{
                        marginTop: rf(6),
                        color: "gray",
                        fontWeight: "700",
                        textAlign: "right",
                        fontSize: rf(14),
                      }}
                    >
                      סטטוס: {statusText}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
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
          <Text
            style={{
              color: "#fff",
              fontWeight: "900",
              fontSize: rf(15),
            }}
          >
            חזרה
          </Text>
        </Pressable>
      </View>
    </AppBackground>
  );
}
