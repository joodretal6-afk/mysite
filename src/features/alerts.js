// ═══════════════════════════════════════════════════════════
// 🔔 وحدة مركز الإنذارات والمراقبة (alerts)
//
// عشر وظائف حقيقية:
//  1) قواعد إنذار يعرّفها التاجر (مقياس/شرط/حد/فترة)
//  2) محرّك تقييم بيشتغل على بيانات فعلية (orders / messages)
//  3) صندوق إنذارات بلا تكرار مزعج (بصمة لكل قاعدة+فترة)
//  4) تهدئة الإنذار (snooze) وكتم القاعدة معه
//  5) لوحة صحة المنصة (آخر طلب/آخر رسالة/الصفحات الصامتة)
//  6) كشف شذوذ صادق: اليوم مقابل نفس اليوم من أسابيع سابقة
//  7) سجل أحداث (audit) لكل ما بيصير بالوحدة مع فلترة
//  8) تقارير مجدولة بتتولّد وبتتخزّن للعرض جوّا الموقع
//  9) لوحة «شو لازم أعمل اليوم» مرتّبة بأثر محسوب
// 10) تصدير CSV للإنذارات وللسجل
//
// 🔴 قاعدتان ما منكسرهم:
//  • ما منخترع ولا رقم: كل إنذار بيحمل الرقم اللي أطلقه، مصدره،
//    والفترة اللي انحسب عليها. وإذا التاريخ ما بيكفي منقول
//    «ما في بيانات كافية» بدل ما نطلّع إنذار وهمي.
//  • صفر إرسال خارجي: ولا نداء شبكة، ولا فيسبوك ولا واتساب ولا
//    إيميل. كل شي بينعرض جوّا الموقع — حماية لصفحة التاجر.
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import express from "express";
import { db } from "../db/database.js";

export const slug = "alerts";
export const title = "مركز الإنذارات والمراقبة";
export const icon = "🔔";

// ── الجداول (كلها بادئة alerts_) ──
try {
  db.exec(`
  CREATE TABLE IF NOT EXISTS alerts_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    metric      TEXT NOT NULL,
    op          TEXT NOT NULL,
    threshold   REAL NOT NULL,
    window_days INTEGER NOT NULL DEFAULT 1,
    page_id     TEXT DEFAULT '',
    severity    TEXT NOT NULL DEFAULT 'متوسط',
    active      INTEGER NOT NULL DEFAULT 1,
    muted_until INTEGER NOT NULL DEFAULT 0,
    note        TEXT DEFAULT '',
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS alerts_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id      INTEGER NOT NULL,
    fingerprint  TEXT NOT NULL,
    rule_name    TEXT DEFAULT '',
    metric       TEXT NOT NULL,
    op           TEXT NOT NULL,
    threshold    REAL NOT NULL,
    observed     REAL NOT NULL,
    unit         TEXT DEFAULT '',
    source       TEXT NOT NULL,
    period_from  TEXT NOT NULL,
    period_to    TEXT NOT NULL,
    severity     TEXT DEFAULT 'متوسط',
    message      TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'نشط',
    hits         INTEGER NOT NULL DEFAULT 1,
    snooze_until INTEGER NOT NULL DEFAULT 0,
    first_at     INTEGER NOT NULL,
    last_at      INTEGER NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS alerts_events_fp ON alerts_events(fingerprint);
  CREATE INDEX IF NOT EXISTS alerts_events_rule ON alerts_events(rule_id);

  CREATE TABLE IF NOT EXISTS alerts_audit (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    at        INTEGER NOT NULL,
    kind      TEXT NOT NULL,
    entity    TEXT DEFAULT '',
    entity_id INTEGER,
    detail    TEXT DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS alerts_audit_at ON alerts_audit(at);

  CREATE TABLE IF NOT EXISTS alerts_schedules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    report      TEXT NOT NULL,
    freq        TEXT NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1,
    last_run_at INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS alerts_reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER,
    name        TEXT DEFAULT '',
    report      TEXT NOT NULL,
    period_from TEXT NOT NULL,
    period_to   TEXT NOT NULL,
    payload     TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );`);
} catch (e) { console.error("alerts tables:", e && e.message); }

// ═══════════════ أدوات عامة ═══════════════
const TZ = 10800000;          // الأردن +3
const DAY = 86400000;
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** بداية اليوم بتوقيت الأردن — shift بالأيام (0 = اليوم) */
export function dayStartMs(shift = 0, now = Date.now()) {
  const d = new Date(now + TZ);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + shift) - TZ;
}
const dayStr = (ts) => new Date(Number(ts) + TZ).toISOString().slice(0, 10);

/** بنقرأ من جدول ممكن ما يكون موجود (وحدة تانية) — بنتخطّاه بهدوء */
function safeGet(sql, ...params) {
  try { return db.prepare(sql).get(...params); } catch { return null; }
}
function safeAll(sql, ...params) {
  try { return db.prepare(sql).all(...params); } catch { return []; }
}

export function logAudit(kind, entity, entity_id, detail) {
  try {
    db.prepare("INSERT INTO alerts_audit (at,kind,entity,entity_id,detail) VALUES (?,?,?,?,?)")
      .run(Date.now(), String(kind), String(entity || ""),
           entity_id == null ? null : Number(entity_id), String(detail || "").slice(0, 500));
  } catch (e) { console.error("alerts audit:", e && e.message); }
}

// ═══════════════════════════════════════════════════════════
// (1) قاموس المقاييس — كل مقياس بيرجع رقمه ومصدره
//
// كل دالة بترجع رقم أو null. null معناها «ما في بيانات» مش صفر،
// وبناءً عليها القاعدة ما بتطلق إنذار — لأنّ الصفر المخترع بيكذب.
// ═══════════════════════════════════════════════════════════
const NOT_CANCELLED = "status <> 'ملغي'";

export const METRICS = {
  orders_count: {
    label: "عدد الطلبات", unit: "طلب", source: "جدول orders",
    calc: (from, to, page) => {
      const r = safeGet(`SELECT COUNT(*) c FROM orders WHERE created_at >= ? AND created_at < ?
                         ${page ? "AND page_id = ?" : ""}`, ...(page ? [from, to, page] : [from, to]));
      return r ? Number(r.c) : null;
    }
  },
  sales_total: {
    label: "مبيعات الفترة", unit: "دينار", source: "جدول orders (بلا الملغي)",
    calc: (from, to, page) => {
      const r = safeGet(`SELECT COALESCE(SUM(total),0) s FROM orders
                         WHERE ${NOT_CANCELLED} AND created_at >= ? AND created_at < ?
                         ${page ? "AND page_id = ?" : ""}`, ...(page ? [from, to, page] : [from, to]));
      return r ? r2(r.s) : null;
    }
  },
  cancelled_orders: {
    label: "الطلبات الملغية", unit: "طلب", source: "جدول orders (status = ملغي)",
    calc: (from, to, page) => {
      const r = safeGet(`SELECT COUNT(*) c FROM orders WHERE status = 'ملغي'
                         AND created_at >= ? AND created_at < ? ${page ? "AND page_id = ?" : ""}`,
                        ...(page ? [from, to, page] : [from, to]));
      return r ? Number(r.c) : null;
    }
  },
  incomplete_orders: {
    label: "الطلبات الناقصة", unit: "طلب", source: "جدول orders (status = ناقص)",
    calc: (from, to, page) => {
      const r = safeGet(`SELECT COUNT(*) c FROM orders WHERE status = 'ناقص'
                         AND created_at >= ? AND created_at < ? ${page ? "AND page_id = ?" : ""}`,
                        ...(page ? [from, to, page] : [from, to]));
      return r ? Number(r.c) : null;
    }
  },
  late_orders: {
    label: "طلبات معلّقة أكثر من يومين", unit: "طلب",
    source: "جدول orders (جديد/تم التواصل وعمرها > يومين)",
    calc: (from, to, page) => {
      const r = safeGet(`SELECT COUNT(*) c FROM orders
                         WHERE status IN ('جديد','تم التواصل') AND created_at < ?
                         ${page ? "AND page_id = ?" : ""}`, ...(page ? [to - 2 * DAY, page] : [to - 2 * DAY]));
      return r ? Number(r.c) : null;
    }
  },
  avg_order_value: {
    label: "متوسط قيمة الطلب", unit: "دينار", source: "جدول orders (بلا الملغي)",
    calc: (from, to, page) => {
      const r = safeGet(`SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders
                         WHERE ${NOT_CANCELLED} AND created_at >= ? AND created_at < ?
                         ${page ? "AND page_id = ?" : ""}`, ...(page ? [from, to, page] : [from, to]));
      // بلا طلبات ما في متوسط — منرجع null مش صفر
      return r && Number(r.c) > 0 ? r2(Number(r.s) / Number(r.c)) : null;
    }
  },
  inbound_messages: {
    label: "الرسائل الواردة", unit: "رسالة", source: "جدول messages (direction = in)",
    calc: (from, to, page) => {
      const r = safeGet(`SELECT COUNT(*) c FROM messages WHERE direction = 'in'
                         AND created_at >= ? AND created_at < ? ${page ? "AND page_id = ?" : ""}`,
                        ...(page ? [from, to, page] : [from, to]));
      return r ? Number(r.c) : null;
    }
  },
  unique_chats: {
    label: "محادثات مختلفة", unit: "محادثة", source: "جدول messages (sender_id مميّز)",
    calc: (from, to, page) => {
      const r = safeGet(`SELECT COUNT(DISTINCT sender_id) c FROM messages
                         WHERE created_at >= ? AND created_at < ? ${page ? "AND page_id = ?" : ""}`,
                        ...(page ? [from, to, page] : [from, to]));
      return r ? Number(r.c) : null;
    }
  },
  hours_since_last_order: {
    label: "ساعات من آخر طلب", unit: "ساعة", source: "جدول orders (أحدث created_at)",
    calc: (from, to, page) => {
      const r = safeGet(`SELECT MAX(created_at) m FROM orders ${page ? "WHERE page_id = ?" : ""}`,
                        ...(page ? [page] : []));
      // بلا ولا طلب بالتاريخ كله ما بنقدر نحسب «من آخر طلب»
      if (!r || r.m == null) return null;
      return r2(Math.max(0, to - Number(r.m)) / 3600000);
    }
  },
  hours_since_last_message: {
    label: "ساعات من آخر رسالة", unit: "ساعة", source: "جدول messages (أحدث created_at)",
    calc: (from, to, page) => {
      const r = safeGet(`SELECT MAX(created_at) m FROM messages ${page ? "WHERE page_id = ?" : ""}`,
                        ...(page ? [page] : []));
      if (!r || r.m == null) return null;
      return r2(Math.max(0, to - Number(r.m)) / 3600000);
    }
  },
  conversion_rate: {
    label: "نسبة تحوّل المحادثات لطلبات", unit: "%",
    source: "orders ÷ محادثات messages بنفس الفترة",
    calc: (from, to, page) => {
      const c = METRICS.unique_chats.calc(from, to, page);
      const o = METRICS.orders_count.calc(from, to, page);
      if (!c || o == null) return null;          // بلا محادثات ما في نسبة
      return r2((o / c) * 100);
    }
  }
};

export const OPS = {
  lt: { label: "أقل من", test: (v, t) => v < t },
  lte: { label: "أقل من أو يساوي", test: (v, t) => v <= t },
  gt: { label: "أكبر من", test: (v, t) => v > t },
  gte: { label: "أكبر من أو يساوي", test: (v, t) => v >= t },
  eq: { label: "يساوي", test: (v, t) => v === t }
};

const SEVERITIES = ["منخفض", "متوسط", "عالي"];

/** نافذة الفترة: window_days = 1 يعني «اليوم من أوّله لهلأ» */
export function windowRange(days, now = Date.now()) {
  const d = Math.max(1, Math.min(365, Number(days) || 1));
  return { from: dayStartMs(-(d - 1), now), to: now };
}

/**
 * (2) تقييم قاعدة وحدة على البيانات الفعلية.
 * @returns {{ok:boolean, reason?:string, fired:boolean, observed:number|null, ...}}
 */
export function evaluateRule(rule, now = Date.now()) {
  const m = METRICS[rule.metric];
  if (!m) return { ok: false, reason: "مقياس غير معروف: " + rule.metric };
  const op = OPS[rule.op];
  if (!op) return { ok: false, reason: "شرط غير معروف: " + rule.op };

  const { from, to } = windowRange(rule.window_days, now);
  const observed = m.calc(from, to, rule.page_id || "");

  // 🔴 ما في بيانات = ما في إنذار. منقولها صراحةً بدل ما نعتبرها صفر.
  if (observed == null)
    return { ok: true, fired: false, observed: null, no_data: true,
             reason: "ما في بيانات كافية لحساب «" + m.label + "» بهالفترة",
             metric: rule.metric, source: m.source, unit: m.unit,
             period_from: dayStr(from), period_to: dayStr(to) };

  return {
    ok: true, fired: op.test(observed, Number(rule.threshold)),
    observed, no_data: false,
    metric: rule.metric, label: m.label, unit: m.unit, source: m.source,
    period_from: dayStr(from), period_to: dayStr(to), from, to,
    message: `${m.label} ${op.label} ${r2(rule.threshold)} ${m.unit} — القراءة الفعلية ${observed} ${m.unit}` +
             ` (المصدر: ${m.source} — الفترة ${dayStr(from)} ← ${dayStr(to)})`
  };
}

/**
 * (3)+(4) تشغيل كل القواعد النشطة.
 * البصمة = القاعدة + الفترة، فنفس الإنذار بنفس اليوم ما بينكرّر:
 * بينزاد عدّاد التكرار وبتتحدّث القراءة بس.
 * القاعدة المكتومة أو الإنذار المهدّأ ما بينبعثوا من جديد.
 */
export function runRules(now = Date.now()) {
  const rules = db.prepare("SELECT * FROM alerts_rules WHERE active = 1 ORDER BY id").all();
  const out = { evaluated: 0, fired: 0, created: 0, repeated: 0, muted: 0, snoozed: 0, no_data: 0, events: [] };

  for (const rule of rules) {
    if (Number(rule.muted_until) > now) { out.muted++; continue; }
    const ev = evaluateRule(rule, now);
    out.evaluated++;
    if (!ev.ok) continue;
    if (ev.no_data) { out.no_data++; continue; }
    if (!ev.fired) continue;
    out.fired++;

    const fp = `${rule.id}|${rule.metric}|${ev.period_from}|${ev.period_to}`;
    const old = db.prepare("SELECT * FROM alerts_events WHERE fingerprint = ?").get(fp);
    if (old) {
      if (Number(old.snooze_until) > now) { out.snoozed++; continue; }
      db.prepare("UPDATE alerts_events SET observed=?, hits=hits+1, last_at=?, message=? WHERE id=?")
        .run(ev.observed, now, ev.message, old.id);
      out.repeated++;
      out.events.push({ id: Number(old.id), repeated: true });
      continue;
    }
    const r = db.prepare(`INSERT INTO alerts_events
      (rule_id,fingerprint,rule_name,metric,op,threshold,observed,unit,source,
       period_from,period_to,severity,message,status,hits,snooze_until,first_at,last_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'نشط',1,0,?,?)`)
      .run(rule.id, fp, rule.name, rule.metric, rule.op, Number(rule.threshold), ev.observed,
           ev.unit, ev.source, ev.period_from, ev.period_to, rule.severity, ev.message, now, now);
    out.created++;
    out.events.push({ id: Number(r.lastInsertRowid), repeated: false });
    logAudit("إنذار جديد", "rule", rule.id, `${rule.name}: ${ev.message}`);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════
// (5) لوحة صحة المنصة — أرقام خام بلا رأي
// ═══════════════════════════════════════════════════════════
export function healthReport(now = Date.now(), silentDays = 7) {
  const lastOrder = safeGet("SELECT MAX(created_at) m FROM orders");
  const lastMsg = safeGet("SELECT MAX(created_at) m FROM messages");
  const hrs = (m) => (m == null ? null : r2(Math.max(0, now - Number(m)) / 3600000));

  // صفحة «صامتة» = كان إلها طلبات بآخر 30 يوم وبطّلت من N يوم
  const cutoff = now - silentDays * DAY;
  const pages = safeAll(
    `SELECT page_id, COALESCE(MAX(page_name),'') page_name,
            COUNT(*) orders_30d, MAX(created_at) last_order
     FROM orders WHERE created_at >= ? GROUP BY page_id ORDER BY orders_30d DESC`, now - 30 * DAY);

  const silent = pages
    .filter((p) => Number(p.last_order) < cutoff)
    .map((p) => ({
      page_id: p.page_id, page_name: p.page_name,
      orders_30d: Number(p.orders_30d),
      last_order_at: Number(p.last_order),
      days_silent: Math.floor((now - Number(p.last_order)) / DAY),
      source: "جدول orders (آخر 30 يوم)"
    }));

  const today = windowRange(1, now);
  return {
    now,
    last_order_at: lastOrder?.m == null ? null : Number(lastOrder.m),
    hours_since_last_order: hrs(lastOrder?.m),
    last_message_at: lastMsg?.m == null ? null : Number(lastMsg.m),
    hours_since_last_message: hrs(lastMsg?.m),
    orders_today: METRICS.orders_count.calc(today.from, today.to, ""),
    sales_today: METRICS.sales_total.calc(today.from, today.to, ""),
    inbound_today: METRICS.inbound_messages.calc(today.from, today.to, ""),
    active_alerts: Number(db.prepare(
      "SELECT COUNT(*) c FROM alerts_events WHERE status='نشط' AND snooze_until <= ?").get(now).c),
    active_rules: Number(db.prepare("SELECT COUNT(*) c FROM alerts_rules WHERE active=1").get().c),
    pages: pages.map((p) => ({ page_id: p.page_id, page_name: p.page_name,
                               orders_30d: Number(p.orders_30d), last_order_at: Number(p.last_order) })),
    silent_pages: silent,
    silent_days: silentDays,
    sources: { orders: "جدول orders", messages: "جدول messages" }
  };
}

// ═══════════════════════════════════════════════════════════
// (6) كشف الشذوذ — بصراحة أو بلا
//
// منقارن اليوم بنفس اليوم من الأسابيع السابقة (الأحد بالأحد).
// إذا ما لقينا الحد الأدنى من الأسابيع اللي فيها بيانات، منقول
// «ما في بيانات كافية للمقارنة» وما منطلع ولا إنذار.
// ═══════════════════════════════════════════════════════════
/** في نشاط فعلي بهالنافذة؟ (طلب أو رسالة) — أساس التمييز بين «صفر» و«بلا بيانات» */
function hasActivity(from, to) {
  const o = safeGet("SELECT COUNT(*) c FROM orders WHERE created_at >= ? AND created_at < ?", from, to);
  if (o && Number(o.c) > 0) return true;
  const m = safeGet("SELECT COUNT(*) c FROM messages WHERE created_at >= ? AND created_at < ?", from, to);
  return !!(m && Number(m.c) > 0);
}

export function detectAnomaly(metric, { weeks = 4, minWeeks = 3, now = Date.now() } = {}) {
  const m = METRICS[metric];
  if (!m) return { ok: false, error: "مقياس غير معروف" };
  const w = Math.max(2, Math.min(12, Number(weeks) || 4));
  const need = Math.max(2, Math.min(w, Number(minWeeks) || 3));

  const todayFrom = dayStartMs(0, now);
  const current = m.calc(todayFrom, now, "");

  // نفس ساعة اليوم من كل أسبوع سابق — حتى المقارنة تكون عادلة
  const elapsed = now - todayFrom;
  const history = [];
  for (let i = 1; i <= w; i++) {
    const from = dayStartMs(-7 * i, now);
    // 🔴 اليوم اللي المنصة ما كانت شغّالة فيه أصلاً مش «صفر مبيعات»،
    // هو يوم بلا بيانات. لو حسبناه صفر كان متوسطنا كذب.
    const active = hasActivity(from, from + elapsed);
    history.push({ day: dayStr(from), value: active ? m.calc(from, from + elapsed, "") : null,
                   has_data: active });
  }
  const withData = history.filter((h) => h.value != null);

  if (current == null || withData.length < need) {
    return {
      ok: true, enough_data: false,
      reason: `ما في بيانات كافية للمقارنة — لقينا ${withData.length} أسبوع فيهم قراءة والمطلوب ${need} على الأقل`,
      metric, label: m.label, unit: m.unit, source: m.source,
      current, weekday: new Date(todayFrom + TZ).getUTCDay(), history
    };
  }

  const values = withData.map((h) => h.value);
  const avg = r2(values.reduce((a, b) => a + b, 0) / values.length);
  const variance = values.reduce((a, b) => a + (b - avg) ** 2, 0) / values.length;
  const sd = r2(Math.sqrt(variance));
  // z-score بيحتاج تشتّت حقيقي؛ إذا كل الأسابيع نفس الرقم بالضبط منقول null
  const z = sd > 0 ? r2((current - avg) / sd) : null;
  const diffPct = avg > 0 ? r2(((current - avg) / avg) * 100) : null;

  return {
    ok: true, enough_data: true,
    metric, label: m.label, unit: m.unit, source: m.source,
    weekday: new Date(todayFrom + TZ).getUTCDay(),
    current, average: avg, sd, z, diff_pct: diffPct,
    weeks_used: withData.length, history,
    // لمّا كل الأسابيع نفس الرقم بالضبط ما في تشتّت نقيس عليه،
    // فمنحكم بنسبة الفرق عن المتوسط بدل z — وبنقول هاد بصراحة.
    basis: z == null ? "نسبة الفرق عن المتوسط (بلا تشتّت بين الأسابيع)" : "z-score",
    verdict: z == null
      ? (diffPct == null ? "ما في متوسط نقارن عليه"
         : diffPct <= -50 ? "انخفاض شاذ" : diffPct >= 50 ? "ارتفاع شاذ" : "ضمن المعتاد")
      : z <= -2 ? "انخفاض شاذ" : z >= 2 ? "ارتفاع شاذ" : "ضمن المعتاد",
    explain: `القراءة اليوم ${current} ${m.unit} مقابل متوسط ${avg} ${m.unit}` +
             ` من ${withData.length} أسبوع بنفس اليوم (المصدر: ${m.source})`
  };
}

// ═══════════════════════════════════════════════════════════
// (9) شو لازم أعمل اليوم — مرتّبة بأثر محسوب من بيانات فعلية
//
// كل بند بيقول: الرقم، مصدره، الفترة، وليش هو مهم. الأثر
// بالدينار محسوب من أرقام موجودة؛ واللي ما إلو أثر مالي
// قابل للحساب بيضل null وبينزل تحت — ما منلبسه رقم من راسنا.
// ═══════════════════════════════════════════════════════════
export function todayList(now = Date.now(), limit = 10) {
  const items = [];
  const day30 = { from: now - 30 * DAY, to: now };
  const aov = METRICS.avg_order_value.calc(day30.from, day30.to, "");   // ممكن null

  // أ) طلبات معلّقة — فلوس واقفة على الباب
  const late = safeAll(
    `SELECT id, total, page_name, created_at FROM orders
     WHERE status IN ('جديد','تم التواصل') AND created_at < ? ORDER BY created_at`, now - 2 * DAY);
  if (late.length) {
    const money = r2(late.reduce((a, o) => a + (Number(o.total) || 0), 0));
    items.push({
      key: "late_orders", title: `${late.length} طلب معلّق من أكثر من يومين`,
      number: late.length, unit: "طلب",
      why: "الطلب اللي بيقعد بلا متابعة بيلغي نفسه — وهاي فلوس محجوزة مش محصّلة",
      impact_jod: money, impact_basis: "مجموع قيم الطلبات المعلّقة نفسها",
      source: "جدول orders (جديد/تم التواصل)", period: `قبل ${dayStr(now - 2 * DAY)}`
    });
  }

  // ب) طلبات ناقصة اليوم — بيانات زبون ما اكتملت
  const today = windowRange(1, now);
  const inc = METRICS.incomplete_orders.calc(today.from, today.to, "");
  if (inc) {
    items.push({
      key: "incomplete_today", title: `${inc} طلب ناقص اليوم`,
      number: inc, unit: "طلب",
      why: "الطلب الناقص معناه البوت ما جمع كل بيانات الزبون — كل وحدة منهم بيعة ممكن تروح",
      impact_jod: aov == null ? null : r2(inc * aov),
      impact_basis: aov == null ? "ما في متوسط قيمة طلب محسوب — ما منخترع أثر مالي"
                                : `عددهم × متوسط قيمة الطلب بآخر 30 يوم (${aov} د)`,
      source: "جدول orders (status = ناقص)", period: `${dayStr(today.from)} ← اليوم`
    });
  }

  // ج) ملغيات اليوم — خسارة فعلية بالقيمة
  const cancelled = safeGet(
    `SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders
     WHERE status='ملغي' AND created_at >= ? AND created_at < ?`, today.from, today.to);
  if (cancelled && Number(cancelled.c) > 0) {
    items.push({
      key: "cancelled_today", title: `${Number(cancelled.c)} طلب انلغى اليوم`,
      number: Number(cancelled.c), unit: "طلب",
      why: "الإلغاء بيوكل ربح اليوم — لازم تعرف السبب قبل ما يصير عادة",
      impact_jod: r2(cancelled.s), impact_basis: "مجموع قيم الطلبات الملغية اليوم",
      source: "جدول orders (status = ملغي)", period: `${dayStr(today.from)} ← اليوم`
    });
  }

  // د) صفحات صامتة — أثرها = معدّل مبيعاتها الأسبوعي الفعلي
  const h = healthReport(now);
  for (const p of h.silent_pages) {
    const sales30 = METRICS.sales_total.calc(now - 30 * DAY, now, p.page_id) || 0;
    items.push({
      key: "silent_page:" + p.page_id,
      title: `صفحة «${p.page_name || p.page_id}» بلا طلبات من ${p.days_silent} يوم`,
      number: p.days_silent, unit: "يوم",
      why: "الصفحة اللي كانت بتبيع وسكتت غالباً في خلل بالربط أو بالنشر",
      impact_jod: r2(sales30 / 30 * 7), impact_basis: "معدّل مبيعاتها الأسبوعي من مبيعات آخر 30 يوم الفعلية",
      source: "جدول orders (حسب page_id)", period: "آخر 30 يوم"
    });
  }

  // هـ) الإنذارات النشطة — أثرها مالي بس إذا مقياسها بالدينار
  const events = db.prepare(
    "SELECT * FROM alerts_events WHERE status='نشط' AND snooze_until <= ? ORDER BY last_at DESC LIMIT 50").all(now);
  for (const e of events) {
    const money = e.unit === "دينار" ? r2(Math.abs(Number(e.observed) - Number(e.threshold))) : null;
    items.push({
      key: "alert:" + e.id, title: `إنذار: ${e.rule_name}`,
      number: Number(e.observed), unit: e.unit,
      why: e.message,
      impact_jod: money,
      impact_basis: money == null ? "مقياس مش بالدينار — ما منحوّله لفلوس بالتخمين"
                                  : "الفرق بين القراءة والحد المضبوط",
      source: e.source, period: `${e.period_from} ← ${e.period_to}`
    });
  }

  // الترتيب: الأثر المالي المحسوب أولاً، وبعدين اللي بلا أثر مالي حسب رقمه
  items.sort((a, b) => {
    const am = a.impact_jod, bm = b.impact_jod;
    if (am != null && bm != null) return bm - am;
    if (am != null) return -1;
    if (bm != null) return 1;
    return (b.number || 0) - (a.number || 0);
  });
  return items.slice(0, Math.max(1, Math.min(50, limit)));
}

// ═══════════════════════════════════════════════════════════
// (8) التقارير المجدولة — بتتولّد وبتتخزّن جوّا الموقع فقط
// ═══════════════════════════════════════════════════════════
export const REPORTS = {
  daily_sales: { label: "مبيعات يومية", days: 1 },
  weekly_sales: { label: "ملخّص أسبوعي", days: 7 },
  monthly_sales: { label: "ملخّص شهري", days: 30 },
  alerts_digest: { label: "خلاصة الإنذارات", days: 7 },
  health: { label: "صحة المنصة", days: 1 }
};

export const FREQS = { daily: { label: "يومي", ms: DAY }, weekly: { label: "أسبوعي", ms: 7 * DAY },
                       monthly: { label: "شهري", ms: 30 * DAY } };

export function buildReport(report, now = Date.now()) {
  const def = REPORTS[report];
  if (!def) return null;
  const from = report === "health" ? dayStartMs(0, now) : now - def.days * DAY;
  const body = { generated_at: now, source_note: "كل الأرقام محسوبة من جداول المنصة وقت التوليد" };

  if (report === "health") {
    Object.assign(body, { health: healthReport(now) });
  } else if (report === "alerts_digest") {
    body.alerts = db.prepare(
      "SELECT rule_name, metric, observed, threshold, unit, source, period_from, period_to, status, hits" +
      " FROM alerts_events WHERE last_at >= ? ORDER BY last_at DESC LIMIT 200").all(from);
    body.counts = { total: body.alerts.length,
                    active: body.alerts.filter((a) => a.status === "نشط").length };
  } else {
    body.metrics = {};
    for (const k of ["orders_count", "sales_total", "cancelled_orders", "incomplete_orders",
                     "avg_order_value", "inbound_messages", "unique_chats"]) {
      const v = METRICS[k].calc(from, now, "");
      body.metrics[k] = { label: METRICS[k].label, value: v, unit: METRICS[k].unit,
                          source: METRICS[k].source,
                          note: v == null ? "ما في بيانات كافية بهالفترة" : "" };
    }
    body.by_page = safeAll(
      `SELECT page_id, COALESCE(MAX(page_name),'') page_name, COUNT(*) orders,
              COALESCE(SUM(CASE WHEN ${NOT_CANCELLED} THEN total ELSE 0 END),0) sales
       FROM orders WHERE created_at >= ? AND created_at < ? GROUP BY page_id ORDER BY sales DESC`, from, now)
      .map((p) => ({ ...p, orders: Number(p.orders), sales: r2(p.sales) }));
  }
  return { report, label: def.label, period_from: dayStr(from), period_to: dayStr(now), body };
}

/** بيولّد تقارير الجداول اللي حان وقتها (بلا أي إرسال — بس تخزين) */
export function runSchedules(now = Date.now()) {
  const rows = db.prepare("SELECT * FROM alerts_schedules WHERE active = 1 ORDER BY id").all();
  const out = { checked: rows.length, generated: 0, ids: [] };
  for (const s of rows) {
    const every = (FREQS[s.freq] || FREQS.daily).ms;
    if (Number(s.last_run_at) && now - Number(s.last_run_at) < every) continue;
    const built = buildReport(s.report, now);
    if (!built) continue;
    const r = db.prepare(`INSERT INTO alerts_reports
      (schedule_id,name,report,period_from,period_to,payload,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(s.id, s.name, s.report, built.period_from, built.period_to, JSON.stringify(built.body), now);
    db.prepare("UPDATE alerts_schedules SET last_run_at=? WHERE id=?").run(now, s.id);
    out.generated++;
    out.ids.push(Number(r.lastInsertRowid));
    logAudit("تقرير مجدول", "schedule", s.id, `${s.name} (${built.label})`);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════
// الراوتر
// ═══════════════════════════════════════════════════════════
export const router = Router();
router.use(express.json({ limit: "5mb" }));

const ok = (res, data) => res.json({ ok: true, ...data });
const bad = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });

/** تحقّق كامل من مدخلات القاعدة — رسائل عربية مفهومة */
export function validateRule(b) {
  const name = String(b?.name || "").trim();
  if (name.length < 2) return { error: "اسم القاعدة لازم حرفين على الأقل" };
  if (!METRICS[b?.metric]) return { error: "المقياس غير معروف — اختر من القائمة" };
  if (!OPS[b?.op]) return { error: "الشرط غير معروف — اختر أقل/أكبر/يساوي" };
  const threshold = Number(b?.threshold);
  if (!Number.isFinite(threshold)) return { error: "الحد لازم يكون رقم" };
  const window_days = Number(b?.window_days ?? 1);
  if (!Number.isInteger(window_days) || window_days < 1 || window_days > 365)
    return { error: "الفترة لازم رقم صحيح بين 1 و 365 يوم" };
  const severity = String(b?.severity || "متوسط");
  if (!SEVERITIES.includes(severity)) return { error: "الخطورة لازم: " + SEVERITIES.join(" / ") };
  return { value: { name: name.slice(0, 120), metric: b.metric, op: b.op, threshold: r2(threshold),
                    window_days, page_id: String(b?.page_id || "").slice(0, 60), severity,
                    note: String(b?.note || "").slice(0, 300) } };
}

// ── المعطيات الثابتة للواجهة ──
router.get("/meta", (req, res) => ok(res, {
  metrics: Object.entries(METRICS).map(([k, v]) => ({ key: k, label: v.label, unit: v.unit, source: v.source })),
  ops: Object.entries(OPS).map(([k, v]) => ({ key: k, label: v.label })),
  severities: SEVERITIES,
  reports: Object.entries(REPORTS).map(([k, v]) => ({ key: k, label: v.label })),
  freqs: Object.entries(FREQS).map(([k, v]) => ({ key: k, label: v.label })),
  pages: safeAll("SELECT page_id, COALESCE(MAX(page_name),'') page_name FROM orders GROUP BY page_id")
}));

// ═══════════ (1) القواعد ═══════════
router.get("/rules", (req, res) => {
  const now = Date.now();
  const rows = db.prepare("SELECT * FROM alerts_rules ORDER BY id DESC").all().map((r) => ({
    ...r, active: Number(r.active) ? 1 : 0,
    muted: Number(r.muted_until) > now,
    label: METRICS[r.metric]?.label || r.metric,
    unit: METRICS[r.metric]?.unit || "",
    op_label: OPS[r.op]?.label || r.op
  }));
  ok(res, { rows });
});

router.post("/rules", (req, res) => {
  const v = validateRule(req.body);
  if (v.error) return bad(res, v.error);
  const r = db.prepare(`INSERT INTO alerts_rules
      (name,metric,op,threshold,window_days,page_id,severity,active,muted_until,note,created_at)
      VALUES (?,?,?,?,?,?,?,1,0,?,?)`)
    .run(v.value.name, v.value.metric, v.value.op, v.value.threshold, v.value.window_days,
         v.value.page_id, v.value.severity, v.value.note, Date.now());
  const id = Number(r.lastInsertRowid);
  logAudit("قاعدة جديدة", "rule", id, v.value.name);
  ok(res, { id });
});

router.post("/rules/:id", (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare("SELECT * FROM alerts_rules WHERE id=?").get(id);
  if (!cur) return bad(res, "القاعدة غير موجودة", 404);
  const v = validateRule({ ...cur, ...req.body });
  if (v.error) return bad(res, v.error);
  const active = req.body?.active == null ? Number(cur.active) : (req.body.active ? 1 : 0);
  db.prepare(`UPDATE alerts_rules SET name=?,metric=?,op=?,threshold=?,window_days=?,
              page_id=?,severity=?,note=?,active=? WHERE id=?`)
    .run(v.value.name, v.value.metric, v.value.op, v.value.threshold, v.value.window_days,
         v.value.page_id, v.value.severity, v.value.note, active, id);
  logAudit("تعديل قاعدة", "rule", id, v.value.name);
  ok(res, {});
});

router.delete("/rules/:id", (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare("SELECT name FROM alerts_rules WHERE id=?").get(id);
  if (!cur) return bad(res, "القاعدة غير موجودة", 404);
  db.transaction(() => {
    db.prepare("DELETE FROM alerts_events WHERE rule_id=?").run(id);
    db.prepare("DELETE FROM alerts_rules WHERE id=?").run(id);
  })();
  logAudit("حذف قاعدة", "rule", id, cur.name);
  ok(res, {});
});

// (4) كتم القاعدة لفترة
router.post("/rules/:id/mute", (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare("SELECT * FROM alerts_rules WHERE id=?").get(id);
  if (!cur) return bad(res, "القاعدة غير موجودة", 404);
  const hours = Number(req.body?.hours ?? 24);
  if (!Number.isFinite(hours) || hours < 0 || hours > 24 * 90)
    return bad(res, "مدة الكتم لازم بالساعات بين 0 و 2160");
  const until = hours > 0 ? Date.now() + hours * 3600000 : 0;
  db.prepare("UPDATE alerts_rules SET muted_until=? WHERE id=?").run(until, id);
  logAudit(hours > 0 ? "كتم قاعدة" : "فك كتم", "rule", id, `${cur.name} — ${hours} ساعة`);
  ok(res, { muted_until: until });
});

// (2) تشغيل المحرّك يدوياً
router.post("/evaluate", (req, res) => {
  const out = runRules();
  logAudit("تقييم القواعد", "engine", null,
           `قُيّمت ${out.evaluated}، أُطلق ${out.fired}، جديد ${out.created}، مكرّر ${out.repeated}`);
  ok(res, out);
});

// معاينة قاعدة قبل حفظها — بتشوف الرقم الحقيقي قبل ما تلتزم
router.post("/preview", (req, res) => {
  const v = validateRule(req.body);
  if (v.error) return bad(res, v.error);
  const ev = evaluateRule(v.value);
  if (!ev.ok) return bad(res, ev.reason);
  ok(res, { result: ev });
});

// ═══════════ (3) صندوق الإنذارات ═══════════
router.get("/events", (req, res) => {
  const now = Date.now();
  const status = String(req.query.status || "");
  const w = [], p = [];
  if (status === "نشط") { w.push("status='نشط' AND snooze_until <= ?"); p.push(now); }
  else if (status === "مهدّأ") { w.push("snooze_until > ?"); p.push(now); }
  else if (status === "مقروء") { w.push("status='مقروء'"); }
  if (req.query.rule_id) { w.push("rule_id = ?"); p.push(Number(req.query.rule_id)); }
  const rows = db.prepare("SELECT * FROM alerts_events" + (w.length ? " WHERE " + w.join(" AND ") : "") +
                          " ORDER BY last_at DESC, id DESC LIMIT 500").all(...p)
    .map((e) => ({ ...e, snoozed: Number(e.snooze_until) > now }));
  const counts = {
    active: Number(db.prepare("SELECT COUNT(*) c FROM alerts_events WHERE status='نشط' AND snooze_until<=?").get(now).c),
    snoozed: Number(db.prepare("SELECT COUNT(*) c FROM alerts_events WHERE snooze_until>?").get(now).c),
    read: Number(db.prepare("SELECT COUNT(*) c FROM alerts_events WHERE status='مقروء'").get().c),
    repeated: Number(db.prepare("SELECT COUNT(*) c FROM alerts_events WHERE hits>1").get().c)
  };
  ok(res, { rows, counts });
});

router.post("/events/:id/read", (req, res) => {
  const id = Number(req.params.id);
  const e = db.prepare("SELECT * FROM alerts_events WHERE id=?").get(id);
  if (!e) return bad(res, "الإنذار غير موجود", 404);
  db.prepare("UPDATE alerts_events SET status='مقروء' WHERE id=?").run(id);
  logAudit("قراءة إنذار", "event", id, e.rule_name);
  ok(res, {});
});

router.post("/events/read-all", (req, res) => {
  const r = db.prepare("UPDATE alerts_events SET status='مقروء' WHERE status='نشط'").run();
  logAudit("قراءة الكل", "event", null, `${Number(r.changes)} إنذار`);
  ok(res, { changed: Number(r.changes) });
});

// (4) تهدئة إنذار — وبتكتم قاعدته لنفس المدة حتى ما يرجع فوراً
router.post("/events/:id/snooze", (req, res) => {
  const id = Number(req.params.id);
  const e = db.prepare("SELECT * FROM alerts_events WHERE id=?").get(id);
  if (!e) return bad(res, "الإنذار غير موجود", 404);
  const hours = Number(req.body?.hours ?? 4);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 30)
    return bad(res, "مدة التهدئة لازم بالساعات بين 1 و 720");
  const until = Date.now() + hours * 3600000;
  db.transaction(() => {
    db.prepare("UPDATE alerts_events SET snooze_until=? WHERE id=?").run(until, id);
    db.prepare("UPDATE alerts_rules SET muted_until=? WHERE id=?").run(until, e.rule_id);
  })();
  logAudit("تهدئة إنذار", "event", id, `${e.rule_name} — ${hours} ساعة`);
  ok(res, { snooze_until: until });
});

router.delete("/events/:id", (req, res) => {
  db.prepare("DELETE FROM alerts_events WHERE id=?").run(Number(req.params.id));
  logAudit("حذف إنذار", "event", Number(req.params.id), "");
  ok(res, {});
});

// ═══════════ (5) الصحة ═══════════
router.get("/health", (req, res) => {
  const days = Math.max(1, Math.min(90, Number(req.query.silent_days) || 7));
  ok(res, { health: healthReport(Date.now(), days) });
});

// ═══════════ (6) الشذوذ ═══════════
router.get("/anomaly", (req, res) => {
  const metric = String(req.query.metric || "orders_count");
  if (!METRICS[metric]) return bad(res, "المقياس غير معروف");
  const out = detectAnomaly(metric, { weeks: Number(req.query.weeks) || 4,
                                      minWeeks: Number(req.query.min_weeks) || 3 });
  if (!out.ok) return bad(res, out.error);
  ok(res, { result: out });
});

// ═══════════ (7) السجل ═══════════
router.get("/audit", (req, res) => {
  const w = [], p = [];
  if (req.query.kind) { w.push("kind = ?"); p.push(String(req.query.kind)); }
  if (req.query.entity) { w.push("entity = ?"); p.push(String(req.query.entity)); }
  if (req.query.q) { w.push("detail LIKE ?"); p.push("%" + String(req.query.q) + "%"); }
  if (req.query.from) { const f = Date.parse(String(req.query.from) + "T00:00:00Z") - TZ;
                        if (Number.isFinite(f)) { w.push("at >= ?"); p.push(f); } }
  if (req.query.to) { const t = Date.parse(String(req.query.to) + "T00:00:00Z") - TZ;
                      if (Number.isFinite(t)) { w.push("at < ?"); p.push(t + DAY); } }
  const rows = db.prepare("SELECT * FROM alerts_audit" + (w.length ? " WHERE " + w.join(" AND ") : "") +
                          " ORDER BY id DESC LIMIT 1000").all(...p);
  const kinds = db.prepare("SELECT kind, COUNT(*) c FROM alerts_audit GROUP BY kind ORDER BY c DESC").all()
    .map((k) => ({ kind: k.kind, count: Number(k.c) }));
  ok(res, { rows, kinds });
});

// ═══════════ (8) التقارير المجدولة ═══════════
router.get("/schedules", (req, res) => {
  ok(res, {
    rows: db.prepare("SELECT * FROM alerts_schedules ORDER BY id DESC").all().map((s) => ({
      ...s, report_label: REPORTS[s.report]?.label || s.report,
      freq_label: FREQS[s.freq]?.label || s.freq
    })),
    reports: db.prepare(
      "SELECT id,schedule_id,name,report,period_from,period_to,created_at FROM alerts_reports ORDER BY id DESC LIMIT 200").all()
  });
});

router.post("/schedules", (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (name.length < 2) return bad(res, "اسم التقرير لازم حرفين على الأقل");
  if (!REPORTS[req.body?.report]) return bad(res, "نوع التقرير غير معروف");
  if (!FREQS[req.body?.freq]) return bad(res, "التكرار لازم: يومي / أسبوعي / شهري");
  const r = db.prepare("INSERT INTO alerts_schedules (name,report,freq,active,last_run_at,created_at) VALUES (?,?,?,1,0,?)")
    .run(name.slice(0, 120), req.body.report, req.body.freq, Date.now());
  logAudit("جدولة تقرير", "schedule", Number(r.lastInsertRowid), `${name} (${FREQS[req.body.freq].label})`);
  ok(res, { id: Number(r.lastInsertRowid) });
});

router.delete("/schedules/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM alerts_schedules WHERE id=?").run(id);
  logAudit("حذف جدولة", "schedule", id, "");
  ok(res, {});
});

// تشغيل الجداول المستحقّة (بلا إرسال — التقرير بينحفظ للعرض بس)
router.post("/schedules/run", (req, res) => ok(res, runSchedules()));

// توليد تقرير فوري بلا جدولة
router.post("/reports/generate", (req, res) => {
  const built = buildReport(String(req.body?.report || ""));
  if (!built) return bad(res, "نوع التقرير غير معروف");
  const r = db.prepare(`INSERT INTO alerts_reports
      (schedule_id,name,report,period_from,period_to,payload,created_at) VALUES (NULL,?,?,?,?,?,?)`)
    .run(built.label, built.report, built.period_from, built.period_to,
         JSON.stringify(built.body), Date.now());
  logAudit("تقرير فوري", "report", Number(r.lastInsertRowid), built.label);
  ok(res, { id: Number(r.lastInsertRowid), report: built });
});

router.get("/reports/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM alerts_reports WHERE id=?").get(Number(req.params.id));
  if (!row) return bad(res, "التقرير غير موجود", 404);
  let payload = null;
  try { payload = JSON.parse(row.payload); } catch { payload = null; }
  ok(res, { report: { ...row, payload, label: REPORTS[row.report]?.label || row.report } });
});

router.delete("/reports/:id", (req, res) => {
  db.prepare("DELETE FROM alerts_reports WHERE id=?").run(Number(req.params.id));
  ok(res, {});
});

// ═══════════ (9) شو لازم أعمل اليوم ═══════════
router.get("/today", (req, res) => {
  const items = todayList(Date.now(), Number(req.query.limit) || 10);
  ok(res, {
    items,
    total_impact_jod: r2(items.reduce((a, i) => a + (i.impact_jod || 0), 0)),
    note: "الترتيب بالأثر المالي المحسوب من بيانات فعلية؛ البنود اللي ما إلها أثر مالي قابل للحساب بتنزل تحت بلا رقم مخترع"
  });
});

// ═══════════ (10) التصدير ═══════════
const csvEsc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
function sendCsv(res, filename, head, rows) {
  const lines = [head.map(csvEsc).join(",")];
  for (const r of rows) lines.push(r.map(csvEsc).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send("﻿" + lines.join("\r\n"));      // BOM حتى إكسل يقرأ العربي صح
}

router.get("/export/events.csv", (req, res) => {
  const rows = db.prepare("SELECT * FROM alerts_events ORDER BY id DESC LIMIT 5000").all();
  sendCsv(res, "alerts-events.csv",
    ["أول ظهور", "آخر ظهور", "القاعدة", "المقياس", "الشرط", "الحد", "القراءة", "الوحدة",
     "المصدر", "من", "إلى", "الخطورة", "الحالة", "عدد التكرار", "النص"],
    rows.map((e) => [new Date(Number(e.first_at)).toISOString(), new Date(Number(e.last_at)).toISOString(),
      e.rule_name, METRICS[e.metric]?.label || e.metric, OPS[e.op]?.label || e.op, e.threshold,
      e.observed, e.unit, e.source, e.period_from, e.period_to, e.severity, e.status, e.hits, e.message]));
});

router.get("/export/audit.csv", (req, res) => {
  const rows = db.prepare("SELECT * FROM alerts_audit ORDER BY id DESC LIMIT 5000").all();
  sendCsv(res, "alerts-audit.csv", ["الوقت", "النوع", "الكيان", "رقم الكيان", "التفاصيل"],
    rows.map((a) => [new Date(Number(a.at)).toISOString(), a.kind, a.entity, a.entity_id ?? "", a.detail]));
});
