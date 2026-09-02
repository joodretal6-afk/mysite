// ═══════════════════════════════════════════════════════════
// 🧪 اختبار الأرشيف والوثائق والامتثال
//
// بيغطي: رفع ملفات حقيقية (CSV/إكسل/نص/PDF ممسوح)، استخراج
// النص والبحث فيه، عدّاد أيام الانتهاء على حدوده بالضبط،
// رفض الملف الكبير، سجل الوصول، الامتثال، والتنزيل بنفس البايتات.
// ═══════════════════════════════════════════════════════════
if (!process.env.DB_PATH || /platform\.db/.test(process.env.DB_PATH))
  process.env.DB_PATH = "./data/smoke-docs.db";
if (/platform\.db/.test(process.env.DB_PATH)) { console.error("🔴 رفض: الاختبار ما بيشتغل على قاعدة الإنتاج"); process.exit(1); }

import fs from "node:fs";
const wipe = () => ["", "-wal", "-shm"].forEach(x => { try { fs.rmSync(process.env.DB_PATH + x); } catch {} });
wipe();

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { console.log("❌ " + m); fail++; } };

const D = await import("../src/features/docs.js");
await new Promise(r => setTimeout(r, 400));
const { db } = await import("../src/db/database.js");
const ExcelJS = (await import("exceljs")).default;

const DAY = 86400000;
const NOW = Date.UTC(2026, 4, 20, 9, 0, 0);          // 20 أيار 2026 الساعة 12 ظهراً بعمّان
// التواريخ النسبية لازم تنبني على «اليوم الحقيقي» لأنّ الراوتر بيحسب بـDate.now()
const plus = (d) => new Date(Date.now() + d * DAY + 10800000).toISOString().slice(0, 10);

// ═══════════ عدّاد الأيام على حدوده ═══════════
ok(D.todayStr(NOW) === "2026-05-20", "اليوم محسوب بتوقيت عمّان مش UTC");
ok(D.daysLeft("2026-05-20", NOW) === 0, "تاريخ اليوم = صفر يوم باقي");
ok(D.daysLeft("2026-05-21", NOW) === 1, "بكرا = باقي يوم واحد");
ok(D.daysLeft("2026-05-19", NOW) === -1, "امبارح = منتهي من يوم");
ok(D.daysLeft("2027-05-20", NOW) === 365, "سنة كاملة = 365 يوم");
ok(D.daysLeft("", NOW) === null && D.daysLeft("20-5-2026", NOW) === null,
   "تاريخ فاضي أو بصيغة غلط = null مش صفر (فرق «ما بنعرف» عن «اليوم»)");
// الساعة 23:00 بتوقيت عمّان لسا نفس اليوم — منتأكد إنّ الإزاحة مضبوطة
ok(D.todayStr(Date.UTC(2026, 4, 20, 20, 30)) === "2026-05-20", "الساعة 11 ونص ليلاً بعمّان لسا نفس اليوم");
ok(D.todayStr(Date.UTC(2026, 4, 20, 21, 30)) === "2026-05-21", "بعد منتصف الليل بعمّان بيصير اليوم اللي بعده");

ok(D.expiryState("2026-05-19", 30, NOW).state === "منتهي", "حالة: منتهي");
ok(D.expiryState("2026-05-20", 30, NOW).state === "بينتهي اليوم", "حالة: بينتهي اليوم");
ok(D.expiryState("2026-05-21", 30, NOW).state === "قرب الانتهاء", "حالة: قرب الانتهاء (باقي يوم)");
ok(D.expiryState("2026-06-19", 30, NOW).state === "قرب الانتهاء", "اليوم الـ30 لسا داخل التحذير");
ok(D.expiryState("2026-06-20", 30, NOW).state === "ساري", "اليوم الـ31 برّا التحذير = ساري");
ok(D.expiryState("", 30, NOW).state === "بلا تاريخ", "بلا تاريخ = بلا تخمين");

// توحيد العربي للبحث
ok(D.norm("الإجراءات") === D.norm("الاجراءات"), "الهمزة ما بتفرّق بالبحث");
ok(D.norm("رخصة") === D.norm("رخصه"), "التاء المربوطة ما بتفرّق بالبحث");
ok(D.norm("١٢٣") === "123", "الأرقام العربية بتتوحّد");

// ═══════════ استخراج النص من ملفات حقيقية ═══════════
const csvBuf = Buffer.from("﻿البند,القيمة\nرخصة مهن,120\nشهادة صحية,45\n", "utf8");
const exCsv = await D.extractText(csvBuf, "fees.csv");
ok(exCsv.extracted === 1 && /رخصة مهن/.test(exCsv.text), "نص الـCSV انستخرج");

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("العقود");
ws.addRow(["الطرف", "البند"]); ws.addRow(["شركة التوصيل السريع", "أجرة 1.75 دينار للطرد"]);
const xbuf = Buffer.from(await wb.xlsx.writeBuffer());
const exX = await D.extractText(xbuf, "contract.xlsx");
ok(exX.extracted === 1 && /شركة التوصيل السريع/.test(exX.text), "نص الإكسل انستخرج من الخانات");
ok(/العقود/.test(exX.text), "اسم ورقة الإكسل داخل النص المستخرج");

const scanPdf = Buffer.from("%PDF-1.4\ntrailer<<>>\n%%EOF");
const exPdf = await D.extractText(scanPdf, "scan.pdf");
ok(exPdf.extracted === 0 && exPdf.text === "", "🔴 الـPDF الممسوح ما طلّع ولا حرف مخترع");
ok(/البحث رح يلاقيها بالاسم والوسوم بس/.test(exPdf.note), "بنقول للمستخدم بصراحة إنّا ما قدرنا نقرأ محتواها");

// ═══════════ الراوتر ═══════════
const express = (await import("express")).default;
const app = express();
app.use("/d", D.router);
const srv = app.listen(0);
const port = srv.address().port;
// ملاحظة: اسم المستخدم بيمرّ بالجسم أو بالكويري — الهيدر ما بيقبل عربي (ByteString)
const call = async (m, p, body) => {
  const r = await fetch(`http://127.0.0.1:${port}/d${p}`, {
    method: m, headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  return r.json();
};

// (1)(2) رفع
const up1 = await call("POST", "/files", {
  title: "كشف رسوم البلدية", doc_type: "فواتير", folder: "مالية", tags: "بلدية, رسوم",
  doc_date: "2026-05-01", filename: "fees.csv", base64: csvBuf.toString("base64"), who: "أبو محمد"
});
ok(up1.ok && up1.id, "رفع ملف CSV نجح");
ok(up1.extracted === true && up1.chars > 0, "الرفع استخرج نص الوثيقة أوتوماتيك");
ok(up1.warning === null, "ملف انقرأ = بلا تحذير");

const up2 = await call("POST", "/files", {
  title: "عقد شركة التوصيل", doc_type: "عقود", folder: "قانونية", tags: ["توصيل"],
  filename: "contract.xlsx", base64: xbuf.toString("base64")
});
ok(up2.ok && up2.extracted === true, "رفع ملف إكسل واستخراج نصه");

const up3 = await call("POST", "/files", {
  title: "صورة السجل التجاري", doc_type: "تراخيص", folder: "قانونية", tags: "سجل",
  filename: "scan.pdf", base64: scanPdf.toString("base64")
});
ok(up3.ok && up3.extracted === false, "الوثيقة اللي ما انقرأت انحفظت بلا نص");
ok(/ما قدرنا نقرأ محتواها/.test(up3.warning || ""), "🔴 التحذير الصريح رجع للواجهة");

// رفض المدخلات الغلط
ok((await call("POST", "/files", { base64: csvBuf.toString("base64") })).error.includes("اسم"), "الرفع بلا اسم بينرفض");
ok((await call("POST", "/files", { title: "بلا ملف" })).error.includes("ما وصل ملف"), "الرفع بلا ملف بينرفض");
ok(/YYYY-MM-DD/.test((await call("POST", "/files",
  { title: "ت", filename: "a.csv", base64: csvBuf.toString("base64"), doc_date: "1-5-2026" })).error),
  "تاريخ وثيقة بصيغة غلط بينرفض");

// (5 بالقواعد) الملف الأكبر من 15 ميجا
const big = Buffer.alloc(15 * 1024 * 1024 + 1024, 0x41);
const upBig = await call("POST", "/files", { title: "ملف ضخم", filename: "big.txt", base64: big.toString("base64") });
ok(upBig.ok === false && /15 ميجا/.test(upBig.error), "الملف الأكبر من 15 ميجا بينرفض برسالة عربية واضحة");
ok(D.MAX_BYTES === 15 * 1024 * 1024, "الحد الأقصى معرّف بوضوح");

// (3) البحث بالمحتوى
const s1 = await call("GET", "/files?q=" + encodeURIComponent("رخصة مهن"));
ok(s1.count === 1 && s1.rows[0].id === up1.id, "البحث لقى الوثيقة من محتواها الداخلي مش من اسمها");
ok(s1.rows[0].snippet && /رخصة مهن/.test(s1.rows[0].snippet), "المقتطف منسوخ حرفياً من نص الوثيقة");
const s2 = await call("GET", "/files?q=" + encodeURIComponent("التوصيل السريع"));
ok(s2.count === 1 && s2.rows[0].id === up2.id, "البحث بالمحتوى شغّال على الإكسل كمان");
const s3 = await call("GET", "/files?q=" + encodeURIComponent("السجل التجاري"));
ok(s3.count === 1 && s3.rows[0].id === up3.id, "الوثيقة اللي ما انقرأت لسا بتنلاقى باسمها");
ok((await call("GET", "/files?q=" + encodeURIComponent("كلمة ما إلها وجود"))).count === 0,
   "🔴 بحث بلا نتيجة بيرجع فاضي — ما منلفّق نتايج");
const s4 = await call("GET", "/files?q=" + encodeURIComponent("رخصه"));
ok(s4.count === 1, "البحث بيتجاهل فرق التاء المربوطة");

// (8) الفلترة بالمجلد والنوع والوسم
ok((await call("GET", "/files?folder=" + encodeURIComponent("قانونية"))).count === 2, "الفلترة بالمجلد");
ok((await call("GET", "/files?doc_type=" + encodeURIComponent("فواتير"))).count === 1, "الفلترة بنوع الوثيقة");
ok((await call("GET", "/files?tag=" + encodeURIComponent("بلدية"))).count === 1, "الفلترة بالوسم");
const fac = await call("GET", "/facets");
ok(fac.folders.length === 2 && fac.tags.includes("رسوم"), "المجلدات والوسوم بتنجمع للفلترة السريعة");

// (10) التنزيل بنفس البايتات
const dl = await fetch(`http://127.0.0.1:${port}/d/files/${up2.id}/download`);
const dlBuf = Buffer.from(await dl.arrayBuffer());
ok(dlBuf.equals(xbuf), "الملف الأصلي نزل بنفس البايتات بالضبط");
ok(dl.headers.get("content-type").includes("spreadsheetml"), "نوع المحتوى مضبوط حسب الامتداد");
const dlCsv = Buffer.from(await (await fetch(`http://127.0.0.1:${port}/d/files/${up1.id}/download`)).arrayBuffer());
ok(dlCsv.equals(csvBuf), "الـCSV نزل بنفس بايتاته (بالـBOM تبعه)");
ok((await fetch(`http://127.0.0.1:${port}/d/files/99999/download`)).status === 404, "تنزيل وثيقة مش موجودة = 404");

// (7) سجل الوصول
const view = await call("GET", `/files/${up1.id}?who=` + encodeURIComponent("سائق"));
ok(view.ok && view.file.body_text.includes("شهادة صحية"), "فتح الوثيقة بيرجّع نصها المستخرج");
const acc = await call("GET", "/access?file_id=" + up1.id);
const actions = acc.rows.map(r => r.action);
ok(actions.includes("رفع") && actions.includes("فتح") && actions.includes("تنزيل"), "سجل الوصول سجّل الرفع والفتح والتنزيل");
ok(acc.rows.find(r => r.action === "فتح").who === "سائق", "سجل الوصول بيحفظ مين فتحها بالضبط");
ok(acc.rows.find(r => r.action === "رفع").who === "أبو محمد", "الرافع محفوظ باسمه");
ok(acc.rows.every(r => r.at > 0 && r.title === "كشف رسوم البلدية"), "كل سطر وصول إلو وقت واسم وثيقة");

// (4)(5) التراخيص
const L1 = await call("POST", "/licenses", { name: "رخصة مهن", kind: "رخصة", issuer: "أمانة عمّان",
  expires_at: plus(-3), file_id: up3.id });
ok(L1.ok, "إضافة ترخيص منتهي");
const L2 = await call("POST", "/licenses", { name: "شهادة صحية", expires_at: plus(0) });
const L3 = await call("POST", "/licenses", { name: "سجل تجاري", expires_at: plus(1) });
const L4 = await call("POST", "/licenses", { name: "رخصة سيارة", expires_at: plus(20) });
ok(L2.ok && L3.ok && L4.ok, "إضافة باقي التراخيص");
ok((await call("POST", "/licenses", { name: "بلا تاريخ" })).error.includes("إلزامي"),
   "🔴 ترخيص بلا تاريخ انتهاء بينرفض — منّا بنستنتج التاريخ");
ok((await call("POST", "/licenses", { expires_at: plus(10) })).error.includes("اسم"), "ترخيص بلا اسم بينرفض");
ok((await call("POST", "/licenses", { name: "س", expires_at: plus(10), issued_at: plus(20) })).error.includes("راجع التواريخ"),
   "إصدار بعد الانتهاء بينرفض");
ok((await call("POST", "/licenses", { name: "س", expires_at: plus(10), file_id: 99999 })).error.includes("مش موجودة"),
   "الربط بوثيقة مش موجودة بينرفض");

const lics = await call("GET", "/licenses?warn=30");
ok(lics.rows[0].name === "رخصة مهن" && lics.rows[0].days_left === -3, "الترتيب بالأقرب انتهاءً وعدّاد الأيام سالب للمنتهي");
ok(lics.rows.find(r => r.name === "شهادة صحية").state === "بينتهي اليوم", "الترخيص اللي بينتهي اليوم مصنّف صح");
ok(lics.rows.find(r => r.name === "سجل تجاري").days_left === 1, "باقي يوم واحد بالضبط");
ok(lics.rows.find(r => r.name === "رخصة سيارة").days_left === 20, "الترخيص البعيد عدّاده 20 يوم");
ok(lics.counts.expired === 1 && lics.counts.soon === 3, "عدّادات المنتهي والقريب");
const warn7 = await call("GET", "/licenses?warn=7");
ok(warn7.counts.soon === 2 && warn7.rows.find(r => r.name === "رخصة سيارة").state === "ساري",
   "مهلة تنبيه 7 أيام بتطلّع اللي بعده 20 يوم برّا التحذير");

const ren = await call("POST", `/licenses/${L1.id}/renew`, { expires_at: plus(365) });
ok(ren.ok && ren.days_left === 365, "تجديد الترخيص حدّث العدّاد");
ok((await call("POST", `/licenses/${L1.id}/renew`, { expires_at: "بكرا" })).error.includes("YYYY-MM-DD"), "تجديد بتاريخ غلط بينرفض");

// (6) العقود
const C1 = await call("POST", "/contracts", { title: "عقد إيجار المستودع", party: "أبو علي", kind: "إيجار",
  starts_at: plus(-300), ends_at: plus(10), notice_days: 60, value: 3600,
  terms: "دفعة كل 3 شهور — إخطار قبل 60 يوم", file_id: up2.id });
ok(C1.ok && C1.days_left === 10, "إضافة عقد مع مهلة تنبيه وبنود");
ok(C1.state === "قرب الانتهاء", "باقي 10 أيام ومهلة التنبيه 60 → قرب الانتهاء");
ok((await call("POST", "/contracts", { title: "بلا نهاية" })).error.includes("إلزامي"), "عقد بلا تاريخ نهاية بينرفض");
ok((await call("POST", "/contracts", { title: "ع", ends_at: plus(5), starts_at: plus(50) })).error.includes("راجع التواريخ"),
   "بداية بعد النهاية بتنرفض");
ok((await call("POST", "/contracts", { title: "ع", ends_at: plus(5), notice_days: 900 })).error.includes("365"),
   "مهلة تنبيه غير منطقية بتنرفض");
ok((await call("POST", "/contracts", { title: "ع", ends_at: plus(5), value: -5 })).error.includes("موجب"), "قيمة عقد سالبة بتنرفض");
const cons = await call("GET", "/contracts");
ok(cons.rows[0].terms.includes("إخطار قبل 60 يوم"), "بنود العقد محفوظة نصّاً");
ok(cons.counts.soon === 1, "عدّاد العقود القريبة");

// (9) الامتثال
await call("POST", "/required", { doc_type: "فواتير" });
await call("POST", "/required", { doc_type: "شهادة صحية", note: "لازمة لوزارة الصحة" });
ok((await call("POST", "/required", {})).error.includes("نوع الوثيقة"), "نوع مطلوب فاضي بينرفض");
const comp = await call("GET", "/compliance");
ok(comp.counts.missing === 1 && comp.missing[0].doc_type === "شهادة صحية",
   "الامتثال بيقول شو النوع المطلوب اللي ما إلو ولا وثيقة");
ok(comp.expired.length === 0, "بعد التجديد ما ضل ترخيص منتهي");
ok(comp.soon.some(r => r.what === "عقد" && r.name === "عقد إيجار المستودع"), "العقد القريب ظاهر بلوحة الامتثال");
ok(comp.soon.some(r => r.what === "ترخيص" && r.name === "شهادة صحية"), "الترخيص اللي بينتهي اليوم ظاهر");
ok(comp.counts.docs === 3, "عدد الوثائق بالأرشيف صحيح");

// (10) تصدير الفهرس
const expRes = await fetch(`http://127.0.0.1:${port}/d/export.csv`);
const expBytes = Buffer.from(await expRes.arrayBuffer());
ok(expBytes[0] === 0xEF && expBytes[1] === 0xBB && expBytes[2] === 0xBF, "التصدير فيه BOM حتى إكسل يقرأ العربي");
const expTxt = expBytes.toString("utf8");
ok(expTxt.includes("كشف رسوم البلدية") && expTxt.includes("صورة السجل التجاري"), "الفهرس فيه كل الوثائق");
ok(/"لا","ما قدرنا نقرأ محتواها/.test(expTxt), "الفهرس بيوضّح الوثيقة اللي ما انقرأ محتواها وسببها");
ok((await (await fetch(`http://127.0.0.1:${port}/d/export.csv?folder=` + encodeURIComponent("مالية"))).text())
     .split("\r\n").length === 2, "تصدير مفلتر بيطلّع صفوفه بس");

// تعديل الوسوم والحذف المحمي
ok((await call("PATCH", `/files/${up1.id}`, { folder: "أرشيف 2026", tags: "بلدية,رسوم,مدفوع" })).ok, "تعديل مجلد الوثيقة ووسومها");
ok((await call("GET", "/files?tag=" + encodeURIComponent("مدفوع"))).count === 1, "الوسم الجديد صار قابل للفلترة");
const delLinked = await call("DELETE", "/files/" + up2.id);
ok(delLinked.ok === false && /مربوطة/.test(delLinked.error), "الوثيقة المربوطة بعقد ما بتنمسح");
ok((await call("DELETE", "/files/" + up1.id)).ok, "الوثيقة غير المربوطة بتنمسح");
ok(db.prepare("SELECT COUNT(*) c FROM docs_access WHERE file_id=?").get(up1.id).c === 0, "سجل وصول الوثيقة المحذوفة انشال معها");
ok((await call("GET", "/files")).count === 2, "الأرشيف صار وثيقتين");

srv.close();

ok(D.slug === "docs" && D.title && D.icon && typeof D.router === "function", "الوحدة بتصدّر slug/title/icon/router");
ok(fs.existsSync("public/features-docs.html"), "صفحة الوثائق موجودة");
ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'docs_%'").all().length === 5,
   "كل جداول الوحدة ببادئة docs_");

wipe();
console.log(`\n${fail ? "🔴" : "🟢"} نجح ${pass} / فشل ${fail}`);
process.exit(fail ? 1 : 0);
