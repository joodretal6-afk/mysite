// ═══════════════════════════════════════════════════════════
// 🔎 EMPIRE GLOBAL SEARCH — بحث موحّد عبر كل الكيانات
// يبحث في: الطلبات، العملاء، الأرقام، المحادثات، المنتجات، الصفحات.
// بحث عربي متسامح مع اختلاف الكتابة، نتائج مصنّفة مع روابط فعلية.
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import { db, retryDb, topProducts } from "../db/database.js";
import { PAGES } from "../bot/brain.js";
import { inboxUrl } from "../brain/links.js";

export const slug = "search";
export const title = "البحث الشامل";
export const icon = "🔎";

const CANCEL = "ملغي";
// تطبيع عربي بسيط: توحيد الألف والهمزات والتاء المربوطة والأرقام العربية
const AR = { "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9" };
function norm(s) {
  return String(s || "").replace(/[٠-٩]/g, d => AR[d] || d)
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[ًٌٍَُِّْ]/g, "").trim().toLowerCase();
}
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

// نمط LIKE متسامح: يحوّل الأرقام العربية للاتينية، ويجعل أشكال الألف
// والتاء/الهاء والياء/الألف المقصورة تطابق أي شكل (عبر '_' = خانة واحدة).
function likePattern(q) {
  let s = String(q || "").replace(/[٠-٩]/g, d => AR[d] || d);
  s = s.replace(/[أإآا]/g, "_").replace(/[ةه]/g, "_").replace(/[ىي]/g, "_");
  // تهريب رموز LIKE الخاصة بالمستخدم (ما عدا ما وضعناه نحن)
  return "%" + s + "%";
}

export function empireSearch(term, { limit = 6 } = {}) {
  const q = String(term || "").trim();
  if (q.length < 2) return { term: q, groups: [] };
  const like = likePattern(q);
  const nq = norm(q);
  const digits = q.replace(/[^\d]/g, "");
  const groups = [];

  // ── الطلبات ──
  try {
    const where = ["order_string LIKE ?", "area LIKE ?", "phone LIKE ?", "page_name LIKE ?", "COALESCE(invoice_no,'') LIKE ?"];
    const params = [like, like, like, like, like];
    if (/^\d+$/.test(q)) { where.push("id = ?"); params.push(Number(q)); }
    const rows = retryDb(() => db.prepare(
      `SELECT id, page_name, order_string, total, status, phone, area, invoice_no, created_at
       FROM orders WHERE ${where.join(" OR ")} ORDER BY created_at DESC LIMIT ?`
    ).all(...params, limit));
    if (rows.length) groups.push({
      key: "orders", title: "الطلبات", icon: "📦",
      items: rows.map(o => ({
        label: "#" + o.id + " — " + (o.page_name || "") + " — " + r2(o.total) + "د",
        sub: [o.status, o.area, o.phone].filter(Boolean).join(" · "),
        at: o.created_at, link: "/admin/?search=" + encodeURIComponent(o.phone || o.id)
      }))
    });
  } catch {}

  // ── العملاء (مجمّع من الطلبات) ──
  try {
    const rows = retryDb(() => db.prepare(
      `SELECT phone, MAX(page_name) AS page_name, MAX(area) AS area,
              COUNT(*) AS orders, COALESCE(SUM(CASE WHEN status<>? THEN total ELSE 0 END),0) AS spent,
              MAX(created_at) AS last_at, MAX(sender_id) AS sender_id, MAX(page_id) AS page_id
       FROM orders WHERE phone <> '' AND (phone LIKE ? OR area LIKE ?)
       GROUP BY phone ORDER BY last_at DESC LIMIT ?`
    ).all(CANCEL, like, like, limit));
    if (rows.length) groups.push({
      key: "customers", title: "العملاء", icon: "👤",
      items: rows.map(c => ({
        label: c.phone + " — " + r2(c.spent) + "د",
        sub: (c.area || "") + " · " + c.orders + " طلب",
        at: c.last_at, link: "/admin/customers?q=" + encodeURIComponent(c.phone)
      }))
    });
  } catch {}

  // ── المحادثات (رسائل واردة) ──
  try {
    const rows = retryDb(() => db.prepare(
      `SELECT page_id, page_name, sender_id, body, created_at FROM messages
       WHERE direction='in' AND body LIKE ? ORDER BY created_at DESC LIMIT ?`
    ).all(like, limit));
    if (rows.length) groups.push({
      key: "chats", title: "المحادثات", icon: "💬",
      items: rows.map(m => ({
        label: (m.page_name || "صفحة") + ": " + String(m.body || "").slice(0, 60),
        sub: "من زبون " + String(m.sender_id || "").slice(-6),
        at: m.created_at, link: inboxUrl(m.page_id, m.sender_id) || "/admin/chats"
      }))
    });
  } catch {}

  // ── المنتجات ──
  try {
    const prods = topProducts(60).filter(p => norm(p.product).includes(nq)).slice(0, limit);
    if (prods.length) groups.push({
      key: "products", title: "المنتجات", icon: "🏷️",
      items: prods.map(p => ({ label: p.product, sub: "مبيع " + p.qty, at: null, link: "/admin/products" }))
    });
  } catch {}

  // ── الصفحات ──
  try {
    const pages = Object.entries(PAGES)
      .filter(([id, c]) => norm(c && c.name).includes(nq) || id.includes(digits && digits.length >= 4 ? digits : "\u0000"))
      .slice(0, limit);
    if (pages.length) groups.push({
      key: "pages", title: "الصفحات", icon: "🏛️",
      items: pages.map(([id, c]) => ({ label: c.name || id, sub: "صفحة", at: null, link: "/admin/pages" }))
    });
  } catch {}

  const total = groups.reduce((a, g) => a + g.items.length, 0);
  return { term: q, total, groups };
}

export const router = Router();
router.get("/q", (req, res) => {
  try {
    const lim = Math.min(10, Math.max(3, Number(req.query.limit) || 6));
    res.json({ ok: true, ...empireSearch(req.query.term || req.query.q, { limit: lim }) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e && e.message ? e.message : "فشل البحث" });
  }
});
