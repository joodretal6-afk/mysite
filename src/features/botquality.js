// ═══════════════════════════════════════════════════════════
// 🤖 وحدة جودة البوت والمحادثات — قراءة وتحليل فقط (صفر إرسال)
// 10 ميزات: مراجعة جودة AI، مقترح أسئلة شائعة، ملخص محادثة،
// محادثات بلا رد، قاموس ردود، محاكي البوت، سجل أخطاء،
// إحصاءات المحادثات، الكلمات الساخنة، كلمات مراقبة
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import { db, retryDb } from "../db/database.js";
import { CONFIG } from "../config.js";

export const slug = "botquality";
export const title = "جودة البوت والمحادثات";
export const icon = "🤖";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// ── جداول الوحدة (botquality_ فقط) ──
try {
  db.exec(`CREATE TABLE IF NOT EXISTS botquality_dict (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword    TEXT NOT NULL,
    reply      TEXT NOT NULL,
    active     INTEGER DEFAULT 1,
    created_at INTEGER
  )`);
} catch (e) { console.error(e.message); }

try {
  db.exec(`CREATE TABLE IF NOT EXISTS botquality_errors (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    source     TEXT,
    message    TEXT NOT NULL,
    created_at INTEGER
  )`);
} catch (e) { console.error(e.message); }

try {
  db.exec(`CREATE TABLE IF NOT EXISTS botquality_watch (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    word       TEXT NOT NULL UNIQUE
  )`);
} catch (e) { console.error(e.message); }

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

// ── مساعدون ──
function threadsList(limit) {
  const n = Math.max(1, Math.min(200, parseInt(limit, 10) || 30));
  return retryDb(() => db.prepare(`
    SELECT page_id, MAX(page_name) page_name, sender_id,
           COUNT(*) cnt, MAX(created_at) last_at,
           SUM(CASE WHEN direction='in' THEN 1 ELSE 0 END) in_cnt,
           SUM(CASE WHEN direction='out' THEN 1 ELSE 0 END) out_cnt
    FROM messages
    GROUP BY page_id, sender_id
    ORDER BY last_at DESC LIMIT ${n}
  `).all());
}

function threadMessages(pageId, senderId, limit) {
  const n = Math.max(1, Math.min(200, parseInt(limit, 10) || 40));
  const rows = retryDb(() => db.prepare(`
    SELECT direction, body, created_at FROM messages
    WHERE page_id = ? AND sender_id = ?
    ORDER BY created_at DESC, id DESC LIMIT ${n}
  `).all(String(pageId), String(senderId)));
  return rows.reverse();
}

function transcriptOf(msgs) {
  return msgs.map(m =>
    (m.direction === "in" ? "الزبون: " : "البوت: ") + String(m.body || "").slice(0, 400)
  ).join("\n");
}

export const router = Router();

// ═══════════════════════════════════════════════════════════
// (1) مراجعة جودة AI — آخر 3 محادثات مع تقييم /10
// ═══════════════════════════════════════════════════════════
router.post("/review", async (req, res) => {
  try {
    const threads = threadsList(3);
    if (!threads.length) return res.status(400).json({ error: "لا توجد محادثات بعد لمراجعتها" });

    let prompt = "أنت مدقق جودة لبوت مبيعات أجبان أردني على ماسنجر. أمامك آخر " + threads.length +
      " محادثات (الزبون/البوت). قيّم ردود البوت في كل محادثة بدرجة من 10، واذكر نقاط القوة، ثم 2-3 ملاحظات تحسين عملية ومختصرة لكل محادثة، وبالنهاية خلاصة عامة قصيرة. أجب بالعربية وبنص واضح منسّق.\n\n";
    threads.forEach((t, i) => {
      const msgs = threadMessages(t.page_id, t.sender_id, 25);
      prompt += "═══ المحادثة " + (i + 1) + " (صفحة: " + (t.page_name || t.page_id) + ") ═══\n" + transcriptOf(msgs) + "\n\n";
    });

    const text = await askAI(prompt);
    if (!text) return res.status(500).json({ error: "تعذّر الاتصال بالذكاء" });
    res.json({
      review: text,
      threads: threads.map(t => ({ page_name: t.page_name, sender_id: t.sender_id, cnt: t.cnt, last_at: t.last_at }))
    });
  } catch (e) {
    console.error("botquality/review:", e.message);
    res.status(500).json({ error: "تعذّر إجراء مراجعة الجودة" });
  }
});

// ═══════════════════════════════════════════════════════════
// (2) مقترح أسئلة شائعة — تحليل آخر 200 رسالة واردة
// ═══════════════════════════════════════════════════════════
router.post("/faq", async (req, res) => {
  try {
    const rows = retryDb(() => db.prepare(
      "SELECT body FROM messages WHERE direction='in' AND body != '' ORDER BY created_at DESC LIMIT 200"
    ).all());
    if (!rows.length) return res.status(400).json({ error: "لا توجد رسائل واردة بعد لتحليلها" });

    const sample = rows.map(r => "- " + String(r.body || "").slice(0, 200)).join("\n");
    const prompt = "هذه آخر " + rows.length + " رسالة واردة من زبائن بوت مبيعات أجبان وألبان أردني على ماسنجر.\n" +
      "استخرج منها أكثر 10 أسئلة/استفسارات تكرراً، ولكل سؤال اكتب إجابة مقترحة قصيرة بلهجة أردنية مهذبة يمكن للبوت استخدامها.\n" +
      "نسّق الناتج كقائمة مرقّمة: السؤال ثم الإجابة المقترحة تحته. أجب بالعربية فقط.\n\nالرسائل:\n" + sample;

    const text = await askAI(prompt);
    if (!text) return res.status(500).json({ error: "تعذّر الاتصال بالذكاء" });
    res.json({ faq: text, analyzed: rows.length });
  } catch (e) {
    console.error("botquality/faq:", e.message);
    res.status(500).json({ error: "تعذّر استخراج الأسئلة الشائعة" });
  }
});

// ═══════════════════════════════════════════════════════════
// (3) ملخص محادثة بضغطة — قائمة المحادثات + ملخص AI
// ═══════════════════════════════════════════════════════════
router.get("/conversations", (req, res) => {
  try {
    const rows = threadsList(req.query.limit || 30).map(t => {
      const last = retryDb(() => db.prepare(
        "SELECT body, direction FROM messages WHERE page_id = ? AND sender_id = ? ORDER BY created_at DESC, id DESC LIMIT 1"
      ).get(String(t.page_id), String(t.sender_id)));
      return { ...t, last_body: last ? String(last.body || "").slice(0, 80) : "", last_dir: last ? last.direction : "" };
    });
    res.json({ conversations: rows });
  } catch (e) {
    console.error("botquality/conversations:", e.message);
    res.status(500).json({ error: "تعذّر جلب قائمة المحادثات" });
  }
});

router.post("/summary", async (req, res) => {
  try {
    const pageId = String((req.body && req.body.page_id) || "").trim();
    const senderId = String((req.body && req.body.sender_id) || "").trim();
    if (!pageId || !senderId) return res.status(400).json({ error: "حدّد المحادثة أولاً" });

    const msgs = threadMessages(pageId, senderId, 60);
    if (!msgs.length) return res.status(400).json({ error: "لا توجد رسائل في هذه المحادثة" });

    const prompt = "لخّص المحادثة التالية بين زبون وبوت مبيعات أجبان أردني في 4-6 أسطر بالعربية: " +
      "ماذا طلب الزبون، ماذا رد البوت، هل اكتمل الطلب أم لا، وأي نقطة مهمة تحتاج متابعة بشرية.\n\n" + transcriptOf(msgs);

    const text = await askAI(prompt);
    if (!text) return res.status(500).json({ error: "تعذّر الاتصال بالذكاء" });
    res.json({ summary: text, count: msgs.length });
  } catch (e) {
    console.error("botquality/summary:", e.message);
    res.status(500).json({ error: "تعذّر تلخيص المحادثة" });
  }
});

// ═══════════════════════════════════════════════════════════
// (4) محادثات بلا رد — آخر رسالة واردة منذ أكثر من ساعة
// ═══════════════════════════════════════════════════════════
router.get("/noreply", (req, res) => {
  try {
    const now = Date.now();
    const rows = retryDb(() => db.prepare(`
      SELECT m.page_id, MAX(m.page_name) page_name, m.sender_id, MAX(m.created_at) last_at,
             (SELECT direction FROM messages x WHERE x.page_id = m.page_id AND x.sender_id = m.sender_id ORDER BY x.created_at DESC, x.id DESC LIMIT 1) last_dir,
             (SELECT body FROM messages x2 WHERE x2.page_id = m.page_id AND x2.sender_id = m.sender_id ORDER BY x2.created_at DESC, x2.id DESC LIMIT 1) last_body
      FROM messages m
      WHERE m.created_at >= ?
      GROUP BY m.page_id, m.sender_id
      ORDER BY last_at DESC LIMIT 100
    `).all(now - 7 * DAY));

    const list = rows
      .filter(r => r.last_dir === "in" && Number(r.last_at) < now - HOUR)
      .map(r => ({
        page_id: r.page_id, page_name: r.page_name, sender_id: r.sender_id,
        last_at: r.last_at, last_body: String(r.last_body || "").slice(0, 120),
        hours_ago: Math.floor((now - Number(r.last_at)) / HOUR)
      }));
    res.json({ threads: list });
  } catch (e) {
    console.error("botquality/noreply:", e.message);
    res.status(500).json({ error: "تعذّر جلب المحادثات بلا رد" });
  }
});

// ═══════════════════════════════════════════════════════════
// (5) قاموس ردود مخصصة — CRUD (بيانات للاستخدام المستقبلي)
// ═══════════════════════════════════════════════════════════
router.get("/dict", (req, res) => {
  try {
    const rows = retryDb(() => db.prepare(
      "SELECT id, keyword, reply, active, created_at FROM botquality_dict ORDER BY id DESC LIMIT 500"
    ).all());
    res.json({ entries: rows });
  } catch (e) {
    console.error("botquality/dict:", e.message);
    res.status(500).json({ error: "تعذّر جلب القاموس" });
  }
});

router.post("/dict", (req, res) => {
  try {
    const keyword = String((req.body && req.body.keyword) || "").trim();
    const reply = String((req.body && req.body.reply) || "").trim();
    if (!keyword || !reply) return res.status(400).json({ error: "الكلمة المفتاحية والرد مطلوبان" });
    if (keyword.length > 100 || reply.length > 1000) return res.status(400).json({ error: "النص أطول من المسموح" });
    retryDb(() => db.prepare(
      "INSERT INTO botquality_dict (keyword, reply, active, created_at) VALUES (?, ?, 1, ?)"
    ).run(keyword, reply, Date.now()));
    res.json({ ok: true });
  } catch (e) {
    console.error("botquality/dict add:", e.message);
    res.status(500).json({ error: "تعذّر إضافة الرد" });
  }
});

router.post("/dict/:id/toggle", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "معرّف غير صالح" });
    const r = retryDb(() => db.prepare(
      "UPDATE botquality_dict SET active = 1 - active WHERE id = ?"
    ).run(id));
    if (!r.changes) return res.status(400).json({ error: "الرد غير موجود" });
    res.json({ ok: true });
  } catch (e) {
    console.error("botquality/dict toggle:", e.message);
    res.status(500).json({ error: "تعذّر تغيير حالة الرد" });
  }
});

router.put("/dict/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const keyword = String((req.body && req.body.keyword) || "").trim();
    const reply = String((req.body && req.body.reply) || "").trim();
    if (!id || !keyword || !reply) return res.status(400).json({ error: "المعرّف والكلمة والرد مطلوبون" });
    const r = retryDb(() => db.prepare(
      "UPDATE botquality_dict SET keyword = ?, reply = ? WHERE id = ?"
    ).run(keyword, reply, id));
    if (!r.changes) return res.status(400).json({ error: "الرد غير موجود" });
    res.json({ ok: true });
  } catch (e) {
    console.error("botquality/dict edit:", e.message);
    res.status(500).json({ error: "تعذّر تعديل الرد" });
  }
});

router.delete("/dict/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "معرّف غير صالح" });
    retryDb(() => db.prepare("DELETE FROM botquality_dict WHERE id = ?").run(id));
    res.json({ ok: true });
  } catch (e) {
    console.error("botquality/dict del:", e.message);
    res.status(500).json({ error: "تعذّر حذف الرد" });
  }
});

// ═══════════════════════════════════════════════════════════
// (6) محاكي البوت — تجربة الردود دون فيسبوك إطلاقاً
// ═══════════════════════════════════════════════════════════
router.post("/simulate", async (req, res) => {
  try {
    const message = String((req.body && req.body.message) || "").trim();
    if (!message) return res.status(400).json({ error: "اكتب رسالة تجريبية أولاً" });
    if (message.length > 500) return res.status(400).json({ error: "الرسالة أطول من المسموح (500 حرف)" });

    const history = Array.isArray(req.body && req.body.history) ? req.body.history.slice(-10) : [];
    const histText = history
      .map(h => (h && h.role === "bot" ? "البوت: " : "الزبون: ") + String((h && h.text) || "").slice(0, 300))
      .join("\n");

    const prompt = "أنت بوت مبيعات لمحل أجبان وألبان بلدية أردني على ماسنجر. تتكلم لهجة أردنية مهذبة ومختصرة. " +
      "المنتجات: جبنة غنم بلدية، جبنة بقر، لبنة، سمنة بلدية، زبدة. البيع بالكيلو أو النصية. التوصيل داخل الأردن والدفع عند الاستلام. " +
      "لإتمام الطلب تحتاج: الصنف والكمية، المنطقة، ورقم الهاتف. رد على رسالة الزبون الأخيرة برد واحد قصير وطبيعي.\n\n" +
      (histText ? "المحادثة حتى الآن:\n" + histText + "\n\n" : "") +
      "الزبون: " + message + "\nالبوت:";

    const text = await askAI(prompt);
    if (!text) return res.status(500).json({ error: "تعذّر الاتصال بالذكاء" });
    res.json({ reply: text });
  } catch (e) {
    console.error("botquality/simulate:", e.message);
    res.status(500).json({ error: "تعذّر تشغيل المحاكي" });
  }
});

// ═══════════════════════════════════════════════════════════
// (7) سجل أخطاء — تسجيل + عرض آخر 100
// ═══════════════════════════════════════════════════════════
router.get("/errors", (req, res) => {
  try {
    const rows = retryDb(() => db.prepare(
      "SELECT id, source, message, created_at FROM botquality_errors ORDER BY id DESC LIMIT 100"
    ).all());
    res.json({ errors: rows });
  } catch (e) {
    console.error("botquality/errors:", e.message);
    res.status(500).json({ error: "تعذّر جلب سجل الأخطاء" });
  }
});

router.post("/errors", (req, res) => {
  try {
    const source = String((req.body && req.body.source) || "يدوي").trim().slice(0, 100);
    const message = String((req.body && req.body.message) || "").trim();
    if (!message) return res.status(400).json({ error: "نص الخطأ مطلوب" });
    retryDb(() => db.prepare(
      "INSERT INTO botquality_errors (source, message, created_at) VALUES (?, ?, ?)"
    ).run(source, message.slice(0, 2000), Date.now()));
    res.json({ ok: true });
  } catch (e) {
    console.error("botquality/errors add:", e.message);
    res.status(500).json({ error: "تعذّر تسجيل الخطأ" });
  }
});

router.delete("/errors", (req, res) => {
  try {
    retryDb(() => db.prepare("DELETE FROM botquality_errors").run());
    res.json({ ok: true });
  } catch (e) {
    console.error("botquality/errors clear:", e.message);
    res.status(500).json({ error: "تعذّر مسح السجل" });
  }
});

// ═══════════════════════════════════════════════════════════
// (8) إحصاءات المحادثات — 14 يوم + محادثات مميزة + نسبة التحول
// ═══════════════════════════════════════════════════════════
router.get("/stats", (req, res) => {
  try {
    const from = Date.now() - 14 * DAY;
    const daily = retryDb(() => db.prepare(`
      SELECT date(created_at/1000, 'unixepoch') d,
             SUM(CASE WHEN direction='in' THEN 1 ELSE 0 END) inc,
             SUM(CASE WHEN direction='out' THEN 1 ELSE 0 END) outc
      FROM messages WHERE created_at >= ?
      GROUP BY d ORDER BY d
    `).all(from));

    const conv = retryDb(() => db.prepare(
      "SELECT COUNT(DISTINCT page_id || '|' || sender_id) c FROM messages WHERE created_at >= ?"
    ).get(from));
    const senders = retryDb(() => db.prepare(
      "SELECT COUNT(DISTINCT page_id || '|' || sender_id) c FROM messages WHERE created_at >= ? AND direction='in'"
    ).get(from));
    const buyers = retryDb(() => db.prepare(
      "SELECT COUNT(DISTINCT page_id || '|' || sender_id) c FROM orders WHERE created_at >= ? AND status != 'ملغي'"
    ).get(from));
    const totals = retryDb(() => db.prepare(`
      SELECT SUM(CASE WHEN direction='in' THEN 1 ELSE 0 END) inc,
             SUM(CASE WHEN direction='out' THEN 1 ELSE 0 END) outc
      FROM messages WHERE created_at >= ?
    `).get(from));

    const sendersC = Number(senders.c) || 0;
    const buyersC = Number(buyers.c) || 0;
    res.json({
      daily,
      conversations: Number(conv.c) || 0,
      senders: sendersC,
      buyers: buyersC,
      conversion: sendersC ? Math.round((buyersC / sendersC) * 1000) / 10 : 0,
      total_in: Number(totals.inc) || 0,
      total_out: Number(totals.outc) || 0
    });
  } catch (e) {
    console.error("botquality/stats:", e.message);
    res.status(500).json({ error: "تعذّر حساب الإحصاءات" });
  }
});

// ═══════════════════════════════════════════════════════════
// (9) الكلمات الساخنة — أكثر 20 كلمة واردة (بلا كلمات توقف)
// ═══════════════════════════════════════════════════════════
const STOP = new Set([
  "في", "من", "على", "الى", "إلى", "عن", "مع", "هذا", "هذه", "ذلك", "التي", "الذي", "ما", "لا",
  "نعم", "اي", "أي", "او", "أو", "و", "يا", "انا", "أنا", "انت", "أنت", "هو", "هي", "هم", "احنا",
  "نحن", "كان", "كانت", "يكون", "هل", "كيف", "متى", "وين", "شو", "ليش", "لماذا", "اذا", "إذا",
  "لو", "بس", "كل", "بعد", "قبل", "عند", "عندي", "عندك", "فيه", "في", "مش", "مو", "بدي", "بدنا",
  "ابي", "اريد", "أريد", "ممكن", "الله", "ان", "إن", "أن", "قد", "لقد", "ثم", "حتى", "غير", "بين",
  "له", "لها", "لهم", "لي", "لك", "به", "بها", "منه", "منها", "الي", "اللي", "يعني", "طيب", "تمام",
  "اوك", "اه", "آه", "ايه", "لكن", "ولا", "ولكن", "هاد", "هاي", "هيك", "كمان", "كثير", "شوي",
  "مرحبا", "اهلا", "أهلا", "هلا", "السلام", "عليكم", "ورحمة", "وبركاته", "صباح", "مساء", "الخير", "خير"
]);

router.get("/hotwords", (req, res) => {
  try {
    const rows = retryDb(() => db.prepare(
      "SELECT body FROM messages WHERE direction='in' AND body != '' ORDER BY created_at DESC LIMIT 1000"
    ).all());
    const counts = {};
    for (const r of rows) {
      const words = String(r.body || "")
        .replace(/[ً-ٰٟ]/g, "")
        .split(/[^ء-يa-zA-Z0-9]+/)
        .filter(Boolean);
      for (let w of words) {
        w = w.replace(/^ال/, "");
        if (w.length < 2 || STOP.has(w) || STOP.has("ال" + w) || /^\d+$/.test(w)) continue;
        counts[w] = (counts[w] || 0) + 1;
      }
    }
    const top = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word, count]) => ({ word, count }));
    res.json({ words: top, analyzed: rows.length });
  } catch (e) {
    console.error("botquality/hotwords:", e.message);
    res.status(500).json({ error: "تعذّر تحليل الكلمات" });
  }
});

// ═══════════════════════════════════════════════════════════
// (10) كلمات مراقبة — قائمة + فحص رسائل آخر 24 ساعة
// ═══════════════════════════════════════════════════════════
router.get("/watch", (req, res) => {
  try {
    const rows = retryDb(() => db.prepare("SELECT id, word FROM botquality_watch ORDER BY word LIMIT 200").all());
    res.json({ words: rows });
  } catch (e) {
    console.error("botquality/watch:", e.message);
    res.status(500).json({ error: "تعذّر جلب كلمات المراقبة" });
  }
});

router.post("/watch", (req, res) => {
  try {
    const word = String((req.body && req.body.word) || "").trim();
    if (!word) return res.status(400).json({ error: "اكتب الكلمة أولاً" });
    if (word.length > 50) return res.status(400).json({ error: "الكلمة أطول من المسموح" });
    retryDb(() => db.prepare("INSERT OR IGNORE INTO botquality_watch (word) VALUES (?)").run(word));
    res.json({ ok: true });
  } catch (e) {
    console.error("botquality/watch add:", e.message);
    res.status(500).json({ error: "تعذّر إضافة الكلمة" });
  }
});

router.delete("/watch/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "معرّف غير صالح" });
    retryDb(() => db.prepare("DELETE FROM botquality_watch WHERE id = ?").run(id));
    res.json({ ok: true });
  } catch (e) {
    console.error("botquality/watch del:", e.message);
    res.status(500).json({ error: "تعذّر حذف الكلمة" });
  }
});

router.get("/watch/hits", (req, res) => {
  try {
    const words = retryDb(() => db.prepare("SELECT word FROM botquality_watch LIMIT 200").all()).map(r => r.word);
    if (!words.length) return res.json({ hits: [], words: 0 });

    const rows = retryDb(() => db.prepare(
      "SELECT page_name, sender_id, body, created_at FROM messages WHERE direction='in' AND created_at >= ? ORDER BY created_at DESC LIMIT 2000"
    ).all(Date.now() - DAY));

    const hits = [];
    for (const r of rows) {
      const body = String(r.body || "");
      const matched = words.filter(w => body.includes(w));
      if (matched.length) {
        hits.push({
          page_name: r.page_name, sender_id: r.sender_id,
          body: body.slice(0, 200), created_at: r.created_at, matched
        });
        if (hits.length >= 100) break;
      }
    }
    res.json({ hits, words: words.length });
  } catch (e) {
    console.error("botquality/watch hits:", e.message);
    res.status(500).json({ error: "تعذّر فحص الرسائل" });
  }
});
