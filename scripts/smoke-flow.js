// محاكاة محادثة كاملة لكل صفحة — من أول رسالة لحد الفاتورة.
// الهدف: التأكد إنه ولا صفحة بتوقف بالنص، وإنه الفاتورة بتطلع فعلاً.
// (بيختبر منطق البوت بلا شبكة ولا ذكاء اصطناعي)
if (!process.env.DB_PATH || /platform\.db/.test(process.env.DB_PATH))
  process.env.DB_PATH = "./data/smoke-flow.db";
if (/platform\.db/.test(process.env.DB_PATH)) {
  console.error("🔴 رفض: الاختبار ما بيشتغل على قاعدة الإنتاج"); process.exit(1);
}
import fs from "node:fs";
const wipe = () => ["", "-wal", "-shm"].forEach(x => { try { fs.rmSync(process.env.DB_PATH + x); } catch {} });
wipe();

await import("../src/db/database.js");
await new Promise(r => setTimeout(r, 1200));

const { PAGES } = await import("../src/bot/brain.js");
const { parseMessage } = await import("../src/bot/parser.js");
const { computeOrder } = await import("../src/bot/order.js");
const { parseAddress } = await import("../src/bot/address.js");

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

// محاكاة مبسّطة لمسار الطلب داخل handler (نفس القواعد بالضبط)
function runFlow(pageConfig, messages) {
  const memory = { cart: {}, area: null, phone: null, sent: false };
  const out = [];
  for (const msg of messages) {
    parseMessage(memory, msg, pageConfig);

    // بوابة العنوان (نفس منطق handler)
    if (memory.area && !memory.addr) {
      const original = String(memory.area).trim();
      const checked = parseAddress(original);
      memory.addr = checked;
      memory.area = checked.formatted.length >= original.length ? checked.formatted
        : (checked.formatted && !original.includes(checked.formatted)
            ? `${checked.formatted} (${original})` : original);
      memory.addressScore = checked.score;
      memory.addressLevel = checked.level;
      memory.addressReady = checked.deliverable;
      memory.addressQuestion = checked.nextQuestion;
    }

    const n = Object.keys(memory.cart).length;
    const addrIncomplete = !!memory.area && memory.addressReady === false;
    const askedAlready = !!memory._addrAsked;

    // العنوان الخشن ما بيوقف الفاتورة — بينضاف عليها طلب معلم
    const complete = n > 0 && !!memory.area && memory.addressReady !== false && memory.phone;
    // ما بنعرف وين أصلاً + عنده رقم وصنف ⇒ منسأل مرة وحدة
    if (n > 0 && memory.phone && !complete && addrIncomplete
        && memory.addressQuestion && !askedAlready && !memory.sent) {
      memory._addrAsked = true;
      out.push({ type: "سؤال", text: memory.addressQuestion });
      continue;
    }
    if (complete && !memory.sent) {
      memory.sent = true;
      const o = computeOrder(pageConfig, memory.cart, null);
      const coarse = !!(memory.addr && memory.addr.coarse);
      out.push({ type: "فاتورة",
        text: pageConfig.INVOICE_TEMPLATE(o.orderString, o.priceString, memory.area, memory.phone)
              + (coarse ? "\n\n📍 لو بتقدر تبعتلي أقرب معلم بيسهّل على السائق يوصلك أسرع." : ""),
        review: coarse, score: memory.addressScore });
    } else if (!complete) {
      out.push({ type: "متابعة", need: !n ? "صنف" : !memory.phone ? "رقم" : "عنوان" });
    }
  }
  return { memory, out };
}

// ═══ 1) إعادة محادثة الصورة بالضبط على ريفان ═══
console.log("── محادثة الصورة الحقيقية (ريفان / البيادر) ──");
const reefan = PAGES["618622274665182"];
let r = runFlow(reefan, ["ممكن بدنا جلن ٢٠ لتر مع توصيل للبيادر", "0795040126"]);
const inv = r.out.find(x => x.type === "فاتورة");
ok(!!inv, inv ? "الفاتورة طلعت" : "🔴 ما طلعت فاتورة — نفس مشكلة الصورة!");
if (inv) {
  console.log("\n" + inv.text.split("\n").map(l => "     " + l).join("\n") + "\n");
  ok(inv.text.includes("البيادر"), "العنوان فيه البيادر");
  ok(inv.text.includes("0795040126"), "الرقم موجود");
  ok(/12/.test(inv.text), "الحساب 12د (10 + 2 توصيل)");
  ok(!inv.text.includes("جائزة"), "بلا أي ذكر للجوائز");
}
ok(r.memory.addressReady === true, `العنوان جاهز (${r.memory.addressScore}%)`);

// ═══ 2) كل الصفحات: هل بتوصل للفاتورة؟ ═══
console.log("\n── كل الصفحات ──");
const SCEN = {
  "618622274665182": ["بدي جلن غسيل للبيادر", "0791234567"],
  "211000052105556": ["بدي نصيتين غنم على الجبيهة جنب الجامعة بناية 12", "0791234567"],
  "907535882452054": ["بدي نصيتين غنم لماركا الشمالية جنب المسجد بناية 3", "0791234567"],
  "1271513032713402": ["بدي نصيتين غنم لاربد الحصن جنب المدرسة بناية 4", "0791234567"]
};
for (const [id, msgs] of Object.entries(SCEN)) {
  const p = PAGES[id];
  if (!p) { ok(false, `${id}: الصفحة مش معرّفة`); continue; }
  const res = runFlow(p, msgs);
  const i = res.out.find(x => x.type === "فاتورة");
  ok(!!i, `${p.name} → ${i ? `فاتورة ✔ (عنوان ${res.memory.addressScore}%)`
    : "🔴 وقف بلا فاتورة: " + JSON.stringify(res.out.slice(-1))}`);
}

// ═══ 3) 🔴 ضمان عدم السكوت: عنوان ناقص لازم يكمّل بعد سؤال واحد ═══
console.log("\n── ضمان: البوت ما بيسكت أبداً ──");
r = runFlow(reefan, ["بدي جلن غسيل", "0791234567", "بيت أبو أحمد", "ما بعرف"]);
const asks = r.out.filter(x => x.type === "سؤال");
const inv2 = r.out.find(x => x.type === "فاتورة");
ok(asks.length <= 1, `سأل مرة وحدة كحد أقصى (${asks.length})`);
// "بيت أبو أحمد" ما فيها أي مكان معروف — فما بينحفظ عنوان أصلاً،
// والمحادثة بتكمّل مع الذكاء الاصطناعي عادي (مش صمت).
ok(!r.memory.area, "عنوان بلا أي مكان معروف ما بينحفظ — بيضل يتابع مع الزبون");
ok(r.out.every(x => x.type !== "فاتورة"), "وما بتطلع فاتورة بعنوان مجهول");
ok(r.out.length === 4, `وكل رسالة إلها رد (${r.out.length}/4) — ولا رسالة بلا تفاعل`);

// ═══ 4) العنوان الكامل: بلا أي سؤال ═══
console.log("\n── العنوان الكامل ما بيتسأل عنه ──");
r = runFlow(reefan, ["بدي جلن غسيل للبيادر جنب دوار البيادر بناية 12", "0791234567"]);
ok(r.out.filter(x => x.type === "سؤال").length === 0, "ما سأل ولا سؤال");
ok(!!r.out.find(x => x.type === "فاتورة"), "وطلّع الفاتورة مباشرة");

// ═══ 4.5) 🔴 صحة الفاتورة: كل كمية لصنفها ═══
console.log("\n── الكميات والفواتير ──");
const motamad = PAGES["907535882452054"];
const { RESET_INTENT } = await import("../src/bot/parser.js");
for (const [txt, want, expected] of [
  ["بدي نصية غنم ونصيتين شخل", { "غنم": 1, "شخل": 2 }, 47],
  ["نصيتين غنم", { "غنم": 2 }, 29],
  ["بدي غنم", { "غنم": 1 }, 15],
  ["ثلاث نصيات غنم ونصية ماعز", { "غنم": 3, "ماعز": 1 }, 65]
]) {
  const m = { cart: {} };
  parseMessage(m, txt, motamad);
  const o = computeOrder(motamad, m.cart, null);
  ok(JSON.stringify(m.cart) === JSON.stringify(want) && o.total === expected,
     `"${txt}" ⇒ ${JSON.stringify(m.cart)} = ${o.total}د`);
}

console.log("\n── تفريغ السلة: بس لما الزبون يقصده ──");
for (const [txt, shouldClear] of [
  ["بدي أعدّل العنوان", false], ["تعديل رقمي", false], ["بدل العنوان", false],
  ["بدي الغنم", false], ["الغي الطلب", true], ["امسح الطلبية", true], ["غيرت رأيي", true]
]) {
  ok(RESET_INTENT.test(txt) === shouldClear,
     `"${txt}" ⇒ ${RESET_INTENT.test(txt) ? "تفريغ" : "السلة سليمة"}`);
}

// ═══ 5) مناطق أضفناها ═══
console.log("\n── مناطق كانت ناقصة ──");
for (const a of ["البيادر", "مرج الحمام", "وادي السير", "صافوط", "طبربور", "ناعور"]) {
  const x = parseAddress(a);
  ok(!!x.components.area, `${a} ⇒ ${x.components.area || "🔴 مش معروفة"} / ${x.components.governorate || "—"}`);
}

console.log(`\n${"═".repeat(50)}\n   ${fail ? `فشل ${fail}` : "كل الفحوصات نجحت"}\n${"═".repeat(50)}`);
wipe();
process.exit(fail ? 1 : 0);
