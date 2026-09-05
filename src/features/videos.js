// ═══════════════════════════════════════════════════════════
// 🎬 وحدة فيديوهات المنتجات
//
// مكان يرفع فيه التاجر فيديوهات منتجاته لكل صفحة. لما يسأل زبون
// عن «المنتجات الثانية» بالماسنجر، البوت بيبعتلو الفيديوهات المفعّلة
// لهديك الصفحة (مرة وحدة بالجلسة حتى ما يزعّج الزبون).
//
// 🔴 القواعد:
//  - الرفع محدود بـ 25 ميغا للفيديو (سقف فيسبوك للمرفق برابط) —
//    وكمان بيحمي القرص من الامتلاء.
//  - كل فيديو مربوط بصفحة (page_id) من brain.js — مش أي رقم.
//  - الرابط اللي بينحفظ مطلق (https) حتى يقدر فيسبوك يجيبه.
//  - بينفع رفع ملف (بينتخزّن على القرص) أو إضافة رابط فيديو مباشر.
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db/database.js";
import { PAGES } from "../bot/brain.js";
import { VIDEOS_DIR, ensureVideosDir, publicBase, PUBLIC_VIDEOS_PATH } from "../media.js";

export const slug = "videos";
export const title = "فيديوهات المنتجات";
export const icon = "🎬";

const MAX_BYTES = 25 * 1024 * 1024;   // 25 ميغا
const ALLOWED = { "mp4": "video/mp4", "mov": "video/quicktime", "m4v": "video/x-m4v", "webm": "video/webm" };

try {
  db.exec(`
  CREATE TABLE IF NOT EXISTS product_videos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id    TEXT NOT NULL,
    label      TEXT DEFAULT '',
    kind       TEXT NOT NULL DEFAULT 'file',   -- file | url
    url        TEXT NOT NULL,                   -- رابط مطلق يُرسل لفيسبوك
    file       TEXT DEFAULT '',                 -- اسم الملف على القرص (للحذف)
    filename   TEXT DEFAULT '',                 -- الاسم الأصلي للعرض
    size       INTEGER NOT NULL DEFAULT 0,
    sort       INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS product_videos_page ON product_videos(page_id, active, sort);`);
} catch (e) { console.error("videos tables:", e && e.message); }

// ── الصفحات المتاحة (اسم + معرّف) من brain.js ──
function pagesList() {
  return Object.entries(PAGES).map(([id, cfg]) => ({ id, name: (cfg && cfg.name) || id }));
}
const isKnownPage = (id) => Object.prototype.hasOwnProperty.call(PAGES, String(id));

// ═══════════════════════════════════════════════════════════
// 🤖 اللي بيستعمله البوت: فيديوهات صفحة معيّنة (المفعّلة فقط)
// ═══════════════════════════════════════════════════════════
export function videosForPage(pageId) {
  try {
    return db.prepare(
      `SELECT id, label, url, kind FROM product_videos
       WHERE page_id = ? AND active = 1
       ORDER BY sort ASC, id ASC`).all(String(pageId));
  } catch { return []; }
}

// ═══════════════════════════════════════════════════════════
// الراوتر (لوحة الأدمن)
// ═══════════════════════════════════════════════════════════
export const router = Router();
router.use(express.json({ limit: "35mb" }));

const ok = (res, data) => res.json({ ok: true, ...data });
const bad = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });
const guard = (fn) => (req, res) => {
  try { fn(req, res); } catch (e) { bad(res, e && e.message ? e.message : "خطأ غير متوقّع"); }
};

router.get("/meta", (req, res) => ok(res, { pages: pagesList(), max_mb: 25, allowed: Object.keys(ALLOWED) }));

// قائمة الفيديوهات (كلها أو لصفحة) مع اسم الصفحة
router.get("/", guard((req, res) => {
  const w = [], p = [];
  if (req.query.page_id) { w.push("page_id = ?"); p.push(String(req.query.page_id)); }
  const rows = db.prepare(
    `SELECT * FROM product_videos ${w.length ? "WHERE " + w.join(" AND ") : ""}
     ORDER BY page_id, sort ASC, id ASC`).all(...p);
  const names = Object.fromEntries(pagesList().map((x) => [x.id, x.name]));
  ok(res, {
    rows: rows.map((r) => ({ ...r, page_name: names[r.page_id] || r.page_id })),
    pages: pagesList(),
    counts: { total: rows.length, active: rows.filter((r) => r.active).length }
  });
}));

// رفع ملف فيديو (base64) → بينتخزّن على القرص وبينحفظ رابطه المطلق
router.post("/upload", (req, res) => {
  try {
    const b = req.body || {};
    const page_id = String(b.page_id || "").trim();
    if (!isKnownPage(page_id)) return bad(res, "اختر صفحة معروفة");
    const label = String(b.label || "").trim().slice(0, 120);

    const raw = String(b.base64 || "");
    const b64 = raw.replace(/^data:[^;]*;base64,/, "");
    if (!b64) return bad(res, "ما وصل ملف فيديو");
    const buf = Buffer.from(b64, "base64");
    if (!buf.length) return bad(res, "الملف فاضي أو غير مقروء");
    if (buf.length > MAX_BYTES) return bad(res, `حجم الفيديو ${(buf.length / 1048576).toFixed(1)} ميغا — الحد ${MAX_BYTES / 1048576} ميغا`);

    const orig = String(b.filename || "video.mp4");
    let ext = (orig.split(".").pop() || "").toLowerCase();
    if (!ALLOWED[ext]) ext = "mp4";   // نفترض mp4 لو الامتداد غير معروف

    const base = publicBase(req);
    if (!base) return bad(res, "ما قدرنا نحدّد رابط الموقع العام — أضف الفيديو برابط مباشر بدل الرفع، أو اضبط PUBLIC_BASE_URL.");

    ensureVideosDir();
    const name = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}.${ext}`;
    // فحص أمان: الاسم لازم يضل جوّا مجلّد الفيديوهات
    const dest = path.join(VIDEOS_DIR, name);
    if (!dest.startsWith(VIDEOS_DIR)) return bad(res, "اسم ملف غير صالح");
    try {
      fs.writeFileSync(dest, buf);
    } catch (e) {
      if (/ENOSPC/i.test(e && e.message)) return bad(res, "القرص ممتلئ — امسح فيديوهات قديمة أو أضف الفيديو برابط مباشر.");
      throw e;
    }

    const url = `${base}${PUBLIC_VIDEOS_PATH}/${name}`;
    const sort = Number(db.prepare("SELECT COALESCE(MAX(sort),0)+1 s FROM product_videos WHERE page_id=?").get(page_id)?.s) || 1;
    const r = db.prepare(
      `INSERT INTO product_videos (page_id,label,kind,url,file,filename,size,sort,active,created_at)
       VALUES (?,?,?,?,?,?,?,?,1,?)`)
      .run(page_id, label, "file", url, name, orig.slice(0, 160), buf.length, sort, Date.now());
    ok(res, { id: Number(r.lastInsertRowid), url, size: buf.length });
  } catch (e) { bad(res, e && e.message ? e.message : "تعذّر الرفع"); }
});

// إضافة فيديو برابط مباشر (بلا تخزين على القرص)
router.post("/url", guard((req, res) => {
  const b = req.body || {};
  const page_id = String(b.page_id || "").trim();
  if (!isKnownPage(page_id)) return bad(res, "اختر صفحة معروفة");
  const url = String(b.url || "").trim();
  if (!/^https:\/\/.+/i.test(url)) return bad(res, "الرابط لازم يبدأ بـ https://");
  const label = String(b.label || "").trim().slice(0, 120);
  const sort = Number(db.prepare("SELECT COALESCE(MAX(sort),0)+1 s FROM product_videos WHERE page_id=?").get(page_id)?.s) || 1;
  const r = db.prepare(
    `INSERT INTO product_videos (page_id,label,kind,url,file,filename,size,sort,active,created_at)
     VALUES (?,?,?,?,'','',0,?,1,?)`)
    .run(page_id, label, "url", url.slice(0, 600), sort, Date.now());
  ok(res, { id: Number(r.lastInsertRowid) });
}));

// تعديل الاسم/الترتيب
router.post("/:id", guard((req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT id FROM product_videos WHERE id=?").get(id);
  if (!row) return bad(res, "الفيديو غير موجود", 404);
  const b = req.body || {};
  if (b.label != null) db.prepare("UPDATE product_videos SET label=? WHERE id=?").run(String(b.label).slice(0, 120), id);
  if (b.sort != null && Number.isFinite(Number(b.sort)))
    db.prepare("UPDATE product_videos SET sort=? WHERE id=?").run(Math.round(Number(b.sort)), id);
  ok(res, {});
}));

// تفعيل/تعطيل
router.post("/:id/toggle", guard((req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT id FROM product_videos WHERE id=?").get(id);
  if (!row) return bad(res, "الفيديو غير موجود", 404);
  db.prepare("UPDATE product_videos SET active = 1 - active WHERE id=?").run(id);
  ok(res, {});
}));

// حذف (بيمسح الملف من القرص كمان لو كان مرفوع)
router.delete("/:id", guard((req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM product_videos WHERE id=?").get(id);
  if (!row) return bad(res, "الفيديو غير موجود", 404);
  if (row.kind === "file" && row.file) {
    try {
      const dest = path.join(VIDEOS_DIR, path.basename(row.file));
      if (dest.startsWith(VIDEOS_DIR) && fs.existsSync(dest)) fs.unlinkSync(dest);
    } catch (e) { console.error("delete video file:", e && e.message); }
  }
  db.prepare("DELETE FROM product_videos WHERE id=?").run(id);
  ok(res, { deleted: true });
}));
