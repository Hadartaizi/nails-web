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
  setDoc,
} from "firebase/firestore";

import { signOut } from "firebase/auth";
import globalStyles from "../styles/global";
import colors from "../styles/colors";
import { auth, db } from "../firebaseConfig";
import {
  sendAppointmentEmail,
  sendAppointmentRejectedEmail,
  sendAppointmentCancelledEmail,
  sendWaitlistHoldEmail,
} from "../emailReminder";

import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

function showAlert(title, message, buttons) {
  if (Platform.OS === "web") {
    if (Array.isArray(buttons) && buttons.length) {
      const cancelBtn = buttons.find((b) => b.style === "cancel") || null;
      const okBtn =
        buttons.find((b) => b.style !== "cancel") || buttons[0];

      const confirmed = window.confirm(`${title}\n\n${message}`);

      if (confirmed) {
        okBtn?.onPress && okBtn.onPress();
      } else {
        cancelBtn?.onPress && cancelBtn.onPress();
      }
    } else {
      window.alert(`${title}\n\n${message}`);
    }
    return;
  }

  Alert.alert(title, message, buttons);
}

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

// ====== WAITLIST (רשימת המתנה) ======
const WAITLIST_COLLECTION = "waitlists";
const HOLD_MINUTES = 30;

function makeWaitlistDocId(date, hour) {
  const safeHour = (hour || "").replace(":", "-");
  return `${date}_${safeHour}`;
}

export async function ensureHoldIfNeeded(dateStr, hourStr) {
  const hour = normalizeHour(hourStr);
  if (!dateStr || !hour) return;

  const waitRef = doc(
    db,
    WAITLIST_COLLECTION,
    makeWaitlistDocId(dateStr, hour)
  );
  const appointmentRef = doc(
    db,
    "appointments",
    makeAppointmentDocId(dateStr, hour)
  );

  const nowMs = Date.now();
  const holdMs = HOLD_MINUTES * 60 * 1000;

  const notifyInfo = await runTransaction(db, async (tx) => {
    const appSnap = await tx.get(appointmentRef);
    const waitSnap = await tx.get(waitRef);

    if (!waitSnap.exists()) {
      console.log("ensureHoldIfNeeded: no waitlist doc – exit");
      return null;
    }

    let data = waitSnap.data() || {};
    let queue = Array.isArray(data.queue) ? data.queue : [];
    let userIds = Array.isArray(data.userIds) ? data.userIds : [];
    let activeUserId = data.activeUserId || null;
    let holdExpiresAtMs = Number(data.holdExpiresAtMs || 0);

    queue = queue.filter((x) => x && x.userId);
    userIds = userIds.filter((id) => queue.some((x) => x.userId === id));

    if (!queue.length) {
      console.log("ensureHoldIfNeeded: empty queue – deleting doc");
      tx.delete(waitRef);
      return null;
    }

    if (appSnap.exists()) {
      console.log("ensureHoldIfNeeded: appointment already exists – exit");
      return null;
    }

    if (activeUserId && holdExpiresAtMs > 0 && holdExpiresAtMs <= nowMs) {
      console.log(
        "ensureHoldIfNeeded: HOLD expired for",
        activeUserId,
        "– removing from queue"
      );
      queue = queue.filter((x) => x.userId !== activeUserId);
      userIds = userIds.filter((id) => id !== activeUserId);
      activeUserId = null;
      holdExpiresAtMs = 0;
    }

    if (!queue.length) {
      console.log(
        "ensureHoldIfNeeded: queue became empty after cleaning – deleting doc"
      );
      tx.delete(waitRef);
      return null;
    }

    const hasHold = !!activeUserId && holdExpiresAtMs > nowMs;
    if (hasHold) {
      console.log("ensureHoldIfNeeded: already has active hold – exit");
      return null;
    }

    const next = queue[0];
    if (!next?.userId) {
      console.log("ensureHoldIfNeeded: first in queue has no userId – exit");
      return null;
    }

    activeUserId = next.userId;
    holdExpiresAtMs = nowMs + holdMs;

    tx.update(waitRef, {
      queue,
      userIds,
      activeUserId,
      holdExpiresAtMs,
    });

    console.log("ensureHoldIfNeeded: created HOLD for", next.userId);

    return {
      userId: next.userId,
      date: dateStr,
      hour,
      userEmail: next.userEmail || "",
      userName: next.userName || "לקוחה",
    };
  });

  if (!notifyInfo) {
    console.log("ensureHoldIfNeeded: no notifyInfo – skip email");
    return;
  }

  try {
    const waitRef = doc(
      db,
      WAITLIST_COLLECTION,
      makeWaitlistDocId(notifyInfo.date, notifyInfo.hour)
    );

    let toEmail = notifyInfo.userEmail;
    let clientName = notifyInfo.userName;

    if (!toEmail) {
      const userSnap = await getDoc(doc(db, "users", notifyInfo.userId));
      if (userSnap.exists()) {
        const u = userSnap.data();
        toEmail = u.email || "";
        const fullName = `${u.firstName || ""} ${u.lastName || ""}`.trim();
        if (fullName) clientName = fullName;
      }
    }

    if (!toEmail) {
      console.log(
        "ensureHoldIfNeeded: user has no email, removing from queue and trying next"
      );

      await runTransaction(db, async (tx) => {
        const snap = await tx.get(waitRef);
        if (!snap.exists()) return;

        const data = snap.data() || {};
        let queue = Array.isArray(data.queue) ? data.queue : [];
        let userIds = Array.isArray(data.userIds) ? data.userIds : [];

        queue = queue.filter((x) => x && x.userId !== notifyInfo.userId);
        userIds = userIds.filter((id) => id !== notifyInfo.userId);

        if (!queue.length) {
          tx.delete(waitRef);
          return;
        }

        tx.update(waitRef, {
          queue,
          userIds,
          activeUserId: null,
          holdExpiresAtMs: 0,
        });
      });

      await ensureHoldIfNeeded(notifyInfo.date, notifyInfo.hour);
      return;
    }

    console.log(
      "ensureHoldIfNeeded: sending waitlist_hold email to",
      toEmail
    );

    await sendWaitlistHoldEmail({
      toEmail,
      clientName,
      date: notifyInfo.date,
      time: notifyInfo.hour,
      businessName: "Rotem Studio Nails",
    });
  } catch (e) {
    console.log("❌ ensureHoldIfNeeded email send error:", e);
  }
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

function formatServices(appOrReq) {
  const arr = Array.isArray(appOrReq?.servicesSelected)
    ? appOrReq.servicesSelected
    : [];
  const names = arr.map((s) => s?.name).filter(Boolean);

  const total = Number(appOrReq?.totalDurationMin || 0);

  const servicesText = names.length
    ? names.join(", ")
    : appOrReq?.serviceType || null;

  let totalText = null;
  if (total > 0) {
    if (total >= 60) {
      const h = Math.floor(total / 60);
      const m = total % 60;
      totalText = `${h}:${String(m).padStart(2, "0")} שעות`;
    } else {
      totalText = `${total} דק׳`;
    }
  }

  return { servicesText, totalText };
}

const DEFAULT_TERMS_TEXT = `
בביצוע שריון תור במערכת, הינך מאשרת ומצהירה כי קראת והסכמת לתנאים הבאים:

1. איחורים וביטולים
- במידה ואת מאחרת – חובה להודיע מראש.
- איחור מתקבל עד רבע שעה מתחילת התור, לאחר מכן ייחשב כביטול תור ויגרור דמי ביטול.
- ביטולים יידרשו בהתראה מוקדמת של כ-24 שעות ממועד התור.
- ביטול שלא יעשה בזמן התואם יגרור דמי ביטול של 50% מעלות התור המיועד.
- ללא הסדר תשלום על דמי הביטול – לא ייקבע תור נוסף.

2. הודעה מראש
- במידה ונשברה לך ציפורן או יותר, חובה לעדכן אותי מראש.
- אם הגעת עם יותר מ־4/5 ציפורניים שבורות ללא הודעה מראש – ייתכן שנאלץ להוריד את הכל.

3. מצב רפואי
האחריות לעדכן על רגישויות חלה על הלקוחה בלבד.

4. שימוש במערכת
המערכת מיועדת לניהול תורים בלבד.

5. עדכון התקנון
התנאים עשויים להשתנות מעת לעת.
`.trim();

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

  const [defaultHours, setDefaultHours] = useState([
    "15:00",
    "16:00",
    "17:00",
    "18:00",
    "19:00",
  ]);
  const [defaultText, setDefaultText] = useState(defaultHours.join("\n"));
  const [defaultModalOpen, setDefaultModalOpen] = useState(false);

  const [availabilityExists, setAvailabilityExists] = useState(false);
  const [availabilityHours, setAvailabilityHours] = useState([]);
  const [availabilityText, setAvailabilityText] = useState("");
  const [availabilityModalOpen, setAvailabilityModalOpen] = useState(false);

  const [requests, setRequests] = useState([]);

  const [appointments, setAppointments] = useState([]);
  const [usersMap, setUsersMap] = useState({});

  const [busyFromApps, setBusyFromApps] = useState({});
  const [busyFromReqs, setBusyFromReqs] = useState({});

  const [manualHour, setManualHour] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualService, setManualService] = useState("");
  const [manualModalOpen, setManualModalOpen] = useState(false);

  const [services, setServices] = useState([]);
  const [servicesInitial, setServicesInitial] = useState([]);
  const [servicesModalOpen, setServicesModalOpen] = useState(false);

  const phoneAccessoryId = "phoneAccessoryId";
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const [showUsers, setShowUsers] = useState(false);
  const [allUsers, setAllUsers] = useState([]);
  const [usersSearch, setUsersSearch] = useState("");

  const [menuOpen, setMenuOpen] = useState(false);

  const [termsModalOpen, setTermsModalOpen] = useState(false);
  const [termsText, setTermsText] = useState(DEFAULT_TERMS_TEXT);
  const [termsVersion, setTermsVersion] = useState(1);

  const [backgroundsModalOpen, setBackgroundsModalOpen] = useState(false);
  const [backgroundAllAppUrl, setBackgroundAllAppUrl] = useState("");
  const [backgroundOpenRegisAppUrl, setBackgroundOpenRegisAppUrl] =
    useState("");

  const [backgroundUploading, setBackgroundUploading] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboardVisible(true)
    );
    const hideSub = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardVisible(false)
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  async function handleLogout() {
    try {
      await signOut(auth);
    } catch (e) {
      showAlert("שגיאה", e?.message || "לא הצליח להתנתק");
    }
  }

  function confirmLogout() {
    if (Platform.OS === "web") {
      const ok = window.confirm("בטוחה שתרצי להתנתק?");
      if (ok) handleLogout();
      return;
    }
    showAlert("התנתקות", "בטוחה שתרצי להתנתק?", [
      { text: "ביטול", style: "cancel" },
      { text: "התנתק", style: "destructive", onPress: handleLogout },
    ]);
  }

  // settings/business listener
  useEffect(() => {
    const ref = doc(db, "settings", "business");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const fallbackHours = [
          "15:00",
          "16:00",
          "17:00",
          "18:00",
          "19:00",
        ];
        const fallbackServices = [
          { id: "manicure", name: "מניקור", durationMin: 50 },
          {
            id: "anatomical_structure_short",
            name: "מבנה אנטומי לציפורניים קצרות",
            durationMin: 180,
          },
          {
            id: "gel_refill_long",
            name: "מילוי ג׳ל לציפורניים ארוכות",
            durationMin: 210,
          },
          { id: "tips_refill", name: "מילוי בטיפסים", durationMin: 60 },
          { id: "gel_build", name: "בניה חדשה", durationMin: 240 },
          { id: "nail_repair", name: "השלמת ציפורן", durationMin: 20 },
          { id: "crack_treatment", name: "טיפול בסדק", durationMin: 10 },
        ];

        if (!snap.exists()) {
          setDefaultHours(fallbackHours);
          setDefaultText(fallbackHours.join("\n"));
          setServices(fallbackServices);
          setBackgroundAllAppUrl("");
          setBackgroundOpenRegisAppUrl("");
          return;
        }

        const data = snap.data() || {};

        const arr = data.defaultHours || [];
        const safeHours =
          Array.isArray(arr) && arr.length ? arr : fallbackHours;
        safeHours.sort((a, b) => timeToMin(a) - timeToMin(b));
        setDefaultHours(safeHours);
        setDefaultText(safeHours.join("\n"));

        const srv = Array.isArray(data.services) ? data.services : [];
        if (srv.length) {
          const mapped = srv.map((s, idx) => ({
            id: String(s.id ?? `service_${idx}`),
            name: String(s.name ?? ""),
            durationMin:
              s.durationMin != null ? String(s.durationMin) : "",
          }));
          setServices(mapped);
          setServicesInitial(mapped);
        } else {
          const mappedFallback = fallbackServices.map((s) => ({
            ...s,
            durationMin: String(s.durationMin),
          }));
          setServices(mappedFallback);
          setServicesInitial(mappedFallback);
        }

        const bgAll =
          typeof data.backgroundAllAppUrl === "string"
            ? data.backgroundAllAppUrl
            : "";
        const bgOpen =
          typeof data.backgroundOpenRegisAppUrl === "string"
            ? data.backgroundOpenRegisAppUrl
            : "";

        setBackgroundAllAppUrl(bgAll);
        setBackgroundOpenRegisAppUrl(bgOpen);
      },
      (err) => {
        console.log(
          "❌ settings/business listen error:",
          err?.code,
          err?.message
        );
        const fallbackHours = [
          "15:00",
          "16:00",
          "17:00",
          "18:00",
          "19:00",
        ];
        const fallbackServices = [
          { id: "manicure", name: "מניקור", durationMin: "50" },
          { id: "gel", name: "ג׳ל", durationMin: "60" },
        ];
        setDefaultHours(fallbackHours);
        setDefaultText(fallbackHours.join("\n"));
        setServices(fallbackServices);
        setServicesInitial(fallbackServices);
        setBackgroundAllAppUrl("");
        setBackgroundOpenRegisAppUrl("");
      }
    );
    return () => unsub();
  }, []);

  // settings/terms listener
  useEffect(() => {
    const ref = doc(db, "settings", "terms");

    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setTermsText(DEFAULT_TERMS_TEXT);
        setTermsVersion(1);
        return;
      }

      const data = snap.data() || {};
      setTermsText((data.text || "").trim() || DEFAULT_TERMS_TEXT);
      setTermsVersion(data.version || 1);
    });

    return () => unsub();
  }, []);

  // availability override listener
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
        console.log(
          "❌ availability listen error:",
          err?.code,
          err?.message
        );
        setAvailabilityExists(false);
        setAvailabilityHours([]);
        setAvailabilityText("");
      }
    );
    return () => unsub();
  }, [selectedDate]);

  const hoursForSelectedDate = useMemo(() => {
    if (availabilityExists) return availabilityHours;
    return defaultHours;
  }, [availabilityExists, availabilityHours, defaultHours]);

  // pending requests for selected date
  useEffect(() => {
    if (showUsers) return;

    const qReq = query(
      collection(db, "appointmentRequests"),
      where("date", "==", selectedDate),
      where("status", "==", "pending")
    );

    const unsub = onSnapshot(
      qReq,
      (snap) => {
        const arr = snap.docs
          .map((d) => {
            const data = d.data() || {};
            const hour = normalizeHour(data.hour);

            return {
              id: d.id,
              ...data,
              hour,
            };
          })
          .filter((r) => !!r.hour)
          .sort((a, b) => timeToMin(a.hour) - timeToMin(b.hour));

        console.log(
          "📥 pending requests for",
          selectedDate,
          "=>",
          arr.length
        );

        setRequests(arr);
      },
      (err) => {
        console.log(
          "❌ appointmentRequests listen error:",
          err?.code,
          err?.message
        );
        showAlert(
          "שגיאה בטעינת בקשות ממתינות",
          err?.message || "לא הצליח לטעון בקשות. בדקי אינדקס/הרשאות."
        );
        setRequests([]);
      }
    );

    return () => unsub();
  }, [selectedDate, showUsers]);

  // ✅ תורים מאושרים לתאריך הנבחר
  // ✅ תורים מאושרים לתאריך הנבחר (מתוקן)
  useEffect(() => {
    if (showUsers) return;

    const qApps = query(
      collection(db, "appointments"),
      where("date", "==", selectedDate)
    );

    const unsub = onSnapshot(
      qApps,
      (snap) => {
        const arr = snap.docs
          .map((d) => {
            const data = d.data() || {};
            const hour = normalizeHour(data.hour);

            return {
              docId: d.id,
              ...data,
              hour,
            };
          })
          .filter((a) => {
            if (!a.hour) return false;

            const status = a.status || null;

            // סטטוסים שלא נחשבים לתור מאושר
            const isPendingOrCancelled =
              status === "pending" ||
              status === "cancelled" ||
              status === "rejected";

            // כל מה שלא pending / cancelled / rejected = נחשב מאושר
            const isApproved = !isPendingOrCancelled;

            // אם isHead לא קיים – נניח שהוא true כדי לא להפיל תורים ישנים
            const isHead =
              a.isHead === undefined ? true : a.isHead === true;

            return isApproved && isHead;
          })
          .sort((a, b) => timeToMin(a.hour) - timeToMin(b.hour));

        setAppointments(arr);
      },
      (err) => {
        console.log(
          "❌ approved appointments listen error:",
          err?.code,
          err?.message
        );
        showAlert(
          "שגיאה בטעינת תורים מאושרים",
          err?.message || "לא הצליח לטעון תורים מאושרים."
        );
        setAppointments([]);
      }
    );

    return () => unsub();
  }, [selectedDate, showUsers]);;

  // busy days maps
  useEffect(() => {
    if (showUsers) return;

    const appsRef = collection(db, "appointments");
    const unsubApps = onSnapshot(
      appsRef,
      (snap) => {
        const next = {};

        snap.docs.forEach((d) => {
          const data = d.data() || {};
          const status = data.status;
          const date = data.date;
          const hour = data.hour;

          if (
            status === "approved" &&
            date &&
            hour &&
            !isAppointmentPast(date, hour)
          ) {
            next[date] = true;
          }
        });

        setBusyFromApps(next);
      },
      (err) => {
        console.log(
          "❌ busy days appointments error:",
          err?.code,
          err?.message
        );
      }
    );

    const reqRef = collection(db, "appointmentRequests");
    const unsubReq = onSnapshot(
      reqRef,
      (snap) => {
        const next = {};

        snap.docs.forEach((d) => {
          const data = d.data() || {};
          const status = data.status;
          const date = data.date;

          if (status === "pending" && date) {
            next[date] = true;
          }
        });

        setBusyFromReqs(next);
      },
      (err) => {
        console.log(
          "❌ busy days requests error:",
          err?.code,
          err?.message
        );
      }
    );

    return () => {
      unsubApps();
      unsubReq();
    };
  }, [showUsers]);

  // load users for requests + appointments
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

  // live users list for "לקוחות פעילים"
  useEffect(() => {
    if (!showUsers) return;

    const qUsers = query(
      collection(db, "users"),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(
      qUsers,
      (snap) =>
        setAllUsers(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))),
      (err) => {
        console.log("❌ users list listen error:", err?.code, err?.message);
        showAlert("שגיאה", "לא הצליח לטעון לקוחות");
      }
    );
    return () => unsub();
  }, [showUsers]);

  const filteredUsers = useMemo(() => {
    const currentUid = auth.currentUser?.uid || null;

    const base = allUsers.filter((u) => u.uid !== currentUid);

    const t = (usersSearch || "").trim().toLowerCase();
    if (!t) return base;

    return base.filter((u) => {
      const name = `${u.firstName || ""} ${
        u.lastName || ""
      }`.toLowerCase();
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

  async function saveDefaultHours() {
    const hours = parseHoursText(defaultText);
    if (hours.length === 0) {
      showAlert("שגיאה", "לא זוהו שעות. לדוגמה: 15:00 ואז Enter");
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

      showAlert("בוצע", "ברירת המחדל נשמרה");
      setDefaultModalOpen(false);
      Keyboard.dismiss();
    } catch (e) {
      showAlert("שגיאה", e?.message || "לא הצליח לשמור ברירת מחדל");
    }
  }

  async function pickAndUploadBackground(kind) {
    if (!auth.currentUser?.uid) {
      showAlert(
        "צריך להתחבר",
        "כדי לשנות תמונת רקע צריך להתחבר."
      );
      return;
    }

    try {
      if (Platform.OS !== "web") {
        const { status } =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          showAlert("שגיאה", "צריך לאשר גישה לגלריה בהגדרות המכשיר.");
          return;
        }
      }

      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
        allowsEditing: true,
      });

      if (!res || res.canceled || !res.assets || !res.assets.length) {
        return;
      }

      const asset = res.assets[0];
      if (!asset.uri) {
        showAlert("שגיאה", "לא נמצאה כתובת לתמונה");
        return;
      }

      setBackgroundUploading(true);

      try {
        const manipulated = await ImageManipulator.manipulateAsync(
          asset.uri,
          [{ resize: { width: 900 } }],
          {
            compress: 0.7,
            format: ImageManipulator.SaveFormat.JPEG,
            base64: true,
          }
        );

        if (!manipulated?.base64) {
          showAlert("שגיאה", "לא הצליח לעבד את התמונה");
          return;
        }

        const dataUrl = `data:image/jpeg;base64,${manipulated.base64}`;

        await setDoc(
          doc(db, "settings", "business"),
          kind === "openRegis"
            ? { backgroundOpenRegisAppUrl: dataUrl }
            : { backgroundAllAppUrl: dataUrl },
          { merge: true }
        );

        if (kind === "openRegis") {
          setBackgroundOpenRegisAppUrl(dataUrl);
        } else {
          setBackgroundAllAppUrl(dataUrl);
        }

        showAlert("בוצע", "תמונת הרקע עודכנה בהצלחה");
      } finally {
        setBackgroundUploading(false);
      }
    } catch (e) {
      console.log("❌ pickAndUploadBackground error:", e);
      showAlert("שגיאה", e?.message || "לא הצליח להעלות תמונה");
      setBackgroundUploading(false);
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

      showAlert("בוצע", "השעות לתאריך נשמרו");
      setAvailabilityModalOpen(false);
      Keyboard.dismiss();
    } catch (e) {
      showAlert("שגיאה", e?.message || "לא הצליח לשמור שעות לתאריך");
    }
  }

  async function resetAvailabilityForDate() {
    try {
      await deleteDoc(doc(db, "availability", selectedDate));
      showAlert("בוצע", "התאריך אופס לברירת מחדל");
    } catch (e) {
      showAlert("שגיאה", e?.message || "לא הצליח לאפס תאריך");
    }
  }

  async function saveServices() {
    const cleaned = (services || [])
      .map((s, idx) => {
        const name = (s.name || "").trim();
        const minutes = parseInt(
          (s.durationMin || "").toString().trim(),
          10
        );
        return {
          id: (s.id || "").trim() || `service_${idx}`,
          name,
          durationMin:
            Number.isFinite(minutes) && minutes > 0 ? minutes : 0,
        };
      })
      .filter((s) => s.name && s.durationMin > 0);

    if (!cleaned.length) {
      showAlert(
        "שגיאה",
        "לפחות טיפול אחד חייב להיות עם שם וזמן גדול מ-0."
      );
      return;
    }

    const ref = doc(db, "settings", "business");

    try {
      await runTransaction(db, async (tx) => {
        tx.set(
          ref,
          {
            services: cleaned,
            servicesUpdatedAt: serverTimestamp(),
            servicesUpdatedBy: auth.currentUser?.uid || null,
          },
          { merge: true }
        );
      });

      const edited = cleaned.map((s, idx) => ({
        id: s.id || `service_${idx}`,
        name: s.name,
        durationMin: String(s.durationMin),
      }));

      setServices(edited);
      setServicesInitial(edited);

      showAlert("בוצע", "הטיפולים נשמרו בהצלחה");
      setServicesModalOpen(false);
      Keyboard.dismiss();
    } catch (e) {
      showAlert("שגיאה", e?.message || "לא הצליח לשמור טיפולים");
    }
  }

  async function saveTerms() {
    const text = (termsText || "").trim();
    if (!text) {
      showAlert("שגיאה", "התקנון לא יכול להיות ריק");
      return;
    }

    const ref = doc(db, "settings", "terms");

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const prevVersion = snap.exists() ? snap.data().version || 0 : 0;

        tx.set(ref, {
          text,
          version: prevVersion + 1,
          updatedAt: serverTimestamp(),
          updatedBy: auth.currentUser?.uid || null,
        });
      });

      showAlert("בוצע", "התקנון עודכן – הלקוחות יתבקשו לאשר מחדש");
      setTermsModalOpen(false);
      Keyboard.dismiss();
    } catch (e) {
      showAlert("שגיאה", e?.message || "לא הצליח לשמור תקנון");
    }
  }

  async function approveRequest(req) {
    const { id, date, userId } = req;

    const hour = normalizeHour(req.hour);

    const groupId = req.groupId || makeAppointmentDocId(date, hour);

    const slots =
      Array.isArray(req.slots) && req.slots.length ? req.slots : [hour];

    const reqRef = doc(db, "appointmentRequests", id);
    const userResRef = doc(db, "userReservations", userId);

    try {
      await runTransaction(db, async (tx) => {
        const reqSnap = await tx.get(reqRef);
        if (!reqSnap.exists()) {
          throw new Error("הבקשה כבר לא קיימת");
        }

        const liveReq = reqSnap.data() || {};
        if (liveReq.status !== "pending") {
          throw new Error("הבקשה כבר טופלה");
        }

        const userResSnap = await tx.get(userResRef);
        if (!userResSnap.exists()) {
          tx.update(reqRef, {
            status: "cancelled",
            decidedAt: serverTimestamp(),
            decidedBy: auth.currentUser?.uid || null,
            cancelReason: "user_reservation_missing",
          });
          throw new Error("הלקוחה ביטלה את התור לפני האישור");
        }

        const appRefs = slots.map((h) =>
          doc(
            db,
            "appointments",
            makeAppointmentDocId(date, normalizeHour(h))
          )
        );

        const appSnaps = [];
        for (const r of appRefs) {
          appSnaps.push(await tx.get(r));
        }

        for (let i = 0; i < appSnaps.length; i++) {
          const snap = appSnaps[i];
          const slotHour = normalizeHour(slots[i]);

          if (!snap.exists()) {
            throw new Error(`חסר סלוט ${slotHour}`);
          }

          const live = snap.data() || {};
          if (live.status !== "pending") {
            throw new Error(`הסלוט ${slotHour} כבר לא ממתין`);
          }
          if (live.userId !== userId) {
            throw new Error(`הסלוט ${slotHour} שייך למשתמש אחר`);
          }
        }

        appRefs.forEach((ref, idx) => {
          const slotHour = normalizeHour(slots[idx]);

          tx.set(
            ref,
            {
              date,
              hour: slotHour,
              userId,
              status: "approved",
              approvedAt: serverTimestamp(),
              approvedBy: auth.currentUser?.uid || null,
              source: "request_approved",

              groupId,
              slots: slots.map((h) => normalizeHour(h)),
              isHead: idx === 0,

              servicesSelected: Array.isArray(liveReq.servicesSelected)
                ? liveReq.servicesSelected
                : [],
              totalDurationMin: Number(liveReq.totalDurationMin || 0),
            },
            { merge: true }
          );
        });

        tx.set(
          userResRef,
          {
            status: "approved",
            approvedAt: serverTimestamp(),
            approvedBy: auth.currentUser?.uid || null,
            approvedAlertShown: false,
            cancelledAlertShown: false,
            appointmentId: groupId,
            date,
            hour,
            groupId,
            slots: slots.map((h) => normalizeHour(h)),
          },
          { merge: true }
        );

        tx.update(reqRef, {
          status: "approved",
          decidedAt: serverTimestamp(),
          decidedBy: auth.currentUser?.uid || null,
        });
      });

      // עדכון state מקומי
      setRequests((prev) => prev.filter((r) => r.id !== req.id));

      setAppointments((prev) => {
        const exists = prev.some(
          (a) =>
            a.date === date &&
            a.hour === hour &&
            (a.userId || null) === (userId || null)
        );
        if (exists) return prev;

        const newApp = {
          docId: makeAppointmentDocId(date, hour),
          date,
          hour,
          userId: userId || null,
          customerName: null,
          customerPhone: null,
          servicesSelected: req.servicesSelected || [],
          totalDurationMin: req.totalDurationMin || 0,
          status: "approved",
          isHead: true,
          slots,
          groupId,
          source: "request_approved",
        };

        const next = [...prev, newApp];
        next.sort((a, b) => timeToMin(a.hour) - timeToMin(b.hour));
        return next;
      });

      try {
        if (Platform.OS === "web") {
          const toEmail = req.userEmail || usersMap?.[userId]?.email || "";

          const clientName =
            usersMap?.[userId]?.displayName ||
            `${usersMap?.[userId]?.firstName || ""} ${
              usersMap?.[userId]?.lastName || ""
            }`.trim() ||
            "לקוחה";

          if (toEmail) {
            await sendAppointmentEmail({
              toEmail,
              clientName,
              date,
              time: hour,
              businessName: "Rotem Studio Nails",
              servicesSelected: req.servicesSelected || [],
            });
          } else {
            console.log("⚠️ אין אימייל ללקוחה – לא נשלח מייל");
          }
        } else {
          console.log("📧 דילוג על EmailJS – לא Web (iOS/Android)");
        }
      } catch (mailErr) {
        console.log(
          "❌ sendAppointmentEmail error (approveRequest):",
          mailErr
        );
      }

      showAlert("אושר ✅", `אישרת את הבקשה לשעה ${hour}`);
    } catch (e) {
      showAlert("שגיאה", e?.message || "לא הצליח לאשר בקשה");
    }
  }

  async function rejectRequest(req) {
    const reqRef = doc(db, "appointmentRequests", req.id);
    const userResRef = doc(db, "userReservations", req.userId);

    const groupId =
      req.groupId || makeAppointmentDocId(req.date, req.hour);
    const slots =
      Array.isArray(req.slots) && req.slots.length
        ? req.slots
        : [req.hour];

    try {
      await runTransaction(db, async (tx) => {
        const s = await tx.get(reqRef);
        if (!s.exists()) throw new Error("הבקשה כבר לא קיימת");
        if (s.data()?.status !== "pending")
          throw new Error("הבקשה כבר טופלה");

        const ur = await tx.get(userResRef);

        const slotRefs = slots.map((h) =>
          doc(db, "appointments", makeAppointmentDocId(req.date, h))
        );

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
          const sameGroup = (live?.groupId || groupId) === groupId;

          if (live?.status === "pending" && sameGroup) {
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

      try {
        if (Platform.OS === "web") {
          const toEmail =
            req.userEmail || usersMap?.[req.userId]?.email || "";

          const clientName =
            usersMap?.[req.userId]?.displayName ||
            `${usersMap?.[req.userId]?.firstName || ""} ${
              usersMap?.[req.userId]?.lastName || ""
            }`.trim() ||
            "לקוחה";

          if (toEmail) {
            await sendAppointmentRejectedEmail({
              toEmail,
              clientName,
              date: req.date,
              time: req.hour,
              businessName: "Rotem Studio Nails",
              servicesSelected: req.servicesSelected || [],
            });
          } else {
            console.log(
              "⚠️ אין אימייל ללקוחה – לא נשלח מייל דחייה"
            );
          }
        } else {
          console.log("📧 דילוג על EmailJS – לא Web (iOS/Android)");
        }
      } catch (mailErr) {
        console.log(
          "❌ sendAppointmentRejectedEmail error:",
          mailErr
        );
      }

      showAlert("נדחה", "הבקשה נדחתה");

      await ensureHoldIfNeeded(req.date, req.hour);
    } catch (e) {
      showAlert("שגיאה", e?.message || "לא הצליח לדחות בקשה");
    }
  }

  async function ownerCancelAppointment(app) {
    const { docId, userId, date, hour } = app;

    if (isAppointmentPast(date, hour)) {
      showAlert(
        "לא ניתן לבטל",
        "התור כבר עבר ולכן אי אפשר לבטל אותו."
      );
      return;
    }

    const groupId = app.groupId || null;
    const slots =
      Array.isArray(app.slots) && app.slots.length ? app.slots : [hour];

    showAlert("ביטול תור", `לבטל את התור של ${hour} בתאריך ${date}?`, [
      { text: "לא", style: "cancel" },
      {
        text: "כן, לבטל",
        style: "destructive",
        onPress: async () => {
          try {
            const userResRef = userId
              ? doc(db, "userReservations", userId)
              : null;

            await runTransaction(db, async (tx) => {
              let userResSnap = null;
              if (userResRef) userResSnap = await tx.get(userResRef);

              const slotRefs = slots.map((h) =>
                doc(db, "appointments", makeAppointmentDocId(date, h))
              );
              const slotSnaps = [];
              for (const r of slotRefs) slotSnaps.push(await tx.get(r));

              for (let i = 0; i < slotSnaps.length; i++) {
                const snap = slotSnaps[i];
                if (!snap.exists()) continue;

                const live = snap.data();
                const sameGroup = groupId
                  ? live?.groupId === groupId
                  : true;
                const sameUser = userId ? live?.userId === userId : true;

                if (
                  sameGroup &&
                  sameUser &&
                  !isAppointmentPast(live?.date, live?.hour)
                ) {
                  tx.delete(slotRefs[i]);
                }
              }

              if (userResRef && userResSnap && userResSnap.exists()) {
                const ur = userResSnap.data();

                const matches = groupId
                  ? ur?.groupId === groupId ||
                    ur?.appointmentId === groupId
                  : ur?.appointmentId === docId;

                if (matches) {
                  tx.set(
                    userResRef,
                    {
                      status: "cancelled_by_owner",
                      cancelledAt: serverTimestamp(),
                      cancelledBy: auth.currentUser?.uid || null,
                      appointmentId: null,
                      date: null,
                      hour: null,
                      groupId: null,
                      slots: [],
                      cancelledAlertShown: false,
                    },
                    { merge: true }
                  );
                }
              }
            });

            try {
              if (Platform.OS === "web") {
                const u = userId ? usersMap?.[userId] : null;

                const toEmail = app?.userEmail || u?.email || "";

                const clientName =
                  u?.displayName ||
                  `${u?.firstName || ""} ${
                    u?.lastName || ""
                  }`.trim() ||
                  app?.customerName ||
                  "לקוחה";

                if (toEmail) {
                  await sendAppointmentCancelledEmail({
                    toEmail,
                    clientName,
                    date,
                    time: hour,
                    businessName: "Rotem Studio Nails",
                    servicesSelected: app?.servicesSelected || [],
                  });
                } else {
                  console.log(
                    "⚠️ אין אימייל ללקוחה – לא נשלח מייל ביטול"
                  );
                }
              } else {
                console.log(
                  "📧 דילוג על EmailJS – לא Web (iOS/Android)"
                );
              }
            } catch (mailErr) {
              console.log(
                "❌ sendAppointmentCancelledEmail error:",
                mailErr
              );
            }

            showAlert("בוצע", "התור בוטל בהצלחה");

            await ensureHoldIfNeeded(date, hour);
          } catch (e) {
            showAlert("שגיאה", e?.message || "לא הצליח לבטל תור");
          }
        },
      },
    ]);
  }

  async function ownerDeletePastAppointment(app) {
    const { docId, userId, date, hour } = app;

    if (!isAppointmentPast(date, hour)) {
      showAlert(
        "שגיאה",
        "התור עדיין לא עבר – אפשר לבטל במקום למחוק."
      );
      return;
    }

    const groupId = app.groupId || null;
    const slots =
      Array.isArray(app.slots) && app.slots.length ? app.slots : [hour];

    showAlert(
      "מחיקת תור שעבר",
      `למחוק לצמיתות את התור של ${hour} בתאריך ${date}?`,
      [
        { text: "לא", style: "cancel" },
        {
          text: "כן, מחק",
          style: "destructive",
          onPress: async () => {
            try {
              const userResRef = userId
                ? doc(db, "userReservations", userId)
                : null;

              await runTransaction(db, async (tx) => {
                let userResSnap = null;
                if (userResRef) userResSnap = await tx.get(userResRef);

                const slotRefs = slots.map((h) =>
                  doc(db, "appointments", makeAppointmentDocId(date, h))
                );
                const slotSnaps = [];
                for (const r of slotRefs) slotSnaps.push(await tx.get(r));

                for (let i = 0; i < slotSnaps.length; i++) {
                  const snap = slotSnaps[i];
                  if (!snap.exists()) continue;

                  const live = snap.data();
                  const sameGroup = groupId
                    ? live?.groupId === groupId
                    : true;
                  const sameUser = userId ? live?.userId === userId : true;

                  if (sameGroup && sameUser) {
                    tx.delete(slotRefs[i]);
                  }
                }

                if (userResRef && userResSnap && userResSnap.exists()) {
                  const ur = userResSnap.data();
                  const matches = groupId
                    ? ur?.groupId === groupId ||
                      ur?.appointmentId === groupId
                    : ur?.appointmentId === docId;

                  if (matches) {
                    tx.set(
                      userResRef,
                      {
                        status: "finished_deleted",
                        appointmentId: null,
                        date: null,
                        hour: null,
                        groupId: null,
                        slots: [],
                      },
                      { merge: true }
                    );
                  }
                }
              });

              showAlert("נמחק", "התור שסומן כ׳עבר׳ נמחק מהמערכת.");
            } catch (e) {
              showAlert("שגיאה", e?.message || "לא הצליח למחוק תור");
            }
          },
        },
      ]
    );
  }

  async function ownerCreateManualAppointment() {
    const hour = normalizeHour(manualHour);
    const name = manualName.trim();
    const phone = manualPhone.trim().replace(/[^\d]/g, "");
    const serviceType = (manualService || "").trim();

    if (!hour || !name || !phone) {
      showAlert("שגיאה", "מלאי שעה, שם וטלפון");
      return;
    }
    if (phone.length < 9) {
      showAlert("שגיאה", "מספר טלפון לא תקין");
      return;
    }

    if (
      hoursForSelectedDate.length > 0 &&
      !hoursForSelectedDate.includes(hour)
    ) {
      showAlert("שגיאה", "השעה הזו לא מוגדרת כזמינה בתאריך הזה");
      return;
    }

    const appId = makeAppointmentDocId(selectedDate, hour);
    const appointmentRef = doc(db, "appointments", appId);

    try {
      await runTransaction(db, async (tx) => {
        const existing = await tx.get(appointmentRef);
        if (existing.exists())
          throw new Error("התור בשעה הזו כבר תפוס");

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

      showAlert("בוצע", `התור נשמר ל-${name} בשעה ${hour}`);
      setManualHour("");
      setManualName("");
      setManualPhone("");
      setManualService("");
      Keyboard.dismiss();
      setManualModalOpen(false);
    } catch (e) {
      showAlert("שגיאה", e?.message || "לא הצליח לשריין תור");
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
          borderColor: danger ? "#D6455D" : colors.border,
          backgroundColor: "#fff",
          marginTop: 10,
          alignItems: "center",
          opacity: pressed ? 0.88 : 1,
        },
        Platform.OS === "web" ? { cursor: "pointer" } : null,
      ]}
    >
      <Text
        style={{
          fontWeight: "900",
          color: danger ? "#D6455D" : colors.textDark,
        }}
      >
        {text}
      </Text>
    </Pressable>
  );

  const markedDates = useMemo(() => {
    const out = {};

    const allDates = new Set([
      ...Object.keys(busyFromApps || {}),
      ...Object.keys(busyFromReqs || {}),
    ]);

    allDates.forEach((d) => {
      const hasApproved = !!busyFromApps?.[d];
      const hasPending = !!busyFromReqs?.[d];

      if (!hasApproved && !hasPending) return;

      const dots = [];

      if (hasApproved) {
        dots.push({
          key: "approved",
          color: "#4CAF50",
        });
      }

      if (hasPending) {
        dots.push({
          key: "pending",
          color: "#ff9800",
        });
      }

      out[d] = {
        ...(out[d] || {}),
        dots,
        marked: true,
      };
    });

    const hasApprovedToday = !!busyFromApps?.[selectedDate];
    const hasPendingToday = !!busyFromReqs?.[selectedDate];

    const dotsToday = [];
    if (hasApprovedToday) {
      dotsToday.push({ key: "approved", color: "#4CAF50" });
    }
    if (hasPendingToday) {
      dotsToday.push({ key: "pending", color: "#ff9800" });
    }

    out[selectedDate] = {
      ...(out[selectedDate] || {}),
      selected: true,
      selectedColor: colors.primary,
      marked: hasApprovedToday || hasPendingToday,
      ...(dotsToday.length ? { dots: dotsToday } : {}),
    };

    return out;
  }, [busyFromApps, busyFromReqs, selectedDate]);

  // --------- מסך "לקוחות פעילים" ---------
  if (showUsers) {
    return (
      <View
        style={[
          globalStyles.container,
          { backgroundColor: "transparent", paddingBottom: 16 },
        ]}
      >
        <View style={{ flex: 1 }}>
          <View
            style={{
              paddingVertical: 12,
              marginBottom: 10,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <Text
              style={{
                fontSize: responsiveFont(22),
                fontWeight: "900",
                textAlign: "center",
                color: colors.primary,
              }}
            >
              לקוחות פעילים
            </Text>
          </View>

          <View
            style={{
              backgroundColor: "#fff",
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.border,
              padding: 10,
              marginBottom: 10,
            }}
          >
            <TextInput
              value={usersSearch}
              onChangeText={setUsersSearch}
              placeholder="חיפוש לפי שם / טלפון / אימייל"
              placeholderTextColor="#777"
              style={[
                globalStyles.input,
                { textAlign: "right", writingDirection: "rtl" },
              ]}
            />
            <Text
              style={{
                marginTop: 6,
                color: "gray",
                textAlign: "center",
              }}
            >
              סה"כ: {filteredUsers.length}
            </Text>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled">
            {filteredUsers.length === 0 ? (
              <Text
                style={{
                  textAlign: "center",
                  color: "gray",
                  marginTop: 20,
                }}
              >
                אין לקוחות להצגה
              </Text>
            ) : (
              filteredUsers.map((u) => {
                const fullName =
                  `${u.firstName || ""} ${u.lastName || ""}`.trim() ||
                  u.displayName ||
                  "ללא שם";

                const accepted = !!u.termsAccepted;
                const acceptedVersion = u.termsAcceptedVersion || 0;

                const acceptedLatest =
                  accepted &&
                  termsVersion > 0 &&
                  acceptedVersion === termsVersion;

                const termsLabel = acceptedLatest
                  ? "✔ תקנון מאושר"
                  : "✖ טרם אושר";
                const termsColor = acceptedLatest ? "#4CAF50" : "#d32f2f";

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
                    <Text
                      style={{
                        fontSize: responsiveFont(16),
                        fontWeight: "900",
                        color: colors.textDark,
                        textAlign: "right",
                        width: "100%",
                      }}
                    >
                      {fullName}
                    </Text>

                    <Text
                      style={{
                        marginTop: 4,
                        color: colors.textDark,
                        textAlign: "right",
                        writingDirection: "ltr",
                        width: "100%",
                      }}
                    >
                      {u.email || "—"} :אימייל
                    </Text>

                    <Text
                      style={{
                        marginTop: 2,
                        color: colors.textDark,
                        textAlign: "right",
                        writingDirection: "ltr",
                        width: "100%",
                      }}
                    >
                      {u.phone || "—"} :טלפון
                    </Text>

                    <Text
                      style={{
                        marginTop: 6,
                        textAlign: "right",
                        width: "100%",
                        fontWeight: "900",
                        color: termsColor,
                      }}
                    >
                      סטטוס תקנון: {termsLabel}
                    </Text>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>

        <Pressable
          onPress={() => {
            Keyboard.dismiss();
            setShowUsers(false);
          }}
          style={({ pressed }) => [
            {
              marginTop: 10,
              alignSelf: "stretch",
              marginHorizontal: 16,
              backgroundColor: colors.primary,
              paddingVertical: 12,
              borderRadius: 10,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.88 : 1,
            },
            Platform.OS === "web" ? { cursor: "pointer" } : null,
          ]}
        >
          <Text
            style={{
              color: "white",
              fontWeight: "900",
              fontSize: responsiveFont(16),
            }}
          >
            חזרה למסך תורים
          </Text>
        </Pressable>
      </View>
    );
  }

  // --------- מסך ראשי ---------
  return (
    <View
      style={[globalStyles.container, { backgroundColor: "transparent" }]}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 28, flexGrow: 1 }}
      >
        {/* Header */}
        <View
          style={{
            paddingVertical: 12,
            marginBottom: 10,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              justifyContent: "space-between",
            }}
          >
            <View style={{ width: 46 }} />

            <View style={{ flex: 1, paddingHorizontal: 10 }}>
              <Text
                style={{
                  fontSize: responsiveFont(24),
                  fontWeight: "900",
                  textAlign: "center",
                  color: colors.primary,
                }}
              >
                מסך בעלת העסק
              </Text>

              <Text
                style={{
                  marginTop: 6,
                  fontSize: responsiveFont(15),
                  textAlign: "center",
                  color: colors.textDark,
                  fontWeight: "700",
                }}
              >
                תאריך נבחר: {selectedDate}
              </Text>

              <Text
                style={{
                  marginTop: 6,
                  fontSize: responsiveFont(13),
                  textAlign: "center",
                  color: "#444",
                  fontWeight: "700",
                }}
              >
                שעות לתאריך: {hoursForSelectedDate.length}{" "}
                {availabilityExists ? "(מיוחד)" : "(ברירת מחדל)"}
              </Text>

              <Text
                style={{
                  marginTop: 6,
                  fontSize: responsiveFont(13),
                  textAlign: "center",
                  color: "#F5A623",
                  fontWeight: "900",
                }}
              >
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
              <View
                style={{
                  width: 18,
                  height: 2,
                  backgroundColor: colors.primary,
                  marginVertical: 2,
                  borderRadius: 2,
                }}
              />
              <View
                style={{
                  width: 18,
                  height: 2,
                  backgroundColor: colors.primary,
                  marginVertical: 2,
                  borderRadius: 2,
                }}
              />
              <View
                style={{
                  width: 18,
                  height: 2,
                  backgroundColor: colors.primary,
                  marginVertical: 2,
                  borderRadius: 2,
                }}
              />
            </Pressable>
          </View>
        </View>

        {/* Menu */}
        <Modal
          visible={menuOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setMenuOpen(false)}
        >
          <TouchableWithoutFeedback onPress={() => setMenuOpen(false)}>
            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(0,0,0,0.35)",
                padding: 18,
              }}
            >
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
                  <Text
                    style={{
                      fontWeight: "900",
                      color: colors.primary,
                      fontSize: responsiveFont(16),
                      textAlign: "center",
                    }}
                  >
                    תפריט
                  </Text>
                  <MenuItem
                    text="לקוחות פעילים"
                    onPress={() => {
                      setMenuOpen(false);
                      Keyboard.dismiss();
                      setShowUsers(true);
                    }}
                  />
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

                  <MenuItem
                    text="עריכת טיפולים"
                    onPress={() => {
                      setMenuOpen(false);
                      Keyboard.dismiss();
                      setServicesModalOpen(true);
                    }}
                  />

                  <MenuItem
                    text="עריכת דף העסק"
                    onPress={() => {
                      setMenuOpen(false);
                      Keyboard.dismiss();
                      navigation.navigate("BusinessHomeOwner");
                    }}
                  />

                  <MenuItem
                    text="עריכת תקנון"
                    onPress={() => {
                      setMenuOpen(false);
                      Keyboard.dismiss();
                      setTermsModalOpen(true);
                    }}
                  />

                  <MenuItem
                    text="שינוי תמונות רקע"
                    onPress={() => {
                      setMenuOpen(false);
                      Keyboard.dismiss();
                      setBackgroundsModalOpen(true);
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
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* Modal: ברירת מחדל */}
        <Modal
          visible={defaultModalOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setDefaultModalOpen(false)}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(0,0,0,0.35)",
                padding: 18,
                justifyContent: "center",
              }}
            >
              <TouchableWithoutFeedback onPress={() => {}}>
                <View
                  style={{
                    backgroundColor: "#fff",
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: 14,
                  }}
                >
                  <Text
                    style={{
                      fontWeight: "900",
                      color: colors.primary,
                      fontSize: responsiveFont(18),
                      textAlign: "center",
                    }}
                  >
                    ברירת מחדל לכל הימים
                  </Text>

                  <Text
                    style={{
                      marginTop: 8,
                      color: "#444",
                      textAlign: "right",
                      fontWeight: "700",
                    }}
                  >
                    הזיני שעה בכל שורה:
                    {"\n"}15:00{"\n"}16:00{"\n"}17:00{"\n"}18:00{"\n"}19:00
                  </Text>

                  <TextInput
                    value={defaultText}
                    onChangeText={setDefaultText}
                    placeholder="15:00"
                    placeholderTextColor="#777"
                    multiline
                    style={[
                      globalStyles.input,
                      {
                        marginTop: 10,
                        minHeight: 140,
                        textAlign: "left",
                        writingDirection: "ltr",
                        paddingTop: 12,
                      },
                    ]}
                  />

                  <Pressable
                    onPress={saveDefaultHours}
                    style={({ pressed }) => [
                      {
                        backgroundColor: colors.primary,
                        paddingVertical: 12,
                        borderRadius: 10,
                        alignItems: "center",
                        marginTop: 12,
                        opacity: pressed ? 0.88 : 1,
                      },
                      Platform.OS === "web"
                        ? { cursor: "pointer" }
                        : null,
                    ]}
                  >
                    <Text
                      style={{ color: "white", fontWeight: "900" }}
                    >
                      שמור ברירת מחדל
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setDefaultModalOpen(false)}
                    style={({ pressed }) => [
                      {
                        backgroundColor: "#444",
                        paddingVertical: 10,
                        borderRadius: 10,
                        alignItems: "center",
                        marginTop: 10,
                        opacity: pressed ? 0.88 : 1,
                      },
                      Platform.OS === "web"
                        ? { cursor: "pointer" }
                        : null,
                    ]}
                  >
                    <Text
                      style={{ color: "white", fontWeight: "900" }}
                    >
                      סגור
                    </Text>
                  </Pressable>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* Modal: שעות לתאריך */}
        <Modal
          visible={availabilityModalOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setAvailabilityModalOpen(false)}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(0,0,0,0.35)",
                padding: 18,
                justifyContent: "center",
              }}
            >
              <TouchableWithoutFeedback onPress={() => {}}>
                <View
                  style={{
                    backgroundColor: "#fff",
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: 14,
                  }}
                >
                  <Text
                    style={{
                      fontWeight: "900",
                      color: colors.primary,
                      fontSize: responsiveFont(18),
                      textAlign: "center",
                    }}
                  >
                    שעות לתאריך {selectedDate}
                  </Text>

                  <Text
                    style={{
                      marginTop: 8,
                      color: "#444",
                      textAlign: "right",
                      fontWeight: "700",
                    }}
                  >
                    אם תשמרי ריק — אין שעות באותו יום (override).
                  </Text>

                  <TextInput
                    value={availabilityText}
                    onChangeText={setAvailabilityText}
                    placeholder="15:00"
                    placeholderTextColor="#777"
                    multiline
                    style={[
                      globalStyles.input,
                      {
                        marginTop: 10,
                        minHeight: 140,
                        textAlign: "left",
                        writingDirection: "ltr",
                        paddingTop: 12,
                      },
                    ]}
                  />

                  <Pressable
                    onPress={saveAvailabilityForDate}
                    style={({ pressed }) => [
                      {
                        backgroundColor: colors.primary,
                        paddingVertical: 12,
                        borderRadius: 10,
                        alignItems: "center",
                        marginTop: 12,
                        opacity: pressed ? 0.88 : 1,
                      },
                      Platform.OS === "web"
                        ? { cursor: "pointer" }
                        : null,
                    ]}
                  >
                    <Text
                      style={{ color: "white", fontWeight: "900" }}
                    >
                      שמור שעות לתאריך
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      if (!availabilityExists) {
                        showAlert(
                          "אין מה לאפס",
                          "אין שעות מיוחדות לתאריך הזה."
                        );
                        return;
                      }
                      showAlert(
                        "איפוס תאריך",
                        "למחוק את השעות המיוחדות ולחזור לברירת המחדל?",
                        [
                          { text: "ביטול", style: "cancel" },
                          {
                            text: "אפס",
                            style: "destructive",
                            onPress: resetAvailabilityForDate,
                          },
                        ]
                      );
                    }}
                    style={({ pressed }) => [
                      {
                        backgroundColor: "#fff",
                        borderWidth: 1,
                        borderColor: "#D6455D",
                        paddingVertical: 10,
                        borderRadius: 10,
                        alignItems: "center",
                        marginTop: 10,
                        opacity: pressed ? 0.88 : 1,
                      },
                      Platform.OS === "web"
                        ? { cursor: "pointer" }
                        : null,
                    ]}
                  >
                    <Text
                      style={{
                        color: "#D6455D",
                        fontWeight: "900",
                      }}
                    >
                      איפוס תאריך לברירת מחדל
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setAvailabilityModalOpen(false)}
                    style={({ pressed }) => [
                      {
                        backgroundColor: "#444",
                        paddingVertical: 10,
                        borderRadius: 10,
                        alignItems: "center",
                        marginTop: 10,
                        opacity: pressed ? 0.88 : 1,
                      },
                      Platform.OS === "web"
                        ? { cursor: "pointer" }
                        : null,
                    ]}
                  >
                    <Text
                      style={{ color: "white", fontWeight: "900" }}
                    >
                      סגור
                    </Text>
                  </Pressable>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* Modal: עריכת טיפולים */}
        <Modal
          visible={servicesModalOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setServicesModalOpen(false)}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(0,0,0,0.35)",
                padding: 18,
                justifyContent: "center",
              }}
            >
              <TouchableWithoutFeedback onPress={() => {}}>
                <View
                  style={{
                    backgroundColor: "#fff",
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: 14,
                    maxHeight: "80%",
                  }}
                >
                  <Text
                    style={{
                      fontWeight: "900",
                      color: colors.primary,
                      fontSize: responsiveFont(18),
                      textAlign: "center",
                    }}
                  >
                    עריכת טיפולים
                  </Text>

                  <Text
                    style={{
                      marginTop: 8,
                      color: "#444",
                      textAlign: "right",
                      fontWeight: "700",
                    }}
                  >
                    כל שורה היא טיפול:
                    {"\n"}- שם טיפול (לדוגמה: מניקור)
                    {"\n"}- זמן בדקות (לדוגמה: 50)
                  </Text>

                  <ScrollView
                    style={{ marginTop: 10, maxHeight: 260 }}
                    keyboardShouldPersistTaps="handled"
                  >
                    {(services || []).map((s, idx) => (
                      <View
                        key={s.id || `service_${idx}`}
                        style={{
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: 10,
                          padding: 8,
                          marginBottom: 8,
                        }}
                      >
                        <Text
                          style={{
                            textAlign: "right",
                            fontWeight: "800",
                            marginBottom: 4,
                          }}
                        >
                          טיפול {idx + 1}
                        </Text>

                        <TextInput
                          value={s.name}
                          onChangeText={(text) =>
                            setServices((prev) => {
                              const copy = [...prev];
                              copy[idx] = { ...copy[idx], name: text };
                              return copy;
                            })
                          }
                          placeholder="שם טיפול (לדוגמה: מניקור)"
                          placeholderTextColor="#777"
                          style={[
                            globalStyles.input,
                            {
                              marginTop: 4,
                              textAlign: "right",
                              writingDirection: "rtl",
                            },
                          ]}
                        />

                        <TextInput
                          value={s.durationMin?.toString() ?? ""}
                          onChangeText={(text) =>
                            setServices((prev) => {
                              const copy = [...prev];
                              copy[idx] = {
                                ...copy[idx],
                                durationMin: text,
                              };
                              return copy;
                            })
                          }
                          placeholder="זמן בדקות (לדוגמה: 50)"
                          placeholderTextColor="#777"
                          keyboardType="numeric"
                          style={[
                            globalStyles.input,
                            {
                              marginTop: 4,
                              textAlign: "right",
                              writingDirection: "ltr",
                            },
                          ]}
                        />

                        <Pressable
                          onPress={() =>
                            setServices((prev) =>
                              prev.filter((_, i) => i !== idx)
                            )
                          }
                          style={({ pressed }) => [
                            {
                              marginTop: 6,
                              alignSelf: "flex-start",
                              paddingVertical: 6,
                              paddingHorizontal: 10,
                              borderRadius: 999,
                              borderWidth: 1,
                              borderColor: "#D6455D",
                              opacity: pressed ? 0.85 : 1,
                            },
                            Platform.OS === "web"
                              ? { cursor: "pointer" }
                              : null,
                          ]}
                        >
                          <Text
                            style={{
                              color: "#D6455D",
                              fontWeight: "900",
                            }}
                          >
                            מחיקת טיפול
                          </Text>
                        </Pressable>
                      </View>
                    ))}
                  </ScrollView>

                  <Pressable
                    onPress={() =>
                      setServices((prev) => [
                        ...prev,
                        {
                          id: `service_${prev.length + 1}`,
                          name: "",
                          durationMin: "",
                        },
                      ])
                    }
                    style={({ pressed }) => [
                      {
                        backgroundColor: "#fff",
                        borderWidth: 1,
                        borderColor: colors.primary,
                        paddingVertical: 10,
                        borderRadius: 10,
                        alignItems: "center",
                        marginTop: 8,
                        opacity: pressed ? 0.88 : 1,
                      },
                      Platform.OS === "web"
                        ? { cursor: "pointer" }
                        : null,
                    ]}
                  >
                    <Text
                      style={{
                        color: colors.primary,
                        fontWeight: "900",
                      }}
                    >
                      הוספת טיפול חדש
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={saveServices}
                    style={({ pressed }) => [
                      {
                        backgroundColor: colors.primary,
                        paddingVertical: 12,
                        borderRadius: 10,
                        alignItems: "center",
                        marginTop: 12,
                        opacity: pressed ? 0.88 : 1,
                      },
                      Platform.OS === "web"
                        ? { cursor: "pointer" }
                        : null,
                    ]}
                  >
                    <Text
                      style={{ color: "white", fontWeight: "900" }}
                    >
                      שמור טיפולים
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      setServices(servicesInitial);
                      setServicesModalOpen(false);
                    }}
                    style={({ pressed }) => [
                      {
                        backgroundColor: "#444",
                        paddingVertical: 10,
                        borderRadius: 10,
                        alignItems: "center",
                        marginTop: 10,
                        opacity: pressed ? 0.88 : 1,
                      },
                      Platform.OS === "web"
                        ? { cursor: "pointer" }
                        : null,
                    ]}
                  >
                    <Text
                      style={{ color: "white", fontWeight: "900" }}
                    >
                      סגור
                    </Text>
                  </Pressable>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* Modal: עריכת תקנון */}
        <Modal
          visible={termsModalOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setTermsModalOpen(false)}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(0,0,0,0.35)",
                padding: 18,
                justifyContent: "center",
              }}
            >
              <TouchableWithoutFeedback>
                <View
                  style={{
                    backgroundColor: "#fff",
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: 14,
                    maxHeight: "80%",
                  }}
                >
                  <Text
                    style={{
                      fontWeight: "900",
                      color: colors.primary,
                      fontSize: 18,
                      textAlign: "center",
                    }}
                  >
                    עריכת תקנון
                  </Text>

                  <Text
                    style={{
                      textAlign: "center",
                      fontSize: 12,
                      color: "#777",
                    }}
                  >
                    גרסה נוכחית: {termsVersion}
                  </Text>

                  <ScrollView style={{ marginTop: 10, maxHeight: 260 }}>
                    <TextInput
                      value={termsText}
                      onChangeText={setTermsText}
                      multiline
                      style={[
                        globalStyles.input,
                        {
                          minHeight: 220,
                          textAlign: "right",
                          writingDirection: "rtl",
                          paddingTop: 12,
                        },
                      ]}
                    />
                  </ScrollView>

                  <Pressable
                    onPress={saveTerms}
                    style={{
                      backgroundColor: colors.primary,
                      paddingVertical: 12,
                      borderRadius: 10,
                      alignItems: "center",
                      marginTop: 12,
                    }}
                  >
                    <Text
                      style={{ color: "white", fontWeight: "900" }}
                    >
                      שמור תקנון
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setTermsModalOpen(false)}
                    style={{
                      backgroundColor: "#444",
                      paddingVertical: 10,
                      borderRadius: 10,
                      alignItems: "center",
                      marginTop: 10,
                    }}
                  >
                    <Text
                      style={{ color: "white", fontWeight: "900" }}
                    >
                      סגור
                    </Text>
                  </Pressable>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* Modal: שינוי תמונות רקע */}
        <Modal
          visible={backgroundsModalOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setBackgroundsModalOpen(false)}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(0,0,0,0.35)",
                padding: 18,
                justifyContent: "center",
              }}
            >
              <TouchableWithoutFeedback>
                <View
                  style={{
                    backgroundColor: "#fff",
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: 14,
                    maxHeight: "80%",
                  }}
                >
                  <Text
                    style={{
                      fontWeight: "900",
                      color: colors.primary,
                      fontSize: responsiveFont(18),
                      textAlign: "center",
                    }}
                  >
                    שינוי תמונות רקע
                  </Text>

                  <ScrollView
                    style={{ marginTop: 10, maxHeight: 260 }}
                    keyboardShouldPersistTaps="handled"
                  >
                    <Text
                      style={{
                        textAlign: "right",
                        fontWeight: "800",
                        marginBottom: 4,
                        marginTop: 8,
                      }}
                    >
                      תמונת רקע למסך פתיחת המערכת
                    </Text>

                    <Pressable
                      onPress={() => pickAndUploadBackground("openRegis")}
                      disabled={backgroundUploading}
                      style={({ pressed }) => [
                        {
                          marginTop: 4,
                          alignSelf: "flex-start",
                          backgroundColor: backgroundUploading
                            ? "#ccc"
                            : colors.primary,
                          paddingVertical: 10,
                          paddingHorizontal: 16,
                          borderRadius: 999,
                          opacity: pressed ? 0.88 : 1,
                        },
                        Platform.OS === "web"
                          ? { cursor: "pointer" }
                          : null,
                      ]}
                    >
                      <Text
                        style={{
                          color: "white",
                          fontWeight: "900",
                        }}
                      >
                        בחרי תמונה מהגלריה
                      </Text>
                    </Pressable>

                    <Text
                      style={{
                        textAlign: "right",
                        fontWeight: "800",
                        marginBottom: 4,
                        marginTop: 16,
                      }}
                    >
                      תמונת רקע לכל האפליקציה
                    </Text>

                    <Pressable
                      onPress={() => pickAndUploadBackground("allApp")}
                      disabled={backgroundUploading}
                      style={({ pressed }) => [
                        {
                          marginTop: 4,
                          alignSelf: "flex-start",
                          backgroundColor: backgroundUploading
                            ? "#ccc"
                            : colors.primary,
                          paddingVertical: 10,
                          paddingHorizontal: 16,
                          borderRadius: 999,
                          opacity: pressed ? 0.88 : 1,
                        },
                        Platform.OS === "web"
                          ? { cursor: "pointer" }
                          : null,
                      ]}
                    >
                      <Text
                        style={{
                          color: "white",
                          fontWeight: "900",
                        }}
                      >
                        בחרי תמונה מהגלריה
                      </Text>
                    </Pressable>

                    {backgroundUploading ? (
                      <Text
                        style={{
                          marginTop: 12,
                          textAlign: "right",
                          color: "#777",
                          fontWeight: "700",
                        }}
                      >
                        מעלה תמונה... זה יכול לקחת כמה שניות
                      </Text>
                    ) : null}
                  </ScrollView>

                  <Pressable
                    onPress={() => setBackgroundsModalOpen(false)}
                    style={({ pressed }) => [
                      {
                        backgroundColor: "#444",
                        paddingVertical: 10,
                        borderRadius: 10,
                        alignItems: "center",
                        marginTop: 10,
                        opacity: pressed ? 0.88 : 1,
                      },
                      Platform.OS === "web"
                        ? { cursor: "pointer" }
                        : null,
                    ]}
                  >
                    <Text
                      style={{ color: "white", fontWeight: "900" }}
                    >
                      סגור
                    </Text>
                  </Pressable>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* Modal: שריון ידני */}
        <Modal
          visible={manualModalOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setManualModalOpen(false)}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(0,0,0,0.35)",
                padding: 18,
                justifyContent: "center",
              }}
            >
              <TouchableWithoutFeedback onPress={() => {}}>
                <View
                  style={{
                    backgroundColor: "#fff",
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: 14,
                  }}
                >
                  <Text
                    style={{
                      fontWeight: "900",
                      color: colors.primary,
                      fontSize: responsiveFont(18),
                      textAlign: "center",
                    }}
                  >
                    שריון ידני (מאושר)
                  </Text>

                  <TextInput
                    value={manualHour}
                    onChangeText={setManualHour}
                    placeholder="שעה (לדוגמה 15:00)"
                    placeholderTextColor="#777"
                    style={[
                      globalStyles.input,
                      {
                        marginTop: 10,
                        textAlign: "right",
                        writingDirection: "ltr",
                      },
                    ]}
                  />

                  <TextInput
                    value={manualName}
                    onChangeText={setManualName}
                    placeholder="שם לקוחה"
                    placeholderTextColor="#777"
                    style={[
                      globalStyles.input,
                      {
                        marginTop: 8,
                        textAlign: "right",
                        writingDirection: "rtl",
                      },
                    ]}
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
                    {...(Platform.OS === "ios"
                      ? { inputAccessoryViewID: phoneAccessoryId }
                      : {})}
                    style={[
                      globalStyles.input,
                      {
                        marginTop: 8,
                        textAlign: "right",
                        writingDirection: "ltr",
                      },
                    ]}
                  />

                  <TextInput
                    value={manualService}
                    onChangeText={setManualService}
                    placeholder="סוג טיפול (אופציונלי)"
                    placeholderTextColor="#777"
                    style={[
                      globalStyles.input,
                      {
                        marginTop: 8,
                        textAlign: "right",
                        writingDirection: "rtl",
                      },
                    ]}
                  />

                  {Platform.OS === "android" &&
                  phoneFocused &&
                  keyboardVisible ? (
                    <Pressable
                      onPress={Keyboard.dismiss}
                      style={({ pressed }) => [
                        {
                          alignSelf: "flex-end",
                          backgroundColor: colors.primary,
                          paddingVertical: 8,
                          paddingHorizontal: 14,
                          borderRadius: 999,
                          marginTop: 10,
                          opacity: pressed ? 0.88 : 1,
                        },
                        Platform.OS === "web"
                          ? { cursor: "pointer" }
                          : null,
                      ]}
                    >
                      <Text
                        style={{
                          color: "white",
                          fontWeight: "900",
                        }}
                      >
                        סיום
                      </Text>
                    </Pressable>
                  ) : null}

                  <Pressable
                    onPress={ownerCreateManualAppointment}
                    style={({ pressed }) => [
                      {
                        backgroundColor: colors.primary,
                        paddingVertical: 12,
                        borderRadius: 10,
                        alignItems: "center",
                        marginTop: 12,
                        opacity: pressed ? 0.88 : 1,
                      },
                      Platform.OS === "web"
                        ? { cursor: "pointer" }
                        : null,
                    ]}
                  >
                    <Text
                      style={{ color: "white", fontWeight: "900" }}
                    >
                      שמור תור
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setManualModalOpen(false)}
                    style={({ pressed }) => [
                      {
                        backgroundColor: "#444",
                        paddingVertical: 10,
                        borderRadius: 10,
                        alignItems: "center",
                        marginTop: 10,
                        opacity: pressed ? 0.88 : 1,
                      },
                      Platform.OS === "web"
                        ? { cursor: "pointer" }
                        : null,
                    ]}
                  >
                    <Text
                      style={{ color: "white", fontWeight: "900" }}
                    >
                      סגור
                    </Text>
                  </Pressable>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {Platform.OS === "ios" ? (
          <InputAccessoryView nativeID={phoneAccessoryId}>
            <View
              style={{
                backgroundColor: "#f2f2f2",
                borderTopWidth: 1,
                borderTopColor: "#ddd",
                paddingVertical: 8,
                paddingHorizontal: 12,
                alignItems: "flex-end",
              }}
            >
              <Pressable
                onPress={Keyboard.dismiss}
                style={{ paddingVertical: 6, paddingHorizontal: 10 }}
              >
                <Text
                  style={{
                    color: colors.primary,
                    fontWeight: "900",
                    fontSize: 16,
                  }}
                >
                  סגירה
                </Text>
              </Pressable>
            </View>
          </InputAccessoryView>
        ) : null}

        {/* Calendar */}
        <Calendar
          minDate={today}
          onDayPress={(day) => setSelectedDate(day.dateString)}
          markedDates={markedDates}
          markingType={"multi-dot"}
          style={{
            borderRadius: 10,
            borderWidth: 1,
            borderColor: colors.border,
            marginBottom: 12,
          }}
          hideArrows={false}
          renderArrow={(direction) => (
            <Text
              style={{
                fontSize: responsiveFont(20),
                color: colors.primary,
                fontWeight: "900",
                paddingHorizontal: 4,
              }}
            >
              {direction === "left" ? "‹" : "›"}
            </Text>
          )}
          theme={{
            todayTextColor: colors.secondary,
            selectedDayBackgroundColor: colors.primary,
            arrowColor: colors.primary,
            monthTextColor: colors.primary,
            textDisabledColor: "#d9e1e8",
          }}
        />

        {/* Legend */}
        <View
          style={{
            flexDirection: "row",
            justifyContent: "flex-end",
            alignItems: "center",
            marginBottom: 12,
            gap: 20,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: "#4CAF50",
                marginRight: 12,
              }}
            />
            <Text
              style={{
                fontWeight: "800",
                color: colors.textDark,
              }}
            >
              תור מאושר
            </Text>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: "#ff9800",
                marginRight: 12,
              }}
            />
            <Text
              style={{
                fontWeight: "800",
                color: colors.textDark,
              }}
            >
              בקשה ממתינה
            </Text>
          </View>
        </View>

        {/* Pending requests */}
        <View style={{ marginBottom: 14 }}>
          <Text
            style={{
              fontWeight: "900",
              color: colors.primary,
              fontSize: responsiveFont(16),
              textAlign: "right",
            }}
          >
            בקשות ממתינות
          </Text>

          {requests.length === 0 ? (
            <Text
              style={{
                color: "gray",
                textAlign: "right",
                marginTop: 6,
              }}
            >
              אין בקשות ממתינות לתאריך הזה
            </Text>
          ) : (
            requests.map((r) => {
              const u = r.userId ? usersMap[r.userId] : null;
              const fullName =
                `${u?.firstName || ""} ${u?.lastName || ""}`.trim() ||
                u?.displayName ||
                r.userId;

              const { servicesText, totalText } = formatServices(r);

              return (
                <View
                  key={r.id}
                  style={{
                    marginTop: 10,
                    backgroundColor: "#fff",
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: 12,
                  }}
                >
                  <Text
                    style={{
                      fontWeight: "900",
                      textAlign: "right",
                    }}
                  >
                    שעה: {r.hour}
                  </Text>
                  <Text
                    style={{
                      marginTop: 4,
                      textAlign: "right",
                    }}
                  >
                    לקוחה: {fullName}
                  </Text>

                  <Text
                    style={{
                      marginTop: 4,
                      textAlign: "right",
                    }}
                  >
                    טיפול: {servicesText || "לא נבחר"}
                  </Text>
                  <Text
                    style={{
                      marginTop: 2,
                      textAlign: "right",
                      fontWeight: "900",
                      color: "#555",
                    }}
                  >
                    זמן כולל: {totalText || "—"}
                  </Text>

                  {Array.isArray(r.slots) && r.slots.length > 1 ? (
                    <Text
                      style={{
                        marginTop: 4,
                        textAlign: "right",
                        color: "#666",
                        fontWeight: "800",
                      }}
                    >
                      שעות שנתפסו: {r.slots.join(", ")}
                    </Text>
                  ) : null}

                  <View
                    style={{
                      flexDirection: "row",
                      gap: 10,
                      marginTop: 10,
                    }}
                  >
                    <Pressable
                      onPress={() => approveRequest(r)}
                      style={{
                        flex: 1,
                        backgroundColor: "#4CAF50",
                        paddingVertical: 10,
                        borderRadius: 10,
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          color: "white",
                          fontWeight: "900",
                        }}
                      >
                        אישור
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => rejectRequest(r)}
                      style={{
                        flex: 1,
                        backgroundColor: "#c62828",
                        paddingVertical: 10,
                        borderRadius: 10,
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          color: "white",
                          fontWeight: "900",
                        }}
                      >
                        דחייה
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* Approved appointments */}
        <View style={{ marginBottom: 8 }}>
          <Text
            style={{
              fontWeight: "900",
              color: colors.primary,
              fontSize: responsiveFont(16),
              textAlign: "right",
            }}
          >
            תורים מאושרים
          </Text>

          {appointments.length === 0 ? (
            <Text
              style={{
                textAlign: "right",
                color: "gray",
                marginTop: 8,
              }}
            >
              אין תורים מאושרים ליום הזה
            </Text>
          ) : (
            appointments.map((app) => {
              const u = app.userId ? usersMap[app.userId] : null;

              const fullName = app.userId
                ? `${u?.firstName || ""} ${
                    u?.lastName || ""
                  }`.trim()
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
                    position: "relative",
                  }}
                >
                  <Text
                    style={{
                      fontSize: responsiveFont(16),
                      fontWeight: "900",
                      color: colors.textDark,
                      width: "100%",
                      textAlign: "right",
                    }}
                  >
                    שעה: {app.hour}
                  </Text>

                  <Text
                    style={{
                      marginTop: 6,
                      fontSize: responsiveFont(14),
                      color: colors.textDark,
                      width: "100%",
                      textAlign: "right",
                    }}
                  >
                    לקוחה: {fullName || "לא נטען"}
                  </Text>

                  <Text
                    style={{
                      marginTop: 2,
                      fontSize: responsiveFont(14),
                      color: colors.textDark,
                      width: "100%",
                      textAlign: "right",
                    }}
                  >
                    טיפול: {servicesText || "לא נבחר"}
                  </Text>

                  <Text
                    style={{
                      marginTop: 2,
                      fontSize: responsiveFont(14),
                      color: "#555",
                      fontWeight: "900",
                      width: "100%",
                      textAlign: "right",
                    }}
                  >
                    זמן כולל: {totalText || "—"}
                  </Text>

                  {Array.isArray(app.slots) && app.slots.length > 1 ? (
                    <Text
                      style={{
                        marginTop: 4,
                        fontSize: responsiveFont(13),
                        color: "#666",
                        fontWeight: "800",
                        width: "100%",
                        textAlign: "right",
                      }}
                    >
                      שעות שנתפסו: {app.slots.join(", ")}
                    </Text>
                  ) : null}

                  <Text
                    style={{
                      marginTop: 2,
                      fontSize: responsiveFont(14),
                      color: colors.textDark,
                      width: "100%",
                      textAlign: "right",
                    }}
                  >
                    טלפון: {phone || "לא נטען"}
                  </Text>

                  {isPast ? (
                    <Text
                      style={{
                        marginTop: 6,
                        fontSize: responsiveFont(14),
                        color: "#4CAF50",
                        fontWeight: "900",
                        width: "100%",
                        textAlign: "right",
                      }}
                    >
                      ✅ התור עבר
                    </Text>
                  ) : null}

                  <Pressable
                    onPress={() => {
                      if (isPast) {
                        ownerDeletePastAppointment(app);
                      } else {
                        ownerCancelAppointment(app);
                      }
                    }}
                    style={{
                      marginTop: 10,
                      alignSelf: "flex-end",
                      backgroundColor: "#c62828",
                      paddingVertical: 8,
                      paddingHorizontal: 14,
                      borderRadius: 8,
                      ...(Platform.OS === "web"
                        ? { cursor: "pointer" }
                        : null),
                      zIndex: 10,
                    }}
                  >
                    <Text
                      style={{
                        color: "white",
                        fontWeight: "800",
                        textAlign: "right",
                      }}
                    >
                      {isPast ? "מחק תור" : "בטל תור"}
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