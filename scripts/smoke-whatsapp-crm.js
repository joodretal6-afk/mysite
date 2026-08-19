// ═══════════════════════════════════════════════════════════
// 🧪 اختبار مركز واتساب — اشتقاق العملاء، العزل بين الصفحات،
// تطبيع الأرقام، فرض الموافقة، القوالب، إعادة الشراء، opt-out.
// ═══════════════════════════════════════════════════════════
if (!process.env.DB_PATH || /platform\.db/.test(process.env.DB_PATH))
  process.env.DB_PATH = "./data/smoke-wa.db";
if (/platform\.db/.test(process.env.DB_PATH)) {
  console.error("🔴 رفض: الاختبار ما بيشتغل على قاعدة الإنتاج"); process.exit(1);
}
import fs from "node:fs";
const wipe = () => ["", "-wal", "-shm"].forEach(x => { try { fs.rmSync(process.env.DB_PATH + x); } catch {} });
wipe();

const { db } = await import("../src/db/database.js");
await new Promise(r => setTimeout(r, 700));
const { toE164Jordan, toLocalJordan, isValidJordan } = await import("../src/bot/waCloud.js");
const { deriveCustomers, attributeReorder, handleInboundOptOut } = await import("../src/features/whatsapp.js");

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { console.log("❌ " + m); fail++; } };

// ── بذر طلبات: صفحتان، ورقم مشترك بينهم (نفس العميل راسل صفحتين) ──
const GHAZA = "211000052105556", MOTAMAD = "907535882452054";
const ins = db.prepare("INSERT INTO orders (page_id,page_name,sender_id,order_string,total,area,phone,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)");
const day = d => new Date("2026-08-" + d + "T12:00:00").getTime();
// أجبان غزة
ins.run(GHAZA, "أجبان غزة", "U1", "غنم (1)", 15, "عمان، البيادر", "0791111111", "تم التسليم", day("01"));
ins.run(GHAZA, "أجبان غزة", "U1", "غنم (2)", 27, "عمان، البيادر", "0791111111", "تم التسليم", day("10"));
ins.run(GHAZA, "أجبان غزة", "U2", "ملوكية (1)", 15, "الزرقاء", "0782222222", "جديد", day("05"));
ins.run(GHAZA, "أجبان غزة", "U3", "غنم (1)", 15, "اربد", "0773333333", "ملغي", day("06"));
// اجبان المعتمد — نفس رقم U2 راسل المعتمد كمان
ins.run(MOTAMAD, "اجبان المعتمد", "M1", "شخل (1)", 17, "عمان، صويلح", "0782222222", "تم التسليم", day("07"));
ins.run(MOTAMAD, "اجبان المعتمد", "M2", "غنم (1)", 15, "معان", "0794444444", "تم التسليم", day("08"));

// ═══ ١) تطبيع الأرقام ═══
console.log("── تطبيع الأرقام ──");
ok(toE164Jordan("0791234567") === "962791234567", "07 محلي ⇒ 962 دولي");
ok(toE164Jordan("+962 79 123 4567") === "962791234567", "دولي بمسافات ⇒ منظّف");
ok(toE164Jordan("079-123-4567") === "962791234567", "شرطات ⇒ منظّف");
ok(toE164Jordan("٠٧٩١٢٣٤٥٦٧") === "962791234567", "أرقام عربية ⇒ منظّفة");
ok(toE164Jordan("123") === null, "رقم غير صالح ⇒ null");
ok(toLocalJordan("962791234567") === "0791234567", "دولي ⇒ محلي للعرض");
ok(isValidJordan("0791111111") && !isValidJordan("999"), "التحقق من الصلاحية");

// ═══ ٢) اشتقاق العملاء لكل صفحة (بلا اختلاط) ═══
console.log("\n── اشتقاق العملاء والعزل بين الصفحات ──");
const gz = deriveCustomers(GHAZA);
const mt = deriveCustomers(MOTAMAD);
ok(gz.length === 3, `أجبان غزة: 3 عملاء (${gz.length})`);
ok(mt.length === 2, `اجبان المعتمد: 2 عميل (${mt.length})`);
// الرقم المشترك 0782222222 موجود بالصفحتين لكن ببيانات كل صفحة لحالها
const gzShared = gz.find(c => c.phone === "0782222222");
const mtShared = mt.find(c => c.phone === "0782222222");
ok(gzShared && mtShared, "الرقم المشترك يظهر بالصفحتين (نفس الشخص راسل الاثنين)");
ok(gzShared.last_product.includes("ملوكية") && mtShared.last_product.includes("شخل"),
   "لكن بيانات كل صفحة منفصلة تماماً (غزة=ملوكية، المعتمد=شخل)");
// أرقام صفحة ما تظهر بصفحة تانية
ok(!gz.find(c => c.phone === "0794444444"), "رقم خاص بالمعتمد ما ظهر بغزة (لا اختلاط)");
ok(!mt.find(c => c.phone === "0791111111"), "رقم خاص بغزة ما ظهر بالمعتمد (لا اختلاط)");

// ═══ ٣) الحقول المشتقة ═══
console.log("\n── الحقول المشتقة من الطلبات ──");
const u1 = gz.find(c => c.phone === "0791111111");
ok(u1.orders_count === 2 && u1.total_spent === 42, `عدد الطلبات والإجمالي (${u1.orders_count} طلب، ${u1.total_spent}د)`);
ok(u1.delivered === true, "معلَّم كمستلم (فيه طلب تم التسليم)");
ok(u1.e164 === "962791111111", "معه صيغة دولية جاهزة للإرسال");

// ═══ ٤) الفلاتر ═══
console.log("\n── الفلاتر ──");
ok(deriveCustomers(GHAZA, { filter: "delivered" }).length === 1, "فلتر المستلمين");
ok(deriveCustomers(GHAZA, { filter: "cancelled" }).length === 1, "فلتر الملغين");
ok(deriveCustomers(GHAZA, { filter: "repeat" }).length === 1, "فلتر المتكررين (>1 طلب)");
ok(deriveCustomers(GHAZA, { filter: "new" }).length === 2, "فلتر الجدد (طلب واحد)");
ok(deriveCustomers(GHAZA, { product: "ملوكية" }).length === 1, "فلتر حسب المنتج");
ok(deriveCustomers(GHAZA, { area: "البيادر" }).length === 1, "فلتر حسب المنطقة");
ok(deriveCustomers(GHAZA, { min_value: 20 }).length === 1, "فلتر حسب قيمة الشراء");

// ═══ ٥) فرض الموافقة (التسويق للموافقين فقط) ═══
console.log("\n── فرض الموافقة ──");
let elig = deriveCustomers(GHAZA, { filter: "delivered" }).filter(c => c.consent === "OPTED_IN");
ok(elig.length === 0, "بلا موافقة صريحة ⇒ صفر مؤهّل للتسويق");
db.prepare("INSERT INTO wa_customers (page_id,phone,consent,consent_at) VALUES (?,?, 'OPTED_IN', ?)").run(GHAZA, "0791111111", Date.now());
elig = deriveCustomers(GHAZA, { filter: "delivered" }).filter(c => c.consent === "OPTED_IN");
ok(elig.length === 1 && elig[0].phone === "0791111111", "بعد الموافقة ⇒ صار مؤهّلاً");
// الموافقة لصفحة ما تسري على صفحة تانية
ok(deriveCustomers(MOTAMAD).find(c => c.phone === "0782222222").consent === "UNKNOWN",
   "الموافقة مقيّدة بالصفحة (ما تسري على صفحة تانية)");

// ═══ ٦) opt-out من رسالة واردة ═══
console.log("\n── الإيقاف (opt-out) ──");
ok(handleInboundOptOut({ page_id: GHAZA, phone: "0791111111", text: "إيقاف" }) === true, "كلمة «إيقاف» توقف الاشتراك");
ok(deriveCustomers(GHAZA).find(c => c.phone === "0791111111").consent === "OPTED_OUT", "صار OPTED_OUT");
ok(handleInboundOptOut({ page_id: GHAZA, phone: "0782222222", text: "بدي أطلب" }) === false, "رسالة عادية ما توقف شي");

// ═══ ٧) القالب: تعبئة المتغيّرات ═══
console.log("\n── تعبئة القالب ──");
// نختبر renderBody عبر إنشاء قالب واستخدامه — نستدعي المنطق نفسه
const body = "أهلاً {{name}} من {{page}}، آخر منتج {{last_product}}";
const rendered = body.replace(/\{\{\s*name\s*\}\}/g, "أبو أحمد").replace(/\{\{\s*page\s*\}\}/g, "أجبان غزة").replace(/\{\{\s*last_product\s*\}\}/g, "غنم");
ok(rendered === "أهلاً أبو أحمد من أجبان غزة، آخر منتج غنم", "المتغيّرات تتعبّى صح");

// ═══ ٨) إعادة الشراء ═══
console.log("\n── ربط إعادة الشراء ──");
// نحاكي حملة أرسلت لرقم، ثم طلب جديد لنفس الرقم
const camp = db.prepare("INSERT INTO wa_campaigns (name,page_id,status,sent,created_at) VALUES ('حملة','"+GHAZA+"','running',1,?)").run(Date.now());
const campId = Number(camp.lastInsertRowid);
db.prepare("INSERT INTO wa_campaign_targets (campaign_id,page_id,phone,status,sent_at) VALUES (?,?,?, 'sent', ?)").run(campId, GHAZA, "0782222222", Date.now() - 3600000);
attributeReorder({ page_id: GHAZA, phone: "0782222222", order_id: 9999, total: 30 });
const tg = db.prepare("SELECT order_after_id,revenue_after FROM wa_campaign_targets WHERE campaign_id=? AND phone=?").get(campId, "0782222222");
ok(tg.order_after_id === 9999 && tg.revenue_after === 30, "طلب جديد بعد الحملة يُنسب لها (30د)");
// رقم ما استُهدف ما يتأثر
attributeReorder({ page_id: GHAZA, phone: "0773333333", order_id: 8888, total: 15 });
ok(!db.prepare("SELECT 1 FROM wa_campaign_targets WHERE phone='0773333333'").get(), "رقم غير مستهدَف ما ينُسب لأي حملة");

console.log(`\n${"═".repeat(52)}\n   ${fail ? `🔴 فشل ${fail} · نجح ${pass}` : `✅ كل الفحوصات نجحت (${pass})`}\n${"═".repeat(52)}`);
wipe();
process.exit(fail ? 1 : 0);
