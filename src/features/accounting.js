// ═══════════════════════════════════════════════════════════
// 🧾 وحدة المحاسبة والأحمال — نظام إكسل داخل الموقع
//
// شو بتعمل بالضبط:
//  1) تسجيل الأحمال اللي بتسلّمها لشركة التوصيل (تاريخ/عدد/صفحة)
//  2) قراءة كشوفات الـPDF (COD) واستخراج البوليصات والمبالغ
//  3) تحويل المبلغ لعدد قطع حسب جدول تسعير أنت بتتحكم فيه
//     (15 د = حبة، 27 د = حبتين … وبتقدر تزيد/تعدّل)
//  4) خصم أجرة التوصيل (1.75 افتراضياً) وحساب الصافي
//  5) مطابقة الكشف مع أحمالك ومع طلبات البوت
//  6) دفتر أستاذ بشكل جدول إكسل + تصدير CSV يفتح بإكسل
//
// 🔴 قاعدة ثابتة: ما منخترع ولا رقم. أي مبلغ مش موجود
//    بجدول التسعير → عدد القطع = غير معروف، مش تخمين.
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import express from "express";
import { db } from "../db/database.js";
import { pdfToText, parseCodStatement } from "../bot/pdfText.js";

export const slug = "accounting";
export const title = "المحاسبة والأحمال";
export const icon = "🧾";

// ── الجداول (كلها بادئة acc_) ──
try {
  db.exec(`
  CREATE TABLE IF NOT EXISTS acc_shipments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id     TEXT DEFAULT '',
    page_name   TEXT DEFAULT '',
    courier     TEXT DEFAULT '',
    shipped_at  INTEGER NOT NULL,
    pieces      INTEGER NOT NULL DEFAULT 0,
    packages    INTEGER NOT NULL DEFAULT 0,
    note        TEXT DEFAULT '',
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS acc_statements (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    filename    TEXT DEFAULT '',
    courier     TEXT DEFAULT '',
    period_from TEXT DEFAULT '',
    period_to   TEXT DEFAULT '',
    rows_count  INTEGER NOT NULL DEFAULT 0,
    gross       REAL NOT NULL DEFAULT 0,
    fees        REAL NOT NULL DEFAULT 0,
    net         REAL NOT NULL DEFAULT 0,
    fee_rate    REAL NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS acc_rows (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    statement_id INTEGER NOT NULL,
    tracking     TEXT NOT NULL,
    amount       REAL NOT NULL DEFAULT 0,
    pieces       INTEGER,
    product      TEXT DEFAULT '',
    fee          REAL NOT NULL DEFAULT 0,
    net          REAL NOT NULL DEFAULT 0,
    state        TEXT NOT NULL DEFAULT 'مُحصّل',
    order_id     INTEGER,
    note         TEXT DEFAULT '',
    created_at   INTEGER NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS acc_rows_uq ON acc_rows(statement_id, tracking);
  CREATE INDEX IF NOT EXISTS acc_rows_track ON acc_rows(tracking);

  CREATE TABLE IF NOT EXISTS acc_pricing (
    amount   REAL PRIMARY KEY,
    pieces   INTEGER NOT NULL,
    product  TEXT DEFAULT '',
    page_id  TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS acc_settings (
    k TEXT PRIMARY KEY,
    v TEXT
  );`);
} catch (e) { console.error("acc tables:", e && e.message); }

// ── تسعير مبدئي من كلام صاحب المشروع نفسه (15 = حبة، 27 = حبتين) ──
try {
  const n = db.prepare("SELECT COUNT(*) c FROM acc_pricing").get();
  if (!Number(n?.c)) {
    const ins = db.prepare("INSERT OR IGNORE INTO acc_pricing (amount,pieces,product,page_id) VALUES (?,?,?,'')");
    ins.run(15, 1, "");
    ins.run(27, 2, "");
  }
} catch (e) { console.error("acc seed:", e && e.message); }

// ── إعدادات ──
const DEFAULTS = { fee_rate: "1.75" };
function getSetting(k) {
  try { return db.prepare("SELECT v FROM acc_settings WHERE k=?").get(k)?.v ?? DEFAULTS[k] ?? ""; }
  catch { return DEFAULTS[k] ?? ""; }
}
function setSetting(k, v) {
  db.prepare("INSERT INTO acc_settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v")
    .run(k, String(v));
}
const feeRate = () => Math.max(0, Number(getSetting("fee_rate")) || 0);

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const TZ_MS = 10800 * 1000;
function dayStart(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) - TZ_MS : null;
}
const dayStr = (ts) => new Date(Number(ts) + TZ_MS).toISOString().slice(0, 10);

// ── خريطة المبلغ → عدد القطع (بدون أي تخمين) ──
function pricingMap() {
  const m = new Map();
  try {
    for (const r of db.prepare("SELECT amount,pieces,product FROM acc_pricing").all())
      m.set(r2(r.amount), { pieces: Number(r.pieces), product: r.product || "" });
  } catch { /* جدول فاضي */ }
  return m;
}

/**
 * يحوّل صف كشف خام لصف محاسبي كامل.
 * amount=0 → طرد مرتجع (ما تحصّل شي) ولا أجرة عليه بالحساب.
 */
export function enrichRow(raw, map, rate) {
  const amount = r2(raw.amount);
  const hit = map.get(amount);
  const returned = amount <= 0;
  const fee = returned ? 0 : r2(rate);
  return {
    tracking: String(raw.tracking),
    amount,
    pieces: hit ? hit.pieces : null,          // null = غير معروف، مش صفر ومش تخمين
    product: hit ? hit.product : "",
    fee,
    net: r2(amount - fee),
    state: returned ? "مرتجع" : "مُحصّل"
  };
}

export function summarize(rows) {
  const gross = r2(rows.reduce((a, r) => a + (Number(r.amount) || 0), 0));
  const fees = r2(rows.reduce((a, r) => a + (Number(r.fee) || 0), 0));
  const known = rows.filter((r) => r.pieces != null);
  return {
    count: rows.length,
    delivered: rows.filter((r) => r.state === "مُحصّل").length,
    returned: rows.filter((r) => r.state === "مرتجع").length,
    gross, fees, net: r2(gross - fees),
    pieces: known.reduce((a, r) => a + r.pieces, 0),
    // "بلا تسعير" = طرد مُحصّل ومبلغه مش بجدول التسعير.
    // المرتجع مستثنى — هو محسوب لحاله وما بنعرف شو كان جوّاه أصلاً.
    unknown: rows.filter((r) => r.pieces == null && r.state !== "مرتجع").length
  };
}

export const router = Router();
router.use(express.json({ limit: "20mb" }));   // كشوفات الـPDF بتوصل ميجات

const ok = (res, data) => res.json({ ok: true, ...data });
const bad = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });

// ═══════════════ الإعدادات وجدول التسعير ═══════════════
router.get("/config", (req, res) => {
  ok(res, {
    fee_rate: feeRate(),
    pricing: db.prepare("SELECT amount,pieces,product,page_id FROM acc_pricing ORDER BY amount").all()
  });
});

router.post("/config", (req, res) => {
  const rate = Number(req.body?.fee_rate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return bad(res, "أجرة التوصيل لازم رقم بين 0 و 100");
  setSetting("fee_rate", r2(rate));
  ok(res, { fee_rate: r2(rate) });
});

router.post("/pricing", (req, res) => {
  const amount = Number(req.body?.amount), pieces = Number(req.body?.pieces);
  if (!Number.isFinite(amount) || amount <= 0) return bad(res, "المبلغ لازم أكبر من صفر");
  if (!Number.isInteger(pieces) || pieces <= 0) return bad(res, "عدد القطع لازم رقم صحيح أكبر من صفر");
  db.prepare(`INSERT INTO acc_pricing (amount,pieces,product,page_id) VALUES (?,?,?,?)
              ON CONFLICT(amount) DO UPDATE SET pieces=excluded.pieces, product=excluded.product, page_id=excluded.page_id`)
    .run(r2(amount), pieces, String(req.body?.product || "").slice(0, 120), String(req.body?.page_id || ""));
  ok(res, {});
});

router.delete("/pricing/:amount", (req, res) => {
  db.prepare("DELETE FROM acc_pricing WHERE amount=?").run(r2(req.params.amount));
  ok(res, {});
});

// ═══════════════ الأحمال المُسلَّمة لشركة التوصيل ═══════════════
router.get("/shipments", (req, res) => {
  const from = dayStart(req.query.from), to = dayStart(req.query.to);
  const w = [], p = [];
  if (from != null) { w.push("shipped_at >= ?"); p.push(from); }
  if (to != null) { w.push("shipped_at < ?"); p.push(to + 86400000); }
  const sql = "SELECT * FROM acc_shipments" + (w.length ? " WHERE " + w.join(" AND ") : "") +
              " ORDER BY shipped_at DESC, id DESC LIMIT 500";
  const rows = db.prepare(sql).all(...p);
  ok(res, {
    rows,
    totals: {
      loads: rows.length,
      pieces: rows.reduce((a, r) => a + (Number(r.pieces) || 0), 0),
      packages: rows.reduce((a, r) => a + (Number(r.packages) || 0), 0)
    }
  });
});

router.post("/shipments", (req, res) => {
  const b = req.body || {};
  const at = dayStart(b.shipped_at);
  if (at == null) return bad(res, "التاريخ لازم بصيغة YYYY-MM-DD");
  const packages = Number(b.packages), pieces = Number(b.pieces);
  if (!Number.isInteger(packages) || packages < 0) return bad(res, "عدد الطرود لازم رقم صحيح");
  if (!Number.isInteger(pieces) || pieces < 0) return bad(res, "عدد القطع لازم رقم صحيح");
  const now = Date.now();
  const r = db.prepare(`INSERT INTO acc_shipments
      (page_id,page_name,courier,shipped_at,pieces,packages,note,created_at)
      VALUES (?,?,?,?,?,?,?,?)`)
    .run(String(b.page_id || ""), String(b.page_name || ""), String(b.courier || "").slice(0, 80),
         at, pieces, packages, String(b.note || "").slice(0, 500), now);
  ok(res, { id: Number(r.lastInsertRowid) });
});

router.delete("/shipments/:id", (req, res) => {
  db.prepare("DELETE FROM acc_shipments WHERE id=?").run(Number(req.params.id));
  ok(res, {});
});

// ═══════════════ قراءة كشف PDF (معاينة فقط — بلا حفظ) ═══════════════
router.post("/parse", (req, res) => {
  const b64 = String(req.body?.base64 || "").replace(/^data:.*?;base64,/, "");
  if (!b64) return bad(res, "ما وصل ملف");
  let buf;
  try { buf = Buffer.from(b64, "base64"); } catch { return bad(res, "الملف غير صالح"); }
  if (buf.length > 25 * 1024 * 1024) return bad(res, "الملف أكبر من 25 ميجا");

  const p = pdfToText(buf);
  if (!p.ok) return bad(res, p.error || "تعذّر قراءة الـPDF");

  const { rows: raw, tokens } = parseCodStatement(p.segments);
  if (!raw.length) {
    return bad(res, "ما لقينا ولا رقم بوليصة بالملف. إذا الكشف صورة ممسوحة (Scan) لازم نسخة PDF نصية.");
  }
  const map = pricingMap(), rate = feeRate();
  const rows = raw.map((r) => enrichRow(r, map, rate));
  ok(res, {
    filename: String(req.body?.filename || "").slice(0, 200),
    rows, summary: summarize(rows), fee_rate: rate,
    diagnostics: { streams: p.streams, tokens }
  });
});

// ═══════════════ حفظ كشف بعد المعاينة ═══════════════
router.post("/statements", (req, res) => {
  const b = req.body || {};
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length) return bad(res, "ما في صفوف للحفظ");

  const map = pricingMap(), rate = feeRate();
  const clean = [];
  const seen = new Set();
  for (const r of rows) {
    const tracking = String(r?.tracking || "").trim();
    if (!/^\d{6,20}$/.test(tracking) || seen.has(tracking)) continue;
    seen.add(tracking);
    clean.push(enrichRow({ tracking, amount: r.amount }, map, rate));
  }
  if (!clean.length) return bad(res, "ما في صفوف صالحة (رقم بوليصة أرقام فقط)");

  const s = summarize(clean);
  const now = Date.now();
  const stId = db.transaction(() => {
    const st = db.prepare(`INSERT INTO acc_statements
        (filename,courier,period_from,period_to,rows_count,gross,fees,net,fee_rate,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(String(b.filename || "").slice(0, 200), String(b.courier || "").slice(0, 80),
           String(b.period_from || ""), String(b.period_to || ""),
           s.count, s.gross, s.fees, s.net, rate, now);
    const id = Number(st.lastInsertRowid);
    const ins = db.prepare(`INSERT OR IGNORE INTO acc_rows
        (statement_id,tracking,amount,pieces,product,fee,net,state,order_id,note,created_at)
        VALUES (?,?,?,?,?,?,?,?,NULL,'',?)`);
    for (const c of clean)
      ins.run(id, c.tracking, c.amount, c.pieces, c.product, c.fee, c.net, c.state, now);
    return id;
  })();

  ok(res, { id: stId, summary: s });
});

router.get("/statements", (req, res) => {
  ok(res, { rows: db.prepare("SELECT * FROM acc_statements ORDER BY id DESC LIMIT 200").all() });
});

router.get("/statements/:id", (req, res) => {
  const id = Number(req.params.id);
  const st = db.prepare("SELECT * FROM acc_statements WHERE id=?").get(id);
  if (!st) return bad(res, "الكشف غير موجود", 404);
  const rows = db.prepare("SELECT * FROM acc_rows WHERE statement_id=? ORDER BY id").all(id);
  ok(res, { statement: st, rows, summary: summarize(rows) });
});

router.delete("/statements/:id", (req, res) => {
  const id = Number(req.params.id);
  db.transaction(() => {
    db.prepare("DELETE FROM acc_rows WHERE statement_id=?").run(id);
    db.prepare("DELETE FROM acc_statements WHERE id=?").run(id);
  })();
  ok(res, {});
});

// تعديل صف يدوياً (خانة إكسل) — عدد القطع أو ملاحظة أو الحالة
router.post("/rows/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM acc_rows WHERE id=?").get(id);
  if (!row) return bad(res, "الصف غير موجود", 404);
  const b = req.body || {};
  const pieces = b.pieces === "" || b.pieces == null ? null : Number(b.pieces);
  if (pieces != null && (!Number.isInteger(pieces) || pieces < 0)) return bad(res, "عدد القطع لازم رقم صحيح");
  const amount = b.amount == null ? row.amount : Number(b.amount);
  if (!Number.isFinite(amount) || amount < 0) return bad(res, "المبلغ غير صالح");
  const fee = amount <= 0 ? 0 : r2(b.fee == null ? row.fee : Number(b.fee));
  db.prepare(`UPDATE acc_rows SET pieces=?, amount=?, fee=?, net=?, product=?, note=?, state=? WHERE id=?`)
    .run(pieces, r2(amount), fee, r2(amount - fee),
         String(b.product ?? row.product).slice(0, 120),
         String(b.note ?? row.note).slice(0, 300),
         amount <= 0 ? "مرتجع" : String(b.state ?? row.state), id);
  ok(res, {});
});

// ═══════════════ دفتر الأستاذ (جدول إكسل) ═══════════════
function ledgerRows({ from, to }) {
  const w = [], p = [];
  if (from != null) { w.push("s.created_at >= ?"); p.push(from); }
  if (to != null) { w.push("s.created_at < ?"); p.push(to + 86400000); }
  const sql = `SELECT r.*, s.filename, s.courier, s.created_at AS st_at
               FROM acc_rows r JOIN acc_statements s ON s.id=r.statement_id
               ${w.length ? "WHERE " + w.join(" AND ") : ""}
               ORDER BY r.id DESC LIMIT 5000`;
  return db.prepare(sql).all(...p);
}

router.get("/ledger", (req, res) => {
  const rows = ledgerRows({ from: dayStart(req.query.from), to: dayStart(req.query.to) });
  // تجميع يومي — عمود "اليوم" اللي بيهم صاحب المحل
  const byDay = new Map();
  for (const r of rows) {
    const d = dayStr(r.st_at);
    const g = byDay.get(d) || { day: d, count: 0, gross: 0, fees: 0, net: 0, pieces: 0, returned: 0 };
    g.count++; g.gross += Number(r.amount) || 0; g.fees += Number(r.fee) || 0;
    g.net += Number(r.net) || 0; g.pieces += Number(r.pieces) || 0;
    if (r.state === "مرتجع") g.returned++;
    byDay.set(d, g);
  }
  const days = [...byDay.values()].map((g) => ({
    ...g, gross: r2(g.gross), fees: r2(g.fees), net: r2(g.net)
  })).sort((a, b) => b.day.localeCompare(a.day));
  ok(res, { rows, days, summary: summarize(rows) });
});

router.get("/export.csv", (req, res) => {
  const rows = ledgerRows({ from: dayStart(req.query.from), to: dayStart(req.query.to) });
  const head = ["التاريخ", "رقم البوليصة", "المبلغ المُحصّل", "عدد القطع", "المنتج",
                "أجرة التوصيل", "الصافي", "الحالة", "الكشف", "ملاحظة"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [head.map(esc).join(",")];
  for (const r of rows) {
    lines.push([dayStr(r.st_at), r.tracking, r.amount, r.pieces == null ? "غير معروف" : r.pieces,
                r.product, r.fee, r.net, r.state, r.filename, r.note].map(esc).join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="accounting.csv"');
  res.send("﻿" + lines.join("\r\n"));      // BOM حتى إكسل يقرأ العربي صح
});

// ═══════════════ المطابقة مع أحمالك ومع طلبات البوت ═══════════════
router.get("/reconcile", (req, res) => {
  const from = dayStart(req.query.from), to = dayStart(req.query.to);
  const rows = ledgerRows({ from, to });
  const s = summarize(rows);

  const w = [], p = [];
  if (from != null) { w.push("shipped_at >= ?"); p.push(from); }
  if (to != null) { w.push("shipped_at < ?"); p.push(to + 86400000); }
  const sh = db.prepare("SELECT COALESCE(SUM(packages),0) pk, COALESCE(SUM(pieces),0) pc FROM acc_shipments" +
                        (w.length ? " WHERE " + w.join(" AND ") : "")).get(...p);

  const ow = ["status NOT IN ('ملغي','ناقص')"], op = [];
  if (from != null) { ow.push("created_at >= ?"); op.push(from); }
  if (to != null) { ow.push("created_at < ?"); op.push(to + 86400000); }
  let orders = { c: 0, t: 0 };
  try {
    orders = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(total),0) t FROM orders WHERE " + ow.join(" AND ")).get(...op);
  } catch { /* لا يكسر الصفحة */ }

  ok(res, {
    statement: s,
    shipments: { packages: Number(sh?.pk) || 0, pieces: Number(sh?.pc) || 0 },
    orders: { count: Number(orders?.c) || 0, total: r2(orders?.t) },
    gaps: {
      packages_vs_statement: (Number(sh?.pk) || 0) - s.count,
      orders_vs_statement: (Number(orders?.c) || 0) - s.count,
      money_vs_orders: r2((Number(orders?.t) || 0) - s.gross)
    }
  });
});
