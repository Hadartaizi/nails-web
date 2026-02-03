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
  ImageBackground,
  StyleSheet,
} from "react-native";

import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  runTransaction,
  serverTimestamp,
  getDoc,
} from "firebase/firestore";

import { auth, db } from "../firebaseConfig";
import globalStyles from "../styles/global";
import colors from "../styles/colors";
import HourSlot from "../components/HourSlot";
import {
  sendAppointmentPendingEmail,
  sendWaitlistHoldEmail,
  sendWaitlistExpiredEmail,
} from "../emailReminder";

// 👇 תמונת ברירת מחדל כמו בשאר המסכים
const BG_FALLBACK = require("../assets/backgroundOpenRegisApp.jpg");

// ✅ לא מוסיפים cache-bust ל-data:image/...base64,...
function normalizeImgUri(uri, bustValue) {
  const u = String(uri || "");
  if (!u) return "";
  if (u.startsWith("data:image/")) return u;
  const sep = u.includes("?") ? "&" : "?";
  return `${u}${sep}t=${bustValue}`;
}

// ================= helpers =================
const FALLBACK_SLOT_MIN = 60;

const WAITLIST_COLLECTION = "waitlists";
const HOLD_MINUTES = 30;

function makeWaitlistDocId(date, hour) {
  const safeHour = (hour || "").replace(":", "-");
  return `${date}_${safeHour}`;
}

function showAlert(title, message) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message || ""}`);
  } else {
    Alert.alert(title, message || "");
  }
}

async function confirmAction(title, message) {
  if (Platform.OS === "web") {
    return window.confirm(`${title}\n\n${message || ""}`);
  }

  return await new Promise((resolve) => {
    Alert.alert(title, message || "", [
      { text: "לא", style: "cancel", onPress: () => resolve(false) },
      { text: "כן", style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}

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
    .filter(
      (s) => s.name && Number.isFinite(s.durationMin) && s.durationMin > 0
    );

  const used = new Map();
  return cleaned.map((s) => {
    const base = (s.id || "").trim() || "service";
    const count = (used.get(base) || 0) + 1;
    used.set(base, count);
    return { ...s, id: count === 1 ? base : `${base}-${count}` };
  });
}

function getSlotStepMin(hoursSorted) {
  if (!Array.isArray(hoursSorted) || hoursSorted.length < 2)
    return FALLBACK_SLOT_MIN;

  let best = Infinity;
  for (let i = 1; i < hoursSorted.length; i++) {
    const diff = timeToMin(hoursSorted[i]) - timeToMin(hoursSorted[i - 1]);
    if (diff > 0 && diff < best) best = diff;
  }
  return Number.isFinite(best) && best !== Infinity ? best : FALLBACK_SLOT_MIN;
}

// ✅ הצגת זמן יפה: דקות אם פחות משעה, שעות/שעות+דקות אם מעל
function formatDuration(min) {
  const total = Number(min) || 0;
  if (total <= 0) return "0 דק׳";

  if (total < 60) {
    return `${total} דק׳`;
  }

  const hours = Math.floor(total / 60);
  const minutes = total % 60;

  const hoursText = hours === 1 ? "שעה" : `${hours} שעות`;

  if (minutes === 0) {
    return hoursText;
  }

  return `${hoursText} ו-${minutes} דק׳`;
}

// ============ WAITLIST LOGIC (EXPORT) ============
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

    let expiredInfo = null;
    let newHoldInfo = null;

    if (activeUserId && holdExpiresAtMs > 0 && holdExpiresAtMs <= nowMs) {
      const expiredEntry =
        queue.find((x) => x.userId === activeUserId) || {};

      expiredInfo = {
        userId: activeUserId,
        userEmail: expiredEntry.userEmail || "",
        userName: expiredEntry.userName || "לקוחה",
      };

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

      return expiredInfo
        ? {
            date: dateStr,
            hour,
            expiredInfo,
            newHoldInfo: null,
          }
        : null;
    }

    const hasHold = !!activeUserId && holdExpiresAtMs > nowMs;
    if (hasHold) {
      console.log("ensureHoldIfNeeded: already has active hold – exit");
      return expiredInfo
        ? {
            date: dateStr,
            hour,
            expiredInfo,
            newHoldInfo: null,
          }
        : null;
    }

    const next = queue[0];
    if (!next?.userId) {
      console.log("ensureHoldIfNeeded: first in queue has no userId – exit");
      return expiredInfo
        ? {
            date: dateStr,
            hour,
            expiredInfo,
            newHoldInfo: null,
          }
        : null;
    }

    activeUserId = next.userId;
    holdExpiresAtMs = nowMs + holdMs;

    newHoldInfo = {
      userId: next.userId,
      userEmail: next.userEmail || "",
      userName: next.userName || "לקוחה",
    };

    tx.update(waitRef, {
      queue,
      userIds,
      activeUserId,
      holdExpiresAtMs,
    });

    console.log("ensureHoldIfNeeded: created HOLD for", next.userId);

    return {
      date: dateStr,
      hour,
      expiredInfo,
      newHoldInfo,
    };
  });

  if (!notifyInfo) {
    console.log("ensureHoldIfNeeded: no notifyInfo – skip emails");
    return;
  }

  const { date, hour: holdHour, expiredInfo, newHoldInfo } = notifyInfo;

  try {
    const waitRef = doc(
      db,
      WAITLIST_COLLECTION,
      makeWaitlistDocId(date, holdHour)
    );

    async function enrichUser(info) {
      if (!info || !info.userId) return null;

      let toEmail = info.userEmail || "";
      let clientName = info.userName || "לקוחה";

      if (!toEmail) {
        const userSnap = await getDoc(doc(db, "users", info.userId));
        if (userSnap.exists()) {
          const u = userSnap.data();
          toEmail = u.email || "";
          const fullName = `${u.firstName || ""} ${u.lastName || ""}`.trim();
          if (fullName) clientName = fullName;
        }
      }

      if (!toEmail) return null;

      return { userId: info.userId, toEmail, clientName };
    }

    const expiredUser = await enrichUser(expiredInfo);
    if (expiredUser) {
      console.log(
        "ensureHoldIfNeeded: sending waitlist_expired email to",
        expiredUser.toEmail
      );

      await sendWaitlistExpiredEmail({
        toEmail: expiredUser.toEmail,
        clientName: expiredUser.clientName,
        date,
        time: holdHour,
        businessName: "Rotem Studio Nails",
      });
    }

    const holdUser = await enrichUser(newHoldInfo);

    if (!holdUser) {
      if (newHoldInfo?.userId) {
        console.log(
          "ensureHoldIfNeeded: new HOLD user has no email, removing from queue and trying next"
        );

        await runTransaction(db, async (tx) => {
          const snap = await tx.get(waitRef);
          if (!snap.exists()) return;

          const data = snap.data() || {};
          let queue = Array.isArray(data.queue) ? data.queue : [];
          let userIds = Array.isArray(data.userIds) ? data.userIds : [];

          queue = queue.filter((x) => x && x.userId !== newHoldInfo.userId);
          userIds = userIds.filter((id) => id !== newHoldInfo.userId);

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

        await ensureHoldIfNeeded(date, holdHour);
      }

      return;
    }

    console.log(
      "ensureHoldIfNeeded: sending waitlist_hold email to",
      holdUser.toEmail
    );

    await sendWaitlistHoldEmail({
      toEmail: holdUser.toEmail,
      clientName: holdUser.clientName,
      date,
      time: holdHour,
      businessName: "Rotem Studio Nails",
    });
  } catch (e) {
    console.log("❌ ensureHoldIfNeeded email send error:", e);
  }
}

// ================= screen =================
export default function DayScreen({ route, navigation }) {
  const [waitlistsByHour, setWaitlistsByHour] = useState({});

  const selectedDate =
    route?.params?.date ||
    route?.params?.selectedDate ||
    new Date().toISOString().split("T")[0];

  const userId = auth.currentUser?.uid || null;

  const [loading, setLoading] = useState(true);

  const [defaultHours, setDefaultHours] = useState([]);
  const [overrideHours, setOverrideHours] = useState(null);

  const [appointments, setAppointments] = useState([]);
  const [myRes, setMyRes] = useState(null);

  const [services, setServices] = useState([]);

  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [serviceHour, setServiceHour] = useState(null);
  const [selectedServiceIds, setSelectedServiceIds] = useState({});

  // ====== רקע דינמי לכל האפליקציה (backgroundAllAppUrl) ======
  // undefined = עדיין לא נטען, null = אין ערך, string = URL
  const [backgroundAllAppUrl, setBackgroundAllAppUrl] = useState(undefined);
  const [bgUpdatedAt, setBgUpdatedAt] = useState(Date.now());

  useEffect(() => {
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

  // ============ WAITLIST LOGIC ============
  async function toggleWaitlist(dateStr, hourStr) {
    if (!userId) {
      showAlert("שגיאה", "צריך להיות מחובר כדי להצטרף לרשימת המתנה");
      return;
    }

    const hour = normalizeHour(hourStr);
    const waitRef = doc(
      db,
      WAITLIST_COLLECTION,
      makeWaitlistDocId(dateStr, hour)
    );

    const nowMs = Date.now();
    const currentUser = auth.currentUser;
    const userEmail = currentUser?.email || "";
    const userName = currentUser?.displayName || "";

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(waitRef);

        if (!snap.exists()) {
          tx.set(waitRef, {
            date: dateStr,
            hour,
            queue: [
              {
                userId,
                joinedAtMs: nowMs,
                userEmail,
                userName,
              },
            ],
            userIds: [userId],
            activeUserId: null,
            holdExpiresAtMs: null,
            createdAtMs: nowMs,
          });
          return;
        }

        const data = snap.data() || {};
        const queue = Array.isArray(data.queue) ? data.queue : [];
        const userIds = Array.isArray(data.userIds) ? data.userIds : [];

        const inQueue = queue.some((x) => x?.userId === userId);

        if (inQueue) {
          const newQueue = queue.filter((x) => x?.userId !== userId);
          const newUserIds = userIds.filter((id) => id !== userId);

          if (!newQueue.length) {
            tx.delete(waitRef);
            return;
          }

          const updates = { queue: newQueue, userIds: newUserIds };

          if (data.activeUserId === userId) {
            updates.activeUserId = null;
            updates.holdExpiresAtMs = null;
          }

          tx.update(waitRef, updates);
          return;
        }

        const newQueue = [
          ...queue,
          {
            userId,
            joinedAtMs: nowMs,
            userEmail,
            userName,
          },
        ];
        const newUserIds = userIds.includes(userId)
          ? userIds
          : [...userIds, userId];

        tx.update(waitRef, {
          queue: newQueue,
          userIds: newUserIds,
        });
      });

      await ensureHoldIfNeeded(dateStr, hour);
    } catch (e) {
      console.log("❌ toggleWaitlist error:", e);
      showAlert("שגיאה", e?.message || "לא הצלחנו לעדכן את רשימת ההמתנה");
    }
  }

  // ============ LISTENERS ============

  useEffect(() => {
    const qW = query(
      collection(db, WAITLIST_COLLECTION),
      where("date", "==", selectedDate)
    );

    const unsub = onSnapshot(
      qW,
      (snap) => {
        const map = {};
        snap.docs.forEach((d) => {
          const data = d.data() || {};
          const h = normalizeHour(data?.hour);
          if (h) map[h] = { id: d.id, ...data };
        });
        setWaitlistsByHour(map);
      },
      (err) =>
        console.log("❌ waitlists/day listen error:", err?.code, err?.message)
    );

    return () => unsub();
  }, [selectedDate]);

  useEffect(() => {
    const nowMs = Date.now();

    const expired = Object.values(waitlistsByHour || {}).filter((w) => {
      const activeUserId = w?.activeUserId || null;
      const holdExpiresAtMs = Number(w?.holdExpiresAtMs || 0);
      return activeUserId && holdExpiresAtMs > 0 && holdExpiresAtMs <= nowMs;
    });

    expired.forEach((w) => {
      if (w.date && w.hour) {
        ensureHoldIfNeeded(w.date, w.hour);
      }
    });
  }, [waitlistsByHour]);

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
      (err) => {
        console.log(
          "❌ userReservations listen error:",
          err?.code,
          err?.message
        );
      }
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
                { id: "manicure", name: "מניקור", durationMin: 50 },
                {
                  id: "anatomical_structure_short",
                  name: "מבנה אנטומי לציפורניים קצרות",
                  durationMin: 180,
                },
                {
                  id: "gel_refill_long",
                  name: " מילוי ג׳ל לציפורניים ארוכות",
                  durationMin: 210,
                },
                { id: "tips_refill", name: "מילוי בטיפסים", durationMin: 60 },
                { id: "gel_build", name: "בניה חדשה", durationMin: 240 },
                { id: "nail_repair", name: "השלמת ציפורן", durationMin: 20 },
                { id: "crack_treatment", name: "טיפול בסדק", durationMin: 10 },
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
    const qApps = query(
      collection(db, "appointments"),
      where("date", "==", selectedDate)
    );

    const unsub = onSnapshot(
      qApps,
      (snap) => {
        const arr = snap.docs.map((d) => ({ docId: d.id, ...d.data() }));
        arr.sort((a, b) => timeToMin(a.hour) - timeToMin(b.hour));
        setAppointments(arr);
      },
      (err) => {
        console.log("❌ appointments error:", err?.code, err?.message);
        showAlert("שגיאה", "לא הצליח לטעון תורים");
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

  const hiddenMineHours = useMemo(() => {
    if (!userId) return new Set();
    const set = new Set();
    for (const a of appointments) {
      const h = normalizeHour(a?.hour);
      const isMine = a?.userId === userId;
      const isHead = !!a?.isHead;
      if (h && isMine && !isHead) {
        set.add(h);
      }
    }
    return set;
  }, [appointments, userId]);

  const hoursToShow = useMemo(() => {
    if (overrideHours !== null) return overrideHours;
    return defaultHours;
  }, [overrideHours, defaultHours]);

  const hoursSorted = useMemo(
    () => uniqSortedHours(hoursToShow),
    [hoursToShow]
  );

  const hoursVisible = useMemo(
    () => hoursSorted.filter((h) => !isAppointmentPast(selectedDate, h)),
    [hoursSorted, selectedDate]
  );

  const selectedServices = useMemo(() => {
    const ids = Object.keys(selectedServiceIds).filter(
      (k) => selectedServiceIds[k]
    );
    const chosen = services.filter((s) => ids.includes(s.id));
    const total = chosen.reduce(
      (sum, s) => sum + (Number(s.durationMin) || 0),
      0
    );
    return { chosen, total };
  }, [selectedServiceIds, services]);

  // ================= reserve logic =================
  async function openServiceModal(hour) {
    if (!userId) {
      showAlert("שגיאה", "צריך להיות מחובר כדי לשריין");
      return;
    }

    if (isAppointmentPast(selectedDate, hour)) {
      showAlert("לא ניתן לשריין", "השעה הזו כבר עברה.");
      return;
    }

    if (myRes?.appointmentId && myRes?.status !== "rejected") {
      showAlert(
        "שגיאה",
        "כבר יש לך תור פעיל. בטלי קודם כדי לשריין חדש."
      );
      return;
    }

    if (appointmentByHour[hour]) {
      showAlert("שגיאה", "השעה הזו כבר תפוסה.");
      return;
    }

    const h = normalizeHour(hour);
    const w = waitlistsByHour[h] || null;
    const now = Date.now();

    const hasHold =
      !!w?.activeUserId &&
      !!w?.holdExpiresAtMs &&
      w.holdExpiresAtMs > now;

    const holdForMe = hasHold && w.activeUserId === userId;

    if (holdForMe) {
      const ok = await confirmAction(
        "התור שמור לך עכשיו",
        "יש לך זכות ראשונים על השעה הזאת מרשימת ההמתנה.\n" +
          "אם תאשרי, תישלח בקשה לבעלת העסק והתור יופיע אצלה ברשימת התורים הממתינים.\n\n" +
          "להמשיך?"
      );

      if (!ok) {
        return;
      }
    }

    setServiceHour(hour);
    setSelectedServiceIds({});
    setServiceModalOpen(true);
  }

  async function reserveHourWithServices(startHour, chosen, totalDurationMin) {
    if (!userId) return;

    if (!totalDurationMin || totalDurationMin <= 0) {
      showAlert("חסר טיפול", "בחרי לפחות טיפול אחד כדי להמשיך.");
      return;
    }

    const startIdx = hoursSorted.indexOf(startHour);
    if (startIdx < 0) {
      showAlert("שגיאה", "השעה לא קיימת ברשימת הזמינות");
      return;
    }

    const stepMin = getSlotStepMin(hoursSorted);
    const requiredSlots = Math.ceil(totalDurationMin / stepMin);

    const slots = [];
    for (let i = 0; i < requiredSlots; i++) {
      const h = hoursSorted[startIdx + i];

      if (!h) {
        showAlert(
          "אין מספיק זמן",
          "אין מספיק זמן רציף לטיפול ביום הזה.\nאפשר להפחית טיפול או לבחור יום אחר."
        );
        return;
      }

      if (i > 0) {
        const prev = hoursSorted[startIdx + i - 1];
        if (timeToMin(h) - timeToMin(prev) !== stepMin) {
          showAlert(
            "אין רצף זמין",
            "השעות ביום הזה לא רציפות מספיק לטיפול שבחרת.\nאפשר להפחית טיפול או לבחור יום אחר."
          );
          return;
        }
      }

      if (appointmentByHour[h]) {
        showAlert(
          "אין אפשרות להאריך",
          `כדי להשלים את הטיפול צריך גם את ${h}, אבל התור הזה תפוס.\nאפשר להפחית טיפול או לבחור יום אחר.`
        );
        return;
      }

      if (isAppointmentPast(selectedDate, h)) {
        showAlert("לא ניתן", "חלק מהזמן שנדרש כבר עבר.");
        return;
      }

      slots.push(h);
    }

    const [y, m, d] = selectedDate.split("-").map(Number);
    const [sh, sm] = startHour.split(":").map(Number);
    const startAtDate = new Date(
      y,
      (m || 1) - 1,
      d || 1,
      sh || 0,
      sm || 0,
      0,
      0
    );

    const groupId = makeAppointmentDocId(selectedDate, startHour);
    const userResRef = doc(db, "userReservations", userId);
    const requestRef = doc(db, "appointmentRequests", groupId);

    const servicesSelected = chosen.map((s) => ({
      id: s.id,
      name: s.name,
      durationMin: s.durationMin,
    }));

    const userEmail = auth.currentUser?.email || "";

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
        for (const r of slotRefs) {
          slotSnaps.push(await tx.get(r));
        }

        for (let i = 0; i < slotSnaps.length; i++) {
          if (slotSnaps[i].exists()) {
            throw new Error(
              `השעה ${slots[i]} נתפסה הרגע. נסי שעה אחרת או יום אחר.`
            );
          }
        }

        const waitRef = doc(
          db,
          WAITLIST_COLLECTION,
          makeWaitlistDocId(selectedDate, startHour)
        );
        const waitSnap = await tx.get(waitRef);

        for (let i = 0; i < slots.length; i++) {
          const h = slots[i];
          const appointmentRef = doc(
            db,
            "appointments",
            makeAppointmentDocId(selectedDate, h)
          );

          tx.set(appointmentRef, {
            date: selectedDate,
            hour: h,
            userId,
            userEmail,
            status: "pending",

            groupId,
            isHead: i === 0,
            headHour: startHour,
            slots,

            servicesSelected,
            totalDurationMin,
            startAt: startAtDate,

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
          userEmail,
          status: "pending",
          slots,
          servicesSelected,
          totalDurationMin,
          createdAt: serverTimestamp(),
        });

        if (waitSnap.exists()) {
          const wdata = waitSnap.data() || {};
          const q = Array.isArray(wdata.queue) ? wdata.queue : [];
          const uids = Array.isArray(wdata.userIds) ? wdata.userIds : [];

          const newQ = q.filter((x) => x?.userId !== userId);
          const newUids = uids.filter((id) => id !== userId);

          if (newQ.length > 0) {
            tx.update(waitRef, {
              queue: newQ,
              userIds: newUids,
              activeUserId: null,
              holdExpiresAtMs: null,
            });
          } else {
            tx.delete(waitRef);
          }
        }
      });

      const endTime = minToTime(timeToMin(startHour) + totalDurationMin);

      try {
        if (Platform.OS === "web") {
          const toEmail = userEmail || auth.currentUser?.email || "";
          const clientName = auth.currentUser?.displayName || "לקוחה";

          if (toEmail) {
            await sendAppointmentPendingEmail({
              toEmail,
              clientName,
              date: selectedDate,
              time: startHour,
              businessName: "Rotem Studio Nails",
              servicesSelected,
            });
          } else {
            console.log("⚠️ אין אימייל למשתמש – לא נשלח מייל נקלט");
          }
        } else {
          console.log("📧 דילוג על שליחת מייל – לא Web (iOS/Android)");
        }
      } catch (mailErr) {
        console.log("❌ sendAppointmentPendingEmail error:", mailErr);
      }

      showAlert(
        "הבקשה נשלחה ✅",
        `נשלחה בקשה לאישור:\nהתחלה ${startHour} • סיום משוער ${endTime}\nנתפסו: ${slots.join(
          ", "
        )}`
      );
    } catch (e) {
      console.log("❌ reserveHourWithServices error:", e);
      showAlert("שגיאה", e?.message || "לא הצליח לשריין תור");
    }
  }

  async function cancelMyRequest(app) {
    if (!userId) return;

    if (!app?.groupId || !Array.isArray(app?.slots) || !app.slots.length) {
      showAlert("שגיאה", "לא נמצאו פרטי ביטול לתור");
      return;
    }

    if (isAppointmentPast(app?.date, app?.hour)) {
      showAlert("לא ניתן לבטל", "התור כבר עבר ולכן אי אפשר לבטל.");
      return;
    }

    const ok = await confirmAction("ביטול בקשה", "לבטל את הבקשה?");
    if (!ok) return;

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

      showAlert("בוצע", "הבקשה בוטלה");
    } catch (e) {
      console.log("❌ cancelMyRequest error:", e);
      showAlert("שגיאה", e?.message || "לא הצליח לבטל בקשה");
    }

    await ensureHoldIfNeeded(selectedDate, app.hour);
  }

  async function cancelApprovedReservation(app) {
    if (!userId) return;

    if (!app?.groupId || !Array.isArray(app?.slots) || !app.slots.length) {
      showAlert("שגיאה", "לא נמצאו פרטי ביטול לתור");
      return;
    }

    if (!app?.isHead) {
      showAlert("שגיאה", "אפשר לבטל רק מהשעה הראשונה של התור");
      return;
    }

    if (isAppointmentPast(app?.date, app?.hour)) {
      showAlert("לא ניתן לבטל", "התור כבר עבר ולכן אי אפשר לבטל.");
      return;
    }

    const ok = await confirmAction("ביטול תור", "לבטל את התור המאושר?");
    if (!ok) return;

    const groupId = app.groupId;
    const userResRef = doc(db, "userReservations", userId);
    const historyRef = doc(db, "users", userId, "history", groupId);

    try {
      await runTransaction(db, async (tx) => {
        const urSnap = await tx.get(userResRef);

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

      showAlert("בוצע", "התור בוטל בהצלחה");
    } catch (e) {
      console.log("❌ cancelApprovedReservation error:", e);
      showAlert("שגיאה", e?.message || "לא הצליח לבטל תור");
    }

    await ensureHoldIfNeeded(selectedDate, app.hour);
  }

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

  // ================= UI =================
  return (
    <ImageBackground source={bgSource} style={styles.bg} resizeMode="cover">
      {/* שכבת לבן שקופה מעל הרקע */}
      <View style={styles.overlay}>
        <View
          style={[
            globalStyles.container,
            {
              backgroundColor: "transparent", // ✅ שלא יסתיר את התמונה
            },
          ]}
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
            <Text
              style={{
                fontSize: 22,
                fontWeight: "900",
                textAlign: "center",
                color: colors.primary,
              }}
            >
              תורים ליום {selectedDate}
            </Text>

            <Text
              style={{
                marginTop: 6,
                textAlign: "center",
                color: "#444",
                fontWeight: "800",
              }}
            >
              כל שריון נשלח לאישור בעלת העסק
            </Text>
          </View>

          {loading ? (
            <View style={{ marginTop: 30, alignItems: "center" }}>
              <ActivityIndicator />
              <Text style={{ marginTop: 10, color: "gray" }}>טוען שעות…</Text>
            </View>
          ) : hoursVisible.length === 0 ? (
            <Text
              style={{ textAlign: "center", color: "gray", marginTop: 30 }}
            >
              אין שעות זמינות ביום הזה. בחרי תאריך אחר.
            </Text>
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 90 }}
              showsVerticalScrollIndicator={false}
            >
              {hoursVisible.map((hour) => {
                if (hiddenMineHours.has(hour)) {
                  return null;
                }

                const app = appointmentByHour[hour];
                const isReserved = !!app;
                const isMine = isReserved && app?.userId === userId;
                const status = app?.status || null;

                const canReserveBase =
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

                const w = waitlistsByHour[hour] || null;
                const queue = Array.isArray(w?.queue) ? w.queue : [];

                const myIdx = userId
                  ? queue.findIndex((x) => x?.userId === userId)
                  : -1;
                const inWaitlist = myIdx >= 0;

                const now = Date.now();
                const hasHold =
                  !!w?.activeUserId &&
                  !!w?.holdExpiresAtMs &&
                  w.holdExpiresAtMs > now;

                const holdForMe = hasHold && w.activeUserId === userId;

                const blockedByHold = !isReserved && hasHold && !holdForMe;

                const canReserveFinal = canReserveBase && !blockedByHold;

                const showWaitlistButton =
                  !!userId &&
                  !canReserveFinal &&
                  ((isReserved && !isMine) ||
                    blockedByHold ||
                    queue.length > 0);

                let waitPositionText = "";
                if (userId) {
                  if (inWaitlist && queue.length > 0) {
                    const position = myIdx + 1;

                    if (holdForMe) {
                      waitPositionText =
                        `✅ התור שמור עבורך למשך ${HOLD_MINUTES} דקות.\n` +
                        `המיקום שלך בתור: ${position}\n` +
                        "לחצי על 'קביעת תור' כדי לאשר ולקבל את התור.";
                    } else {
                      waitPositionText = `המיקום שלך בתור: ${position}`;
                    }
                  } else if (showWaitlistButton && queue.length > 0) {
                    waitPositionText = `יש ${queue.length} בתור`;
                    if (blockedByHold) {
                      waitPositionText =
                        `התור שמור כרגע ללקוחה אחרת למשך עד ${HOLD_MINUTES} דקות • ` +
                        waitPositionText;
                    }
                  }
                }

                return (
                  <View key={hour}>
                    <HourSlot
                      hour={hour}
                      isReserved={isReserved}
                      isMine={isMine}
                      status={status}
                      canReserve={canReserveFinal}
                      canCancelRequest={canCancelRequest}
                      onReserve={() => openServiceModal(hour)}
                      onCancelRequest={
                        canCancelRequest ? () => cancelMyRequest(app) : undefined
                      }
                      onCancel={
                        canCancelApproved
                          ? () => cancelApprovedReservation(app)
                          : undefined
                      }
                      showWaitlistButton={showWaitlistButton}
                      inWaitlist={inWaitlist}
                      waitPositionText={waitPositionText}
                      onWaitlistToggle={() =>
                        toggleWaitlist(selectedDate, hour)
                      }
                    />

                    {isMine &&
                    Array.isArray(app?.servicesSelected) &&
                    app.servicesSelected.length > 0 ? (
                      <Text
                        style={{
                          marginTop: -2,
                          marginBottom: 8,
                          textAlign: "center",
                          color: "#555",
                        }}
                      >
                        {`טיפולים: ${app.servicesSelected
                          .map((s) => s.name)
                          .join(", ")} • ${formatDuration(
                          app.totalDurationMin || 0
                        )}`}
                        {Array.isArray(app?.slots) && app.slots.length > 1
                          ? ` • נתפסו: ${app.slots.join(", ")}`
                          : ""}
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
            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(0,0,0,0.35)",
                justifyContent: "center",
                padding: 16,
              }}
            >
              <View
                style={{
                  backgroundColor: "#fff",
                  borderRadius: 14,
                  padding: 16,
                }}
              >
                <Text
                  style={{
                    fontSize: 18,
                    fontWeight: "900",
                    textAlign: "center",
                  }}
                >
                  בחרי טיפולים לשעה {serviceHour}
                </Text>

                <Text
                  style={{
                    marginTop: 6,
                    textAlign: "center",
                    color: "#666",
                    fontWeight: "700",
                  }}
                >
                  אפשר לבחור יותר מטיפול אחד
                </Text>

                <View style={{ marginTop: 14 }}>
                  {services.map((s, idx) => {
                    const checked = !!selectedServiceIds[s.id];
                    return (
                      <Pressable
                        key={`${s.id}_${s.name}_${idx}`}
                        onPress={() =>
                          setSelectedServiceIds((prev) => ({
                            ...prev,
                            [s.id]: !prev[s.id],
                          }))
                        }
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
                        <Text style={{ fontWeight: "800", color: "#555" }}>
                          {formatDuration(s.durationMin)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text
                  style={{
                    textAlign: "center",
                    fontWeight: "900",
                    marginTop: 4,
                    color: "#333",
                  }}
                >
                  סה״כ זמן: {formatDuration(selectedServices.total)}
                </Text>

                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    marginTop: 14,
                    gap: 10,
                  }}
                >
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
                        showAlert(
                          "חסר טיפול",
                          "בחרי לפחות טיפול אחד כדי להמשיך."
                        );
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
                    <Text
                      style={{
                        fontWeight: "900",
                        color: "#fff",
                      }}
                    >
                      אישור שריון
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>

          {/* Back */}
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 14,
              paddingHorizontal: 16,
            }}
          >
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
