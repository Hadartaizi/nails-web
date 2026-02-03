// frontend/firebaseConfig.js
import { initializeApp } from "firebase/app";
import {
  getAuth,
  initializeAuth,
  getReactNativePersistence,
} from "firebase/auth";
import { getFirestore, doc, setDoc } from "firebase/firestore";
import { getStorage } from "firebase/storage"; // 👈 חדש
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

// -------- בסיס: הגדרות Firebase --------
const firebaseConfig = {
  apiKey: "AIzaSyAwExdxDGLkmGMt82EcCmEkBXVdRw3qjjs",
  authDomain: "nailsdb-4655f.firebaseapp.com",
  projectId: "nailsdb-4655f",
  storageBucket: "nailsdb-4655f.firebasestorage.app",
  messagingSenderId: "170217873964",
  appId: "1:170217873964:web:1573c24a7894eb4eb12789",
  measurementId: "G-S921LZL155",
};

// Initialize app (משותף לכולם)
const app = initializeApp(firebaseConfig);

// -------- AUTH --------
let auth;

if (Platform.OS === "web") {
  // ב-WEB – getAuth רגיל (localStorage וכו')
  auth = getAuth(app);
} else {
  // במובייל – initializeAuth עם AsyncStorage
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
}

// -------- Firestore --------
const db = getFirestore(app);

// -------- Storage --------
const storage = getStorage(app); // 👈 זה מה שמאפשר לנו להעלות תמונות

// -------- WEB PUSH (firebase/messaging – Web בלבד) --------
let messaging = null;
let getToken = null;
let onMessage = null;

// מפתח VAPID ל-Web Push
const VAPID_KEY =
  "BA37Zk2HfvLdYvcPcL6oPOWR5kIyBw21vNvVbr9Ve0102VLyzQp3-m8r7Mst0hS2-7_diHyQp0h5vPwuXiJA0NY";

if (Platform.OS === "web" && typeof window !== "undefined") {
  try {
    // חשוב: משתמשים ב-require כדי שלא יישבר בבילד נייטיב
    // eslint-disable-next-line global-require
    const messagingModule = require("firebase/messaging");

    const {
      getMessaging,
      getToken: getTokenFn,
      onMessage: onMessageFn,
    } = messagingModule;

    messaging = getMessaging(app);
    getToken = getTokenFn;
    onMessage = onMessageFn;
  } catch (err) {
    console.log("Error initializing web messaging:", err?.message || err);
  }
}

/**
 * 📲 פונקציה לרישום PUSH WEB למשתמש המחובר (רק ב-WEB)
 * שומרת webFcmToken במסמך המשתמש ב-Firestore
 */
export async function setupWebPushForCurrentUser() {
  try {
    if (Platform.OS !== "web") return;
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) {
      console.log("🛑 Notifications not supported in this browser");
      return;
    }
    if (!("serviceWorker" in navigator)) {
      console.log("🛑 Service workers are not supported in this browser");
      return;
    }

    // לא מריצים ב-localhost (Expo Dev)
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      console.log("🛑 Skipping web push setup on localhost (Expo dev)");
      return;
    }

    // בקשת הרשאה מהמשתמש
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.log("❌ notifications not granted");
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      console.log("🛑 no logged in user for web push");
      return;
    }

    if (!messaging || !getToken) {
      console.log("🛑 messaging or getToken not initialized");
      return;
    }

    // 🔑 רישום מפורש של ה-Service Worker
    const registration = await navigator.serviceWorker.register(
      "/firebase-messaging-sw.js"
    );

    // 🔑 קבלת ה-token מ-FCM (קשור ל-SW)
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      console.log("❌ no FCM token returned");
      return;
    }

    console.log("✅ Web FCM token:", token);

    // שמירה במסמך המשתמש
    await setDoc(
      doc(db, "users", user.uid),
      {
        webFcmToken: token,
        webFcmUpdatedAt: new Date(),
      },
      { merge: true }
    );

    console.log("✅ webFcmToken saved in Firestore");
  } catch (err) {
    console.error("❌ setupWebPushForCurrentUser error:", err);
  }
}

// ---- מה שמייצאים החוצה ----
export { app, auth, db, messaging, getToken, onMessage, storage };
