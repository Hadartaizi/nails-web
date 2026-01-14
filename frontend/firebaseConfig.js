// frontend/firebaseConfig.js
import { initializeApp } from "firebase/app";
import { initializeAuth, getReactNativePersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore"; // ✅ לא lite
import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: "AIzaSyAwExdxDGLkmGMt82EcCmEkBXVdRw3qjjs",
  authDomain: "nailsdb-4655f.firebaseapp.com",
  projectId: "nailsdb-4655f",
  storageBucket: "nailsdb-4655f.firebasestorage.app",
  messagingSenderId: "170217873964",
  appId: "1:170217873964:web:1573c24a7894eb4eb12789",
  measurementId: "G-S921LZL155",
};

const app = initializeApp(firebaseConfig);

export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

export const db = getFirestore(app);
