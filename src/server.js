// ═══════════════════════════════════════════════════════════
// الخادم الرئيسي: ويبهوك فيسبوك + لوحة التحكم
// ═══════════════════════════════════════════════════════════
import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { CONFIG, WEB } from "./config.js";
import { SESSIONS_KV, countUsers, getUser, createUser, ordersStats, migrateFromTurso,
  salesReport, listOrders } from "./db/database.js";
import { handleEvent } from "./bot/handler.js";
import { adminRouter } from "./admin/routes.js";
import { PAGES } from "./bot/brain.js";
import { sendText, notifyTelegram } from "./bot/messenger.js";
import { whatsappEnabled, handleWhatsAppMessage } from "./bot/whatsapp.js";

// 🛡️ حماية من توقّف السيرفر بسبب تقطّع شبكة Turso اللحظي (نسجّل الخطأ ونكمّل)
process.on("uncaughtException", e => console.error("⚠️ uncaughtException:", e && e.message));
process.on("unhandledRejection", e => console.error("⚠️ unhandledRejection:", e && (e.message || e)));

// 🟢 إنشاء أدمن تلقائياً من متغيّرات البيئة (مغلّف بحماية حتى لا يوقف الإقلاع)
(function bootstrapAdmin() {
  try {
    const u = process.env.ADMIN_USER;
    const p = process.env.ADMIN_PASS;
    if (u && p && !getUser(u)) {
      createUser(u, bcrypt.hashSync(p, 10));
      console.log(`👤 تم إنشاء مستخدم الأدمن "${u}" من متغيّرات البيئة.`);
    }
  } catch (e) {
    console.error("⚠️ bootstrapAdmin skipped (Turso hiccup):", e && e.message);
  }
})();

// 🚚 نقل بيانات Turso القديمة للقرص المحلي (يعيد المحاولة كل دقيقة حتى ينجح لو Turso متعطّل)
if (process.env.MIGRATE_FROM_TURSO === "true") {
  const tryMigrate = () => {
    try {
      if (migrateFromTurso()) { clearInterval(migTimer); }
    } catch (e) { console.error("migrate attempt error:", e && e.message); }
  };
  const migTimer = setInterval(tryMigrate, 60 * 1000);
  migTimer.unref?.();
  tryMigrate();
}

const app = express();
app.set("trust proxy", 1);
app.use(cookieParser());
// نلتقط الـ body الخام للتحقق من توقيع فيسبوك
app.use(express.json({ limit: "2mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));

// التحقق من توقيع فيسبوك X-Hub-Signature-256 (يعمل فقط إن ضُبط APP_SECRET)
function verifyFbSignature(req) {
  const appSecret = process.env.FB_APP_SECRET;
  if (!appSecret) return true;   // غير مفعّل → لا نمنع (اختياري)
  const sig = req.get("x-hub-signature-256") || "";
  if (!sig.startsWith("sha256=") || !req.rawBody) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(req.rawBody).digest("hex");
  try {
    return sig.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch { return false; }
}

// ⚠️ حُذفت المتابعة التلقائية "شو صار معك" نهائياً (إرسال استباقي — شبهة مخالفة لسياسات فيسبوك).

// ═══════════════════════════════════════════════════════════
// 📊 تقرير يومي تلقائي (يُرسل لتيليجرام) + 💾 نسخة احتياطية يومية
// يعمل مرة كل يوم عند تجاوز الساعة المستهدفة (بتوقيت الخادم).
// ═══════════════════════════════════════════════════════════
const DAILY_REPORT_HOUR = Number(process.env.DAILY_REPORT_HOUR ?? 21);   // 9 مساءً افتراضياً
let _lastReportDay = null, _lastBackupDay = null;

async function dailyReport() {
  try {
    const r = salesReport();
    const t = r.today || { c: 0, s: 0 };
    const msg =
      `📊 تقرير اليوم — منصة الأجبان\n` +
      `━━━━━━━━━━━━━━━\n` +
      `🧾 طلبات اليوم: ${t.c}\n` +
      `💵 مبيعات اليوم: ${Number(t.s).toFixed(2)} دينار\n` +
      `📅 آخر 7 أيام: ${r.week.c} طلب — ${Number(r.week.s).toFixed(0)}د\n` +
      `📆 آخر 30 يوم: ${r.month.c} طلب — ${Number(r.month.s).toFixed(0)}د\n` +
      `📦 الإجمالي: ${r.all.c} طلب — ${Number(r.all.s).toFixed(0)}د`;
    await notifyTelegram(msg);
    console.log("📊 تم إرسال التقرير اليومي");
  } catch (e) { console.error("dailyReport error:", e && e.message); }
}

function dailyBackup() {
  try {
    const src = WEB.DB_PATH;
    if (!src || !fs.existsSync(src)) return;   // متاح فقط في وضع القرص المحلي
    const dir = path.join(path.dirname(src), "backups");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    fs.copyFileSync(src, path.join(dir, `backup-${stamp}.db`));
    // نحتفظ بآخر 14 نسخة فقط
    const files = fs.readdirSync(dir).filter(f => f.startsWith("backup-")).sort();
    while (files.length > 14) { try { fs.unlinkSync(path.join(dir, files.shift())); } catch {} }
    console.log(`💾 نسخة احتياطية: backup-${stamp}.db`);
  } catch (e) { console.error("dailyBackup error:", e && e.message); }
}

function dailyJobsTick() {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (now.getHours() >= DAILY_REPORT_HOUR && _lastReportDay !== day) {
    _lastReportDay = day; dailyReport();
  }
  if (_lastBackupDay !== day) {   // نسخة احتياطية أول تشغيل باليوم
    _lastBackupDay = day; dailyBackup();
  }
}
setInterval(dailyJobsTick, 5 * 60 * 1000).unref?.();   // فحص كل 5 دقائق
dailyJobsTick();   // نسخة احتياطية فورية عند الإقلاع

// ⚠️ حُذفت متابعة ما بعد البيع نهائياً (إرسال استباقي خارج نافذة 24 ساعة — شبهة مخالفة).

// بيئة متوافقة مع كود الـ Worker الأصلي (env + ctx)
const env = { SESSIONS_KV };
function makeCtx() {
  // ctx.waitUntil: تشغيل المهام الجانبية بدون انتظار (مثل Cloudflare)
  return {
    waitUntil(promise) {
      Promise.resolve(promise).catch(e => console.error("waitUntil error:", e && e.message));
    }
  };
}

// ═══════════════════════════════════════════════════════════
// ويبهوك فيسبوك ماسنجر
// ═══════════════════════════════════════════════════════════

// التحقق من الويبهوك (GET)
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === CONFIG.VERIFY_TOKEN) {
    return res.send(req.query["hub.challenge"] || "");
  }
  return res.status(403).send("Unauthorized");
});

// استقبال الرسائل (POST)
app.post("/webhook", async (req, res) => {
  try {
    if (!verifyFbSignature(req)) {
      console.error("⚠️ webhook signature mismatch — rejected");
      return res.status(403).send("bad signature");
    }
    const body = req.body || {};
    const entries = body.entry || [];
    const ctx = makeCtx();

    // 🔴 معالجة كل الأحداث مش أول واحد بس
    for (const entry of entries) {
      const events = entry.messaging || [];
      for (const event of events) {
        await handleEvent(event, env, ctx).catch(e => console.error("Event error:", e && e.message));
      }
    }
    res.send("EVENT_RECEIVED");
  } catch (e) {
    console.error("Handler error:", e && e.message);
    res.send("OK");   // نرجع 200 حتى فيسبوك ما يوقف الويبهوك
  }
});

// ═══════════════════════════════════════════════════════════
// 📱 ويبهوك واتساب (WhatsApp Cloud API) — اختياري
// ═══════════════════════════════════════════════════════════
app.get("/whatsapp", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" &&
      req.query["hub.verify_token"] === CONFIG.WHATSAPP_VERIFY_TOKEN) {
    return res.send(req.query["hub.challenge"] || "");
  }
  return res.status(403).send("Unauthorized");
});
app.post("/whatsapp", async (req, res) => {
  res.send("EVENT_RECEIVED");   // نرد فوراً حتى لا يعيد فيسبوك الإرسال
  try {
    if (!whatsappEnabled()) return;
    const entries = req.body?.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const contactName = value.contacts?.[0]?.profile?.name || "";
        for (const msg of value.messages || []) {
          if (msg.type === "text") {
            await handleWhatsAppMessage(msg, contactName, SESSIONS_KV)
              .catch(e => console.error("WA handle:", e && e.message));
          }
        }
      }
    }
  } catch (e) { console.error("WhatsApp webhook error:", e && e.message); }
});

// ═══════════════════════════════════════════════════════════
// لوحة التحكم
// ═══════════════════════════════════════════════════════════
app.use("/admin", adminRouter);

// ═══════════════════════════════════════════════════════════
// 🧀 قسم مستقل: شيخ الجبنة (Cheese AI) — مُركّب تحت /cheese
// معزول تماماً عن البوت الأساسي (راوتاته وبياناته الخاصة).
// ═══════════════════════════════════════════════════════════
try {
  const { default: cheeseApp } = await import("../cheese-ai/src/server.js");
  app.use("/cheese", cheeseApp);
  console.log("🧀 قسم شيخ الجبنة مُركّب على /cheese");
} catch (e) {
  console.error("⚠️ تعذّر تركيب قسم شيخ الجبنة (لا يؤثر على البوت الأساسي):", e && e.message);
}

// ملفات PWA (تُخدَم من الجذر حتى يعمل Service Worker على كامل الموقع)
const pwaDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
app.get("/sw.js", (req, res) => res.sendFile(path.join(pwaDir, "sw.js")));
app.get("/manifest.webmanifest", (req, res) => res.sendFile(path.join(pwaDir, "manifest.webmanifest")));
app.get("/icon.svg", (req, res) => res.sendFile(path.join(pwaDir, "icon.svg")));

// الصفحة الرئيسية → لوحة التحكم
app.get("/", (req, res) => res.redirect("/admin"));

// فحص صحة الخادم (عام — بدون كشف بيانات)
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

// تشخيص محمي (يتطلب توكن سري) — للفحص عن بُعد بدون كشف عام
app.get("/health/diag", (req, res) => {
  if (!process.env.DIAG_TOKEN || req.query.token !== process.env.DIAG_TOKEN) {
    return res.status(403).json({ error: "forbidden" });
  }
  let orders = null, err = null;
  try { orders = Number(ordersStats().total.c); } catch (e) { err = e && e.message; }
  res.json({ ok: true, ts: Date.now(), orders, dbError: err });
});

app.listen(WEB.PORT, () => {
  if (CONFIG.GLOBAL_PAUSE) console.log("🛑🛑 البوت موقوف بالكامل (بطلب المالك) — لا يرد على أي زبون. اللوحة شغّالة عادي.");
  console.log(`🧀 منصة الأجبان تعمل على المنفذ ${WEB.PORT}`);
  console.log(`   لوحة التحكم:  http://localhost:${WEB.PORT}/admin`);
  console.log(`   الويبهوك:     http://localhost:${WEB.PORT}/webhook`);
});
