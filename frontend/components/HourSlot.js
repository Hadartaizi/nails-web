// frontend/components/HourSlot.js
import React from "react";
import { View, Text, Pressable, Platform } from "react-native";
import globalStyles from "../styles/global";
import colors from "../styles/colors";

export default function HourSlot({
  hour,
  isReserved,
  isMine,

  // pending / approved / rejected
  status,

  // האם מותר לקבוע תור בשעה הזאת (אחרי כל הלוגיקה ב-DayScreen)
  canReserve = true,

  // ביטול בקשה (pending שלי)
  canCancelRequest = false,
  onCancelRequest,

  // ביטול תור מאושר (approved שלי)
  onCancel,

  // שריון: onReserve() -> DayScreen פותח מודאל בחירת טיפולים
  onReserve,

  // === רשימת המתנה ===
  inWaitlist = false, // האם המשתמש כבר ברשימת המתנה של השעה הזאת
  waitPositionText = "", // טקסט כמו "המיקום שלך ברשימה: 2 מתוך 5"
  showWaitlistButton = false, // האם בכלל להציג כפתור רשימת המתנה
  onWaitlistToggle, // לחיצה על "רשימת המתנה" / "בטל המתנה"

  // === HOLD (התור שמור למשתמשת ל-30 דק) ===
  holdForMe = false, // אם יש HOLD עבור המשתמשת הנוכחית
}) {
  // ---------- טקסט סטטוס מעל הכפתורים ----------
  let statusLabel = "";
  if (isReserved) {
    statusLabel = "תפוס";
  } else if (holdForMe) {
    statusLabel = "שמור עבורך";
  } else {
    statusLabel = "פנוי";
  }

  // ---------- מצבים לוגיים ----------
  const isPendingMine = isMine && status === "pending";
  const isApprovedMine = isMine && status === "approved";

  // כפתור קביעת תור – רק אם מותר לקבוע תור ויש callback
  const showReserveBtn = !!onReserve && !!canReserve;

  // כפתור ביטול בקשה ממתינה
  const showCancelRequestBtn =
    !!onCancelRequest && !!canCancelRequest && isPendingMine;

  // כפתור ביטול תור מאושר
  const showCancelApprovedBtn = !!onCancel && isApprovedMine;

  // כפתור רשימת המתנה – נשלט גם ע"י DayScreen וגם ע"י מצב התור
  // ❗ אם כבר יש כפתור "בטלי תור" או "בטלי בקשה" או "קבעי תור" – לא מציגים רשימת המתנה
  const showWaitlistBtn =
    !!onWaitlistToggle &&
    !!showWaitlistButton &&
    !showReserveBtn &&
    !showCancelApprovedBtn &&
    !showCancelRequestBtn;

  // טקסט לכפתור רשימת המתנה
  const waitlistButtonLabel = inWaitlist
    ? "בטלי המתנה"
    : "הצטרפי לרשימת המתנה";

  return (
    <View
      style={{
        backgroundColor: "#fff",
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border || "#ddd",
        paddingVertical: 10,
        paddingHorizontal: 12,
        marginBottom: 10,
        alignItems: "flex-end",
      }}
    >
      {/* שעה */}
      <Text
        style={{
          fontSize: 18,
          fontWeight: "900",
          color: colors.textDark || "#222",
        }}
      >
        {hour}
      </Text>

      {/* סטטוס: פנוי / שמור עבורך / תפוס */}
      <Text
        style={{
          marginTop: 4,
          fontSize: 14,
          fontWeight: "800",
          color: isReserved
            ? "#c62828"
            : holdForMe
            ? "#2e7d32"
            : "#4caf50",
        }}
      >
        {statusLabel}
      </Text>

      {/* טקסט מיקום ברשימת המתנה (אם קיים) */}
      {waitPositionText ? (
        <Text
          style={{
            marginTop: 4,
            fontSize: 13,
            color: "#555",
            textAlign: "right",
          }}
        >
          {waitPositionText}
        </Text>
      ) : null}

      {/* כפתורים */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "flex-start",
          width: "100%",
          marginTop: 10,
          gap: 8,
        }}
      >
        {/* כפתור קביעת תור */}
        {showReserveBtn && (
          <Pressable
            onPress={onReserve}
            style={({ pressed }) => [
              {
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: 10,
                backgroundColor: colors.primary,
                opacity: pressed ? 0.85 : 1,
              },
              Platform.OS === "web" ? { cursor: "pointer" } : null,
            ]}
          >
            <Text
              style={{
                color: "white",
                fontWeight: "900",
                fontSize: 14,
              }}
            >
              קבעי תור
            </Text>
          </Pressable>
        )}

        {/* כפתור ביטול בקשה ממתינה (pending) */}
        {showCancelRequestBtn && (
          <Pressable
            onPress={onCancelRequest}
            style={({ pressed }) => [
              {
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: 10,
                backgroundColor: "#f57c00",
                opacity: pressed ? 0.85 : 1,
              },
              Platform.OS === "web" ? { cursor: "pointer" } : null,
            ]}
          >
            <Text
              style={{
                color: "white",
                fontWeight: "900",
                fontSize: 14,
              }}
            >
              בטלי בקשה
            </Text>
          </Pressable>
        )}

        {/* כפתור ביטול תור מאושר (approved) */}
        {showCancelApprovedBtn && (
          <Pressable
            onPress={onCancel}
            style={({ pressed }) => [
              {
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: 10,
                backgroundColor: "#c62828",
                opacity: pressed ? 0.85 : 1,
              },
              Platform.OS === "web" ? { cursor: "pointer" } : null,
            ]}
          >
            <Text
              style={{
                color: "white",
                fontWeight: "900",
                fontSize: 14,
              }}
            >
              בטלי תור
            </Text>
          </Pressable>
        )}

        {/* כפתור רשימת המתנה (הצטרפי / בטלי) */}
        {showWaitlistBtn && (
          <Pressable
            onPress={onWaitlistToggle}
            style={({ pressed }) => [
              {
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: 10,
                backgroundColor: "#fff",
                borderWidth: 1,
                borderColor: inWaitlist ? "#c62828" : colors.primary,
                opacity: pressed ? 0.85 : 1,
              },
              Platform.OS === "web" ? { cursor: "pointer" } : null,
            ]}
          >
            <Text
              style={{
                color: inWaitlist ? "#c62828" : colors.primary,
                fontWeight: "900",
                fontSize: 14,
              }}
            >
              {waitlistButtonLabel}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
