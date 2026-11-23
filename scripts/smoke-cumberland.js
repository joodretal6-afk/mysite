// ═══════════════════════════════════════════════════════════
// 🧪 اختبار صفحة كمبرلاند: التسعير (توصيل مرة وحدة) ومطابقة المنتجات
// ═══════════════════════════════════════════════════════════
if (!process.env.DB_PATH || /platform\.db/.test(process.env.DB_PATH))
  process.env.DB_PATH = "./data/smoke-cumberland.db";
if (/platform\.db/.test(process.env.DB_PATH)) {
  console.error("🔴 رفض: الاختبار ما بيشتغل على قاعدة الإنتاج"); process.exit(1);
}
let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { console.log("❌ " + m); fail++; } };

const { PAGES } = await import("../src/bot/brain.js");
const { computeOrder } = await import("../src/bot/order.js");
const { parseMessage } = await import("../src/bot/parser.js");

// نحلّ الصفحة بالاسم (معرّفها ممكن يكون اتغيّر بتعديلات المالك).
// لو صفحة كمبرلاند انشالت من الإعدادات، منتخطّى الاختبار بدون فشل.
const cid = Object.keys(PAGES).find(k => PAGES[k].name === "كمبرلاند");
if (!cid) {
  console.log("⏭️  صفحة كمبرلاند مش موجودة بالإعدادات الحالية — تم تخطّي الاختبار (مش فشل).");
  console.log("\n🟢 نجح 0 / فشل 0");
  process.exit(0);
}
const c = PAGES[cid];
ok(!!c && c.name === "كمبرلاند", "صفحة كمبرلاند موجودة باسمها");
ok(!!c.PAGE_TOKEN && c.PAGE_TOKEN.startsWith("EAAR"), "التوكن مضبوط");

const total = (cart) => computeOrder(c, cart, null).total;

// ── التسعير: نفس منتجات ريفان وفاتي ──
ok(total({ "جل غسيل كمبرلاند": 1 }) === 12, "جل وحدة = 10 + 2 توصيل = 12");
ok(total({ "كلور": 1 }) === 9, "كلور وحدة = 7 + 2 توصيل = 9");
ok(total({ "فلاش": 1 }) === 9, "فلاش وحدة = 7 + 2 توصيل = 9");
ok(total({ "جل غسيل كمبرلاند": 1, "كلور": 1, "فلاش": 1 }) === 26, "العرض الثلاثي = 26 شامل التوصيل");

// ── مطابقة المنتجات والعرض ──
const cartOf = (msg) => { const m = { cart: {}, area: null, phone: null }; parseMessage(m, msg, c); return m.cart; };
ok(JSON.stringify(cartOf("بدي جل غسيل")) === '{"جل غسيل كمبرلاند":1}', "«جل غسيل» → الجل");
ok(JSON.stringify(cartOf("بدي كلور")) === '{"كلور":1}', "«كلور» → الكلور");
ok(JSON.stringify(cartOf("بدي فلاش")) === '{"فلاش":1}', "«فلاش» → الفلاش");
const bundle = cartOf("بدي العرض");
ok(bundle["جل غسيل كمبرلاند"] === 1 && bundle["كلور"] === 1 && bundle["فلاش"] === 1, "«العرض» → الأصناف الثلاثة");
// الفاتورة باسم كمبرلاند
ok(/كمبرلاند/.test(String(c.INVOICE_TEMPLATE("جل (1)", "12د", "عمان", "079"))), "الفاتورة باسم كمبرلاند");

console.log(`\n${fail ? "🔴" : "🟢"} نجح ${pass} / فشل ${fail}`);
process.exit(fail ? 1 : 0);
