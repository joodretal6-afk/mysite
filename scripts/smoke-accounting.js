// ═══════════════════════════════════════════════════════════
// 🧪 اختبار المحاسبة والأحمال
// بيبني ملف PDF حقيقي بنفس شكل كشف الدفع عند الاستلام،
// بيقرأه بمحلّلنا، وبيتأكد إنّ:
//  • البوليصات والمبالغ طلعت صح
//  • 15 = حبة و27 = حبتين (من جدول التسعير، مش تخمين)
//  • مبلغ مش بالجدول = "غير معروف" مش رقم مخترع
//  • أجرة 1.75 بتنخصم من المُحصّل وما بتنخصم من المرتجع
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
  const ops = pairs.map(([amt, trk]) =>
    `BT /F1 10 Tf 40 700 Td (${amt}) Tj ET BT /F1 10 Tf 200 700 Td (${trk}) Tj ET`).join("\n");
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

const PAIRS = [
  ["15", "100506548034"], ["15", "100506548218"], ["27", "100506546382"],
  ["0",  "100506548126"], ["17", "100506542049"], ["12", "100506078173"]
];
const pdf = buildPdf(PAIRS);

// ── 1) قراءة النص ──
const t = pdfToText(pdf);
ok(t.ok, "قراءة الـPDF نجحت");
ok(t.streams >= 1, "لقينا مجرى نص واحد على الأقل");
ok(numericTokens(t.segments).length >= 12, "استخرجنا كل الأرقام من الملف");

// رفض ملف مش PDF
ok(pdfToText(Buffer.from("hello world")).ok === false, "ملف مش PDF بينرفض بدل ما ينهار");

// ── 2) تحليل الكشف ──
const { rows } = parseCodStatement(t.segments);
ok(rows.length === PAIRS.length, `عدد البوليصات = ${PAIRS.length}`);
ok(rows.every((r, i) => r.tracking === PAIRS[i][1]), "أرقام البوليصات طلعت بالترتيب وصح");
ok(rows.every((r, i) => r.amount === Number(PAIRS[i][0])), "المبالغ انربطت بالبوليصة الصح");

// تكرار البوليصة ما بينحسب مرتين
const dup = parseCodStatement(pdfToText(buildPdf([...PAIRS, ["15", "100506548034"]])).segments);
ok(dup.rows.length === PAIRS.length, "البوليصة المكرّرة ما بتنحسب مرتين");

// ── 3) التسعير والحسابات ──
const { enrichRow, summarize } = await import("../src/features/accounting.js");
await new Promise(r => setTimeout(r, 500));

const map = new Map([[15, { pieces: 1, product: "" }], [27, { pieces: 2, product: "" }]]);
const RATE = 1.75;
const enriched = rows.map(r => enrichRow(r, map, RATE));

ok(enriched[0].pieces === 1, "15 دينار = حبة واحدة");
ok(enriched[2].pieces === 2, "27 دينار = حبتين");
ok(enriched[4].pieces === null, "17 دينار مش بالجدول → غير معروف (بلا اختراع)");
ok(enriched[5].pieces === null, "12 دينار مش بالجدول → غير معروف (بلا اختراع)");

ok(enriched[0].fee === 1.75, "أجرة التوصيل 1.75 بتنخصم من الطرد المُحصّل");
ok(enriched[0].net === 13.25, "صافي طرد الـ15 = 13.25");
ok(enriched[2].net === 25.25, "صافي طرد الـ27 = 25.25");

ok(enriched[3].state === "مرتجع", "مبلغ 0 = مرتجع");
ok(enriched[3].fee === 0, "المرتجع ما بتنخصم عليه أجرة");
ok(enriched[3].net === 0, "صافي المرتجع صفر");

// ── 4) الملخّص ──
const s = summarize(enriched);
const gross = PAIRS.reduce((a, [x]) => a + Number(x), 0);      // 86
ok(s.count === 6, "عدد الصفوف بالملخّص = 6");
ok(s.gross === gross, `إجمالي التحصيل = ${gross}`);
ok(s.returned === 1 && s.delivered === 5, "تصنيف المُحصّل والمرتجع صحيح");
ok(s.fees === 5 * RATE, "مجموع الأجور = عدد المُحصّل × 1.75");
ok(s.net === Math.round((gross - 5 * RATE) * 100) / 100, "الصافي = الإجمالي − الأجور");
ok(s.pieces === 4, "مجموع القطع المعروفة = 4 (حبة + حبة + حبتين)");
ok(s.unknown === 2, "مبلغان مُحصّلان بلا تسعير محسوبين كغير معروف (المرتجع مستثنى)");

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

const { loadFeatures } = await import("../src/features/index.js");
const mods = await loadFeatures();
ok(mods.some(m => m.slug === "accounting"), "وحدة المحاسبة مُحمّلة مع باقي الوحدات");
ok(fs.existsSync("public/features-accounting.html"), "صفحة المحاسبة موجودة");

wipe();
console.log(`\n${fail ? "🔴" : "🟢"} نجح ${pass} / فشل ${fail}`);
process.exit(fail ? 1 : 0);
