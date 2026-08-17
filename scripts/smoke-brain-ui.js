// اختبار الواجهة: بيتأكد إنه كل صفحة موجودة، وإنه كل نقطة نهاية
// بتناديها الصفحة موجودة فعلاً بالراوتر. بيمسك أخطاء المسارات قبل المستخدم.
import fs from "node:fs";
import path from "node:path";

const PAGES = ["chief", "intel", "retention", "pricing", "growth", "quality"];
let fail = 0;

// 1) الصفحات والأصول المشتركة موجودة
for (const p of [...PAGES.map(s => `public/features-${s}.html`), "public/brain-ui.css", "public/brain-ui.js"]) {
  if (fs.existsSync(p)) console.log(`✅ ${p}`);
  else { console.log(`❌ ناقص: ${p}`); fail++; }
}

// 2) كل مسار API بتناديه صفحة لازم يكون معرّف بالوحدة المقابلة
console.log("\n── مطابقة مسارات الواجهة مع الراوترات ──");
for (const slug of PAGES) {
  const html = fs.readFileSync(`public/features-${slug}.html`, "utf8");
  const mod = fs.readFileSync(`src/features/${slug}.js`, "utf8");
  const defined = new Set([...mod.matchAll(/router\.(get|post)\("([^"]+)"/g)].map(m => m[2]));

  // المسارات المستدعاة: `${A}/x`  أو  A + "/x"
  const called = new Set([...html.matchAll(/\$\{A\}(\/[a-z0-9\-\/]*)/gi)].map(m => m[1]));
  for (const c of called) {
    const clean = c.split("?")[0].replace(/\/$/, "") || "/";
    // نطابق كمان المسارات المتغيّرة مثل /experiments/:id/record
    const ok = defined.has(clean) ||
      [...defined].some(d => new RegExp("^" + d.replace(/:[^/]+/g, "[^/]+") + "$").test(clean));
    if (ok) console.log(`✅ ${slug}${clean}`);
    else { console.log(`❌ ${slug}${clean} — مستدعى بالواجهة وغير معرّف بالراوتر`); fail++; }
  }
}

// 3) الصفحات بتشير للأصول الصح
console.log("\n── الأصول ──");
for (const slug of PAGES.filter(s => s !== "chief")) {
  const html = fs.readFileSync(`public/features-${slug}.html`, "utf8");
  for (const asset of ["/brain-ui.css", "/brain-ui.js"]) {
    if (html.includes(asset)) console.log(`✅ ${slug} ← ${asset}`);
    else { console.log(`❌ ${slug} ما بيحمّل ${asset}`); fail++; }
  }
}

// 4) الأصول مخدومة من السيرفر
const srv = fs.readFileSync("src/server.js", "utf8");
for (const a of ["brain-ui.css", "brain-ui.js"]) {
  if (srv.includes(a)) console.log(`✅ السيرفر بيخدم ${a}`);
  else { console.log(`❌ السيرفر ما بيخدم ${a}`); fail++; }
}

console.log(`\n${"═".repeat(40)}\n   ${fail ? `فشل ${fail}` : "كل الفحوصات نجحت"}\n${"═".repeat(40)}`);
process.exit(fail ? 1 : 0);
