// ═══════════════════════════════════════════════════════════
// 🚚 وحدة شركات التوصيل والبوالص — 10 وظائف
//
//  1) سجل شركات التوصيل (هاتف، سعر افتراضي، تغطية، ملاحظات)
//  2) تسعيرة كل شركة حسب المنطقة + مدة التوصيل المتوقّعة
//  3) سجل البوالص وربطها بطلب البوت
//  4) تتبّع الحالة بسجل زمني: مين غيّر ومتى ومن وين لوين
//  5) لوحة أداء كل شركة (تسليم/رفض/متوسط أيام/تكلفة الطرد)
//  6) مقارنة الشركات على نفس المنطقة (الأرخص والأسرع)
//  7) البوالص المتأخرة اللي عدّى عليها أكثر من X يوم
//  8) المطالبات: ضايع/متضرر بقيمته وحالته ومتى انحلّ
//  9) حاسبة تكلفة التوصيل لمنطقة قبل الشحن
// 10) تصدير CSV + تقرير شهري لكل شركة
//
// 🔴 القاعدة الحاكمة: ما منخترع ولا رقم. أي مؤشر ما إلو
//    بيانات تسنده بيرجع null ومعه سبب واضح («ما في بوالص
//    مغلقة») — مش صفر. وكل سعر بيجي معه «الأساس» اللي انحسب
//    منه حتى تعرف من وين إجا الرقم.
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import express from "express";
import { db } from "../db/database.js";

export const slug = "delivery";
export const title = "شركات التوصيل والبوالص";
export const icon = "🚚";

try {
  db.exec(`
  CREATE TABLE IF NOT EXISTS delivery_couriers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE,
    phone         TEXT DEFAULT '',
    default_price REAL,
    areas         TEXT DEFAULT '',
    note          TEXT DEFAULT '',
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS delivery_rates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    courier_id INTEGER NOT NULL,
    area       TEXT NOT NULL,
    price      REAL NOT NULL,
    eta_days   INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS delivery_rates_uq ON delivery_rates(courier_id, area);

  CREATE TABLE IF NOT EXISTS delivery_waybills (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking     TEXT NOT NULL UNIQUE,
    courier_id   INTEGER NOT NULL,
    area         TEXT NOT NULL,
    status       TEXT NOT NULL,
    order_id     INTEGER,
    cod_amount   REAL,
    fee          REAL,
    fee_basis    TEXT DEFAULT 'غير معروف',
    shipped_at   INTEGER NOT NULL,
    closed_at    INTEGER,
    note         TEXT DEFAULT '',
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS delivery_wb_courier ON delivery_waybills(courier_id, status);

  CREATE TABLE IF NOT EXISTS delivery_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    waybill_id  INTEGER NOT NULL,
    from_status TEXT DEFAULT '',
    to_status   TEXT NOT NULL,
    actor       TEXT DEFAULT '',
    note        TEXT DEFAULT '',
    at          INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS delivery_ev_wb ON delivery_events(waybill_id, at);

  CREATE TABLE IF NOT EXISTS delivery_claims (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    waybill_id  INTEGER NOT NULL,
    kind        TEXT NOT NULL,
    amount      REAL,
    status      TEXT NOT NULL DEFAULT 'مفتوحة',
    note        TEXT DEFAULT '',
    opened_at   INTEGER NOT NULL,
    resolved_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS delivery_cl_wb ON delivery_claims(waybill_id);`);
} catch (e) { console.error("delivery tables:", e && e.message); }

// ── ثوابت ──
// الحالات مرتّبة زي ما بتمشي بالواقع. «المغلقة» هي اللي انتهت
// قصّتها — وهي وحدها اللي منحسب عليها نِسَب الأداء، لأنّ
// البوليصة اللي لسا بالطريق ما بتقول لا نجاح ولا فشل.
export const STATUSES = ["قيد التجهيز", "بالطريق", "تم التسليم", "رفض عند الاستلام", "مرتجع", "ضايع"];
export const CLOSED_STATUSES = ["تم التسليم", "رفض عند الاستلام", "مرتجع", "ضايع"];
export const CLAIM_KINDS = ["طرد ضايع", "طرد متضرر", "مبلغ ناقص"];
export const CLAIM_STATUSES = ["مفتوحة", "مقبولة", "مرفوضة", "معوّضة"];

const DAY = 86400000;
const TZ_MS = 10800 * 1000;   // الأردن UTC+3

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const dayStr = (ts) => (ts == null ? null : new Date(Number(ts) + TZ_MS).toISOString().slice(0, 10));
function dayStart(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) - TZ_MS : null;
}
const txt = (v, n) => String(v ?? "").trim().slice(0, n);

/** رقم اختياري: الفاضي بيرجع null (مش صفر)، والغلط بيرجع undefined حتى يتميّز عن الفاضي */
function optNum(v, { min = 0, max = 1e9 } = {}) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return r2(n);
}

// ═══════════════════════════════════════════════════════════
// 🏢 (1) الشركات
// ═══════════════════════════════════════════════════════════
export function saveCourier(input = {}) {
  const name = txt(input.name, 80);
  if (!name) throw new Error("اسم الشركة مطلوب");
  const price = optNum(input.default_price, { max: 1000 });
  if (price === undefined) throw new Error("السعر الافتراضي لازم رقم بين 0 و 1000");
  const now = Date.now();
  const id = Number(input.id) || 0;
  if (id) {
    const cur = db.prepare("SELECT id FROM delivery_couriers WHERE id=?").get(id);
    if (!cur) throw new Error("الشركة غير موجودة");
    db.prepare(`UPDATE delivery_couriers SET name=?, phone=?, default_price=?, areas=?, note=? WHERE id=?`)
      .run(name, txt(input.phone, 30), price, txt(input.areas, 500), txt(input.note, 500), id);
    return id;
  }
  if (db.prepare("SELECT id FROM delivery_couriers WHERE name=?").get(name))
    throw new Error("في شركة بنفس الاسم");
  const r = db.prepare(`INSERT INTO delivery_couriers (name,phone,default_price,areas,note,active,created_at)
                        VALUES (?,?,?,?,?,1,?)`)
    .run(name, txt(input.phone, 30), price, txt(input.areas, 500), txt(input.note, 500), now);
  return Number(r.lastInsertRowid);
}

/** الشركة اللي إلها بوالص ما بتنمسح — بتنوقف، حتى ما يضيع تاريخها */
export function removeCourier(id) {
  const n = Number(db.prepare("SELECT COUNT(*) c FROM delivery_waybills WHERE courier_id=?").get(id)?.c) || 0;
  if (n > 0) {
    db.prepare("UPDATE delivery_couriers SET active=0 WHERE id=?").run(id);
    return { archived: true, waybills: n };
  }
  db.prepare("DELETE FROM delivery_rates WHERE courier_id=?").run(id);
  db.prepare("DELETE FROM delivery_couriers WHERE id=?").run(id);
  return { archived: false, waybills: 0 };
}

// ═══════════════════════════════════════════════════════════
// 💵 (2) التسعيرة حسب المنطقة
// ═══════════════════════════════════════════════════════════
export function saveRate(input = {}) {
  const courier_id = Number(input.courier_id);
  if (!db.prepare("SELECT id FROM delivery_couriers WHERE id=?").get(courier_id))
    throw new Error("الشركة غير موجودة");
  const area = txt(input.area, 60);
  if (!area) throw new Error("المنطقة مطلوبة");
  const price = optNum(input.price, { max: 1000 });
  if (price === undefined || price == null) throw new Error("سعر التوصيل لازم رقم بين 0 و 1000");
  const eta = input.eta_days === "" || input.eta_days == null ? null : Number(input.eta_days);
  if (eta != null && (!Number.isInteger(eta) || eta < 0 || eta > 60))
    throw new Error("مدة التوصيل لازم رقم صحيح من 0 إلى 60 يوم");
  db.prepare(`INSERT INTO delivery_rates (courier_id,area,price,eta_days,created_at) VALUES (?,?,?,?,?)
              ON CONFLICT(courier_id,area) DO UPDATE SET price=excluded.price, eta_days=excluded.eta_days`)
    .run(courier_id, area, price, eta, Date.now());
  return true;
}

/**
 * سعر شركة لمنطقة، ومعه أساسه.
 * الترتيب: تسعيرة المنطقة ← السعر الافتراضي ← ما منعرف (null).
 * ما منرجع صفر أبداً لمّا ما يكون في سعر مسجّل.
 */
export function priceFor(courier_id, area) {
  const rate = db.prepare("SELECT price, eta_days FROM delivery_rates WHERE courier_id=? AND area=?")
    .get(Number(courier_id), txt(area, 60));
  if (rate) return { price: r2(rate.price), eta_days: rate.eta_days ?? null, basis: "تسعيرة المنطقة" };
  const c = db.prepare("SELECT default_price FROM delivery_couriers WHERE id=?").get(Number(courier_id));
  if (c && c.default_price != null)
    return { price: r2(c.default_price), eta_days: null, basis: "السعر الافتراضي للشركة" };
  return { price: null, eta_days: null, basis: "غير معروف" };
}

// ═══════════════════════════════════════════════════════════
// 📄 (3) البوالص
// ═══════════════════════════════════════════════════════════
export function createWaybill(input = {}) {
  const tracking = txt(input.tracking, 40);
  if (!/^[A-Za-z0-9\-_/]{3,40}$/.test(tracking))
    throw new Error("رقم البوليصة لازم 3 خانات فأكثر (أرقام وحروف إنجليزية و - _ / فقط)");
  if (db.prepare("SELECT id FROM delivery_waybills WHERE tracking=?").get(tracking))
    throw new Error("رقم البوليصة مسجّل من قبل");

  const courier_id = Number(input.courier_id);
  if (!db.prepare("SELECT id FROM delivery_couriers WHERE id=?").get(courier_id))
    throw new Error("الشركة غير موجودة");

  const area = txt(input.area, 60);
  if (!area) throw new Error("المنطقة مطلوبة");

  const status = input.status ? txt(input.status, 30) : "قيد التجهيز";
  if (!STATUSES.includes(status)) throw new Error("حالة غير معروفة: " + status);

  const shipped_at = input.shipped_at ? dayStart(input.shipped_at) : dayStart(dayStr(Date.now()));
  if (shipped_at == null) throw new Error("تاريخ الشحن لازم بصيغة YYYY-MM-DD");

  // الطلب المرتبط: إذا انذكر لازم يكون موجود فعلاً، ما منربط برقم من الهوا
  let order_id = null;
  if (input.order_id !== "" && input.order_id != null) {
    order_id = Number(input.order_id);
    if (!Number.isInteger(order_id) || order_id <= 0) throw new Error("رقم الطلب لازم رقم صحيح");
    let exists = null;
    try { exists = db.prepare("SELECT id FROM orders WHERE id=?").get(order_id); }
    catch { exists = null; }
    if (!exists) throw new Error("الطلب #" + order_id + " مش موجود بجدول الطلبات");
  }

  const cod = optNum(input.cod_amount, { max: 100000 });
  if (cod === undefined) throw new Error("مبلغ التحصيل لازم رقم موجب");

  // الأجرة: يا يدوية، يا من تسعيرة الشركة — وإلا بتضل غير معروفة.
  let fee = optNum(input.fee, { max: 1000 }), fee_basis = "يدوي";
  if (fee === undefined) throw new Error("أجرة التوصيل لازم رقم موجب");
  if (fee == null) { const p = priceFor(courier_id, area); fee = p.price; fee_basis = p.basis; }

  const now = Date.now();
  const closed = CLOSED_STATUSES.includes(status) ? now : null;
  const id = db.transaction(() => {
    const r = db.prepare(`INSERT INTO delivery_waybills
      (tracking,courier_id,area,status,order_id,cod_amount,fee,fee_basis,shipped_at,closed_at,note,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(tracking, courier_id, area, status, order_id, cod, fee, fee_basis,
           shipped_at, closed, txt(input.note, 400), now);
    const wid = Number(r.lastInsertRowid);
    // أول حدث بينتخم بتاريخ الشحن مش بلحظة الإدخال، لأنّ البوالص
    // القديمة بتنسجّل بأثر رجعي — وإلا بيطلع السجل مقلوب.
    db.prepare(`INSERT INTO delivery_events (waybill_id,from_status,to_status,actor,note,at)
                VALUES (?,'',?,?,'تسجيل البوليصة',?)`)
      .run(wid, status, txt(input.actor, 60) || "النظام", shipped_at);
    return wid;
  })();
  return id;
}

// ═══════════════════════════════════════════════════════════
// 🔁 (4) تغيير الحالة + السجل الزمني
// ═══════════════════════════════════════════════════════════
export function setStatus(id, to, actor = "", note = "", at = Date.now()) {
  const wb = db.prepare("SELECT * FROM delivery_waybills WHERE id=?").get(Number(id));
  if (!wb) throw new Error("البوليصة غير موجودة");
  const next = txt(to, 30);
  if (!STATUSES.includes(next)) throw new Error("حالة غير معروفة: " + next);
  if (wb.status === next) throw new Error("البوليصة أصلاً بحالة «" + next + "»");

  // closed_at بينكتب أول مرة بتوصل فيها البوليصة لحالة نهائية،
  // وبينمسح إذا رجعت لحالة سير — حتى متوسط أيام التوصيل يضل صادق.
  const closed = CLOSED_STATUSES.includes(next) ? Number(at) : null;
  db.transaction(() => {
    db.prepare("UPDATE delivery_waybills SET status=?, closed_at=? WHERE id=?").run(next, closed, wb.id);
    db.prepare(`INSERT INTO delivery_events (waybill_id,from_status,to_status,actor,note,at) VALUES (?,?,?,?,?,?)`)
      .run(wb.id, wb.status, next, txt(actor, 60) || "غير معروف", txt(note, 300), Number(at));
  })();
  return { id: wb.id, from: wb.status, to: next };
}

export const waybillEvents = (id) =>
  db.prepare("SELECT * FROM delivery_events WHERE waybill_id=? ORDER BY at, id").all(Number(id));

// ═══════════════════════════════════════════════════════════
// 📊 (5) أداء الشركة
//
// كل مؤشر إمّا رقم مسنود ببيانات، أو null مع سبب. مثال:
// شركة إلها 3 بوالص كلها لسا بالطريق ⇒ نسبة التسليم null
// («ما في بوالص مغلقة»)، مش 0%.
// ═══════════════════════════════════════════════════════════
export function courierStats(courier_id, { from = null, to = null } = {}) {
  const w = ["courier_id = ?"], p = [Number(courier_id)];
  if (from != null) { w.push("shipped_at >= ?"); p.push(from); }
  if (to != null) { w.push("shipped_at < ?"); p.push(to + DAY); }
  const rows = db.prepare("SELECT * FROM delivery_waybills WHERE " + w.join(" AND ")).all(...p);

  const closed = rows.filter((r) => CLOSED_STATUSES.includes(r.status));
  const delivered = closed.filter((r) => r.status === "تم التسليم");
  const refused = closed.filter((r) => r.status === "رفض عند الاستلام");
  const lost = closed.filter((r) => r.status === "ضايع");
  const returned = closed.filter((r) => r.status === "مرتجع");

  // متوسط الأيام: من البوالص المسلَّمة اللي معروف وقت إغلاقها فقط
  const spans = delivered
    .filter((r) => r.closed_at != null && r.closed_at >= r.shipped_at)
    .map((r) => (r.closed_at - r.shipped_at) / DAY);
  const withFee = rows.filter((r) => r.fee != null);
  const feeSum = withFee.reduce((a, r) => a + Number(r.fee), 0);
  const codSum = delivered.filter((r) => r.cod_amount != null)
    .reduce((a, r) => a + Number(r.cod_amount), 0);

  const pct = (n) => (closed.length ? r2((n / closed.length) * 100) : null);
  return {
    courier_id: Number(courier_id),
    waybills: rows.length,
    open: rows.length - closed.length,
    closed: closed.length,
    delivered: delivered.length,
    refused: refused.length,
    returned: returned.length,
    lost: lost.length,
    delivery_rate: pct(delivered.length),
    refusal_rate: pct(refused.length),
    lost_rate: pct(lost.length),
    avg_days: spans.length ? r2(spans.reduce((a, b) => a + b, 0) / spans.length) : null,
    avg_days_sample: spans.length,
    cost_per_parcel: withFee.length ? r2(feeSum / withFee.length) : null,
    fee_total: withFee.length ? r2(feeSum) : null,
    fee_known: withFee.length,
    fee_unknown: rows.length - withFee.length,
    collected: delivered.length ? r2(codSum) : null,
    // السبب بيظهر بالواجهة بدل الشرطة الصمّاء، حتى يعرف صاحب المحل ليش فاضي
    basis: closed.length ? `محسوب من ${closed.length} بوليصة مغلقة`
                         : (rows.length ? "ما في بوالص مغلقة بعد" : "ما في بوالص لهاي الشركة")
  };
}

export function allCourierStats(range = {}) {
  return db.prepare("SELECT * FROM delivery_couriers ORDER BY active DESC, name").all()
    .map((c) => ({ id: c.id, name: c.name, phone: c.phone, active: c.active,
                   default_price: c.default_price, ...courierStats(c.id, range) }));
}

// ═══════════════════════════════════════════════════════════
// ⚖️ (6) مقارنة الشركات على نفس المنطقة
// ═══════════════════════════════════════════════════════════
export function compareArea(area) {
  const a = txt(area, 60);
  if (!a) throw new Error("المنطقة مطلوبة");
  const couriers = db.prepare("SELECT * FROM delivery_couriers WHERE active=1 ORDER BY name").all();

  const rows = couriers.map((c) => {
    const pr = priceFor(c.id, a);
    const wbs = db.prepare("SELECT * FROM delivery_waybills WHERE courier_id=? AND area=?").all(c.id, a);
    const closed = wbs.filter((r) => CLOSED_STATUSES.includes(r.status));
    const delivered = closed.filter((r) => r.status === "تم التسليم");
    const spans = delivered.filter((r) => r.closed_at != null && r.closed_at >= r.shipped_at)
      .map((r) => (r.closed_at - r.shipped_at) / DAY);
    return {
      courier_id: c.id, name: c.name,
      price: pr.price, price_basis: pr.basis,
      eta_days: pr.eta_days,
      waybills: wbs.length, closed: closed.length, delivered: delivered.length,
      delivery_rate: closed.length ? r2((delivered.length / closed.length) * 100) : null,
      // الأيام الفعلية بتغلب المدة المعلنة لأنها من أرض الواقع
      actual_days: spans.length ? r2(spans.reduce((x, y) => x + y, 0) / spans.length) : null,
      actual_days_sample: spans.length
    };
  });

  const min = (list, key) => {
    const v = list.filter((r) => r[key] != null);
    return v.length ? v.reduce((b, r) => (r[key] < b[key] ? r : b)) : null;
  };
  const cheapest = min(rows, "price");
  const fastest = min(rows.filter((r) => r.actual_days != null), "actual_days")
               || min(rows.filter((r) => r.eta_days != null), "eta_days");
  return {
    area: a, rows,
    cheapest: cheapest ? { courier_id: cheapest.courier_id, name: cheapest.name, price: cheapest.price } : null,
    fastest: fastest
      ? { courier_id: fastest.courier_id, name: fastest.name,
          days: fastest.actual_days ?? fastest.eta_days,
          basis: fastest.actual_days != null ? `أيام فعلية من ${fastest.actual_days_sample} توصيلة` : "مدة معلنة من الشركة" }
      : null,
    note: cheapest ? null : "ما في ولا شركة إلها سعر مسجّل لهاي المنطقة"
  };
}

// ═══════════════════════════════════════════════════════════
// ⏰ (7) البوالص المتأخرة
// ═══════════════════════════════════════════════════════════
export function lateWaybills(days = 5, now = Date.now()) {
  const d = Number(days);
  if (!Number.isFinite(d) || d < 0) throw new Error("عدد الأيام لازم رقم موجب");
  const cutoff = now - d * DAY;
  const rows = db.prepare(
    `SELECT w.*, c.name courier_name FROM delivery_waybills w
     JOIN delivery_couriers c ON c.id = w.courier_id
     WHERE w.closed_at IS NULL AND w.shipped_at <= ? ORDER BY w.shipped_at`).all(cutoff);
  return rows.map((r) => ({ ...r, age_days: Math.floor((now - r.shipped_at) / DAY) }));
}

// ═══════════════════════════════════════════════════════════
// 🧾 (8) المطالبات
// ═══════════════════════════════════════════════════════════
export function openClaim(input = {}) {
  const wb = db.prepare("SELECT id FROM delivery_waybills WHERE id=?").get(Number(input.waybill_id));
  if (!wb) throw new Error("البوليصة غير موجودة");
  const kind = txt(input.kind, 30);
  if (!CLAIM_KINDS.includes(kind)) throw new Error("نوع المطالبة لازم يكون: " + CLAIM_KINDS.join(" / "));
  const amount = optNum(input.amount, { max: 100000 });
  if (amount === undefined) throw new Error("قيمة المطالبة لازم رقم موجب");
  if (db.prepare("SELECT id FROM delivery_claims WHERE waybill_id=? AND status='مفتوحة'").get(wb.id))
    throw new Error("في مطالبة مفتوحة على نفس البوليصة");
  const r = db.prepare(`INSERT INTO delivery_claims (waybill_id,kind,amount,status,note,opened_at,resolved_at)
                        VALUES (?,?,?,'مفتوحة',?,?,NULL)`)
    .run(wb.id, kind, amount, txt(input.note, 400), Date.now());
  return Number(r.lastInsertRowid);
}

export function resolveClaim(id, status, note = "", at = Date.now()) {
  const cl = db.prepare("SELECT * FROM delivery_claims WHERE id=?").get(Number(id));
  if (!cl) throw new Error("المطالبة غير موجودة");
  const st = txt(status, 20);
  if (!CLAIM_STATUSES.includes(st)) throw new Error("حالة مطالبة غير معروفة: " + st);
  if (st === "مفتوحة") throw new Error("لإعادة الفتح استخدم مطالبة جديدة");
  if (cl.status !== "مفتوحة") throw new Error("المطالبة محلولة من قبل");
  db.prepare("UPDATE delivery_claims SET status=?, note=?, resolved_at=? WHERE id=?")
    .run(st, txt(note, 400) || cl.note, Number(at), cl.id);
  return true;
}

export function claimRows() {
  const rows = db.prepare(
    `SELECT cl.*, w.tracking, w.area, c.name courier_name
     FROM delivery_claims cl
     JOIN delivery_waybills w ON w.id = cl.waybill_id
     JOIN delivery_couriers c ON c.id = w.courier_id
     ORDER BY cl.opened_at DESC`).all();
  const withAmount = rows.filter((r) => r.amount != null);
  const compensated = rows.filter((r) => r.status === "معوّضة" && r.amount != null);
  const solved = rows.filter((r) => r.resolved_at != null);
  return {
    rows: rows.map((r) => ({
      ...r,
      // أيام الحل بتنحسب للمحلولة بس؛ المفتوحة إلها "عمر" مش "مدة حل"
      days_to_resolve: r.resolved_at != null ? Math.floor((r.resolved_at - r.opened_at) / DAY) : null,
      age_days: r.resolved_at == null ? Math.floor((Date.now() - r.opened_at) / DAY) : null
    })),
    totals: {
      count: rows.length,
      open: rows.filter((r) => r.status === "مفتوحة").length,
      amount_at_risk: withAmount.length
        ? r2(withAmount.filter((r) => r.status === "مفتوحة").reduce((a, r) => a + r.amount, 0)) : null,
      compensated: compensated.length ? r2(compensated.reduce((a, r) => a + r.amount, 0)) : null,
      amount_unknown: rows.length - withAmount.length,
      avg_days_to_resolve: solved.length
        ? r2(solved.reduce((a, r) => a + (r.resolved_at - r.opened_at) / DAY, 0) / solved.length) : null
    }
  };
}

// ═══════════════════════════════════════════════════════════
// 🧮 (9) حاسبة تكلفة الشحن قبل ما تشحن
// ═══════════════════════════════════════════════════════════
export function quote(area, parcels = 1) {
  const n = Number(parcels);
  if (!Number.isInteger(n) || n <= 0) throw new Error("عدد الطرود لازم رقم صحيح أكبر من صفر");
  const cmp = compareArea(area);
  const options = cmp.rows.map((r) => ({
    courier_id: r.courier_id, name: r.name,
    unit_price: r.price, price_basis: r.price_basis,
    total: r.price == null ? null : r2(r.price * n),   // بلا سعر ⇒ بلا مجموع مخترع
    delivery_rate: r.delivery_rate,
    expected_days: r.actual_days ?? r.eta_days ?? null,
    days_basis: r.actual_days != null ? "أيام فعلية" : (r.eta_days != null ? "مدة معلنة" : "غير معروف")
  })).sort((a, b) => (a.total == null) - (b.total == null) || a.total - b.total);
  const priced = options.filter((o) => o.total != null);
  return {
    area: cmp.area, parcels: n, options,
    best: priced.length ? priced[0] : null,
    // الوفر ما بينحسب إلا لو في خيارين مسعّرين نقارن بينهم
    saving: priced.length > 1 ? r2(priced[priced.length - 1].total - priced[0].total) : null,
    note: priced.length ? null : "ما في سعر مسجّل لهاي المنطقة عند ولا شركة"
  };
}

// ═══════════════════════════════════════════════════════════
// 📅 (10) التقرير الشهري + التصدير
// ═══════════════════════════════════════════════════════════
export function monthlyReport(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || "").trim());
  if (!m) throw new Error("الشهر لازم بصيغة YYYY-MM");
  const y = +m[1], mo = +m[2];
  if (mo < 1 || mo > 12) throw new Error("الشهر لازم بين 01 و 12");
  const from = Date.UTC(y, mo - 1, 1) - TZ_MS;
  const to = Date.UTC(mo === 12 ? y + 1 : y, mo === 12 ? 0 : mo, 1) - TZ_MS;
  const couriers = allCourierStats({ from, to: to - DAY })
    .filter((c) => c.waybills > 0);
  const feeRows = couriers.filter((c) => c.fee_total != null);
  return {
    month: `${m[1]}-${m[2]}`,
    couriers,
    totals: {
      waybills: couriers.reduce((a, c) => a + c.waybills, 0),
      delivered: couriers.reduce((a, c) => a + c.delivered, 0),
      fees: feeRows.length ? r2(feeRows.reduce((a, c) => a + c.fee_total, 0)) : null,
      fee_unknown: couriers.reduce((a, c) => a + c.fee_unknown, 0)
    },
    empty: !couriers.length
  };
}

export function waybillRows({ courier_id = null, status = null, area = null, from = null, to = null } = {}) {
  const w = [], p = [];
  if (courier_id) { w.push("w.courier_id = ?"); p.push(Number(courier_id)); }
  if (status) { w.push("w.status = ?"); p.push(String(status)); }
  if (area) { w.push("w.area = ?"); p.push(String(area)); }
  if (from != null) { w.push("w.shipped_at >= ?"); p.push(from); }
  if (to != null) { w.push("w.shipped_at < ?"); p.push(to + DAY); }
  return db.prepare(
    `SELECT w.*, c.name courier_name FROM delivery_waybills w
     JOIN delivery_couriers c ON c.id = w.courier_id
     ${w.length ? "WHERE " + w.join(" AND ") : ""}
     ORDER BY w.shipped_at DESC, w.id DESC LIMIT 5000`).all(...p);
}

// ═══════════════════════════════════════════════════════════
// 🌐 الراوتر
// ═══════════════════════════════════════════════════════════
export const router = Router();
router.use(express.json({ limit: "5mb" }));

const ok = (res, data) => res.json({ ok: true, ...data });
const bad = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });
/** كل نقطة بتلف بهاي، فرسالة الخطأ العربية بتوصل للواجهة بدل 500 صامتة */
const guard = (fn) => (req, res) => {
  try { fn(req, res); }
  catch (e) { bad(res, (e && e.message) || "صار خطأ غير متوقّع"); }
};

router.get("/meta", guard((req, res) => ok(res, {
  statuses: STATUSES, closed_statuses: CLOSED_STATUSES,
  claim_kinds: CLAIM_KINDS, claim_statuses: CLAIM_STATUSES,
  areas: db.prepare(`SELECT area, COUNT(*) n FROM delivery_waybills GROUP BY area
                     UNION SELECT area, 0 FROM delivery_rates ORDER BY area`).all()
           .map((r) => r.area).filter((a, i, s) => s.indexOf(a) === i)
})));

// ── الشركات ──
router.get("/couriers", guard((req, res) => ok(res, { rows: allCourierStats() })));
router.post("/couriers", guard((req, res) => ok(res, { id: saveCourier(req.body) })));
router.delete("/couriers/:id", guard((req, res) => ok(res, removeCourier(Number(req.params.id)))));
router.post("/couriers/:id/toggle", guard((req, res) => {
  const c = db.prepare("SELECT active FROM delivery_couriers WHERE id=?").get(Number(req.params.id));
  if (!c) return bad(res, "الشركة غير موجودة", 404);
  db.prepare("UPDATE delivery_couriers SET active=? WHERE id=?").run(c.active ? 0 : 1, Number(req.params.id));
  ok(res, { active: c.active ? 0 : 1 });
}));

// ── التسعيرة ──
router.get("/rates", guard((req, res) => ok(res, {
  rows: db.prepare(`SELECT r.*, c.name courier_name FROM delivery_rates r
                    JOIN delivery_couriers c ON c.id = r.courier_id
                    ORDER BY r.area, r.price`).all()
})));
router.post("/rates", guard((req, res) => { saveRate(req.body); ok(res, {}); }));
router.delete("/rates/:id", guard((req, res) => {
  db.prepare("DELETE FROM delivery_rates WHERE id=?").run(Number(req.params.id));
  ok(res, {});
}));

// ── البوالص ──
router.get("/waybills", guard((req, res) => {
  const rows = waybillRows({
    courier_id: req.query.courier_id, status: req.query.status, area: req.query.area,
    from: dayStart(req.query.from), to: dayStart(req.query.to)
  });
  const closed = rows.filter((r) => CLOSED_STATUSES.includes(r.status));
  ok(res, {
    rows,
    totals: {
      count: rows.length,
      open: rows.length - closed.length,
      delivered: closed.filter((r) => r.status === "تم التسليم").length,
      delivery_rate: closed.length
        ? r2((closed.filter((r) => r.status === "تم التسليم").length / closed.length) * 100) : null
    }
  });
}));
router.post("/waybills", guard((req, res) => ok(res, { id: createWaybill(req.body) })));
router.post("/waybills/:id/status", guard((req, res) =>
  ok(res, setStatus(Number(req.params.id), req.body?.status, req.body?.actor, req.body?.note))));
router.get("/waybills/:id", guard((req, res) => {
  const wb = db.prepare(`SELECT w.*, c.name courier_name FROM delivery_waybills w
                         JOIN delivery_couriers c ON c.id=w.courier_id WHERE w.id=?`).get(Number(req.params.id));
  if (!wb) return bad(res, "البوليصة غير موجودة", 404);
  ok(res, { waybill: wb, events: waybillEvents(wb.id) });
}));
router.delete("/waybills/:id", guard((req, res) => {
  const id = Number(req.params.id);
  if (db.prepare("SELECT id FROM delivery_claims WHERE waybill_id=?").get(id))
    return bad(res, "ما بتنمسح: عليها مطالبة مسجّلة");
  db.transaction(() => {
    db.prepare("DELETE FROM delivery_events WHERE waybill_id=?").run(id);
    db.prepare("DELETE FROM delivery_waybills WHERE id=?").run(id);
  })();
  ok(res, {});
}));

// ── الأداء والمقارنة والتأخير ──
router.get("/performance", guard((req, res) => ok(res, {
  rows: allCourierStats({ from: dayStart(req.query.from), to: dayStart(req.query.to) })
})));
router.get("/compare", guard((req, res) => ok(res, compareArea(req.query.area))));
router.get("/late", guard((req, res) => {
  const rows = lateWaybills(req.query.days ?? 5);
  ok(res, { rows, days: Number(req.query.days ?? 5), count: rows.length });
}));
router.get("/quote", guard((req, res) => ok(res, quote(req.query.area, req.query.parcels ?? 1))));

// ── المطالبات ──
router.get("/claims", guard((req, res) => ok(res, claimRows())));
router.post("/claims", guard((req, res) => ok(res, { id: openClaim(req.body) })));
router.post("/claims/:id/resolve", guard((req, res) => {
  resolveClaim(Number(req.params.id), req.body?.status, req.body?.note);
  ok(res, {});
}));

// ── التقرير والتصدير ──
router.get("/report", guard((req, res) => ok(res, monthlyReport(req.query.month))));

router.get("/export.csv", guard((req, res) => {
  const rows = waybillRows({
    courier_id: req.query.courier_id, status: req.query.status, area: req.query.area,
    from: dayStart(req.query.from), to: dayStart(req.query.to)
  });
  const head = ["رقم البوليصة", "الشركة", "المنطقة", "الحالة", "تاريخ الشحن", "تاريخ الإغلاق",
                "أيام الطريق", "مبلغ التحصيل", "أجرة التوصيل", "أساس الأجرة", "الطلب", "ملاحظة"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [head.map(esc).join(",")];
  for (const r of rows) {
    const days = r.closed_at != null ? Math.round((r.closed_at - r.shipped_at) / DAY) : "غير معروف";
    lines.push([r.tracking, r.courier_name, r.area, r.status, dayStr(r.shipped_at),
                dayStr(r.closed_at) || "غير معروف", days,
                r.cod_amount == null ? "غير معروف" : r.cod_amount,
                r.fee == null ? "غير معروف" : r.fee, r.fee_basis,
                r.order_id == null ? "" : r.order_id, r.note].map(esc).join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="delivery-waybills.csv"');
  res.send("﻿" + lines.join("\r\n"));   // BOM حتى إكسل يقرأ العربي صح
}));
