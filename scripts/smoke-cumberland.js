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

const c = PAGES["1229773096895942"];
ok(!!c && c.name === "كمبرلاند", "صفحة كمبرلاند موجودة باسمها");
ok(!!c.PAGE_TOKEN && c.PAGE_TOKEN.startsWith("EAAR"), "التوكن مضبوط");

const total = (cart) => computeOrder(c, cart, null).total;

// ── التسعير: التوصيل 2 مرة وحدة، الجل 10 للعبوة ──
ok(total({ "جل غسيل كمبرلاند": 1 }) === 12, "جل وحدة = 12 (شامل التوصيل)");
ok(total({ "جل غسيل كمبرلاند": 2 }) === 22, "جلّتين = 22 (توصيل مرة وحدة)");
ok(total({ "جل غسيل كمبرلاند": 3 }) === 32, "ثلاث جل = 32");
ok(total({ "جل غسيل كمبرلاند": 4 }) === 42, "أربع جل = 42");
ok(total({ "ديتول": 1 }) === 4.5, "ديتول وحدة = 2.5 + 2 توصيل = 4.5");
ok(total({ "ديتول": 2 }) === 7, "ديتولين = 5 + 2 توصيل = 7 (توصيل مرة وحدة)");
ok(total({ "جل غسيل كمبرلاند": 1, "سائل جلي": 1 }) === 14.5, "جل + سائل جلي = 10+2.5+2 = 14.5");

// كل منتجات 5 لتر بسعر 2.5
for (const p of ["بكس", "سائل جلي", "ملين", "معطر", "مطهر", "فلاش", "ديتول"])
  ok(c.PRICES[p] === 2.5, `سعر «${p}» = 2.5`);

// ── مطابقة المنتجات: «جل» مش «جلي» ──
const cartOf = (msg) => { const m = { cart: {}, area: null, phone: null }; parseMessage(m, msg, c); return m.cart; };
ok(JSON.stringify(cartOf("بدي جل غسيل")) === '{"جل غسيل كمبرلاند":1}', "«جل غسيل» → الجل");
ok(JSON.stringify(cartOf("بدي سائل جلي")) === '{"سائل جلي":1}', "«سائل جلي» → سائل الجلي مش الجل");
ok(cartOf("بدي 3 عبوات جل")["جل غسيل كمبرلاند"] === 3, "«3 عبوات جل» → جل عدد 3");
ok(cartOf("بدي عبوتين جل")["جل غسيل كمبرلاند"] === 2, "«عبوتين جل» → جل عدد 2");
const mix = cartOf("بدي جل مسكر وسائل جلي");
ok(mix["جل غسيل كمبرلاند"] === 1 && mix["سائل جلي"] === 1, "«جل مسكر وسائل جلي» → صنفين صح");

// الفاتورة باسم كمبرلاند
ok(/كمبرلاند/.test(String(c.INVOICE_TEMPLATE("جل (1)", "12د", "عمان", "079"))), "الفاتورة باسم كمبرلاند");

console.log(`\n${fail ? "🔴" : "🟢"} نجح ${pass} / فشل ${fail}`);
process.exit(fail ? 1 : 0);
