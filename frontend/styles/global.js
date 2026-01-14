import { StyleSheet, Dimensions } from "react-native";
import colors from "./colors";

const { width, height } = Dimensions.get("window");

export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: width * 0.05, // רוחב קבוע באחוז
    paddingTop: height * 0.10,       // ריווח עליון יחסי
  },
  title: {
    fontSize: width * 0.07,          // גודל פונטים ביחס לרוחב המסך
    fontWeight: "700",
    color: colors.primary,
    marginBottom: height * 0.02,
    textAlign: "center",
  },
  subtitle: {
    fontSize: width * 0.05,
    fontWeight: "600",
    color: colors.textDark,
    marginBottom: height * 0.015,
  },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: height * 0.015,  // גובה הכפתור יחסי
    paddingHorizontal: width * 0.04,  // רוחב פנימי יחסי
    borderRadius: width * 0.04,
    marginTop: height * 0.02,
    alignItems: "center",
  },
  buttonText: {
    color: colors.textLight,
    textAlign: "center",
    fontWeight: "600",
    fontSize: width * 0.045,
  },
  card: {
    backgroundColor: "#fff",
    padding: height * 0.015,
    borderRadius: width * 0.04,
    borderWidth: 1,
    borderColor: colors.border,
    marginVertical: height * 0.01,
  },
  hourText: {
    fontSize: width * 0.05,
    fontWeight: "500",
    color: colors.textDark,
  },
});
