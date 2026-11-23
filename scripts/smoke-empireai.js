// ═══════════════════════════════════════════════════════════
// 🧪 EMPIRE INTELLIGENCE — جمع الحقائق + نقطة السؤال (تدهور لطيف)
// ═══════════════════════════════════════════════════════════
if (!process.env.DB_PATH || /platform\.db/.test(process.env.DB_PATH))
  process.env.DB_PATH = "./data/smoke-empireai.db";
if (/platform\.db/.test(process.env.DB_PATH)) {
  console.error("🔴 رفض: الاختبار ما بيشتغل على قاعدة الإنتاج"); process.exit(1);
}
import fs from "node:fs";
const wipe = () => ["", "-wal", "-shm"].forEach(x => { try { fs.rmSync(process.env.DB_PATH + x); } catch {} });
wipe();

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { console.log("❌ " + m); fail++; } };

const { db } = await import("../src/db/database.js");
await new Promise(r => setTimeout(r, 800));
const ai = await import("../src/features/empireai.js");

// نزرع طلبات حقيقية
const mk = (page, total, status, at) => db.prepare(
  "INSERT INTO orders (page_id,page_name,sender_id,order_string,total,area,phone,status,messenger_url,created_at) VALUES (?,?,?,?,?,?,?,?,'',?)"
).run(page, "صفحة " + page, "u" + Math.random(), "جبنة غنم (2 نصية)", total, "عمان", "0790000000", status, at);
const T = Date.now();
for (let i = 0; i < 5; i++) mk("p1", 30, "تم التسليم", T - i * 86400000);
mk("p2", 50, "جديد", T - 2 * 3600000);
mk("p1", 20, "ملغي", T - 3600000);

// ── جمع الحقائق ──
const f = ai.gatherStrategicFacts();
ok(f && typeof f.text === "string" && f.text.length > 20, "جمع الحقائق يرجّع نصاً");
ok(Array.isArray(f.sources) && f.sources.length >= 2, "يذكر مصادر البيانات");
ok(f.data && f.data.sales, "فيه بيانات مبيعات منظّمة");
ok(/\d/.test(f.text) && f.text.includes("د"), "الحقائق فيها أرقام فعلية بالدينار");
ok(!/undefined|NaN/.test(f.text), "لا قيم undefined/NaN بالحقائق");

// ── نقطة /ask مع ذكاء غير متاح (نوقف الشبكة) → تدهور لطيف ──
globalThis.fetch = async () => { throw new Error("no network"); };
const call = (method, urlPath, body = {}) => new Promise((resolve) => {
  const layer = ai.router.stack.find(l => l.route && l.route.path === urlPath && l.route.methods[method]);
  const res = { code: 200, body: null, status(c){ this.code = c; return this; }, json(j){ this.body = j; resolve(this); return this; } };
  // express.json already parsed; we pass body directly
  layer.route.stack[layer.route.stack.length - 1].handle({ body, query: {} }, res, () => {});
});

const r = await call("post", "/ask", { question: "لماذا تغيّرت الأرباح؟" });
ok(r.body && r.body.ok, "نقطة /ask ترجّع بنجاح حتى بلا ذكاء");
ok(r.body.ai_available === false && r.body.note, "توسم أن الذكاء غير متاح وتعطي ملاحظة صريحة");
ok(r.body.facts && r.body.facts.length > 20, "ترجّع الأرقام الحقيقية للتحليل اليدوي");
ok(Array.isArray(r.body.sources) && r.body.sources.length, "ترجّع مصادر البيانات");

// سؤال فارغ يُرفض
const r2 = await call("post", "/ask", { question: "" });
ok(r2.code === 400, "سؤال فارغ بينرفض");

// presets
const rp = await call("get", "/presets");
ok(rp.body && rp.body.presets && rp.body.presets.length >= 4, "أسئلة جاهزة متوفرة");

wipe();
console.log(`\n${fail ? "🔴" : "🟢"} نجح ${pass} / فشل ${fail}`);
process.exit(fail ? 1 : 0);
