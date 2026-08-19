// ═══════════════════════════════════════════════════════════
// 📣 وحدة استوديو التسويق — 10 ميزات (صفر إرسال، أدوات داخل اللوحة فقط)
// 1) أفكار منشورات AI    2) كابشنات إعلانية AI   3) سيناريو فيديو AI
// 4) تقويم محتوى         5) مكتبة نصوص ناجحة     6) بنك ردود التعليقات
// 7) مولد عروض ذكي       8) أفضل أوقات النشر     9) أرشيف حملات
// 10) هاشتاغات وكلمات إعلانية AI
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import { db, retryDb } from "../db/database.js";
import { CONFIG } from "../config.js";

export const slug = "marketing";
export const title = "استوديو التسويق";
export const icon = "📣";

// ── جداول الوحدة (marketing_ فقط) ──
try {
  db.exec(`CREATE TABLE IF NOT EXISTS marketing_calendar (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    day     TEXT NOT NULL,
    title   TEXT NOT NULL,
    channel TEXT DEFAULT 'فيسبوك',
    status  TEXT DEFAULT 'مخطط',
    notes   TEXT DEFAULT ''
  )`);
} catch (e) { console.error(e.message); }

try {
  db.exec(`CREATE TABLE IF NOT EXISTS marketing_swipes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    tags       TEXT DEFAULT '',
    created_at INTEGER
  )`);
} catch (e) { console.error(e.message); }

try {
  db.exec(`CREATE TABLE IF NOT EXISTS marketing_replies (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    "trigger" TEXT NOT NULL,
    reply     TEXT NOT NULL
  )`);
} catch (e) { console.error(e.message); }

try {
  db.exec(`CREATE TABLE IF NOT EXISTS marketing_campaigns (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    product       TEXT DEFAULT '',
    budget        REAL DEFAULT 0,
    started_at    TEXT DEFAULT '',
    ended_at      TEXT DEFAULT '',
    orders_gained INTEGER DEFAULT 0,
    notes         TEXT DEFAULT '',
    verdict       TEXT DEFAULT ''
  )`);
} catch (e) { console.error(e.message); }

// ── الذكاء الاصطناعي (Gemini) — يرجع نص أو null عند الفشل ──
async function askAI(prompt) {
  // يمرّ من الطبقة الموحّدة — يشتغل بأي مزوّد مربوط (AIsa أو Gemini)
  try {
    const { aiComplete } = await import("../bot/aiCore.js");
    const r = await aiComplete(prompt, { temperature: 0.5, maxTokens: 900, timeoutMs: 40000 });
    if (!r.ok) return null;
    return String(r.text || "").replace(/\*\*/g, "").trim() || null;
  } catch { return null; }
}

// ── مساعدات صغيرة ──
const S = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

export const router = Router();

// ═══════════════════════════════════════════════════════════
// (1) مولد أفكار منشورات (AI)
// ═══════════════════════════════════════════════════════════
router.post("/ideas", async (req, res) => {
  try {
    const topic = S(req.body && req.body.topic, 200);
    if (!topic) return res.status(400).json({ error: "اكتب اسم المنتج أو المناسبة أولاً" });
    const prompt =
      "أنت خبير تسويق لمحل أجبان وألبان بلدية في الأردن يبيع عبر صفحات فيسبوك.\n" +
      `المطلوب: 5 أفكار منشورات فيسبوك عن: "${topic}".\n` +
      "الشروط: باللهجة الأردنية البيضاء المحبّبة، كل فكرة مرقّمة (1-5) وفيها: عنوان جذاب + وصف سطرين لفكرة المنشور + نوعه (صورة/فيديو/سؤال تفاعلي...).\n" +
      "بدون مقدمات ولا خاتمة — الأفكار الخمسة مباشرة.";
    const text = await askAI(prompt);
    if (!text) return res.status(500).json({ error: "تعذّر الاتصال بالذكاء" });
    res.json({ topic, text });
  } catch (e) {
    console.error("marketing/ideas:", e.message);
    res.status(500).json({ error: "تعذّر توليد أفكار المنشورات" });
  }
});

// ═══════════════════════════════════════════════════════════
// (2) كاتب كابشن إعلان (AI) — 3 زوايا: سعر / جودة / قصة
// ═══════════════════════════════════════════════════════════
router.post("/captions", async (req, res) => {
  try {
    const product = S(req.body && req.body.product, 200);
    const details = S(req.body && req.body.details, 400);
    if (!product) return res.status(400).json({ error: "اكتب اسم المنتج أولاً" });
    const prompt =
      "أنت كاتب إعلانات محترف لصفحات بيع أجبان وألبان بلدية في الأردن.\n" +
      `اكتب 3 كابشنات إعلانية جاهزة للنشر عن المنتج: "${product}".` +
      (details ? `\nتفاصيل إضافية من صاحب المحل: ${details}` : "") +
      "\nكل كابشن بزاوية مختلفة ومعنون بوضوح:\n" +
      "1) زاوية السعر والتوفير.\n2) زاوية الجودة والطعم البلدي.\n3) زاوية القصة والعاطفة (بيت، عيلة، ذكريات).\n" +
      "الأسلوب: لهجة أردنية بيضاء، 3-5 أسطر لكل كابشن، مع دعوة واضحة للطلب عبر الرسائل، وإيموجي خفيف بدون مبالغة. بدون أي مقدمات.";
    const text = await askAI(prompt);
    if (!text) return res.status(500).json({ error: "تعذّر الاتصال بالذكاء" });
    res.json({ product, text });
  } catch (e) {
    console.error("marketing/captions:", e.message);
    res.status(500).json({ error: "تعذّر كتابة الكابشنات" });
  }
});

// ═══════════════════════════════════════════════════════════
// (3) مولد سيناريو فيديو 30 ثانية (AI)
// ═══════════════════════════════════════════════════════════
router.post("/video-script", async (req, res) => {
  try {
    const product = S(req.body && req.body.product, 200);
    const style = S(req.body && req.body.style, 100);
    if (!product) return res.status(400).json({ error: "اكتب اسم المنتج أولاً" });
    const prompt =
      "أنت مخرج فيديوهات تسويقية قصيرة (ريلز) لمحل أجبان وألبان بلدية في الأردن.\n" +
      `اكتب سيناريو فيديو مدته 30 ثانية عن المنتج: "${product}".` +
      (style ? `\nالأسلوب المطلوب: ${style}.` : "") +
      "\nالشكل المطلوب بالضبط: مشاهد مرقّمة، كل مشهد بسطر يبدأ بتوقيته مثل: (0-4 ثواني) وصف اللقطة | النص المسموع أو المكتوب على الشاشة.\n" +
      "خاتمة الفيديو: دعوة للطلب عبر رسائل الصفحة. اللهجة أردنية بسيطة، قابل للتصوير بموبايل داخل المحل. بدون مقدمات.";
    const text = await askAI(prompt);
    if (!text) return res.status(500).json({ error: "تعذّر الاتصال بالذكاء" });
    res.json({ product, text });
  } catch (e) {
    console.error("marketing/video-script:", e.message);
    res.status(500).json({ error: "تعذّر توليد سيناريو الفيديو" });
  }
});

// ═══════════════════════════════════════════════════════════
// (4) تقويم المحتوى — CRUD بعرض أسبوعي
// ═══════════════════════════════════════════════════════════
router.get("/calendar", (req, res) => {
  try {
    const from = S(req.query.from, 10);
    const to = S(req.query.to, 10);
    if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) {
      return res.status(400).json({ error: "التاريخ يجب أن يكون بصيغة YYYY-MM-DD" });
    }
    const rows = retryDb(() => db.prepare(
      "SELECT id,day,title,channel,status,notes FROM marketing_calendar WHERE day >= ? AND day <= ? ORDER BY day, id LIMIT 500"
    ).all(from, to));
    res.json({ from, to, items: rows });
  } catch (e) {
    console.error("marketing/calendar:", e.message);
    res.status(500).json({ error: "تعذّر جلب تقويم المحتوى" });
  }
});

router.post("/calendar/add", (req, res) => {
  try {
    const b = req.body || {};
    const day = S(b.day, 10);
    const title = S(b.title, 200);
    if (!ISO_DAY.test(day)) return res.status(400).json({ error: "اختر يوم النشر (YYYY-MM-DD)" });
    if (!title) return res.status(400).json({ error: "اكتب عنوان المنشور" });
    const channel = S(b.channel, 40) || "فيسبوك";
    const status = S(b.status, 40) || "مخطط";
    const notes = S(b.notes, 1000);
    const r = retryDb(() => db.prepare(
      "INSERT INTO marketing_calendar (day,title,channel,status,notes) VALUES (?,?,?,?,?)"
    ).run(day, title, channel, status, notes));
    res.json({ ok: true, id: Number(r.lastInsertRowid) });
  } catch (e) {
    console.error("marketing/calendar/add:", e.message);
    res.status(500).json({ error: "تعذّر إضافة عنصر التقويم" });
  }
});

router.post("/calendar/update", (req, res) => {
  try {
    const b = req.body || {};
    const id = parseInt(b.id, 10);
    if (!id) return res.status(400).json({ error: "رقم العنصر مطلوب" });
    const cur = retryDb(() => db.prepare("SELECT * FROM marketing_calendar WHERE id = ?").get(id));
    if (!cur) return res.status(400).json({ error: "العنصر غير موجود" });
    const day = b.day != null ? S(b.day, 10) : cur.day;
    const title = b.title != null ? S(b.title, 200) : cur.title;
    if (!ISO_DAY.test(day)) return res.status(400).json({ error: "التاريخ يجب أن يكون بصيغة YYYY-MM-DD" });
    if (!title) return res.status(400).json({ error: "العنوان لا يمكن أن يكون فارغاً" });
    const channel = b.channel != null ? (S(b.channel, 40) || "فيسبوك") : cur.channel;
    const status = b.status != null ? (S(b.status, 40) || "مخطط") : cur.status;
    const notes = b.notes != null ? S(b.notes, 1000) : cur.notes;
    retryDb(() => db.prepare(
      "UPDATE marketing_calendar SET day=?, title=?, channel=?, status=?, notes=? WHERE id=?"
    ).run(day, title, channel, status, notes, id));
    res.json({ ok: true });
  } catch (e) {
    console.error("marketing/calendar/update:", e.message);
    res.status(500).json({ error: "تعذّر تعديل عنصر التقويم" });
  }
});

router.post("/calendar/delete", (req, res) => {
  try {
    const id = parseInt(req.body && req.body.id, 10);
    if (!id) return res.status(400).json({ error: "رقم العنصر مطلوب" });
    const r = retryDb(() => db.prepare("DELETE FROM marketing_calendar WHERE id = ?").run(id));
    if (!r.changes) return res.status(400).json({ error: "العنصر غير موجود" });
    res.json({ ok: true });
  } catch (e) {
    console.error("marketing/calendar/delete:", e.message);
    res.status(500).json({ error: "تعذّر حذف عنصر التقويم" });
  }
});

// ═══════════════════════════════════════════════════════════
// (5) مكتبة النصوص الناجحة (Swipe File) — حفظ وبحث
// ═══════════════════════════════════════════════════════════
router.get("/swipes", (req, res) => {
  try {
    const s = S(req.query.search, 100);
    const cond = s ? "WHERE title LIKE @s OR body LIKE @s OR tags LIKE @s" : "";
    const rows = retryDb(() => db.prepare(
      `SELECT id,title,body,tags,created_at FROM marketing_swipes ${cond} ORDER BY created_at DESC LIMIT 300`
    ).all(s ? { s: `%${s}%` } : {}));
    res.json({ swipes: rows });
  } catch (e) {
    console.error("marketing/swipes:", e.message);
    res.status(500).json({ error: "تعذّر جلب مكتبة النصوص" });
  }
});

router.post("/swipes/add", (req, res) => {
  try {
    const b = req.body || {};
    const title = S(b.title, 150);
    const body = S(b.body, 4000);
    const tags = S(b.tags, 200);
    if (!title || !body) return res.status(400).json({ error: "العنوان ونص المنشور مطلوبان" });
    const r = retryDb(() => db.prepare(
      "INSERT INTO marketing_swipes (title,body,tags,created_at) VALUES (?,?,?,?)"
    ).run(title, body, tags, Date.now()));
    res.json({ ok: true, id: Number(r.lastInsertRowid) });
  } catch (e) {
    console.error("marketing/swipes/add:", e.message);
    res.status(500).json({ error: "تعذّر حفظ النص" });
  }
});

router.post("/swipes/delete", (req, res) => {
  try {
    const id = parseInt(req.body && req.body.id, 10);
    if (!id) return res.status(400).json({ error: "رقم النص مطلوب" });
    const r = retryDb(() => db.prepare("DELETE FROM marketing_swipes WHERE id = ?").run(id));
    if (!r.changes) return res.status(400).json({ error: "النص غير موجود" });
    res.json({ ok: true });
  } catch (e) {
    console.error("marketing/swipes/delete:", e.message);
    res.status(500).json({ error: "تعذّر حذف النص" });
  }
});

// ═══════════════════════════════════════════════════════════
// (6) بنك ردود التعليقات — ردود جاهزة تُنسخ يدوياً
// ═══════════════════════════════════════════════════════════
router.get("/replies", (req, res) => {
  try {
    const s = S(req.query.search, 100);
    const cond = s ? `WHERE "trigger" LIKE @s OR reply LIKE @s` : "";
    const rows = retryDb(() => db.prepare(
      `SELECT id,"trigger",reply FROM marketing_replies ${cond} ORDER BY id DESC LIMIT 500`
    ).all(s ? { s: `%${s}%` } : {}));
    res.json({ replies: rows });
  } catch (e) {
    console.error("marketing/replies:", e.message);
    res.status(500).json({ error: "تعذّر جلب بنك الردود" });
  }
});

router.post("/replies/add", (req, res) => {
  try {
    const trigger = S(req.body && req.body.trigger, 150);
    const reply = S(req.body && req.body.reply, 2000);
    if (!trigger || !reply) return res.status(400).json({ error: "نوع التعليق ونص الرد مطلوبان" });
    const r = retryDb(() => db.prepare(
      `INSERT INTO marketing_replies ("trigger",reply) VALUES (?,?)`
    ).run(trigger, reply));
    res.json({ ok: true, id: Number(r.lastInsertRowid) });
  } catch (e) {
    console.error("marketing/replies/add:", e.message);
    res.status(500).json({ error: "تعذّر إضافة الرد" });
  }
});

router.post("/replies/update", (req, res) => {
  try {
    const id = parseInt(req.body && req.body.id, 10);
    const trigger = S(req.body && req.body.trigger, 150);
    const reply = S(req.body && req.body.reply, 2000);
    if (!id || !trigger || !reply) return res.status(400).json({ error: "الرقم ونوع التعليق ونص الرد مطلوبة" });
    const r = retryDb(() => db.prepare(
      `UPDATE marketing_replies SET "trigger" = ?, reply = ? WHERE id = ?`
    ).run(trigger, reply, id));
    if (!r.changes) return res.status(400).json({ error: "الرد غير موجود" });
    res.json({ ok: true });
  } catch (e) {
    console.error("marketing/replies/update:", e.message);
    res.status(500).json({ error: "تعذّر تعديل الرد" });
  }
});

router.post("/replies/delete", (req, res) => {
  try {
    const id = parseInt(req.body && req.body.id, 10);
    if (!id) return res.status(400).json({ error: "رقم الرد مطلوب" });
    const r = retryDb(() => db.prepare("DELETE FROM marketing_replies WHERE id = ?").run(id));
    if (!r.changes) return res.status(400).json({ error: "الرد غير موجود" });
    res.json({ ok: true });
  } catch (e) {
    console.error("marketing/replies/delete:", e.message);
    res.status(500).json({ error: "تعذّر حذف الرد" });
  }
});

// ═══════════════════════════════════════════════════════════
// (7) مولد العروض الذكي — 3 عروض محسوبة الهامش (بدون AI)
// ═══════════════════════════════════════════════════════════
router.post("/offers", (req, res) => {
  try {
    const price = Number(req.body && req.body.price);
    const cost = Number(req.body && req.body.cost);
    if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: "سعر البيع يجب أن يكون رقماً أكبر من صفر" });
    if (!Number.isFinite(cost) || cost < 0) return res.status(400).json({ error: "التكلفة يجب أن تكون رقماً صفراً أو أكثر" });
    if (cost >= price) return res.status(400).json({ error: "التكلفة أعلى من (أو تساوي) سعر البيع — لا يوجد هامش ربح أصلاً لبناء عرض عليه" });

    const MIN_MARGIN = 25; // %
    const mk = (name, desc, revenue, totalCost) => {
      const margin = revenue > 0 ? ((revenue - totalCost) / revenue) * 100 : 0;
      return {
        name, desc,
        revenue: round2(revenue),
        cost: round2(totalCost),
        profit: round2(revenue - totalCost),
        margin_pct: round2(margin),
        warning: margin < MIN_MARGIN ? `⚠️ الهامش نزل تحت ${MIN_MARGIN}% — العرض مغري للزبون لكنه خطر على ربحك` : ""
      };
    };

    const baseMargin = ((price - cost) / price) * 100;
    const offers = [
      mk(
        "عرض الكمية",
        `اشترِ قطعتين والثالثة بنص السعر (الزبون يدفع ${round2(2.5 * price)} بدل ${round2(3 * price)})`,
        2.5 * price, 3 * cost
      ),
      mk(
        "عرض الهدية",
        `هدية مجانية مع كل طلب بقيمة ${round2(0.1 * price)} دينار (تُحسب كتكلفة إضافية عليك)`,
        price, cost + 0.1 * price
      ),
      mk(
        "عرض الخصم",
        `خصم مباشر 10% (السعر يصير ${round2(0.9 * price)} بدل ${round2(price)})`,
        0.9 * price, cost
      )
    ];
    res.json({
      price: round2(price),
      cost: round2(cost),
      base_margin_pct: round2(baseMargin),
      min_margin_pct: MIN_MARGIN,
      offers
    });
  } catch (e) {
    console.error("marketing/offers:", e.message);
    res.status(500).json({ error: "تعذّر حساب العروض" });
  }
});

// ═══════════════════════════════════════════════════════════
// (8) أفضل أوقات النشر — من ذروة الطلبات الفعلية (يوم × ساعة)
// ═══════════════════════════════════════════════════════════
const DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const AMMAN_OFFSET_MS = 3 * 3600000; // توقيت الأردن UTC+3

router.get("/best-times", (req, res) => {
  try {
    let days = parseInt(req.query.days, 10);
    if (![30, 60, 90, 180, 365].includes(days)) days = 90;
    const cutoff = Date.now() - days * 86400000;
    const rows = retryDb(() => db.prepare(
      "SELECT created_at FROM orders WHERE created_at >= ? AND status != 'ملغي' ORDER BY created_at DESC LIMIT 20000"
    ).all(cutoff));

    const grid = {}; // "dow_hour" → count
    for (const r of rows) {
      const t = Number(r.created_at);
      if (!Number.isFinite(t) || t <= 0) continue;
      const d = new Date(t + AMMAN_OFFSET_MS);
      const key = d.getUTCDay() + "_" + d.getUTCHours();
      grid[key] = (grid[key] || 0) + 1;
    }
    const slots = Object.entries(grid).map(([k, count]) => {
      const [dow, hour] = k.split("_").map(Number);
      return { dow, day_name: DAY_NAMES[dow], hour, count };
    }).sort((a, b) => b.count - a.count);

    res.json({
      days,
      total_orders: rows.length,
      top: slots.slice(0, 5),
      grid: slots
    });
  } catch (e) {
    console.error("marketing/best-times:", e.message);
    res.status(500).json({ error: "تعذّر حساب أفضل أوقات النشر" });
  }
});

// ═══════════════════════════════════════════════════════════
// (9) أرشيف الحملات — تسجيل يدوي وتعلّم من النتائج
// ═══════════════════════════════════════════════════════════
function campaignRow(c) {
  const budget = Number(c.budget) || 0;
  const gained = Number(c.orders_gained) || 0;
  return {
    ...c,
    cost_per_order: gained > 0 ? round2(budget / gained) : null
  };
}

router.get("/campaigns", (_req, res) => {
  try {
    const rows = retryDb(() => db.prepare(
      "SELECT id,name,product,budget,started_at,ended_at,orders_gained,notes,verdict FROM marketing_campaigns ORDER BY id DESC LIMIT 300"
    ).all()).map(campaignRow);
    const withCpo = rows.filter(r => r.cost_per_order != null);
    const best = withCpo.length ? withCpo.reduce((a, b) => (a.cost_per_order <= b.cost_per_order ? a : b)) : null;
    const worst = withCpo.length ? withCpo.reduce((a, b) => (a.cost_per_order >= b.cost_per_order ? a : b)) : null;
    const totBudget = rows.reduce((s, r) => s + (Number(r.budget) || 0), 0);
    const totOrders = rows.reduce((s, r) => s + (Number(r.orders_gained) || 0), 0);
    res.json({
      campaigns: rows,
      summary: {
        count: rows.length,
        total_budget: round2(totBudget),
        total_orders: totOrders,
        avg_cost_per_order: totOrders > 0 ? round2(totBudget / totOrders) : null,
        best: best ? { id: best.id, name: best.name, cost_per_order: best.cost_per_order } : null,
        worst: worst && withCpo.length > 1 ? { id: worst.id, name: worst.name, cost_per_order: worst.cost_per_order } : null
      }
    });
  } catch (e) {
    console.error("marketing/campaigns:", e.message);
    res.status(500).json({ error: "تعذّر جلب أرشيف الحملات" });
  }
});

router.post("/campaigns/add", (req, res) => {
  try {
    const b = req.body || {};
    const name = S(b.name, 150);
    if (!name) return res.status(400).json({ error: "اسم الحملة مطلوب" });
    const budget = Number(b.budget);
    if (b.budget != null && b.budget !== "" && (!Number.isFinite(budget) || budget < 0)) {
      return res.status(400).json({ error: "الميزانية يجب أن تكون رقماً صفراً أو أكثر" });
    }
    const gained = parseInt(b.orders_gained, 10);
    if (b.orders_gained != null && b.orders_gained !== "" && (!Number.isFinite(gained) || gained < 0)) {
      return res.status(400).json({ error: "عدد الطلبات المكتسبة يجب أن يكون رقماً صفراً أو أكثر" });
    }
    const started = S(b.started_at, 10);
    const ended = S(b.ended_at, 10);
    if (started && !ISO_DAY.test(started)) return res.status(400).json({ error: "تاريخ البداية يجب أن يكون بصيغة YYYY-MM-DD" });
    if (ended && !ISO_DAY.test(ended)) return res.status(400).json({ error: "تاريخ النهاية يجب أن يكون بصيغة YYYY-MM-DD" });
    const r = retryDb(() => db.prepare(
      "INSERT INTO marketing_campaigns (name,product,budget,started_at,ended_at,orders_gained,notes,verdict) VALUES (?,?,?,?,?,?,?,?)"
    ).run(name, S(b.product, 150), Number.isFinite(budget) ? budget : 0, started, ended,
      Number.isFinite(gained) ? gained : 0, S(b.notes, 2000), S(b.verdict, 60)));
    res.json({ ok: true, id: Number(r.lastInsertRowid) });
  } catch (e) {
    console.error("marketing/campaigns/add:", e.message);
    res.status(500).json({ error: "تعذّر تسجيل الحملة" });
  }
});

router.post("/campaigns/update", (req, res) => {
  try {
    const b = req.body || {};
    const id = parseInt(b.id, 10);
    if (!id) return res.status(400).json({ error: "رقم الحملة مطلوب" });
    const cur = retryDb(() => db.prepare("SELECT * FROM marketing_campaigns WHERE id = ?").get(id));
    if (!cur) return res.status(400).json({ error: "الحملة غير موجودة" });
    const name = b.name != null ? S(b.name, 150) : cur.name;
    if (!name) return res.status(400).json({ error: "اسم الحملة لا يمكن أن يكون فارغاً" });
    let budget = cur.budget;
    if (b.budget != null && b.budget !== "") {
      budget = Number(b.budget);
      if (!Number.isFinite(budget) || budget < 0) return res.status(400).json({ error: "الميزانية يجب أن تكون رقماً صفراً أو أكثر" });
    }
    let gained = cur.orders_gained;
    if (b.orders_gained != null && b.orders_gained !== "") {
      gained = parseInt(b.orders_gained, 10);
      if (!Number.isFinite(gained) || gained < 0) return res.status(400).json({ error: "عدد الطلبات يجب أن يكون رقماً صفراً أو أكثر" });
    }
    const started = b.started_at != null ? S(b.started_at, 10) : cur.started_at;
    const ended = b.ended_at != null ? S(b.ended_at, 10) : cur.ended_at;
    if (started && !ISO_DAY.test(started)) return res.status(400).json({ error: "تاريخ البداية يجب أن يكون بصيغة YYYY-MM-DD" });
    if (ended && !ISO_DAY.test(ended)) return res.status(400).json({ error: "تاريخ النهاية يجب أن يكون بصيغة YYYY-MM-DD" });
    retryDb(() => db.prepare(
      "UPDATE marketing_campaigns SET name=?, product=?, budget=?, started_at=?, ended_at=?, orders_gained=?, notes=?, verdict=? WHERE id=?"
    ).run(name,
      b.product != null ? S(b.product, 150) : cur.product,
      budget, started, ended, gained,
      b.notes != null ? S(b.notes, 2000) : cur.notes,
      b.verdict != null ? S(b.verdict, 60) : cur.verdict,
      id));
    res.json({ ok: true });
  } catch (e) {
    console.error("marketing/campaigns/update:", e.message);
    res.status(500).json({ error: "تعذّر تعديل الحملة" });
  }
});

router.post("/campaigns/delete", (req, res) => {
  try {
    const id = parseInt(req.body && req.body.id, 10);
    if (!id) return res.status(400).json({ error: "رقم الحملة مطلوب" });
    const r = retryDb(() => db.prepare("DELETE FROM marketing_campaigns WHERE id = ?").run(id));
    if (!r.changes) return res.status(400).json({ error: "الحملة غير موجودة" });
    res.json({ ok: true });
  } catch (e) {
    console.error("marketing/campaigns/delete:", e.message);
    res.status(500).json({ error: "تعذّر حذف الحملة" });
  }
});

// ═══════════════════════════════════════════════════════════
// (10) مولد الهاشتاغات والكلمات الإعلانية (AI) — للسوق الأردني
// ═══════════════════════════════════════════════════════════
router.post("/hashtags", async (req, res) => {
  try {
    const product = S(req.body && req.body.product, 200);
    if (!product) return res.status(400).json({ error: "اكتب اسم المنتج أولاً" });
    const prompt =
      "أنت خبير إعلانات فيسبوك وانستغرام للسوق الأردني (أجبان وألبان بلدية تُباع عبر رسائل الصفحات).\n" +
      `المنتج: "${product}".\nالمطلوب — بثلاثة أقسام معنونة بوضوح:\n` +
      "1) 15 هاشتاغ عربي مناسب للسوق الأردني (منها هاشتاغات مناطق أردنية مثل #عمان #اربد #الزرقاء) كل هاشتاغ بجانب الآخر.\n" +
      "2) 5 هاشتاغات إنجليزية شائعة مناسبة.\n" +
      "3) 10 كلمات/عبارات إعلانية قصيرة بالعربي تصلح كعناوين إعلانات أو اهتمامات استهداف.\n" +
      "بدون أي مقدمات أو شرح إضافي.";
    const text = await askAI(prompt);
    if (!text) return res.status(500).json({ error: "تعذّر الاتصال بالذكاء" });
    res.json({ product, text });
  } catch (e) {
    console.error("marketing/hashtags:", e.message);
    res.status(500).json({ error: "تعذّر توليد الهاشتاغات" });
  }
});
