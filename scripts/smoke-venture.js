// اختبار باني المشاريع الغذائية.
// بيركّز على الحساب — لأن غلطة برقم التعادل بتفلّس مشروع.
// نقاط الذكاء الاصطناعي بتنختبر بالتوفّر مش بالمخرجات (بتحتاج مفتاح وشبكة).
process.env.DB_FILE = process.env.DB_FILE || "./data/smoke-venture.db";
import fs from "node:fs";
import express from "express";
if (fs.existsSync(process.env.DB_FILE)) fs.rmSync(process.env.DB_FILE);

await import("../src/db/database.js");
await new Promise(r => setTimeout(r, 1200));

const { unitEconomics, breakEven, reversePricing, scenarios, launchBudget } =
  await import("../src/venture/economics.js");
const { guessCategory, complianceChecklist } = await import("../src/venture/food.js");
const { adLibraryLinks } = await import("../src/venture/research.js");

let fail = 0;
const ok = (c, m) => { if (c) console.log("✅ " + m); else { console.log("❌ " + m); fail++; } };
const near = (a, b, t = 0.02) => Math.abs(a - b) <= t;

// ═══ 1) الحساب — تحقق يدوي بورقة وقلم ═══
console.log("── اقتصاديات الوحدة (تحقق يدوي) ──");
// سعر 20، تكلفة 8، فاقد 0، تغليف 0، شحن 0، توصيل 2.5 (كله عليّ)، إعلان 3، مرتجع 0
// تكلفة الطلب = 8 + 2.5 + 3 = 13.5 ⇒ ربح = 6.5
let u = unitEconomics({ sellPrice: 20, unitCost: 8, packaging: 0, shipping: 0,
  delivery: 2.5, deliveryCharged: 0, adCostPerOrder: 3, spoilageRate: 0, returnRate: 0, codFee: 0 });
ok(u.ok && near(u.perOrder, 6.5), `ربح الطلب = 6.5 (طلع ${u.perOrder})`);
ok(near(u.margin, 32.5, 0.6), `الهامش = 32.5% (طلع ${u.margin})`);

// الفاقد: تكلفة 8 بفاقد 20% ⇒ التكلفة الفعلية = 8 / 0.8 = 10
u = unitEconomics({ sellPrice: 20, unitCost: 8, packaging: 0, shipping: 0,
  delivery: 0, adCostPerOrder: 0, spoilageRate: 20, returnRate: 0 });
ok(near(u.effectiveCost, 10), `الفاقد: 8 ÷ (1−0.20) = 10 (طلع ${u.effectiveCost})`);
ok(near(u.perOrder, 10), `الربح بعد الفاقد = 10 (طلع ${u.perOrder})`);

// المرتجع: 50% مرتجع. الناجح: 20−(8+2.5)=9.5 ؛ المرتجع يخسر 8+(2.5×2)=13
// المتوسط = 0.5×9.5 − 0.5×13 = −1.75
u = unitEconomics({ sellPrice: 20, unitCost: 8, packaging: 0, shipping: 0,
  delivery: 2.5, adCostPerOrder: 0, spoilageRate: 0, returnRate: 50 });
ok(near(u.perOrder, -1.75), `المرتجع بيقلب الربح لخسارة −1.75 (طلع ${u.perOrder})`);
ok(near(u.returnLoss, 13), `خسارة المرتجع = التكلفة + توصيل ذهاب وإياب = 13 (طلع ${u.returnLoss})`);

console.log("\n── حالات حدّية ──");
ok(!unitEconomics({ sellPrice: 0, unitCost: 5 }).ok, "سعر صفر مرفوض");
ok(!unitEconomics({ sellPrice: 20, unitCost: 0 }).ok, "تكلفة صفر مرفوضة — بلاها الحساب وهمي");
u = unitEconomics({ sellPrice: 10, unitCost: 9, delivery: 5, adCostPerOrder: 4 });
ok(u.ok && u.perOrder < 0 && u.verdict.level === "خاسر", `الخسارة بتنكشف صراحة (${u.perOrder})`);

console.log("\n── نقطة التعادل ──");
let be = breakEven({ sellPrice: 20, unitCost: 8, packaging: 0, shipping: 0, delivery: 2.5,
  adCostPerOrder: 3, spoilageRate: 0, returnRate: 0, monthlyFixed: 650 });
ok(be.ok && be.ordersToBreakEven === 100, `650 ÷ 6.5 = 100 طلب (طلع ${be.ordersToBreakEven})`);
be = breakEven({ sellPrice: 10, unitCost: 9, delivery: 5, adCostPerOrder: 4, monthlyFixed: 500 });
ok(be.impossible && be.fixes && be.fixes.length > 0,
   "الربح سالب ⇒ ما في تعادل، وبيقترح إصلاحات");
// حالة ميؤوس منها (تكلفة 9 + توصيل 5 + إعلان 4 = 18 مقابل سعر 10):
// المطلوب إنه النظام يقول الحقيقة — مش يخترع حل وهمي.
ok(be.fixes.every(f => f.ربح_الطلب > be.perOrder),
   "كل إصلاح مقترح بيحسّن الوضع فعلياً عن الحالي");
const combo = be.fixes.find(f => f.مركّب);
ok(combo, "لما ما ينفع إصلاح مفرد، بيجرّب الثلاثة مع بعض");
ok(combo && !combo.يحل_المشكلة && String(combo.ملاحظة).includes("النموذج نفسه"),
   "وبيقول صراحة إنه النموذج نفسه ما بيمشي بدل ما يوهم التاجر بحل");

// وحالة قابلة للإصلاح: لازم يلاقي حل مفرد
const fixable = breakEven({ sellPrice: 15, unitCost: 8, delivery: 2.5, adCostPerOrder: 3,
  spoilageRate: 0, returnRate: 0, monthlyFixed: 100 });
ok(fixable.ok && !fixable.impossible, "الحالة القابلة للربح بتطلع نقطة تعادل عادية");

console.log("\n── التسعير العكسي ──");
const rp = reversePricing({ unitCost: 8, delivery: 2.5, adCostPerOrder: 3,
  spoilageRate: 0, returnRate: 0, targetMargin: 30 });
ok(rp.ok && near(rp.economics.margin, 30, 1.5),
   `سعر يحقق هامش 30% = ${rp.suggestedPrice} (الهامش الفعلي ${rp.economics.margin}%)`);

console.log("\n── السيناريوهات ──");
const sc = scenarios({ sellPrice: 20, unitCost: 8, delivery: 2.5, adCostPerOrder: 3,
  returnRate: 10, spoilageRate: 5, targetOrders: 100, monthlyFixed: 200 });
ok(sc.ok && sc.rows.length === 3, "3 سيناريوهات");
const [pes, real, opt] = sc.rows;
ok(pes.monthlyProfit < real.monthlyProfit && real.monthlyProfit < opt.monthlyProfit,
   `متشائم(${pes.monthlyProfit}) < واقعي(${real.monthlyProfit}) < متفائل(${opt.monthlyProfit})`);

console.log("\n── ميزانية الإطلاق ──");
const lb = launchBudget({ sellPrice: 20, unitCost: 8, packaging: 0.35, delivery: 2.5,
  adCostPerOrder: 3, targetOrders: 100, testOrders: 40, cashCycleDays: 14 });
ok(lb.ok && lb.total > 0 && lb.workingCapital > 0,
   `إجمالي ${lb.total} + رأس مال عامل ${lb.workingCapital} = ${lb.totalNeeded}`);

console.log("\n── التصنيف الغذائي ──");
ok(guessCategory("لبنة بلدية").key === "dairy_fresh", "لبنة ⇒ ألبان طازجة");
ok(guessCategory("غنم نعيمي").key === "meat_frozen", "غنم ⇒ لحوم");
ok(guessCategory("عسل سدر").key === "dry_shelf", "عسل ⇒ جاف");
ok(guessCategory("بروتين واي").key === "supplements", "بروتين ⇒ مكمّلات");
ok(guessCategory("شي غريب").guessed === false, "الصنف المجهول بيتعلّم إنه تخمين");
ok(guessCategory("لبنة").coldChain === true, "الألبان بتحتاج تبريد");
ok(complianceChecklist("supplements").items.some(i => String(i.بند).includes("ادعاء")),
   "المكمّلات بتحذّر من الادعاءات العلاجية");
ok(complianceChecklist("meat_frozen").criticalCount >= 6, "اللحوم عندها بنود حرجة أكثر");

console.log("\n── روابط مكتبة الإعلانات ──");
const links = adLibraryLinks("لبنة", "JO");
ok(links.length >= 5 && links.every(l => l.url.startsWith("https://www.facebook.com/ads/library/")),
   `${links.length} رابط بصيغة مكتبة الإعلانات الرسمية`);
ok(links[0].url.includes("country=JO") && links[0].url.includes(encodeURIComponent("لبنة")),
   "الرابط فيه البلد واسم الصنف مرمّزين");

// ═══ 2) نقاط النهاية ═══
console.log("\n── نقاط النهاية ──");
const { loadFeatures } = await import("../src/features/index.js");
const app = express(); app.use(express.json());
for (const f of await loadFeatures()) app.use("/f-api/" + f.slug, f.router);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/f-api/venture`;

const hit = async (method, path, body) => {
  const r = await fetch(base + path, {
    method, headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: r.status, json: await r.json() };
};

const ECON = { sellPrice: 20, unitCost: 8, packaging: 0.35, delivery: 2.5,
               adCostPerOrder: 3, spoilageRate: 7, returnRate: 10,
               monthlyFixed: 300, targetOrders: 100 };

const created = await hit("POST", "/projects", { product: "لبنة بلدية" });
ok(created.status === 200 && created.json.id, `إنشاء مشروع (id=${created.json.id})`);
ok(created.json.category.key === "dairy_fresh", "الفئة انتقت تلقائياً: ألبان طازجة");
const PID = created.json.id;

await hit("POST", "/3/competitors", { project_id: PID, name: "منافس أ", price: 3.5, delivery: 2, angle: "بلدي" });
await hit("POST", "/3/competitors", { project_id: PID, name: "منافس ب", price: 4.0, delivery: 0, angle: "بلدي" });
await hit("POST", "/3/competitors", { project_id: PID, name: "منافس ج", price: 6.5, delivery: 2, angle: "بلدي", offer: "خصم" });

const TESTS = [
  ["projects", "GET", "/projects"],
  ["1 تصنيف", "GET", "/1/classify?product=لبنة"],
  ["2 كاشف المنافسين", "GET", "/2/competitors/discover?product=لبنة"],
  ["3 سجل المنافسين", "GET", `/3/competitors?project_id=${PID}`],
  ["4 فجوة السوق", "GET", `/4/gap?project_id=${PID}`],
  ["5 إشارة الطلب", "GET", "/5/demand?product=لبنة"],
  ["6 بحث محفوظ", "GET", `/6/research/saved?project_id=${PID}`],
  ["7 اقتصاديات الوحدة", "POST", "/7/unit", ECON],
  ["8 نقطة التعادل", "POST", "/8/breakeven", ECON],
  ["9 تسعير عكسي", "POST", "/9/pricing", { ...ECON, targetMargin: 30 }],
  ["10 السيناريوهات", "POST", "/10/scenarios", ECON],
  ["11 ميزانية الإطلاق", "POST", "/11/budget", ECON],
  ["12 تشخيص", "POST", "/12/fix", ECON],
  ["13 الامتثال", "GET", "/13/compliance?category=dairy_fresh"],
  ["14 سياسة الإعلانات", "GET", "/14/adpolicy?category=dairy_fresh"],
  ["15 التبريد", "GET", "/15/coldchain?category=dairy_fresh"],
  ["16 الفاقد", "POST", "/16/spoilage", { ...ECON, category: "dairy_fresh" }],
  ["17 الموقع التنافسي", "GET", `/17/positioning?project_id=${PID}&sellPrice=20`],
  ["18 بناء العرض", "GET", `/18/offer?project_id=${PID}&sellPrice=20&unitCost=8`],
  ["27 خطة الاختبار", "POST", "/27/testplan", ECON],
  ["28 المخاطر", "GET", `/28/risks?category=dairy_fresh&project_id=${PID}`],
  ["29 لوحة القرار", "POST", "/29/verdict", { ...ECON, category: "dairy_fresh", project_id: PID }],
  ["30 خطة الطريق", "POST", "/30/roadmap", { ...ECON, category: "dairy_fresh", project_id: PID }],
  ["فهرس الخدمات", "GET", "/services"]
];

for (const [name, m, p, b] of TESTS) {
  try {
    const r = await hit(m, p, b);
    ok(r.status === 200 && !r.json.error, `${name}${r.json.error ? " → " + r.json.error : ""}`);
  } catch (e) { ok(false, `${name} → ${e.message}`); }
}

// تحقق من محتوى مخرجات مهمة
const gap = await hit("GET", `/4/gap?project_id=${PID}`);
ok(gap.json.enough && gap.json.gaps.length > 0, `فجوة السوق لقت ${gap.json.gaps.length} فرصة`);
const verdict = await hit("POST", "/29/verdict", { ...ECON, category: "dairy_fresh", project_id: PID });
ok(typeof verdict.json.score === "number" && verdict.json.verdict.قرار,
   `لوحة القرار: ${verdict.json.score}/100 — ${verdict.json.verdict.قرار}`);
const disc = await hit("GET", "/2/competitors/discover?product=لبنة");
ok(disc.json.limits && disc.json.limits.ما_ما_نقدر_عليه.length >= 3,
   "كاشف المنافسين بيعلن حدوده صراحة");

server.close();
console.log(`\n${"═".repeat(46)}\n   ${fail ? `فشل ${fail}` : "كل الفحوصات نجحت"}\n${"═".repeat(46)}`);
try { fs.rmSync(process.env.DB_FILE); } catch {}
process.exit(fail ? 1 : 0);
