// // frontend/notifications/registerWebPushToken.js
// import { Platform } from "react-native";
// import { doc, setDoc, arrayUnion } from "firebase/firestore";
// import {
//   getMessaging,
//   getToken,
//   onMessage,
//   isSupported,
// } from "firebase/messaging";
// import { auth, db, app } from "../firebaseConfig";

// // ✅ VAPID KEY שלך
// const VAPID_KEY =
//   "BA37Zk2HfvLdYvcPcL6oPOWR5kIyBw21vNvVbr9Ve0102VLyzQp3-m8r7Mst0hS2-7_diHyQp0h5vPwuXiJA0NY";

// let onMessageBound = false;

// // ✅ השם הזה חייב להתאים למה שיש ב-LoginScreen
// export async function registerWebPushToken() {
//   try {
//     if (Platform.OS !== "web") return;

//     const uid = auth.currentUser?.uid;
//     if (!uid) return;

//     const supported = await isSupported();
//     if (!supported) {
//       console.log("❌ FCM not supported in this browser");
//       return;
//     }

//     if (!("Notification" in window)) {
//       console.log("❌ Notifications not supported in this browser");
//       return;
//     }

//     const perm = await Notification.requestPermission();
//     if (perm !== "granted") {
//       console.log("⚠️ Notification permission denied");
//       return;
//     }

//     // ✅ חייב להיות קובץ ב-root: /firebase-messaging-sw.js
//     const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

//     const messaging = getMessaging(app);

//     const token = await getToken(messaging, {
//       vapidKey: VAPID_KEY,
//       serviceWorkerRegistration: reg,
//     });

//     if (!token) {
//       console.log("⚠️ No FCM token returned");
//       return;
//     }

//     console.log("✅ FCM Web Token:", token);

//     await setDoc(
//       doc(db, "users", uid),
//       {
//         fcmTokens: arrayUnion(token),
//         fcmUpdatedAt: new Date().toISOString(),
//       },
//       { merge: true }
//     );

//     // ✅ הודעה כשהאתר פתוח (foreground)
//     if (!onMessageBound) {
//       onMessageBound = true;

//       onMessage(messaging, (payload) => {
//         const title = payload?.notification?.title || "תור התפנה 🎉";
//         const body = payload?.notification?.body || "התור שלך פנוי עכשיו";

//         try {
//           new Notification(title, { body });
//         } catch (e) {
//           console.log("⚠️ Notification display error:", e?.message || e);
//         }
//       });
//     }
//   } catch (e) {
//     console.log("❌ registerWebPushToken error:", e?.message || e);
//   }
// }
