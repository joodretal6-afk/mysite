// ═══════════════════════════════════════════════════════════
// 👑 وحدة غرفة القيادة (command) — الشاشة الأولى كل صباح
// 10 ميزات: النبض الحي، مؤشر الصحة، الإنذارات، ترتيب الصفحات،
// عدّاد الهدف، الإحاطة الصباحية AI، قرارات اليوم، شاشة TV،
// الشريط الحي، مقارنة الأسبوعين
// 🔴 صفر إرسال للزبائن — قراءة وتحليل فقط.
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import { db, retryDb } from "../db/database.js";
import { CONFIG } from "../config.js";

export const slug = "command";
export const title = "غرفة القيادة";
export const icon = "👑";

// ── جدول الوحدة الخاص: أهداف غرفة القيادة ──
try {
  db.exec(`CREATE TABLE IF NOT EXISTS command_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT NOT NULL,
    target REAL NOT NULL,
    note TEXT DEFAULT '',
    updated_at INTEGER NOT NULL
  )`);
} catch (e) { console.error(e.message); }

try {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS command_targets_month ON command_targets(month)`);
} catch (e) { console.error(e.message); }

const DAY_MS = 86400000;

// ── أدوات الوقت (التوقيت المحلي) ──
function pad(n) { return String(n).padStart(2, "0"); }
function dayKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function monthKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function startOfMonth() {
  const d = new Date();
  d.setDate(1); d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function isMonth(s) { return /^\d{4}-\d{2}$/.test(String(s || "")); }

// الحالات التي تُحتسب مبيعات فعلية (كل شيء ما عدا الملغي)
const CANCEL_STATUS = "ملغي";

// إحصاء نافذة زمنية [from, to)
function windowStats(from, to) {
  const row = retryDb(() => db.prepare(
    `SELECT COUNT(*) AS orders,
            COALESCE(SUM(CASE WHEN status <> ? THEN total ELSE 0 END), 0) AS sales,
            COALESCE(SUM(CASE WHEN status <> ? THEN 1 ELSE 0 END), 0) AS valid_orders,
            COALESCE(SUM(CASE WHEN status = ? THEN 1 ELSE 0 END), 0) AS cancelled
     FROM orders WHERE created_at >= ? AND created_at < ?`
  ).get(CANCEL_STATUS, CANCEL_STATUS, CANCEL_STATUS, from, to));
  const msgs = retryDb(() => db.prepare(
    `SELECT COUNT(DISTINCT sender_id) AS chats,
            COALESCE(SUM(CASE WHEN direction = 'in' THEN 1 ELSE 0 END), 0) AS inbound
     FROM messages WHERE created_at >= ? AND created_at < ?`
  ).get(from, to));
  return {
    orders: Number((row && row.orders) || 0),
    valid_orders: Number((row && row.valid_orders) || 0),
    cancelled: Number((row && row.cancelled) || 0),
    sales: Math.round(Number((row && row.sales) || 0) * 100) / 100,
    chats: Number((msgs && msgs.chats) || 0),
    inbound: Number((msgs && msgs.inbound) || 0)
  };
}

// نسبة التغيّر بين رقمين (تتعامل مع الصفر بأمان)
function change(now, before) {
  if (!before) return now > 0 ? 100 : 0;
  return Math.round(((now - before) / before) * 1000) / 10;
}

// ── الذكاء الاصطناعي ──
async function askAI(prompt) {
  // يمرّ من الطبقة الموحّدة — يشتغل بأي مزوّد مربوط (AIsa أو Gemini)
  try {
    const { aiComplete } = await import("../bot/aiCore.js");
    const r = await aiComplete(prompt, { temperature: 0.4, maxTokens: 900, timeoutMs: 40000 });
    if (!r.ok) return null;
    return String(r.text || "").replace(/\*\*/g, "").trim() || null;
  } catch { return null; }
}

export const router = Router();

// ═══ 1) النبض الحي: اليوم مقابل الأمس ومقابل نفس اليوم الأسبوع الماضي ═══
router.get("/pulse", (req, res) => {
  try {
    const t0 = startOfToday();
    const today = windowStats(t0, t0 + DAY_MS);
    const yesterday = windowStats(t0 - DAY_MS, t0);
    const lastWeek = windowStats(t0 - 7 * DAY_MS, t0 - 6 * DAY_MS);
    res.json({
      today, yesterday, lastWeek,
      vsYesterday: {
        sales: change(today.sales, yesterday.sales),
        orders: change(today.orders, yesterday.orders),
        chats: change(today.chats, yesterday.chats)
      },
      vsLastWeek: {
        sales: change(today.sales, lastWeek.sales),
        orders: change(today.orders, lastWeek.orders),
        chats: change(today.chats, lastWeek.chats)
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل جلب النبض الحي" });
  }
});

// ═══ 2) مؤشر صحة الإمبراطورية (0-100) مع تفصيل كل مكوّن ═══
router.get("/health-score", (req, res) => {
  try {
    const t0 = startOfToday();
    const last30 = windowStats(t0 - 30 * DAY_MS, t0 + DAY_MS);
    const prev30 = windowStats(t0 - 60 * DAY_MS, t0 - 30 * DAY_MS);
    const parts = [];

    // أ) نمو المبيعات (25 نقطة)
    const growth = change(last30.sales, prev30.sales);
    let gScore;
    if (!prev30.sales && !last30.sales) gScore = 0;
    else if (growth >= 20) gScore = 25;
    else if (growth >= 0) gScore = 15 + Math.round((growth / 20) * 10);
    else gScore = Math.max(0, 15 + Math.round((growth / 50) * 15));
    parts.push({
      key: "نمو المبيعات", score: gScore, max: 25,
      detail: "آخر 30 يوم " + last30.sales + "د مقابل " + prev30.sales + "د (" + (growth >= 0 ? "+" : "") + growth + "%)"
    });

    // ب) نسبة الطلبات غير الملغاة (25 نقطة)
    const okRate = last30.orders ? (last30.valid_orders / last30.orders) * 100 : 0;
    const cScore = last30.orders ? Math.round((okRate / 100) * 25) : 0;
    parts.push({
      key: "سلامة الطلبات", score: cScore, max: 25,
      detail: last30.orders ? Math.round(okRate) + "% غير ملغاة (" + last30.cancelled + " ملغي من " + last30.orders + ")" : "لا توجد طلبات"
    });

    // ج) اكتمال بيانات الطلب — هاتف وعنوان (20 نقطة)
    const incomplete = retryDb(() => db.prepare(
      `SELECT COUNT(*) AS n FROM orders
       WHERE created_at >= ? AND (phone IS NULL OR TRIM(phone) = '' OR area IS NULL OR TRIM(area) = '')`
    ).get(t0 - 30 * DAY_MS));
    const bad = Number((incomplete && incomplete.n) || 0);
    const dScore = last30.orders ? Math.round(((last30.orders - bad) / last30.orders) * 20) : 0;
    parts.push({
      key: "اكتمال البيانات", score: Math.max(0, dScore), max: 20,
      detail: bad ? bad + " طلب ناقص رقم أو عنوان" : (last30.orders ? "كل الطلبات مكتملة" : "لا توجد طلبات")
    });

    // د) تحويل المحادثات إلى طلبات (20 نقطة)
    const conv = last30.chats ? (last30.valid_orders / last30.chats) * 100 : 0;
    const vScore = last30.chats ? Math.min(20, Math.round((conv / 30) * 20)) : 0;
    parts.push({
      key: "تحويل المحادثات", score: vScore, max: 20,
      detail: last30.chats
        ? Math.min(100, Math.round(conv)) + "% (" + last30.valid_orders + " طلب مقابل " + last30.chats + " محادثة)"
        : "لا توجد محادثات"
    });

    // هـ) تنوّع الصفحات — عدم الاعتماد على صفحة واحدة (10 نقاط)
    const pages = retryDb(() => db.prepare(
      `SELECT page_name, COALESCE(SUM(total),0) AS s FROM orders
       WHERE created_at >= ? AND status <> ? GROUP BY page_name ORDER BY s DESC`
    ).all(t0 - 30 * DAY_MS, CANCEL_STATUS));
    const totalS = pages.reduce((a, p) => a + Number(p.s || 0), 0);
    const topShare = totalS && pages.length ? (Number(pages[0].s || 0) / totalS) * 100 : 0;
    const pScore = !totalS ? 0 : (topShare >= 90 ? 3 : topShare >= 70 ? 6 : 10);
    parts.push({
      key: "تنوّع الصفحات", score: pScore, max: 10,
      detail: totalS ? "أعلى صفحة تمثّل " + Math.round(topShare) + "% من المبيعات (" + pages.length + " صفحة نشطة)" : "لا توجد مبيعات"
    });

    const total = parts.reduce((a, p) => a + p.score, 0);
    let grade = "ضعيف", color = "red";
    if (total >= 80) { grade = "ممتاز"; color = "green"; }
    else if (total >= 60) { grade = "جيد"; color = "green"; }
    else if (total >= 40) { grade = "متوسط"; color = "amber"; }
    res.json({ total, grade, color, parts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل حساب مؤشر الصحة" });
  }
});

// ═══ 3) الإنذارات الحمراء الحية ═══
router.get("/alerts", (req, res) => {
  try {
    const now = Date.now();
    const t0 = startOfToday();
    const alerts = [];

    const noPhone = retryDb(() => db.prepare(
      `SELECT id, page_name, area, total, created_at FROM orders
       WHERE (phone IS NULL OR TRIM(phone) = '') AND status <> ?
       ORDER BY created_at DESC LIMIT 20`
    ).all(CANCEL_STATUS));
    if (noPhone.length) alerts.push({
      level: "high", title: "طلبات بلا رقم هاتف", count: noPhone.length,
      hint: "ما بتقدر توصلها — راجع المحادثة وخذ الرقم.",
      items: noPhone.map(o => ({ id: o.id, label: "#" + o.id + " " + (o.page_name || "") + " — " + (o.area || "بلا عنوان"), at: o.created_at }))
    });

    const stuck = retryDb(() => db.prepare(
      `SELECT id, page_name, area, total, created_at FROM orders
       WHERE status = 'جديد' AND created_at < ?
       ORDER BY created_at ASC LIMIT 20`
    ).all(now - DAY_MS));
    if (stuck.length) alerts.push({
      level: "high", title: "طلبات عالقة أكثر من 24 ساعة", count: stuck.length,
      hint: "لسا حالتها «جديد» — حدّثها أو جهّزها للتوصيل.",
      items: stuck.map(o => ({ id: o.id, label: "#" + o.id + " " + (o.page_name || "") + " — " + (o.total || 0) + "د", at: o.created_at }))
    });

    // محادثات آخر رسالة فيها واردة ولم يردّ عليها البوت/الموظف
    const noReply = retryDb(() => db.prepare(
      `SELECT m.sender_id, m.page_name, MAX(m.created_at) AS last_at,
              (SELECT direction FROM messages m2 WHERE m2.sender_id = m.sender_id
                 ORDER BY m2.created_at DESC LIMIT 1) AS last_dir
       FROM messages m WHERE m.created_at >= ?
       GROUP BY m.sender_id HAVING last_dir = 'in'
       ORDER BY last_at DESC LIMIT 20`
    ).all(now - 3 * DAY_MS));
    if (noReply.length) alerts.push({
      level: "high", title: "محادثات واردة بلا ردّ", count: noReply.length,
      hint: "آخر رسالة فيها من الزبون — افتح الوارد وردّ عليها.",
      items: noReply.map(m => ({ id: m.sender_id, label: (m.page_name || "صفحة") + " — " + String(m.sender_id).slice(-6), at: m.last_at }))
    });

    let low = [];
    try {
      low = retryDb(() => db.prepare(
        `SELECT product, stock, low FROM inventory WHERE stock <= low ORDER BY stock ASC LIMIT 20`
      ).all());
    } catch { low = []; }
    if (low.length) alerts.push({
      level: "mid", title: "مخزون تحت حدّ التنبيه", count: low.length,
      hint: "جهّز إنتاج أو اطلب توريد قبل ما ينفد.",
      items: low.map(i => ({ id: i.product, label: i.product + " — متبقي " + i.stock + " (الحد " + i.low + ")", at: null }))
    });

    // هبوط مبيعات مفاجئ: آخر 7 أيام مقابل الـ7 السابقة
    const w1 = windowStats(t0 - 6 * DAY_MS, t0 + DAY_MS);
    const w2 = windowStats(t0 - 13 * DAY_MS, t0 - 6 * DAY_MS);
    const drop = change(w1.sales, w2.sales);
    if (w2.sales > 0 && drop <= -25) alerts.push({
      level: "high", title: "هبوط مبيعات حاد", count: 1,
      hint: "مبيعات آخر 7 أيام " + w1.sales + "د مقابل " + w2.sales + "د (" + drop + "%) — افحص الإعلانات وسرعة الرد.",
      items: []
    });

    res.json({ alerts, totalIssues: alerts.reduce((a, x) => a + x.count, 0) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل جلب الإنذارات" });
  }
});

// ═══ 4) ترتيب الصفحات الحي ═══
router.get("/pages-rank", (req, res) => {
  try {
    const range = req.query.range === "week" ? 7 : req.query.range === "month" ? 30 : 1;
    const t0 = startOfToday();
    const from = t0 - (range - 1) * DAY_MS;
    const rows = retryDb(() => db.prepare(
      `SELECT COALESCE(NULLIF(TRIM(page_name),''),'غير معروفة') AS page,
              COUNT(*) AS orders,
              COALESCE(SUM(CASE WHEN status <> ? THEN total ELSE 0 END),0) AS sales,
              COALESCE(SUM(CASE WHEN status = ? THEN 1 ELSE 0 END),0) AS cancelled
       FROM orders WHERE created_at >= ?
       GROUP BY page ORDER BY sales DESC LIMIT 50`
    ).all(CANCEL_STATUS, CANCEL_STATUS, from));
    const list = rows.map(r => ({
      page: r.page,
      orders: Number(r.orders || 0),
      cancelled: Number(r.cancelled || 0),
      sales: Math.round(Number(r.sales || 0) * 100) / 100,
      avg: r.orders ? Math.round((Number(r.sales || 0) / Number(r.orders)) * 100) / 100 : 0
    }));
    res.json({ range, from, pages: list, totalSales: Math.round(list.reduce((a, p) => a + p.sales, 0) * 100) / 100 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل جلب ترتيب الصفحات" });
  }
});

// ═══ 5) عدّاد الهدف الشهري ═══
router.get("/target", (req, res) => {
  try {
    const month = isMonth(req.query.month) ? req.query.month : monthKey(new Date());
    const row = retryDb(() => db.prepare(
      "SELECT month, target, note FROM command_targets WHERE month = ?"
    ).get(month));
    const target = row ? Number(row.target) : 0;

    const mStart = month === monthKey(new Date())
      ? startOfMonth()
      : new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).getTime();
    const mEnd = new Date(new Date(mStart).getFullYear(), new Date(mStart).getMonth() + 1, 1).getTime();
    const stats = windowStats(mStart, mEnd);

    const now = Date.now();
    const totalDays = Math.round((mEnd - mStart) / DAY_MS);
    const daysPassed = Math.min(totalDays, Math.max(1, Math.ceil((Math.min(now, mEnd) - mStart) / DAY_MS)));
    const daysLeft = Math.max(0, totalDays - daysPassed);
    const remaining = Math.max(0, Math.round((target - stats.sales) * 100) / 100);
    const pct = target ? Math.round((stats.sales / target) * 1000) / 10 : 0;
    const dailyNeeded = daysLeft ? Math.round((remaining / daysLeft) * 100) / 100 : remaining;
    const dailyPace = Math.round((stats.sales / daysPassed) * 100) / 100;
    const projected = Math.round(dailyPace * totalDays * 100) / 100;

    res.json({
      month, target, note: (row && row.note) || "",
      achieved: stats.sales, orders: stats.valid_orders,
      pct, remaining, totalDays, daysPassed, daysLeft,
      dailyNeeded, dailyPace, projected,
      onTrack: target ? projected >= target : null
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل جلب الهدف" });
  }
});

router.post("/target", (req, res) => {
  try {
    const b = req.body || {};
    const month = isMonth(b.month) ? b.month : monthKey(new Date());
    const target = Number(b.target);
    if (!Number.isFinite(target) || target < 0) return res.status(400).json({ error: "اكتب رقم هدف صحيح" });
    const note = String(b.note || "").trim().slice(0, 200);
    retryDb(() => db.prepare(
      `INSERT INTO command_targets (month, target, note, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(month) DO UPDATE SET target = excluded.target, note = excluded.note, updated_at = excluded.updated_at`
    ).run(month, target, note, Date.now()));
    res.json({ ok: true, month, target });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل حفظ الهدف" });
  }
});

// ═══ 9) الشريط الحي: آخر الأحداث ═══
router.get("/live-feed", (req, res) => {
  try {
    let limit = Number(req.query.limit);
    if (!Number.isFinite(limit) || limit < 1 || limit > 50) limit = 20;
    const orders = retryDb(() => db.prepare(
      `SELECT id, page_name, area, total, status, created_at FROM orders
       ORDER BY created_at DESC LIMIT ${Math.floor(limit)}`
    ).all());
    const msgs = retryDb(() => db.prepare(
      `SELECT id, page_name, sender_id, body, created_at FROM messages
       WHERE direction = 'in' ORDER BY created_at DESC LIMIT ${Math.floor(limit)}`
    ).all());
    const feed = [];
    for (const o of orders) feed.push({
      type: "order", at: Number(o.created_at || 0),
      text: "طلب #" + o.id + " — " + (o.page_name || "صفحة") + " — " + (o.total || 0) + "د" + (o.area ? " — " + o.area : ""),
      status: o.status || ""
    });
    for (const m of msgs) feed.push({
      type: "message", at: Number(m.created_at || 0),
      text: "رسالة واردة — " + (m.page_name || "صفحة") + ": " + String(m.body || "").slice(0, 70),
      status: ""
    });
    feed.sort((a, b) => b.at - a.at);
    res.json({ feed: feed.slice(0, limit) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل جلب الشريط الحي" });
  }
});

// ═══ 10) مقارنة الأسبوع الحالي بالسابق + بيانات الرسم ═══
router.get("/week-compare", (req, res) => {
  try {
    const t0 = startOfToday();
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const from = t0 - i * DAY_MS;
      const s = windowStats(from, from + DAY_MS);
      days.push({ day: dayKey(new Date(from)), sales: s.sales, orders: s.orders });
    }
    const prev = days.slice(0, 7);
    const cur = days.slice(7);
    const sum = arr => Math.round(arr.reduce((a, d) => a + d.sales, 0) * 100) / 100;
    const sumO = arr => arr.reduce((a, d) => a + d.orders, 0);
    const curSales = sum(cur), prevSales = sum(prev);
    res.json({
      days,
      current: { sales: curSales, orders: sumO(cur) },
      previous: { sales: prevSales, orders: sumO(prev) },
      salesChange: change(curSales, prevSales),
      ordersChange: change(sumO(cur), sumO(prev)),
      best: days.reduce((a, d) => (d.sales > (a ? a.sales : -1) ? d : a), null)
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل جلب المقارنة" });
  }
});

// ═══ 8) وضع الشاشة الكبيرة — تجميعة واحدة خفيفة ═══
router.get("/tv", (req, res) => {
  try {
    const t0 = startOfToday();
    const today = windowStats(t0, t0 + DAY_MS);
    const yesterday = windowStats(t0 - DAY_MS, t0);
    const month = windowStats(startOfMonth(), Date.now() + 1);
    const tRow = retryDb(() => db.prepare(
      "SELECT target FROM command_targets WHERE month = ?"
    ).get(monthKey(new Date())));
    const target = tRow ? Number(tRow.target) : 0;
    const topPage = retryDb(() => db.prepare(
      `SELECT COALESCE(NULLIF(TRIM(page_name),''),'غير معروفة') AS page,
              COALESCE(SUM(total),0) AS s
       FROM orders WHERE created_at >= ? AND status <> ?
       GROUP BY page ORDER BY s DESC LIMIT 1`
    ).get(t0, CANCEL_STATUS));
    res.json({
      today, yesterday, month, target,
      targetPct: target ? Math.round((month.sales / target) * 1000) / 10 : 0,
      salesChange: change(today.sales, yesterday.sales),
      topPage: topPage ? { page: topPage.page, sales: Math.round(Number(topPage.s || 0) * 100) / 100 } : null,
      at: Date.now()
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل جلب بيانات الشاشة" });
  }
});

// ── وقائع مشتركة تُغذّي ميزتَي الذكاء الاصطناعي ──
function gatherFacts() {
  const t0 = startOfToday();
  const today = windowStats(t0, t0 + DAY_MS);
  const w1 = windowStats(t0 - 6 * DAY_MS, t0 + DAY_MS);
  const w2 = windowStats(t0 - 13 * DAY_MS, t0 - 6 * DAY_MS);
  const month = windowStats(startOfMonth(), Date.now() + 1);
  const pages = retryDb(() => db.prepare(
    `SELECT COALESCE(NULLIF(TRIM(page_name),''),'غير معروفة') AS page,
            COUNT(*) AS n, COALESCE(SUM(total),0) AS s
     FROM orders WHERE created_at >= ? AND status <> ?
     GROUP BY page ORDER BY s DESC LIMIT 10`
  ).all(t0 - 6 * DAY_MS, CANCEL_STATUS));
  const areas = retryDb(() => db.prepare(
    `SELECT COALESCE(NULLIF(TRIM(area),''),'بلا عنوان') AS area, COUNT(*) AS n
     FROM orders WHERE created_at >= ? AND status <> ?
     GROUP BY area ORDER BY n DESC LIMIT 8`
  ).all(t0 - 29 * DAY_MS, CANCEL_STATUS));
  const tRow = retryDb(() => db.prepare("SELECT target FROM command_targets WHERE month = ?").get(monthKey(new Date())));

  const lines = [
    "اليوم: " + today.valid_orders + " طلب، " + today.sales + " دينار، " + today.chats + " محادثة.",
    "آخر 7 أيام: " + w1.valid_orders + " طلب و" + w1.sales + " دينار (الأسبوع السابق: " + w2.valid_orders + " طلب و" + w2.sales + " دينار، التغيّر " + change(w1.sales, w2.sales) + "%).",
    "الشهر حتى الآن: " + month.valid_orders + " طلب و" + month.sales + " دينار." + (tRow ? " الهدف الشهري: " + Number(tRow.target) + " دينار." : " لا يوجد هدف شهري محدّد."),
    "الملغي آخر 7 أيام: " + w1.cancelled + " طلب.",
    "الصفحات آخر 7 أيام: " + (pages.length ? pages.map(p => p.page + " (" + p.n + " طلب، " + Math.round(Number(p.s || 0)) + "د)").join("، ") : "لا يوجد"),
    "أكثر المناطق آخر 30 يوم: " + (areas.length ? areas.map(a => a.area + " (" + a.n + ")").join("، ") : "لا يوجد")
  ];
  return { text: lines.join("\n"), today, w1, w2, month };
}

// ═══ 6) الإحاطة الصباحية بالذكاء الاصطناعي ═══
router.post("/briefing", async (req, res) => {
  try {
    const facts = gatherFacts();
    const prompt =
      "أنت مستشار تنفيذي لتاجر أردني يبيع أجبان بلدية ومواد تنظيف عبر صفحات فيسبوك.\n" +
      "اكتب إحاطة صباحية قصيرة بالعربية (لهجة عربية فصيحة مبسّطة) من أرقامه الحقيقية التالية.\n" +
      "المطلوب بالضبط: سطر واحد عن حالة الأمس/الأسبوع، ثم 3 نقاط لأهم ما يجب أن ينتبه له، ثم سطر تحفيزي واقعي واحد.\n" +
      "ممنوع اختراع أي رقم غير موجود أدناه. ممنوع Markdown معقّد — نقاط بسيطة فقط. كن مختصراً جداً.\n\n" +
      "الأرقام:\n" + facts.text;
    const text = await askAI(prompt);
    // تدهور لطيف: لو تعذّر الذكاء الاصطناعي، نرجّع الأرقام الحقيقية على أي حال
    res.json({ briefing: text || null, facts: facts.text });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل توليد الإحاطة" });
  }
});

// ═══ 7) أهم 3 قرارات اليوم (قواعد حقيقية + صياغة AI) ═══
router.post("/decisions", async (req, res) => {
  try {
    const t0 = startOfToday();
    const facts = gatherFacts();
    const rules = [];

    const noPhone = retryDb(() => db.prepare(
      `SELECT COUNT(*) AS n FROM orders WHERE (phone IS NULL OR TRIM(phone) = '') AND status <> ?`
    ).get(CANCEL_STATUS));
    if (Number((noPhone && noPhone.n) || 0) > 0)
      rules.push("يوجد " + noPhone.n + " طلب بلا رقم هاتف — استرجاعها أسرع ربح ممكن اليوم.");

    const stuck = retryDb(() => db.prepare(
      `SELECT COUNT(*) AS n FROM orders WHERE status = 'جديد' AND created_at < ?`
    ).get(Date.now() - DAY_MS));
    if (Number((stuck && stuck.n) || 0) > 0)
      rules.push("يوجد " + stuck.n + " طلب عالق بحالة «جديد» أكثر من 24 ساعة.");

    const drop = change(facts.w1.sales, facts.w2.sales);
    if (facts.w2.sales > 0 && drop <= -20) rules.push("المبيعات هبطت " + drop + "% هذا الأسبوع مقابل السابق.");
    if (facts.w1.cancelled > 0 && facts.w1.valid_orders > 0 && (facts.w1.cancelled / (facts.w1.valid_orders + facts.w1.cancelled)) > 0.15)
      rules.push("نسبة الإلغاء مرتفعة هذا الأسبوع (" + facts.w1.cancelled + " ملغي).");

    const conv = facts.w1.chats ? (facts.w1.valid_orders / facts.w1.chats) * 100 : 0;
    if (facts.w1.chats >= 10 && conv < 15)
      rules.push("تحويل المحادثات ضعيف: " + Math.round(conv) + "% فقط من المحادثات صارت طلبات.");

    const prompt =
      "أنت مستشار تنفيذي لتاجر أردني يبيع عبر فيسبوك ماسنجر.\n" +
      "بناءً على أرقامه الحقيقية والمؤشرات المرصودة، اكتب أهم 3 قرارات عملية يجب أن ينفّذها اليوم.\n" +
      "كل قرار: جملة واحدة واضحة تبدأ بفعل أمر، ومعها سبب رقمي من البيانات. رقّمها 1 و2 و3 فقط، بدون مقدمة ولا خاتمة.\n" +
      "ممنوع اختراع أرقام.\n\nالأرقام:\n" + facts.text +
      (rules.length ? "\n\nمؤشرات مرصودة آلياً:\n- " + rules.join("\n- ") : "");
    const text = await askAI(prompt);
    res.json({ signals: rules, decisions: text || null, facts: facts.text });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل توليد القرارات" });
  }
});
