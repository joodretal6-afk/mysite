// ═══════════════════════════════════════════════════════════
// 📡 وحدة رادار السوق اليومي (radar)
//
// اللائحة اللي بتشوفها كل يوم: شو بيصعد، شو مثبت، شو بينطفي.
// وأهم شي — على أي إشارة انبنى كل حكم.
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import { db, retryDb } from "../db/database.js";
import {
  addTerm, watchlist, removeTerm, board, runDailyScan, scanTerm,
  saveSnapshot, logObservation, lastRun, runHistory, buildDigest, today
} from "../venture/radar.js";
import { adLibraryLinks } from "../venture/research.js";
import { research } from "../venture/research.js";
import { guessCategory, CATEGORIES } from "../venture/food.js";

export const slug = "radar";
export const title = "رادار السوق اليومي";
export const icon = "📡";

export const router = Router();

const ok = (res, p, basis) => res.json({ ...p, basis: basis || null, generated_at: Date.now() });
const bad = (res, m) => res.status(400).json({ error: m });
const boom = (res, e, m) => { console.error("radar:", e && e.message); res.status(500).json({ error: m || "فشل" }); };

// حالة الفحص الجاري (فحص واحد بالمرة — البحث بياخد وقت)
let running = null;

// ═══ اللوحة ═══
router.get("/board", (req, res) => {
  try {
    const days = Math.min(180, Math.max(7, parseInt(req.query.days, 10) || 30));
    const b = board(days);
    const run = lastRun();
    ok(res, {
      ...b, lastRun: run,
      running: running ? { ...running } : null,
      digest: run ? run.digest : buildDigest(b)
    }, {
      المصدر: "بحث ويب يومي + رصدك من مكتبة إعلانات ميتا",
      "🔴_مبيعات_فيسبوك": "فيسبوك ما بينشر مبيعات — ولا أداة بالدنيا عندها الرقم. " +
        "أقوى إشارة عامة هي مدة بقاء الإعلان: ولا معلن بيدفع 30 يوم على إعلان خسران.",
      العتبات: "14+ يوم مؤشر · 30+ يوم مثبت غالباً · 60+ يوم رابح قوي",
      قيد: "طول المدة دليل بقاء مش برهان ربح — إشارة مرجّحة لا أكثر",
      التراكم: b.maturity
    });
  } catch (e) { boom(res, e); }
});

// ═══ قائمة المراقبة ═══
router.get("/watch", (req, res) => {
  try {
    const rows = watchlist(false).map(w => ({
      ...w, categoryLabel: (CATEGORIES[w.category] || {}).label || "—",
      adLibrary: adLibraryLinks(w.term, w.cc)
    }));
    ok(res, { total: rows.length, rows });
  } catch (e) { boom(res, e); }
});

router.post("/watch", (req, res) => {
  try {
    const b = req.body || {};
    const terms = Array.isArray(b.terms) ? b.terms : [b.term];
    const added = [];
    for (const t of terms) {
      const s = String(t || "").trim();
      if (!s) continue;
      added.push(addTerm(s, b.country || "الأردن", b.cc || "JO", b.note || ""));
    }
    if (!added.length) return bad(res, "أدخل صنف واحد على الأقل");
    ok(res, { added: added.length, rows: added });
  } catch (e) { boom(res, e); }
});

router.delete("/watch/:id", (req, res) => {
  try { removeTerm(req.params.id); ok(res, { removed: true }); }
  catch (e) { boom(res, e); }
});

// ═══ رصد يدوي من مكتبة الإعلانات — هاد اللي بيكمّل الدرجة ═══
router.post("/observe/:id", (req, res) => {
  try {
    const b = req.body || {};
    const has = ["advertisers", "max_days", "variations"].some(k => b[k] != null && b[k] !== "");
    if (!has) return bad(res, "أدخل رقم واحد على الأقل: عدد المعلنين، أطول مدة، أو عدد النسخ");
    const scored = logObservation(req.params.id, {
      advertisers: b.advertisers === "" ? null : b.advertisers,
      max_days: b.max_days === "" ? null : b.max_days,
      variations: b.variations === "" ? null : b.variations
    }, String(b.day || today()));
    ok(res, { saved: true, score: scored.score, parts: scored.parts, note: scored.note }, {
      لماذا_يدوي: "مكتبة إعلانات ميتا بتتطلب متصفح — ما في وصول برمجي لها بالأردن. " +
                  "رصدك بعينك أدق من أي تقدير آلي.",
      كيف: "افتح رابط المكتبة، وشوف: كم معلن ظاهر، وأطول إعلان 'Active since' كم يوم، وكم نسخة."
    });
  } catch (e) { boom(res, e); }
});

// ═══ تشغيل الفحص يدوياً ═══
router.post("/scan", async (req, res) => {
  if (running) return res.status(409).json({ error: "في فحص شغّال حالياً", running });
  const list = watchlist(true);
  if (!list.length) return bad(res, "قائمة المراقبة فاضية — ضيف أصناف أول");

  running = { started: Date.now(), total: list.length, done: 0, term: "" };
  // بنرد فوراً — الفحص بياخد دقائق (بحث ويب حقيقي لكل صنف)
  res.json({ started: true, total: list.length,
             note: "الفحص شغّال بالخلفية. حدّث اللوحة بعد شوي." });
  try {
    await runDailyScan(p => { running = { ...running, done: p.done, term: p.term }; });
  } catch (e) { console.error("radar scan:", e.message); }
  finally { running = null; }
});

router.get("/scan/status", (req, res) => {
  ok(res, { running: running ? { ...running } : null, lastRun: lastRun() });
});

// فحص صنف واحد فوراً (سريع — للتجربة)
router.post("/scan/:id", async (req, res) => {
  try {
    const w = retryDb(() => db.prepare("SELECT * FROM radar_watch WHERE id=?").get(Number(req.params.id)));
    if (!w) return res.status(404).json({ error: "الصنف مش بقائمة المراقبة" });
    const snap = await scanTerm(w);
    const scored = saveSnapshot(snap);
    ok(res, { term: w.term, snapshot: snap, score: scored.score, parts: scored.parts, note: scored.note },
       { المصدر: `${(snap.signals.queries || []).length} عملية بحث ويب فعلية` });
  } catch (e) { boom(res, e, "فشل فحص الصنف"); }
});

// ═══ سجل التشغيل ═══
router.get("/runs", (req, res) => {
  try { ok(res, { rows: runHistory(parseInt(req.query.limit, 10) || 30) }); }
  catch (e) { boom(res, e); }
});

// ═══ تاريخ صنف واحد — السلسلة الزمنية ═══
router.get("/history/:id", (req, res) => {
  try {
    const w = retryDb(() => db.prepare("SELECT * FROM radar_watch WHERE id=?").get(Number(req.params.id)));
    if (!w) return res.status(404).json({ error: "غير موجود" });
    const rows = retryDb(() => db.prepare(
      "SELECT * FROM radar_snapshots WHERE watch_id=? ORDER BY day ASC LIMIT 400"
    ).all(w.id));
    ok(res, {
      term: w.term, rows, points: rows.length,
      adLibrary: adLibraryLinks(w.term, w.cc),
      confidence: rows.length >= 14 ? "عالية" : rows.length >= 5 ? "متوسطة" : "لا تكفي — بدها وقت"
    }, { ملاحظة: "السلسلة الزمنية بتصير مفيدة بعد أسبوعين على الأقل" });
  } catch (e) { boom(res, e); }
});

// ═══ 🔎 اكتشاف أصناف جديدة للمراقبة (بحث حقيقي) ═══
router.post("/discover", async (req, res) => {
  try {
    const b = req.body || {};
    const country = String(b.country || "الأردن");
    const niche = String(b.niche || "منتجات غذائية").trim();
    const existing = watchlist(false).map(w => w.term);

    const topic =
      `ابحث عن أصناف "${niche}" رائجة حالياً بالبيع أونلاين في ${country} ` +
      `(فيسبوك/إنستغرام، دفع عند الاستلام).\n` +
      `المطلوب: قائمة 10-15 صنف مرشّح للمراقبة، ولكل صنف سطر واحد: ليش مرشّح ومن أي مصدر.\n` +
      `تجنّب هالأصناف لأنها مراقبة أصلاً: ${existing.join("، ") || "لا يوجد"}.\n` +
      `🔴 لا تخترع أصناف من خيالك — كل صنف لازم يطلع من نتيجة بحث فعلية، واذكر الرابط.\n` +
      `وإذا ما لقيت بيانات كافية قول ذلك صراحة بدل ما تملأ القائمة.`;

    const r = await research(topic, null);
    if (!r.ok) return res.status(502).json({ error: r.error || "فشل البحث", steps: r.steps });
    ok(res, { niche, country, report: r.report, steps: r.steps }, {
      المصدر: `${(r.steps || []).length} عملية بحث فعلية`,
      "🔴": "المرشّحون اقتراحات للمراقبة مش توصيات شراء. ضيفهم للرادار وراقبهم قبل أي قرار."
    });
  } catch (e) { boom(res, e, "فشل الاكتشاف"); }
});

// ═══ دليل الاستخدام — الصراحة جزء من المنتج ═══
router.get("/guide", (req, res) => {
  ok(res, {
    الحقيقة: {
      عنوان: "فيسبوك ما بينشر مبيعات",
      شرح: "ولا رقم مبيعات لأي منتج على فيسبوك متاح لأي أداة — لا عنا ولا عند غيرنا. " +
           "أي منصة بتدّعي إنها بتعطيك 'الأكثر مبيعاً على فيسبوك' بتخمّن."
    },
    البديل_الحقيقي: {
      عنوان: "مدة بقاء الإعلان",
      شرح: "ولا معلن بيدفع فلوس 30 يوم على إعلان خسران. فمدة الإعلان أقوى إشارة مجانية على الربحية.",
      العتبات: [
        "14+ يوم → مؤشر مبدئي",
        "30+ يوم → مثبت غالباً — هون بتبدأ تاخده جدي",
        "60+ يوم → رابح قوي",
        "+ عدد النسخ الإعلانية → جدّية الاستثمار والتحسين"
      ],
      القيد: "طول المدة دليل بقاء مش برهان ربح. معلن كبير ممكن يتحمّل خسارة لأسباب تانية."
    },
    كيف_تشتغل: [
      "1. ضيف أصناف لقائمة المراقبة (أو استخدم الاكتشاف)",
      "2. الفحص اليومي بيشتغل تلقائياً وبيقيس الحضور الرقمي والأسعار",
      "3. مرة بالأسبوع: افتح رابط مكتبة الإعلانات لكل صنف، وسجّل عدد المعلنين وأطول مدة",
      "4. بعد أسبوعين بتبدأ تشوف الحركة الحقيقية — شو بيصعد وشو بينطفي"
    ],
    "🔴_توقّع_صحيح": "اليوم الأول بيعطيك صورة ثابتة، مش اتجاه. القيمة بتتراكم: " +
      "بعد 30 يوم بيصير عندك سلسلة زمنية ما بيملكها منافسك، لأنها انبنت عندك بالوقت.",
    لماذا_الرصد_يدوي: "مكتبة إعلانات ميتا بتتطلب متصفح، و API الرسمي بيغطي الإعلانات " +
      "السياسية عالمياً وكل الأنواع بأوروبا وبريطانيا بس — الأردن مش مغطّى برمجياً. " +
      "والاستخراج الآلي من فيسبوك مخالف لشروطه وبيوقّف صفحتك وحسابك الإعلاني."
  });
});
