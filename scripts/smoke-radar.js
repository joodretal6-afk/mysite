// اختبار رادار السوق. البحث الشبكي مستثنى (بطيء ومعتمد على الشبكة)،
// والتركيز على المنطق: الدرجة، التراكم، الحركة، والصراحة بالنواقص.

// 🔴 حارس: ممنوع الاختبار يلمس قاعدة الإنتاج.
// غلطة سابقة: كنا نضبط DB_FILE والقاعدة بتقرأ DB_PATH — فكل الاختبارات
// كتبت بيانات وهمية بقاعدة حقيقية. الحارس هون عشان ما تتكرر.
if (!process.env.DB_PATH || /platform\.db/.test(process.env.DB_PATH)) {
  process.env.DB_PATH = "./data/smoke-" + (import.meta.url.match(/smoke-([a-z-]+)\.js/) || [,"test"])[1] + ".db";
}
if (/platform\.db/.test(process.env.DB_PATH)) {
  console.error("🔴 رفض: الاختبار ما بيشتغل على قاعدة الإنتاج"); process.exit(1);
}
process.env.DB_PATH = process.env.DB_PATH || "./data/smoke-radar.db";
import fs from "node:fs";
import express from "express";
// SQLite بوضع WAL بيكتب ملفات جانبية — لازم تنحذف كلها وإلا بتضل بيانات التشغيل السابق
const wipe = () => ["", "-wal", "-shm"].forEach(x => {
  try { fs.rmSync(process.env.DB_PATH + x); } catch {}
});
wipe();

await import("../src/db/database.js");
await new Promise(r => setTimeout(r, 1200));

const R = await import("../src/venture/radar.js");
let fail = 0;
const ok = (c, m) => { if (c) console.log("✅ " + m); else { console.log("❌ " + m); fail++; } };
const dayOf = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

console.log("── قائمة المراقبة ──");
const w1 = R.addTerm("لبنة بلدية");
const w2 = R.addTerm("عسل سدر");
ok(w1 && w1.id, `إضافة صنف (id=${w1.id})`);
ok(w1.category === "dairy_fresh", "الفئة انتقت تلقائياً: ألبان");
R.addTerm("لبنة بلدية");
ok(R.watchlist(true).length === 2, "الإضافة المكررة ما بتضاعف الصف");

console.log("\n── الدرجة: مدة الإعلان أقوى مكوّن ──");
const base = { watch_id: w1.id, web_results: 20, fb_pages: 5, shops: 4,
               price_low: 2, price_high: 5, signals: {} };
const s60 = R.scoreSnapshot({ ...base, advertisers: 3, max_days: 60, variations: 12 });
const s30 = R.scoreSnapshot({ ...base, advertisers: 3, max_days: 30, variations: 12 });
const s5  = R.scoreSnapshot({ ...base, advertisers: 3, max_days: 5,  variations: 12 });
ok(s60.score > s30.score && s30.score > s5.score,
   `60ي(${s60.score}) > 30ي(${s30.score}) > 5ي(${s5.score})`);
ok(s60.complete && s60.parts.some(p => p.الوزن === 0.40),
   "مدة الإعلان وزنها 40% — أعلى مكوّن");

console.log("\n── الصراحة بالدرجة الناقصة ──");
const partial = R.scoreSnapshot({ ...base, advertisers: -1, max_days: -1, variations: -1 });
ok(!partial.complete, "بلا رصد إعلانات ⇒ الدرجة معلّمة ناقصة");
ok(partial.note.startsWith("⚠️") && partial.note.includes("60%"),
   "وبيقول صراحة إنه 60% من الدرجة ناقصة");
ok(partial.score > 0 && partial.score <= 100,
   `وبيرجّع درجة من المتوفّر فقط (${partial.score}) بدل ما يصفّر`);

console.log("\n── المنافسة: قليل المعلنين أفضل من مشبع ──");
const few = R.scoreSnapshot({ ...base, advertisers: 3, max_days: 30, variations: 5 });
const many = R.scoreSnapshot({ ...base, advertisers: 40, max_days: 30, variations: 5 });
ok(few.score > many.score, `3 معلنين(${few.score}) > 40 معلن(${many.score}) — السوق المشبع أصعب`);
const none = R.scoreSnapshot({ ...base, advertisers: 0, max_days: 0, variations: 0 });
ok(none.parts.find(p => p.المكوّن === "عدد المعلنين").السبب.includes("بكر"),
   "صفر معلنين: بيوضّح إنها إما فرصة بكر أو ما في طلب");

console.log("\n── التراكم والحركة ──");
// سلسلة صاعدة على 20 يوم
for (let i = 20; i >= 0; i--) {
  R.saveSnapshot({ watch_id: w1.id, web_results: 8 + (20 - i), fb_pages: 3, shops: 2,
    price_low: 2, price_high: 5, signals: {},
    advertisers: 4, max_days: 10 + (20 - i) * 2, variations: 6 }, dayOf(i));
}
// صنف بلقطة وحدة بس
R.saveSnapshot({ watch_id: w2.id, web_results: 12, fb_pages: 2, shops: 1,
  price_low: 5, price_high: 9, signals: {}, advertisers: 2, max_days: 45, variations: 3 }, dayOf(0));

const b = R.board(60);
const laban = b.rows.find(r => r.term === "لبنة بلدية");
const asal = b.rows.find(r => r.term === "عسل سدر");
ok(laban.dataPoints === 21, `السلسلة تراكمت: ${laban.dataPoints} نقطة`);
ok(laban.weekDelta > 0, `الحركة الأسبوعية موجبة (+${laban.weekDelta}) — الصنف صاعد`);
ok(laban.trendConfidence === "عالية", "21 نقطة ⇒ ثقة الاتجاه عالية");
ok(asal.trendConfidence === "لا تكفي", "نقطة وحدة ⇒ الثقة 'لا تكفي' مش رقم واثق");
ok(b.rising.some(r => r.term === "لبنة بلدية"), "الصاعد انرصد بقائمة الصاعدين");
ok(b.proven.length === 2, `الأصناف اللي إعلاناتها 30+ يوم: ${b.proven.length}`);

console.log("\n── نضج الرادار معلن ──");
ok(b.maturity.includes("بيتكوّن"), `21 يوم ⇒ "بيتكوّن" مش "ناضج" (النضج بده 30): ${b.maturity}`);
// رادار جديد لازم يحذّر
const w3 = R.addTerm("زعتر بري");
R.saveSnapshot({ watch_id: w3.id, web_results: 5, fb_pages: 1, shops: 1,
  price_low: 0, price_high: 0, signals: {} }, dayOf(0));
const fresh = R.board(1);
ok(fresh.rows.find(r => r.term === "زعتر بري").trendConfidence === "لا تكفي",
   "الصنف الجديد ثقته 'لا تكفي' — ما بندّعي اتجاه من لقطة");

console.log("\n── الرصد اليدوي بيكمّل الدرجة ──");
const before = R.board(60).rows.find(r => r.term === "زعتر بري");
ok(before.complete === false, "قبل الرصد: الدرجة ناقصة");
const after = R.logObservation(w3.id, { advertisers: 2, max_days: 40, variations: 8 });
ok(after.complete, "بعد الرصد: الدرجة صارت كاملة");
ok(after.score > 0, `والدرجة اتحدّثت (${after.score})`);
// والرصد ما بيمسح بيانات البحث
const kept = R.board(60).rows.find(r => r.term === "زعتر بري");
ok(kept.web_results === 5, "الرصد اليدوي ما مسح نتائج البحث المحفوظة");

console.log("\n── الملخّص اليومي ──");
const digest = R.buildDigest(R.board(60));
ok(digest.includes("رادار السوق") && digest.includes("الأعلى درجة"), "الملخّص فيه الترتيب");
ok(digest.includes("30+ يوم"), "وبيبرز الأصناف المثبتة");

// ═══ نقاط النهاية ═══
console.log("\n── نقاط النهاية ──");
const { loadFeatures } = await import("../src/features/index.js");
const app = express(); app.use(express.json());
for (const f of await loadFeatures()) app.use("/f-api/" + f.slug, f.router);
const server = app.listen(0);
const base2 = `http://127.0.0.1:${server.address().port}/f-api/radar`;
const hit = async (m, p, body) => {
  const r = await fetch(base2 + p, { method: m,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json() };
};

for (const [n, m, p, b2] of [
  ["اللوحة", "GET", "/board?days=60"],
  ["قائمة المراقبة", "GET", "/watch"],
  ["إضافة صنف", "POST", "/watch", { terms: ["تمر مجدول"] }],
  ["رصد يدوي", "POST", `/observe/${w2.id}`, { advertisers: 5, max_days: 35, variations: 4 }],
  ["تاريخ صنف", "GET", `/history/${w1.id}`],
  ["سجل التشغيل", "GET", "/runs"],
  ["حالة الفحص", "GET", "/scan/status"],
  ["الدليل", "GET", "/guide"]
]) {
  const r = await hit(m, p, b2);
  ok(r.status === 200 && !r.json.error, `${n}${r.json.error ? " → " + r.json.error : ""}`);
}

const guide = await hit("GET", "/guide");
ok(guide.json.الحقيقة.عنوان.includes("ما بينشر") &&
   guide.json.الحقيقة.شرح.includes("بتخمّن"),
   "الدليل بيصرّح إنه فيسبوك ما بينشر مبيعات وإنه غيرنا بيخمّن");
const bd = await hit("GET", "/board");
ok(bd.json.basis["🔴_مبيعات_فيسبوك"], "اللوحة بتحمل التحذير بالأساس");
const obsErr = await hit("POST", `/observe/${w2.id}`, {});
ok(obsErr.status === 400, "الرصد الفاضي مرفوض");

server.close();
console.log(`\n${"═".repeat(46)}\n   ${fail ? `فشل ${fail}` : "كل الفحوصات نجحت"}\n${"═".repeat(46)}`);
wipe();
process.exit(fail ? 1 : 0);
