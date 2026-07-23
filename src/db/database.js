// ═══════════════════════════════════════════════════════════
// طبقة قاعدة البيانات (SQLite)
// - محوّل KV متوافق مع كود البوت الأصلي (get/put/delete + TTL)
// - جدول الأوردرات (orders) للوحة التحكم والتصدير Excel
// - جدول المستخدمين (users) لتسجيل الدخول
// ═══════════════════════════════════════════════════════════
import Database from "libsql";
import fs from "node:fs";
import path from "node:path";
import { WEB } from "../config.js";

// إنشاء مجلد قاعدة البيانات لو مش موجود
const dbDir = path.dirname(WEB.DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

// ═══════════════════════════════════════════════════════════
// التخزين الدائم:
// - لو TURSO_DATABASE_URL موجود → اتصال مباشر بـ Turso السحابي
//   (كل كتابة وقراءة على نفس القاعدة السحابية → الأوردرات تظهر فوراً وما تنمسح أبداً)
// - غير هيك → ملف محلي عادي (للتجربة)
// ═══════════════════════════════════════════════════════════
const TURSO_URL = process.env.TURSO_DATABASE_URL || "";
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || "";

export const db = TURSO_URL
  ? new Database(TURSO_URL, { authToken: TURSO_TOKEN })   // اتصال مباشر (تناسق فوري)
  : new Database(WEB.DB_PATH);

if (TURSO_URL) {
  console.log("☁️  متصل مباشرة بـ Turso السحابي (تخزين دائم)");
} else {
  // WAL مفيد فقط للملف المحلي
  try { db.pragma("journal_mode = WAL"); } catch { /* تجاهل */ }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS kv (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    expires_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS orders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id       TEXT,
    page_name     TEXT,
    sender_id     TEXT,
    order_string  TEXT,
    total         REAL,
    area          TEXT,
    phone         TEXT,
    status        TEXT DEFAULT 'جديد',
    messenger_url TEXT,
    created_at    INTEGER
  );

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE,
    password_hash TEXT,
    created_at    INTEGER
  );

  CREATE TABLE IF NOT EXISTS page_knowledge (
    page_id    TEXT PRIMARY KEY,
    extra      TEXT,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id    TEXT,
    page_name  TEXT,
    sender_id  TEXT,
    direction  TEXT,            -- 'in' من الزبون / 'out' من البوت
    body       TEXT,
    created_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
  CREATE INDEX IF NOT EXISTS idx_orders_page    ON orders(page_id);
  CREATE INDEX IF NOT EXISTS idx_msg_conv       ON messages(page_id, sender_id, created_at);
`);

// ── تنظيف دوري للمفاتيح المنتهية ──
function cleanupExpired() {
  db.prepare("DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at < ?").run(Date.now());
}
setInterval(cleanupExpired, 60 * 1000).unref?.();
cleanupExpired();

// ═══════════════════════════════════════════════════════════
// محوّل KV متوافق مع Cloudflare Workers KV
// يدعم: get(key, "json") / put(key, value, {expirationTtl}) / delete(key)
// ═══════════════════════════════════════════════════════════
const kvGet = db.prepare("SELECT value, expires_at FROM kv WHERE key = ?");
const kvPut = db.prepare(`
  INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at
`);
const kvDel = db.prepare("DELETE FROM kv WHERE key = ?");

export const SESSIONS_KV = {
  async get(key, type) {
    const row = kvGet.get(key);
    if (!row) return null;
    if (row.expires_at != null && row.expires_at < Date.now()) {
      kvDel.run(key);
      return null;
    }
    if (type === "json") {
      try { return JSON.parse(row.value); } catch { return null; }
    }
    return row.value;
  },

  async put(key, value, opts = {}) {
    const expiresAt = opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null;
    kvPut.run(key, String(value), expiresAt);
  },

  async delete(key) {
    kvDel.run(key);
  }
};

// ═══════════════════════════════════════════════════════════
// دوال الأوردرات
// ═══════════════════════════════════════════════════════════
const insertOrder = db.prepare(`
  INSERT INTO orders (page_id, page_name, sender_id, order_string, total, area, phone, status, messenger_url, created_at)
  VALUES (@page_id, @page_name, @sender_id, @order_string, @total, @area, @phone, @status, @messenger_url, @created_at)
`);

export function saveOrder(o) {
  const info = insertOrder.run({
    page_id: o.page_id || "",
    page_name: o.page_name || "",
    sender_id: o.sender_id || "",
    order_string: o.order_string || "",
    total: o.total || 0,
    area: o.area || "",
    phone: o.phone || "",
    status: o.status || "جديد",
    messenger_url: o.messenger_url || "",
    created_at: o.created_at || Date.now()
  });
  return info.lastInsertRowid;
}

export function listOrders({ page_id, search, from, to, status, limit = 500, offset = 0 } = {}) {
  const where = [];
  const params = {};

  if (page_id) { where.push("page_id = @page_id"); params.page_id = page_id; }
  if (status)  { where.push("status = @status");   params.status = status; }
  if (from)    { where.push("created_at >= @from"); params.from = from; }
  if (to)      { where.push("created_at <= @to");   params.to = to; }
  if (search) {
    where.push("(order_string LIKE @s OR area LIKE @s OR phone LIKE @s OR page_name LIKE @s)");
    params.s = `%${search}%`;
  }

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  params.limit = limit;
  params.offset = offset;

  const rows = db.prepare(
    `SELECT * FROM orders ${clause} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`
  ).all(params);

  const totalCount = db.prepare(
    `SELECT COUNT(*) AS c, COALESCE(SUM(total),0) AS sum FROM orders ${clause}`
  ).get(params);

  return { rows, count: totalCount.c, sum: totalCount.sum };
}

// فحص وجود طلب مطابق (لمنع التكرار أثناء الاستخراج الجماعي)
export function orderExists(page_id, sender_id, order_string) {
  const row = db.prepare(
    "SELECT id FROM orders WHERE page_id = ? AND sender_id = ? AND order_string = ?"
  ).get(page_id, sender_id, order_string);
  return !!row;
}

export function updateOrderStatus(id, status) {
  return db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, id);
}

export function deleteOrder(id) {
  return db.prepare("DELETE FROM orders WHERE id = ?").run(id);
}

export function distinctPages() {
  return db.prepare(
    "SELECT DISTINCT page_id, page_name FROM orders WHERE page_name != '' ORDER BY page_name"
  ).all();
}

// إحصائيات لكل صفحة على حدة (لصفحة الأوردرات المنفصلة)
export function perPageStats() {
  return db.prepare(`
    SELECT page_id, page_name,
           COUNT(*) AS count,
           COALESCE(SUM(total),0) AS sum,
           SUM(CASE WHEN status='جديد' THEN 1 ELSE 0 END) AS new_count,
           MAX(created_at) AS last_at
    FROM orders GROUP BY page_id ORDER BY count DESC
  `).all();
}

export function ordersStats() {
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  return {
    total:      db.prepare("SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders").get(),
    today:      db.prepare("SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE created_at >= ?").get(today0.getTime()),
    newCount:   db.prepare("SELECT COUNT(*) c FROM orders WHERE status = 'جديد'").get().c
  };
}

// ═══════════════════════════════════════════════════════════
// دوال تغذية البوت بمعلومات إضافية (لكل صفحة)
// ═══════════════════════════════════════════════════════════
export function getKnowledge(pageId) {
  const row = db.prepare("SELECT extra FROM page_knowledge WHERE page_id = ?").get(pageId);
  return row ? row.extra : "";
}

export function setKnowledge(pageId, extra) {
  db.prepare(`
    INSERT INTO page_knowledge (page_id, extra, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(page_id) DO UPDATE SET extra = excluded.extra, updated_at = excluded.updated_at
  `).run(pageId, String(extra || ""), Date.now());
}

// ═══════════════════════════════════════════════════════════
// أرشيف الرسائل (حفظ كل الدردشات)
// ═══════════════════════════════════════════════════════════
const insertMessage = db.prepare(`
  INSERT INTO messages (page_id, page_name, sender_id, direction, body, created_at)
  VALUES (@page_id, @page_name, @sender_id, @direction, @body, @created_at)
`);

export function logMessage(m) {
  try {
    insertMessage.run({
      page_id: m.page_id || "",
      page_name: m.page_name || "",
      sender_id: m.sender_id || "",
      direction: m.direction || "in",
      body: m.body || "",
      created_at: m.created_at || Date.now()
    });
  } catch (e) {
    console.error("logMessage failed:", e && e.message);
  }
}

export function listChatThreads(pageId) {
  // آخر رسالة لكل زبون في صفحة
  return db.prepare(`
    SELECT sender_id, page_name,
           MAX(created_at) AS last_at,
           COUNT(*) AS msg_count
    FROM messages WHERE page_id = ?
    GROUP BY sender_id ORDER BY last_at DESC LIMIT 200
  `).all(pageId);
}

export function getChatMessages(pageId, senderId) {
  return db.prepare(
    "SELECT direction, body, created_at FROM messages WHERE page_id = ? AND sender_id = ? ORDER BY created_at ASC LIMIT 300"
  ).all(pageId, senderId);
}

// ═══════════════════════════════════════════════════════════
// دوال المستخدمين
// ═══════════════════════════════════════════════════════════
export function getUser(username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username);
}

export function createUser(username, passwordHash) {
  return db.prepare(
    "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)"
  ).run(username, passwordHash, Date.now());
}

export function countUsers() {
  return db.prepare("SELECT COUNT(*) c FROM users").get().c;
}
