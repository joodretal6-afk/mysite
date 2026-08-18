// ═══════════════════════════════════════════════════════════
// 🔑 أداة ترحيل التوكنات — من الكود لمتغيّرات البيئة
//
// ليش: التوكنات مكتوبة نصاً صريحاً في brain.js والمستودع عام.
// GitHub يرصد توكنات فيسبوك ويبلّغ ميتا، وميتا تُبطلها. هذا التفسير
// الأرجح لانبطال توكن "اجبان المهيري".
//
// الأداة **لا تحذف شيئاً**. تفحص التوكنات الحالية، وتطبع ما يجب
// لصقه في لوحة الاستضافة. الحذف من الكود يصير بعد ما تتأكد إنه
// كل صفحة صارت تقرأ من البيئة — وهاد بيمنع إيقاف صفحة شغّالة.
//
// التشغيل:  node scripts/migrate-tokens.js
//           node scripts/migrate-tokens.js --check   (فحص فقط بلا طباعة توكنات)
// ═══════════════════════════════════════════════════════════
const checkOnly = process.argv.includes("--check");

const { PAGES } = await import("../src/bot/brain.js");
const ids = Object.keys(PAGES);

console.log("🔑 فحص توكنات الصفحات\n" + "═".repeat(58));

const rows = [];
for (const id of ids) {
  const p = PAGES[id];
  const envKey = `PAGE_TOKEN_${id}`;
  const fromEnv = process.env[envKey];
  const token = fromEnv || p.PAGE_TOKEN;
  const source = fromEnv ? "متغيّر بيئة ✅" : p.PAGE_TOKEN ? "الكود ⚠️" : "لا يوجد ❌";

  let status = "—", detail = "";
  if (token) {
    try {
      const r = await fetch(
        `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(token)}`,
        { signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      if (j.error) {
        status = "معطّل ❌";
        detail = `code=${j.error.code}${j.error.error_subcode ? " sub=" + j.error.error_subcode : ""} — ${j.error.message.slice(0, 90)}`;
      } else if (j.id !== id) {
        status = "معرّف مختلف ⚠️";
        detail = `التوكن لصفحة ${j.name} (${j.id}) مش لهاي الصفحة`;
      } else {
        status = "شغّال ✅";
        // نفحص الصلاحيات والانتهاء
        try {
          const d = await (await fetch(
            `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`,
            { signal: AbortSignal.timeout(15000) })).json();
          const dd = d.data || {};
          const scopes = dd.scopes || [];
          const need = ["pages_messaging", "pages_manage_metadata"];
          const missing = need.filter(s => !scopes.includes(s));
          const parts = [];
          parts.push(dd.expires_at === 0 ? "لا ينتهي" : "ينتهي " + new Date(dd.expires_at * 1000).toISOString().slice(0, 10));
          if (missing.length) parts.push("⚠️ صلاحيات ناقصة: " + missing.join(", "));
          detail = parts.join(" · ");
        } catch { /* التفاصيل اختيارية */ }
      }
    } catch (e) { status = "تعذّر الفحص"; detail = e.message; }
  }
  rows.push({ id, name: p.name, envKey, source, status, detail, token });
}

for (const r of rows) {
  console.log(`\n📄 ${r.name}`);
  console.log(`   المعرّف : ${r.id}`);
  console.log(`   المصدر  : ${r.source}`);
  console.log(`   الحالة  : ${r.status}${r.detail ? "\n   التفاصيل: " + r.detail : ""}`);
}

const inCode = rows.filter(r => r.source.includes("الكود") && r.token);
const broken = rows.filter(r => r.status.includes("معطّل"));

console.log("\n" + "═".repeat(58));
console.log(`الإجمالي: ${rows.length} صفحة · ${rows.filter(r => r.status.includes("شغّال")).length} شغّالة · ${broken.length} معطّلة`);
console.log(`${inCode.length} توكن ما زال في الكود (مكشوف في المستودع العام)`);

if (broken.length) {
  console.log("\n❌ صفحات تحتاج توكناً جديداً:");
  for (const b of broken) console.log(`   • ${b.name} — ${b.detail}`);
  console.log("   ولّد توكن جديد من: https://developers.facebook.com/tools/explorer/");
  console.log("   بالصلاحيات: pages_messaging, pages_manage_metadata, pages_read_engagement");
}

if (inCode.length && !checkOnly) {
  console.log("\n" + "═".repeat(58));
  console.log("📋 الصقها في Render → خدمتك → Environment:\n");
  for (const r of inCode) console.log(`${r.envKey}=${r.token}`);
  console.log("\n" + "═".repeat(58));
  console.log(`الخطوات:
  1. الصق السطور فوق في Environment على Render واحفظ.
  2. استنى إعادة التشغيل، وشوف سجل الإقلاع — لازم يطلع لكل صفحة:
     🔑 توكن من متغيّر البيئة لصفحة: <الاسم>
  3. شغّل:  node scripts/migrate-tokens.js --check
     لازم كل الصفحات تصير "متغيّر بيئة ✅".
  4. بس وقتها احذف سطور PAGE_TOKEN من src/bot/brain.js.

  🔴 لا تحذف من الكود قبل الخطوة 3 — بتوقف الصفحات الشغّالة.`);
} else if (inCode.length && checkOnly) {
  console.log("\n⚠️ لسه في توكنات بالكود. شغّل الأداة بلا --check عشان تطلعلك جاهزة للّصق.");
} else if (!inCode.length) {
  console.log("\n✅ كل التوكنات من متغيّرات البيئة — بتقدر تحذف PAGE_TOKEN من brain.js بأمان.");
}
