// ═══════════════════════════════════════════════════════════
// 🧪 اختبار وحدة التشغيل وسلامة الغذاء (ops)
//
// بيغطي المنطق اللي بينبني عليه ملف الرقابة:
// حدود الحرارة بالضبط (شامل مقابل غير شامل)، استحقاق النظافة
// والمهام حسب جدولتها، نسب الالتزام ومقاماتها، رفض المدخلات
// الغلط، وإثبات إنّ اليوم بلا قراءة ما بينحسب سليم.
// ═══════════════════════════════════════════════════════════
if (!process.env.DB_PATH || /platform\.db/.test(process.env.DB_PATH))
  process.env.DB_PATH = "./data/smoke-ops.db";
if (/platform\.db/.test(process.env.DB_PATH)) {
  console.error("🔴 رفض: الاختبار ما بيشتغل على قاعدة الإنتاج"); process.exit(1);
}
import fs from "node:fs";
const wipe = () => ["", "-wal", "-shm"].forEach(x => { try { fs.rmSync(process.env.DB_PATH + x); } catch {} });
wipe();

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { console.log("❌ " + m); fail++; } };
const threw = (fn) => { try { fn(); return false; } catch { return true; } };

const ops = await import("../src/features/ops.js");
await new Promise(r => setTimeout(r, 500));
const { db } = await import("../src/db/database.js");

const DAY = 86400000;
const TZ = 10800 * 1000;
const dstr = (ts) => new Date(ts + TZ).toISOString().slice(0, 10);
const D = (back) => dstr(Date.now() - back * DAY);
const T0 = D(0), T1 = D(1), T2 = D(2);

// ═══════════ (3)(4) حدود الحرارة — أخطر نقطة بالوحدة ═══════════
const incl = { min_c: 2, max_c: 5, bounds: "شامل" };
const excl = { min_c: 2, max_c: 5, bounds: "غير شامل" };

ok(ops.evaluateTemp(3.5, incl).status === "ضمن المدى", "قراءة بنص المدى = ضمن المدى");
ok(ops.evaluateTemp(2, incl).status === "ضمن المدى", "المدى الشامل: القراءة على الحد الأدنى بالضبط مقبولة");
ok(ops.evaluateTemp(5, incl).status === "ضمن المدى", "المدى الشامل: القراءة على الحد الأعلى بالضبط مقبولة");
ok(ops.evaluateTemp(2, excl).status === "أدنى من المدى", "المدى غير الشامل: الحد الأدنى بالضبط مرفوض");
ok(ops.evaluateTemp(5, excl).status === "أعلى من المدى", "المدى غير الشامل: الحد الأعلى بالضبط مرفوض");
ok(ops.evaluateTemp(2.1, excl).out === false, "غير شامل: 2.1 جوّا المدى");
ok(ops.evaluateTemp(1.9, incl).out === true && ops.evaluateTemp(1.9, incl).deviation === -0.1,
   "أقل من الحد الأدنى بـ0.1 = خارج المدى وانحرافه محسوب");
ok(ops.evaluateTemp(7, incl).deviation === 2, "الانحراف فوق = القراءة − الحد الأعلى");
ok(threw(() => ops.evaluateTemp("دافي", incl)), "قراءة مش رقم بتنرفض");
ok(threw(() => ops.evaluateTemp(4, { min_c: null, max_c: 5 })), "جهاز بلا مدى محدّد بينرفض");

// ═══════════ (5)(8) استحقاق الجدولة ═══════════
const sd = ops.scheduleDue;
ok(sd("يومي", null, T0).due === true, "بند عمره ما انعمل = مستحق");
ok(sd("يومي", null, T0).days_since === null && sd("يومي", null, T0).overdue === null,
   "🔴 اللي عمره ما انعمل تأخيره «غير معروف» مش رقم مخترع");
ok(sd("يومي", T0, T0).due === false, "اليومي اللي انعمل اليوم مش مستحق");
ok(sd("يومي", T1, T0).due === true && sd("يومي", T1, T0).overdue === 0, "اليومي بعد يوم مستحق بلا تأخير");
ok(sd("أسبوعي", D(6), T0).due === false, "الأسبوعي بعد 6 أيام لسا مش مستحق");
ok(sd("أسبوعي", D(7), T0).due === true && sd("أسبوعي", D(7), T0).overdue === 0,
   "الأسبوعي على اليوم السابع بالضبط مستحق");
ok(sd("أسبوعي", D(9), T0).overdue === 2, "الأسبوعي المتأخر يومين تأخيره 2");
ok(sd("شهري", D(29), T0).due === false && sd("شهري", D(30), T0).due === true, "الشهري بيستحق على 30 يوم");
ok(threw(() => sd("كل ساعة", null, T0)), "جدولة مش معروفة بتنرفض");
ok(threw(() => sd("يومي", null, "2026/01/01")), "تاريخ بصيغة غلط بينرفض");

ok(ops.expectedRuns("يومي", T2, T0) === 3, "المتوقّع من اليومي بـ3 أيام = 3");
ok(ops.expectedRuns("أسبوعي", D(6), T0) === 1, "المتوقّع من الأسبوعي بـ7 أيام = 1");
ok(ops.expectedRuns("شهري", T2, T0) === 0, "الشهري بـ3 أيام ما إلو استحقاق");
ok(ops.dayRange(T2, T0).length === 3 && ops.dayRange(T0, T2).length === 0,
   "مدى الأيام شامل الطرفين، والمقلوب بيرجع فاضي");
ok(ops.daysBetween(T2, T0) === 2, "فرق الأيام محسوب صح");

// (10) حدود الشهر
ok(ops.monthRange("2024-02").to === "2024-02-29", "شباط الكبيسة 29 يوم");
ok(ops.monthRange("2025-02").to === "2025-02-28", "شباط العادي 28 يوم");
ok(threw(() => ops.monthRange("2025-13")) && threw(() => ops.monthRange("شباط")), "شهر غلط بينرفض");

// ═══════════ الراوتر الحقيقي ═══════════
const express = (await import("express")).default;
const app = express();
app.use("/o", ops.router);
const srv = app.listen(0);
const port = srv.address().port;
const call = async (m, p, body) => {
  const r = await fetch(`http://127.0.0.1:${port}/o${p}`, {
    method: m, headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  return r.json();
};

// ══ (1) قوائم الفحص ══
const cl = await call("POST", "/checklists", { name: "فتح المحل", kind: "فتح" });
ok(cl.ok && cl.id, "انشأت قائمة فحص الفتح");
ok((await call("POST", "/checklists", { name: "", kind: "فتح" })).ok === false, "قائمة بلا اسم بتنرفض");
ok((await call("POST", "/checklists", { name: "قائمة", kind: "شي غريب" })).ok === false, "نوع قائمة غير معروف بينرفض");
const i1 = await call("POST", `/checklists/${cl.id}/items`, { text: "قياس حرارة البراد", sort: 1, critical: 1 });
const i2 = await call("POST", `/checklists/${cl.id}/items`, { text: "تنظيف الكاونتر", sort: 2 });
const i3 = await call("POST", `/checklists/${cl.id}/items`, { text: "فحص تواريخ الصلاحية", sort: 3 });
ok(i1.ok && i2.ok && i3.ok, "انضافت 3 بنود للقائمة");
ok((await call("POST", `/checklists/${cl.id}/items`, { text: "" })).ok === false, "بند بلا نص بينرفض");
ok((await call("POST", "/checklists/9999/items", { text: "x" })).ok === false, "بند لقائمة مش موجودة بينرفض");

// ══ (2) تنفيذ القائمة ══
const run = await call("POST", "/runs", { checklist_id: cl.id, day: T0, person: "أبو محمد" });
ok(run.ok && run.id, "انفتح تنفيذ اليوم");
const run2 = await call("POST", "/runs", { checklist_id: cl.id, day: T0 });
ok(run2.id === run.id, "التنفيذ الواحد لليوم الواحد — ما بينفتح مرتين");
let rv = await call("GET", "/runs/" + run.id);
ok(rv.rows.length === 3 && rv.summary.done === 0, "التنفيذ ثبّت البنود الثلاثة وكلها لسا ما انعملت");
ok(rv.summary.percent === 0, "بنود موجودة وما انعمل ولا واحد → 0%");
const noPerson = await call("POST", `/runs/${run.id}/item`, { item_id: i1.id, done: true, person: "" });
ok(noPerson.ok === false && /اسم/.test(noPerson.error), "ما بينعلّم بند منجز بلا اسم منفّذ");
await call("POST", `/runs/${run.id}/item`, { item_id: i1.id, done: true, person: "سامر" });
await call("POST", `/runs/${run.id}/item`, { item_id: i2.id, done: true, person: "سامر" });
rv = await call("GET", "/runs/" + run.id);
const doneLine = rv.rows.find(r => r.item_id === i1.id);
ok(doneLine.done === 1 && doneLine.person === "سامر" && doneLine.at > 0, "البند بيحمل مين عمله ومتى");
ok(rv.summary.missed === 1 && rv.summary.missed_list[0] === "فحص تواريخ الصلاحية",
   "اللي انترك ظاهر بالاسم مش مخفي");
ok(rv.summary.percent === 66.7, "نسبة إنجاز التنفيذ = 2 من 3");
ok((await call("POST", `/runs/${run.id}/item`, { item_id: 9999, done: true, person: "س" })).ok === false,
   "بند مش ضمن التنفيذ بينرفض");

// ══ (2)+(6) الإقفال وفيه بند حرج ناقص ══
const run3 = await call("POST", "/runs", { checklist_id: cl.id, day: T1, person: "سامر" });
await call("POST", `/runs/${run3.id}/item`, { item_id: i2.id, done: true, person: "سامر" });
const closeNo = await call("POST", `/runs/${run3.id}/close`, {});
ok(closeNo.ok === false && /حرج/.test(closeNo.error), "الإقفال بينرفض وفي بند حرج ناقص");
const closed = await call("POST", `/runs/${run3.id}/close`, { force: true, reason: "انقطعت الكهربا" });
ok(closed.ok && closed.run.status === "مقفل ناقص", "الإقفال بالقوة بيسمّي الحالة «مقفل ناقص»");
ok((await call("POST", `/runs/${run3.id}/item`, { item_id: i3.id, done: true, person: "س" })).ok === false,
   "التنفيذ المقفل ما بينعدّل");
const incFromRun = db.prepare("SELECT * FROM ops_incidents WHERE ref_type='run'").all();
ok(incFromRun.length === 1 && incFromRun[0].cause === "انقطعت الكهربا",
   "الإقفال الناقص فتح حادثة بسببها المكتوب");

// ══ (3) الأجهزة ══
ok((await call("POST", "/units", { name: "براد", min_c: 5, max_c: 2 })).ok === false,
   "مدى مقلوب (الأدنى أكبر من الأعلى) بينرفض");
ok((await call("POST", "/units", { name: "براد", min_c: 2 })).ok === false, "جهاز بلا حد أعلى بينرفض");
ok((await call("POST", "/units", { name: "براد", min_c: 2, max_c: 5, bounds: "تقريبي" })).ok === false,
   "نوع حدود غير معروف بينرفض");
const uA = await call("POST", "/units", { name: "براد الأجبان", kind: "براد", min_c: 2, max_c: 5, bounds: "شامل" });
const uB = await call("POST", "/units", { name: "فريزر اللبنة", kind: "فريزر", min_c: -22, max_c: -18, bounds: "غير شامل" });
ok(uA.ok && uB.ok, "انسجّل جهازين بمدى كل واحد");

// ══ (3)(4) القراءات والإنذار ══
ok((await call("POST", "/temps", { unit_id: uA.id, celsius: 4, person: "" })).ok === false,
   "قراءة بلا اسم مسؤول بتنرفض");
ok((await call("POST", "/temps", { unit_id: 9999, celsius: 4, person: "س" })).ok === false,
   "قراءة لجهاز مش موجود بتنرفض");
const good = await call("POST", "/temps", { unit_id: uA.id, celsius: 4, person: "سامر", day: T0 });
ok(good.ok && good.out === false && good.incident_id === null, "قراءة ضمن المدى ما بتفتح حادثة");
const edge = await call("POST", "/temps", { unit_id: uA.id, celsius: 5, person: "سامر", day: T1 });
ok(edge.status === "ضمن المدى", "5° على الحد بالضبط بمدى شامل = سليمة");
const hot = await call("POST", "/temps", { unit_id: uA.id, celsius: 9.4, person: "سامر", day: T1 });
ok(hot.out === true && hot.status === "أعلى من المدى" && hot.incident_id,
   "قراءة برّا المدى فتحت حادثة تلقائياً");
const edgeB = await call("POST", "/temps", { unit_id: uB.id, celsius: -18, person: "سامر", day: T0 });
ok(edgeB.out === true, "−18° على حد فريزر «غير شامل» = خارج المدى");
const incT = db.prepare("SELECT * FROM ops_incidents WHERE ref_type='temp'").all();
ok(incT.length === 2 && incT.every(i => i.severity === "عالية"), "حوادث الحرارة كلها خطورتها عالية");

// 🔴 السجل الرقابي: التصحيح سطر جديد مش كتابة فوق
ok((await call("POST", `/temps/${hot.id}/correct`, { celsius: 4, person: "سامر" })).ok === false,
   "🔴 التصحيح بلا سبب مرفوض");
const corr = await call("POST", `/temps/${hot.id}/correct`,
  { celsius: 4.2, person: "سامر", reason: "الترمومتر كان معطّل" });
ok(corr.ok && corr.status === "ضمن المدى", "التصحيح انسجّل كقراءة جديدة");
const oldRow = db.prepare("SELECT * FROM ops_temps WHERE id=?").get(hot.id);
ok(oldRow && oldRow.celsius === 9.4 && oldRow.voided === 1,
   "🔴 القراءة الأصلية ما انمحت — بتضل موجودة ومعلّم عليها مصحّحة");
const newRow = db.prepare("SELECT * FROM ops_temps WHERE id=?").get(corr.id);
ok(newRow.corrects_id === hot.id && newRow.reason === "الترمومتر كان معطّل",
   "القراءة الجديدة بتقول أي سطر بتصحّح وليش");
ok((await call("POST", `/temps/${hot.id}/correct`, { celsius: 3, person: "س", reason: "مرة تانية" })).ok === false,
   "القراءة المصحّحة ما بتنصحّح مرتين");
ok(newRow.min_c === 2 && newRow.max_c === 5,
   "المدى محفوظ جوّا السطر — تغيير مدى الجهاز بكرا ما بيغيّر حكم الماضي");

// 🔴 يوم بلا قراءة = «ما في قراءة»
const units = await call("GET", `/units?day=${T2}`);
ok(units.rows.every(r => r.today_state === "ما في قراءة"),
   "🔴 يوم ما انسجّلت فيه قراءة اسمه «ما في قراءة» مش «سليم»");
ok(units.totals.no_reading === 2, "عدّاد الأجهزة بلا قراءة صادق");
const unitsT1 = await call("GET", `/units?day=${T1}`);
ok(unitsT1.rows.find(r => r.id === uA.id).today_state === "ضمن المدى",
   "بعد التصحيح صار يوم البراد ضمن المدى");

const cov = await call("GET", `/temps/coverage?from=${T2}&to=${T0}`);
const covA = cov.rows.find(r => r.unit_id === uA.id);
ok(covA.days === 3 && covA.logged_days === 2 && covA.missing_days === 1, "التغطية بتعدّ الأيام الناقصة");
ok(covA.missing_list[0] === T2, "اليوم الناقص مسمّى بتاريخه");
ok(covA.coverage === 66.7, "نسبة التغطية = أيام فيها قراءة ÷ أيام الفترة");
ok(covA.in_range === 100, "🔴 نسبة السلامة محسوبة على الأيام المسجّلة بس — اليوم الفاضي ما بينحسب ناجح");
const covB = cov.rows.find(r => r.unit_id === uB.id);
ok(covB.out_days === 1 && covB.out_readings === 1, "الفريزر إلو يوم خارج المدى");

// ══ (5) النظافة ══
const c1 = await call("POST", "/cleaning", { name: "تعقيم طاولة التقطيع", area: "المطبخ", freq: "يومي" });
const c2 = await call("POST", "/cleaning", { name: "غسيل غرفة التبريد", area: "المخزن", freq: "أسبوعي" });
ok(c1.ok && c2.ok, "انضاف بندين نظافة");
ok((await call("POST", "/cleaning", { name: "بند", freq: "كل شهرين" })).ok === false, "جدولة غير معروفة بتنرفض");
ok((await call("POST", `/cleaning/${c1.id}/log`, { day: T0 })).ok === false, "تسجيل نظافة بلا اسم منفّذ بينرفض");
await call("POST", `/cleaning/${c1.id}/log`, { day: T0, person: "سامر" });
await call("POST", `/cleaning/${c1.id}/log`, { day: T1, person: "سامر" });
await call("POST", `/cleaning/${c2.id}/log`, { day: D(10), person: "أبو محمد" });
const clean = await call("GET", "/cleaning?day=" + T0);
const rc1 = clean.rows.find(r => r.id === c1.id), rc2 = clean.rows.find(r => r.id === c2.id);
ok(rc1.done_today === true && rc1.last_day === T0, "بند اليومي معلّم منجز اليوم");
ok(rc2.due === true && rc2.overdue === 3, "الأسبوعي اللي صار له 10 أيام متأخر 3 أيام");
ok(clean.totals.due === 1 && clean.totals.overdue === 1, "عدّادات الاستحقاق والتأخير");
await call("POST", `/cleaning/${c1.id}/log`, { day: T0, person: "خالد" });
ok(db.prepare("SELECT COUNT(*) c FROM ops_clean_logs WHERE task_id=? AND day=?").get(c1.id, T0).c === 1,
   "نفس البند بنفس اليوم بينتحدّث مش بينتكرّر");

// ══ (8) المهام المتكررة ══
const rt = await call("POST", "/routines", { name: "معايرة الميزان", freq: "شهري", owner: "أبو محمد" });
ok(rt.ok, "انضافت مهمة متكررة شهرية");
const rts = await call("GET", "/routines?day=" + T0);
const rr = rts.rows.find(r => r.id === rt.id);
ok(rr.due === true && rr.last_day === null && rr.overdue === null,
   "المهمة اللي عمرها ما انعملت مستحقة وتأخيرها غير معروف");
ok(rts.totals.never === 1, "عدّاد «عمره ما انعمل» منفصل عن المتأخر");

// ══ (7) الورديات ══
ok((await call("POST", "/shifts", { day: T0, period: "الفجر", person: "س" })).ok === false, "فترة وردية غير معروفة بتنرفض");
ok((await call("POST", "/shifts", { day: T0, period: "صباحي", person: "" })).ok === false, "وردية بلا اسم بتنرفض");
await call("POST", "/shifts", { day: T0, period: "صباحي", person: "سامر", role: "تحضير" });
await call("POST", "/shifts", { day: T0, period: "مسائي", person: "خالد" });
const sh = await call("GET", `/shifts?from=${T2}&to=${T0}`);
ok(sh.rows.length === 2, "الورديات انسجّلت");
ok(sh.days.find(d => d.day === T0).periods.find(p => p.period === "صباحي").people[0].person === "سامر",
   "جدول الورديات موزّع على الأيام والفترات");
ok(sh.uncovered.length === 2 && sh.uncovered.includes(T2), "الأيام بلا ولا وردية بتنسمّى بصراحة");

// ══ (6) الحوادث ══
const inc = await call("POST", "/incidents", { title: "زبون اشتكى من طعم اللبنة", severity: "متوسطة", day: T1 });
ok(inc.ok && inc.id, "انسجّلت حادثة يدوية");
ok((await call("POST", "/incidents", { title: "" })).ok === false, "حادثة بلا عنوان بتنرفض");
ok((await call("POST", `/incidents/${inc.id}/close`, { cause: "" })).ok === false,
   "🔴 ما بتنسكّر حادثة بلا سبب");
ok((await call("POST", `/incidents/${inc.id}/close`, { cause: "دفعة قديمة" })).ok === false,
   "ما بتنسكّر حادثة بلا إجراء تصحيحي");
const closeInc = await call("POST", `/incidents/${inc.id}/close`,
  { cause: "دفعة قديمة انباعت بالغلط", action: "سحبنا الدفعة وعوّضنا الزبون" });
ok(closeInc.ok, "الحادثة انسكّرت بعد ما انكتب السبب والإجراء");
const incList = await call("GET", "/incidents");
ok(incList.totals.closed_without_action === 0, "ما في حادثة مغلقة بلا إجراء تصحيحي");

// ══ (9) لوحة الالتزام ══
const comp = await call("GET", `/compliance?from=${T2}&to=${T0}`);
ok(comp.checklists.items === 6 && comp.checklists.done === 3, "بنود القوائم المفتوحة وإنجازها");
ok(comp.checklists.percent === 50, "التزام القوائم = 3 من 6");
ok(comp.checklists.critical_missed === 1, "البند الحرج اللي انترك معدود");
ok(comp.temperature.days === 6 && comp.temperature.logged_days === 3,
   "تغطية الحرارة على مستوى الجهازين × أيام الفترة");
ok(comp.temperature.missing_days === 3, "أيام بلا قراءة ظاهرة برقمها");
ok(comp.cleaning.expected === 3 && comp.cleaning.done === 2, "المتوقّع من النظافة من جدولتها والمنفّذ فعلاً");
ok(comp.forgotten[0].item === "فحص تواريخ الصلاحية" && comp.forgotten[0].missed === 2,
   "أكثر بند بينتنسى مستخرج من التنفيذات الحقيقية");
ok(comp.forgotten[0].miss_rate === 100, "نسبة نسيان البند محسوبة من مرات فتحه");
ok(comp.overall === 55.6, "المعدّل العام = متوسط المحاور اللي إلها بيانات");

// 🔴 فترة بلا أي بيانات: كل النسب null
const empty = await call("GET", "/compliance?from=2019-01-01&to=2019-01-10");
ok(empty.checklists.percent === null, "🔴 فترة بلا تنفيذات → نسبة القوائم «—» مش صفر");
ok(empty.cleaning.percent === 0 || empty.cleaning.percent === null, "النظافة بفترة قديمة ما بتخترع إنجاز");
ok(empty.temperature.percent === 0, "تغطية الحرارة بفترة بلا قراءات = 0% لأنّ المقام أيام حقيقية");
ok((await call("GET", "/compliance?from=2020-05-05&to=2020-05-01")).ok === false, "فترة مقلوبة بتنرفض");

// ══ لمحة اليوم ══
const td = await call("GET", "/today?day=" + T0);
ok(td.lists[0].run_id === run.id && td.lists[0].percent === 66.7, "لمحة اليوم بتوصل نسبة القائمة");
ok(td.units.every(u => u.state === "مسجّل"), "أجهزة اليوم إلها قراءات");
ok(td.routines_due.length === 1, "المهمة المستحقة ظاهرة بلمحة اليوم");
ok(td.open_incidents.length >= 1, "الحوادث المفتوحة ظاهرة بلمحة اليوم");

// ══ (10) التصدير والتقرير ══
const tcsvBytes = Buffer.from(await (await fetch(`http://127.0.0.1:${port}/o/temps.csv`)).arrayBuffer());
ok(tcsvBytes[0] === 0xEF && tcsvBytes[1] === 0xBB && tcsvBytes[2] === 0xBF, "تصدير الحرارة فيه BOM للعربي بإكسل");
const tcsv = tcsvBytes.toString("utf8");
ok(tcsv.includes("براد الأجبان") && tcsv.includes("سبب التصحيح"), "ملف الحرارة فيه الأجهزة وعمود سبب التصحيح");
ok(tcsv.includes("الترمومتر كان معطّل"), "🔴 التصحيح وسببه ظاهرين بالتصدير الرقابي");
const kcsv = await (await fetch(`http://127.0.0.1:${port}/o/checklists.csv`)).text();
ok(kcsv.includes("انترك"), "تصدير القوائم بيسمّي البند اللي انترك");
const rep = await call("GET", "/report/monthly?month=" + T0.slice(0, 7));
ok(rep.ok && rep.month === T0.slice(0, 7), "التقرير الشهري بيرجع بشهره");
const repCsv = await (await fetch(`http://127.0.0.1:${port}/o/report/monthly.csv?month=2019-01`)).text();
ok(repCsv.includes("—"), "🔴 التقرير الشهري الفاضي بيكتب «—» مش أصفار");
ok((await call("GET", "/report/monthly?month=2025-99")).ok === false, "شهر غلط بالتقرير بينرفض");

srv.close();

// ══ الوحدة والصفحة ══
ok(ops.slug === "ops" && ops.title && ops.icon && typeof ops.router === "function",
   "الوحدة بتصدّر slug و title و icon و router");
ok(fs.existsSync("public/features-ops.html"), "صفحة الوحدة موجودة");
ok(db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name LIKE 'ops!_%' ESCAPE '!'").get().c === 12,
   "كل جداول الوحدة بادئتها ops_");

wipe();
console.log(`\n${fail ? "🔴" : "🟢"} نجح ${pass} / فشل ${fail}`);
process.exit(fail ? 1 : 0);
