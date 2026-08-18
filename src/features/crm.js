// ═══════════════════════════════════════════════════════════
// 👑 وحدة إدارة الزبائن CRM — الزبون معرّف برقم الهاتف
// 10 ميزات: ملف 360، وسوم، ملاحظات، نقاط ولاء، أفضل الزبائن،
// معرّضون للفقدان، زبائن خطرون، دفتر عناوين، CLV، تصدير CSV
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import { db, retryDb } from "../db/database.js";

export const slug = "crm";
export const title = "إدارة الزبائن CRM";
export const icon = "👑";

// ── جداول الوحدة (crm_ فقط) ──
try {
  db.exec(`CREATE TABLE IF NOT EXISTS crm_tags (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    phone      TEXT NOT NULL,
    tag        TEXT NOT NULL,
    created_at INTEGER,
    UNIQUE(phone, tag)
  )`);
} catch (e) { console.error(e.message); }

try {
  db.exec(`CREATE TABLE IF NOT EXISTS crm_notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    phone      TEXT NOT NULL,
    note       TEXT NOT NULL,
    created_at INTEGER
  )`);
} catch (e) { console.error(e.message); }

try {
  db.exec(`CREATE TABLE IF NOT EXISTS crm_points_adj (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    phone      TEXT NOT NULL,
    delta      INTEGER NOT NULL,
    reason     TEXT,
    created_at INTEGER
  )`);
} catch (e) { console.error(e.message); }

// طلب "مكتمل" = ليس ملغياً وليس ناقصاً (نفس تعريف المنصة)
const DONE = "status NOT IN ('ملغي','ناقص')";
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function cleanPhone(p) { return String(p == null ? "" : p).trim(); }

// رصيد النقاط الحيّ: نقطة لكل دينار مكتمل + التعديلات اليدوية
function pointsBalance(phone) {
  const base = retryDb(() => db.prepare(
    `SELECT COALESCE(SUM(total),0) s FROM orders WHERE phone = ? AND ${DONE}`
  ).get(phone));
  const adj = retryDb(() => db.prepare(
    "SELECT COALESCE(SUM(delta),0) s FROM crm_points_adj WHERE phone = ?"
  ).get(phone));
  const earned = Math.floor(Number(base.s) || 0);
  const adjusted = Number(adj.s) || 0;
  return { earned, adjusted, balance: earned + adjusted };
}

// CLV بسيط: متوسط الصرف الشهري منذ أول طلب مكتمل
function clvOf(spent, first_at) {
  const months = Math.max(1, (Date.now() - (first_at || Date.now())) / MONTH_MS);
  return Math.round(((Number(spent) || 0) / months) * 100) / 100;
}

export const router = Router();

// ───────────────────────────────────────────────
// مساعد: قائمة الزبائن (بحث بالهاتف/المنطقة) — تُستخدم بالواجهة
// ───────────────────────────────────────────────
router.get("/customers", (req, res) => {
  try {
    const s = String(req.query.search || "").trim();
    const cond = s ? "AND (phone LIKE @s OR area LIKE @s)" : "";
    const rows = retryDb(() => db.prepare(`
      SELECT phone, COUNT(*) orders_count,
             SUM(CASE WHEN ${DONE} THEN total ELSE 0 END) total_spent,
             MAX(created_at) last_at, MAX(area) area
      FROM orders WHERE phone != '' ${cond}
      GROUP BY phone ORDER BY last_at DESC LIMIT 300
    `).all(s ? { s: `%${s}%` } : {}));
    res.json({ customers: rows });
  } catch (e) {
    console.error("crm/customers:", e.message);
    res.status(500).json({ error: "تعذّر جلب قائمة الزبائن" });
  }
});

// ───────────────────────────────────────────────
// (1) ملف زبون 360 — كل شيء عن الزبون بصفحة واحدة
// ───────────────────────────────────────────────
router.get("/customer", (req, res) => {
  try {
    const phone = cleanPhone(req.query.phone);
    if (!phone) return res.status(400).json({ error: "رقم الهاتف مطلوب" });

    const orders = retryDb(() => db.prepare(
      "SELECT id,page_name,order_string,total,area,status,created_at,messenger_url,cancel_reason FROM orders WHERE phone = ? ORDER BY created_at DESC LIMIT 200"
    ).all(phone));
    if (!orders.length) return res.status(400).json({ error: "لا يوجد زبون بهذا الرقم" });

    const agg = retryDb(() => db.prepare(`
      SELECT COUNT(*) cnt,
             SUM(CASE WHEN ${DONE} THEN 1 ELSE 0 END) done_cnt,
             SUM(CASE WHEN status='ملغي' THEN 1 ELSE 0 END) cancelled_cnt,
             SUM(CASE WHEN ${DONE} THEN total ELSE 0 END) spent,
             MIN(created_at) first_at, MAX(created_at) last_at
      FROM orders WHERE phone = ?
    `).get(phone));

    const notes = retryDb(() => db.prepare(
      "SELECT id,note,created_at FROM crm_notes WHERE phone = ? ORDER BY created_at DESC LIMIT 100"
    ).all(phone));
    const tags = retryDb(() => db.prepare(
      "SELECT tag FROM crm_tags WHERE phone = ? ORDER BY tag"
    ).all(phone)).map(r => r.tag);
    const addresses = retryDb(() => db.prepare(
      "SELECT area, COUNT(*) uses, MAX(created_at) last_at FROM orders WHERE phone = ? AND area != '' GROUP BY area ORDER BY uses DESC LIMIT 50"
    ).all(phone));

    const doneCnt = Number(agg.done_cnt) || 0;
    const spent = Number(agg.spent) || 0;
    res.json({
      phone,
      orders,
      stats: {
        orders_count: Number(agg.cnt) || 0,
        done_count: doneCnt,
        cancelled_count: Number(agg.cancelled_cnt) || 0,
        total_spent: spent,
        avg_order: doneCnt ? Math.round((spent / doneCnt) * 100) / 100 : 0,
        first_at: agg.first_at,
        last_at: agg.last_at,
        clv_monthly: clvOf(spent, agg.first_at)
      },
      points: pointsBalance(phone),
      notes, tags, addresses
    });
  } catch (e) {
    console.error("crm/customer:", e.message);
    res.status(500).json({ error: "تعذّر جلب ملف الزبون" });
  }
});

// ───────────────────────────────────────────────
// (2) وسوم الزبائن — إضافة/حذف/فلترة
// ───────────────────────────────────────────────
router.get("/tags/all", (_req, res) => {
  try {
    const rows = retryDb(() => db.prepare(
      "SELECT tag, COUNT(*) customers FROM crm_tags GROUP BY tag ORDER BY customers DESC, tag LIMIT 200"
    ).all());
    res.json({ tags: rows });
  } catch (e) {
    console.error("crm/tags/all:", e.message);
    res.status(500).json({ error: "تعذّر جلب الوسوم" });
  }
});

router.get("/tags", (req, res) => {
  try {
    const phone = cleanPhone(req.query.phone);
    if (!phone) return res.status(400).json({ error: "رقم الهاتف مطلوب" });
    const rows = retryDb(() => db.prepare(
      "SELECT tag, created_at FROM crm_tags WHERE phone = ? ORDER BY tag LIMIT 100"
    ).all(phone));
    res.json({ phone, tags: rows });
  } catch (e) {
    console.error("crm/tags:", e.message);
    res.status(500).json({ error: "تعذّر جلب وسوم الزبون" });
  }
});

router.post("/tags/add", (req, res) => {
  try {
    const phone = cleanPhone(req.body && req.body.phone);
    const tag = String((req.body && req.body.tag) || "").trim();
    if (!phone || !tag) return res.status(400).json({ error: "الهاتف والوسم مطلوبان" });
    if (tag.length > 40) return res.status(400).json({ error: "الوسم طويل جداً (40 حرفاً كحد أقصى)" });
    retryDb(() => db.prepare(
      "INSERT INTO crm_tags (phone,tag,created_at) VALUES (?,?,?) ON CONFLICT(phone,tag) DO NOTHING"
    ).run(phone, tag, Date.now()));
    res.json({ ok: true });
  } catch (e) {
    console.error("crm/tags/add:", e.message);
    res.status(500).json({ error: "تعذّر إضافة الوسم" });
  }
});

router.post("/tags/remove", (req, res) => {
  try {
    const phone = cleanPhone(req.body && req.body.phone);
    const tag = String((req.body && req.body.tag) || "").trim();
    if (!phone || !tag) return res.status(400).json({ error: "الهاتف والوسم مطلوبان" });
    retryDb(() => db.prepare("DELETE FROM crm_tags WHERE phone = ? AND tag = ?").run(phone, tag));
    res.json({ ok: true });
  } catch (e) {
    console.error("crm/tags/remove:", e.message);
    res.status(500).json({ error: "تعذّر حذف الوسم" });
  }
});

router.get("/tags/filter", (req, res) => {
  try {
    const tag = String(req.query.tag || "").trim();
    if (!tag) return res.status(400).json({ error: "الوسم مطلوب" });
    const rows = retryDb(() => db.prepare(`
      SELECT t.phone,
             COUNT(o.id) orders_count,
             COALESCE(SUM(CASE WHEN o.${DONE} THEN o.total ELSE 0 END),0) total_spent,
             MAX(o.created_at) last_at
      FROM crm_tags t LEFT JOIN orders o ON o.phone = t.phone
      WHERE t.tag = ?
      GROUP BY t.phone ORDER BY total_spent DESC LIMIT 300
    `).all(tag));
    res.json({ tag, customers: rows });
  } catch (e) {
    console.error("crm/tags/filter:", e.message);
    res.status(500).json({ error: "تعذّر فلترة الزبائن بالوسم" });
  }
});

// ───────────────────────────────────────────────
// (3) ملاحظات الزبون — CRUD
// ───────────────────────────────────────────────
router.get("/notes", (req, res) => {
  try {
    const phone = cleanPhone(req.query.phone);
    if (!phone) return res.status(400).json({ error: "رقم الهاتف مطلوب" });
    const rows = retryDb(() => db.prepare(
      "SELECT id,note,created_at FROM crm_notes WHERE phone = ? ORDER BY created_at DESC LIMIT 200"
    ).all(phone));
    res.json({ phone, notes: rows });
  } catch (e) {
    console.error("crm/notes:", e.message);
    res.status(500).json({ error: "تعذّر جلب الملاحظات" });
  }
});

router.post("/notes/add", (req, res) => {
  try {
    const phone = cleanPhone(req.body && req.body.phone);
    const note = String((req.body && req.body.note) || "").trim();
    if (!phone || !note) return res.status(400).json({ error: "الهاتف ونص الملاحظة مطلوبان" });
    if (note.length > 2000) return res.status(400).json({ error: "الملاحظة طويلة جداً" });
    const r = retryDb(() => db.prepare(
      "INSERT INTO crm_notes (phone,note,created_at) VALUES (?,?,?)"
    ).run(phone, note, Date.now()));
    res.json({ ok: true, id: Number(r.lastInsertRowid) });
  } catch (e) {
    console.error("crm/notes/add:", e.message);
    res.status(500).json({ error: "تعذّر إضافة الملاحظة" });
  }
});

router.post("/notes/update", (req, res) => {
  try {
    const id = parseInt(req.body && req.body.id, 10);
    const note = String((req.body && req.body.note) || "").trim();
    if (!id || !note) return res.status(400).json({ error: "رقم الملاحظة والنص الجديد مطلوبان" });
    const r = retryDb(() => db.prepare("UPDATE crm_notes SET note = ? WHERE id = ?").run(note, id));
    if (!r.changes) return res.status(400).json({ error: "الملاحظة غير موجودة" });
    res.json({ ok: true });
  } catch (e) {
    console.error("crm/notes/update:", e.message);
    res.status(500).json({ error: "تعذّر تعديل الملاحظة" });
  }
});

router.post("/notes/delete", (req, res) => {
  try {
    const id = parseInt(req.body && req.body.id, 10);
    if (!id) return res.status(400).json({ error: "رقم الملاحظة مطلوب" });
    const r = retryDb(() => db.prepare("DELETE FROM crm_notes WHERE id = ?").run(id));
    if (!r.changes) return res.status(400).json({ error: "الملاحظة غير موجودة" });
    res.json({ ok: true });
  } catch (e) {
    console.error("crm/notes/delete:", e.message);
    res.status(500).json({ error: "تعذّر حذف الملاحظة" });
  }
});

// ───────────────────────────────────────────────
// (4) نقاط الولاء — أرصدة أعلى 100 + تعديل يدوي
// ───────────────────────────────────────────────
router.get("/points/top", (_req, res) => {
  try {
    const earned = retryDb(() => db.prepare(`
      SELECT phone, SUM(total) spent, COUNT(*) done_count
      FROM orders WHERE phone != '' AND ${DONE}
      GROUP BY phone
    `).all());
    const adjs = retryDb(() => db.prepare(
      "SELECT phone, SUM(delta) adj FROM crm_points_adj GROUP BY phone"
    ).all());
    const map = new Map();
    for (const r of earned) {
      map.set(r.phone, { phone: r.phone, earned: Math.floor(Number(r.spent) || 0), adjusted: 0, done_count: Number(r.done_count) || 0 });
    }
    for (const a of adjs) {
      const cur = map.get(a.phone) || { phone: a.phone, earned: 0, adjusted: 0, done_count: 0 };
      cur.adjusted = Number(a.adj) || 0;
      map.set(a.phone, cur);
    }
    const list = [...map.values()]
      .map(r => ({ ...r, balance: r.earned + r.adjusted }))
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 100);
    res.json({ customers: list });
  } catch (e) {
    console.error("crm/points/top:", e.message);
    res.status(500).json({ error: "تعذّر جلب أرصدة النقاط" });
  }
});

router.get("/points", (req, res) => {
  try {
    const phone = cleanPhone(req.query.phone);
    if (!phone) return res.status(400).json({ error: "رقم الهاتف مطلوب" });
    const adjustments = retryDb(() => db.prepare(
      "SELECT id,delta,reason,created_at FROM crm_points_adj WHERE phone = ? ORDER BY created_at DESC LIMIT 100"
    ).all(phone));
    res.json({ phone, ...pointsBalance(phone), adjustments });
  } catch (e) {
    console.error("crm/points:", e.message);
    res.status(500).json({ error: "تعذّر جلب نقاط الزبون" });
  }
});

router.post("/points/adjust", (req, res) => {
  try {
    const phone = cleanPhone(req.body && req.body.phone);
    const delta = parseInt(req.body && req.body.delta, 10);
    const reason = String((req.body && req.body.reason) || "").trim();
    if (!phone) return res.status(400).json({ error: "رقم الهاتف مطلوب" });
    if (!Number.isFinite(delta) || delta === 0) return res.status(400).json({ error: "قيمة التعديل يجب أن تكون رقماً غير صفري (موجب لإضافة، سالب لخصم)" });
    if (!reason) return res.status(400).json({ error: "سبب التعديل مطلوب" });
    retryDb(() => db.prepare(
      "INSERT INTO crm_points_adj (phone,delta,reason,created_at) VALUES (?,?,?,?)"
    ).run(phone, delta, reason, Date.now()));
    res.json({ ok: true, ...pointsBalance(phone) });
  } catch (e) {
    console.error("crm/points/adjust:", e.message);
    res.status(500).json({ error: "تعذّر تعديل النقاط" });
  }
});

// ───────────────────────────────────────────────
// (5) أفضل 50 زبون بالقيمة الإجمالية
// ───────────────────────────────────────────────
router.get("/top-customers", (_req, res) => {
  try {
    const rows = retryDb(() => db.prepare(`
      SELECT phone, COUNT(*) done_count, SUM(total) total_spent,
             ROUND(AVG(total), 2) avg_order, MAX(created_at) last_at, MAX(area) area
      FROM orders WHERE phone != '' AND ${DONE}
      GROUP BY phone ORDER BY total_spent DESC LIMIT 50
    `).all());
    res.json({ customers: rows });
  } catch (e) {
    console.error("crm/top-customers:", e.message);
    res.status(500).json({ error: "تعذّر جلب أفضل الزبائن" });
  }
});

// ───────────────────────────────────────────────
// (6) زبائن معرّضون للفقدان — 2+ مكتمل وآخر طلب أقدم من 30 يوم (عرض فقط)
// ───────────────────────────────────────────────
router.get("/churn", (_req, res) => {
  try {
    const cutoff = Date.now() - MONTH_MS;
    const rows = retryDb(() => db.prepare(`
      SELECT phone,
             SUM(CASE WHEN ${DONE} THEN 1 ELSE 0 END) done_count,
             SUM(CASE WHEN ${DONE} THEN total ELSE 0 END) total_spent,
             MAX(created_at) last_at
      FROM orders WHERE phone != ''
      GROUP BY phone
      HAVING done_count >= 2 AND last_at < ?
      ORDER BY total_spent DESC LIMIT 200
    `).all(cutoff));
    const now = Date.now();
    res.json({ customers: rows.map(r => ({ ...r, days_since: Math.floor((now - r.last_at) / 86400000) })) });
  } catch (e) {
    console.error("crm/churn:", e.message);
    res.status(500).json({ error: "تعذّر جلب الزبائن المعرّضين للفقدان" });
  }
});

// ───────────────────────────────────────────────
// (7) زبائن خطرون — نسبة إلغاء >= 50% مع 2+ طلبات
// ───────────────────────────────────────────────
router.get("/risky", (_req, res) => {
  try {
    const rows = retryDb(() => db.prepare(`
      SELECT phone, COUNT(*) orders_count,
             SUM(CASE WHEN status='ملغي' THEN 1 ELSE 0 END) cancelled_count,
             MAX(created_at) last_at
      FROM orders WHERE phone != ''
      GROUP BY phone
      HAVING orders_count >= 2 AND cancelled_count * 1.0 / orders_count >= 0.5
      ORDER BY cancelled_count * 1.0 / orders_count DESC, orders_count DESC LIMIT 200
    `).all());
    res.json({
      customers: rows.map(r => ({
        ...r,
        cancel_rate: Math.round((r.cancelled_count * 100) / r.orders_count)
      }))
    });
  } catch (e) {
    console.error("crm/risky:", e.message);
    res.status(500).json({ error: "تعذّر جلب قائمة الزبائن الخطرين" });
  }
});

// ───────────────────────────────────────────────
// (8) دفتر العناوين — كل العناوين المميزة لكل هاتف
// ───────────────────────────────────────────────
router.get("/addresses", (req, res) => {
  try {
    const phone = cleanPhone(req.query.phone);
    if (phone) {
      const rows = retryDb(() => db.prepare(
        "SELECT area, COUNT(*) uses, MAX(created_at) last_at FROM orders WHERE phone = ? AND area != '' GROUP BY area ORDER BY uses DESC LIMIT 100"
      ).all(phone));
      return res.json({ phone, addresses: rows });
    }
    const rows = retryDb(() => db.prepare(
      "SELECT phone, area, COUNT(*) uses, MAX(created_at) last_at FROM orders WHERE phone != '' AND area != '' GROUP BY phone, area ORDER BY last_at DESC LIMIT 500"
    ).all());
    res.json({ addresses: rows });
  } catch (e) {
    console.error("crm/addresses:", e.message);
    res.status(500).json({ error: "تعذّر جلب دفتر العناوين" });
  }
});

// ───────────────────────────────────────────────
// (9) CLV بسيط — متوسط الصرف الشهري منذ أول طلب
// ───────────────────────────────────────────────
router.get("/clv", (_req, res) => {
  try {
    const rows = retryDb(() => db.prepare(`
      SELECT phone, SUM(total) total_spent, COUNT(*) done_count,
             MIN(created_at) first_at, MAX(created_at) last_at
      FROM orders WHERE phone != '' AND ${DONE}
      GROUP BY phone ORDER BY total_spent DESC LIMIT 100
    `).all());
    const now = Date.now();
    const list = rows.map(r => {
      const months = Math.max(1, (now - r.first_at) / MONTH_MS);
      return {
        ...r,
        months_active: Math.round(months * 10) / 10,
        clv_monthly: Math.round(((Number(r.total_spent) || 0) / months) * 100) / 100
      };
    }).sort((a, b) => b.clv_monthly - a.clv_monthly);
    res.json({ customers: list });
  } catch (e) {
    console.error("crm/clv:", e.message);
    res.status(500).json({ error: "تعذّر حساب القيمة الشهرية للزبائن" });
  }
});

// ───────────────────────────────────────────────
// (10) تصدير الزبائن CSV (بترويسة UTF-8 BOM لِيفتح صحيحاً في Excel)
// ───────────────────────────────────────────────
router.get("/export.csv", (_req, res) => {
  try {
    const rows = retryDb(() => db.prepare(`
      SELECT phone, COUNT(*) orders_count,
             SUM(CASE WHEN ${DONE} THEN 1 ELSE 0 END) done_count,
             SUM(CASE WHEN status='ملغي' THEN 1 ELSE 0 END) cancelled_count,
             SUM(CASE WHEN ${DONE} THEN total ELSE 0 END) total_spent,
             MIN(created_at) first_at, MAX(created_at) last_at, MAX(area) area
      FROM orders WHERE phone != ''
      GROUP BY phone ORDER BY total_spent DESC LIMIT 5000
    `).all());
    const tagRows = retryDb(() => db.prepare("SELECT phone, tag FROM crm_tags").all());
    const tagMap = new Map();
    for (const t of tagRows) {
      if (!tagMap.has(t.phone)) tagMap.set(t.phone, []);
      tagMap.get(t.phone).push(t.tag);
    }
    const cell = v => {
      const s = String(v == null ? "" : v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const d = t => (t ? new Date(t).toISOString().slice(0, 10) : "");
    const header = ["الهاتف", "عدد الطلبات", "المكتملة", "الملغاة", "إجمالي الصرف", "متوسط الطلب", "أول طلب", "آخر طلب", "آخر منطقة", "الوسوم"];
    const lines = [header.join(",")];
    for (const r of rows) {
      const done = Number(r.done_count) || 0;
      const spent = Number(r.total_spent) || 0;
      lines.push([
        cell(r.phone), r.orders_count, done, r.cancelled_count,
        spent.toFixed(2), done ? (spent / done).toFixed(2) : "0.00",
        d(r.first_at), d(r.last_at), cell(r.area), cell((tagMap.get(r.phone) || []).join(" | "))
      ].join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="crm-customers.csv"');
    res.send("\uFEFF" + lines.join("\r\n"));
  } catch (e) {
    console.error("crm/export:", e.message);
    res.status(500).json({ error: "تعذّر تصدير الزبائن" });
  }
});
