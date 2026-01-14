// // frontend/notifications/registerPushToken.js
// import { Platform } from "react-native";
// import { doc, setDoc, arrayUnion } from "firebase/firestore";
// import * as Notifications from "expo-notifications";
// import Constants from "expo-constants";
// import { auth, db, app } from "../firebaseConfig";

// // ✅ VAPID KEY שלך (ל-Web)
// const VAPID_KEY =
//   "BA37Zk2HfvLdYvcPcL6oPOWR5kIyBw21vNvVbr9Ve0102VLyzQp3-m8r7Mst0hS2-7_diHyQp0h5vPwuXiJA0NY";

// let onMessageBound = false;

// export async function registerPushTokenForCurrentUser() {
//   try {
//     const uid = auth.currentUser?.uid;
//     if (!uid) return;

//     // =========================
//     // ✅ WEB: Firebase Messaging
//     // =========================
//     if (Platform.OS === "web") {
//       // חשוב: לא לייבא firebase/messaging למעלה כדי לא לשבור native
//       const mod = await import("firebase/messaging");
//       const { getMessaging, getToken, onMessage, isSupported } = mod;

//       const supported = await isSupported();
//       if (!supported) {
//         console.log("❌ FCM not supported in this browser");
//         return;
//       }

//       if (!("Notification" in window)) {
//         console.log("❌ Notifications not supported in this browser");
//         return;
//       }

//       const perm = await Notification.requestPermission();
//       if (perm !== "granted") {
//         console.log("⚠️ Notification permission denied");
//         return;
//       }

//       // ✅ חייב להיות קובץ ב-root: /firebase-messaging-sw.js
//       const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

//       const messaging = getMessaging(app);

//       const token = await getToken(messaging, {
//         vapidKey: VAPID_KEY,
//         serviceWorkerRegistration: reg,
//       });

//       if (!token) {
//         console.log("⚠️ No FCM token returned");
//         return;
//       }

//       console.log("✅ FCM Web Token:", token);

//       await setDoc(
//         doc(db, "users", uid),
//         {
//           fcmTokens: arrayUnion(token),
//           fcmUpdatedAt: new Date().toISOString(),
//         },
//         { merge: true }
//       );

//       // ✅ הודעה כשהאתר פתוח (foreground)
//       if (!onMessageBound) {
//         onMessageBound = true;

//         onMessage(messaging, (payload) => {
//           const title = payload?.notification?.title || "תור התפנה 🎉";
//           const body = payload?.notification?.body || "התור פנוי עכשיו";

//           try {
//             new Notification(title, { body });
//           } catch (e) {
//             console.log("⚠️ Notification display error:", e?.message || e);
//           }
//         });
//       }

//       return;
//     }

//     // =========================
//     // ✅ NATIVE: Expo Notifications
//     // =========================
//     if (!Constants.isDevice) {
//       console.log("⚠️ Push tokens work on physical devices");
//       return;
//     }

//     const { status: existingStatus } = await Notifications.getPermissionsAsync();
//     let finalStatus = existingStatus;

//     if (existingStatus !== "granted") {
//       const { status } = await Notifications.requestPermissionsAsync();
//       finalStatus = status;
//     }

//     if (finalStatus !== "granted") {
//       console.log("⚠️ Notification permission not granted");
//       return;
//     }

//     const tokenResp = await Notifications.getExpoPushTokenAsync();
//     const token = tokenResp?.data;
//     if (!token) return;

//     await setDoc(
//       doc(db, "users", uid),
//       { expoPushTokens: arrayUnion(token) },
//       { merge: true }
//     );

//     console.log("✅ Saved Expo push token:", token);
//   } catch (e) {
//     console.log("❌ registerPushTokenForCurrentUser error:", e?.message || e);
//   }
// }