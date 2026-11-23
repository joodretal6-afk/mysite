// ═══════════════════════════════════════════════════════════
// 🧪 EMPIRE GLOBAL SEARCH — بحث موحّد عبر الكيانات
// ═══════════════════════════════════════════════════════════
if (!process.env.DB_PATH || /platform\.db/.test(process.env.DB_PATH))
  process.env.DB_PATH = "./data/smoke-empiresearch.db";
if (/platform\.db/.test(process.env.DB_PATH)) {
  console.error("🔴 رفض: الاختبار ما بيشتغل على قاعدة الإنتاج"); process.exit(1);
}
import fs from "node:fs";
const wipe = () => ["", "-wal", "-shm"].forEach(x => { try { fs.rmSync(process.env.DB_PATH + x); } catch {} });
wipe();

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { console.log("❌ " + m); fail++; } };

const { db } = await import("../src/db/database.js");
await new Promise(r => setTimeout(r, 800));
const S = await import("../src/features/empiresearch.js");

db.prepare("INSERT INTO orders (page_id,page_name,sender_id,order_string,total,area,phone,status,messenger_url,created_at) VALUES (?,?,?,?,?,?,?,?,'',?)")
  .run("p1", "أجبان غزة", "u1", "جبنة غنم (2 نصية)", 30, "اربد", "0791234567", "جديد", Date.now());
db.prepare("INSERT INTO messages (page_id,page_name,sender_id,direction,body,created_at) VALUES (?,?,?,?,?,?)")
  .run("p1", "أجبان غزة", "u1", "in", "بدي اطلب رقمي 0791234567", Date.now());

const keys = (r) => r.groups.map(g => g.key);

// رقم هاتف → طلب + عميل + محادثة
let r = S.empireSearch("0791234567");
ok(keys(r).includes("orders"), "البحث برقم يلاقي الطلب");
ok(keys(r).includes("customers"), "البحث برقم يلاقي العميل");
ok(keys(r).includes("chats"), "البحث برقم يلاقي المحادثة");

// اسم منتج → طلب + منتج
r = S.empireSearch("غنم");
ok(keys(r).includes("orders") && keys(r).includes("products"), "البحث بالمنتج يلاقي الطلب والمنتج");

// منطقة → طلب + عميل
r = S.empireSearch("اربد");
ok(keys(r).includes("orders"), "البحث بالمنطقة يلاقي الطلب");

// تطبيع عربي: الهمزة/الألف
r = S.empireSearch("إربد");
ok(r.total >= 1, "البحث متسامح مع اختلاف الهمزة (إربد=اربد)");

// الأرقام العربية
r = S.empireSearch("٠٧٩١٢٣٤٥٦٧");
ok(r.total >= 1, "البحث يطبّع الأرقام العربية");

// كل نتيجة فيها رابط فعلي
r = S.empireSearch("0791234567");
ok(r.groups.every(g => g.items.every(it => it.link && it.link.length > 1)), "كل نتيجة فيها رابط");

// استعلام قصير جداً → بلا نتائج (حماية)
ok(S.empireSearch("a").groups.length === 0, "استعلام أقل من حرفين ما بيبحث");

// استعلام بلا تطابق
ok(S.empireSearch("zzzznope").total === 0, "استعلام بلا تطابق يرجّع صفر");

// نقطة الراوتر
const layer = S.router.stack.find(l => l.route && l.route.path === "/q");
const res = { body: null, status(){ return this; }, json(j){ this.body = j; return this; } };
layer.route.stack[layer.route.stack.length - 1].handle({ query: { term: "غنم" } }, res);
ok(res.body && res.body.ok && res.body.groups, "نقطة /q ترجّع نتائج مصنّفة");

wipe();
console.log(`\n${fail ? "🔴" : "🟢"} نجح ${pass} / فشل ${fail}`);
process.exit(fail ? 1 : 0);
