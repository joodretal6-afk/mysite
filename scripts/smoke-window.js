// حارس نافذة الـ24 ساعة — أهم قيد سياسة على المنصة.
//
// الإرسال خارج النافذة مخالفة صريحة لسياسة ميتا، وعقوبتها إيقاف
// الصفحة والحساب الإعلاني. يعني خرق واحد بيوقّف قناة البيع كلها.
if (!process.env.DB_PATH || /platform\.db/.test(process.env.DB_PATH))
  process.env.DB_PATH = "./data/smoke-window.db";
if (/platform\.db/.test(process.env.DB_PATH)) {
  console.error("🔴 رفض: الاختبار ما بيشتغل على قاعدة الإنتاج"); process.exit(1);
}
import fs from "node:fs";
const wipe = () => ["", "-wal", "-shm"].forEach(x => { try { fs.rmSync(process.env.DB_PATH + x); } catch {} });
wipe();

const { db } = await import("../src/db/database.js");
await new Promise(r => setTimeout(r, 1200));

let fail = 0;
const ok = (c, m) => { if (c) console.log("✅ " + m); else { console.log("❌ " + m); fail++; } };

// ═══ 1) طبقة الإرسال: ممنوع أي إرسال خارج النافذة ═══
console.log("── طبقة الإرسال ──");
const M = await import("../src/bot/messenger.js");
const warns = [];
const origWarn = console.warn;
console.warn = (...a) => warns.push(a.join(" "));

// بلا فتح نافذة: لازم يُرفض
await M.sendText("tok", "user1", "رسالة استباقية");
console.warn = origWarn;
ok(warns.some(w => w.includes("إرسال استباقي مرفوض")),
   "الإرسال بلا نافذة رد مرفوض ومسجّل");

// النافذة بتنقفل دايماً حتى لو صار خطأ
M.openReplyWindow();
try { throw new Error("عطل مصطنع"); } catch {} finally { M.closeReplyWindow(); }
const warns2 = [];
console.warn = (...a) => warns2.push(a.join(" "));
await M.sendText("tok", "user1", "بعد الإغلاق");
console.warn = origWarn;
ok(warns2.some(w => w.includes("إرسال استباقي مرفوض")),
   "النافذة بتنقفل حتى لو صار خطأ أثناء المعالجة");

// ═══ 2) الرد اليدوي من اللوحة ═══
console.log("\n── الرد اليدوي من لوحة التحكم ──");
const routes = fs.readFileSync("src/admin/routes.js", "utf8");
ok(/direction = 'in'/.test(routes) && /24 \* 3600 \* 1000/.test(routes),
   "الرد اليدوي بيفحص آخر رسالة واردة مقابل 24 ساعة");
ok(/outsideWindow/.test(routes), "وبيرجّع 409 مع سبب واضح خارج النافذة");
const idx = routes.indexOf("openReplyWindow()");
const before = routes.slice(Math.max(0, idx - 1600), idx);
ok(/status\(409\)/.test(before),
   "🔴 الفحص بيصير **قبل** فتح النافذة مش بعدها");

// ═══ 3) ولا إرسال استباقي بأي مكان بالكود ═══
console.log("\n── ما في إرسال استباقي مبرمج ──");
const { execSync } = await import("node:child_process");
const scheduled = execSync(
  `grep -rn 'setInterval\\|setTimeout' src/ --include=*.js | grep -i 'sendText\\|graphSend' || true`,
  { encoding: "utf8" }).trim();
ok(!scheduled, scheduled ? `🔴 في إرسال مجدول:\n${scheduled}` : "ولا إرسال مجدول للزبائن");

// الوحدات اللي بتتعامل مع الزبائن لازم تحترم النافذة
const retention = fs.readFileSync("src/features/retention.js", "utf8");
ok(/inWindow/.test(retention), "وحدة الاحتفاظ بتفحص النافذة قبل ما تعرض قائمة تواصل");
ok(!/sendText|graphSend/.test(retention), "ووحدة الاحتفاظ ما بتبعث ولا رسالة بنفسها");

console.log(`\n${"═".repeat(48)}\n   ${fail ? `فشل ${fail}` : "كل الفحوصات نجحت"}\n${"═".repeat(48)}`);
wipe();
process.exit(fail ? 1 : 0);
