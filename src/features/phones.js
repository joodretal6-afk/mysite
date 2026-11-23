// ═══════════════════════════════════════════════════════════
// 📱 وحدة «أرقام من المحادثات»
//
// بتعرض أي محادثة ذكر فيها الزبون (المُرسِل، مش بوتنا) رقم هاتف
// أردني (077 / 078 / 079) — مجمّعة لكل زبون، ومفصولة لكل صفحة لحال.
// المصدر: جدول الرسائل direction='in' فقط (كلام الزبون نفسه).
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import { db } from "../db/database.js";
import { PAGES } from "../bot/brain.js";
import { inboxUrl } from "../brain/links.js";

export const slug = "phones";
export const title = "أرقام من المحادثات";
export const icon = "📱";

// تطبيع الأرقام العربية للإنجليزية
const AR = { "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9",
             "۰":"0","۱":"1","۲":"2","۳":"3","۴":"4","۵":"5","۶":"6","۷":"7","۸":"8","۹":"9" };
const toEn = (s) => String(s || "").replace(/[٠-٩۰-۹]/g, d => AR[d] || d);
// رقم أردني: (+962/00962)؟ 0؟ 7 ثم 7/8/9 ثم 7 خانات
const PHONE_RE = /(?:\+?962|00962)?0?7[789]\d{7}/g;

function extractAll(body) {
  const norm = toEn(body).replace(/[\s\-().]/g, "");
  const out = [];
  const matches = norm.match(PHONE_RE);
  if (matches) for (let m of matches) {
    m = m.replace(/^(?:\+?962|00962)/, "0").replace(/^00?7/, "07");
    const mm = m.match(/7[789]\d{7}$/);
    if (mm) out.push("0" + mm[0]);
  }
  return out;
}

const pagesList = () => Object.entries(PAGES).map(([id, cfg]) => ({ id, name: (cfg && cfg.name) || id }));

// المحادثات اللي فيها أرقام — مجمّعة لكل (صفحة + زبون)
function conversationsWithPhones({ pageId } = {}) {
  const params = [];
  // ملاحظة: ما منفلتر بـ LIKE '%7%' لأن الأرقام ممكن تكون عربية (٧)،
  // فمنجيب كل رسائل الزبون ومنستخرج بالـ regex (مع تطبيع الأرقام).
  let where = "direction = 'in' AND body IS NOT NULL";
  if (pageId) { where += " AND page_id = ?"; params.push(String(pageId)); }
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT page_id, page_name, sender_id, body, created_at
       FROM messages WHERE ${where} ORDER BY created_at ASC`).all(...params);
  } catch { return []; }

  const map = new Map();   // key page+sender → سجل مجمّع
  for (const r of rows) {
    const phones = extractAll(r.body);
    if (!phones.length) continue;
    const key = r.page_id + "|" + r.sender_id;
    let e = map.get(key);
    if (!e) {
      e = { page_id: r.page_id, page_name: r.page_name || "—", sender_id: r.sender_id,
            phones: new Set(), messages: 0, first_at: r.created_at, last_at: r.created_at,
            last_sample: r.body.slice(0, 160) };
      map.set(key, e);
    }
    phones.forEach(p => e.phones.add(p));
    e.messages++;
    if (r.created_at < e.first_at) e.first_at = r.created_at;
    if (r.created_at >= e.last_at) { e.last_at = r.created_at; e.last_sample = r.body.slice(0, 160); }
  }

  return [...map.values()]
    .map(e => ({
      page_id: e.page_id, page_name: e.page_name, sender_id: e.sender_id,
      phones: [...e.phones], messages: e.messages,
      first_at: e.first_at, last_at: e.last_at, last_sample: e.last_sample,
      link: inboxUrl(e.page_id, e.sender_id)
    }))
    .sort((a, b) => b.last_at - a.last_at);
}

export const router = Router();
const ok = (res, data) => res.json({ ok: true, ...data });
const guard = (fn) => (req, res) => {
  try { fn(req, res); } catch (e) { res.status(400).json({ ok: false, error: e && e.message ? e.message : "خطأ" }); }
};

router.get("/meta", guard((req, res) => {
  const all = conversationsWithPhones({});
  // عدّاد لكل صفحة
  const counts = {};
  for (const r of all) counts[r.page_id] = (counts[r.page_id] || 0) + 1;
  ok(res, { pages: pagesList().map(p => ({ ...p, count: counts[p.id] || 0 })), total: all.length });
}));

router.get("/", guard((req, res) => {
  const rows = conversationsWithPhones({ pageId: req.query.page_id });
  const uniquePhones = new Set();
  rows.forEach(r => r.phones.forEach(p => uniquePhones.add(p)));
  ok(res, { rows, totals: { conversations: rows.length, phones: uniquePhones.size } });
}));

// تصدير CSV (لكل صفحة أو الكل) — يفتحه إكسل عربي صح
router.get("/export.csv", guard((req, res) => {
  const rows = conversationsWithPhones({ pageId: req.query.page_id });
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const d = (ts) => new Date(Number(ts) + 10800000).toISOString().slice(0, 16).replace("T", " ");
  const head = ["الصفحة", "الأرقام", "عدد الرسائل", "أول ظهور", "آخر ظهور", "آخر رسالة"];
  const lines = rows.map(r => [r.page_name, r.phones.join(" / "), r.messages, d(r.first_at), d(r.last_at), r.last_sample]);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="phones.csv"`);
  res.send("﻿" + [head.map(esc).join(","), ...lines.map(l => l.map(esc).join(","))].join("\r\n"));
}));
