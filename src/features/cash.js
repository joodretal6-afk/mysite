// ═══════════════════════════════════════════════════════════
// 💵 وحدة الخزنة والتدفق النقدي — 10 وظائف
//
//  1) الخزائن والحسابات (صندوق/بنك/محفظة) بأرصدتها
//  2) سجل الحركات النقدية (قبض/صرف) بالتصنيف والمرجع
//  3) تحويل بين الخزائن — بحركتين مترابطتين لازم يوازنوا
//  4) المستحقات على شركات التوصيل (كم تحصيل عندهم لسا)
//  5) استلام دفعة من شركة التوصيل ومطابقتها مع المستحق
//  6) الذمم (لنا/علينا) بأعمار الدين 0-30 / 31-60 / 60+
//  7) الشيكات المستلمة والصادرة بتواريخ استحقاقها
//  8) التدفق النقدي المتوقّع — من التزامات مسجّلة فقط
//  9) المصاريف المتكررة بجدولها الشهري
// 10) تقرير يومي/شهري للخزنة + تصدير CSV
//
// 🔴 القاعدة اللي ما منكسرها: الرصيد = مجموع الحركات. ما في
//    عمود "رصيد" محفوظ ولا رقم بينكتب من برّا بلا حركة توثّقه.
//    حتى الرصيد الافتتاحي بينتسجّل كحركة باسمها.
//    وأي قيمة ما منعرفها = null (بتطلع «—») مش صفر ولا تخمين.
//    التدفق المتوقّع مبني حصراً على التزامات مكتوبة (شيك، مستحق،
//    مصروف متكرر)، وكل سطر بيقول من وين إجا.
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import express from "express";
import { db } from "../db/database.js";

export const slug = "cash";
export const title = "الخزنة والتدفق النقدي";
export const icon = "💵";

try {
  db.exec(`
  CREATE TABLE IF NOT EXISTS cash_accounts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    kind       TEXT NOT NULL DEFAULT 'صندوق نقدي',
    holder     TEXT DEFAULT '',
    note       TEXT DEFAULT '',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cash_moves (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    amount     REAL NOT NULL,
    kind       TEXT NOT NULL,
    category   TEXT DEFAULT '',
    party      TEXT DEFAULT '',
    ref_type   TEXT DEFAULT '',
    ref_id     TEXT DEFAULT '',
    note       TEXT DEFAULT '',
    at         INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cash_moves_acc ON cash_moves(account_id, at);
  CREATE UNIQUE INDEX IF NOT EXISTS cash_moves_ref
    ON cash_moves(ref_type, ref_id, account_id) WHERE ref_type <> '';

  CREATE TABLE IF NOT EXISTS cash_transfers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id    INTEGER NOT NULL,
    to_id      INTEGER NOT NULL,
    amount     REAL NOT NULL,
    note       TEXT DEFAULT '',
    at         INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cash_dues (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    courier    TEXT NOT NULL,
    ref        TEXT DEFAULT '',
    amount     REAL NOT NULL,
    day        TEXT NOT NULL,
    expect_day TEXT DEFAULT '',
    note       TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cash_dues_courier ON cash_dues(courier, day);

  CREATE TABLE IF NOT EXISTS cash_settlements (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    courier    TEXT NOT NULL,
    account_id INTEGER NOT NULL,
    amount     REAL NOT NULL,
    fee        REAL NOT NULL DEFAULT 0,
    day        TEXT NOT NULL,
    note       TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cash_debts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    party      TEXT NOT NULL,
    direction  TEXT NOT NULL,
    amount     REAL NOT NULL,
    day        TEXT NOT NULL,
    due_day    TEXT DEFAULT '',
    phone      TEXT DEFAULT '',
    note       TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cash_cheques (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    direction  TEXT NOT NULL,
    number     TEXT NOT NULL,
    bank       TEXT DEFAULT '',
    party      TEXT DEFAULT '',
    amount     REAL NOT NULL,
    due_day    TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'قيد التحصيل',
    note       TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cash_recurring (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    category     TEXT NOT NULL DEFAULT 'أخرى',
    amount       REAL NOT NULL,
    day_of_month INTEGER NOT NULL DEFAULT 1,
    account_id   INTEGER,
    active       INTEGER NOT NULL DEFAULT 1,
    note         TEXT DEFAULT '',
    created_at   INTEGER NOT NULL
  );`);
} catch (e) { console.error("cash tables:", e && e.message); }

// ── ثوابت ──
const ACCOUNT_KINDS = ["صندوق نقدي", "حساب بنكي", "محفظة إلكترونية"];
const MOVE_KINDS = ["قبض", "صرف"];
const CATEGORIES = ["تحصيل توصيل", "مبيعات", "بضاعة", "إيجار", "رواتب", "إنترنت",
                    "إعلانات", "تغليف", "سداد ذمم", "تحويل", "رصيد افتتاحي", "شيكات", "أخرى"];
const DIRECTIONS = ["لنا", "علينا"];
const CHEQUE_DIRECTIONS = ["مستلم", "صادر"];
const CHEQUE_STATUSES = ["قيد التحصيل", "محصّل", "مرتجع", "ملغي"];

const DAY = 86400000;
const TZ_MS = 10800 * 1000;                 // نفس إزاحة المنصة (+3)

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const dayStr = (ts) => new Date(Number(ts) + TZ_MS).toISOString().slice(0, 10);
function dayStart(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) - TZ_MS : null;
}
const isDate = (s) => dayStart(s) != null;
const todayStr = () => dayStr(Date.now());
/** فرق الأيام بين تاريخين نصّيين — موجب يعني a قبل b */
const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / DAY);
const addDaysStr = (s, n) => dayStr(dayStart(s) + n * DAY);

// ═══════════════════════════════════════════════════════════
// 🧮 المحرّك — كل رقم مشتق، ما في رصيد مخزّن
// ═══════════════════════════════════════════════════════════

/** رصيد كل خزنة = مجموع حركاتها. الخزنة بلا حركات ما بتظهر بالخريطة. */
export function balanceMap() {
  const m = new Map();
  try {
    for (const r of db.prepare(
      "SELECT account_id, COALESCE(SUM(amount),0) s FROM cash_moves GROUP BY account_id").all())
      m.set(Number(r.account_id), r2(r.s));
  } catch { /* ما في حركات بعد */ }
  return m;
}

/** الخزائن مع أرصدتها وآخر حركة فيها (null = ما في ولا حركة، مش تاريخ مخترع) */
export function accountsView() {
  const rows = db.prepare("SELECT * FROM cash_accounts ORDER BY active DESC, id").all();
  const bal = balanceMap();
  const last = new Map();
  try {
    for (const r of db.prepare(
      "SELECT account_id, MAX(at) t, COUNT(*) c FROM cash_moves GROUP BY account_id").all())
      last.set(Number(r.account_id), { at: Number(r.t), moves: Number(r.c) });
  } catch { /* لا شيء */ }

  return rows.map((a) => {
    const l = last.get(a.id) || null;
    return {
      ...a,
      balance: bal.get(a.id) ?? 0,          // مجموع الحركات — والصفر هون حقيقي (ما في حركات)
      moves: l ? l.moves : 0,
      last_at: l ? l.at : null,             // 🔴 بلا حركات ما في "آخر حركة" — بتطلع «—»
      last_day: l ? dayStr(l.at) : null
    };
  });
}

/**
 * يسجّل حركة نقدية. الإشارة هي القرار: موجب = دخل للخزنة، سالب = طلع منها.
 * منجبر الإشارة من نوع الحركة حتى ما يصير صرف بيزيد الرصيد بالغلط.
 */
export function addMove({ account_id, amount, kind, category = "أخرى", party = "",
                          ref_type = "", ref_id = "", note = "", at = Date.now() }) {
  if (!MOVE_KINDS.includes(kind)) throw new Error("نوع الحركة لازم «قبض» أو «صرف»");
  const raw = Number(amount);
  if (!Number.isFinite(raw) || raw === 0) throw new Error("المبلغ لازم رقم مش صفر");
  const acc = db.prepare("SELECT id, active FROM cash_accounts WHERE id=?").get(Number(account_id));
  if (!acc) throw new Error("الخزنة غير موجودة");
  if (!acc.active) throw new Error("الخزنة موقوفة — ما بتستقبل حركات");
  const cat = CATEGORIES.includes(category) ? category : "أخرى";
  const signed = kind === "صرف" ? -Math.abs(raw) : Math.abs(raw);

  const r = db.prepare(`INSERT INTO cash_moves
      (account_id,amount,kind,category,party,ref_type,ref_id,note,at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(acc.id, r2(signed), kind, cat, String(party).slice(0, 120),
         String(ref_type).slice(0, 40), String(ref_id).slice(0, 60),
         String(note).slice(0, 300), Number(at) || Date.now());
  return Number(r.lastInsertRowid);
}

// ═══════════ (4)(5) مستحقات شركات التوصيل ═══════════
/**
 * مطابقة الدفعات مع المستحقات بطريقة FIFO: أقدم مستحق بينسدّ أول.
 * هيك بنعرف أي حمولة لسا فلوسها برّا — مش بس رقم إجمالي.
 * المخصوم (fee) بينحسب ضمن التغطية لأنه فعلاً انسدّ من المستحق،
 * بس ما بيدخل الخزنة — فالحركة النقدية بتكون بالصافي الواصل فقط.
 */
export function courierState(courier) {
  const w = courier ? " WHERE courier=?" : "";
  const p = courier ? [String(courier)] : [];
  const dues = db.prepare("SELECT * FROM cash_dues" + w + " ORDER BY day, id").all(...p);
  const setts = db.prepare("SELECT * FROM cash_settlements" + w + " ORDER BY day, id").all(...p);

  const byCourier = new Map();
  for (const d of dues) {
    if (!byCourier.has(d.courier)) byCourier.set(d.courier, { dues: [], covered: 0 });
    byCourier.get(d.courier).dues.push(d);
  }
  for (const s of setts) {
    if (!byCourier.has(s.courier)) byCourier.set(s.courier, { dues: [], covered: 0 });
    byCourier.get(s.courier).covered += r2(s.amount) + r2(s.fee);
  }

  const rows = [], couriers = [];
  for (const [name, g] of byCourier) {
    let left = r2(g.covered);
    let due = 0, outstanding = 0;
    for (const d of g.dues) {
      const amt = r2(d.amount);
      const paid = r2(Math.min(left, amt));
      left = r2(left - paid);
      const remaining = r2(amt - paid);
      due = r2(due + amt);
      outstanding = r2(outstanding + remaining);
      rows.push({ ...d, amount: amt, paid, remaining,
                  status: remaining <= 0 ? "مسدّد" : paid > 0 ? "مسدّد جزئياً" : "لسا عندهم" });
    }
    couriers.push({
      courier: name, due, covered: r2(g.covered), outstanding,
      // فايض = دفعوا أكثر من المسجّل عندك ⇒ في مستحق ناقص بالتسجيل، لازم تعرف
      overpaid: r2(left)
    });
  }
  rows.sort((a, b) => (a.day === b.day ? a.id - b.id : a.day.localeCompare(b.day)));
  couriers.sort((a, b) => b.outstanding - a.outstanding);
  return { rows, couriers };
}

// ═══════════ (6) الذمم وأعمار الدين ═══════════
/**
 * شريحة عمر الدين. الحدود بالضبط زي ما اتفقنا:
 * 0..30 و31..60 وكل اللي فوق الـ60. واللي لسا ما استحق إلو
 * شريحته لحاله — لأنه مش متأخّر أصلاً وما بصير نحسبه تأخير.
 */
export function agingBucket(days) {
  const d = Number(days);
  if (!Number.isFinite(d)) return null;
  if (d < 0) return "غير مستحق بعد";
  if (d <= 30) return "0-30";
  if (d <= 60) return "31-60";
  return "60+";
}

/** المدفوع على ذمّة معيّنة = مجموع الحركات المربوطة فيها (بالقيمة المطلقة) */
function debtPaidMap() {
  const m = new Map();
  try {
    for (const r of db.prepare(
      `SELECT ref_id, COALESCE(SUM(ABS(amount)),0) s FROM cash_moves
       WHERE ref_type='debt' GROUP BY ref_id`).all())
      m.set(String(r.ref_id), r2(r.s));
  } catch { /* لا شيء */ }
  return m;
}

export function debtsView(today = todayStr()) {
  const rows = db.prepare("SELECT * FROM cash_debts ORDER BY id").all();
  const paidMap = debtPaidMap();
  const out = rows.map((d) => {
    const amount = r2(d.amount);
    const paid = r2(Math.min(paidMap.get(String(d.id)) || 0, amount));
    const remaining = r2(amount - paid);
    // العمر بينحسب من تاريخ الاستحقاق إذا مكتوب، وإلا من تاريخ نشوء الدين
    const ref = d.due_day || d.day;
    const age = daysBetween(ref, today);
    return { ...d, amount, paid, remaining, age_days: age,
             bucket: remaining > 0 ? agingBucket(age) : "مسدّد", ref_day: ref };
  });

  const open = out.filter((d) => d.remaining > 0);
  const sum = (dir, bucket) => r2(open
    .filter((d) => d.direction === dir && (!bucket || d.bucket === bucket))
    .reduce((a, d) => a + d.remaining, 0));
  const aging = {};
  for (const dir of DIRECTIONS)
    aging[dir] = {
      total: sum(dir),
      "غير مستحق بعد": sum(dir, "غير مستحق بعد"),
      "0-30": sum(dir, "0-30"),
      "31-60": sum(dir, "31-60"),
      "60+": sum(dir, "60+")
    };
  return { rows: out, aging, net: r2(aging["لنا"].total - aging["علينا"].total) };
}

// ═══════════ (7) الشيكات ═══════════
export function chequesView({ warn = 7, today = todayStr() } = {}) {
  const rows = db.prepare("SELECT * FROM cash_cheques ORDER BY due_day, id").all().map((c) => {
    const left = daysBetween(today, c.due_day);
    return {
      ...c, amount: r2(c.amount), days_left: left,
      near: c.status === "قيد التحصيل" && left >= 0 && left <= warn,
      overdue: c.status === "قيد التحصيل" && left < 0
    };
  });
  const openOf = (dir) => rows.filter((c) => c.status === "قيد التحصيل" && c.direction === dir);
  const tot = (dir) => r2(openOf(dir).reduce((a, c) => a + c.amount, 0));
  return {
    rows,
    totals: {
      in_open: tot("مستلم"), out_open: tot("صادر"),
      net: r2(tot("مستلم") - tot("صادر")),
      near: rows.filter((c) => c.near).length,
      overdue: rows.filter((c) => c.overdue).length
    }
  };
}

// ═══════════ (9) المصاريف المتكررة ═══════════
/** تاريخ الاستحقاق داخل شهر معيّن، مع تقصيره لآخر يوم بالشهر القصير */
function occurrenceDay(ym, dom) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(ym || ""));
  if (!m) return null;
  const y = +m[1], mo = +m[2];
  const lastDom = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const d = Math.min(Math.max(1, Number(dom) || 1), lastDom);
  return `${m[1]}-${m[2]}-${String(d).padStart(2, "0")}`;
}

/** الأشهر المسدّدة لكل مصروف متكرر — من المراجع المكتوبة بالحركات نفسها */
function recurringPostedSet() {
  const s = new Set();
  try {
    for (const r of db.prepare("SELECT ref_id FROM cash_moves WHERE ref_type='recurring'").all())
      s.add(String(r.ref_id));
  } catch { /* لا شيء */ }
  return s;
}

// ═══════════════════════════════════════════════════════════
// (8) 🔮 التدفق النقدي المتوقّع
//
// ما في ولا رقم مخترع هون. كل سطر بيجي من التزام مكتوب:
//  • شيك قيد التحصيل بتاريخ استحقاقه
//  • مستحق على شركة توصيل إلو تاريخ وصول متوقّع مسجّل
//  • ذمّة لسا ما انسدّت وإلها تاريخ استحقاق
//  • مصروف متكرر نشط ما انسدّ لهذا الشهر
// واللي ما إلو تاريخ ما بيدخل التوقّع أبداً — بينطلع بقائمة
// «مستثنى» بسببه، حتى تعرف شو برّا الحساب بدل ما نخمّنه.
// ═══════════════════════════════════════════════════════════
export function forecast({ weeks = 6, today = todayStr() } = {}) {
  const n = Math.min(26, Math.max(1, Math.round(Number(weeks) || 6)));
  const horizon = addDaysStr(today, n * 7);
  const items = [], excluded = [];

  for (const c of db.prepare("SELECT * FROM cash_cheques WHERE status='قيد التحصيل'").all()) {
    items.push({ day: c.due_day, amount: c.direction === "مستلم" ? r2(c.amount) : -r2(c.amount),
                 source: "شيك", label: `شيك ${c.direction} رقم ${c.number}`, ref_id: c.id });
  }

  for (const d of courierState().rows) {
    if (d.remaining <= 0) continue;
    if (!isDate(d.expect_day)) {
      excluded.push({ source: "مستحق توصيل", label: `${d.courier} — ${d.ref || d.day}`,
                      amount: d.remaining, reason: "ما في تاريخ وصول متوقّع مسجّل" });
      continue;
    }
    items.push({ day: d.expect_day, amount: d.remaining, source: "مستحق توصيل",
                 label: `تحصيل من ${d.courier}`, ref_id: d.id });
  }

  for (const d of debtsView(today).rows) {
    if (d.remaining <= 0) continue;
    if (!isDate(d.due_day)) {
      excluded.push({ source: "ذمّة", label: `${d.party} (${d.direction})`,
                      amount: d.remaining, reason: "ما في تاريخ استحقاق مسجّل" });
      continue;
    }
    items.push({ day: d.due_day, amount: d.direction === "لنا" ? d.remaining : -d.remaining,
                 source: "ذمّة", label: `${d.direction}: ${d.party}`, ref_id: d.id });
  }

  const posted = recurringPostedSet();
  for (const rc of db.prepare("SELECT * FROM cash_recurring WHERE active=1").all()) {
    let ym = today.slice(0, 7);
    for (let i = 0; i < n / 4 + 2; i++) {
      const day = occurrenceDay(ym, rc.day_of_month);
      if (day && day >= today && day <= horizon && !posted.has(`${rc.id}:${ym}`))
        items.push({ day, amount: -r2(rc.amount), source: "مصروف متكرر",
                     label: `${rc.name} (${rc.category})`, ref_id: rc.id });
      const [y, m] = ym.split("-").map(Number);
      ym = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    }
  }

  // كل التزام تاريخه فات وما انسدّ بينتحسب على أول أسبوع — لأنه
  // مستحق هلأ فعلاً، مش لأنّا خمّنا إنه رح ينسدّ.
  const inWindow = items.filter((x) => x.day <= horizon);
  const buckets = [];
  const opening = r2([...balanceMap().values()].reduce((a, v) => a + v, 0));
  let running = opening;
  for (let i = 0; i < n; i++) {
    const from = addDaysStr(today, i * 7);
    const to = addDaysStr(today, (i + 1) * 7 - 1);
    const rows = inWindow.filter((x) => (i === 0 ? x.day <= to : x.day >= from && x.day <= to));
    const inflow = r2(rows.filter((x) => x.amount > 0).reduce((a, x) => a + x.amount, 0));
    const outflow = r2(-rows.filter((x) => x.amount < 0).reduce((a, x) => a + x.amount, 0));
    running = r2(running + inflow - outflow);
    buckets.push({ week: i + 1, from, to, inflow, outflow,
                   net: r2(inflow - outflow), closing: running, rows });
  }
  return {
    today, weeks: n, horizon, opening, closing: running,
    // 🔴 أخفض رصيد متوقّع — هاد الرقم اللي بيقولك إذا رح تعلق
    lowest: buckets.length ? Math.min(...buckets.map((b) => b.closing)) : opening,
    buckets, excluded
  };
}

// ═══════════ (10) التقارير ═══════════
export function dailyReport(from, to) {
  const w = [], p = [];
  if (from != null) { w.push("at >= ?"); p.push(from); }
  if (to != null) { w.push("at < ?"); p.push(to + DAY); }
  const rows = db.prepare("SELECT * FROM cash_moves" +
    (w.length ? " WHERE " + w.join(" AND ") : "") + " ORDER BY at, id").all(...p);

  // الرصيد الافتتاحي للفترة = كل اللي قبلها. بلا هيك التقرير بيكذب.
  const before = from == null ? { s: 0 }
    : db.prepare("SELECT COALESCE(SUM(amount),0) s FROM cash_moves WHERE at < ?").get(from);
  let running = r2(before?.s);

  const byDay = new Map();
  for (const m of rows) {
    const d = dayStr(m.at);
    const g = byDay.get(d) || { day: d, in: 0, out: 0, count: 0 };
    if (m.amount > 0) g.in += m.amount; else g.out += -m.amount;
    g.count++;
    byDay.set(d, g);
  }
  const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).map((g) => {
    running = r2(running + g.in - g.out);
    return { ...g, in: r2(g.in), out: r2(g.out), net: r2(g.in - g.out), closing: running };
  });
  return {
    opening: r2(before?.s), closing: running, days: days.reverse(),
    totals: {
      count: rows.length,
      in: r2(days.reduce((a, d) => a + d.in, 0)),
      out: r2(days.reduce((a, d) => a + d.out, 0)),
      net: r2(days.reduce((a, d) => a + d.net, 0))
    }
  };
}

export function monthlyReport(months = 6) {
  const n = Math.min(36, Math.max(1, Math.round(Number(months) || 6)));
  const rows = db.prepare("SELECT amount, at FROM cash_moves").all();
  const by = new Map();
  for (const m of rows) {
    const ym = dayStr(m.at).slice(0, 7);
    const g = by.get(ym) || { month: ym, in: 0, out: 0, count: 0 };
    if (m.amount > 0) g.in += m.amount; else g.out += -m.amount;
    g.count++;
    by.set(ym, g);
  }
  return [...by.values()]
    .map((g) => ({ ...g, in: r2(g.in), out: r2(g.out), net: r2(g.in - g.out) }))
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, n);
}

// ═══════════════════════════════════════════════════════════
// 🌐 الراوتر
// ═══════════════════════════════════════════════════════════
export const router = Router();
router.use(express.json({ limit: "5mb" }));

const ok = (res, data) => res.json({ ok: true, ...data });
const bad = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });
const guard = (fn) => (req, res) => {
  try { fn(req, res); } catch (e) { bad(res, e && e.message ? e.message : "خطأ غير متوقّع"); }
};

/** مبلغ موجب صالح، وإلا رسالة عربية واضحة */
function money(v, label = "المبلغ") {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} لازم رقم أكبر من صفر`);
  return r2(n);
}

router.get("/meta", (req, res) => ok(res, {
  account_kinds: ACCOUNT_KINDS, move_kinds: MOVE_KINDS, categories: CATEGORIES,
  directions: DIRECTIONS, cheque_directions: CHEQUE_DIRECTIONS, cheque_statuses: CHEQUE_STATUSES,
  today: todayStr()
}));

// ══════════ (1) الخزائن ══════════
router.get("/accounts", guard((req, res) => {
  const rows = accountsView();
  const live = rows.filter((a) => a.active);
  ok(res, {
    rows,
    totals: {
      accounts: rows.length,
      total: r2(live.reduce((a, x) => a + x.balance, 0)),
      cash: r2(live.filter((a) => a.kind === "صندوق نقدي").reduce((a, x) => a + x.balance, 0)),
      bank: r2(live.filter((a) => a.kind === "حساب بنكي").reduce((a, x) => a + x.balance, 0)),
      wallet: r2(live.filter((a) => a.kind === "محفظة إلكترونية").reduce((a, x) => a + x.balance, 0)),
      negative: rows.filter((a) => a.balance < 0).length
    }
  });
}));

router.post("/accounts", guard((req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim();
  if (!name) return bad(res, "اسم الخزنة مطلوب");
  if (!ACCOUNT_KINDS.includes(b.kind)) return bad(res, "نوع الخزنة لازم من: " + ACCOUNT_KINDS.join("، "));
  const opening = b.opening == null || b.opening === "" ? 0 : Number(b.opening);
  if (!Number.isFinite(opening)) return bad(res, "الرصيد الافتتاحي لازم رقم");

  const id = db.transaction(() => {
    const r = db.prepare(`INSERT INTO cash_accounts (name,kind,holder,note,active,created_at)
                          VALUES (?,?,?,?,1,?)`)
      .run(name.slice(0, 120), b.kind, String(b.holder || "").slice(0, 120),
           String(b.note || "").slice(0, 300), Date.now());
    const aid = Number(r.lastInsertRowid);
    // 🔴 حتى الرصيد الافتتاحي بينكتب كحركة — ما في رصيد بيوقع من السما
    if (opening !== 0)
      addMove({ account_id: aid, amount: Math.abs(opening),
                kind: opening > 0 ? "قبض" : "صرف", category: "رصيد افتتاحي",
                note: "رصيد افتتاحي عند إنشاء الخزنة" });
    return aid;
  })();
  ok(res, { id });
}));

router.post("/accounts/:id/toggle", guard((req, res) => {
  const r = db.prepare("UPDATE cash_accounts SET active = 1 - active WHERE id=?").run(Number(req.params.id));
  if (!r.changes) return bad(res, "الخزنة غير موجودة", 404);
  ok(res, {});
}));

router.delete("/accounts/:id", guard((req, res) => {
  const id = Number(req.params.id);
  const acc = db.prepare("SELECT id FROM cash_accounts WHERE id=?").get(id);
  if (!acc) return bad(res, "الخزنة غير موجودة", 404);
  const n = Number(db.prepare("SELECT COUNT(*) c FROM cash_moves WHERE account_id=?").get(id)?.c) || 0;
  // خزنة إلها حركات ما بتنمسح — بتنوقف. المسح بيمحي تاريخ فلوس حقيقي.
  if (n) {
    db.prepare("UPDATE cash_accounts SET active=0 WHERE id=?").run(id);
    return ok(res, { archived: true, moves: n });
  }
  db.prepare("DELETE FROM cash_accounts WHERE id=?").run(id);
  ok(res, { deleted: true });
}));

// ══════════ (2) الحركات ══════════
router.get("/moves", guard((req, res) => {
  const w = [], p = [];
  if (req.query.account_id) { w.push("m.account_id=?"); p.push(Number(req.query.account_id)); }
  if (req.query.kind) { w.push("m.kind=?"); p.push(String(req.query.kind)); }
  if (req.query.category) { w.push("m.category=?"); p.push(String(req.query.category)); }
  const from = dayStart(req.query.from), to = dayStart(req.query.to);
  if (from != null) { w.push("m.at >= ?"); p.push(from); }
  if (to != null) { w.push("m.at < ?"); p.push(to + DAY); }
  const rows = db.prepare(
    `SELECT m.*, a.name AS account_name, a.kind AS account_kind
     FROM cash_moves m JOIN cash_accounts a ON a.id=m.account_id
     ${w.length ? "WHERE " + w.join(" AND ") : ""}
     ORDER BY m.at DESC, m.id DESC LIMIT 1000`).all(...p);
  ok(res, {
    rows,
    totals: {
      count: rows.length,
      in: r2(rows.filter((r) => r.amount > 0).reduce((a, r) => a + r.amount, 0)),
      out: r2(-rows.filter((r) => r.amount < 0).reduce((a, r) => a + r.amount, 0))
    }
  });
}));

router.post("/moves", guard((req, res) => {
  const b = req.body || {};
  const at = b.day ? dayStart(b.day) : Date.now();
  if (b.day && at == null) return bad(res, "التاريخ لازم بصيغة YYYY-MM-DD");
  const id = addMove({ ...b, amount: money(b.amount), at });
  ok(res, { id });
}));

router.delete("/moves/:id", guard((req, res) => {
  const m = db.prepare("SELECT ref_type FROM cash_moves WHERE id=?").get(Number(req.params.id));
  if (!m) return bad(res, "الحركة غير موجودة", 404);
  // حركة التحويل ما بتنمسح لحالها — بتخلّي الطرف التاني معلّق وبيختلّ التوازن
  if (m.ref_type === "transfer")
    return bad(res, "هاي حركة تحويل — احذف التحويل نفسه حتى ينشال الطرفين مع بعض");
  db.prepare("DELETE FROM cash_moves WHERE id=?").run(Number(req.params.id));
  ok(res, {});
}));

router.get("/accounts/:id/ledger", guard((req, res) => {
  const id = Number(req.params.id);
  const acc = db.prepare("SELECT * FROM cash_accounts WHERE id=?").get(id);
  if (!acc) return bad(res, "الخزنة غير موجودة", 404);
  const moves = db.prepare("SELECT * FROM cash_moves WHERE account_id=? ORDER BY at, id").all(id);
  let run = 0;
  const rows = moves.map((m) => { run = r2(run + Number(m.amount)); return { ...m, balance: run }; });
  ok(res, {
    account: acc, rows: rows.reverse(), balance: run,
    in: r2(moves.filter((m) => m.amount > 0).reduce((a, m) => a + m.amount, 0)),
    out: r2(-moves.filter((m) => m.amount < 0).reduce((a, m) => a + m.amount, 0))
  });
}));

// ══════════ (3) التحويل بين الخزائن ══════════
router.get("/transfers", guard((req, res) => {
  ok(res, { rows: db.prepare(
    `SELECT t.*, f.name AS from_name, o.name AS to_name FROM cash_transfers t
     JOIN cash_accounts f ON f.id=t.from_id JOIN cash_accounts o ON o.id=t.to_id
     ORDER BY t.at DESC, t.id DESC LIMIT 300`).all() });
}));

router.post("/transfers", guard((req, res) => {
  const b = req.body || {};
  const from = Number(b.from_id), to = Number(b.to_id);
  if (!from || !to) return bad(res, "اختر خزنة المصدر وخزنة الوجهة");
  if (from === to) return bad(res, "ما بتقدر تحوّل من الخزنة لنفسها");
  const amount = money(b.amount);
  const at = b.day ? dayStart(b.day) : Date.now();
  if (b.day && at == null) return bad(res, "التاريخ لازم بصيغة YYYY-MM-DD");
  const note = String(b.note || "").slice(0, 300);

  // الحركتين بتنكتبوا سوا أو ما بتنكتبوا — حتى ما يضيع مبلغ بالنص
  const id = db.transaction(() => {
    const t = db.prepare("INSERT INTO cash_transfers (from_id,to_id,amount,note,at) VALUES (?,?,?,?,?)")
      .run(from, to, amount, note, at);
    const tid = Number(t.lastInsertRowid);
    addMove({ account_id: from, amount, kind: "صرف", category: "تحويل",
              ref_type: "transfer", ref_id: String(tid), at,
              note: note || "تحويل صادر" });
    addMove({ account_id: to, amount, kind: "قبض", category: "تحويل",
              ref_type: "transfer", ref_id: String(tid), at,
              note: note || "تحويل وارد" });
    return tid;
  })();
  ok(res, { id });
}));

router.delete("/transfers/:id", guard((req, res) => {
  const id = Number(req.params.id);
  const t = db.prepare("SELECT id FROM cash_transfers WHERE id=?").get(id);
  if (!t) return bad(res, "التحويل غير موجود", 404);
  db.transaction(() => {
    db.prepare("DELETE FROM cash_moves WHERE ref_type='transfer' AND ref_id=?").run(String(id));
    db.prepare("DELETE FROM cash_transfers WHERE id=?").run(id);
  })();
  ok(res, {});
}));

// ══════════ (4) المستحقات على شركات التوصيل ══════════
router.get("/couriers", guard((req, res) => {
  const st = courierState(req.query.courier ? String(req.query.courier) : null);
  ok(res, {
    ...st,
    totals: {
      due: r2(st.couriers.reduce((a, c) => a + c.due, 0)),
      covered: r2(st.couriers.reduce((a, c) => a + c.covered, 0)),
      outstanding: r2(st.couriers.reduce((a, c) => a + c.outstanding, 0)),
      overpaid: r2(st.couriers.reduce((a, c) => a + c.overpaid, 0))
    }
  });
}));

router.post("/dues", guard((req, res) => {
  const b = req.body || {};
  const courier = String(b.courier || "").trim();
  if (!courier) return bad(res, "اسم شركة التوصيل مطلوب");
  const day = String(b.day || "").trim() || todayStr();
  if (!isDate(day)) return bad(res, "تاريخ التسليم لازم بصيغة YYYY-MM-DD");
  const expect = String(b.expect_day || "").trim();
  if (expect && !isDate(expect)) return bad(res, "تاريخ الوصول المتوقّع لازم بصيغة YYYY-MM-DD");
  const r = db.prepare(`INSERT INTO cash_dues (courier,ref,amount,day,expect_day,note,created_at)
                        VALUES (?,?,?,?,?,?,?)`)
    .run(courier.slice(0, 80), String(b.ref || "").slice(0, 60), money(b.amount),
         day, expect, String(b.note || "").slice(0, 300), Date.now());
  ok(res, { id: Number(r.lastInsertRowid) });
}));

router.delete("/dues/:id", guard((req, res) => {
  const r = db.prepare("DELETE FROM cash_dues WHERE id=?").run(Number(req.params.id));
  if (!r.changes) return bad(res, "المستحق غير موجود", 404);
  ok(res, {});
}));

// ══════════ (5) استلام دفعة من شركة التوصيل ══════════
router.get("/settlements", guard((req, res) => {
  ok(res, { rows: db.prepare(
    `SELECT s.*, a.name AS account_name FROM cash_settlements s
     JOIN cash_accounts a ON a.id=s.account_id ORDER BY s.day DESC, s.id DESC LIMIT 300`).all() });
}));

router.post("/settlements", guard((req, res) => {
  const b = req.body || {};
  const courier = String(b.courier || "").trim();
  if (!courier) return bad(res, "اسم شركة التوصيل مطلوب");
  const amount = money(b.amount, "المبلغ الواصل");
  const fee = b.fee == null || b.fee === "" ? 0 : Number(b.fee);
  if (!Number.isFinite(fee) || fee < 0) return bad(res, "المخصوم لازم صفر أو أكثر");
  const day = String(b.day || "").trim() || todayStr();
  if (!isDate(day)) return bad(res, "التاريخ لازم بصيغة YYYY-MM-DD");

  const before = courierState(courier).couriers[0];
  if (!before) return bad(res, `ما في مستحقات مسجّلة على «${courier}» — سجّل المستحق أول`);
  const covering = r2(amount + fee);

  const id = db.transaction(() => {
    const s = db.prepare(`INSERT INTO cash_settlements
        (courier,account_id,amount,fee,day,note,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(courier.slice(0, 80), Number(b.account_id), amount, r2(fee), day,
           String(b.note || "").slice(0, 300), Date.now());
    const sid = Number(s.lastInsertRowid);
    // 🔴 الواصل بس بيدخل الخزنة. المخصوم ما مرّ عليها فما منسجّله قبض.
    addMove({ account_id: Number(b.account_id), amount, kind: "قبض", category: "تحصيل توصيل",
              party: courier, ref_type: "settlement", ref_id: String(sid), at: dayStart(day),
              note: `دفعة من ${courier}${fee ? ` (مخصوم ${r2(fee)})` : ""}` });
    return sid;
  })();

  const after = courierState(courier).couriers[0];
  ok(res, {
    id, covering,
    outstanding_before: before.outstanding,
    outstanding_after: after.outstanding,
    // فايض = غطّت أكثر من المسجّل ⇒ عندك مستحق ناسي تسجّله
    overpaid: after.overpaid,
    matched: r2(before.outstanding - after.outstanding)
  });
}));

router.delete("/settlements/:id", guard((req, res) => {
  const id = Number(req.params.id);
  const s = db.prepare("SELECT id FROM cash_settlements WHERE id=?").get(id);
  if (!s) return bad(res, "الدفعة غير موجودة", 404);
  db.transaction(() => {
    db.prepare("DELETE FROM cash_moves WHERE ref_type='settlement' AND ref_id=?").run(String(id));
    db.prepare("DELETE FROM cash_settlements WHERE id=?").run(id);
  })();
  ok(res, {});
}));

// ══════════ (6) الذمم ══════════
router.get("/debts", guard((req, res) => {
  const v = debtsView();
  const dir = String(req.query.direction || "");
  const openOnly = String(req.query.open || "") === "1";
  let rows = v.rows;
  if (DIRECTIONS.includes(dir)) rows = rows.filter((d) => d.direction === dir);
  if (openOnly) rows = rows.filter((d) => d.remaining > 0);
  ok(res, { rows, aging: v.aging, net: v.net });
}));

router.post("/debts", guard((req, res) => {
  const b = req.body || {};
  const party = String(b.party || "").trim();
  if (!party) return bad(res, "اسم الطرف مطلوب");
  if (!DIRECTIONS.includes(b.direction)) return bad(res, "الاتجاه لازم «لنا» أو «علينا»");
  const day = String(b.day || "").trim() || todayStr();
  if (!isDate(day)) return bad(res, "تاريخ الدين لازم بصيغة YYYY-MM-DD");
  const due = String(b.due_day || "").trim();
  if (due && !isDate(due)) return bad(res, "تاريخ الاستحقاق لازم بصيغة YYYY-MM-DD");
  if (due && due < day) return bad(res, "تاريخ الاستحقاق ما بصير قبل تاريخ الدين");
  const r = db.prepare(`INSERT INTO cash_debts (party,direction,amount,day,due_day,phone,note,created_at)
                        VALUES (?,?,?,?,?,?,?,?)`)
    .run(party.slice(0, 120), b.direction, money(b.amount), day, due,
         String(b.phone || "").slice(0, 40), String(b.note || "").slice(0, 300), Date.now());
  ok(res, { id: Number(r.lastInsertRowid) });
}));

router.post("/debts/:id/pay", guard((req, res) => {
  const id = Number(req.params.id);
  const d = debtsView().rows.find((x) => x.id === id);
  if (!d) return bad(res, "الذمّة غير موجودة", 404);
  if (d.remaining <= 0) return bad(res, "هاي الذمّة مسدّدة أصلاً");
  const amount = money(req.body?.amount);
  if (amount > d.remaining)
    return bad(res, `المبلغ أكبر من المتبقّي (${d.remaining}) — ما منسجّل سداد أكثر من الدين`);
  const day = String(req.body?.day || "").trim() || todayStr();
  if (!isDate(day)) return bad(res, "التاريخ لازم بصيغة YYYY-MM-DD");
  // «لنا» يعني بيدفعولنا ⇒ قبض. «علينا» يعني منحن بندفع ⇒ صرف.
  const mid = addMove({
    account_id: Number(req.body?.account_id), amount,
    kind: d.direction === "لنا" ? "قبض" : "صرف", category: "سداد ذمم", party: d.party,
    ref_type: "debt", ref_id: String(id), at: dayStart(day),
    note: `سداد ذمّة #${id} — ${d.party}`
  });
  ok(res, { move_id: mid, remaining: r2(d.remaining - amount) });
}));

router.delete("/debts/:id", guard((req, res) => {
  const id = Number(req.params.id);
  const paid = Number(db.prepare(
    "SELECT COUNT(*) c FROM cash_moves WHERE ref_type='debt' AND ref_id=?").get(String(id))?.c) || 0;
  // ذمّة انسدّ منها شي إلها أثر نقدي — مسحها بيخلّي حركات يتيمة
  if (paid) return bad(res, `الذمّة عليها ${paid} سداد مسجّل — ما بتنمسح. احذف السدادات أول.`);
  const r = db.prepare("DELETE FROM cash_debts WHERE id=?").run(id);
  if (!r.changes) return bad(res, "الذمّة غير موجودة", 404);
  ok(res, {});
}));

// ══════════ (7) الشيكات ══════════
router.get("/cheques", guard((req, res) => {
  const v = chequesView({ warn: Number(req.query.warn) || 7 });
  const dir = String(req.query.direction || "");
  ok(res, {
    rows: CHEQUE_DIRECTIONS.includes(dir) ? v.rows.filter((c) => c.direction === dir) : v.rows,
    totals: v.totals
  });
}));

router.post("/cheques", guard((req, res) => {
  const b = req.body || {};
  if (!CHEQUE_DIRECTIONS.includes(b.direction)) return bad(res, "نوع الشيك لازم «مستلم» أو «صادر»");
  const number = String(b.number || "").trim();
  if (!number) return bad(res, "رقم الشيك مطلوب");
  const due = String(b.due_day || "").trim();
  if (!isDate(due)) return bad(res, "تاريخ الاستحقاق لازم بصيغة YYYY-MM-DD");
  const r = db.prepare(`INSERT INTO cash_cheques
      (direction,number,bank,party,amount,due_day,status,note,created_at)
      VALUES (?,?,?,?,?,?,'قيد التحصيل',?,?)`)
    .run(b.direction, number.slice(0, 60), String(b.bank || "").slice(0, 80),
         String(b.party || "").slice(0, 120), money(b.amount), due,
         String(b.note || "").slice(0, 300), Date.now());
  ok(res, { id: Number(r.lastInsertRowid) });
}));

// صرف الشيك = حركة نقدية حقيقية بالخزنة، والحالة بتتغيّر معها بنفس اللحظة
router.post("/cheques/:id/cash", guard((req, res) => {
  const id = Number(req.params.id);
  const c = db.prepare("SELECT * FROM cash_cheques WHERE id=?").get(id);
  if (!c) return bad(res, "الشيك غير موجود", 404);
  if (c.status !== "قيد التحصيل") return bad(res, `الشيك حالته «${c.status}» — ما بينصرف مرة تانية`);
  const day = String(req.body?.day || "").trim() || todayStr();
  if (!isDate(day)) return bad(res, "التاريخ لازم بصيغة YYYY-MM-DD");
  const mid = db.transaction(() => {
    const m = addMove({
      account_id: Number(req.body?.account_id), amount: r2(c.amount),
      kind: c.direction === "مستلم" ? "قبض" : "صرف", category: "شيكات", party: c.party,
      ref_type: "cheque", ref_id: String(id), at: dayStart(day),
      note: `شيك ${c.direction} رقم ${c.number}`
    });
    db.prepare("UPDATE cash_cheques SET status='محصّل' WHERE id=?").run(id);
    return m;
  })();
  ok(res, { move_id: mid });
}));

router.post("/cheques/:id/status", guard((req, res) => {
  const id = Number(req.params.id);
  const st = String(req.body?.status || "");
  if (!CHEQUE_STATUSES.includes(st)) return bad(res, "الحالة لازم من: " + CHEQUE_STATUSES.join("، "));
  if (st === "محصّل") return bad(res, "التحصيل بيصير من زر «اصرف» حتى تنكتب حركة بالخزنة");
  const has = Number(db.prepare(
    "SELECT COUNT(*) c FROM cash_moves WHERE ref_type='cheque' AND ref_id=?").get(String(id))?.c) || 0;
  if (has) return bad(res, "الشيك إلو حركة نقدية مسجّلة — احذف الحركة أول إذا بدك ترجّع حالته");
  const r = db.prepare("UPDATE cash_cheques SET status=? WHERE id=?").run(st, id);
  if (!r.changes) return bad(res, "الشيك غير موجود", 404);
  ok(res, {});
}));

router.delete("/cheques/:id", guard((req, res) => {
  const id = Number(req.params.id);
  const has = Number(db.prepare(
    "SELECT COUNT(*) c FROM cash_moves WHERE ref_type='cheque' AND ref_id=?").get(String(id))?.c) || 0;
  if (has) return bad(res, "الشيك انصرف وإلو حركة بالخزنة — ما بينمسح");
  const r = db.prepare("DELETE FROM cash_cheques WHERE id=?").run(id);
  if (!r.changes) return bad(res, "الشيك غير موجود", 404);
  ok(res, {});
}));

// ══════════ (9) المصاريف المتكررة ══════════
router.get("/recurring", guard((req, res) => {
  const posted = recurringPostedSet();
  const today = todayStr(), ym = today.slice(0, 7);
  const rows = db.prepare(
    `SELECT r.*, a.name AS account_name FROM cash_recurring r
     LEFT JOIN cash_accounts a ON a.id=r.account_id ORDER BY r.active DESC, r.day_of_month`).all()
    .map((r) => {
      const due = occurrenceDay(ym, r.day_of_month);
      const isPosted = posted.has(`${r.id}:${ym}`);
      return {
        ...r, amount: r2(r.amount), this_month_day: due, posted_this_month: isPosted,
        // متأخّر = استحق هذا الشهر وما انسدّ. غير هيك ما منحكي متأخّر.
        overdue: !isPosted && r.active === 1 && due != null && due < today
      };
    });
  ok(res, {
    rows, month: ym,
    totals: {
      monthly: r2(rows.filter((r) => r.active).reduce((a, r) => a + r.amount, 0)),
      pending: rows.filter((r) => r.active && !r.posted_this_month).length,
      overdue: rows.filter((r) => r.overdue).length
    }
  });
}));

router.post("/recurring", guard((req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim();
  if (!name) return bad(res, "اسم المصروف مطلوب");
  const dom = Number(b.day_of_month);
  if (!Number.isInteger(dom) || dom < 1 || dom > 31) return bad(res, "يوم الاستحقاق لازم رقم بين 1 و 31");
  const cat = CATEGORIES.includes(b.category) ? b.category : "أخرى";
  const r = db.prepare(`INSERT INTO cash_recurring
      (name,category,amount,day_of_month,account_id,active,note,created_at)
      VALUES (?,?,?,?,?,1,?,?)`)
    .run(name.slice(0, 120), cat, money(b.amount), dom,
         b.account_id ? Number(b.account_id) : null,
         String(b.note || "").slice(0, 300), Date.now());
  ok(res, { id: Number(r.lastInsertRowid) });
}));

router.post("/recurring/:id/toggle", guard((req, res) => {
  const r = db.prepare("UPDATE cash_recurring SET active = 1 - active WHERE id=?").run(Number(req.params.id));
  if (!r.changes) return bad(res, "المصروف غير موجود", 404);
  ok(res, {});
}));

router.delete("/recurring/:id", guard((req, res) => {
  const r = db.prepare("DELETE FROM cash_recurring WHERE id=?").run(Number(req.params.id));
  if (!r.changes) return bad(res, "المصروف غير موجود", 404);
  ok(res, {});
}));

// ترحيل مصروف متكرر لشهر معيّن — مرة وحدة بس بفضل مفتاح المرجع الفريد
router.post("/recurring/:id/post", guard((req, res) => {
  const id = Number(req.params.id);
  const rc = db.prepare("SELECT * FROM cash_recurring WHERE id=?").get(id);
  if (!rc) return bad(res, "المصروف غير موجود", 404);
  const ym = String(req.body?.month || todayStr().slice(0, 7));
  const day = occurrenceDay(ym, rc.day_of_month);
  if (!day) return bad(res, "الشهر لازم بصيغة YYYY-MM");
  const account_id = Number(req.body?.account_id || rc.account_id);
  if (!account_id) return bad(res, "اختر الخزنة اللي رح ينصرف منها");
  try {
    const mid = addMove({ account_id, amount: r2(rc.amount), kind: "صرف", category: rc.category,
                          ref_type: "recurring", ref_id: `${id}:${ym}`, at: dayStart(day),
                          note: `${rc.name} — استحقاق ${ym}` });
    ok(res, { move_id: mid, day });
  } catch (e) {
    if (/UNIQUE|constraint/i.test(e.message))
      return bad(res, `«${rc.name}» مسدّد لشهر ${ym} من قبل — ما منكرّره`);
    throw e;
  }
}));

// ══════════ (8) التدفق المتوقّع ══════════
router.get("/forecast", guard((req, res) => ok(res, forecast({ weeks: req.query.weeks }))));

// ══════════ (10) التقارير ══════════
router.get("/report/daily", guard((req, res) => {
  const from = dayStart(req.query.from), to = dayStart(req.query.to);
  ok(res, dailyReport(from, to));
}));

router.get("/report/monthly", guard((req, res) => {
  ok(res, { months: monthlyReport(req.query.months) });
}));

/** ملخّص الصفحة الأولى — كل رقم منه مشتق من جدول حقيقي */
router.get("/overview", guard((req, res) => {
  const accs = accountsView().filter((a) => a.active);
  const cs = courierState();
  const dv = debtsView();
  const ch = chequesView();
  const f = forecast({ weeks: 4 });
  ok(res, {
    balance: r2(accs.reduce((a, x) => a + x.balance, 0)),
    accounts: accs.length,
    courier_outstanding: r2(cs.couriers.reduce((a, c) => a + c.outstanding, 0)),
    owed_to_us: dv.aging["لنا"].total,
    owed_by_us: dv.aging["علينا"].total,
    cheques_in: ch.totals.in_open, cheques_out: ch.totals.out_open,
    cheques_near: ch.totals.near, cheques_overdue: ch.totals.overdue,
    forecast_4w_net: r2(f.closing - f.opening),
    forecast_lowest: f.lowest,
    excluded_from_forecast: f.excluded.length
  });
}));

// ══════════ التصدير CSV ══════════
const csv = (res, name, head, lines) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  // BOM حتى إكسل يقرأ العربي صح
  res.send("﻿" + [head.map(esc).join(","), ...lines.map((l) => l.map(esc).join(","))].join("\r\n"));
};

router.get("/export/moves.csv", guard((req, res) => {
  const rows = db.prepare(
    `SELECT m.*, a.name AS account_name FROM cash_moves m
     JOIN cash_accounts a ON a.id=m.account_id ORDER BY m.at DESC, m.id DESC LIMIT 5000`).all();
  csv(res, "cash-moves.csv",
    ["التاريخ", "الخزنة", "النوع", "التصنيف", "الطرف", "المبلغ", "المرجع", "ملاحظة"],
    rows.map((m) => [dayStr(m.at), m.account_name, m.kind, m.category, m.party, r2(m.amount),
                     m.ref_type ? `${m.ref_type}:${m.ref_id}` : "—", m.note]));
}));

router.get("/export/aging.csv", guard((req, res) => {
  const v = debtsView();
  csv(res, "cash-aging.csv",
    ["الطرف", "الاتجاه", "المبلغ", "المسدّد", "المتبقّي", "تاريخ الدين", "الاستحقاق", "العمر بالأيام", "الشريحة"],
    v.rows.map((d) => [d.party, d.direction, d.amount, d.paid, d.remaining, d.day,
                       d.due_day || "—", d.age_days, d.bucket]));
}));

router.get("/export/forecast.csv", guard((req, res) => {
  const f = forecast({ weeks: req.query.weeks });
  const lines = [];
  for (const b of f.buckets)
    for (const r of b.rows)
      lines.push([`أسبوع ${b.week}`, r.day, r.source, r.label, r2(r.amount)]);
  csv(res, "cash-forecast.csv", ["الأسبوع", "التاريخ", "المصدر", "البيان", "المبلغ"], lines);
}));

router.get("/export/daily.csv", guard((req, res) => {
  const rep = dailyReport(dayStart(req.query.from), dayStart(req.query.to));
  csv(res, "cash-daily.csv", ["اليوم", "عدد الحركات", "قبض", "صرف", "الصافي", "الرصيد بنهاية اليوم"],
    rep.days.map((d) => [d.day, d.count, d.in, d.out, d.net, d.closing]));
}));
