// // logicScreen.js
// import { Alert } from "react-native";
// import {
//   collection,
//   doc,
//   query,
//   where,
//   orderBy,
//   limit,
//   getDocs,
//   getDoc,
//   runTransaction,
//   serverTimestamp,
//   deleteDoc,
// } from "firebase/firestore";
// import { auth, db } from "../firebaseConfig";

// /**
//  * Schema מומלץ ב-Firestore:
//  *
//  * appointments/{appointmentId}:
//  *  { date, hour, userId?, customerName?, customerPhone?, status: "booked" | "open", ... }
//  *
//  * waitlists/{waitlistId}:
//  *  { appointmentId, date, hour, userId, phone, name, createdAt, status: "waiting" | "notified" | "cancelled" }
//  *
//  * users/{uid}:
//  *  { firstName, lastName, phone }
//  */

// export function makeAppointmentDocId(date, hour) {
//   const safeHour = (hour || "").replace(":", "-");
//   return `${date}_${safeHour}`;
// }

// async function getMyProfile(uid) {
//   const snap = await getDoc(doc(db, "users", uid));
//   return snap.exists() ? snap.data() : null;
// }

// /**
//  * בדיקה האם אני כבר ברשימת המתנה לתור הזה
//  */
// export async function isInWaitlist(appointmentId) {
//   const uid = auth.currentUser?.uid;
//   if (!uid) return false;

//   const q = query(
//     collection(db, "waitlists"),
//     where("appointmentId", "==", appointmentId),
//     where("userId", "==", uid),
//     where("status", "in", ["waiting", "notified"])
//   );

//   const snap = await getDocs(q);
//   return !snap.empty;
// }

// /**
//  * כניסה לרשימת המתנה
//  */
// export async function joinWaitlist({ date, hour }) {
//   const uid = auth.currentUser?.uid;
//   if (!uid) {
//     Alert.alert("שגיאה", "צריך להיות מחוברת כדי להיכנס לרשימת המתנה");
//     return;
//   }

//   const appointmentId = makeAppointmentDocId(date, hour);
//   const appointmentRef = doc(db, "appointments", appointmentId);

//   try {
//     await runTransaction(db, async (tx) => {
//       const appSnap = await tx.get(appointmentRef);

//       // התור חייב להיות קיים ותפוס (אחרת אין צורך ברשימת המתנה)
//       if (!appSnap.exists()) {
//         throw new Error("התור לא קיים");
//       }

//       const appData = appSnap.data();
//       const isBooked = !!appData.userId || appData.status === "booked";
//       if (!isBooked) {
//         throw new Error("התור פנוי כרגע — אפשר לשריין ישירות");
//       }

//       // להביא פרטי משתמש
//       const me = await getMyProfile(uid);
//       const phone = (me?.phone || "").toString().replace(/[^\d]/g, "");
//       const name = `${me?.firstName || ""} ${me?.lastName || ""}`.trim();

//       if (!phone || phone.length < 9) {
//         throw new Error("חסר מספר טלפון תקין בפרופיל המשתמש");
//       }

//       // למנוע כפילות: חיפוש “האם כבר בפנים”
//       const alreadyQ = query(
//         collection(db, "waitlists"),
//         where("appointmentId", "==", appointmentId),
//         where("userId", "==", uid),
//         where("status", "in", ["waiting", "notified"])
//       );
//       const alreadySnap = await getDocs(alreadyQ);
//       if (!alreadySnap.empty) {
//         throw new Error("את כבר ברשימת ההמתנה לתור הזה");
//       }

//       // יצירת רשומת waitlist חדשה
//       const waitRef = doc(collection(db, "waitlists")); // id אוטומטי
//       tx.set(waitRef, {
//         appointmentId,
//         date,
//         hour,
//         userId: uid,
//         phone,
//         name,
//         status: "waiting",
//         createdAt: serverTimestamp(),
//       });
//     });

//     Alert.alert("נרשמת!", "נכנסת לרשימת המתנה. תקבלי SMS כשהתור יתפנה.");
//   } catch (e) {
//     Alert.alert("שגיאה", e?.message || "לא הצליח להכניס לרשימת המתנה");
//   }
// }

// /**
//  * יציאה מרשימת המתנה (ביטול)
//  */
// export async function leaveWaitlist({ date, hour }) {
//   const uid = auth.currentUser?.uid;
//   if (!uid) return;

//   const appointmentId = makeAppointmentDocId(date, hour);

//   try {
//     // מוצאים את הרשומה הפעילה של המשתמש לתור
//     const q = query(
//       collection(db, "waitlists"),
//       where("appointmentId", "==", appointmentId),
//       where("userId", "==", uid),
//       where("status", "in", ["waiting", "notified"]),
//       orderBy("createdAt", "asc"),
//       limit(1)
//     );

//     const snap = await getDocs(q);
//     if (snap.empty) {
//       Alert.alert("אין מה לבטל", "את לא ברשימת המתנה לתור הזה");
//       return;
//     }

//     const waitDoc = snap.docs[0];
//     await runTransaction(db, async (tx) => {
//       tx.update(doc(db, "waitlists", waitDoc.id), { status: "cancelled" });
//     });

//     Alert.alert("בוצע", "יצאת מרשימת ההמתנה");
//   } catch (e) {
//     Alert.alert("שגיאה", e?.message || "לא הצליח לצאת מרשימת ההמתנה");
//   }
// }

// /**
//  * לקבל תצוגה של “כמה לפניי” (אופציונלי)
//  */
// export async function getWaitlistPosition({ date, hour }) {
//   const uid = auth.currentUser?.uid;
//   if (!uid) return null;

//   const appointmentId = makeAppointmentDocId(date, hour);

//   const q = query(
//     collection(db, "waitlists"),
//     where("appointmentId", "==", appointmentId),
//     where("status", "==", "waiting"),
//     orderBy("createdAt", "asc")
//   );

//   const snap = await getDocs(q);
//   const ids = snap.docs.map((d) => d.data().userId);
//   const idx = ids.indexOf(uid);
//   if (idx === -1) return null;
//   return { position: idx + 1, total: ids.length };
// }
