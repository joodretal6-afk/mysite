// ═══════════════════════════════════════════════════════════
// 🧪 اختبار وحدة شركات التوصيل والبوالص
//
// بيغطي: التحقق من المدخلات، أساس السعر (تسعيرة/افتراضي/غير
// معروف)، السجل الزمني للحالات، مؤشرات الأداء وحالات «ما في
// بيانات» اللي لازم ترجع null مش صفر، المقارنة والحاسبة،
// المتأخرات، المطالبات، التقرير الشهري، والراوتر عبر HTTP.
// ═══════════════════════════════════════════════════════════
if (!process.env.DB_PATH || /platform\.db/.test(process.env.DB_PATH))
  process.env.DB_PATH = "./data/smoke-delivery.db";
if (/platform\.db/.test(process.env.DB_PATH)) {
  console.error("🔴 رفض: الاختبار ما بيشتغل على قاعدة الإنتاج"); process.exit(1);
}
import fs from "node:fs";
const wipe = () => ["", "-wal", "-shm"].forEach(x => { try { fs.rmSync(process.env.DB_PATH + x); } catch {} });
wipe();

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { console.log("❌ " + m); fail++; } };
const threw = (fn) => { try { fn(); return false; } catch { return true; } };

const dv = await import("../src/features/delivery.js");
await new Promise(r => setTimeout(r, 500));
const { db } = await import("../src/db/database.js");

const DAY = 86400000;
const TZ_MS = 10800 * 1000;
const dayStr = (ts) => new Date(ts + TZ_MS).toISOString().slice(0, 10);

// ═══════════ (1) الشركات ═══════════
// أول شي: قبل ما ينوجد ولا شركة — لازم النظام يقول «ما في بيانات»
// بدل ما يخترع مقارنة أو «أفضل خيار».
const cmpEmpty = dv.compareArea("العقبة");
ok(cmpEmpty.rows.length === 0 && cmpEmpty.cheapest === null && /ما في ولا شركة/.test(cmpEmpty.note),
   "🔴 مقارنة بلا ولا شركة بترجع رسالة واضحة مش مقارنة وهمية");
const qEmpty = dv.quote("العقبة", 3);
ok(qEmpty.best === null && qEmpty.saving === null && /ما في سعر مسجّل/.test(qEmpty.note),
   "🔴 حاسبة بلا أي تسعيرة → ما في «أفضل خيار» مخترع ولا وفر مخترع");

const speedy = dv.saveCourier({ name: "سبيدي", phone: "0790000000", default_price: 2, areas: "عمّان، الزرقاء" });
const fast   = dv.saveCourier({ name: "فاست", default_price: 1.75 });
const noPrice = dv.saveCourier({ name: "بلا تسعيرة" });   // 🔴 بلا سعر افتراضي إطلاقاً

ok(speedy > 0 && fast > 0, "انسجّلت شركات التوصيل");
ok(threw(() => dv.saveCourier({ name: "" })), "شركة بلا اسم بتنرفض");
ok(threw(() => dv.saveCourier({ name: "سبيدي" })), "اسم شركة مكرّر بينرفض");
ok(threw(() => dv.saveCourier({ name: "غلط", default_price: -3 })), "سعر افتراضي سالب بينرفض");
ok(db.prepare("SELECT default_price p FROM delivery_couriers WHERE id=?").get(noPrice).p === null,
   "🔴 شركة بلا سعر افتراضي بتنخزن null مش صفر");

// ═══════════ (2) التسعيرة حسب المنطقة ═══════════
dv.saveRate({ courier_id: speedy, area: "إربد", price: 3, eta_days: 2 });
dv.saveRate({ courier_id: fast, area: "إربد", price: 2.5, eta_days: 4 });
dv.saveRate({ courier_id: speedy, area: "إربد", price: 2.8, eta_days: 2 });   // تحديث مش تكرار

ok(db.prepare("SELECT COUNT(*) c FROM delivery_rates WHERE courier_id=? AND area='إربد'").get(speedy).c === 1,
   "تسعيرة نفس المنطقة بتنحدّث مش بتنكرّر");
ok(dv.priceFor(speedy, "إربد").price === 2.8 && dv.priceFor(speedy, "إربد").basis === "تسعيرة المنطقة",
   "سعر المنطقة بيغلب السعر الافتراضي ومعه أساسه");
ok(dv.priceFor(speedy, "معان").price === 2 && dv.priceFor(speedy, "معان").basis === "السعر الافتراضي للشركة",
   "منطقة بلا تسعيرة بترجع للسعر الافتراضي مع ذكر الأساس");
const unk = dv.priceFor(noPrice, "معان");
ok(unk.price === null && unk.basis === "غير معروف",
   "🔴 شركة بلا أي سعر → السعر null و«غير معروف» مش صفر");
ok(threw(() => dv.saveRate({ courier_id: 9999, area: "إربد", price: 3 })), "تسعيرة لشركة مش موجودة بتنرفض");
ok(threw(() => dv.saveRate({ courier_id: speedy, area: "", price: 3 })), "تسعيرة بلا منطقة بتنرفض");
ok(threw(() => dv.saveRate({ courier_id: speedy, area: "عجلون", price: "" })), "تسعيرة بلا سعر بتنرفض");
ok(threw(() => dv.saveRate({ courier_id: speedy, area: "عجلون", price: 3, eta_days: 2.5 })),
   "مدة توصيل كسرية بتنرفض");

// ═══════════ (3) البوالص ═══════════
db.prepare("INSERT INTO orders (id,page_id,order_string,total,area,phone,status,created_at) VALUES (?,?,?,?,?,?,?,?)")
  .run(501, "p1", "جبنة (2)", 30, "إربد", "079", "جديد", Date.now());

const w1 = dv.createWaybill({ tracking: "JO-1001", courier_id: speedy, area: "إربد",
                              order_id: 501, cod_amount: 30, shipped_at: dayStr(Date.now() - 6 * DAY) });
ok(w1 > 0, "انسجّلت بوليصة مربوطة بطلب حقيقي");
const w1row = db.prepare("SELECT * FROM delivery_waybills WHERE id=?").get(w1);
ok(w1row.fee === 2.8 && w1row.fee_basis === "تسعيرة المنطقة",
   "الأجرة انتعبّت من تسعيرة المنطقة ومعها أساسها");
ok(w1row.status === "قيد التجهيز" && w1row.closed_at === null, "البوليصة الجديدة مفتوحة بلا تاريخ إغلاق");

const wNo = dv.createWaybill({ tracking: "JO-NOFEE", courier_id: noPrice, area: "معان" });
ok(db.prepare("SELECT fee,fee_basis f FROM delivery_waybills WHERE id=?").get(wNo).fee === null,
   "🔴 بوليصة عند شركة بلا تسعيرة → الأجرة null مش صفر");

ok(threw(() => dv.createWaybill({ tracking: "JO-1001", courier_id: speedy, area: "إربد" })),
   "رقم بوليصة مكرّر بينرفض");
ok(threw(() => dv.createWaybill({ tracking: "ا ب", courier_id: speedy, area: "إربد" })),
   "رقم بوليصة بصيغة غلط بينرفض");
ok(threw(() => dv.createWaybill({ tracking: "JO-X1", courier_id: 9999, area: "إربد" })),
   "بوليصة لشركة مش موجودة بتنرفض");
ok(threw(() => dv.createWaybill({ tracking: "JO-X2", courier_id: speedy, area: "" })),
   "بوليصة بلا منطقة بتنرفض");
ok(threw(() => dv.createWaybill({ tracking: "JO-X3", courier_id: speedy, area: "إربد", order_id: 99999 })),
   "🔴 الربط بطلب مش موجود بينرفض — ما منربط برقم من الهوا");
ok(threw(() => dv.createWaybill({ tracking: "JO-X4", courier_id: speedy, area: "إربد", status: "طايرة" })),
   "حالة غير معروفة بتنرفض");
ok(threw(() => dv.createWaybill({ tracking: "JO-X5", courier_id: speedy, area: "إربد", shipped_at: "2026/01/01" })),
   "تاريخ شحن بصيغة غلط بينرفض");
ok(db.prepare("SELECT COUNT(*) c FROM delivery_waybills").get().c === 2,
   "ولا وحدة من البوالص المرفوضة انحفظت");

// ═══════════ (4) الحالات والسجل الزمني ═══════════
ok(dv.waybillEvents(w1).length === 1 && dv.waybillEvents(w1)[0].to_status === "قيد التجهيز",
   "التسجيل نفسه انكتب كأول حدث بالسجل");
dv.setStatus(w1, "بالطريق", "أحمد", "", Date.now() - 5 * DAY);
dv.setStatus(w1, "تم التسليم", "أحمد", "استلمها الزبون", Date.now() - 2 * DAY);
const ev = dv.waybillEvents(w1);
ok(ev.length === 3 && ev[2].from_status === "بالطريق" && ev[2].actor === "أحمد",
   "السجل الزمني بيحفظ من وين لوين ومين غيّر");
ok(db.prepare("SELECT closed_at FROM delivery_waybills WHERE id=?").get(w1).closed_at != null,
   "الحالة النهائية بتكتب تاريخ الإغلاق");
ok(threw(() => dv.setStatus(w1, "تم التسليم")), "تغيير الحالة لنفس الحالة بينرفض");
ok(threw(() => dv.setStatus(w1, "مفقودة")), "حالة غير معروفة بتنرفض");
ok(threw(() => dv.setStatus(99999, "بالطريق")), "بوليصة مش موجودة بتنرفض");
dv.setStatus(w1, "بالطريق", "أحمد");
ok(db.prepare("SELECT closed_at FROM delivery_waybills WHERE id=?").get(w1).closed_at === null,
   "الرجوع لحالة سير بيمسح تاريخ الإغلاق حتى ما يتلوّث متوسط الأيام");
dv.setStatus(w1, "تم التسليم", "أحمد", "", Date.now() - 2 * DAY);

// ═══════════ (5) الأداء ═══════════
const stNo = dv.courierStats(noPrice);
ok(stNo.delivery_rate === null && stNo.avg_days === null && stNo.cost_per_parcel === null,
   "🔴 شركة بلا بوالص مغلقة → كل المؤشرات null مش صفر");
ok(stNo.basis === "ما في بوالص مغلقة بعد", "سبب غياب المؤشر مكتوب بصراحة");
ok(dv.courierStats(fast).basis === "ما في بوالص لهاي الشركة", "شركة بلا ولا بوليصة إلها سبب مختلف");
ok(stNo.fee_unknown === 1 && stNo.fee_total === null,
   "🔴 أجرة غير معروفة بتنعدّ لحالها والمجموع بيضل null");

const w2 = dv.createWaybill({ tracking: "JO-1002", courier_id: speedy, area: "إربد",
                              shipped_at: dayStr(Date.now() - 8 * DAY) });
dv.setStatus(w2, "رفض عند الاستلام", "سامي", "", Date.now() - 4 * DAY);
const w3 = dv.createWaybill({ tracking: "JO-1003", courier_id: speedy, area: "عمّان",
                              shipped_at: dayStr(Date.now() - 3 * DAY) });   // لسا مفتوحة

const stS = dv.courierStats(speedy);
ok(stS.waybills === 3 && stS.closed === 2 && stS.open === 1, "عدّ البوالص المفتوحة والمغلقة");
ok(stS.delivery_rate === 50 && stS.refusal_rate === 50,
   "النِسَب محسوبة على المغلقة فقط (1 من 2) — المفتوحة ما بتحسب نجاح ولا فشل");
ok(Math.round(stS.avg_days) === 4 && stS.avg_days_sample === 1,
   "متوسط أيام التوصيل من المسلَّمة اللي معروف إغلاقها (شُحنت قبل 6 أيام وتسلّمت قبل يومين)");
ok(stS.cost_per_parcel === 2.53 && stS.fee_known === 3 && stS.fee_total === 7.6,
   "تكلفة الطرد = مجموع الأجور ÷ الطرود اللي أجرتها معروفة (2.8+2.8+2)/3");
ok(stS.collected === 30, "المُحصّل من المسلَّمة فقط");
ok(dv.courierStats(speedy, { from: Date.now(), to: Date.now() }).basis === "ما في بوالص لهاي الشركة",
   "فلترة الفترة بتشتغل على الأداء");

// ═══════════ (6) المقارنة ═══════════
const cmp = dv.compareArea("إربد");
ok(cmp.cheapest.name === "فاست" && cmp.cheapest.price === 2.5, "الأرخص على المنطقة انحدّد صح");
ok(cmp.fastest.name === "سبيدي" && /أيام فعلية/.test(cmp.fastest.basis),
   "الأسرع انحدّد من أيام فعلية مش من وعد الشركة");
ok(cmp.rows.find(r => r.name === "بلا تسعيرة").price === null,
   "🔴 شركة بلا سعر بتظهر بالمقارنة بسعر null مش صفر");
const cmpFallback = dv.compareArea("العقبة");
ok(cmpFallback.cheapest.name === "فاست" &&
   cmpFallback.rows.find(r => r.name === "فاست").price_basis === "السعر الافتراضي للشركة",
   "منطقة بلا تسعيرة خاصة بتتقارن بالأسعار الافتراضية مع ذكر الأساس");
ok(cmpFallback.rows.find(r => r.name === "بلا تسعيرة").delivery_rate === null,
   "🔴 شركة بلا بوالص بالمنطقة → نسبة تسليمها null مش صفر");
ok(threw(() => dv.compareArea("")), "مقارنة بلا منطقة بتنرفض");

// ═══════════ (7) المتأخرات ═══════════
const late = dv.lateWaybills(2);
ok(late.length === 1 && late[0].tracking === "JO-1003", "بوليصة مفتوحة من 3 أيام ظهرت كمتأخرة عن حد يومين");
ok(late[0].age_days === 3 && late[0].courier_name === "سبيدي", "المتأخرة بتقول عمرها وشركتها");
ok(dv.lateWaybills(30).length === 0, "برفع الحد ما بيضل في متأخرات");
ok(threw(() => dv.lateWaybills(-1)), "حد أيام سالب بينرفض");

// ═══════════ (8) المطالبات ═══════════
const cl1 = dv.openClaim({ waybill_id: w2, kind: "طرد ضايع", amount: 30 });
ok(cl1 > 0, "انفتحت مطالبة");
ok(threw(() => dv.openClaim({ waybill_id: w2, kind: "طرد ضايع", amount: 5 })),
   "مطالبة تانية مفتوحة على نفس البوليصة بتنرفض");
ok(threw(() => dv.openClaim({ waybill_id: w2, kind: "شي" })), "نوع مطالبة غير معروف بينرفض");
ok(threw(() => dv.openClaim({ waybill_id: 9999, kind: "طرد ضايع" })), "مطالبة على بوليصة مش موجودة بتنرفض");
const cl2 = dv.openClaim({ waybill_id: w1, kind: "طرد متضرر" });   // بلا قيمة
ok(db.prepare("SELECT amount FROM delivery_claims WHERE id=?").get(cl2).amount === null,
   "🔴 مطالبة بلا قيمة معروفة بتنخزن null مش صفر");
const c0 = dv.claimRows();
ok(c0.totals.amount_at_risk === 30 && c0.totals.amount_unknown === 1,
   "المبلغ المعرّض للخطر من المطالبات المعروفة القيمة، والباقي بينعدّ لحاله");
ok(c0.totals.avg_days_to_resolve === null && c0.totals.compensated === null,
   "🔴 ما في مطالبة محلولة → متوسط الحل والتعويض null مش صفر");
ok(c0.rows[0].days_to_resolve === null && c0.rows[0].age_days === 0,
   "المطالبة المفتوحة إلها عمر مش مدة حل");
dv.resolveClaim(cl1, "معوّضة", "تعويض كامل", Date.now() + 2 * DAY);
ok(threw(() => dv.resolveClaim(cl1, "مرفوضة")), "المطالبة المحلولة ما بتنحلّ مرتين");
ok(threw(() => dv.resolveClaim(cl2, "مفتوحة")), "ما بتنرجع «مفتوحة» عبر الحل");
const c1 = dv.claimRows();
ok(c1.totals.compensated === 30 && c1.totals.avg_days_to_resolve === 2,
   "بعد التعويض: المبلغ ومتوسط أيام الحل صاروا محسوبين");
ok(c1.totals.amount_at_risk === 0 || c1.totals.amount_at_risk === null,
   "المطالبة المحلولة طلعت من المبلغ المعرّض للخطر");

// ═══════════ (9) الحاسبة ═══════════
const q = dv.quote("إربد", 10);
ok(q.best.name === "فاست" && q.best.total === 25, "الحاسبة: 10 طرود × 2.5 = 25 عند الأرخص");
ok(q.saving === 3, "الوفر = فرق الأغلى عن الأرخص (28 − 25)");
ok(q.options[q.options.length - 1].total === null,
   "الشركة اللي بلا سعر بتنزل آخر القائمة بمجموع null");
ok(dv.quote("العقبة", 2).best.total === 3.5 && dv.quote("العقبة", 2).best.days_basis === "غير معروف",
   "منطقة بالسعر الافتراضي: المجموع بينحسب بس مدة التوصيل بتضل «غير معروف»");
ok(threw(() => dv.quote("إربد", 0)), "عدد طرود صفر بينرفض");
ok(threw(() => dv.quote("إربد", 2.5)), "عدد طرود كسري بينرفض");

// ═══════════ (10) التقرير الشهري ═══════════
const thisMonth = dayStr(Date.now()).slice(0, 7);
const rep = dv.monthlyReport(thisMonth);
ok(rep.month === thisMonth && !rep.empty, "التقرير الشهري بيطلع لشهر فيه حركة");
ok(rep.couriers.every(c => c.waybills > 0), "الشركات اللي بلا بوالص بالشهر ما بتظهر بالتقرير");
ok(rep.totals.fee_unknown >= 1, "التقرير بيصرّح كم أجرة غير معروفة بدل ما يعتبرها صفر");
ok(dv.monthlyReport("2001-01").empty === true, "شهر بلا حركة بيرجع «فاضي» بصراحة");
ok(threw(() => dv.monthlyReport("2026-13")), "شهر 13 بينرفض");
ok(threw(() => dv.monthlyReport("ابريل")), "صيغة شهر غلط بتنرفض");

// ═══════════ الراوتر عبر HTTP ═══════════
const express = (await import("express")).default;
const app = express();
app.use("/d", dv.router);
const srv = app.listen(0);
const port = srv.address().port;
const call = async (m, p, body) => {
  const r = await fetch(`http://127.0.0.1:${port}/d${p}`, {
    method: m, headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  return r.json();
};

const meta = await call("GET", "/meta");
ok(meta.ok && meta.statuses.includes("تم التسليم") && meta.areas.includes("إربد"),
   "نقطة /meta بترجع الحالات والمناطق");
const cs = await call("GET", "/couriers");
ok(cs.ok && cs.rows.length === 3 && cs.rows.find(r => r.name === "فاست").delivery_rate === null,
   "قائمة الشركات ومعها أداء كل وحدة (وnull للي بلا بيانات)");
const badPost = await call("POST", "/couriers", { name: "" });
ok(badPost.ok === false && /اسم الشركة/.test(badPost.error),
   "الراوتر بيرجع رسالة الخطأ العربية مش 500 صامتة");
const wbs = await call("GET", "/waybills?courier_id=" + speedy);
ok(wbs.ok && wbs.rows.length === 3 && wbs.totals.delivery_rate === 50, "قائمة البوالص مع مجاميعها");
const perf = await call("GET", "/performance");
ok(perf.ok && perf.rows.find(r => r.id === speedy).cost_per_parcel === 2.53, "نقطة الأداء شغّالة");
const cmpApi = await call("GET", "/compare?area=" + encodeURIComponent("إربد"));
ok(cmpApi.ok && cmpApi.cheapest.name === "فاست", "نقطة المقارنة شغّالة");
const qApi = await call("GET", "/quote?area=" + encodeURIComponent("إربد") + "&parcels=10");
ok(qApi.ok && qApi.best.total === 25, "نقطة الحاسبة شغّالة");
const lateApi = await call("GET", "/late?days=2");
ok(lateApi.ok && lateApi.count === 1, "نقطة المتأخرات شغّالة");
const one = await call("GET", "/waybills/" + w1);
ok(one.ok && one.events.length === 5, "تفاصيل البوليصة بترجع سجلها الزمني كامل");
ok((await call("GET", "/waybills/99999")).ok === false, "بوليصة مش موجودة بترجع خطأ");
const delWb = await call("DELETE", "/waybills/" + w2);
ok(delWb.ok === false && /مطالبة/.test(delWb.error), "البوليصة اللي عليها مطالبة ما بتنمسح");
const delC = await call("DELETE", "/couriers/" + speedy);
ok(delC.ok && delC.archived === true && delC.waybills === 3,
   "الشركة اللي إلها بوالص بتنوقف مش بتنمسح");
ok(db.prepare("SELECT COUNT(*) c FROM delivery_waybills WHERE courier_id=?").get(speedy).c === 3,
   "بوالص الشركة الموقوفة محفوظة");
const delFast = await call("DELETE", "/couriers/" + fast);
ok(delFast.ok && delFast.archived === false, "شركة بلا بوالص بتنمسح فعلياً");

const expRes = await fetch(`http://127.0.0.1:${port}/d/export.csv`);
const expBytes = Buffer.from(await expRes.arrayBuffer());
const expTxt = expBytes.toString("utf8");
ok(expBytes[0] === 0xEF && expBytes[1] === 0xBB && expBytes[2] === 0xBF,
   "التصدير فيه BOM حتى إكسل يقرأ العربي");
ok(expTxt.includes("JO-1001") && expTxt.includes("تسعيرة المنطقة"), "التصدير فيه البوالص وأساس الأجرة");
ok(expTxt.includes("غير معروف"), "🔴 الخانة اللي ما منعرفها بتطلع «غير معروف» مش صفر");

srv.close();

ok(fs.existsSync("public/features-delivery.html"), "صفحة الوحدة موجودة");
ok(dv.slug === "delivery" && dv.title && dv.icon && dv.router, "الوحدة بتصدّر slug/title/icon/router");

wipe();
console.log(`\n${fail ? "🔴" : "🟢"} نجح ${pass} / فشل ${fail}`);
process.exit(fail ? 1 : 0);
