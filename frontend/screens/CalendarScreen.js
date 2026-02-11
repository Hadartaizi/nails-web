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
  ImageBackground,
  StyleSheet,
  ActivityIndicator,
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
  getDocs,
  writeBatch,
  getDoc,
  deleteDoc,
  updateDoc,
} from "firebase/firestore";

import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "../firebaseConfig";
import { ensureHoldIfNeeded } from "./DayScreen";
import colors from "../styles/colors";

// 👇 תמונת ברירת מחדל כמו במסך הבית
const BG_FALLBACK = require("../assets/backgroundOpenRegisApp.jpg");

// ✅ לא מוסיפים cache-bust ל-data:image/...base64,...
function normalizeImgUri(uri, bustValue) {
  const u = String(uri || "");
  if (!u) return "";
  if (u.startsWith("data:image/")) return u;
  const sep = u.includes("?") ? "&" : "?";
  return `${u}${sep}t=${bustValue}`;
}

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

// עוזר כללי לבדוק אם תאריך/שעה מסוימים כבר עברו
function isDateHourPassed(dateStr, hourStr) {
  const dt = toLocalDateTime(dateStr, hourStr);
  if (!dt) return false;
  return dt.getTime() < Date.now() - 60 * 1000;
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

function makeAppointmentDocId(date, hour) {
  const safeHour = (hour || "").replace(":", "-");
  return `${date}_${safeHour}`;
}

function showMsg(title, msg) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${msg || ""}`);
  } else {
    Alert.alert(title, msg || "");
  }
}

export default function CalendarScreen({ navigation }) {
  const { width } = useWindowDimensions();

  // ====== רקע דינמי לכל האפליקציה (backgroundAllAppUrl) ======
  // undefined = עדיין לא נטען, null = אין ערך, string = URL
  const [backgroundAllAppUrl, setBackgroundAllAppUrl] = useState(undefined);
  const [bgUpdatedAt, setBgUpdatedAt] = useState(Date.now());

  useEffect(() => {
    // כמו ב-BusinessHomeScreen – settings/business
    const ref = doc(db, "settings", "business");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setBackgroundAllAppUrl(null);
          setBgUpdatedAt(Date.now());
          return;
        }
        const data = snap.data() || {};
        const url =
          typeof data.backgroundAllAppUrl === "string" &&
          data.backgroundAllAppUrl.trim()
            ? data.backgroundAllAppUrl.trim()
            : null;

        setBackgroundAllAppUrl(url);
        setBgUpdatedAt(Date.now());
      },
      (err) => {
        console.log(
          "❌ app backgrounds (business doc) listen error:",
          err?.code,
          err?.message
        );
        setBackgroundAllAppUrl(null);
        setBgUpdatedAt(Date.now());
      }
    );
    return () => unsub();
  }, []);

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

  const today = useMemo(() => {
    const now = new Date(); // תאריך מקומי
    const y = now.getFullYear();
    const m = pad2(now.getMonth() + 1);
    const d = pad2(now.getDate());
    return `${y}-${m}-${d}`;
  }, []);

  // ✅ userId יציב
  const [userId, setUserId] = useState(auth.currentUser?.uid || null);

  // ✅ גרסת תקנון מהשרת + מה שהמשתמש אישר
  const [termsVersion, setTermsVersion] = useState(1);
  const [userTermsAccepted, setUserTermsAccepted] = useState(false);
  const [userTermsAcceptedVersion, setUserTermsAcceptedVersion] =
    useState(0);

  const [myRes, setMyRes] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // ✅ החודש שמוצג ביומן
  const [calendarMonthDate, setCalendarMonthDate] = useState(today);

  // ✅ התאריך שנבחר ביומן (לעיגול)
  const [selectedDate, setSelectedDate] = useState(today);

  // ✅ נשמור את התור האחרון כדי לזהות כשנעלם
  const lastReservationRef = useRef(null);
  const deleteAlertShownRef = useRef(false);

  // ✅ רשימות המתנה שהמשתמש רשום אליהן
  const [myWaitlistEntries, setMyWaitlistEntries] = useState([]);

  // ✅ כל התורים העתידיים שהלקוח שריין (pending/approved, רק השעה הראשונה של כל תור)
  const [myFutureAppointments, setMyFutureAppointments] = useState([]);

  // ✅ auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUserId(user?.uid || null);
    });
    return () => unsub();
  }, []);

  // ✅ מאזין לגרסת התקנון האחרונה מהשרת (settings/terms)
  useEffect(() => {
    const ref = doc(db, "settings", "terms");

    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setTermsVersion(1);
          return;
        }
        const data = snap.data() || {};
        setTermsVersion(data.version || 1);
      },
      (err) => {
        console.log(
          "❌ settings/terms listen error:",
          err?.code,
          err?.message
        );
      }
    );

    return () => unsub();
  }, []);

  // ✅ מאזין לנתוני המשתמש: האם אישר תקנון ואיזו גרסה
  useEffect(() => {
    if (!userId) {
      setUserTermsAccepted(false);
      setUserTermsAcceptedVersion(0);
      return;
    }

    const ref = doc(db, "users", userId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setUserTermsAccepted(false);
          setUserTermsAcceptedVersion(0);
          return;
        }
        const data = snap.data() || {};
        setUserTermsAccepted(!!data.termsAccepted);
        setUserTermsAcceptedVersion(data.termsAcceptedVersion || 0);
      },
      (err) => {
        console.log(
          "❌ users terms listen error:",
          err?.code,
          err?.message
        );
      }
    );

    return () => unsub();
  }, [userId]);

  // ✅ האם המשתמש אישר את גרסת התקנון הנוכחית
  const hasAcceptedLatestTerms = useMemo(() => {
    if (!termsVersion) return false;
    return (
      userTermsAccepted && userTermsAcceptedVersion === termsVersion
    );
  }, [userTermsAccepted, userTermsAcceptedVersion, termsVersion]);

  // ✅ מאזין לתור של המשתמש + הודעות חד-פעמיות
  useEffect(() => {
    if (!userId) {
      setMyRes(null);
      lastReservationRef.current = null;
      deleteAlertShownRef.current = false;
      return;
    }

    const userResRef = doc(db, "userReservations", userId);

    const unsub = onSnapshot(
      userResRef,
      (snap) => {
        const prev = lastReservationRef.current;

        // ====== אין מסמך בכלל ======
        if (!snap.exists()) {
          setMyRes(null);

          if (prev && !deleteAlertShownRef.current) {
            const whenParts = [];
            if (prev.date) whenParts.push(prev.date);
            if (prev.hour) whenParts.push(prev.hour);
            const whenText = whenParts.join(" • ");

            const servicesArr = Array.isArray(prev?.servicesSelected)
              ? prev.servicesSelected
              : [];
            const serviceNames = servicesArr
              .map((s) => s?.name)
              .filter(Boolean);
            const serviceLabel =
              serviceNames.length > 0
                ? serviceNames.join(", ")
                : prev?.serviceType || "";

            let msg = "";
            if (serviceLabel && whenText) {
              msg = `התור שלך ל${serviceLabel} בתאריך ${whenText} כבר לא פעיל (בוטל או הושלם).\n\nניתן לקבוע תור חדש מהיומן.`;
            } else if (whenText) {
              msg = `התור שלך בתאריך ${whenText} כבר לא פעיל (בוטל או הושלם).\n\nניתן לקבוע תור חדש מהיומן.`;
            } else {
              msg = `התור שלך כבר לא פעיל (בוטל או הושלם).\n\nניתן לקבוע תור חדש מהיומן.`;
            }

            showMsg("התור בוטל / הסתיים", msg);
            deleteAlertShownRef.current = true;
          }

          lastReservationRef.current = null;
          return;
        }

        // ====== יש מסמך ======
        const data = { id: snap.id, ...snap.data() };
        lastReservationRef.current = data;
        setMyRes(data);

        const status = data?.status || null;
        const dateStr = data?.date || "";
        const hourStr = data?.hour || "";

        const whenParts = [];
        if (dateStr) whenParts.push(dateStr);
        if (hourStr) whenParts.push(hourStr);
        const whenText = whenParts.join(" • ");

        // ✅ הודעת אישור תור – פעם אחת בלבד
        if (status === "approved" && !data.approvedAlertShown) {
          const msg = whenText || "";

          if (Platform.OS === "web") {
            window.alert(`התור אושר ✅\n\n${msg}`);
            updateDoc(userResRef, { approvedAlertShown: true }).catch(
              (e) =>
                console.log("❌ update approvedAlertShown:", e?.message)
            );
          } else {
            Alert.alert("התור אושר ✅", msg, [
              {
                text: "אישור",
                onPress: () => {
                  updateDoc(userResRef, {
                    approvedAlertShown: true,
                  }).catch((e) =>
                    console.log(
                      "❌ update approvedAlertShown:",
                      e?.message
                    )
                  );
                },
              },
            ]);
          }
        }

        // ✅ הודעת ביטול ע"י בעלת העסק – פעם אחת בלבד
        if (
          (status === "cancelled_by_owner" || status === "cancelled") &&
          !data.cancelledAlertShown
        ) {
          const servicesArr = Array.isArray(data?.servicesSelected)
            ? data.servicesSelected
            : [];
          const serviceNames = servicesArr
            .map((s) => s?.name)
            .filter(Boolean);
          const serviceLabel =
            serviceNames.length > 0
              ? serviceNames.join(", ")
              : data?.serviceType || "";

          const whenParts2 = [];
          if (dateStr) whenParts2.push(dateStr);
          if (hourStr) whenParts2.push(hourStr);
          const whenText2 = whenParts2.join(" • ");

          let baseText = "";

          if (serviceLabel && whenText2) {
            baseText = `התור שלך ל${serviceLabel} בתאריך ${whenText2} בוטל ע"י בעלת העסק.`;
          } else if (whenText2) {
            baseText = `התור שלך בתאריך ${whenText2} בוטל ע"י בעלת העסק.`;
          } else if (serviceLabel) {
            baseText = `התור שלך ל${serviceLabel} בוטל ע"י בעלת העסק.`;
          } else {
            baseText = 'התור שלך בוטל ע"י בעלת העסק.';
          }

          const fullText = `${baseText}\n\nניתן לקבוע תור חדש מהיומן.`;

          if (Platform.OS === "web") {
            window.alert(fullText);
            updateDoc(userResRef, { cancelledAlertShown: true }).catch(
              (e) =>
                console.log(
                  "❌ update cancelledAlertShown:",
                  e?.message
                )
            );
          } else {
            Alert.alert("התור בוטל", fullText, [
              {
                text: "אישור",
                onPress: () => {
                  updateDoc(userResRef, {
                    cancelledAlertShown: true,
                  }).catch((e) =>
                    console.log(
                      "❌ update cancelledAlertShown:",
                      e?.message
                    )
                  );
                },
              },
            ]);
          }
        }
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

  // ✅ מאזין לרשימות המתנה שבהן המשתמש נמצא
  useEffect(() => {
    if (!userId) {
      setMyWaitlistEntries([]);
      return;
    }

    const qWait = query(
      collection(db, "waitlists"),
      where("userIds", "array-contains", userId)
    );

    const unsub = onSnapshot(
      qWait,
      (snap) => {
        const now = Date.now();
        const entries = [];

        snap.docs.forEach((d) => {
          const data = d.data() || {};
          const date = data.date || "";
          const hour = data.hour || "";

          if (!date || !hour) return;

          const dt = toLocalDateTime(date, hour);
          if (!dt) return;

          // מדלגים על שעות שעברו כבר
          if (dt.getTime() < now - 60 * 1000) {
            return;
          }

          const queue = Array.isArray(data.queue) ? data.queue : [];
          const idx = queue.findIndex((x) => x?.userId === userId);
          if (idx < 0) return;

          const position = idx + 1;
          const queueLength = queue.length;

          const hasHold =
            !!data.activeUserId &&
            !!data.holdExpiresAtMs &&
            data.holdExpiresAtMs > now;

          const holdForMe = hasHold && data.activeUserId === userId;

          entries.push({
            id: d.id,
            date,
            hour,
            position,
            queueLength,
            hasHold,
            holdForMe,
          });
        });

        // מיון לפי זמן
        entries.sort((a, b) => {
          const adt = toLocalDateTime(a.date, a.hour);
          const bdt = toLocalDateTime(b.date, b.hour);
          if (!adt || !bdt) return 0;
          return adt.getTime() - bdt.getTime();
        });

        setMyWaitlistEntries(entries);
      },
      (err) => {
        console.log(
          "❌ waitlists/user listen error:",
          err?.code,
          err?.message
        );
        setMyWaitlistEntries([]);
      }
    );

    return () => unsub();
  }, [userId]);

  // ✅ מאזין לכל התורים העתידיים של הלקוחה (pending/approved, רק isHead)
  useEffect(() => {
    if (!userId) {
      setMyFutureAppointments([]);
      return;
    }

    const qApps = query(
      collection(db, "appointments"),
      where("userId", "==", userId)
    );

    const unsub = onSnapshot(
      qApps,
      (snap) => {
        const now = Date.now();
        const arr = [];

        snap.docs.forEach((d) => {
          const data = d.data() || {};
          const date = data.date || "";
          const hour = data.hour || "";
          const status = data.status || "pending";

          if (!date || !hour) return;

          // רק תורים פעילים (pending / approved)
          if (status !== "pending" && status !== "approved") return;

          // רק השעה הראשונה של התור
          if (!data.isHead) return;

          const dt = toLocalDateTime(date, hour);
          if (!dt) return;

          // מדלגים על תורים שעברו
          if (dt.getTime() < now - 60 * 1000) return;

          arr.push({ id: d.id, ...data });
        });

        // מיון לפי זמן
        arr.sort((a, b) => {
          const adt = toLocalDateTime(a.date, a.hour);
          const bdt = toLocalDateTime(b.date, b.hour);
          if (!adt || !bdt) return 0;
          return adt.getTime() - bdt.getTime();
        });

        setMyFutureAppointments(arr);
      },
      (err) => {
        console.log(
          "❌ appointments/user listen error:",
          err?.code,
          err?.message
        );
        setMyFutureAppointments([]);
      }
    );

    return () => unsub();
  }, [userId]);

  // ✅ חלוקה לתורים מאושרים ותורים שממתינים לאישור
  const approvedFutureAppointments = useMemo(
    () => myFutureAppointments.filter((a) => a.status === "approved"),
    [myFutureAppointments]
  );

  const pendingFutureAppointments = useMemo(
    () => myFutureAppointments.filter((a) => a.status === "pending"),
    [myFutureAppointments]
  );

  async function handleLogout() {
    try {
      await signOut(auth);
    } catch (e) {
      showMsg("שגיאה", e?.message || "לא הצליח להתנתק");
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

  // ✅ תור פעיל בלבד – *שלא עבר* בזמן
  const activeRes = useMemo(() => {
    if (!myRes) return null;
    if (isReservationPassed(myRes)) return null;

    return myRes.status === "pending" || myRes.status === "approved"
      ? myRes
      : null;
  }, [myRes]);

  // ✅ ביטול תור על ידי הלקוחה (התור הראשי מ-userReservations)
  async function cancelMyReservationFromCalendar() {
    if (!userId) {
      showMsg("שגיאה", "את חייבת להיות מחוברת");
      return;
    }
    if (!activeRes) {
      showMsg("שגיאה", "אין תור פעיל לביטול");
      return;
    }

    const userResRef = doc(db, "userReservations", userId);

    try {
      const snap = await getDoc(userResRef);
      if (!snap.exists()) {
        showMsg("שגיאה", "אין תור פעיל לביטול");
        return;
      }

      const data = snap.data();

      if (isReservationPassed(data)) {
        showMsg("לא ניתן לבטל", "התור כבר עבר ולכן לא ניתן לבטל אותו.");
        return;
      }

      const date = data.date;
      if (!date) {
        showMsg("שגיאה", "חסר תאריך לתור");
        return;
      }

      const hoursArr =
        Array.isArray(data.slots) && data.slots.length
          ? data.slots
          : data.hour
          ? [data.hour]
          : [];

      if (!hoursArr.length) {
        showMsg("שגיאה", "לא נמצאו שעות לתור לביטול");
        return;
      }

      const groupId =
        data.groupId ||
        (data.appointmentId ||
          (data.date && data.hour
            ? makeAppointmentDocId(data.date, data.hour)
            : null));

      // 🔹 שלב 1 – מוחקים את המסמך של הלקוחה
      await deleteDoc(userResRef);
      deleteAlertShownRef.current = false;

      // 🔹 שלב 2 – מנסים לשחרר את הסלוטים ב-appointments
      try {
        const batch = writeBatch(db);
        hoursArr.forEach((h) => {
          const appRef = doc(
            db,
            "appointments",
            makeAppointmentDocId(date, h)
          );
          batch.delete(appRef);
        });
        await batch.commit();
      } catch (e) {
        console.log(
          "⚠️ לא הצלחתי למחוק מה-appointments (כנראה בעיית הרשאות):",
          e?.code,
          e?.message
        );
      }

      // 🔹 שלב 3 – נסמן בקשות ממתינות כ-cancelled
      if (groupId) {
        try {
          const qReq = query(
            collection(db, "appointmentRequests"),
            where("userId", "==", userId),
            where("groupId", "==", groupId),
            where("status", "==", "pending")
          );

          const snapReq = await getDocs(qReq);
          if (!snapReq.empty) {
            const batch = writeBatch(db);
            snapReq.forEach((docSnap) => {
              batch.update(docSnap.ref, {
                status: "cancelled",
                cancelledAt: serverTimestamp(),
                cancelledBy: userId,
              });
            });
            await batch.commit();
          }
        } catch (e) {
          console.log(
            "⚠️ cleanup appointmentRequests after cancel:",
            e?.code,
            e?.message
          );
        }
      }

      showMsg("בוטל", "התור בוטל בהצלחה");
    } catch (e) {
      console.log(
        "❌ cancelMyReservationFromCalendar error:",
        e?.code,
        e?.message
      );
      showMsg("שגיאה", e?.message || "לא הצליח לבטל תור");
    }
  }

  // ✅ ביטול תור מתוך רשימת "תורים שמחכים לאישור"
  async function cancelPendingAppointment(app) {
    if (!userId || !app) {
      showMsg("שגיאה", "לא נמצא תור לביטול");
      return;
    }

    try {
      const date = app.date;
      const hour = app.hour;

      if (!date) {
        showMsg("שגיאה", "חסר תאריך לתור לביטול");
        return;
      }

      const hoursArr =
        Array.isArray(app.slots) && app.slots.length
          ? app.slots
          : hour
          ? [hour]
          : [];

      if (!hoursArr.length) {
        showMsg("שגיאה", "לא נמצאו שעות לתור לביטול");
        return;
      }

      const groupId =
        app.groupId ||
        (app.appointmentId ||
          (date && hour ? makeAppointmentDocId(date, hour) : null));

      // 🔹 שלב 1 – מנסים למחוק את הסלוטים מ-appointments
      try {
        const batch = writeBatch(db);
        hoursArr.forEach((h) => {
          const appRef = doc(
            db,
            "appointments",
            makeAppointmentDocId(date, h)
          );
          batch.delete(appRef);
        });
        await batch.commit();
      } catch (e) {
        console.log(
          "⚠️ cancelPendingAppointment: לא הצלחתי למחוק מה-appointments:",
          e?.code,
          e?.message
        );
      }

      // 🔹 שלב 2 – מסמנים בקשות ממתינות כ-cancelled
      if (groupId) {
        try {
          const qReq = query(
            collection(db, "appointmentRequests"),
            where("userId", "==", userId),
            where("groupId", "==", groupId),
            where("status", "==", "pending")
          );
          const snapReq = await getDocs(qReq);
          if (!snapReq.empty) {
            const batch = writeBatch(db);
            snapReq.forEach((docSnap) => {
              batch.update(docSnap.ref, {
                status: "cancelled",
                cancelledAt: serverTimestamp(),
                cancelledBy: userId,
              });
            });
            await batch.commit();
          }
        } catch (e) {
          console.log(
            "⚠️ cancelPendingAppointment: cleanup appointmentRequests:",
            e?.code,
            e?.message
          );
        }
      }

      // 🔹 שלב 3 – אם userReservations תואם לבקשה הזו, נמחק אותו גם
      try {
        const userResRef = doc(db, "userReservations", userId);
        const userResSnap = await getDoc(userResRef);
        if (userResSnap.exists()) {
          const r = userResSnap.data() || {};
          const rGroupId =
            r.groupId ||
            (r.appointmentId ||
              (r.date && r.hour
                ? makeAppointmentDocId(r.date, r.hour)
                : null));

          const isSameGroup =
            (groupId && rGroupId && groupId === rGroupId) ||
            (r.date === date && r.hour === hour);

          if (isSameGroup && r.status === "pending") {
            await deleteDoc(userResRef);
            deleteAlertShownRef.current = false;
          }
        }
      } catch (e) {
        console.log(
          "⚠️ cancelPendingAppointment: userReservations cleanup:",
          e?.code,
          e?.message
        );
      }

      showMsg("בוטל", "הבקשה לתור בוטלה בהצלחה.");
    } catch (e) {
      console.log(
        "❌ cancelPendingAppointment error:",
        e?.code,
        e?.message
      );
      showMsg("שגיאה", e?.message || "לא הצליח לבטל את הבקשה לתור");
    }
  }

  // ✅ ביטול מהרשמת מתנה מתוך היומן
  async function cancelWaitlistEntry(entry) {
    if (!userId || !entry) {
      showMsg("שגיאה", "לא נמצאה רשימת מתנה לביטול");
      return;
    }

    const waitRef = doc(db, "waitlists", entry.id);

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(waitRef);
        if (!snap.exists()) return;

        const data = snap.data() || {};
        const queue = Array.isArray(data.queue) ? data.queue : [];
        const userIds = Array.isArray(data.userIds) ? data.userIds : [];
        const activeUserId = data.activeUserId || null;

        const newQueue = queue.filter((x) => x?.userId !== userId);
        const newUserIds = userIds.filter((id) => id !== userId);

        if (!newQueue.length) {
          tx.delete(waitRef);
          return;
        }

        const updates = {
          queue: newQueue,
          userIds: newUserIds,
        };

        if (activeUserId === userId) {
          updates.activeUserId = null;
          updates.holdExpiresAtMs = null;
        }

        tx.update(waitRef, updates);
      });

      try {
        await ensureHoldIfNeeded(entry.date, entry.hour);
      } catch (e) {
        console.log(
          "⚠️ ensureHoldIfNeeded after waitlist cancel error:",
          e?.message
        );
      }

      showMsg("בוצע", "הוסרת מרשימת ההמתנה לשעה הזאת.");
    } catch (e) {
      console.log("❌ cancelWaitlistEntry error:", e);
      showMsg("שגיאה", e?.message || "לא הצליח לעדכן רשימת המתנה");
    }
  }

  // ✅ markedDates – היום שנבחר + כל התאריכים עם תור עתידי (ששריינו)
  const markedDates = useMemo(() => {
    const out = {};

    // היום שהמשתמש בחר – עיגול
    if (selectedDate) {
      out[selectedDate] = {
        ...(out[selectedDate] || {}),
        selected: true,
        selectedColor: colors.primary,
      };
    }

    // כל התאריכים שיש בהם תור עתידי שהלקוח שריין (שעה ראשית isHead)
    myFutureAppointments.forEach((app) => {
      if (!app.date) return;
      out[app.date] = {
        ...(out[app.date] || {}),
        marked: true,
        dotColor: colors.secondary,
      };
    });

    // אם יש activeRes (מהמסמך userReservations) – נשמור גם עליו את הנקודה
    if (activeRes?.date) {
      out[activeRes.date] = {
        ...(out[activeRes.date] || {}),
        marked: true,
        dotColor: colors.secondary,
      };
    }

    return out;
  }, [myFutureAppointments, activeRes, selectedDate]);

  const MenuItem = ({ text, danger, onPress }) => (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: rf(12),
        paddingHorizontal: rf(14),
        borderRadius: rf(12),
        borderWidth: 1,
        borderColor: danger ? "#D6455D" : colors.border,
        backgroundColor: "#fff",
        marginTop: rf(10),
        alignItems: "center",
      }}
    >
      <Text
        style={{
          fontWeight: "900",
          color: danger ? "#D6455D" : colors.textDark,
          fontSize: rf(15),
          flexWrap: "wrap",
          textAlign: "center",
        }}
      >
        {text}
      </Text>
    </Pressable>
  );

  const passed = activeRes ? isReservationPassed(activeRes) : false;
  const niceService = activeRes?.serviceType
    ? ` (${activeRes.serviceType})`
    : "";

  const statusLabel =
    activeRes?.status === "approved"
      ? "מאושר ✅"
      : activeRes?.status === "pending"
      ? "ממתין לאישור ⏳"
      : activeRes?.status || "—";

  // 💡 עד ש-backgroundAllAppUrl לא נטען – לא מציגים רקע ישן
  if (backgroundAllAppUrl === undefined) {
    return (
      <View
        style={[
          styles.bg,
          {
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "#fff",
          },
        ]}
      >
        <ActivityIndicator />
      </View>
    );
  }

  const bgSource = backgroundAllAppUrl
    ? { uri: normalizeImgUri(backgroundAllAppUrl, bgUpdatedAt) }
    : BG_FALLBACK;

  return (
    <ImageBackground source={bgSource} style={styles.bg} resizeMode="cover">
      {/* שכבת לבן שקוף מעל הרקע (כמו במסך הבית) */}
      <View style={styles.overlay}>
        {/* שימי לב: אין כאן View עוטף עם רקע, רק ScrollView על התמונה */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1, backgroundColor: "transparent" }}
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: rf(24),
          }}
        >
          {/* Header */}
          <View
            style={{
              marginBottom: rf(20),
              paddingVertical: rf(16),
              paddingHorizontal: rf(14),
              backgroundColor: "rgba(255,255,255,0.92)",
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
                backgroundColor: "rgba(255,255,255,0.95)",
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
          </View>

          {/* Calendar */}
          <View
            style={{
              backgroundColor: "rgba(255,255,255,0.9)",
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
                // ✅ קודם לסמן את היום שנלחץ (עיגול)
                setSelectedDate(day.dateString);

                if (!hasAcceptedLatestTerms) {
                  const msg =
                    "לפני קביעת תור במערכת חובה לקרוא ולאשר את התקנון במסך התקנון.";

                  if (Platform.OS === "web") {
                    window.alert(msg);
                    navigation.navigate("Terms");
                  } else {
                    Alert.alert("נדרש אישור תקנון", msg, [
                      {
                        text: "מעבר לתקנון",
                        onPress: () => navigation.navigate("Terms"),
                      },
                    ]);
                  }
                  return;
                }

                navigation.navigate("Day", {
                  selectedDate: day.dateString,
                  date: day.dateString,
                  requireApproval: true,
                });
              }}
              style={{ borderRadius: rf(12), backgroundColor: "transparent" }}
              hideArrows={false}
              renderArrow={(direction) => (
                <Text
                  style={{
                    fontSize: rf(20),
                    color: colors.primary,
                    fontWeight: "900",
                    paddingHorizontal: 4,
                  }}
                >
                  {direction === "left" ? "‹" : "›"}
                </Text>
              )}
              theme={{
                calendarBackground: "transparent",
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

          {/* My Reservation (תקציר תור אחד – כמו שהיה) */}
          <View
            style={{
              marginTop: rf(12),
              backgroundColor: "rgba(255,255,255,0.9)",
              borderRadius: rf(14),
              borderWidth: 1,
              borderColor: colors.border,
              paddingVertical: rf(12),
              paddingHorizontal: rf(12),
            }}
          >
            {/* כותרת + קו תחתון */}
            <View
              style={{
                paddingBottom: rf(8),
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
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
            </View>

            {!activeRes ? (
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
                  {activeRes.date} • {activeRes.hour} {niceService}
                </Text>

                <Text
                  style={{
                    marginTop: 6,
                    textAlign: "center",
                    fontWeight: "900",
                    color:
                      activeRes.status === "approved" ? "#4CAF50" : "#F5A623",
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
                    onPress={() => {
                      if (!hasAcceptedLatestTerms) {
                        const msg =
                          "לפני קביעת תור חדש או שינוי תור יש לאשר את התקנון המעודכן במסך התקנון.";

                        if (Platform.OS === "web") {
                          const go = window.confirm(
                            `${msg}\n\nלעבור למסך התקנון עכשיו?`
                          );
                          if (go) {
                            navigation.navigate("Terms");
                          }
                        } else {
                          Alert.alert("נדרש אישור תקנון", msg, [
                            { text: "ביטול", style: "cancel" },
                            {
                              text: "מעבר לתקנון",
                              onPress: () => navigation.navigate("Terms"),
                            },
                          ]);
                        }
                        return;
                      }

                      navigation.navigate("Day", {
                        selectedDate: activeRes.date,
                        date: activeRes.date,
                        requireApproval: true,
                      });
                    }}
                    style={{
                      flex: 1,
                      backgroundColor: "rgba(255,255,255,0.95)",
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
                        backgroundColor: "rgba(255,255,255,0.95)",
                        borderRadius: rf(12),
                        borderWidth: 1,
                        borderColor: "#D6455D",
                        paddingVertical: rf(10),
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          color: "#D6455D",
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

          {/* בלוק: תורים מאושרים */}
          {approvedFutureAppointments.length > 0 && (
            <View
              style={{
                marginTop: rf(12),
                backgroundColor: "rgba(255,255,255,0.9)",
                borderRadius: rf(14),
                borderWidth: 1,
                borderColor: colors.border,
                paddingVertical: rf(12),
                paddingHorizontal: rf(12),
              }}
            >
              <View
                style={{
                  paddingBottom: rf(8),
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
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
                  תורים מאושרים
                </Text>
              </View>

              <View style={{ marginTop: rf(6) }}>
                {approvedFutureAppointments.map((app, index) => (
                  <View
                    key={app.id}
                    style={{
                      marginTop: index === 0 ? rf(4) : rf(8),
                      paddingVertical: rf(6),
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderTopColor: colors.border,
                    }}
                  >
                    <Text
                      style={{
                        textAlign: "center",
                        fontWeight: "900",
                        fontSize: rf(16),
                        color: colors.textDark,
                      }}
                    >
                      {app.date} • {app.hour}
                    </Text>

                    <Text
                      style={{
                        marginTop: rf(3),
                        textAlign: "center",
                        fontWeight: "700",
                        fontSize: rf(13),
                        color: "#4CAF50",
                      }}
                    >
                      סטטוס: מאושר ✅
                    </Text>

                    <View
                      style={{
                        flexDirection: "row",
                        gap: rf(10),
                        marginTop: rf(8),
                      }}
                    >
                      <Pressable
                        onPress={() => {
                          navigation.navigate("Day", {
                            selectedDate: app.date,
                            date: app.date,
                            requireApproval: true,
                          });
                        }}
                        style={{
                          flex: 1,
                          backgroundColor: "rgba(255,255,255,0.95)",
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

                      {/* ביטול תור ספציפי נעשה מתוך מסך היום עצמו */}
                      <View style={{ flex: 1 }} />
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* בלוק: תורים שממתינים לאישור */}
          {pendingFutureAppointments.length > 0 && (
            <View
              style={{
                marginTop: rf(12),
                backgroundColor: "rgba(255,255,255,0.9)",
                borderRadius: rf(14),
                borderWidth: 1,
                borderColor: colors.border,
                paddingVertical: rf(12),
                paddingHorizontal: rf(12),
              }}
            >
              <View
                style={{
                  paddingBottom: rf(8),
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
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
                  תורים שמחכים לאישור
                </Text>
              </View>

              <View style={{ marginTop: rf(6) }}>
                {pendingFutureAppointments.map((app, index) => (
                  <View
                    key={app.id}
                    style={{
                      marginTop: index === 0 ? rf(4) : rf(8),
                      paddingVertical: rf(6),
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderTopColor: colors.border,
                    }}
                  >
                    <Text
                      style={{
                        textAlign: "center",
                        fontWeight: "900",
                        fontSize: rf(16),
                        color: colors.textDark,
                      }}
                    >
                      {app.date} • {app.hour}
                    </Text>

                    <Text
                      style={{
                        marginTop: rf(3),
                        textAlign: "center",
                        fontWeight: "700",
                        fontSize: rf(13),
                        color: "#F5A623",
                      }}
                    >
                      סטטוס: ממתין לאישור ⏳
                    </Text>

                    <View
                      style={{
                        flexDirection: "row",
                        gap: rf(10),
                        marginTop: rf(8),
                      }}
                    >
                      <Pressable
                        onPress={() => {
                          navigation.navigate("Day", {
                            selectedDate: app.date,
                            date: app.date,
                            requireApproval: true,
                          });
                        }}
                        style={{
                          flex: 1,
                          backgroundColor: "rgba(255,255,255,0.95)",
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

                      {/* 👉 כפתור ביטול בקשה – עם אישור ואז ביטול בפיירסטור */}
                      <Pressable
                        onPress={() => {
                          if (Platform.OS === "web") {
                            const ok = window.confirm(
                              "לבטל את הבקשה לתור הזה?"
                            );
                            if (ok) cancelPendingAppointment(app);
                            return;
                          }

                          Alert.alert(
                            "ביטול בקשה",
                            "לבטל את הבקשה לתור הזה?",
                            [
                              { text: "לא", style: "cancel" },
                              {
                                text: "כן",
                                style: "destructive",
                                onPress: () => cancelPendingAppointment(app),
                              },
                            ]
                          );
                        }}
                        style={{
                          flex: 1,
                          backgroundColor: "rgba(255,255,255,0.95)",
                          borderRadius: rf(12),
                          borderWidth: 1,
                          borderColor: "#D6455D",
                          paddingVertical: rf(10),
                          alignItems: "center",
                        }}
                      >
                        <Text
                          style={{
                            color: "#D6455D",
                            fontWeight: "900",
                            fontSize: rf(14),
                          }}
                        >
                          ביטול בקשה
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* בלוק: רשימות המתנה */}
          {myWaitlistEntries.length > 0 && (
            <View
              style={{
                marginTop: rf(12),
                backgroundColor: "rgba(255,255,255,0.9)",
                borderRadius: rf(14),
                borderWidth: 1,
                borderColor: colors.border,
                paddingVertical: rf(12),
                paddingHorizontal: rf(12),
              }}
            >
              <View
                style={{
                  paddingBottom: rf(8),
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
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
                  רשימות המתנה
                </Text>
              </View>

              <View style={{ marginTop: rf(6) }}>
                {myWaitlistEntries.map((w, index) => (
                  <View
                    key={w.id}
                    style={{
                      marginTop: index === 0 ? rf(4) : rf(8),
                      paddingVertical: rf(6),
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderTopColor: colors.border,
                    }}
                  >
                    <Text
                      style={{
                        textAlign: "center",
                        fontWeight: "900",
                        fontSize: rf(16),
                        color: colors.textDark,
                      }}
                    >
                      {w.date} • {w.hour}
                    </Text>

                    <Text
                      style={{
                        marginTop: rf(3),
                        textAlign: "center",
                        fontWeight: "700",
                        fontSize: rf(13),
                        color: "#555",
                      }}
                    >
                      {`המיקום שלך בתור הוא ${w.position}`}
                    </Text>

                    {w.holdForMe && (
                      <Text
                        style={{
                          marginTop: rf(2),
                          textAlign: "center",
                          fontWeight: "700",
                          fontSize: rf(13),
                          color: "#4CAF50",
                        }}
                      >
                        יש לך כרגע זכות ראשונים על השעה הזאת 🕒
                      </Text>
                    )}

                    <View
                      style={{
                        flexDirection: "row",
                        gap: rf(10),
                        marginTop: rf(8),
                      }}
                    >
                      <Pressable
                        onPress={() => {
                          navigation.navigate("Day", {
                            selectedDate: w.date,
                            date: w.date,
                            requireApproval: true,
                          });
                        }}
                        style={{
                          flex: 1,
                          backgroundColor: "rgba(255,255,255,0.95)",
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

                      <Pressable
                        onPress={() => {
                          if (Platform.OS === "web") {
                            const ok = window.confirm(
                              "להסיר אותך מרשימת ההמתנה לשעה הזו?"
                            );
                            if (ok) cancelWaitlistEntry(w);
                            return;
                          }

                          Alert.alert(
                            "ביטול רשימת המתנה",
                            "להסיר אותך מרשימת ההמתנה לשעה הזו?",
                            [
                              { text: "לא", style: "cancel" },
                              {
                                text: "כן",
                                style: "destructive",
                                onPress: () => cancelWaitlistEntry(w),
                              },
                            ]
                          );
                        }}
                        style={{
                          flex: 1,
                          backgroundColor: "rgba(255,255,255,0.95)",
                          borderRadius: rf(12),
                          borderWidth: 1,
                          borderColor: "#D6455D",
                          paddingVertical: rf(10),
                          alignItems: "center",
                        }}
                      >
                        <Text
                          style={{
                            color: "#D6455D",
                            fontWeight: "900",
                            fontSize: rf(14),
                          }}
                        >
                          ביטול מהרשימה
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}
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

              <MenuItem
                text="עמוד הבית של העסק"
                onPress={() => {
                  setMenuOpen(false);
                  navigation.navigate("BusinessHome");
                }}
              />

              <MenuItem
                text="תקנון"
                onPress={() => {
                  setMenuOpen(false);
                  navigation.navigate("Terms");
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
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.5)", // שכבה לבנה שקופה מעל הרקע
  },
});