// frontend/screens/WaitingList.js
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";

import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  runTransaction,
} from "firebase/firestore";

import { auth, db } from "../firebaseConfig";
import globalStyles from "../styles/global";
import colors from "../styles/colors";

// ✅ מייבאים את הפונקציה שמטפלת ב-HOLD ושולחת מייל
import { ensureHoldIfNeeded } from "./DayScreen";

const WAITLIST_COLLECTION = "waitlists";

function showAlert(title, message) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message || ""}`);
  } else {
    Alert.alert(title, message || "");
  }
}

// נראות יפה של התאריך + השעה
function buildTitle(date, hour) {
  if (!date && !hour) return "תור";
  if (date && !hour) return `תור ליום ${date}`;
  if (!date && hour) return `תור בשעה ${hour}`;
  return `תור ליום ${date} בשעה ${hour}`;
}

export default function WaitingListScreen({ navigation }) {
  const user = auth.currentUser;
  const userId = user?.uid || null;

  const [loading, setLoading] = useState(true);

  // [{ id, date, hour, slots, myPosition, queueLength, activeUserId, holdExpiresAtMs }]
  const [myWaitlists, setMyWaitlists] = useState([]);

  // ✅ מאזין לרשימות המתנה שהמשתמש נמצא בהן
  useEffect(() => {
    if (!userId) {
      setMyWaitlists([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(db, WAITLIST_COLLECTION),
      where("userIds", "array-contains", userId)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const arr = [];

        snap.docs.forEach((d) => {
          const data = d.data() || {};
          const queue = Array.isArray(data.queue) ? data.queue : [];

          // מחשבים מיקום אמיתי לפי queue
          const idx = queue.findIndex((item) => item?.userId === userId);

          // אם המשתמש לא נמצא באמת ב-queue -> לא מציגים (נחשב "הוסר")
          if (idx < 0) return;

          const nowMs = Date.now();
          const activeUserId = data.activeUserId || null;
          const holdExpiresAtMs = Number(data.holdExpiresAtMs || 0);

          // ✅ אם היה לי HOLD והוא כבר פג – מנקים ב-Firestore ולא מציגים ברשימה
          if (
            activeUserId === userId &&
            holdExpiresAtMs > 0 &&
            holdExpiresAtMs <= nowMs
          ) {
            // מנקה ומעביר HOLD למישהי אחרת / משחרר את התור
            if (data.date && data.hour) {
              ensureHoldIfNeeded(data.date, data.hour);
            }
            // לא מכניס את התור לרשימה על המסך
            return;
          }

          arr.push({
            id: d.id,
            ...data,
            myPosition: idx + 1,
            queueLength: queue.length,
          });
        });

        // מיון לפי תאריך + שעה
        arr.sort((a, b) => {
          const ad = a.date || "";
          const bd = b.date || "";
          if (ad < bd) return -1;
          if (ad > bd) return 1;

          const ah = a.hour || "";
          const bh = b.hour || "";
          if (ah < bh) return -1;
          if (ah > bh) return 1;

          return 0;
        });

        setMyWaitlists(arr);
        setLoading(false);
      },

      (err) => {
        console.log("❌ waitlists listen error:", err?.code, err?.message);
        showAlert("שגיאה", "לא הצלחנו לטעון את רשימת ההמתנה");
        setMyWaitlists([]);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [userId]);

  // ✅ יציאה מרשימת המתנה
// ✅ יציאה מרשימת המתנה
async function leaveWaitlist(waitDoc) {
  if (!userId || !waitDoc?.id) return;

  const ok = await new Promise((resolve) => {
    const msg =
      "לבטל את ההמתנה לתור הזה?\nלא תקבלי יותר התראה כשהתור יתפנה.";
    if (Platform.OS === "web") {
      resolve(window.confirm(msg));
    } else {
      Alert.alert("ביטול רשימת המתנה", msg, [
        { text: "לא", style: "cancel", onPress: () => resolve(false) },
        { text: "כן", style: "destructive", onPress: () => resolve(true) },
      ]);
    }
  });

  if (!ok) return;

  const ref = doc(db, WAITLIST_COLLECTION, waitDoc.id);

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;

      const data = snap.data() || {};
      const queue = Array.isArray(data.queue) ? data.queue : [];
      const userIds = Array.isArray(data.userIds) ? data.userIds : [];

      const newQueue = queue.filter((item) => item?.userId !== userId);
      const newUserIds = userIds.filter((id) => id !== userId);

      if (newQueue.length === 0) {
        // אין יותר אף אחת ברשימה – מוחקים מסמך
        tx.delete(ref);
        return;
      }

      // אם המשתמש היה activeUserId – מנקים כדי שהמערכת תעביר לבאה בתור
      const updates = {
        queue: newQueue,
        userIds: newUserIds,
      };

      if (data.activeUserId === userId) {
        updates.activeUserId = null;
        updates.holdExpiresAtMs = null;
      }

      tx.update(ref, updates);
    });

    // ⭐ אחרי שיצאת מהרשימה – אם השעה פנויה ויש עוד ממתינות,
    // הפונקציה הזו תיתן HOLD לראשונה בתור ותשלח לה מייל
    await ensureHoldIfNeeded(waitDoc.date, waitDoc.hour);

    showAlert("בוצע", "יצאת מרשימת ההמתנה לתור הזה");
  } catch (e) {
    console.log("❌ leaveWaitlist error:", e);
    showAlert("שגיאה", e?.message || "לא ניתן היה לבטל את ההמתנה");
  }
}

  const hasItems = useMemo(() => myWaitlists.length > 0, [myWaitlists]);

  return (
    <View style={[globalStyles.container, { backgroundColor: "transparent" }]}>
      {/* Header */}
      <View
        style={{
          paddingVertical: 12,
          marginBottom: 10,
          borderBottomWidth: 1,
          borderBottomColor: colors.border || "#ddd",
        }}
      >
        <Text
          style={{
            fontSize: 22,
            fontWeight: "900",
            textAlign: "center",
            color: colors.primary || "#000",
          }}
        >
          רשימת המתנה
        </Text>

        <Text
          style={{
            marginTop: 6,
            textAlign: "center",
            color: "#444",
            fontWeight: "700",
          }}
        >
          כאן תראי את כל התורים שאת מחכה להם
        </Text>
      </View>

      {loading ? (
        <View style={{ marginTop: 30, alignItems: "center" }}>
          <ActivityIndicator />
          <Text style={{ marginTop: 10, color: "gray" }}>
            טוען רשימת המתנה…
          </Text>
        </View>
      ) : !hasItems ? (
        <View
          style={{ marginTop: 30, alignItems: "center", paddingHorizontal: 16 }}
        >
          <Text style={{ textAlign: "center", color: "gray", fontSize: 16 }}>
            כרגע אינך נמצאת באף רשימת מתנה.
          </Text>
          <Text
            style={{
              marginTop: 8,
              textAlign: "center",
              color: "#666",
              fontSize: 14,
            }}
          >
            כשתרצי, תוכלי להצטרף מרשימת התורים ליום מסוים.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 90 }}
          showsVerticalScrollIndicator={false}
        >
          {myWaitlists.map((w) => {
            const title = buildTitle(w.date, w.hour);

            const now = Date.now();
            const hasHold =
              !!w.activeUserId &&
              !!w.holdExpiresAtMs &&
              w.holdExpiresAtMs > now;
            const holdForMe = hasHold && w.activeUserId === userId;

            return (
              <View
                key={w.id}
                style={{
                  backgroundColor: "#fff",
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: "#ddd",
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  marginHorizontal: 10,
                  marginVertical: 6,
                }}
              >
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: "900",
                    marginBottom: 4,
                    textAlign: "right",
                  }}
                >
                  {title}
                </Text>

                {Array.isArray(w.slots) && w.slots.length > 1 ? (
                  <Text
                    style={{
                      fontSize: 13,
                      color: "#555",
                      textAlign: "right",
                    }}
                  >
                    שעות התור: {w.slots.join(", ")}
                  </Text>
                ) : null}

                <Text
                  style={{
                    marginTop: 6,
                    fontSize: 14,
                    fontWeight: "800",
                    color: colors.primary || "#000",
                    textAlign: "right",
                  }}
                >
                  המיקום שלך ברשימה: {w.myPosition}
                  {w.queueLength ? ` מתוך ${w.queueLength}` : ""}
                </Text>

                {holdForMe ? (
                  <Text
                    style={{
                      marginTop: 4,
                      fontSize: 12,
                      color: "#2e7d32",
                      fontWeight: "900",
                      textAlign: "right",
                    }}
                  >
                    התור שמור לך כרגע — אפשר להיכנס ליום ולשריין ✅
                  </Text>
                ) : (
                  <Text
                    style={{
                      marginTop: 4,
                      fontSize: 12,
                      color: "#777",
                      textAlign: "right",
                    }}
                  >
                    המיקום מתעדכן אוטומטית אם לקוחות מבטלות.
                  </Text>
                )}

                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "flex-start",
                    marginTop: 10,
                  }}
                >
                  <Pressable
                    onPress={() => leaveWaitlist(w)}
                    style={({ pressed }) => [
                      {
                        paddingVertical: 8,
                        paddingHorizontal: 16,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: "#c62828",
                        backgroundColor: "#fff",
                        opacity: pressed ? 0.85 : 1,
                      },
                      Platform.OS === "web" ? { cursor: "pointer" } : null,
                    ]}
                  >
                    <Text
                      style={{
                        color: "#c62828",
                        fontWeight: "900",
                        fontSize: 14,
                      }}
                    >
                      בטלי מהרשימה
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Back button */}
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
  );
}
