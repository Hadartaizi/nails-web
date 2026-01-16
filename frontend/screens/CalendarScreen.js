// frontend/screens/CalendarScreen.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  Alert,
  Platform,
  Modal,
  useWindowDimensions,
  ScrollView,
} from "react-native";

import { Calendar } from "react-native-calendars";

import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "../firebaseConfig";

import globalStyles from "../styles/global";
import colors from "../styles/colors";

// ---------- helpers ----------
function toLocalDateTime(dateStr, hourStr) {
  if (!dateStr || !hourStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = hourStr.split(":").map(Number);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

function isReservationPassed(res) {
  const dt = toLocalDateTime(res?.date, res?.hour);
  if (!dt) return false;
  return dt.getTime() < Date.now() - 60 * 1000; // דקה גרייס
}

// ---- helpers for month range ----
function pad2(n) {
  return String(n).padStart(2, "0");
}
function monthRange(dateString) {
  const [y, m] = dateString.split("-").map(Number);
  const start = `${y}-${pad2(m)}-01`;

  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  const endExclusive = `${nextYear}-${pad2(nextMonth)}-01`;

  return { start, endExclusive };
}

export default function CalendarScreen({ navigation }) {
  const { width } = useWindowDimensions();

  // responsive font helper
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

  const today = useMemo(() => new Date().toISOString().split("T")[0], []);

  // ✅ userId יציב
  const [userId, setUserId] = useState(auth.currentUser?.uid || null);

  const [myRes, setMyRes] = useState(null);
  const prevStatusRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // ✅ החודש שמוצג ביומן
  const [calendarMonthDate, setCalendarMonthDate] = useState(today);

  // ✅ ימים עם שעות מיוחדות (override)
  const [overrideDaysMarked, setOverrideDaysMarked] = useState({});

  // ✅ auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUserId(user?.uid || null);
    });
    return () => unsub();
  }, []);

  // ✅ מאזין לתור של המשתמש
  useEffect(() => {
    if (!userId) {
      setMyRes(null);
      prevStatusRef.current = null;
      return;
    }

    const userResRef = doc(db, "userReservations", userId);

    const unsub = onSnapshot(
      userResRef,
      (snap) => {
        if (!snap.exists()) {
          setMyRes(null);
          prevStatusRef.current = null;
          return;
        }

        const data = snap.data();
        setMyRes(data);

        const prev = prevStatusRef.current;
        const next = data?.status || null;

        if (next === "approved" && prev !== "approved") {
          Alert.alert("התור אושר ✅", `${data.date} • ${data.hour}`);
        }

        prevStatusRef.current = next;
      },
      () => {}
    );

    return () => unsub();
  }, [userId]);

  // ✅ אם התור עבר — היסטוריה
  useEffect(() => {
    if (!userId || !myRes?.appointmentId) return;
    if (!isReservationPassed(myRes)) return;

    const userResRef = doc(db, "userReservations", userId);
    const historyRef = doc(db, "users", userId, "history", myRes.appointmentId);
    const appRef = doc(db, "appointments", myRes.appointmentId);

    (async () => {
      try {
        await runTransaction(db, async (tx) => {
          const userResSnap = await tx.get(userResRef);
          if (!userResSnap.exists()) return;

          const data = userResSnap.data();
          const appSnap = await tx.get(appRef);

          tx.set(
            historyRef,
            { ...data, status: "completed", completedAt: serverTimestamp() },
            { merge: true }
          );

          if (appSnap.exists()) {
            tx.update(appRef, {
              status: "completed",
              completedAt: serverTimestamp(),
            });
          }

          tx.delete(userResRef);
        });
      } catch {}
    })();
  }, [userId, myRes]);

  // ✅ נקודות ביומן
  useEffect(() => {
    const { start, endExclusive } = monthRange(calendarMonthDate);

    const qAvail = query(
      collection(db, "availability"),
      where("date", ">=", start),
      where("date", "<", endExclusive)
    );

    const unsub = onSnapshot(
      qAvail,
      (snap) => {
        const marked = {};
        snap.docs.forEach((d) => {
          const data = d.data();
          const date = data?.date || d.id;
          const hours = Array.isArray(data?.hours) ? data.hours : [];
          if (date && hours.length > 0) {
            marked[date] = { marked: true, dotColor: colors.primary };
          }
        });
        setOverrideDaysMarked(marked);
      },
      () => setOverrideDaysMarked({})
    );

    return () => unsub();
  }, [calendarMonthDate]);

  async function handleLogout() {
    try {
      await signOut(auth);
    } catch (e) {
      Alert.alert("שגיאה", e?.message || "לא הצליח להתנתק");
    }
  }

  function confirmLogout() {
    if (Platform.OS === "web") {
      const ok = window.confirm("בטוחה שתרצי להתנתק?");
      if (ok) handleLogout();
      return;
    }

    Alert.alert("התנתקות", "בטוחה שתרצי להתנתק?", [
      { text: "ביטול", style: "cancel" },
      { text: "התנתק", style: "destructive", onPress: handleLogout },
    ]);
  }

  // ✅ ביטול תור
  async function cancelMyReservationFromCalendar() {
    if (!userId) {
      Alert.alert("שגיאה", "את חייבת להיות מחוברת");
      return;
    }
    if (!myRes?.appointmentId) {
      Alert.alert("שגיאה", "אין תור פעיל לביטול");
      return;
    }
    if (isReservationPassed(myRes)) {
      Alert.alert("לא ניתן לבטל", "התור כבר עבר ולכן לא ניתן לבטל אותו.");
      return;
    }

    const userResRef = doc(db, "userReservations", userId);

    try {
      await runTransaction(db, async (tx) => {
        const userResSnap = await tx.get(userResRef);
        if (!userResSnap.exists()) throw new Error("אין תור פעיל לביטול");

        const data = userResSnap.data();
        if (!data?.appointmentId) throw new Error("אין תור פעיל לביטול");
        if (isReservationPassed(data)) throw new Error("התור כבר עבר ולכן לא ניתן לבטל");

        const appointmentId = data.appointmentId;
        const appRef = doc(db, "appointments", appointmentId);
        const appSnap = await tx.get(appRef);

        if (appSnap.exists()) {
          const appData = appSnap.data();
          if (appData?.userId && appData.userId !== userId) {
            throw new Error("אין הרשאה לבטל תור זה");
          }
          tx.delete(appRef);
        }

        tx.delete(userResRef);
      });

      Alert.alert("בוטל", "התור בוטל בהצלחה");
    } catch (e) {
      Alert.alert("שגיאה", e?.message || "לא הצליח לבטל תור");
    }
  }

  // ✅ markedDates
  const markedDates = useMemo(() => {
    const out = { ...overrideDaysMarked };

    if (myRes?.date) {
      out[myRes.date] = {
        ...(out[myRes.date] || {}),
        selected: true,
        selectedColor: colors.secondary,
      };
    }

    return out;
  }, [overrideDaysMarked, myRes]);

  const MenuItem = ({ text, danger, onPress }) => (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: rf(12),
        paddingHorizontal: rf(14),
        borderRadius: rf(12),
        borderWidth: 1,
        borderColor: danger ? "#d33" : colors.border,
        backgroundColor: "#fff",
        marginTop: rf(10),
        alignItems: "center",
      }}
    >
      <Text
        style={{
          fontWeight: "900",
          color: danger ? "#d33" : colors.textDark,
          fontSize: rf(15),
          flexWrap: "wrap",
          textAlign: "center",
        }}
      >
        {text}
      </Text>
    </Pressable>
  );

  const passed = myRes ? isReservationPassed(myRes) : false;
  const niceService = myRes?.serviceType ? ` (${myRes.serviceType})` : "";

  const statusLabel =
    myRes?.status === "approved"
      ? "מאושר ✅"
      : myRes?.status === "pending"
      ? "ממתין לאישור ⏳"
      : myRes?.status || "—";

  return (
    <View style={[globalStyles.container, { backgroundColor: "transparent" }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, paddingBottom: rf(24) }}
      >
        {/* Header */}
        <View
          style={{
            marginBottom: rf(20),
            paddingVertical: rf(16),
            paddingHorizontal: rf(14),
            backgroundColor: "#fff",
            borderRadius: rf(14),
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
            position: "relative",
          }}
        >
          <Pressable
            onPress={() => setMenuOpen(true)}
            style={{
              position: "absolute",
              top: rf(10),
              right: rf(10),
              width: rf(42),
              height: rf(42),
              borderRadius: rf(12),
              backgroundColor: "#fff",
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: "center",
              justifyContent: "center",
              ...(Platform.OS === "web" ? { cursor: "pointer" } : null),
            }}
            accessibilityLabel="פתח תפריט"
          >
            <View
              style={{
                width: rf(18),
                height: 2,
                backgroundColor: colors.primary,
                marginVertical: 2,
                borderRadius: 2,
              }}
            />
            <View
              style={{
                width: rf(18),
                height: 2,
                backgroundColor: colors.primary,
                marginVertical: 2,
                borderRadius: 2,
              }}
            />
            <View
              style={{
                width: rf(18),
                height: 2,
                backgroundColor: colors.primary,
                marginVertical: 2,
                borderRadius: 2,
              }}
            />
          </Pressable>

          <Text
            style={{
              fontSize: rf(26),
              fontWeight: "900",
              color: colors.primary,
              textAlign: "center",
            }}
          >
            קביעת תור
          </Text>

          <Text
            style={{
              marginTop: rf(6),
              fontSize: rf(15),
              color: colors.textDark,
              textAlign: "center",
              fontWeight: "600",
            }}
          >
            בחרי תאריך ביומן כדי להמשיך
          </Text>

          <Text
            style={{
              marginTop: rf(6),
              color: "#666",
              fontWeight: "700",
              textAlign: "center",
            }}
          >
            נקודה מתחת ליום = שעות מיוחדות שהוגדרו ידנית
          </Text>
        </View>

        {/* Calendar */}
        <View
          style={{
            backgroundColor: "#fff",
            borderRadius: rf(16),
            borderWidth: 1,
            borderColor: colors.border,
            padding: rf(10),
          }}
        >
          <Calendar
            minDate={today}
            markedDates={markedDates}
            onMonthChange={(m) => setCalendarMonthDate(m.dateString)}
            onDayPress={(day) => {
              navigation.navigate("Day", {
                selectedDate: day.dateString,
                date: day.dateString,
                requireApproval: true,
              });
            }}
            style={{ borderRadius: rf(12) }}
            theme={{
              todayTextColor: colors.secondary,
              selectedDayBackgroundColor: colors.primary,
              selectedDayTextColor: "#fff",
              arrowColor: colors.primary,
              monthTextColor: colors.primary,
              textMonthFontWeight: "900",
              textDayFontWeight: "600",
              textDayHeaderFontWeight: "700",
              textDisabledColor: "#d9e1e8",
              textMonthFontSize: rf(16),
              textDayFontSize: rf(14),
              textDayHeaderFontSize: rf(12),
            }}
          />
        </View>

        {/* My Reservation */}
        <View
          style={{
            marginTop: rf(12),
            backgroundColor: "#fff",
            borderRadius: rf(14),
            borderWidth: 1,
            borderColor: colors.border,
            paddingVertical: rf(12),
            paddingHorizontal: rf(12),
          }}
        >
          <Text
            style={{
              fontWeight: "900",
              color: colors.primary,
              fontSize: rf(16),
              textAlign: "center",
            }}
          >
            התור שלי
          </Text>

          {!myRes ? (
            <Text
              style={{
                marginTop: rf(8),
                textAlign: "center",
                color: "gray",
                fontWeight: "700",
                fontSize: rf(14),
              }}
            >
              אין לך תור פעיל כרגע
            </Text>
          ) : (
            <>
              <Text
                style={{
                  marginTop: rf(8),
                  textAlign: "center",
                  color: colors.textDark,
                  fontWeight: "900",
                  fontSize: rf(16),
                }}
              >
                {myRes.date} • {myRes.hour} {niceService}
              </Text>

              <Text
                style={{
                  marginTop: 6,
                  textAlign: "center",
                  fontWeight: "900",
                  color:
                    myRes.status === "approved" ? "#2e7d32" : "#ff8f00",
                }}
              >
                סטטוס: {statusLabel}
              </Text>

              <View
                style={{
                  flexDirection: "row",
                  gap: rf(10),
                  marginTop: rf(12),
                }}
              >
                <Pressable
                  onPress={() =>
                    navigation.navigate("Day", {
                      selectedDate: myRes.date,
                      date: myRes.date,
                      requireApproval: true,
                    })
                  }
                  style={{
                    flex: 1,
                    backgroundColor: "#fff",
                    borderRadius: rf(12),
                    borderWidth: 1,
                    borderColor: colors.primary,
                    paddingVertical: rf(10),
                    alignItems: "center",
                  }}
                >
                  <Text
                    style={{
                      color: colors.primary,
                      fontWeight: "900",
                      fontSize: rf(14),
                    }}
                  >
                    מעבר לתאריך
                  </Text>
                </Pressable>

                {!passed ? (
                  <Pressable
                    onPress={() => {
                      if (Platform.OS === "web") {
                        const ok = window.confirm("לבטל את התור?");
                        if (ok) cancelMyReservationFromCalendar();
                        return;
                      }
                      Alert.alert("ביטול תור", "לבטל את התור?", [
                        { text: "לא", style: "cancel" },
                        {
                          text: "כן",
                          style: "destructive",
                          onPress: cancelMyReservationFromCalendar,
                        },
                      ]);
                    }}
                    style={{
                      flex: 1,
                      backgroundColor: "#fff",
                      borderRadius: rf(12),
                      borderWidth: 1,
                      borderColor: "#d33",
                      paddingVertical: rf(10),
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: "#d33",
                        fontWeight: "900",
                        fontSize: rf(14),
                      }}
                    >
                      ביטול תור
                    </Text>
                  </Pressable>
                ) : (
                  <View style={{ flex: 1 }} />
                )}
              </View>
            </>
          )}
        </View>
      </ScrollView>

      {/* Menu */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable
          onPress={() => setMenuOpen(false)}
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.35)",
            padding: rf(18),
          }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              marginTop: rf(70),
              alignSelf: "flex-end",
              width: rf(220),
              backgroundColor: "#fff",
              borderRadius: rf(16),
              borderWidth: 1,
              borderColor: colors.border,
              padding: rf(14),
            }}
          >
            <Text
              style={{
                fontWeight: "900",
                color: colors.primary,
                fontSize: rf(16),
                textAlign: "center",
              }}
            >
              תפריט
            </Text>

            <MenuItem
              text="היסטוריית תורים"
              onPress={() => {
                setMenuOpen(false);
                navigation.navigate("History");
              }}
            />

            <MenuItem
              text="מחירים"
              onPress={() => {
                setMenuOpen(false);
                navigation.navigate("Prices");
              }}
            />

            {/* ⭐ חדש: מעבר למסך BusinessHomeScreen */}
            <MenuItem
              text="עמוד הבית של העסק"
              onPress={() => {
                setMenuOpen(false);
                navigation.navigate("BusinessHome");
              }}
            />

            <MenuItem
              text="התנתקות"
              danger
              onPress={() => {
                setMenuOpen(false);
                confirmLogout();
              }}
            />

            <MenuItem
              text="סגור"
              onPress={() => setMenuOpen(false)}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
