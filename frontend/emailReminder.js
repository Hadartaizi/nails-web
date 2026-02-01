// frontend/emailReminder.js
import emailjs from "@emailjs/browser";

// 🧩 הפרטים מה-EmailJS שלך
const SERVICE_ID = "service_r7ytmia";
const PUBLIC_KEY = "WISwzUSwvr_vHGVcO";

// ✅ Template אחד כללי (עם status_line + services_text)
const TEMPLATE_GENERAL_ID = "template_rxisqza"; // שימי כאן את הטמפלט שבו הדבקת את ה-HTML הכללי

// פונקציית עזר לשליחה בפועל
async function sendEmailWithTemplate(templateId, templateParams, debugLabel) {
  try {
    if (!SERVICE_ID || !templateId || !PUBLIC_KEY) {
      console.log(
        "❌ EmailJS config missing – SERVICE_ID / TEMPLATE_ID / PUBLIC_KEY"
      );
      return;
    }

    if (!templateParams?.to_email) {
      console.log("❌ Missing to_email, skipping email send");
      return;
    }

    console.log(
      `📧 Sending EmailJS (${debugLabel}) with params:`,
      templateParams
    );

    const result = await emailjs.send(
      SERVICE_ID,
      templateId,
      templateParams,
      PUBLIC_KEY
    );

    console.log(
      `✅ EmailJS success (${debugLabel}):`,
      result.status,
      result.text
    );
    return result;
  } catch (err) {
    console.log(`❌ EmailJS error (${debugLabel}):`, err);
  }
}

// עזר: הופך servicesSelected לטקסט יפה
function servicesToText(servicesSelected) {
  if (!Array.isArray(servicesSelected) || servicesSelected.length === 0)
    return "לא נבחר";
  return (
    servicesSelected
      .map((s) => s?.name)
      .filter(Boolean)
      .join(", ") || "לא נבחר"
  );
}

/**
 * 🟡 מייל כשהבקשה נקלטה וממתינה לאישור
 */
export async function sendAppointmentPendingEmail({
  toEmail,
  clientName,
  date,
  time,
  businessName,
  servicesSelected,
}) {
  const templateParams = {
    to_email: toEmail,
    client_name: clientName || "לקוחה",
    date,
    time,
    business_name: businessName || "Rotem Studio Nails",
    services_text: servicesToText(servicesSelected),
    status_line: "הבקשה לתור נקלטה בהצלחה וממתינה לאישור ⏳",
  };

  return sendEmailWithTemplate(TEMPLATE_GENERAL_ID, templateParams, "pending");
}

/**
 * ✅ מייל כשהתור אושר
 */
export async function sendAppointmentEmail({
  toEmail,
  clientName,
  date,
  time,
  businessName,
  servicesSelected,
}) {
  const templateParams = {
    to_email: toEmail,
    client_name: clientName || "לקוחה",
    date,
    time,
    business_name: businessName || "Rotem Studio Nails",
    services_text: servicesToText(servicesSelected),
    status_line: "התור שלך אושר! 😊",
  };

  return sendEmailWithTemplate(TEMPLATE_GENERAL_ID, templateParams, "approve");
}

/**
 * ❌ מייל כשהתור נדחה
 */
export async function sendAppointmentRejectedEmail({
  toEmail,
  clientName,
  date,
  time,
  businessName,
  servicesSelected,
}) {
  const templateParams = {
    to_email: toEmail,
    client_name: clientName || "לקוחה",
    date,
    time,
    business_name: businessName || "Rotem Studio Nails",
    services_text: servicesToText(servicesSelected),
    status_line:
      "לצערנו הבקשה לתור נדחתה ❌ מוזמנת לבחור זמן אחר.",
  };

  return sendEmailWithTemplate(TEMPLATE_GENERAL_ID, templateParams, "reject");
}

/**
 * 🛑 מייל כשהתור בוטל ע"י בעלת העסק
 */
export async function sendAppointmentCancelledEmail({
  toEmail,
  clientName,
  date,
  time,
  businessName,
  servicesSelected,
}) {
  const templateParams = {
    to_email: toEmail,
    client_name: clientName || "לקוחה",
    date,
    time,
    business_name: businessName || "Rotem Studio Nails",
    services_text: servicesToText(servicesSelected),
    status_line:
      "התור שלך בוטל. במידת הצורך אפשר לקבוע תור חדש דרך המערכת 💅",
  };

  return sendEmailWithTemplate(
    TEMPLATE_GENERAL_ID,
    templateParams,
    "cancelled"
  );
}

/**
 * 🕒 מייל ללקוחה שמחכה ברשימת המתנה – עכשיו תורך ויש לך 30 דקות
 */
export async function sendWaitlistHoldEmail({
  toEmail,
  clientName,
  date,
  time,
  businessName,
}) {
  const templateParams = {
    to_email: toEmail,
    client_name: clientName || "לקוחה",
    date,
    time,
    business_name: businessName || "Rotem Studio Nails",
    services_text: "רשימת המתנה",
    status_line:
      "התור התפנה עבורך! יש לך 30 דקות לאשר את התור דרך המערכת, לפני שהוא יעבור ללקוחה הבאה ברשימת ההמתנה.",
  };

  return sendEmailWithTemplate(
    TEMPLATE_GENERAL_ID,
    templateParams,
    "waitlist_hold"
  );
}

/**
 * ⏰ מייל כשה־HOLD מרשימת ההמתנה נגמר
 */
export async function sendWaitlistExpiredEmail({
  toEmail,
  clientName,
  date,
  time,
  businessName,
}) {
  const templateParams = {
    to_email: toEmail,
    client_name: clientName || "לקוחה",
    date,
    time,
    business_name: businessName || "Rotem Studio Nails",
    services_text: "רשימת המתנה",
    status_line:
      "הזמן לשמור את התור הסתיים, והתור עבר ללקוחה הבאה ברשימת ההמתנה.",
  };

  return sendEmailWithTemplate(
    TEMPLATE_GENERAL_ID,
    templateParams,
    "waitlist_expired"
  );
}
