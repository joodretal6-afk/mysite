// ═══════════════════════════════════════════════════════════
// 🔄 حلقة التعلّم (brain/learn)
// هاي اللي بتفرّق بين "لوحة أرقام" وبين نظام بيتحسّن.
// الدورة: يلاحظ → يحلل → يقترح → يختبر → يقيس → يتعلم → يحسّن.
//
// المبدأ اللي ماشيين عليه: النظام ما بيدّعي إنه تعلّم إشي
// إلا لما تكون العيّنة كافية. قبل هيك بيقول "لسه بنجمع".
// ═══════════════════════════════════════════════════════════
import { db, retryDb } from "../db/database.js";
import { round, pct, confidence, DAY_MS } from "./core.js";

try {
  // ── تجربة: سؤال تجاري له إجابة قابلة للقياس ──
  db.exec(`CREATE TABLE IF NOT EXISTS brain_experiments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    hypothesis  TEXT DEFAULT '',
    kind        TEXT DEFAULT 'offer',     -- offer / price / copy / speed / bundle
    target      TEXT DEFAULT '',          -- المنتج أو الشريحة
    metric      TEXT DEFAULT 'conversion',-- conversion / revenue / profit / aov
    status      TEXT DEFAULT 'draft',     -- draft / running / done / abandoned
    started_at  INTEGER,
    ended_at    INTEGER,
    winner      TEXT DEFAULT '',
    conclusion  TEXT DEFAULT '',
    created_at  INTEGER NOT NULL
  )`);

  // ── ذراع من التجربة ──
  db.exec(`CREATE TABLE IF NOT EXISTS brain_variants (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    experiment_id INTEGER NOT NULL,
    label         TEXT NOT NULL,          -- A / B / C
    description   TEXT DEFAULT '',
    config        TEXT DEFAULT '{}',      -- JSON: السعر، العرض، النسخة...
    exposures     INTEGER DEFAULT 0,      -- كم واحد شافها
    conversions   INTEGER DEFAULT 0,      -- كم واحد طلب
    revenue       REAL DEFAULT 0,
    profit        REAL DEFAULT 0,
    created_at    INTEGER NOT NULL
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS brain_variants_exp ON brain_variants(experiment_id)`);

  // ── نتيجة مقاسة: الوقود الحقيقي للتعلّم ──
  db.exec(`CREATE TABLE IF NOT EXISTS brain_outcomes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    experiment_id INTEGER,
    variant_id    INTEGER,
    sender_id     TEXT DEFAULT '',
    event         TEXT NOT NULL,          -- exposure / conversion / rejection
    value         REAL DEFAULT 0,
    context       TEXT DEFAULT '{}',      -- JSON: الشريحة، المنتج، الاعتراض...
    created_at    INTEGER NOT NULL
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS brain_outcomes_exp ON brain_outcomes(experiment_id, created_at)`);

  // ── قرار اقترحه النظام: بنسجّله عشان نحاسب حالنا لاحقاً ──
  db.exec(`CREATE TABLE IF NOT EXISTS brain_decisions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    engine      TEXT NOT NULL,            -- أي محرك اقترح
    title       TEXT NOT NULL,
    detail      TEXT DEFAULT '',
    basis       TEXT DEFAULT '{}',        -- JSON: الأرقام اللي بنى عليها
    confidence  TEXT DEFAULT '',
    status      TEXT DEFAULT 'proposed',  -- proposed / accepted / rejected / executed
    result      TEXT DEFAULT '',          -- شو صار فعلياً بعدها
    created_at  INTEGER NOT NULL,
    acted_at    INTEGER
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS brain_decisions_when ON brain_decisions(created_at)`);

  // ── معرفة متراكمة: "هاد اشتغل مع هاي الشريحة بهاي الظروف" ──
  db.exec(`CREATE TABLE IF NOT EXISTS brain_lessons (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    scope       TEXT NOT NULL,            -- product:X / segment:Y / global
    lesson      TEXT NOT NULL,
    evidence    TEXT DEFAULT '{}',
    samples     INTEGER DEFAULT 0,
    strength    REAL DEFAULT 0,           -- -1..1
    updated_at  INTEGER NOT NULL
  )`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS brain_lessons_key ON brain_lessons(scope, lesson)`);
} catch (e) { console.error("brain/learn schema:", e.message); }

// ═══════════════════════════════════════════════════════════
// تسجيل القرارات — النظام بيحاسب حاله
// ═══════════════════════════════════════════════════════════
export function recordDecision(engine, title, detail, basis, conf) {
  try {
    const r = retryDb(() => db.prepare(
      `INSERT INTO brain_decisions (engine, title, detail, basis, confidence, created_at)
       VALUES (?,?,?,?,?,?)`
    ).run(String(engine), String(title).slice(0, 300), String(detail || "").slice(0, 2000),
          JSON.stringify(basis || {}), String((conf && conf.level) || conf || ""), Date.now()));
    return Number(r && r.lastInsertRowid) || null;
  } catch (e) { console.error("recordDecision:", e.message); return null; }
}

export function recordOutcome(o) {
  try {
    retryDb(() => db.prepare(
      `INSERT INTO brain_outcomes (experiment_id, variant_id, sender_id, event, value, context, created_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(o.experiment_id || null, o.variant_id || null, String(o.sender_id || ""),
          String(o.event), Number(o.value) || 0, JSON.stringify(o.context || {}), Date.now()));
    if (o.variant_id) {
      const col = o.event === "conversion" ? "conversions" : o.event === "exposure" ? "exposures" : null;
      if (col) retryDb(() => db.prepare(
        `UPDATE brain_variants SET ${col} = ${col} + 1,
         revenue = revenue + ?, profit = profit + ? WHERE id = ?`
      ).run(o.event === "conversion" ? Number(o.value) || 0 : 0,
            o.event === "conversion" ? Number(o.profit) || 0 : 0, o.variant_id));
    }
    return true;
  } catch (e) { console.error("recordOutcome:", e.message); return false; }
}

// ═══════════════════════════════════════════════════════════
// 📊 تقييم تجربة — مقارنة إحصائية مش انطباع
//
// بنستخدم اختبار نسبتين (two-proportion z-test). مهم جداً:
// فرق 6.8% مقابل 4.2% ممكن يكون صدفة لو العيّنة صغيرة،
// وأسوأ إشي ممكن نعمله إننا نخلّي التاجر يغيّر استراتيجيته بناءً على ضجيج.
// ═══════════════════════════════════════════════════════════
export function evaluateExperiment(experimentId) {
  const exp = retryDb(() => db.prepare("SELECT * FROM brain_experiments WHERE id = ?").get(experimentId));
  if (!exp) return null;
  const variants = retryDb(() => db.prepare(
    "SELECT * FROM brain_variants WHERE experiment_id = ? ORDER BY label ASC"
  ).all(experimentId));

  const arms = variants.map(v => {
    const n = Number(v.exposures) || 0, c = Number(v.conversions) || 0;
    return {
      id: v.id, label: v.label, description: v.description,
      exposures: n, conversions: c,
      rate: n ? round(c * 100 / n, 2) : 0,
      revenue: round(v.revenue), profit: round(v.profit),
      revPerExposure: n ? round(Number(v.revenue) / n, 2) : 0
    };
  });

  if (arms.length < 2) {
    return { experiment: exp, arms, verdict: "تحتاج ذراعين على الأقل للمقارنة", significant: false };
  }

  // نقارن أفضل ذراع مع اللي بعده
  const sorted = [...arms].sort((a, b) => b.rate - a.rate);
  const [best, second] = sorted;
  const n1 = best.exposures, n2 = second.exposures;
  const x1 = best.conversions, x2 = second.conversions;

  let z = 0, significant = false, pooled = 0, underpowered = true;
  if (n1 >= 1 && n2 >= 1) {
    pooled = (x1 + x2) / (n1 + n2);
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
    if (se > 0) {
      z = ((x1 / n1) - (x2 / n2)) / se;
      // 🔴 اختبار z ما بيصحّ على عيّنة صغيرة. بلا حد أدنى كان النظام
      // بيعلن فائزاً من 10 مشاهدات و3 تحويلات — والتاجر بيغيّر
      // استراتيجيته بناءً على ضجيج. الشروط المتعارف عليها:
      // 30 مشاهدة لكل ذراع، و5 نجاحات و5 إخفاقات على الأقل بكل ذراع.
      const enough = n1 >= 30 && n2 >= 30 &&
        x1 >= 5 && (n1 - x1) >= 5 && x2 >= 5 && (n2 - x2) >= 5;
      underpowered = !enough;
      significant = enough && Math.abs(z) >= 1.96;   // ثقة 95%
    }
  }

  const totalN = n1 + n2;
  const conf = confidence(totalN, { low: 60, mid: 200 });
  const lift = second.rate ? round((best.rate - second.rate) * 100 / second.rate, 1) : null;

  let verdict;
  if (totalN < 40) {
    verdict = `لسه بدري. ${totalN} مشاهدة فقط — استنى توصل 100 على الأقل قبل ما تقرر.`;
  } else if (underpowered) {
    verdict = `الأرقام لسه تحت الحد الأدنى للحكم (${n1} مقابل ${n2} مشاهدة). ` +
              `بدنا 30 مشاهدة و5 تحويلات لكل ذراع على الأقل — كمّل التجربة.`;
  } else if (significant) {
    verdict = `${best.label} أفضل فعلياً — الفرق مش صدفة (ثقة 95%).` +
              (lift != null ? ` تحسّن ${lift}% عن ${second.label}.` : "");
  } else {
    verdict = `الفرق بين ${best.label} و${second.label} ما زال ضمن الصدفة. ` +
              `الأرقام بتميل لـ${best.label} بس ما بتثبتها — كمّل التجربة.`;
  }

  return {
    experiment: exp, arms,
    best: significant ? best.label : null,
    underpowered,
    lift, z: round(z, 2), significant, confidence: conf, verdict,
    basis: {
      طريقة: "اختبار z لنسبتين، عتبة 95%",
      العيّنة: `${n1} مقابل ${n2} مشاهدة`,
      التحويل: `${best.rate}% مقابل ${second.rate}%`
    }
  };
}

// ── حفظ درس متعلَّم ──
export function learn(scope, lesson, evidence, samples, strength) {
  try {
    retryDb(() => db.prepare(
      `INSERT INTO brain_lessons (scope, lesson, evidence, samples, strength, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(scope, lesson) DO UPDATE SET
         evidence = excluded.evidence, samples = excluded.samples,
         strength = excluded.strength, updated_at = excluded.updated_at`
    ).run(String(scope), String(lesson).slice(0, 300), JSON.stringify(evidence || {}),
          Number(samples) || 0, Math.max(-1, Math.min(1, Number(strength) || 0)), Date.now()));
    return true;
  } catch (e) { console.error("learn:", e.message); return false; }
}

export function lessons(scope) {
  try {
    const sql = scope
      ? "SELECT * FROM brain_lessons WHERE scope = ? ORDER BY ABS(strength) DESC, samples DESC LIMIT 100"
      : "SELECT * FROM brain_lessons ORDER BY ABS(strength) DESC, samples DESC LIMIT 100";
    const rows = scope ? retryDb(() => db.prepare(sql).all(scope)) : retryDb(() => db.prepare(sql).all());
    return rows.map(r => ({ ...r, evidence: safeJson(r.evidence) }));
  } catch { return []; }
}

export function safeJson(s) { try { return JSON.parse(s || "{}"); } catch { return {}; } }

// ═══════════════════════════════════════════════════════════
// 🎓 دورة التعلّم الليلية — بتحوّل النتائج الخام لدروس
// بتشتغل على كل التجارب المنتهية + أنماط الطلبات الفعلية.
// ═══════════════════════════════════════════════════════════
export function runLearningCycle() {
  const learned = [];
  try {
    // 1) دروس من التجارب المحسومة
    const done = retryDb(() => db.prepare(
      "SELECT id, name, target, kind FROM brain_experiments WHERE status IN ('running','done')"
    ).all());
    for (const e of done) {
      const ev = evaluateExperiment(e.id);
      if (!ev || !ev.significant || !ev.best) continue;
      const arm = ev.arms.find(a => a.label === ev.best);
      const scope = e.target ? `product:${e.target}` : "global";
      const text = `${e.kind === "price" ? "تسعير" : e.kind === "copy" ? "نسخة بيعية" : "عرض"}: ` +
                   `"${arm.description || arm.label}" حقق تحويل ${arm.rate}% — أعلى من البدائل`;
      learn(scope, text, ev.basis, arm.exposures, Math.min(1, (ev.lift || 0) / 100));
      learned.push({ scope, lesson: text });
      // التجربة صارت محسومة — نقفلها بدل ما تضل تستهلك انتباه
      retryDb(() => db.prepare(
        "UPDATE brain_experiments SET status='done', ended_at=?, winner=?, conclusion=? WHERE id=? AND status='running'"
      ).run(Date.now(), ev.best, ev.verdict, e.id));
    }

    // 2) درس من الواقع: أي منتج بيتكرر شراؤه فعلياً
    const repeat = retryDb(() => db.prepare(
      `SELECT order_string, COUNT(*) n, COUNT(DISTINCT sender_id) buyers
       FROM orders WHERE created_at >= ? AND status <> 'ملغي'
       GROUP BY order_string HAVING buyers >= 5 ORDER BY n DESC LIMIT 20`
    ).all(Date.now() - 120 * DAY_MS));
    for (const r of repeat) {
      const ratio = r.buyers ? r.n / r.buyers : 0;
      if (ratio >= 1.5) {
        const text = `"${String(r.order_string).slice(0, 60)}" بيتكرر شراؤه — ${round(ratio, 2)} طلب لكل زبون`;
        learn("global", text, { طلبات: r.n, زبائن: r.buyers }, r.n, Math.min(1, (ratio - 1) / 2));
        learned.push({ scope: "global", lesson: text });
      }
    }
  } catch (e) { console.error("runLearningCycle:", e.message); }
  return learned;
}
