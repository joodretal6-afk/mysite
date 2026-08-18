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
let _remoteActive = false;   // هل القاعدة الأساسية فعلاً هي Turso السحابي؟
function connect() {
  // 🔴 حماية الإقلاع: لو فشل الاتصال بـ Turso وقت التشغيل (توكن منتهي،
  //    شبكة، عنوان غلط) — بلا هالحماية كان الاستثناء بيوقع البروسيس
  //    كله وقت التحميل، فترجع Render 502 دائم والمنصة كلها تنطفي.
  //    القاعدة: نجرّب السحابي، وإذا فشل ننزل على القرص المحلي ونكمّل
  //    شغل (المنصة حيّة > المنصة ميتة)، مع تحذير صارخ للمالك.
  if (REMOTE_PRIMARY) {
    try {
      db = new Database(TURSO_URL, { authToken: TURSO_TOKEN });
      db.prepare("SELECT 1").get();   // نتأكد إنه الاتصال فعلاً شغّال
      _remoteActive = true;
      return db;
    } catch (e) {
      console.error(`🔴🔴 فشل الاتصال بـ Turso السحابي عند الإقلاع: ${e && e.message}`);
      console.error("⚠️ المنصة رح تكمّل على قاعدة محلية عشان ما تنطفي — صلّح توكن/عنوان Turso بأقرب وقت.");
    }
  }
  db = new Database(WEB.DB_PATH);
  _remoteActive = false;
  try { db.pragma("journal_mode = WAL"); } catch { /* تجاهل */ }
  return db;
}
connect();
console.log(_remoteActive ? "☁️  متصل بـ Turso السحابي" : `💽 قاعدة محلية على القرص: ${WEB.DB_PATH}`);

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

  CREATE TABLE IF NOT EXISTS activity_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT,
    action     TEXT,
    detail     TEXT,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS product_costs (
    product    TEXT PRIMARY KEY,   -- اسم الصنف (يطابق مفاتيح الأسعار)
    cost       REAL,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS inventory (
    product    TEXT PRIMARY KEY,   -- اسم الصنف (يطابق مفاتيح الأسعار)
    stock      REAL DEFAULT 0,     -- الكمية المتوفّرة
    low        REAL DEFAULT 5,     -- حد التنبيه
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS blocklist (
    sender_id  TEXT PRIMARY KEY,
    page_id    TEXT,
    note       TEXT,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS price_overrides (
    page_id    TEXT,
    product    TEXT,
    price      REAL,
    updated_at INTEGER,
    PRIMARY KEY (page_id, product)
  );

  CREATE TABLE IF NOT EXISTS market_studies (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product    TEXT,               -- اسم المنتج
    score      INTEGER DEFAULT 0,  -- Opportunity Score /100
    wholesale  REAL DEFAULT 0,     -- سعر الجملة التقريبي
    sell       REAL DEFAULT 0,     -- سعر البيع المقترح
    category   TEXT DEFAULT '',    -- الفئة (سيارات/منزل/...)
    status     TEXT DEFAULT 'مرشح', -- مرشح / تجربة / رابح / فاشل
    data       TEXT DEFAULT '',    -- البطاقة الكاملة (JSON: لماذا، جمهور، فيديوهات، زوايا، مخاطر...)
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS page_tokens (
    page_id    TEXT PRIMARY KEY,   -- معرّف الصفحة
    token      TEXT,               -- توكن الصفحة (يتجاوز توكن الكود)
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS goals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT,               -- عنوان الهدف (مثال: مبيعات 100 ألف)
    target     REAL,               -- القيمة المستهدفة بالدينار
    metric     TEXT DEFAULT 'revenue',  -- revenue (مبيعات) | orders (عدد طلبات)
    from_at    INTEGER,            -- بداية الفترة
    to_at      INTEGER,            -- نهاية الفترة
    status     TEXT DEFAULT 'نشط', -- نشط / مكتمل / ملغي
    plan       TEXT DEFAULT '',    -- خطة/ملاحظات المستشار (المطلوب لتحقيقه)
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS handoffs (
    session_key TEXT PRIMARY KEY,  -- page_id + '_' + sender_id (طلب تدخّل واحد مفتوح لكل زبون)
    page_id     TEXT,
    page_name   TEXT,
    sender_id   TEXT,
    reason      TEXT,              -- سبب التدخّل (غضب / يطلب موظف / تكرار سؤال)
    snippet     TEXT,              -- مقتطف من رسالة الزبون
    paused      INTEGER DEFAULT 0, -- هل البوت معلّق لهذا الزبون
    status      TEXT DEFAULT 'open', -- open / closed
    created_at  INTEGER,
    updated_at  INTEGER
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
  "ALTER TABLE orders ADD COLUMN reorder_sent INTEGER DEFAULT 0",  // أُرسل تذكير إعادة الطلب
  "ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'admin'",        // دور المستخدم
  "ALTER TABLE orders ADD COLUMN postsale_sent INTEGER DEFAULT 0", // أُرسلت متابعة ما بعد البيع
  "ALTER TABLE orders ADD COLUMN cancel_reason TEXT DEFAULT ''",   // سبب الإلغاء (لتحليله)
  // ثقة العنوان — عشان تعرف أي فاتورة عنوانها مؤكّد وأيها يحتاج مراجعة
  "ALTER TABLE orders ADD COLUMN address_score INTEGER DEFAULT -1", // 0-100 (-1 = غير مقاس، طلبات قديمة)
  "ALTER TABLE orders ADD COLUMN address_level TEXT DEFAULT ''"     // مؤكّد / كافٍ / ناقص / غير كافٍ
]) {
  try { db.exec(col); } catch { /* العمود موجود */ }
}

// ═══════════════════════════════════════════════════════════
// 📇 فهارس الأداء
// كل محركات التحليل بتمشّط messages و orders بالتاريخ والمرسل.
// بلا هالفهارس كل استعلام بيمسح الجدول كامل — وبتكبر المشكلة مع
// كل يوم بيمر لأن الجداول بتزيد ولا بتنقص.
// ═══════════════════════════════════════════════════════════
for (const idx of [
  "CREATE INDEX IF NOT EXISTS idx_msg_created ON messages(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_msg_dir_created ON messages(direction, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_msg_sender ON messages(page_id, sender_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_orders_sender ON orders(sender_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_kv_expires ON kv(expires_at) WHERE expires_at IS NOT NULL"
]) {
  try { db.exec(idx); } catch (e) { console.error("فهرس:", e.message); }
}

// ── ترحيل: إصلاح روابط الماسنجر القديمة ──
// الطلبات المحفوظة قبل هيك خزّنت https://m.me/<sender_id>، والـ sender_id
// هو PSID مربوط بالصفحة — و m.me بيتوقّع معرّف صفحة، فكان بيطلع "غير متوفر".
// منستبدلها برابط صندوق الصفحة، وهو الوحيد اللي بيفتح المحادثة فعلاً.
try {
  const done = db.prepare("SELECT value FROM kv WHERE key = '__fixed_mme_links'").get();
  if (!done) {
    const r = db.prepare(
      `UPDATE orders
          SET messenger_url = 'https://www.facebook.com/' || page_id ||
                              '/inbox/?selected_item_id=' || sender_id
        WHERE messenger_url LIKE 'https://m.me/%'
          AND page_id IS NOT NULL AND page_id <> ''
          AND sender_id IS NOT NULL AND sender_id <> ''`
    ).run();
    // الصفوف اللي بلا page_id ما إلها رابط صالح أصلاً — نفضّيها بدل ما نخلّيها مكسورة
    db.prepare(
      `UPDATE orders SET messenger_url = ''
        WHERE messenger_url LIKE 'https://m.me/%'`
    ).run();
    db.prepare("INSERT INTO kv (key,value,expires_at) VALUES ('__fixed_mme_links','1',NULL) ON CONFLICT(key) DO NOTHING").run();
    const n = Number(r && r.changes) || 0;
    if (n) console.log(`🔗 صُلّح ${n} رابط ماسنجر قديم (كانت m.me وما بتفتح)`);
  }
} catch (e) { console.error("ترحيل روابط الماسنجر:", e.message); }

// ── تنظيف دوري للمفاتيح المنتهية ──
function cleanupExpired() {
  db.prepare("DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at < ?").run(Date.now());
}
setInterval(cleanupExpired, 60 * 1000).unref?.();
cleanupExpired();

// 🔁 إعادة المحاولة مع إعادة فتح الاتصال — بتهدئة (throttle) لتفادي عاصفة الاتصالات
// أخطاء شبكة/stream حقيقية من libsql/Hrana فقط (لا نعيد المحاولة لأخطاء منطقية)
const _NET_ERR = /Hrana|stream not found|unexpected EOF|broken pipe|upstream forward failed|502|bad gateway|ECONNRESET|ETIMEDOUT|socket hang up|connection (reset|closed|refused)/i;
let _lastReconnect = 0;

export function retryDb(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return fn(); }
    catch (e) {
      last = e;
      const msg = String((e && e.message) || "");
      if (!_NET_ERR.test(msg)) throw e;
      // أعد فتح الاتصال مرة واحدة كل ثانيتين كحد أقصى (بدون حجب المعالج بحلقة انتظار)
      const now = Date.now();
      if (now - _lastReconnect > 2000) {
        _lastReconnect = now;
        try { connect(); } catch (ce) { console.error("reconnect failed:", ce && ce.message); }
      }
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
const INSERT_ORDER = `INSERT INTO orders (page_id, page_name, sender_id, order_string, total, area, phone, status, messenger_url, created_at, address_score, address_level)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function saveOrder(o) {
  // 🔴 حاجز الهوية على مستوى قاعدة البيانات (دفاع بالعمق، مستقل عن
  //    الـ prompt والمنطق الأعلى): ممنوع نحفظ طلب بلا صفحة أو مرسِل،
  //    وإذا انبعتت بصمة الجلسة لازم تطابق page_id_sender_id — وإلا
  //    يعني بيانات تجمّعت من سياق غلط، فبنرفض الحفظ كلياً.
  const pageId = String(o.page_id || "");
  const senderId = String(o.sender_id || "");
  if (!pageId || !senderId)
    throw new Error(`saveOrder مرفوض: هوية ناقصة (page_id="${pageId}" sender_id="${senderId}")`);
  if (o.session_key && o.session_key !== `${pageId}_${senderId}`)
    throw new Error(`saveOrder مرفوض: بصمة الجلسة (${o.session_key}) لا تطابق ${pageId}_${senderId}`);
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
    Number(o.created_at) || Date.now(),
    Number.isFinite(Number(o.address_score)) ? Number(o.address_score) : -1,
    String(o.address_level || "")
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

// أحدث أوردر مفتوح لنفس الزبون خلال 6 ساعات (لمنع تكرار الصفوف عند انتهاء الجلسة)
export function getRecentOpenOrderId(pageId, senderId) {
  if (!senderId) return null;
  const since = Date.now() - 6 * 3600 * 1000;
  const row = retryDb(() => db.prepare(
    "SELECT id FROM orders WHERE page_id=? AND sender_id=? AND status IN ('ناقص','جديد') AND created_at>=? ORDER BY created_at DESC LIMIT 1"
  ).get(pageId, senderId, since));
  return row ? row.id : null;
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
  return retryDb(() => db.prepare(
    "UPDATE orders SET order_string = ?, total = ?, area = ?, phone = ? WHERE id = ?"
  ).run(
    String(f.order_string || ""),
    Number(f.total) || 0,
    String(f.area || ""),
    String(f.phone || ""),
    Number(id)
  ));
}

export function updateOrderStatus(id, status) {
  return retryDb(() => db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(String(status), Number(id)));
}

export function deleteOrder(id) {
  return retryDb(() => db.prepare("DELETE FROM orders WHERE id = ?").run(Number(id)));
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
  retryDb(() => db.prepare(`
    INSERT INTO page_knowledge (page_id, extra, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(page_id) DO UPDATE SET extra = excluded.extra, updated_at = excluded.updated_at
  `).run(pageId, String(extra || ""), Date.now()));
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
  return retryDb(() => db.prepare(
    "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)"
  ).run(username, passwordHash, Date.now()));
}

export function addUser(username, passwordHash, role = "staff") {
  return retryDb(() => db.prepare(
    "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)"
  ).run(username, passwordHash, role, Date.now()));
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
  const cond = search ? "AND (phone LIKE @s OR area LIKE @s)" : "";
  const params = search ? { s: `%${search}%` } : {};   // لا نمرّر بارامتر غير مستخدم
  return retryDb(() => db.prepare(`
    SELECT phone, MAX(sender_id) sender_id, MAX(area) area,
           COUNT(*) orders_count, COALESCE(SUM(total),0) total_spent,
           MAX(created_at) last_at, MAX(page_name) last_page,
           MAX(messenger_url) messenger_url
    FROM orders WHERE phone != '' ${cond}
    GROUP BY phone ORDER BY orders_count DESC, last_at DESC LIMIT 300
  `).all(params));
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
export function getActiveCouponsList() {
  return retryDb(() => db.prepare("SELECT code,type,value FROM coupons WHERE active=1").all());
}
export function incrementCouponUse(code) {
  return retryDb(() => db.prepare("UPDATE coupons SET uses=uses+1 WHERE code=?").run(String(code).toUpperCase()));
}

// ⚠️ حُذفت دوال المتابعة التلقائية (followups) نهائياً — لا إرسال استباقي.

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

// ⚠️ حُذفت دوال "تذكير إعادة الطلب" نهائياً — لا إرسال ترويجي استباقي.

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
// 📝 سجل النشاط
// ═══════════════════════════════════════════════════════════
export function logActivity(username, action, detail) {
  try {
    retryDb(() => db.prepare("INSERT INTO activity_log (username,action,detail,created_at) VALUES (?,?,?,?)")
      .run(String(username || "?"), String(action || ""), String(detail || ""), Date.now()));
  } catch (e) { console.error("logActivity:", e && e.message); }
}
export function listActivity() {
  return retryDb(() => db.prepare("SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 300").all());
}

// ═══════════════════════════════════════════════════════════
// 💰 التكاليف والأرباح
// ═══════════════════════════════════════════════════════════
export function setCost(product, cost) {
  retryDb(() => db.prepare("INSERT INTO product_costs (product,cost,updated_at) VALUES (?,?,?) ON CONFLICT(product) DO UPDATE SET cost=excluded.cost, updated_at=excluded.updated_at")
    .run(String(product).trim(), Number(cost) || 0, Date.now()));
}
export function getCosts() {
  return retryDb(() => db.prepare("SELECT product,cost FROM product_costs").all());
}
export function deleteCost(product) {
  retryDb(() => db.prepare("DELETE FROM product_costs WHERE product=?").run(String(product)));
}
// حساب تكلفة الطلبات (من order_string: "صنف (عدد وحدة) + ...") مقابل خريطة التكاليف
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
export function profitReport({ from, to } = {}) {
  const where = ["status != 'ملغي'", "status != 'ناقص'"];
  const params = {};
  if (from) { where.push("created_at >= @from"); params.from = from; }
  if (to)   { where.push("created_at <= @to");   params.to = to; }
  const clause = "WHERE " + where.join(" AND ");
  const rows = retryDb(() => db.prepare(`SELECT order_string, total FROM orders ${clause}`).all(params));
  const costs = {};
  for (const c of getCosts()) costs[c.product] = c.cost;
  let revenue = 0, cost = 0;
  for (const r of rows) {
    revenue += Number(r.total) || 0;
    for (const part of String(r.order_string || "").split("+")) {
      const m = part.match(/(.+?)\s*\((\d+(?:\.\d+)?)/);   // "غنم (2 نصية)"
      if (m) {
        const name = m[1].trim(); const qty = parseFloat(m[2]) || 0;
        if (costs[name] != null) cost += costs[name] * qty;
      }
    }
  }
  return { revenue: round2(revenue), cost: round2(cost), profit: round2(revenue - cost), orders: rows.length };
}

// ═══════════════════════════════════════════════════════════
// 📦 إدارة المخزون
// ═══════════════════════════════════════════════════════════
export function listInventory() {
  return retryDb(() => db.prepare("SELECT product, stock, low FROM inventory ORDER BY product").all());
}
export function setInventory(product, stock, low) {
  retryDb(() => db.prepare(
    `INSERT INTO inventory (product,stock,low,updated_at) VALUES (?,?,?,?)
     ON CONFLICT(product) DO UPDATE SET stock=excluded.stock, low=excluded.low, updated_at=excluded.updated_at`
  ).run(String(product).trim(), Number(stock) || 0, Number(low) || 0, Date.now()));
}
export function deleteInventory(product) {
  retryDb(() => db.prepare("DELETE FROM inventory WHERE product=?").run(String(product)));
}
// خصم كميات طلب من المخزون (من order_string: "صنف (عدد وحدة) + ...")
export function decrementStock(orderString) {
  try {
    const map = {};
    for (const c of listInventory()) map[c.product] = true;
    for (const part of String(orderString || "").split("+")) {
      const m = part.match(/(.+?)\s*\((\d+(?:\.\d+)?)/);
      if (m) {
        const name = m[1].trim(); const qty = parseFloat(m[2]) || 0;
        if (map[name] && qty > 0) {
          retryDb(() => db.prepare("UPDATE inventory SET stock = stock - ?, updated_at=? WHERE product=?")
            .run(qty, Date.now(), name));
        }
      }
    }
  } catch (e) { console.error("decrementStock:", e && e.message); }
}
export function lowStockList() {
  return retryDb(() => db.prepare("SELECT product, stock, low FROM inventory WHERE stock <= low ORDER BY stock").all());
}

// ═══════════════════════════════════════════════════════════
// 🔎 دراسات السوق (Product Hunter) — خط أنابيب المنتجات مع التعلم من النتائج
// ═══════════════════════════════════════════════════════════
export function addStudy(s) {
  const info = retryDb(() => db.prepare(
    "INSERT INTO market_studies (product,score,wholesale,sell,category,status,data,created_at) VALUES (?,?,?,?,?,'مرشح',?,?)"
  ).run(String(s.product || "").slice(0, 150), Math.min(100, Number(s.score) || 0),
        Number(s.wholesale) || 0, Number(s.sell) || 0, String(s.category || "").slice(0, 60),
        JSON.stringify(s.data || {}).slice(0, 8000), Date.now()));
  return Number(info.lastInsertRowid);
}
export function listStudies() {
  return retryDb(() => db.prepare("SELECT * FROM market_studies ORDER BY created_at DESC LIMIT 200").all())
    .map(r => { try { r.data = JSON.parse(r.data || "{}"); } catch { r.data = {}; } return r; });
}
export function getStudy(id) {
  const r = retryDb(() => db.prepare("SELECT * FROM market_studies WHERE id=?").get(Number(id)));
  if (r) { try { r.data = JSON.parse(r.data || "{}"); } catch { r.data = {}; } }
  return r || null;
}
export function updateStudyData(id, patch) {
  const s = getStudy(id);
  if (!s) return false;
  const data = { ...(s.data || {}), ...patch };
  retryDb(() => db.prepare("UPDATE market_studies SET data=? WHERE id=?")
    .run(JSON.stringify(data).slice(0, 16000), Number(id)));
  return true;
}
export function studiesToday() {
  const dayStart = new Date().setHours(0, 0, 0, 0);
  return retryDb(() => db.prepare(
    "SELECT COUNT(*) c, SUM(CASE WHEN score>=80 THEN 1 ELSE 0 END) hot FROM market_studies WHERE created_at >= ?"
  ).get(dayStart));
}
export function setStudyStatus(id, status) {
  const allowed = ["مرشح", "تجربة", "رابح", "فاشل"];
  if (!allowed.includes(status)) return;
  retryDb(() => db.prepare("UPDATE market_studies SET status=? WHERE id=?").run(status, Number(id)));
}
export function deleteStudy(id) {
  retryDb(() => db.prepare("DELETE FROM market_studies WHERE id=?").run(Number(id)));
}
// ملخص نتائج التجارب (للتعلم): المنتجات الرابحة والفاشلة وأنماطها
export function studyOutcomes() {
  const rows = retryDb(() => db.prepare(
    "SELECT product, score, wholesale, sell, category, status FROM market_studies WHERE status IN ('رابح','فاشل','تجربة') ORDER BY created_at DESC LIMIT 60"
  ).all());
  return rows;
}

// ═══════════════════════════════════════════════════════════
// 🔑 توكنات الصفحات المُدارة من الموقع (تتجاوز توكنات الكود)
// ═══════════════════════════════════════════════════════════
export function setPageToken(pageId, token) {
  retryDb(() => db.prepare(
    "INSERT INTO page_tokens (page_id,token,updated_at) VALUES (?,?,?) ON CONFLICT(page_id) DO UPDATE SET token=excluded.token, updated_at=excluded.updated_at"
  ).run(String(pageId).trim(), String(token).trim(), Date.now()));
}
export function getPageTokenOverrides() {
  try { return retryDb(() => db.prepare("SELECT page_id, token, updated_at FROM page_tokens").all()); }
  catch { return []; }
}
export function deletePageToken(pageId) {
  retryDb(() => db.prepare("DELETE FROM page_tokens WHERE page_id=?").run(String(pageId)));
}

// ═══════════════════════════════════════════════════════════
// 🎯 أهداف المبيعات (يُنشئها المستشار أو الأدمن) مع حساب تقدّم حيّ
// ═══════════════════════════════════════════════════════════
export function addGoal({ title, target, metric = "revenue", from_at, to_at, plan = "" }) {
  const dayStart = new Date().setHours(0, 0, 0, 0);   // يبدأ العدّ من بداية اليوم (طلبات اليوم تنحسب)
  const info = retryDb(() => db.prepare(
    "INSERT INTO goals (title,target,metric,from_at,to_at,status,plan,created_at) VALUES (?,?,?,?,?,'نشط',?,?)"
  ).run(String(title || "").slice(0, 200), Number(target) || 0, metric === "orders" ? "orders" : "revenue",
        Number(from_at) || dayStart, Number(to_at) || Date.now() + 30 * 86400000, String(plan || "").slice(0, 2000), Date.now()));
  return Number(info.lastInsertRowid);
}
export function listGoalsWithProgress() {
  const goals = retryDb(() => db.prepare("SELECT * FROM goals ORDER BY created_at DESC LIMIT 100").all());
  return goals.map(g => {
    const row = retryDb(() => db.prepare(
      "SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE status != 'ملغي' AND status != 'ناقص' AND created_at >= ? AND created_at <= ?"
    ).get(Number(g.from_at), Number(g.to_at)));
    const current = g.metric === "orders" ? Number(row.c) : Number(row.s);
    const pct = g.target > 0 ? Math.min(100, Math.round(current / g.target * 100)) : 0;
    return { ...g, current: Math.round(current * 100) / 100, pct,
      daysLeft: Math.max(0, Math.ceil((Number(g.to_at) - Date.now()) / 86400000)) };
  });
}
export function setGoalStatus(id, status) {
  retryDb(() => db.prepare("UPDATE goals SET status=? WHERE id=?").run(String(status).slice(0, 20), Number(id)));
}
export function deleteGoal(id) {
  retryDb(() => db.prepare("DELETE FROM goals WHERE id=?").run(Number(id)));
}

// ═══════════════════════════════════════════════════════════
// 🙋 التدخّل البشري (Human Handoff) — كشف الزبون الغاضب/المتردّد
// ═══════════════════════════════════════════════════════════
export function flagHandoff({ page_id, page_name, sender_id, reason, snippet, pause = 1 }) {
  const key = `${page_id}_${sender_id}`;
  const now = Date.now();
  retryDb(() => db.prepare(
    `INSERT INTO handoffs (session_key,page_id,page_name,sender_id,reason,snippet,paused,status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?, 'open', ?, ?)
     ON CONFLICT(session_key) DO UPDATE SET
       reason=excluded.reason, snippet=excluded.snippet,
       paused=MAX(handoffs.paused, excluded.paused), status='open', updated_at=excluded.updated_at`
  ).run(key, String(page_id || ""), String(page_name || ""), String(sender_id || ""),
        String(reason || ""), String(snippet || "").slice(0, 300), pause ? 1 : 0, now, now));
  return key;
}
export function isBotPaused(page_id, sender_id) {
  const row = retryDb(() => db.prepare(
    "SELECT paused, status FROM handoffs WHERE session_key = ?"
  ).get(`${page_id}_${sender_id}`));
  return Boolean(row && row.status === "open" && row.paused);
}
export function listHandoffs() {
  return retryDb(() => db.prepare(
    "SELECT * FROM handoffs WHERE status = 'open' ORDER BY updated_at DESC LIMIT 200"
  ).all());
}
export function setHandoffPause(session_key, paused) {
  retryDb(() => db.prepare("UPDATE handoffs SET paused=?, updated_at=? WHERE session_key=?")
    .run(paused ? 1 : 0, Date.now(), String(session_key)));
}
export function resolveHandoff(session_key) {
  retryDb(() => db.prepare("UPDATE handoffs SET status='closed', paused=0, updated_at=? WHERE session_key=?")
    .run(Date.now(), String(session_key)));
}

// ═══════════════════════════════════════════════════════════
// ⚙️ إعدادات عامة (key/value) — هدف المبيعات، ساعات العمل...
// ═══════════════════════════════════════════════════════════
export function getSetting(key, def = null) {
  try {
    const r = retryDb(() => db.prepare("SELECT value FROM settings WHERE key = ?").get(String(key)));
    return r ? r.value : def;
  } catch { return def; }
}
export function setSetting(key, value) {
  retryDb(() => db.prepare(
    "INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  ).run(String(key), String(value)));
}

// ═══════════════════════════════════════════════════════════
// 🚫 حظر الزبائن المزعجين
// ═══════════════════════════════════════════════════════════
export function isBlocked(senderId) {
  if (!senderId) return false;
  const r = retryDb(() => db.prepare("SELECT sender_id FROM blocklist WHERE sender_id = ?").get(String(senderId)));
  return Boolean(r);
}
export function listBlocked() {
  return retryDb(() => db.prepare("SELECT * FROM blocklist ORDER BY created_at DESC").all());
}
export function addBlock(senderId, pageId, note) {
  retryDb(() => db.prepare(
    "INSERT INTO blocklist (sender_id,page_id,note,created_at) VALUES (?,?,?,?) ON CONFLICT(sender_id) DO UPDATE SET note=excluded.note"
  ).run(String(senderId), String(pageId || ""), String(note || ""), Date.now()));
}
export function removeBlock(senderId) {
  retryDb(() => db.prepare("DELETE FROM blocklist WHERE sender_id = ?").run(String(senderId)));
}

// ═══════════════════════════════════════════════════════════
// 💵 تعديل أسعار المنتجات من الموقع (تتجاوز أسعار الكود)
// ═══════════════════════════════════════════════════════════
export function listPriceOverrides(pageId) {
  if (pageId) return retryDb(() => db.prepare("SELECT * FROM price_overrides WHERE page_id = ? ORDER BY product").all(String(pageId)));
  return retryDb(() => db.prepare("SELECT * FROM price_overrides ORDER BY page_id, product").all());
}
export function setPriceOverride(pageId, product, price) {
  retryDb(() => db.prepare(
    "INSERT INTO price_overrides (page_id,product,price,updated_at) VALUES (?,?,?,?) ON CONFLICT(page_id,product) DO UPDATE SET price=excluded.price, updated_at=excluded.updated_at"
  ).run(String(pageId), String(product).trim(), Number(price) || 0, Date.now()));
}
export function deletePriceOverride(pageId, product) {
  retryDb(() => db.prepare("DELETE FROM price_overrides WHERE page_id=? AND product=?").run(String(pageId), String(product)));
}
// خريطة {product: price} للصفحة (للدمج مع أسعار الكود)
export function priceOverrideMap(pageId) {
  const map = {};
  for (const r of listPriceOverrides(pageId)) map[r.product] = r.price;
  return map;
}

// ═══════════════════════════════════════════════════════════
// 🏆 أكثر المنتجات مبيعاً (من order_string للطلبات المكتملة)
// ═══════════════════════════════════════════════════════════
export function topProducts(limit = 20) {
  const rows = retryDb(() => db.prepare(
    "SELECT order_string FROM orders WHERE status != 'ملغي' AND status != 'ناقص'"
  ).all());
  const counts = {};
  for (const r of rows) {
    for (const part of String(r.order_string || "").split("+")) {
      const m = part.match(/(.+?)\s*\((\d+(?:\.\d+)?)/);
      if (m) { const name = m[1].trim(); const qty = parseFloat(m[2]) || 0;
        if (name) counts[name] = (counts[name] || 0) + qty; }
    }
  }
  return Object.entries(counts).map(([product, qty]) => ({ product, qty }))
    .sort((a, b) => b.qty - a.qty).slice(0, limit);
}

// ═══════════════════════════════════════════════════════════
// 🎯 تخصيص للزبائن السابقين: أكثر أصنافهم طلباً (للاقتراح الذكي)
// ═══════════════════════════════════════════════════════════
// آخر طلب مكتمل للزبون (لإعادته بضغطة) — يرجّع الصف أو null
export function lastCompletedOrder(senderId) {
  if (!senderId) return null;
  return retryDb(() => db.prepare(
    "SELECT * FROM orders WHERE sender_id = ? AND status != 'ملغي' AND status != 'ناقص' ORDER BY created_at DESC LIMIT 1"
  ).get(senderId)) || null;
}

// ═══════════════════════════════════════════════════════════
// 📝 سبب الإلغاء (تحليل داخلي فقط — لا إرسال)
// ═══════════════════════════════════════════════════════════
// ⚠️ حُذفت متابعة ما بعد البيع نهائياً — لا إرسال استباقي.
export function setCancelReason(id, reason) {
  retryDb(() => db.prepare("UPDATE orders SET cancel_reason = ? WHERE id = ?").run(String(reason || "").slice(0, 200), Number(id)));
}
export function cancelReasonsReport() {
  const rows = retryDb(() => db.prepare(
    "SELECT cancel_reason FROM orders WHERE status = 'ملغي' AND cancel_reason != ''"
  ).all());
  const counts = {};
  for (const r of rows) { const k = r.cancel_reason.trim(); if (k) counts[k] = (counts[k] || 0) + 1; }
  return Object.entries(counts).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

// ═══════════════════════════════════════════════════════════
// 🔥 خريطة أوقات الذروة (يوم الأسبوع × الساعة) للطلبات المكتملة
// ═══════════════════════════════════════════════════════════
export function peakHeatmap() {
  const rows = retryDb(() => db.prepare(
    "SELECT created_at FROM orders WHERE status != 'ملغي' AND status != 'ناقص'"
  ).all());
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const r of rows) {
    const d = new Date(Number(r.created_at));
    grid[d.getDay()][d.getHours()]++;
  }
  return grid;   // grid[day 0=الأحد..6][hour 0..23]
}

export function customerHistoryHint(senderId) {
  if (!senderId) return "";
  try {
    const rows = retryDb(() => db.prepare(
      "SELECT order_string FROM orders WHERE sender_id = ? AND status != 'ملغي' AND status != 'ناقص' ORDER BY created_at DESC LIMIT 20"
    ).all(senderId));
    if (!rows.length) return "";
    const counts = {};
    for (const r of rows) {
      for (const part of String(r.order_string || "").split("+")) {
        const m = part.match(/(.+?)\s*\(/);
        if (m) { const name = m[1].trim(); if (name) counts[name] = (counts[name] || 0) + 1; }
      }
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
    if (!top.length) return `\n\n[زبون سابق] طلب معنا ${rows.length} مرة. رحّب فيه كزبون دائم بلطف.`;
    return `\n\n[زبون سابق — تخصيص] طلب معنا ${rows.length} مرة، وأكثر أصنافه طلباً: ${top.join(" ، ")}. ` +
      `رحّب فيه كزبون دائم واقترح عليه تكرار أصنافه المعتادة إن ناسب السياق (اقتراح واحد لطيف بدون إلحاح).`;
  } catch (e) { console.error("customerHistoryHint:", e && e.message); return ""; }
}

// ═══════════════════════════════════════════════════════════
// 👤 إدارة المستخدمين (أدوار)
// ═══════════════════════════════════════════════════════════
export function listUsers() {
  return retryDb(() => db.prepare("SELECT id, username, role, created_at FROM users ORDER BY created_at").all());
}
export function setUserRole(username, role) {
  retryDb(() => db.prepare("UPDATE users SET role=? WHERE username=?").run(String(role), String(username)));
}
export function deleteUser(username) {
  retryDb(() => db.prepare("DELETE FROM users WHERE username=?").run(String(username)));
}

// ⚠️ حُذفت دالة قائمة الحملات (broadcastTargets) نهائياً — لا حملات جماعية.

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
    // نقرأ كل شيء من Turso أولاً (لو تعطّل يرمي هنا قبل أي كتابة)
    const orders = src.prepare(
      "SELECT page_id,page_name,sender_id,order_string,total,area,phone,status,messenger_url,created_at FROM orders"
    ).all();
    let msgs = [];
    try { msgs = src.prepare("SELECT page_id,page_name,sender_id,direction,body,created_at FROM messages").all(); } catch { /* تجاهل */ }
    let ks = [];
    try { ks = src.prepare("SELECT page_id,extra,updated_at FROM page_knowledge").all(); } catch { /* تجاهل */ }

    // كل الكتابة + علامة الإتمام داخل معاملة واحدة (الكل أو لا شيء → لا تكرار عند إعادة المحاولة)
    const doMigrate = db.transaction(() => {
      const insO = db.prepare(INSERT_ORDER);
      // ⚠️ عدد الوسائط لازم يطابق INSERT_ORDER بالضبط (12 عمود).
      // لما انضاف address_score/address_level للاستعلام ونُسي تحديث هالسطر،
      // كان أي ترحيل من Turso بينهار كاملاً. الطلبات القديمة ما إلها درجة
      // عنوان، فمنحطّ -1 (غير مقاس) بدل ما ندّعي إنها مؤكدة.
      for (const o of orders) insO.run(
        o.page_id, o.page_name, o.sender_id, o.order_string, o.total,
        o.area, o.phone, o.status, o.messenger_url, o.created_at,
        Number.isFinite(Number(o.address_score)) ? Number(o.address_score) : -1,
        String(o.address_level || "")
      );
      const insM = db.prepare(INSERT_MESSAGE);
      for (const m of msgs) insM.run(m.page_id, m.page_name, m.sender_id, m.direction, m.body, m.created_at);
      const insK = db.prepare("INSERT INTO page_knowledge (page_id,extra,updated_at) VALUES (?,?,?) ON CONFLICT(page_id) DO UPDATE SET extra=excluded.extra");
      for (const k of ks) insK.run(k.page_id, k.extra, k.updated_at);
      db.prepare("INSERT INTO kv (key,value,expires_at) VALUES ('__migrated_turso','1',NULL) ON CONFLICT(key) DO NOTHING").run();
    });
    doMigrate();
    console.log(`✅ تم نقل ${orders.length} أوردر من Turso إلى القرص المحلي`);
    return true;
  } catch (e) {
    console.error("⏳ نقل Turso لم ينجح بعد (غالباً Turso متعطّل الآن)، سيعيد المحاولة:", e && e.message);
    return false;
  } finally {
    try { src && src.close && src.close(); } catch { /* تجاهل */ }
  }
}
