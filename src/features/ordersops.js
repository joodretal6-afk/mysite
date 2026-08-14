// ═══════════════════════════════════════════════════════════
// 📦 وحدة عمليات الطلبات (ordersops)
// 10 ميزات تشغيلية: إجراءات جماعية، ورقة تحضير، بوليصات شحن،
// جولة توصيل، سائقين، كشف تكرار، خط زمني، ملاحظات، متأخرة، طلب يدوي
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import { db, retryDb, listOrders, saveOrder, getOrder } from "../db/database.js";

export const slug = "ordersops";
export const title = "عمليات الطلبات";
export const icon = "📦";

// ── جداول الوحدة الخاصة ──
try {
  db.exec(`CREATE TABLE IF NOT EXISTS ordersops_drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT DEFAULT ''
  )`);
} catch (e) { console.error(e.message); }

try {
  db.exec(`CREATE TABLE IF NOT EXISTS ordersops_assign (
    order_id INTEGER PRIMARY KEY,
    driver_id INTEGER NOT NULL,
    assigned_at INTEGER NOT NULL
  )`);
} catch (e) { console.error(e.message); }

try {
  db.exec(`CREATE TABLE IF NOT EXISTS ordersops_timeline (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    event TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
} catch (e) { console.error(e.message); }

try {
  db.exec(`CREATE TABLE IF NOT EXISTS ordersops_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    note TEXT NOT NULL,
    author TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  )`);
} catch (e) { console.error(e.message); }

const STATUSES = ["ناقص", "جديد", "تم التواصل", "تم الشحن", "تم التسليم", "ملغي"];

// تسجيل حدث بالخط الزمني (يُستخدم داخلياً من عدة ميزات)
function logEvent(orderId, event) {
  try {
    retryDb(() => db.prepare(
      "INSERT INTO ordersops_timeline (order_id, event, created_at) VALUES (?, ?, ?)"
    ).run(Number(orderId), String(event), Date.now()));
  } catch (e) { console.error("ordersops timeline:", e.message); }
}

// تفكيك order_string إلى أصناف: "غنم (2 نصية) + لبنة (1 كيلو)"
function parseItems(orderString) {
  const items = [];
  String(orderString || "").split("+").forEach(part => {
    const p = part.trim();
    if (!p) return;
    const m = p.match(/(.+?)\s*\((\d+)\s*([^)]*)/);
    if (m) items.push({ name: m[1].trim(), qty: parseInt(m[2], 10) || 1, unit: (m[3] || "").trim() });
    else items.push({ name: p, qty: 1, unit: "" });
  });
  return items;
}

export const router = Router();

// ═══ 0) قائمة طلبات عامة (تخدم تبويب الإجراءات الجماعية وغيره) ═══
router.get("/orders", (req, res) => {
  try {
    const { status, search } = req.query;
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
    const data = listOrders({
      status: status && STATUSES.includes(status) ? status : undefined,
      search: search ? String(search).slice(0, 100) : undefined,
      limit
    });
    res.json({ orders: data.rows, count: Number(data.count), sum: Number(data.sum) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل جلب الطلبات" });
  }
});

// ═══ 1) إجراءات جماعية: تغيير حالة عدة طلبات دفعة واحدة ═══
router.post("/bulk-status", (req, res) => {
  try {
    const { ids, status } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: "اختر طلباً واحداً على الأقل" });
    if (!STATUSES.includes(status)) return res.status(400).json({ error: "حالة غير صالحة" });
    const clean = [...new Set(ids.map(x => parseInt(x, 10)).filter(n => Number.isFinite(n) && n > 0))].slice(0, 500);
    if (!clean.length) return res.status(400).json({ error: "أرقام طلبات غير صالحة" });
    let updated = 0;
    for (const id of clean) {
      const info = retryDb(() => db.prepare("UPDATE orders SET status=? WHERE id=?").run(status, id));
      if (Number(info.changes) > 0) { updated++; logEvent(id, `تغيير الحالة إلى «${status}» (إجراء جماعي)`); }
    }
    res.json({ ok: true, updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل تنفيذ الإجراء الجماعي" });
  }
});

// ═══ 2) ورقة تحضير اليوم: تجميع كميات الأصناف من طلبات يوم معيّن ═══
router.get("/prep-sheet", (req, res) => {
  try {
    const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || "")) ? String(req.query.date) : null;
    const start = dateStr ? new Date(dateStr + "T00:00:00").getTime() : new Date(new Date().toDateString()).getTime();
    if (!Number.isFinite(start)) return res.status(400).json({ error: "تاريخ غير صالح" });
    const end = start + 24 * 3600 * 1000;
    const rows = retryDb(() => db.prepare(
      `SELECT id, order_string, status FROM orders
       WHERE created_at >= ? AND created_at < ? AND status != 'ملغي'
       ORDER BY id LIMIT 2000`
    ).all(start, end));
    const agg = new Map();
    for (const r of rows) {
      for (const it of parseItems(r.order_string)) {
        const key = it.name + "|" + it.unit;
        const cur = agg.get(key) || { name: it.name, unit: it.unit, qty: 0, orders: 0 };
        cur.qty += it.qty; cur.orders += 1;
        agg.set(key, cur);
      }
    }
    const items = [...agg.values()].sort((a, b) => b.qty - a.qty);
    res.json({ date: dateStr || new Date(start).toISOString().slice(0, 10), ordersCount: rows.length, items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل توليد ورقة التحضير" });
  }
});

// ═══ 3) بوليصات شحن: بطاقات لكل طلبات حالة معيّنة ═══
router.get("/labels", (req, res) => {
  try {
    const status = STATUSES.includes(req.query.status) ? req.query.status : "جديد";
    const rows = retryDb(() => db.prepare(
      `SELECT id, page_name, order_string, total, area, phone, created_at FROM orders
       WHERE status = ? ORDER BY created_at DESC LIMIT 300`
    ).all(status));
    res.json({ status, labels: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل توليد البوليصات" });
  }
});

// ═══ 4) جولة التوصيل: تجميع حسب أول كلمة من العنوان ═══
router.get("/route", (req, res) => {
  try {
    const rows = retryDb(() => db.prepare(
      `SELECT id, page_name, order_string, total, area, phone, status, created_at FROM orders
       WHERE status IN ('جديد','تم التواصل') ORDER BY created_at DESC LIMIT 1000`
    ).all());
    const groups = new Map();
    for (const r of rows) {
      const first = String(r.area || "").trim().split(/\s+/)[0] || "بدون عنوان";
      const g = groups.get(first) || { region: first, count: 0, total: 0, orders: [] };
      g.count += 1; g.total += Number(r.total) || 0; g.orders.push(r);
      groups.set(first, g);
    }
    const out = [...groups.values()].sort((a, b) => b.count - a.count);
    res.json({ groups: out, totalOrders: rows.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل تجميع جولة التوصيل" });
  }
});

// ═══ 5) إدارة السائقين + تعيين الطلبات ═══
router.get("/drivers", (req, res) => {
  try {
    const rows = retryDb(() => db.prepare(
      `SELECT d.id, d.name, d.phone,
        (SELECT COUNT(*) FROM ordersops_assign a WHERE a.driver_id = d.id) AS assigned
       FROM ordersops_drivers d ORDER BY d.id DESC LIMIT 200`
    ).all());
    res.json({ drivers: rows.map(r => ({ ...r, assigned: Number(r.assigned) })) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل جلب السائقين" });
  }
});

router.post("/drivers", (req, res) => {
  try {
    const name = String((req.body || {}).name || "").trim();
    const phone = String((req.body || {}).phone || "").trim();
    if (!name) return res.status(400).json({ error: "اكتب اسم السائق" });
    const info = retryDb(() => db.prepare("INSERT INTO ordersops_drivers (name, phone) VALUES (?, ?)").run(name, phone));
    res.json({ ok: true, id: Number(info.lastInsertRowid) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل إضافة السائق" });
  }
});

router.put("/drivers/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const name = String((req.body || {}).name || "").trim();
    const phone = String((req.body || {}).phone || "").trim();
    if (!id || !name) return res.status(400).json({ error: "بيانات غير مكتملة" });
    const info = retryDb(() => db.prepare("UPDATE ordersops_drivers SET name=?, phone=? WHERE id=?").run(name, phone, id));
    if (!Number(info.changes)) return res.status(400).json({ error: "السائق غير موجود" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل تعديل السائق" });
  }
});

router.delete("/drivers/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "رقم غير صالح" });
    retryDb(() => db.prepare("DELETE FROM ordersops_assign WHERE driver_id=?").run(id));
    retryDb(() => db.prepare("DELETE FROM ordersops_drivers WHERE id=?").run(id));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل حذف السائق" });
  }
});

router.post("/assign", (req, res) => {
  try {
    const orderId = parseInt((req.body || {}).order_id, 10);
    const driverId = parseInt((req.body || {}).driver_id, 10);
    if (!orderId || !driverId) return res.status(400).json({ error: "رقم الطلب والسائق مطلوبان" });
    const order = getOrder(orderId);
    if (!order) return res.status(400).json({ error: "الطلب غير موجود" });
    const driver = retryDb(() => db.prepare("SELECT * FROM ordersops_drivers WHERE id=?").get(driverId));
    if (!driver) return res.status(400).json({ error: "السائق غير موجود" });
    retryDb(() => db.prepare(
      `INSERT INTO ordersops_assign (order_id, driver_id, assigned_at) VALUES (?, ?, ?)
       ON CONFLICT(order_id) DO UPDATE SET driver_id=excluded.driver_id, assigned_at=excluded.assigned_at`
    ).run(orderId, driverId, Date.now()));
    logEvent(orderId, `تعيين السائق «${driver.name}» للطلب`);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل تعيين السائق" });
  }
});

router.delete("/assign/:orderId", (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId, 10);
    if (!orderId) return res.status(400).json({ error: "رقم غير صالح" });
    retryDb(() => db.prepare("DELETE FROM ordersops_assign WHERE order_id=?").run(orderId));
    logEvent(orderId, "إلغاء تعيين السائق");
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل إلغاء التعيين" });
  }
});

router.get("/drivers/:id/orders", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "رقم غير صالح" });
    const rows = retryDb(() => db.prepare(
      `SELECT o.id, o.page_name, o.order_string, o.total, o.area, o.phone, o.status, a.assigned_at
       FROM ordersops_assign a JOIN orders o ON o.id = a.order_id
       WHERE a.driver_id = ? ORDER BY a.assigned_at DESC LIMIT 300`
    ).all(id));
    res.json({ orders: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل جلب طلبات السائق" });
  }
});

// ═══ 6) كشف التكرار: طلبات بنفس الهاتف خلال 24 ساعة ═══
router.get("/duplicates", (req, res) => {
  try {
    const since = Date.now() - 7 * 24 * 3600 * 1000;
    const rows = retryDb(() => db.prepare(
      `SELECT id, page_name, order_string, total, area, phone, status, created_at FROM orders
       WHERE phone != '' AND created_at >= ? ORDER BY phone, created_at LIMIT 2000`
    ).all(since));
    const byPhone = new Map();
    for (const r of rows) {
      if (!byPhone.has(r.phone)) byPhone.set(r.phone, []);
      byPhone.get(r.phone).push(r);
    }
    const groups = [];
    for (const [phone, list] of byPhone) {
      let cluster = [list[0]];
      for (let i = 1; i < list.length; i++) {
        if (list[i].created_at - cluster[cluster.length - 1].created_at <= 24 * 3600 * 1000) {
          cluster.push(list[i]);
        } else {
          if (cluster.length >= 2) groups.push({ phone, orders: cluster });
          cluster = [list[i]];
        }
      }
      if (cluster.length >= 2) groups.push({ phone, orders: cluster });
    }
    groups.sort((a, b) => b.orders.length - a.orders.length);
    res.json({ groups });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل كشف التكرار" });
  }
});

// ═══ 7) خط زمني للطلب ═══
router.get("/timeline/:orderId", (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId, 10);
    if (!orderId) return res.status(400).json({ error: "رقم طلب غير صالح" });
    const order = getOrder(orderId);
    if (!order) return res.status(400).json({ error: "الطلب غير موجود" });
    const events = retryDb(() => db.prepare(
      "SELECT id, event, created_at FROM ordersops_timeline WHERE order_id=? ORDER BY created_at DESC, id DESC LIMIT 300"
    ).all(orderId));
    events.push({ id: 0, event: "📥 إنشاء الطلب", created_at: Number(order.created_at) });
    res.json({ order, events });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل جلب الخط الزمني" });
  }
});

router.post("/timeline", (req, res) => {
  try {
    const orderId = parseInt((req.body || {}).order_id, 10);
    const event = String((req.body || {}).event || "").trim().slice(0, 300);
    if (!orderId || !event) return res.status(400).json({ error: "رقم الطلب ونص الحدث مطلوبان" });
    if (!getOrder(orderId)) return res.status(400).json({ error: "الطلب غير موجود" });
    retryDb(() => db.prepare(
      "INSERT INTO ordersops_timeline (order_id, event, created_at) VALUES (?, ?, ?)"
    ).run(orderId, event, Date.now()));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل تسجيل الحدث" });
  }
});

// ═══ 8) ملاحظات داخلية على الطلب (CRUD) ═══
router.get("/notes/:orderId", (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId, 10);
    if (!orderId) return res.status(400).json({ error: "رقم طلب غير صالح" });
    const order = getOrder(orderId);
    if (!order) return res.status(400).json({ error: "الطلب غير موجود" });
    const notes = retryDb(() => db.prepare(
      "SELECT id, note, author, created_at FROM ordersops_notes WHERE order_id=? ORDER BY created_at DESC LIMIT 200"
    ).all(orderId));
    res.json({ order, notes });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل جلب الملاحظات" });
  }
});

router.post("/notes", (req, res) => {
  try {
    const orderId = parseInt((req.body || {}).order_id, 10);
    const note = String((req.body || {}).note || "").trim().slice(0, 1000);
    const author = String((req.body || {}).author || "").trim().slice(0, 60);
    if (!orderId || !note) return res.status(400).json({ error: "رقم الطلب ونص الملاحظة مطلوبان" });
    if (!getOrder(orderId)) return res.status(400).json({ error: "الطلب غير موجود" });
    const info = retryDb(() => db.prepare(
      "INSERT INTO ordersops_notes (order_id, note, author, created_at) VALUES (?, ?, ?, ?)"
    ).run(orderId, note, author, Date.now()));
    res.json({ ok: true, id: Number(info.lastInsertRowid) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل إضافة الملاحظة" });
  }
});

router.put("/notes/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const note = String((req.body || {}).note || "").trim().slice(0, 1000);
    if (!id || !note) return res.status(400).json({ error: "بيانات غير مكتملة" });
    const info = retryDb(() => db.prepare("UPDATE ordersops_notes SET note=? WHERE id=?").run(note, id));
    if (!Number(info.changes)) return res.status(400).json({ error: "الملاحظة غير موجودة" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل تعديل الملاحظة" });
  }
});

router.delete("/notes/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "رقم غير صالح" });
    retryDb(() => db.prepare("DELETE FROM ordersops_notes WHERE id=?").run(id));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل حذف الملاحظة" });
  }
});

// ═══ 9) الطلبات المتأخرة: «جديد» مضى عليها أكثر من 24 ساعة ═══
router.get("/late", (req, res) => {
  try {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    const rows = retryDb(() => db.prepare(
      `SELECT id, page_name, order_string, total, area, phone, created_at FROM orders
       WHERE status = 'جديد' AND created_at < ? ORDER BY created_at ASC LIMIT 500`
    ).all(cutoff));
    const now = Date.now();
    const orders = rows.map(r => ({ ...r, age_hours: Math.floor((now - Number(r.created_at)) / 3600000) }));
    res.json({ orders });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل جلب الطلبات المتأخرة" });
  }
});

// ═══ 10) طلب يدوي سريع ═══
router.post("/manual", (req, res) => {
  try {
    const b = req.body || {};
    const orderString = String(b.order_string || "").trim().slice(0, 500);
    const total = Number(b.total);
    const area = String(b.area || "").trim().slice(0, 200);
    const phone = String(b.phone || "").trim().slice(0, 30);
    const status = STATUSES.includes(b.status) ? b.status : "جديد";
    if (!orderString) return res.status(400).json({ error: "اكتب تفاصيل الطلب (مثال: غنم (2 نصية) + لبنة (1 كيلو))" });
    if (!Number.isFinite(total) || total < 0) return res.status(400).json({ error: "المبلغ الإجمالي غير صالح" });
    const id = saveOrder({
      page_id: "يدوي",
      page_name: "طلب يدوي",
      sender_id: "",
      order_string: orderString,
      total,
      area,
      phone,
      status,
      messenger_url: "",
      created_at: Date.now()
    });
    logEvent(id, "✍️ إنشاء طلب يدوي من اللوحة");
    res.json({ ok: true, id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل إنشاء الطلب اليدوي" });
  }
});
