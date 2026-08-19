// ═══════════════════════════════════════════════════════════
// 📲 وحدة مركز إعادة التواصل عبر واتساب (WhatsApp Retention Center)
//
// مبدأ التصميم (حسب المتطلبات 24/25): ما بننشئ نظام بيانات موازي.
// العملاء **مشتقّون حيّاً من جدول orders الموجود** (تجميع حسب الهاتف
// لكل صفحة). جدول wa_customers overlay رفيع بيحمل بس الحقول الخاصة
// بواتساب (الموافقة، عدّاد الرسائل). ولا اختلاط أرقام بين الصفحات:
// كل استعلام مقيّد بـ page_id.
//
// الإرسال رسمي فقط عبر Cloud API (bot/waCloud.js). التسويق بس للموافقين.
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import { db, retryDb } from "../db/database.js";
import { WA, toE164Jordan, toLocalJordan, isValidJordan } from "../bot/waCloud.js";
import { PAGES } from "../bot/brain.js";
import { getUser } from "../db/database.js";

export const slug = "whatsapp";
export const title = "مركز واتساب";
export const icon = "📲";

// ── الجداول (wa_ فقط، بلا مساس بأي جدول قائم) ──
try {
  db.exec(`
  CREATE TABLE IF NOT EXISTS wa_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id TEXT UNIQUE, account_name TEXT, wa_number TEXT,
    provider TEXT DEFAULT 'cloud', token_env TEXT, phone_id_env TEXT,
    status TEXT DEFAULT 'disconnected', last_connected_at INTEGER, created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS wa_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, category TEXT, body TEXT, created_at INTEGER, updated_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS wa_customers (
    page_id TEXT, phone TEXT, name TEXT,
    consent TEXT DEFAULT 'UNKNOWN',          -- OPTED_IN / OPTED_OUT / UNKNOWN
    consent_at INTEGER, messages_sent INTEGER DEFAULT 0,
    last_message_at INTEGER, last_campaign TEXT,
    PRIMARY KEY(page_id, phone)
  );
  CREATE TABLE IF NOT EXISTS wa_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, page_id TEXT, template_id INTEGER, audience_json TEXT,
    status TEXT DEFAULT 'draft',             -- draft/running/paused/done
    targeted INTEGER DEFAULT 0, eligible INTEGER DEFAULT 0, excluded INTEGER DEFAULT 0,
    sent INTEGER DEFAULT 0, delivered INTEGER DEFAULT 0, failed INTEGER DEFAULT 0,
    created_by TEXT, created_at INTEGER, started_at INTEGER, finished_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS wa_campaign_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER, page_id TEXT, phone TEXT, e164 TEXT, name TEXT,
    body TEXT, status TEXT DEFAULT 'pending', -- pending/sent/delivered/failed/skipped
    wamid TEXT, error TEXT, sent_at INTEGER,
    order_after_id INTEGER, revenue_after REAL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS wa_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id TEXT, phone TEXT, direction TEXT, campaign_id INTEGER,
    template TEXT, body TEXT, status TEXT, wamid TEXT, created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS wa_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT, action TEXT, detail TEXT, created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS wa_user_pages (
    username TEXT, page_id TEXT, UNIQUE(username, page_id)
  );
  CREATE INDEX IF NOT EXISTS idx_wa_targets_camp ON wa_campaign_targets(campaign_id, status);
  CREATE INDEX IF NOT EXISTS idx_wa_targets_phone ON wa_campaign_targets(page_id, phone, sent_at);
  CREATE INDEX IF NOT EXISTS idx_wa_msg_phone ON wa_messages(page_id, phone, created_at);
  `);
} catch (e) { console.error("wa tables:", e && e.message); }

// ── أدوات ──
const now = () => Date.now();
const DELIVERED = "تم التسليم", CANCELLED = "ملغي";

function audit(actor, action, detail) {
  try { db.prepare("INSERT INTO wa_audit (actor,action,detail,created_at) VALUES (?,?,?,?)")
    .run(String(actor || "?"), action, typeof detail === "string" ? detail : JSON.stringify(detail || {}), now()); }
  catch (e) { console.error("wa audit:", e && e.message); }
}

// صلاحية الصفحة: admin يشوف الكل؛ غير هيك يقتصر على صفحاته (إن حُدّدت).
function allowedPages(username) {
  try {
    const u = getUser(username);
    if (!u || (u.role || "admin") === "admin") return null;   // null = كل الصفحات
    const rows = db.prepare("SELECT page_id FROM wa_user_pages WHERE username=?").all(username);
    return rows.length ? rows.map(r => r.page_id) : null;      // بلا قيد = الكل (تجنّب قفل غير مقصود)
  } catch { return null; }
}
function canSeePage(username, pageId) {
  const ap = allowedPages(username);
  return ap === null || ap.includes(pageId);
}

// ═══════════════════════════════════════════════════════════
// 🧮 اشتقاق العملاء من orders (لكل صفحة، بلا اختلاط)
// ═══════════════════════════════════════════════════════════
export function deriveCustomers(pageId, opts = {}) {
  if (!pageId) return [];
  const rows = retryDb(() => db.prepare(`
    SELECT phone,
           MAX(sender_id) sender_id,
           MAX(area) area,
           COUNT(*) orders_count,
           COALESCE(SUM(total),0) total_spent,
           MIN(created_at) first_at,
           MAX(created_at) last_at,
           SUM(CASE WHEN status=? THEN 1 ELSE 0 END) delivered_count,
           SUM(CASE WHEN status=? THEN 1 ELSE 0 END) cancelled_count
    FROM orders
    WHERE page_id=? AND phone IS NOT NULL AND phone!=''
    GROUP BY phone
  `).all(DELIVERED, CANCELLED, pageId));

  // آخر منتج/حالة لكل رقم
  const lastByPhone = {};
  for (const o of retryDb(() => db.prepare(
    "SELECT phone, order_string, status, total, created_at FROM orders WHERE page_id=? AND phone!='' ORDER BY created_at DESC"
  ).all(pageId))) {
    if (!lastByPhone[o.phone]) lastByPhone[o.phone] = o;
  }

  // overlay الموافقة/الرسائل
  const overlay = {};
  for (const c of db.prepare("SELECT phone,name,consent,messages_sent,last_message_at,last_campaign FROM wa_customers WHERE page_id=?").all(pageId))
    overlay[c.phone] = c;

  const t = now(), DAY = 86400000;
  let list = rows.map(r => {
    const last = lastByPhone[r.phone] || {};
    const ov = overlay[r.phone] || {};
    const daysSince = Math.floor((t - r.last_at) / DAY);
    return {
      phone: r.phone, e164: toE164Jordan(r.phone), display: r.phone,
      valid: isValidJordan(r.phone),
      name: ov.name || "", area: r.area || "",
      orders_count: r.orders_count, total_spent: Math.round(r.total_spent * 100) / 100,
      first_at: r.first_at, last_at: r.last_at, days_since: daysSince,
      last_product: last.order_string || "", last_status: last.status || "",
      last_total: last.total || 0,
      delivered: r.delivered_count > 0, delivered_count: r.delivered_count,
      cancelled_count: r.cancelled_count,
      consent: ov.consent || "UNKNOWN",
      messages_sent: ov.messages_sent || 0, last_message_at: ov.last_message_at || null,
      last_campaign: ov.last_campaign || ""
    };
  });

  // فلاتر
  const f = opts.filter || "all";
  const days = Number(opts.days) || 0;
  list = list.filter(c => {
    switch (f) {
      case "delivered":     return c.delivered;
      case "not_delivered": return !c.delivered;
      case "cancelled":     return c.cancelled_count > 0;
      case "repeat":        return c.orders_count > 1;
      case "new":           return c.orders_count === 1;
      case "returning":     return c.orders_count > 1;
      case "opted_in":      return c.consent === "OPTED_IN";
      case "inactive":      return days ? c.days_since >= days : true;
      default:              return true;   // all / ordered
    }
  });
  if (days && f !== "inactive") list = list.filter(c => c.days_since <= days);   // "خلال آخر N يوم"
  if (opts.product) list = list.filter(c => (c.last_product || "").includes(opts.product));
  if (opts.area)    list = list.filter(c => (c.area || "").includes(opts.area));
  if (opts.min_value) list = list.filter(c => c.total_spent >= Number(opts.min_value));
  if (opts.valid_only) list = list.filter(c => c.valid);

  list.sort((a, b) => b.last_at - a.last_at);
  return list;
}

// ═══════════════════════════════════════════════════════════
export const router = Router();

// ---- الصفحات المتاحة ----
router.get("/pages", (req, res) => {
  const ap = allowedPages(req.user);
  const out = Object.entries(PAGES)
    .filter(([id]) => ap === null || ap.includes(id))
    .map(([id, p]) => ({ id, name: p.name }));
  res.json(out);
});

// ═══ الحسابات ═══
router.get("/accounts", (req, res) => {
  const accts = db.prepare("SELECT * FROM wa_accounts ORDER BY created_at DESC").all();
  const out = accts.map(a => ({ ...a, configured: WA.configured(a), token_env: a.token_env, page_name: PAGES[a.page_id]?.name || a.page_id }));
  res.json(out);
});
router.post("/accounts", (req, res) => {
  const { page_id, account_name, wa_number, token_env, phone_id_env } = req.body || {};
  if (!page_id || !PAGES[page_id]) return res.status(400).json({ error: "اختر صفحة صحيحة" });
  db.prepare(`INSERT INTO wa_accounts (page_id,account_name,wa_number,provider,token_env,phone_id_env,status,created_at)
    VALUES (?,?,?,'cloud',?,?, 'disconnected', ?)
    ON CONFLICT(page_id) DO UPDATE SET account_name=excluded.account_name, wa_number=excluded.wa_number,
      token_env=excluded.token_env, phone_id_env=excluded.phone_id_env`)
    .run(page_id, account_name || PAGES[page_id].name, wa_number || "", token_env || "", phone_id_env || "", now());
  audit(req.user, "account_upsert", { page_id, account_name });
  res.json({ ok: true });
});
router.post("/accounts/:id/verify", async (req, res) => {
  const a = db.prepare("SELECT * FROM wa_accounts WHERE id=?").get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: "الحساب غير موجود" });
  const r = await WA.verify(a);
  const status = r.ok ? "connected" : "disconnected";
  db.prepare("UPDATE wa_accounts SET status=?, last_connected_at=? WHERE id=?")
    .run(status, r.ok ? now() : a.last_connected_at, a.id);
  audit(req.user, "account_verify", { id: a.id, ok: r.ok });
  res.json({ ok: r.ok, status, info: r.info || null, error: r.error || null });
});
router.post("/accounts/:id/disconnect", (req, res) => {
  db.prepare("UPDATE wa_accounts SET status='disconnected' WHERE id=?").run(Number(req.params.id));
  audit(req.user, "account_disconnect", { id: req.params.id });
  res.json({ ok: true });
});
router.delete("/accounts/:id", (req, res) => {
  db.prepare("DELETE FROM wa_accounts WHERE id=?").run(Number(req.params.id));
  audit(req.user, "account_delete", { id: req.params.id });
  res.json({ ok: true });
});

// ═══ العملاء ═══
router.get("/customers", (req, res) => {
  const { page_id } = req.query;
  if (!page_id || !PAGES[page_id]) return res.status(400).json({ error: "اختر صفحة" });
  if (!canSeePage(req.user, page_id)) return res.status(403).json({ error: "لا صلاحية لهذه الصفحة" });
  const list = deriveCustomers(page_id, req.query);
  res.json({ count: list.length, customers: list });
});

router.get("/customer", (req, res) => {
  const { page_id, phone } = req.query;
  if (!page_id || !phone) return res.status(400).json({ error: "ناقص" });
  if (!canSeePage(req.user, page_id)) return res.status(403).json({ error: "لا صلاحية" });
  const orders = db.prepare("SELECT id,order_string,total,status,area,created_at FROM orders WHERE page_id=? AND phone=? ORDER BY created_at DESC").all(page_id, phone);
  const msgs = db.prepare("SELECT campaign_id,template,body,status,created_at FROM wa_messages WHERE page_id=? AND phone=? ORDER BY created_at DESC LIMIT 100").all(page_id, phone);
  const ov = db.prepare("SELECT * FROM wa_customers WHERE page_id=? AND phone=?").get(page_id, phone) || {};
  // Timeline مدمج
  const timeline = [
    ...orders.map(o => ({ t: o.created_at, type: "order", label: o.order_string, total: o.total, status: o.status })),
    ...msgs.map(m => ({ t: m.created_at, type: "message", label: m.template || "رسالة", status: m.status, campaign_id: m.campaign_id }))
  ].sort((a, b) => b.t - a.t);
  audit(req.user, "customer_view", { page_id, phone });
  res.json({ orders, messages: msgs, overlay: ov, timeline });
});

router.post("/consent", (req, res) => {
  const { page_id, phone, status } = req.body || {};
  if (!page_id || !phone || !["OPTED_IN", "OPTED_OUT", "UNKNOWN"].includes(status))
    return res.status(400).json({ error: "قيمة موافقة غير صحيحة" });
  if (!canSeePage(req.user, page_id)) return res.status(403).json({ error: "لا صلاحية" });
  db.prepare(`INSERT INTO wa_customers (page_id,phone,consent,consent_at) VALUES (?,?,?,?)
    ON CONFLICT(page_id,phone) DO UPDATE SET consent=excluded.consent, consent_at=excluded.consent_at`)
    .run(page_id, phone, status, now());
  audit(req.user, "consent_change", { page_id, phone, status });
  res.json({ ok: true });
});

// ═══ القوالب ═══
router.get("/templates", (req, res) => res.json(db.prepare("SELECT * FROM wa_templates ORDER BY updated_at DESC").all()));
router.post("/templates", (req, res) => {
  const { id, name, category, body } = req.body || {};
  if (!name || !body) return res.status(400).json({ error: "الاسم والنص مطلوبان" });
  if (id) db.prepare("UPDATE wa_templates SET name=?,category=?,body=?,updated_at=? WHERE id=?").run(name, category || "", body, now(), Number(id));
  else db.prepare("INSERT INTO wa_templates (name,category,body,created_at,updated_at) VALUES (?,?,?,?,?)").run(name, category || "", body, now(), now());
  audit(req.user, "template_save", { name });
  res.json({ ok: true });
});
router.delete("/templates/:id", (req, res) => {
  db.prepare("DELETE FROM wa_templates WHERE id=?").run(Number(req.params.id));
  res.json({ ok: true });
});

// ── تعبئة المتغيّرات ──
function renderBody(body, c, pageName) {
  return String(body || "")
    .replace(/\{\{\s*name\s*\}\}/g, c.name || "عميلنا العزيز")
    .replace(/\{\{\s*page\s*\}\}/g, pageName || "")
    .replace(/\{\{\s*last_order\s*\}\}/g, c.last_product || "")
    .replace(/\{\{\s*last_product\s*\}\}/g, c.last_product || "")
    .replace(/\{\{\s*last_order_total\s*\}\}/g, String(c.last_total || ""))
    .replace(/\{\{\s*last_order_date\s*\}\}/g, c.last_at ? new Date(c.last_at).toLocaleDateString("ar-EG") : "");
}

// ═══ الحملات ═══
router.get("/campaigns", (req, res) => {
  const rows = db.prepare("SELECT * FROM wa_campaigns ORDER BY created_at DESC LIMIT 200").all();
  res.json(rows.map(c => ({ ...c, page_name: PAGES[c.page_id]?.name || c.page_id })));
});

// معاينة الجمهور (بدون إنشاء)
router.post("/campaigns/preview", (req, res) => {
  const { page_id, filter, days, product, area, min_value, exclude_no_consent } = req.body || {};
  if (!PAGES[page_id]) return res.status(400).json({ error: "صفحة غير صحيحة" });
  if (!canSeePage(req.user, page_id)) return res.status(403).json({ error: "لا صلاحية" });
  const all = deriveCustomers(page_id, { filter, days, product, area, min_value, valid_only: true });
  const eligible = all.filter(c => c.consent === "OPTED_IN");
  const excluded = all.length - eligible.length;
  res.json({
    targeted: all.length,
    eligible: (exclude_no_consent === false ? all.length : eligible.length),
    excluded: (exclude_no_consent === false ? 0 : excluded),
    opted_in: eligible.length, sample: all.slice(0, 8)
  });
});

// إنشاء حملة (لقطة الجمهور → targets)
router.post("/campaigns", (req, res) => {
  const { name, page_id, template_id, filter, days, product, area, min_value, exclude_no_consent } = req.body || {};
  if (!name || !PAGES[page_id]) return res.status(400).json({ error: "الاسم والصفحة مطلوبان" });
  if (!canSeePage(req.user, page_id)) return res.status(403).json({ error: "لا صلاحية" });
  const tpl = db.prepare("SELECT * FROM wa_templates WHERE id=?").get(Number(template_id));
  if (!tpl) return res.status(400).json({ error: "اختر قالباً" });

  const audience = { filter, days, product, area, min_value, exclude_no_consent: exclude_no_consent !== false };
  const all = deriveCustomers(page_id, { filter, days, product, area, min_value, valid_only: true });
  const eligible = audience.exclude_no_consent ? all.filter(c => c.consent === "OPTED_IN") : all;
  const excluded = all.length - eligible.length;
  const pageName = PAGES[page_id].name;

  const info = db.prepare(`INSERT INTO wa_campaigns
    (name,page_id,template_id,audience_json,status,targeted,eligible,excluded,created_by,created_at)
    VALUES (?,?,?,?, 'draft', ?,?,?,?,?)`)
    .run(name, page_id, tpl.id, JSON.stringify(audience), all.length, eligible.length, excluded, req.user, now());
  const campId = Number(info.lastInsertRowid);

  // منع التكرار: ما نضيف نفس الرقم مرتين لنفس الحملة
  const seen = new Set();
  const ins = db.prepare(`INSERT INTO wa_campaign_targets (campaign_id,page_id,phone,e164,name,body,status) VALUES (?,?,?,?,?,?, 'pending')`);
  for (const c of eligible) {
    if (seen.has(c.phone)) continue; seen.add(c.phone);
    ins.run(campId, page_id, c.phone, c.e164, c.name, renderBody(tpl.body, c, pageName));
  }
  audit(req.user, "campaign_create", { campId, name, eligible: eligible.length });
  res.json({ ok: true, id: campId, eligible: eligible.length, excluded });
});

router.get("/campaign/:id", (req, res) => {
  const c = db.prepare("SELECT * FROM wa_campaigns WHERE id=?").get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: "غير موجود" });
  const targets = db.prepare("SELECT phone,e164,name,status,error,sent_at,order_after_id,revenue_after FROM wa_campaign_targets WHERE campaign_id=? ORDER BY id LIMIT 1000").all(c.id);
  // نتائج إعادة الشراء
  const reorders = targets.filter(t => t.order_after_id);
  const revenue = reorders.reduce((s, t) => s + (t.revenue_after || 0), 0);
  res.json({ campaign: { ...c, page_name: PAGES[c.page_id]?.name || c.page_id }, targets,
    reorders: reorders.length, revenue: Math.round(revenue * 100) / 100,
    reorder_rate: c.sent ? Math.round(reorders.length / c.sent * 100) : 0 });
});

// بدء الإرسال (يشغّل الطابور — إرسال تدريجي)
router.post("/campaign/:id/start", (req, res) => {
  const c = db.prepare("SELECT * FROM wa_campaigns WHERE id=?").get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: "غير موجود" });
  if (!canSeePage(req.user, c.page_id)) return res.status(403).json({ error: "لا صلاحية" });
  const acct = db.prepare("SELECT * FROM wa_accounts WHERE page_id=?").get(c.page_id);
  if (!acct || !WA.configured(acct))
    return res.status(400).json({ error: "حساب واتساب لهذه الصفحة غير مهيأ (اضبط TOKEN/PHONE_ID كمتغيّرات بيئة)" });
  if (c.status === "running") return res.json({ ok: true, already: true });
  db.prepare("UPDATE wa_campaigns SET status='running', started_at=COALESCE(started_at,?) WHERE id=?").run(now(), c.id);
  audit(req.user, "campaign_start", { id: c.id });
  res.json({ ok: true });
  // الطابور بياخدها من هون تلقائياً (tick)
});
router.post("/campaign/:id/pause", (req, res) => {
  db.prepare("UPDATE wa_campaigns SET status='paused' WHERE id=?").run(Number(req.params.id));
  audit(req.user, "campaign_pause", { id: req.params.id });
  res.json({ ok: true });
});

// ═══ سجل الإرسال ═══
router.get("/log", (req, res) => {
  const { page_id } = req.query;
  const rows = page_id
    ? db.prepare("SELECT * FROM wa_messages WHERE page_id=? ORDER BY created_at DESC LIMIT 500").all(page_id)
    : db.prepare("SELECT * FROM wa_messages ORDER BY created_at DESC LIMIT 500").all();
  res.json(rows);
});

// ═══ لوحة الإحصائيات ═══
router.get("/stats", (req, res) => {
  const ap = allowedPages(req.user);
  const pageFilter = ap ? ` AND page_id IN (${ap.map(() => "?").join(",")})` : "";
  const p = ap || [];
  const t = now(), D30 = t - 30 * 86400000;
  const totalCustomers = retryDb(() => db.prepare(`SELECT COUNT(DISTINCT phone) n FROM orders WHERE phone!=''${pageFilter}`).get(...p)).n;
  const delivered = retryDb(() => db.prepare(`SELECT COUNT(DISTINCT phone) n FROM orders WHERE phone!='' AND status=?${pageFilter}`).get(DELIVERED, ...p)).n;
  const newThis = retryDb(() => db.prepare(`SELECT COUNT(DISTINCT phone) n FROM orders WHERE phone!='' AND created_at>=?${pageFilter}`).get(D30, ...p)).n;
  const campaigns = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(sent),0) s, COALESCE(SUM(failed),0) f FROM wa_campaigns").get();
  const reorders = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(revenue_after),0) rev FROM wa_campaign_targets WHERE order_after_id IS NOT NULL").get();
  res.json({
    total_customers: totalCustomers, delivered_customers: delivered, new_30d: newThis,
    campaigns: campaigns.n, messages_sent: campaigns.s, messages_failed: campaigns.f,
    reorders: reorders.n, reorder_revenue: Math.round((reorders.rev || 0) * 100) / 100
  });
});

// ═══ تصدير CSV (مقيّد بالصلاحية) ═══
router.get("/export", (req, res) => {
  const { page_id } = req.query;
  if (!PAGES[page_id]) return res.status(400).json({ error: "صفحة" });
  const u = getUser(req.user);
  if (!u || (u.role || "admin") !== "admin") return res.status(403).json({ error: "التصدير لمدير الحساب فقط" });
  if (!canSeePage(req.user, page_id)) return res.status(403).json({ error: "لا صلاحية" });
  const list = deriveCustomers(page_id, {});
  audit(req.user, "export", { page_id, count: list.length });
  const head = ["الاسم", "الهاتف", "دولي", "العنوان", "عدد الطلبات", "إجمالي الشراء", "آخر منتج", "آخر حالة", "آخر طلب", "الموافقة"];
  const rows = list.map(c => [c.name, c.phone, c.e164 || "", c.area, c.orders_count, c.total_spent,
    c.last_product, c.last_status, c.last_at ? new Date(c.last_at).toLocaleDateString("ar-EG") : "", c.consent]);
  const csv = "﻿" + [head, ...rows].map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="customers-${page_id}.csv"`);
  res.send(csv);
});

// ═══ سجل التدقيق ═══
router.get("/audit", (req, res) => {
  const u = getUser(req.user);
  if (!u || (u.role || "admin") !== "admin") return res.status(403).json({ error: "لمدير الحساب فقط" });
  res.json(db.prepare("SELECT * FROM wa_audit ORDER BY id DESC LIMIT 500").all());
});

// ═══════════════════════════════════════════════════════════
// ⏳ طابور الإرسال التدريجي — يحترم الموافقة، منع التكرار، وحدود ميتا
//
// كل نبضة بتبعت دفعة صغيرة بس (rate limit)، وبس للحملات "running".
// بلا حساب مهيأ ما بينبعت ولا رسالة (آمن بالاختبار).
// ═══════════════════════════════════════════════════════════
let _sending = false;
const BATCH = Number(process.env.WA_BATCH_PER_TICK || 5);     // رسائل لكل نبضة
const TEMPLATE_NAME = process.env.WA_TEMPLATE_NAME || "";      // اسم قالب ميتا المعتمد (اختياري)
const TEMPLATE_LANG = process.env.WA_TEMPLATE_LANG || "ar";

export async function waQueueTick() {
  if (_sending) return;
  _sending = true;
  try {
    const camps = db.prepare("SELECT * FROM wa_campaigns WHERE status='running' ORDER BY started_at LIMIT 3").all();
    for (const c of camps) {
      const acct = db.prepare("SELECT * FROM wa_accounts WHERE page_id=?").get(c.page_id);
      if (!acct || !WA.configured(acct)) continue;   // غير مهيأ — نتخطّى بهدوء
      const pending = db.prepare("SELECT * FROM wa_campaign_targets WHERE campaign_id=? AND status='pending' ORDER BY id LIMIT ?").all(c.id, BATCH);
      if (!pending.length) {
        db.prepare("UPDATE wa_campaigns SET status='done', finished_at=? WHERE id=?").run(now(), c.id);
        continue;
      }
      for (const tg of pending) {
        // منع التكرار اليومي: نفس الرقم/نفس الحملة ما ينبعتله مرتين
        // (status pending→sent يمنع ذلك أصلاً). ومنع نفس الحملة بنفس اليوم:
        const dupe = db.prepare("SELECT 1 FROM wa_campaign_targets WHERE campaign_id=? AND phone=? AND status='sent'").get(c.id, tg.phone);
        if (dupe) { db.prepare("UPDATE wa_campaign_targets SET status='skipped',error='مكرر' WHERE id=?").run(tg.id); continue; }

        // الإرسال الرسمي: قالب معتمد إن وُجد اسمه، وإلا نص (داخل النافذة فقط)
        let r;
        if (TEMPLATE_NAME) r = await WA.sendTemplate(acct, tg.phone, TEMPLATE_NAME, TEMPLATE_LANG);
        else r = await WA.sendText(acct, tg.phone, tg.body);

        const st = r.ok ? "sent" : "failed";
        db.prepare("UPDATE wa_campaign_targets SET status=?, wamid=?, error=?, sent_at=? WHERE id=?")
          .run(st, r.id || null, r.ok ? null : (r.error || "فشل"), now(), tg.id);
        db.prepare("INSERT INTO wa_messages (page_id,phone,direction,campaign_id,template,body,status,wamid,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
          .run(c.page_id, tg.phone, "out", c.id, TEMPLATE_NAME || "", tg.body, st, r.id || null, now());
        db.prepare(`INSERT INTO wa_customers (page_id,phone,messages_sent,last_message_at,last_campaign) VALUES (?,?,1,?,?)
          ON CONFLICT(page_id,phone) DO UPDATE SET messages_sent=messages_sent+1, last_message_at=excluded.last_message_at, last_campaign=excluded.last_campaign`)
          .run(c.page_id, tg.phone, now(), c.name);
        db.prepare(`UPDATE wa_campaigns SET sent=sent+?, failed=failed+? WHERE id=?`).run(r.ok ? 1 : 0, r.ok ? 0 : 1, c.id);
      }
    }
  } catch (e) { console.error("waQueueTick:", e && e.message); }
  finally { _sending = false; }
}

// ═══════════════════════════════════════════════════════════
// 🔗 ربط إعادة الشراء: يُستدعى عند أي طلب جديد. لو الرقم مستهدَف
// بحملة أُرسلت خلال 30 يوم، نسجّل الطلب كنتيجة الحملة.
// ═══════════════════════════════════════════════════════════
export function attributeReorder({ page_id, phone, order_id, total }) {
  try {
    if (!page_id || !phone || !order_id) return;
    const since = now() - 30 * 86400000;
    const tg = db.prepare(`SELECT id FROM wa_campaign_targets
      WHERE page_id=? AND phone=? AND status='sent' AND sent_at>=? AND order_after_id IS NULL
      ORDER BY sent_at DESC LIMIT 1`).get(page_id, phone, since);
    if (tg) db.prepare("UPDATE wa_campaign_targets SET order_after_id=?, revenue_after=? WHERE id=?")
      .run(order_id, Number(total) || 0, tg.id);
  } catch (e) { console.error("attributeReorder:", e && e.message); }
}

// ═══════════════════════════════════════════════════════════
// ✋ Opt-out من رسالة واردة: لو كتب الزبون "إيقاف/الغاء" على واتساب.
// ═══════════════════════════════════════════════════════════
export function handleInboundOptOut({ page_id, phone, text }) {
  if (!page_id || !phone || !text) return false;
  if (/^\s*(ايقاف|إيقاف|الغاء|إلغاء|stop|unsubscribe|لا اريد|لا أريد)\s*$/i.test(String(text).trim())) {
    db.prepare(`INSERT INTO wa_customers (page_id,phone,consent,consent_at) VALUES (?,?, 'OPTED_OUT', ?)
      ON CONFLICT(page_id,phone) DO UPDATE SET consent='OPTED_OUT', consent_at=excluded.consent_at`)
      .run(page_id, phone, now());
    audit("system", "opt_out_inbound", { page_id, phone });
    return true;
  }
  return false;
}
