import { auth, db } from "../firebaseConfig";
import { getMessaging, getToken } from "firebase/messaging";
import { doc, setDoc } from "firebase/firestore";

const VAPID_KEY =
  "BA37Zk2HfvLdYvcPcL6oPOWR5kIyBw21vNvVbr9Ve0102VLyzQp3-m8r7Mst0hS2-7_diHyQp0h5vPwuXiJA0NY";

export async function setupWebPushForCurrentUser() {
  try {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (!("serviceWorker" in navigator)) {
      console.log("🛑 Service workers are not supported in this browser");
      return;
    }

    // 👇 חדש – לא מנסים לרשום Service Worker ב־localhost (Expo dev)
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      console.log("🛑 Skipping web push setup on localhost (Expo dev)");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.log("❌ notifications not granted");
      return;
    }

    const user = auth.currentUser;
    if (!user) return;

    // 🔑 1️⃣ רישום מפורש של ה-Service Worker (ב-Hosting אמיתי)
    const registration = await navigator.serviceWorker.register(
      "/firebase-messaging-sw.js"
    );

    const messaging = getMessaging();

    // 🔑 2️⃣ חיבור ה-SW ל-token
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      console.log("❌ no FCM token");
      return;
    }

    console.log("✅ FCM token (bound to SW):", token);

    await setDoc(
      doc(db, "users", user.uid),
      {
        webFcmToken: token,
        webFcmUpdatedAt: new Date(),
      },
      { merge: true }
    );

    console.log("✅ webFcmToken saved");
  } catch (err) {
    console.error("❌ setupWebPushForCurrentUser error:", err);
  }
}
