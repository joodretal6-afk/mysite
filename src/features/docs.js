// ═══════════════════════════════════════════════════════════
// 🗂️ وحدة الأرشيف والوثائق والامتثال
//
// شو بتعمل:
//  1) أرشيف وثائق: ترفع PDF/إكسل/CSV/صورة بنوعها وتاريخها ووسومها
//  2) استخراج نص الوثيقة أوتوماتيك وقت الرفع (عبر القارئ الشامل)
//  3) بحث جوّا محتوى الوثيقة مش بالاسم بس
//  4) سجل التراخيص والشهادات بتواريخ انتهائها
//  5) تنبيه انتهاء الترخيص قبل X يوم بعدّاد أيام حقيقي
//  6) العقود: مدّتها، بنودها، وتاريخ تجديدها
//  7) سجل وصول: مين فتح أي وثيقة ومتى
//  8) مجلدات ووسوم وفلترة سريعة
//  9) لوحة امتثال: منتهي / بينتهي / ناقص
// 10) تصدير فهرس CSV + تنزيل الوثيقة الأصلية بنفس بايتاتها
//
// 🔴 القاعدة الحاكمة: ما منخترع ولا معلومة.
//    - الوثيقة اللي ما قدرنا نقرأ محتواها منقول للمستخدم بصراحة
//      إنّ البحث رح يلاقيها بالاسم والوسوم بس — وممنوع نعبّي نص من راسنا.
//    - تاريخ انتهاء الترخيص أو العقد بيدخله المستخدم. ما منستنتجه أبداً.
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import express from "express";
import { db } from "../db/database.js";
import { readAnyFile } from "../bot/fileRead.js";

export const slug = "docs";
export const title = "الأرشيف والوثائق";
export const icon = "🗂️";

// ── الجداول (كلها بادئة docs_) ──
try {
  db.exec(`
  CREATE TABLE IF NOT EXISTS docs_files (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    doc_type     TEXT NOT NULL DEFAULT 'عام',
    folder       TEXT NOT NULL DEFAULT 'عام',
    tags         TEXT NOT NULL DEFAULT '',
    doc_date     TEXT NOT NULL DEFAULT '',
    filename     TEXT NOT NULL DEFAULT '',
    ext          TEXT NOT NULL DEFAULT '',
    size         INTEGER NOT NULL DEFAULT 0,
    content_b64  TEXT NOT NULL DEFAULT '',
    body_text    TEXT NOT NULL DEFAULT '',
    body_norm    TEXT NOT NULL DEFAULT '',
    extracted    INTEGER NOT NULL DEFAULT 0,
    extract_note TEXT NOT NULL DEFAULT '',
    note         TEXT NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS docs_files_folder ON docs_files(folder);

  CREATE TABLE IF NOT EXISTS docs_licenses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'رخصة',
    issuer     TEXT NOT NULL DEFAULT '',
    number     TEXT NOT NULL DEFAULT '',
    issued_at  TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL,
    file_id    INTEGER,
    note       TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS docs_contracts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    party        TEXT NOT NULL DEFAULT '',
    kind         TEXT NOT NULL DEFAULT 'مورد',
    starts_at    TEXT NOT NULL DEFAULT '',
    ends_at      TEXT NOT NULL,
    notice_days  INTEGER NOT NULL DEFAULT 30,
    value        REAL,
    terms        TEXT NOT NULL DEFAULT '',
    file_id      INTEGER,
    note         TEXT NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS docs_access (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id  INTEGER NOT NULL,
    who      TEXT NOT NULL DEFAULT 'غير معروف',
    action   TEXT NOT NULL,
    at       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS docs_access_file ON docs_access(file_id);

  CREATE TABLE IF NOT EXISTS docs_required (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_type   TEXT NOT NULL UNIQUE,
    note       TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );`);
} catch (e) { console.error("docs tables:", e && e.message); }

// ═══════════════ أدوات مشتركة ═══════════════
export const MAX_BYTES = 15 * 1024 * 1024;      // سقف الملف الواحد
const TZ_MS = 10800 * 1000;                     // الأردن UTC+3

/** اليوم بتوقيت عمّان — عشان عدّاد الأيام ما ينزلق يوم بسبب UTC */
export function todayStr(now = Date.now()) {
  return new Date(Number(now) + TZ_MS).toISOString().slice(0, 10);
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
const dayNum = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null;
};

/**
 * كم يوم باقي لتاريخ الانتهاء: 0 = بينتهي اليوم، سالب = منتهي من زمان.
 * بيرجّع null إذا التاريخ مش مكتوب صح — لأنّ الصفر هون بيعني «اليوم» مش «ما بنعرف».
 */
export function daysLeft(dateStr, now = Date.now()) {
  const d = dayNum(dateStr), t = dayNum(todayStr(now));
  return d == null || t == null ? null : d - t;
}

/** حالة الصلاحية بكلمة وحدة — نفس المنطق مستخدم للتراخيص والعقود */
export function expiryState(dateStr, warnDays = 30, now = Date.now()) {
  const left = daysLeft(dateStr, now);
  if (left == null) return { days_left: null, state: "بلا تاريخ" };
  if (left < 0) return { days_left: left, state: "منتهي" };
  if (left === 0) return { days_left: 0, state: "بينتهي اليوم" };
  if (left <= warnDays) return { days_left: left, state: "قرب الانتهاء" };
  return { days_left: left, state: "ساري" };
}

/** توحيد العربي (همزات/تاء مربوطة/تشكيل) حتى البحث يلاقي الكلمة مهما انكتبت */
export function norm(s) {
  return String(s ?? "").normalize("NFKC")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[إأآٱ]/g, "ا").replace(/ة/g, "ه").replace(/[ىی]/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\s+/g, " ").trim().toLowerCase();
}

const cleanTags = (v) => {
  const arr = Array.isArray(v) ? v : String(v || "").split(/[,،]/);
  return [...new Set(arr.map((t) => String(t).trim()).filter(Boolean))].slice(0, 20);
};
const extOf = (name) => String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";

// ═══════════════════════════════════════════════════════════
// 📖 استخراج نص الوثيقة
// منمرّر الملف على القارئ الشامل. إذا رجع نص منخزّنه للبحث،
// وإذا ما قدر (صورة ممسوحة مثلاً) منسجّل السبب الصريح ومنقوله
// للمستخدم — بلا ولا كلمة مخترعة.
// ═══════════════════════════════════════════════════════════
const NO_TEXT_MSG = "ما قدرنا نقرأ محتواها — البحث رح يلاقيها بالاسم والوسوم بس";

export async function extractText(buffer, filename) {
  let f;
  try { f = await readAnyFile(buffer, filename); }
  catch (e) { return { extracted: 0, text: "", note: `${NO_TEXT_MSG} (${e && e.message})` }; }

  if (!f.ok) return { extracted: 0, text: "", note: `${NO_TEXT_MSG} — السبب: ${f.error}` };

  // الجداول منسطّحها لنص عشان البحث يلاقي أي خانة فيها
  const fromTable = (t) => !t || !t.rows?.length ? "" :
    [t.headers.join(" ")].concat(t.rows.map((r) => t.headers.map((h) => r[h] ?? "").join(" "))).join("\n");

  let text = String(f.text || "").trim();
  if (!text && f.sheets?.length) text = f.sheets.map((s) => `[${s.name}]\n${fromTable(s)}`).join("\n");
  if (!text) text = fromTable(f.table);
  text = text.trim();

  if (!text) return { extracted: 0, text: "", note: `${NO_TEXT_MSG} — الملف ما فيه نص نقراه` };
  return { extracted: 1, text: text.slice(0, 400_000), note: "" };
}

// ═══════════════ عمليات الأرشيف ═══════════════
const fileCols = `id,title,doc_type,folder,tags,doc_date,filename,ext,size,extracted,extract_note,note,created_at`;

export function logAccess(file_id, who, action) {
  db.prepare("INSERT INTO docs_access (file_id,who,action,at) VALUES (?,?,?,?)")
    .run(Number(file_id), String(who || "غير معروف").slice(0, 80), String(action).slice(0, 40), Date.now());
}

/**
 * فلترة الأرشيف. `q` بتدوّر بالاسم والوسوم **وبمحتوى الوثيقة**،
 * وكل كلمة بالبحث لازم تنوجد (AND) حتى النتيجة تكون دقيقة مش عشوائية.
 */
export function listFiles({ q = "", folder = "", doc_type = "", tag = "", limit = 300 } = {}) {
  const rows = db.prepare(`SELECT ${fileCols}, body_norm, body_text FROM docs_files
                           ORDER BY created_at DESC LIMIT ?`).all(Math.min(Number(limit) || 300, 1000));
  const words = norm(q).split(" ").filter(Boolean);
  const nTag = norm(tag), nFolder = norm(folder), nType = norm(doc_type);

  return rows.filter((r) => {
    if (nFolder && norm(r.folder) !== nFolder) return false;
    if (nType && norm(r.doc_type) !== nType) return false;
    if (nTag && !norm(r.tags).includes(nTag)) return false;
    if (!words.length) return true;
    const hay = norm([r.title, r.tags, r.filename, r.doc_type, r.folder, r.note].join(" ")) + " " + (r.body_norm || "");
    return words.every((w) => hay.includes(w));
  }).map((r) => {
    const { body_norm, body_text, ...rest } = r;
    const hit = words.length && body_norm ? words.find((w) => body_norm.includes(w)) : null;
    return { ...rest, tags: r.tags ? r.tags.split(",") : [], snippet: hit ? snippetFor(body_text, words) : null };
  });
}

/** مقتطف من نص الوثيقة نفسه حوالين أول كلمة بحث — نص حقيقي منسوخ حرفياً */
function snippetFor(text, words) {
  const t = String(text || "");
  if (!t) return null;
  const nt = norm(t);
  let at = -1;
  for (const w of words) { const i = nt.indexOf(w); if (i >= 0) { at = i; break; } }
  if (at < 0) return null;
  const from = Math.max(0, at - 60);
  return (from ? "…" : "") + t.slice(from, from + 180).replace(/\s+/g, " ") + (t.length > from + 180 ? "…" : "");
}

/** التراخيص مع عدّاد الأيام — مرتّبة بالأقرب انتهاءً لأنّه هو المستعجل */
export function licenseRows(warnDays = 30, now = Date.now()) {
  return db.prepare("SELECT * FROM docs_licenses").all()
    .map((r) => ({ ...r, ...expiryState(r.expires_at, warnDays, now) }))
    .sort((a, b) => (a.days_left ?? 1e9) - (b.days_left ?? 1e9));
}

export function contractRows(now = Date.now()) {
  return db.prepare("SELECT * FROM docs_contracts").all()
    .map((r) => ({ ...r, ...expiryState(r.ends_at, Number(r.notice_days) || 30, now) }))
    .sort((a, b) => (a.days_left ?? 1e9) - (b.days_left ?? 1e9));
}

/**
 * لوحة الامتثال: منتهي، بينتهي هالشهر (30 يوم)، وناقص.
 * «الناقص» = نوع وثيقة المستخدم نفسه حدّده كمطلوب وما رفع تحته ولا وثيقة.
 */
export function compliance(now = Date.now()) {
  const lic = licenseRows(30, now), con = contractRows(now);
  const all = [
    ...lic.map((r) => ({ id: r.id, what: "ترخيص", name: r.name, date: r.expires_at, days_left: r.days_left, state: r.state })),
    ...con.map((r) => ({ id: r.id, what: "عقد", name: r.title, date: r.ends_at, days_left: r.days_left, state: r.state }))
  ];
  const have = new Set(db.prepare("SELECT DISTINCT doc_type FROM docs_files").all().map((r) => norm(r.doc_type)));
  const missing = db.prepare("SELECT * FROM docs_required ORDER BY doc_type").all()
    .filter((r) => !have.has(norm(r.doc_type)));

  const expired = all.filter((r) => r.days_left != null && r.days_left < 0);
  const soon = all.filter((r) => r.days_left != null && r.days_left >= 0 && r.days_left <= 30);
  const noDate = all.filter((r) => r.days_left == null);
  return {
    expired, soon, missing, no_date: noDate,
    valid: all.filter((r) => r.days_left != null && r.days_left > 30),
    counts: { expired: expired.length, soon: soon.length, missing: missing.length, docs: db.prepare("SELECT COUNT(*) c FROM docs_files").get().c }
  };
}

// ═══════════════ الراوتر ═══════════════
export const router = Router();
router.use(express.json({ limit: "30mb" }));   // 15 ميجا ملف بصيغة base64 بتصير ~20

const ok = (res, data) => res.json({ ok: true, ...data });
const bad = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });
const who = (req) => String(req.headers["x-user"] || req.query.who || req.body?.who || "غير معروف").slice(0, 80);

// ── (1)(2) الرفع مع استخراج النص ──
router.post("/files", async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || b.filename || "").trim();
    if (!title) return bad(res, "لازم اسم للوثيقة");
    const b64 = String(b.base64 || "").replace(/^data:.*?;base64,/, "");
    if (!b64) return bad(res, "ما وصل ملف");
    if (b.doc_date && !isDate(b.doc_date)) return bad(res, "تاريخ الوثيقة لازم بصيغة YYYY-MM-DD");

    let buf;
    try { buf = Buffer.from(b64, "base64"); } catch { return bad(res, "الملف غير صالح"); }
    if (!buf.length) return bad(res, "الملف فاضي");
    if (buf.length > MAX_BYTES)
      return bad(res, `الملف ${(buf.length / 1048576).toFixed(1)} ميجا — الحد الأقصى 15 ميجا. اضغط الملف أو ارفع نسخة أخف.`);

    const filename = String(b.filename || title).slice(0, 200);
    const ex = await extractText(buf, filename);
    const tags = cleanTags(b.tags);

    const r = db.prepare(`INSERT INTO docs_files
        (title,doc_type,folder,tags,doc_date,filename,ext,size,content_b64,body_text,body_norm,extracted,extract_note,note,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(title.slice(0, 200), String(b.doc_type || "عام").slice(0, 80), String(b.folder || "عام").slice(0, 80),
           tags.join(","), String(b.doc_date || ""), filename, extOf(filename), buf.length,
           buf.toString("base64"), ex.text, norm(ex.text), ex.extracted, ex.note,
           String(b.note || "").slice(0, 1000), Date.now());

    const id = Number(r.lastInsertRowid);
    logAccess(id, who(req), "رفع");
    ok(res, { id, size: buf.length, extracted: !!ex.extracted, chars: ex.text.length, warning: ex.note || null });
  } catch (e) { bad(res, "تعذّر حفظ الوثيقة: " + (e && e.message), 500); }
});

// ── (3)(8) الفهرس والبحث بالمحتوى والفلترة ──
router.get("/files", (req, res) => {
  const rows = listFiles(req.query);
  ok(res, { rows, count: rows.length });
});

router.get("/facets", (req, res) => {
  const rows = db.prepare("SELECT folder,doc_type,tags FROM docs_files").all();
  const tags = new Set();
  rows.forEach((r) => (r.tags ? r.tags.split(",") : []).forEach((t) => t && tags.add(t)));
  ok(res, {
    folders: [...new Set(rows.map((r) => r.folder).filter(Boolean))].sort(),
    types: [...new Set(rows.map((r) => r.doc_type).filter(Boolean))].sort(),
    tags: [...tags].sort()
  });
});

// ── (7) فتح الوثيقة = سطر بسجل الوصول ──
router.get("/files/:id", (req, res) => {
  const r = db.prepare(`SELECT ${fileCols}, body_text FROM docs_files WHERE id=?`).get(Number(req.params.id));
  if (!r) return bad(res, "الوثيقة مش موجودة", 404);
  logAccess(r.id, who(req), "فتح");
  ok(res, {
    file: { ...r, tags: r.tags ? r.tags.split(",") : [], body_text: r.body_text.slice(0, 20000) },
    access: db.prepare("SELECT * FROM docs_access WHERE file_id=? ORDER BY at DESC LIMIT 50").all(r.id)
  });
});

router.patch("/files/:id", (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare("SELECT id FROM docs_files WHERE id=?").get(id);
  if (!cur) return bad(res, "الوثيقة مش موجودة", 404);
  const b = req.body || {};
  if (b.doc_date && !isDate(b.doc_date)) return bad(res, "تاريخ الوثيقة لازم بصيغة YYYY-MM-DD");
  db.prepare(`UPDATE docs_files SET title=COALESCE(NULLIF(?,''),title), doc_type=COALESCE(NULLIF(?,''),doc_type),
              folder=COALESCE(NULLIF(?,''),folder), tags=?, doc_date=COALESCE(NULLIF(?,''),doc_date), note=? WHERE id=?`)
    .run(String(b.title || "").slice(0, 200), String(b.doc_type || "").slice(0, 80), String(b.folder || "").slice(0, 80),
         cleanTags(b.tags).join(","), String(b.doc_date || ""), String(b.note || "").slice(0, 1000), id);
  logAccess(id, who(req), "تعديل");
  ok(res, {});
});

// ── (10) تنزيل الوثيقة الأصلية بنفس بايتاتها ──
router.get("/files/:id/download", (req, res) => {
  const r = db.prepare("SELECT filename,ext,content_b64 FROM docs_files WHERE id=?").get(Number(req.params.id));
  if (!r) return bad(res, "الوثيقة مش موجودة", 404);
  logAccess(Number(req.params.id), who(req), "تنزيل");
  const MIME = { pdf: "application/pdf", csv: "text/csv", txt: "text/plain", json: "application/json",
                 png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
                 xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  const buf = Buffer.from(r.content_b64, "base64");
  res.setHeader("Content-Type", MIME[r.ext] || "application/octet-stream");
  res.setHeader("Content-Length", buf.length);
  res.setHeader("Content-Disposition",
    `attachment; filename="doc-${req.params.id}.${r.ext || "bin"}"; filename*=UTF-8''${encodeURIComponent(r.filename || "doc")}`);
  res.end(buf);
});

router.delete("/files/:id", (req, res) => {
  const id = Number(req.params.id);
  const used = db.prepare("SELECT COUNT(*) c FROM docs_licenses WHERE file_id=?").get(id).c +
               db.prepare("SELECT COUNT(*) c FROM docs_contracts WHERE file_id=?").get(id).c;
  if (used) return bad(res, "الوثيقة مربوطة بترخيص أو عقد — فكّ الربط قبل الحذف");
  db.prepare("DELETE FROM docs_files WHERE id=?").run(id);
  db.prepare("DELETE FROM docs_access WHERE file_id=?").run(id);
  ok(res, {});
});

// ── (4)(5) التراخيص والشهادات وتنبيه انتهائها ──
router.get("/licenses", (req, res) => {
  const warn = Math.max(0, Number(req.query.warn) || 30);
  const rows = licenseRows(warn);
  ok(res, { rows, counts: {
    expired: rows.filter((r) => r.state === "منتهي").length,
    soon: rows.filter((r) => r.state === "قرب الانتهاء" || r.state === "بينتهي اليوم").length
  } });
});

router.post("/licenses", (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim();
  if (!name) return bad(res, "لازم اسم الترخيص أو الشهادة");
  // 🔴 تاريخ الانتهاء من المستخدم فقط — ممنوع نستنتجه من الملف
  if (!isDate(b.expires_at)) return bad(res, "تاريخ الانتهاء إلزامي وبصيغة YYYY-MM-DD — منّا بنستنتجه من الملف");
  if (b.issued_at && !isDate(b.issued_at)) return bad(res, "تاريخ الإصدار لازم بصيغة YYYY-MM-DD");
  if (b.issued_at && dayNum(b.issued_at) > dayNum(b.expires_at)) return bad(res, "تاريخ الإصدار بعد تاريخ الانتهاء — راجع التواريخ");
  if (b.file_id != null && b.file_id !== "" && !db.prepare("SELECT id FROM docs_files WHERE id=?").get(Number(b.file_id)))
    return bad(res, "الوثيقة المربوطة مش موجودة بالأرشيف");

  const r = db.prepare(`INSERT INTO docs_licenses (name,kind,issuer,number,issued_at,expires_at,file_id,note,created_at)
                        VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(name.slice(0, 160), String(b.kind || "رخصة").slice(0, 60), String(b.issuer || "").slice(0, 120),
         String(b.number || "").slice(0, 80), String(b.issued_at || ""), String(b.expires_at),
         b.file_id ? Number(b.file_id) : null, String(b.note || "").slice(0, 500), Date.now());
  ok(res, { id: Number(r.lastInsertRowid), ...expiryState(b.expires_at) });
});

router.post("/licenses/:id/renew", (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare("SELECT id FROM docs_licenses WHERE id=?").get(id)) return bad(res, "الترخيص مش موجود", 404);
  if (!isDate(req.body?.expires_at)) return bad(res, "تاريخ الانتهاء الجديد لازم بصيغة YYYY-MM-DD");
  db.prepare("UPDATE docs_licenses SET expires_at=?, issued_at=COALESCE(NULLIF(?,''),issued_at) WHERE id=?")
    .run(String(req.body.expires_at), String(req.body.issued_at || ""), id);
  ok(res, { ...expiryState(req.body.expires_at) });
});

router.delete("/licenses/:id", (req, res) => {
  db.prepare("DELETE FROM docs_licenses WHERE id=?").run(Number(req.params.id));
  ok(res, {});
});

// ── (6) العقود ──
router.get("/contracts", (req, res) => {
  const rows = contractRows();
  ok(res, { rows, counts: {
    expired: rows.filter((r) => r.state === "منتهي").length,
    soon: rows.filter((r) => r.state === "قرب الانتهاء" || r.state === "بينتهي اليوم").length
  } });
});

router.post("/contracts", (req, res) => {
  const b = req.body || {};
  const t = String(b.title || "").trim();
  if (!t) return bad(res, "لازم عنوان للعقد");
  if (!isDate(b.ends_at)) return bad(res, "تاريخ نهاية العقد إلزامي وبصيغة YYYY-MM-DD");
  if (b.starts_at && !isDate(b.starts_at)) return bad(res, "تاريخ بداية العقد لازم بصيغة YYYY-MM-DD");
  if (b.starts_at && dayNum(b.starts_at) > dayNum(b.ends_at)) return bad(res, "بداية العقد بعد نهايته — راجع التواريخ");
  const notice = b.notice_days == null || b.notice_days === "" ? 30 : Number(b.notice_days);
  if (!Number.isInteger(notice) || notice < 0 || notice > 365) return bad(res, "مهلة التنبيه لازم رقم صحيح بين 0 و 365");
  const value = b.value == null || b.value === "" ? null : Number(b.value);
  if (value != null && (!Number.isFinite(value) || value < 0)) return bad(res, "قيمة العقد لازم رقم موجب");
  if (b.file_id != null && b.file_id !== "" && !db.prepare("SELECT id FROM docs_files WHERE id=?").get(Number(b.file_id)))
    return bad(res, "الوثيقة المربوطة مش موجودة بالأرشيف");

  const r = db.prepare(`INSERT INTO docs_contracts (title,party,kind,starts_at,ends_at,notice_days,value,terms,file_id,note,created_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(t.slice(0, 200), String(b.party || "").slice(0, 160), String(b.kind || "مورد").slice(0, 60),
         String(b.starts_at || ""), String(b.ends_at), notice, value, String(b.terms || "").slice(0, 4000),
         b.file_id ? Number(b.file_id) : null, String(b.note || "").slice(0, 500), Date.now());
  ok(res, { id: Number(r.lastInsertRowid), ...expiryState(b.ends_at, notice) });
});

router.delete("/contracts/:id", (req, res) => {
  db.prepare("DELETE FROM docs_contracts WHERE id=?").run(Number(req.params.id));
  ok(res, {});
});

// ── (7) سجل الوصول ──
router.get("/access", (req, res) => {
  const w = [], p = [];
  if (req.query.file_id) { w.push("a.file_id=?"); p.push(Number(req.query.file_id)); }
  if (req.query.who) { w.push("a.who=?"); p.push(String(req.query.who)); }
  const rows = db.prepare(`SELECT a.*, f.title FROM docs_access a LEFT JOIN docs_files f ON f.id=a.file_id
      ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY a.at DESC LIMIT 300`).all(...p);
  ok(res, { rows });
});

// ── (9) الوثائق المطلوبة ولوحة الامتثال ──
router.get("/required", (req, res) => ok(res, { rows: db.prepare("SELECT * FROM docs_required ORDER BY doc_type").all() }));

router.post("/required", (req, res) => {
  const t = String(req.body?.doc_type || "").trim();
  if (!t) return bad(res, "لازم تكتب نوع الوثيقة المطلوبة");
  db.prepare(`INSERT INTO docs_required (doc_type,note,created_at) VALUES (?,?,?)
              ON CONFLICT(doc_type) DO UPDATE SET note=excluded.note`)
    .run(t.slice(0, 80), String(req.body?.note || "").slice(0, 300), Date.now());
  ok(res, {});
});

router.delete("/required/:id", (req, res) => {
  db.prepare("DELETE FROM docs_required WHERE id=?").run(Number(req.params.id));
  ok(res, {});
});

router.get("/compliance", (req, res) => ok(res, compliance()));

// ── (10) تصدير فهرس الوثائق ──
router.get("/export.csv", (req, res) => {
  const rows = listFiles({ ...req.query, limit: 1000 });
  const head = ["#", "الوثيقة", "النوع", "المجلد", "الوسوم", "تاريخ الوثيقة", "الملف", "الحجم (ك.ب)",
                "انقرأ محتواها؟", "سبب عدم القراءة", "ملاحظة", "تاريخ الرفع"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [head.map(esc).join(",")];
  for (const r of rows)
    lines.push([r.id, r.title, r.doc_type, r.folder, (r.tags || []).join(" | "), r.doc_date,
                r.filename, Math.round(r.size / 1024), r.extracted ? "نعم" : "لا", r.extract_note,
                r.note, todayStr(r.created_at)].map(esc).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="docs-index.csv"');
  res.send("﻿" + lines.join("\r\n"));   // BOM حتى إكسل يقرأ العربي صح
});
