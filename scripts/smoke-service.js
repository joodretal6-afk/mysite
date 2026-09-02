// ═══════════════════════════════════════════════════════════
// 🧪 اختبار خدمة العملاء والشكاوى (service)
//
// بيغطي: حساب أوقات أول رد والحل، حدود الـSLA بالضبط (المساواة
// مش تجاوز)، إعادة الفتح ونسبتها، رفض المدخلات الغلط، السجل
// الزمني، تعبئة القوالب بمتغيّراتها، التعويضات والاسترجاع،
// وإثبات إنّ المؤشر بلا بيانات بيرجع null مش صفر.
// ═══════════════════════════════════════════════════════════
if (!process.env.DB_PATH || /platform\.db/.test(process.env.DB_PATH))
  process.env.DB_PATH = "./data/smoke-service.db";
if (/platform\.db/.test(process.env.DB_PATH)) {
  console.error("🔴 رفض: الاختبار ما بيشتغل على قاعدة الإنتاج"); process.exit(1);
}
import fs from "node:fs";
const wipe = () => ["", "-wal", "-shm"].forEach(x => { try { fs.rmSync(process.env.DB_PATH + x); } catch {} });
wipe();

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { console.log("❌ " + m); fail++; } };

const sv = await import("../src/features/service.js");
await new Promise(r => setTimeout(r, 500));
const { db } = await import("../src/db/database.js");

const HOUR = 3600000, MIN = 60000;

// ═══════════ الدوال الصافية ═══════════

// (7) بلا بيانات → null مش صفر
const empty = sv.kpis([]);
ok(empty.tickets === 0, "بلا تذاكر: العدد صفر");
ok(empty.first_reply_avg === null, "🔴 بلا تذاكر: متوسط أول رد null مش 0");
ok(empty.resolve_avg === null, "🔴 بلا تذاكر: متوسط الحل null مش 0");
ok(empty.reopen_rate === null, "🔴 بلا تذاكر: نسبة إعادة الفتح null مش 0");

const T0 = 1700000000000;
const sample = [
  { opened_at: T0, first_reply_at: T0 + 10 * MIN, resolved_at: T0 + 2 * HOUR, status: "تم الحل", reopen_count: 0 },
  { opened_at: T0, first_reply_at: T0 + 30 * MIN, resolved_at: T0 + 6 * HOUR, status: "مغلق", reopen_count: 1 },
  { opened_at: T0, first_reply_at: null, resolved_at: null, status: "جديد", reopen_count: 0 }
];
const k = sv.kpis(sample);
ok(k.first_reply_n === 2 && k.first_reply_avg === 20, "متوسط أول رد = (10+30)/2 = 20 دقيقة");
ok(k.first_reply_median === 20, "وسيط أول رد");
ok(k.resolve_avg === 240, "متوسط الحل = (120+360)/2 = 240 دقيقة");
ok(k.no_reply === 1, "التذكرة اللي ما إجاها رد معدودة");
ok(k.open === 1, "التذكرة المفتوحة معدودة");
ok(k.reopen_base === 2 && k.reopen_rate === 50,
   "نسبة إعادة الفتح على اللي انحلّوا بس (1 من 2 = 50%) — المفتوحة برّا المقام");

// (4) حدود الـSLA بالضبط
const base = { opened_at: T0, sla_reply_h: 4, sla_resolve_h: 48, first_reply_at: null, resolved_at: null };
const exact = sv.slaCheck({ ...base, first_reply_at: T0 + 4 * HOUR });
ok(exact.reply_breached === false, "🎯 الرد بالثانية الأخيرة تماماً = ضمن المهلة مش تجاوز");
ok(exact.reply_mins === 240, "وقت أول رد بالدقائق");
const over = sv.slaCheck({ ...base, first_reply_at: T0 + 4 * HOUR + 1 });
ok(over.reply_breached === true, "🎯 ملّي ثانية وحدة بعد المهلة = تجاوز");
const under = sv.slaCheck({ ...base, first_reply_at: T0 + 4 * HOUR - 1 });
ok(under.reply_breached === false, "أقل من المهلة بملّي ثانية = التزام");

const pending = sv.slaCheck(base, T0 + 5 * HOUR);
ok(pending.reply_breached === true && pending.reply_mins === null,
   "تذكرة بلا رد وفات وقتها = متجاوزة، وبلا وقت رد محسوب");
ok(pending.reply_left_mins === -60, "الوقت المتبقّي بالسالب لمّا تكون متأخرة");
const stillOk = sv.slaCheck(base, T0 + 1 * HOUR);
ok(stillOk.reply_breached === false && stillOk.reply_left_mins === 180, "لسا باقي 180 دقيقة");
ok(sv.slaCheck({ ...base, sla_reply_h: 0 }, T0 + 999 * HOUR).reply_breached === null,
   "🔴 سياسة معطّلة (0 ساعة) → null مش «ملتزم» ولا «متجاوز»");
ok(sv.slaCheck({ opened_at: null }).reply_breached === null, "تذكرة بلا وقت فتح ما بتعطي حكم");
const resolveB = sv.slaCheck({ ...base, resolved_at: T0 + 48 * HOUR + 1 });
ok(resolveB.resolve_breached === true && resolveB.resolve_mins === 2880,
   "تجاوز مهلة الحل بينكشف حتى لو بملّي ثانية");
ok(sv.slaCheck({ ...base, resolved_at: T0 + 48 * HOUR }).resolve_breached === false,
   "🎯 الحل بالثانية الأخيرة تماماً = ضمن المهلة");

// (3)+(8) عدّاد التكرار
const tl = sv.tally([{ a: "إربد" }, { a: "إربد" }, { a: "عمان" }, { a: "" }, { a: null }], "a");
ok(tl.rows[0].label === "إربد" && tl.rows[0].n === 2, "أكثر منطقة تكراراً بتطلع أول");
ok(tl.rows[0].share === 66.67, "النسبة محسوبة على المعدود فقط");
ok(tl.blank === 2 && tl.counted === 3, "🔴 الخانات الفاضية بتنعدّ لحالها وما بتدخل الترتيب");
ok(sv.tally([], "a").rows.length === 0 && sv.tally([], "a").counted === 0, "بلا صفوف = بلا ترتيب");

// (9) تعبئة القوالب
const f1 = sv.fillTemplate("مرحبا {الاسم}، طلبك رقم {رقم الطلب} بالطريق.",
                           { "الاسم": "أبو محمد", "رقم الطلب": 77 });
ok(f1.text === "مرحبا أبو محمد، طلبك رقم 77 بالطريق." && f1.missing.length === 0, "تعبئة القالب بمتغيّراته");
const f2 = sv.fillTemplate("مرحبا {الاسم}، بخصوص {الصنف}", { "الاسم": "سمر" });
ok(f2.text === "مرحبا سمر، بخصوص {الصنف}" && f2.missing[0] === "الصنف",
   "🔴 المتغيّر الناقص بيضل ظاهر وبينتبلّغ عنه — ما منعبّيه من راسنا");
ok(sv.fillTemplate("مرحبا {الاسم}", { "الاسم": "   " }).missing[0] === "الاسم", "القيمة الفاضية بتنعتبر ناقصة");
ok(sv.fillTemplate("بلا متغيّرات").missing.length === 0, "نص بلا متغيّرات بيمرّ زي ما هو");

// مدى الشهر
ok(sv.monthRange("2025-13") === null && sv.monthRange("2025-1") === null, "شهر غلط بينرفض");
const mr = sv.monthRange("2025-03");
ok(mr && new Date(mr.to - mr.from).getTime() === 31 * 86400000, "آذار = 31 يوم");

// ═══════════ الراوتر ═══════════
const express = (await import("express")).default;
const app = express();
app.use("/s", sv.router);
const srv = app.listen(0);
const port = srv.address().port;
const call = async (m, p, body) => {
  const r = await fetch(`http://127.0.0.1:${port}/s${p}`, {
    method: m, headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  return r.json();
};

const meta = await call("GET", "/meta");
ok(meta.ok && meta.reasons.length === 8, "قائمة أسباب الشكاوى انزرعت");
ok(meta.sla_reply_h === 4 && meta.sla_resolve_h === 48, "سياسة الـSLA الافتراضية");
ok(/ما في ولا إرسال تلقائي/.test(meta.policy), "🔴 الوحدة معلنة إنها ما بتبعت للزبون تلقائياً");

// كل مؤشرات لوحة الأداء لسا بلا بيانات
const k0 = await call("GET", "/kpis");
ok(k0.first_reply_avg === null && k0.resolve_avg === null && k0.reopen_rate === null,
   "🔴 اللوحة قبل أي تذكرة: كل المؤشرات null");
ok(k0.comp_per_ticket === null, "كلفة التعويض للتذكرة null مش صفر قبل ما يكون في تذاكر");

// طلب حقيقي للربط
db.prepare(`INSERT INTO orders (id,page_id,page_name,sender_id,order_string,total,area,phone,status,created_at)
            VALUES (501,'p1','صفحة','u9','جبنة (2)',30,'إربد','0790000000','جديد',?)`).run(Date.now());

// (1) فتح تذكرة + التحقق من المدخلات
ok((await call("POST", "/tickets", { subject: "تأخير" })).error.includes("مين فتح"),
   "بلا اسم الموظف التذكرة بتنرفض");
ok((await call("POST", "/tickets", { actor: "أحمد" })).error.includes("موضوع"), "بلا موضوع بتنرفض");
ok((await call("POST", "/tickets", { actor: "أحمد", subject: "س", reason: "سبب مخترع" })).error.includes("مش من القائمة"),
   "🔴 سبب مش بالقائمة بينرفض — ما منقبل تصنيف مخترع");
ok((await call("POST", "/tickets", { actor: "أحمد", subject: "س", priority: "طيّارة" })).error.includes("الأولوية"),
   "أولوية غير معروفة بتنرفض");
ok((await call("POST", "/tickets", { actor: "أحمد", subject: "س", order_id: 99999 })).error.includes("مش موجود"),
   "الربط بطلب غير موجود بينرفض");

const now = Date.now();
const t1 = await call("POST", "/tickets", {
  actor: "أحمد", subject: "الطلب تأخّر 5 أيام", reason: "تأخير بالتوصيل",
  order_id: 501, item: "جبنة نابلسية", priority: "مرتفع", opened_at: now - 10 * HOUR
});
ok(t1.ok && t1.id, "انفتحت التذكرة الأولى");
ok(t1.ticket.area === "إربد" && t1.ticket.phone === "0790000000",
   "المنطقة والهاتف انسحبوا من الطلب المربوط مش من الإيد");
ok(t1.ticket.sla_reply_h === 4, "سياسة الـSLA اتثبّتت على التذكرة لحظة الفتح");

// (2) السجل الزمني
const ev0 = await call("GET", `/tickets/${t1.id}/events`);
ok(ev0.rows.length === 1 && ev0.rows[0].actor === "أحمد" && ev0.rows[0].action === "فتح تذكرة",
   "الفتح انسجّل بالسجل الزمني باسم صاحبه");

// (4) التذكرة تجاوزت مهلة الرد (10 ساعات بلا رد وسياسة 4)
const br = await call("GET", "/breaches");
ok(br.counts.reply === 1 && br.reply[0].id === t1.id, "التذكرة اللي فاتت مهلتها ظاهرة بالمتجاوزين");

// أول رد
ok((await call("POST", `/tickets/${t1.id}/reply`, { at: now - 20 * HOUR, actor: "سالي" })).error.includes("قبل وقت فتح"),
   "وقت رد قبل فتح التذكرة بينرفض");
ok((await call("POST", `/tickets/${t1.id}/reply`, { at: now - 9 * HOUR })).error.includes("مين رد"),
   "الرد بلا اسم بينرفض");
const rep1 = await call("POST", `/tickets/${t1.id}/reply`, { actor: "سالي", at: now - 9 * HOUR });
ok(rep1.ok && rep1.ticket.sla.reply_mins === 60, "أول رد بعد 60 دقيقة");
ok(rep1.ticket.sla.reply_breached === false, "60 دقيقة ضمن مهلة الـ4 ساعات");
ok(rep1.ticket.status === "قيد المعالجة", "التذكرة انتقلت لقيد المعالجة تلقائياً بعد أول رد");
ok((await call("POST", `/tickets/${t1.id}/reply`, { actor: "سالي" })).error.includes("مسجّل من قبل"),
   "🔴 أول رد ما بينداس عليه مرة ثانية — وإلا صار المؤشر مجاملة");

// تعديل + سجل
ok((await call("POST", `/tickets/${t1.id}`, { status: "تم الحل" })).error.includes("تعديل صامت"),
   "🔴 التعديل بلا اسم الموظف بينرفض");
ok((await call("POST", `/tickets/${t1.id}`, { actor: "أحمد", status: "منتهي" })).error.includes("الحالة"),
   "حالة غير معروفة بتنرفض");
ok((await call("POST", `/tickets/${t1.id}`, { actor: "أحمد", priority: "مرتفع" })).error.includes("ما في شي جديد"),
   "قيمة زي ما هي = ما في تعديل");

const solved = await call("POST", `/tickets/${t1.id}`, { actor: "أحمد", status: "تم الحل", note: "تواصلنا وانحلّت" });
ok(solved.ok && solved.ticket.resolved_at != null, "وقت الحل انختم مع تغيير الحالة");
ok(solved.ticket.sla.resolve_mins != null && solved.ticket.sla.resolve_breached === false,
   "وقت الحل محسوب وضمن مهلة الـ48 ساعة");
const ev1 = await call("GET", `/tickets/${t1.id}/events`);
ok(ev1.rows.some(e => e.field === "الحالة" && e.old_value === "قيد المعالجة" && e.new_value === "تم الحل"),
   "تغيير الحالة انسجّل بقيمته القديمة والجديدة");
ok(ev1.rows.some(e => e.action === "ملاحظة" && e.note === "تواصلنا وانحلّت"), "الملاحظة انسجّلت بالسجل");

// (7) إعادة الفتح
ok((await call("POST", `/tickets/${t1.id}/reopen`, { actor: "أحمد" })).error.includes("ليش"),
   "إعادة فتح بلا سبب بتنرفض");
const re = await call("POST", `/tickets/${t1.id}/reopen`, { actor: "أحمد", note: "الزبون رجع اشتكى" });
ok(re.ok && re.reopen_count === 1 && re.ticket.resolved_at === null,
   "إعادة الفتح عدّت مرة ومسحت وقت الحل");
ok((await call("POST", `/tickets/${t1.id}/reopen`, { actor: "أحمد", note: "تاني" })).error.includes("لسا مفتوحة"),
   "ما بتنعاد فتح تذكرة أصلاً مفتوحة");

// (5) التعويضات
ok((await call("POST", `/tickets/${t1.id}/comps`, { actor: "أحمد", kind: "رشوة", amount: 5 })).error.includes("نوع التعويض"),
   "نوع تعويض غير معروف بينرفض");
ok((await call("POST", `/tickets/${t1.id}/comps`, { actor: "أحمد", kind: "خصم", amount: -3 })).error.includes("صفر أو أكثر"),
   "تعويض بمبلغ سالب بينرفض");
ok((await call("POST", `/tickets/${t1.id}/comps`, { actor: "أحمد", kind: "خصم", amount: 2.5 })).ok, "انسجّل تعويض");
await call("POST", `/tickets/${t1.id}/comps`, { actor: "أحمد", kind: "توصيل مجاني", amount: 1.75 });
const comps = await call("GET", "/comps");
ok(comps.total === 4.25, "مجموع التعويضات = 2.5 + 1.75");
ok(comps.by_kind.length === 2, "التعويضات مصنّفة بنوعها");

// (6) الاسترجاع والاستبدال
ok((await call("POST", `/tickets/${t1.id}/returns`, { actor: "أحمد", kind: "استبدال", qty: 0 })).error.includes("الكمية"),
   "استرجاع بكمية صفر بينرفض");
const rt = await call("POST", `/tickets/${t1.id}/returns`, { actor: "أحمد", kind: "استرجاع", qty: 2, refund: 15 });
ok(rt.ok && rt.id, "انسجّل طلب استرجاع");
ok((await call("POST", `/returns/${rt.id}/state`, { actor: "أحمد", state: "ضايع" })).error.includes("الحالة"),
   "حالة استرجاع غير معروفة بتنرفض");
ok((await call("POST", `/returns/${rt.id}/state`, { actor: "أحمد", state: "مطلوب" })).error.includes("زي ما هي"),
   "نفس الحالة = ما في تغيير");
ok((await call("POST", `/returns/${rt.id}/state`, { actor: "أحمد", state: "تم التعويض" })).ok, "حالة الاسترجاع تغيّرت");
const rets = await call("GET", "/returns");
ok(rets.refund_total === 15, "المبلغ المسترجع بينتحسب بس بعد ما تصير الحالة «تم التعويض»");
const ev2 = await call("GET", `/tickets/${t1.id}/events`);
ok(ev2.rows.some(e => e.field === "حالة الاسترجاع" && e.new_value === "تم التعويض"),
   "تغيير حالة الاسترجاع انكتب بسجل التذكرة كمان");

// تذكرة ثانية بمنطقة وصنف مختلفين للتجميع
const t2 = await call("POST", "/tickets", {
  actor: "سالي", subject: "الصنف ناقص", reason: "صنف ناقص", area: "عمان",
  item: "جبنة نابلسية", customer: "أم خالد", opened_at: now - 2 * HOUR
});
ok(t2.ok, "انفتحت التذكرة الثانية");

// (8) أكثر الأصناف والمناطق
const hs = await call("GET", "/hotspots");
ok(hs.items.rows[0].label === "جبنة نابلسية" && hs.items.rows[0].n === 2, "أكثر صنف شكاوى");
ok(hs.areas.rows.length === 2 && hs.areas.counted === 2, "المناطق مجمّعة من التذاكر المسجّلة");
ok(hs.reasons.rows.length === 2, "الأسباب مرتّبة بتكرارها");

// (3) استخدام الأسباب
const rs = await call("GET", "/reasons");
ok(rs.usage.rows.some(r => r.label === "تأخير بالتوصيل" && r.n === 1), "تكرار السبب محسوب من التذاكر");
ok((await call("POST", "/reasons", { label: "تأخير بالتوصيل" })).error.includes("موجود"), "سبب مكرّر بينرفض");
ok((await call("POST", "/reasons", { label: "" })).error.includes("اسم السبب"), "سبب فاضي بينرفض");

// (9) القوالب
ok((await call("POST", "/templates", { title: "اعتذار", body: "" })).error.includes("نص الرد"), "قالب بلا نص بينرفض");
const tp = await call("POST", "/templates", {
  title: "اعتذار عن التأخير", reason: "تأخير بالتوصيل",
  body: "أهلاً {الاسم}، بعتذر عن تأخير طلبك رقم {رقم الطلب}. عوّضناك بـ{التعويض}."
});
ok(tp.ok, "انحفظ القالب");
const rn = await call("POST", `/templates/${tp.id}/render`, { ticket_id: t1.id });
ok(rn.text.includes("501"), "رقم الطلب انعبّى من التذكرة");
ok(rn.missing.includes("التعويض") && rn.text.includes("{التعويض}"),
   "🔴 المتغيّر اللي ما إلنا قيمة إله بيضل فاضي وبينتبلّغ عنه");
ok(/ما بتبعت ولا رسالة/.test(rn.note), "🔴 الرد بيقول صراحة إنه للنسخ اليدوي — بلا إرسال");
const rn2 = await call("POST", `/templates/${tp.id}/render`,
  { ticket_id: t1.id, vars: { "التعويض": "خصم 2.5 دينار", "الاسم": "أبو محمد" } });
ok(rn2.missing.length === 0 && rn2.text.includes("خصم 2.5 دينار"), "المتغيّر اليدوي كمّل القالب");

// (7) اللوحة بعد ما صار في بيانات
const kk = await call("GET", "/kpis");
ok(kk.tickets === 2 && kk.first_reply_n === 1, "اللوحة بتقول على كم تذكرة انبنى المؤشر");
ok(kk.first_reply_avg === 60, "متوسط أول رد من التذاكر الحقيقية");
ok(kk.resolve_avg === null, "🔴 التذكرة انعاد فتحها فما بقي ولا حل مكتمل → متوسط الحل null");
ok(kk.reopen_rate === 100 && kk.reopen_base === 1, "نسبة إعادة الفتح من اللي وصلوا للحل");
ok(kk.comp_total === 4.25, "كلفة التعويضات ظاهرة باللوحة");

// (10) التصدير
const expRes = await fetch(`http://127.0.0.1:${port}/s/export.csv`);
const expBytes = Buffer.from(await expRes.arrayBuffer());
const expTxt = expBytes.toString("utf8");
ok(expBytes[0] === 0xEF && expBytes[1] === 0xBB && expBytes[2] === 0xBF, "التصدير فيه BOM للعربي");
ok(expTxt.includes("الطلب تأخّر 5 أيام") && expTxt.includes("أم خالد"), "التصدير فيه التذاكر");
ok(expTxt.split("\r\n").length === 3, "سطر عناوين + تذكرتين");

// (10) التقرير الشهري
ok((await call("GET", "/report/monthly?month=2025")).error.includes("YYYY-MM"), "شهر بصيغة غلط بينرفض");
const mstr = new Date(now + 10800000).toISOString().slice(0, 7);
const rep = await call("GET", "/report/monthly?month=" + mstr);
ok(rep.ok && rep.tickets === 2, "التقرير الشهري بيعدّ تذاكر الشهر");
ok(rep.compensation.total === 4.25, "التقرير فيه كلفة التعويضات");
ok(rep.change_pct === null && /ما في تذاكر بالشهر السابق/.test(rep.basis),
   "🔴 بلا شهر سابق ما في نسبة تغيّر — منقولها بصراحة بدل رقم مخترع");

// الإعدادات
ok((await call("POST", "/config", { sla_reply_h: 10, sla_resolve_h: 2 })).error.includes("أقصر"),
   "مهلة حل أقصر من مهلة الرد بتنرفض");
ok((await call("POST", "/config", { sla_reply_h: -1, sla_resolve_h: 20 })).error.includes("أول رد"),
   "مهلة سالبة بتنرفض");
const cfg = await call("POST", "/config", { sla_reply_h: 2, sla_resolve_h: 24 });
ok(cfg.ok && cfg.sla_reply_h === 2, "انحفظت سياسة الـSLA الجديدة");
ok((await call("GET", `/tickets/${t1.id}`)).ticket.sla_reply_h === 4,
   "🔴 السياسة الجديدة ما بتغيّر تذاكر قديمة بأثر رجعي");

ok((await call("GET", "/tickets/99999")).error.includes("غير موجودة"), "تذكرة مش موجودة بترجع خطأ واضح");

srv.close();

ok(fs.existsSync("public/features-service.html"), "صفحة خدمة العملاء موجودة");
ok(sv.slug === "service" && sv.title && sv.icon && sv.router, "الوحدة بتصدّر slug/title/icon/router");

wipe();
console.log(`\n${fail ? "🔴" : "🟢"} نجح ${pass} / فشل ${fail}`);
process.exit(fail ? 1 : 0);
