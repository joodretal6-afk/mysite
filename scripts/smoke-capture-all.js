// ═══════════════════════════════════════════════════════════
// 🧪 التقاط الطلبات والأرقام — ما يضيع إشي نهائياً
// بيشغّل handleEvent الحقيقي ويعترض فيسبوك والذكاء، ويتأكد:
//  - رقم لحاله بلا صنف → بينحفظ «بحاجة متابعة»
//  - رقم داخل جملة طبيعية → بينلتقط
//  - الأرقام الصغيرة (كميات) ما بتنحسب أرقام تلفون
// ═══════════════════════════════════════════════════════════
if (!process.env.DB_PATH || /platform\.db/.test(process.env.DB_PATH))
  process.env.DB_PATH = "./data/smoke-capture-all.db";
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
const { PAGES } = await import("../src/bot/brain.js");
const { handleEvent } = await import("../src/bot/handler.js");

// صفحة جبنة بسيطة (أجبان غزة) — موجودة بالإعدادات
const PAGE = Object.keys(PAGES).find(id => PAGES[id].name === "أجبان غزة") || Object.keys(PAGES)[0];

// نعترض الشبكة: فيسبوك يرجع ok، والذكاء يرجع فاضي (البوت بيسكت) حتى
// نثبت إنه الالتقاط بيصير حتى بلا رد من الذكاء ولا فاتورة.
globalThis.fetch = async (url) => {
  const u = String(url);
  if (/graph\.facebook\.com/.test(u))
    return { ok: true, status: 200, text: async () => "{}", json: async () => ({}) };
  return { ok: true, status: 200, text: async () => "{}",
           json: async () => ({ choices: [{ message: { content: "" } }] }) };
};

const ctx = { waitUntil: (p) => { Promise.resolve(p).catch(() => {}); } };
const env = { SESSIONS_KV };
let mid = 1;
const say = async (senderId, text) => {
  await handleEvent({ sender: { id: senderId }, recipient: { id: PAGE },
                      message: { mid: "m" + (mid++), text } }, env, ctx);
  await new Promise(r => setTimeout(r, 60));
};
const ordersFor = (sender) => db.prepare(
  "SELECT * FROM orders WHERE page_id=? AND sender_id=? ORDER BY id DESC").all(PAGE, sender);

// ── (1) رقم لحاله بلا أي صنف → لازم ينحفظ «بحاجة متابعة» ──
await say("cA", "مرحبا رقمي 0791234567");
let rows = ordersFor("cA");
ok(rows.length === 1, "رقم لحاله انحفظ كسجل واحد");
ok(rows[0] && rows[0].phone === "0791234567", "الرقم انلتقط صح");
ok(rows[0] && rows[0].status === "بحاجة متابعة", "رقم بلا طلب → حالته «بحاجة متابعة»");

// ── (2) رقم داخل جملة طبيعية (بصيغة +962) ──
await say("cB", "تواصلو معي ضروري +962799887766 بسرعة");
rows = ordersFor("cB");
ok(rows.length === 1 && rows[0].phone === "0799887766", "رقم بصيغة +962 انلتقط وانتطبّع");

// ── (3) رسالة بلا رقم ولا صنف → ما تنحفظ ولا طلب وهمي ──
await say("cC", "مرحبا كيف الاسعار");
ok(ordersFor("cC").length === 0, "استفسار بلا رقم ولا صنف → ما في سجل وهمي");

// ── (4) أرقام صغيرة (كميات/أسعار) مش تلفونات ──
await say("cD", "بدي 2 كيلو بسعر 10");
const cd = ordersFor("cD");
ok(cd.every(r => r.phone !== "2" && r.phone !== "10"), "الكميات والأسعار ما انحسبت أرقام تلفون");

// ── (5) الرقم بينتحدّث بنفس الجلسة مش بيعمل سجل جديد ──
await say("cA", "اسمي احمد ومنطقتي اربد");
ok(ordersFor("cA").length === 1, "نفس الجلسة بتضل سجل واحد (بينتحدّث مش بيتكرّر)");

wipe();
console.log(`\n${fail ? "🔴" : "🟢"} نجح ${pass} / فشل ${fail}`);
process.exit(fail ? 1 : 0);
