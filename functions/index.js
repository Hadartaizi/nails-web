/* eslint-disable */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();
const db = admin.firestore();

/**
 * =========================
 * ✅ MAIL (Gmail) Setup
 * =========================
 * צריך להגדיר:
 * firebase functions:config:set gmail.user="xxx@gmail.com" gmail.pass="APP_PASSWORD"
 * ואז:
 * firebase deploy --only functions
 */
const GMAIL_USER = functions.config()?.gmail?.user;
const GMAIL_PASS = functions.config()?.gmail?.pass;

const transporter =
  GMAIL_USER && GMAIL_PASS
    ? nodemailer.createTransport({
        service: "gmail",
        auth: { user: GMAIL_USER, pass: GMAIL_PASS },
      })
    : null;

function toDateTime(dateStr, hourStr) {
  const [y, m, d] = String(dateStr || "").split("-").map(Number);
  const [hh, mm = 0] = String(hourStr || "").split(":").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
}

function buildEmail({ to, subject, html }) {
  return {
    from: `"צוות התמיכה" <${GMAIL_USER}>`,
    to,
    subject,
    html,
  };
}

/**
 * =========================
 * ✅ 0) Helpers (Waitlist Hold)
 * =========================
 */
const WAITLIST_COLLECTION = "waitlists";
const HOLD_MS = 30 * 60 * 1000; // 30 דקות
const BATCH_LIMIT = 200;

function makeAppointmentDocId(date, hour) {
  const safeHour = String(hour || "").replace(":", "-");
  return `${date}_${safeHour}`;
}

/**
 * =========================
=======
>>>>>>> a9a2328930efef57e6a08f2505e2295deba56b79
 * ✅ 1) יצירת מסמך משתמש אוטומטי ב-Firestore כשנוצר משתמש ב-Auth
 * =========================
 */
exports.onAuthUserCreate = functions.auth.user().onCreate(async (user) => {
  const uid = user.uid;
  const email = user.email || null;

  const displayName = user.displayName || "";
  const parts = displayName.trim().split(" ").filter(Boolean);
  const firstName = parts[0] || "";
  const lastName = parts.slice(1).join(" ") || "";

  await db
    .collection("users")
    .doc(uid)
    .set(
      {
        uid,
        email,
        firstName,
        lastName,
        displayName: user.displayName || null,
        phone: user.phoneNumber || null,
        role: "customer",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  return null;
});

/**
 * =========================
 * ✅ 2) מחיקה מלאה של משתמש (Firestore + Auth)
 * =========================
 */
exports.ownerDeleteUserFully = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Not logged in");
  }

  const targetUid = data?.uid;
  if (!targetUid) {
    throw new functions.https.HttpsError("invalid-argument", "Missing uid");
  }

  const callerUid = context.auth.uid;
  if (callerUid === targetUid) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Cannot delete yourself"
    );
  }

  const callerSnap = await db.doc(`users/${callerUid}`).get();
  const callerRole = callerSnap.exists ? callerSnap.data()?.role : null;

  if (callerRole !== "owner" && callerRole !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Not allowed");
  }

  const bulk = db.bulkWriter();

  async function deleteByQuery(q) {
    const snap = await q.get();
    snap.docs.forEach((d) => bulk.delete(d.ref));
    return snap.size;
  }

  await deleteByQuery(
    db.collection("appointments").where("userId", "==", targetUid)
  );

  // ✅ תיקון: אצלך waitlists בנוי עם userIds array
  await deleteByQuery(
    db.collection("waitlists").where("userIds", "array-contains", targetUid)
  );

  await deleteByQuery(db.collection("waitlists").where("userId", "==", targetUid));

  bulk.delete(db.doc(`userReservations/${targetUid}`));
  bulk.delete(db.doc(`users/${targetUid}`));

  await bulk.close();

  try {
    await admin.auth().deleteUser(targetUid);
  } catch (e) {
    if (e?.code !== "auth/user-not-found") {
      throw new functions.https.HttpsError(
        "internal",
        e?.message || "Auth delete failed"
      );
    }
  }

  return { ok: true };
});

/**
 * =========================
 * ✅ 3) יצירת תזכורות (מייל + PUSH) כאשר תור הופך ל-approved
 * =========================
 * תנאים:
 * - status משתנה ל "approved"
 * - isHead === true (רק השעה הראשונה)
 * - קיים userEmail במסמך
 */
exports.onAppointmentApprovedCreateReminders = functions.firestore
  .document("appointments/{appointmentId}")
  .onWrite(async (change, context) => {
    const after = change.after.exists ? change.after.data() : null;
    const before = change.before.exists ? change.before.data() : null;

    // נמחק? אין מה לעשות
    if (!after) return null;

    // פועלים רק במעבר ל-approved
    const beforeStatus = before?.status || null;
    const afterStatus = after?.status || null;
    if (afterStatus !== "approved") return null;
    if (beforeStatus === "approved") return null;

    // רק שעה ראשונה של התור
    if (!after?.isHead) return null;

    // חייב אימייל
    const userEmail = String(after?.userEmail || "").trim();
    if (!userEmail) {
      console.log(
        "⚠️ No userEmail on appointment. Add userEmail to appointments docs."
      );
      return null;
    }

    const date = after?.date;
    const hour = after?.hour;
    if (!date || !hour) return null;

    // 👇 userId בשביל PUSH
    // 👇 חדש – נשמור גם userId בשביל PUSH
    const userId = String(after?.userId || "").trim();

    const apptDt = toDateTime(date, hour);
    const now = new Date();
    if (!(apptDt instanceof Date) || isNaN(apptDt.getTime())) return null;
    if (apptDt <= now) return null;

    const oneDayBefore = new Date(apptDt.getTime() - 24 * 60 * 60 * 1000);
    const oneHourBefore = new Date(apptDt.getTime() - 60 * 60 * 1000);

    const remindersCol = db.collection("emailReminders");

    // מזהה קבוע כדי לא ליצור כפילויות
    const groupId = String(after?.groupId || context.params.appointmentId);

    const batch = db.batch();

    // יום לפני
    if (oneDayBefore > now) {
      batch.set(
        remindersCol.doc(`${groupId}_1d`),
        {
          groupId,
          type: "1d",
          userId,
          userId, // 👈 בשביל PUSH
          to: userEmail,
          date,
          hour,
          sendAt: admin.firestore.Timestamp.fromDate(oneDayBefore),
          sent: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    // שעה לפני
    if (oneHourBefore > now) {
      batch.set(
        remindersCol.doc(`${groupId}_1h`),
        {
          groupId,
          type: "1h",
          userId,

          userId, // 👈 בשביל PUSH
          to: userEmail,
          date,
          hour,
          sendAt: admin.firestore.Timestamp.fromDate(oneHourBefore),
          sent: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    await batch.commit();
    console.log("✅ Reminders created:", groupId);
    return null;
  });

/**
 * =========================
 * ✅ 4) שליחת התזכורות שמגיע זמנן (כל 5 דקות) – מייל + PUSH
 * =========================
 * חשוב:
 * - אם אין הגדרות מייל (gmail.user/gmail.pass) → נדלג רק על שליחת המייל,
 *   אבל עדיין נשלח PUSH אם יש webFcmToken למשתמש.
 */
exports.sendDueEmailReminders = functions.pubsub
  .schedule("every 5 minutes")
  .timeZone("Asia/Jerusalem")
  .onRun(async () => {
    const nowTs = admin.firestore.Timestamp.fromDate(new Date());

    const snap = await db
      .collection("emailReminders")
      .where("sent", "==", false)
      .where("sendAt", "<=", nowTs)
      .limit(25)
      .get();

    if (snap.empty) {
      console.log("No due reminders.");
      return null;
    }

    for (const docSnap of snap.docs) {
      const r = docSnap.data() || {};
      const to = String(r.to || "").trim();
      const date = String(r.date || "").trim();
      const hour = String(r.hour || "").trim();
      const type = r.type;

      // const userId = String(r.userId || "").trim();

      const userId = String(r.userId || "").trim(); // 👈 חשוב ל-PUSH

      const subject =
        type === "1d"
          ? "תזכורת לתור מחר 🗓️"
          : "תזכורת: התור בעוד שעה ⏰";

      const html =
        type === "1d"
          ? `<p>שלום,</p>
             <p>תזכורת: יש לך תור <b>מחר</b> בתאריך <b>${date}</b> בשעה <b>${hour}</b>.</p>
             <p>בברכה,<br/>צוות התמיכה</p>`
          : `<p>שלום,</p>
             <p>תזכורת: התור שלך בעוד <b>שעה</b> — היום בשעה <b>${hour}</b> (תאריך <b>${date}</b>).</p>
             <p>בברכה,<br/>צוות התמיכה</p>`;

<<<<<<< HEAD
      // 1) מייל
=======
      // --- 1) שליחת מייל (רק אם יש transporter וגם יש כתובת) ---
>>>>>>> a9a2328930efef57e6a08f2505e2295deba56b79
      if (transporter && to) {
        try {
          await transporter.sendMail(buildEmail({ to, subject, html }));
          console.log("✅ Sent email reminder:", docSnap.id, "to", to);
        } catch (err) {
          console.log("❌ Failed sending email:", docSnap.id, err?.message);

          await docSnap.ref.set(
            {
              lastError: String(err?.message || "unknown"),
              tries: admin.firestore.FieldValue.increment(1),
            },
            { merge: true }
          );
        }
      } else {
        if (!transporter) {
          console.log(
            "⚠️ transporter not configured, skipping email for",
            docSnap.id
          );
        } else if (!to) {
          console.log("⚠️ missing 'to' email for", docSnap.id);
        }
      }

<<<<<<< HEAD
      // 2) PUSH
=======
      // --- 2) PUSH דרך FCM (webFcmToken) – לא תלוי במייל ---
>>>>>>> a9a2328930efef57e6a08f2505e2295deba56b79
      if (userId) {
        try {
          const userSnap = await db.collection("users").doc(userId).get();
          if (userSnap.exists) {
            const userData = userSnap.data() || {};
<<<<<<< HEAD
            const token = userData.webFcmToken;
=======
            const token = userData.webFcmToken; // 👈 מה ששמרת מהפרונט
>>>>>>> a9a2328930efef57e6a08f2505e2295deba56b79

            if (token) {
              const pushTitle =
                type === "1d"
                  ? "תזכורת לתור מחר 💅"
                  : "תזכורת: התור בעוד שעה 💅";

              const pushBody =
                type === "1d"
                  ? `יש לך תור מחר ב-${hour} (תאריך ${date})`
                  : `יש לך תור היום ב-${hour} (תאריך ${date})`;

              await admin.messaging().send({
                token,
                notification: {
                  title: pushTitle,
                  body: pushBody,
                },
                data: {
                  type:
                    type === "1d"
                      ? "appointment_reminder_24h"
                      : "appointment_reminder_1h",
                  date,
                  hour,
                },
              });

              console.log(
                "✅ Sent PUSH reminder for",
                docSnap.id,
                "to user",
                userId
              );
            } else {
              console.log("⚠️ no webFcmToken for user", userId);
            }
          } else {
            console.log("⚠️ user doc not found for", userId);
          }
        } catch (err) {
          console.log(
            "❌ error sending PUSH reminder for",
            docSnap.id,
            "user",
            userId,
            err?.message
          );
        }
      }

<<<<<<< HEAD
      // 3) סימון sent
=======
      // --- 3) סימון שהתזכורת טופלה --- 
>>>>>>> a9a2328930efef57e6a08f2505e2295deba56b79
      await docSnap.ref.set(
        {
          sent: true,
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    return null;
  });
<<<<<<< HEAD

/**
 * =========================
 * ✅ 5) ניהול HOLD של רשימת המתנה (כל דקה)
 * =========================
 * מה זה עושה:
 * A) אם hold פג תוקף -> activeUserId יורד מהתור, וה-hold עובר לבאה בתור.
 * B) אם אין activeUserId אבל יש queue -> נותן hold לראש התור (אם אין appointment בפועל).
 *
 * ⚠️ חשוב:
 * כדי שה־UI יעבוד נכון, ב־DayScreen צריך להאזין ל-waitlists לפי date (לכולם),
 * ואז להראות "שריין" רק ל-activeUserId.
 */
exports.processWaitlistHolds = functions.pubsub
  .schedule("every 1 minutes")
  .timeZone("Asia/Jerusalem")
  .onRun(async () => {
    const now = Date.now();

    // -----------------------------
    // A) HOLD שפג תוקף -> להעביר לבאה בתור
    // -----------------------------
    const expiredSnap = await db
      .collection(WAITLIST_COLLECTION)
      .where("holdExpiresAtMs", "<=", now)
      .limit(BATCH_LIMIT)
      .get();

    for (const docSnap of expiredSnap.docs) {
      const ref = docSnap.ref;

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;

        const data = snap.data() || {};
        const activeUserId = data.activeUserId || null;
        const holdExpiresAtMs = data.holdExpiresAtMs || null;

        // אם אין active/hold או שזה לא באמת פג — לא נוגעים
        if (!activeUserId || !holdExpiresAtMs || holdExpiresAtMs > now) return;

        const queue = Array.isArray(data.queue) ? data.queue : [];
        const userIds = Array.isArray(data.userIds) ? data.userIds : [];

        // מסירים את מי שהיה active מהתור
        const newQueue = queue.filter((item) => item?.userId !== activeUserId);
        const newUserIds = userIds.filter((id) => id !== activeUserId);

        if (newQueue.length === 0) {
          // אין יותר רשימת המתנה
          tx.delete(ref);
          return;
        }

        const nextUserId = newQueue[0]?.userId || null;

        tx.update(ref, {
          queue: newQueue,
          userIds: newUserIds,
          activeUserId: nextUserId,
          holdExpiresAtMs: nextUserId ? now + HOLD_MS : null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
    }

    // -----------------------------
    // B) אין activeUserId אבל יש queue -> לתת hold לראש התור
    // -----------------------------
    const noActiveSnap = await db
      .collection(WAITLIST_COLLECTION)
      .where("activeUserId", "==", null)
      .limit(BATCH_LIMIT)
      .get();

    for (const docSnap of noActiveSnap.docs) {
      const ref = docSnap.ref;

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;

        const data = snap.data() || {};
        if (data.activeUserId) return;

        const date = data.date || null;
        const hour = data.hour || null;
        const queue = Array.isArray(data.queue) ? data.queue : [];

        if (!date || !hour || queue.length === 0) return;

        // אם כבר יש appointment בפועל – לא נותנים hold
        const apptId = makeAppointmentDocId(date, hour);
        const apptRef = db.collection("appointments").doc(apptId);
        const apptSnap = await tx.get(apptRef);
        if (apptSnap.exists) return;

        const nextUserId = queue[0]?.userId || null;
        if (!nextUserId) return;

        tx.update(ref, {
          activeUserId: nextUserId,
          holdExpiresAtMs: now + HOLD_MS,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
    }

    return null;
  });
=======
>>>>>>> a9a2328930efef57e6a08f2505e2295deba56b79
