/* eslint-disable */
const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();

/**
 * ✅ יצירת מסמך משתמש אוטומטי ב-Firestore כשנוצר משתמש ב-Auth
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

        // ✅ ברירת מחדל: לקוח (כדי שנוכל לבדוק הרשאות למחיקה)
        role: "customer",

        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  return null;
});

/**
 * ✅ מחיקה מלאה של משתמש (Firestore + Auth)
 * callable function: ownerDeleteUserFully({ uid })
 *
 * הרשאה: רק מי שיש לו role=owner/admin במסמך users/{callerUid}
 */
exports.ownerDeleteUserFully = functions.https.onCall(async (data, context) => {
  // חייבים להיות מחוברים
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Not logged in");
  }

  const targetUid = data?.uid;
  if (!targetUid) {
    throw new functions.https.HttpsError("invalid-argument", "Missing uid");
  }

  const callerUid = context.auth.uid;

  // לא למחוק את עצמך
  if (callerUid === targetUid) {
    throw new functions.https.HttpsError("failed-precondition", "Cannot delete yourself");
  }

  // בדיקת הרשאה (role)
  const callerSnap = await db.doc(`users/${callerUid}`).get();
  const callerRole = callerSnap.exists ? callerSnap.data()?.role : null;

  if (callerRole !== "owner" && callerRole !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Not allowed");
  }

  // ✅ BulkWriter למחיקה יעילה
  const bulk = db.bulkWriter();

  async function deleteByQuery(query) {
    // אם יש הרבה מסמכים, אפשר לעשות לולאה עם limit.
    // כרגע: מוחק את כל מה שה-query מחזיר.
    const snap = await query.get();
    snap.docs.forEach((d) => bulk.delete(d.ref));
    return snap.size;
  }

  // 1) למחוק את כל התורים שהמשתמש קבע
  await deleteByQuery(db.collection("appointments").where("userId", "==", targetUid));

  // 2) למחוק את כל רשומות ה-waitlists שלו
  await deleteByQuery(db.collection("waitlists").where("userId", "==", targetUid));

  // 3) למחוק מסמכים חד-חד-ערכיים
  bulk.delete(db.doc(`userReservations/${targetUid}`));
  bulk.delete(db.doc(`users/${targetUid}`));

  await bulk.close();

  // 4) למחוק את המשתמש מ-Firebase Auth (זה מה שמונע ממנו להתחבר שוב!)
  try {
    await admin.auth().deleteUser(targetUid);
  } catch (e) {
    // אם הוא כבר לא קיים — לא נכשיל
    if (e?.code !== "auth/user-not-found") {
      throw new functions.https.HttpsError("internal", e?.message || "Auth delete failed");
    }
  }

  return { ok: true };
});
