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
  salesReport, listOrders, getChatMessages } from "./db/database.js";
import { handleEvent } from "./bot/handler.js";
import { adminRouter } from "./admin/routes.js";
import { PAGES } from "./bot/brain.js";
import { sendText, notifyTelegram } from "./bot/messenger.js";
import { whatsappEnabled, handleWhatsAppMessage } from "./bot/whatsapp.js";
import { captureEnabled, captureDelayMs, archiveExternal, captureOrderFrom,
         isOurOwnEcho } from "./bot/capture.js";

// ═══════════════════════════════════════════════════════════
// 🔑 توكنات الصفحات — ثلاث مصادر بترتيب أولوية واضح
//
//   1) متغيّر بيئة  PAGE_TOKEN_<معرّف الصفحة>   ← الأقوى والأأمن
//   2) قاعدة البيانات (من صفحة فحص التوكنات)
//   3) التوكن المكتوب بالكود                     ← الأضعف
//
// 🔴 ليش متغيّر البيئة أولاً: التوكن المكتوب بالكود بينرفع للمستودع.
//    لو المستودع عام، GitHub بيرصد التوكن ويبلّغ ميتا، وميتا بتلغيه.
//    متغيّر البيئة بيضل بلوحة الاستضافة وما بينرفع لأي مكان.
//
// مثال على Render → Environment:
//    PAGE_TOKEN_618622274665182 = EAAR...
// ═══════════════════════════════════════════════════════════
(async function applyTokens() {
  // (2) قاعدة البيانات
  try {
    const { getPageTokenOverrides } = await import("./db/database.js");
    for (const row of getPageTokenOverrides()) {
      if (PAGES[row.page_id] && row.token) {
        PAGES[row.page_id].PAGE_TOKEN = row.token;
        PAGES[row.page_id]._tokenSource = "قاعدة البيانات";
        console.log(`🔑 توكن من قاعدة البيانات لصفحة: ${PAGES[row.page_id].name}`);
      }
    }
  } catch (e) { console.error("applyTokens(db):", e && e.message); }

  // (1) متغيّرات البيئة — بتدعس اللي قبلها لأنها الأأمن
  try {
    for (const [k, v] of Object.entries(process.env)) {
      const m = k.match(/^PAGE_TOKEN_(\d{5,})$/);
      if (!m || !v) continue;
      const id = m[1];
      if (!PAGES[id]) { console.warn(`⚠️ ${k}: ما في صفحة بهاد المعرّف`); continue; }
      PAGES[id].PAGE_TOKEN = String(v).trim();
      PAGES[id]._tokenSource = "متغيّر بيئة";
      console.log(`🔑 توكن من متغيّر البيئة لصفحة: ${PAGES[id].name}`);
    }
  } catch (e) { console.error("applyTokens(env):", e && e.message); }

  // تقرير حالة سريع عند الإقلاع — بيوفّر عليك تشخيص لاحق
  for (const [id, p] of Object.entries(PAGES)) {
    if (!p.PAGE_TOKEN) console.warn(`⚠️ ${p.name} (${id}): بلا توكن إطلاقاً`);
    else if (!p._tokenSource) console.log(`📄 ${p.name}: توكن من الكود (يُفضّل نقله لمتغيّر بيئة)`);
  }
})();

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
// ═══════════════════════════════════════════════════════════
// 🔐 التحقق من توقيع فيسبوك
//
// بلا FB_APP_SECRET أي حدا بيعرف رابط الويبهوك بيقدر يزوّر أحداث:
// يخترع طلبات وهمية، أو يخلّي البوت يرد على ناس ما راسلوك.
//
// 🔴 قرار مقصود: ما بنمنع تلقائياً لما السر مش مضبوط.
// المنع الفوري بيوقف بوتك كله لو نُشر التعديل قبل ما تضبط السر —
// وإيقاف تجارة أسوأ من ثغرة لسه ما استُغلت. فبنحذّر بصوت عالي كل
// مرة، ومنخلّي التشديد بضغطة منك: REQUIRE_FB_SIGNATURE=true.
//
// الترتيب الآمن: اضبط FB_APP_SECRET → تأكد إنه التحذير اختفى →
// شغّل REQUIRE_FB_SIGNATURE=true.
// ═══════════════════════════════════════════════════════════
let _sigWarned = 0;
function verifyFbSignature(req) {
  const appSecret = process.env.FB_APP_SECRET;
  if (!appSecret) {
    if (process.env.REQUIRE_FB_SIGNATURE === "true") {
      console.error("🔴 REQUIRE_FB_SIGNATURE مفعّل بس FB_APP_SECRET مش مضبوط — الحدث مرفوض");
      return false;
    }
    // تحذير كل ساعة كحد أقصى — عشان ما يغرق السجل
    if (Date.now() - _sigWarned > 3600000) {
      _sigWarned = Date.now();
      console.warn("⚠️ FB_APP_SECRET مش مضبوط — الويبهوك بيقبل أي حدث بلا تحقق. " +
                   "اضبطه بلوحة الاستضافة، وبعدها شغّل REQUIRE_FB_SIGNATURE=true");
    }
    return true;
  }
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

// ═══════════════════════════════════════════════════════════
// 💾 النسخ الاحتياطي — بحماية من امتلاء القرص
//
// 🔴 العقدة اللي وقعنا فيها: الكود كان ينسخ **أول** وبعدين
//    يحذف القديم. فلمّا يمتلئ القرص، النسخ بيفشل والحذف ما
//    بيوصلوش — فبيضل ممتلئ للأبد وكل يوم بيحاول وبيفشل.
//    وقرص ممتلئ مش بس بيوقف النسخ: قاعدة البيانات ما بتقدر
//    تكتب، يعني **طلبات الزبائن بتضيع**.
//
//    الحل: منظّف الأول، ومنفحص المساحة قبل ما نبلّش، ولو
//    فشلنا بـENOSPC منحذف الأقدم ومنعيد مرة وحدة.
// ═══════════════════════════════════════════════════════════
const KEEP_BACKUPS = 7;   // كان 14 — نصّيناهم لأنّ قرص الاستضافة صغير

/** يحذف الزايد عن الحد ويرجّع كم ملف ضل */
function pruneBackups(dir, keep = KEEP_BACKUPS) {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter(f => /^backup-.*\.db$/.test(f)).sort();
  } catch { return 0; }
  while (files.length > keep) {
    const victim = files.shift();
    try { fs.unlinkSync(path.join(dir, victim)); console.log(`🧹 حذفنا نسخة قديمة: ${victim}`); }
    catch (e) { console.error("حذف نسخة:", e && e.message); }
  }
  return files.length;
}

/** المساحة الفاضية بالبايت، أو null إذا ما قدرنا نقرأها */
export function freeBytes(dir) {
  try {
    const st = fs.statfsSync(dir);
    return Number(st.bavail) * Number(st.bsize);
  } catch { return null; }
}

function dailyBackup() {
  try {
    const src = WEB.DB_PATH;
    if (!src || !fs.existsSync(src)) return;   // متاح فقط في وضع القرص المحلي
    const dir = path.join(path.dirname(src), "backups");
    fs.mkdirSync(dir, { recursive: true });

    // 1) ننظّف **قبل** ما ننسخ — هيك المساحة بتتحرر قبل الحاجة
    pruneBackups(dir);

    const dbSize = fs.statSync(src).size;
    const free = freeBytes(dir);

    // 2) لازم يبقى ضعف حجم القاعدة فاضي بعد النسخ، وإلا منحذف أكثر
    if (free != null && free < dbSize * 2) {
      console.warn(`⚠️ المساحة ضيّقة (${Math.round(free / 1048576)}م فاضي، القاعدة ${Math.round(dbSize / 1048576)}م) — منقلّل النسخ`);
      pruneBackups(dir, 2);
    }
    // 3) لسا ضيّقة؟ منتخطّى النسخة بدل ما نملّي القرص ونوقف
    //    كتابة الطلبات — الطلب أهم من النسخة الاحتياطية.
    const free2 = freeBytes(dir);
    if (free2 != null && free2 < dbSize * 1.2) {
      console.error(`🔴 ما في مساحة كافية للنسخة (${Math.round(free2 / 1048576)}م) — تخطّيناها حتى ما نوقف كتابة الطلبات`);
      return;
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const dest = path.join(dir, `backup-${stamp}.db`);
    try {
      fs.copyFileSync(src, dest);
    } catch (e) {
      if (e && e.code === "ENOSPC") {
        // 4) امتلأ أثناء النسخ: منشيل النصف المكتوب ومنحذف كل
        //    النسخ ومنعيد مرة وحدة بس
        try { fs.unlinkSync(dest); } catch {}
        pruneBackups(dir, 0);
        try { fs.copyFileSync(src, dest); }
        catch (e2) { console.error("🔴 النسخ فشل حتى بعد التنظيف:", e2 && e2.message); return; }
      } else throw e;
    }
    console.log(`💾 نسخة احتياطية: backup-${stamp}.db (${pruneBackups(dir)} نسخة محفوظة)`);
  } catch (e) { console.error("dailyBackup error:", e && e.message); }
}

// 🧹 تنظيف فوري عند الإقلاع — لو القرص ممتلئ أصلاً، ما منستنى
//    لبكرة. هاد بيفك العقدة اللي بتخلي القرص ممتلئ للأبد.
(function cleanupOnBoot() {
  try {
    const src = WEB.DB_PATH;
    if (!src || !fs.existsSync(src)) return;
    const dir = path.join(path.dirname(src), "backups");
    if (!fs.existsSync(dir)) return;
    const dbSize = fs.statSync(src).size;
    const free = freeBytes(dir);
    if (free != null && free < dbSize * 3) {
      console.warn(`🧹 المساحة ضيّقة عند الإقلاع (${Math.round(free / 1048576)}م) — بنظّف النسخ القديمة`);
      pruneBackups(dir, 2);
      const after = freeBytes(dir);
      if (after != null) console.log(`🧹 صار فاضي: ${Math.round(after / 1048576)}م`);
    }
  } catch (e) { console.error("cleanupOnBoot:", e && e.message); }
})();

// ═══════════════════════════════════════════════════════════
// 📡 فحص رادار السوق اليومي
// بيشتغل بساعة مبكرة عشان يكون الملخّص جاهز قبل التقرير المسائي.
// بياخد دقائق (بحث ويب حقيقي لكل صنف) — فبنشغّله بالخلفية.
// ═══════════════════════════════════════════════════════════
const RADAR_HOUR = Number(process.env.RADAR_SCAN_HOUR ?? 7);
let _lastRadarDay = null;

async function radarScan() {
  try {
    const { runDailyScan, watchlist } = await import("./venture/radar.js");
    if (!watchlist(true).length) return;   // ما في أصناف مراقبة — ما في شي نفحصه
    const r = await runDailyScan();
    console.log(`📡 رادار السوق: ${r.scanned} صنف بـ${Math.round(r.ms / 1000)}ث`);
    if (r.digest) await notifyTelegram(r.digest);
  } catch (e) { console.error("radarScan error:", e && e.message); }
}

function dailyJobsTick() {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (now.getHours() >= DAILY_REPORT_HOUR && _lastReportDay !== day) {
    _lastReportDay = day; dailyReport();
  }
  if (now.getHours() >= RADAR_HOUR && _lastRadarDay !== day) {
    _lastRadarDay = day; radarScan();   // بالخلفية — ما منستنى
  }
  if (_lastBackupDay !== day) {   // نسخة احتياطية أول تشغيل باليوم
    _lastBackupDay = day; dailyBackup();
  }
}
setInterval(dailyJobsTick, 5 * 60 * 1000).unref?.();   // فحص كل 5 دقائق
dailyJobsTick();   // نسخة احتياطية فورية عند الإقلاع

// 📲 طابور واتساب: إرسال تدريجي للحملات النشطة (رسمي فقط، بس للموافقين).
// كل 20 ثانية دفعة صغيرة — يحترم حدود ميتا. بلا حساب مهيأ ما بينبعت شي.
try {
  const { waQueueTick } = await import("./features/whatsapp.js");
  setInterval(() => { waQueueTick().catch(e => console.error("waQueueTick:", e && e.message)); }, 20 * 1000).unref?.();
} catch (e) { console.error("WA queue init:", e && e.message); }

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

    // ═══════════════════════════════════════════════════════════
    // 🔴 نرد على فيسبوك **فوراً** قبل المعالجة.
    //
    // فيسبوك بيتوقع رد خلال ثوانٍ. والمعالجة عندنا بتنادي الذكاء
    // الاصطناعي وممكن تاخد 10-30 ثانية. لما كنا نرد بعدها، فيسبوك
    // بيعتبر الويبهوك بطيء وبيعيد إرسال نفس الحدث — فبيتضاعف الرد
    // على الزبون، وبتكرار الفشل بيوقف الويبهوك عن الصفحة كلياً.
    //
    // المعالجة بتكمّل بالخلفية. وبنحافظ على await **جوّا** الحلقة
    // عشان أحداث نفس الزبون تنعالج بالترتيب ولا تتسابق على الجلسة.
    // ═══════════════════════════════════════════════════════════
    res.send("EVENT_RECEIVED");

    (async () => {
      for (const entry of entries) {
        // ── القناة الأساسية: المحادثات اللي بوتنا ماسكها ──
        for (const event of entry.messaging || []) {
          // 🎣 رد الصفحة (echo): ممكن يكون ذكاء ميتا أو موظف من
          //    الموبايل. البوت بيتجاهله، بس منأرشفه حتى يكون
          //    تاريخ المحادثة كامل ونعرف مين رد فعلاً.
          if (event?.message?.is_echo) { await captureEcho(entry.id, event); continue; }
          await handleEvent(event, env, ctx)
            .catch(e => console.error("Event error:", e && e.message));
        }

        // ═══════════════════════════════════════════════════════
        // 🎣 قناة standby: محادثة ماسكها تطبيق تاني (ذكاء ميتا
        //    مثلاً) حسب بروتوكول التسليم. ممنوع نرد عليها —
        //    الرد بيتضاعف على الزبون — بس مسموح نسمع.
        //    وهيك الطلب بيوصل الموقع حتى لو مش بوتنا اللي رد.
        // ═══════════════════════════════════════════════════════
        for (const event of entry.standby || []) {
          await captureStandby(entry.id, event)
            .catch(e => console.error("Standby error:", e && e.message));
        }
      }
    })().catch(e => console.error("Webhook background error:", e && e.message));
  } catch (e) {
    console.error("Handler error:", e && e.message);
    // بنرد بس لو ما رددنا قبل — بعد الرد الفوري فوق، أي رد تاني
    // بيرمي "Cannot set headers after they are sent"
    if (!res.headersSent) res.send("OK");   // 200 حتى فيسبوك ما يوقف الويبهوك
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
// 🎣 وضع الالتقاط — الطلب بيوصلك حتى لو مش بوتنا اللي رد
//
// المشكلة اللي بيحلها: ذكاء ميتا (Meta Business Agent) بيرد
// على زبائنك جوّا ماسنجر وما بيعطيك الطلب — ما في API بيسلّمه.
// ونفس الشي لمّا ترد إنت من الموبايل. بالحالتين الطلب بيضيع.
// هون منسمع المحادثة عبر القنوات الرسمية ومنستخرج الطلب بنفسنا.
//
// 🔴 استماع بحت: ما منرد ولا رسالة من هون. الرد بيتضاعف على
//    الزبون لأنّ في طرف تاني ماسك المحادثة أصلاً.
// ═══════════════════════════════════════════════════════════

// مؤقّت لكل محادثة: منستنى تهدأ قبل ما نستخرج، لأنّ الطلب
// بينبني على مدار كذا رسالة مش رسالة وحدة.
const _captureTimers = new Map();

function scheduleCapture(pageId, senderId, pageConfig, source) {
  const key = `${pageId}_${senderId}`;
  clearTimeout(_captureTimers.get(key));
  _captureTimers.set(key, setTimeout(async () => {
    _captureTimers.delete(key);
    try {
      const rows = getChatMessages(pageId, senderId) || [];
      const r = await captureOrderFrom({ pageId, senderId, pageConfig, rows, source });
      if (!r.saved) console.log(`🎣 ما التقطنا طلب (${senderId}): ${r.reason}`);
    } catch (e) { console.error("capture:", e && e.message); }
  }, captureDelayMs()));
}

/** رد صادر من الصفحة — ذكاء ميتا أو موظف أو بوت تاني */
async function captureEcho(pageId, event) {
  try {
    if (!captureEnabled()) return;
    if (isOurOwnEcho(event, CONFIG.FB_APP_ID)) return;   // ردنا نحنا — مؤرشف أصلاً
    const page = PAGES[pageId];
    if (!page) return;
    const senderId = event.recipient?.id;                 // المستلم = الزبون
    const text = event.message?.text;
    if (!senderId || !text) return;
    archiveExternal({ pageId, pageName: page.name, senderId,
                      direction: "out", body: text, source: "🤖 رد خارجي:" });
  } catch (e) { console.error("captureEcho:", e && e.message); }
}

/** رسالة زبون بمحادثة ماسكها تطبيق تاني */
async function captureStandby(pageId, event) {
  if (!captureEnabled()) return;
  const page = PAGES[pageId];
  if (!page) return;

  const senderId = event.sender?.id;
  if (!senderId) return;

  // echo داخل standby = رد الطرف التاني على الزبون
  if (event.message?.is_echo) {
    const to = event.recipient?.id;
    if (to && event.message.text)
      archiveExternal({ pageId, pageName: page.name, senderId: to,
                        direction: "out", body: event.message.text, source: "🤖 رد خارجي:" });
    return;
  }
  const text = event.message?.text;
  if (!text) return;

  archiveExternal({ pageId, pageName: page.name, senderId, direction: "in", body: text });
  scheduleCapture(pageId, senderId, page, "محادثة خارجية");
}

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

// أصول واجهة عقل المبيعات — تنسيق وكود عرض فقط، بلا أي بيانات
app.get("/premium.css", (req, res) => { res.type("text/css"); res.sendFile(path.join(pwaDir, "premium.css")); });
app.get("/theme.js", (req, res) => { res.type("application/javascript"); res.sendFile(path.join(pwaDir, "theme.js")); });
app.get("/motion.js", (req, res) => { res.type("application/javascript"); res.sendFile(path.join(pwaDir, "motion.js")); });
app.get("/brain-ui.css", (req, res) => res.sendFile(path.join(pwaDir, "brain-ui.css")));
app.get("/brain-ui.js", (req, res) => res.sendFile(path.join(pwaDir, "brain-ui.js")));

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

  // ═══════════════════════════════════════════════════════════
  // 🩺 تشخيص تلقائي عند الإقلاع
  //
  // ليش: البوت لمّا ما يرد، السبب دايماً إعداد ناقص على السيرفر
  // (مفتاح، توكن صفحة، إيقاف عام) — والتاجر ما بيقدر يشوفه إلا
  // لو دخّل الموقع وضغط زر. فمنطبعه بسجل الاستضافة عند كل إقلاع،
  // بصوت عالي، مع الحل. هيك أول ما تفتح السجل بتعرف وين المشكلة.
  //
  // منستنى شوي حتى تخلص التوكنات تنقرأ من القاعدة والبيئة.
  // ═══════════════════════════════════════════════════════════
  setTimeout(async () => {
    try {
      const { botDiagnose } = await import("./bot/aiCore.js");
      const d = await botDiagnose();
      console.log("\n╔══════════════════════════════════════════════");
      console.log("║ 🩺 فحص جاهزية البوت للرد");
      for (const c of d.checks) {
        console.log(`║ ${c.ok ? "✅" : "🔴"} ${c.name} — ${c.detail}`);
        if (!c.ok) console.log(`║    ↳ الحل: ${c.fix}`);
      }
      console.log(`║ ${d.ok ? "🟢" : "🔴"} ${d.verdict}`);
      console.log("╚══════════════════════════════════════════════\n");
    } catch (e) { console.error("🩺 تعذّر الفحص التلقائي:", e && e.message); }
  }, 4000).unref?.();
});
