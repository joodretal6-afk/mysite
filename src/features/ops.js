// ═══════════════════════════════════════════════════════════
// 🧊 وحدة التشغيل اليومي وسلامة الغذاء (ops) — 10 وظائف
//
//  1) قوائم الفحص اليومية (فتح / إغلاق / تحضير الطلبات) بعناصرها
//  2) تنفيذ القائمة ليوم معيّن: مين عمل شو ومتى، وشو انترك
//  3) سجل حرارة الثلاجات والبرادات بمداها المسموح
//  4) إنذار الخروج عن المدى + فتح حادثة تلقائياً
//  5) سجل النظافة والتعقيم بجدوله (يومي/أسبوعي/شهري) وشو استحق اليوم
//  6) سجل الحوادث والملاحظات بأسبابها وإجراءاتها التصحيحية
//  7) الورديات: مين شغّال أي يوم وأي فترة
//  8) المهام المتكررة بجدولها وتنبيه المتأخرة
//  9) لوحة الالتزام خلال فترة + أكثر بند بينتنسى
// 10) تصدير CSV + تقرير التزام شهري يصلح للعرض على الرقابة
//
// 🔴 القاعدة الحاكمة هون: اليوم اللي ما انسجّلت فيه قراءة حرارة
//    اسمه «ما في قراءة» — مش «سليم» ومش صفر. ونسبة الالتزام بلا
//    بيانات بترجع null حتى تطلع «—» بالواجهة بدل رقم مخترع.
//
// 🔴 وسجل الحرارة سجل رقابي: ممنوع ينتعدّل بصمت. أي تصحيح
//    بينكتب كسطر جديد بسببه، والسطر الأصلي بيضل مكانه.
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import express from "express";
import { db } from "../db/database.js";

export const slug = "ops";
export const title = "التشغيل وسلامة الغذاء";
export const icon = "🧊";

try {
  db.exec(`
  CREATE TABLE IF NOT EXISTS ops_checklists (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    kind       TEXT NOT NULL DEFAULT 'فتح',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ops_checklist_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    checklist_id INTEGER NOT NULL,
    text         TEXT NOT NULL,
    sort         INTEGER NOT NULL DEFAULT 0,
    critical     INTEGER NOT NULL DEFAULT 0,
    active       INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS ops_ci_list ON ops_checklist_items(checklist_id, sort);

  CREATE TABLE IF NOT EXISTS ops_runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    checklist_id INTEGER NOT NULL,
    day          TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'مفتوح',
    person       TEXT DEFAULT '',
    started_at   INTEGER NOT NULL,
    closed_at    INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ops_runs_uq ON ops_runs(checklist_id, day);

  CREATE TABLE IF NOT EXISTS ops_run_items (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id  INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    text    TEXT NOT NULL,
    critical INTEGER NOT NULL DEFAULT 0,
    done    INTEGER NOT NULL DEFAULT 0,
    person  TEXT DEFAULT '',
    at      INTEGER,
    note    TEXT DEFAULT ''
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ops_run_items_uq ON ops_run_items(run_id, item_id);

  CREATE TABLE IF NOT EXISTS ops_units (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    kind       TEXT NOT NULL DEFAULT 'براد',
    min_c      REAL NOT NULL,
    max_c      REAL NOT NULL,
    bounds     TEXT NOT NULL DEFAULT 'شامل',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ops_temps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id     INTEGER NOT NULL,
    day         TEXT NOT NULL,
    at          INTEGER NOT NULL,
    celsius     REAL NOT NULL,
    min_c       REAL NOT NULL,
    max_c       REAL NOT NULL,
    bounds      TEXT NOT NULL DEFAULT 'شامل',
    status      TEXT NOT NULL,
    person      TEXT DEFAULT '',
    note        TEXT DEFAULT '',
    corrects_id INTEGER,
    reason      TEXT DEFAULT '',
    voided      INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ops_temps_unit ON ops_temps(unit_id, day);

  CREATE TABLE IF NOT EXISTS ops_incidents (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    day       TEXT NOT NULL,
    at        INTEGER NOT NULL,
    source    TEXT NOT NULL DEFAULT 'يدوي',
    severity  TEXT NOT NULL DEFAULT 'متوسطة',
    title     TEXT NOT NULL,
    cause     TEXT DEFAULT '',
    action    TEXT DEFAULT '',
    person    TEXT DEFAULT '',
    status    TEXT NOT NULL DEFAULT 'مفتوحة',
    ref_type  TEXT DEFAULT '',
    ref_id    TEXT DEFAULT '',
    closed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS ops_inc_day ON ops_incidents(day);

  CREATE TABLE IF NOT EXISTS ops_clean_tasks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    area       TEXT DEFAULT '',
    freq       TEXT NOT NULL DEFAULT 'يومي',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ops_clean_logs (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    day     TEXT NOT NULL,
    person  TEXT DEFAULT '',
    note    TEXT DEFAULT '',
    at      INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ops_clean_uq ON ops_clean_logs(task_id, day);

  CREATE TABLE IF NOT EXISTS ops_shifts (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    day    TEXT NOT NULL,
    period TEXT NOT NULL,
    person TEXT NOT NULL,
    role   TEXT DEFAULT '',
    note   TEXT DEFAULT ''
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ops_shifts_uq ON ops_shifts(day, period, person);

  CREATE TABLE IF NOT EXISTS ops_routines (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    freq       TEXT NOT NULL DEFAULT 'يومي',
    owner      TEXT DEFAULT '',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ops_routine_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id INTEGER NOT NULL,
    day        TEXT NOT NULL,
    person     TEXT DEFAULT '',
    note       TEXT DEFAULT '',
    at         INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ops_routine_uq ON ops_routine_logs(routine_id, day);`);
} catch (e) { console.error("ops tables:", e && e.message); }

// ── ثوابت الوحدة ──
export const CHECKLIST_KINDS = ["فتح", "إغلاق", "تحضير الطلبات", "استلام بضاعة"];
export const UNIT_KINDS = ["براد", "فريزر", "ثلاجة عرض", "غرفة تبريد", "سيارة توصيل"];
export const FREQS = ["يومي", "أسبوعي", "شهري"];
export const PERIODS = ["صباحي", "مسائي", "ليلي"];
export const SEVERITIES = ["منخفضة", "متوسطة", "عالية"];
export const BOUNDS = ["شامل", "غير شامل"];
// كل جدولة وكم يوم بتستحق فيها — مرجع واحد حتى النظافة والمهام
// المتكررة يحسبوا بنفس المسطرة بلا تكرار كود.
const FREQ_DAYS = { "يومي": 1, "أسبوعي": 7, "شهري": 30 };

const DAY = 86400000;
const TZ_MS = 10800 * 1000;               // عمّان +3 — حتى «اليوم» يكون يوم المحل مش يوم UTC
const r1 = (v) => Math.round((Number(v) || 0) * 10) / 10;
const dayStr = (ts) => new Date(Number(ts) + TZ_MS).toISOString().slice(0, 10);
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
function dayStart(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) - TZ_MS : null;
}
const today = () => dayStr(Date.now());
/** فرق الأيام بين تاريخين بصيغة YYYY-MM-DD (موجب إذا b بعد a) */
export function daysBetween(a, b) {
  const x = dayStart(a), y = dayStart(b);
  if (x == null || y == null) return null;
  return Math.round((y - x) / DAY);
}
/** كل أيام الفترة شاملة الطرفين — أساس «اليوم اللي ما فيه قراءة» */
export function dayRange(from, to) {
  const a = dayStart(from), b = dayStart(to);
  if (a == null || b == null || b < a) return [];
  const out = [];
  for (let t = a; t <= b; t += DAY) out.push(dayStr(t));
  return out;
}
const pct = (done, total) => (total > 0 ? r1((done / total) * 100) : null);   // بلا مقام → null مش صفر

// ═══════════════════════════════════════════════════════════
// 🧮 المحرّك — منطق قابل للاختبار لحاله بلا راوتر ولا قاعدة
// ═══════════════════════════════════════════════════════════

/**
 * الحكم على قراءة حرارة مقابل مدى الجهاز.
 * «شامل» = القراءة على الحد بالضبط مقبولة (المدى المكتوب على
 * الجهاز عادة هيك). «غير شامل» = الحد نفسه مرفوض، لأنّ في أجهزة
 * مواصفتها «أقل من 4» مش «4 أو أقل» — والفرق بيعني إتلاف بضاعة.
 * @returns {{status:string,out:boolean,deviation:number}}
 */
export function evaluateTemp(celsius, unit) {
  const c = Number(celsius);
  if (!Number.isFinite(c)) throw new Error("القراءة لازم رقم بالدرجات");
  // null أو خانة فاضية مش صفر — الجهاز اللي ما إلو مدى مكتوب ما منحكم عليه
  const numOrNull = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const min = numOrNull(unit?.min_c), max = numOrNull(unit?.max_c);
  if (min == null || max == null) throw new Error("مدى الجهاز غير محدّد");
  const strict = String(unit?.bounds || "شامل") === "غير شامل";
  if (strict ? c <= min : c < min) return { status: "أدنى من المدى", out: true, deviation: r1(c - min) };
  if (strict ? c >= max : c > max) return { status: "أعلى من المدى", out: true, deviation: r1(c - max) };
  return { status: "ضمن المدى", out: false, deviation: 0 };
}

/**
 * هل البند مستحق بيوم معيّن حسب جدولته؟
 * اللي عمره ما انعمل → مستحق، وتأخيره «غير معروف» (null) مش رقم —
 * لأنّ ما بنعرف من إيمتى المفروض بلّش.
 * @returns {{due:boolean,days_since:number|null,overdue:number|null}}
 */
export function scheduleDue(freq, lastDay, day) {
  const every = FREQ_DAYS[freq];
  if (!every) throw new Error("الجدولة لازم تكون: " + FREQS.join(" / "));
  if (!isDay(day)) throw new Error("التاريخ لازم بصيغة YYYY-MM-DD");
  if (!lastDay) return { due: true, days_since: null, overdue: null };
  const since = daysBetween(lastDay, day);
  if (since == null) throw new Error("تاريخ آخر تنفيذ غير صالح");
  if (since < 0) return { due: false, days_since: since, overdue: 0 };   // انعمل بالمستقبل — ما إلو تأخير
  return { due: since >= every, days_since: since, overdue: Math.max(0, since - every) };
}

/** كم مرة المفروض ينعمل البند خلال فترة — من جدولته، مش من الهوا */
export function expectedRuns(freq, from, to) {
  const every = FREQ_DAYS[freq];
  if (!every) return null;
  const days = dayRange(from, to).length;
  if (!days) return null;
  return Math.floor(days / every);
}

const ok = (res, data) => res.json({ ok: true, ...data });
const bad = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });
const guard = (fn) => (req, res) => {
  try { fn(req, res); } catch (e) { bad(res, e && e.message ? e.message : "خطأ غير متوقّع"); }
};
const txt = (v, n) => String(v ?? "").trim().slice(0, n);

export const router = Router();
router.use(express.json({ limit: "5mb" }));

router.get("/meta", (req, res) => ok(res, {
  checklist_kinds: CHECKLIST_KINDS, unit_kinds: UNIT_KINDS, freqs: FREQS,
  periods: PERIODS, severities: SEVERITIES, bounds: BOUNDS, today: today()
}));

// ══════════ (1) قوائم الفحص وعناصرها ══════════
export function checklistsView() {
  const lists = db.prepare("SELECT * FROM ops_checklists ORDER BY active DESC, id").all();
  const items = db.prepare("SELECT * FROM ops_checklist_items WHERE active=1 ORDER BY sort, id").all();
  return lists.map((l) => ({ ...l, items: items.filter((i) => i.checklist_id === l.id) }));
}

router.get("/checklists", guard((req, res) => ok(res, { rows: checklistsView() })));

router.post("/checklists", guard((req, res) => {
  const name = txt(req.body?.name, 120);
  if (!name) return bad(res, "اسم القائمة مطلوب");
  const kind = txt(req.body?.kind, 40) || "فتح";
  if (!CHECKLIST_KINDS.includes(kind)) return bad(res, "نوع القائمة لازم يكون: " + CHECKLIST_KINDS.join(" / "));
  const r = db.prepare(`INSERT INTO ops_checklists (name,kind,active,created_at) VALUES (?,?,1,?)
                        ON CONFLICT(name) DO UPDATE SET kind=excluded.kind`).run(name, kind, Date.now());
  const id = Number(r.lastInsertRowid) ||
             Number(db.prepare("SELECT id FROM ops_checklists WHERE name=?").get(name).id);
  ok(res, { id });
}));

router.post("/checklists/:id/toggle", guard((req, res) => {
  db.prepare("UPDATE ops_checklists SET active = 1 - active WHERE id=?").run(Number(req.params.id));
  ok(res, {});
}));

router.post("/checklists/:id/items", guard((req, res) => {
  const cid = Number(req.params.id);
  if (!db.prepare("SELECT id FROM ops_checklists WHERE id=?").get(cid)) return bad(res, "القائمة غير موجودة", 404);
  const text = txt(req.body?.text, 200);
  if (!text) return bad(res, "نص البند مطلوب");
  const sort = Number(req.body?.sort);
  const r = db.prepare("INSERT INTO ops_checklist_items (checklist_id,text,sort,critical,active) VALUES (?,?,?,?,1)")
    .run(cid, text, Number.isFinite(sort) ? Math.round(sort) : 0, req.body?.critical ? 1 : 0);
  ok(res, { id: Number(r.lastInsertRowid) });
}));

// البند اللي انستعمل بتنفيذ سابق ما بينمسح — بينوقف، لأنّ مسحه
// بيزوّر تاريخ التنفيذ اللي انسجّل عليه.
router.delete("/checklists/items/:id", guard((req, res) => {
  const id = Number(req.params.id);
  const used = Number(db.prepare("SELECT COUNT(*) c FROM ops_run_items WHERE item_id=?").get(id)?.c) || 0;
  if (used) {
    db.prepare("UPDATE ops_checklist_items SET active=0 WHERE id=?").run(id);
    return ok(res, { archived: true, used });
  }
  db.prepare("DELETE FROM ops_checklist_items WHERE id=?").run(id);
  ok(res, { deleted: true });
}));

// ══════════ (2) تنفيذ قائمة فحص ليوم معيّن ══════════
/** بيفتح تنفيذ اليوم أو بيرجع المفتوح — التنفيذ الواحد لليوم الواحد */
export function openRun(checklist_id, day, person = "") {
  const list = db.prepare("SELECT * FROM ops_checklists WHERE id=?").get(Number(checklist_id));
  if (!list) throw new Error("القائمة غير موجودة");
  if (!isDay(day)) throw new Error("التاريخ لازم بصيغة YYYY-MM-DD");
  const exist = db.prepare("SELECT id FROM ops_runs WHERE checklist_id=? AND day=?").get(list.id, day);
  if (exist) return Number(exist.id);
  const now = Date.now();
  return db.transaction(() => {
    const r = db.prepare("INSERT INTO ops_runs (checklist_id,day,status,person,started_at) VALUES (?,?,'مفتوح',?,?)")
      .run(list.id, day, txt(person, 60), now);
    const rid = Number(r.lastInsertRowid);
    // منثبّت نص البنود لحظة الفتح — لو انتعدّل نص البند بعدين
    // بيضل التنفيذ شاهد على اللي انقرأ فعلياً يومها.
    const items = db.prepare("SELECT * FROM ops_checklist_items WHERE checklist_id=? AND active=1 ORDER BY sort, id").all(list.id);
    const ins = db.prepare("INSERT INTO ops_run_items (run_id,item_id,text,critical,done) VALUES (?,?,?,?,0)");
    for (const it of items) ins.run(rid, it.id, it.text, it.critical);
    return rid;
  })();
}

export function runView(id) {
  const run = db.prepare(`SELECT r.*, c.name, c.kind FROM ops_runs r
                          JOIN ops_checklists c ON c.id=r.checklist_id WHERE r.id=?`).get(Number(id));
  if (!run) return null;
  const rows = db.prepare("SELECT * FROM ops_run_items WHERE run_id=? ORDER BY id").all(run.id);
  const done = rows.filter((r) => r.done);
  const missed = rows.filter((r) => !r.done);
  return {
    run, rows,
    summary: {
      items: rows.length, done: done.length, missed: missed.length,
      critical_missed: missed.filter((r) => r.critical).length,
      // 🔴 قائمة بلا بنود ما إلها نسبة — «—» أصدق من 0% أو 100%
      percent: pct(done.length, rows.length),
      missed_list: missed.map((r) => r.text)
    }
  };
}

router.get("/runs", guard((req, res) => {
  const w = [], p = [];
  if (isDay(req.query.from)) { w.push("r.day >= ?"); p.push(req.query.from); }
  if (isDay(req.query.to)) { w.push("r.day <= ?"); p.push(req.query.to); }
  if (req.query.checklist_id) { w.push("r.checklist_id = ?"); p.push(Number(req.query.checklist_id)); }
  const rows = db.prepare(`SELECT r.*, c.name, c.kind,
      (SELECT COUNT(*) FROM ops_run_items i WHERE i.run_id=r.id) items,
      (SELECT COUNT(*) FROM ops_run_items i WHERE i.run_id=r.id AND i.done=1) done
      FROM ops_runs r JOIN ops_checklists c ON c.id=r.checklist_id
      ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY r.day DESC, r.id DESC LIMIT 400`).all(...p)
    .map((r) => ({ ...r, percent: pct(r.done, r.items) }));
  ok(res, { rows });
}));

router.post("/runs", guard((req, res) => {
  const day = txt(req.body?.day, 10) || today();
  const id = openRun(req.body?.checklist_id, day, req.body?.person);
  ok(res, { id });
}));

router.get("/runs/:id", guard((req, res) => {
  const v = runView(req.params.id);
  if (!v) return bad(res, "التنفيذ غير موجود", 404);
  ok(res, v);
}));

router.post("/runs/:id/item", guard((req, res) => {
  const rid = Number(req.params.id);
  const run = db.prepare("SELECT * FROM ops_runs WHERE id=?").get(rid);
  if (!run) return bad(res, "التنفيذ غير موجود", 404);
  if (run.status !== "مفتوح") return bad(res, "التنفيذ مقفل — ما بينعدّل");
  const line = db.prepare("SELECT * FROM ops_run_items WHERE run_id=? AND item_id=?")
    .get(rid, Number(req.body?.item_id));
  if (!line) return bad(res, "البند مش ضمن هذا التنفيذ", 404);
  const done = req.body?.done ? 1 : 0;
  // مين عمل البند ومتى — بلا اسم ما في مسؤولية، فمنطلبه لمّا ينعلّم منجز
  const person = txt(req.body?.person ?? run.person, 60);
  if (done && !person) return bad(res, "اكتب اسم اللي نفّذ البند");
  db.prepare("UPDATE ops_run_items SET done=?, person=?, at=?, note=? WHERE id=?")
    .run(done, done ? person : "", done ? Date.now() : null, txt(req.body?.note, 200), line.id);
  ok(res, runView(rid));
}));

router.post("/runs/:id/close", guard((req, res) => {
  const v = runView(req.params.id);
  if (!v) return bad(res, "التنفيذ غير موجود", 404);
  if (v.run.status !== "مفتوح") return bad(res, "التنفيذ مقفل أصلاً");
  const s = v.summary;
  if (s.critical_missed && !req.body?.force)
    return bad(res, `في ${s.critical_missed} بند حرج ما انعمل. نفّذهم أو أقفل بالقوة مع تسجيل السبب.`);
  db.prepare("UPDATE ops_runs SET status=?, closed_at=? WHERE id=?")
    .run(s.missed ? "مقفل ناقص" : "مكتمل", Date.now(), v.run.id);
  // الإقفال وفي بنود حرجة ناقصة = حادثة موثّقة، مش شي بيمرّ بصمت
  if (s.critical_missed)
    logIncident({
      title: `إقفال ${v.run.name} ليوم ${v.run.day} وفيه ${s.critical_missed} بند حرج ناقص`,
      cause: txt(req.body?.reason, 300), severity: "عالية", source: "قائمة فحص",
      person: txt(req.body?.person ?? v.run.person, 60), day: v.run.day,
      ref_type: "run", ref_id: String(v.run.id)
    });
  ok(res, runView(v.run.id));
}));

// ══════════ (3) أجهزة التبريد وسجل الحرارة ══════════
router.get("/units", guard((req, res) => {
  const day = isDay(req.query.day) ? req.query.day : today();
  const units = db.prepare("SELECT * FROM ops_units ORDER BY active DESC, id").all();
  const rows = units.map((u) => {
    const last = db.prepare(`SELECT * FROM ops_temps WHERE unit_id=? AND voided=0
                             ORDER BY at DESC, id DESC LIMIT 1`).get(u.id) || null;
    const dayRows = db.prepare("SELECT * FROM ops_temps WHERE unit_id=? AND day=? AND voided=0").all(u.id, day);
    return {
      ...u,
      last_reading: last ? { celsius: last.celsius, at: last.at, status: last.status, person: last.person } : null,
      today_count: dayRows.length,
      today_out: dayRows.filter((r) => r.status !== "ضمن المدى").length,
      // 🔴 صفر قراءات = «ما في قراءة». ما منقول عنه سليم.
      today_state: dayRows.length === 0 ? "ما في قراءة"
        : dayRows.some((r) => r.status !== "ضمن المدى") ? "خارج المدى" : "ضمن المدى"
    };
  });
  ok(res, {
    rows,
    totals: {
      units: rows.filter((r) => r.active).length,
      no_reading: rows.filter((r) => r.active && r.today_state === "ما في قراءة").length,
      out: rows.filter((r) => r.active && r.today_state === "خارج المدى").length
    }
  });
}));

router.post("/units", guard((req, res) => {
  const b = req.body || {};
  const name = txt(b.name, 120);
  if (!name) return bad(res, "اسم الجهاز مطلوب");
  const kind = txt(b.kind, 40) || "براد";
  if (!UNIT_KINDS.includes(kind)) return bad(res, "نوع الجهاز لازم يكون: " + UNIT_KINDS.join(" / "));
  const min = Number(b.min_c), max = Number(b.max_c);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return bad(res, "أدخل أدنى وأعلى درجة مسموحة");
  if (min >= max) return bad(res, "أدنى درجة لازم أصغر من أعلى درجة");
  const bounds = txt(b.bounds, 20) || "شامل";
  if (!BOUNDS.includes(bounds)) return bad(res, "نوع الحدود لازم: " + BOUNDS.join(" / "));
  db.prepare(`INSERT INTO ops_units (name,kind,min_c,max_c,bounds,active,created_at) VALUES (?,?,?,?,?,1,?)
              ON CONFLICT(name) DO UPDATE SET kind=excluded.kind, min_c=excluded.min_c,
                max_c=excluded.max_c, bounds=excluded.bounds`)
    .run(name, kind, r1(min), r1(max), bounds, Date.now());
  ok(res, { id: Number(db.prepare("SELECT id FROM ops_units WHERE name=?").get(name).id) });
}));

router.post("/units/:id/toggle", guard((req, res) => {
  db.prepare("UPDATE ops_units SET active = 1 - active WHERE id=?").run(Number(req.params.id));
  ok(res, {});
}));

/**
 * (3)+(4) يسجّل قراءة، وإذا طلعت برّا المدى بيفتح حادثة على طول.
 * المدى بينتخزّن جوّا السطر نفسه — لأنّ لو تغيّر مدى الجهاز بكرا
 * ما بدنا القراءات القديمة تتحوّل لسليمة أو مخالفة بأثر رجعي.
 */
export function logTemp({ unit_id, celsius, person = "", note = "", at = Date.now(), corrects_id = null, reason = "" }) {
  const unit = db.prepare("SELECT * FROM ops_units WHERE id=?").get(Number(unit_id));
  if (!unit) throw new Error("الجهاز غير موجود");
  const who = txt(person, 60);
  if (!who) throw new Error("اكتب اسم اللي أخذ القراءة");
  const ev = evaluateTemp(celsius, unit);
  const ts = Number(at) || Date.now();
  const day = dayStr(ts);
  const c = r1(celsius);

  const id = db.transaction(() => {
    const r = db.prepare(`INSERT INTO ops_temps
        (unit_id,day,at,celsius,min_c,max_c,bounds,status,person,note,corrects_id,reason,voided,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?)`)
      .run(unit.id, day, ts, c, unit.min_c, unit.max_c, unit.bounds, ev.status, who,
           txt(note, 300), corrects_id, txt(reason, 300), Date.now());
    return Number(r.lastInsertRowid);
  })();

  let incident_id = null;
  if (ev.out)
    incident_id = logIncident({
      title: `${unit.name}: قراءة ${c}° ${ev.status} (المسموح ${unit.min_c}° إلى ${unit.max_c}°)`,
      cause: "", action: "", severity: "عالية", source: "حرارة", person: who, day,
      ref_type: "temp", ref_id: String(id)
    });
  return { id, status: ev.status, out: ev.out, deviation: ev.deviation, incident_id };
}

router.post("/temps", guard((req, res) => {
  const b = req.body || {};
  const at = isDay(b.day) ? dayStart(b.day) + (12 * 3600 * 1000) : Date.now();  // يوم بلا ساعة = ظهر ذاك اليوم
  ok(res, logTemp({ unit_id: b.unit_id, celsius: b.celsius, person: b.person, note: b.note, at }));
}));

/**
 * تصحيح قراءة: السطر القديم بينتعلّم عليه «مصحّح» وبيضل موجود،
 * والقراءة الجديدة بتنكتب بسببها. ما في مسح ولا كتابة فوق —
 * هاد سجل رقابي والرقابة بدها تشوف الأصل والتصحيح مع بعض.
 */
router.post("/temps/:id/correct", guard((req, res) => {
  const id = Number(req.params.id);
  const old = db.prepare("SELECT * FROM ops_temps WHERE id=?").get(id);
  if (!old) return bad(res, "القراءة غير موجودة", 404);
  if (old.voided) return bad(res, "القراءة مصحّحة من قبل — صحّح القراءة الأحدث");
  const reason = txt(req.body?.reason, 300);
  if (!reason) return bad(res, "اكتب سبب التصحيح — السجل الرقابي ما بينعدّل بلا سبب");
  const out = logTemp({
    unit_id: old.unit_id, celsius: req.body?.celsius, person: req.body?.person || old.person,
    note: old.note, at: old.at, corrects_id: id, reason
  });
  db.prepare("UPDATE ops_temps SET voided=1 WHERE id=?").run(id);
  ok(res, out);
}));

router.get("/temps", guard((req, res) => {
  const w = [], p = [];
  if (req.query.unit_id) { w.push("t.unit_id = ?"); p.push(Number(req.query.unit_id)); }
  if (isDay(req.query.from)) { w.push("t.day >= ?"); p.push(req.query.from); }
  if (isDay(req.query.to)) { w.push("t.day <= ?"); p.push(req.query.to); }
  if (req.query.out === "1") w.push("t.status <> 'ضمن المدى'");
  const rows = db.prepare(`SELECT t.*, u.name FROM ops_temps t JOIN ops_units u ON u.id=t.unit_id
      ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY t.at DESC, t.id DESC LIMIT 1000`).all(...p);
  ok(res, { rows });
}));

/**
 * (4) تغطية الحرارة خلال فترة — الأهم فيها الأيام اللي بلا قراءة.
 * هاي الأيام مش «سليمة» ومش «مخالفة»؛ هي فجوة بالسجل ولازم تبين.
 */
export function tempCoverage({ from, to, unit_id = null }) {
  const days = dayRange(from, to);
  if (!days.length) return null;
  const units = db.prepare("SELECT * FROM ops_units WHERE active=1" + (unit_id ? " AND id=?" : ""))
    .all(...(unit_id ? [Number(unit_id)] : []));
  const rows = units.map((u) => {
    const logs = db.prepare("SELECT day, status FROM ops_temps WHERE unit_id=? AND day>=? AND day<=? AND voided=0")
      .all(u.id, from, to);
    const byDay = new Map();
    for (const l of logs) byDay.set(l.day, (byDay.get(l.day) || 0) + (l.status === "ضمن المدى" ? 0 : 1));
    const missing = days.filter((d) => !byDay.has(d));
    const outDays = [...byDay.entries()].filter(([, n]) => n > 0).map(([d]) => d);
    return {
      unit_id: u.id, name: u.name, days: days.length,
      logged_days: byDay.size, missing_days: missing.length, missing_list: missing.slice(0, 60),
      out_days: outDays.length, readings: logs.length,
      out_readings: logs.filter((l) => l.status !== "ضمن المدى").length,
      // نسبة التغطية = أيام فيها قراءة ÷ أيام الفترة. بلا فترة → null
      coverage: pct(byDay.size, days.length),
      // نسبة الأيام السليمة تنحسب على الأيام المسجّلة بس — ما منعتبر
      // اليوم اللي ما انقاس فيه شي يوم ناجح.
      in_range: pct(byDay.size - outDays.length, byDay.size)
    };
  });
  return rows;
}

router.get("/temps/coverage", guard((req, res) => {
  const from = isDay(req.query.from) ? req.query.from : dayStr(Date.now() - 29 * DAY);
  const to = isDay(req.query.to) ? req.query.to : today();
  const rows = tempCoverage({ from, to, unit_id: req.query.unit_id || null });
  if (!rows) return bad(res, "الفترة غير صالحة");
  ok(res, { from, to, rows });
}));

// ══════════ (6) الحوادث والملاحظات التشغيلية ══════════
export function logIncident({ title, cause = "", action = "", severity = "متوسطة", source = "يدوي",
                              person = "", day = null, ref_type = "", ref_id = "" }) {
  const t = txt(title, 200);
  if (!t) throw new Error("عنوان الحادثة مطلوب");
  if (!SEVERITIES.includes(severity)) throw new Error("الخطورة لازم: " + SEVERITIES.join(" / "));
  const now = Date.now();
  const d = isDay(day) ? day : dayStr(now);
  const r = db.prepare(`INSERT INTO ops_incidents
      (day,at,source,severity,title,cause,action,person,status,ref_type,ref_id)
      VALUES (?,?,?,?,?,?,?,?,'مفتوحة',?,?)`)
    .run(d, now, txt(source, 40), severity, t, txt(cause, 500), txt(action, 500),
         txt(person, 60), txt(ref_type, 20), txt(ref_id, 40));
  return Number(r.lastInsertRowid);
}

router.get("/incidents", guard((req, res) => {
  const w = [], p = [];
  if (isDay(req.query.from)) { w.push("day >= ?"); p.push(req.query.from); }
  if (isDay(req.query.to)) { w.push("day <= ?"); p.push(req.query.to); }
  if (req.query.status) { w.push("status = ?"); p.push(String(req.query.status)); }
  const rows = db.prepare("SELECT * FROM ops_incidents" + (w.length ? " WHERE " + w.join(" AND ") : "") +
    " ORDER BY at DESC, id DESC LIMIT 500").all(...p);
  ok(res, {
    rows,
    totals: {
      all: rows.length,
      open: rows.filter((r) => r.status === "مفتوحة").length,
      high: rows.filter((r) => r.severity === "عالية").length,
      // الحادثة المقفلة بلا إجراء تصحيحي مكتوب = ثغرة بالملف الرقابي
      closed_without_action: rows.filter((r) => r.status === "مغلقة" && !r.action).length
    }
  });
}));

router.post("/incidents", guard((req, res) => {
  const b = req.body || {};
  const id = logIncident({
    title: b.title, cause: b.cause, action: b.action, person: b.person,
    severity: txt(b.severity, 20) || "متوسطة", source: "يدوي", day: b.day
  });
  ok(res, { id });
}));

router.post("/incidents/:id/close", guard((req, res) => {
  const id = Number(req.params.id);
  const inc = db.prepare("SELECT * FROM ops_incidents WHERE id=?").get(id);
  if (!inc) return bad(res, "الحادثة غير موجودة", 404);
  const cause = txt(req.body?.cause ?? inc.cause, 500);
  const action = txt(req.body?.action ?? inc.action, 500);
  // ما منسكّر حادثة بلا سبب وإجراء — هاي بالضبط اللي الرقابة
  // بتسأل عنها: شو صار وليش وشو عملتوا.
  if (!cause) return bad(res, "اكتب سبب الحادثة قبل الإغلاق");
  if (!action) return bad(res, "اكتب الإجراء التصحيحي قبل الإغلاق");
  db.prepare("UPDATE ops_incidents SET cause=?, action=?, status='مغلقة', closed_at=? WHERE id=?")
    .run(cause, action, Date.now(), id);
  ok(res, {});
}));

// ══════════ (5) النظافة والتعقيم + (8) المهام المتكررة ══════════
// الاثنين نفس المنطق: بند إلو جدولة وسجل تنفيذ. منمرّرهم على
// نفس الدوال بدل ما نكتب المنطق مرتين ويختلفوا مع الوقت.
const SCHED = {
  clean: { tasks: "ops_clean_tasks", logs: "ops_clean_logs", fk: "task_id", label: "بند النظافة" },
  routine: { tasks: "ops_routines", logs: "ops_routine_logs", fk: "routine_id", label: "المهمة" }
};

export function schedRows(kind, day = today()) {
  const t = SCHED[kind];
  const rows = db.prepare(`SELECT * FROM ${t.tasks} ORDER BY active DESC, id`).all();
  return rows.map((x) => {
    const last = db.prepare(`SELECT day, person FROM ${t.logs} WHERE ${t.fk}=? AND day<=? ORDER BY day DESC LIMIT 1`)
      .get(x.id, day) || null;
    const d = scheduleDue(x.freq, last?.day || null, day);
    return {
      ...x, last_day: last?.day || null, last_person: last?.person || "",
      due: d.due, days_since: d.days_since, overdue: d.overdue,
      done_today: !!db.prepare(`SELECT 1 FROM ${t.logs} WHERE ${t.fk}=? AND day=?`).get(x.id, day)
    };
  });
}

function schedRoutes(kind, base) {
  const t = SCHED[kind];

  router.get(base, guard((req, res) => {
    const day = isDay(req.query.day) ? req.query.day : today();
    const rows = schedRows(kind, day);
    const act = rows.filter((r) => r.active);
    ok(res, {
      day, rows,
      totals: {
        tasks: act.length,
        due: act.filter((r) => r.due && !r.done_today).length,
        done_today: act.filter((r) => r.done_today).length,
        overdue: act.filter((r) => (r.overdue || 0) > 0).length,
        // البند اللي عمره ما انعمل — تأخيره مجهول، فمنعدّه لحاله
        never: act.filter((r) => r.last_day == null).length
      }
    });
  }));

  router.post(base, guard((req, res) => {
    const b = req.body || {};
    const name = txt(b.name, 120);
    if (!name) return bad(res, `اسم ${t.label} مطلوب`);
    const freq = txt(b.freq, 20) || "يومي";
    if (!FREQS.includes(freq)) return bad(res, "الجدولة لازم: " + FREQS.join(" / "));
    const extra = kind === "clean" ? txt(b.area, 120) : txt(b.owner, 60);
    const col = kind === "clean" ? "area" : "owner";
    db.prepare(`INSERT INTO ${t.tasks} (name,${col},freq,active,created_at) VALUES (?,?,?,1,?)
                ON CONFLICT(name) DO UPDATE SET ${col}=excluded.${col}, freq=excluded.freq`)
      .run(name, extra, freq, Date.now());
    ok(res, { id: Number(db.prepare(`SELECT id FROM ${t.tasks} WHERE name=?`).get(name).id) });
  }));

  router.post(base + "/:id/toggle", guard((req, res) => {
    db.prepare(`UPDATE ${t.tasks} SET active = 1 - active WHERE id=?`).run(Number(req.params.id));
    ok(res, {});
  }));

  router.post(base + "/:id/log", guard((req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare(`SELECT id FROM ${t.tasks} WHERE id=?`).get(id)) return bad(res, `${t.label} غير موجود`, 404);
    const day = txt(req.body?.day, 10) || today();
    if (!isDay(day)) return bad(res, "التاريخ لازم بصيغة YYYY-MM-DD");
    const person = txt(req.body?.person, 60);
    if (!person) return bad(res, "اكتب اسم اللي نفّذ");
    // نفس البند بنفس اليوم بينتحدّث مش بينتكرّر — حتى العدّ يضل صادق
    db.prepare(`INSERT INTO ${t.logs} (${t.fk},day,person,note,at) VALUES (?,?,?,?,?)
                ON CONFLICT(${t.fk},day) DO UPDATE SET person=excluded.person, note=excluded.note, at=excluded.at`)
      .run(id, day, person, txt(req.body?.note, 300), Date.now());
    ok(res, {});
  }));

  router.get(base + "/logs", guard((req, res) => {
    const w = [], p = [];
    if (isDay(req.query.from)) { w.push("l.day >= ?"); p.push(req.query.from); }
    if (isDay(req.query.to)) { w.push("l.day <= ?"); p.push(req.query.to); }
    const rows = db.prepare(`SELECT l.*, x.name, x.freq FROM ${t.logs} l JOIN ${t.tasks} x ON x.id=l.${t.fk}
        ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY l.day DESC, l.id DESC LIMIT 500`).all(...p);
    ok(res, { rows });
  }));
}
schedRoutes("clean", "/cleaning");
schedRoutes("routine", "/routines");

// ══════════ (7) الورديات ══════════
router.get("/shifts", guard((req, res) => {
  const from = isDay(req.query.from) ? req.query.from : today();
  const to = isDay(req.query.to) ? req.query.to : from;
  const rows = db.prepare("SELECT * FROM ops_shifts WHERE day>=? AND day<=? ORDER BY day, period, id").all(from, to);
  const days = dayRange(from, to).map((d) => ({
    day: d,
    periods: PERIODS.map((p) => ({ period: p, people: rows.filter((r) => r.day === d && r.period === p) }))
  }));
  ok(res, {
    from, to, rows, days,
    // اليوم اللي ما إلو ولا وردية = فراغ بالجدول، منسمّيه بصراحة
    uncovered: days.filter((d) => !d.periods.some((p) => p.people.length)).map((d) => d.day)
  });
}));

router.post("/shifts", guard((req, res) => {
  const b = req.body || {};
  const day = txt(b.day, 10) || today();
  if (!isDay(day)) return bad(res, "التاريخ لازم بصيغة YYYY-MM-DD");
  const period = txt(b.period, 20);
  if (!PERIODS.includes(period)) return bad(res, "الفترة لازم: " + PERIODS.join(" / "));
  const person = txt(b.person, 60);
  if (!person) return bad(res, "اسم الموظف مطلوب");
  db.prepare(`INSERT INTO ops_shifts (day,period,person,role,note) VALUES (?,?,?,?,?)
              ON CONFLICT(day,period,person) DO UPDATE SET role=excluded.role, note=excluded.note`)
    .run(day, period, person, txt(b.role, 60), txt(b.note, 200));
  ok(res, {});
}));

router.delete("/shifts/:id", guard((req, res) => {
  db.prepare("DELETE FROM ops_shifts WHERE id=?").run(Number(req.params.id));
  ok(res, {});
}));

// ══════════ (9) لوحة الالتزام ══════════
/**
 * كل نسبة هون مبنية على مقام حقيقي:
 *  • القوائم: بنود انعملت ÷ بنود انفتحت فعلياً بالتنفيذات.
 *  • النظافة: مرات انعملت ÷ مرات المفروض تنعمل حسب الجدولة.
 *  • الحرارة: أيام فيها قراءة ÷ أيام الفترة.
 * وإذا المقام صفر بترجع null — يعني «ما في بيانات»، مش صفر بالمية.
 */
export function compliance({ from, to }) {
  const days = dayRange(from, to);
  if (!days.length) throw new Error("الفترة غير صالحة");

  const runItems = db.prepare(`SELECT i.done, i.text, i.critical, r.day, c.name list
      FROM ops_run_items i JOIN ops_runs r ON r.id=i.run_id
      JOIN ops_checklists c ON c.id=r.checklist_id
      WHERE r.day>=? AND r.day<=?`).all(from, to);
  const runsCount = Number(db.prepare("SELECT COUNT(*) c FROM ops_runs WHERE day>=? AND day<=?")
    .get(from, to)?.c) || 0;

  // أكثر بند بينتنسى — من التنفيذات الحقيقية بس
  const miss = new Map();
  for (const r of runItems) {
    const k = r.list + " — " + r.text;
    const g = miss.get(k) || { item: r.text, list: r.list, opened: 0, missed: 0, critical: r.critical };
    g.opened++; if (!r.done) g.missed++;
    miss.set(k, g);
  }
  const forgotten = [...miss.values()]
    .map((g) => ({ ...g, miss_rate: pct(g.missed, g.opened) }))
    .filter((g) => g.missed > 0)
    .sort((a, b) => b.missed - a.missed || b.miss_rate - a.miss_rate)
    .slice(0, 15);

  const cleanTasks = db.prepare("SELECT * FROM ops_clean_tasks WHERE active=1").all();
  const cleaning = cleanTasks.map((t) => {
    const done = Number(db.prepare("SELECT COUNT(*) c FROM ops_clean_logs WHERE task_id=? AND day>=? AND day<=?")
      .get(t.id, from, to)?.c) || 0;
    const expected = expectedRuns(t.freq, from, to);
    return { id: t.id, name: t.name, area: t.area, freq: t.freq, done, expected,
             percent: expected ? pct(Math.min(done, expected), expected) : null };
  });
  const cleanDone = cleaning.reduce((a, x) => a + Math.min(x.done, x.expected || 0), 0);
  const cleanExp = cleaning.reduce((a, x) => a + (x.expected || 0), 0);

  const temps = tempCoverage({ from, to }) || [];
  const tempDays = temps.reduce((a, x) => a + x.days, 0);
  const tempLogged = temps.reduce((a, x) => a + x.logged_days, 0);

  const inc = db.prepare("SELECT severity,status,action FROM ops_incidents WHERE day>=? AND day<=?").all(from, to);

  const parts = {
    checklists: pct(runItems.filter((r) => r.done).length, runItems.length),
    cleaning: pct(cleanDone, cleanExp),
    temperature: pct(tempLogged, tempDays)
  };
  const scored = Object.values(parts).filter((v) => v != null);

  return {
    from, to, days: days.length,
    checklists: {
      runs: runsCount, items: runItems.length,
      done: runItems.filter((r) => r.done).length,
      missed: runItems.filter((r) => !r.done).length,
      critical_missed: runItems.filter((r) => !r.done && r.critical).length,
      percent: parts.checklists
    },
    cleaning: { rows: cleaning, done: cleanDone, expected: cleanExp, percent: parts.cleaning },
    temperature: {
      rows: temps, days: tempDays, logged_days: tempLogged,
      missing_days: tempDays - tempLogged,
      out_readings: temps.reduce((a, x) => a + x.out_readings, 0),
      percent: parts.temperature
    },
    incidents: {
      all: inc.length, open: inc.filter((i) => i.status === "مفتوحة").length,
      high: inc.filter((i) => i.severity === "عالية").length,
      closed_without_action: inc.filter((i) => i.status === "مغلقة" && !i.action).length
    },
    forgotten,
    // المعدّل العام = متوسط المحاور اللي إلها بيانات فقط.
    // ولا محور فيه بيانات → null، و«—» بالواجهة.
    overall: scored.length ? r1(scored.reduce((a, v) => a + v, 0) / scored.length) : null,
    parts
  };
}

router.get("/compliance", guard((req, res) => {
  const from = isDay(req.query.from) ? req.query.from : dayStr(Date.now() - 29 * DAY);
  const to = isDay(req.query.to) ? req.query.to : today();
  ok(res, compliance({ from, to }));
}));

// اليوم بلمحة — أول شاشة بيفتحها الموظف الصبح
router.get("/today", guard((req, res) => {
  const day = isDay(req.query.day) ? req.query.day : today();
  const lists = db.prepare("SELECT * FROM ops_checklists WHERE active=1 ORDER BY id").all().map((l) => {
    const run = db.prepare("SELECT id FROM ops_runs WHERE checklist_id=? AND day=?").get(l.id, day);
    const v = run ? runView(run.id) : null;
    return { id: l.id, name: l.name, kind: l.kind, run_id: run?.id || null,
             percent: v ? v.summary.percent : null, missed: v ? v.summary.missed : null };
  });
  const units = db.prepare("SELECT * FROM ops_units WHERE active=1").all().map((u) => {
    const n = Number(db.prepare("SELECT COUNT(*) c FROM ops_temps WHERE unit_id=? AND day=? AND voided=0")
      .get(u.id, day)?.c) || 0;
    return { id: u.id, name: u.name, min_c: u.min_c, max_c: u.max_c, bounds: u.bounds,
             readings: n, state: n ? "مسجّل" : "ما في قراءة" };
  });
  ok(res, {
    day, lists, units,
    cleaning_due: schedRows("clean", day).filter((r) => r.active && r.due && !r.done_today),
    routines_due: schedRows("routine", day).filter((r) => r.active && r.due && !r.done_today),
    shifts: db.prepare("SELECT * FROM ops_shifts WHERE day=? ORDER BY period").all(day),
    open_incidents: db.prepare("SELECT * FROM ops_incidents WHERE status='مفتوحة' ORDER BY at DESC LIMIT 20").all()
  });
}));

// ══════════ (10) التصدير والتقرير الشهري ══════════
const csv = (res, name, head, lines) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  res.send("\uFEFF" + [head.map(esc).join(","), ...lines.map((l) => l.map(esc).join(","))].join("\r\n"));
};
const clock = (ts) => (ts ? new Date(Number(ts) + TZ_MS).toISOString().slice(11, 16) : "");

router.get("/temps.csv", guard((req, res) => {
  const rows = db.prepare(`SELECT t.*, u.name FROM ops_temps t JOIN ops_units u ON u.id=t.unit_id
                           ORDER BY t.at DESC LIMIT 5000`).all();
  csv(res, "ops-temps.csv",
    ["التاريخ", "الساعة", "الجهاز", "القراءة", "الحد الأدنى", "الحد الأعلى", "نوع الحدود",
     "النتيجة", "المسؤول", "ملاحظة", "تصحيح لقراءة", "سبب التصحيح", "مصحّحة لاحقاً"],
    rows.map((r) => [r.day, clock(r.at), r.name, r.celsius, r.min_c, r.max_c, r.bounds,
      r.status, r.person, r.note, r.corrects_id || "", r.reason, r.voided ? "نعم" : "لا"]));
}));

router.get("/checklists.csv", guard((req, res) => {
  const rows = db.prepare(`SELECT r.day, c.name list, i.text, i.critical, i.done, i.person, i.at, i.note
      FROM ops_run_items i JOIN ops_runs r ON r.id=i.run_id JOIN ops_checklists c ON c.id=r.checklist_id
      ORDER BY r.day DESC, i.id LIMIT 5000`).all();
  csv(res, "ops-checklists.csv",
    ["التاريخ", "القائمة", "البند", "حرج", "الحالة", "المنفّذ", "الساعة", "ملاحظة"],
    rows.map((r) => [r.day, r.list, r.text, r.critical ? "نعم" : "لا",
      r.done ? "منجز" : "انترك", r.person, clock(r.at), r.note]));
}));

router.get("/cleaning.csv", guard((req, res) => {
  const rows = db.prepare(`SELECT l.day, t.name, t.area, t.freq, l.person, l.note
      FROM ops_clean_logs l JOIN ops_clean_tasks t ON t.id=l.task_id
      ORDER BY l.day DESC LIMIT 5000`).all();
  csv(res, "ops-cleaning.csv", ["التاريخ", "البند", "المكان", "الجدولة", "المنفّذ", "ملاحظة"],
    rows.map((r) => [r.day, r.name, r.area, r.freq, r.person, r.note]));
}));

router.get("/incidents.csv", guard((req, res) => {
  const rows = db.prepare("SELECT * FROM ops_incidents ORDER BY at DESC LIMIT 5000").all();
  csv(res, "ops-incidents.csv",
    ["التاريخ", "المصدر", "الخطورة", "الحادثة", "السبب", "الإجراء التصحيحي", "المسؤول", "الحالة"],
    rows.map((r) => [r.day, r.source, r.severity, r.title, r.cause, r.action, r.person, r.status]));
}));

/** حدود شهر YYYY-MM — بلا اختراع: الشهر الغلط بينرفض */
export function monthRange(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || "").trim());
  if (!m) throw new Error("الشهر لازم بصيغة YYYY-MM");
  const y = +m[1], mo = +m[2];
  if (mo < 1 || mo > 12) throw new Error("رقم الشهر غير صحيح");
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const p = (n) => String(n).padStart(2, "0");
  return { from: `${y}-${p(mo)}-01`, to: `${y}-${p(mo)}-${p(last)}` };
}

router.get("/report/monthly", guard((req, res) => {
  const { from, to } = monthRange(req.query.month || today().slice(0, 7));
  ok(res, { month: from.slice(0, 7), ...compliance({ from, to }) });
}));

// تقرير التزام شهري بصيغة CSV — يطبع ويتحط بملف الرقابة
router.get("/report/monthly.csv", guard((req, res) => {
  const { from, to } = monthRange(req.query.month || today().slice(0, 7));
  const c = compliance({ from, to });
  const n = (v) => (v == null ? "—" : v);   // 🔴 «—» يعني ما في بيانات، مش صفر
  const lines = [
    ["الفترة", `${from} إلى ${to}`, ""],
    ["أيام الفترة", c.days, ""],
    ["التزام قوائم الفحص %", n(c.checklists.percent), `${c.checklists.done}/${c.checklists.items} بند`],
    ["بنود حرجة انتركت", c.checklists.critical_missed, ""],
    ["التزام النظافة %", n(c.cleaning.percent), `${c.cleaning.done}/${c.cleaning.expected} مرة`],
    ["تغطية سجل الحرارة %", n(c.temperature.percent), `${c.temperature.logged_days}/${c.temperature.days} يوم`],
    ["أيام بلا قراءة حرارة", c.temperature.missing_days, ""],
    ["قراءات خارج المدى", c.temperature.out_readings, ""],
    ["حوادث مسجّلة", c.incidents.all, `مفتوحة: ${c.incidents.open}`],
    ["حوادث مغلقة بلا إجراء تصحيحي", c.incidents.closed_without_action, ""],
    ["المعدّل العام %", n(c.overall), ""],
    ["", "", ""],
    ["أكثر البنود اللي بتنتنسى", "مرات انتركت", "نسبة النسيان %"],
    ...c.forgotten.map((f) => [`${f.list} — ${f.item}`, f.missed, n(f.miss_rate)])
  ];
  csv(res, `ops-report-${from.slice(0, 7)}.csv`, ["البند", "القيمة", "تفصيل"], lines);
}));
