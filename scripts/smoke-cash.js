// ═══════════════════════════════════════════════════════════
// 🧪 اختبار الخزنة والتدفق النقدي
//
// بيغطي: الرصيد المشتق من الحركات، توازن التحويل، مطابقة
// دفعات شركات التوصيل FIFO، أعمار الدين على حدودها بالضبط،
// الشيكات، المصاريف المتكررة وعدم تكرارها، التدفق المتوقّع
// المبني على التزامات مكتوبة فقط، والتقارير والتصدير.
// ═══════════════════════════════════════════════════════════
if (!process.env.DB_PATH || /platform\.db/.test(process.env.DB_PATH))
  process.env.DB_PATH = "./data/smoke-cash.db";
if (/platform\.db/.test(process.env.DB_PATH)) {
  console.error("🔴 رفض: الاختبار ما بيشتغل على قاعدة الإنتاج"); process.exit(1);
}
import fs from "node:fs";
const wipe = () => ["", "-wal", "-shm"].forEach(x => { try { fs.rmSync(process.env.DB_PATH + x); } catch {} });
wipe();

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { console.log("❌ " + m); fail++; } };

const cash = await import("../src/features/cash.js");
await new Promise(r => setTimeout(r, 400));
const { db } = await import("../src/db/database.js");

// ── مساعدات التواريخ (نفس إزاحة المنصة) ──
const DAY = 86400000, TZ = 10800 * 1000;
const dayStr = (ts) => new Date(ts + TZ).toISOString().slice(0, 10);
const TODAY = dayStr(Date.now());
const shift = (n) => dayStr(Date.now() + n * DAY);

// ── الراوتر الحقيقي عبر HTTP ──
const express = (await import("express")).default;
const app = express();
app.use("/c", cash.router);
const srv = app.listen(0);
const port = srv.address().port;
const call = async (m, p, body) => {
  const r = await fetch(`http://127.0.0.1:${port}/c${p}`, {
    method: m, headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  return r.json();
};

// ═══════════ (1) الخزائن والأرصدة ═══════════
const A1 = await call("POST", "/accounts", { name: "صندوق المحل", kind: "صندوق نقدي", opening: 500 });
ok(A1.ok && A1.id, "انفتحت خزنة صندوق نقدي");
const A2 = await call("POST", "/accounts", { name: "حساب الأهلي", kind: "حساب بنكي", opening: 1000 });
const A3 = await call("POST", "/accounts", { name: "محفظة زين كاش", kind: "محفظة إلكترونية" });
ok(A2.ok && A3.ok, "انفتحت خزنة بنكية ومحفظة");

const badKind = await call("POST", "/accounts", { name: "خزنة غريبة", kind: "جيبة" });
ok(badKind.ok === false && /نوع الخزنة/.test(badKind.error), "نوع خزنة مش معروف بينرفض");
const noName = await call("POST", "/accounts", { name: "  ", kind: "صندوق نقدي" });
ok(noName.ok === false, "خزنة بلا اسم بتنرفض");

// 🔴 ما في عمود رصيد أصلاً — الرصيد ما بينكتب، بينحسب
const cols = db.prepare("PRAGMA table_info(cash_accounts)").all().map(c => c.name);
ok(!cols.includes("balance"), "🔴 جدول الخزائن ما فيه عمود رصيد — الرصيد مشتق مش مخزّن");
const opMove = db.prepare("SELECT * FROM cash_moves WHERE account_id=? AND category='رصيد افتتاحي'").get(A1.id);
ok(opMove && opMove.amount === 500, "الرصيد الافتتاحي انكتب كحركة موثّقة مش رقم صامت");

let accs = await call("GET", "/accounts");
ok(accs.rows.find(a => a.id === A1.id).balance === 500, "رصيد الصندوق = مجموع حركاته");
ok(accs.rows.find(a => a.id === A3.id).balance === 0, "خزنة بلا حركات رصيدها صفر حقيقي");
ok(accs.rows.find(a => a.id === A3.id).last_at === null, "خزنة بلا حركات ما إلها «آخر حركة» — بتطلع «—»");
ok(accs.totals.total === 1500 && accs.totals.bank === 1000, "مجاميع الخزائن حسب النوع");

// ═══════════ (2) الحركات ═══════════
const m1 = await call("POST", "/moves", { account_id: A1.id, amount: 120, kind: "قبض",
                                          category: "مبيعات", day: TODAY, note: "بيع كاش" });
ok(m1.ok, "انسجّلت حركة قبض");
await call("POST", "/moves", { account_id: A1.id, amount: 20, kind: "صرف", category: "تغليف", day: TODAY });
ok(cash.balanceMap().get(A1.id) === 600, "الرصيد = 500 + 120 − 20 (مجموع الحركات)");

const negMove = db.prepare("SELECT amount FROM cash_moves WHERE account_id=? AND category='تغليف'").get(A1.id);
ok(negMove.amount === -20, "الصرف انكتب بالسالب حتى لو المستخدم كتب رقم موجب");

const zero = await call("POST", "/moves", { account_id: A1.id, amount: 0, kind: "قبض" });
ok(zero.ok === false && /أكبر من صفر/.test(zero.error), "حركة بمبلغ صفر بتنرفض");
const badK = await call("POST", "/moves", { account_id: A1.id, amount: 5, kind: "هدية" });
ok(badK.ok === false && /قبض/.test(badK.error), "نوع حركة مش معروف بينرفض");
const noAcc = await call("POST", "/moves", { account_id: 99999, amount: 5, kind: "قبض" });
ok(noAcc.ok === false && /الخزنة غير موجودة/.test(noAcc.error), "حركة لخزنة مش موجودة بتنرفض");
const badDay = await call("POST", "/moves", { account_id: A1.id, amount: 5, kind: "قبض", day: "2026/01/01" });
ok(badDay.ok === false && /YYYY-MM-DD/.test(badDay.error), "تاريخ بصيغة غلط بينرفض");

const led = await call("GET", `/accounts/${A1.id}/ledger`);
ok(led.ok && led.balance === 600, "كشف الخزنة بيطابق الرصيد");
ok(led.rows[0].balance === 600, "الرصيد الجاري محسوب سطر بسطر");
ok(led.in === 620 && led.out === 20, "مجموع الداخل والخارج بالكشف");

// ═══════════ (3) التحويل بين الخزائن ═══════════
const before = cash.balanceMap();
const tr = await call("POST", "/transfers", { from_id: A1.id, to_id: A2.id, amount: 200, day: TODAY });
ok(tr.ok && tr.id, "انسجّل تحويل");
const after = cash.balanceMap();
ok(after.get(A1.id) === 400 && after.get(A2.id) === 1200, "التحويل نقص من المصدر وزاد بالوجهة");
const totalBefore = [...before.values()].reduce((a, v) => a + v, 0);
const totalAfter = [...after.values()].reduce((a, v) => a + v, 0);
ok(totalBefore === totalAfter, "🔴 التحويل موازن: مجموع الخزائن ما تغيّر ولا قرش");
const trMoves = db.prepare("SELECT * FROM cash_moves WHERE ref_type='transfer' AND ref_id=?").all(String(tr.id));
ok(trMoves.length === 2 && trMoves[0].amount + trMoves[1].amount === 0, "التحويل كتب حركتين مترابطتين مجموعهم صفر");

const self = await call("POST", "/transfers", { from_id: A1.id, to_id: A1.id, amount: 10 });
ok(self.ok === false && /لنفسها/.test(self.error), "التحويل للخزنة نفسها بينرفض");
const negTr = await call("POST", "/transfers", { from_id: A1.id, to_id: A2.id, amount: -50 });
ok(negTr.ok === false, "تحويل بمبلغ سالب بينرفض");
const delOne = await call("DELETE", "/moves/" + trMoves[0].id);
ok(delOne.ok === false && /التحويل نفسه/.test(delOne.error), "ما بتنحذف نص التحويل لحاله — بيختل التوازن");

const tr2 = await call("POST", "/transfers", { from_id: A2.id, to_id: A3.id, amount: 100, day: TODAY });
await call("DELETE", "/transfers/" + tr2.id);
ok(db.prepare("SELECT COUNT(*) c FROM cash_moves WHERE ref_type='transfer' AND ref_id=?").get(String(tr2.id)).c === 0,
   "حذف التحويل شال الحركتين مع بعض");
ok(cash.balanceMap().get(A3.id) === undefined,
   "رصيد الوجهة رجع مثل ما كان بعد حذف التحويل (بلا حركات = مش بالخريطة)");

// ═══════════ (4)(5) مستحقات شركات التوصيل ═══════════
const d1 = await call("POST", "/dues", { courier: "أرامكس", amount: 300, day: shift(-10), expect_day: shift(2) });
const d2 = await call("POST", "/dues", { courier: "أرامكس", amount: 200, day: shift(-5) });
const d3 = await call("POST", "/dues", { courier: "الفارس", amount: 150, day: shift(-3), expect_day: shift(5) });
ok(d1.ok && d2.ok && d3.ok, "انسجّلت 3 مستحقات على شركتين");

let cur = await call("GET", "/couriers");
ok(cur.totals.outstanding === 650, "المستحق الكلي = مجموع اللي لسا عندهم");
ok(cur.couriers.find(c => c.courier === "أرامكس").outstanding === 500, "مستحق أرامكس لحاله");

const noCourier = await call("POST", "/settlements", { courier: "شركة وهمية", amount: 50, account_id: A1.id });
ok(noCourier.ok === false && /سجّل المستحق أول/.test(noCourier.error), "دفعة من شركة بلا مستحقات بتنرفض");

// دفعة: وصل 280 والمخصوم 20 ⇒ غطّت 300 من المستحق، وبس 280 دخلوا الخزنة
const bal1 = cash.balanceMap().get(A1.id);
const s1 = await call("POST", "/settlements", { courier: "أرامكس", account_id: A1.id,
                                                amount: 280, fee: 20, day: TODAY });
ok(s1.ok && s1.covering === 300, "الدفعة غطّت 300 (الواصل + المخصوم)");
ok(s1.outstanding_before === 500 && s1.outstanding_after === 200, "المستحق نقص بمقدار المُغطّى بالضبط");
ok(cash.balanceMap().get(A1.id) === bal1 + 280, "🔴 الواصل بس دخل الخزنة — المخصوم ما مرّ عليها");

const st = cash.courierState("أرامكس");
const row1 = st.rows.find(r => r.id === d1.id), row2 = st.rows.find(r => r.id === d2.id);
ok(row1.remaining === 0 && row1.status === "مسدّد", "FIFO: أقدم مستحق انسدّ أول");
ok(row2.remaining === 200 && row2.status === "لسا عندهم", "المستحق الأحدث لسا برّا");

// دفعة أكبر من المسجّل ⇒ فايض لازم يبيّن بدل ما ينهضم
await call("POST", "/settlements", { courier: "الفارس", account_id: A1.id, amount: 200, day: TODAY });
const fares = (await call("GET", "/couriers?courier=" + encodeURIComponent("الفارس"))).couriers[0];
ok(fares.outstanding === 0 && fares.overpaid === 50, "الدفع الزايد بيطلع «فايض» — يعني في مستحق ناقص تسجيل");

// ═══════════ (6) الذمم وأعمار الدين ═══════════
ok(cash.agingBucket(-1) === "غير مستحق بعد", "الدين اللي لسا ما استحق مش متأخّر");
ok(cash.agingBucket(0) === "0-30", "اليوم صفر = شريحة 0-30");
ok(cash.agingBucket(30) === "0-30", "الحد 30 جوّا شريحة 0-30");
ok(cash.agingBucket(31) === "31-60", "الحد 31 بيبلّش شريحة 31-60");
ok(cash.agingBucket(60) === "31-60", "الحد 60 لسا جوّا 31-60");
ok(cash.agingBucket(61) === "60+", "الحد 61 بيدخل شريحة 60+");
ok(cash.agingBucket("نص") === null, "عمر غير رقمي = null مش تخمين");

const dbt1 = await call("POST", "/debts", { party: "أبو محمد", direction: "لنا", amount: 100,
                                            day: shift(-40), due_day: shift(-31) });
const dbt2 = await call("POST", "/debts", { party: "مورد الأجبان", direction: "علينا", amount: 400,
                                            day: shift(-80), due_day: shift(-70) });
const dbt3 = await call("POST", "/debts", { party: "زبون جملة", direction: "لنا", amount: 60,
                                            day: TODAY, due_day: shift(10) });
const dbt4 = await call("POST", "/debts", { party: "سائق", direction: "لنا", amount: 25, day: shift(-5) });
ok(dbt1.ok && dbt2.ok && dbt3.ok && dbt4.ok, "انسجّلت 4 ذمم");

const badDir = await call("POST", "/debts", { party: "فلان", direction: "معلّق", amount: 10 });
ok(badDir.ok === false && /لنا/.test(badDir.error), "اتجاه ذمّة مش معروف بينرفض");
const badDue = await call("POST", "/debts", { party: "فلان", direction: "لنا", amount: 10,
                                              day: TODAY, due_day: shift(-3) });
ok(badDue.ok === false && /قبل تاريخ الدين/.test(badDue.error), "استحقاق قبل تاريخ الدين بينرفض");

const dv = await call("GET", "/debts");
const r1 = dv.rows.find(d => d.id === dbt1.id);
ok(r1.age_days === 31 && r1.bucket === "31-60", "عمر الدين محسوب من تاريخ الاستحقاق");
ok(dv.rows.find(d => d.id === dbt2.id).bucket === "60+", "الدين المتأخّر 70 يوم بشريحة 60+");
ok(dv.rows.find(d => d.id === dbt3.id).bucket === "غير مستحق بعد", "الدين اللي استحقاقه جاي مش متأخّر");
ok(dv.rows.find(d => d.id === dbt4.id).age_days === 5, "بلا استحقاق: العمر بينحسب من تاريخ نشوء الدين");
ok(dv.aging["لنا"].total === 185 && dv.aging["علينا"].total === 400, "مجاميع الذمم بالاتجاهين");
ok(dv.aging["لنا"]["31-60"] === 100 && dv.aging["لنا"]["0-30"] === 25, "توزيع الذمم على الشرايح");
ok(dv.net === -215, "صافي الذمم = لنا − علينا");

const overPay = await call("POST", `/debts/${dbt1.id}/pay`, { account_id: A1.id, amount: 150 });
ok(overPay.ok === false && /أكبر من المتبقّي/.test(overPay.error), "سداد أكبر من الدين بينرفض");
const balBeforePay = cash.balanceMap().get(A1.id);
const pay = await call("POST", `/debts/${dbt1.id}/pay`, { account_id: A1.id, amount: 40, day: TODAY });
ok(pay.ok && pay.remaining === 60, "السداد الجزئي نقّص المتبقّي");
ok(cash.balanceMap().get(A1.id) === balBeforePay + 40, "سداد «لنا» بيزيد الخزنة (قبض)");
const payOut = await call("POST", `/debts/${dbt2.id}/pay`, { account_id: A1.id, amount: 100, day: TODAY });
ok(payOut.ok && cash.balanceMap().get(A1.id) === balBeforePay + 40 - 100, "سداد «علينا» بينقّص الخزنة (صرف)");
const delPaid = await call("DELETE", "/debts/" + dbt1.id);
ok(delPaid.ok === false && /سداد مسجّل/.test(delPaid.error), "ذمّة عليها سداد ما بتنمسح");

// ═══════════ (7) الشيكات ═══════════
const c1 = await call("POST", "/cheques", { direction: "مستلم", number: "551", bank: "الأهلي",
                                            party: "أبو محمد", amount: 300, due_day: shift(3) });
const c2 = await call("POST", "/cheques", { direction: "صادر", number: "552", bank: "الإسكان",
                                            party: "مورد", amount: 500, due_day: shift(20) });
const c3 = await call("POST", "/cheques", { direction: "مستلم", number: "553", amount: 90, due_day: shift(-4) });
ok(c1.ok && c2.ok && c3.ok, "انسجّلت 3 شيكات");
const badCh = await call("POST", "/cheques", { direction: "مستلم", number: "554", amount: 10, due_day: "قريب" });
ok(badCh.ok === false && /YYYY-MM-DD/.test(badCh.error), "شيك بلا تاريخ استحقاق صحيح بينرفض");

const chv = await call("GET", "/cheques?warn=7");
ok(chv.totals.in_open === 390 && chv.totals.out_open === 500, "مجاميع الشيكات قيد التحصيل");
ok(chv.rows.find(c => c.id === c1.id).near === true, "تنبيه: شيك استحقاقه بعد 3 أيام");
ok(chv.rows.find(c => c.id === c3.id).overdue === true, "شيك فات استحقاقه بينتعلّم متأخّر");

const balBeforeCh = cash.balanceMap().get(A2.id);
const cashed = await call("POST", `/cheques/${c1.id}/cash`, { account_id: A2.id, day: TODAY });
ok(cashed.ok && cash.balanceMap().get(A2.id) === balBeforeCh + 300, "صرف الشيك المستلم زاد الخزنة");
ok(db.prepare("SELECT status FROM cash_cheques WHERE id=?").get(c1.id).status === "محصّل", "حالة الشيك صارت محصّل");
const again = await call("POST", `/cheques/${c1.id}/cash`, { account_id: A2.id });
ok(again.ok === false && /مرة تانية/.test(again.error), "الشيك ما بينصرف مرتين");
const delCh = await call("DELETE", "/cheques/" + c1.id);
ok(delCh.ok === false && /ما بينمسح/.test(delCh.error), "شيك إلو حركة نقدية ما بينمسح");
const forceStatus = await call("POST", `/cheques/${c2.id}/status`, { status: "محصّل" });
ok(forceStatus.ok === false && /اصرف/.test(forceStatus.error), "ما بتنكتب حالة «محصّل» بلا حركة بالخزنة");
const bounced = await call("POST", `/cheques/${c3.id}/status`, { status: "مرتجع" });
ok(bounced.ok, "تعليم الشيك مرتجع شغّال");

// ═══════════ (9) المصاريف المتكررة ═══════════
const rc1 = await call("POST", "/recurring", { name: "إيجار المحل", category: "إيجار",
                                               amount: 250, day_of_month: 1, account_id: A1.id });
const rc2 = await call("POST", "/recurring", { name: "إنترنت", category: "إنترنت",
                                               amount: 30, day_of_month: 15, account_id: A1.id });
ok(rc1.ok && rc2.ok, "انسجّل مصروفين متكررين");
const badDom = await call("POST", "/recurring", { name: "شي", amount: 10, day_of_month: 40 });
ok(badDom.ok === false && /بين 1 و 31/.test(badDom.error), "يوم استحقاق خارج الشهر بينرفض");

const recv = await call("GET", "/recurring");
ok(recv.totals.monthly === 280, "مجموع الالتزام الشهري المتكرر");
const ym = TODAY.slice(0, 7);
const balBeforeRc = cash.balanceMap().get(A1.id);
const posted = await call("POST", `/recurring/${rc1.id}/post`, { month: ym, account_id: A1.id });
ok(posted.ok && cash.balanceMap().get(A1.id) === balBeforeRc - 250, "ترحيل المصروف المتكرر انصرف من الخزنة");
const dupPost = await call("POST", `/recurring/${rc1.id}/post`, { month: ym, account_id: A1.id });
ok(dupPost.ok === false && /من قبل/.test(dupPost.error), "🔴 المصروف الشهري ما بينصرف مرتين لنفس الشهر");
const recv2 = await call("GET", "/recurring");
ok(recv2.rows.find(r => r.id === rc1.id).posted_this_month === true, "المصروف بيبيّن إنه مسدّد هذا الشهر");

// ═══════════ (8) التدفق المتوقّع ═══════════
const fc = await call("GET", "/forecast?weeks=6");
ok(fc.ok && fc.buckets.length === 6, "التوقّع طلع 6 أسابيع");
ok(fc.opening === [...cash.balanceMap().values()].reduce((a, v) => a + v, 0),
   "الافتتاحي بالتوقّع = مجموع أرصدة الخزائن الفعلية");
const allRows = fc.buckets.flatMap(b => b.rows);
const sources = new Set(allRows.map(r => r.source));
ok([...sources].every(s => ["شيك", "مستحق توصيل", "ذمّة", "مصروف متكرر"].includes(s)),
   "🔴 كل سطر بالتوقّع مصدره التزام مسجّل — ما في تخمين");
ok(allRows.every(r => r.label && r.day), "كل سطر متوقّع بيقول من وين إجا وبأي تاريخ");
ok(fc.excluded.some(x => x.reason.includes("تاريخ وصول متوقّع")),
   "🔴 المستحق بلا تاريخ متوقّع ما بينحط بالتوقّع — بينطلع مستثنى بسببه");
ok(fc.excluded.some(x => x.source === "ذمّة" && x.reason.includes("استحقاق")),
   "الذمّة بلا تاريخ استحقاق مستثناة كمان");
ok(!allRows.some(r => r.source === "مستحق توصيل" && r.label.includes("الفارس")),
   "المستحق المسدّد ما بيضل بالتوقّع");
const netSum = fc.buckets.reduce((a, b) => a + b.net, 0);
ok(Math.abs(fc.closing - (fc.opening + netSum)) < 0.011, "الرصيد المتوقّع = الافتتاحي + مجموع صوافي الأسابيع");
ok(fc.lowest <= fc.opening || fc.buckets.every(b => b.net >= 0), "أخفض رصيد متوقّع محسوب من مسار الأسابيع");
ok(allRows.some(r => r.source === "شيك" && r.amount < 0), "الشيك الصادر بيدخل التوقّع كخروج فلوس");

// ═══════════ (10) التقارير والتصدير ═══════════
const rep = await call("GET", "/report/daily");
ok(rep.ok && rep.days.length > 0, "التقرير اليومي فيه أيام");
const totalNow = [...cash.balanceMap().values()].reduce((a, v) => a + v, 0);
ok(Math.abs(rep.closing - totalNow) < 0.011, "🔴 إقفال التقرير اليومي = مجموع أرصدة الخزائن");
ok(Math.abs(rep.opening + rep.totals.net - rep.closing) < 0.011, "افتتاحي + صافي الفترة = الإقفال");
const mrep = await call("GET", "/report/monthly?months=6");
ok(mrep.ok && mrep.months.length >= 1 && mrep.months[0].month === ym, "التقرير الشهري بيبلّش بالشهر الحالي");

const ov = await call("GET", "/overview");
ok(Math.abs(ov.balance - totalNow) < 0.011, "الملخّص بيعرض الرصيد الحقيقي");
ok(ov.courier_outstanding === 200, "الملخّص بيعرض المستحق الباقي على شركات التوصيل");

const expRes = await fetch(`http://127.0.0.1:${port}/c/export/moves.csv`);
const expBytes = Buffer.from(await expRes.arrayBuffer());
ok(expBytes[0] === 0xEF && expBytes[1] === 0xBB && expBytes[2] === 0xBF,
   "تصدير الحركات فيه BOM حتى إكسل يقرأ العربي");
ok(expBytes.toString("utf8").includes("صندوق المحل"), "التصدير فيه اسم الخزنة");
const agingCsv = await (await fetch(`http://127.0.0.1:${port}/c/export/aging.csv`)).text();
ok(agingCsv.includes("الشريحة") && agingCsv.includes("مورد الأجبان"), "تصدير أعمار الدين شغّال");
const fcCsv = await (await fetch(`http://127.0.0.1:${port}/c/export/forecast.csv`)).text();
ok(fcCsv.includes("المصدر"), "تصدير التدفق المتوقّع بيقول مصدر كل سطر");

// ═══════════ الحماية والأرشفة ═══════════
const delAcc = await call("DELETE", "/accounts/" + A1.id);
ok(delAcc.archived === true && delAcc.moves > 0, "خزنة إلها حركات بتنوقف مش بتنمسح");
const onStopped = await call("POST", "/moves", { account_id: A1.id, amount: 10, kind: "قبض" });
ok(onStopped.ok === false && /موقوفة/.test(onStopped.error), "الخزنة الموقوفة ما بتستقبل حركات");
const delEmpty = await call("DELETE", "/accounts/" + A3.id);
ok(delEmpty.deleted === true, "خزنة بلا حركات بتنمسح عادي");

srv.close();

// ═══════════ الوحدة والصفحة ═══════════
ok(cash.slug === "cash" && cash.title === "الخزنة والتدفق النقدي" && cash.icon === "💵" && cash.router,
   "الوحدة مصدّرة slug/title/icon/router");
ok(fs.existsSync("public/features-cash.html"), "صفحة الخزنة موجودة");
const tbls = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'cash_%'").all();
ok(tbls.length === 8 && tbls.every(t => t.name.startsWith("cash_")), "كل جداول الوحدة بادئتها cash_");

wipe();
console.log(`\n${fail ? "🔴" : "🟢"} نجح ${pass} / فشل ${fail}`);
process.exit(fail ? 1 : 0);
