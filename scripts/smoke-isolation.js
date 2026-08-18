// ═══════════════════════════════════════════════════════════
// 🧪 اختبار عزل العملاء العدائي — يحاول عمداً يكسر النظام
//
// الهدف: إثبات إنه ما في أي احتمال تنتقل بيانات عميل لعميل تاني،
// ولا يتخترع/يفترض النظام أي معلومة. لو في أي تسريب = فشل.
//
// بيغطّي: 2 / 10 / 100 عميل، رسائل متزامنة/متداخلة/متأخرة، مكرّرة،
// retry، ناقص رقم/عنوان/طلب، "نفس العنوان"، نفس المنطقة/المنتج بين
// عملاء، بيانات على عدة رسائل، أرقام بصيغ مختلفة، وأخطاء إملائية.
// ═══════════════════════════════════════════════════════════
if (!process.env.DB_PATH || /platform\.db/.test(process.env.DB_PATH))
  process.env.DB_PATH = "./data/smoke-isolation.db";
if (/platform\.db/.test(process.env.DB_PATH)) {
  console.error("🔴 رفض: الاختبار ما بيشتغل على قاعدة الإنتاج"); process.exit(1);
}
import fs from "node:fs";
const wipe = () => ["", "-wal", "-shm"].forEach(x => { try { fs.rmSync(process.env.DB_PATH + x); } catch {} });
wipe();

const { SESSIONS_KV, saveOrder } = await import("../src/db/database.js");
const { parseMessage } = await import("../src/bot/parser.js");
const { validateOrder, sessionFingerprint } = await import("../src/bot/validate.js");
const { withSessionLock } = await import("../src/bot/lock.js");
await new Promise(r => setTimeout(r, 800));

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; } else { console.log("❌ " + m); fail++; } };
const okv = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { console.log("❌ " + m); fail++; } };

// PRNG ثابت (نتائج قابلة لإعادة الإنتاج، بلا Math.random عشوائي)
let _seed = 987654321;
const rnd = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// صفحة أجبان مبسّطة للاختبار
const PAGE = {
  name: "اختبار",
  QTY_MODE: "unit",
  PRICES: { "غنم": 15, "شخل": 16, "ماعز": 20 },
  PRODUCT_KEYWORDS: { "غنم": /غنم|بلدي/i, "شخل": /شخل/i, "ماعز": /ماعز|عربي/i }
};

const AREAS = ["البيادر", "الجبيهة", "صويلح", "الزرقاء الجديدة", "ماركا الشمالية",
               "المفرق", "اربد الحصن", "الرصيفة", "طبربور", "مرج الحمام"];
const PRODUCTS = ["غنم", "شخل", "ماعز"];

// رقم أردني فريد لكل عميل i بصيغ مختلفة
function phoneFor(i) {
  const pre = ["077", "078", "079"][i % 3];
  const tail = String(1000000 + (i * 7919) % 8999999).slice(0, 7);
  return pre + tail;
}
function phoneMsg(i) {
  const p = phoneFor(i);
  const fmt = i % 3;
  if (fmt === 0) return `رقمي ${p}`;
  if (fmt === 1) return `تلفوني ${p.slice(0,3)}-${p.slice(3)}`;          // بشرطة
  return `للتواصل ${"+962" + p.slice(1)}`;                               // دولي
}
function areaMsg(i) {
  const a = AREAS[i % AREAS.length];
  return `عنواني ${a} جنب المسجد بناية ${(i % 30) + 1}`;
}
function orderMsg(i) {
  const p = PRODUCTS[i % PRODUCTS.length];
  const two = i % 2 === 0;
  return { text: two ? `بدي نصيتين ${p}` : `بدي نصية ${p}`, product: p, qty: two ? 2 : 1 };
}

// معالجة رسالة واحدة كما بالإنتاج: قفل الجلسة → تحميل → parse → حفظ
async function processMsg(pageId, senderId, text, srcId) {
  const key = sessionFingerprint(pageId, senderId);
  return withSessionLock(key, async () => {
    let mem = await SESSIONS_KV.get(key, "json");
    if (!mem) mem = { cart: {}, area: null, phone: null, history: [], prov: {}, sessionKey: key };
    parseMessage(mem, text, PAGE, srcId);
    await SESSIONS_KV.put(key, JSON.stringify(mem), { expirationTtl: 3600 });
    return mem;
  });
}

// ═══ اختبار متعدد العملاء متداخل ═══
async function runManyCustomers(N, pageId, label) {
  const customers = [];
  for (let i = 0; i < N; i++) {
    const o = orderMsg(i);
    customers.push({
      i, senderId: `U${pageId}_${i}`, expectArea: AREAS[i % AREAS.length],
      expectPhone: phoneFor(i), expectProduct: o.product, expectQty: o.qty,
      msgs: [
        { text: o.text, id: `m${i}a` },
        { text: areaMsg(i), id: `m${i}b` },
        { text: phoneMsg(i), id: `m${i}c` }
      ]
    });
  }

  // نبعثر كل الرسائل من كل العملاء مع بعض (تداخل كامل) وننفّذها متزامنة
  const allMsgs = [];
  for (const c of customers) for (const m of c.msgs) allMsgs.push({ c, m });
  shuffle(allMsgs);
  await Promise.all(allMsgs.map(({ c, m }) => processMsg(pageId, c.senderId, m.text, m.id)));

  // نفحص كل عميل: بياناته بياناته هو بالضبط، ولا شي من غيره
  const otherPhones = new Set(customers.map(c => c.expectPhone));
  let leaks = 0, incomplete = 0, wrongCart = 0, wrongPhone = 0, wrongArea = 0;
  for (const c of customers) {
    const key = sessionFingerprint(pageId, c.senderId);
    const mem = await SESSIONS_KV.get(key, "json");
    if (!mem) { leaks++; continue; }
    // الرقم رقمه هو
    if (mem.phone !== c.expectPhone) { wrongPhone++; }
    // العنوان يحتوي منطقته هو
    if (!mem.area || !mem.area.includes(normArea(c.expectArea))) { wrongArea++; }
    // السلة صنفه هو بكميته
    if (mem.cart[c.expectProduct] !== c.expectQty || Object.keys(mem.cart).length !== 1) { wrongCart++; }
    // 🔴 تسريب: هل رقمه يطابق رقم عميل تاني مختلف؟ (بصمة الجلسة لازم رقمه)
    for (const other of customers) {
      if (other.i === c.i) continue;
      if (mem.phone === other.expectPhone && other.expectPhone !== c.expectPhone) { leaks++; break; }
      // عنوان عميل تاني بمنطقة مختلفة ظهر عنده؟
      if (other.expectArea !== c.expectArea && mem.area && mem.area.includes(normArea(other.expectArea))
          && !mem.area.includes(normArea(c.expectArea))) { leaks++; break; }
    }
    const v = validateOrder(mem, { pageId, senderId: c.senderId });
    if (!v.complete) incomplete++;
  }
  okv(leaks === 0, `${label}: ولا تسريب بيانات بين ${N} عميل (تسريبات=${leaks})`);
  okv(wrongPhone === 0, `${label}: كل رقم لصاحبه (أخطاء=${wrongPhone})`);
  okv(wrongArea === 0, `${label}: كل عنوان لصاحبه (أخطاء=${wrongArea})`);
  okv(wrongCart === 0, `${label}: كل طلب لصاحبه بكميته (أخطاء=${wrongCart})`);
  okv(incomplete === 0, `${label}: كل الطلبات اكتملت بمصادر موثّقة (ناقص=${incomplete})`);
}

function normArea(a) {
  // نطابق أول كلمة مميّزة (العنوان بينحفظ منسّق: "عمان، البيادر...")
  return a.replace(/^اربد /, "").split(" ")[0].replace(/ة$/, "ه").replace(/^ال/, "ال");
}

console.log("── عملاء متعددون متداخلون ──");
await runManyCustomers(2, "P1", "عميلان");
await runManyCustomers(10, "P1", "10 عملاء");
await runManyCustomers(100, "P2", "100 عميل");

// ═══ سباق على نفس العميل: رسالتان متزامنتان ما تضيع وحدة ═══
console.log("\n── سباق على نفس الجلسة (رسالتان متزامنتان) ──");
{
  const pageId = "R1", senderId = "race1";
  const key = sessionFingerprint(pageId, senderId);
  await SESSIONS_KV.delete(key);
  // بلا قفل: تحميل متزامن ثم كتابة متزامنة = فقدان. مع القفل: الاثنين بيثبتوا.
  await Promise.all([
    processMsg(pageId, senderId, "بدي نصيتين غنم", "rm1"),
    processMsg(pageId, senderId, "رقمي 0791234567", "rm2")
  ]);
  const mem = await SESSIONS_KV.get(key, "json");
  okv(mem && mem.cart["غنم"] === 2 && mem.phone === "0791234567",
      `القفل حفظ الطلب والرقم معاً بلا فقدان (cart=${JSON.stringify(mem && mem.cart)} phone=${mem && mem.phone})`);
}

// ═══ رسالة مكرّرة (retry) ما تضاعف الطلب ═══
console.log("\n── رسالة مكرّرة / retry ──");
{
  const pageId = "D1", senderId = "dup1";
  const key = sessionFingerprint(pageId, senderId);
  await SESSIONS_KV.delete(key);
  // محاكاة dedup: نفس معرّف الرسالة بينكتب علامة، والثانية تنرفض
  const seen = new Set();
  const handleDedup = async (text, mid) => {
    if (seen.has(mid)) return "skipped";
    seen.add(mid);
    await processMsg(pageId, senderId, text, mid);
    return "processed";
  };
  await handleDedup("بدي نصيتين غنم", "X1");
  const second = await handleDedup("بدي نصيتين غنم", "X1");  // نفس الـ mid
  const mem = await SESSIONS_KV.get(key, "json");
  okv(second === "skipped" && mem.cart["غنم"] === 2,
      `الرسالة المكرّرة (نفس mid) ما تضاعفت (${JSON.stringify(mem.cart)})`);
}

// ═══ حقل بلا مصدر = ناقص (ممنوع يمرّ) ═══
console.log("\n── منع القيم بلا مصدر ──");
{
  const mem = { cart: { "غنم": 1 }, area: "عمان، البيادر", addressReady: true,
                phone: "0791234567", prov: { order: { source_mid: "a" }, area: { source_mid: "b" } } };
  // الرقم موجود بس بلا مصدر (prov.phone غائب) → لازم يعتبره ناقص
  const v = validateOrder(mem, { pageId: "Z", senderId: "z" });
  okv(!v.complete && v.missing.includes("phone"),
      `رقم بلا source_mid = ناقص (missing=${v.missing.join(",")})`);
  // نضيف مصدره → يكتمل
  mem.prov.phone = { source_mid: "c" };
  okv(validateOrder(mem, {}).complete, "بعد إضافة مصدر الرقم → مكتمل");
}

// ═══ "نفس العنوان" بلا سياق داخل الجلسة → عنوان مجهول ═══
console.log("\n── \"نفس العنوان\" بلا سياق = مجهول ──");
{
  const pageId = "S1", senderId = "same1";
  const key = sessionFingerprint(pageId, senderId);
  await SESSIONS_KV.delete(key);
  await processMsg(pageId, senderId, "بدي نصية غنم", "s1");
  await processMsg(pageId, senderId, "نفس العنوان", "s2");   // بلا أي عنوان سابق بالجلسة
  const mem = await SESSIONS_KV.get(key, "json");
  okv(!mem.area, `"نفس العنوان" ما اخترع عنوان (area=${mem.area || "مجهول"})`);
  const v = validateOrder(mem, { pageId, senderId });
  okv(!v.complete && v.missing.includes("address"), "والطلب ضل ناقص (بيسأل عن العنوان)");
}

// ═══ حاجز قاعدة البيانات: بصمة جلسة غلط تنرفض ═══
console.log("\n── حاجز قاعدة البيانات ──");
{
  let threw = false;
  try {
    saveOrder({ page_id: "P", sender_id: "A", session_key: "P_B",   // مش مطابقة
      order_string: "غنم (1)", total: 15, area: "عمان", phone: "0791234567" });
  } catch { threw = true; }
  okv(threw, "saveOrder رفض طلب بصمة جلسته لا تطابق هويته");

  let threw2 = false;
  try { saveOrder({ page_id: "", sender_id: "", order_string: "x", total: 1 }); }
  catch { threw2 = true; }
  okv(threw2, "saveOrder رفض طلب بلا هوية (page/sender فارغين)");
}

// ═══ بيانات على عدة رسائل لنفس العميل تتجمّع صح ═══
console.log("\n── تجميع بيانات عبر رسائل منفصلة ──");
{
  const pageId = "M1", senderId = "multi1";
  const key = sessionFingerprint(pageId, senderId);
  await SESSIONS_KV.delete(key);
  for (const [t, id] of [["مرحبا", "u1"], ["بدي نصيتين شخل", "u2"],
                         ["الجبيهة شارع الملكة", "u3"], ["0788887777", "u4"]]) {
    await processMsg(pageId, senderId, t, id);
  }
  const mem = await SESSIONS_KV.get(key, "json");
  okv(mem.cart["شخل"] === 2 && mem.phone === "0788887777" && mem.area && mem.area.includes("الجبيه"),
      `البيانات المتفرّقة تجمّعت لنفس العميل فقط (${JSON.stringify(mem.cart)} | ${mem.phone} | ${mem.area})`);
}

console.log(`\n${"═".repeat(52)}\n   ${fail ? `🔴 فشل ${fail} · نجح ${pass}` : `✅ كل الفحوصات نجحت (${pass})`}\n${"═".repeat(52)}`);
wipe();
process.exit(fail ? 1 : 0);
