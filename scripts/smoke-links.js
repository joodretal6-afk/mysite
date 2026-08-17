// حارس الروابط: بيمنع رجوع خطأ m.me/<PSID>.
// السبب: الـ sender_id من الويبهوك هو PSID مربوط بصفحتك،
// و m.me بيتوقع معرّف صفحة — فبيطلع "غير متوفر".
import fs from "node:fs";
import { execSync } from "node:child_process";
import { inboxUrl, businessInboxUrl, whatsappUrl, contactLinks } from "../src/brain/links.js";

let fail = 0;
const ok = (c, m) => { if (c) console.log("✅ " + m); else { console.log("❌ " + m); fail++; } };

console.log("── سلوك المساعد ──");
ok(inboxUrl("100123", "789") === "https://www.facebook.com/100123/inbox/?selected_item_id=789",
   "رابط صندوق الصفحة بالصيغة الصحيحة");
ok(businessInboxUrl("100123", "789").includes("asset_id=100123") &&
   businessInboxUrl("100123", "789").includes("selected_item_id=789"),
   "رابط Business Suite فيه معرّف الصفحة والمحادثة");
ok(inboxUrl("", "789") === "", "بلا page_id بيرجّع فاضي بدل رابط مكسور");
ok(inboxUrl("100123", "") === "", "بلا sender_id بيرجّع فاضي");
ok(inboxUrl(null, null) === "", "بلا مدخلات بيرجّع فاضي");
ok(!contactLinks("", "789").ok && contactLinks("1", "2").ok, "الحزمة بتعلّم إذا الرابط صالح");
ok(inboxUrl("a/b?x=1", "c&d").includes("a%2Fb") , "الترميز بيمنع كسر الرابط بمحارف خاصة");
ok(whatsappUrl("+962 79 123 4567") === "https://wa.me/962791234567", "واتساب بينضّف الرقم");
ok(whatsappUrl("") === "", "واتساب بلا رقم بيرجّع فاضي");

console.log("\n── ما في m.me/<sender_id> بأي مكان ──");
// أي m.me بالكود المصدري مرفوض، إلا موضعين شرعيين:
//   • links.js — التوثيق اللي بيشرح الخطأ
//   • database.js — الترحيل، لازم يطابق النمط القديم عشان يصلحه
const ALLOWED = [/^src\/brain\/links\.js:/, /^src\/db\/database\.js:/];
const hits = execSync(
  `grep -rn 'm\\.me/' src/ --include=*.js || true`, { encoding: "utf8" }
).trim().split("\n").filter(l => l && !ALLOWED.some(re => re.test(l)));
// وبنتأكد إنه استخدام database.js فعلاً ترحيل مش توليد رابط جديد
const dbHits = execSync(`grep -n 'm\\.me/' src/db/database.js || true`, { encoding: "utf8" })
  .trim().split("\n").filter(Boolean);
ok(dbHits.every(l => /LIKE|^\s*\d+:\s*\/\//.test(l)),
   "استخدام m.me بـ database.js محصور بالترحيل والتعليق — مش توليد");
ok(hits.length === 0, hits.length ? `لسه في روابط m.me:\n   ${hits.join("\n   ")}` : "نظيف — ولا رابط m.me متبقّي");

console.log("\n── مولّدو الروابط بيمرّروا page_id ──");
for (const f of ["src/features/intel.js", "src/features/retention.js", "src/features/chief.js",
                 "src/features/quality.js", "src/features/leads.js", "src/admin/routes.js",
                 "src/bot/handler.js"]) {
  const src = fs.readFileSync(f, "utf8");
  const calls = [...src.matchAll(/inboxUrl\(([^)]*)\)/g)].map(m => m[1].trim());
  const bad = calls.filter(a => !a.includes(",") || a.split(",")[0].trim() === "");
  ok(bad.length === 0 && (calls.length > 0 || f.includes("routes")),
     `${f} — ${calls.length} نداء، كلها بمعرّف صفحة${bad.length ? " | ناقص: " + bad.join(" ; ") : ""}`);
}

console.log(`\n${"═".repeat(44)}\n   ${fail ? `فشل ${fail}` : "كل فحوصات الروابط نجحت"}\n${"═".repeat(44)}`);
process.exit(fail ? 1 : 0);
