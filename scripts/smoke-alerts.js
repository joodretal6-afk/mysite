// ═══════════════════════════════════════════════════════════
// 🧪 اختبار مركز الإنذارات والمراقبة
//
// بيغطّي: تقييم القواعد على الحد بالضبط (أكبر مقابل أكبر أو
// يساوي)، عدم تكرار نفس الإنذار، التهدئة وانتهاؤها، كتم
// القاعدة، رفض المدخلات الغلط، صدق كشف الشذوذ لمّا التاريخ
// ما بيكفي، الصحة، لوحة اليوم، السجل، التقارير، والتصدير —
// وكل هاد عبر الراوتر الحقيقي كمان.
// ═══════════════════════════════════════════════════════════
if (!process.env.DB_PATH || /platform\.db/.test(process.env.DB_PATH))
  process.env.DB_PATH = "./data/smoke-alerts.db";
if (/platform\.db/.test(process.env.DB_PATH)) {
  console.error("🔴 رفض: الاختبار ما بيشتغل على قاعدة الإنتاج"); process.exit(1);
}
import fs from "node:fs";
const wipe = () => ["", "-wal", "-shm"].forEach(x => { try { fs.rmSync(process.env.DB_PATH + x); } catch {} });
wipe();

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { console.log("❌ " + m); fail++; } };

const al = await import("../src/features/alerts.js");
await new Promise(r => setTimeout(r, 500));
const { db } = await import("../src/db/database.js");

const DAY = 86400000, HOUR = 3600000;
const now = Date.now();
const today0 = al.dayStartMs(0, now);

// ── بيانات حقيقية بجدول orders و messages ──
const mkOrder = (at, total, status = "جديد", page = "P1") =>
  db.prepare(`INSERT INTO orders (page_id,page_name,sender_id,order_string,total,area,phone,status,messenger_url,created_at)
              VALUES (?,?,?,?,?,?,?,?,'',?)`)
    .run(page, "صفحة " + page, "u" + Math.random().toString(36).slice(2, 8),
         "جبنة (2)", total, "عمّان", "0790000000", status, at);
const mkMsg = (at, dir = "in", page = "P1", sender = "u1") =>
  db.prepare("INSERT INTO messages (page_id,page_name,sender_id,direction,body,created_at) VALUES (?,?,?,?,?,?)")
    .run(page, "صفحة " + page, sender, dir, "مرحبا", at);

// 🔴 أوقات مضمونة إنها "اليوم" وبالماضي مهما كانت الساعة.
//    كان الزرع على today0 + 3 ساعات، فلو شغّلت الاختبار قبل الساعة
//    3 صباحاً بعمّان بيصير الطلب بالمستقبل ويطلع برّا نافذة اليوم
//    فيفشل — والنافذة [today0, now]. هلأ منزرع لحظات قبل "now".
const todayPast = (sec) => Math.max(today0, now - sec * 1000);

// 3 طلبات اليوم بقيمة 45 د إجمالاً
mkOrder(todayPast(3), 15);
mkOrder(todayPast(2), 15);
mkOrder(todayPast(1), 15, "ناقص");
mkMsg(todayPast(3)); mkMsg(todayPast(3), "out");

// ═══════════ المقاييس ═══════════
const w = al.windowRange(1, now);
ok(al.METRICS.orders_count.calc(w.from, w.to, "") === 3, "عدد طلبات اليوم = 3 من جدول orders");
ok(al.METRICS.sales_total.calc(w.from, w.to, "") === 45, "مبيعات اليوم = 45 د");
ok(al.METRICS.incomplete_orders.calc(w.from, w.to, "") === 1, "الطلبات الناقصة اليوم = 1");
ok(al.METRICS.cancelled_orders.calc(w.from, w.to, "") === 0, "ما في ملغيات اليوم");
ok(al.METRICS.avg_order_value.calc(w.from, w.to, "") === 15, "متوسط قيمة الطلب = 15 د");
ok(al.METRICS.avg_order_value.calc(now + DAY, now + 2 * DAY, "") === null,
   "🔴 بلا طلبات → المتوسط null مش صفر مخترع");
ok(al.METRICS.inbound_messages.calc(w.from, w.to, "") === 1, "رسالة واردة وحدة (الصادرة ما انعدّت)");
ok(al.METRICS.orders_count.calc(w.from, w.to, "P9") === 0, "فلتر الصفحة بيشتغل");
ok(al.METRICS.hours_since_last_order.calc(w.from, w.to, "") != null, "ساعات آخر طلب محسوبة");

// ═══════════ التقييم على الحد بالضبط ═══════════
const R = (o) => ({ id: 1, name: "ت", metric: "orders_count", op: o, threshold: 3, window_days: 1, page_id: "" });
ok(al.evaluateRule(R("gt"), now).fired === false, "«أكبر من 3» ما بينطلق والقراءة 3 بالضبط");
ok(al.evaluateRule(R("gte"), now).fired === true, "«أكبر أو يساوي 3» بينطلق والقراءة 3");
ok(al.evaluateRule(R("lt"), now).fired === false, "«أقل من 3» ما بينطلق والقراءة 3");
ok(al.evaluateRule(R("lte"), now).fired === true, "«أقل أو يساوي 3» بينطلق والقراءة 3");
ok(al.evaluateRule(R("eq"), now).fired === true, "«يساوي 3» بينطلق");
const evd = al.evaluateRule(R("gte"), now);
ok(evd.observed === 3 && evd.source.includes("orders"), "الإنذار بيحمل القراءة ومصدرها");
ok(evd.period_from && evd.period_to, "الإنذار بيحمل فترته");
ok(/المصدر/.test(evd.message) && /الفترة/.test(evd.message), "نص الإنذار بيذكر المصدر والفترة");
const noData = al.evaluateRule({ ...R("lt"), metric: "avg_order_value", threshold: 5,
                                 window_days: 1, id: 1 }, now + 400 * DAY);
ok(noData.no_data === true && noData.fired === false,
   "🔴 مقياس بلا بيانات ما بيطلّع إنذار وهمي — بيقول ما في بيانات");
ok(al.evaluateRule({ ...R("gt"), metric: "شي_غريب" }).ok === false, "مقياس مش معروف بينرفض");
ok(al.evaluateRule({ ...R("زقزق") }).ok === false, "شرط مش معروف بينرفض");

// ═══════════ التحقّق من المدخلات ═══════════
ok(al.validateRule({ name: "أ", metric: "orders_count", op: "lt", threshold: 5 }).error, "اسم قصير بينرفض");
ok(al.validateRule({ name: "قاعدة", metric: "xx", op: "lt", threshold: 5 }).error, "مقياس غلط بينرفض");
ok(al.validateRule({ name: "قاعدة", metric: "orders_count", op: "xx", threshold: 5 }).error, "شرط غلط بينرفض");
ok(al.validateRule({ name: "قاعدة", metric: "orders_count", op: "lt", threshold: "نص" }).error, "حد مش رقم بينرفض");
ok(al.validateRule({ name: "قاعدة", metric: "orders_count", op: "lt", threshold: 5, window_days: 0 }).error,
   "فترة صفر بتنرفض");
ok(al.validateRule({ name: "قاعدة", metric: "orders_count", op: "lt", threshold: 5, severity: "كارثة" }).error,
   "خطورة مش من القائمة بتنرفض");
ok(!al.validateRule({ name: "قاعدة سليمة", metric: "orders_count", op: "lt", threshold: 5 }).error,
   "القاعدة السليمة بتنقبل");

// ═══════════ الراوتر الحقيقي ═══════════
const express = (await import("express")).default;
const app = express();
app.use("/a", al.router);
const srv = app.listen(0);
const port = srv.address().port;
const call = async (m, p, body) => {
  const r = await fetch(`http://127.0.0.1:${port}/a${p}`, {
    method: m, headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  return r.json();
};

const meta = await call("GET", "/meta");
ok(meta.ok && meta.metrics.length >= 10, "قائمة المقاييس ظاهرة للواجهة");

const badRule = await call("POST", "/rules", { name: "س", metric: "orders_count", op: "lt", threshold: 1 });
ok(badRule.ok === false && /حرفين/.test(badRule.error), "الراوتر بيرجّع رسالة عربية مفهومة للقاعدة الغلط");

const c1 = await call("POST", "/rules",
  { name: "طلبات اليوم أقل من 5", metric: "orders_count", op: "lt", threshold: 5, window_days: 1, severity: "عالي" });
ok(c1.ok && c1.id, "انحفظت قاعدة «الطلبات اليوم أقل من 5»");
const c2 = await call("POST", "/rules",
  { name: "ناقص اليوم 1 أو أكثر", metric: "incomplete_orders", op: "gte", threshold: 1 });
ok(c2.ok, "انحفظت قاعدة الطلبات الناقصة");

const prev = await call("POST", "/preview", { name: "معاينة", metric: "sales_total", op: "lt", threshold: 100 });
ok(prev.ok && prev.result.observed === 45, "المعاينة بتوري الرقم الحقيقي قبل الحفظ");

const run1 = await call("POST", "/evaluate");
ok(run1.created === 2 && run1.fired === 2, "المحرّك أطلق إنذارين وأنشأهم");
const run2 = await call("POST", "/evaluate");
ok(run2.created === 0 && run2.repeated === 2,
   "🔴 نفس الإنذار ما انكرّر — انزاد عدّاد التكرار بس");
const box1 = await call("GET", "/events");
ok(box1.rows.length === 2 && box1.counts.active === 2, "صندوق الإنذارات فيه إنذارين نشطين");
ok(box1.rows.every(e => e.hits === 2), "عدّاد التكرار صار 2");
ok(box1.rows.every(e => e.observed != null && e.source && e.period_from),
   "كل إنذار محفوظ معه قراءته ومصدره وفترته");

// تهدئة
const target = box1.rows.find(e => e.rule_id === c1.id);
const sn = await call("POST", `/events/${target.id}/snooze`, { hours: 5 });
ok(sn.ok && sn.snooze_until > Date.now(), "التهدئة انسجّلت");
const box2 = await call("GET", "/events?status=نشط");
ok(box2.rows.length === 1, "المهدّأ اختفى من النشط");
ok((await call("GET", "/events")).counts.snoozed === 1, "عدّاد المهدّأ = 1");
const rulesAfter = await call("GET", "/rules");
ok(rulesAfter.rows.find(r => r.id === c1.id).muted === true,
   "تهدئة الإنذار كتمت قاعدته كمان حتى ما ترجع فوراً");
const run3 = await call("POST", "/evaluate");
ok(run3.muted === 1 && run3.created === 0, "القاعدة المكتومة ما انقيّمت ولا أنشأت إنذار جديد");

// انتهاء التهدئة: منرجّع الوقت للماضي ومنشوف إنّه رجع نشط
db.prepare("UPDATE alerts_events SET snooze_until=? WHERE id=?").run(Date.now() - 1000, target.id);
db.prepare("UPDATE alerts_rules SET muted_until=0 WHERE id=?").run(c1.id);
ok((await call("GET", "/events?status=نشط")).rows.length === 2, "بعد ما خلصت التهدئة رجع الإنذار نشط");
const run4 = await call("POST", "/evaluate");
ok(run4.repeated === 2 && run4.created === 0, "بعد فك الكتم بيتحدّث نفس الإنذار مش إنذار جديد");

const snBad = await call("POST", `/events/${target.id}/snooze`, { hours: 0 });
ok(snBad.ok === false, "تهدئة بصفر ساعة بتنرفض");
ok((await call("POST", "/events/99999/snooze", { hours: 1 })).ok === false, "تهدئة إنذار مش موجود بتنرفض");

// مقروء
ok((await call("POST", `/events/${target.id}/read`)).ok, "تعليم الإنذار مقروء");
ok((await call("GET", "/events")).counts.read === 1, "عدّاد المقروء = 1");
const readAll = await call("POST", "/events/read-all");
ok(readAll.changed === 1, "قراءة الكل غيّرت الباقي بس");

// كتم القاعدة يدوياً
ok((await call("POST", `/rules/${c2.id}/mute`, { hours: 3 })).ok, "كتم قاعدة يدوياً");
ok((await call("POST", `/rules/${c2.id}/mute`, { hours: -1 })).ok === false, "مدة كتم سالبة بتنرفض");

// ═══════════ الشذوذ ═══════════
const an1 = await call("GET", "/anomaly?metric=orders_count&weeks=4&min_weeks=3");
ok(an1.result.enough_data === false && /ما في بيانات كافية/.test(an1.result.reason),
   "🔴 بلا تاريخ كافي الشذوذ بيقول «ما في بيانات كافية» وما بيطلّع رقم");
ok(an1.result.z === undefined || an1.result.z == null, "بلا بيانات كافية ما في z مخترع");

// منعبّي نفس اليوم من 3 أسابيع سابقة
for (const wk of [1, 2, 3]) {
  const base = al.dayStartMs(-7 * wk, now);
  for (let i = 0; i < 10; i++) mkOrder(base + HOUR, 15);
}
const an2 = await call("GET", "/anomaly?metric=orders_count&weeks=4&min_weeks=3");
ok(an2.result.enough_data === true, "بعد ما توفّر 3 أسابيع صار في مقارنة");
ok(an2.result.average === 10 && an2.result.weeks_used === 3, "المتوسط 10 من 3 أسابيع فعلية");
ok(an2.result.current === 3 && an2.result.verdict === "انخفاض شاذ", "اليوم 3 مقابل 10 → انخفاض شاذ");
ok(/المصدر/.test(an2.result.explain), "شرح الشذوذ بيذكر المصدر");
ok((await call("GET", "/anomaly?metric=مش_موجود")).ok === false, "مقياس غلط بالشذوذ بينرفض");

// ═══════════ الصحة ═══════════
mkOrder(now - 40 * DAY, 15, "جديد", "P2");
mkOrder(now - 20 * DAY, 15, "جديد", "P2");     // صفحة بطّلت من 20 يوم
const h = await call("GET", "/health?silent_days=7");
ok(h.ok && h.health.hours_since_last_order != null, "لوحة الصحة بتقول متى آخر طلب");
ok(h.health.hours_since_last_message != null, "لوحة الصحة بتقول متى آخر رسالة");
ok(h.health.silent_pages.some(p => p.page_id === "P2"), "الصفحة الصامتة انكشفت");
ok(!h.health.silent_pages.some(p => p.page_id === "P1"), "الصفحة النشطة مش بقائمة الصامتة");
ok(h.health.orders_today === 3, "طلبات اليوم بلوحة الصحة = 3");

// ═══════════ شو لازم أعمل اليوم ═══════════
const td = await call("GET", "/today");
ok(td.ok && td.items.length > 0, "لوحة اليوم فيها بنود");
ok(td.items.length <= 10, "لوحة اليوم بحدود 10 بنود");
ok(td.items.every(i => i.source && i.why && i.period), "كل بند بيقول سببه ومصدر رقمه وفترته");
const impacts = td.items.filter(i => i.impact_jod != null).map(i => i.impact_jod);
ok(impacts.every((v, i) => i === 0 || impacts[i - 1] >= v), "البنود مرتّبة تنازلياً بالأثر المحسوب");
ok(td.items.every(i => i.impact_jod == null || i.impact_basis), "كل أثر مالي معه أساس حسابه");

// ═══════════ التقارير ═══════════
ok((await call("POST", "/schedules", { name: "ي", report: "daily_sales", freq: "daily" })).ok === false,
   "اسم تقرير قصير بينرفض");
ok((await call("POST", "/schedules", { name: "تقرير يومي", report: "مش_موجود", freq: "daily" })).ok === false,
   "نوع تقرير غلط بينرفض");
const sch = await call("POST", "/schedules", { name: "تقرير يومي", report: "daily_sales", freq: "daily" });
ok(sch.ok && sch.id, "انحفظت جدولة تقرير يومي");
const gen1 = await call("POST", "/schedules/run");
ok(gen1.generated === 1, "الجدولة المستحقّة ولّدت تقرير");
const gen2 = await call("POST", "/schedules/run");
ok(gen2.generated === 0, "التقرير اليومي ما بينتولّد مرتين بنفس اليوم");
const rep = await call("GET", "/reports/" + gen1.ids[0]);
ok(rep.ok && rep.report.payload.metrics.orders_count.value != null, "التقرير المخزّن فيه أرقام حقيقية");
ok(rep.report.payload.metrics.orders_count.source.includes("orders"), "التقرير بيذكر مصدر كل رقم");
const inst = await call("POST", "/reports/generate", { report: "health" });
ok(inst.ok && inst.report.body.health, "تقرير فوري لصحة المنصة انتولّد");

// ═══════════ السجل والتصدير ═══════════
const aud = await call("GET", "/audit");
ok(aud.ok && aud.rows.length >= 5, "سجل الأحداث بيسجّل كل ما بيصير");
ok(aud.rows.some(r => r.kind === "قاعدة جديدة"), "إنشاء القاعدة انسجّل");
ok((await call("GET", "/audit?kind=تهدئة إنذار")).rows.length === 1, "فلترة السجل بالنوع بتشتغل");
ok((await call("GET", "/audit?q=مش_موجود_أبداً")).rows.length === 0, "فلترة السجل بالبحث بتشتغل");

const csvRes = await fetch(`http://127.0.0.1:${port}/a/export/events.csv`);
const csvBytes = Buffer.from(await csvRes.arrayBuffer());
ok(csvBytes[0] === 0xEF && csvBytes[1] === 0xBB && csvBytes[2] === 0xBF, "تصدير الإنذارات فيه BOM للعربي");
ok(csvBytes.toString("utf8").includes("القاعدة"), "تصدير الإنذارات فيه العناوين العربية");
const csvAudit = await (await fetch(`http://127.0.0.1:${port}/a/export/audit.csv`)).text();
ok(csvAudit.includes("التفاصيل"), "تصدير السجل شغّال");

// حذف القاعدة بيشيل إنذاراتها
ok((await call("DELETE", "/rules/" + c1.id)).ok, "انحذفت القاعدة");
ok(db.prepare("SELECT COUNT(*) c FROM alerts_events WHERE rule_id=?").get(c1.id).c === 0,
   "إنذارات القاعدة المحذوفة انشالت معها");
ok((await call("DELETE", "/rules/99999")).ok === false, "حذف قاعدة مش موجودة بينرفض");

srv.close();

// ═══════════ الوحدة والصفحة ═══════════
ok(al.slug === "alerts" && al.title && al.icon && al.router, "الوحدة بتصدّر slug/title/icon/router");
ok(fs.existsSync("public/features-alerts.html"), "صفحة الوحدة موجودة");
const src = fs.readFileSync("src/features/alerts.js", "utf8");
ok(!/fetch\s*\(|axios|nodemailer|graph\.facebook/.test(src),
   "🔴 ولا نداء شبكة خارجي بالوحدة — كل شي جوّا الموقع");
const tbls = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'alerts_%'").all();
ok(tbls.length === 5, "كل جداول الوحدة بادئتها alerts_");

wipe();
console.log(`\n${fail ? "🔴" : "🟢"} نجح ${pass} / فشل ${fail}`);
process.exit(fail ? 1 : 0);
