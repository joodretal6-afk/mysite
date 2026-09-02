// ═══════════════════════════════════════════════════════════
// 📦 وحدة الجرد والمخزون — 15 ميزة
//
//  1) دليل الأصناف (وحدة، باركود، تكلفة، سعر)
//  2) دفتر حركة المخزون (كل دخول وخروج بمرجعه)
//  3) الرصيد الحالي محسوب من الحركات — مش رقم مكتوب بالإيد
//  4) جلسة جرد فعلي: متوقّع مقابل معدود مقابل الفرق
//  5) استيراد الجرد من ملف (إكسل / CSV / PDF)
//  6) خصم الأحمال المُسلَّمة من المخزون تلقائياً
//  7) إرجاع الطرود المرفوضة للمخزون تلقائياً
//  8) حد إعادة الطلب وتنبيهات النقص
//  9) تغطية بالأيام من سرعة البيع الحقيقية
// 10) الدفعات وتواريخ الصلاحية
// 11) تنبيه قرب انتهاء الصلاحية
// 12) تقييم المخزون بالتكلفة وبسعر البيع
// 13) سجل الهدر والتالف بأسبابه
// 14) كشف حركة الصنف الواحد
// 15) تصدير الجرد + طباعة ورقة جرد جاهزة
//
// 🔴 القاعدة: الرصيد = مجموع الحركات. ما في رقم بينكتب من
//    برّا بلا حركة توثّقه. وأي تسوية جرد بتتسجّل كحركة
//    باسمها وسببها — حتى تعرف مين وليش غيّر الرصيد.
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import express from "express";
import { db } from "../db/database.js";
import { readAnyFile, matchColumns, num } from "../bot/fileRead.js";

export const slug = "stock";
export const title = "الجرد والمخزون";
export const icon = "📦";

try {
  db.exec(`
  CREATE TABLE IF NOT EXISTS stock_items (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL UNIQUE,
    unit           TEXT DEFAULT 'حبة',
    barcode        TEXT DEFAULT '',
    cost           REAL NOT NULL DEFAULT 0,
    price          REAL NOT NULL DEFAULT 0,
    reorder_point  REAL NOT NULL DEFAULT 0,
    shelf_life     INTEGER NOT NULL DEFAULT 0,
    active         INTEGER NOT NULL DEFAULT 1,
    created_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stock_moves (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id    INTEGER NOT NULL,
    qty        REAL NOT NULL,
    kind       TEXT NOT NULL,
    ref_type   TEXT DEFAULT '',
    ref_id     TEXT DEFAULT '',
    batch      TEXT DEFAULT '',
    expiry     TEXT DEFAULT '',
    unit_cost  REAL NOT NULL DEFAULT 0,
    note       TEXT DEFAULT '',
    at         INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS stock_moves_item ON stock_moves(item_id, at);
  CREATE UNIQUE INDEX IF NOT EXISTS stock_moves_ref
    ON stock_moves(ref_type, ref_id, item_id) WHERE ref_type <> '';

  CREATE TABLE IF NOT EXISTS stock_counts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'مفتوح',
    note       TEXT DEFAULT '',
    started_at INTEGER NOT NULL,
    closed_at  INTEGER
  );

  CREATE TABLE IF NOT EXISTS stock_count_lines (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    count_id INTEGER NOT NULL,
    item_id  INTEGER NOT NULL,
    expected REAL NOT NULL DEFAULT 0,
    counted  REAL,
    note     TEXT DEFAULT ''
  );
  CREATE UNIQUE INDEX IF NOT EXISTS stock_count_uq ON stock_count_lines(count_id, item_id);`);
} catch (e) { console.error("stock tables:", e && e.message); }

// ── ثوابت ──
const KINDS = ["استلام", "بيع", "مرتجع", "هدر", "تسوية جرد", "تحويل"];
const WASTE_REASONS = ["انتهت الصلاحية", "كسر/تلف", "خطأ تحضير", "عينة", "أخرى"];
const DAY = 86400000;
const TZ_MS = 10800 * 1000;

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const r3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;
const dayStr = (ts) => new Date(Number(ts) + TZ_MS).toISOString().slice(0, 10);
function dayStart(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) - TZ_MS : null;
}
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());

// ═══════════════════════════════════════════════════════════
// 🧮 المحرّك — كله مشتق من الحركات، ولا رقم محفوظ على جنب
// ═══════════════════════════════════════════════════════════

/** الرصيد الحالي لكل صنف = مجموع حركاته */
export function onHandMap() {
  const m = new Map();
  try {
    for (const r of db.prepare("SELECT item_id, COALESCE(SUM(qty),0) q FROM stock_moves GROUP BY item_id").all())
      m.set(Number(r.item_id), r3(r.q));
  } catch { /* ما في حركات بعد */ }
  return m;
}

/**
 * سرعة البيع الحقيقية: كم حبة بتطلع باليوم، محسوبة من حركات
 * البيع خلال آخر N يوم. إذا ما في ولا حركة بيع → null، وما
 * منحسب "تغطية" وهمية.
 */
export function velocityMap(days = 30) {
  const since = Date.now() - days * DAY;
  const m = new Map();
  try {
    for (const r of db.prepare(
      `SELECT item_id, COALESCE(SUM(-qty),0) q FROM stock_moves
       WHERE kind='بيع' AND at >= ? GROUP BY item_id`).all(since)) {
      const per = Number(r.q) / days;
      if (per > 0) m.set(Number(r.item_id), r3(per));
    }
  } catch { /* لا شيء */ }
  return m;
}

/** الدفعات المتبقّية لكل صنف (اللي إلها رقم دفعة أو صلاحية) */
export function batchRows() {
  try {
    return db.prepare(
      `SELECT m.item_id, i.name, m.batch, m.expiry, ROUND(SUM(m.qty),3) qty
       FROM stock_moves m JOIN stock_items i ON i.id=m.item_id
       WHERE m.batch <> '' OR m.expiry <> ''
       GROUP BY m.item_id, m.batch, m.expiry
       HAVING SUM(m.qty) > 0.0001
       ORDER BY (m.expiry='') ASC, m.expiry ASC`).all();
  } catch { return []; }
}

/** الصورة الكاملة لصنف: رصيد + تغطية + قيمة + حالة */
export function itemsView({ days = 30, expiryWarnDays = 30 } = {}) {
  const items = db.prepare("SELECT * FROM stock_items ORDER BY active DESC, name").all();
  const oh = onHandMap(), vel = velocityMap(days);
  const today = dayStr(Date.now());
  const soon = dayStr(Date.now() + expiryWarnDays * DAY);

  const expiryByItem = new Map();
  for (const b of batchRows()) {
    if (!b.expiry) continue;
    const cur = expiryByItem.get(b.item_id);
    if (!cur || b.expiry < cur.expiry) expiryByItem.set(b.item_id, { expiry: b.expiry, qty: b.qty });
  }

  return items.map((it) => {
    const stock = oh.get(it.id) || 0;
    const v = vel.get(it.id) ?? null;
    const cover = v && v > 0 ? Math.floor(stock / v) : null;   // null = ما في مبيعات نحسب عليها
    const nearest = expiryByItem.get(it.id) || null;

    let status = "سليم";
    if (stock <= 0) status = "نفد";
    else if (it.reorder_point > 0 && stock <= it.reorder_point) status = "تحت الحد";
    if (nearest && nearest.expiry <= today) status = "منتهي الصلاحية";
    else if (nearest && nearest.expiry <= soon && status === "سليم") status = "قرب الانتهاء";

    return {
      ...it, stock,
      velocity: v, cover,
      value_cost: r2(stock * it.cost),
      value_sale: r2(stock * it.price),
      nearest_expiry: nearest ? nearest.expiry : "",
      nearest_expiry_qty: nearest ? nearest.qty : 0,
      status
    };
  });
}

/** يسجّل حركة. الكمية موجبة = دخول، سالبة = خروج. */
export function addMove({ item_id, qty, kind, ref_type = "", ref_id = "", batch = "", expiry = "", unit_cost = 0, note = "", at = Date.now() }) {
  const q = Number(qty);
  if (!Number.isFinite(q) || q === 0) throw new Error("الكمية لازم رقم مش صفر");
  if (!KINDS.includes(kind)) throw new Error("نوع الحركة غير معروف");
  const it = db.prepare("SELECT id FROM stock_items WHERE id=?").get(Number(item_id));
  if (!it) throw new Error("الصنف غير موجود");
  if (expiry && !isDate(expiry)) throw new Error("تاريخ الصلاحية لازم بصيغة YYYY-MM-DD");

  const r = db.prepare(`INSERT INTO stock_moves
      (item_id,qty,kind,ref_type,ref_id,batch,expiry,unit_cost,note,at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(Number(item_id), r3(q), kind, String(ref_type).slice(0, 40), String(ref_id).slice(0, 60),
         String(batch).slice(0, 60), String(expiry).slice(0, 10), r2(unit_cost),
         String(note).slice(0, 300), Number(at) || Date.now());
  return Number(r.lastInsertRowid);
}

/** حركة مرتبطة بمستند خارجي — بتتجاهل التكرار بدل ما تخصم مرتين */
function addMoveIdempotent(payload) {
  try { return { added: true, id: addMove(payload) }; }
  catch (e) {
    if (/UNIQUE|constraint/i.test(e.message)) return { added: false, id: null };
    throw e;
  }
}

export const router = Router();
router.use(express.json({ limit: "30mb" }));

const ok = (res, data) => res.json({ ok: true, ...data });
const bad = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });
const guard = (fn) => (req, res) => {
  try { fn(req, res); } catch (e) { bad(res, e && e.message ? e.message : "خطأ غير متوقّع"); }
};

router.get("/meta", (req, res) => ok(res, { kinds: KINDS, waste_reasons: WASTE_REASONS }));

// ══════════ (1) دليل الأصناف ══════════
router.get("/items", guard((req, res) => {
  const view = itemsView({ days: Number(req.query.days) || 30 });
  ok(res, {
    rows: view,
    totals: {
      items: view.length,
      units: r3(view.reduce((a, r) => a + r.stock, 0)),
      value_cost: r2(view.reduce((a, r) => a + r.value_cost, 0)),
      value_sale: r2(view.reduce((a, r) => a + r.value_sale, 0)),
      low: view.filter((r) => r.status === "تحت الحد").length,
      out: view.filter((r) => r.status === "نفد").length,
      expiring: view.filter((r) => r.status === "قرب الانتهاء" || r.status === "منتهي الصلاحية").length
    }
  });
}));

router.post("/items", guard((req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim();
  if (!name) return bad(res, "اسم الصنف مطلوب");
  const nums = { cost: Number(b.cost) || 0, price: Number(b.price) || 0,
                 reorder_point: Number(b.reorder_point) || 0, shelf_life: Number(b.shelf_life) || 0 };
  for (const [k, v] of Object.entries(nums)) if (v < 0) return bad(res, `القيمة ${k} ما بتصير سالبة`);

  db.prepare(`INSERT INTO stock_items (name,unit,barcode,cost,price,reorder_point,shelf_life,active,created_at)
              VALUES (?,?,?,?,?,?,?,1,?)
              ON CONFLICT(name) DO UPDATE SET unit=excluded.unit, barcode=excluded.barcode,
                cost=excluded.cost, price=excluded.price, reorder_point=excluded.reorder_point,
                shelf_life=excluded.shelf_life`)
    .run(name.slice(0, 120), String(b.unit || "حبة").slice(0, 20), String(b.barcode || "").slice(0, 60),
         r2(nums.cost), r2(nums.price), r3(nums.reorder_point), Math.round(nums.shelf_life), Date.now());
  ok(res, {});
}));

router.post("/items/:id/toggle", guard((req, res) => {
  db.prepare("UPDATE stock_items SET active = 1 - active WHERE id=?").run(Number(req.params.id));
  ok(res, {});
}));

router.delete("/items/:id", guard((req, res) => {
  const id = Number(req.params.id);
  const n = db.prepare("SELECT COUNT(*) c FROM stock_moves WHERE item_id=?").get(id);
  // الصنف اللي إلو حركات ما بينمسح — بينوقف. المسح بيمحي تاريخ حقيقي.
  if (Number(n?.c)) {
    db.prepare("UPDATE stock_items SET active=0 WHERE id=?").run(id);
    return ok(res, { archived: true, moves: Number(n.c) });
  }
  db.prepare("DELETE FROM stock_items WHERE id=?").run(id);
  ok(res, { deleted: true });
}));

// ══════════ (2) حركات المخزون + (13) الهدر ══════════
router.post("/moves", guard((req, res) => {
  const b = req.body || {};
  const at = b.day ? dayStart(b.day) : Date.now();
  if (b.day && at == null) return bad(res, "التاريخ لازم بصيغة YYYY-MM-DD");
  // الخروج بيتكتب بالسالب حتى لو المستخدم كتب رقم موجب
  const OUT = ["بيع", "هدر"];
  let qty = Number(b.qty);
  if (OUT.includes(b.kind)) qty = -Math.abs(qty);
  const id = addMove({ ...b, qty, at });
  ok(res, { id });
}));

router.get("/moves", guard((req, res) => {
  const w = [], p = [];
  if (req.query.item_id) { w.push("m.item_id = ?"); p.push(Number(req.query.item_id)); }
  if (req.query.kind) { w.push("m.kind = ?"); p.push(String(req.query.kind)); }
  const from = dayStart(req.query.from), to = dayStart(req.query.to);
  if (from != null) { w.push("m.at >= ?"); p.push(from); }
  if (to != null) { w.push("m.at < ?"); p.push(to + DAY); }
  const rows = db.prepare(
    `SELECT m.*, i.name, i.unit FROM stock_moves m JOIN stock_items i ON i.id=m.item_id
     ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY m.at DESC, m.id DESC LIMIT 1000`).all(...p);
  ok(res, { rows });
}));

router.delete("/moves/:id", guard((req, res) => {
  db.prepare("DELETE FROM stock_moves WHERE id=?").run(Number(req.params.id));
  ok(res, {});
}));

// ══════════ (14) كشف حركة الصنف — رصيد جاري سطر بسطر ══════════
router.get("/items/:id/ledger", guard((req, res) => {
  const id = Number(req.params.id);
  const item = db.prepare("SELECT * FROM stock_items WHERE id=?").get(id);
  if (!item) return bad(res, "الصنف غير موجود", 404);
  const moves = db.prepare("SELECT * FROM stock_moves WHERE item_id=? ORDER BY at, id").all(id);
  let run = 0;
  const rows = moves.map((m) => { run = r3(run + Number(m.qty)); return { ...m, balance: run }; });
  ok(res, {
    item, rows: rows.reverse(), balance: run,
    in: r3(moves.filter((m) => m.qty > 0).reduce((a, m) => a + m.qty, 0)),
    out: r3(-moves.filter((m) => m.qty < 0).reduce((a, m) => a + m.qty, 0))
  });
}));

// ══════════ (8)(11) التنبيهات ══════════
router.get("/alerts", guard((req, res) => {
  const view = itemsView({ days: Number(req.query.days) || 30,
                           expiryWarnDays: Number(req.query.warn) || 30 });
  const low = view.filter((r) => r.active && (r.status === "تحت الحد" || r.status === "نفد"))
    .map((r) => ({
      item_id: r.id, name: r.name, stock: r.stock, reorder_point: r.reorder_point,
      cover: r.cover, status: r.status,
      // الكمية المقترحة = تغطية شهر من سرعة البيع الفعلية، وإلا حد الطلب
      suggest: r.velocity ? Math.max(0, Math.ceil(r.velocity * 30 - r.stock)) : null
    }));
  const expiring = batchRows()
    .filter((b) => b.expiry && b.expiry <= dayStr(Date.now() + (Number(req.query.warn) || 30) * DAY))
    .map((b) => ({ ...b, days_left: Math.round((dayStart(b.expiry) - Date.now()) / DAY) }));
  ok(res, { low, expiring, counts: { low: low.length, expiring: expiring.length } });
}));

// ══════════ (10) الدفعات والصلاحيات ══════════
router.get("/batches", guard((req, res) => {
  const rows = batchRows().map((b) => ({
    ...b, days_left: b.expiry ? Math.round((dayStart(b.expiry) - Date.now()) / DAY) : null
  }));
  ok(res, { rows });
}));

// ══════════ (12) تقييم المخزون ══════════
router.get("/valuation", guard((req, res) => {
  const view = itemsView().filter((r) => r.stock !== 0);
  const cost = r2(view.reduce((a, r) => a + r.value_cost, 0));
  const sale = r2(view.reduce((a, r) => a + r.value_sale, 0));
  ok(res, {
    rows: view.map((r) => ({
      id: r.id, name: r.name, unit: r.unit, stock: r.stock,
      cost: r.cost, price: r.price, value_cost: r.value_cost, value_sale: r.value_sale,
      margin: r2(r.value_sale - r.value_cost)
    })),
    totals: { cost, sale, margin: r2(sale - cost),
              // 🔴 بلا تكلفة مسجّلة ما في تقييم صادق — منقول كم صنف ناقص
              missing_cost: view.filter((r) => !r.cost).length }
  });
}));

// ══════════ (4) جلسات الجرد ══════════
router.get("/counts", guard((req, res) => {
  ok(res, { rows: db.prepare("SELECT * FROM stock_counts ORDER BY id DESC LIMIT 100").all() });
}));

router.post("/counts", guard((req, res) => {
  const name = String(req.body?.name || "").slice(0, 120) || `جرد ${dayStr(Date.now())}`;
  const now = Date.now();
  const id = db.transaction(() => {
    const c = db.prepare("INSERT INTO stock_counts (name,status,note,started_at) VALUES (?,'مفتوح',?,?)")
      .run(name, String(req.body?.note || "").slice(0, 300), now);
    const cid = Number(c.lastInsertRowid);
    // منثبّت "المتوقّع" لحظة فتح الجلسة — حتى الفرق يكون منصف
    const oh = onHandMap();
    const ins = db.prepare("INSERT INTO stock_count_lines (count_id,item_id,expected,counted) VALUES (?,?,?,NULL)");
    for (const it of db.prepare("SELECT id FROM stock_items WHERE active=1").all())
      ins.run(cid, it.id, oh.get(it.id) || 0);
    return cid;
  })();
  ok(res, { id });
}));

function countView(id) {
  const c = db.prepare("SELECT * FROM stock_counts WHERE id=?").get(id);
  if (!c) return null;
  const rows = db.prepare(
    `SELECT l.*, i.name, i.unit, i.cost FROM stock_count_lines l
     JOIN stock_items i ON i.id=l.item_id WHERE l.count_id=? ORDER BY i.name`).all(id)
    .map((l) => ({
      ...l,
      variance: l.counted == null ? null : r3(Number(l.counted) - Number(l.expected)),
      value: l.counted == null ? null : r2((Number(l.counted) - Number(l.expected)) * Number(l.cost || 0))
    }));
  const done = rows.filter((r) => r.counted != null);
  return {
    count: c, rows,
    summary: {
      items: rows.length, counted: done.length, pending: rows.length - done.length,
      surplus: done.filter((r) => r.variance > 0).length,
      shortage: done.filter((r) => r.variance < 0).length,
      exact: done.filter((r) => r.variance === 0).length,
      variance_value: r2(done.reduce((a, r) => a + (r.value || 0), 0))
    }
  };
}

router.get("/counts/:id", guard((req, res) => {
  const v = countView(Number(req.params.id));
  if (!v) return bad(res, "جلسة الجرد غير موجودة", 404);
  ok(res, v);
}));

router.post("/counts/:id/line", guard((req, res) => {
  const cid = Number(req.params.id);
  const c = db.prepare("SELECT status FROM stock_counts WHERE id=?").get(cid);
  if (!c) return bad(res, "جلسة الجرد غير موجودة", 404);
  if (c.status !== "مفتوح") return bad(res, "الجلسة مقفلة — ما بتنعدّل");
  const counted = req.body?.counted === "" || req.body?.counted == null ? null : Number(req.body.counted);
  if (counted != null && (!Number.isFinite(counted) || counted < 0)) return bad(res, "العدد لازم رقم غير سالب");
  db.prepare("UPDATE stock_count_lines SET counted=?, note=? WHERE count_id=? AND item_id=?")
    .run(counted, String(req.body?.note || "").slice(0, 200), cid, Number(req.body?.item_id));
  ok(res, {});
}));

// إقفال الجلسة: كل فرق بينكتب كحركة "تسوية جرد" — ما في رصيد بينتغيّر بالسرّ
router.post("/counts/:id/close", guard((req, res) => {
  const cid = Number(req.params.id);
  const v = countView(cid);
  if (!v) return bad(res, "جلسة الجرد غير موجودة", 404);
  if (v.count.status !== "مفتوح") return bad(res, "الجلسة مقفلة أصلاً");
  const pending = v.rows.filter((r) => r.counted == null);
  if (pending.length && !req.body?.force)
    return bad(res, `في ${pending.length} صنف ما انعدّ بعد. كمّلهم أو أقفل بالقوة.`);

  const now = Date.now();
  let adjusted = 0;
  db.transaction(() => {
    for (const r of v.rows) {
      if (r.counted == null || !r.variance) continue;
      addMove({ item_id: r.item_id, qty: r.variance, kind: "تسوية جرد",
                ref_type: "count", ref_id: String(cid) + ":" + r.item_id,
                unit_cost: r.cost || 0, note: `جرد #${cid}${r.note ? " — " + r.note : ""}`, at: now });
      adjusted++;
    }
    db.prepare("UPDATE stock_counts SET status='مقفل', closed_at=? WHERE id=?").run(now, cid);
  })();
  ok(res, { adjusted, variance_value: v.summary.variance_value });
}));

// ══════════ (5) استيراد الجرد من ملف ══════════
router.post("/counts/:id/import", async (req, res) => {
  try {
    const cid = Number(req.params.id);
    const c = db.prepare("SELECT status FROM stock_counts WHERE id=?").get(cid);
    if (!c) return bad(res, "جلسة الجرد غير موجودة", 404);
    if (c.status !== "مفتوح") return bad(res, "الجلسة مقفلة — ما بتستقبل استيراد");

    const b64 = String(req.body?.base64 || "").replace(/^data:.*?;base64,/, "");
    if (!b64) return bad(res, "ما وصل ملف");
    const f = await readAnyFile(Buffer.from(b64, "base64"), req.body?.filename);
    if (!f.ok) return bad(res, f.error);
    if (!f.table.rows.length)
      return bad(res, `قرينا الملف (${f.kind}) بس ما لقينا جدول فيه. لازم ملف إكسل أو CSV فيه عمود للصنف وعمود للعدد.`);

    const cols = matchColumns(f.table.headers);
    if (!cols.name || !cols.qty)
      return bad(res, `ما عرفنا الأعمدة. لقينا: ${f.table.headers.join("، ")}. ` +
                      `لازم عمود للصنف (اسمه مثلاً "الصنف") وعمود للعدد (مثلاً "الكمية").`);

    const items = db.prepare("SELECT id,name,barcode FROM stock_items").all();
    const byName = new Map(items.map((i) => [String(i.name).trim(), i.id]));
    const byCode = new Map(items.filter((i) => i.barcode).map((i) => [String(i.barcode).trim(), i.id]));

    const upd = db.prepare("UPDATE stock_count_lines SET counted=? WHERE count_id=? AND item_id=?");
    const applied = [], unknown = [];
    db.transaction(() => {
      for (const row of f.table.rows) {
        const nm = String(row[cols.name] ?? "").trim();
        const code = cols.barcode ? String(row[cols.barcode] ?? "").trim() : "";
        const q = num(row[cols.qty]);
        if (!nm && !code) continue;
        const id = byCode.get(code) ?? byName.get(nm);
        if (!id) { unknown.push(nm || code); continue; }   // 🔴 ما منضيف صنف من راسنا
        if (q == null) { unknown.push(`${nm} (العدد غير مقروء)`); continue; }
        upd.run(r3(q), cid, id);
        applied.push({ item_id: id, name: nm, counted: r3(q) });
      }
    })();

    ok(res, {
      kind: f.kind, columns: cols, headers: f.table.headers,
      applied: applied.length, unknown: [...new Set(unknown)].slice(0, 50),
      rows_in_file: f.table.rows.length
    });
  } catch (e) { bad(res, e && e.message ? e.message : "تعذّر الاستيراد"); }
});

// ══════════ (6) خصم الأحمال + (7) إرجاع المرفوض ══════════
// كلاهما مربوط بوحدة المحاسبة، وكلاهما لا يتكرّر: كل مستند
// بينخصم مرة وحدة بفضل مفتاح المرجع الفريد.
router.post("/sync/shipments", guard((req, res) => {
  const item_id = Number(req.body?.item_id);
  if (!item_id) return bad(res, "اختر الصنف اللي بتشحنه");
  const from = dayStart(req.body?.from), to = dayStart(req.body?.to);
  let rows = [];
  try {
    const w = [], p = [];
    if (from != null) { w.push("shipped_at >= ?"); p.push(from); }
    if (to != null) { w.push("shipped_at < ?"); p.push(to + DAY); }
    rows = db.prepare("SELECT id, shipped_at, pieces FROM acc_shipments" +
      (w.length ? " WHERE " + w.join(" AND ") : "")).all(...p);
  } catch { return bad(res, "وحدة المحاسبة مش جاهزة بعد — سجّل حمولة أول"); }

  let applied = 0, skipped = 0, units = 0;
  db.transaction(() => {
    for (const s of rows) {
      if (!Number(s.pieces)) continue;
      const r = addMoveIdempotent({
        item_id, qty: -Math.abs(Number(s.pieces)), kind: "بيع",
        ref_type: "shipment", ref_id: String(s.id), at: Number(s.shipped_at),
        note: `حمولة #${s.id} لشركة التوصيل`
      });
      if (r.added) { applied++; units += Number(s.pieces); } else skipped++;
    }
  })();
  ok(res, { applied, skipped, units, scanned: rows.length });
}));

router.post("/sync/returns", guard((req, res) => {
  const item_id = Number(req.body?.item_id);
  if (!item_id) return bad(res, "اختر الصنف");
  let rows = [];
  try {
    // الطرد المرفوض بيرجع بضاعة. الملغي بلا تكلفة كمان بيرجع.
    rows = db.prepare(
      `SELECT r.id, r.tracking, r.pieces, r.state, s.created_at
       FROM acc_rows r JOIN acc_statements s ON s.id=r.statement_id
       WHERE r.state <> 'مُحصّل'`).all();
  } catch { return bad(res, "ما في كشوفات محفوظة بعد"); }

  let applied = 0, skipped = 0, unknown = 0, units = 0;
  db.transaction(() => {
    for (const r of rows) {
      // 🔴 الطرد المرفوض عدده 0 بالكشف (ما تحصّل)، فمنرجع اللي
      //    بيقولوا الحمولة بس ما منخترع عدد. المستخدم بيحدد كم حبة بالطرد.
      const per = Number(req.body?.pieces_per_parcel);
      if (!Number.isFinite(per) || per <= 0) { unknown++; continue; }
      const m = addMoveIdempotent({
        item_id, qty: Math.abs(per), kind: "مرتجع",
        ref_type: "acc_row", ref_id: String(r.id), at: Number(r.created_at),
        note: `مرتجع بوليصة ${r.tracking} (${r.state})`
      });
      if (m.added) { applied++; units += per; } else skipped++;
    }
  })();
  if (unknown && !applied)
    return bad(res, "حدّد كم حبة بالطرد الواحد (pieces_per_parcel) — ما منقدر نستنتجها من كشف ما تحصّل.");
  ok(res, { applied, skipped, units, scanned: rows.length });
}));

// ══════════ (15) التصدير وورقة الجرد ══════════
const csv = (res, name, head, lines) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  res.send("\uFEFF" + [head.map(esc).join(","), ...lines.map((l) => l.map(esc).join(","))].join("\r\n"));
};

router.get("/export.csv", guard((req, res) => {
  const view = itemsView();
  csv(res, "stock.csv",
    ["الصنف", "الوحدة", "الباركود", "الرصيد", "حد الطلب", "التكلفة", "السعر",
     "قيمة بالتكلفة", "قيمة بالبيع", "بيع/يوم", "تغطية بالأيام", "أقرب صلاحية", "الحالة"],
    view.map((r) => [r.name, r.unit, r.barcode, r.stock, r.reorder_point, r.cost, r.price,
      r.value_cost, r.value_sale, r.velocity ?? "—", r.cover ?? "—", r.nearest_expiry || "—", r.status]));
}));

router.get("/moves.csv", guard((req, res) => {
  const rows = db.prepare(
    `SELECT m.*, i.name, i.unit FROM stock_moves m JOIN stock_items i ON i.id=m.item_id
     ORDER BY m.at DESC LIMIT 5000`).all();
  csv(res, "stock-moves.csv",
    ["التاريخ", "الصنف", "الوحدة", "النوع", "الكمية", "الدفعة", "الصلاحية", "المرجع", "ملاحظة"],
    rows.map((m) => [dayStr(m.at), m.name, m.unit, m.kind, m.qty, m.batch, m.expiry,
      m.ref_type ? `${m.ref_type}:${m.ref_id}` : "", m.note]));
}));

// ورقة جرد فارغة للطباعة — خانة العدد فاضية عمداً
router.get("/countsheet.csv", guard((req, res) => {
  const rows = db.prepare("SELECT name, unit, barcode FROM stock_items WHERE active=1 ORDER BY name").all();
  csv(res, "count-sheet.csv", ["الصنف", "الوحدة", "الباركود", "العدد المعدود", "ملاحظة"],
    rows.map((r) => [r.name, r.unit, r.barcode, "", ""]));
}));

router.get("/counts/:id/export.csv", guard((req, res) => {
  const v = countView(Number(req.params.id));
  if (!v) return bad(res, "جلسة الجرد غير موجودة", 404);
  csv(res, `count-${req.params.id}.csv`,
    ["الصنف", "الوحدة", "المتوقّع", "المعدود", "الفرق", "قيمة الفرق", "ملاحظة"],
    v.rows.map((r) => [r.name, r.unit, r.expected, r.counted ?? "", r.variance ?? "", r.value ?? "", r.note]));
}));
