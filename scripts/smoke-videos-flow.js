// ═══════════════════════════════════════════════════════════
// 🧪 اختبار تكامل: مسار البوت الحقيقي لإرسال فيديوهات المنتجات
//
// بيشغّل handleEvent الفعلي (مش محاكاة) ويعترض نداءات فيسبوك
// (global.fetch) حتى يتأكد:
//  - لما الزبون يسأل عن المنتجات → البوت يرسل مرفق فيديو بالرابط الصح
//  - ما بيتكرّر الإرسال بنفس الجلسة (مرة وحدة)
//  - رسالة مش عن المنتجات ما بتطلّع فيديو
//  - صفحة بلا فيديوهات ما بترسل إشي
// ═══════════════════════════════════════════════════════════
if (!process.env.DB_PATH || /platform\.db/.test(process.env.DB_PATH))
  process.env.DB_PATH = "./data/smoke-videos-flow.db";
if (/platform\.db/.test(process.env.DB_PATH)) {
  console.error("🔴 رفض: الاختبار ما بيشتغل على قاعدة الإنتاج"); process.exit(1);
}
import fs from "node:fs";
const wipe = () => ["", "-wal", "-shm"].forEach(x => { try { fs.rmSync(process.env.DB_PATH + x); } catch {} });
wipe();

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { console.log("❌ " + m); fail++; } };

const { db, SESSIONS_KV } = await import("../src/db/database.js");
await new Promise(r => setTimeout(r, 1000));
await import("../src/features/videos.js");   // ينشئ جدول product_videos
const { PAGES } = await import("../src/bot/brain.js");
const { handleEvent } = await import("../src/bot/handler.js");

const FATI = "514074765127663";
const OTHER = "618622274665182";   // ريفان — رح نتركها بلا فيديوهات
const VURL = "https://ajban-bot.onrender.com/media/videos/test-clip.mp4";

// نزرع فيديو مفعّل لفاتي مباشرة بالجدول
db.prepare(`INSERT INTO product_videos (page_id,label,kind,url,file,filename,size,sort,active,created_at)
            VALUES (?,?,?,?,'','',0,1,1,?)`).run(FATI, "جل غسيل فاتي", "url", VURL, Date.now());

// ── نعترض كل نداءات الشبكة، ونلتقط اللي رايح لفيسبوك ──
const sent = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (/graph\.facebook\.com/.test(u)) {
    try { sent.push(JSON.parse(opts.body)); } catch { /* typing_on ما بيهمنا */ }
    return { ok: true, status: 200, text: async () => "{}", json: async () => ({}) };
  }
  // أي نداء ذكاء اصطناعي: نرجّع رد فاضي حتى ما ينهار المعالج (البوت بيسكت)
  return { ok: true, status: 200, text: async () => "{}",
           json: async () => ({ choices: [{ message: { content: "" } }] }) };
};

const ctx = { waitUntil: (p) => { Promise.resolve(p).catch(() => {}); } };
const env = { SESSIONS_KV };

const videoPayloads = () => sent.filter(p => p?.message?.attachment?.type === "video");

let mid = 1;
const say = async (pageId, senderId, text) => {
  sent.length = 0;
  await handleEvent({
    sender: { id: senderId }, recipient: { id: pageId },
    message: { mid: "m" + (mid++), text }
  }, env, ctx);
  await new Promise(r => setTimeout(r, 50));
};

// ── (1) الزبون يسأل عن المنتجات → فيديو ينبعث ──
await say(FATI, "cust-A", "مرحبا شو عندكم منتجات ثانية؟");
let vp = videoPayloads();
ok(vp.length === 1, "سؤال عن المنتجات ⇐ انبعت فيديو واحد");
ok(vp[0]?.message?.attachment?.payload?.url === VURL, "الفيديو انبعت بالرابط الصح");
ok(vp[0]?.recipient?.id === "cust-A", "الفيديو راح للزبون الصح");

// ── (2) نفس الزبون يسأل ثاني مرة → ما بيتكرّر ──
await say(FATI, "cust-A", "طيب وشو عندكم كمان منتجات؟");
ok(videoPayloads().length === 0, "ما بيتكرّر إرسال الفيديو بنفس الجلسة");

// ── (3) زبون ثاني يسأل → بياخد الفيديو (جلسة جديدة) ──
await say(FATI, "cust-B", "بدي اشوف المنتجات");
ok(videoPayloads().length === 1, "زبون جديد بياخد الفيديو (كل جلسة لحالها)");

// ── (4) رسالة مش عن المنتجات → ما في فيديو ──
await say(FATI, "cust-C", "مرحبا كيف حالكم");
ok(videoPayloads().length === 0, "رسالة عادية ما بتطلّع فيديو");

// ── (5) صفحة بلا فيديوهات → ما في إرسال ──
await say(OTHER, "cust-D", "شو عندكم منتجات؟");
ok(videoPayloads().length === 0, "صفحة بلا فيديوهات ما بترسل إشي");

wipe();
console.log(`\n${fail ? "🔴" : "🟢"} نجح ${pass} / فشل ${fail}`);
process.exit(fail ? 1 : 0);
