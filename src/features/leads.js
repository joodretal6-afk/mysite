// ═══════════════════════════════════════════════════════════
// 🎯 وحدة الفرص الضائعة والعملاء المحتملين (leads)
// كل رسالة بتيجي = فرصة. هاي الوحدة بتمسك اللي ما صار طلب وبتصنّفه بالسبب.
// 🔴 الإرسال الاستباقي مطفي افتراضياً ولازم تشغيل يدوي صريح.
// 🔴 وحتى لما يشتغل: داخل نافذة 24 ساعة فقط، وتذكير واحد لكل زبون للأبد.
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import { db, retryDb } from "../db/database.js";

export const slug = "leads";
export const title = "الفرص الضائعة";
export const icon = "🎯";

try {
  // العميل المحتمل: حدّد اهتماماً لكنه لم يُكمل الطلب
  db.exec(`CREATE TABLE IF NOT EXISTS leads_prospects (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id    TEXT NOT NULL,
    page_name  TEXT DEFAULT '',
    sender_id  TEXT NOT NULL,
    interest   TEXT DEFAULT '',
    est_value  REAL DEFAULT 0,
    first_at   INTEGER NOT NULL,
    last_at    INTEGER NOT NULL,
    status     TEXT DEFAULT 'open',
    note       TEXT DEFAULT ''
  )`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS leads_prospects_key ON leads_prospects(page_id, sender_id)`);
  // سجل كل محاولة استرجاع — يدوية كانت أو تلقائية
  db.exec(`CREATE TABLE IF NOT EXISTS leads_touches (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id    TEXT NOT NULL,
    sender_id  TEXT NOT NULL,
    kind       TEXT NOT NULL,
    detail     TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS leads_touches_who ON leads_touches(page_id, sender_id)`);
} catch (e) { console.error("leads schema:", e.message); }

const DAY_MS = 86400000;
const WINDOW_MS = 24 * 3600 * 1000;   // نافذة فيسبوك للرد
const CANCEL = "ملغي";

function setting(key, dflt) {
  try {
    const r = retryDb(() => db.prepare("SELECT value FROM settings WHERE key = ?").get("leads_" + key));
    return r && r.value != null ? r.value : dflt;
  } catch { return dflt; }
}
function setSetting(key, value) {
  retryDb(() => db.prepare(
    `INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run("leads_" + key, String(value)));
}

function since(req) {
  let d = Number(req.query.days);
  if (!Number.isFinite(d) || d < 1 || d > 180) d = 30;
  return { days: d, from: Date.now() - d * DAY_MS };
}
function mUrl(sid) { return "https://m.me/" + sid; }

// ── آخر رسالة واردة لكل زبون: أساس حساب نافذة الـ24 ساعة ──
function lastInboundMap(from) {
  const rows = retryDb(() => db.prepare(
    `SELECT page_id, sender_id, MAX(created_at) AS at FROM messages
     WHERE direction = 'in' AND created_at >= ? GROUP BY page_id, sender_id`
  ).all(from));
  const m = new Map();
  for (const r of rows) m.set(r.page_id + "|" + r.sender_id, Number(r.at || 0));
  return m;
}

export const router = Router();

// ═══ 1) قمع التحويل: وين بالضبط بتضيع الرسائل ═══
router.get("/funnel", (req, res) => {
  try {
    const { days, from } = since(req);
    // 🔴 القمع لازم يكون مراحل متداخلة فعلاً (كل مرحلة جزء من اللي قبلها)،
    // وإلا بتطلع نسبة تحويل فوق 100%. فبنحصر كل المراحل بنفس مجموعة المحادثين.
    const CHATTERS = `SELECT DISTINCT page_id, sender_id FROM messages
                      WHERE direction = 'in' AND created_at >= ?`;
    const chats = retryDb(() => db.prepare(
      `SELECT COUNT(*) AS n FROM (${CHATTERS})`
    ).get(from));
    // أبدى اهتماماً = مسجّل كعميل محتمل أو وصل لطلب فعلي (الطلب دليل اهتمام أقوى)
    const interested = retryDb(() => db.prepare(
      `SELECT COUNT(*) AS n FROM (${CHATTERS}) c
       WHERE EXISTS (SELECT 1 FROM leads_prospects p
                      WHERE p.page_id = c.page_id AND p.sender_id = c.sender_id)
          OR EXISTS (SELECT 1 FROM orders o
                      WHERE o.sender_id = c.sender_id AND o.created_at >= ?)`
    ).get(from, from));
    const ordered = retryDb(() => db.prepare(
      `SELECT COUNT(*) AS n FROM (${CHATTERS}) c
       WHERE EXISTS (SELECT 1 FROM orders o
                      WHERE o.sender_id = c.sender_id AND o.created_at >= ? AND o.status <> ?)`
    ).get(from, from, CANCEL));
    // أرقام العمل الإجمالية (مش جزء من القمع) — لتقدير قيمة الفرصة
    const biz = retryDb(() => db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN status <> ? THEN 1 ELSE 0 END),0) AS ok,
              COALESCE(SUM(CASE WHEN status <> ? THEN total ELSE 0 END),0) AS sales
       FROM orders WHERE created_at >= ?`
    ).get(CANCEL, CANCEL, from));

    const nChats = Number((chats && chats.n) || 0);
    const nProsp = Number((interested && interested.n) || 0);
    const nOk = Number((ordered && ordered.n) || 0);
    const sales = Math.round(Number((biz && biz.sales) || 0) * 100) / 100;
    const nBizOrders = Number((biz && biz.ok) || 0);
    const avg = nBizOrders ? Math.round((sales / nBizOrders) * 100) / 100 : 0;

    const stages = [
      { key: "محادثات وصلتنا", n: nChats },
      { key: "أبدوا اهتماماً بصنف", n: nProsp },
      { key: "صاروا طلبات", n: nOk }
    ];
    const lostAtInterest = Math.max(0, nChats - nProsp);
    const lostAtClose = Math.max(0, nProsp - nOk);
    res.json({
      days, stages, sales, avgOrder: avg,
      convRate: nChats ? Math.round((nOk / nChats) * 1000) / 10 : 0,
      lostAtInterest, lostAtClose,
      // القيمة المقدّرة للفرص الضائعة = عدد اللي اهتموا وما طلبوا × متوسط الطلب
      estLostValue: Math.round(lostAtClose * avg * 100) / 100
    });
  } catch (e) {
    console.error("leads/funnel:", e.message);
    res.status(500).json({ error: "فشل حساب قمع التحويل" });
  }
});

// ═══ 2) الفرص الضائعة مصنّفة بالسبب ═══
router.get("/lost", (req, res) => {
  try {
    const { days, from } = since(req);
    const now = Date.now();
    const inbound = lastInboundMap(from);
    const buckets = [];

    // أ) محادثات آخر رسالة فيها من الزبون ولا أحد ردّ
    const noReply = retryDb(() => db.prepare(
      `SELECT m.page_id, m.page_name, m.sender_id, MAX(m.created_at) AS last_at,
              (SELECT direction FROM messages m2
                WHERE m2.page_id = m.page_id AND m2.sender_id = m.sender_id
                ORDER BY m2.created_at DESC LIMIT 1) AS last_dir
       FROM messages m WHERE m.created_at >= ?
       GROUP BY m.page_id, m.sender_id HAVING last_dir = 'in'
       ORDER BY last_at DESC LIMIT 100`
    ).all(from));
    buckets.push({
      key: "no_reply", title: "محادثات بلا ردّ", level: "high",
      why: "آخر رسالة من الزبون وما حدا ردّ — أسرع فرصة ترجّعها.",
      items: noReply.map(r => ({
        page_id: r.page_id, page: r.page_name || "", sender_id: r.sender_id, at: Number(r.last_at || 0),
        label: "آخر رسالة من الزبون", url: mUrl(r.sender_id)
      }))
    });

    // ب) أبدى اهتماماً بصنف وما كمّل الطلب
    const prospects = retryDb(() => db.prepare(
      `SELECT page_id, page_name, sender_id, interest, est_value, last_at
       FROM leads_prospects WHERE status = 'open' AND last_at >= ?
       ORDER BY last_at DESC LIMIT 100`
    ).all(from));
    buckets.push({
      key: "no_close", title: "حدّد صنف وما كمّل", level: "high",
      why: "عرف شو بده بالضبط بس ما أعطى رقم ولا عنوان — أقرب واحد للشراء.",
      items: prospects.map(p => ({
        page_id: p.page_id, page: p.page_name || "", sender_id: p.sender_id, at: Number(p.last_at || 0),
        label: p.interest || "اهتمام غير محدّد", value: Number(p.est_value || 0), url: mUrl(p.sender_id)
      }))
    });

    // ج) طلب ناقص أو بلا رقم هاتف
    const incomplete = retryDb(() => db.prepare(
      `SELECT id, page_id, page_name, sender_id, order_string, total, area, phone, status, created_at
       FROM orders
       WHERE created_at >= ? AND status <> ?
         AND (status = 'ناقص' OR phone IS NULL OR TRIM(phone) = '')
       ORDER BY created_at DESC LIMIT 100`
    ).all(from, CANCEL));
    buckets.push({
      key: "incomplete", title: "طلبات ناقصة معلومات", level: "high",
      why: "الطلب محجوز بالنظام بس ناقصه رقم أو عنوان — ما بتقدر توصله.",
      items: incomplete.map(o => ({
        page_id: o.page_id, page: o.page_name || "", sender_id: o.sender_id, at: Number(o.created_at || 0),
        label: "#" + o.id + " " + (o.order_string || "") + (o.phone ? "" : " — بلا رقم") + (o.area ? "" : " — بلا عنوان"),
        value: Number(o.total || 0), url: mUrl(o.sender_id)
      }))
    });

    // د) طلبات ملغاة
    const cancelled = retryDb(() => db.prepare(
      `SELECT id, page_id, page_name, sender_id, order_string, total, created_at FROM orders
       WHERE created_at >= ? AND status = ? ORDER BY created_at DESC LIMIT 50`
    ).all(from, CANCEL));
    buckets.push({
      key: "cancelled", title: "طلبات ملغاة", level: "mid",
      why: "انلغى — يستاهل تعرف السبب قبل ما يتكرر.",
      items: cancelled.map(o => ({
        page_id: o.page_id, page: o.page_name || "", sender_id: o.sender_id, at: Number(o.created_at || 0),
        label: "#" + o.id + " " + (o.order_string || ""), value: Number(o.total || 0), url: mUrl(o.sender_id)
      }))
    });

    // وسم كل عنصر: هل لسا داخل نافذة 24 ساعة؟ وهل تواصلنا معه؟
    const touched = new Set(
      retryDb(() => db.prepare("SELECT page_id, sender_id FROM leads_touches").all())
        .map(t => t.page_id + "|" + t.sender_id)
    );
    let contactable = 0, totalItems = 0;
    for (const b of buckets) {
      for (const it of b.items) {
        // 🔴 الأمان أولاً: النافذة من آخر رسالة واردة فعلية فقط.
        // إذا ما عرفناها، نعتبره خارج النافذة — أحسن ما نوريه وقت وهمي فيبعث ويتحظر.
        const lastIn = inbound.get(it.page_id + "|" + it.sender_id) || 0;
        it.inWindow = lastIn > 0 && (now - lastIn) < WINDOW_MS;
        it.hoursLeft = it.inWindow ? Math.max(0, Math.round(((WINDOW_MS - (now - lastIn)) / 3600000) * 10) / 10) : 0;
        it.touched = touched.has(it.page_id + "|" + it.sender_id);
        if (it.inWindow) contactable++;
        totalItems++;
      }
    }
    res.json({ days, buckets, totalItems, contactable });
  } catch (e) {
    console.error("leads/lost:", e.message);
    res.status(500).json({ error: "فشل جلب الفرص الضائعة" });
  }
});

// ═══ 3) القابلون للتواصل الآن (داخل نافذة 24 ساعة) ═══
router.get("/window", (req, res) => {
  try {
    const now = Date.now();
    const from = now - 2 * DAY_MS;
    const rows = retryDb(() => db.prepare(
      `SELECT p.page_id, p.page_name, p.sender_id, p.interest, p.est_value,
              (SELECT MAX(created_at) FROM messages m
                WHERE m.page_id = p.page_id AND m.sender_id = p.sender_id AND m.direction = 'in') AS last_in
       FROM leads_prospects p WHERE p.status = 'open' AND p.last_at >= ?
       ORDER BY last_in DESC LIMIT 100`
    ).all(from));
    const touched = new Set(
      retryDb(() => db.prepare("SELECT page_id, sender_id FROM leads_touches").all())
        .map(t => t.page_id + "|" + t.sender_id)
    );
    const list = rows
      .map(r => {
        const li = Number(r.last_in || 0);
        const left = WINDOW_MS - (now - li);
        return {
          page_id: r.page_id, page: r.page_name || "", sender_id: r.sender_id,
          interest: r.interest || "", value: Number(r.est_value || 0),
          lastIn: li, hoursLeft: Math.round((left / 3600000) * 10) / 10,
          touched: touched.has(r.page_id + "|" + r.sender_id),
          url: mUrl(r.sender_id)
        };
      })
      .filter(x => x.lastIn > 0 && x.hoursLeft > 0)
      .sort((a, b) => a.hoursLeft - b.hoursLeft);
    res.json({ count: list.length, list, note: "مرتّبين حسب الأقرب لانتهاء النافذة — هدول أولوية." });
  } catch (e) {
    console.error("leads/window:", e.message);
    res.status(500).json({ error: "فشل جلب نافذة التواصل" });
  }
});

// ═══ 4) أسباب الضياع — تحليل مجمّع ═══
router.get("/reasons", (req, res) => {
  try {
    const { days, from } = since(req);
    const rows = [];
    const q = (sql, ...a) => Number((retryDb(() => db.prepare(sql).get(...a)) || {}).n || 0);

    rows.push({ reason: "ما حدا ردّ عليه", n: q(
      `SELECT COUNT(*) AS n FROM (SELECT m.page_id, m.sender_id,
        (SELECT direction FROM messages m2 WHERE m2.page_id=m.page_id AND m2.sender_id=m.sender_id
          ORDER BY m2.created_at DESC LIMIT 1) AS d
        FROM messages m WHERE m.created_at >= ? GROUP BY m.page_id, m.sender_id HAVING d='in')`, from) });
    rows.push({ reason: "حدّد صنف وما أعطى رقم", n: q(
      "SELECT COUNT(*) AS n FROM leads_prospects WHERE status='open' AND last_at >= ?", from) });
    rows.push({ reason: "طلب بلا رقم هاتف", n: q(
      `SELECT COUNT(*) AS n FROM orders WHERE created_at >= ? AND status <> ?
        AND (phone IS NULL OR TRIM(phone)='')`, from, CANCEL) });
    rows.push({ reason: "طلب بلا عنوان", n: q(
      `SELECT COUNT(*) AS n FROM orders WHERE created_at >= ? AND status <> ?
        AND (area IS NULL OR TRIM(area)='')`, from, CANCEL) });
    rows.push({ reason: "انلغى", n: q(
      "SELECT COUNT(*) AS n FROM orders WHERE created_at >= ? AND status = ?", from, CANCEL) });

    const total = rows.reduce((a, r) => a + r.n, 0);
    res.json({
      days, total,
      reasons: rows.filter(r => r.n > 0)
        .map(r => ({ ...r, pct: total ? Math.round((r.n / total) * 1000) / 10 : 0 }))
        .sort((a, b) => b.n - a.n)
    });
  } catch (e) {
    console.error("leads/reasons:", e.message);
    res.status(500).json({ error: "فشل تحليل الأسباب" });
  }
});

// ═══ 5) تسجيل تواصل يدوي (بعد ما تفتح المحادثة وترد بنفسك) ═══
router.post("/touch", (req, res) => {
  try {
    const b = req.body || {};
    const page_id = String(b.page_id || "").trim();
    const sender_id = String(b.sender_id || "").trim();
    if (!sender_id) return res.status(400).json({ error: "ناقص معرّف الزبون" });
    const kind = String(b.kind || "manual").slice(0, 30);
    retryDb(() => db.prepare(
      "INSERT INTO leads_touches (page_id, sender_id, kind, detail, created_at) VALUES (?,?,?,?,?)"
    ).run(page_id, sender_id, kind, String(b.detail || "").slice(0, 300), Date.now()));
    res.json({ ok: true });
  } catch (e) {
    console.error("leads/touch:", e.message);
    res.status(500).json({ error: "فشل تسجيل التواصل" });
  }
});

// ═══ 6) تغيير حالة عميل محتمل ═══
router.post("/prospect/status", (req, res) => {
  try {
    const b = req.body || {};
    const ok = ["open", "converted", "lost"];
    const status = ok.includes(b.status) ? b.status : null;
    if (!status) return res.status(400).json({ error: "حالة غير صالحة" });
    const sender_id = String(b.sender_id || "").trim();
    if (!sender_id) return res.status(400).json({ error: "ناقص معرّف الزبون" });
    const r = retryDb(() => db.prepare(
      "UPDATE leads_prospects SET status = ?, note = ? WHERE sender_id = ? AND page_id = ?"
    ).run(status, String(b.note || "").slice(0, 300), sender_id, String(b.page_id || "")));
    res.json({ ok: true, changed: r.changes });
  } catch (e) {
    console.error("leads/prospect/status:", e.message);
    res.status(500).json({ error: "فشل تحديث الحالة" });
  }
});

// ═══ 7) أثر الاسترجاع: هل التواصل بيرجّع فعلاً؟ ═══
router.get("/impact", (req, res) => {
  try {
    const { days, from } = since(req);
    const touches = retryDb(() => db.prepare(
      "SELECT page_id, sender_id, MIN(created_at) AS at FROM leads_touches WHERE created_at >= ? GROUP BY page_id, sender_id"
    ).all(from));
    let recovered = 0, value = 0;
    for (const t of touches) {
      const o = retryDb(() => db.prepare(
        `SELECT COALESCE(SUM(total),0) AS v, COUNT(*) AS n FROM orders
         WHERE sender_id = ? AND status <> ? AND created_at >= ?`
      ).get(t.sender_id, CANCEL, Number(t.at || 0)));
      if (Number((o && o.n) || 0) > 0) { recovered++; value += Number((o && o.v) || 0); }
    }
    res.json({
      days, touched: touches.length, recovered,
      rate: touches.length ? Math.round((recovered / touches.length) * 1000) / 10 : 0,
      value: Math.round(value * 100) / 100
    });
  } catch (e) {
    console.error("leads/impact:", e.message);
    res.status(500).json({ error: "فشل حساب الأثر" });
  }
});

// ═══ 8) إعدادات التذكير التلقائي — مطفي افتراضياً ═══
router.get("/settings", (_req, res) => {
  try {
    res.json({
      autoReminder: setting("auto_reminder", "0") === "1",
      delayMinutes: Number(setting("delay_minutes", "90")),
      template: setting("template", "أهلاً فيك 🌹 ضل طلبك مفتوح — بتحب أكمّلهولك؟"),
      note: "الإرسال داخل نافذة 24 ساعة فقط، وتذكير واحد لكل زبون للأبد. مطفي حتى تشغّله بنفسك."
    });
  } catch (e) {
    console.error("leads/settings:", e.message);
    res.status(500).json({ error: "فشل جلب الإعدادات" });
  }
});

router.post("/settings", (req, res) => {
  try {
    const b = req.body || {};
    if (b.autoReminder !== undefined) setSetting("auto_reminder", b.autoReminder ? "1" : "0");
    if (b.delayMinutes !== undefined) {
      const d = Number(b.delayMinutes);
      if (!Number.isFinite(d) || d < 15 || d > 1200) return res.status(400).json({ error: "التأخير من 15 دقيقة إلى 20 ساعة" });
      setSetting("delay_minutes", Math.round(d));
    }
    if (b.template !== undefined) {
      const t = String(b.template).trim();
      if (t.length < 5 || t.length > 300) return res.status(400).json({ error: "نص التذكير من 5 إلى 300 حرف" });
      setSetting("template", t);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("leads/settings POST:", e.message);
    res.status(500).json({ error: "فشل حفظ الإعدادات" });
  }
});
