// ═══════════════════════════════════════════════════════════
// 🧪 اختبار المشتريات والموردين
//
// بيغطي: حساب إجمالي أمر الشراء، الاستلام الجزئي والكامل
// والفرق، رفض المدخلات الغلط، المستحق بعد الدفع، مقارنة
// الأسعار، تاريخ التكلفة، اقتراح الشراء من نواقص حقيقية،
// وإثبات إنّ المؤشر بلا بيانات بيرجع null مش صفر مخترع.
// ═══════════════════════════════════════════════════════════
if (!process.env.DB_PATH || /platform\.db/.test(process.env.DB_PATH))
  process.env.DB_PATH = "./data/smoke-procure.db";
if (/platform\.db/.test(process.env.DB_PATH)) {
  console.error("🔴 رفض: الاختبار ما بيشتغل على قاعدة الإنتاج"); process.exit(1);
}
import fs from "node:fs";
const wipe = () => ["", "-wal", "-shm"].forEach(x => { try { fs.rmSync(process.env.DB_PATH + x); } catch {} });
wipe();

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { console.log("❌ " + m); fail++; } };

const pc = await import("../src/features/procure.js");
await new Promise(r => setTimeout(r, 500));
const { db } = await import("../src/db/database.js");
const today = new Date(Date.now() + 10800 * 1000).toISOString().slice(0, 10);

// ═══════════ (4) حساب إجماليات أمر الشراء — دالة صافية ═══════════
const T1 = pc.orderTotals([
  { qty: 10, unit_price: 3, received_qty: 0 },
  { qty: 5, unit_price: 2.5, received_qty: 0 }
]);
ok(T1.value === 42.5, "إجمالي الأمر = 10×3 + 5×2.5");
ok(T1.qty === 15 && T1.received === 0, "الكميات المطلوبة والمستلمة");
ok(T1.variance === 15, "الفرق كله ناقص قبل الاستلام");
ok(T1.open_value === 42.5 && T1.received_value === 0, "القيمة المفتوحة = كل الأمر قبل الاستلام");

const T2 = pc.orderTotals([{ qty: 10, unit_price: 3, received_qty: 6 }]);
ok(T2.received_value === 18 && T2.open_value === 12, "استلام 6 من 10 بسعر 3 → 18 مستلم و12 مفتوح");
ok(T2.short_lines === 1, "السطر الناقص بينعدّ");
ok(pc.orderTotals([{ qty: 0.1, unit_price: 0.1, received_qty: 0 }]).value === 0.01,
   "🔴 التقريب لخانتين بكل عملية فلوس");

ok(pc.statusFromReceipt("مرسل", { received: 0, qty: 10 }) === "مرسل", "بلا استلام الحالة ما بتتغيّر");
ok(pc.statusFromReceipt("مرسل", { received: 4, qty: 10 }) === "مستلم جزئي", "استلام ناقص → مستلم جزئي");
ok(pc.statusFromReceipt("مرسل", { received: 10, qty: 10 }) === "مستلم", "استلام كامل → مستلم");
ok(pc.statusFromReceipt("ملغي", { received: 10, qty: 10 }) === "ملغي", "الأمر الملغي بيضل ملغي");

// ═══════════ (8) الاقتراح بلا وحدة جرد → رسالة واضحة مش انهيار ═══════════
let stockErr = "";
try { pc.suggestRows(); } catch (e) { stockErr = e.message; }
ok(/stock_items/.test(stockErr) && /مش موجودة/.test(stockErr),
   "🔴 بلا جداول الجرد بيرجع رسالة عربية واضحة بدل ما ينهار");

// ═══════════ الراوتر الحقيقي ═══════════
const express = (await import("express")).default;
const app = express();
app.use("/p", pc.router);
const srv = app.listen(0);
const port = srv.address().port;
const call = async (m, p, body) => {
  const r = await fetch(`http://127.0.0.1:${port}/p${p}`, {
    method: m, headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  return r.json();
};

// ── (1) الموردين ──
const s1 = await call("POST", "/suppliers", { name: "مصنع الوادي", phone: "0790000000", pay_terms: "آجل 15 يوم", lead_days: 3 });
const s2 = await call("POST", "/suppliers", { name: "ألبان الشمال", phone: "0791111111", pay_terms: "نقدي" });
ok(s1.ok && s1.id && s2.ok && s2.id, "انسجّل مورّدين");
ok((await call("POST", "/suppliers", { name: "" })).ok === false, "مورد بلا اسم بينرفض");
ok((await call("POST", "/suppliers", { name: "س", phone: "قوس" })).ok === false, "هاتف غير صالح بينرفض");
ok((await call("POST", "/suppliers", { name: "س٢", lead_days: 999 })).ok === false, "مدة توريد خيالية بتنرفض");
const supList = await call("GET", "/suppliers");
ok(supList.totals.suppliers === 2 && supList.totals.active === 2, "سجل الموردين بيعدّهم صح");

// ── (2) قائمة الأسعار ──
ok((await call("POST", "/prices", { supplier_id: s1.id, item_name: "جبنة نابلسية", price: 3 })).ok,
   "انسجّل سعر عند المورد الأول");
await call("POST", "/prices", { supplier_id: s2.id, item_name: "جبنة نابلسية", price: 3.4 });
await call("POST", "/prices", { supplier_id: s1.id, item_name: "لبنة بلدية", price: 2 });
ok((await call("POST", "/prices", { supplier_id: s1.id, item_name: "جبنة نابلسية", price: 0 })).ok === false,
   "سعر صفر أو سالب بينرفض");
ok((await call("POST", "/prices", { supplier_id: 9999, item_name: "شي", price: 1 })).ok === false,
   "سعر لمورد مش موجود بينرفض");
const pr = await call("GET", "/prices?supplier_id=" + s1.id);
ok(pr.rows.length === 2 && pr.rows[0].updated_day === today, "قائمة أسعار المورد فيها تاريخ آخر تحديث");

// ── (3) المقارنة ──
const cmp = await call("GET", "/compare?item=" + encodeURIComponent("جبنة نابلسية"));
ok(cmp.rows.length === 2 && cmp.rows[0].best === true, "المقارنة بترتّب الأرخص أول");
ok(cmp.best.price === 3 && cmp.best.supplier_id === s1.id, "الأرخص اليوم هو المورد الأول");
ok(cmp.rows[1].extra === 0.4 && cmp.spread === 0.4, "فرق السعر عن الأرخص محسوب صح");
const cmp0 = await call("GET", "/compare?item=" + encodeURIComponent("صنف ما إلو سعر"));
ok(cmp0.rows.length === 0 && cmp0.best === null && /ما في سعر/.test(cmp0.msg),
   "🔴 صنف بلا أسعار → «ما في سعر مسجّل» بدل رقم مخترع");
ok((await call("GET", "/compare")).ok === false, "المقارنة بلا اسم صنف بتنرفض");

// ── (4) أمر الشراء ──
const po = await call("POST", "/orders", {
  supplier_id: s1.id, expected_at: today,
  lines: [{ item_name: "جبنة نابلسية", qty: 10, unit_price: 3 },
          { item_name: "لبنة بلدية", qty: 5, unit_price: 2 }]
});
ok(po.ok && po.totals.value === 40, "أمر شراء إجماليه 40 (10×3 + 5×2)");
ok((await call("POST", "/orders", { supplier_id: s1.id, lines: [] })).ok === false, "أمر بلا سطور بينرفض");
ok((await call("POST", "/orders", { supplier_id: s1.id, lines: [{ item_name: "جبنة", qty: 0, unit_price: 1 }] })).ok === false,
   "سطر بكمية صفر بينرفض");
ok((await call("POST", "/orders", { supplier_id: s1.id, expected_at: "2026/01/01", lines: [{ item_name: "ج", qty: 1, unit_price: 1 }] })).ok === false,
   "تاريخ بصيغة غلط بينرفض");
const ov = await call("GET", "/orders/" + po.id);
ok(ov.order.status === "مسودة" && ov.lines.length === 2, "الأمر بيبلّش مسودة بسطرين");
ok((await call("POST", `/orders/${po.id}/status`, { status: "مستلم" })).ok === false,
   "الحالة «مستلم» ما بتنكتب بالإيد — بتنشتق من الكميات");
ok((await call("POST", `/orders/${po.id}/status`, { status: "مرسل" })).ok, "تحويل الأمر لمرسل");

// ── (5) الاستلام الجزئي ثم الكامل ──
const rc1 = await call("POST", `/orders/${po.id}/receive`, { lines: [{ line_id: ov.lines[0].id, qty: 6 }], day: today });
ok(rc1.status === "مستلم جزئي", "استلام 6 من 10 → مستلم جزئي");
ok(rc1.totals.received === 6 && rc1.totals.variance === 9, "الفرق = 15 مطلوب − 6 مستلم");
ok(rc1.variances.length === 2 && rc1.variances[0].variance === 4, "الفرق مسجّل سطر بسطر");
ok(rc1.totals.received_value === 18, "قيمة المستلم = 6×3");
const over = await call("POST", `/orders/${po.id}/receive`, { lines: [{ line_id: ov.lines[0].id, qty: 99 }] });
ok(over.ok === false && /أكبر من المطلوب/.test(over.error), "الاستلام الزائد بينرفض إلا بإذن صريح");
ok((await call("POST", `/orders/${po.id}/receive`, { lines: [{ line_id: ov.lines[0].id, qty: -1 }] })).ok === false,
   "كمية استلام سالبة بتنرفض");
ok((await call("POST", `/orders/${po.id}/receive`, { lines: [{ line_id: 99999, qty: 1 }] })).ok === false,
   "سطر مش تابع للأمر بينرفض");
// السعر تغيّر عند الاستلام — لازم ينكتب بتاريخ التكلفة
const rc2 = await call("POST", `/orders/${po.id}/receive`, {
  lines: [{ line_id: ov.lines[0].id, qty: 4, unit_price: 3.25 },
          { line_id: ov.lines[1].id, qty: 5 }], day: today });
ok(rc2.status === "مستلم", "بعد ما وصل الباقي → الأمر مستلم");
ok(rc2.totals.variance === 0 && rc2.variances.length === 0, "ما ضل ولا فرق");
ok(rc2.totals.value === 42.5, "قيمة الأمر انحدّثت لسعر الاستلام الفعلي (10×3.25 + 5×2)");
ok((await call("DELETE", "/orders/" + po.id)).ok === false, "الأمر اللي فيه استلام ما بينمسح");

// ── (6) الفواتير والمستحق ──
ok((await call("POST", "/bills", { supplier_id: s1.id, order_id: po.id, amount: 42.5, bill_date: today })).ok,
   "انسجّلت فاتورة مربوطة بالأمر");
ok((await call("POST", "/bills", { supplier_id: s1.id, amount: 0 })).ok === false, "فاتورة بصفر بتنرفض");
ok((await call("POST", "/bills", { supplier_id: s2.id, order_id: po.id, amount: 5 })).ok === false,
   "ربط فاتورة بأمر تبع مورد ثاني بينرفض");
await call("POST", "/payments", { supplier_id: s1.id, amount: 20, paid_at: today });
ok((await call("POST", "/payments", { supplier_id: s1.id, amount: 5, method: "بيتكوين" })).ok === false,
   "طريقة دفع غير معروفة بتنرفض");
const dues = await call("GET", "/dues");
const d1 = dues.rows.find(r => r.supplier_id === s1.id);
ok(d1.billed === 42.5 && d1.paid === 20 && d1.due === 22.5, "المستحق = الفواتير − المدفوع");
ok(dues.totals.owed_to === 1, "مورد واحد بس عليك إلو فلوس");
ok(dues.rows.find(r => r.supplier_id === s2.id).due === 0, "مورد بلا فواتير مستحقه صفر فعلي مش تقدير");

// ── (7) التقييم ──
const sc1 = await call("GET", "/scorecard/" + s1.id);
ok(sc1.on_time_rate === 100 && sc1.on_time_basis === 1, "التزام بالموعد 100% من أمر واحد مستلم بموعده");
ok(sc1.short_rate === 0 && sc1.received_qty === 15, "ما في نقص باستلام الأمر الكامل");
ok(sc1.price_change_pct != null && sc1.price_change_items.length >= 1,
   "تغيّر السعر انرصد لأنّ الاستلام إجا بسعر أعلى");
const sc2 = await call("GET", "/scorecard/" + s2.id);
ok(sc2.on_time_rate === null && sc2.short_rate === null && sc2.price_change_pct === null,
   "🔴 مورد بلا أوامر: كل المؤشرات null («ما في بيانات») مش 0%");
ok(sc2.orders === 0 && sc2.received_orders === 0, "عدّاد أوامره صفر حقيقي");
ok((await call("GET", "/scorecard")).ranked.length === 1, "الترتيب بيضم بس اللي إلهم بيانات");

// ── (9) تاريخ التكلفة ──
const ch = await call("GET", "/cost-history?item=" + encodeURIComponent("جبنة نابلسية"));
ok(ch.points >= 3, "تاريخ التكلفة فيه نقاط من قوائم الأسعار ومن الاستلام");
ok(ch.min === 3 && ch.max === 3.4, "أقل وأعلى سعر مسجّل للصنف");
const ch1 = await call("GET", "/cost-history?item=" + encodeURIComponent("لبنة بلدية"));
ok(ch1.points === 2 && ch1.change_pct === 0, "صنف ثابت سعره → تغيّر 0% (نقطتين حقيقيتين)");
const ch0 = await call("GET", "/cost-history?item=" + encodeURIComponent("صنف ما اشتريناه"));
ok(ch0.points === 0 && ch0.change_pct === null,
   "🔴 صنف بلا تاريخ → change_pct = null مش صفر");
ok((await call("GET", "/cost-history")).ok === false, "تاريخ التكلفة بلا اسم صنف بينرفض");

// ── (8) الاقتراح من نواقص حقيقية ──
ok((await call("GET", "/suggest")).ok === false, "الاقتراح بلا وحدة جرد بيعطي رسالة مش انهيار");
const st = await import("../src/features/stock.js");
await new Promise(r => setTimeout(r, 300));
const mk = (name, rop) => {
  db.prepare(`INSERT INTO stock_items (name,unit,barcode,cost,price,reorder_point,shelf_life,active,created_at)
              VALUES (?,'حبة','',0,0,?,0,1,?)`).run(name, rop, Date.now());
  return Number(db.prepare("SELECT id FROM stock_items WHERE name=?").get(name).id);
};
const A = mk("جبنة نابلسية", 20);     // رصيد 4 → ناقص 16
const B = mk("لبنة بلدية", 10);       // رصيد 30 → مش ناقص
const C = mk("زعتر", 8);              // رصيد 0 وبلا سعر مسجّل
st.addMove({ item_id: A, qty: 4, kind: "استلام" });
st.addMove({ item_id: B, qty: 30, kind: "استلام" });

const sug = await call("GET", "/suggest");
ok(sug.ok && sug.rows.length === 2, "الاقتراح أخد الناقصين بس (A و C) وترك B");
const sa = sug.rows.find(r => r.name === "جبنة نابلسية");
ok(sa.suggest_qty === 16, "الكمية المقترحة = حد الطلب 20 − الرصيد 4");
ok(/الرصيد 4/.test(sa.basis) && /حد الطلب 20/.test(sa.basis), "🔴 كل سطر بيقول من وين إجت كميته");
ok(sa.unit_price === 3 && sa.supplier_id === s1.id, "السعر المقترح = أرخص سعر مسجّل فعلاً");
ok(sa.line_total === 48, "قيمة السطر = 16 × 3");
const scz = sug.rows.find(r => r.name === "زعتر");
ok(scz.unit_price === null && /ما في سعر مسجّل/.test(scz.price_note),
   "🔴 صنف بلا سعر مسجّل → السعر null مش صفر");
ok(sug.totals.unpriced === 1 && sug.totals.value === 48,
   "قيمة الاقتراح محسوبة بس على السطور اللي إلها سعر");

const applied = await call("POST", "/suggest/apply", { supplier_id: s1.id });
ok(applied.ok && applied.lines === 1 && applied.skipped === 1,
   "تحويل الاقتراح لأمر أخد الصنف اللي إلو سعر عند المورد وترك الباقي");
const av = await call("GET", "/orders/" + applied.id);
ok(av.totals.value === 48 && /الرصيد 4/.test(av.lines[0].note), "الأمر المقترح بيحمل مصدر كميته بالملاحظة");
const ap2 = await call("POST", "/suggest/apply", { supplier_id: s2.id });
ok(ap2.ok && ap2.lines === 1, "نفس النواقص بتتحوّل لأمر عند المورد الثاني بأسعاره هو");
const s3 = await call("POST", "/suppliers", { name: "مورد بلا أسعار" });
ok((await call("POST", "/suggest/apply", { supplier_id: s3.id })).ok === false,
   "مورد ما إلو أسعار للنواقص → رفض واضح");

// ── (1) الأرشفة بدل المسح ──
const delS = await call("DELETE", "/suppliers/" + s1.id);
ok(delS.archived === true && delS.records > 0, "المورد اللي إلو تاريخ بينوقف مش بينمسح");
ok((await call("DELETE", "/suppliers/9999")).ok === false, "مورد مش موجود بيرجع خطأ");

// ── (10) التصدير ──
const ex = await fetch(`http://127.0.0.1:${port}/p/orders.csv`);
const exBytes = Buffer.from(await ex.arrayBuffer());
ok(exBytes[0] === 0xEF && exBytes[1] === 0xBB && exBytes[2] === 0xBF, "تصدير الأوامر فيه BOM للعربي");
ok(exBytes.toString("utf8").includes("جبنة نابلسية"), "تصدير الأوامر فيه سطور الأصناف");
const exd = await (await fetch(`http://127.0.0.1:${port}/p/dues.csv`)).text();
ok(exd.includes("المستحق عليك") && exd.includes("22.5"), "تصدير المستحقات فيه الرصيد الصحيح");
const exp2 = await (await fetch(`http://127.0.0.1:${port}/p/prices.csv`)).text();
ok(exp2.includes("ألبان الشمال"), "تصدير قائمة الأسعار شغّال");

srv.close();

ok(fs.existsSync("public/features-procure.html"), "صفحة المشتريات موجودة");

wipe();
console.log(`\n${fail ? "🔴" : "🟢"} نجح ${pass} / فشل ${fail}`);
process.exit(fail ? 1 : 0);
