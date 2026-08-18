// حارس الإرسال: بيمنع أخطر عطل ممكن يصير بالبوت — الصمت التام.
//
// خلفية: sendText(pageToken, senderId, text). عكس المعاملات مرّة مرّر
// كائن مكان النص، فرمت .trim() خطأً وانهار المعالج، والزبون ما وصله
// ولا رد وطلبه علق. الاختبار بيمسك النمط قبل ما يوصل الإنتاج.
import fs from "node:fs";
import { execSync } from "node:child_process";

let fail = 0;
const ok = (c, m) => { if (c) console.log("✅ " + m); else { console.log("❌ " + m); fail++; } };

console.log("── ترتيب معاملات sendText بكل الاستدعاءات ──");
// بس الاستدعاءات الفعلية — بلا التعريف ولا التعليقات التوضيحية
const calls = execSync(`grep -rn 'await sendText(' src/ --include=*.js || true`,
  { encoding: "utf8" }).trim().split("\n").filter(Boolean)
  .filter(l => !/^\s*\d+:\s*\/\//.test(l.split(":").slice(2).join(":")));
ok(calls.length > 0, `${calls.length} استدعاء للفحص`);

for (const line of calls) {
  const m = line.match(/^([^:]+):(\d+):\s*(.*)$/);
  if (!m) continue;
  const [, file, ln, code] = m;
  const args = (code.match(/sendText\(([^;]*)\)/) || [, ""])[1];
  const first = args.split(",")[0].trim();
  // أول معامل لازم يكون توكن — الأسماء المقبولة بالمشروع
  const looksLikeToken = /^(token|pageToken|page\.PAGE_TOKEN|pageConfig\.PAGE_TOKEN|effConfig\.PAGE_TOKEN)$/.test(first);
  ok(looksLikeToken, `${file}:${ln} → أول معامل "${first}" ${looksLikeToken ? "توكن ✔" : "🔴 مش توكن!"}`);
}

console.log("\n── الحارس داخل sendText ──");
const msgr = fs.readFileSync("src/bot/messenger.js", "utf8");
ok(/typeof text !== "string"/.test(msgr), "بيرفض النص اللي مش سلسلة");
ok(/typeof pageToken !== "string"/.test(msgr), "بيرفض التوكن اللي مش سلسلة");
ok(/الترتيب الصحيح/.test(msgr), "ورسالة الخطأ بتوضّح الترتيب الصحيح");

console.log("\n── سلوك فعلي ──");
const { sendText, openReplyWindow, closeReplyWindow } = await import("../src/bot/messenger.js");
const errs = [];
const origErr = console.error;
console.error = (...a) => errs.push(a.join(" "));
openReplyWindow();
// الحالة المعطوبة: ترتيب معكوس — لازم يُرفض بهدوء مع رسالة واضحة، بلا انهيار
let threw = false;
try { await sendText("sender123", "نص الرسالة", { name: "صفحة" }); }
catch { threw = true; }
closeReplyWindow();
console.error = origErr;
ok(!threw, "الترتيب المعكوس ما بيرمي استثناء يوقف المعالج");
ok(errs.some(e => e.includes("sendText")), "وبيسجّل خطأ واضح بالسجل");

console.log("\n── كل رسالة للزبون بتنسجّل ──");
const handler = fs.readFileSync("src/bot/handler.js", "utf8");
const sends = [...handler.matchAll(/await sendText\(token, senderId, (\w+)\)/g)].map(m => m[1]);
ok(sends.length >= 4, `${sends.length} إرسال مباشر بالمعالج`);

console.log(`\n${"═".repeat(48)}\n   ${fail ? `فشل ${fail}` : "كل الفحوصات نجحت"}\n${"═".repeat(48)}`);
process.exit(fail ? 1 : 0);
