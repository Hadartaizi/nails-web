// frontend/screens/DayScreen.js
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  Platform,
  ActivityIndicator,
  Modal,
} from "react-native";

import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "../firebaseConfig";
import globalStyles from "../styles/global";
import colors from "../styles/colors";
import HourSlot from "../components/HourSlot";

// ================= helpers =================
const FALLBACK_SLOT_MIN = 60;

function normalizeHour(input) {
  const t = (input || "").trim();
  if (!t) return "";
  if (/^\d{1,2}$/.test(t)) {
    const h = String(parseInt(t, 10)).padStart(2, "0");
    return `${h}:00`;
  }
  const m = t.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/);
  if (m) {
    const h = String(parseInt(m[1], 10)).padStart(2, "0");
    const mm = String(parseInt(m[2], 10)).padStart(2, "0");
    return `${h}:${mm}`;
  }
  return t;
}

function timeToMin(hhmm) {
  const [h, m] = String(hhmm || "0:0").split(":").map((x) => parseInt(x, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function minToTime(min) {
  const h = String(Math.floor(min / 60)).padStart(2, "0");
  const m = String(min % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function uniqSortedHours(hours) {
  const safe = (Array.isArray(hours) ? hours : [])
    .map(normalizeHour)
    .filter((h) => /^\d{2}:\d{2}$/.test(h));
  const uniq = Array.from(new Set(safe));
  uniq.sort((a, b) => timeToMin(a) - timeToMin(b));
  return uniq;
}

function makeAppointmentDocId(date, hour) {
  const safeHour = (hour || "").replace(":", "-");
  return `${date}_${safeHour}`;
}

function isAppointmentPast(dateStr, hourStr) {
  try {
    if (!dateStr || !hourStr) return false;
    const [y, m, d] = String(dateStr).split("-").map(Number);
    const [hh, mm = 0] = String(hourStr).split(":").map((x) => Number(x));
    const dt = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
    return dt.getTime() < Date.now();
  } catch {
    return false;
  }
}

function safeServices(list) {
  const arr = Array.isArray(list) ? list : [];
  const cleaned = arr
    .map((s, idx) => ({
      id: String(s?.id ?? idx),
      name: String(s?.name ?? "טיפול"),
      durationMin: Number(s?.durationMin ?? 0),
    }))
    .filter((s) => s.name && Number.isFinite(s.durationMin) && s.durationMin > 0);

  const used = new Map();
  return cleaned.map((s) => {
    const base = (s.id || "").trim() || "service";
    const count = (used.get(base) || 0) + 1;
    used.set(base, count);
    return { ...s, id: count === 1 ? base : `${base}-${count}` };
  });
}

function getSlotStepMin(hoursSorted) {
  if (!Array.isArray(hoursSorted) || hoursSorted.length < 2) return FALLBACK_SLOT_MIN;

  let best = Infinity;
  for (let i = 1; i < hoursSorted.length; i++) {
    const diff = timeToMin(hoursSorted[i]) - timeToMin(hoursSorted[i - 1]);
    if (diff > 0 && diff < best) best = diff;
  }
  return Number.isFinite(best) && best !== Infinity ? best : FALLBACK_SLOT_MIN;
}

// ================= screen =================
export default function DayScreen({ route, navigation }) {
  const selectedDate =
    route?.params?.date ||
    route?.params?.selectedDate ||
    new Date().toISOString().split("T")[0];

  const userId = auth.currentUser?.uid || null;

  const [loading, setLoading] = useState(true);

  // שעות
  const [defaultHours, setDefaultHours] = useState([]);
  const [overrideHours, setOverrideHours] = useState(null);

  // תורים
  const [appointments, setAppointments] = useState([]);
  const [myRes, setMyRes] = useState(null);

  // טיפולים
  const [services, setServices] = useState([]);

  // מודאל בחירת טיפולים
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [serviceHour, setServiceHour] = useState(null);
  const [selectedServiceIds, setSelectedServiceIds] = useState({}); // {id:true}

  // --- listen my reservation ---
  useEffect(() => {
    if (!userId) {
      setMyRes(null);
      return;
    }
    const userResRef = doc(db, "userReservations", userId);
    const unsub = onSnapshot(
      userResRef,
      (snap) => {
        if (!snap.exists()) {
          setMyRes(null);
          return;
        }
        setMyRes(snap.data());
      },
      (err) => console.log("❌ userReservations listen error:", err?.code, err?.message)
    );
    return () => unsub();
  }, [userId]);

  // --- listen settings/business (default hours + services) ---
  useEffect(() => {
    const ref = doc(db, "settings", "business");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        setDefaultHours(uniqSortedHours(data?.defaultHours || []));

        const srv = safeServices(data?.services);
        setServices(
          srv.length
            ? srv
            : safeServices([
                { id: "anatomical_structure", name: "מבנה אנטומי", durationMin: 60 },
                { id: "gel_refill", name: "מילוי ג׳ל", durationMin: 35 },
                { id: "tips_refill", name: "מילוי בטיפסים", durationMin: 60 },
                { id: "gel_build", name: "בניה", durationMin: 60 },
                { id: "nail_repair", name: "השלמת ציפורן", durationMin: 15 },
                { id: "crack_treatment", name: "טיפול בסדק", durationMin: 15 },
              ])
        );
      },
      (err) => {
        console.log("❌ settings/business error:", err?.code, err?.message);
        setDefaultHours([]);
        setServices(
          safeServices([
            { id: "manicure", name: "מניקור", durationMin: 30 },
            { id: "gel", name: "ג׳ל", durationMin: 60 },
          ])
        );
      }
    );
    return () => unsub();
  }, []);

  // --- listen availability/{date} (override) ---
  useEffect(() => {
    setLoading(true);
    const ref = doc(db, "availability", selectedDate);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setOverrideHours(null);
          setLoading(false);
          return;
        }
        setOverrideHours(uniqSortedHours(snap.data()?.hours || []));
        setLoading(false);
      },
      (err) => {
        console.log("❌ availability/date error:", err?.code, err?.message);
        setOverrideHours(null);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [selectedDate]);

  // --- listen appointments for selectedDate ---
  useEffect(() => {
    const qApps = query(collection(db, "appointments"), where("date", "==", selectedDate));

    const unsub = onSnapshot(
      qApps,
      (snap) => {
        const arr = snap.docs.map((d) => ({ docId: d.id, ...d.data() }));
        arr.sort((a, b) => timeToMin(a.hour) - timeToMin(b.hour));
        setAppointments(arr);
      },
      (err) => {
        console.log("❌ appointments error:", err?.code, err?.message);
        Alert.alert("שגיאה", "לא הצליח לטעון תורים");
      }
    );

    return () => unsub();
  }, [selectedDate]);

  const appointmentByHour = useMemo(() => {
    const map = {};
    for (const a of appointments) {
      const h = normalizeHour(a?.hour);
      if (h) map[h] = a;
    }
    return map;
  }, [appointments]);

  // ✅ שעות להצגה
  const hoursToShow = useMemo(() => {
    if (overrideHours !== null) return overrideHours;
    return defaultHours;
  }, [overrideHours, defaultHours]);

  const hoursSorted = useMemo(() => uniqSortedHours(hoursToShow), [hoursToShow]);

  const selectedServices = useMemo(() => {
    const ids = Object.keys(selectedServiceIds).filter((k) => selectedServiceIds[k]);
    const chosen = services.filter((s) => ids.includes(s.id));
    const total = chosen.reduce((sum, s) => sum + (Number(s.durationMin) || 0), 0);
    return { chosen, total };
  }, [selectedServiceIds, services]);

  // ================= reserve logic =================
  function openServiceModal(hour) {
    if (!userId) {
      Alert.alert("שגיאה", "צריך להיות מחובר כדי לשריין");
      return;
    }
    if (isAppointmentPast(selectedDate, hour)) {
      Alert.alert("לא ניתן לשריין", "השעה הזו כבר עברה.");
      return;
    }
    if (myRes?.appointmentId && myRes?.status !== "rejected") {
      Alert.alert("שגיאה", "כבר יש לך תור פעיל. בטלי קודם כדי לשריין חדש.");
      return;
    }
    if (appointmentByHour[hour]) {
      Alert.alert("שגיאה", "השעה הזו כבר תפוסה.");
      return;
    }

    setServiceHour(hour);
    setSelectedServiceIds({});
    setServiceModalOpen(true);
  }

  async function reserveHourWithServices(startHour, chosen, totalDurationMin) {
    if (!userId) return;

    if (!totalDurationMin || totalDurationMin <= 0) {
      Alert.alert("חסר טיפול", "בחרי לפחות טיפול אחד כדי להמשיך.");
      return;
    }

    const startIdx = hoursSorted.indexOf(startHour);
    if (startIdx < 0) {
      Alert.alert("שגיאה", "השעה לא קיימת ברשימת הזמינות");
      return;
    }

    const stepMin = getSlotStepMin(hoursSorted);
    const requiredSlots = Math.ceil(totalDurationMin / stepMin);

    const slots = [];
    for (let i = 0; i < requiredSlots; i++) {
      const h = hoursSorted[startIdx + i];

      if (!h) {
        Alert.alert(
          "אין מספיק זמן",
          "אין מספיק זמן רציף לטיפול ביום הזה.\nאפשר להפחית טיפול או לבחור יום אחר."
        );
        return;
      }

      if (i > 0) {
        const prev = hoursSorted[startIdx + i - 1];
        if (timeToMin(h) - timeToMin(prev) !== stepMin) {
          Alert.alert(
            "אין רצף זמין",
            "השעות ביום הזה לא רציפות מספיק לטיפול שבחרת.\nאפשר להפחית טיפול או לבחור יום אחר."
          );
          return;
        }
      }

      if (appointmentByHour[h]) {
        Alert.alert(
          "אין אפשרות להאריך",
          `כדי להשלים את הטיפול צריך גם את ${h}, אבל התור הזה תפוס.\nאפשר להפחית טיפול או לבחור יום אחר.`
        );
        return;
      }

      if (isAppointmentPast(selectedDate, h)) {
        Alert.alert("לא ניתן", "חלק מהזמן שנדרש כבר עבר.");
        return;
      }

      slots.push(h);
    }

    const groupId = makeAppointmentDocId(selectedDate, startHour);
    const userResRef = doc(db, "userReservations", userId);
    const requestRef = doc(db, "appointmentRequests", groupId);

    const servicesSelected = chosen.map((s) => ({
      id: s.id,
      name: s.name,
      durationMin: s.durationMin,
    }));

    try {
      await runTransaction(db, async (tx) => {
        const myResSnap = await tx.get(userResRef);
        if (myResSnap.exists()) {
          const prev = myResSnap.data();
          if (prev?.status !== "rejected" && prev?.appointmentId) {
            throw new Error("כבר יש לך תור פעיל. בטלי קודם כדי לשריין חדש.");
          }
        }

        const slotRefs = slots.map((h) =>
          doc(db, "appointments", makeAppointmentDocId(selectedDate, h))
        );

        const slotSnaps = [];
        for (const r of slotRefs) slotSnaps.push(await tx.get(r));

        for (let i = 0; i < slotSnaps.length; i++) {
          if (slotSnaps[i].exists()) {
            throw new Error(`השעה ${slots[i]} נתפסה הרגע. נסי שעה אחרת או יום אחר.`);
          }
        }

        for (let i = 0; i < slots.length; i++) {
          const h = slots[i];
          const appointmentRef = doc(db, "appointments", makeAppointmentDocId(selectedDate, h));

          tx.set(appointmentRef, {
            date: selectedDate,
            hour: h,
            userId,
            status: "pending",

            groupId,
            isHead: i === 0,
            headHour: startHour,
            slots,

            servicesSelected,
            totalDurationMin,

            createdAt: serverTimestamp(),
            requestedAt: serverTimestamp(),
            source: "user_request",
          });
        }

        tx.set(
          userResRef,
          {
            appointmentId: groupId,
            date: selectedDate,
            hour: startHour,
            status: "pending",
            groupId,
            slots,
            servicesSelected,
            totalDurationMin,
            requestedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );

        tx.set(requestRef, {
          appointmentId: groupId,
          groupId,
          date: selectedDate,
          hour: startHour,
          userId,
          status: "pending",
          slots,
          servicesSelected,
          totalDurationMin,
          createdAt: serverTimestamp(),
        });
      });

      const endTime = minToTime(timeToMin(startHour) + totalDurationMin);
      Alert.alert(
        "הבקשה נשלחה ✅",
        `נשלחה בקשה לאישור:\nהתחלה ${startHour} • סיום משוער ${endTime}\nנתפסו: ${slots.join(", ")}`
      );
    } catch (e) {
      console.log("❌ reserveHourWithServices error:", e);
      Alert.alert("שגיאה", e?.message || "לא הצליח לשריין תור");
    }
  }

  async function cancelMyRequest(app) {
    if (!userId) return;

    if (!app?.groupId || !Array.isArray(app?.slots) || !app.slots.length) {
      Alert.alert("שגיאה", "לא נמצאו פרטי ביטול לתור");
      return;
    }

    if (isAppointmentPast(app?.date, app?.hour)) {
      Alert.alert("לא ניתן לבטל", "התור כבר עבר ולכן אי אפשר לבטל.");
      return;
    }

    Alert.alert("ביטול בקשה", "לבטל את הבקשה?", [
      { text: "לא", style: "cancel" },
      {
        text: "כן, לבטל",
        style: "destructive",
        onPress: async () => {
          const userResRef = doc(db, "userReservations", userId);
          const requestRef = doc(db, "appointmentRequests", app.groupId);

          try {
            await runTransaction(db, async (tx) => {
              const urSnap = await tx.get(userResRef);
              const reqSnap = await tx.get(requestRef);

              const slotRefs = app.slots.map((h) =>
                doc(db, "appointments", makeAppointmentDocId(selectedDate, h))
              );
              const slotSnaps = [];
              for (const r of slotRefs) slotSnaps.push(await tx.get(r));

              for (let i = 0; i < slotSnaps.length; i++) {
                const s = slotSnaps[i];
                if (!s.exists()) continue;
                const live = s.data();
                if (
                  live?.userId === userId &&
                  live?.status === "pending" &&
                  live?.groupId === app.groupId
                ) {
                  tx.delete(slotRefs[i]);
                }
              }

              if (urSnap.exists() && urSnap.data()?.appointmentId === app.groupId) {
                tx.delete(userResRef);
              }
              if (reqSnap.exists()) tx.delete(requestRef);
            });

            Alert.alert("בוצע", "הבקשה בוטלה");
          } catch (e) {
            console.log("❌ cancelMyRequest error:", e);
            Alert.alert("שגיאה", e?.message || "לא הצליח לבטל בקשה");
          }
        },
      },
    ]);
  }

  // ✅ ביטול תור מאושר (approved): מוחק קבוצה + userReservations + כותב להיסטוריה cancelled
  async function cancelApprovedReservation(app) {
    if (!userId) return;

    if (!app?.groupId || !Array.isArray(app?.slots) || !app.slots.length) {
      Alert.alert("שגיאה", "לא נמצאו פרטי ביטול לתור");
      return;
    }

    if (!app?.isHead) {
      Alert.alert("שגיאה", "אפשר לבטל רק מהשעה הראשונה של התור");
      return;
    }

    if (isAppointmentPast(app?.date, app?.hour)) {
      Alert.alert("לא ניתן לבטל", "התור כבר עבר ולכן אי אפשר לבטל.");
      return;
    }

    Alert.alert("ביטול תור", "לבטל את התור המאושר?", [
      { text: "לא", style: "cancel" },
      {
        text: "כן, לבטל",
        style: "destructive",
        onPress: async () => {
          const groupId = app.groupId;

          const userResRef = doc(db, "userReservations", userId);
          const historyRef = doc(db, "users", userId, "history", groupId);

          try {
            await runTransaction(db, async (tx) => {
              // reads first
              const urSnap = await tx.get(userResRef);

              const slotRefs = app.slots.map((h) =>
                doc(db, "appointments", makeAppointmentDocId(selectedDate, h))
              );

              const slotSnaps = [];
              for (const r of slotRefs) slotSnaps.push(await tx.get(r));

              // writes
              for (let i = 0; i < slotSnaps.length; i++) {
                const s = slotSnaps[i];
                if (!s.exists()) continue;

                const live = s.data();
                if (
                  live?.userId === userId &&
                  live?.groupId === groupId &&
                  live?.status === "approved"
                ) {
                  tx.delete(slotRefs[i]);
                }
              }

              if (urSnap.exists() && urSnap.data()?.appointmentId === groupId) {
                tx.delete(userResRef);
              }

              tx.set(
                historyRef,
                {
                  ...(urSnap.exists() ? urSnap.data() : {}),
                  date: app?.date || selectedDate,
                  hour: app?.hour || "",
                  groupId,
                  slots: app?.slots || [],
                  servicesSelected: app?.servicesSelected || [],
                  totalDurationMin: app?.totalDurationMin || 0,
                  status: "cancelled",
                  cancelledAt: serverTimestamp(),
                },
                { merge: true }
              );
            });

            Alert.alert("בוצע", "התור בוטל בהצלחה");
          } catch (e) {
            console.log("❌ cancelApprovedReservation error:", e);
            Alert.alert("שגיאה", e?.message || "לא הצליח לבטל תור");
          }
        },
      },
    ]);
  }

  function noop() {}

  // ================= UI =================
  return (
    <View style={[globalStyles.container, { backgroundColor: "transparent" }]}>
      {/* Header */}
      <View
        style={{
          paddingVertical: 12,
          marginBottom: 10,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Text style={{ fontSize: 22, fontWeight: "900", textAlign: "center", color: colors.primary }}>
          תורים ליום {selectedDate}
        </Text>

        <Text style={{ marginTop: 6, textAlign: "center", color: "#444", fontWeight: "800" }}>
          כל שריון נשלח לאישור בעלת העסק
        </Text>
      </View>

      {loading ? (
        <View style={{ marginTop: 30, alignItems: "center" }}>
          <ActivityIndicator />
          <Text style={{ marginTop: 10, color: "gray" }}>טוען שעות…</Text>
        </View>
      ) : hoursSorted.length === 0 ? (
        <Text style={{ textAlign: "center", color: "gray", marginTop: 30 }}>
          אין שעות זמינות ביום הזה. בחרי תאריך אחר.
        </Text>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 90 }}
          showsVerticalScrollIndicator={false}
        >
          {hoursSorted.map((hour) => {
            const app = appointmentByHour[hour];
            const isReserved = !!app;
            const isMine = isReserved && app?.userId === userId;
            const status = app?.status || null;

            const canReserve =
              !!userId &&
              (!myRes?.appointmentId || myRes?.status === "rejected") &&
              !isReserved &&
              !isAppointmentPast(selectedDate, hour);

            const canCancelRequest =
              isMine &&
              status === "pending" &&
              app?.isHead &&
              Array.isArray(app?.slots) &&
              app.slots.length > 0;

            const canCancelApproved =
              isMine &&
              status === "approved" &&
              app?.isHead &&
              Array.isArray(app?.slots) &&
              app.slots.length > 0;

            return (
              <View key={hour}>
                <HourSlot
                  hour={hour}
                  isReserved={isReserved}
                  isMine={isMine}
                  status={status}
                  canReserve={canReserve}
                  canCancelRequest={canCancelRequest}
                  onReserve={() => openServiceModal(hour)}
                  onCancelRequest={() => cancelMyRequest(app)}
                  onCancel={canCancelApproved ? () => cancelApprovedReservation(app) : undefined}
                  inWaitlist={false}
                  waitPositionText={""}
                  onWaitlistToggle={noop}
                />

                {isMine && Array.isArray(app?.servicesSelected) && app.servicesSelected.length > 0 ? (
                  <Text style={{ marginTop: -2, marginBottom: 8, textAlign: "center", color: "#555" }}>
                    {`טיפולים: ${app.servicesSelected.map((s) => s.name).join(", ")} • ${
                      app.totalDurationMin || 0
                    } דק׳`}
                    {Array.isArray(app?.slots) && app.slots.length > 1 ? ` • נתפסו: ${app.slots.join(", ")}` : ""}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* MODAL: select services */}
      <Modal
        visible={serviceModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setServiceModalOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 16 }}>
          <View style={{ backgroundColor: "#fff", borderRadius: 14, padding: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: "900", textAlign: "center" }}>
              בחרי טיפולים לשעה {serviceHour}
            </Text>

            <Text style={{ marginTop: 6, textAlign: "center", color: "#666", fontWeight: "700" }}>
              אפשר לבחור יותר מטיפול אחד
            </Text>

            <View style={{ marginTop: 14 }}>
              {services.map((s, idx) => {
                const checked = !!selectedServiceIds[s.id];
                return (
                  <Pressable
                    key={`${s.id}_${s.name}_${idx}`}
                    onPress={() => setSelectedServiceIds((prev) => ({ ...prev, [s.id]: !prev[s.id] }))}
                    style={({ pressed }) => [
                      {
                        paddingVertical: 12,
                        paddingHorizontal: 12,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: checked ? colors.primary : "#ddd",
                        marginBottom: 10,
                        opacity: pressed ? 0.85 : 1,
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                      },
                      Platform.OS === "web" ? { cursor: "pointer" } : null,
                    ]}
                  >
                    <Text style={{ fontWeight: "900" }}>
                      {checked ? "✓ " : ""}
                      {s.name}
                    </Text>
                    <Text style={{ fontWeight: "800", color: "#555" }}>{s.durationMin} דק׳</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={{ textAlign: "center", fontWeight: "900", marginTop: 4, color: "#333" }}>
              סה״כ זמן: {selectedServices.total} דק׳
            </Text>

            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 14, gap: 10 }}>
              <Pressable
                onPress={() => setServiceModalOpen(false)}
                style={({ pressed }) => [
                  {
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: "#bbb",
                    alignItems: "center",
                    opacity: pressed ? 0.85 : 1,
                  },
                  Platform.OS === "web" ? { cursor: "pointer" } : null,
                ]}
              >
                <Text style={{ fontWeight: "900" }}>סגור</Text>
              </Pressable>

              <Pressable
                onPress={async () => {
                  const chosen = selectedServices.chosen;
                  const total = selectedServices.total;

                  if (!serviceHour) return;
                  if (!chosen.length) {
                    Alert.alert("חסר טיפול", "בחרי לפחות טיפול אחד כדי להמשיך.");
                    return;
                  }

                  setServiceModalOpen(false);
                  await reserveHourWithServices(serviceHour, chosen, total);
                }}
                style={({ pressed }) => [
                  {
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 12,
                    backgroundColor: colors.primary,
                    alignItems: "center",
                    opacity: pressed ? 0.85 : 1,
                  },
                  Platform.OS === "web" ? { cursor: "pointer" } : null,
                ]}
              >
                <Text style={{ fontWeight: "900", color: "#fff" }}>אישור שריון</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Back */}
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 14, paddingHorizontal: 16 }}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={{
            backgroundColor: "#444",
            paddingVertical: 12,
            borderRadius: 12,
            alignItems: "center",
            ...(Platform.OS === "web" ? { cursor: "pointer" } : null),
          }}
        >
          <Text style={{ color: "white", fontWeight: "900" }}>חזרה</Text>
        </Pressable>
      </View>
    </View>
  );
}
