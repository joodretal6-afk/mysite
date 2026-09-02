// ═══════════════════════════════════════════════════════════
// 🎧 وحدة خدمة العملاء والشكاوى (service) — 10 وظائف
//
//  1) تذاكر الشكاوى مربوطة بزبون/طلب، بأولوية وحالة ومسؤول
//  2) سجل زمني لكل تذكرة — كل تغيير مين عمله ومتى (بلا تعديل صامت)
//  3) تصنيف أسباب الشكاوى وترتيبها بالتكرار
//  4) اتفاقية مستوى الخدمة (SLA): مهلة أول رد ومهلة الحل + المتجاوزين
//  5) التعويضات: شو أعطينا للزبون وكم كلّفنا
//  6) الاسترجاع والاستبدال بحالاتهم
//  7) لوحة أداء: أول رد، وقت الحل، نسبة إعادة الفتح
//  8) أكثر الأصناف والمناطق شكاوى — من التذاكر المسجّلة فقط
//  9) ردود جاهزة بمتغيّرات {الاسم} و{رقم الطلب}
// 10) تصدير CSV + تقرير شهري
//
// 🔴 قاعدتين ما منتنازل عنهن:
//  • ما منخترع رقم. بلا تذاكر ما في "متوسط رد = 0" — في null
//    وبتظهر "—". وسبب الشكوى بينتحدد من اللي انسجّل بس،
//    ما منستنتجه من نص ولا من راسنا.
//  • ولا إرسال تلقائي للزبون من هون نهائياً. القوالب بتنعرض
//    للنسخ اليدوي، وما في ولا نداء لفيسبوك أو واتساب —
//    هاي حماية للصفحة من الحظر.
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import express from "express";
import { db } from "../db/database.js";

export const slug = "service";
export const title = "خدمة العملاء والشكاوى";
export const icon = "🎧";

// ── الجداول (كلها بادئة service_) ──
try {
  db.exec(`
  CREATE TABLE IF NOT EXISTS service_tickets (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id       INTEGER,
    sender_id      TEXT DEFAULT '',
    page_id        TEXT DEFAULT '',
    customer       TEXT DEFAULT '',
    phone          TEXT DEFAULT '',
    area           TEXT DEFAULT '',
    item           TEXT DEFAULT '',
    reason         TEXT DEFAULT '',
    channel        TEXT NOT NULL DEFAULT 'ماسنجر',
    subject        TEXT DEFAULT '',
    body           TEXT DEFAULT '',
    priority       TEXT NOT NULL DEFAULT 'عادي',
    status         TEXT NOT NULL DEFAULT 'جديد',
    assignee       TEXT DEFAULT '',
    sla_reply_h    REAL NOT NULL DEFAULT 0,
    sla_resolve_h  REAL NOT NULL DEFAULT 0,
    opened_at      INTEGER NOT NULL,
    first_reply_at INTEGER,
    resolved_at    INTEGER,
    closed_at      INTEGER,
    reopen_count   INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS service_tickets_open ON service_tickets(opened_at);
  CREATE INDEX IF NOT EXISTS service_tickets_ord  ON service_tickets(order_id);

  CREATE TABLE IF NOT EXISTS service_events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    actor     TEXT NOT NULL,
    action    TEXT NOT NULL,
    field     TEXT DEFAULT '',
    old_value TEXT DEFAULT '',
    new_value TEXT DEFAULT '',
    note      TEXT DEFAULT '',
    at        INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS service_events_t ON service_events(ticket_id, at);

  CREATE TABLE IF NOT EXISTS service_reasons (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    label  TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS service_comps (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    kind      TEXT NOT NULL,
    amount    REAL NOT NULL DEFAULT 0,
    note      TEXT DEFAULT '',
    actor     TEXT NOT NULL DEFAULT '',
    at        INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS service_comps_t ON service_comps(ticket_id);

  CREATE TABLE IF NOT EXISTS service_returns (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id  INTEGER NOT NULL,
    kind       TEXT NOT NULL,
    item       TEXT DEFAULT '',
    qty        REAL NOT NULL DEFAULT 0,
    state      TEXT NOT NULL DEFAULT 'مطلوب',
    refund     REAL NOT NULL DEFAULT 0,
    note       TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS service_returns_t ON service_returns(ticket_id);

  CREATE TABLE IF NOT EXISTS service_templates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL UNIQUE,
    reason     TEXT DEFAULT '',
    body       TEXT NOT NULL,
    uses       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS service_settings (
    k TEXT PRIMARY KEY,
    v TEXT
  );`);
} catch (e) { console.error("service tables:", e && e.message); }

// ── قوائم ثابتة (خيارات، مش بيانات) ──
export const STATUSES   = ["جديد", "قيد المعالجة", "بانتظار الزبون", "تم الحل", "مغلق"];
export const OPEN_STATES = ["جديد", "قيد المعالجة", "بانتظار الزبون"];
export const DONE_STATES = ["تم الحل", "مغلق"];
export const PRIORITIES = ["عادي", "مرتفع", "عاجل"];
export const CHANNELS   = ["ماسنجر", "اتصال", "واتساب", "شخصي", "أخرى"];
export const COMP_KINDS = ["خصم", "استبدال", "استرجاع مبلغ", "توصيل مجاني", "هدية"];
export const RETURN_KINDS  = ["استرجاع", "استبدال"];
export const RETURN_STATES = ["مطلوب", "بالطريق", "استلمناه", "تم التعويض", "مرفوض"];
const SEED_REASONS = ["تأخير بالتوصيل", "صنف ناقص", "جودة المنتج", "السعر", "التغليف",
                      "خطأ بالطلب", "سوء تعامل", "أخرى"];

try {
  const n = db.prepare("SELECT COUNT(*) c FROM service_reasons").get();
  if (!Number(n?.c)) {
    const ins = db.prepare("INSERT OR IGNORE INTO service_reasons (label,active) VALUES (?,1)");
    for (const r of SEED_REASONS) ins.run(r);
  }
} catch (e) { console.error("service seed:", e && e.message); }

// ── إعدادات الـSLA: هاي سياسة التاجر مش بيانات مقيسة، فإلها افتراضي واضح ──
const DEFAULTS = { sla_reply_h: "4", sla_resolve_h: "48" };
function getSetting(k) {
  try { return db.prepare("SELECT v FROM service_settings WHERE k=?").get(k)?.v ?? DEFAULTS[k] ?? ""; }
  catch { return DEFAULTS[k] ?? ""; }
}
function setSetting(k, v) {
  db.prepare("INSERT INTO service_settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v")
    .run(k, String(v));
}
export const slaPolicy = () => ({
  sla_reply_h: Number(getSetting("sla_reply_h")) || 0,
  sla_resolve_h: Number(getSetting("sla_resolve_h")) || 0
});

// ── أدوات ──
const HOUR = 3600000, DAY = 86400000, TZ_MS = 10800 * 1000;
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const dayStr = (ts) => new Date(Number(ts) + TZ_MS).toISOString().slice(0, 10);
const txt = (v, n) => String(v ?? "").trim().slice(0, n);

function dayStart(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) - TZ_MS : null;
}
/** يحوّل "YYYY-MM" لمدى الشهر بتوقيت عمّان [بداية، نهاية) */
export function monthRange(s) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const mo = +m[2];
  if (mo < 1 || mo > 12) return null;
  const from = Date.UTC(+m[1], mo - 1, 1) - TZ_MS;
  const to = Date.UTC(mo === 12 ? +m[1] + 1 : +m[1], mo === 12 ? 0 : mo, 1) - TZ_MS;
  return { from, to };
}

const avg = (a) => (a.length ? r2(a.reduce((x, y) => x + y, 0) / a.length) : null);
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const i = Math.floor(s.length / 2);
  return r2(s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2);
};

// ═══════════════════════════════════════════════════════════
// 🧮 المحرّك — دوال صافية، منها بينبني كل شي وعليها بينمشي الاختبار
// ═══════════════════════════════════════════════════════════

/**
 * (4) فحص الـSLA لتذكرة وحدة.
 *
 * الحدّ بالضبط: المهلة بتنكسر لمّا الوقت **يتجاوز** المهلة،
 * والمساواة التامة لسا ضمن المهلة — لأنّ اللي رد بالدقيقة
 * الأخيرة التزم فعلاً وما بصير نحسبها عليه.
 *
 * التذكرة اللي مهلتها صفر (سياسة معطّلة) بترجّع null — مش "ملتزم".
 */
export function slaCheck(t, now = Date.now()) {
  const out = {
    reply_mins: null, resolve_mins: null,
    reply_due_at: null, resolve_due_at: null,
    reply_breached: null, resolve_breached: null,
    reply_left_mins: null, resolve_left_mins: null
  };
  const opened = Number(t?.opened_at);
  if (!Number.isFinite(opened)) return out;

  const mins = (ms) => Math.round(ms / 60000);

  const rh = Number(t.sla_reply_h);
  if (Number.isFinite(rh) && rh > 0) {
    const due = opened + rh * HOUR;
    out.reply_due_at = due;
    if (t.first_reply_at != null) {
      out.reply_mins = mins(Number(t.first_reply_at) - opened);
      out.reply_breached = Number(t.first_reply_at) > due;
    } else {
      out.reply_breached = now > due;
      out.reply_left_mins = mins(due - now);
    }
  } else if (t.first_reply_at != null) {
    out.reply_mins = mins(Number(t.first_reply_at) - opened);   // منقيس حتى لو ما في سياسة
  }

  const sh = Number(t.sla_resolve_h);
  if (Number.isFinite(sh) && sh > 0) {
    const due = opened + sh * HOUR;
    out.resolve_due_at = due;
    if (t.resolved_at != null) {
      out.resolve_mins = mins(Number(t.resolved_at) - opened);
      out.resolve_breached = Number(t.resolved_at) > due;
    } else {
      out.resolve_breached = now > due;
      out.resolve_left_mins = mins(due - now);
    }
  } else if (t.resolved_at != null) {
    out.resolve_mins = mins(Number(t.resolved_at) - opened);
  }
  return out;
}

/**
 * (7) مؤشرات الأداء.
 * كل مؤشر بلا بيانات بيرجع null — ممنوع نطلّع صفر يوهم إنّ
 * الأداء ممتاز واحنا أصلاً ما عنا ولا تذكرة.
 */
export function kpis(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const fr = [], rs = [];
  for (const t of list) {
    const o = Number(t.opened_at);
    if (t.first_reply_at != null && Number.isFinite(o)) fr.push((Number(t.first_reply_at) - o) / 60000);
    if (t.resolved_at != null && Number.isFinite(o)) rs.push((Number(t.resolved_at) - o) / 60000);
  }
  // مقام نسبة إعادة الفتح = اللي وصلوا لمرحلة الحل مرة على الأقل.
  // اللي لسا مفتوح ما إلو علاقة بالنسبة، وحطّه بالمقام بيخفّضها كذباً.
  const base = list.filter((t) => t.resolved_at != null || Number(t.reopen_count) > 0);
  const reopened = list.filter((t) => Number(t.reopen_count) > 0);

  return {
    tickets: list.length,
    open: list.filter((t) => OPEN_STATES.includes(t.status)).length,
    resolved: list.filter((t) => t.resolved_at != null).length,
    no_reply: list.filter((t) => t.first_reply_at == null).length,
    first_reply_n: fr.length,
    first_reply_avg: avg(fr),
    first_reply_median: median(fr),
    resolve_n: rs.length,
    resolve_avg: avg(rs),
    resolve_median: median(rs),
    reopened: reopened.length,
    reopen_base: base.length,
    reopen_rate: base.length ? r2((reopened.length * 100) / base.length) : null
  };
}

/**
 * (3)+(8) عدّاد تكرار على حقل واحد.
 * الخانة الفاضية ما بتتحسب ضمن الترتيب — بترجع كـ blank
 * منفصلة، حتى ما نقول "أكثر منطقة شكاوى: (فاضي)".
 */
export function tally(rows, field) {
  const m = new Map();
  let blank = 0;
  for (const r of rows || []) {
    const k = String(r?.[field] ?? "").trim();
    if (!k) { blank++; continue; }
    m.set(k, (m.get(k) || 0) + 1);
  }
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  return {
    rows: [...m.entries()]
      .map(([label, n]) => ({ label, n, share: total ? r2((n * 100) / total) : null }))
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, "ar")),
    counted: total,
    blank
  };
}

/**
 * (9) تعبئة قالب. المتغيّر اللي ما إلو قيمة بيضل ظاهر بقوسينه
 * وبينتبلّغ عنه بـmissing — أحسن ما نحط اسم أو رقم من راسنا
 * بيروح للزبون غلط.
 */
export function fillTemplate(body, vars) {
  const missing = [];
  const text = String(body ?? "").replace(/\{([^{}\n]{1,40})\}/g, (m, k) => {
    const key = k.trim();
    const v = vars ? vars[key] : undefined;
    if (v === undefined || v === null || String(v).trim() === "") {
      if (!missing.includes(key)) missing.push(key);
      return m;
    }
    return String(v);
  });
  return { text, missing };
}

// ── قراءة التذاكر مع فحص الـSLA ──
function ticketsWhere(q = {}) {
  const w = [], p = [];
  const from = dayStart(q.from), to = dayStart(q.to);
  if (from != null) { w.push("opened_at >= ?"); p.push(from); }
  if (to != null) { w.push("opened_at < ?"); p.push(to + DAY); }
  if (q.status && STATUSES.includes(q.status)) { w.push("status = ?"); p.push(q.status); }
  if (q.reason) { w.push("reason = ?"); p.push(String(q.reason)); }
  if (q.assignee) { w.push("assignee = ?"); p.push(String(q.assignee)); }
  if (q.priority && PRIORITIES.includes(q.priority)) { w.push("priority = ?"); p.push(q.priority); }
  if (q.open === "1") { w.push(`status IN (${OPEN_STATES.map(() => "?").join(",")})`); p.push(...OPEN_STATES); }
  return { sql: w.length ? " WHERE " + w.join(" AND ") : "", params: p };
}

export function listTickets(q = {}, now = Date.now()) {
  const { sql, params } = ticketsWhere(q);
  const rows = db.prepare("SELECT * FROM service_tickets" + sql +
                          " ORDER BY opened_at DESC, id DESC LIMIT 2000").all(...params);
  return rows.map((t) => ({ ...t, sla: slaCheck(t, now) }));
}

function getTicket(id) {
  return db.prepare("SELECT * FROM service_tickets WHERE id=?").get(Number(id));
}

/** (2) كل تغيير بينكتب هون. بلا سطر بالسجل ما في تعديل — نقطة. */
function logEvent(ticketId, actor, action, field, oldV, newV, note, at) {
  db.prepare(`INSERT INTO service_events (ticket_id,actor,action,field,old_value,new_value,note,at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(Number(ticketId), txt(actor, 60), txt(action, 40), txt(field, 40),
         txt(oldV ?? "", 200), txt(newV ?? "", 200), txt(note, 400), Number(at) || Date.now());
}

/** الطلب المربوط — بينجاب من جدول orders نفسه، مش بينتكتب بالإيد */
function findOrder(id) {
  try { return db.prepare("SELECT * FROM orders WHERE id=?").get(Number(id)) || null; }
  catch { return null; }
}

export const router = Router();
router.use(express.json({ limit: "5mb" }));

const ok = (res, data) => res.json({ ok: true, ...data });
const bad = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });

// ═══════════════ الميتا والإعدادات ═══════════════
router.get("/meta", (req, res) => {
  ok(res, {
    statuses: STATUSES, open_states: OPEN_STATES, priorities: PRIORITIES,
    channels: CHANNELS, comp_kinds: COMP_KINDS,
    return_kinds: RETURN_KINDS, return_states: RETURN_STATES,
    reasons: db.prepare("SELECT id,label,active FROM service_reasons ORDER BY id").all(),
    ...slaPolicy(),
    policy: "ما في ولا إرسال تلقائي للزبون من هالوحدة — القوالب للنسخ اليدوي فقط"
  });
});

router.post("/config", (req, res) => {
  const b = req.body || {};
  const rep = Number(b.sla_reply_h), rsv = Number(b.sla_resolve_h);
  if (!Number.isFinite(rep) || rep < 0 || rep > 720) return bad(res, "مهلة أول رد لازم رقم بين 0 و 720 ساعة");
  if (!Number.isFinite(rsv) || rsv < 0 || rsv > 8760) return bad(res, "مهلة الحل لازم رقم بين 0 و 8760 ساعة");
  if (rep > 0 && rsv > 0 && rsv < rep) return bad(res, "مهلة الحل ما بصير أقصر من مهلة أول رد");
  setSetting("sla_reply_h", r2(rep));
  setSetting("sla_resolve_h", r2(rsv));
  ok(res, slaPolicy());
});

// ═══════════════ (3) أسباب الشكاوى ═══════════════
router.get("/reasons", (req, res) => {
  const rows = db.prepare("SELECT id,label,active FROM service_reasons ORDER BY id").all();
  const tickets = db.prepare("SELECT reason FROM service_tickets").all();
  ok(res, { rows, usage: tally(tickets, "reason") });
});

router.post("/reasons", (req, res) => {
  const label = txt(req.body?.label, 60);
  if (!label) return bad(res, "أدخل اسم السبب");
  try { db.prepare("INSERT INTO service_reasons (label,active) VALUES (?,1)").run(label); }
  catch { return bad(res, "السبب موجود من قبل"); }
  ok(res, {});
});

router.post("/reasons/:id/toggle", (req, res) => {
  const r = db.prepare("SELECT * FROM service_reasons WHERE id=?").get(Number(req.params.id));
  if (!r) return bad(res, "السبب غير موجود", 404);
  db.prepare("UPDATE service_reasons SET active=? WHERE id=?").run(r.active ? 0 : 1, r.id);
  ok(res, { active: r.active ? 0 : 1 });
});

// ═══════════════ (1) التذاكر ═══════════════
router.get("/tickets", (req, res) => {
  const rows = listTickets(req.query);
  ok(res, {
    rows,
    summary: kpis(rows),
    breached: rows.filter((t) => t.sla.reply_breached === true || t.sla.resolve_breached === true).length
  });
});

router.post("/tickets", (req, res) => {
  const b = req.body || {};
  const actor = txt(b.actor, 60);
  if (!actor) return bad(res, "لازم تكتب مين فتح التذكرة — بلا اسم ما منسجّل");
  const subject = txt(b.subject, 200);
  if (!subject) return bad(res, "أدخل موضوع الشكوى");

  const reason = txt(b.reason, 60);
  if (reason) {
    const known = db.prepare("SELECT id FROM service_reasons WHERE label=?").get(reason);
    if (!known) return bad(res, "سبب الشكوى مش من القائمة — أضفه أول من تبويب الأسباب");
  }
  const priority = txt(b.priority, 20) || "عادي";
  if (!PRIORITIES.includes(priority)) return bad(res, "الأولوية لازم تكون: " + PRIORITIES.join(" / "));
  const channel = txt(b.channel, 20) || "ماسنجر";
  if (!CHANNELS.includes(channel)) return bad(res, "قناة التواصل لازم تكون: " + CHANNELS.join(" / "));

  const openedAt = b.opened_at == null || b.opened_at === "" ? Date.now() : Number(b.opened_at);
  if (!Number.isFinite(openedAt) || openedAt <= 0) return bad(res, "وقت فتح التذكرة غير صالح");

  // الربط بالطلب: منجيب المنطقة والزبون من الطلب نفسه بدل ما نطلب
  // من الموظف يعيد كتابتهم (وبالتالي يغلط فيهم)
  let order = null;
  if (b.order_id != null && b.order_id !== "") {
    order = findOrder(b.order_id);
    if (!order) return bad(res, "رقم الطلب مش موجود بجدول الطلبات");
  }

  const pol = slaPolicy();
  const now = Date.now();
  const row = {
    order_id: order ? Number(order.id) : null,
    sender_id: txt(b.sender_id, 60) || (order?.sender_id ?? ""),
    page_id: txt(b.page_id, 60) || (order?.page_id ?? ""),
    customer: txt(b.customer, 120),
    phone: txt(b.phone, 30) || (order?.phone ?? ""),
    area: txt(b.area, 80) || (order?.area ?? ""),
    item: txt(b.item, 120),
    reason, channel, subject,
    body: txt(b.body, 2000),
    priority,
    assignee: txt(b.assignee, 60),
    sla_reply_h: pol.sla_reply_h,
    sla_resolve_h: pol.sla_resolve_h,
    opened_at: openedAt
  };

  const id = db.transaction(() => {
    const r = db.prepare(`INSERT INTO service_tickets
        (order_id,sender_id,page_id,customer,phone,area,item,reason,channel,subject,body,
         priority,status,assignee,sla_reply_h,sla_resolve_h,opened_at,reopen_count,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'جديد',?,?,?,?,0,?)`)
      .run(row.order_id, row.sender_id, row.page_id, row.customer, row.phone, row.area, row.item,
           row.reason, row.channel, row.subject, row.body, row.priority, row.assignee,
           row.sla_reply_h, row.sla_resolve_h, row.opened_at, now);
    const tid = Number(r.lastInsertRowid);
    logEvent(tid, actor, "فتح تذكرة", "", "", "جديد",
             order ? `مربوطة بالطلب #${order.id}` : "", now);
    return tid;
  })();

  const t = getTicket(id);
  ok(res, { id, ticket: { ...t, sla: slaCheck(t) } });
});

router.get("/tickets/:id", (req, res) => {
  const t = getTicket(req.params.id);
  if (!t) return bad(res, "التذكرة غير موجودة", 404);
  ok(res, {
    ticket: { ...t, sla: slaCheck(t) },
    order: t.order_id ? findOrder(t.order_id) : null,
    events: db.prepare("SELECT * FROM service_events WHERE ticket_id=? ORDER BY at, id").all(t.id),
    comps: db.prepare("SELECT * FROM service_comps WHERE ticket_id=? ORDER BY at, id").all(t.id),
    returns: db.prepare("SELECT * FROM service_returns WHERE ticket_id=? ORDER BY id").all(t.id),
    comp_total: r2(db.prepare("SELECT COALESCE(SUM(amount),0) s FROM service_comps WHERE ticket_id=?")
      .get(t.id)?.s)
  });
});

// (1)+(2) تعديل التذكرة — كل حقل بيتغيّر بينكتب بالسجل باسم صاحبه
const EDITABLE = {
  status: { label: "الحالة", check: (v) => STATUSES.includes(v), err: "الحالة لازم تكون: " + STATUSES.join(" / ") },
  priority: { label: "الأولوية", check: (v) => PRIORITIES.includes(v), err: "الأولوية لازم تكون: " + PRIORITIES.join(" / ") },
  assignee: { label: "المسؤول", check: () => true },
  reason: { label: "السبب", check: (v) => !v || !!db.prepare("SELECT id FROM service_reasons WHERE label=?").get(v),
            err: "سبب الشكوى مش من القائمة" },
  item: { label: "الصنف", check: () => true },
  area: { label: "المنطقة", check: () => true },
  customer: { label: "الزبون", check: () => true },
  phone: { label: "الهاتف", check: () => true },
  subject: { label: "الموضوع", check: (v) => !!v, err: "الموضوع ما بصير يفضى" }
};

router.post("/tickets/:id", (req, res) => {
  const t = getTicket(req.params.id);
  if (!t) return bad(res, "التذكرة غير موجودة", 404);
  const b = req.body || {};
  const actor = txt(b.actor, 60);
  if (!actor) return bad(res, "لازم تكتب مين عمل التعديل — ما في تعديل صامت");

  const at = Date.now();
  const changes = [];
  for (const [key, def] of Object.entries(EDITABLE)) {
    if (b[key] === undefined) continue;
    const nv = txt(b[key], 200);
    if (!def.check(nv)) return bad(res, def.err || "قيمة غير صالحة");
    if (String(t[key] ?? "") === nv) continue;
    changes.push({ key, label: def.label, old: String(t[key] ?? ""), nv });
  }
  const note = txt(b.note, 400);
  if (!changes.length && !note) return bad(res, "ما في شي جديد للحفظ");

  db.transaction(() => {
    for (const c of changes) {
      db.prepare(`UPDATE service_tickets SET ${c.key}=? WHERE id=?`).run(c.nv, t.id);
      logEvent(t.id, actor, "تعديل", c.label, c.old, c.nv, "", at);

      if (c.key === "status") {
        // الحل والإغلاق بينختموا بوقتهم — ومنه بينحسب وقت الحل الحقيقي
        if (c.nv === "تم الحل" && t.resolved_at == null)
          db.prepare("UPDATE service_tickets SET resolved_at=? WHERE id=?").run(at, t.id);
        if (c.nv === "مغلق") {
          db.prepare("UPDATE service_tickets SET closed_at=? WHERE id=?").run(at, t.id);
          if (t.resolved_at == null)
            db.prepare("UPDATE service_tickets SET resolved_at=? WHERE id=?").run(at, t.id);
        }
      }
    }
    if (note) logEvent(t.id, actor, "ملاحظة", "", "", "", note, at);
  })();

  const nt = getTicket(t.id);
  ok(res, { changed: changes.length, ticket: { ...nt, sla: slaCheck(nt) } });
});

/**
 * (4) تسجيل أول رد. منختم الوقت مرة وحدة بس — لأنّ "أول رد"
 * إذا انداس عليه كل مرة بترد، بيصير المؤشر مجاملة مش قياس.
 */
router.post("/tickets/:id/reply", (req, res) => {
  const t = getTicket(req.params.id);
  if (!t) return bad(res, "التذكرة غير موجودة", 404);
  const actor = txt(req.body?.actor, 60);
  if (!actor) return bad(res, "لازم تكتب مين رد");
  if (t.first_reply_at != null) return bad(res, "أول رد مسجّل من قبل — ما منداس عليه");

  const at = req.body?.at == null || req.body?.at === "" ? Date.now() : Number(req.body.at);
  if (!Number.isFinite(at) || at < Number(t.opened_at))
    return bad(res, "وقت الرد ما بصير قبل وقت فتح التذكرة");

  db.transaction(() => {
    db.prepare("UPDATE service_tickets SET first_reply_at=? WHERE id=?").run(at, t.id);
    if (t.status === "جديد")
      db.prepare("UPDATE service_tickets SET status='قيد المعالجة' WHERE id=?").run(t.id);
    logEvent(t.id, actor, "أول رد", "", "", String(at), txt(req.body?.note, 400), at);
  })();

  const nt = getTicket(t.id);
  ok(res, { ticket: { ...nt, sla: slaCheck(nt) } });
});

/** (7) إعادة الفتح — بتنعدّ، لأنها أصدق مؤشر إنّ الحل كان شكلي */
router.post("/tickets/:id/reopen", (req, res) => {
  const t = getTicket(req.params.id);
  if (!t) return bad(res, "التذكرة غير موجودة", 404);
  const actor = txt(req.body?.actor, 60);
  if (!actor) return bad(res, "لازم تكتب مين أعاد الفتح");
  if (!DONE_STATES.includes(t.status)) return bad(res, "التذكرة لسا مفتوحة — ما في شي نعيد فتحه");
  const reason = txt(req.body?.note, 400);
  if (!reason) return bad(res, "اكتب ليش رجعت انفتحت — بلا سبب ما بتفيدنا");

  const at = Date.now();
  db.transaction(() => {
    db.prepare(`UPDATE service_tickets SET status='قيد المعالجة', resolved_at=NULL,
                closed_at=NULL, reopen_count=reopen_count+1 WHERE id=?`).run(t.id);
    logEvent(t.id, actor, "إعادة فتح", "الحالة", t.status, "قيد المعالجة", reason, at);
  })();

  const nt = getTicket(t.id);
  ok(res, { reopen_count: nt.reopen_count, ticket: { ...nt, sla: slaCheck(nt) } });
});

router.get("/tickets/:id/events", (req, res) => {
  const t = getTicket(req.params.id);
  if (!t) return bad(res, "التذكرة غير موجودة", 404);
  ok(res, { rows: db.prepare("SELECT * FROM service_events WHERE ticket_id=? ORDER BY at, id").all(t.id) });
});

// ═══════════════ (5) التعويضات ═══════════════
router.post("/tickets/:id/comps", (req, res) => {
  const t = getTicket(req.params.id);
  if (!t) return bad(res, "التذكرة غير موجودة", 404);
  const b = req.body || {};
  const actor = txt(b.actor, 60);
  if (!actor) return bad(res, "لازم تكتب مين اعتمد التعويض");
  const kind = txt(b.kind, 30);
  if (!COMP_KINDS.includes(kind)) return bad(res, "نوع التعويض لازم يكون: " + COMP_KINDS.join(" / "));
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount < 0) return bad(res, "كلفة التعويض لازم رقم صفر أو أكثر");

  const at = Date.now();
  const id = db.transaction(() => {
    const r = db.prepare(`INSERT INTO service_comps (ticket_id,kind,amount,note,actor,at)
                          VALUES (?,?,?,?,?,?)`)
      .run(t.id, kind, r2(amount), txt(b.note, 400), actor, at);
    logEvent(t.id, actor, "تعويض", kind, "", String(r2(amount)), txt(b.note, 400), at);
    return Number(r.lastInsertRowid);
  })();
  ok(res, { id });
});

router.delete("/comps/:id", (req, res) => {
  const c = db.prepare("SELECT * FROM service_comps WHERE id=?").get(Number(req.params.id));
  if (!c) return bad(res, "التعويض غير موجود", 404);
  const actor = txt(req.query?.actor, 60) || "غير معروف";
  db.transaction(() => {
    db.prepare("DELETE FROM service_comps WHERE id=?").run(c.id);
    logEvent(c.ticket_id, actor, "حذف تعويض", c.kind, String(c.amount), "", "", Date.now());
  })();
  ok(res, {});
});

router.get("/comps", (req, res) => {
  const from = dayStart(req.query.from), to = dayStart(req.query.to);
  const w = [], p = [];
  if (from != null) { w.push("c.at >= ?"); p.push(from); }
  if (to != null) { w.push("c.at < ?"); p.push(to + DAY); }
  const rows = db.prepare(`SELECT c.*, t.subject, t.reason, t.customer, t.area
                           FROM service_comps c JOIN service_tickets t ON t.id=c.ticket_id
                           ${w.length ? "WHERE " + w.join(" AND ") : ""}
                           ORDER BY c.at DESC, c.id DESC LIMIT 2000`).all(...p);
  ok(res, {
    rows,
    total: r2(rows.reduce((a, r) => a + (Number(r.amount) || 0), 0)),
    by_kind: tally(rows, "kind").rows.map((k) => ({
      ...k, amount: r2(rows.filter((r) => r.kind === k.label).reduce((a, r) => a + (Number(r.amount) || 0), 0))
    })),
    by_reason: tally(rows, "reason")
  });
});

// ═══════════════ (6) الاسترجاع والاستبدال ═══════════════
router.post("/tickets/:id/returns", (req, res) => {
  const t = getTicket(req.params.id);
  if (!t) return bad(res, "التذكرة غير موجودة", 404);
  const b = req.body || {};
  const actor = txt(b.actor, 60);
  if (!actor) return bad(res, "لازم تكتب مين سجّل الطلب");
  const kind = txt(b.kind, 20);
  if (!RETURN_KINDS.includes(kind)) return bad(res, "النوع لازم يكون: " + RETURN_KINDS.join(" / "));
  const qty = Number(b.qty);
  if (!Number.isFinite(qty) || qty <= 0) return bad(res, "الكمية لازم أكبر من صفر");
  const refund = Number(b.refund ?? 0);
  if (!Number.isFinite(refund) || refund < 0) return bad(res, "المبلغ المسترجع لازم صفر أو أكثر");

  const now = Date.now();
  const id = db.transaction(() => {
    const r = db.prepare(`INSERT INTO service_returns
        (ticket_id,kind,item,qty,state,refund,note,created_at,updated_at)
        VALUES (?,?,?,?, 'مطلوب', ?,?,?,?)`)
      .run(t.id, kind, txt(b.item, 120) || t.item, qty, r2(refund), txt(b.note, 400), now, now);
    logEvent(t.id, actor, kind, "الحالة", "", "مطلوب", txt(b.note, 400), now);
    return Number(r.lastInsertRowid);
  })();
  ok(res, { id });
});

router.post("/returns/:id/state", (req, res) => {
  const rr = db.prepare("SELECT * FROM service_returns WHERE id=?").get(Number(req.params.id));
  if (!rr) return bad(res, "طلب الاسترجاع غير موجود", 404);
  const actor = txt(req.body?.actor, 60);
  if (!actor) return bad(res, "لازم تكتب مين غيّر الحالة");
  const state = txt(req.body?.state, 30);
  if (!RETURN_STATES.includes(state)) return bad(res, "الحالة لازم تكون: " + RETURN_STATES.join(" / "));
  if (state === rr.state) return bad(res, "الحالة زي ما هي");

  const at = Date.now();
  db.transaction(() => {
    db.prepare("UPDATE service_returns SET state=?, updated_at=? WHERE id=?").run(state, at, rr.id);
    logEvent(rr.ticket_id, actor, rr.kind, "حالة الاسترجاع", rr.state, state, "", at);
  })();
  ok(res, {});
});

router.get("/returns", (req, res) => {
  const rows = db.prepare(`SELECT r.*, t.subject, t.customer, t.area, t.reason
                           FROM service_returns r JOIN service_tickets t ON t.id=r.ticket_id
                           ORDER BY r.id DESC LIMIT 2000`).all();
  ok(res, {
    rows,
    by_state: tally(rows, "state"),
    by_kind: tally(rows, "kind"),
    refund_total: r2(rows.filter((r) => r.state === "تم التعويض")
      .reduce((a, r) => a + (Number(r.refund) || 0), 0))
  });
});

// ═══════════════ (7) لوحة الأداء ═══════════════
router.get("/kpis", (req, res) => {
  const rows = listTickets(req.query);
  const k = kpis(rows);
  const comp = db.prepare("SELECT COALESCE(SUM(amount),0) s, COUNT(*) c FROM service_comps").get();
  ok(res, {
    ...k,
    breached_reply: rows.filter((t) => t.sla.reply_breached === true).length,
    breached_resolve: rows.filter((t) => t.sla.resolve_breached === true).length,
    comp_total: r2(comp?.s), comp_count: Number(comp?.c) || 0,
    comp_per_ticket: rows.length ? r2(Number(comp?.s || 0) / rows.length) : null,
    basis: {
      المصدر: `${rows.length} تذكرة مسجّلة`,
      القياس: "أول رد = من فتح التذكرة لأول رد مسجّل. الحل = من الفتح لوقت «تم الحل»",
      "🔴_قيد": "المؤشر اللي ما إلو بيانات بيرجع null وبيظهر «—» — ما منحطّ صفر"
    }
  });
});

/** (4) قائمة المتجاوزين — الأهم بالصفحة، لأنها اللي بتتحرك عليها */
router.get("/breaches", (req, res) => {
  const rows = listTickets({ ...req.query });
  const reply = rows.filter((t) => t.sla.reply_breached === true);
  const resolve = rows.filter((t) => t.sla.resolve_breached === true);
  ok(res, {
    ...slaPolicy(),
    reply, resolve,
    counts: { reply: reply.length, resolve: resolve.length },
    at_risk: rows.filter((t) => t.sla.reply_breached === false && t.first_reply_at == null &&
                                t.sla.reply_left_mins != null && t.sla.reply_left_mins <= 60)
  });
});

// ═══════════════ (8) أكثر الأصناف والمناطق شكاوى ═══════════════
router.get("/hotspots", (req, res) => {
  const rows = listTickets(req.query);
  ok(res, {
    tickets: rows.length,
    areas: tally(rows, "area"),
    items: tally(rows, "item"),
    reasons: tally(rows, "reason"),
    priorities: tally(rows, "priority"),
    channels: tally(rows, "channel"),
    assignees: tally(rows, "assignee"),
    basis: "من التذاكر المسجّلة فقط — ما منستنتج صنف ولا منطقة من نص المحادثة"
  });
});

// ═══════════════ (9) الردود الجاهزة ═══════════════
router.get("/templates", (req, res) => {
  ok(res, { rows: db.prepare("SELECT * FROM service_templates ORDER BY uses DESC, id DESC").all() });
});

router.post("/templates", (req, res) => {
  const b = req.body || {};
  const t = txt(b.title, 120), body = String(b.body ?? "").trim().slice(0, 3000);
  if (!t) return bad(res, "أدخل عنوان القالب");
  if (!body) return bad(res, "أدخل نص الرد");
  const reason = txt(b.reason, 60);
  if (reason && !db.prepare("SELECT id FROM service_reasons WHERE label=?").get(reason))
    return bad(res, "سبب الشكوى مش من القائمة");
  try {
    const r = db.prepare("INSERT INTO service_templates (title,reason,body,uses,created_at) VALUES (?,?,?,0,?)")
      .run(t, reason, body, Date.now());
    ok(res, { id: Number(r.lastInsertRowid) });
  } catch { bad(res, "في قالب بنفس العنوان"); }
});

router.delete("/templates/:id", (req, res) => {
  db.prepare("DELETE FROM service_templates WHERE id=?").run(Number(req.params.id));
  ok(res, {});
});

/**
 * تعبئة القالب لتذكرة معيّنة — للنسخ اليدوي فقط.
 * 🔴 ما في ولا سطر بيرسل للزبون من هون، والمتغيّر الناقص
 * بيرجع كما هو مع تنبيه — الموظف بيكمّله بإيده.
 */
router.post("/templates/:id/render", (req, res) => {
  const tpl = db.prepare("SELECT * FROM service_templates WHERE id=?").get(Number(req.params.id));
  if (!tpl) return bad(res, "القالب غير موجود", 404);

  let vars = {};
  const tid = req.body?.ticket_id;
  let ticket = null;
  if (tid != null && tid !== "") {
    ticket = getTicket(tid);
    if (!ticket) return bad(res, "التذكرة غير موجودة", 404);
    const order = ticket.order_id ? findOrder(ticket.order_id) : null;
    vars = {
      "الاسم": ticket.customer,
      "رقم الطلب": ticket.order_id == null ? "" : String(ticket.order_id),
      "رقم التذكرة": String(ticket.id),
      "الصنف": ticket.item,
      "المنطقة": ticket.area,
      "المبلغ": order && order.total != null ? String(r2(order.total)) : "",
      "السبب": ticket.reason
    };
  }
  for (const [k, v] of Object.entries(req.body?.vars || {})) vars[String(k).trim()] = v;

  const out = fillTemplate(tpl.body, vars);
  db.prepare("UPDATE service_templates SET uses=uses+1 WHERE id=?").run(tpl.id);
  ok(res, {
    ...out,
    used_vars: vars,
    warning: out.missing.length
      ? "في متغيّرات ما لقينا إلها قيمة فتركناها زي ما هي: " + out.missing.join("، ")
      : "",
    note: "انسخ النص وابعته بإيدك — الوحدة ما بتبعت ولا رسالة لحالها"
  });
});

// ═══════════════ (10) التصدير والتقرير الشهري ═══════════════
router.get("/export.csv", (req, res) => {
  const rows = listTickets(req.query);
  const comps = new Map();
  for (const c of db.prepare("SELECT ticket_id, SUM(amount) s FROM service_comps GROUP BY ticket_id").all())
    comps.set(Number(c.ticket_id), r2(c.s));

  const head = ["رقم التذكرة", "تاريخ الفتح", "الزبون", "الهاتف", "المنطقة", "الصنف", "رقم الطلب",
                "السبب", "القناة", "الموضوع", "الأولوية", "الحالة", "المسؤول",
                "دقائق أول رد", "تجاوز مهلة الرد", "دقائق الحل", "تجاوز مهلة الحل",
                "مرات إعادة الفتح", "كلفة التعويض"];
  const yn = (v) => (v === null || v === undefined ? "—" : v ? "نعم" : "لا");
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [head.map(esc).join(",")];
  for (const t of rows) {
    lines.push([
      t.id, dayStr(t.opened_at), t.customer, t.phone, t.area, t.item, t.order_id ?? "",
      t.reason, t.channel, t.subject, t.priority, t.status, t.assignee,
      t.sla.reply_mins == null ? "—" : t.sla.reply_mins, yn(t.sla.reply_breached),
      t.sla.resolve_mins == null ? "—" : t.sla.resolve_mins, yn(t.sla.resolve_breached),
      t.reopen_count, comps.get(t.id) ?? 0
    ].map(esc).join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="service-tickets.csv"');
  res.send("﻿" + lines.join("\r\n"));   // BOM حتى إكسل يقرأ العربي صح
});

router.get("/report/monthly", (req, res) => {
  const range = monthRange(req.query.month);
  if (!range) return bad(res, "الشهر لازم بصيغة YYYY-MM");

  const rows = db.prepare("SELECT * FROM service_tickets WHERE opened_at >= ? AND opened_at < ? ORDER BY id")
    .all(range.from, range.to).map((t) => ({ ...t, sla: slaCheck(t) }));

  const comps = db.prepare("SELECT * FROM service_comps WHERE at >= ? AND at < ?").all(range.from, range.to);
  const compTotal = r2(comps.reduce((a, c) => a + (Number(c.amount) || 0), 0));

  // مقارنة بالشهر اللي قبله — وإذا ما في تذاكر بالشهر السابق
  // منقول "ما في مقارنة" بدل ما نطلّع نسبة تغيّر من صفر
  const prev = monthRange(prevMonth(req.query.month));
  const prevCount = prev
    ? Number(db.prepare("SELECT COUNT(*) c FROM service_tickets WHERE opened_at >= ? AND opened_at < ?")
        .get(prev.from, prev.to)?.c) || 0
    : 0;

  ok(res, {
    month: String(req.query.month),
    from: dayStr(range.from), to: dayStr(range.to - 1),
    tickets: rows.length,
    kpis: kpis(rows),
    by_status: tally(rows, "status"),
    by_reason: tally(rows, "reason"),
    by_area: tally(rows, "area"),
    by_item: tally(rows, "item"),
    by_assignee: tally(rows, "assignee"),
    breached_reply: rows.filter((t) => t.sla.reply_breached === true).length,
    breached_resolve: rows.filter((t) => t.sla.resolve_breached === true).length,
    compensation: { count: comps.length, total: compTotal, by_kind: tally(comps, "kind").rows },
    returns: db.prepare(`SELECT r.state, r.kind, COUNT(*) n FROM service_returns r
                         WHERE r.created_at >= ? AND r.created_at < ? GROUP BY r.state, r.kind`)
      .all(range.from, range.to),
    prev_month_tickets: prevCount,
    change_pct: prevCount ? r2(((rows.length - prevCount) * 100) / prevCount) : null,
    basis: prevCount ? "" : "ما في تذاكر بالشهر السابق — فما في نسبة تغيّر نقارن فيها"
  });
});

function prevMonth(s) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return "";
  const y = +m[1], mo = +m[2];
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
}
