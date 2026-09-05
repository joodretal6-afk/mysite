// ═══════════════════════════════════════════════════════════
// 🎬 مجلّد وسائط المنتجات (فيديوهات) — بيعيش جنب قاعدة البيانات
// على القرص الدائم (/data على Render) حتى يضل بعد إعادة التشغيل.
// نفس المسار بيستخدمه: راوتر الرفع (features/videos.js) والخدمة
// العامة (server.js) — فمكان واحد يحسبه حتى ما ينحرفوا.
// ═══════════════════════════════════════════════════════════
import path from "node:path";
import fs from "node:fs";
import { CONFIG } from "./config.js";

// مجلّد القاعدة (غالباً ./data محلياً أو /data على Render)
export const DATA_DIR = path.dirname(CONFIG.DB_PATH || "./data/platform.db");
export const VIDEOS_DIR = path.join(DATA_DIR, "product-videos");

export function ensureVideosDir() {
  try { fs.mkdirSync(VIDEOS_DIR, { recursive: true }); } catch { /* موجود أصلاً */ }
  return VIDEOS_DIR;
}

// المسار العام اللي فيسبوك بيجيب منه الفيديو (بلا مصادقة)
export const PUBLIC_VIDEOS_PATH = "/media/videos";

// نبني رابط مطلق (https) للملف — فيسبوك بدّو رابط كامل مش نسبي.
// الأولوية لمتغيّر البيئة، وإلا منشتقّه من ترويسة الطلب (المتصفح
// اللي رفع من لوحة الأدمن host إلو نفس دومين الموقع العام).
export function publicBase(req) {
  const env = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (env) return env;
  const host = (req && (req.headers["x-forwarded-host"] || req.headers.host)) || "";
  if (!host) return "";
  const local = /^(localhost|127\.|0\.0\.0\.0)/.test(host);
  const proto = (req.headers["x-forwarded-proto"] || (local ? "http" : "https")).split(",")[0].trim();
  return `${proto}://${host}`;
}
