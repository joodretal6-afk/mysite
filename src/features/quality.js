// ═══════════════════════════════════════════════════════════
// 🔬 وحدة التجارب والجودة (quality)
// 13) A/B Experiment Engine — محرك التجارب
// 14) Customer Journey Map — خريطة رحلة العميل
// 15) Sales Speed Engine — محرك سرعة البيع
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import { db, retryDb } from "../db/database.js";
import {
  since, round, pct, confidence, reply, fail, DAY_MS, CANCEL,
  conversations, scanConversation, replyDelayMin, customerStats
} from "../brain/core.js";
import { evaluateExperiment, recordOutcome, runLearningCycle, lessons, safeJson } from "../brain/learn.js";
import { inboxUrl } from "../brain/links.js";

export const slug = "quality";
export const title = "التجارب والجودة";
export const icon = "🔬";

export const router = Router();

// ═══════════════════════════════════════════════════════════
// 13) 🔬 A/B EXPERIMENT ENGINE
// ═══════════════════════════════════════════════════════════
router.get("/experiments", (req, res) => {
  try {
    const rows = retryDb(() => db.prepare(
      "SELECT * FROM brain_experiments ORDER BY created_at DESC LIMIT 100"
    ).all());
    const out = rows.map(e => {
      const ev = evaluateExperiment(e.id);
      return { ...e, arms: ev ? ev.arms : [], verdict: ev ? ev.verdict : "",
               significant: ev ? ev.significant : false, best: ev ? ev.best : null };
    });
    reply(res, { total: out.length, experiments: out }, {
      الطريقة: "اختبار z لنسبتين بثقة 95%",
      مبدأ: "ما بنعلن فائز إلا لما الفرق يتجاوز حدود الصدفة"
    });
  } catch (e) { fail(res, e, "فشل جلب التجارب"); }
});

router.get("/experiments/:id", (req, res) => {
  try {
    const ev = evaluateExperiment(parseInt(req.params.id, 10));
    if (!ev) return res.status(404).json({ error: "التجربة مش موجودة" });
    const events = retryDb(() => db.prepare(
      `SELECT event, value, context, created_at FROM brain_outcomes
       WHERE experiment_id = ? ORDER BY created_at DESC LIMIT 200`
    ).all(parseInt(req.params.id, 10))).map(r => ({ ...r, context: safeJson(r.context) }));
    reply(res, { ...ev, events }, ev.basis);
  } catch (e) { fail(res, e, "فشل جلب التجربة"); }
});

router.post("/experiments", (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    const variants = Array.isArray(b.variants) ? b.variants : [];
    if (!name) return res.status(400).json({ error: "أدخل اسم التجربة" });
    if (variants.length < 2) return res.status(400).json({ error: "لازم ذراعين على الأقل" });
    if (variants.length > 5) return res.status(400).json({ error: "5 أذرع كحد أقصى — أكثر من هيك بيحتاج عيّنة ضخمة" });

    const now = Date.now();
    const r = retryDb(() => db.prepare(
      `INSERT INTO brain_experiments (name, hypothesis, kind, target, metric, status, started_at, created_at)
       VALUES (?,?,?,?,?,'running',?,?)`
    ).run(name.slice(0, 200), String(b.hypothesis || "").slice(0, 500),
          String(b.kind || "offer"), String(b.target || "").slice(0, 120),
          String(b.metric || "conversion"), now, now));
    const expId = Number(r.lastInsertRowid);

    variants.forEach((v, i) => {
      retryDb(() => db.prepare(
        `INSERT INTO brain_variants (experiment_id, label, description, config, created_at)
         VALUES (?,?,?,?,?)`
      ).run(expId, String(v.label || String.fromCharCode(65 + i)).slice(0, 10),
            String(v.description || "").slice(0, 300),
            JSON.stringify(v.config || {}), now));
    });

    const created = evaluateExperiment(expId);
    res.json({ ok: true, id: expId, experiment: created,
               note: "التجربة شغّالة. سجّل كل مشاهدة وكل تحويل عشان نقدر نحكم." });
  } catch (e) { fail(res, e, "فشل إنشاء التجربة"); }
});

// تسجيل مشاهدة/تحويل — هون بتدخل النتائج الحقيقية
router.post("/experiments/:id/record", (req, res) => {
  try {
    const expId = parseInt(req.params.id, 10);
    const b = req.body || {};
    const event = String(b.event || "");
    if (!["exposure", "conversion", "rejection"].includes(event))
      return res.status(400).json({ error: "الحدث لازم يكون exposure أو conversion أو rejection" });
    const variantId = parseInt(b.variant_id, 10);
    const v = retryDb(() => db.prepare(
      "SELECT id FROM brain_variants WHERE id = ? AND experiment_id = ?"
    ).get(variantId, expId));
    if (!v) return res.status(400).json({ error: "الذراع مش تابعة لهاي التجربة" });

    recordOutcome({ experiment_id: expId, variant_id: variantId, sender_id: b.sender_id,
                    event, value: b.value, profit: b.profit, context: b.context });
    res.json({ ok: true, evaluation: evaluateExperiment(expId) });
  } catch (e) { fail(res, e, "فشل تسجيل النتيجة"); }
});

router.post("/experiments/:id/stop", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ev = evaluateExperiment(id);
    retryDb(() => db.prepare(
      "UPDATE brain_experiments SET status='done', ended_at=?, winner=?, conclusion=? WHERE id=?"
    ).run(Date.now(), (ev && ev.best) || "", (ev && ev.verdict) || "", id));
    res.json({ ok: true, evaluation: ev });
  } catch (e) { fail(res, e, "فشل إيقاف التجربة"); }
});

// ── الدروس المتراكمة + تشغيل دورة التعلّم ──
router.get("/lessons", (req, res) => {
  try {
    const rows = lessons(req.query.scope ? String(req.query.scope) : null);
    reply(res, { total: rows.length, lessons: rows }, {
      المصدر: "تجاربك المحسومة + أنماط طلباتك المتكررة",
      قيمة: "هاي معرفة خاصة بعملك إنت — بتتراكم مع الوقت وما بينقلها منافس"
    });
  } catch (e) { fail(res, e, "فشل جلب الدروس"); }
});

router.post("/learn", (req, res) => {
  try {
    const learned = runLearningCycle();
    res.json({ ok: true, learned: learned.length, lessons: learned });
  } catch (e) { fail(res, e, "فشل تشغيل دورة التعلّم"); }
});

// ═══════════════════════════════════════════════════════════
// 14) 🗺️ CUSTOMER JOURNEY MAP — وين بيسقطوا بالضبط
//
// مش قمع عام. هاد بيمشي مع المحادثة خطوة خطوة ويحدّد
// آخر مرحلة وصلها كل زبون قبل ما يختفي.
// ═══════════════════════════════════════════════════════════
const STEPS = [
  { key: "وصل",           test: cv => cv.inCount > 0 },
  { key: "تفاعل",         test: cv => cv.inCount >= 2 },
  { key: "سأل عن المنتج", test: (cv, s) => s.reasons.some(r => r.label === "مهتم" || r.label === "جاهز للشراء") },
  { key: "سأل عن السعر",  test: cv => /سعر|بكم|قديش|كم ثمن/.test(joinIn(cv)) },
  { key: "سأل عن التوصيل",test: cv => /توصيل|شحن|بتوصلو|متى بيوصل|كم بيوصل/.test(joinIn(cv)) },
  { key: "أعطى بيانات",   test: cv => /\b07\d{8}\b|\b\d{9,10}\b/.test(joinIn(cv)) },
  { key: "طلب",           test: (cv, s, bought) => bought }
];
function joinIn(cv) {
  return (cv.msgs || []).filter(m => m.dir === "in").map(m => m.body || "").join(" ");
}

router.get("/journey", (req, res) => {
  try {
    const { days, from } = since(req, 30);
    const convs = conversations(from);
    const buyers = new Set(retryDb(() => db.prepare(
      `SELECT DISTINCT sender_id FROM orders WHERE created_at >= ? AND status <> ?`
    ).all(from, CANCEL)).map(r => r.sender_id));

    const counts = STEPS.map(s => ({ step: s.key, n: 0 }));
    const dropExamples = STEPS.map(() => []);

    for (const cv of convs) {
      const scan = scanConversation(cv);
      const bought = buyers.has(cv.sender_id);
      let reached = -1;
      for (let i = 0; i < STEPS.length; i++) {
        if (STEPS[i].test(cv, scan, bought)) { counts[i].n++; reached = i; }
      }
      // آخر خطوة وصلها ثم توقف = نقطة سقوطه
      if (reached >= 0 && reached < STEPS.length - 1 && dropExamples[reached].length < 6) {
        dropExamples[reached].push({
          sender_id: cv.sender_id, page_name: cv.page_name,
          intent: scan.intent, messages: cv.inCount,
          lastMessage: String((cv.msgs.filter(m => m.dir === "in").slice(-1)[0] || {}).body || "").slice(0, 120),
          objections: scan.objections.map(o => o.label),
          url: inboxUrl(cv.page_id, cv.sender_id)
        });
      }
    }

    const total = convs.length;
    const steps = counts.map((c, i) => {
      const prev = i === 0 ? total : counts[i - 1].n;
      const dropped = Math.max(0, prev - c.n);
      return {
        step: c.step, reached: c.n,
        ofTotal: pct(c.n, total),
        stepConversion: prev ? pct(c.n, prev) : 0,
        dropped, dropRate: prev ? pct(dropped, prev) : 0,
        examples: dropExamples[i]
      };
    });

    // أسوأ تسريب — هون بتحط جهدك
    const leaks = steps.slice(1).filter(s => s.dropped > 0)
      .sort((a, b) => b.dropped - a.dropped);
    const worst = leaks[0];

    reply(res, {
      days, total, steps, leaks: leaks.slice(0, 3),
      confidence: confidence(total, { low: 40, mid: 150 }),
      headline: worst
        ? `أكبر تسريب عند "${worst.step}": ${worst.dropped} زبون (${worst.dropRate}%) وصلوا لهون ووقفوا`
        : "ما في تسريب واضح"
    }, {
      المصدر: `${total} محادثة`,
      الطريقة: "تتبّع كل محادثة عبر 7 خطوات وتحديد آخر خطوة وصلها",
      قيد: "الخطوات مستنتجة من نص المحادثة — ممكن تفوت صياغات غير متوقّعة"
    });
  } catch (e) { fail(res, e, "فشل رسم رحلة العميل"); }
});

// ═══════════════════════════════════════════════════════════
// 15) ⚡ SALES SPEED ENGINE — سرعة الرد
//
// هاي غالباً أرخص زيادة مبيعات ممكن يعملها التاجر:
// ما بتحتاج إعلان ولا خصم ولا منتج جديد — بس ترد أسرع.
// ═══════════════════════════════════════════════════════════
const BUCKETS = [
  { key: "أقل من دقيقتين", max: 2 },
  { key: "2–10 دقائق",     max: 10 },
  { key: "10–30 دقيقة",    max: 30 },
  { key: "30–60 دقيقة",    max: 60 },
  { key: "1–4 ساعات",      max: 240 },
  { key: "أكثر من 4 ساعات",max: Infinity }
];

router.get("/speed", (req, res) => {
  try {
    const { days, from } = since(req, 30);
    const convs = conversations(from);
    const buyers = new Set(retryDb(() => db.prepare(
      `SELECT DISTINCT sender_id FROM orders WHERE created_at >= ? AND status <> ?`
    ).all(from, CANCEL)).map(r => r.sender_id));

    const rows = BUCKETS.map(b => ({ bucket: b.key, n: 0, bought: 0 }));
    let noReply = { n: 0, bought: 0 };
    const delays = [];

    for (const cv of convs) {
      const d = replyDelayMin(cv);
      const bought = buyers.has(cv.sender_id);
      if (d == null) {
        if (cv.inCount > 0) { noReply.n++; if (bought) noReply.bought++; }
        continue;
      }
      delays.push(d);
      const idx = BUCKETS.findIndex(b => d <= b.max);
      const r = rows[idx < 0 ? rows.length - 1 : idx];
      r.n++; if (bought) r.bought++;
    }

    rows.forEach(r => { r.conversion = pct(r.bought, r.n); });
    const withData = rows.filter(r => r.n >= 5);
    const fast = withData[0], slow = withData[withData.length - 1];

    delays.sort((a, b) => a - b);
    const median = delays.length ? round(delays[Math.floor(delays.length / 2)], 1) : null;
    const p90 = delays.length ? round(delays[Math.floor(delays.length * 0.9)], 1) : null;

    // كلفة التأخير — بلغة الفلوس مش النسب
    const biz = retryDb(() => db.prepare(
      `SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM orders WHERE created_at >= ? AND status <> ?`
    ).get(from, CANCEL));
    const aov = Number(biz && biz.n) ? round(Number(biz.s) / Number(biz.n)) : 0;

    let costOfDelay = null, insight = "";
    if (fast && slow && fast !== slow && fast.conversion > slow.conversion) {
      const gap = fast.conversion - slow.conversion;
      const slowConvs = rows.filter(r => BUCKETS.findIndex(b => b.key === r.bucket) >= 3)
        .reduce((s, r) => s + r.n, 0);
      costOfDelay = round(slowConvs * (gap / 100) * aov);
      insight = `اللي رديت عليهم "${fast.bucket}" حوّلوا ${fast.conversion}%، ` +
                `واللي رديت عليهم "${slow.bucket}" حوّلوا ${slow.conversion}%. ` +
                `الفرق ${round(gap, 1)} نقطة. لو رديت على كل المتأخرين بنفس السرعة، ` +
                `التقدير إنك كنت تكسب ${costOfDelay} إضافي.`;
    }

    if (noReply.n > 0) {
      insight += (insight ? " " : "") +
        `🔴 وفي ${noReply.n} محادثة ما إجاها رد أبداً — هاي أوضح خسارة بالنظام كله.`;
    }

    reply(res, {
      days, rows, noReply, median, p90, aov, costOfDelay,
      totalConversations: convs.length,
      confidence: confidence(delays.length, { low: 40, mid: 150 }),
      insight: insight || "ما في بيانات كافية لربط السرعة بالتحويل",
      alerts: [
        median != null && median > 15 ? `⚠️ وسيط الرد ${median} دقيقة — بطيء` : null,
        p90 != null && p90 > 120 ? `⚠️ 10% من المحادثات بتستنى أكثر من ${p90} دقيقة` : null,
        noReply.n > convs.length * 0.1 ? `🔴 ${pct(noReply.n, convs.length)}% من المحادثات بلا رد نهائياً` : null
      ].filter(Boolean)
    }, {
      المصدر: `${convs.length} محادثة، ${delays.length} منها فيها رد`,
      القياس: "الوقت بين أول رسالة من الزبون وأول رد من الصفحة",
      "🔴_تحذير": "الارتباط مش سببية. الناس المستعجلة بتشتري أسرع وبنفس الوقت بتلاقي رد أسرع — " +
                "بس فجوة التحويل كبيرة لدرجة إنها تستاهل تجربة فعلية"
    });
  } catch (e) { fail(res, e, "فشل تحليل سرعة الرد"); }
});
