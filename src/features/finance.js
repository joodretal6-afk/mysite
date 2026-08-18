// ═══════════════════════════════════════════════════════════
// 💰 وحدة المالية والأرباح — 10 ميزات
// دفتر مصاريف، صافي الربح، تسوية يومية، عهدة السائقين،
// تقرير شهري، تكلفة اكتساب الطلب، نقطة التعادل، توقع بسيط،
// أهداف ربح شهرية، تصدير CSV
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import { db, retryDb } from "../db/database.js";

export const slug = "finance";
export const title = "المالية والأرباح";
export const icon = "💰";

// ── جداول الوحدة (finance_ فقط) ──
try {
  db.exec(`CREATE TABLE IF NOT EXISTS finance_expenses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    category   TEXT NOT NULL,
    amount     REAL NOT NULL,
    note       TEXT DEFAULT '',
    spent_at   INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`);
} catch (e) { console.error(e.message); }

try {
  db.exec(`CREATE TABLE IF NOT EXISTS finance_recon (
    day        TEXT PRIMARY KEY,
    expected   REAL NOT NULL DEFAULT 0,
    received   REAL NOT NULL DEFAULT 0,
    note       TEXT DEFAULT '',
    updated_at INTEGER
  )`);
} catch (e) { console.error(e.message); }

try {
  db.exec(`CREATE TABLE IF NOT EXISTS finance_goals (
    month      TEXT PRIMARY KEY,
    target     REAL NOT NULL,
    updated_at INTEGER
  )`);
} catch (e) { console.error(e.message); }

// ── ثوابت ومساعدات ──
const CATS = ["إعلانات", "تغليف", "توصيل", "بضاعة", "أخرى"];
const DONE = "status NOT IN ('ملغي','ناقص')";   // طلب "مكتمل" = نفس تعريف المنصة
const DAY_MS = 86400000;
const TZ_MS = 10800 * 1000;                      // نفس إزاحة المنصة (+3 ساعات)

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

// "YYYY-MM-DD" → بداية اليوم بالمللي (بتوقيت المنصة)
function dayStart(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]) - TZ_MS;
  return Number.isFinite(t) ? t : null;
}

// نطاق الفترة من كويري from/to (وإلا: آخر defDays يوماً)
function rangeOf(req, defDays) {
  const f = dayStart(req.query.from);
  const t = dayStart(req.query.to);
  const to = t != null ? t + DAY_MS - 1 : Date.now();
  const from = f != null ? f : to - defDays * DAY_MS + 1;
  return { from, to };
}

// "YYYY-MM" → نطاق الشهر بالمللي
function monthRange(ym) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(ym || "").trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2];
  return { from: Date.UTC(y, mo - 1, 1) - TZ_MS, to: Date.UTC(y, mo, 1) - TZ_MS - 1 };
}

// آخر n أشهر ["2026-08", "2026-07", ...]
function lastMonths(n) {
  const out = [];
  const now = new Date(Date.now() + TZ_MS);
  let y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  for (let i = 0; i < n; i++) {
    out.push(y + "-" + String(m).padStart(2, "0"));
    m--; if (m === 0) { m = 12; y--; }
  }
  return out;
}

// اليوم الحالي "YYYY-MM-DD" بتوقيت المنصة
function todayStr() {
  return new Date(Date.now() + TZ_MS).toISOString().slice(0, 10);
}

// تفكيك order_string: "غنم (2 نصية) + لبنة (1 كيلو)" — نفس منطق المنصة
function parseItems(orderString) {
  const items = [];
  for (const part of String(orderString || "").split("+")) {
    const m = part.match(/(.+?)\s*\((\d+(?:\.\d+)?)/);
    if (m) items.push({ name: m[1].trim(), qty: parseFloat(m[2]) || 0 });
  }
  return items;
}

// خريطة تكاليف المنتجات من جدول product_costs الموجود
function costMap() {
  const map = {};
  const rows = retryDb(() => db.prepare("SELECT product, cost FROM product_costs").all());
  for (const r of rows) map[r.product] = Number(r.cost) || 0;
  return map;
}

// الملخص المالي لفترة: إيرادات مكتملة − تكلفة بضاعة − مصاريف = صافي
function financeSummary(fromMs, toMs) {
  const rows = retryDb(() => db.prepare(
    `SELECT order_string, total FROM orders WHERE ${DONE} AND created_at >= ? AND created_at <= ? LIMIT 20000`
  ).all(fromMs, toMs));
  const costs = costMap();
  let revenue = 0, cogs = 0;
  const missing = new Set();
  for (const r of rows) {
    revenue += Number(r.total) || 0;
    for (const it of parseItems(r.order_string)) {
      if (costs[it.name] != null) cogs += costs[it.name] * it.qty;
      else if (it.name) missing.add(it.name);
    }
  }
  const exp = retryDb(() => db.prepare(
    "SELECT COALESCE(SUM(amount),0) s FROM finance_expenses WHERE spent_at >= ? AND spent_at <= ?"
  ).get(fromMs, toMs));
  const expenses = Number(exp && exp.s) || 0;
  return {
    revenue: r2(revenue), cogs: r2(cogs), expenses: r2(expenses),
    net: r2(revenue - cogs - expenses), orders: rows.length,
    missing_costs: [...missing].slice(0, 30)
  };
}

// التقرير الشهري بآخر n أشهر (تُستخدم بالتقرير والتصدير)
function monthlyReport(n) {
  return lastMonths(n).map((ym) => {
    const r = monthRange(ym);
    const s = financeSummary(r.from, r.to);
    return { month: ym, revenue: s.revenue, cogs: s.cogs, expenses: s.expenses, net: s.net, orders: s.orders };
  });
}

// CSV مع BOM
function sendCsv(res, filename, headerCols, rows) {
  const escCell = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const lines = [headerCols.map(escCell).join(",")];
  for (const r of rows) lines.push(r.map(escCell).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="' + filename + '"');
  res.send("\uFEFF" + lines.join("\r\n"));
}

export const router = Router();

// ───────────────────────────────────────────────
// (1) دفتر المصاريف — CRUD
// ───────────────────────────────────────────────
router.get("/expenses", (req, res) => {
  try {
    const { from, to } = rangeOf(req, 30);
    const cat = String(req.query.category || "").trim();
    const catCond = CATS.includes(cat) ? "AND category = @cat" : "";
    const params = { from, to };
    if (catCond) params.cat = cat;
    const rows = retryDb(() => db.prepare(
      `SELECT id, category, amount, note, spent_at, created_at
       FROM finance_expenses WHERE spent_at >= @from AND spent_at <= @to ${catCond}
       ORDER BY spent_at DESC, id DESC LIMIT 500`
    ).all(params));
    const byCat = retryDb(() => db.prepare(
      `SELECT category, COALESCE(SUM(amount),0) s, COUNT(*) c
       FROM finance_expenses WHERE spent_at >= @from AND spent_at <= @to ${catCond}
       GROUP BY category ORDER BY s DESC`
    ).all(params));
    const total = r2(byCat.reduce((a, x) => a + (Number(x.s) || 0), 0));
    res.json({ expenses: rows, by_category: byCat, total, categories: CATS });
  } catch (e) {
    console.error("finance/expenses:", e.message);
    res.status(500).json({ error: "تعذّر جلب دفتر المصاريف" });
  }
});

router.post("/expenses", (req, res) => {
  try {
    const b = req.body || {};
    const category = String(b.category || "").trim();
    const amount = Number(b.amount);
    const note = String(b.note || "").trim().slice(0, 500);
    if (!CATS.includes(category)) return res.status(400).json({ error: "الفئة غير صحيحة — اختر من: " + CATS.join("، ") });
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "المبلغ يجب أن يكون رقماً أكبر من صفر" });
    const spent = dayStart(b.spent_at) ?? dayStart(todayStr());
    retryDb(() => db.prepare(
      "INSERT INTO finance_expenses (category, amount, note, spent_at, created_at) VALUES (?,?,?,?,?)"
    ).run(category, r2(amount), note, spent, Date.now()));
    res.json({ ok: true });
  } catch (e) {
    console.error("finance/expenses add:", e.message);
    res.status(500).json({ error: "تعذّر حفظ المصروف" });
  }
});

router.put("/expenses/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "رقم المصروف غير صحيح" });
    const b = req.body || {};
    const category = String(b.category || "").trim();
    const amount = Number(b.amount);
    const note = String(b.note || "").trim().slice(0, 500);
    if (!CATS.includes(category)) return res.status(400).json({ error: "الفئة غير صحيحة" });
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "المبلغ يجب أن يكون رقماً أكبر من صفر" });
    const spent = dayStart(b.spent_at);
    if (spent == null) return res.status(400).json({ error: "التاريخ غير صحيح (YYYY-MM-DD)" });
    const r = retryDb(() => db.prepare(
      "UPDATE finance_expenses SET category=?, amount=?, note=?, spent_at=? WHERE id=?"
    ).run(category, r2(amount), note, spent, id));
    if (!r.changes) return res.status(400).json({ error: "المصروف غير موجود" });
    res.json({ ok: true });
  } catch (e) {
    console.error("finance/expenses edit:", e.message);
    res.status(500).json({ error: "تعذّر تعديل المصروف" });
  }
});

router.delete("/expenses/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "رقم المصروف غير صحيح" });
    const r = retryDb(() => db.prepare("DELETE FROM finance_expenses WHERE id=?").run(id));
    if (!r.changes) return res.status(400).json({ error: "المصروف غير موجود" });
    res.json({ ok: true });
  } catch (e) {
    console.error("finance/expenses del:", e.message);
    res.status(500).json({ error: "تعذّر حذف المصروف" });
  }
});

// ───────────────────────────────────────────────
// (2) صافي الربح الفعلي بالفترة
// ───────────────────────────────────────────────
router.get("/profit", (req, res) => {
  try {
    const { from, to } = rangeOf(req, 30);
    res.json({ from, to, ...financeSummary(from, to) });
  } catch (e) {
    console.error("finance/profit:", e.message);
    res.status(500).json({ error: "تعذّر حساب صافي الربح" });
  }
});

// ───────────────────────────────────────────────
// (3) التسوية اليومية — المتوقع مقابل المستلم
// ───────────────────────────────────────────────
function expectedOfDay(day) {
  const start = dayStart(day);
  if (start == null) return null;
  const row = retryDb(() => db.prepare(
    "SELECT COALESCE(SUM(total),0) s, COUNT(*) c FROM orders WHERE status='تم التسليم' AND created_at >= ? AND created_at <= ?"
  ).get(start, start + DAY_MS - 1));
  return { expected: r2(row && row.s), count: Number(row && row.c) || 0 };
}

router.get("/recon", (req, res) => {
  try {
    const day = String(req.query.day || todayStr()).trim();
    const exp = expectedOfDay(day);
    if (!exp) return res.status(400).json({ error: "التاريخ غير صحيح (YYYY-MM-DD)" });
    const saved = retryDb(() => db.prepare(
      "SELECT day, expected, received, note, updated_at FROM finance_recon WHERE day = ?"
    ).get(day)) || null;
    res.json({ day, expected: exp.expected, delivered_count: exp.count, saved });
  } catch (e) {
    console.error("finance/recon:", e.message);
    res.status(500).json({ error: "تعذّر جلب بيانات التسوية" });
  }
});

router.post("/recon", (req, res) => {
  try {
    const b = req.body || {};
    const day = String(b.day || "").trim();
    const exp = expectedOfDay(day);
    if (!exp) return res.status(400).json({ error: "التاريخ غير صحيح (YYYY-MM-DD)" });
    const received = Number(b.received);
    if (!Number.isFinite(received) || received < 0) return res.status(400).json({ error: "المبلغ المستلم يجب أن يكون رقماً صفراً أو أكثر" });
    const note = String(b.note || "").trim().slice(0, 500);
    retryDb(() => db.prepare(
      `INSERT INTO finance_recon (day, expected, received, note, updated_at) VALUES (?,?,?,?,?)
       ON CONFLICT(day) DO UPDATE SET expected=excluded.expected, received=excluded.received, note=excluded.note, updated_at=excluded.updated_at`
    ).run(day, exp.expected, r2(received), note, Date.now()));
    res.json({ ok: true, expected: exp.expected, diff: r2(received - exp.expected) });
  } catch (e) {
    console.error("finance/recon save:", e.message);
    res.status(500).json({ error: "تعذّر حفظ التسوية" });
  }
});

router.get("/recon/list", (req, res) => {
  try {
    const rows = retryDb(() => db.prepare(
      "SELECT day, expected, received, note, updated_at FROM finance_recon ORDER BY day DESC LIMIT 30"
    ).all());
    res.json({ recons: rows.map((r) => ({ ...r, diff: r2((Number(r.received) || 0) - (Number(r.expected) || 0)) })) });
  } catch (e) {
    console.error("finance/recon list:", e.message);
    res.status(500).json({ error: "تعذّر جلب سجل التسويات" });
  }
});

// ───────────────────────────────────────────────
// (4) عهدة السائقين — تكامل مع وحدة عمليات الطلبات إن وُجدت
// ───────────────────────────────────────────────
router.get("/drivers-custody", (req, res) => {
  try {
    const rows = retryDb(() => db.prepare(`
      SELECT d.id, d.name, d.phone,
             COALESCE(SUM(CASE WHEN o.status='تم التسليم' THEN o.total ELSE 0 END),0) delivered_cash,
             COALESCE(SUM(CASE WHEN o.status='تم التسليم' THEN 1 ELSE 0 END),0)       delivered_cnt,
             COALESCE(SUM(CASE WHEN o.status='تم الشحن'  THEN o.total ELSE 0 END),0)  shipped_cash,
             COALESCE(SUM(CASE WHEN o.status='تم الشحن'  THEN 1 ELSE 0 END),0)        shipped_cnt
      FROM ordersops_drivers d
      LEFT JOIN ordersops_assign a ON a.driver_id = d.id
      LEFT JOIN orders o ON o.id = a.order_id
      GROUP BY d.id ORDER BY delivered_cash DESC LIMIT 200
    `).all());
    const totals = rows.reduce((t, r) => ({
      delivered_cash: r2(t.delivered_cash + (Number(r.delivered_cash) || 0)),
      shipped_cash: r2(t.shipped_cash + (Number(r.shipped_cash) || 0))
    }), { delivered_cash: 0, shipped_cash: 0 });
    res.json({ drivers: rows, totals });
  } catch (e) {
    console.error("finance/drivers-custody:", e.message);
    res.status(400).json({ error: "وحدة السائقين (عمليات الطلبات) غير مفعّلة بعد — فعّلها أولاً لعرض العُهد" });
  }
});

// ───────────────────────────────────────────────
// (5) التقرير الشهري المالي — آخر 6 أشهر
// ───────────────────────────────────────────────
router.get("/monthly", (req, res) => {
  try {
    res.json({ months: monthlyReport(6) });
  } catch (e) {
    console.error("finance/monthly:", e.message);
    res.status(500).json({ error: "تعذّر إعداد التقرير الشهري" });
  }
});

// ───────────────────────────────────────────────
// (6) تكلفة اكتساب الطلب (CPA)
// ───────────────────────────────────────────────
router.get("/cpa", (req, res) => {
  try {
    const { from, to } = rangeOf(req, 30);
    const ads = retryDb(() => db.prepare(
      "SELECT COALESCE(SUM(amount),0) s FROM finance_expenses WHERE category='إعلانات' AND spent_at >= ? AND spent_at <= ?"
    ).get(from, to));
    const ord = retryDb(() => db.prepare(
      `SELECT COUNT(*) c FROM orders WHERE ${DONE} AND created_at >= ? AND created_at <= ?`
    ).get(from, to));
    const adsSpend = r2(ads && ads.s);
    const orders = Number(ord && ord.c) || 0;
    res.json({
      from, to, ads_spend: adsSpend, orders,
      cpa: orders > 0 ? r2(adsSpend / orders) : null,
      note: orders > 0 ? null : "لا توجد طلبات مكتملة بهذه الفترة لحساب التكلفة"
    });
  } catch (e) {
    console.error("finance/cpa:", e.message);
    res.status(500).json({ error: "تعذّر حساب تكلفة اكتساب الطلب" });
  }
});

// ───────────────────────────────────────────────
// (7) نقطة التعادل — كم طلباً يغطي مصروفاً إعلانياً مخططاً؟
// ───────────────────────────────────────────────
router.get("/breakeven", (req, res) => {
  try {
    const spend = Number(req.query.spend);
    if (!Number.isFinite(spend) || spend <= 0) return res.status(400).json({ error: "أدخل مبلغ الإعلان المخطط (رقم أكبر من صفر)" });
    const days = 90;
    const to = Date.now();
    const from = to - days * DAY_MS;
    const s = financeSummary(from, to);
    if (!s.orders) return res.status(400).json({ error: "لا توجد طلبات مكتملة بآخر 90 يوماً لحساب متوسط الهامش" });
    const margin = r2((s.revenue - s.cogs) / s.orders);   // هامش الطلب قبل المصاريف العامة
    if (margin <= 0) return res.status(400).json({ error: "متوسط هامش الطلب صفر أو سالب — راجع تكاليف المنتجات أولاً" });
    res.json({
      spend: r2(spend), avg_margin: margin,
      orders_needed: Math.ceil(spend / margin),
      based_on_days: days, based_on_orders: s.orders
    });
  } catch (e) {
    console.error("finance/breakeven:", e.message);
    res.status(500).json({ error: "تعذّر حساب نقطة التعادل" });
  }
});

// ───────────────────────────────────────────────
// (8) توقع بسيط — متوسط آخر 30 يوماً × 7 و× 30
// ───────────────────────────────────────────────
router.get("/forecast", (req, res) => {
  try {
    const to = Date.now();
    const from = to - 30 * DAY_MS;
    const row = retryDb(() => db.prepare(
      `SELECT COALESCE(SUM(total),0) s, COUNT(*) c FROM orders WHERE ${DONE} AND created_at >= ? AND created_at <= ?`
    ).get(from, to));
    const total = Number(row && row.s) || 0;
    const orders = Number(row && row.c) || 0;
    const dailyAvg = r2(total / 30);
    res.json({
      window_days: 30, total_sales: r2(total), orders,
      daily_avg: dailyAvg, week_forecast: r2(dailyAvg * 7), month_forecast: r2(dailyAvg * 30),
      disclaimer: "توقع تقديري مبني على متوسط آخر 30 يوماً فقط — ليس ضماناً للمبيعات الفعلية"
    });
  } catch (e) {
    console.error("finance/forecast:", e.message);
    res.status(500).json({ error: "تعذّر حساب التوقع" });
  }
});

// ───────────────────────────────────────────────
// (9) أهداف الربح الشهرية + التقدم الفعلي
// ───────────────────────────────────────────────
router.get("/goals", (req, res) => {
  try {
    const rows = retryDb(() => db.prepare(
      "SELECT month, target, updated_at FROM finance_goals ORDER BY month DESC LIMIT 12"
    ).all());
    const goals = rows.map((g) => {
      const r = monthRange(g.month);
      const s = r ? financeSummary(r.from, r.to) : { net: 0 };
      const target = Number(g.target) || 0;
      return {
        month: g.month, target: r2(target), actual_net: s.net,
        progress_pct: target > 0 ? Math.round(Math.max(0, s.net) / target * 100) : null,
        updated_at: g.updated_at
      };
    });
    res.json({ goals, current_month: lastMonths(1)[0] });
  } catch (e) {
    console.error("finance/goals:", e.message);
    res.status(500).json({ error: "تعذّر جلب أهداف الربح" });
  }
});

router.post("/goals", (req, res) => {
  try {
    const b = req.body || {};
    const month = String(b.month || "").trim();
    if (!monthRange(month)) return res.status(400).json({ error: "الشهر غير صحيح (YYYY-MM)" });
    const target = Number(b.target);
    if (!Number.isFinite(target) || target <= 0) return res.status(400).json({ error: "الهدف يجب أن يكون رقماً أكبر من صفر" });
    retryDb(() => db.prepare(
      `INSERT INTO finance_goals (month, target, updated_at) VALUES (?,?,?)
       ON CONFLICT(month) DO UPDATE SET target=excluded.target, updated_at=excluded.updated_at`
    ).run(month, r2(target), Date.now()));
    res.json({ ok: true });
  } catch (e) {
    console.error("finance/goals save:", e.message);
    res.status(500).json({ error: "تعذّر حفظ الهدف" });
  }
});

router.delete("/goals/:month", (req, res) => {
  try {
    const month = String(req.params.month || "").trim();
    const r = retryDb(() => db.prepare("DELETE FROM finance_goals WHERE month=?").run(month));
    if (!r.changes) return res.status(400).json({ error: "لا يوجد هدف لهذا الشهر" });
    res.json({ ok: true });
  } catch (e) {
    console.error("finance/goals del:", e.message);
    res.status(500).json({ error: "تعذّر حذف الهدف" });
  }
});

// ───────────────────────────────────────────────
// (10) تصدير مالي CSV (بترويسة BOM)
// ───────────────────────────────────────────────
router.get("/export/expenses.csv", (req, res) => {
  try {
    const rows = retryDb(() => db.prepare(
      "SELECT id, category, amount, note, spent_at FROM finance_expenses ORDER BY spent_at DESC, id DESC LIMIT 5000"
    ).all());
    const data = rows.map((r) => [
      r.id,
      new Date((Number(r.spent_at) || 0) + TZ_MS).toISOString().slice(0, 10),
      r.category, r2(r.amount), r.note || ""
    ]);
    sendCsv(res, "finance-expenses.csv", ["#", "التاريخ", "الفئة", "المبلغ", "ملاحظة"], data);
  } catch (e) {
    console.error("finance/export expenses:", e.message);
    res.status(500).json({ error: "تعذّر تصدير المصاريف" });
  }
});

router.get("/export/monthly.csv", (req, res) => {
  try {
    const months = monthlyReport(6);
    const data = months.map((m) => [m.month, m.orders, m.revenue, m.cogs, m.expenses, m.net]);
    sendCsv(res, "finance-monthly.csv",
      ["الشهر", "الطلبات المكتملة", "الإيرادات", "تكلفة البضاعة", "المصاريف", "صافي الربح"], data);
  } catch (e) {
    console.error("finance/export monthly:", e.message);
    res.status(500).json({ error: "تعذّر تصدير الملخص الشهري" });
  }
});
