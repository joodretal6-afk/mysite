// اختبار دخان لمحركات عقل المبيعات الـ20.
// بيزرع بيانات وهمية بقاعدة مؤقتة وبيضرب كل نقطة نهاية.
// التشغيل:  node scripts/smoke-brain.js

// 🔴 حارس: ممنوع الاختبار يلمس قاعدة الإنتاج.
// غلطة سابقة: كنا نضبط DB_FILE والقاعدة بتقرأ DB_PATH — فكل الاختبارات
// كتبت بيانات وهمية بقاعدة حقيقية. الحارس هون عشان ما تتكرر.
if (!process.env.DB_PATH || /platform\.db/.test(process.env.DB_PATH)) {
  process.env.DB_PATH = "./data/smoke-" + (import.meta.url.match(/smoke-([a-z-]+)\.js/) || [,"test"])[1] + ".db";
}
if (/platform\.db/.test(process.env.DB_PATH)) {
  console.error("🔴 رفض: الاختبار ما بيشتغل على قاعدة الإنتاج"); process.exit(1);
}
process.env.DB_PATH = process.env.DB_PATH || "./data/smoke-brain.db";

import fs from "node:fs";
import express from "express";

// SQLite بوضع WAL بيكتب ملفات جانبية — لازم تنحذف كلها
const wipe = () => ["", "-wal", "-shm"].forEach(x => { try { fs.rmSync(process.env.DB_PATH + x); } catch {} });
wipe();

const { db } = await import("../src/db/database.js");
await new Promise(r => setTimeout(r, 1200));

// ── زرع بيانات ──
const DAY = 86400000, now = Date.now();
const PRODUCTS = ["غنم", "لبنة", "زيت زيتون", "عسل"];
const AREAS = ["عمان", "اربد", "الزرقاء"];
const rnd = n => Math.floor(Math.random() * n);

for (const [p, c] of [["غنم", 40], ["لبنة", 3], ["زيت زيتون", 12], ["عسل", 9]])
  db.prepare("INSERT OR REPLACE INTO product_costs (product,cost,updated_at) VALUES (?,?,?)").run(p, c, now);

const MSGS = [
  "مرحبا شو عندكم", "كم سعر غنم", "غالي شوي في خصم", "بدي اطلب غنم",
  "بكم التوصيل", "التوصيل غالي", "مش متوفر عسل؟", "بفكر وبحكيلك",
  "زيت زيتون اصلي؟ بدي اشوف", "قديش لبنة", "بدي أطلب لبنة كيلو", "وينكم ما رديتو"
];

let orderId = 0;
for (let i = 0; i < 220; i++) {
  const sid = "u" + (i % 90);
  const at = now - rnd(60) * DAY - rnd(20) * 3600000;
  const nMsg = 1 + rnd(6);
  for (let m = 0; m < nMsg; m++) {
    db.prepare(`INSERT INTO messages (page_id,page_name,sender_id,direction,body,created_at)
                VALUES (?,?,?,?,?,?)`)
      .run("p1", "صفحة الاختبار", sid, "in", MSGS[rnd(MSGS.length)], at + m * 60000);
    if (Math.random() > 0.25)   // 25% بلا رد — عشان نختبر كشف "ما إجاه رد"
      db.prepare(`INSERT INTO messages (page_id,page_name,sender_id,direction,body,created_at)
                  VALUES (?,?,?,?,?,?)`)
        .run("p1", "صفحة الاختبار", sid, "out", "أهلاً فيك", at + m * 60000 + (1 + rnd(90)) * 60000);
  }
  if (Math.random() > 0.55) {
    const items = [];
    const k = 1 + rnd(2);
    for (let j = 0; j < k; j++) items.push(`${PRODUCTS[rnd(PRODUCTS.length)]} (${1 + rnd(3)} كيلو)`);
    db.prepare(`INSERT INTO orders (page_id,page_name,sender_id,order_string,total,area,phone,status,created_at)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run("p1", "صفحة الاختبار", sid, items.join(" + "), 20 + rnd(120),
           AREAS[rnd(AREAS.length)], "079" + (1000000 + rnd(8999999)),
           Math.random() > 0.85 ? "ملغي" : "جديد", at + 3600000);
    orderId++;
  }
}
console.log(`🌱 زرعنا: ${orderId} طلب، ~${220 * 3} رسالة\n`);

// ── تركيب السيرفر بلا مصادقة ──
const { loadFeatures } = await import("../src/features/index.js");
const app = express();
app.use(express.json());
for (const f of await loadFeatures()) app.use("/f-api/" + f.slug, f.router);

const server = app.listen(0);
const port = server.address().port;
const base = `http://127.0.0.1:${port}/f-api`;

const TESTS = [
  ["🧠  1 عقل العميل",        "GET",  "/intel/brain?days=90"],
  ["🔥  2 نية الشراء",         "GET",  "/intel/intent?days=60"],
  ["💰  3 الفلوس الضائعة",     "GET",  "/intel/lost?days=60"],
  ["🎯  4 الشراء التالي",      "GET",  "/retention/next-buy"],
  ["🧬  5 حمض العميل النووي",  "GET",  "/intel/dna?days=90"],
  ["🕵️  6 منجم الاعتراضات",    "GET",  "/intel/objections?days=60"],
  ["🧪  7 مختبر العروض",       "GET",  "/pricing/offers"],
  ["💵  8 مستشار التسعير",     "GET",  "/pricing/advisor"],
  ["📈  9 رادار الفرص",        "GET",  "/growth/radar?window=14"],
  ["🥇 10 ترتيب المنتجات",     "GET",  "/growth/ranking"],
  ["🧲 11 مغناطيس العملاء",    "GET",  "/growth/magnet"],
  ["✍️ 12 مختبر النسخ",        "GET",  "/growth/copy?product=غنم"],
  ["🔬 13 التجارب",            "GET",  "/quality/experiments"],
  ["🗺️ 14 رحلة العميل",        "GET",  "/quality/journey?days=60"],
  ["⚡ 15 سرعة الرد",          "GET",  "/quality/speed?days=60"],
  ["👑 16 قيمة العميل",        "GET",  "/retention/value"],
  ["♻️ 17 العملاء المفقودون",  "GET",  "/retention/churn"],
  ["🧠 18 المحاكي",            "POST", "/pricing/simulate", { scenario: "price", product: "غنم", newPrice: 60 }],
  ["🏆 19 قائد السوق",         "POST", "/growth/market-plan", { product: "غنم", country: "الأردن", category: "أغذية" }],
  ["👑 20 مركز القيادة",       "GET",  "/chief/command?days=60"]
];

let pass = 0, fail = 0;
for (const [name, method, path, body] of TESTS) {
  try {
    const r = await fetch(base + path, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const j = await r.json();
    if (r.ok && !j.error) { pass++; console.log(`✅ ${name}`); }
    else { fail++; console.log(`❌ ${name} → ${r.status} ${j.error || ""}`); }
  } catch (e) { fail++; console.log(`❌ ${name} → ${e.message}`); }
}

// اختبار دورة التجربة كاملة: إنشاء → تسجيل → حكم
try {
  const c = await (await fetch(base + "/quality/experiments", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "اختبار خصم", kind: "offer", target: "غنم",
      variants: [{ label: "A", description: "سعر عادي" }, { label: "B", description: "خصم 10%" }] })
  })).json();
  const [a, b] = c.experiment.arms;
  for (let i = 0; i < 120; i++) {
    const v = i % 2 ? b : a;
    await fetch(`${base}/quality/experiments/${c.id}/record`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ variant_id: v.id, event: "exposure" })
    });
    // B بتحوّل ضعف A — لازم النظام يكتشفها
    if (Math.random() < (v.label === "B" ? 0.30 : 0.12))
      await fetch(`${base}/quality/experiments/${c.id}/record`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ variant_id: v.id, event: "conversion", value: 50, profit: 15 })
      });
  }
  const ev = await (await fetch(`${base}/quality/experiments/${c.id}`)).json();
  console.log(`\n🔬 دورة التجربة: ${ev.verdict}`);
  console.log(`   A=${ev.arms[0].rate}%  B=${ev.arms[1].rate}%  z=${ev.z}  دلالة=${ev.significant}`);
  pass++;
} catch (e) { fail++; console.log(`❌ دورة التجربة → ${e.message}`); }

// عيّنة من مركز القيادة
try {
  const cc = await (await fetch(base + "/chief/command?days=60")).json();
  console.log(`\n👑 مركز القيادة:`);
  console.log(`   💰 مبيعات: ${cc.sales.value} (${cc.sales.orders} طلب، متوسط ${cc.sales.aov})`);
  console.log(`   🔴 خسارة مقدّرة: ${cc.totalLossValue}`);
  if (cc.losses[0]) console.log(`      أكبرها: ${cc.losses[0].what} — ${cc.losses[0].why}`);
  if (cc.opportunities[0]) console.log(`   🟢 فرصة: ${cc.opportunities[0].what}`);
  if (cc.actions[0]) console.log(`   ⚡ الإجراء: ${cc.actions[0].action}`);
  console.log(`   📊 ثقة: ${cc.confidence.level} (${cc.confidence.note})`);
} catch (e) { console.log("❌ عيّنة القيادة:", e.message); }

console.log(`\n${"═".repeat(46)}\n   نجح ${pass} · فشل ${fail}\n${"═".repeat(46)}`);
server.close();
try { wipe(); } catch {}
process.exit(fail ? 1 : 0);
