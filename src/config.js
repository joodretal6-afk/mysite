// ═══════════════════════════════════════════════════════════
// إعدادات المنصة والبوت
// ملاحظة: القيم الأصلية للمفاتيح محفوظة كما هي (بدون حذف).
// يمكن تجاوزها عبر متغيرات البيئة (.env) لو رغبت لاحقاً بذلك.
// ═══════════════════════════════════════════════════════════

export const CONFIG = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "AIzaSyA1hzKsNzQHEZatQ4OQqYyPquT0fBJUghc",
  MODEL_NAME: process.env.MODEL_NAME || "gemini-flash-latest",

  // ── اختيار مزوّد الذكاء: "gemini" أو "openai" ──
  // لو تركته فاضي: يستخدم OpenAI تلقائياً إذا وُجد مفتاحه، وإلا Gemini.
  AI_PROVIDER: process.env.AI_PROVIDER || "",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-4o-mini",
  OPENAI_TRANSCRIBE_MODEL: process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1",
  VERIFY_TOKEN: process.env.VERIFY_TOKEN || "talebbot",
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "YOUR_TELEGRAM_BOT_TOKEN",
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || "YOUR_TELEGRAM_CHAT_ID",

  // إعدادات إضافية
  GRAPH_VERSION: "v21.0",
  // صفحات موقوفة عن العمل (البوت ما يرد عليها). أرقام صفحات مفصولة بفاصلة.
  DISABLED_PAGES: (process.env.DISABLED_PAGES || "").split(",").map(s => s.trim()).filter(Boolean),
  // زر الإشعارات OTN يحتاج صلاحية Advanced Messaging من فيسبوك.
  // مطفأ افتراضياً حتى لا يسبب خطأ. فعّله بـ ENABLE_OTN=true بعد الحصول على الصلاحية.
  ENABLE_OTN: process.env.ENABLE_OTN === "true",
  DEFAULT_PRICE: 14,          // سعر احتياطي لو الصنف مش موجود
  SESSION_TTL: 60 * 60 * 24 * 30,   // عمر الجلسة شهر (يتذكر الزبون أطول)
  CRM_TTL: 60 * 60 * 24 * 365,      // عمر بيانات الزبون سنة
  MAX_HISTORY: 30,                  // يتذكر آخر 30 رسالة (كان 8 → كان بينسى)
  GEMINI_TIMEOUT_MS: 20000
};

// إعدادات الموقع / لوحة التحكم
export const WEB = {
  PORT: parseInt(process.env.PORT || "3000", 10),
  SESSION_SECRET: process.env.SESSION_SECRET || "ajban-default-secret-change-me-please-2026",
  DB_PATH: process.env.DB_PATH || "./data/platform.db",
  ADMIN_SESSION_TTL_MS: 1000 * 60 * 60 * 24 * 3   // جلسة الأدمن 3 أيام
};
