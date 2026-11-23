// ═══════════════════════════════════════════════════════════
// 🧪 فصل تام: الحلال الأبيض مستقلة عن أجبان الرياض
//  - الحلال ما تذكر "الرياض" بأي مخرج (فاتورة/رسائل منع/خبرة)
//  - نفس آلية التسعير (مضاعفات الـ2 كيلو) شغّالة
//  - أجبان الرياض ما تأثرت
// ═══════════════════════════════════════════════════════════
let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { console.log("❌ " + m); fail++; } };

const { PAGES, calculateOrderTotal, getDomainExpertBrain, PAGE_EXPERT_KNOWLEDGE } =
  await import("../src/bot/brain.js");

const H = Object.keys(PAGES).find(k => PAGES[k].name === "الحلال الأبيض");
ok(!!H, "صفحة الحلال الأبيض موجودة");
const cH = PAGES[H];

// هوية مستقلة
ok(cH.BRAND === "الحلال الأبيض" && cH.BRAND_PRODUCT === "جبنة الحلال الأبيض", "هوية خاصة: اسم ومنتج الحلال الأبيض");
ok(!!cH.PRICES["جبنة الحلال الأبيض"], "مفتاح السعر باسم جبنة الحلال الأبيض");

// الفاتورة باسمها وما تذكر الرياض
const inv = String(cH.INVOICE_TEMPLATE("4 كيلو جبنة الحلال الأبيض", "18 دينار شامل التوصيل", "عمان", "0791234567"));
ok(inv.includes("فاتورة الحلال الأبيض"), "الفاتورة باسم الحلال الأبيض");
ok(!inv.includes("الرياض"), "الفاتورة ما تذكر الرياض نهائياً");

// رسائل المنع باسمها
const blocked = calculateOrderTotal(H, [{ product: "جبنة الحلال الأبيض", quantity: 1 }], "auto");
ok(blocked.invoiceBlocked && !blocked.message.includes("الرياض"), "رسالة منع 1 كيلو بلا ذكر الرياض");
ok(blocked.message.includes("الحلال الأبيض"), "رسالة المنع باسم الحلال الأبيض");

// خبرة البوت وبروفايله بلا تسرّب الرياض
ok(!getDomainExpertBrain(H).includes("أجبان الرياض"), "خبرة البوت بلا ذكر أجبان الرياض");
const prof = PAGE_EXPERT_KNOWLEDGE[H];
ok(prof && !prof.summary.includes("الرياض") && !JSON.stringify(prof.faq).includes("الرياض"),
   "ملف الخبرة/الأسئلة بلا ذكر الرياض");

// التسعير نفسه شغّال (مضاعفات 2 كيلو)
ok(calculateOrderTotal(H, [{ product: "جبنة الحلال الأبيض", quantity: 2 }], "auto").total === 10, "2 كيلو = 10");
ok(calculateOrderTotal(H, [{ product: "جبنة الحلال الأبيض", quantity: 4 }], "auto").total === 18, "4 كيلو = 18");
ok(!!calculateOrderTotal(H, [{ product: "x", quantity: 3 }], "auto").invoiceBlocked, "3 كيلو ممنوعة");

// أجبان الرياض ما تأثرت
const R = Object.keys(PAGES).find(k => PAGES[k].name === "أجبان الرياض");
if (R) {
  const invR = String(PAGES[R].INVOICE_TEMPLATE("4 كيلو جبنة الرياض", "18 دينار شامل التوصيل", "عمان", "0791234567"));
  ok(invR.includes("فاتورة أجبان الرياض"), "أجبان الرياض لسا فاتورتها باسمها");
  ok(calculateOrderTotal(R, [{ product: "جبنة الرياض", quantity: 4 }], "auto").total === 18, "أجبان الرياض تسعيرها سليم (4=18)");
}

console.log(`\n${fail ? "🔴" : "🟢"} نجح ${pass} / فشل ${fail}`);
process.exit(fail ? 1 : 0);
