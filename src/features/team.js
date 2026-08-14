// ═══════════════════════════════════════════════════════════
// 🤝 وحدة الفريق والإنتاجية (team)
// 10 ميزات: مهام كانبان، ملاحظات الشفت، تشيك ليست يومية،
// نشاط الموظفين، تذكيرات، ملاحظات لاصقة، دليل SOP،
// سجل أحداث بفلتر، إنجازات الأسبوع، اجتماع يومي جاهز
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import { db, retryDb } from "../db/database.js";
import { CONFIG } from "../config.js";

export const slug = "team";
export const title = "الفريق والإنتاجية";
export const icon = "🤝";

// ── جداول الوحدة الخاصة ──
try {
  db.exec(`CREATE TABLE IF NOT EXISTS team_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    assignee TEXT DEFAULT '',
    status TEXT DEFAULT 'جديدة',
    priority TEXT DEFAULT 'عادية',
    due_day TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  )`);
} catch (e) { console.error(e.message); }

try {
  db.exec(`CREATE TABLE IF NOT EXISTS team_shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author TEXT DEFAULT '',
    note TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
} catch (e) { console.error(e.message); }

try {
  db.exec(`CREATE TABLE IF NOT EXISTS team_checklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item TEXT NOT NULL,
    day TEXT DEFAULT '',
    done INTEGER DEFAULT 0
  )`);
} catch (e) { console.error(e.message); }

try {
  db.exec(`CREATE TABLE IF NOT EXISTS team_reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    remind_day TEXT NOT NULL,
    done INTEGER DEFAULT 0
  )`);
} catch (e) { console.error(e.message); }

try {
  db.exec(`CREATE TABLE IF NOT EXISTS team_stickies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    color TEXT DEFAULT 'yellow',
    created_at INTEGER NOT NULL
  )`);
} catch (e) { console.error(e.message); }

try {
  db.exec(`CREATE TABLE IF NOT EXISTS team_sop (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    updated_at INTEGER NOT NULL
  )`);
} catch (e) { console.error(e.message); }

const TASK_STATUSES = ["جديدة", "جارية", "منجزة"];
const PRIORITIES = ["عالية", "عادية", "منخفضة"];
const STICKY_COLORS = ["yellow", "green", "pink", "blue", "orange"];

// اليوم المحلي بصيغة YYYY-MM-DD
function todayStr() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function isDay(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")); }

// بداية يوم معيّن (millis) بالتوقيت المحلي
function dayStart(dayStr) {
  const t = new Date(dayStr + "T00:00:00").getTime();
  return Number.isFinite(t) ? t : null;
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

// ═══ 1) قائمة المهام (كانبان: جديدة/جارية/منجزة) — CRUD كامل ═══
router.get("/tasks", (req, res) => {
  try {
    const rows = retryDb(() => db.prepare(
      `SELECT id, title, assignee, status, priority, due_day, created_at
       FROM team_tasks ORDER BY created_at DESC LIMIT 500`
    ).all());
    res.json({ tasks: rows, statuses: TASK_STATUSES });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل جلب المهام" });
  }
});

router.post("/tasks", (req, res) => {
  try {
    const b = req.body || {};
    const taskTitle = String(b.title || "").trim().slice(0, 200);
    if (!taskTitle) return res.status(400).json({ error: "اكتب عنوان المهمة" });
    const assignee = String(b.assignee || "").trim().slice(0, 60);
    const status = TASK_STATUSES.includes(b.status) ? b.status : "جديدة";
    const priority = PRIORITIES.includes(b.priority) ? b.priority : "عادية";
    const dueDay = isDay(b.due_day) ? b.due_day : "";
    const info = retryDb(() => db.prepare(
      "INSERT INTO team_tasks (title, assignee, status, priority, due_day, created_at) VALUES (?,?,?,?,?,?)"
    ).run(taskTitle, assignee, status, priority, dueDay, Date.now()));
    res.json({ ok: true, id: Number(info.lastInsertRowid) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل إضافة المهمة" });
  }
});

router.put("/tasks/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "رقم مهمة غير صالح" });
    const cur = retryDb(() => db.prepare("SELECT * FROM team_tasks WHERE id=?").get(id));
    if (!cur) return res.status(400).json({ error: "المهمة غير موجودة" });
    const b = req.body || {};
    const taskTitle = b.title != null ? String(b.title).trim().slice(0, 200) : cur.title;
    if (!taskTitle) return res.status(400).json({ error: "عنوان المهمة لا يمكن أن يكون فارغاً" });
    const assignee = b.assignee != null ? String(b.assignee).trim().slice(0, 60) : cur.assignee;
    const status = TASK_STATUSES.includes(b.status) ? b.status : cur.status;
    const priority = PRIORITIES.includes(b.priority) ? b.priority : cur.priority;
    const dueDay = b.due_day != null ? (isDay(b.due_day) ? b.due_day : "") : cur.due_day;
    retryDb(() => db.prepare(
      "UPDATE team_tasks SET title=?, assignee=?, status=?, priority=?, due_day=? WHERE id=?"
    ).run(taskTitle, assignee, status, priority, dueDay, id));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل تعديل المهمة" });
  }
});

router.delete("/tasks/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "رقم غير صالح" });
    retryDb(() => db.prepare("DELETE FROM team_tasks WHERE id=?").run(id));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل حذف المهمة" });
  }
});

// ═══ 2) ملاحظات الشفت — دفتر تسليم بين الورديات ═══
router.get("/shifts", (req, res) => {
  try {
    const rows = retryDb(() => db.prepare(
      "SELECT id, author, note, created_at FROM team_shifts ORDER BY created_at DESC LIMIT 200"
    ).all());
    res.json({ shifts: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل جلب ملاحظات الشفت" });
  }
});

router.post("/shifts", (req, res) => {
  try {
    const b = req.body || {};
    const note = String(b.note || "").trim().slice(0, 2000);
    if (!note) return res.status(400).json({ error: "اكتب ملاحظة التسليم" });
    const author = String(b.author || req.user || "").trim().slice(0, 60);
    const info = retryDb(() => db.prepare(
      "INSERT INTO team_shifts (author, note, created_at) VALUES (?,?,?)"
    ).run(author, note, Date.now()));
    res.json({ ok: true, id: Number(info.lastInsertRowid) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل حفظ ملاحظة الشفت" });
  }
});

router.delete("/shifts/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "رقم غير صالح" });
    retryDb(() => db.prepare("DELETE FROM team_shifts WHERE id=?").run(id));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل حذف الملاحظة" });
  }
});

// ═══ 3) تشيك ليست يومية — تتصفر كل يوم جديد ═══
// المنطق: البنود المرجعية هي بنود آخر يوم مسجّل؛ عند طلب قائمة اليوم
// إن لم توجد بنود لليوم الحالي تُنسخ من آخر يوم (بحالة غير منجزة).
router.get("/checklist", (req, res) => {
  try {
    const day = todayStr();
    let rows = retryDb(() => db.prepare(
      "SELECT id, item, day, done FROM team_checklist WHERE day=? ORDER BY id LIMIT 300"
    ).all(day));
    if (!rows.length) {
      const lastDay = retryDb(() => db.prepare(
        "SELECT day FROM team_checklist WHERE day != ? ORDER BY day DESC LIMIT 1"
      ).get(day));
      if (lastDay && lastDay.day) {
        const prev = retryDb(() => db.prepare(
          "SELECT item FROM team_checklist WHERE day=? ORDER BY id LIMIT 300"
        ).all(lastDay.day));
        for (const p of prev) {
          retryDb(() => db.prepare(
            "INSERT INTO team_checklist (item, day, done) VALUES (?,?,0)"
          ).run(p.item, day));
        }
        rows = retryDb(() => db.prepare(
          "SELECT id, item, day, done FROM team_checklist WHERE day=? ORDER BY id LIMIT 300"
        ).all(day));
      }
    }
    const doneCount = rows.filter(r => Number(r.done)).length;
    res.json({ day, items: rows, doneCount, total: rows.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل جلب التشيك ليست" });
  }
});

router.post("/checklist", (req, res) => {
  try {
    const item = String((req.body || {}).item || "").trim().slice(0, 200);
    if (!item) return res.status(400).json({ error: "اكتب اسم البند" });
    const info = retryDb(() => db.prepare(
      "INSERT INTO team_checklist (item, day, done) VALUES (?,?,0)"
    ).run(item, todayStr()));
    res.json({ ok: true, id: Number(info.lastInsertRowid) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل إضافة البند" });
  }
});

router.put("/checklist/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "رقم غير صالح" });
    const done = (req.body || {}).done ? 1 : 0;
    const info = retryDb(() => db.prepare("UPDATE team_checklist SET done=? WHERE id=?").run(done, id));
    if (!Number(info.changes)) return res.status(400).json({ error: "البند غير موجود" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل تحديث البند" });
  }
});

router.delete("/checklist/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "رقم غير صالح" });
    // حذف البند من كل الأيام بنفس الاسم حتى لا يعود غداً
    const row = retryDb(() => db.prepare("SELECT item FROM team_checklist WHERE id=?").get(id));
    if (row) retryDb(() => db.prepare("DELETE FROM team_checklist WHERE item=?").run(row.item));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل حذف البند" });
  }
});

// ═══ 4) لوحة نشاط الموظفين — عدد العمليات لكل مستخدم آخر 7 أيام ═══
router.get("/activity-board", (req, res) => {
  try {
    const since = Date.now() - 7 * 24 * 3600 * 1000;
    const rows = retryDb(() => db.prepare(
      `SELECT username, COUNT(*) AS ops, MAX(created_at) AS last_at
       FROM activity_log WHERE created_at >= ?
       GROUP BY username ORDER BY ops DESC LIMIT 100`
    ).all(since));
    const topActions = retryDb(() => db.prepare(
      `SELECT username, action, COUNT(*) AS c
       FROM activity_log WHERE created_at >= ?
       GROUP BY username, action ORDER BY c DESC LIMIT 300`
    ).all(since));
    const byUser = {};
    for (const t of topActions) {
      const u = t.username || "غير معروف";
      if (!byUser[u]) byUser[u] = [];
      if (byUser[u].length < 3) byUser[u].push({ action: t.action, count: Number(t.c) });
    }
    res.json({
      users: rows.map(r => ({
        username: r.username || "غير معروف",
        ops: Number(r.ops),
        last_at: Number(r.last_at),
        top: byUser[r.username || "غير معروف"] || []
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل جلب نشاط الموظفين" });
  }
});

// ═══ 5) تذكيرات داخلية — تظهر عند حلول يومها ═══
router.get("/reminders", (req, res) => {
  try {
    const today = todayStr();
    const rows = retryDb(() => db.prepare(
      "SELECT id, text, remind_day, done FROM team_reminders ORDER BY remind_day ASC, id DESC LIMIT 300"
    ).all());
    const due = rows.filter(r => !Number(r.done) && r.remind_day <= today);
    res.json({ today, reminders: rows, due });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل جلب التذكيرات" });
  }
});

router.post("/reminders", (req, res) => {
  try {
    const b = req.body || {};
    const text = String(b.text || "").trim().slice(0, 300);
    if (!text) return res.status(400).json({ error: "اكتب نص التذكير" });
    if (!isDay(b.remind_day)) return res.status(400).json({ error: "اختر تاريخ التذكير" });
    const info = retryDb(() => db.prepare(
      "INSERT INTO team_reminders (text, remind_day, done) VALUES (?,?,0)"
    ).run(text, b.remind_day));
    res.json({ ok: true, id: Number(info.lastInsertRowid) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل إضافة التذكير" });
  }
});

router.put("/reminders/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "رقم غير صالح" });
    const done = (req.body || {}).done ? 1 : 0;
    const info = retryDb(() => db.prepare("UPDATE team_reminders SET done=? WHERE id=?").run(done, id));
    if (!Number(info.changes)) return res.status(400).json({ error: "التذكير غير موجود" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل تحديث التذكير" });
  }
});

router.delete("/reminders/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "رقم غير صالح" });
    retryDb(() => db.prepare("DELETE FROM team_reminders WHERE id=?").run(id));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل حذف التذكير" });
  }
});

// ═══ 6) ملاحظات لاصقة — حائط ملوّن ═══
router.get("/stickies", (req, res) => {
  try {
    const rows = retryDb(() => db.prepare(
      "SELECT id, text, color, created_at FROM team_stickies ORDER BY created_at DESC LIMIT 200"
    ).all());
    res.json({ stickies: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل جلب الملاحظات اللاصقة" });
  }
});

router.post("/stickies", (req, res) => {
  try {
    const b = req.body || {};
    const text = String(b.text || "").trim().slice(0, 500);
    if (!text) return res.status(400).json({ error: "اكتب نص الملاحظة" });
    const color = STICKY_COLORS.includes(b.color) ? b.color : "yellow";
    const info = retryDb(() => db.prepare(
      "INSERT INTO team_stickies (text, color, created_at) VALUES (?,?,?)"
    ).run(text, color, Date.now()));
    res.json({ ok: true, id: Number(info.lastInsertRowid) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل إضافة الملاحظة" });
  }
});

router.put("/stickies/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "رقم غير صالح" });
    const cur = retryDb(() => db.prepare("SELECT * FROM team_stickies WHERE id=?").get(id));
    if (!cur) return res.status(400).json({ error: "الملاحظة غير موجودة" });
    const b = req.body || {};
    const text = b.text != null ? String(b.text).trim().slice(0, 500) : cur.text;
    if (!text) return res.status(400).json({ error: "النص لا يمكن أن يكون فارغاً" });
    const color = STICKY_COLORS.includes(b.color) ? b.color : cur.color;
    retryDb(() => db.prepare("UPDATE team_stickies SET text=?, color=? WHERE id=?").run(text, color, id));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل تعديل الملاحظة" });
  }
});

router.delete("/stickies/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "رقم غير صالح" });
    retryDb(() => db.prepare("DELETE FROM team_stickies WHERE id=?").run(id));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل حذف الملاحظة" });
  }
});

// ═══ 7) دليل تشغيل SOP — صفحات إرشادات قابلة للتحرير ═══
router.get("/sop", (req, res) => {
  try {
    const rows = retryDb(() => db.prepare(
      "SELECT id, title, updated_at FROM team_sop ORDER BY updated_at DESC LIMIT 200"
    ).all());
    res.json({ pages: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل جلب دليل التشغيل" });
  }
});

router.get("/sop/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "رقم غير صالح" });
    const page = retryDb(() => db.prepare(
      "SELECT id, title, content, updated_at FROM team_sop WHERE id=?"
    ).get(id));
    if (!page) return res.status(400).json({ error: "الصفحة غير موجودة" });
    res.json({ page });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل جلب الصفحة" });
  }
});

router.post("/sop", (req, res) => {
  try {
    const b = req.body || {};
    const sopTitle = String(b.title || "").trim().slice(0, 150);
    if (!sopTitle) return res.status(400).json({ error: "اكتب عنوان الصفحة" });
    const content = String(b.content || "").slice(0, 20000);
    const info = retryDb(() => db.prepare(
      "INSERT INTO team_sop (title, content, updated_at) VALUES (?,?,?)"
    ).run(sopTitle, content, Date.now()));
    res.json({ ok: true, id: Number(info.lastInsertRowid) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل إنشاء الصفحة" });
  }
});

router.put("/sop/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "رقم غير صالح" });
    const cur = retryDb(() => db.prepare("SELECT * FROM team_sop WHERE id=?").get(id));
    if (!cur) return res.status(400).json({ error: "الصفحة غير موجودة" });
    const b = req.body || {};
    const sopTitle = b.title != null ? String(b.title).trim().slice(0, 150) : cur.title;
    if (!sopTitle) return res.status(400).json({ error: "العنوان لا يمكن أن يكون فارغاً" });
    const content = b.content != null ? String(b.content).slice(0, 20000) : cur.content;
    retryDb(() => db.prepare(
      "UPDATE team_sop SET title=?, content=?, updated_at=? WHERE id=?"
    ).run(sopTitle, content, Date.now(), id));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل تعديل الصفحة" });
  }
});

router.delete("/sop/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "رقم غير صالح" });
    retryDb(() => db.prepare("DELETE FROM team_sop WHERE id=?").run(id));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل حذف الصفحة" });
  }
});

// ═══ 8) سجل أحداث بفلتر مستخدم ═══
router.get("/activity-log", (req, res) => {
  try {
    const username = String(req.query.username || "").trim().slice(0, 60);
    const limit = Math.min(300, Math.max(1, parseInt(req.query.limit, 10) || 150));
    let rows;
    if (username) {
      rows = retryDb(() => db.prepare(
        `SELECT id, username, action, detail, created_at FROM activity_log
         WHERE username = ? ORDER BY created_at DESC LIMIT ${limit}`
      ).all(username));
    } else {
      rows = retryDb(() => db.prepare(
        `SELECT id, username, action, detail, created_at FROM activity_log
         ORDER BY created_at DESC LIMIT ${limit}`
      ).all());
    }
    const users = retryDb(() => db.prepare(
      "SELECT DISTINCT username FROM activity_log ORDER BY username LIMIT 100"
    ).all()).map(r => r.username).filter(Boolean);
    res.json({ log: rows, users });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل جلب سجل الأحداث" });
  }
});

// ═══ 9) إنجازات الأسبوع — عمليات «تغيير حالة» لكل مستخدم آخر 7 أيام ═══
router.get("/week-achievements", (req, res) => {
  try {
    const since = Date.now() - 7 * 24 * 3600 * 1000;
    const rows = retryDb(() => db.prepare(
      `SELECT username, COUNT(*) AS changes
       FROM activity_log
       WHERE created_at >= ? AND action = 'تغيير حالة'
       GROUP BY username ORDER BY changes DESC LIMIT 100`
    ).all(since));
    const total = rows.reduce((s, r) => s + Number(r.changes), 0);
    res.json({
      since,
      total,
      users: rows.map(r => ({ username: r.username || "غير معروف", changes: Number(r.changes) }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل جلب إنجازات الأسبوع" });
  }
});

// ═══ 10) اجتماع يومي جاهز — أجندة صباحية للطباعة ═══
router.get("/standup", (req, res) => {
  try {
    const today = todayStr();
    const tStart = dayStart(today);
    const yStart = tStart - 24 * 3600 * 1000;

    // طلبات أمس: العدد والمبيعات (غير الملغية)
    const yesterday = retryDb(() => db.prepare(
      `SELECT COUNT(*) AS c, COALESCE(SUM(CASE WHEN status != 'ملغي' THEN total ELSE 0 END), 0) AS sales
       FROM orders WHERE created_at >= ? AND created_at < ?`
    ).get(yStart, tStart));
    const yOrders = retryDb(() => db.prepare(
      `SELECT id, page_name, order_string, total, status FROM orders
       WHERE created_at >= ? AND created_at < ? ORDER BY created_at DESC LIMIT 100`
    ).all(yStart, tStart));

    // طلبات متأخرة: «جديد» مضى عليها أكثر من 24 ساعة
    const cutoff = Date.now() - 24 * 3600 * 1000;
    const late = retryDb(() => db.prepare(
      `SELECT id, page_name, order_string, total, area, phone, created_at FROM orders
       WHERE status = 'جديد' AND created_at < ? ORDER BY created_at ASC LIMIT 100`
    ).all(cutoff)).map(r => ({ ...r, age_hours: Math.floor((Date.now() - Number(r.created_at)) / 3600000) }));

    // مهام اليوم: المستحقة اليوم أو قبله وغير منجزة
    const tasks = retryDb(() => db.prepare(
      `SELECT id, title, assignee, status, priority, due_day FROM team_tasks
       WHERE status != 'منجزة' AND due_day != '' AND due_day <= ?
       ORDER BY due_day ASC LIMIT 100`
    ).all(today));
    const openTasks = retryDb(() => db.prepare(
      "SELECT COUNT(*) AS c FROM team_tasks WHERE status != 'منجزة'"
    ).get());

    // تذكيرات اليوم
    const reminders = retryDb(() => db.prepare(
      "SELECT id, text, remind_day FROM team_reminders WHERE done = 0 AND remind_day <= ? ORDER BY remind_day ASC LIMIT 100"
    ).all(today));

    // آخر ملاحظة شفت
    const lastShift = retryDb(() => db.prepare(
      "SELECT author, note, created_at FROM team_shifts ORDER BY created_at DESC LIMIT 1"
    ).get());

    res.json({
      today,
      yesterday: {
        count: Number(yesterday && yesterday.c || 0),
        sales: Number(yesterday && yesterday.sales || 0),
        orders: yOrders
      },
      late,
      tasks,
      openTasksCount: Number(openTasks && openTasks.c || 0),
      reminders,
      lastShift: lastShift || null
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل تجهيز أجندة الاجتماع" });
  }
});

// ملخص ذكي اختياري لأجندة الاجتماع (AI)
router.post("/standup/ai-summary", async (req, res) => {
  try {
    const b = req.body || {};
    const facts = String(b.facts || "").slice(0, 4000);
    if (!facts) return res.status(400).json({ error: "لا توجد بيانات لتلخيصها" });
    const prompt =
      "أنت مساعد فريق مبيعات أجبان أردني. لخّص وقائع الاجتماع الصباحي التالية بنقاط عربية قصيرة وواضحة، " +
      "ثم اقترح 3 أولويات عملية لليوم. لا تستخدم Markdown معقداً — نقاط بسيطة فقط.\n\nالوقائع:\n" + facts;
    const text = await askAI(prompt);
    if (!text) return res.status(500).json({ error: "تعذّر الاتصال بالذكاء" });
    res.json({ summary: text });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "فشل توليد الملخص الذكي" });
  }
});
