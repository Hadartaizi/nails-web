// frontend/screens/OwnerDashboard.js
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Alert,
  ScrollView,
  Pressable,
  TextInput,
  Keyboard,
  Platform,
  InputAccessoryView,
  Modal,
  TouchableWithoutFeedback,
  useWindowDimensions,
} from "react-native";

import { Calendar } from "react-native-calendars";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  runTransaction,
  getDoc,
  serverTimestamp,
  orderBy,
  deleteDoc,
} from "firebase/firestore";

import { signOut } from "firebase/auth";
import { auth, db } from "../firebaseConfig";
import globalStyles from "../styles/global";
import colors from "../styles/colors";

// ---------- helpers ----------
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
  const [h, m] = String(hhmm || "0:0")
    .split(":")
    .map((x) => parseInt(x, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
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

function parseHoursText(text) {
  const raw = (text || "")
    .split(/[\n,]/g)
    .map((s) => normalizeHour(s))
    .filter(Boolean);

  const ok = raw.filter((h) => /^\d{2}:\d{2}$/.test(h));
  const uniq = Array.from(new Set(ok));
  uniq.sort((a, b) => timeToMin(a) - timeToMin(b));
  return uniq;
}

// ✅ פורמט טיפולים + זמן כולל (תומך גם ב-serviceType)
function formatServices(appOrReq) {
  const arr = Array.isArray(appOrReq?.servicesSelected) ? appOrReq.servicesSelected : [];
  const names = arr.map((s) => s?.name).filter(Boolean);
  const total = Number(appOrReq?.totalDurationMin || 0);

  const servicesText = names.length ? names.join(", ") : appOrReq?.serviceType || null;
  const totalText = total > 0 ? `${total} דק׳` : null;

  return { servicesText, totalText };
}

export default function OwnerDashboard({ navigation }) {
  const { width } = useWindowDimensions();

  const responsiveFont = (base) => {
    if (width < 360) return Math.max(12, base - 5);
    if (width < 420) return Math.max(12, base - 3);
    if (width < 768) return base;
    return base + 2;
  };

  const today = useMemo(() => new Date().toISOString().split("T")[0], []);
  const [selectedDate, setSelectedDate] = useState(today);

  // ✅ default שעות לכל הימים
  const [defaultHours, setDefaultHours] = useState(["15:00", "16:00", "17:00", "18:00", "19:00"]);
  const [defaultText, setDefaultText] = useState(defaultHours.join("\n"));
  const [defaultModalOpen, setDefaultModalOpen] = useState(false);

  // ✅ override שעות לתאריך
  const [availabilityExists, setAvailabilityExists] = useState(false);
  const [availabilityHours, setAvailabilityHours] = useState([]);
  const [availabilityText, setAvailabilityText] = useState("");
  const [availabilityModalOpen, setAvailabilityModalOpen] = useState(false);

  // ✅ בקשות לתור
  const [requests, setRequests] = useState([]);

  // ✅ תורים מאושרים בלבד
  const [appointments, setAppointments] = useState([]);
  const [usersMap, setUsersMap] = useState({});

  // ✅ סימון ימים ביומן
  const [busyDaysMap, setBusyDaysMap] = useState({});

  // ✅ טופס שריון ידני
  const [manualHour, setManualHour] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualService, setManualService] = useState("");
  const [manualModalOpen, setManualModalOpen] = useState(false);

  const phoneAccessoryId = "phoneAccessoryId";
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  // ✅ מסך לקוחות פעילים
  const [showUsers, setShowUsers] = useState(false);
  const [allUsers, setAllUsers] = useState([]);
  const [usersSearch, setUsersSearch] = useState("");

  // ✅ תפריט
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  async function handleLogout() {
    try {
      await signOut(auth);
    } catch (e) {
      Alert.alert("שגיאה", e?.message || "לא הצליח להתנתק");
    }
  }

  function confirmLogout() {
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      const ok = window.confirm("בטוחה שתרצי להתנתק?");
      if (ok) handleLogout();
      return;
    }
    Alert.alert("התנתקות", "בטוחה שתרצי להתנתק?", [
      { text: "ביטול", style: "cancel" },
      { text: "התנתק", style: "destructive", onPress: handleLogout },
    ]);
  }

  // ✅ מאזין לברירת מחדל settings/business
  useEffect(() => {
    const ref = doc(db, "settings", "business");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const fallback = ["15:00", "16:00", "17:00", "18:00", "19:00"];
        if (!snap.exists()) {
          setDefaultHours(fallback);
          setDefaultText(fallback.join("\n"));
          return;
        }
        const arr = snap.data()?.defaultHours || [];
        const safe = Array.isArray(arr) && arr.length ? arr : fallback;
        safe.sort((a, b) => timeToMin(a) - timeToMin(b));
        setDefaultHours(safe);
        setDefaultText(safe.join("\n"));
      },
      (err) => {
        console.log("❌ settings/business listen error:", err?.code, err?.message);
        const fallback = ["15:00", "16:00", "17:00", "18:00", "19:00"];
        setDefaultHours(fallback);
        setDefaultText(fallback.join("\n"));
      }
    );
    return () => unsub();
  }, []);

  // ✅ override שעות בזמן אמת לתאריך הנבחר
  useEffect(() => {
    const ref = doc(db, "availability", selectedDate);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setAvailabilityExists(false);
          setAvailabilityHours([]);
          setAvailabilityText("");
          return;
        }
        setAvailabilityExists(true);
        const hours = snap.data()?.hours || [];
        const safe = Array.isArray(hours) ? hours : [];
        safe.sort((a, b) => timeToMin(a) - timeToMin(b));
        setAvailabilityHours(safe);
        setAvailabilityText(safe.join("\n"));
      },
      (err) => {
        console.log("❌ availability listen error:", err?.code, err?.message);
        setAvailabilityExists(false);
        setAvailabilityHours([]);
        setAvailabilityText("");
      }
    );
    return () => unsub();
  }, [selectedDate]);

  // שעות לתאריך (override אם קיים, אחרת default)
  const hoursForSelectedDate = useMemo(() => {
    if (availabilityExists) return availabilityHours;
    return defaultHours;
  }, [availabilityExists, availabilityHours, defaultHours]);

  // ✅ בקשות ממתינות לתאריך הנבחר
  useEffect(() => {
    const qReq = query(
      collection(db, "appointmentRequests"),
      where("date", "==", selectedDate),
      where("status", "==", "pending")
    );

    const unsub = onSnapshot(
      qReq,
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        arr.sort((a, b) => timeToMin(a.hour) - timeToMin(b.hour));
        setRequests(arr);
      },
      (err) => {
        console.log("❌ appointmentRequests listen error:", err?.code, err?.message);
        Alert.alert("שגיאה בטעינת בקשות ממתינות", err?.message || "לא הצליח לטעון בקשות. בדקי אינדקס/הרשאות.");
        setRequests([]);
      }
    );

    return () => unsub();
  }, [selectedDate]);

  // ✅ תורים מאושרים לתאריך הנבחר
  useEffect(() => {
    if (showUsers) return;

    const qApps = query(
      collection(db, "appointments"),
      where("date", "==", selectedDate),
      where("status", "==", "approved")
    );

    const unsub = onSnapshot(
      qApps,
      (snap) => {
        const raw = snap.docs.map((d) => ({ docId: d.id, ...d.data() }));
        const arr = raw.filter((a) => {
          if (a?.groupId) return !!a?.isHead;
          return true;
        });
        arr.sort((a, b) => timeToMin(a.hour) - timeToMin(b.hour));
        setAppointments(arr);
      },
      (err) => {
        console.log("❌ approved appointments listen error:", err?.code, err?.message);
        Alert.alert("שגיאה", "לא הצליח לטעון תורים מאושרים");
      }
    );

    return () => unsub();
  }, [selectedDate, showUsers]);

  // ✅ סימון ימים "עסוקים" ביומן
  useEffect(() => {
    if (showUsers) return;

    const qAllApps = query(collection(db, "appointments"), where("status", "in", ["pending", "approved"]));
    const unsubApps = onSnapshot(
      qAllApps,
      (snap) => {
        const next = {};
        snap.docs.forEach((d) => {
          const data = d.data() || {};
          if (data?.date) next[data.date] = true;
        });
        setBusyDaysMap((prev) => ({ ...prev, ...next }));
      },
      (err) => console.log("❌ busy days appointments error:", err?.code, err?.message)
    );

    const qAllReq = query(collection(db, "appointmentRequests"), where("status", "==", "pending"));
    const unsubReq = onSnapshot(
      qAllReq,
      (snap) => {
        const next = {};
        snap.docs.forEach((d) => {
          const data = d.data() || {};
          if (data?.date) next[data.date] = true;
        });
        setBusyDaysMap((prev) => ({ ...prev, ...next }));
      },
      (err) => console.log("❌ busy days requests error:", err?.code, err?.message)
    );

    return () => {
      unsubApps();
      unsubReq();
    };
  }, [showUsers]);

  // ✅ טעינת פרטי משתמשים עבור בקשות + תורים
  useEffect(() => {
    if (showUsers) return;

    let cancelled = false;

    (async () => {
      const uids = new Set();
      appointments.forEach((a) => a.userId && uids.add(a.userId));
      requests.forEach((r) => r.userId && uids.add(r.userId));

      const nextMap = { ...usersMap };

      for (const uid of Array.from(uids)) {
        if (!nextMap[uid]) {
          try {
            const snap = await getDoc(doc(db, "users", uid));
            if (snap.exists()) nextMap[uid] = snap.data();
          } catch (e) {
            console.log("❌ get user doc error:", e?.message);
          }
        }
      }

      if (!cancelled) setUsersMap(nextMap);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments, requests, showUsers]);

  // ✅ רשימת משתמשים בזמן אמת
  useEffect(() => {
    if (!showUsers) return;

    const qUsers = query(collection(db, "users"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      qUsers,
      (snap) => setAllUsers(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))),
      (err) => {
        console.log("❌ users list listen error:", err?.code, err?.message);
        Alert.alert("שגיאה", "לא הצליח לטעון לקוחות");
      }
    );
    return () => unsub();
  }, [showUsers]);

  const filteredUsers = useMemo(() => {
    const t = (usersSearch || "").trim().toLowerCase();
    if (!t) return allUsers;

    return allUsers.filter((u) => {
      const name = `${u.firstName || ""} ${u.lastName || ""}`.toLowerCase();
      const email = (u.email || "").toLowerCase();
      const phone = (u.phone || "").toString().toLowerCase();
      const displayName = (u.displayName || "").toLowerCase();
      return (
        name.includes(t) ||
        email.includes(t) ||
        phone.includes(t) ||
        displayName.includes(t) ||
        (u.uid || "").toLowerCase().includes(t)
      );
    });
  }, [allUsers, usersSearch]);

  // ---------- actions ----------
  async function saveDefaultHours() {
    const hours = parseHoursText(defaultText);
    if (hours.length === 0) {
      Alert.alert("שגיאה", "לא זוהו שעות. לדוגמה: 15:00 ואז Enter");
      return;
    }

    const ref = doc(db, "settings", "business");

    try {
      await runTransaction(db, async (tx) => {
        tx.set(
          ref,
          {
            defaultHours: hours,
            updatedAt: serverTimestamp(),
            updatedBy: auth.currentUser?.uid || null,
          },
          { merge: true }
        );
      });

      Alert.alert("בוצע", "ברירת המחדל נשמרה");
      setDefaultModalOpen(false);
      Keyboard.dismiss();
    } catch (e) {
      Alert.alert("שגיאה", e?.message || "לא הצליח לשמור ברירת מחדל");
    }
  }

  async function saveAvailabilityForDate() {
    const hours = parseHoursText(availabilityText);
    const ref = doc(db, "availability", selectedDate);

    try {
      await runTransaction(db, async (tx) => {
        tx.set(
          ref,
          {
            date: selectedDate,
            hours,
            updatedAt: serverTimestamp(),
            updatedBy: auth.currentUser?.uid || null,
          },
          { merge: true }
        );
      });

      Alert.alert("בוצע", "השעות לתאריך נשמרו");
      setAvailabilityModalOpen(false);
      Keyboard.dismiss();
    } catch (e) {
      Alert.alert("שגיאה", e?.message || "לא הצליח לשמור שעות לתאריך");
    }
  }

  async function resetAvailabilityForDate() {
    try {
      await deleteDoc(doc(db, "availability", selectedDate));
      Alert.alert("בוצע", "התאריך אופס לברירת מחדל");
    } catch (e) {
      Alert.alert("שגיאה", e?.message || "לא הצליח לאפס תאריך");
    }
  }

  // ✅ אישור בקשה (תומך slots)
  async function approveRequest(req) {
    const { id, date, hour, userId } = req;

    const groupId = req.groupId || makeAppointmentDocId(date, hour);
    const slots = Array.isArray(req.slots) && req.slots.length ? req.slots : [hour];

    const reqRef = doc(db, "appointmentRequests", id);
    const userResRef = doc(db, "userReservations", userId);

    try {
      await runTransaction(db, async (tx) => {
        const reqSnap = await tx.get(reqRef);
        if (!reqSnap.exists()) throw new Error("הבקשה כבר לא קיימת");
        const liveReq = reqSnap.data();
        if (liveReq.status !== "pending") throw new Error("הבקשה כבר טופלה");

        const myResSnap = await tx.get(userResRef);
        if (!myResSnap.exists()) throw new Error("לא נמצא רישום תור למשתמש");

        const myRes = myResSnap.data();
        if (myRes.appointmentId !== groupId) {
          throw new Error("למשתמש יש תור אחר פעיל (לא תואם לבקשה הזו)");
        }

        const appRefs = slots.map((h) => doc(db, "appointments", makeAppointmentDocId(date, h)));
        const appSnaps = [];
        for (const r of appRefs) appSnaps.push(await tx.get(r));

        for (let i = 0; i < appSnaps.length; i++) {
          const s = appSnaps[i];
          const slotHour = slots[i];
          if (!s.exists()) throw new Error(`חסר סלוט ${slotHour} (אולי בוטל)`);
          const live = s.data();
          if (live.status !== "pending") throw new Error(`הסלוט ${slotHour} כבר לא pending`);
          if (live.userId !== userId) throw new Error(`הסלוט ${slotHour} שייך למשתמש אחר`);
          if ((live.groupId || groupId) !== groupId) throw new Error("groupId לא תואם");
        }

        for (const r of appRefs) {
          tx.update(r, {
            status: "approved",
            approvedAt: serverTimestamp(),
            approvedBy: auth.currentUser?.uid || null,
            source: "request_approved",
          });
        }

        tx.set(
          userResRef,
          {
            status: "approved",
            approvedAt: serverTimestamp(),
            approvedBy: auth.currentUser?.uid || null,
          },
          { merge: true }
        );

        tx.update(reqRef, {
          status: "approved",
          decidedAt: serverTimestamp(),
          decidedBy: auth.currentUser?.uid || null,
        });
      });

      Alert.alert("אושר ✅", `אישרת את הבקשה לשעה ${hour}`);
    } catch (e) {
      Alert.alert("שגיאה", e?.message || "לא הצליח לאשר בקשה");
    }
  }

  // ✅ דחיית בקשה
  async function rejectRequest(req) {
    const reqRef = doc(db, "appointmentRequests", req.id);
    const userResRef = doc(db, "userReservations", req.userId);

    const groupId = req.groupId || makeAppointmentDocId(req.date, req.hour);
    const slots = Array.isArray(req.slots) && req.slots.length ? req.slots : [req.hour];

    try {
      await runTransaction(db, async (tx) => {
        const s = await tx.get(reqRef);
        if (!s.exists()) throw new Error("הבקשה כבר לא קיימת");
        if (s.data().status !== "pending") throw new Error("הבקשה כבר טופלה");

        const ur = await tx.get(userResRef);

        const slotRefs = slots.map((h) => doc(db, "appointments", makeAppointmentDocId(req.date, h)));
        const slotSnaps = [];
        for (const r of slotRefs) slotSnaps.push(await tx.get(r));

        tx.update(reqRef, {
          status: "rejected",
          decidedAt: serverTimestamp(),
          decidedBy: auth.currentUser?.uid || null,
        });

        for (let i = 0; i < slotSnaps.length; i++) {
          const snap = slotSnaps[i];
          if (!snap.exists()) continue;
          const live = snap.data();
          if (live?.status === "pending" && (live?.groupId || groupId) === groupId) {
            tx.delete(slotRefs[i]);
          }
        }

        if (ur.exists()) {
          tx.set(
            userResRef,
            {
              status: "rejected",
              rejectedAt: serverTimestamp(),
              appointmentId: null,
              date: null,
              hour: null,
              groupId: null,
              slots: [],
            },
            { merge: true }
          );
        }
      });

      Alert.alert("נדחה", "הבקשה נדחתה");
    } catch (e) {
      Alert.alert("שגיאה", e?.message || "לא הצליח לדחות בקשה");
    }
  }

  // ✅ ביטול תור מאושר
  async function ownerCancelAppointment(app) {
    const { docId, userId, date, hour } = app;

    if (isAppointmentPast(date, hour)) {
      Alert.alert("לא ניתן לבטל", "התור כבר עבר ולכן אי אפשר לבטל אותו.");
      return;
    }

    const groupId = app.groupId || null;
    const slots = Array.isArray(app.slots) && app.slots.length ? app.slots : [hour];

    Alert.alert("ביטול תור", `לבטל את התור של ${hour} בתאריך ${date}?`, [
      { text: "לא", style: "cancel" },
      {
        text: "כן, לבטל",
        style: "destructive",
        onPress: async () => {
          try {
            const userResRef = userId ? doc(db, "userReservations", userId) : null;

            await runTransaction(db, async (tx) => {
              let userResSnap = null;
              if (userResRef) userResSnap = await tx.get(userResRef);

              const slotRefs = slots.map((h) => doc(db, "appointments", makeAppointmentDocId(date, h)));
              const slotSnaps = [];
              for (const r of slotRefs) slotSnaps.push(await tx.get(r));

              for (let i = 0; i < slotSnaps.length; i++) {
                const snap = slotSnaps[i];
                if (!snap.exists()) continue;

                const live = snap.data();
                const sameGroup = groupId ? live?.groupId === groupId : true;
                const sameUser = userId ? live?.userId === userId : true;

                if (sameGroup && sameUser && !isAppointmentPast(live?.date, live?.hour)) {
                  tx.delete(slotRefs[i]);
                }
              }

              if (userResRef && userResSnap && userResSnap.exists()) {
                const ur = userResSnap.data();
                if ((groupId && ur?.appointmentId === groupId) || (!groupId && ur?.appointmentId === docId)) {
                  tx.delete(userResRef);
                }
              }
            });

            Alert.alert("בוצע", "התור בוטל בהצלחה");
          } catch (e) {
            Alert.alert("שגיאה", e?.message || "לא הצליח לבטל תור");
          }
        },
      },
    ]);
  }

  // ✅ שריון ידני: מאושר מיד
  async function ownerCreateManualAppointment() {
    const hour = normalizeHour(manualHour);
    const name = manualName.trim();
    const phone = manualPhone.trim().replace(/[^\d]/g, "");
    const serviceType = (manualService || "").trim();

    if (!hour || !name || !phone) {
      Alert.alert("שגיאה", "מלאי שעה, שם וטלפון");
      return;
    }
    if (phone.length < 9) {
      Alert.alert("שגיאה", "מספר טלפון לא תקין");
      return;
    }

    if (hoursForSelectedDate.length > 0 && !hoursForSelectedDate.includes(hour)) {
      Alert.alert("שגיאה", "השעה הזו לא מוגדרת כזמינה בתאריך הזה");
      return;
    }

    const appId = makeAppointmentDocId(selectedDate, hour);
    const appointmentRef = doc(db, "appointments", appId);

    try {
      await runTransaction(db, async (tx) => {
        const existing = await tx.get(appointmentRef);
        if (existing.exists()) throw new Error("התור בשעה הזו כבר תפוס");

        tx.set(appointmentRef, {
          date: selectedDate,
          hour,
          userId: null,
          customerName: name,
          customerPhone: phone,
          serviceType: serviceType || null,

          groupId: null,
          isHead: true,
          slots: [hour],

          status: "approved",
          approvedAt: serverTimestamp(),
          approvedBy: auth.currentUser?.uid || null,
          createdAt: serverTimestamp(),
          source: "owner_manual",
        });
      });

      Alert.alert("בוצע", `התור נשמר ל-${name} בשעה ${hour}`);
      setManualHour("");
      setManualName("");
      setManualPhone("");
      setManualService("");
      Keyboard.dismiss();
      setManualModalOpen(false);
    } catch (e) {
      Alert.alert("שגיאה", e?.message || "לא הצליח לשריין תור");
    }
  }

  const MenuItem = ({ text, danger, onPress }) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: danger ? "#d33" : colors.border,
          backgroundColor: "#fff",
          marginTop: 10,
          alignItems: "center",
          opacity: pressed ? 0.88 : 1,
        },
        Platform.OS === "web" ? { cursor: "pointer" } : null,
      ]}
    >
      <Text style={{ fontWeight: "900", color: danger ? "#d33" : colors.textDark }}>{text}</Text>
    </Pressable>
  );

  // ✅ markedDates: יום נבחר + נקודה סגולה בימים עם לקוחות
  const markedDates = useMemo(() => {
    const out = {};
    Object.keys(busyDaysMap || {}).forEach((d) => {
      out[d] = { ...(out[d] || {}), marked: true, dotColor: colors.primary };
    });

    out[selectedDate] = {
      ...(out[selectedDate] || {}),
      selected: true,
      selectedColor: colors.primary,
      marked: !!busyDaysMap?.[selectedDate],
      dotColor: colors.primary,
    };

    return out;
  }, [busyDaysMap, selectedDate]);

  // --------- מסך "לקוחות פעילים" ---------
  if (showUsers) {
    return (
      <View style={[globalStyles.container, { backgroundColor: "transparent" }]}>
        <View style={{ paddingVertical: 12, marginBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Text style={{ fontSize: responsiveFont(22), fontWeight: "900", textAlign: "center", color: colors.primary }}>
            לקוחות פעילים
          </Text>

          <Pressable
            onPress={() => {
              Keyboard.dismiss();
              setShowUsers(false);
            }}
            style={({ pressed }) => [
              {
                marginTop: 10,
                alignSelf: "center",
                backgroundColor: "#444",
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: 8,
                opacity: pressed ? 0.88 : 1,
              },
              Platform.OS === "web" ? { cursor: "pointer" } : null,
            ]}
          >
            <Text style={{ color: "white", fontWeight: "800" }}>חזרה למסך תורים</Text>
          </Pressable>
        </View>

        <View style={{ backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 10, marginBottom: 10 }}>
          <TextInput
            value={usersSearch}
            onChangeText={setUsersSearch}
            placeholder="חיפוש לפי שם / טלפון / אימייל"
            placeholderTextColor="#777"
            style={[globalStyles.input, { textAlign: "right", writingDirection: "rtl" }]}
          />
          <Text style={{ marginTop: 6, color: "gray", textAlign: "center" }}>סה"כ: {filteredUsers.length}</Text>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled">
          {filteredUsers.length === 0 ? (
            <Text style={{ textAlign: "center", color: "gray", marginTop: 20 }}>אין לקוחות להצגה</Text>
          ) : (
            filteredUsers.map((u) => {
              const fullName = `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.displayName || "ללא שם";

              return (
                <View
                  key={u.uid}
                  style={{
                    backgroundColor: "#fff",
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: 12,
                    marginBottom: 10,
                    alignItems: "flex-end",
                  }}
                >
                  <Text style={{ fontSize: responsiveFont(16), fontWeight: "900", color: colors.textDark, textAlign: "right", width: "100%" }}>
                    {fullName}
                  </Text>

                  <Text style={{ marginTop: 4, color: colors.textDark, textAlign: "right", writingDirection: "ltr", width: "100%" }}>
                    {u.email || "—"} :אימייל
                  </Text>

                  <Text style={{ marginTop: 2, color: colors.textDark, textAlign: "right", writingDirection: "ltr", width: "100%" }}>
                    {u.phone || "—"} :טלפון
                  </Text>
                </View>
              );
            })
          )}
        </ScrollView>
      </View>
    );
  }

  // --------- מסך ראשי ---------
  return (
    <View style={[globalStyles.container, { backgroundColor: "transparent" }]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 28, flexGrow: 1 }}>
        {/* Header */}
        <View style={{ paddingVertical: 12, marginBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
            <View style={{ width: 46 }} />

            <View style={{ flex: 1, paddingHorizontal: 10 }}>
              <Text style={{ fontSize: responsiveFont(24), fontWeight: "900", textAlign: "center", color: colors.primary }}>
                מסך בעלת העסק
              </Text>

              <Text style={{ marginTop: 6, fontSize: responsiveFont(15), textAlign: "center", color: colors.textDark, fontWeight: "700" }}>
                תאריך נבחר: {selectedDate}
              </Text>

              <Text style={{ marginTop: 6, fontSize: responsiveFont(13), textAlign: "center", color: "#444", fontWeight: "700" }}>
                שעות לתאריך: {hoursForSelectedDate.length} {availabilityExists ? "(מיוחד)" : "(ברירת מחדל)"}
              </Text>

              <Text style={{ marginTop: 6, fontSize: responsiveFont(13), textAlign: "center", color: "#ff8f00", fontWeight: "900" }}>
                בקשות ממתינות: {requests.length}
              </Text>
            </View>

            <Pressable
              onPress={() => setMenuOpen(true)}
              hitSlop={{ top: 18, left: 18, right: 18, bottom: 18 }}
              style={({ pressed }) => [
                {
                  width: 46,
                  height: 46,
                  borderRadius: 14,
                  backgroundColor: "#fff",
                  borderWidth: 1,
                  borderColor: colors.border,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.88 : 1,
                },
                Platform.OS === "web" ? { cursor: "pointer" } : null,
              ]}
            >
              <View style={{ width: 18, height: 2, backgroundColor: colors.primary, marginVertical: 2, borderRadius: 2 }} />
              <View style={{ width: 18, height: 2, backgroundColor: colors.primary, marginVertical: 2, borderRadius: 2 }} />
              <View style={{ width: 18, height: 2, backgroundColor: colors.primary, marginVertical: 2, borderRadius: 2 }} />
            </Pressable>
          </View>
        </View>

        {/* Menu */}
        <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
          <TouchableWithoutFeedback onPress={() => setMenuOpen(false)}>
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", padding: 18 }}>
              <TouchableWithoutFeedback onPress={() => {}}>
                <View
                  style={{
                    marginTop: 70,
                    alignSelf: "flex-end",
                    width: 240,
                    backgroundColor: "#fff",
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: 14,
                  }}
                >
                  <Text style={{ fontWeight: "900", color: colors.primary, fontSize: responsiveFont(16), textAlign: "center" }}>
                    תפריט
                  </Text>

                  <MenuItem
                    text="הגדרת ברירת מחדל"
                    onPress={() => {
                      setMenuOpen(false);
                      Keyboard.dismiss();
                      setDefaultModalOpen(true);
                    }}
                  />
                  <MenuItem
                    text="שעות לתאריך ספציפי"
                    onPress={() => {
                      setMenuOpen(false);
                      Keyboard.dismiss();
                      setAvailabilityModalOpen(true);
                    }}
                  />
                  <MenuItem
                    text="שריון ידני ללקוחה"
                    onPress={() => {
                      setMenuOpen(false);
                      Keyboard.dismiss();
                      setManualModalOpen(true);
                    }}
                  />

                  {/* ✅ כפתור מעבר למסך דף העסק */}
                  <MenuItem
                    text="דף העסק (עריכה)"
                    onPress={() => {
                      setMenuOpen(false);
                      Keyboard.dismiss();
                      navigation.navigate("BusinessHomeOwner");
                    }}
                  />

                  <MenuItem
                    text="לקוחות פעילים"
                    onPress={() => {
                      setMenuOpen(false);
                      Keyboard.dismiss();
                      setShowUsers(true);
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
                  <MenuItem text="סגור" onPress={() => setMenuOpen(false)} />
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* Modal: ברירת מחדל */}
        <Modal visible={defaultModalOpen} transparent animationType="slide" onRequestClose={() => setDefaultModalOpen(false)}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", padding: 18, justifyContent: "center" }}>
              <TouchableWithoutFeedback onPress={() => {}}>
                <View style={{ backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14 }}>
                  <Text style={{ fontWeight: "900", color: colors.primary, fontSize: responsiveFont(18), textAlign: "center" }}>
                    ברירת מחדל לכל הימים
                  </Text>

                  <Text style={{ marginTop: 8, color: "#444", textAlign: "right", fontWeight: "700" }}>
                    הזיני שעה בכל שורה:
                    {"\n"}15:00{"\n"}16:00{"\n"}17:00{"\n"}18:00{"\n"}19:00
                  </Text>

                  <TextInput
                    value={defaultText}
                    onChangeText={setDefaultText}
                    placeholder="15:00"
                    placeholderTextColor="#777"
                    multiline
                    style={[globalStyles.input, { marginTop: 10, minHeight: 140, textAlign: "left", writingDirection: "ltr", paddingTop: 12 }]}
                  />

                  <Pressable
                    onPress={saveDefaultHours}
                    style={({ pressed }) => [
                      { backgroundColor: colors.primary, paddingVertical: 12, borderRadius: 10, alignItems: "center", marginTop: 12, opacity: pressed ? 0.88 : 1 },
                      Platform.OS === "web" ? { cursor: "pointer" } : null,
                    ]}
                  >
                    <Text style={{ color: "white", fontWeight: "900" }}>שמור ברירת מחדל</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setDefaultModalOpen(false)}
                    style={({ pressed }) => [
                      { backgroundColor: "#444", paddingVertical: 10, borderRadius: 10, alignItems: "center", marginTop: 10, opacity: pressed ? 0.88 : 1 },
                      Platform.OS === "web" ? { cursor: "pointer" } : null,
                    ]}
                  >
                    <Text style={{ color: "white", fontWeight: "900" }}>סגור</Text>
                  </Pressable>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* Modal: שעות לתאריך */}
        <Modal visible={availabilityModalOpen} transparent animationType="slide" onRequestClose={() => setAvailabilityModalOpen(false)}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", padding: 18, justifyContent: "center" }}>
              <TouchableWithoutFeedback onPress={() => {}}>
                <View style={{ backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14 }}>
                  <Text style={{ fontWeight: "900", color: colors.primary, fontSize: responsiveFont(18), textAlign: "center" }}>
                    שעות לתאריך {selectedDate}
                  </Text>

                  <Text style={{ marginTop: 8, color: "#444", textAlign: "right", fontWeight: "700" }}>
                    אם תשמרי ריק — אין שעות באותו יום (override).
                  </Text>

                  <TextInput
                    value={availabilityText}
                    onChangeText={setAvailabilityText}
                    placeholder="15:00"
                    placeholderTextColor="#777"
                    multiline
                    style={[globalStyles.input, { marginTop: 10, minHeight: 140, textAlign: "left", writingDirection: "ltr", paddingTop: 12 }]}
                  />

                  <Pressable
                    onPress={saveAvailabilityForDate}
                    style={({ pressed }) => [
                      { backgroundColor: colors.primary, paddingVertical: 12, borderRadius: 10, alignItems: "center", marginTop: 12, opacity: pressed ? 0.88 : 1 },
                      Platform.OS === "web" ? { cursor: "pointer" } : null,
                    ]}
                  >
                    <Text style={{ color: "white", fontWeight: "900" }}>שמור שעות לתאריך</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      if (!availabilityExists) {
                        Alert.alert("אין מה לאפס", "אין שעות מיוחדות לתאריך הזה.");
                        return;
                      }
                      Alert.alert("איפוס תאריך", "למחוק את השעות המיוחדות ולחזור לברירת המחדל?", [
                        { text: "ביטול", style: "cancel" },
                        { text: "אפס", style: "destructive", onPress: resetAvailabilityForDate },
                      ]);
                    }}
                    style={({ pressed }) => [
                      { backgroundColor: "#fff", borderWidth: 1, borderColor: "#d33", paddingVertical: 10, borderRadius: 10, alignItems: "center", marginTop: 10, opacity: pressed ? 0.88 : 1 },
                      Platform.OS === "web" ? { cursor: "pointer" } : null,
                    ]}
                  >
                    <Text style={{ color: "#d33", fontWeight: "900" }}>איפוס תאריך לברירת מחדל</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setAvailabilityModalOpen(false)}
                    style={({ pressed }) => [
                      { backgroundColor: "#444", paddingVertical: 10, borderRadius: 10, alignItems: "center", marginTop: 10, opacity: pressed ? 0.88 : 1 },
                      Platform.OS === "web" ? { cursor: "pointer" } : null,
                    ]}
                  >
                    <Text style={{ color: "white", fontWeight: "900" }}>סגור</Text>
                  </Pressable>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* Modal: שריון ידני */}
        <Modal visible={manualModalOpen} transparent animationType="slide" onRequestClose={() => setManualModalOpen(false)}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", padding: 18, justifyContent: "center" }}>
              <TouchableWithoutFeedback onPress={() => {}}>
                <View style={{ backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14 }}>
                  <Text style={{ fontWeight: "900", color: colors.primary, fontSize: responsiveFont(18), textAlign: "center" }}>
                    שריון ידני (מאושר)
                  </Text>

                  <TextInput
                    value={manualHour}
                    onChangeText={setManualHour}
                    placeholder="שעה (לדוגמה 15:00)"
                    placeholderTextColor="#777"
                    style={[globalStyles.input, { marginTop: 10, textAlign: "right", writingDirection: "ltr" }]}
                  />

                  <TextInput
                    value={manualName}
                    onChangeText={setManualName}
                    placeholder="שם לקוחה"
                    placeholderTextColor="#777"
                    style={[globalStyles.input, { marginTop: 8, textAlign: "right", writingDirection: "rtl" }]}
                  />

                  <TextInput
                    value={manualPhone}
                    onChangeText={setManualPhone}
                    placeholder="טלפון"
                    placeholderTextColor="#777"
                    keyboardType="phone-pad"
                    returnKeyType="done"
                    onSubmitEditing={Keyboard.dismiss}
                    onFocus={() => setPhoneFocused(true)}
                    onBlur={() => setPhoneFocused(false)}
                    {...(Platform.OS === "ios" ? { inputAccessoryViewID: phoneAccessoryId } : {})}
                    style={[globalStyles.input, { marginTop: 8, textAlign: "right", writingDirection: "ltr" }]}
                  />

                  <TextInput
                    value={manualService}
                    onChangeText={setManualService}
                    placeholder="סוג טיפול (אופציונלי)"
                    placeholderTextColor="#777"
                    style={[globalStyles.input, { marginTop: 8, textAlign: "right", writingDirection: "rtl" }]}
                  />

                  {Platform.OS === "android" && phoneFocused && keyboardVisible ? (
                    <Pressable
                      onPress={Keyboard.dismiss}
                      style={({ pressed }) => [
                        { alignSelf: "flex-end", backgroundColor: colors.primary, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, marginTop: 10, opacity: pressed ? 0.88 : 1 },
                        Platform.OS === "web" ? { cursor: "pointer" } : null,
                      ]}
                    >
                      <Text style={{ color: "white", fontWeight: "900" }}>סיום</Text>
                    </Pressable>
                  ) : null}

                  <Pressable
                    onPress={ownerCreateManualAppointment}
                    style={({ pressed }) => [
                      { backgroundColor: colors.primary, paddingVertical: 12, borderRadius: 10, alignItems: "center", marginTop: 12, opacity: pressed ? 0.88 : 1 },
                      Platform.OS === "web" ? { cursor: "pointer" } : null,
                    ]}
                  >
                    <Text style={{ color: "white", fontWeight: "900" }}>שמור תור</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setManualModalOpen(false)}
                    style={({ pressed }) => [
                      { backgroundColor: "#444", paddingVertical: 10, borderRadius: 10, alignItems: "center", marginTop: 10, opacity: pressed ? 0.88 : 1 },
                      Platform.OS === "web" ? { cursor: "pointer" } : null,
                    ]}
                  >
                    <Text style={{ color: "white", fontWeight: "900" }}>סגור</Text>
                  </Pressable>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* iOS accessory */}
        {Platform.OS === "ios" ? (
          <InputAccessoryView nativeID={phoneAccessoryId}>
            <View style={{ backgroundColor: "#f2f2f2", borderTopWidth: 1, borderTopColor: "#ddd", paddingVertical: 8, paddingHorizontal: 12, alignItems: "flex-end" }}>
              <Pressable onPress={Keyboard.dismiss} style={{ paddingVertical: 6, paddingHorizontal: 10 }}>
                <Text style={{ color: colors.primary, fontWeight: "900", fontSize: 16 }}>סגירה</Text>
              </Pressable>
            </View>
          </InputAccessoryView>
        ) : null}

        {/* Calendar */}
        <Calendar
          minDate={today}
          onDayPress={(day) => setSelectedDate(day.dateString)}
          markedDates={markedDates}
          markingType={"dot"}
          style={{ borderRadius: 10, borderWidth: 1, borderColor: colors.border, marginBottom: 12 }}
          theme={{
            todayTextColor: colors.secondary,
            selectedDayBackgroundColor: colors.primary,
            arrowColor: colors.primary,
            monthTextColor: colors.primary,
            textDisabledColor: "#d9e1e8",
          }}
        />

        {/* בקשות ממתינות */}
        <View style={{ marginBottom: 14 }}>
          <Text style={{ fontWeight: "900", color: colors.primary, fontSize: responsiveFont(16), textAlign: "right" }}>
            בקשות ממתינות
          </Text>

          {requests.length === 0 ? (
            <Text style={{ color: "gray", textAlign: "right", marginTop: 6 }}>אין בקשות ממתינות לתאריך הזה</Text>
          ) : (
            requests.map((r) => {
              const u = r.userId ? usersMap[r.userId] : null;
              const fullName = `${u?.firstName || ""} ${u?.lastName || ""}`.trim() || u?.displayName || r.userId;

              const { servicesText, totalText } = formatServices(r);

              return (
                <View key={r.id} style={{ marginTop: 10, backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12 }}>
                  <Text style={{ fontWeight: "900", textAlign: "right" }}>שעה: {r.hour}</Text>
                  <Text style={{ marginTop: 4, textAlign: "right" }}>לקוחה: {fullName}</Text>

                  <Text style={{ marginTop: 4, textAlign: "right" }}>טיפול: {servicesText || "לא נבחר"}</Text>
                  <Text style={{ marginTop: 2, textAlign: "right", fontWeight: "900", color: "#555" }}>
                    זמן כולל: {totalText || "—"}
                  </Text>

                  {Array.isArray(r.slots) && r.slots.length > 1 ? (
                    <Text style={{ marginTop: 4, textAlign: "right", color: "#666", fontWeight: "800" }}>
                      שעות שנתפסו: {r.slots.join(", ")}
                    </Text>
                  ) : null}

                  <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                    <Pressable onPress={() => approveRequest(r)} style={{ flex: 1, backgroundColor: "#2e7d32", paddingVertical: 10, borderRadius: 10, alignItems: "center" }}>
                      <Text style={{ color: "white", fontWeight: "900" }}>אישור</Text>
                    </Pressable>

                    <Pressable onPress={() => rejectRequest(r)} style={{ flex: 1, backgroundColor: "#c62828", paddingVertical: 10, borderRadius: 10, alignItems: "center" }}>
                      <Text style={{ color: "white", fontWeight: "900" }}>דחייה</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* תורים מאושרים */}
        <View style={{ marginBottom: 8 }}>
          <Text style={{ fontWeight: "900", color: colors.primary, fontSize: responsiveFont(16), textAlign: "right" }}>
            תורים מאושרים
          </Text>

          {appointments.length === 0 ? (
            <Text style={{ textAlign: "right", color: "gray", marginTop: 8 }}>אין תורים מאושרים ליום הזה</Text>
          ) : (
            appointments.map((app) => {
              const u = app.userId ? usersMap[app.userId] : null;

              const fullName = app.userId
                ? `${u?.firstName || ""} ${u?.lastName || ""}`.trim()
                : (app.customerName || "").trim();

              const phone = app.userId ? u?.phone : app.customerPhone;
              const isPast = isAppointmentPast(app.date, app.hour);

              const { servicesText, totalText } = formatServices(app);

              return (
                <View
                  key={app.docId}
                  style={{
                    backgroundColor: "#fff",
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: 12,
                    marginBottom: 10,
                    alignItems: "flex-end",
                  }}
                >
                  <Text style={{ fontSize: responsiveFont(16), fontWeight: "900", color: colors.textDark, width: "100%", textAlign: "right" }}>
                    שעה: {app.hour}
                  </Text>

                  <Text style={{ marginTop: 6, fontSize: responsiveFont(14), color: colors.textDark, width: "100%", textAlign: "right" }}>
                    לקוחה: {fullName || "לא נטען"}
                  </Text>

                  <Text style={{ marginTop: 2, fontSize: responsiveFont(14), color: colors.textDark, width: "100%", textAlign: "right" }}>
                    טיפול: {servicesText || "לא נבחר"}
                  </Text>

                  <Text style={{ marginTop: 2, fontSize: responsiveFont(14), color: "#555", fontWeight: "900", width: "100%", textAlign: "right" }}>
                    זמן כולל: {totalText || "—"}
                  </Text>

                  {Array.isArray(app.slots) && app.slots.length > 1 ? (
                    <Text style={{ marginTop: 4, fontSize: responsiveFont(13), color: "#666", fontWeight: "800", width: "100%", textAlign: "right" }}>
                      שעות שנתפסו: {app.slots.join(", ")}
                    </Text>
                  ) : null}

                  <Text style={{ marginTop: 2, fontSize: responsiveFont(14), color: colors.textDark, width: "100%", textAlign: "right" }}>
                    טלפון: {phone || "לא נטען"}
                  </Text>

                  {isPast ? (
                    <Text style={{ marginTop: 6, fontSize: responsiveFont(14), color: "#2e7d32", fontWeight: "900", width: "100%", textAlign: "right" }}>
                      ✅ התור עבר
                    </Text>
                  ) : null}

                  <Pressable
                    disabled={isPast}
                    onPress={() => ownerCancelAppointment(app)}
                    style={{
                      marginTop: 10,
                      alignSelf: "flex-end",
                      backgroundColor: isPast ? "#bdbdbd" : "#c62828",
                      paddingVertical: 8,
                      paddingHorizontal: 14,
                      borderRadius: 8,
                      opacity: isPast ? 0.7 : 1,
                      ...(Platform.OS === "web" ? { cursor: isPast ? "not-allowed" : "pointer" } : null),
                    }}
                  >
                    <Text style={{ color: "white", fontWeight: "800", textAlign: "right" }}>
                      {isPast ? "לא ניתן לבטל" : "בטל תור"}
                    </Text>
                  </Pressable>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}
