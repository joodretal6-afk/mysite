// ═══════════════════════════════════════════════════════════
// الخادم الرئيسي: ويبهوك فيسبوك + لوحة التحكم
// ═══════════════════════════════════════════════════════════
import express from "express";
import cookieParser from "cookie-parser";
import { CONFIG, WEB } from "./config.js";
import { SESSIONS_KV } from "./db/database.js";
import { handleEvent } from "./bot/handler.js";
import { adminRouter } from "./admin/routes.js";

const app = express();
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

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

// فحص صحة الخادم
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

app.listen(WEB.PORT, () => {
  console.log(`🧀 منصة الأجبان تعمل على المنفذ ${WEB.PORT}`);
  console.log(`   لوحة التحكم:  http://localhost:${WEB.PORT}/admin`);
  console.log(`   الويبهوك:     http://localhost:${WEB.PORT}/webhook`);
});
