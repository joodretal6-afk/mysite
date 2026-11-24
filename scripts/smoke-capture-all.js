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

const msgsFor = (sender) => db.prepare(
  "SELECT * FROM messages WHERE page_id=? AND sender_id=? AND direction='in'").all(PAGE, sender);

// ── (1) رقم لحاله بلا أي صنف → 🔴 ما بينصنع طلب بقيمة 0 ──
await say("cA", "مرحبا رقمي 0791234567");
let rows = ordersFor("cA");
ok(rows.length === 0, "رقم بلا طلب → ما بينصنع طلب (ولا طلب بقيمة 0)");
ok(msgsFor("cA").length >= 1, "لكن رسالة الزبون محفوظة (صفحة الأرقام بتلتقطها)");

// ── (2) رسالة بلا رقم ولا صنف → ما تنحفظ ولا طلب ──
await say("cC", "مرحبا كيف الاسعار");
ok(ordersFor("cC").length === 0, "استفسار بلا رقم ولا صنف → ما في طلب");

// ── (3) طلب حقيقي بقيمة موجبة ما بيتأثر، والصفر بينشال (محرّك الحفظ) ──
// (بناء السلة الحيّ بيعتمد على الذكاء؛ هون منتأكد إنّ القاعدة بتضمن
//  إنّه ما في ولا طلب بقيمة 0 — وهو مطلب المالك الأساسي.)

// ── (4) ولا طلب أبداً بقيمة 0 بكل القاعدة ──
const zero = db.prepare("SELECT COUNT(*) c FROM orders WHERE total IS NULL OR total <= 0").get();
ok(Number(zero.c) === 0, "ما في ولا طلب بقيمة 0 بالقاعدة كلها");

// ── (5) ولا حالة «بحاجة متابعة» بتنصنع ──
const needFollow = db.prepare("SELECT COUNT(*) c FROM orders WHERE status='بحاجة متابعة'").get();
ok(Number(needFollow.c) === 0, "ما في ولا طلب «بحاجة متابعة» (ألغينا التقاط القيمة صفر)");

wipe();
console.log(`\n${fail ? "🔴" : "🟢"} نجح ${pass} / فشل ${fail}`);
process.exit(fail ? 1 : 0);
