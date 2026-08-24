// ═══════════════════════════════════════════════════════════
// 🛒 وحدة المشتريات والموردين — 10 وظائف
//
//  1) سجل الموردين (اسم، هاتف، أصناف، شروط الدفع، ملاحظات)
//  2) قائمة أسعار كل مورد لكل صنف مع تاريخ آخر تحديث
//  3) مقارنة أسعار الموردين لنفس الصنف — مين الأرخص اليوم
//  4) أوامر الشراء بأصنافها وكمياتها وأسعارها
//  5) الاستلام الكامل أو الجزئي مع تسجيل الفرق
//  6) فواتير الموردين والمستحق عليك لكل مورد
//  7) تقييم أداء المورد (التزام بالموعد، نقص الاستلام، تغيّر السعر)
//  8) اقتراح أمر شراء من نواقص المخزون الحقيقية
//  9) تاريخ تكلفة الصنف — كيف تغيّر سعر الشراء مع الوقت
// 10) تصدير CSV لأوامر الشراء وللمستحقات
//
// 🔴 القاعدة: ما منخترع ولا رقم. المورد اللي ما إلو أوامر
//    مستلمة ما إلو «التزام 0%» — إلو null يعني «ما في بيانات».
//    وكل كمية مقترحة بتقول من وين إجت بالحرف.
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import express from "express";
import { db } from "../db/database.js";

export const slug = "procure";
export const title = "المشتريات والموردين";
export const icon = "🛒";

try {
  db.exec(`
  CREATE TABLE IF NOT EXISTS procure_suppliers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    phone      TEXT DEFAULT '',
    items_text TEXT DEFAULT '',
    pay_terms  TEXT DEFAULT 'نقدي',
    lead_days  INTEGER NOT NULL DEFAULT 0,
    note       TEXT DEFAULT '',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS procure_prices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL,
    item_name   TEXT NOT NULL,
    unit        TEXT DEFAULT 'حبة',
    price       REAL NOT NULL,
    note        TEXT DEFAULT '',
    updated_at  INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS procure_prices_uq
    ON procure_prices(supplier_id, item_name);

  CREATE TABLE IF NOT EXISTS procure_orders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'مسودة',
    expected_at TEXT DEFAULT '',
    note        TEXT DEFAULT '',
    created_at  INTEGER NOT NULL,
    sent_at     INTEGER,
    received_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS procure_order_lines (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id     INTEGER NOT NULL,
    item_name    TEXT NOT NULL,
    unit         TEXT DEFAULT 'حبة',
    qty          REAL NOT NULL,
    unit_price   REAL NOT NULL DEFAULT 0,
    received_qty REAL NOT NULL DEFAULT 0,
    note         TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS procure_lines_order ON procure_order_lines(order_id);

  CREATE TABLE IF NOT EXISTS procure_bills (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL,
    order_id    INTEGER,
    ref         TEXT DEFAULT '',
    amount      REAL NOT NULL,
    bill_date   TEXT DEFAULT '',
    note        TEXT DEFAULT '',
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS procure_payments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL,
    bill_id     INTEGER,
    amount      REAL NOT NULL,
    paid_at     TEXT DEFAULT '',
    method      TEXT DEFAULT 'نقدي',
    note        TEXT DEFAULT '',
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS procure_cost_hist (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    item_name   TEXT NOT NULL,
    supplier_id INTEGER NOT NULL,
    price       REAL NOT NULL,
    source      TEXT DEFAULT '',
    at          INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS procure_cost_item ON procure_cost_hist(item_name, at);`);
} catch (e) { console.error("procure tables:", e && e.message); }

// ── ثوابت ──
const STATUSES = ["مسودة", "مرسل", "مستلم جزئي", "مستلم", "ملغي"];
const PAY_TERMS = ["نقدي", "آجل 7 أيام", "آجل 15 يوم", "آجل 30 يوم", "بالأمانة"];
const METHODS = ["نقدي", "حوالة", "شيك"];
const DAY = 86400000;
const TZ_MS = 10800 * 1000;

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const r3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;
const dayStr = (ts) => new Date(Number(ts) + TZ_MS).toISOString().slice(0, 10);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ");

// ═══════════════════════════════════════════════════════════
// 🧮 المحرّك — كل رقم مشتق من سطور محفوظة، ولا شي محفوظ مرتين
// ═══════════════════════════════════════════════════════════

/** إجماليات أمر الشراء من سطوره: المطلوب، المستلم، والفرق */
export function orderTotals(lines) {
  let value = 0, received_value = 0, qty = 0, received = 0, shortLines = 0;
  for (const l of lines) {
    const q = Number(l.qty) || 0, rq = Number(l.received_qty) || 0, p = Number(l.unit_price) || 0;
    qty += q; received += rq;
    value += q * p; received_value += rq * p;
    if (rq < q) shortLines++;
  }
  return {
    lines: lines.length,
    qty: r3(qty),
    received: r3(received),
    // الفرق موجب = ناقص وصلك، سالب = وصلك أكثر من طلبك
    variance: r3(qty - received),
    value: r2(value),
    received_value: r2(received_value),
    open_value: r2(value - received_value),
    short_lines: shortLines
  };
}

/** الحالة بتنشتق من الاستلام نفسه — ما بتنكتب بالإيد */
export function statusFromReceipt(prev, totals) {
  if (prev === "ملغي") return "ملغي";
  if (totals.received <= 0) return prev === "مسودة" ? "مسودة" : "مرسل";
  return totals.received + 0.0001 < totals.qty ? "مستلم جزئي" : "مستلم";
}

function orderLines(orderId) {
  return db.prepare("SELECT * FROM procure_order_lines WHERE order_id=? ORDER BY id").all(orderId);
}

export function orderView(id) {
  const o = db.prepare(
    `SELECT o.*, s.name AS supplier_name, s.pay_terms
     FROM procure_orders o LEFT JOIN procure_suppliers s ON s.id=o.supplier_id
     WHERE o.id=?`).get(Number(id));
  if (!o) return null;
  const lines = orderLines(o.id).map((l) => ({
    ...l,
    line_total: r2(Number(l.qty) * Number(l.unit_price)),
    variance: r3(Number(l.qty) - Number(l.received_qty))
  }));
  return { order: o, lines, totals: orderTotals(lines) };
}

/** ما دفعته وما عليك لكل مورد — الفرق بين الفواتير والدفعات، بلا تقدير */
export function duesRows() {
  const sup = db.prepare("SELECT id,name,phone,pay_terms,active FROM procure_suppliers ORDER BY name").all();
  const billed = new Map(), paid = new Map(), billCount = new Map();
  for (const b of db.prepare(
    "SELECT supplier_id, COUNT(*) c, COALESCE(SUM(amount),0) t FROM procure_bills GROUP BY supplier_id").all()) {
    billed.set(Number(b.supplier_id), Number(b.t) || 0);
    billCount.set(Number(b.supplier_id), Number(b.c) || 0);
  }
  for (const p of db.prepare(
    "SELECT supplier_id, COALESCE(SUM(amount),0) t FROM procure_payments GROUP BY supplier_id").all())
    paid.set(Number(p.supplier_id), Number(p.t) || 0);

  return sup.map((s) => {
    const b = billed.get(s.id) || 0, p = paid.get(s.id) || 0;
    return {
      supplier_id: s.id, name: s.name, phone: s.phone, pay_terms: s.pay_terms, active: s.active,
      bills: billCount.get(s.id) || 0,
      billed: r2(b), paid: r2(p), due: r2(b - p)
    };
  });
}

/**
 * 📊 تقييم أداء المورد.
 * كل مؤشر بيرجع null إذا ما في سطور تحسب عليه — لأنّ مورد جديد
 * ما إلو «التزام صفر»، إلو «ما في بيانات كافية».
 */
export function supplierScore(supplierId) {
  const id = Number(supplierId);
  const orders = db.prepare(
    "SELECT * FROM procure_orders WHERE supplier_id=? AND status<>'ملغي' ORDER BY id").all(id);

  // ⏱️ الالتزام بالموعد: بس الأوامر اللي إلها موعد متوقّع وخلصت استلام كامل.
  //    الأمر الجزئي لسا مفتوح — الحكم عليه بالموعد بكون ظلم أو تجميل.
  const dated = orders.filter((o) => o.status === "مستلم" && o.received_at && isDate(o.expected_at));
  const onTime = dated.filter((o) => dayStr(o.received_at) <= o.expected_at).length;

  // 📉 نقص الاستلام: بس الأوامر اللي صار فيها استلام
  let ordQty = 0, recQty = 0, touched = 0;
  for (const o of orders) {
    if (!["مستلم", "مستلم جزئي"].includes(o.status)) continue;
    const t = orderTotals(orderLines(o.id));
    ordQty += t.qty; recQty += t.received; touched++;
  }

  // 💸 تغيّر السعر: أول سعر مسجّل مقابل آخر سعر، لكل صنف إلو نقطتين على الأقل
  const hist = db.prepare(
    "SELECT item_name, price, at FROM procure_cost_hist WHERE supplier_id=? ORDER BY at, id").all(id);
  const byItem = new Map();
  for (const h of hist) {
    const g = byItem.get(h.item_name) || [];
    g.push(Number(h.price));
    byItem.set(h.item_name, g);
  }
  const changes = [];
  for (const [item, arr] of byItem) {
    if (arr.length < 2 || !arr[0]) continue;
    changes.push({ item, first: r2(arr[0]), last: r2(arr[arr.length - 1]),
                   pct: r2(((arr[arr.length - 1] - arr[0]) / arr[0]) * 100) });
  }

  return {
    supplier_id: id,
    orders: orders.length,
    received_orders: touched,
    // النِّسب null لمّا ما في أساس نحسب عليه — الواجهة بتعرضها «—»
    on_time_rate: dated.length ? r2((onTime / dated.length) * 100) : null,
    on_time_basis: dated.length,
    short_rate: ordQty > 0 ? r2(((ordQty - recQty) / ordQty) * 100) : null,
    short_basis: touched,
    ordered_qty: r3(ordQty),
    received_qty: r3(recQty),
    price_change_pct: changes.length
      ? r2(changes.reduce((a, c) => a + c.pct, 0) / changes.length) : null,
    price_change_items: changes
  };
}

/**
 * 💡 اقتراح أمر شراء من نواقص المخزون.
 * بيقرأ جداول وحدة الجرد قراءة فقط. إذا مش موجودة منقول ذلك
 * بصراحة بدل ما ننهار أو نطلّع أرقام من الهوا.
 * الكمية المقترحة = حد الطلب − الرصيد (فجوة موثّقة)، وكل سطر
 * بيحمل شرح مصدره.
 */
export function suggestRows() {
  let items;
  try {
    items = db.prepare(
      `SELECT i.id, i.name, i.unit, i.reorder_point,
              COALESCE((SELECT SUM(m.qty) FROM stock_moves m WHERE m.item_id=i.id),0) AS stock
       FROM stock_items i WHERE i.active=1`).all();
  } catch {
    throw new Error("وحدة الجرد (stock_items / stock_moves) مش موجودة بهاي القاعدة — ما منقدر نقترح أمر شراء بلا نواقص حقيقية.");
  }

  // أرخص سعر مسجّل لكل صنف — مصدره قائمة الأسعار، مش تقدير
  const best = new Map();
  for (const p of db.prepare(
    `SELECT p.item_name, p.price, p.updated_at, p.supplier_id, s.name
     FROM procure_prices p JOIN procure_suppliers s ON s.id=p.supplier_id
     WHERE s.active=1 ORDER BY p.price ASC`).all()) {
    const k = norm(p.item_name);
    if (!best.has(k)) best.set(k, p);
  }

  const out = [];
  for (const it of items) {
    const stock = r3(it.stock);
    const rop = Number(it.reorder_point) || 0;
    if (rop <= 0 || stock > rop) continue;          // ما في نقص موثّق → ما في اقتراح
    const gap = r3(rop - stock);
    if (gap <= 0) continue;
    const b = best.get(norm(it.name)) || null;
    out.push({
      item_id: it.id, name: it.name, unit: it.unit,
      stock, reorder_point: rop,
      suggest_qty: gap,
      basis: `الرصيد ${stock} وحد الطلب ${rop} — الفرق ${gap}`,
      supplier_id: b ? b.supplier_id : null,
      supplier_name: b ? b.name : null,
      unit_price: b ? r2(b.price) : null,           // بلا سعر مسجّل → null مش صفر
      line_total: b ? r2(gap * b.price) : null,
      price_note: b ? `أرخص سعر مسجّل (${dayStr(b.updated_at)})` : "ما في سعر مسجّل لهالصنف عند أي مورد"
    });
  }
  return out.sort((a, b) => b.suggest_qty - a.suggest_qty);
}

/** 📈 تاريخ تكلفة الصنف: كل نقطة سعر مسجّلة، مرتّبة بالوقت */
export function costHistory(itemName) {
  const item = norm(itemName);
  if (!item) throw new Error("اكتب اسم الصنف");
  const rows = db.prepare(
    `SELECT h.*, s.name AS supplier_name FROM procure_cost_hist h
     LEFT JOIN procure_suppliers s ON s.id=h.supplier_id
     WHERE h.item_name=? ORDER BY h.at, h.id`).all(item)
    .map((h) => ({ ...h, price: r2(h.price), day: dayStr(h.at) }));

  if (rows.length < 2)
    return { item, rows, first: rows[0] ? rows[0].price : null, last: rows[0] ? rows[0].price : null,
             min: rows[0] ? rows[0].price : null, max: rows[0] ? rows[0].price : null,
             change_pct: null, points: rows.length };

  const prices = rows.map((r) => r.price);
  const first = prices[0], last = prices[prices.length - 1];
  return {
    item, rows, points: rows.length,
    first, last,
    min: Math.min(...prices), max: Math.max(...prices),
    change_pct: first ? r2(((last - first) / first) * 100) : null
  };
}

/** نقطة سعر بتنسجّل بالتاريخ مع مصدرها — أساس مقارنة الأسعار والتقييم */
function logCost(item_name, supplier_id, price, source, at = Date.now()) {
  db.prepare("INSERT INTO procure_cost_hist (item_name,supplier_id,price,source,at) VALUES (?,?,?,?,?)")
    .run(norm(item_name).slice(0, 120), Number(supplier_id), r2(price), String(source).slice(0, 120), Number(at));
}

const supplierExists = (id) =>
  !!db.prepare("SELECT id FROM procure_suppliers WHERE id=?").get(Number(id));

export const router = Router();
router.use(express.json({ limit: "5mb" }));

const ok = (res, data) => res.json({ ok: true, ...data });
const bad = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });
const guard = (fn) => (req, res) => {
  try { fn(req, res); } catch (e) { bad(res, e && e.message ? e.message : "خطأ غير متوقّع"); }
};

router.get("/meta", (req, res) => ok(res, { statuses: STATUSES, pay_terms: PAY_TERMS, methods: METHODS }));

// ══════════ (1) سجل الموردين ══════════
router.get("/suppliers", guard((req, res) => {
  const dues = new Map(duesRows().map((d) => [d.supplier_id, d]));
  const rows = db.prepare("SELECT * FROM procure_suppliers ORDER BY active DESC, name").all()
    .map((s) => {
      const d = dues.get(s.id);
      const n = db.prepare("SELECT COUNT(*) c FROM procure_prices WHERE supplier_id=?").get(s.id);
      const o = db.prepare("SELECT COUNT(*) c FROM procure_orders WHERE supplier_id=?").get(s.id);
      return { ...s, prices: Number(n?.c) || 0, orders: Number(o?.c) || 0, due: d ? d.due : 0 };
    });
  ok(res, {
    rows,
    totals: {
      suppliers: rows.length,
      active: rows.filter((r) => r.active).length,
      due: r2(rows.reduce((a, r) => a + r.due, 0))
    }
  });
}));

router.post("/suppliers", guard((req, res) => {
  const b = req.body || {};
  const name = norm(b.name);
  if (!name) return bad(res, "اسم المورد مطلوب");
  const lead = Number(b.lead_days) || 0;
  if (lead < 0 || lead > 365) return bad(res, "مدة التوريد لازم بين 0 و 365 يوم");
  const phone = String(b.phone || "").trim();
  if (phone && !/^[0-9+\-\s]{6,20}$/.test(phone)) return bad(res, "رقم الهاتف غير صالح");

  db.prepare(`INSERT INTO procure_suppliers (name,phone,items_text,pay_terms,lead_days,note,active,created_at)
              VALUES (?,?,?,?,?,?,1,?)
              ON CONFLICT(name) DO UPDATE SET phone=excluded.phone, items_text=excluded.items_text,
                pay_terms=excluded.pay_terms, lead_days=excluded.lead_days, note=excluded.note`)
    .run(name.slice(0, 120), phone.slice(0, 20), String(b.items_text || "").slice(0, 400),
         String(b.pay_terms || "نقدي").slice(0, 40), Math.round(lead),
         String(b.note || "").slice(0, 500), Date.now());
  const id = db.prepare("SELECT id FROM procure_suppliers WHERE name=?").get(name)?.id;
  ok(res, { id: Number(id) });
}));

router.post("/suppliers/:id/toggle", guard((req, res) => {
  if (!supplierExists(req.params.id)) return bad(res, "المورد غير موجود", 404);
  db.prepare("UPDATE procure_suppliers SET active = 1 - active WHERE id=?").run(Number(req.params.id));
  ok(res, {});
}));

// المورد اللي إلو أوامر ما بينمسح — بينوقف، لأنّ المسح بيمحي تاريخ شراء حقيقي
router.delete("/suppliers/:id", guard((req, res) => {
  const id = Number(req.params.id);
  if (!supplierExists(id)) return bad(res, "المورد غير موجود", 404);
  const o = db.prepare("SELECT COUNT(*) c FROM procure_orders WHERE supplier_id=?").get(id);
  const bl = db.prepare("SELECT COUNT(*) c FROM procure_bills WHERE supplier_id=?").get(id);
  const used = (Number(o?.c) || 0) + (Number(bl?.c) || 0);
  if (used) {
    db.prepare("UPDATE procure_suppliers SET active=0 WHERE id=?").run(id);
    return ok(res, { archived: true, records: used });
  }
  db.transaction(() => {
    db.prepare("DELETE FROM procure_prices WHERE supplier_id=?").run(id);
    db.prepare("DELETE FROM procure_suppliers WHERE id=?").run(id);
  })();
  ok(res, { deleted: true });
}));

// ══════════ (2) قائمة الأسعار ══════════
router.get("/prices", guard((req, res) => {
  const w = [], p = [];
  if (req.query.supplier_id) { w.push("p.supplier_id=?"); p.push(Number(req.query.supplier_id)); }
  if (req.query.item) { w.push("p.item_name LIKE ?"); p.push("%" + norm(req.query.item) + "%"); }
  const rows = db.prepare(
    `SELECT p.*, s.name AS supplier_name, s.active FROM procure_prices p
     JOIN procure_suppliers s ON s.id=p.supplier_id
     ${w.length ? "WHERE " + w.join(" AND ") : ""}
     ORDER BY p.item_name, p.price`).all(...p)
    .map((r) => ({ ...r, price: r2(r.price), updated_day: dayStr(r.updated_at),
                   age_days: Math.floor((Date.now() - Number(r.updated_at)) / DAY) }));
  ok(res, { rows });
}));

router.post("/prices", guard((req, res) => {
  const b = req.body || {};
  const sid = Number(b.supplier_id);
  if (!supplierExists(sid)) return bad(res, "اختر مورد موجود");
  const item = norm(b.item_name);
  if (!item) return bad(res, "اسم الصنف مطلوب");
  const price = Number(b.price);
  if (!Number.isFinite(price) || price <= 0) return bad(res, "السعر لازم رقم أكبر من صفر");

  const now = Date.now();
  const prev = db.prepare("SELECT price FROM procure_prices WHERE supplier_id=? AND item_name=?").get(sid, item);
  db.transaction(() => {
    db.prepare(`INSERT INTO procure_prices (supplier_id,item_name,unit,price,note,updated_at)
                VALUES (?,?,?,?,?,?)
                ON CONFLICT(supplier_id,item_name) DO UPDATE SET
                  unit=excluded.unit, price=excluded.price, note=excluded.note, updated_at=excluded.updated_at`)
      .run(sid, item.slice(0, 120), String(b.unit || "حبة").slice(0, 20), r2(price),
           String(b.note || "").slice(0, 200), now);
    // منسجّل نقطة تاريخية بس لمّا السعر فعلاً يتغيّر — التكرار بيلوّث التاريخ
    if (!prev || r2(prev.price) !== r2(price)) logCost(item, sid, price, "قائمة أسعار", now);
  })();
  ok(res, { changed: !prev || r2(prev.price) !== r2(price) });
}));

router.delete("/prices/:id", guard((req, res) => {
  db.prepare("DELETE FROM procure_prices WHERE id=?").run(Number(req.params.id));
  ok(res, {});
}));

// ══════════ (3) مقارنة الأسعار لنفس الصنف ══════════
router.get("/compare", guard((req, res) => {
  const item = norm(req.query.item);
  if (!item) return bad(res, "اكتب اسم الصنف اللي بدك تقارنه");
  const rows = db.prepare(
    `SELECT p.*, s.name AS supplier_name, s.phone, s.pay_terms, s.lead_days, s.active
     FROM procure_prices p JOIN procure_suppliers s ON s.id=p.supplier_id
     WHERE p.item_name=? AND s.active=1 ORDER BY p.price ASC, p.updated_at DESC`).all(item);
  if (!rows.length)
    return ok(res, { item, rows: [], best: null, spread: null,
                     msg: "ما في سعر مسجّل لهالصنف عند أي مورد نشط" });

  const cheapest = r2(rows[0].price);
  const dearest = r2(rows[rows.length - 1].price);
  ok(res, {
    item,
    rows: rows.map((r, i) => ({
      ...r, price: r2(r.price), best: i === 0,
      updated_day: dayStr(r.updated_at),
      age_days: Math.floor((Date.now() - Number(r.updated_at)) / DAY),
      // الفرق عن الأرخص — بيوفّر عليك قد إيش لو حوّلت لهالمورد
      extra: r2(Number(r.price) - cheapest),
      extra_pct: cheapest ? r2(((Number(r.price) - cheapest) / cheapest) * 100) : null
    })),
    best: { supplier_id: rows[0].supplier_id, supplier_name: rows[0].supplier_name, price: cheapest },
    // فرق السعر بين الأرخص والأغلى — بلا مورّدين اثنين ما إلو معنى
    spread: rows.length > 1 ? r2(dearest - cheapest) : null
  });
}));

// ══════════ (4) أوامر الشراء ══════════
router.get("/orders", guard((req, res) => {
  const w = [], p = [];
  if (req.query.supplier_id) { w.push("o.supplier_id=?"); p.push(Number(req.query.supplier_id)); }
  if (req.query.status) { w.push("o.status=?"); p.push(String(req.query.status)); }
  const orders = db.prepare(
    `SELECT o.*, s.name AS supplier_name FROM procure_orders o
     LEFT JOIN procure_suppliers s ON s.id=o.supplier_id
     ${w.length ? "WHERE " + w.join(" AND ") : ""}
     ORDER BY o.id DESC LIMIT 500`).all(...p);
  const rows = orders.map((o) => ({ ...o, totals: orderTotals(orderLines(o.id)),
                                    created_day: dayStr(o.created_at) }));
  ok(res, {
    rows,
    totals: {
      orders: rows.length,
      value: r2(rows.reduce((a, r) => a + r.totals.value, 0)),
      open_value: r2(rows.filter((r) => r.status !== "ملغي")
                         .reduce((a, r) => a + r.totals.open_value, 0)),
      open: rows.filter((r) => ["مسودة", "مرسل", "مستلم جزئي"].includes(r.status)).length
    }
  });
}));

router.post("/orders", guard((req, res) => {
  const b = req.body || {};
  const sid = Number(b.supplier_id);
  if (!supplierExists(sid)) return bad(res, "اختر مورد موجود");
  if (b.expected_at && !isDate(b.expected_at)) return bad(res, "الموعد المتوقّع لازم بصيغة YYYY-MM-DD");
  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (!lines.length) return bad(res, "أمر الشراء لازم سطر واحد على الأقل");

  const clean = [];
  for (const l of lines) {
    const item = norm(l?.item_name);
    if (!item) return bad(res, "كل سطر لازم اسم صنف");
    const qty = Number(l?.qty);
    if (!Number.isFinite(qty) || qty <= 0) return bad(res, `الكمية للصنف «${item}» لازم أكبر من صفر`);
    const price = Number(l?.unit_price);
    if (!Number.isFinite(price) || price < 0) return bad(res, `سعر الصنف «${item}» غير صالح`);
    clean.push({ item_name: item.slice(0, 120), unit: String(l?.unit || "حبة").slice(0, 20),
                 qty: r3(qty), unit_price: r2(price), note: String(l?.note || "").slice(0, 200) });
  }

  const now = Date.now();
  const id = db.transaction(() => {
    const o = db.prepare(`INSERT INTO procure_orders (supplier_id,status,expected_at,note,created_at)
                          VALUES (?,'مسودة',?,?,?)`)
      .run(sid, String(b.expected_at || ""), String(b.note || "").slice(0, 500), now);
    const oid = Number(o.lastInsertRowid);
    const ins = db.prepare(`INSERT INTO procure_order_lines (order_id,item_name,unit,qty,unit_price,received_qty,note)
                            VALUES (?,?,?,?,?,0,?)`);
    for (const c of clean) ins.run(oid, c.item_name, c.unit, c.qty, c.unit_price, c.note);
    return oid;
  })();
  ok(res, { id, totals: orderTotals(clean.map((c) => ({ ...c, received_qty: 0 }))) });
}));

router.get("/orders/:id", guard((req, res) => {
  const v = orderView(req.params.id);
  if (!v) return bad(res, "أمر الشراء غير موجود", 404);
  ok(res, v);
}));

router.post("/orders/:id/status", guard((req, res) => {
  const v = orderView(req.params.id);
  if (!v) return bad(res, "أمر الشراء غير موجود", 404);
  const st = String(req.body?.status || "");
  if (!["مرسل", "ملغي", "مسودة"].includes(st))
    return bad(res, "الحالة اليدوية المسموحة: مسودة / مرسل / ملغي — والاستلام بينحدد لحاله من الكميات");
  if (v.totals.received > 0 && st !== "ملغي")
    return bad(res, "الأمر صار فيه استلام — ما بينرجع لمسودة أو مرسل");
  db.prepare("UPDATE procure_orders SET status=?, sent_at=COALESCE(sent_at, ?) WHERE id=?")
    .run(st, st === "مرسل" ? Date.now() : null, v.order.id);
  ok(res, { status: st });
}));

router.delete("/orders/:id", guard((req, res) => {
  const v = orderView(req.params.id);
  if (!v) return bad(res, "أمر الشراء غير موجود", 404);
  if (v.totals.received > 0) return bad(res, "الأمر فيه استلام مسجّل — ألغِه بدل ما تمحيه");
  db.transaction(() => {
    db.prepare("DELETE FROM procure_order_lines WHERE order_id=?").run(v.order.id);
    db.prepare("DELETE FROM procure_orders WHERE id=?").run(v.order.id);
  })();
  ok(res, { deleted: true });
}));

// ══════════ (5) الاستلام الكامل أو الجزئي ══════════
// كل سطر بتستلمه بينسجّل بكميته الفعلية، والفرق بينحسب لحاله.
// وسعر الاستلام (إذا اختلف) بينكتب بتاريخ التكلفة حتى تشوف
// المورد اللي بيرفّع عليك بهدوء.
router.post("/orders/:id/receive", guard((req, res) => {
  const v = orderView(req.params.id);
  if (!v) return bad(res, "أمر الشراء غير موجود", 404);
  if (v.order.status === "ملغي") return bad(res, "الأمر ملغي — ما بينستلم");

  const input = Array.isArray(req.body?.lines) ? req.body.lines : [];
  if (!input.length) return bad(res, "حدّد الكميات اللي وصلتك");
  const byId = new Map(v.lines.map((l) => [l.id, l]));

  const updates = [];
  for (const r of input) {
    const line = byId.get(Number(r?.line_id));
    if (!line) return bad(res, "في سطر مش تابع لهالأمر");
    const q = Number(r?.qty);
    if (!Number.isFinite(q) || q < 0) return bad(res, `الكمية المستلمة للصنف «${line.item_name}» لازم رقم غير سالب`);
    const total = r3(Number(line.received_qty) + q);
    if (total > Number(line.qty) + 0.0001 && !req.body?.allow_over)
      return bad(res, `الكمية المستلمة للصنف «${line.item_name}» أكبر من المطلوب (${line.qty}). فعّل «اسمح بالزيادة» إذا فعلاً وصلك أكثر.`);
    const price = r?.unit_price == null || r.unit_price === "" ? null : Number(r.unit_price);
    if (price != null && (!Number.isFinite(price) || price < 0))
      return bad(res, `سعر الاستلام للصنف «${line.item_name}» غير صالح`);
    updates.push({ line, add: r3(q), total, price: price == null ? null : r2(price) });
  }

  const now = Date.now();
  const at = isDate(req.body?.day) ? Date.parse(req.body.day + "T00:00:00Z") - TZ_MS : now;
  db.transaction(() => {
    for (const u of updates) {
      db.prepare("UPDATE procure_order_lines SET received_qty=?, unit_price=? WHERE id=?")
        .run(u.total, u.price == null ? u.line.unit_price : u.price, u.line.id);
      if (u.add > 0)
        logCost(u.line.item_name, v.order.supplier_id,
                u.price == null ? u.line.unit_price : u.price, `استلام أمر #${v.order.id}`, at);
    }
    const after = orderTotals(orderLines(v.order.id));
    const st = statusFromReceipt(v.order.status, after);
    db.prepare("UPDATE procure_orders SET status=?, received_at=? WHERE id=?")
      .run(st, st === "مستلم" ? at : (after.received > 0 ? at : null), v.order.id);
  })();

  const out = orderView(v.order.id);
  ok(res, {
    status: out.order.status, totals: out.totals,
    // الفرق سطر بسطر — هاد اللي بتحاسب عليه المورد
    variances: out.lines.filter((l) => l.variance !== 0)
      .map((l) => ({ item_name: l.item_name, ordered: l.qty, received: l.received_qty,
                     variance: l.variance, value: r2(l.variance * l.unit_price) }))
  });
}));

// ══════════ (6) الفواتير والمستحقات ══════════
router.get("/bills", guard((req, res) => {
  const w = [], p = [];
  if (req.query.supplier_id) { w.push("b.supplier_id=?"); p.push(Number(req.query.supplier_id)); }
  const rows = db.prepare(
    `SELECT b.*, s.name AS supplier_name FROM procure_bills b
     LEFT JOIN procure_suppliers s ON s.id=b.supplier_id
     ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY b.id DESC LIMIT 500`).all(...p)
    .map((b) => ({ ...b, amount: r2(b.amount) }));
  const pays = db.prepare(
    `SELECT y.*, s.name AS supplier_name FROM procure_payments y
     LEFT JOIN procure_suppliers s ON s.id=y.supplier_id
     ${req.query.supplier_id ? "WHERE y.supplier_id=?" : ""} ORDER BY y.id DESC LIMIT 500`)
    .all(...(req.query.supplier_id ? [Number(req.query.supplier_id)] : []))
    .map((y) => ({ ...y, amount: r2(y.amount) }));
  ok(res, { rows, payments: pays });
}));

router.post("/bills", guard((req, res) => {
  const b = req.body || {};
  const sid = Number(b.supplier_id);
  if (!supplierExists(sid)) return bad(res, "اختر مورد موجود");
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0) return bad(res, "قيمة الفاتورة لازم أكبر من صفر");
  if (b.bill_date && !isDate(b.bill_date)) return bad(res, "تاريخ الفاتورة لازم بصيغة YYYY-MM-DD");
  let oid = null;
  if (b.order_id) {
    const o = db.prepare("SELECT id,supplier_id FROM procure_orders WHERE id=?").get(Number(b.order_id));
    if (!o) return bad(res, "أمر الشراء المربوط غير موجود");
    if (Number(o.supplier_id) !== sid) return bad(res, "أمر الشراء تبع مورد ثاني");
    oid = Number(o.id);
  }
  const r = db.prepare(`INSERT INTO procure_bills (supplier_id,order_id,ref,amount,bill_date,note,created_at)
                        VALUES (?,?,?,?,?,?,?)`)
    .run(sid, oid, String(b.ref || "").slice(0, 60), r2(amount),
         String(b.bill_date || dayStr(Date.now())), String(b.note || "").slice(0, 300), Date.now());
  ok(res, { id: Number(r.lastInsertRowid) });
}));

router.delete("/bills/:id", guard((req, res) => {
  db.prepare("DELETE FROM procure_bills WHERE id=?").run(Number(req.params.id));
  ok(res, {});
}));

router.post("/payments", guard((req, res) => {
  const b = req.body || {};
  const sid = Number(b.supplier_id);
  if (!supplierExists(sid)) return bad(res, "اختر مورد موجود");
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0) return bad(res, "قيمة الدفعة لازم أكبر من صفر");
  if (b.paid_at && !isDate(b.paid_at)) return bad(res, "تاريخ الدفع لازم بصيغة YYYY-MM-DD");
  if (b.method && !METHODS.includes(String(b.method))) return bad(res, "طريقة الدفع غير معروفة");
  const r = db.prepare(`INSERT INTO procure_payments (supplier_id,bill_id,amount,paid_at,method,note,created_at)
                        VALUES (?,?,?,?,?,?,?)`)
    .run(sid, b.bill_id ? Number(b.bill_id) : null, r2(amount),
         String(b.paid_at || dayStr(Date.now())), String(b.method || "نقدي"),
         String(b.note || "").slice(0, 300), Date.now());
  ok(res, { id: Number(r.lastInsertRowid) });
}));

router.delete("/payments/:id", guard((req, res) => {
  db.prepare("DELETE FROM procure_payments WHERE id=?").run(Number(req.params.id));
  ok(res, {});
}));

router.get("/dues", guard((req, res) => {
  const rows = duesRows();
  ok(res, {
    rows,
    totals: {
      billed: r2(rows.reduce((a, r) => a + r.billed, 0)),
      paid: r2(rows.reduce((a, r) => a + r.paid, 0)),
      due: r2(rows.reduce((a, r) => a + r.due, 0)),
      // المورّدين اللي عليك إلهم فلوس فعلاً
      owed_to: rows.filter((r) => r.due > 0).length
    }
  });
}));

// ══════════ (7) تقييم أداء المورد ══════════
router.get("/scorecard", guard((req, res) => {
  const dues = new Map(duesRows().map((d) => [d.supplier_id, d]));
  const rows = db.prepare("SELECT id,name,phone,pay_terms,lead_days,active FROM procure_suppliers ORDER BY name").all()
    .map((s) => ({ ...s, ...supplierScore(s.id), due: dues.get(s.id)?.due ?? 0 }));
  ok(res, {
    rows,
    // بلا بيانات كافية ما منعطي «أفضل مورد» — منقول ما في
    ranked: rows.filter((r) => r.on_time_rate != null)
                .sort((a, b) => b.on_time_rate - a.on_time_rate).slice(0, 5)
  });
}));

router.get("/scorecard/:id", guard((req, res) => {
  if (!supplierExists(req.params.id)) return bad(res, "المورد غير موجود", 404);
  ok(res, supplierScore(req.params.id));
}));

// ══════════ (8) اقتراح أمر شراء من النواقص ══════════
router.get("/suggest", guard((req, res) => {
  let rows;
  try { rows = suggestRows(); }
  catch (e) { return bad(res, e.message); }
  ok(res, {
    rows,
    totals: {
      items: rows.length,
      priced: rows.filter((r) => r.unit_price != null).length,
      unpriced: rows.filter((r) => r.unit_price == null).length,
      // القيمة محسوبة بس على السطور اللي إلها سعر مسجّل
      value: r2(rows.reduce((a, r) => a + (r.line_total || 0), 0))
    }
  });
}));

// يحوّل الاقتراح لأمر شراء فعلي عند مورد واحد — بس السطور اللي إلها سعر منه
router.post("/suggest/apply", guard((req, res) => {
  const sid = Number(req.body?.supplier_id);
  if (!supplierExists(sid)) return bad(res, "اختر مورد موجود");
  let rows;
  try { rows = suggestRows(); }
  catch (e) { return bad(res, e.message); }

  const priced = db.prepare("SELECT item_name, unit, price FROM procure_prices WHERE supplier_id=?").all(sid);
  const map = new Map(priced.map((p) => [norm(p.item_name), p]));
  const lines = rows.map((r) => ({ r, p: map.get(norm(r.name)) })).filter((x) => x.p);
  if (!lines.length)
    return bad(res, "ما في ولا صنف ناقص إلو سعر مسجّل عند هالمورد — سجّل أسعاره أول");

  const now = Date.now();
  const id = db.transaction(() => {
    const o = db.prepare(`INSERT INTO procure_orders (supplier_id,status,expected_at,note,created_at)
                          VALUES (?,'مسودة','',?,?)`)
      .run(sid, "مقترح تلقائياً من نواقص المخزون", now);
    const oid = Number(o.lastInsertRowid);
    const ins = db.prepare(`INSERT INTO procure_order_lines (order_id,item_name,unit,qty,unit_price,received_qty,note)
                            VALUES (?,?,?,?,?,0,?)`);
    for (const x of lines)
      ins.run(oid, x.r.name, x.p.unit || x.r.unit || "حبة", x.r.suggest_qty, r2(x.p.price), x.r.basis);
    return oid;
  })();
  ok(res, { id, lines: lines.length, skipped: rows.length - lines.length });
}));

// ══════════ (9) تاريخ تكلفة الصنف ══════════
router.get("/cost-history", guard((req, res) => {
  ok(res, costHistory(req.query.item));
}));

router.get("/cost-items", guard((req, res) => {
  ok(res, { rows: db.prepare(
    `SELECT item_name, COUNT(*) points, MIN(price) min, MAX(price) max, MAX(at) last_at
     FROM procure_cost_hist GROUP BY item_name ORDER BY item_name`).all()
    .map((r) => ({ ...r, min: r2(r.min), max: r2(r.max), last_day: dayStr(r.last_at) })) });
}));

// ══════════ (10) التصدير ══════════
const csv = (res, name, head, lines) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  res.send("﻿" + [head.map(esc).join(","), ...lines.map((l) => l.map(esc).join(","))].join("\r\n"));
};

router.get("/orders.csv", guard((req, res) => {
  const rows = db.prepare(
    `SELECT o.id, o.status, o.expected_at, o.created_at, o.received_at, s.name AS supplier_name
     FROM procure_orders o LEFT JOIN procure_suppliers s ON s.id=o.supplier_id
     ORDER BY o.id DESC LIMIT 2000`).all();
  const out = [];
  for (const o of rows) {
    for (const l of orderLines(o.id))
      out.push([o.id, o.supplier_name || "—", o.status, dayStr(o.created_at), o.expected_at || "—",
                o.received_at ? dayStr(o.received_at) : "—", l.item_name, l.unit, l.qty, l.unit_price,
                r2(l.qty * l.unit_price), l.received_qty, r3(l.qty - l.received_qty), l.note]);
  }
  csv(res, "procure-orders.csv",
    ["رقم الأمر", "المورد", "الحالة", "تاريخ الإنشاء", "الموعد المتوقّع", "تاريخ الاستلام",
     "الصنف", "الوحدة", "الكمية", "سعر الوحدة", "قيمة السطر", "المستلم", "الفرق", "ملاحظة"], out);
}));

router.get("/dues.csv", guard((req, res) => {
  const rows = duesRows();
  csv(res, "procure-dues.csv",
    ["المورد", "الهاتف", "شروط الدفع", "عدد الفواتير", "إجمالي الفواتير", "المدفوع", "المستحق عليك"],
    rows.map((r) => [r.name, r.phone || "—", r.pay_terms, r.bills, r.billed, r.paid, r.due]));
}));

router.get("/prices.csv", guard((req, res) => {
  const rows = db.prepare(
    `SELECT p.*, s.name AS supplier_name FROM procure_prices p
     JOIN procure_suppliers s ON s.id=p.supplier_id ORDER BY p.item_name, p.price`).all();
  csv(res, "procure-prices.csv",
    ["الصنف", "المورد", "الوحدة", "السعر", "آخر تحديث", "ملاحظة"],
    rows.map((r) => [r.item_name, r.supplier_name, r.unit, r2(r.price), dayStr(r.updated_at), r.note]));
}));
