// اختبار محرّك العناوين على صياغات أردنية حقيقية.
// الهدف مش "نجاح 100%" — الهدف: ولا عنوان غلط بيمرّ كأنه مؤكّد.
import {
  parseAddress, mergeAddress, looksLikeAddressAttempt, isCorrection,
  normalizeAr, matchArea, formatAddress
} from "../src/bot/address.js";

let fail = 0, soft = 0;
const ok = (c, m) => { if (c) console.log("✅ " + m); else { console.log("❌ " + m); fail++; } };
const note = m => { console.log("⚠️  " + m); soft++; };

console.log("── التطبيع ──");
ok(normalizeAr("الجُبَيْهَة") === "الجبيهه", "التشكيل والتاء المربوطة");
ok(normalizeAr("إربد") === "اربد", "الهمزات");
ok(normalizeAr("عمّـــان") === "عمان", "الشدة والتطويل");
ok(normalizeAr("١٢٣") === "123", "الأرقام العربية");

console.log("\n── المناطق: مباشرة ──");
for (const [txt, area, gov] of [
  ["أنا بالجبيهة", "الجبيهه", "عمان"],
  ["ساكن بصويلح", "صويلح", "عمان"],
  ["الزرقاء الجديدة", "الزرقاء الجديده", "الزرقاء"],
  ["ماركا الشمالية", "ماركا الشماليه", "عمان"],
  ["اربد الحصن", "الحصن", "اربد"],
  ["وادي موسى", "وادي موسى", "معان"],
  ["مخيم الوحدات", "مخيم الوحدات", "عمان"]
]) {
  const r = parseAddress(txt);
  ok(r.components.area === area && r.components.governorate === gov,
     `"${txt}" ⇒ ${r.components.area} / ${r.components.governorate}`);
}

console.log("\n── المناطق: أخطاء إملائية ──");
for (const [txt, area] of [
  ["انا بالجبيها", "الجبيهه"], ["الجبيهه", "الجبيهه"],
  ["الشميسني", "الشميساني"], ["الرابيه", "الرابيه"],
  ["القويسمه", "القويسمه"], ["ابو نصير", "ابو نصير"]
]) {
  const r = parseAddress(txt);
  if (r.components.area === area) console.log(`✅ "${txt}" ⇒ ${area}`);
  else { console.log(`❌ "${txt}" ⇒ ${r.components.area || "لا شيء"} (متوقّع ${area})`); fail++; }
}

console.log("\n── الاختصارات ──");
ok(parseAddress("انا بالسابع").components.area === "الدوار السابع", "السابع ⇒ الدوار السابع");
ok(parseAddress("عند الدوار الخامس").components.area === "الدوار الخامس", "الدوار الخامس");

console.log("\n── المكوّنات ──");
let r = parseAddress("الجبيهة شارع الملكة رانيا بناية 24 طابق الثالث شقة 5");
ok(r.components.area === "الجبيهه", "المنطقة");
ok(r.components.street && r.components.street.includes("الملكه"), `الشارع: ${r.components.street}`);
ok(r.components.building === "24", `البناية: ${r.components.building}`);
ok(r.components.floor === "الثالث", `الطابق: ${r.components.floor}`);
ok(r.components.apartment === "5", `الشقة: ${r.components.apartment}`);
ok(r.level === "مؤكّد", `الثقة: ${r.level} (${r.score})`);

console.log("\n── المعالم ──");
for (const txt of ["أنا بصويلح جنب المسجد", "الجبيهة بعد دوار المنهل",
                   "خلدا مقابل مدرسة الاتحاد", "طبربور ورا كازية المناصير"]) {
  const x = parseAddress(txt);
  ok(!!x.components.landmark, `"${txt}" ⇒ معلم: ${x.components.landmark || "لا شيء"}`);
}

console.log("\n── GPS ──");
r = parseAddress("هاد موقعي https://maps.app.goo.gl/abc123XY");
ok(!!r.components.gps && r.score >= 60, `رابط الموقع (${r.score})`);
r = parseAddress("31.9539, 35.9106");
ok(!!r.components.coords, "الإحداثيات");

console.log("\n── 🔴 الأهم: العناوين الناقصة ما بتمرّ كمؤكّدة ──");
for (const [txt, why] of [
  ["بيت أبو أحمد", "اسم بيت بلا أي مرجع — مستحيل يتحدد"],
  ["جنب المسجد", "معلم بلا منطقة — في آلاف المساجد"],
  ["عمان", "محافظة بس"],
  ["قريب من هون", "بلا أي معلومة"]
]) {
  const x = parseAddress(txt);
  ok(!x.deliverable, `"${txt}" ⇒ ${x.level} (${x.score}) — ${why}`);
  ok(!!x.nextQuestion, `   ومعه سؤال محدّد: "${x.nextQuestion}"`);
}

console.log("\n── العنوان الكافي بيمرّ ──");
for (const txt of ["الجبيهة جنب الجامعة الأردنية بناية 12",
                   "صويلح شارع الأميرة رانيا مقابل الصيدلية",
                   "الزرقاء الجديدة حي معصوم بناية 8 طابق الثاني"]) {
  const x = parseAddress(txt);
  ok(x.deliverable, `"${txt}" ⇒ ${x.level} (${x.score})`);
}

console.log("\n── 🔴 العلة القديمة: فصل العنوان عن نص الطلب ──");
r = parseAddress("بدي نصيتين غنم وانا بالجبيهة جنب الجامعة");
ok(!r.formatted.includes("نصيتين") && !r.formatted.includes("غنم"),
   `الفاتورة بتطبع: "${r.formatted}" — بلا نص الطلب`);
ok(r.components.area === "الجبيهه", "والمنطقة انمسكت صح");

console.log("\n── 🔴 العلة القديمة: التصحيح كان بينرمى ──");
let acc = mergeAddress(null, "انا بصويلح");
ok(acc.components.area === "صويلح", "العنوان الأول: صويلح");
acc = mergeAddress(acc, "لا غلط انا بالجبيهة مش صويلح");
ok(acc.corrected, "انرصدت نية التصحيح");
ok(acc.components.area === "الجبيهه", `وانتحدّث فعلاً: ${acc.components.area}`);

console.log("\n── التراكم عبر رسائل ──");
acc = mergeAddress(null, "انا بالجبيهة");
// منطقة معروفة لحالها = قابلة للتوصيل (السائق معه رقم الزبون)،
// بس معلَّمة "خشنة" عشان تنطلب تفاصيل أكثر بلا ما نوقف الطلب.
ok(acc.deliverable && acc.coarse, `رسالة 1: ${acc.level} (${acc.score}) — يوصل بس خشن`);
acc = mergeAddress(acc, "جنب مسجد الحسين");
ok(acc.components.area === "الجبيهه" && acc.components.landmark, "رسالة 2: ضاف المعلم بلا ما يمسح المنطقة");
acc = mergeAddress(acc, "بناية 15 طابق الثاني");
ok(acc.deliverable && acc.components.building === "15",
   `رسالة 3: ${acc.level} (${acc.score}) — "${acc.formatted}"`);

console.log("\n── 🔴 العلة القديمة: السؤال كان بينحسب عنوان ──");
ok(!looksLikeAddressAttempt("بكم التوصيل؟", { wasAsked: true }), "سؤال عن التوصيل ≠ عنوان");
ok(!looksLikeAddressAttempt("قديش السعر", { wasAsked: true }), "سؤال عن السعر ≠ عنوان");
ok(!looksLikeAddressAttempt("تمام", { wasAsked: true }), "كلمة تأكيد ≠ عنوان");
ok(!looksLikeAddressAttempt("اه ماشي", { wasAsked: true }), "موافقة ≠ عنوان");
ok(looksLikeAddressAttempt("الجبيهة", {}), "منطقة معروفة = عنوان");
ok(looksLikeAddressAttempt("جنب مسجد عمر بشارع رئيسي", { wasAsked: true }),
   "وصف بمعلم بعد سؤال صريح = عنوان");

console.log("\n── التصحيح ──");
ok(isCorrection("لا غلط"), "غلط");
ok(isCorrection("قصدي الجبيهة"), "قصدي");
ok(!isCorrection("الجبيهة جنب الجامعة"), "عنوان عادي مش تصحيح");

console.log("\n── الأرقام ما بتضيع (العلة القديمة كانت بتحذفها) ──");
r = parseAddress("الجبيهة بناية 1234 شقة 12");
ok(r.components.building === "1234", `بناية 4 خانات: ${r.components.building}`);

// ═══════════════════════════════════════════════════════════
// تكامل: بوابة العنوان بالـ parser
// ═══════════════════════════════════════════════════════════
console.log("\n── تكامل مع الـ parser ──");
const { extractArea } = await import("../src/bot/parser.js");

let mem = {};
extractArea(mem, "بدي نصيتين غنم");
ok(!mem.area, "رسالة طلب بلا عنوان ⇒ ما بينحفظ عنوان");

mem = {};
extractArea(mem, "انا بالجبيهة");
ok(mem.area === "عمان، الجبيهه", `العنوان منسّق: "${mem.area}"`);
ok(mem.addressReady === true && mem.addr.coarse,
   "منطقة لحالها ⇒ يوصل بس خشن (ما بيوقف الطلب)");
ok(!!mem.addressQuestion, `ومعه سؤال تحسين: "${mem.addressQuestion}"`);

extractArea(mem, "جنب مسجد الحسين بناية 15");
ok(mem.addressReady === true, `بعد التفاصيل ⇒ جاهز (${mem.addressScore})`);
ok(mem.area.includes("الجبيهه") && mem.area.includes("15"),
   `العنوان تراكم: "${mem.area}"`);

console.log("\n── 🔴 السؤال بعد سؤال البوت عن العنوان ما بينحفظ كعنوان ──");
mem = { lastReply: "وين عنوانك للتوصيل؟" };
extractArea(mem, "بكم التوصيل؟");
ok(!mem.area, "سؤال الزبون ما انحفظ كعنوان");

console.log("\n── التصحيح عبر الـ parser ──");
mem = {};
extractArea(mem, "انا بصويلح جنب المسجد بناية 3");
const first = mem.area;
extractArea(mem, "غلط انا بالجبيهة");
ok(mem.area.includes("الجبيهه"), `التصحيح اشتغل: "${first}" ⇒ "${mem.area}"`);

console.log("\n── العنوان الأقوى ما بينمسح بأضعف ──");
mem = {};
extractArea(mem, "الجبيهة جنب الجامعة بناية 20 طابق الثاني");
const strong = mem.area, strongScore = mem.addressScore;
extractArea(mem, "عمان");
ok(mem.area === strong && mem.addressScore === strongScore,
   "ذكر المحافظة لحالها ما دعس العنوان الكامل");

console.log("\n── حدّ التوصيل: بنعرف وين؟ ──");
for (const [t, want] of [["البيادر", true], ["الجبيهة", true],
                         ["عمان", false], ["بيت أبو أحمد", false], ["جنب المسجد", false]]) {
  const x = parseAddress(t);
  ok(x.deliverable === want,
     `"${t}" ⇒ ${x.deliverable ? "يوصل" : "ما بيوصل"} (${x.score}%) — ${want ? "منطقة معروفة" : "ما بنعرف وين"}`);
}

console.log(`\n${"═".repeat(52)}`);
console.log(`   ${fail ? `فشل ${fail}` : "كل الفحوصات نجحت"}${soft ? ` · ${soft} ملاحظة` : ""}`);
console.log("═".repeat(52));
process.exit(fail ? 1 : 0);
