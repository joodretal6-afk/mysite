// ═══════════════════════════════════════════════════════════
// 🧪 اختبار الجرد والمخزون + القارئ الشامل للملفات
//
// بيغطي: قراءة إكسل/CSV/JSON بترميزات مختلفة، مطابقة الأعمدة
// بالعربي والإنجليزي، الرصيد المشتق من الحركات، التغطية،
// الدفعات والصلاحية، التقييم، جلسة الجرد وتسوياتها،
// واستيراد ورقة الجرد من ملف.
// ═══════════════════════════════════════════════════════════
if (!process.env.DB_PATH || /platform\.db/.test(process.env.DB_PATH))
  process.env.DB_PATH = "./data/smoke-stock.db";
if (/platform\.db/.test(process.env.DB_PATH)) {
  console.error("🔴 رفض: الاختبار ما بيشتغل على قاعدة الإنتاج"); process.exit(1);
}
import fs from "node:fs";
const wipe = () => ["", "-wal", "-shm"].forEach(x => { try { fs.rmSync(process.env.DB_PATH + x); } catch {} });
wipe();

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { console.log("❌ " + m); fail++; } };

// ═══════════ القارئ الشامل ═══════════
const { readAnyFile, decodeText, parseDelimited, sniffDelimiter, toTable, matchColumns, num } =
  await import("../src/bot/fileRead.js");

ok(sniffDelimiter("a,b,c\n1,2,3") === ",", "تخمين الفاصلة");
ok(sniffDelimiter("a\tb\tc") === "\t", "تخمين التاب");
ok(sniffDelimiter("a;b;c;d") === ";", "تخمين الفاصلة المنقوطة");

const csvRows = parseDelimited('a,b\n"فيه, فاصلة",2\n"سطر\nجوّا",3');
ok(csvRows.length === 3, "CSV: الأسطر انفصلت صح");
ok(csvRows[1][0] === "فيه, فاصلة", "CSV: الفاصلة جوّا الاقتباس ما كسرت الخانة");
ok(csvRows[2][0] === "سطر\nجوّا", "CSV: سطر جديد جوّا الخانة انحفظ");
ok(parseDelimited('a\n"قال ""مرحبا"""')[1][0] === 'قال "مرحبا"', "CSV: الاقتباس المزدوج انفك صح");

const tbl = toTable([["الصنف", "الكمية"], ["جبنة", "12"]]);
ok(tbl.headers[0] === "الصنف" && tbl.rows[0]["الكمية"] === "12", "فصل العناوين عن البيانات");
ok(toTable([["1", "2"], ["3", "4"]]).headers[0] === "عمود 1", "صف كله أرقام بينعتبر بيانات مش عناوين");

// الترميز: BOM و UTF-8
ok(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("جبنة", "utf8")])) === "جبنة",
   "BOM بينشال والعربي بيطلع سليم");
ok(decodeText(Buffer.from("جبنة نابلسية", "utf8")) === "جبنة نابلسية", "UTF-8 بينقرأ صح");

// مطابقة الأعمدة
const c1 = matchColumns(["اسم الصنف", "الكمية", "سعر التكلفة", "الباركود"]);
ok(c1.name === "اسم الصنف" && c1.qty === "الكمية", "مطابقة الأعمدة بالعربي");
ok(c1.cost === "سعر التكلفة", "«سعر التكلفة» انربط بالتكلفة مش بالسعر");
const c2 = matchColumns(["Product", "QTY", "Unit Cost"]);
ok(c2.name === "Product" && c2.qty === "QTY" && c2.cost === "Unit Cost", "مطابقة الأعمدة بالإنجليزي");
ok(Object.keys(matchColumns(["س١", "س٢"])).length === 0, "أعمدة مش معروفة → ما منخمّن");

// الأرقام
ok(num("1,250.5") === 1250.5, "الفاصلة الألفية بتنشال");
ok(num("١٢") === 12, "الأرقام العربية بتتحوّل");
ok(num("") === null && num("abc") === null, "الخانة الفاضية أو النص = null مش صفر");
ok(num("-3") === -3, "الرقم السالب بينقرأ");

// ملفات فعلية
const csvBuf = Buffer.from("﻿الصنف,الكمية\nجبنة,12\nلبنة,5\n", "utf8");
const f1 = await readAnyFile(csvBuf, "count.csv");
ok(f1.ok && f1.kind === "csv" && f1.table.rows.length === 2, "قراءة ملف CSV عربي");

const jsonBuf = Buffer.from(JSON.stringify([{ الصنف: "جبنة", الكمية: 3 }]), "utf8");
const f2 = await readAnyFile(jsonBuf, "x.json");
ok(f2.ok && f2.table.rows[0]["الكمية"] === 3, "قراءة JSON");

const ExcelJS = (await import("exceljs")).default;
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("جرد");
ws.addRow(["الصنف", "العدد"]); ws.addRow(["جبنة نابلسية", 9]); ws.addRow(["لبنة بلدية", 4]);
const xbuf = Buffer.from(await wb.xlsx.writeBuffer());
const f3 = await readAnyFile(xbuf, "count.xlsx");
ok(f3.ok && f3.kind === "xlsx", "قراءة ملف إكسل");
ok(f3.sheets[0].name === "جرد" && f3.table.rows.length === 2, "أوراق الإكسل وصفوفها");
ok(f3.table.rows[0]["الصنف"] === "جبنة نابلسية", "العربي بالإكسل سليم");

ok((await readAnyFile(Buffer.from(""), "a.csv")).ok === false, "ملف فاضي بينرفض");
const bad1 = await readAnyFile(Buffer.from("%PDF-1.4\n/Encrypt 5 0 R\ntrailer"), "x.pdf");
ok(bad1.ok === false && /كلمة سر/.test(bad1.error), "الـPDF المحمي بكلمة سر بينقال عنه بصراحة");
const bad2 = await readAnyFile(Buffer.from("%PDF-1.4\ntrailer<<>>\n%%EOF"), "x.pdf");
ok(bad2.ok === false && /صورة ممسوحة|نص/.test(bad2.error), "الـPDF الممسوح بينقال عنه بصراحة");
ok((await readAnyFile(Buffer.from("\xD0\xCF\x11\xE0abcd", "latin1"), "old.xls")).error.includes("xlsx"),
   "ملف xls القديم بيعطي إرشاد واضح");

// ═══════════ وحدة الجرد ═══════════
const st = await import("../src/features/stock.js");
await new Promise(r => setTimeout(r, 500));
const { db } = await import("../src/db/database.js");

const mkItem = (name, o = {}) => {
  db.prepare(`INSERT INTO stock_items (name,unit,barcode,cost,price,reorder_point,shelf_life,active,created_at)
              VALUES (?,?,?,?,?,?,?,1,?)`)
    .run(name, o.unit || "حبة", o.barcode || "", o.cost || 0, o.price || 0,
         o.rop || 0, o.life || 0, Date.now());
  return Number(db.prepare("SELECT id FROM stock_items WHERE name=?").get(name).id);
};

const A = mkItem("جبنة نابلسية", { cost: 4, price: 15, rop: 10, barcode: "111" });
const B = mkItem("لبنة بلدية", { cost: 2, price: 8, rop: 5 });
const C = mkItem("زعتر", { cost: 1, price: 5 });

const DAY = 86400000;
st.addMove({ item_id: A, qty: 100, kind: "استلام", batch: "L1",
             expiry: new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10) });
st.addMove({ item_id: A, qty: -30, kind: "بيع", at: Date.now() - 5 * DAY });
st.addMove({ item_id: A, qty: -2, kind: "هدر", note: "كسر" });
st.addMove({ item_id: B, qty: 4, kind: "استلام" });

// (3) الرصيد من الحركات
const oh = st.onHandMap();
ok(oh.get(A) === 68, "الرصيد = مجموع الحركات (100 − 30 − 2)");
ok(oh.get(B) === 4, "رصيد الصنف الثاني");
ok(!oh.has(C), "صنف بلا حركات ما إلو رصيد مخترع");

// (9) التغطية
const vel = st.velocityMap(30);
ok(vel.get(A) === 1, "سرعة البيع = 30 حبة ÷ 30 يوم = 1/يوم");
ok(!vel.has(B), "بلا مبيعات → بلا سرعة (مش صفر ولا تخمين)");

const view = st.itemsView();
const va = view.find(v => v.id === A), vb = view.find(v => v.id === B), vc = view.find(v => v.id === C);
ok(va.cover === 68, "التغطية = 68 يوم");
ok(vb.cover === null, "بلا مبيعات → التغطية «—» مش رقم");
ok(vb.status === "تحت الحد", "رصيد 4 وحد الطلب 5 → تحت الحد");
ok(vc.status === "نفد", "صنف بلا رصيد → نفد");
ok(va.status === "قرب الانتهاء", "دفعة صلاحيتها بعد 10 أيام → قرب الانتهاء");
ok(va.value_cost === 272 && va.value_sale === 1020, "قيمة الصنف بالتكلفة وبالبيع");

// (10) الدفعات
const batches = st.batchRows();
ok(batches.length === 1 && batches[0].batch === "L1", "الدفعة ظاهرة برصيدها");
ok(batches[0].qty === 100, "رصيد الدفعة = اللي دخل فيها");

// حماية المدخلات
let threw = 0;
try { st.addMove({ item_id: A, qty: 0, kind: "استلام" }); } catch { threw++; }
try { st.addMove({ item_id: A, qty: 5, kind: "شي غريب" }); } catch { threw++; }
try { st.addMove({ item_id: 99999, qty: 5, kind: "استلام" }); } catch { threw++; }
try { st.addMove({ item_id: A, qty: 5, kind: "استلام", expiry: "2026/01/01" }); } catch { threw++; }
ok(threw === 4, "الحركة الفاضية أو بنوع غلط أو لصنف مش موجود أو بتاريخ غلط بتنرفض");

// (2) عدم تكرار المستند: مفتاح المرجع فريد
st.addMove({ item_id: A, qty: -5, kind: "بيع", ref_type: "shipment", ref_id: "77" });
let dup = false;
try { st.addMove({ item_id: A, qty: -5, kind: "بيع", ref_type: "shipment", ref_id: "77" }); }
catch { dup = true; }
ok(dup, "نفس المستند ما بينخصم مرتين");
ok(st.onHandMap().get(A) === 63, "الرصيد انخصم مرة وحدة بس");

// (4) جلسة جرد كاملة عبر الراوتر
const express = (await import("express")).default;
const app = express();
app.use("/s", st.router);
const srv = app.listen(0);
const port = srv.address().port;
const call = async (m, p, body) => {
  const r = await fetch(`http://127.0.0.1:${port}/s${p}`, {
    method: m, headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  return r.json();
};

const cnt = await call("POST", "/counts", { name: "جرد اختبار" });
ok(cnt.ok && cnt.id, "فتحت جلسة جرد");
const cv = await call("GET", "/counts/" + cnt.id);
ok(cv.rows.length === 3, "الجلسة ثبّتت كل الأصناف النشطة");
ok(cv.rows.find(r => r.item_id === A).expected === 63, "المتوقّع اتثبّت من الرصيد لحظة الفتح");
ok(cv.summary.pending === 3, "كل الأصناف لسا ما انعدّت");

// استيراد من إكسل — صنف موجود وصنف مش موجود
const wb2 = new ExcelJS.Workbook();
const ws2 = wb2.addWorksheet("عد");
ws2.addRow(["الصنف", "العدد"]);
ws2.addRow(["جبنة نابلسية", 60]);      // نقص 3
ws2.addRow(["لبنة بلدية", 4]);         // مطابق
ws2.addRow(["صنف مش عندي", 9]);        // 🔴 لازم ينترك
const x2 = Buffer.from(await wb2.xlsx.writeBuffer());
const imp = await call("POST", `/counts/${cnt.id}/import`,
  { filename: "c.xlsx", base64: x2.toString("base64") });
ok(imp.ok && imp.applied === 2, "استيراد الجرد طبّق الصنفين الموجودين");
ok(imp.unknown.length === 1 && imp.unknown[0] === "صنف مش عندي",
   "🔴 الصنف اللي مش بالدليل انترك وانبلّغ عنه — ما انضاف من راسه");

const cv2 = await call("GET", "/counts/" + cnt.id);
const lineA = cv2.rows.find(r => r.item_id === A);
ok(lineA.counted === 60 && lineA.variance === -3, "الفرق = المعدود − المتوقّع");
ok(lineA.value === -12, "قيمة الفرق = الفرق × التكلفة");
ok(cv2.summary.shortage === 1 && cv2.summary.exact === 1, "تصنيف النقص والمطابق");
ok(cv2.summary.pending === 1, "الصنف الثالث لسا ما انعدّ");

// الإقفال بلا force لازم ينرفض
const noForce = await call("POST", `/counts/${cnt.id}/close`, {});
ok(noForce.ok === false && /ما انعدّ/.test(noForce.error), "الإقفال بينرفض وفي أصناف ما انعدّت");

const closed = await call("POST", `/counts/${cnt.id}/close`, { force: true });
ok(closed.ok && closed.adjusted === 1, "الإقفال بالقوة رحّل تسوية وحدة (الفرق الوحيد)");
ok(st.onHandMap().get(A) === 60, "الرصيد صار يساوي المعدود بعد التسوية");
const adj = db.prepare("SELECT * FROM stock_moves WHERE kind='تسوية جرد'").all();
ok(adj.length === 1 && adj[0].qty === -3, "التسوية انكتبت كحركة موثّقة مش تعديل صامت");
ok(/جرد #/.test(adj[0].note), "التسوية بتقول من أي جلسة إجت");

const reClose = await call("POST", `/counts/${cnt.id}/close`, { force: true });
ok(reClose.ok === false, "الجلسة المقفلة ما بتنقفل مرتين");
const lineAfter = await call("POST", `/counts/${cnt.id}/line`, { item_id: A, counted: 5 });
ok(lineAfter.ok === false, "الجلسة المقفلة ما بتنعدّل");

// (8) التنبيهات
const al = await call("GET", "/alerts?warn=30");
ok(al.low.some(r => r.item_id === C), "الصنف اللي نفد ظاهر بالتنبيهات");
ok(al.low.find(r => r.item_id === C).suggest === null,
   "بلا مبيعات → ما في كمية مقترحة (بدل رقم مخترع)");
const sugA = al.low.find(r => r.item_id === A);
ok(!sugA || sugA.status !== "نفد", "الصنف اللي رصيده كويس مش بقائمة النفاد");
ok(al.expiring.length === 1, "تنبيه الصلاحية القريبة شغّال");

// (12) التقييم
const val = await call("GET", "/valuation");
ok(val.ok && val.totals.cost === 248, "تقييم المخزون بالتكلفة (60×4 + 4×2)");
ok(val.totals.sale === 932 && val.totals.margin === 684, "الربح الكامن = بالبيع − بالتكلفة");

// (14) كشف الصنف
const led = await call("GET", `/items/${A}/ledger`);
ok(led.ok && led.balance === 60, "كشف الصنف بيطابق الرصيد");
ok(led.rows[0].balance === 60, "الرصيد الجاري محسوب سطر بسطر");

// (1) الصنف اللي إلو حركات ما بينمسح
const delA = await call("DELETE", "/items/" + A);
ok(delA.archived === true, "الصنف اللي إلو تاريخ بينوقف مش بينمسح");
ok(db.prepare("SELECT COUNT(*) c FROM stock_moves WHERE item_id=?").get(A).c > 0, "حركاته محفوظة");

// (15) التصدير
const exp = await fetch(`http://127.0.0.1:${port}/s/export.csv`);
// ملاحظة: fetch().text() بيشيل الـBOM حسب المواصفة، فمنفحص البايتات الخام
const expBytes = Buffer.from(await exp.arrayBuffer());
const expTxt = expBytes.toString("utf8");
ok(expBytes[0] === 0xEF && expBytes[1] === 0xBB && expBytes[2] === 0xBF,
   "التصدير فيه BOM حتى إكسل يقرأ العربي");
ok(expTxt.includes("لبنة بلدية"), "التصدير فيه الأصناف");
const sheet = await (await fetch(`http://127.0.0.1:${port}/s/countsheet.csv`)).text();
ok(sheet.includes("العدد المعدود"), "ورقة الجرد الفارغة فيها خانة العد");

srv.close();

// الوحدة والصفحة
const { loadFeatures } = await import("../src/features/index.js");
const mods = await loadFeatures();
ok(mods.some(m => m.slug === "stock"), "وحدة الجرد مُحمّلة");
ok(fs.existsSync("public/features-stock.html"), "صفحة الجرد موجودة");

wipe();
console.log(`\n${fail ? "🔴" : "🟢"} نجح ${pass} / فشل ${fail}`);
process.exit(fail ? 1 : 0);
