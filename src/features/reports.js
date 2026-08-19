// ═══════════════════════════════════════════════════════════
// 📊 وحدة التقارير المتقدمة (reports)
// 10 ميزات تحليلية: تقرير أسبوعي، شهر بشهر، مقارنة الصفحات،
// مزيج المنتجات، قمع يومي، الإلغاءات، المحافظات، نشاط المحادثات،
// أداء الكوبونات، لوحة KPI تنفيذية
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import { db, retryDb } from "../db/database.js";
import { CONFIG } from "../config.js";

export const slug = "reports";
export const title = "التقارير المتقدمة";
export const icon = "📊";

// ── جدول الوحدة الخاص: أرشيف نسخ التقرير الأسبوعي ──
try {
  db.exec(`CREATE TABLE IF NOT EXISTS reports_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    label TEXT DEFAULT '',
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
} catch (e) { console.error(e.message); }

// ═══════════════ أدوات مساعدة ═══════════════
const TZ = 10800000;           // توقيت الأردن +3 ساعات (ميلي ثانية)
const DAY = 86400000;

function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// نسبة التغيّر % بين قيمتين
function pctChange(cur, prev) {
  cur = Number(cur) || 0; prev = Number(prev) || 0;
  if (prev > 0) return round1(((cur - prev) / prev) * 100);
  return cur > 0 ? 100 : 0;
}

// تفكيك order_string إلى أصناف: "غنم (2 نصية) + لبنة (1 كيلو)"
function parseItems(orderString) {
  const items = [];
  String(orderString || "").split("+").forEach(part => {
    const p = part.trim();
    if (!p) return;
    const m = p.match(/(.+?)\s*\((\d+(?:\.\d+)?)\s*([^)]*)/);
    if (m) items.push({ name: m[1].trim(), qty: parseFloat(m[2]) || 1, unit: (m[3] || "").trim() });
    else items.push({ name: p, qty: 1, unit: "" });
  });
  return items;
}

// بداية شهر (بتوقيت الأردن) بالميلي ثانية — shift بالأشهر (0 = الحالي، -1 = الماضي)
function monthStartMs(shift = 0) {
  const d = new Date(Date.now() + TZ);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + shift, 1) - TZ;
}
// مفتاح شهر YYYY-MM (بتوقيت الأردن)
function monthKey(shift = 0) {
  const d = new Date(Date.now() + TZ);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + shift, 1));
  return t.getUTCFullYear() + "-" + String(t.getUTCMonth() + 1).padStart(2, "0");
}
// بداية يوم (بتوقيت الأردن) — shift بالأيام
function dayStartMs(shift = 0) {
  const d = new Date(Date.now() + TZ);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + shift) - TZ;
}
function dayKeyFromMs(ms) { return new Date(Number(ms) + TZ).toISOString().slice(0, 10); }

// قراءة فترة from/to (YYYY-MM-DD) من الاستعلام — افتراضي آخر defDays يوم
function parsePeriod(req, defDays = 30) {
  const now = Date.now();
  let from = now - defDays * DAY, to = now;
  const f = String((req.query || {}).from || ""), t = String((req.query || {}).to || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(f)) { const ms = Date.parse(f + "T00:00:00+03:00"); if (Number.isFinite(ms)) from = ms; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) { const ms = Date.parse(t + "T23:59:59+03:00"); if (Number.isFinite(ms)) to = ms; }
  if (from > to) { const x = from; from = to; to = x; }
  return { from, to };
}

// استخراج المحافظة من بداية حقل العنوان
const GOVS = ["عمان", "إربد", "اربد", "الزرقاء", "مادبا", "العقبة", "جرش", "عجلون", "المفرق", "الكرك", "الطفيلة", "معان", "السلط"];
function governorate(area) {
  let a = String(area || "").trim().replace(/[ً-ْـ]/g, "");   // إزالة التشكيل والتطويل
  if (!a) return "غير محدد";
  for (const g of GOVS) if (a.startsWith(g)) return g === "اربد" ? "إربد" : g;
  const noAl = a.replace(/^ال/, "");
  for (const g of GOVS) {
    const g2 = g.replace(/^ال/, "");
    if (g2 && noAl.startsWith(g2)) return g === "اربد" ? "إربد" : g;
  }
  return "أخرى";
}

// ── الذكاء الاصطناعي (Gemini) — يرجع نص أو null عند الفشل ──
async function askAI(prompt) {
  // يمرّ من الطبقة الموحّدة — يشتغل بأي مزوّد مربوط (AIsa أو Gemini)
  try {
    const { aiComplete } = await import("../bot/aiCore.js");
    const r = await aiComplete(prompt, { temperature: 0.5, maxTokens: 900, timeoutMs: 40000 });
    if (!r.ok) return null;
    return String(r.text || "").replace(/\*\*/g, "").trim() || null;
  } catch { return null; }
}

export const router = Router();

// ═══════════════════════════════════════════════════════════
// 1) التقرير الأسبوعي (آخر 7 أيام مقابل الأسبوع السابق)
// ═══════════════════════════════════════════════════════════
function computeWeekly() {
  const now = Date.now();
  const curFrom = now - 7 * DAY, prevFrom = now - 14 * DAY;
  const cur = retryDb(() => db.prepare(
    "SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE status != 'ملغي' AND created_at >= ? AND created_at <= ?"
  ).get(curFrom, now));
  const prev = retryDb(() => db.prepare(
    "SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE status != 'ملغي' AND created_at >= ? AND created_at < ?"
  ).get(prevFrom, curFrom));
  const rows = retryDb(() => db.prepare(
    "SELECT order_string, page_name, total FROM orders WHERE status != 'ملغي' AND created_at >= ? LIMIT 5000"
  ).all(curFrom));

  const prodQty = {}, pageAgg = {};
  for (const r of rows) {
    for (const it of parseItems(r.order_string)) {
      if (it.name) prodQty[it.name] = (prodQty[it.name] || 0) + it.qty;
    }
    const p = r.page_name || "غير معروف";
    if (!pageAgg[p]) pageAgg[p] = { orders: 0, sales: 0 };
    pageAgg[p].orders += 1; pageAgg[p].sales += Number(r.total) || 0;
  }
  const bestProduct = Object.entries(prodQty).sort((a, b) => b[1] - a[1])[0] || null;
  const bestPage = Object.entries(pageAgg).sort((a, b) => b[1].sales - a[1].sales)[0] || null;

  const orders = Number(cur.c), sales = round2(cur.s);
  return {
    from: curFrom, to: now,
    current: {
      orders, sales,
      avg: orders ? round2(sales / orders) : 0,
      best_product: bestProduct ? { name: bestProduct[0], qty: round2(bestProduct[1]) } : null,
      best_page: bestPage ? { name: bestPage[0], sales: round2(bestPage[1].sales), orders: bestPage[1].orders } : null
    },
    previous: { orders: Number(prev.c), sales: round2(prev.s) },
    change: { orders_pct: pctChange(cur.c, prev.c), sales_pct: pctChange(cur.s, prev.s) }
  };
}

router.get("/weekly", (req, res) => {
  try { res.json(computeWeekly()); }
  catch (e) { console.error(e); res.status(500).json({ error: "فشل توليد التقرير الأسبوعي" }); }
});

// تحليل ذكي للتقرير الأسبوعي
router.get("/weekly/ai", async (req, res) => {
  try {
    const w = computeWeekly();
    const prompt = "أنت مستشار مبيعات لمتجر أجبان وألبان أردني يبيع عبر ماسنجر. هذه أرقام آخر 7 أيام:\n" +
      `- المبيعات: ${w.current.sales} دينار (${w.change.sales_pct >= 0 ? "+" : ""}${w.change.sales_pct}% عن الأسبوع السابق)\n` +
      `- عدد الطلبات: ${w.current.orders} (${w.change.orders_pct >= 0 ? "+" : ""}${w.change.orders_pct}%)\n` +
      `- متوسط قيمة الطلب: ${w.current.avg} دينار\n` +
      `- أفضل صنف: ${w.current.best_product ? w.current.best_product.name + " (كمية " + w.current.best_product.qty + ")" : "لا يوجد"}\n` +
      `- أفضل صفحة: ${w.current.best_page ? w.current.best_page.name + " (" + w.current.best_page.sales + " دينار)" : "لا يوجد"}\n` +
      "اكتب تحليلاً تنفيذياً موجزاً بالعربية (5-7 أسطر): تقييم الأداء، أهم ملاحظة، وثلاث توصيات عملية قصيرة. بدون مقدمات وبدون تنسيق Markdown.";
    const text = await askAI(prompt);
    if (!text) return res.status(500).json({ error: "تعذّر الاتصال بالذكاء" });
    res.json({ text });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل التحليل الذكي" }); }
});

// حفظ نسخة من التقرير الأسبوعي بالأرشيف
router.post("/weekly/save", (req, res) => {
  try {
    const w = computeWeekly();
    const label = "أسبوع " + dayKeyFromMs(w.from) + " ← " + dayKeyFromMs(w.to);
    const info = retryDb(() => db.prepare(
      "INSERT INTO reports_snapshots (kind, label, data, created_at) VALUES ('weekly', ?, ?, ?)"
    ).run(label, JSON.stringify(w).slice(0, 12000), Date.now()));
    res.json({ ok: true, id: Number(info.lastInsertRowid), label });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل حفظ النسخة" }); }
});

router.get("/weekly/snapshots", (req, res) => {
  try {
    const rows = retryDb(() => db.prepare(
      "SELECT id, label, data, created_at FROM reports_snapshots WHERE kind = 'weekly' ORDER BY created_at DESC LIMIT 50"
    ).all());
    const snapshots = rows.map(r => {
      let d = {}; try { d = JSON.parse(r.data); } catch { /* تجاهل */ }
      return { id: Number(r.id), label: r.label, created_at: Number(r.created_at),
        sales: d.current ? d.current.sales : 0, orders: d.current ? d.current.orders : 0 };
    });
    res.json({ snapshots });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل جلب الأرشيف" }); }
});

router.delete("/weekly/snapshots/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "رقم غير صالح" });
    retryDb(() => db.prepare("DELETE FROM reports_snapshots WHERE id = ? AND kind = 'weekly'").run(id));
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل حذف النسخة" }); }
});

// ═══════════════════════════════════════════════════════════
// 2) مقارنة شهر بشهر — آخر 6 أشهر
// ═══════════════════════════════════════════════════════════
router.get("/monthly", (req, res) => {
  try {
    const from = monthStartMs(-5);
    const rows = retryDb(() => db.prepare(
      `SELECT strftime('%Y-%m',(created_at/1000)+10800,'unixepoch') ym,
              COUNT(*) c, COALESCE(SUM(total),0) s
       FROM orders WHERE status != 'ملغي' AND created_at >= ?
       GROUP BY ym ORDER BY ym`
    ).all(from));
    const map = {};
    for (const r of rows) map[r.ym] = { orders: Number(r.c), sales: round2(r.s) };
    const months = [];
    for (let i = -5; i <= 0; i++) {
      const key = monthKey(i);
      const m = map[key] || { orders: 0, sales: 0 };
      months.push({ ym: key, orders: m.orders, sales: m.sales });
    }
    for (let i = 1; i < months.length; i++) {
      months[i].change_pct = pctChange(months[i].sales, months[i - 1].sales);
    }
    months[0].change_pct = null;
    res.json({ months });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل توليد المقارنة الشهرية" }); }
});

// ═══════════════════════════════════════════════════════════
// 3) مقارنة الصفحات: هذا الشهر مقابل الشهر الماضي
// ═══════════════════════════════════════════════════════════
router.get("/pages", (req, res) => {
  try {
    const from = monthStartMs(-1);
    const ymCur = monthKey(0), ymPrev = monthKey(-1);
    const rows = retryDb(() => db.prepare(
      `SELECT COALESCE(NULLIF(page_name,''),'غير معروف') pn,
              strftime('%Y-%m',(created_at/1000)+10800,'unixepoch') ym,
              COUNT(*) c, COALESCE(SUM(total),0) s
       FROM orders WHERE status != 'ملغي' AND created_at >= ?
       GROUP BY pn, ym`
    ).all(from));
    const byPage = {};
    for (const r of rows) {
      if (!byPage[r.pn]) byPage[r.pn] = { page_name: r.pn, cur_orders: 0, cur_sales: 0, prev_orders: 0, prev_sales: 0 };
      if (r.ym === ymCur) { byPage[r.pn].cur_orders = Number(r.c); byPage[r.pn].cur_sales = round2(r.s); }
      else if (r.ym === ymPrev) { byPage[r.pn].prev_orders = Number(r.c); byPage[r.pn].prev_sales = round2(r.s); }
    }
    const pages = Object.values(byPage).map(p => ({ ...p, change_pct: pctChange(p.cur_sales, p.prev_sales) }))
      .sort((a, b) => b.cur_sales - a.cur_sales);
    res.json({ this_month: ymCur, last_month: ymPrev, pages });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل مقارنة الصفحات" }); }
});

// ═══════════════════════════════════════════════════════════
// 4) مزيج المنتجات: حصة كل صنف (كمية وقيمة و%) بفترة قابلة للاختيار
// ═══════════════════════════════════════════════════════════
router.get("/product-mix", (req, res) => {
  try {
    const { from, to } = parsePeriod(req, 30);
    const rows = retryDb(() => db.prepare(
      "SELECT order_string, total FROM orders WHERE status != 'ملغي' AND created_at >= ? AND created_at <= ? LIMIT 8000"
    ).all(from, to));
    const agg = {};
    let totalSales = 0, totalQty = 0;
    for (const r of rows) {
      const items = parseItems(r.order_string).filter(it => it.name);
      const qtySum = items.reduce((a, it) => a + it.qty, 0);
      const orderTotal = Number(r.total) || 0;
      totalSales += orderTotal;
      for (const it of items) {
        if (!agg[it.name]) agg[it.name] = { name: it.name, qty: 0, value: 0, orders: 0 };
        agg[it.name].qty += it.qty;
        agg[it.name].orders += 1;
        // توزيع قيمة الطلب على أصنافه بنسبة الكمية (تقدير)
        agg[it.name].value += qtySum > 0 ? orderTotal * (it.qty / qtySum) : 0;
        totalQty += it.qty;
      }
    }
    const items = Object.values(agg).map(x => ({
      name: x.name, qty: round2(x.qty), value: round2(x.value), orders: x.orders,
      qty_pct: totalQty > 0 ? round1(x.qty / totalQty * 100) : 0,
      value_pct: totalSales > 0 ? round1(x.value / totalSales * 100) : 0
    })).sort((a, b) => b.value - a.value);
    res.json({ from, to, orders_count: rows.length, total_sales: round2(totalSales), total_qty: round2(totalQty), items });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل تحليل مزيج المنتجات" }); }
});

// ═══════════════════════════════════════════════════════════
// 5) القمع اليومي: بدأت / اكتملت / ألغيت — آخر 14 يوم
// ═══════════════════════════════════════════════════════════
router.get("/funnel", (req, res) => {
  try {
    const since = dayStartMs(-13);
    const rows = retryDb(() => db.prepare(
      `SELECT date((created_at/1000)+10800,'unixepoch') d,
              COUNT(*) started,
              SUM(CASE WHEN status = 'تم التسليم' THEN 1 ELSE 0 END) completed,
              SUM(CASE WHEN status = 'ملغي' THEN 1 ELSE 0 END) canceled
       FROM orders WHERE created_at >= ? GROUP BY d ORDER BY d`
    ).all(since));
    const map = {};
    for (const r of rows) map[r.d] = { started: Number(r.started), completed: Number(r.completed), canceled: Number(r.canceled) };
    const days = [];
    let tot = { started: 0, completed: 0, canceled: 0 };
    for (let i = -13; i <= 0; i++) {
      const key = dayKeyFromMs(dayStartMs(i));
      const v = map[key] || { started: 0, completed: 0, canceled: 0 };
      tot.started += v.started; tot.completed += v.completed; tot.canceled += v.canceled;
      days.push({ d: key, ...v });
    }
    res.json({ days, totals: tot,
      completion_pct: tot.started > 0 ? round1(tot.completed / tot.started * 100) : 0,
      cancel_pct: tot.started > 0 ? round1(tot.canceled / tot.started * 100) : 0 });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل توليد القمع اليومي" }); }
});

// ═══════════════════════════════════════════════════════════
// 6) تحليل الإلغاءات: العدد والنسبة والأسباب المسجلة
// ═══════════════════════════════════════════════════════════
router.get("/cancellations", (req, res) => {
  try {
    const { from, to } = parsePeriod(req, 30);
    const all = retryDb(() => db.prepare(
      "SELECT COUNT(*) c FROM orders WHERE created_at >= ? AND created_at <= ?"
    ).get(from, to));
    const canceled = retryDb(() => db.prepare(
      "SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE status = 'ملغي' AND created_at >= ? AND created_at <= ?"
    ).get(from, to));
    const reasonRows = retryDb(() => db.prepare(
      `SELECT COALESCE(TRIM(cancel_reason),'') reason, COUNT(*) c
       FROM orders WHERE status = 'ملغي' AND created_at >= ? AND created_at <= ?
       GROUP BY reason ORDER BY c DESC LIMIT 100`
    ).all(from, to));
    let noReason = 0;
    const reasons = [];
    for (const r of reasonRows) {
      if (!r.reason) noReason += Number(r.c);
      else reasons.push({ reason: r.reason, count: Number(r.c) });
    }
    const total = Number(all.c), cnc = Number(canceled.c);
    res.json({ from, to, total_orders: total, canceled: cnc,
      lost_value: round2(canceled.s),
      cancel_pct: total > 0 ? round1(cnc / total * 100) : 0,
      reasons, no_reason: noReason });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل تحليل الإلغاءات" }); }
});

// ═══════════════════════════════════════════════════════════
// 7) ترتيب المحافظات: من بداية حقل العنوان
// ═══════════════════════════════════════════════════════════
router.get("/governorates", (req, res) => {
  try {
    const { from, to } = parsePeriod(req, 30);
    const rows = retryDb(() => db.prepare(
      "SELECT area, total FROM orders WHERE status != 'ملغي' AND created_at >= ? AND created_at <= ? LIMIT 8000"
    ).all(from, to));
    const agg = {};
    let totalOrders = 0;
    for (const r of rows) {
      const g = governorate(r.area);
      if (!agg[g]) agg[g] = { gov: g, orders: 0, sales: 0 };
      agg[g].orders += 1;
      agg[g].sales += Number(r.total) || 0;
      totalOrders += 1;
    }
    const govs = Object.values(agg).map(x => ({
      gov: x.gov, orders: x.orders, sales: round2(x.sales),
      pct: totalOrders > 0 ? round1(x.orders / totalOrders * 100) : 0
    })).sort((a, b) => b.orders - a.orders);
    res.json({ from, to, total_orders: totalOrders, govs });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل ترتيب المحافظات" }); }
});

// ═══════════════════════════════════════════════════════════
// 8) نشاط المحادثات: وارد/صادر يومياً + نسبة التحويل لطلب — آخر 14 يوم
// ═══════════════════════════════════════════════════════════
router.get("/chats", (req, res) => {
  try {
    const since = dayStartMs(-13);
    const rows = retryDb(() => db.prepare(
      `SELECT date((created_at/1000)+10800,'unixepoch') d,
              SUM(CASE WHEN direction = 'in' THEN 1 ELSE 0 END) inbound,
              SUM(CASE WHEN direction = 'out' THEN 1 ELSE 0 END) outbound
       FROM messages WHERE created_at >= ? GROUP BY d ORDER BY d`
    ).all(since));
    const map = {};
    for (const r of rows) map[r.d] = { inbound: Number(r.inbound), outbound: Number(r.outbound) };
    const days = [];
    let totIn = 0, totOut = 0;
    for (let i = -13; i <= 0; i++) {
      const key = dayKeyFromMs(dayStartMs(i));
      const v = map[key] || { inbound: 0, outbound: 0 };
      totIn += v.inbound; totOut += v.outbound;
      days.push({ d: key, ...v });
    }
    const conv = retryDb(() => db.prepare(
      "SELECT COUNT(DISTINCT page_id || '_' || sender_id) c FROM messages WHERE created_at >= ? AND direction = 'in'"
    ).get(since));
    const converted = retryDb(() => db.prepare(
      `SELECT COUNT(DISTINCT m.page_id || '_' || m.sender_id) c
       FROM (SELECT DISTINCT page_id, sender_id FROM messages WHERE created_at >= ? AND direction = 'in') m
       WHERE EXISTS (SELECT 1 FROM orders o WHERE o.page_id = m.page_id AND o.sender_id = m.sender_id AND o.created_at >= ?)`
    ).get(since, since));
    const convCount = Number(conv.c), convertedCount = Number(converted.c);
    res.json({ days, total_in: totIn, total_out: totOut,
      conversations: convCount, converted: convertedCount,
      conversion_pct: convCount > 0 ? round1(Math.min(100, convertedCount / convCount * 100)) : 0 });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل تحليل نشاط المحادثات" }); }
});

// ═══════════════════════════════════════════════════════════
// 9) أداء الكوبونات: الاستخدامات + تقدير الخصم الممنوح
// ═══════════════════════════════════════════════════════════
router.get("/coupons", (req, res) => {
  try {
    const coupons = retryDb(() => db.prepare(
      "SELECT code, type, value, active, uses, created_at FROM coupons ORDER BY uses DESC, created_at DESC LIMIT 300"
    ).all());
    const avgRow = retryDb(() => db.prepare(
      "SELECT COALESCE(AVG(total),0) a FROM orders WHERE status != 'ملغي' AND total > 0"
    ).get());
    const avgOrder = round2(avgRow.a);
    let totalUses = 0, totalDiscount = 0;
    const list = coupons.map(c => {
      const uses = Number(c.uses) || 0;
      const value = Number(c.value) || 0;
      const est = c.type === "percent" ? round2(uses * avgOrder * (value / 100)) : round2(uses * value);
      totalUses += uses; totalDiscount += est;
      return { code: c.code, type: c.type, value, active: Number(c.active) ? 1 : 0, uses,
        discount_est: est, created_at: Number(c.created_at) || 0 };
    });
    res.json({ coupons: list, avg_order: avgOrder, total_uses: totalUses, total_discount: round2(totalDiscount) });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل تحليل الكوبونات" }); }
});

// ═══════════════════════════════════════════════════════════
// 10) لوحة KPI تنفيذية: 8 مؤشرات لهذا الشهر
// ═══════════════════════════════════════════════════════════
router.get("/kpi", (req, res) => {
  try {
    const curFrom = monthStartMs(0), prevFrom = monthStartMs(-1);
    const now = Date.now();
    const cur = retryDb(() => db.prepare(
      "SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE status != 'ملغي' AND created_at >= ?"
    ).get(curFrom));
    const prev = retryDb(() => db.prepare(
      "SELECT COALESCE(SUM(total),0) s FROM orders WHERE status != 'ملغي' AND created_at >= ? AND created_at < ?"
    ).get(prevFrom, curFrom));
    const statusRow = retryDb(() => db.prepare(
      `SELECT COUNT(*) allc,
              SUM(CASE WHEN status = 'تم التسليم' THEN 1 ELSE 0 END) delivered,
              SUM(CASE WHEN status = 'ملغي' THEN 1 ELSE 0 END) canceled
       FROM orders WHERE created_at >= ?`
    ).get(curFrom));
    const rows = retryDb(() => db.prepare(
      "SELECT order_string, area FROM orders WHERE status != 'ملغي' AND created_at >= ? LIMIT 8000"
    ).all(curFrom));

    const prodQty = {}, govCount = {};
    for (const r of rows) {
      for (const it of parseItems(r.order_string)) {
        if (it.name) prodQty[it.name] = (prodQty[it.name] || 0) + it.qty;
      }
      const g = governorate(r.area);
      if (g !== "غير محدد") govCount[g] = (govCount[g] || 0) + 1;
    }
    const bestProduct = Object.entries(prodQty).sort((a, b) => b[1] - a[1])[0] || null;
    const bestArea = Object.entries(govCount).sort((a, b) => b[1] - a[1])[0] || null;

    const orders = Number(cur.c), sales = round2(cur.s);
    const allCount = Number(statusRow.allc), delivered = Number(statusRow.delivered), canceled = Number(statusRow.canceled);
    const daysElapsed = Math.max(1, new Date(now + TZ).getUTCDate());

    res.json({
      month: monthKey(0),
      sales,
      growth_pct: pctChange(sales, prev.s),
      avg_order: orders > 0 ? round2(sales / orders) : 0,
      completion_pct: allCount > 0 ? round1(delivered / allCount * 100) : 0,
      cancel_pct: allCount > 0 ? round1(canceled / allCount * 100) : 0,
      orders_per_day: round1(orders / daysElapsed),
      orders,
      best_product: bestProduct ? bestProduct[0] : null,
      best_area: bestArea ? bestArea[0] : null
    });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل توليد لوحة المؤشرات" }); }
});
