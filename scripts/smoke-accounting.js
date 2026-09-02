// ═══════════════════════════════════════════════════════════
// 🧪 اختبار المحاسبة والأحمال
// بيبني ملف PDF حقيقي بنفس شكل كشف الدفع عند الاستلام،
// بيقرأه بمحلّلنا، وبيتأكد إنّ:
//  • البوليصات والمبالغ طلعت صح
//  • 15 = حبة و27 = حبتين (من جدول التسعير، مش تخمين)
//  • مبلغ مش بالجدول = "غير معروف" مش رقم مخترع
//  • النظام بيستنتج عدد الحبّات لحاله من النمط (39 = 3 حبّات)
//  • مبلغ 0 وأجرة 0 → عدد 0 وصافي 0
//  • مبلغ 0 وأجرة -1.75 → رفض عند الاستلام، عدد 0، صافي -1.75
//  • الحسابات (إجمالي/أجور/صافي) مضبوطة للقرش
// ═══════════════════════════════════════════════════════════
if (!process.env.DB_PATH || /platform\.db/.test(process.env.DB_PATH))
  process.env.DB_PATH = "./data/smoke-acc.db";
if (/platform\.db/.test(process.env.DB_PATH)) {
  console.error("🔴 رفض: الاختبار ما بيشتغل على قاعدة الإنتاج"); process.exit(1);
}
import fs from "node:fs";
import zlib from "node:zlib";
const wipe = () => ["", "-wal", "-shm"].forEach(x => { try { fs.rmSync(process.env.DB_PATH + x); } catch {} });
wipe();

const { pdfToText, parseCodStatement, numericTokens } = await import("../src/bot/pdfText.js");

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { console.log("❌ " + m); fail++; } };

// ── نبني PDF فعلي (مضغوط FlateDecode) بنفس نمط الكشف: مبلغ ثم بوليصة ──
function buildPdf(pairs) {
  const ops = pairs.map(([amt, trk, fee]) =>
    `BT /F1 10 Tf 40 700 Td (${amt}) Tj ET` +
    (fee === undefined ? "" : ` BT /F1 10 Tf 120 700 Td (${fee}) Tj ET`) +
    ` BT /F1 10 Tf 200 700 Td (${trk}) Tj ET`).join("\n");
  const stream = zlib.deflateSync(Buffer.from(ops, "latin1"));
  const chunks = [];
  const push = (s) => chunks.push(Buffer.isBuffer(s) ? s : Buffer.from(s, "latin1"));
  push("%PDF-1.4\n");
  push("1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n");
  push("2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n");
  push("3 0 obj<</Type/Page/Parent 2 0 R/Contents 4 0 R>>endobj\n");
  push(`4 0 obj<</Length ${stream.length}/Filter/FlateDecode>>stream\n`);
  push(stream);
  push("\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
  return Buffer.concat(chunks);
}

// [مبلغ التحصيل، رقم البوليصة، أجرة التوصيل كما بالكشف]
const PAIRS = [
  ["15", "100506548034", "-1.75"],   // حبة، تحصّلت
  ["15", "100506548218", "-1.75"],   // حبة، تحصّلت
  ["27", "100506546382", "-1.75"],   // حبتين، تحصّلت
  ["0",  "100506548126", "-1.75"],   // 🔴 رفض عند الاستلام — دفعنا التوصيل
  ["0",  "100506599001", "0"],       // ما وصل ولا كلّفنا شي
  ["39", "100506542049", "-1.75"],   // 3 حبّات — بالنمط مش بالجدول
  ["12", "100506078173", "-1.75"]    // مبلغ ما بينطبق عليه نمط → غير معروف
];
const pdf = buildPdf(PAIRS);

// ── 1) قراءة النص ──
const t = pdfToText(pdf);
ok(t.ok, "قراءة الـPDF نجحت");
ok(t.streams >= 1, "لقينا مجرى نص واحد على الأقل");
ok(numericTokens(t.segments).length >= 14, "استخرجنا كل الأرقام من الملف");
ok(numericTokens(t.segments).includes("-1.75"), "الأجرة السالبة -1.75 انقرأت بإشارتها");

// رفض ملف مش PDF
ok(pdfToText(Buffer.from("hello world")).ok === false, "ملف مش PDF بينرفض بدل ما ينهار");

// ── 2) تحليل الكشف ──
const { rows } = parseCodStatement(t.segments, { feeRate: 1.75 });
ok(rows.length === PAIRS.length, `عدد البوليصات = ${PAIRS.length}`);
ok(rows.every((r, i) => r.tracking === PAIRS[i][1]), "أرقام البوليصات طلعت بالترتيب وصح");
ok(rows.every((r, i) => r.amount === Number(PAIRS[i][0])), "المبالغ انربطت بالبوليصة الصح");
ok(rows.filter((r, i) => PAIRS[i][2] === "-1.75").every(r => r.fee === -1.75),
   "عمود أجرة التوصيل انفصل عن المبلغ وانقرأ بإشارته");
ok(rows[4].fee === null, "أجرة 0 مش مقدارها 1.75 فما بتنحسب كعمود أجرة — والحساب بيرجع للقاعدة");

// تكرار البوليصة ما بينحسب مرتين
const dup = parseCodStatement(pdfToText(buildPdf([...PAIRS, ["15", "100506548034", "-1.75"]])).segments, { feeRate: 1.75 });
ok(dup.rows.length === PAIRS.length, "البوليصة المكرّرة ما بتنحسب مرتين");

// ── 3) استنتاج عدد الحبّات والحسابات ──
const { enrichRow, summarize, buildModel, derivePieces } = await import("../src/features/accounting.js");
await new Promise(r => setTimeout(r, 500));

const map = new Map([[15, { pieces: 1, product: "" }], [27, { pieces: 2, product: "" }]]);
const RATE = 1.75;

// النموذج الخطّي: سعر الحبة الأولى 15 والخطوة 12
const model = buildModel(map);
ok(model && model.base === 15 && model.step === 12, "النظام استنتج النمط لحاله: 15 + 12 لكل حبة زيادة");
ok(derivePieces(39, map, model).pieces === 3, "39 دينار = 3 حبّات (استنتاج، مش إدخال يدوي)");
ok(derivePieces(51, map, model).pieces === 4, "51 دينار = 4 حبّات");
ok(derivePieces(39, map, model).basis.includes("نمط"), "الصف بيحمل معه أساس الاستنتاج");
ok(derivePieces(12, map, model).pieces === null, "12 دينار ما بينطبق عليه النمط → غير معروف");
ok(buildModel(new Map([[15, { pieces: 1 }]])) === null, "نقطة وحدة ما بتكفي لبناء نمط");
ok(buildModel(new Map([[15, { pieces: 1 }], [27, { pieces: 2 }], [50, { pieces: 3 }]])) === null,
   "نمط غير منتظم بينرفض بدل ما يخمّن");

const enriched = rows.map(r => enrichRow(r, map, RATE, model));

ok(enriched[0].pieces === 1, "15 دينار = حبة واحدة");
ok(enriched[2].pieces === 2, "27 دينار = حبتين");
ok(enriched[5].pieces === 3, "39 دينار = 3 حبّات بالكشف الفعلي");
ok(enriched[6].pieces === null, "المبلغ اللي ما إلو أساس بيضل غير معروف");

ok(enriched[0].fee === 1.75, "أجرة التوصيل انقرأت من الكشف كتكلفة موجبة");
ok(enriched[0].net === 13.25, "صافي طرد الـ15 = 13.25");
ok(enriched[2].net === 25.25, "صافي طرد الـ27 = 25.25");

// 🔴 القاعدتين اللي طلبهم صاحب المشروع بالحرف
ok(enriched[4].state === "ملغي بلا تكلفة", "مبلغ 0 وأجرة 0 → ما كلّفنا شي");
ok(enriched[4].pieces === 0, "مبلغ 0 وأجرة 0 → العدد صفر");
ok(enriched[4].net === 0, "مبلغ 0 وأجرة 0 → الصافي صفر");

ok(enriched[3].state === "رفض عند الاستلام", "مبلغ 0 وأجرة 1.75 → الزبون رفض عند الباب");
ok(enriched[3].pieces === 0, "الطرد المرفوض عدده صفر");
ok(enriched[3].fee === 1.75, "الطرد المرفوض كلّفنا أجرة التوصيل");
ok(enriched[3].net === -1.75, "🔴 الطرد المرفوض صافيه بالسالب — خسارة فعلية بتبين");

// ── 4) الملخّص ──
const s2 = summarize(enriched);
ok(s2.count === 7, "عدد الصفوف بالملخّص = 7");
ok(s2.gross === 108, "إجمالي التحصيل = 108");
ok(s2.delivered === 5, "5 طرود مُحصّلة");
ok(s2.refused === 1, "طرد واحد مرفوض عند الاستلام");
ok(s2.cancelled === 1, "طرد واحد ملغي بلا تكلفة");
ok(s2.lost === 1.75, "🔴 الخسارة الصافية = 1.75 (توصيل الطرد المرفوض)");
ok(s2.fees === 6 * RATE, "الأجور = 6 طرود × 1.75 (الملغي بلا أجرة)");
ok(s2.net === Math.round((108 - 6 * RATE) * 100) / 100, "الصافي = الإجمالي − الأجور");
ok(s2.pieces === 7, "مجموع الحبّات = 1+1+2+3 = 7");
ok(s2.unknown === 1, "مبلغ واحد بس بلا أساس");

// ── 4.5) قراءة الكشف كامل: صفحة صفحة وحساب حساب ──
const { clientNameFrom, arNormalize, parseCodStatementByClient,
        detectTrackingLength, statedTotals } = await import("../src/bot/pdfText.js");

// أشكال العرض العربية (زي ما بتطلع من الـPDF) لازم ترجع حروف عادية
ok(arNormalize("ﺍﺳﻢ ﺍﻟﺰﺑﻮﻥ") === "اسم الزبون", "أشكال العرض العربية بترجع حروف عادية");

ok(clientNameFrom(["ﺍﺳﻢ ﺍﻟﺰﺑﻮﻥ: ﺍﺟﺒﺎﻥ ﻏﺰﺓ ﺟﺪﻳﺪ"]) === "اجبان غزة جديد",
   "استخراج اسم الحساب من نفس المقطع");
ok(clientNameFrom(["اسم الزبون:", "ريفان"]) === "ريفان", "استخراج الاسم من المقطع اللي بعده");
ok(clientNameFrom(["كشف تحصيل", "المجموع 120"]) === "", "بلا عنوان حساب → ما منخترع اسم");

// كشف من 3 صفحات: أول صفحتين لحساب، والثالثة لحساب تاني
const P1 = ["اسم الزبون: اجبان غزة جديد", "15", "-1.75", "100500000001"];
const P2 = ["27", "-1.75", "100500000002"];                       // امتداد نفس الحساب
const P3 = ["اسم الزبون: ريفان", "39", "-1.75", "100500000003", "0", "-1.75", "100500000004"];
const g = parseCodStatementByClient([P1, P2, P3], { feeRate: 1.75 });

ok(g.pages.length === 3, "قرا الصفحات الثلاثة كلها");
ok(g.pages[1].client === "اجبان غزة جديد", "الحساب بيمتد للصفحة اللي بعدها لمّا ما فيها عنوان");
ok(g.clients.length === 2, "فصل الكشف لحسابين");
const gaza = g.clients.find(c => c.client === "اجبان غزة جديد");
const reefan = g.clients.find(c => c.client === "ريفان");
ok(gaza && gaza.rows.length === 2, "حساب اجبان غزة إلو بوليصتين");
ok(gaza && gaza.pages.join() === "1,2", "بوليصاته موزّعة على صفحتين");
ok(reefan && reefan.rows.length === 2, "حساب ريفان إلو بوليصتين");
ok(gaza.rows.every(r => r.page_no >= 1), "كل بوليصة بتحمل رقم صفحتها");

const gazaSum = summarize(gaza.rows.map(r => enrichRow(r, map, RATE, model)));
const reefanSum = summarize(reefan.rows.map(r => enrichRow(r, map, RATE, model)));
ok(gazaSum.gross === 42, "تحصيل اجبان غزة لحاله = 42");
ok(reefanSum.gross === 39, "تحصيل ريفان لحاله = 39");
ok(reefanSum.refused === 1 && reefanSum.lost === 1.75, "رفض ريفان محسوب على حسابه هو مش على غيره");

// ── الملف اللي فيه خريطة ToUnicode بيطلع عربي مقروء ──
function pdfWithCMap() {
  const cmapTxt = `/CIDInit /ProcSet findresource begin
1 begincodespacerange <0000> <FFFF> endcodespacerange
2 beginbfchar <0003> <0631> <0004> <064A> endbfchar
1 beginbfrange <0010> <0012> <0641> endbfrange
endcmap end`;
  const content = "BT /F1 10 Tf 40 700 Td <0003 0004 0010> Tj ET";
  const c1 = zlib.deflateSync(Buffer.from(cmapTxt, "latin1"));
  const c2 = zlib.deflateSync(Buffer.from(content, "latin1"));
  const chunks = [];
  const push = (x) => chunks.push(Buffer.isBuffer(x) ? x : Buffer.from(x, "latin1"));
  push("%PDF-1.4\n");
  push(`5 0 obj<</Length ${c1.length}/Filter/FlateDecode>>stream\n`); push(c1); push("\nendstream endobj\n");
  push(`4 0 obj<</Length ${c2.length}/Filter/FlateDecode>>stream\n`); push(c2); push("\nendstream endobj\n%%EOF");
  return Buffer.concat(chunks);
}
const uni = pdfToText(pdfWithCMap());
ok(uni.arabic === true, "خريطة ToUnicode فكّت العربي وطلع مقروء");
ok(uni.text.includes("ر") && uni.text.includes("ي"), "bfchar انفكّ صح (ر، ي)");
ok(uni.text.includes("ف"), "bfrange انفك صح (ف)");
ok(pdfToText(pdf).arabic === false, "ملف بلا عربي بيتبلّغ عنه بصراحة مش بيتخيّل");

// ── 4.7) 🔴 العلة اللي كانت بتضيّع بوليصات ──
// مصفوفة TJ بتقسّم النص لقطع عشان تباعد الحروف. لو حسبنا كل
// قطعة لحالها، رقم البوليصة ما بيصير 12 خانة فبتضيع البوليصة.
function pdfWithSplitTJ() {
  // نفس الصفوف بس البوليصة مقسّمة لقطعتين جوّا نفس عامل TJ
  const ops = [
    ["15", "1005", "06548034"], ["27", "10050", "6546382"], ["39", "100506", "542049"]
  ].map(([amt, a, b]) =>
    `BT /F1 10 Tf 40 700 Td [(${amt})] TJ ET BT /F1 10 Tf 120 700 Td [(-1.75)] TJ ET` +
    ` BT /F1 10 Tf 200 700 Td [(${a})-18(${b})] TJ ET`).join("\n");
  const st = zlib.deflateSync(Buffer.from(ops, "latin1"));
  const c = [];
  const push = (x) => c.push(Buffer.isBuffer(x) ? x : Buffer.from(x, "latin1"));
  push("%PDF-1.4\n");
  push(`4 0 obj<</Length ${st.length}/Filter/FlateDecode>>stream\n`); push(st);
  push("\nendstream endobj\n%%EOF");
  return Buffer.concat(c);
}
const split = pdfToText(pdfWithSplitTJ());
const splitRows = parseCodStatement(split.segments, { feeRate: 1.75 }).rows;
ok(splitRows.length === 3, "🔴 البوليصة المقسّمة بتباعد الحروف ما عادت تضيع — طلعت الثلاثة");
ok(splitRows[0].tracking === "100506548034", "قطع الـTJ انلزقت ورجّعت رقم البوليصة كامل");
ok(splitRows[2].amount === 39 && splitRows[2].fee === -1.75, "المبلغ والأجرة انربطوا صح مع البوليصة الملزوقة");

// أرقام تباعد الحروف جوّا TJ ما بتنحسب كمبالغ
ok(splitRows.every(r => r.amount !== 18 && r.amount !== -18),
   "أرقام التباعد جوّا مصفوفة TJ ما بتنقرأ كمبالغ");

// التشخيص بيقول شو صار بالضبط
ok(split.stats && split.stats.streams_found >= 1, "التشخيص بيعدّ المجاري اللي لقيناها");
ok(split.stats.streams_decoded >= 1, "التشخيص بيعدّ المجاري اللي انفكّت");

// مجرى مقطوع/تالف بيرجّع اللي انفك منه بدل ما تضيع الصفحة كلها
const full = zlib.deflateSync(Buffer.from("BT /F1 10 Tf (100506548034) Tj ET BT (15) Tj ET", "latin1"));
const cut = full.subarray(0, full.length - 3);
const cutPdf = Buffer.concat([
  Buffer.from(`%PDF-1.4\n4 0 obj<</Length ${cut.length}/Filter/FlateDecode>>stream\n`, "latin1"),
  cut, Buffer.from("\nendstream endobj\n%%EOF", "latin1")]);
ok(pdfToText(cutPdf).text.includes("100506548034"),
   "🔴 المجرى المقطوع ما عاد يضيّع الصفحة — منرجّع اللي انفك منه");

// ── 4.8) 🔴 كشف بنفس بنية الكشف الحقيقي بالضبط ──
// (بيانات مخترعة — الكشف الحقيقي فيه أسماء وهواتف زبائن
//  والريبو عام، فما بينحفظ. البنية هي هي: خط CID مقصوص،
//  الأرقام كسلاسل عادية مش سداسية، هواتف 10 خانات، تواريخ،
//  وثلاثة أعمدة مال: السعر والأجرة والإجمالي.)
function cidPdf(pages) {
  // منبني خريطة ToUnicode لكل حرف مستعمل بالملف — تماماً زي
  // ما بتعمل شركة التوصيل بخطها المقصوص
  const chars = [...new Set(pages.flat().join("").split(""))];
  const code = new Map();
  chars.forEach((ch, i) => code.set(ch, 0x13 + i));
  const hex4 = (n) => n.toString(16).padStart(4, "0");
  const uni = (ch) => ch.charCodeAt(0).toString(16).padStart(4, "0");
  const cmapTxt = `/CIDInit /ProcSet findresource begin
1 begincodespacerange <0000> <FFFF> endcodespacerange
${chars.length} beginbfchar ${chars.map((c) => `<${hex4(code.get(c))}> <${uni(c)}>`).join(" ")} endbfchar
endcmap end`;

  // نص → سلسلة PDF عادية بترميز CID 2-بايت (زي الكشف الحقيقي).
  // العربي بينكتب معكوساً — بترتيب العرض زي ما بيحفظه الـPDF.
  const cid = (txt) => {
    // بترتيب العرض بينعكس العربي بس — الأرقام بتضل بترتيبها
    const hasAr = /[؀-ۿ]/.test(txt);
    const t = hasAr
      ? String(txt).split(/(\d+(?:\.\d+)?)/).filter(x => x !== "").reverse()
          .map(x => /^\d/.test(x) ? x : [...x].reverse().join("")).join("")
      : String(txt);
    let out = "";
    for (const ch of t) {
      const c = code.get(ch) ?? 0x03;
      out += "\\000" + "\\" + c.toString(8).padStart(3, "0");
    }
    return out;
  };

  const chunks = [];
  const push = (x) => chunks.push(Buffer.isBuffer(x) ? x : Buffer.from(x, "latin1"));
  push("%PDF-1.4\n");
  const c1 = zlib.deflateSync(Buffer.from(cmapTxt, "latin1"));
  push(`9 0 obj<</Length ${c1.length}/Filter/FlateDecode>>stream\n`); push(c1); push("\nendstream endobj\n");

  pages.forEach((segs, i) => {
    const ops = segs.map((t) => `BT /F1 10 Tf 40 700 Td (${cid(t)}) Tj ET`).join("\n");
    const c = zlib.deflateSync(Buffer.from(ops, "latin1"));
    push(`${20 + i} 0 obj<</Length ${c.length}/Filter/FlateDecode>>stream\n`); push(c); push("\nendstream endobj\n");
  });
  push("%%EOF");
  return Buffer.concat(chunks);
}

// صف كامل زي الكشف: السعر، الأجرة، الإجمالي، هاتف، هاتف، تاريخ، بوليصة
const rowOf = (price, fee, trk) => {
  const net = Math.round((price - fee) * 100) / 100;
  return [String(price), String(fee), String(net), "0772441092", "0772441092", "20/08/26", trk];
};

const REAL = cidPdf([
  ["57 :مجموع التحصيل", "5.25 :مجموع سعر التوصيل", "اسم الزبون: اجبان غزة جديد",
   ...rowOf(15, 1.75, "100506548034"), ...rowOf(27, 1.75, "100506546382"),
   ...rowOf(15, 1.75, "100506542810"), "0", "0", "0", "0772441092", "20/08/26", "100506548126"],
  ["34 :مجموع التحصيل", "3.5 :مجموع سعر التوصيل", "اسم الزبون: ريفان",
   ...rowOf(17, 1.75, "100506585398"), ...rowOf(17, 1.75, "100506585848")]
]);

const rp = pdfToText(REAL);
ok(rp.ok && rp.pages.length === 2, "كشف بخط CID: الصفحتين انقرأوا");
ok(rp.text.includes("100506548034"), "🔴 الأرقام المكتوبة كسلسلة عادية بخط CID انفكّت — هون كانت العلة الكبرى");

ok(detectTrackingLength(rp.segments) === 12, "النظام تعرّف على طول رقم البوليصة (12) من الملف نفسه");

const rg = parseCodStatementByClient(rp.pages, { feeRate: 1.75 });
const allRows = rg.clients.flatMap(c => c.rows);
ok(allRows.length === 6, "🔴 كل الطرود طلعت (6) — الهواتف والتواريخ ما انحسبوا بوليصات");
ok(!allRows.some(r => r.tracking.startsWith("07")), "رقم الهاتف ما بينحسب رقم بوليصة");

// العلاقة: التحصيل = الإجمالي + الأجرة — هيك منعرف مين السعر
const byTrk = Object.fromEntries(allRows.map(r => [r.tracking, r]));
ok(byTrk["100506548034"].amount === 15, "🔴 عمود السعر (15) انختار مش الإجمالي (13.25)");
ok(byTrk["100506546382"].amount === 27, "طرد الحبتين: السعر 27 مش 25.25");
ok(byTrk["100506548126"].amount === 0 && byTrk["100506548126"].fee === null,
   "الطرد اللي كل خاناته صفر: مبلغ 0 وبلا عمود أجرة");
ok(allRows.every(r => r.amount !== 20 && r.amount !== 26), "أرقام التاريخ ما انحسبت مبالغ");

// ✅ التحقق الذاتي مقابل مجاميع الكشف
ok(rg.stated.collection === 91, "قرينا «مجموع التحصيل» من ترويسة الصفحات (57+34)");
ok(rg.stated.delivery === 8.75, "قرينا «مجموع سعر التوصيل» (5.25+3.5)");
const ourGross = allRows.reduce((a, r) => a + r.amount, 0);
const ourFees = allRows.reduce((a, r) => a + Math.abs(r.fee || 0), 0);
ok(ourGross === rg.stated.collection, "✅ مجموعنا يطابق مجموع الكشف بالضبط — دليل إنّ ما ضاع صف");
ok(ourFees === rg.stated.delivery, "✅ مجموع الأجور يطابق الكشف كمان");

// ── 5) الجداول انبنت والوحدة مركّبة ──
const { db } = await import("../src/db/database.js");
for (const tbl of ["acc_shipments", "acc_statements", "acc_rows", "acc_pricing", "acc_settings"]) {
  let exists = false;
  try { db.prepare(`SELECT 1 FROM ${tbl} LIMIT 1`).all(); exists = true; } catch { exists = false; }
  ok(exists, `جدول ${tbl} موجود`);
}
const seeded = db.prepare("SELECT pieces FROM acc_pricing WHERE amount=15").get();
ok(Number(seeded?.pieces) === 1, "التسعير المبدئي 15 = حبة انزرع بالقاعدة");
const seed27 = db.prepare("SELECT pieces FROM acc_pricing WHERE amount=27").get();
ok(Number(seed27?.pieces) === 2, "التسعير المبدئي 27 = حبتين انزرع بالقاعدة");

// ── 6) التعلّم من طلبات البوت الحقيقية ──
const { learnPricingFromOrders } = await import("../src/features/accounting.js");
const now = Date.now();
const insOrd = db.prepare(`INSERT INTO orders (page_id,page_name,sender_id,order_string,total,area,phone,status,created_at)
                           VALUES ('p','ص','u',?,?,'','','جديد',?)`);
insOrd.run("جبنة (3)", 39, now);
insOrd.run("جبنة (3)", 39, now);
insOrd.run("لبنة (5)", 63, now);
insOrd.run("جبنة (2) + لبنة (2)", 44, now);   // نفس المبلغ باختلاف
insOrd.run("جبنة (4)", 44, now);              // ⇒ تعارض: 4 مقابل 4؟ لا — 4 و4 متطابقين
const learn = learnPricingFromOrders();
const got = (a) => learn.learned.find(x => x.amount === a);
ok(got(39) && got(39).pieces === 3, "تعلّم من طلبات حقيقية: 39 د = 3 حبّات (نفس ما استنتجه النمط)");
ok(got(63) && got(63).pieces === 5, "تعلّم من طلبات حقيقية: 63 د = 5 حبّات");
const conflict44 = learn.conflicts.find(c => c.amount === 44);
ok(!conflict44, "44 د متّفق عليه (4 حبّات بالطلبتين) فما في تعارض");
insOrd.run("جبنة (9)", 63, now);
const learn2 = learnPricingFromOrders();
ok(learn2.learned.every(x => x.amount !== 63), "المبلغ المتعلَّم سابقاً ما بينكتب فوقه");

const { loadFeatures } = await import("../src/features/index.js");
const mods = await loadFeatures();
ok(mods.some(m => m.slug === "accounting"), "وحدة المحاسبة مُحمّلة مع باقي الوحدات");
ok(fs.existsSync("public/features-accounting.html"), "صفحة المحاسبة موجودة");

wipe();
console.log(`\n${fail ? "🔴" : "🟢"} نجح ${pass} / فشل ${fail}`);
process.exit(fail ? 1 : 0);
