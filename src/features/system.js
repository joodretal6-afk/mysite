// ═══════════════════════════════════════════════════════════
// 🛡️ وحدة النظام والأمان (system)
// 10 ميزات: مركز إشعارات، فحص التناقضات، تصدير كامل، استيراد طلبات،
// أرشيف الطلبات، سجل تدقيق متقدم، مراقب الصحة، نسخ احتياطي فوري،
// مؤشر حجم الجداول، منظف الجلسات
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { db, retryDb } from "../db/database.js";
import { CONFIG, WEB } from "../config.js";

export const slug = "system";
export const title = "النظام والأمان";
export const icon = "🛡️";

// ── جدول الوحدة الخاص: إشعارات اللوحة ──
try {
  db.exec(`CREATE TABLE IF NOT EXISTS system_notices (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,
    text       TEXT NOT NULL,
    seen       INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  )`);
} catch (e) { console.error(e.message); }

// ═══════════════ أدوات مساعدة ═══════════════
const TZ = 10800000;      // توقيت الأردن +3 (ميلي ثانية)
const DAY = 86400000;

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// بداية يوم بتوقيت الأردن — shift بالأيام
function dayStartMs(shift = 0) {
  const d = new Date(Date.now() + TZ);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + shift) - TZ;
}

function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

// ── الذكاء الاصطناعي (Gemini) — يرجع نص أو null عند الفشل ──
async function askAI(prompt) {
  try {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + CONFIG.MODEL_NAME + ":generateContent?key=" + CONFIG.GEMINI_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.5, maxOutputTokens: 900 }
        }),
        signal: AbortSignal.timeout(40000)
      }
    );
    if (!r.ok) return null;
    const j = await r.json();
    const parts = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
    const text = Array.isArray(parts) ? parts.map(p => p.text || "").join("").trim() : "";
    return text || null;
  } catch { return null; }
}

export const router = Router();

// ═══════════════════════════════════════════════════════════
// 1) مركز إشعارات اللوحة
// ═══════════════════════════════════════════════════════════
router.get("/notices", (req, res) => {
  try {
    const onlyUnseen = String(req.query.unseen || "") === "1";
    const rows = retryDb(() => db.prepare(
      "SELECT id, kind, text, seen, created_at FROM system_notices " +
      (onlyUnseen ? "WHERE seen = 0 " : "") +
      "ORDER BY created_at DESC, id DESC LIMIT 200"
    ).all());
    const unseen = retryDb(() => db.prepare("SELECT COUNT(*) c FROM system_notices WHERE seen = 0").get());
    res.json({
      notices: rows.map(r => ({ id: Number(r.id), kind: r.kind, text: r.text, seen: Number(r.seen) ? 1 : 0, created_at: Number(r.created_at) })),
      unseen_count: Number(unseen.c)
    });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل جلب الإشعارات" }); }
});

// فحص الآن: يولّد إشعارات (متأخرة / ناقصة كثيرة اليوم / انخفاض مبيعات عن متوسط 7 أيام)
router.post("/notices/check", (req, res) => {
  try {
    const now = Date.now();
    const todayStart = dayStartMs(0);
    const candidates = [];

    // أ) طلبات متأخرة: جديد/تم التواصل منذ أكثر من يومين
    const late = retryDb(() => db.prepare(
      "SELECT COUNT(*) c FROM orders WHERE status IN ('جديد','تم التواصل') AND created_at < ?"
    ).get(now - 2 * DAY));
    if (Number(late.c) > 0) {
      candidates.push({ kind: "late_orders", text: "⏰ يوجد " + Number(late.c) + " طلب متأخر (جديد/تم التواصل منذ أكثر من يومين) — راجع صفحة الطلبات" });
    }

    // ب) طلبات ناقصة كثيرة اليوم (3 أو أكثر)
    const incomplete = retryDb(() => db.prepare(
      "SELECT COUNT(*) c FROM orders WHERE status = 'ناقص' AND created_at >= ?"
    ).get(todayStart));
    if (Number(incomplete.c) >= 3) {
      candidates.push({ kind: "incomplete_today", text: "🧩 " + Number(incomplete.c) + " طلبات ناقصة اليوم — قد تكون هناك مشكلة بجمع بيانات الزبائن" });
    }

    // ج) انخفاض مبيعات اليوم عن متوسط آخر 7 أيام (بعد الساعة 3 عصراً بتوقيت الأردن)
    const hourJo = new Date(now + TZ).getUTCHours();
    const today = retryDb(() => db.prepare(
      "SELECT COALESCE(SUM(total),0) s FROM orders WHERE status != 'ملغي' AND created_at >= ?"
    ).get(todayStart));
    const week = retryDb(() => db.prepare(
      "SELECT COALESCE(SUM(total),0) s FROM orders WHERE status != 'ملغي' AND created_at >= ? AND created_at < ?"
    ).get(dayStartMs(-7), todayStart));
    const avg7 = round2(Number(week.s) / 7);
    if (hourJo >= 15 && avg7 > 0 && Number(today.s) < avg7 * 0.5) {
      candidates.push({ kind: "sales_drop", text: "📉 مبيعات اليوم (" + round2(today.s) + " د) أقل من نصف متوسط آخر 7 أيام (" + avg7 + " د/يوم)" });
    }

    // إدراج بدون تكرار نفس النوع بنفس اليوم
    let created = 0;
    const texts = [];
    for (const c of candidates) {
      const dup = retryDb(() => db.prepare(
        "SELECT id FROM system_notices WHERE kind = ? AND created_at >= ? LIMIT 1"
      ).get(c.kind, todayStart));
      if (dup) continue;
      retryDb(() => db.prepare(
        "INSERT INTO system_notices (kind, text, seen, created_at) VALUES (?, ?, 0, ?)"
      ).run(c.kind, c.text, now));
      created += 1;
      texts.push(c.text);
    }
    res.json({ ok: true, checked: candidates.length, created, notices: texts, avg7, today_sales: round2(today.s) });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل فحص الإشعارات" }); }
});

router.post("/notices/seen", (req, res) => {
  try {
    const info = retryDb(() => db.prepare("UPDATE system_notices SET seen = 1 WHERE seen = 0").run());
    res.json({ ok: true, updated: Number(info.changes) || 0 });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل تعليم الإشعارات كمقروءة" }); }
});

router.delete("/notices/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "رقم إشعار غير صالح" });
    retryDb(() => db.prepare("DELETE FROM system_notices WHERE id = ?").run(id));
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل حذف الإشعار" }); }
});

// ═══════════════════════════════════════════════════════════
// 2) فحص تناقضات البيانات
// ═══════════════════════════════════════════════════════════
function computeIntegrity() {
  const pick = "id, page_name, order_string, total, area, phone, status, created_at";
  const mapRow = r => ({
    id: Number(r.id), page_name: r.page_name || "", order_string: r.order_string || "",
    total: round2(r.total), area: r.area || "", phone: r.phone || "",
    status: r.status || "", created_at: Number(r.created_at) || 0
  });

  // طلبات مكتملة (تم الشحن/تم التسليم) بلا هاتف
  const noPhone = retryDb(() => db.prepare(
    `SELECT ${pick} FROM orders WHERE status IN ('تم الشحن','تم التسليم')
     AND (phone IS NULL OR TRIM(phone) = '') ORDER BY created_at DESC LIMIT 200`
  ).all()).map(mapRow);

  // طلبات مكتملة بلا عنوان
  const noArea = retryDb(() => db.prepare(
    `SELECT ${pick} FROM orders WHERE status IN ('تم الشحن','تم التسليم')
     AND (area IS NULL OR TRIM(area) = '') ORDER BY created_at DESC LIMIT 200`
  ).all()).map(mapRow);

  // طلبات غير ملغية بمبلغ صفر
  const zeroTotal = retryDb(() => db.prepare(
    `SELECT ${pick} FROM orders WHERE status NOT IN ('ملغي','ناقص')
     AND (total IS NULL OR total <= 0) ORDER BY created_at DESC LIMIT 200`
  ).all()).map(mapRow);

  // مبالغ شاذة: أكثر من 5 أضعاف المتوسط
  const avgRow = retryDb(() => db.prepare(
    "SELECT COALESCE(AVG(total),0) a FROM orders WHERE status != 'ملغي' AND total > 0"
  ).get());
  const avg = round2(avgRow.a);
  const outliers = avg > 0 ? retryDb(() => db.prepare(
    `SELECT ${pick} FROM orders WHERE status != 'ملغي' AND total > ?
     ORDER BY total DESC LIMIT 200`
  ).all(avg * 5)).map(mapRow) : [];

  return {
    avg_order: avg,
    outlier_threshold: round2(avg * 5),
    no_phone: noPhone, no_area: noArea, zero_total: zeroTotal, outliers,
    total_issues: noPhone.length + noArea.length + zeroTotal.length + outliers.length
  };
}

router.get("/integrity", (req, res) => {
  try { res.json(computeIntegrity()); }
  catch (e) { console.error(e); res.status(500).json({ error: "فشل فحص التناقضات" }); }
});

// ملخص ذكي لنتائج الفحص
router.get("/integrity/ai", async (req, res) => {
  try {
    const g = computeIntegrity();
    const prompt = "أنت مدقق بيانات لمنصة مبيعات أجبان أردنية عبر ماسنجر. نتائج فحص التناقضات:\n" +
      `- طلبات مكتملة بلا هاتف: ${g.no_phone.length}\n` +
      `- طلبات مكتملة بلا عنوان: ${g.no_area.length}\n` +
      `- طلبات بمبلغ صفر: ${g.zero_total.length}\n` +
      `- مبالغ شاذة (أكبر من ${g.outlier_threshold} دينار أي 5× المتوسط ${g.avg_order}): ${g.outliers.length}\n` +
      "اكتب تقييماً موجزاً بالعربية (4-6 أسطر): خطورة كل نوع، أيها يُعالج أولاً، وخطوات عملية للتصحيح والوقاية. بدون مقدمات وبدون تنسيق Markdown.";
    const text = await askAI(prompt);
    if (!text) return res.status(500).json({ error: "تعذّر الاتصال بالذكاء" });
    res.json({ text });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل التحليل الذكي" }); }
});

// ═══════════════════════════════════════════════════════════
// 3) تصدير كامل (JSON كملف تنزيل)
// ═══════════════════════════════════════════════════════════
router.get("/export", (req, res) => {
  try {
    const orders = retryDb(() => db.prepare("SELECT * FROM orders ORDER BY id LIMIT 50000").all());
    const users = retryDb(() => db.prepare("SELECT id, username, role, created_at FROM users LIMIT 1000").all());
    const coupons = retryDb(() => db.prepare("SELECT * FROM coupons LIMIT 5000").all());
    const addons = retryDb(() => db.prepare("SELECT * FROM addons LIMIT 5000").all());
    const payload = {
      exported_at: Date.now(),
      exported_at_text: new Date(Date.now() + TZ).toISOString().replace("T", " ").slice(0, 19) + " (توقيت الأردن)",
      counts: { orders: orders.length, users: users.length, coupons: coupons.length, addons: addons.length },
      data: { orders, users, coupons, addons }
    };
    const fname = "platform-export-" + new Date(Date.now() + TZ).toISOString().slice(0, 10) + ".json";
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="' + fname + '"');
    res.send(JSON.stringify(payload, null, 1));
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل التصدير الكامل" }); }
});

// ═══════════════════════════════════════════════════════════
// 4) استيراد طلبات من JSON مصدَّر (تخطي المكرر حسب id)
// ═══════════════════════════════════════════════════════════
router.post("/import", (req, res) => {
  try {
    const body = req.body || {};
    let list = Array.isArray(body) ? body : (body.orders || (body.data && body.data.orders));
    if (!Array.isArray(list)) return res.status(400).json({ error: "صيغة غير صالحة — أرسل مصفوفة orders من ملف التصدير" });
    if (list.length > 5000) return res.status(400).json({ error: "الحد الأقصى 5000 طلب بالاستيراد الواحد" });

    const VALID = ["ناقص", "جديد", "تم التواصل", "تم الشحن", "تم التسليم", "ملغي"];
    let inserted = 0, skipped = 0, invalid = 0;
    for (const o of list) {
      if (!o || typeof o !== "object") { invalid += 1; continue; }
      const id = Number(o.id) > 0 ? Math.floor(Number(o.id)) : null;
      const orderString = String(o.order_string || "").slice(0, 2000);
      if (!orderString && !o.phone && !o.sender_id) { invalid += 1; continue; }
      if (id) {
        const exists = retryDb(() => db.prepare("SELECT id FROM orders WHERE id = ?").get(id));
        if (exists) { skipped += 1; continue; }
      }
      const status = VALID.includes(String(o.status)) ? String(o.status) : "جديد";
      retryDb(() => db.prepare(
        `INSERT INTO orders (id, page_id, page_name, sender_id, order_string, total, area, phone,
                             status, messenger_url, created_at, followed_up, reorder_sent, postsale_sent, cancel_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        String(o.page_id || ""), String(o.page_name || "").slice(0, 300), String(o.sender_id || ""),
        orderString, Number(o.total) || 0,
        String(o.area || "").slice(0, 500), String(o.phone || "").slice(0, 50),
        status, String(o.messenger_url || "").slice(0, 500),
        Number(o.created_at) > 0 ? Math.floor(Number(o.created_at)) : Date.now(),
        Number(o.followed_up) ? 1 : 0, Number(o.reorder_sent) ? 1 : 0, Number(o.postsale_sent) ? 1 : 0,
        String(o.cancel_reason || "").slice(0, 500)
      ));
      inserted += 1;
    }
    res.json({ ok: true, total: list.length, inserted, skipped, invalid });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل الاستيراد — تأكد من صحة الملف" }); }
});

// ═══════════════════════════════════════════════════════════
// 5) أرشيف الطلبات (الأقدم من 90 يوماً — عرض فقط، بدون حذف)
// ═══════════════════════════════════════════════════════════
router.get("/archive", (req, res) => {
  try {
    const cutoff = Date.now() - 90 * DAY;
    const offset = clampInt(req.query.offset, 0, 1000000, 0);
    const limit = clampInt(req.query.limit, 1, 200, 50);
    const cnt = retryDb(() => db.prepare(
      "SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE created_at < ?"
    ).get(cutoff));
    const rows = retryDb(() => db.prepare(
      `SELECT id, page_name, order_string, total, area, phone, status, created_at
       FROM orders WHERE created_at < ? ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
    ).all(cutoff));
    res.json({
      cutoff, total: Number(cnt.c), total_value: round2(cnt.s), offset, limit,
      orders: rows.map(r => ({
        id: Number(r.id), page_name: r.page_name || "", order_string: r.order_string || "",
        total: round2(r.total), area: r.area || "", phone: r.phone || "",
        status: r.status || "", created_at: Number(r.created_at) || 0
      }))
    });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل جلب الأرشيف" }); }
});

// ═══════════════════════════════════════════════════════════
// 6) سجل تدقيق متقدم (فلاتر + تصدير CSV)
// ═══════════════════════════════════════════════════════════
function auditWhere(req) {
  const where = [], params = [];
  const user = String(req.query.user || "").trim();
  const action = String(req.query.action || "").trim();
  const q = String(req.query.q || "").trim();
  if (user) { where.push("username = ?"); params.push(user); }
  if (action) { where.push("action = ?"); params.push(action); }
  if (q) {
    const like = "%" + q.replace(/[%_]/g, "") + "%";
    where.push("(COALESCE(detail,'') LIKE ? OR COALESCE(action,'') LIKE ? OR COALESCE(username,'') LIKE ?)");
    params.push(like, like, like);
  }
  return { sql: where.length ? " WHERE " + where.join(" AND ") : "", params };
}

router.get("/audit", (req, res) => {
  try {
    const { sql, params } = auditWhere(req);
    const limit = clampInt(req.query.limit, 1, 500, 100);
    const offset = clampInt(req.query.offset, 0, 1000000, 0);
    const cnt = retryDb(() => db.prepare("SELECT COUNT(*) c FROM activity_log" + sql).get(...params));
    const rows = retryDb(() => db.prepare(
      `SELECT id, username, action, detail, created_at FROM activity_log${sql}
       ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`
    ).all(...params));
    res.json({
      total: Number(cnt.c), offset, limit,
      logs: rows.map(r => ({
        id: Number(r.id), username: r.username || "", action: r.action || "",
        detail: r.detail || "", created_at: Number(r.created_at) || 0
      }))
    });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل جلب سجل التدقيق" }); }
});

// قوائم الفلاتر (مستخدمون وعمليات مميزة)
router.get("/audit/filters", (req, res) => {
  try {
    const users = retryDb(() => db.prepare(
      "SELECT DISTINCT COALESCE(username,'') u FROM activity_log WHERE COALESCE(username,'') != '' ORDER BY u LIMIT 100"
    ).all()).map(r => r.u);
    const actions = retryDb(() => db.prepare(
      "SELECT DISTINCT COALESCE(action,'') a FROM activity_log WHERE COALESCE(action,'') != '' ORDER BY a LIMIT 100"
    ).all()).map(r => r.a);
    res.json({ users, actions });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل جلب قوائم الفلاتر" }); }
});

// تصدير CSV بنفس الفلاتر
router.get("/audit/csv", (req, res) => {
  try {
    const { sql, params } = auditWhere(req);
    const rows = retryDb(() => db.prepare(
      `SELECT id, username, action, detail, created_at FROM activity_log${sql}
       ORDER BY created_at DESC, id DESC LIMIT 5000`
    ).all(...params));
    const csvCell = v => '"' + String(v == null ? "" : v).replace(/"/g, '""').replace(/\r?\n/g, " ") + '"';
    let csv = "\uFEFFid,المستخدم,العملية,التفاصيل,التاريخ\n";
    for (const r of rows) {
      const dt = new Date(Number(r.created_at) + TZ).toISOString().replace("T", " ").slice(0, 19);
      csv += [r.id, csvCell(r.username), csvCell(r.action), csvCell(r.detail), csvCell(dt)].join(",") + "\n";
    }
    const fname = "audit-log-" + new Date(Date.now() + TZ).toISOString().slice(0, 10) + ".csv";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="' + fname + '"');
    res.send(csv);
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل تصدير CSV" }); }
});

// ═══════════════════════════════════════════════════════════
// 7) مراقب الصحة
// ═══════════════════════════════════════════════════════════
router.get("/health", (req, res) => {
  try {
    const now = Date.now();
    const out = { checked_at: now };

    // قاعدة البيانات تستجيب + زمن الاستجابة
    try {
      const t0 = Date.now();
      retryDb(() => db.prepare("SELECT 1 x").get());
      out.db = { ok: true, ms: Date.now() - t0 };
    } catch (e) { out.db = { ok: false, ms: null, error: String(e && e.message).slice(0, 200) }; }

    // طلبات اليوم ومبيعاته
    try {
      const r = retryDb(() => db.prepare(
        "SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE created_at >= ?"
      ).get(dayStartMs(0)));
      out.today = { orders: Number(r.c), sales: round2(r.s) };
    } catch { out.today = null; }

    // آخر رسالة واردة قبل كم دقيقة
    try {
      const m = retryDb(() => db.prepare(
        "SELECT MAX(created_at) m FROM messages WHERE direction = 'in'"
      ).get());
      out.last_inbound_min = m && m.m ? Math.round((now - Number(m.m)) / 60000) : null;
    } catch { out.last_inbound_min = null; }

    // حجم ملف قاعدة البيانات
    try {
      const st = fs.statSync(WEB.DB_PATH);
      out.db_file = { exists: true, size: st.size, size_mb: round2(st.size / 1048576), modified_at: st.mtimeMs };
    } catch { out.db_file = { exists: false, size: null, size_mb: null }; }

    out.uptime_min = Math.round(process.uptime() / 60);
    res.json(out);
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل فحص الصحة" }); }
});

// ═══════════════════════════════════════════════════════════
// 8) نسخة احتياطية فورية + قائمة النسخ
// ═══════════════════════════════════════════════════════════
function backupsDir() { return path.join(path.dirname(WEB.DB_PATH), "backups"); }

router.post("/backup", (req, res) => {
  try {
    if (!fs.existsSync(WEB.DB_PATH)) {
      return res.status(400).json({ error: "ملف قاعدة البيانات غير موجود محلياً (قد تكون القاعدة سحابية Turso) — النسخ المحلي غير متاح" });
    }
    const dir = backupsDir();
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date(Date.now() + TZ).toISOString().slice(0, 19).replace(/[T:]/g, "-");
    const fname = "backup-" + stamp + ".db";
    const dest = path.join(dir, fname);
    fs.copyFileSync(WEB.DB_PATH, dest);
    const st = fs.statSync(dest);
    res.json({ ok: true, file: fname, size: st.size, size_mb: round2(st.size / 1048576) });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل إنشاء النسخة الاحتياطية" }); }
});

router.get("/backups", (req, res) => {
  try {
    const dir = backupsDir();
    let files = [];
    try {
      files = fs.readdirSync(dir)
        .filter(f => f.endsWith(".db"))
        .map(f => {
          try {
            const st = fs.statSync(path.join(dir, f));
            return { file: f, size: st.size, size_mb: round2(st.size / 1048576), created_at: st.mtimeMs };
          } catch { return { file: f, size: null, size_mb: null, created_at: 0 }; }
        })
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, 100);
    } catch { files = []; }
    res.json({ dir, backups: files });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل جلب قائمة النسخ" }); }
});

// ═══════════════════════════════════════════════════════════
// 9) مؤشر حجم الجداول
// ═══════════════════════════════════════════════════════════
router.get("/tables", (req, res) => {
  try {
    const names = ["orders", "messages", "kv", "activity_log", "coupons", "reviews"];
    const tables = names.map(name => {
      try {
        const r = retryDb(() => db.prepare("SELECT COUNT(*) c FROM " + name).get());
        return { name, rows: Number(r.c) };
      } catch { return { name, rows: null }; }
    });
    res.json({ tables, total_rows: tables.reduce((a, t) => a + (t.rows || 0), 0) });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل قراءة أحجام الجداول" }); }
});

// ═══════════════════════════════════════════════════════════
// 10) منظف الجلسات (kv منتهية الصلاحية)
// ═══════════════════════════════════════════════════════════
router.get("/sessions/expired", (req, res) => {
  try {
    const now = Date.now();
    const expired = retryDb(() => db.prepare(
      "SELECT COUNT(*) c FROM kv WHERE expires_at IS NOT NULL AND expires_at < ?"
    ).get(now));
    const total = retryDb(() => db.prepare("SELECT COUNT(*) c FROM kv").get());
    const noExpiry = retryDb(() => db.prepare("SELECT COUNT(*) c FROM kv WHERE expires_at IS NULL").get());
    res.json({ expired: Number(expired.c), total: Number(total.c), no_expiry: Number(noExpiry.c) });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل عدّ الجلسات المنتهية" }); }
});

router.post("/sessions/clean", (req, res) => {
  try {
    const info = retryDb(() => db.prepare(
      "DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at < ?"
    ).run(Date.now()));
    res.json({ ok: true, deleted: Number(info.changes) || 0 });
  } catch (e) { console.error(e); res.status(500).json({ error: "فشل تنظيف الجلسات" }); }
});
