// ═══════════════════════════════════════════════════════════
// 🧾 وحدة المحاسبة والأحمال — نظام إكسل داخل الموقع
//
// شو بتعمل بالضبط:
//  1) تسجيل الأحمال اللي بتسلّمها لشركة التوصيل (تاريخ/عدد/صفحة)
//  2) قراءة كشوفات الـPDF (COD) واستخراج البوليصات والمبالغ
//  3) النظام بيحط عدد الحبّات لحاله: من جدول التسعير، أو من
//     النمط المستنتج منه (15 = حبة و27 = حبتين ⇒ 39 = 3)،
//     أو بتعلّمه من طلبات البوت الحقيقية.
//  4) خصم أجرة التوصيل (1.75 افتراضياً) وحساب الصافي
//  5) مطابقة الكشف مع أحمالك ومع طلبات البوت
//  6) دفتر أستاذ بشكل جدول إكسل + تصدير CSV يفتح بإكسل
//
// 🔴 قاعدة ثابتة: ما منخترع ولا رقم. كل عدد حبّات بيجي معه
//    "الأساس" اللي انبنى عليه، واللي ما إلو أساس بيضل
//    "غير معروف" — مش تخمين.
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import express from "express";
import { db } from "../db/database.js";
import { pdfToText, parseCodStatement, parseCodStatementByClient } from "../bot/pdfText.js";
import { readAnyFile, matchColumns, num } from "../bot/fileRead.js";

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
    basis        TEXT DEFAULT '',
    client       TEXT DEFAULT '',
    page_no      INTEGER DEFAULT 0,
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

// ترقية القواعد القديمة اللي انبنت قبل عمود "الأساس"
for (const col of ["basis TEXT DEFAULT ''", "client TEXT DEFAULT ''", "page_no INTEGER DEFAULT 0"]) {
  try { db.exec("ALTER TABLE acc_rows ADD COLUMN " + col); } catch { /* موجود أصلاً */ }
}

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

// ═══════════════════════════════════════════════════════════
// 🧮 محرّك استنتاج عدد الحبّات — النظام بيحطه لحاله
//
// ثلاث طبقات، وكل صف بيحمل معه "الأساس" اللي انبنى عليه
// حتى تعرف من وين إجا الرقم:
//   1) جدول التسعير (تطابق تام)          → أساس: جدول
//   2) نمط خطّي مستنتج من الجدول نفسه     → أساس: نمط
//      مثال: 15 = حبة و27 = حبتين ⇒ الخطوة 12 ⇒ 39 = 3 حبّات
//   3) الطرد اللي ما تحصّل (مبلغ 0)        → أساس: مرتجع، العدد 0
// وإذا ما انطبق ولا وحدة → null (غير معروف). ما منخترع.
// ═══════════════════════════════════════════════════════════

/** يبني النموذج الخطّي من نقاط جدول التسعير: السعر = base + step×(n−1) */
export function buildModel(map) {
  const pts = [...map.entries()]
    .map(([amount, v]) => ({ amount: Number(amount), pieces: Number(v.pieces) }))
    .filter((p) => p.pieces > 0 && p.amount > 0)
    .sort((a, b) => a.pieces - b.pieces);
  if (pts.length < 2) return null;

  // الخطوة لازم تكون ثابتة بين كل نقطتين متتاليتين، وإلا ما منستنتج
  let step = null;
  for (let i = 1; i < pts.length; i++) {
    const dp = pts[i].pieces - pts[i - 1].pieces;
    if (dp <= 0) return null;
    const s = r2((pts[i].amount - pts[i - 1].amount) / dp);
    if (s <= 0) return null;
    if (step == null) step = s;
    else if (Math.abs(step - s) > 0.005) return null;   // النمط مش خطّي
  }
  const base = r2(pts[0].amount - step * (pts[0].pieces - 1));   // سعر الحبة الأولى
  return { base, step };
}

/**
 * يستنتج عدد الحبّات لمبلغ معيّن.
 * @returns {{pieces:number|null, basis:string, product:string}}
 */
export function derivePieces(amount, map, model) {
  const a = r2(amount);
  if (a <= 0) return { pieces: 0, basis: "مرتجع", product: "" };

  const hit = map.get(a);
  if (hit) return { pieces: Number(hit.pieces), basis: "جدول التسعير", product: hit.product || "" };

  if (model && model.step > 0) {
    const n = (a - model.base) / model.step + 1;
    const rn = Math.round(n);
    if (rn >= 1 && rn <= 200 && Math.abs(n - rn) < 0.005)
      return { pieces: rn, basis: `نمط ${model.base}+${model.step}`, product: "" };
  }
  return { pieces: null, basis: "غير معروف", product: "" };
}

/**
 * يحوّل صف كشف خام لصف محاسبي كامل.
 *
 * قواعد الحالة (حرفياً زي ما بيصير بالواقع):
 *  • مبلغ > 0                → مُحصّل. أجرة التوصيل بتنخصم.
 *  • مبلغ 0 وأجرة 0          → ما وصل ولا كلّفنا شي. العدد 0، الصافي 0.
 *  • مبلغ 0 وأجرة سالبة/أكبر من 0 → الزبون رفض الطلب عند الاستلام،
 *    واحنا دفعنا التوصيل. العدد 0، والصافي بالسالب (خسارة فعلية).
 *
 * @param {*} raw صف من parseCodStatement
 * @param {Map} map جدول التسعير
 * @param {number} rate الأجرة الافتراضية لمّا الكشف ما بيذكرها
 * @param {*} [model] النموذج الخطّي (من buildModel) — اختياري
 */
export function enrichRow(raw, map, rate, model) {
  const amount = r2(raw.amount);
  const mdl = model === undefined ? buildModel(map) : model;
  const d = derivePieces(amount, map, mdl);

  // أجرة التوصيل: من الكشف إذا ذكرها، وإلا الافتراضية للطرد المُحصّل.
  // منخزّنها دايماً كتكلفة موجبة مهما كانت إشارتها بالكشف.
  const stated = raw.fee == null || raw.fee === "" ? null : Number(raw.fee);
  const fee = r2(stated != null && Number.isFinite(stated)
    ? Math.abs(stated)
    : (amount > 0 ? rate : 0));

  let state;
  if (amount > 0) state = "مُحصّل";
  else if (fee > 0) state = "رفض عند الاستلام";
  else state = "ملغي بلا تكلفة";

  return {
    tracking: String(raw.tracking),
    amount,
    pieces: d.pieces,                 // null = غير معروف فقط، وما عداها رقم مبني على أساس
    basis: d.basis,
    product: d.product,
    fee,
    net: r2(amount - fee),            // الرفض بيطلع بالسالب — خسارة لازم تبين
    state
  };
}

export function summarize(rows) {
  const gross = r2(rows.reduce((a, r) => a + (Number(r.amount) || 0), 0));
  const fees = r2(rows.reduce((a, r) => a + (Number(r.fee) || 0), 0));
  const known = rows.filter((r) => r.pieces != null);
  const refused = rows.filter((r) => r.state === "رفض عند الاستلام");
  return {
    count: rows.length,
    delivered: rows.filter((r) => r.state === "مُحصّل").length,
    refused: refused.length,
    cancelled: rows.filter((r) => r.state === "ملغي بلا تكلفة").length,
    returned: rows.filter((r) => r.state !== "مُحصّل").length,
    // 🔴 خسارة صافية: طرود ما تحصّل منها ولا قرش وادفعنا توصيلها
    lost: r2(refused.reduce((a, r) => a + (Number(r.fee) || 0), 0)),
    gross, fees, net: r2(gross - fees),
    pieces: known.reduce((a, r) => a + r.pieces, 0),
    // "بلا تسعير" = طرد مُحصّل ومبلغه ما قدرنا نستنتج منه عدد الحبّات
    unknown: rows.filter((r) => r.pieces == null).length
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
  ok(res, { fee_rate: r2(rate), rederived: rederiveRows() });
});

router.post("/pricing", (req, res) => {
  const amount = Number(req.body?.amount), pieces = Number(req.body?.pieces);
  if (!Number.isFinite(amount) || amount <= 0) return bad(res, "المبلغ لازم أكبر من صفر");
  if (!Number.isInteger(pieces) || pieces <= 0) return bad(res, "عدد القطع لازم رقم صحيح أكبر من صفر");
  db.prepare(`INSERT INTO acc_pricing (amount,pieces,product,page_id) VALUES (?,?,?,?)
              ON CONFLICT(amount) DO UPDATE SET pieces=excluded.pieces, product=excluded.product, page_id=excluded.page_id`)
    .run(r2(amount), pieces, String(req.body?.product || "").slice(0, 120), String(req.body?.page_id || ""));
  ok(res, { rederived: rederiveRows() });
});

router.delete("/pricing/:amount", (req, res) => {
  db.prepare("DELETE FROM acc_pricing WHERE amount=?").run(r2(req.params.amount));
  ok(res, { rederived: rederiveRows() });
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
router.post("/parse", async (req, res) => {
 try {
  const b64 = String(req.body?.base64 || "").replace(/^data:.*?;base64,/, "");
  if (!b64) return bad(res, "ما وصل ملف");
  let buf;
  try { buf = Buffer.from(b64, "base64"); } catch { return bad(res, "الملف غير صالح"); }

  const f = await readAnyFile(buf, req.body?.filename);
  if (!f.ok) return bad(res, f.error);

  const rate0 = feeRate();

  // ── كشف بشكل جدول (إكسل / CSV): منقرأ الأعمدة باسمها ──
  if (f.kind !== "pdf") {
    if (!f.table.rows.length) return bad(res, "الملف ما فيه جدول نقراه");
    const cols = matchColumns(f.table.headers);
    const trackCol = cols.barcode || f.table.headers.find((h) => /بوليصة|تتبع|track|awb|شحنة/i.test(h));
    const amtCol = f.table.headers.find((h) => /تحصيل|المبلغ|cod|amount|قيمة/i.test(h)) || cols.qty;
    if (!trackCol || !amtCol)
      return bad(res, `ما عرفنا الأعمدة. لقينا: ${f.table.headers.join("، ")}. لازم عمود لرقم البوليصة وعمود لمبلغ التحصيل.`);
    const feeCol = f.table.headers.find((h) => /توصيل|أجرة|اجرة|delivery|fee|شحن/i.test(h));

    const map0 = pricingMap(), model0 = buildModel(map0);
    const seen0 = new Set();
    const rows0 = [];
    for (const r of f.table.rows) {
      const tr = String(r[trackCol] ?? "").replace(/\D/g, "");
      if (!tr || seen0.has(tr)) continue;
      seen0.add(tr);
      rows0.push(enrichRow({ tracking: tr, amount: num(r[amtCol]) ?? 0,
                             fee: feeCol ? num(r[feeCol]) : null }, map0, rate0, model0));
    }
    if (!rows0.length) return bad(res, "ما لقينا ولا رقم بوليصة بالجدول");
    return ok(res, {
      filename: String(req.body?.filename || "").slice(0, 200),
      clients: [{ client: "", pages: [1], rows: rows0, summary: summarize(rows0) }],
      rows: rows0, summary: summarize(rows0), fee_rate: rate0, model: model0,
      diagnostics: { pages: 1, arabic: true, named: 0, fee_column: !!feeCol,
                     source: f.kind, columns: { tracking: trackCol, amount: amtCol, fee: feeCol || null },
                     per_page: [{ page: 1, client: "", rows: rows0.length }] }
    });
  }

  const p = { pages: f.pages, arabic: f.arabic };
  const grouped = parseCodStatementByClient(p.pages, { feeRate: rate0 });
  const map = pricingMap(), model = buildModel(map);

  const clients = grouped.clients.map((g) => {
    const rows = g.rows.map((r) => enrichRow(r, map, rate0, model))
      .map((r, i) => ({ ...r, client: g.client, page_no: g.rows[i].page_no || 0 }));
    return { client: g.client, pages: g.pages, rows, summary: summarize(rows) };
  }).filter((g) => g.rows.length);

  const rows = clients.flatMap((g) => g.rows);
  if (!rows.length) {
    return bad(res, "ما لقينا ولا رقم بوليصة بالملف. إذا الكشف صورة ممسوحة (Scan) لازم نسخة PDF نصية.");
  }

  ok(res, {
    filename: String(req.body?.filename || "").slice(0, 200),
    clients,
    rows, summary: summarize(rows), fee_rate: rate0, model,
    diagnostics: {
      pages: p.pages.length,
      arabic: p.arabic,                       // انقرأ العربي ولا لأ — بنقولها بصراحة
      named: clients.filter((c) => c.client && c.client !== "بلا اسم").length,
      fee_column: grouped.clients.some((g) => g.rows.some((r) => r.fee != null)),
      per_page: grouped.pages.map((x) => ({ page: x.page, client: x.client, rows: x.rows.length }))
    }
  });
 } catch (e) { bad(res, e && e.message ? e.message : "تعذّر قراءة الملف"); }
});

// ═══════════════ حفظ كشف بعد المعاينة ═══════════════
router.post("/statements", (req, res) => {
  const b = req.body || {};
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length) return bad(res, "ما في صفوف للحفظ");

  const map = pricingMap(), rate = feeRate(), model = buildModel(map);
  const clean = [];
  const seen = new Set();
  for (const r of rows) {
    const tracking = String(r?.tracking || "").trim();
    if (!/^\d{6,20}$/.test(tracking) || seen.has(tracking)) continue;
    seen.add(tracking);
    clean.push({ ...enrichRow({ tracking, amount: r.amount, fee: r.fee }, map, rate, model),
                 client: String(r.client || "").slice(0, 120), page_no: Number(r.page_no) || 0 });
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
        (statement_id,tracking,amount,pieces,product,fee,net,state,basis,client,page_no,order_id,note,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,'',?)`);
    for (const c of clean)
      ins.run(id, c.tracking, c.amount, c.pieces, c.product, c.fee, c.net, c.state, c.basis,
              c.client, c.page_no, now);
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
  // الأجرة بتضل زي ما هي حتى لو المبلغ صفر — لأنّ الرفض عند الباب
  // بيكلّفنا توصيل فعلي، وتصفيرها بتخفي خسارة حقيقية.
  const fee = r2(Math.abs(b.fee == null ? row.fee : Number(b.fee)));
  const e = enrichRow({ tracking: row.tracking, amount, fee }, pricingMap(), feeRate());
  db.prepare(`UPDATE acc_rows SET pieces=?, amount=?, fee=?, net=?, product=?, note=?, state=?, basis=? WHERE id=?`)
    .run(pieces, r2(amount), fee, r2(amount - fee),
         String(b.product ?? row.product).slice(0, 120),
         String(b.note ?? row.note).slice(0, 300),
         e.state,
         pieces === e.pieces ? e.basis : "تعديل يدوي", id);
  ok(res, {});
});

// ═══════════════════════════════════════════════════════════
// 🎓 تعلّم التسعير من طلبات البوت نفسها
// بدل ما تدخّل الجدول بإيدك: منقرأ طلباتك الحقيقية، ولكل مبلغ
// منشوف كم حبة كان فيه. إذا كل الطلبات بنفس المبلغ متّفقة على
// نفس العدد → منعتمده. إذا اختلفت → منتركه، لأنّ المبلغ الواحد
// إلو أكثر من تفسير وما منقدر نجزم.
// ═══════════════════════════════════════════════════════════
function qtyFromOrderString(s) {
  let n = 0;
  for (const part of String(s || "").split("+")) {
    const m = part.match(/\((\d+(?:\.\d+)?)/);
    if (m) n += Number(m[1]) || 0;
  }
  return n;
}

export function learnPricingFromOrders() {
  let orders = [];
  try {
    orders = db.prepare(
      "SELECT total, order_string FROM orders WHERE status NOT IN ('ملغي','ناقص') AND total > 0"
    ).all();
  } catch { return { learned: [], conflicts: [], scanned: 0 }; }

  const by = new Map();
  for (const o of orders) {
    const q = qtyFromOrderString(o.order_string);
    if (!Number.isInteger(q) || q <= 0) continue;
    const t = r2(o.total);
    const g = by.get(t) || new Map();
    g.set(q, (g.get(q) || 0) + 1);
    by.set(t, g);
  }

  const map = pricingMap();
  const learned = [], conflicts = [];
  const ins = db.prepare(`INSERT INTO acc_pricing (amount,pieces,product,page_id) VALUES (?,?,'','')
                          ON CONFLICT(amount) DO NOTHING`);
  for (const [amount, counts] of by) {
    if (counts.size > 1) { conflicts.push({ amount, options: [...counts.keys()] }); continue; }
    if (map.has(amount)) continue;                       // موجود — ما منمسّه
    const pieces = [...counts.keys()][0];
    ins.run(amount, pieces);
    learned.push({ amount, pieces, from_orders: [...counts.values()][0] });
  }
  return { learned, conflicts, scanned: orders.length };
}

/** يعيد حساب عدد الحبّات لكل الصفوف المحفوظة بعد ما يتغيّر التسعير */
export function rederiveRows() {
  const map = pricingMap(), model = buildModel(map), rate = feeRate();
  const rows = db.prepare("SELECT id,tracking,amount,fee,pieces,basis FROM acc_rows").all();
  const upd = db.prepare("UPDATE acc_rows SET pieces=?, product=?, state=?, basis=? WHERE id=?");
  let changed = 0;
  db.transaction(() => {
    for (const r of rows) {
      if (r.basis === "تعديل يدوي") continue;            // تعديلك اليدوي مقدّس
      const e = enrichRow({ tracking: r.tracking, amount: r.amount, fee: r.fee }, map, rate, model);
      if (e.pieces !== r.pieces || e.basis !== r.basis) {
        upd.run(e.pieces, e.product, e.state, e.basis, r.id);
        changed++;
      }
    }
  })();
  return changed;
}

router.post("/learn", (req, res) => {
  const out = learnPricingFromOrders();
  ok(res, { ...out, rederived: rederiveRows() });
});

router.post("/rederive", (req, res) => ok(res, { rederived: rederiveRows() }));

// ═══════════════ دفتر الأستاذ (جدول إكسل) ═══════════════
function ledgerRows({ from, to, client }) {
  const w = [], p = [];
  if (from != null) { w.push("s.created_at >= ?"); p.push(from); }
  if (to != null) { w.push("s.created_at < ?"); p.push(to + 86400000); }
  if (client) { w.push("r.client = ?"); p.push(String(client)); }
  const sql = `SELECT r.*, s.filename, s.courier, s.created_at AS st_at
               FROM acc_rows r JOIN acc_statements s ON s.id=r.statement_id
               ${w.length ? "WHERE " + w.join(" AND ") : ""}
               ORDER BY r.id DESC LIMIT 5000`;
  return db.prepare(sql).all(...p);
}

router.get("/ledger", (req, res) => {
  const rows = ledgerRows({ from: dayStart(req.query.from), to: dayStart(req.query.to), client: req.query.client });
  // تجميع يومي — عمود "اليوم" اللي بيهم صاحب المحل
  const byDay = new Map();
  for (const r of rows) {
    const d = dayStr(r.st_at);
    const g = byDay.get(d) || { day: d, count: 0, gross: 0, fees: 0, net: 0, pieces: 0, returned: 0, refused: 0, lost: 0 };
    g.count++; g.gross += Number(r.amount) || 0; g.fees += Number(r.fee) || 0;
    g.net += Number(r.net) || 0; g.pieces += Number(r.pieces) || 0;
    if (r.state !== "مُحصّل") g.returned++;
    if (r.state === "رفض عند الاستلام") { g.refused++; g.lost += Number(r.fee) || 0; }
    byDay.set(d, g);
  }
  const days = [...byDay.values()].map((g) => ({
    ...g, gross: r2(g.gross), fees: r2(g.fees), net: r2(g.net), lost: r2(g.lost)
  })).sort((a, b) => b.day.localeCompare(a.day));
  // 🏷️ تجميع حسب الحساب — تحصيل كل صفحة/حساب لحاله
  const byClient = new Map();
  for (const r of rows) {
    const k = r.client || "بلا اسم";
    if (!byClient.has(k)) byClient.set(k, []);
    byClient.get(k).push(r);
  }
  const clients = [...byClient.entries()]
    .map(([client, rs]) => ({ client, ...summarize(rs) }))
    .sort((a, b) => b.gross - a.gross);

  ok(res, { rows, days, clients, summary: summarize(rows) });
});

router.get("/export.csv", (req, res) => {
  const rows = ledgerRows({ from: dayStart(req.query.from), to: dayStart(req.query.to), client: req.query.client });
  const head = ["التاريخ", "الحساب", "الصفحة", "رقم البوليصة", "المبلغ المُحصّل", "عدد القطع",
                "أساس العدد", "المنتج", "أجرة التوصيل", "الصافي", "الحالة", "الكشف", "ملاحظة"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [head.map(esc).join(",")];
  for (const r of rows) {
    lines.push([dayStr(r.st_at), r.client || "", r.page_no || "", r.tracking, r.amount,
                r.pieces == null ? "غير معروف" : r.pieces,
                r.basis || "", r.product, r.fee, r.net, r.state, r.filename, r.note].map(esc).join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="accounting.csv"');
  res.send("\uFEFF" + lines.join("\r\n"));      // BOM حتى إكسل يقرأ العربي صح
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
