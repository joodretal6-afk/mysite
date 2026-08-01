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

// USE_LOCAL_DB=true → القاعدة الأساسية على قرص Render المحلي (الأكثر موثوقية)
//                     وتُستخدم بيانات Turso فقط كمصدر لنقل البيانات القديمة.
const USE_LOCAL = process.env.USE_LOCAL_DB === "true";
const REMOTE_PRIMARY = TURSO_URL && !USE_LOCAL;

// اتصال قابل لإعادة الفتح (Turso أحياناً يُنهي الـ stream فنعيد الاتصال)
export let db;
function connect() {
  db = REMOTE_PRIMARY
    ? new Database(TURSO_URL, { authToken: TURSO_TOKEN })
    : new Database(WEB.DB_PATH);
  if (!REMOTE_PRIMARY) { try { db.pragma("journal_mode = WAL"); } catch { /* تجاهل */ } }
  return db;
}
connect();
console.log(REMOTE_PRIMARY ? "☁️  متصل بـ Turso السحابي" : `💽 قاعدة محلية على القرص: ${WEB.DB_PATH}`);

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

  CREATE TABLE IF NOT EXISTS coupons (
    code       TEXT PRIMARY KEY,
    type       TEXT,              -- 'percent' نسبة مئوية / 'fixed' مبلغ ثابت
    value      REAL,
    active     INTEGER DEFAULT 1,
    uses       INTEGER DEFAULT 0,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS followups (
    key       TEXT PRIMARY KEY,   -- page_id + '_' + sender_id
    page_id   TEXT,
    sender_id TEXT,
    due_at    INTEGER,
    status    TEXT DEFAULT 'pending',  -- pending / sent / completed
    sends     INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS addons (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT,
    price       REAL,
    weight      TEXT,
    description TEXT,
    active      INTEGER DEFAULT 1,
    created_at  INTEGER
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id    TEXT,
    page_name  TEXT,
    sender_id  TEXT,
    phone      TEXT,
    rating     INTEGER,
    comment    TEXT,
    created_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
  CREATE INDEX IF NOT EXISTS idx_orders_page    ON orders(page_id);
  CREATE INDEX IF NOT EXISTS idx_orders_phone   ON orders(phone);
  CREATE INDEX IF NOT EXISTS idx_msg_conv       ON messages(page_id, sender_id, created_at);
`);

// أعمدة إضافية (ALTER آمن — SQLite لا يدعم IF NOT EXISTS للأعمدة)
for (const col of [
  "ALTER TABLE orders ADD COLUMN followed_up INTEGER DEFAULT 0",   // تمّت متابعة الطلب الناقص
  "ALTER TABLE orders ADD COLUMN reorder_sent INTEGER DEFAULT 0"   // أُرسل تذكير إعادة الطلب
]) {
  try { db.exec(col); } catch { /* العمود موجود */ }
}

// ── تنظيف دوري للمفاتيح المنتهية ──
function cleanupExpired() {
  db.prepare("DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at < ?").run(Date.now());
}
setInterval(cleanupExpired, 60 * 1000).unref?.();
cleanupExpired();

// 🔁 إعادة المحاولة مع إعادة فتح الاتصال — بتهدئة (throttle) لتفادي عاصفة الاتصالات
const _NET_ERR = /EOF|Hrana|cursor error|connection|reset|timeout|stream|broken pipe|not found|closed|502|bad gateway|upstream/i;
let _lastReconnect = 0;
const _sleep = ms => { const end = Date.now() + ms; while (Date.now() < end) { /* backoff قصير */ } };

export function retryDb(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return fn(); }
    catch (e) {
      last = e;
      const msg = String((e && e.message) || "");
      if (!_NET_ERR.test(msg)) throw e;
      // أعد فتح الاتصال مرة واحدة كل ثانيتين كحد أقصى (لتفادي إغراق Turso)
      const now = Date.now();
      if (now - _lastReconnect > 2000) {
        _lastReconnect = now;
        try { connect(); } catch (ce) { console.error("reconnect failed:", ce && ce.message); }
      }
      if (i < tries - 1) _sleep(150 * (i + 1));   // مهلة تصاعدية بسيطة قبل المحاولة
    }
  }
  throw last;
}

// ═══════════════════════════════════════════════════════════
// محوّل KV متوافق مع Cloudflare Workers KV
// يدعم: get(key, "json") / put(key, value, {expirationTtl}) / delete(key)
// ═══════════════════════════════════════════════════════════
// نصوص SQL (نحضّرها من الاتصال الحالي في كل نداء ليعمل reconnect بأمان)
const KV_GET = "SELECT value, expires_at FROM kv WHERE key = ?";
const KV_PUT = `INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`;
const KV_DEL = "DELETE FROM kv WHERE key = ?";

export const SESSIONS_KV = {
  async get(key, type) {
    const row = retryDb(() => db.prepare(KV_GET).get(key));
    if (!row) return null;
    if (row.expires_at != null && row.expires_at < Date.now()) {
      retryDb(() => db.prepare(KV_DEL).run(key));
      return null;
    }
    if (type === "json") {
      try { return JSON.parse(row.value); } catch { return null; }
    }
    return row.value;
  },

  async put(key, value, opts = {}) {
    const expiresAt = opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null;
    retryDb(() => db.prepare(KV_PUT).run(key, String(value), expiresAt));
  },

  async delete(key) {
    retryDb(() => db.prepare(KV_DEL).run(key));
  }
};

// ═══════════════════════════════════════════════════════════
// دوال الأوردرات
// ═══════════════════════════════════════════════════════════
// نستخدم بارامترات ترتيبية (?) — الأضمن مع Turso/libsql
const INSERT_ORDER = `INSERT INTO orders (page_id, page_name, sender_id, order_string, total, area, phone, status, messenger_url, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function saveOrder(o) {
  const info = retryDb(() => db.prepare(INSERT_ORDER).run(
    String(o.page_id || ""),
    String(o.page_name || ""),
    String(o.sender_id || ""),
    String(o.order_string || ""),
    Number(o.total) || 0,
    String(o.area || ""),
    String(o.phone || ""),
    String(o.status || "جديد"),
    String(o.messenger_url || ""),
    Number(o.created_at) || Date.now()
  ));
  const id = Number(info.lastInsertRowid);   // تفادي BigInt عند إرجاعه كـ JSON
  console.log(`💾 order saved #${id}: ${o.page_name} | ${o.order_string} | ${o.total}د | ${o.area} | ${o.phone}`);
  return id;
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
  // LIMIT/OFFSET كأعداد صحيحة مضمّنة (Turso صارم: لا يقبلها كبارامترات عشرية)
  const lim = Math.max(1, parseInt(limit, 10) || 500);
  const off = Math.max(0, parseInt(offset, 10) || 0);

  const rows = retryDb(() => db.prepare(
    `SELECT * FROM orders ${clause} ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}`
  ).all(params));

  const totalCount = retryDb(() => db.prepare(
    `SELECT COUNT(*) AS c, COALESCE(SUM(total),0) AS sum FROM orders ${clause}`
  ).get(params));

  return { rows, count: Number(totalCount.c), sum: Number(totalCount.sum) };
}

// فحص وجود طلب مطابق (لمنع التكرار أثناء الاستخراج الجماعي)
export function getOrder(id) {
  return retryDb(() => db.prepare("SELECT * FROM orders WHERE id = ?").get(Number(id)));
}

export function orderExists(page_id, sender_id, order_string) {
  const row = db.prepare(
    "SELECT id FROM orders WHERE page_id = ? AND sender_id = ? AND order_string = ?"
  ).get(page_id, sender_id, order_string);
  return !!row;
}

// تحديث أوردر موجود (للتحديث اللحظي أثناء المحادثة)
export function updateOrder(id, f) {
  retryDb(() => db.prepare(
    "UPDATE orders SET order_string = ?, total = ?, area = ?, phone = ?, status = ? WHERE id = ?"
  ).run(
    String(f.order_string || ""),
    Number(f.total) || 0,
    String(f.area || ""),
    String(f.phone || ""),
    String(f.status || "جديد"),
    Number(id)
  ));
}

// تعديل حقول الأوردر من اللوحة (بدون المساس بالحالة)
export function editOrder(id, f) {
  db.prepare(
    "UPDATE orders SET order_string = ?, total = ?, area = ?, phone = ? WHERE id = ?"
  ).run(
    String(f.order_string || ""),
    Number(f.total) || 0,
    String(f.area || ""),
    String(f.phone || ""),
    Number(id)
  );
}

export function updateOrderStatus(id, status) {
  return db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, id);
}

export function deleteOrder(id) {
  return db.prepare("DELETE FROM orders WHERE id = ?").run(id);
}

export function distinctPages() {
  return retryDb(() => db.prepare(
    "SELECT DISTINCT page_id, page_name FROM orders WHERE page_name != '' ORDER BY page_name"
  ).all());
}

// إحصائيات لكل صفحة على حدة (لصفحة الأوردرات المنفصلة)
export function perPageStats() {
  return retryDb(() => db.prepare(`
    SELECT page_id, page_name,
           COUNT(*) AS count,
           COALESCE(SUM(total),0) AS sum,
           SUM(CASE WHEN status='جديد' THEN 1 ELSE 0 END) AS new_count,
           MAX(created_at) AS last_at
    FROM orders GROUP BY page_id ORDER BY count DESC
  `).all());
}

export function ordersStats() {
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  return retryDb(() => ({
    total:      db.prepare("SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders").get(),
    today:      db.prepare("SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE created_at >= ?").get(today0.getTime()),
    newCount:   db.prepare("SELECT COUNT(*) c FROM orders WHERE status = 'جديد'").get().c
  }));
}

// ═══════════════════════════════════════════════════════════
// دوال تغذية البوت بمعلومات إضافية (لكل صفحة)
// ═══════════════════════════════════════════════════════════
export function getKnowledge(pageId) {
  const row = retryDb(() => db.prepare("SELECT extra FROM page_knowledge WHERE page_id = ?").get(pageId));
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
const INSERT_MESSAGE = `INSERT INTO messages (page_id, page_name, sender_id, direction, body, created_at)
  VALUES (?, ?, ?, ?, ?, ?)`;

export function logMessage(m) {
  try {
    retryDb(() => db.prepare(INSERT_MESSAGE).run(
      String(m.page_id || ""),
      String(m.page_name || ""),
      String(m.sender_id || ""),
      String(m.direction || "in"),
      String(m.body || ""),
      Number(m.created_at) || Date.now()
    ));
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
  return retryDb(() => db.prepare("SELECT * FROM users WHERE username = ?").get(username));
}

export function createUser(username, passwordHash) {
  return db.prepare(
    "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)"
  ).run(username, passwordHash, Date.now());
}

export function countUsers() {
  return db.prepare("SELECT COUNT(*) c FROM users").get().c;
}

// ═══════════════════════════════════════════════════════════
// 📊 تحليلات المبيعات (توقيت الأردن +3)
// ═══════════════════════════════════════════════════════════
export function analyticsData({ from, to } = {}) {
  const where = [];
  const params = {};
  if (from) { where.push("created_at >= @from"); params.from = from; }
  if (to)   { where.push("created_at <= @to");   params.to = to; }
  const clause = where.length ? "WHERE " + where.join(" AND ") : "";
  // نستثني الطلبات الملغاة من الإيرادات
  const soldClause = (clause ? clause + " AND " : "WHERE ") + "status != 'ملغي'";

  return retryDb(() => ({
    totals:   db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders ${soldClause}`).get(params),
    byStatus: db.prepare(`SELECT status, COUNT(*) c FROM orders ${clause} GROUP BY status`).all(params),
    byPage:   db.prepare(`SELECT page_name, COUNT(*) c, COALESCE(SUM(total),0) s FROM orders ${soldClause} GROUP BY page_name ORDER BY c DESC`).all(params),
    byDay:    db.prepare(`SELECT date((created_at/1000)+10800,'unixepoch') d, COUNT(*) c, COALESCE(SUM(total),0) s
                          FROM orders ${soldClause} GROUP BY d ORDER BY d DESC LIMIT 30`).all(params),
    byHour:   db.prepare(`SELECT CAST(strftime('%H',(created_at/1000)+10800,'unixepoch') AS INTEGER) h, COUNT(*) c
                          FROM orders ${clause} GROUP BY h ORDER BY h`).all(params)
  }));
}

// تقارير جاهزة (اليوم/الأسبوع/الشهر)
export function salesReport() {
  const now = Date.now();
  const day = 86400000;
  const q = (fromTs) => retryDb(() => db.prepare(
    "SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE status != 'ملغي' AND created_at >= ?"
  ).get(fromTs));
  return {
    today: q(new Date().setHours(0, 0, 0, 0)),
    week:  q(now - 7 * day),
    month: q(now - 30 * day),
    all:   retryDb(() => db.prepare("SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE status != 'ملغي'").get())
  };
}

// ═══════════════════════════════════════════════════════════
// 👥 ملف الزبائن (CRM) — تجميع حسب رقم الهاتف
// ═══════════════════════════════════════════════════════════
export function listCustomers({ search } = {}) {
  const s = search ? `%${search}%` : "";
  const cond = search ? "AND (phone LIKE @s OR area LIKE @s)" : "";
  return retryDb(() => db.prepare(`
    SELECT phone, MAX(sender_id) sender_id, MAX(area) area,
           COUNT(*) orders_count, COALESCE(SUM(total),0) total_spent,
           MAX(created_at) last_at, MAX(page_name) last_page,
           MAX(messenger_url) messenger_url
    FROM orders WHERE phone != '' ${cond}
    GROUP BY phone ORDER BY orders_count DESC, last_at DESC LIMIT 300
  `).all({ s }));
}
export function customerOrders(phone) {
  return retryDb(() => db.prepare(
    "SELECT * FROM orders WHERE phone = ? ORDER BY created_at DESC LIMIT 100"
  ).all(phone));
}

// ═══════════════════════════════════════════════════════════
// 🎟️ الكوبونات وأكواد الخصم
// ═══════════════════════════════════════════════════════════
export function listCoupons() {
  return retryDb(() => db.prepare("SELECT * FROM coupons ORDER BY created_at DESC").all());
}
export function addCoupon(code, type, value) {
  return retryDb(() => db.prepare(
    "INSERT INTO coupons (code,type,value,active,uses,created_at) VALUES (?,?,?,1,0,?) ON CONFLICT(code) DO UPDATE SET type=excluded.type, value=excluded.value, active=1"
  ).run(String(code).trim().toUpperCase(), type === "fixed" ? "fixed" : "percent", Number(value) || 0, Date.now()));
}
export function toggleCoupon(code, active) {
  return retryDb(() => db.prepare("UPDATE coupons SET active=? WHERE code=?").run(active ? 1 : 0, String(code).toUpperCase()));
}
export function deleteCoupon(code) {
  return retryDb(() => db.prepare("DELETE FROM coupons WHERE code=?").run(String(code).toUpperCase()));
}
export function getActiveCoupon(code) {
  if (!code) return null;
  return retryDb(() => db.prepare("SELECT * FROM coupons WHERE code=? AND active=1").get(String(code).trim().toUpperCase()));
}

// ═══════════════════════════════════════════════════════════
// 🔄 متابعة تلقائية للزبائن غير المكتملين (تايمر 10 دقائق لكل زبون)
// ═══════════════════════════════════════════════════════════
const FOLLOWUP_DELAY_MS = 10 * 60 * 1000;   // 10 دقائق بعد آخر رسالة

// تشغيل/إعادة ضبط التايمر عند كل رسالة من زبون لم يُكمل (مرة متابعة واحدة فقط)
export function armFollowup(pageId, senderId) {
  const key = pageId + "_" + senderId;
  const due = Date.now() + FOLLOWUP_DELAY_MS;
  retryDb(() => {
    const row = db.prepare("SELECT sends, status FROM followups WHERE key = ?").get(key);
    if (row && (row.sends >= 1 || row.status === "completed")) return;  // تابعناه مسبقاً أو أكمل
    db.prepare(`INSERT INTO followups (key,page_id,sender_id,due_at,status,sends)
                VALUES (?,?,?,?, 'pending', 0)
                ON CONFLICT(key) DO UPDATE SET due_at=excluded.due_at, status='pending'`)
      .run(key, pageId, senderId, due);
  });
}
// عند اكتمال الطلب: لا تتابعه نهائياً
export function completeFollowup(pageId, senderId) {
  retryDb(() => db.prepare("UPDATE followups SET status='completed' WHERE key = ?").run(pageId + "_" + senderId));
}
// الزبائن الذين حان وقت متابعتهم
export function dueFollowups() {
  return retryDb(() => db.prepare(
    "SELECT * FROM followups WHERE status='pending' AND due_at <= ?"
  ).all(Date.now()));
}
export function markFollowupSent(key) {
  retryDb(() => db.prepare("UPDATE followups SET status='sent', sends=sends+1 WHERE key = ?").run(key));
}

// ═══════════════════════════════════════════════════════════
// 🎁 برنامج الولاء — عدد الطلبات المكتملة للزبون
// ═══════════════════════════════════════════════════════════
export function customerCompletedCount(phone) {
  if (!phone) return 0;
  return retryDb(() => db.prepare(
    "SELECT COUNT(*) c FROM orders WHERE phone = ? AND status != 'ملغي' AND status != 'ناقص'"
  ).get(phone)).c;
}
export function customerCompletedCountBySender(senderId) {
  if (!senderId) return 0;
  return retryDb(() => db.prepare(
    "SELECT COUNT(*) c FROM orders WHERE sender_id = ? AND status != 'ملغي' AND status != 'ناقص'"
  ).get(senderId)).c;
}

// ═══════════════════════════════════════════════════════════
// ⏰ تذكير إعادة الطلب — زبائن آخر طلب لهم قديم
// ═══════════════════════════════════════════════════════════
export function dueForReorder(days = 14) {
  const cutoff = Date.now() - days * 86400000;
  return retryDb(() => db.prepare(
    `SELECT phone, MAX(sender_id) sender_id, MAX(page_id) page_id, MAX(page_name) page_name,
            MAX(created_at) last_at, COUNT(*) orders_count, MAX(messenger_url) messenger_url,
            MAX(reorder_sent) reorder_sent
     FROM orders WHERE phone != '' AND status != 'ناقص'
     GROUP BY phone HAVING last_at < ? ORDER BY last_at DESC LIMIT 300`
  ).all(cutoff));
}
export function markReorderSent(phone) {
  retryDb(() => db.prepare("UPDATE orders SET reorder_sent = 1 WHERE phone = ?").run(phone));
}

// ═══════════════════════════════════════════════════════════
// ⭐ التقييمات
// ═══════════════════════════════════════════════════════════
export function addReview(r) {
  retryDb(() => db.prepare(
    "INSERT INTO reviews (page_id,page_name,sender_id,phone,rating,comment,created_at) VALUES (?,?,?,?,?,?,?)"
  ).run(String(r.page_id||""), String(r.page_name||""), String(r.sender_id||""), String(r.phone||""), Number(r.rating)||0, String(r.comment||""), Date.now()));
}
export function listReviews() {
  return retryDb(() => db.prepare("SELECT * FROM reviews ORDER BY created_at DESC LIMIT 300").all());
}
export function reviewStats() {
  return retryDb(() => db.prepare("SELECT COUNT(*) c, COALESCE(AVG(rating),0) avg FROM reviews WHERE rating > 0").get());
}

// ═══════════════════════════════════════════════════════════
// 🛒 المنتجات الإضافية (بيع إضافي — موحّدة لكل الصفحات)
// ═══════════════════════════════════════════════════════════
export function listAddons() {
  return retryDb(() => db.prepare("SELECT * FROM addons ORDER BY created_at DESC").all());
}
export function getActiveAddons() {
  return retryDb(() => db.prepare("SELECT * FROM addons WHERE active = 1 ORDER BY id").all());
}
export function addAddon(a) {
  return retryDb(() => db.prepare(
    "INSERT INTO addons (name,price,weight,description,active,created_at) VALUES (?,?,?,?,1,?)"
  ).run(String(a.name||"").trim(), Number(a.price)||0, String(a.weight||""), String(a.description||""), Date.now()));
}
export function updateAddon(id, a) {
  return retryDb(() => db.prepare(
    "UPDATE addons SET name=?, price=?, weight=?, description=? WHERE id=?"
  ).run(String(a.name||"").trim(), Number(a.price)||0, String(a.weight||""), String(a.description||""), Number(id)));
}
export function toggleAddon(id, active) {
  return retryDb(() => db.prepare("UPDATE addons SET active=? WHERE id=?").run(active?1:0, Number(id)));
}
export function deleteAddon(id) {
  return retryDb(() => db.prepare("DELETE FROM addons WHERE id=?").run(Number(id)));
}

// ═══════════════════════════════════════════════════════════
// 🚚 نقل البيانات القديمة من Turso إلى القرص المحلي (مرة واحدة)
// يعمل عندما USE_LOCAL_DB=true + بيانات Turso متوفّرة كمصدر.
// آمن للتكرار: محمي بعلامة داخلية، ويتجاهل الفشل (يعيد المحاولة لاحقاً).
// ═══════════════════════════════════════════════════════════
export function migrateFromTurso() {
  if (!USE_LOCAL || !TURSO_URL) return false;   // فقط بوضع القرص المحلي مع مصدر Turso
  try {
    const done = db.prepare("SELECT value FROM kv WHERE key = '__migrated_turso'").get();
    if (done) return true;   // تمّ النقل مسبقاً
  } catch { /* الجدول قد لا يكون جاهزاً */ }

  let src;
  try {
    src = new Database(TURSO_URL, { authToken: TURSO_TOKEN });
    const orders = src.prepare(
      "SELECT page_id,page_name,sender_id,order_string,total,area,phone,status,messenger_url,created_at FROM orders"
    ).all();

    const insO = db.prepare(INSERT_ORDER);
    let n = 0;
    for (const o of orders) {
      insO.run(o.page_id, o.page_name, o.sender_id, o.order_string, o.total, o.area, o.phone, o.status, o.messenger_url, o.created_at);
      n++;
    }

    // الرسائل (اختياري)
    try {
      const msgs = src.prepare("SELECT page_id,page_name,sender_id,direction,body,created_at FROM messages").all();
      const insM = db.prepare(INSERT_MESSAGE);
      for (const m of msgs) insM.run(m.page_id, m.page_name, m.sender_id, m.direction, m.body, m.created_at);
    } catch { /* تجاهل */ }

    // معلومات التغذية (اختياري)
    try {
      const ks = src.prepare("SELECT page_id,extra,updated_at FROM page_knowledge").all();
      for (const k of ks) {
        db.prepare("INSERT INTO page_knowledge (page_id,extra,updated_at) VALUES (?,?,?) ON CONFLICT(page_id) DO UPDATE SET extra=excluded.extra").run(k.page_id, k.extra, k.updated_at);
      }
    } catch { /* تجاهل */ }

    db.prepare("INSERT INTO kv (key,value,expires_at) VALUES ('__migrated_turso','1',NULL) ON CONFLICT(key) DO NOTHING").run();
    console.log(`✅ تم نقل ${n} أوردر من Turso إلى القرص المحلي`);
    return true;
  } catch (e) {
    console.error("⏳ نقل Turso لم ينجح بعد (غالباً Turso متعطّل الآن)، سيعيد المحاولة:", e && e.message);
    return false;
  } finally {
    try { src && src.close && src.close(); } catch { /* تجاهل */ }
  }
}
