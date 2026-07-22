// ═══════════════════════════════════════════════════════════
// إعدادات المنصة والبوت
// ملاحظة: القيم الأصلية للمفاتيح محفوظة كما هي (بدون حذف).
// يمكن تجاوزها عبر متغيرات البيئة (.env) لو رغبت لاحقاً بذلك.
// ═══════════════════════════════════════════════════════════

export const CONFIG = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "AIzaSyA1hzKsNzQHEZatQ4OQqYyPquT0fBJUghc",
  MODEL_NAME: process.env.MODEL_NAME || "gemini-2.0-flash",
  VERIFY_TOKEN: process.env.VERIFY_TOKEN || "talebbot",
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "YOUR_TELEGRAM_BOT_TOKEN",
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || "YOUR_TELEGRAM_CHAT_ID",

  // إعدادات إضافية
  GRAPH_VERSION: "v21.0",
  DEFAULT_PRICE: 14,          // سعر احتياطي لو الصنف مش موجود
  SESSION_TTL: 60 * 60 * 24 * 7,    // عمر الجلسة أسبوع
  CRM_TTL: 60 * 60 * 24 * 365,      // عمر بيانات الزبون سنة
  MAX_HISTORY: 8,
  GEMINI_TIMEOUT_MS: 20000
};

// إعدادات الموقع / لوحة التحكم
export const WEB = {
  PORT: parseInt(process.env.PORT || "3000", 10),
  SESSION_SECRET: process.env.SESSION_SECRET || "ajban-default-secret-change-me-please-2026",
  DB_PATH: process.env.DB_PATH || "./data/platform.db",
  ADMIN_SESSION_TTL_MS: 1000 * 60 * 60 * 24 * 3   // جلسة الأدمن 3 أيام
};
