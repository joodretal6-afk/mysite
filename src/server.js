// ═══════════════════════════════════════════════════════════
// الخادم الرئيسي: ويبهوك فيسبوك + لوحة التحكم
// ═══════════════════════════════════════════════════════════
import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { CONFIG, WEB } from "./config.js";
import { SESSIONS_KV, countUsers, getUser, createUser, ordersStats, migrateFromTurso,
  dueFollowups, markFollowupSent } from "./db/database.js";
import { handleEvent } from "./bot/handler.js";
import { adminRouter } from "./admin/routes.js";
import { PAGES } from "./bot/brain.js";
import { sendText } from "./bot/messenger.js";

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

// ⏰ المتابعة التلقائية: كل زبون بعد 10 دقائق من آخر رسالة (إن لم يُكمل طلبه)
async function runFollowups() {
  try {
    const list = dueFollowups();
    for (const f of list) {
      markFollowupSent(f.key);   // علّمها أولاً حتى لا تتكرر
      if (CONFIG.DISABLED_PAGES.includes(f.page_id)) continue;
      const page = PAGES[f.page_id];
      if (!page?.PAGE_TOKEN) continue;
      await sendText(page.PAGE_TOKEN, f.sender_id,
        "يا هلا فيك 🌹 شو صار معك؟ ضلّينا مستنيينك. لو حابب تكمّل طلبك بس قلّي شو بتحب ومنجهّزلك ياه 🧀");
    }
    if (list.length) console.log(`⏰ تمت متابعة ${list.length} زبون`);
  } catch (e) { console.error("followup job error:", e && e.message); }
}
setInterval(runFollowups, 60 * 1000).unref?.();   // فحص كل دقيقة (التايمر 10 دقائق لكل زبون)

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
// لوحة التحكم
// ═══════════════════════════════════════════════════════════
app.use("/admin", adminRouter);

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
  console.log(`🧀 منصة الأجبان تعمل على المنفذ ${WEB.PORT}`);
  console.log(`   لوحة التحكم:  http://localhost:${WEB.PORT}/admin`);
  console.log(`   الويبهوك:     http://localhost:${WEB.PORT}/webhook`);
});
