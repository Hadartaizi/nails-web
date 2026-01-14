// frontend/components/HourSlot.js
import React from "react";
import { View, Text, Pressable, Platform } from "react-native";
import globalStyles from "../styles/global";

export default function HourSlot({
  hour,
  isReserved,
  isMine,

  // pending / approved / rejected
  status,

  canReserve = true,

  // ביטול בקשה (pending שלי)
  canCancelRequest = false,
  onCancelRequest,

  // ביטול תור (לרוב: approved שלי)
  onCancel,

  // waitlist
  inWaitlist = false,
  waitPositionText = "",
  onWaitlistToggle,

  // שריון: onReserve() -> DayScreen פותח מודאל
  onReserve,
}) {
  const showReserveBtn = !isReserved;
  const showCancelRequestBtn =
    isReserved && isMine && status === "pending" && canCancelRequest && !!onCancelRequest;

  const showCancelApprovedBtn =
    isReserved && isMine && status === "approved" && !!onCancel;

  const showWaitBtn = isReserved && !isMine && !canReserve && !!onWaitlistToggle;
  const waitLabel = inWaitlist
    ? `בהמתנה ✓ ${waitPositionText || ""}`.trim()
    : `המתנה ${waitPositionText || ""}`.trim();

  // label נעול (כמו בישן)
  let lockedLabel = "תפוס";
  if (isReserved && isMine) {
    if (status === "pending") lockedLabel = "ממתין לאישור ⏳";
    else if (status === "approved") lockedLabel = "אושר ✅";
    else if (status === "rejected") lockedLabel = "נדחה ❌";
    else lockedLabel = "תפוס";
  } else if (isReserved && !isMine) {
    lockedLabel = "תפוס";
  }

  return (
    <View
      style={{
        paddingVertical: 10,
        paddingHorizontal: 12,
        marginVertical: 6,
        backgroundColor: "#fff",
        borderRadius: 8,
        borderWidth: 1,
        borderColor: "#ddd",
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={globalStyles.hourText}>{hour}</Text>

        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {/* ✅ בטלי בקשה (pending שלי) */}
          {showCancelRequestBtn ? (
            <Pressable
              onPress={onCancelRequest}
              style={({ pressed }) => [
                {
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: "#E53935",
                  backgroundColor: "#fff",
                  opacity: pressed ? 0.85 : 1,
                  marginRight: 10,
                },
                Platform.OS === "web" ? { cursor: "pointer" } : null,
              ]}
            >
              <Text style={{ color: "#E53935", fontWeight: "900" }}>בטלי בקשה</Text>
            </Pressable>
          ) : null}

          {/* ✅ פנוי -> שריין (פותח מודאל ב-DayScreen) */}
          {showReserveBtn ? (
            <Pressable
              disabled={!canReserve}
              onPress={() => {
                if (!canReserve) return;
                onReserve?.(); // ✅ פותח מודאל בחירת טיפולים לפי שעה
              }}
              style={({ pressed }) => [
                globalStyles.button,
                !canReserve && { opacity: 0.5 },
                pressed && canReserve && { opacity: 0.85 },
                Platform.OS === "web" ? { cursor: canReserve ? "pointer" : "not-allowed" } : null,
              ]}
            >
              <Text style={globalStyles.buttonText}>שריין</Text>
            </Pressable>
          ) : showCancelApprovedBtn ? (
            /* ✅ בטל תור (מאושר שלי) */
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [
                globalStyles.button,
                { backgroundColor: "#c62828" },
                pressed && { opacity: 0.85 },
                Platform.OS === "web" ? { cursor: "pointer" } : null,
              ]}
            >
              <Text style={globalStyles.buttonText}>בטל תור</Text>
            </Pressable>
          ) : (
            /* ✅ מצב נעול */
            <Pressable
              disabled
              style={[
                globalStyles.button,
                { opacity: 0.6 },
                Platform.OS === "web" ? { cursor: "not-allowed" } : null,
              ]}
            >
              <Text style={globalStyles.buttonText}>{lockedLabel}</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* ✅ כפתור המתנה */}
      {showWaitBtn && (
        <Pressable
          onPress={onWaitlistToggle}
          style={({ pressed }) => [
            {
              marginTop: 8,
              paddingVertical: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: "#aaa",
              alignItems: "center",
              opacity: pressed ? 0.85 : 1,
            },
            Platform.OS === "web" ? { cursor: "pointer" } : null,
          ]}
        >
          <Text style={{ fontWeight: "800" }}>{waitLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}
