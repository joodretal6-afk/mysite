// ═══════════════════════════════════════════════════════════
// 👑 المدير التنفيذي للمبيعات + مركز القيادة (chief)
// 20) AI Chief Sales Officer
//
// هاي الوحدة ما بتحسب إشي جديد. بتجمع مخرجات كل المحركات
// وبترتّبها بقرار واحد: شو أهم إشي تعمله اليوم.
// السبب: التاجر ما بيقرأ 20 لوحة. بيقرأ سطر واحد وبينفّذ.
//
// وكل بند لازم يجاوب على 3 أسئلة:
//   شو؟  ليش (بالأرقام)؟  قديش نثق فيه؟
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import { db, retryDb } from "../db/database.js";
import {
  since, round, pct, confidence, reply, fail, DAY_MS, CANCEL,
  productStats, customerStats, conversations, scanConversation,
  replyDelayMin, costMap
} from "../brain/core.js";
import { recordDecision, lessons, runLearningCycle, safeJson } from "../brain/learn.js";

export const slug = "chief";
export const title = "مركز القيادة";
export const icon = "👑";

export const router = Router();

// ═══════════════════════════════════════════════════════════
// 🧠 COMMAND CENTER — الشاشة الواحدة
// ═══════════════════════════════════════════════════════════
router.get("/command", (req, res) => {
  try {
    const days = Math.min(90, Math.max(7, parseInt(req.query.days, 10) || 30));
    const now = Date.now();
    const from = now - days * DAY_MS;
    const prevFrom = now - 2 * days * DAY_MS;

    // ── 💰 كم بعنا؟ ──
    const cur = retryDb(() => db.prepare(
      `SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM orders WHERE created_at >= ? AND status <> ?`
    ).get(from, CANCEL));
    const prev = retryDb(() => db.prepare(
      `SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM orders
       WHERE created_at >= ? AND created_at < ? AND status <> ?`
    ).get(prevFrom, from, CANCEL));

    const sales = round(Number(cur.s) || 0);
    const prevSales = round(Number(prev.s) || 0);
    const salesChange = prevSales ? pct(sales - prevSales, prevSales) : null;
    const ordersN = Number(cur.n) || 0;
    const aov = ordersN ? round(sales / ordersN) : 0;

    const stats = productStats(from);
    const profit = round(stats.reduce((s, p) => s + p.profit, 0));
    const costsKnown = stats.filter(p => p.hasCost).length;

    // ── 📈 ليش؟ ──
    const why = [];
    if (salesChange != null) {
      const prevStats = productStats(prevFrom);
      const movers = stats.map(s => {
        const p = prevStats.find(x => x.product === s.product);
        const prevRev = p ? Math.max(0, p.revenue - s.revenue) : 0;
        return { product: s.product, delta: round(s.revenue - prevRev), now: s.revenue, before: round(prevRev) };
      }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3);
      for (const m of movers)
        if (Math.abs(m.delta) > 1)
          why.push({
            factor: m.product,
            effect: m.delta > 0 ? `+${m.delta}` : String(m.delta),
            note: `${m.before} ← ${m.now}`
          });
    }

    // ── 🔴 أين نخسر؟ ──
    const convs = conversations(from);
    const buyers = new Set(retryDb(() => db.prepare(
      `SELECT DISTINCT sender_id FROM orders WHERE created_at >= ? AND status <> ?`
    ).all(from, CANCEL)).map(r => r.sender_id));

    const losses = [];
    let lostConvs = 0, lostValue = 0, noReplyN = 0;
    const objAgg = new Map();
    for (const cv of convs) {
      const scan = scanConversation(cv);
      const bought = buyers.has(cv.sender_id);
      if (replyDelayMin(cv) === null && cv.inCount > 0 && !bought) noReplyN++;
      if (!bought && scan.intent >= 30) {
        lostConvs++;
        lostValue += aov * (scan.intent / 100);
        for (const o of scan.objections) objAgg.set(o.label, (objAgg.get(o.label) || 0) + 1);
      }
    }
    lostValue = round(lostValue);
    const topObj = [...objAgg.entries()].sort((a, b) => b[1] - a[1]);

    if (lostConvs) losses.push({
      what: `${lostConvs} محادثة ما صارت طلب`,
      value: lostValue,
      why: topObj.length ? `أكبر سبب: ${topObj[0][0]} (${topObj[0][1]} مرة)` : "السبب غير محدد",
      confidence: confidence(lostConvs)
    });
    if (noReplyN) losses.push({
      what: `${noReplyN} محادثة ما إجاها رد أبداً`,
      value: round(noReplyN * aov * 0.3),
      why: "زبون بيراسلك وما بتردّ عليه — أوضح خسارة ممكنة",
      confidence: confidence(noReplyN)
    });
    const cancelled = retryDb(() => db.prepare(
      `SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM orders WHERE created_at >= ? AND status = ?`
    ).get(from, CANCEL));
    if (Number(cancelled.n) > 0) losses.push({
      what: `${cancelled.n} طلب ملغي`,
      value: round(Number(cancelled.s)),
      why: "طلبات وصلت لآخر خطوة وانهارت — أغلى نوع خسارة",
      confidence: confidence(Number(cancelled.n))
    });
    losses.sort((a, b) => b.value - a.value);

    // ── 🟢 أين الفرصة؟ ──
    const opps = [];
    const win = Math.min(14, days);
    const recentStats = productStats(now - win * DAY_MS);
    for (const s of recentStats) {
      if (s.askers >= 8 && s.askToOrder != null && s.askToOrder < 15) {
        opps.push({
          what: `${s.product}: ${s.askers} سأل، ${s.askToOrder}% اشترى`,
          why: "اهتمام عالي وتحويل ضعيف — الطلب موجود وإنت مش ماسكه",
          value: round(s.askers * 0.25 * aov),
          action: "افحص السعر والتوفر وسرعة الرد على هاد المنتج",
          confidence: confidence(s.askers, { low: 12, mid: 40 })
        });
      }
    }
    const highIntent = convs.filter(cv => !buyers.has(cv.sender_id) && scanConversation(cv).intent >= 70);
    if (highIntent.length) opps.push({
      what: `${highIntent.length} محادثة نيّتها عالية وما طلبت`,
      why: "هدول أقرب ناس للشراء بكل قاعدتك",
      value: round(highIntent.length * aov * 0.5),
      action: "راجعهم يدوياً — اللي راسلك خلال 24 ساعة بتقدر ترد عليه",
      confidence: confidence(highIntent.length)
    });
    opps.sort((a, b) => b.value - a.value);

    // ── 🎯 من هم أفضل العملاء؟ ──
    const customers = customerStats(from);
    const withOrders = customers.filter(c => c.orders > 0).sort((a, b) => b.spend - a.spend);
    const top10 = withOrders.slice(0, Math.max(1, Math.ceil(withOrders.length * 0.1)));
    const topShare = pct(top10.reduce((s, c) => s + c.spend, 0), withOrders.reduce((s, c) => s + c.spend, 0));

    // ── 🏆 أي منتج ندفعه؟ ──
    const push = stats.filter(s => s.orders > 0 && s.hasCost)
      .map(s => ({ ...s, pushScore: s.profit * (s.askToOrder != null ? s.askToOrder / 100 : 0.2) }))
      .sort((a, b) => b.pushScore - a.pushScore)[0] || null;

    // ── 💵 أي سعر نختبر؟ ──
    const costs = costMap();
    const priceTest = stats.filter(s => s.hasCost && s.orders >= 5 && s.askers >= 8)
      .map(s => {
        const unit = s.qty ? round(s.revenue / s.qty) : 0;
        const c = costs.get(s.product) || 0;
        const margin = unit ? pct(unit - c, unit) : 0;
        if (s.askToOrder != null && s.askToOrder >= 35 && margin >= 25)
          return { product: s.product, current: unit, test: round(unit * 1.1), dir: "ارفع",
                   why: `تحويل ${s.askToOrder}% وهامش ${margin}% — السعر مش عائق` };
        if (s.askToOrder != null && s.askToOrder < 12)
          return { product: s.product, current: unit, test: round(Math.max(c * 1.1, unit * 0.92)), dir: "نزّل",
                   why: `تحويل ${s.askToOrder}% ضعيف رغم ${s.askers} استفسار` };
        return null;
      }).filter(Boolean)[0] || null;

    // ── ⚡ شو نعمل هلأ؟ ──
    const actions = [];
    if (noReplyN > 0) actions.push({
      priority: 1, action: `رد على الـ${noReplyN} محادثة اللي بلا رد`,
      why: "ما بتكلف ولا قرش وأثرها فوري",
      confidence: confidence(noReplyN)
    });
    if (losses.length && losses[0].value > 0) actions.push({
      priority: 2, action: topObj.length ? `عالج اعتراض "${topObj[0][0]}" بشكل مباشر` : "افحص أسباب عدم التحويل",
      why: losses[0].why, confidence: losses[0].confidence
    });
    if (opps.length) actions.push({
      priority: 3, action: opps[0].action, why: opps[0].why, confidence: opps[0].confidence
    });
    if (priceTest) actions.push({
      priority: 4, action: `اختبر سعر ${priceTest.product}: ${priceTest.current} ← ${priceTest.test}`,
      why: priceTest.why, confidence: confidence(30)
    });
    if (costsKnown < stats.length) actions.push({
      priority: 5, action: `سجّل تكلفة ${stats.length - costsKnown} منتج`,
      why: "بلا تكلفة كل أرقام الربح عندك تقديرية — وهاد بيخرّب كل قرار تسعير",
      confidence: { level: "عالية", score: 3, n: stats.length, note: "حقيقة مش تقدير" }
    });

    // ── 🚀 خلال 30 يوم ──
    const horizon = [];
    if (push) horizon.push(`وسّع "${push.product}" — أعلى ربح فعلي مضروب بتحويله`);
    const repeat = withOrders.filter(c => c.orders >= 2).length;
    horizon.push(`ارفع تكرار الشراء: ${repeat} من ${withOrders.length} زبون طلبوا أكثر من مرة (${pct(repeat, withOrders.length)}%)`);
    if (lostConvs > 20) horizon.push(`ابنِ نظام متابعة للـ${lostConvs} فرصة ضائعة — ضمن نافذة 24 ساعة`);
    horizon.push("شغّل تجربتين A/B على الأقل — بلا تجارب النظام ما بيتعلم إشي جديد");

    const knownLessons = lessons().slice(0, 5);

    const payload = {
      period: { days, from, to: now },
      sales: {
        value: sales, orders: ordersN, aov, profit,
        change: salesChange,
        changeLabel: salesChange == null ? "ما في فترة سابقة للمقارنة"
          : salesChange >= 0 ? `+${salesChange}% عن الفترة السابقة` : `${salesChange}% عن الفترة السابقة`,
        profitReliable: costsKnown === stats.length,
        profitNote: costsKnown === stats.length ? "الربح محسوب من تكاليف كاملة"
          : `⚠️ ${stats.length - costsKnown} من ${stats.length} منتج بلا تكلفة — الربح ناقص`
      },
      why,
      losses: losses.slice(0, 4),
      totalLossValue: round(losses.reduce((s, l) => s + l.value, 0)),
      opportunities: opps.slice(0, 4),
      customers: {
        total: customers.length, buyers: withOrders.length,
        topShare, top: top10.slice(0, 10).map(c => ({
          sender_id: c.sender_id, spend: c.spend, orders: c.orders,
          url: "https://m.me/" + c.sender_id
        })),
        note: `أعلى 10% بيجيبوا ${topShare}% من مبيعاتك`
      },
      pushProduct: push ? {
        product: push.product, profit: push.profit, margin: push.margin,
        askToOrder: push.askToOrder,
        why: `ربح ${push.profit} بهامش ${push.margin}%` +
             (push.askToOrder != null ? ` وتحويل استفسار ${push.askToOrder}%` : "")
      } : null,
      priceTest,
      actions: actions.sort((a, b) => a.priority - b.priority),
      horizon,
      lessons: knownLessons,
      confidence: confidence(ordersN + convs.length, { low: 50, mid: 200 })
    };

    recordDecision("chief", "تقرير مركز القيادة",
      `مبيعات ${sales} · خسارة مقدّرة ${payload.totalLossValue} · ${actions.length} إجراء مقترح`,
      { sales, ordersN, lostConvs, noReplyN }, payload.confidence);

    reply(res, payload, {
      المصدر: `${ordersN} طلب · ${convs.length} محادثة · ${stats.length} منتج · آخر ${days} يوم`,
      المبدأ: "كل بند فوق معه سببه بالأرقام ومستوى ثقته",
      "🔴_انتبه": costsKnown === stats.length ? null
        : "أرقام الربح ناقصة لأن في منتجات بلا تكلفة مسجّلة"
    });
  } catch (e) { fail(res, e, "فشل بناء مركز القيادة"); }
});

// ═══════════════════════════════════════════════════════════
// سجل القرارات — النظام بيحاسب حاله
// ═══════════════════════════════════════════════════════════
router.get("/decisions", (req, res) => {
  try {
    const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
    const rows = retryDb(() => db.prepare(
      "SELECT * FROM brain_decisions ORDER BY created_at DESC LIMIT ?"
    ).all(limit)).map(r => ({ ...r, basis: safeJson(r.basis) }));
    reply(res, { total: rows.length, decisions: rows }, {
      قيمة: "كل اقتراح اقترحناه محفوظ. بتقدر ترجع تشوف إذا كان صح ولا غلط"
    });
  } catch (e) { fail(res, e, "فشل جلب القرارات"); }
});

// قبول/رفض قرار — التغذية الراجعة اللي بيتعلم منها النظام
router.post("/decisions/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const status = String((req.body || {}).status || "");
    if (!["accepted", "rejected", "executed"].includes(status))
      return res.status(400).json({ error: "الحالة لازم تكون accepted أو rejected أو executed" });
    retryDb(() => db.prepare(
      "UPDATE brain_decisions SET status=?, result=?, acted_at=? WHERE id=?"
    ).run(status, String((req.body || {}).result || "").slice(0, 500), Date.now(), id));
    res.json({ ok: true });
  } catch (e) { fail(res, e, "فشل تحديث القرار"); }
});

// دورة التعلّم اليدوية
router.post("/learn", (req, res) => {
  try {
    const learned = runLearningCycle();
    res.json({ ok: true, learned: learned.length, lessons: learned });
  } catch (e) { fail(res, e, "فشل تشغيل دورة التعلّم"); }
});
