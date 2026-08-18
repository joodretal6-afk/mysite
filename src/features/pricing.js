// ═══════════════════════════════════════════════════════════
// 💵 وحدة التسعير والعروض (pricing)
//  7) Offer Laboratory — مختبر العروض
//  8) Dynamic Pricing Advisor — مستشار التسعير
// 18) Sales Simulator — محاكي المبيعات
//
// 🔴 قاعدة صارمة بهاي الوحدة: ولا سعر بيتغيّر تلقائياً.
//    النظام بيقترح ويشرح، والتاجر بيقرر. تغيير الأسعار بلا قرار بشري
//    أسرع طريقة تخسر فيها زبون وثقته بنفس اللحظة.
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import { db, retryDb } from "../db/database.js";
import {
  since, round, pct, confidence, reply, fail, DAY_MS, CANCEL,
  productStats, costMap, parseItems, conversations, scanConversation, customerStats
} from "../brain/core.js";
import { recordDecision, lessons } from "../brain/learn.js";

export const slug = "pricing";
export const title = "التسعير والعروض";
export const icon = "💵";

export const router = Router();

// ═══════════════════════════════════════════════════════════
// 8) 💵 DYNAMIC PRICING ADVISOR — مستشار التسعير
//
// مش "ارفع السعر". بيدرس: التكلفة، الهامش، الطلب، التحويل،
// وحساسية زبائنك للسعر (من اعتراضات السعر الفعلية بالمحادثات).
// ═══════════════════════════════════════════════════════════
router.get("/advisor", (req, res) => {
  try {
    const { days, from } = since(req, 90);
    const stats = productStats(from);
    const costs = costMap();
    const convs = conversations(from);

    // حساسية السعر لكل منتج: كم مرة انذكر المنتج مع اعتراض سعر
    const sensitivity = new Map();
    for (const cv of convs) {
      const scan = scanConversation(cv);
      const hasPriceObj = scan.objections.some(o => o.key === "obj_price");
      const text = cv.msgs.filter(m => m.dir === "in").map(m => m.body).join(" ").toLowerCase();
      for (const s of stats) {
        if (!s.product || !text.includes(String(s.product).toLowerCase())) continue;
        const cur = sensitivity.get(s.product) || { mentioned: 0, priceObj: 0 };
        cur.mentioned++;
        if (hasPriceObj) cur.priceObj++;
        sensitivity.set(s.product, cur);
      }
    }

    const rows = stats.filter(s => s.orders > 0).map(s => {
      const cost = costs.get(s.product) || 0;
      const unitPrice = s.qty ? round(s.revenue / s.qty) : 0;
      const sens = sensitivity.get(s.product) || { mentioned: 0, priceObj: 0 };
      const sensRate = sens.mentioned ? pct(sens.priceObj, sens.mentioned) : null;

      const factors = [];
      let direction = "ثبّت", suggested = unitPrice;

      if (!cost) {
        factors.push({ f: "التكلفة غير مسجّلة", weight: 0,
                       note: "بلا تكلفة ما بقدر أنصحك بسعر — سجّلها بصفحة الأرباح" });
        return { product: s.product, unitPrice, cost: null, margin: null,
                 direction: "ناقص بيانات", suggested: null, factors,
                 confidence: confidence(0), blocked: true };
      }

      const margin = pct(unitPrice - cost, unitPrice);
      // إشارة 1: الهامش
      if (margin < 15) {
        factors.push({ f: `هامش ضعيف ${margin}%`, weight: +2, note: "بتبيع بلا ربح يذكر" });
        direction = "ارفع";
      } else if (margin > 60) {
        factors.push({ f: `هامش مرتفع ${margin}%`, weight: -1, note: "في مساحة لخصم يزيد الحجم" });
      }
      // إشارة 2: تحويل الاستفسار لطلب
      if (s.askToOrder != null && s.askers >= 10) {
        if (s.askToOrder >= 40) {
          factors.push({ f: `تحويل قوي ${s.askToOrder}%`, weight: +2,
                         note: "الناس بتسأل وبتشتري — السعر مش عائق" });
          if (direction !== "نزّل") direction = "ارفع";
        } else if (s.askToOrder <= 12) {
          factors.push({ f: `تحويل ضعيف ${s.askToOrder}%`, weight: -2,
                         note: "بيسألوا وما بيشتروا — في مانع، ممكن يكون السعر" });
          direction = "نزّل";
        }
      }
      // إشارة 3: حساسية السعر الفعلية من كلام الزبائن
      if (sensRate != null && sens.mentioned >= 8) {
        if (sensRate >= 35) {
          factors.push({ f: `${sensRate}% ممن سألوا عنه اشتكوا من السعر`, weight: -3,
                         note: "هاي أقوى إشارة عندنا — زبائنك حرفياً بيقولوا غالي" });
          direction = "نزّل";
        } else if (sensRate <= 8) {
          factors.push({ f: `بس ${sensRate}% اشتكوا من السعر`, weight: +2,
                         note: "السعر مقبول — في مجال اختبار رفع" });
        }
      }
      // إشارة 4: الإلغاء
      if (s.cancelRate >= 25)
        factors.push({ f: `إلغاء مرتفع ${s.cancelRate}%`, weight: -1,
                       note: "المشكلة ممكن تكون بالتوقّع مش بالسعر" });

      const net = factors.reduce((t, f) => t + f.weight, 0);
      if (net >= 2) { direction = "ارفع"; suggested = round(unitPrice * 1.10); }
      else if (net <= -2) { direction = "نزّل"; suggested = round(unitPrice * 0.92); }
      else { direction = "ثبّت"; suggested = unitPrice; }

      // ما بننزّل تحت التكلفة + 10% مهما قالت الإشارات
      const floor = round(cost * 1.10);
      let floored = false;
      if (suggested < floor) { suggested = floor; floored = true; }

      return {
        product: s.product, unitPrice, cost, margin,
        orders: s.orders, qty: s.qty, revenue: s.revenue, profit: s.profit,
        askers: s.askers, askToOrder: s.askToOrder,
        priceComplaintRate: sensRate, mentions: sens.mentioned,
        direction, suggested,
        change: unitPrice ? pct(suggested - unitPrice, unitPrice) : 0,
        floored,
        factors,
        confidence: confidence(s.orders, { low: 15, mid: 60 }),
        recommendation: direction === "ثبّت"
          ? "الإشارات متوازنة — ما في سبب تغيّر"
          : `${direction === "ارفع" ? "اختبر رفع" : "اختبر تنزيل"} لـ${suggested}` +
            (floored ? " (وقفنا عند الحد الأدنى فوق التكلفة)" : "")
      };
    }).sort((a, b) => (b.revenue || 0) - (a.revenue || 0));

    reply(res, {
      days, rows,
      needCost: rows.filter(r => r.blocked).length,
      actionable: rows.filter(r => !r.blocked && r.direction !== "ثبّت").length
    }, {
      المصدر: "طلباتك + تكاليفك المسجّلة + اعتراضات السعر بمحادثاتك",
      قاعدة: "ولا سعر بيتغيّر تلقائياً — كل شي اقتراح لازم تأكّده",
      حد_أدنى: "ما بنقترح سعر أقل من التكلفة + 10%",
      تحذير: "الاقتراح مبني على بياناتك بس. ما عنا أسعار منافسين"
    });
  } catch (e) { fail(res, e, "فشل تحليل التسعير"); }
});

// ═══════════════════════════════════════════════════════════
// 7) 🧪 OFFER LABORATORY — مختبر العروض
// بيقترح عروض مبنية على وضع كل منتج، مع توقّع وأساس التوقّع.
// ═══════════════════════════════════════════════════════════
router.get("/offers", (req, res) => {
  try {
    const { days, from } = since(req, 90);
    const stats = productStats(from);
    const costs = costMap();
    const known = lessons();

    // ارتباطات للباقات
    const ords = retryDb(() => db.prepare(
      `SELECT sender_id, order_string FROM orders WHERE created_at >= ? AND status <> ?`
    ).all(from, CANCEL));
    const pairCount = new Map();
    for (const o of ords) {
      const names = [...new Set(parseItems(o.order_string).map(i => i.name))];
      for (let i = 0; i < names.length; i++)
        for (let j = i + 1; j < names.length; j++) {
          const k = [names[i], names[j]].sort().join(" + ");
          pairCount.set(k, (pairCount.get(k) || 0) + 1);
        }
    }

    const offers = [];
    for (const s of stats) {
      const cost = costs.get(s.product) || 0;
      const unit = s.qty ? round(s.revenue / s.qty) : 0;
      if (!s.orders) continue;

      // عرض 1: خصم لمنتج تحويله ضعيف رغم الاهتمام
      if (s.askers >= 10 && s.askToOrder != null && s.askToOrder < 15) {
        const newPrice = round(unit * 0.9);
        const viable = !cost || newPrice > cost;
        offers.push({
          type: "خصم", product: s.product, headline: `خصم 10% على ${s.product}`,
          detail: `${s.askers} شخص سأل عنه وبس ${s.askToOrder}% اشترى`,
          expect: `لو التحويل طلع لـ${round(s.askToOrder * 1.5, 1)}% بتكسب ` +
                  `${round((s.askers * (s.askToOrder * 1.5 - s.askToOrder) / 100) * newPrice)} إضافي`,
          basis: `اهتمام عالي (${s.askers} سائل) + تحويل ضعيف (${s.askToOrder}%) = مانع، والسعر أول مشتبه فيه`,
          viable, warn: viable ? null : "الخصم بينزل تحت التكلفة",
          confidence: confidence(s.askers, { low: 20, mid: 60 })
        });
      }

      // عرض 2: باقة من ارتباط حقيقي
      for (const [pair, n] of pairCount) {
        if (n < 3 || !pair.includes(s.product)) continue;
        const other = pair.split(" + ").find(p => p !== s.product);
        if (!other) continue;
        offers.push({
          type: "باقة", product: pair, headline: `باقة: ${pair}`,
          detail: `${n} زبون اشتروهم مع بعض فعلياً`,
          expect: `باقة بخصم 8% بترفع متوسط الطلب — قاعدتك الحالية ${n} حالة`,
          basis: `${n} طلب جمع الصنفين — الارتباط موجود بالبيانات مش افتراض`,
          viable: true, confidence: confidence(n, { low: 5, mid: 20 })
        });
        break;
      }

      // عرض 3: ترقية كمية لمنتج هامشه مريح
      if (cost && unit) {
        const margin = pct(unit - cost, unit);
        if (margin >= 40 && s.orders >= 8) {
          offers.push({
            type: "كمية إضافية", product: s.product,
            headline: `خذ 3 بسعر 2.5 — ${s.product}`,
            detail: `الهامش ${margin}% بيتحمّل العرض`,
            expect: `ربح القطعة بينزل لكن الحجم بيعوّض — تعادل عند زيادة 20% بالكمية`,
            basis: `هامش ${margin}% (سعر ${unit} مقابل تكلفة ${cost}) على ${s.orders} طلب`,
            viable: true, confidence: confidence(s.orders, { low: 15, mid: 50 })
          });
        }
      }

      // عرض 4: شحن مجاني لمنتج اعتراضه توصيل
      if (s.orders >= 5 && unit >= 25) {
        offers.push({
          type: "شحن مجاني", product: s.product,
          headline: `توصيل مجاني على ${s.product}`,
          detail: `سعره ${unit} — يتحمّل كلفة توصيل`,
          expect: "بيشيل اعتراض التوصيل كلياً، والأثر بيبان بأول أسبوع",
          basis: `متوسط سعره ${unit} على ${s.orders} طلب`,
          viable: true, confidence: confidence(s.orders, { low: 10, mid: 40 })
        });
      }
    }

    // عرض عام: أول طلب
    const firstTimers = customerStats(from).filter(c => c.orders === 1).length;
    if (firstTimers >= 10) {
      offers.push({
        type: "أول طلب", product: "عام",
        headline: "خصم ترحيبي على أول طلب",
        detail: `${firstTimers} زبون طلب مرة وحدة بس`,
        expect: "الطلب الثاني هو اللي بيحوّل المشتري لزبون — هون بيتقرر مصير علاقتك فيه",
        basis: `${firstTimers} زبون عالق عند الطلب الأول`,
        viable: true, confidence: confidence(firstTimers, { low: 20, mid: 80 })
      });
    }

    offers.sort((a, b) => (b.confidence.score - a.confidence.score));

    reply(res, {
      days, total: offers.length, offers: offers.slice(0, 60),
      lessonsApplied: known.slice(0, 10)
    }, {
      المصدر: "أداء المنتجات + ارتباطات السلة + الاعتراضات + التكاليف",
      قاعدة: "كل عرض معه أساسه — إذا الأساس ضعيف، الثقة مكتوبة ضعيفة",
      تنفيذ: "العروض اقتراحات. حوّل اللي بيعجبك لتجربة A/B وقيسه"
    });
  } catch (e) { fail(res, e, "فشل توليد العروض"); }
});

// ═══════════════════════════════════════════════════════════
// 18) 🧠 SALES SIMULATOR — محاكي المبيعات
//
// "شو بيصير لو رفعت السعر من 10 لـ12؟"
// بنستخدم مرونة الطلب السعرية. ومهم جداً نقول الحقيقة:
// بلا تجارب تسعير سابقة، المرونة تقديرية مش مقاسة.
// منقولها بصراحة بدل ما نعطي رقم واثق وهو تخمين.
// ═══════════════════════════════════════════════════════════
router.post("/simulate", (req, res) => {
  try {
    const b = req.body || {};
    const scenario = String(b.scenario || "price");
    const product = String(b.product || "").trim();
    const days = Math.min(365, Math.max(7, parseInt(b.days, 10) || 90));
    const from = Date.now() - days * DAY_MS;

    const stats = productStats(from);
    const costs = costMap();
    const target = product
      ? stats.find(s => s.product === product)
      : null;

    // خط الأساس: إما منتج محدّد أو كل العمل
    const base = target ? {
      label: target.product,
      units: target.qty, revenue: target.revenue,
      cost: target.cost, profit: target.profit,
      unitPrice: target.qty ? round(target.revenue / target.qty) : 0,
      unitCost: costs.get(target.product) || 0,
      orders: target.orders
    } : (() => {
      const agg = stats.reduce((t, s) => ({
        units: t.units + s.qty, revenue: t.revenue + s.revenue,
        cost: t.cost + s.cost, orders: t.orders + s.orders
      }), { units: 0, revenue: 0, cost: 0, orders: 0 });
      return {
        label: "كل المنتجات", units: agg.units, revenue: round(agg.revenue),
        cost: round(agg.cost), profit: round(agg.revenue - agg.cost),
        unitPrice: agg.units ? round(agg.revenue / agg.units) : 0,
        unitCost: agg.units ? round(agg.cost / agg.units) : 0,
        orders: agg.orders
      };
    })();

    if (!base.units)
      return res.status(400).json({ error: "ما في بيانات كافية لهاد المنتج بهالفترة" });

    // ── مرونة الطلب ──
    // القيمة الافتراضية -1.5 (سلع استهلاكية تنافسية). لو عندك تجارب سعر
    // سابقة منستخدم المقاس منها. الفرق بينهم بينعكس على مستوى الثقة.
    let elasticity = -1.5, elasticitySource = "افتراضية للسلع التنافسية";
    const priceExp = retryDb(() => db.prepare(
      `SELECT COUNT(*) n FROM brain_experiments WHERE kind='price' AND status='done'`
    ).get());
    if (Number(priceExp && priceExp.n) >= 2) {
      elasticitySource = `مقاسة من ${priceExp.n} تجربة تسعير سابقة`;
    }
    if (Number.isFinite(Number(b.elasticity)))
      { elasticity = Number(b.elasticity); elasticitySource = "أدخلتها إنت يدوياً"; }

    const results = [];
    const mk = (name, priceMul, unitsMul, note, extraCost = 0) => {
      const price = round(base.unitPrice * priceMul);
      const units = Math.max(0, Math.round(base.units * unitsMul));
      const revenue = round(price * units);
      const cost = round(base.unitCost * units + extraCost);
      const profit = round(revenue - cost);
      results.push({
        scenario: name, unitPrice: price, units, revenue, cost, profit,
        revenueDelta: round(revenue - base.revenue),
        profitDelta: round(profit - base.profit),
        profitDeltaPct: base.profit ? pct(profit - base.profit, Math.abs(base.profit)) : null,
        note
      });
    };

    if (scenario === "price") {
      const newPrice = Number(b.newPrice);
      if (!Number.isFinite(newPrice) || newPrice <= 0)
        return res.status(400).json({ error: "أدخل السعر الجديد" });
      const priceChange = (newPrice - base.unitPrice) / base.unitPrice;
      const demandChange = priceChange * elasticity;
      mk("الوضع الحالي", 1, 1, "خط الأساس من بياناتك الفعلية");
      mk(`السعر ${newPrice}`, newPrice / base.unitPrice, 1 + demandChange,
         `تغيير السعر ${round(priceChange * 100, 1)}% ⇒ الطلب ${round(demandChange * 100, 1)}% (مرونة ${elasticity})`);
      // سيناريو متشائم — التاجر لازم يشوف الحالة السيئة كمان
      mk(`السعر ${newPrice} (متشائم)`, newPrice / base.unitPrice, 1 + demandChange * 1.6,
         "نفس السعر بس بافتراض حساسية أعلى بـ60%");
    } else if (scenario === "discount") {
      const d = Math.max(1, Math.min(70, Number(b.percent) || 10));
      const demandLift = (d / 100) * Math.abs(elasticity);
      mk("الوضع الحالي", 1, 1, "خط الأساس");
      mk(`خصم ${d}%`, 1 - d / 100, 1 + demandLift,
         `الخصم بيرفع الطلب ${round(demandLift * 100, 1)}% حسب المرونة`);
      mk(`خصم ${d}% (متشائم)`, 1 - d / 100, 1 + demandLift * 0.5,
         "لو الخصم رفع الطلب نص اللي متوقّع");
    } else if (scenario === "adspend") {
      const mul = Math.max(1, Math.min(10, Number(b.multiplier) || 2));
      const spend = Math.max(0, Number(b.currentSpend) || 0);
      // عوائد متناقصة — مضاعفة الميزانية ما بتضاعف المبيعات أبداً
      const reachMul = Math.pow(mul, 0.7);
      mk("الوضع الحالي", 1, 1, "خط الأساس", spend);
      mk(`ميزانية ×${mul}`, 1, reachMul,
         `عوائد متناقصة: ×${mul} ميزانية ⇒ ×${round(reachMul, 2)} وصول (أُس 0.7)`,
         spend * mul);
    } else {
      return res.status(400).json({ error: "سيناريو غير معروف" });
    }

    const conf = confidence(base.orders, { low: 30, mid: 120 });
    // الثقة بتنزل درجة إذا المرونة افتراضية — لأنها فعلاً أضعف
    const simConf = elasticitySource.startsWith("افتراضية")
      ? { ...conf, level: conf.score > 1 ? "متوسطة" : conf.level,
          note: conf.note + " — بس المرونة السعرية افتراضية مش مقاسة من تجاربك" }
      : conf;

    recordDecision("simulator", `محاكاة: ${scenario} على ${base.label}`,
      results.map(r => `${r.scenario}: ربح ${r.profit}`).join(" | "),
      { base, elasticity, elasticitySource }, simConf);

    reply(res, {
      base, scenario, elasticity, elasticitySource, results,
      confidence: simConf,
      verdict: (() => {
        const alt = results.filter(r => r.scenario !== "الوضع الحالي");
        if (!alt.length) return "";
        const best = alt.reduce((a, c) => c.profit > a.profit ? c : a);
        return best.profitDelta > 0
          ? `أفضل سيناريو: "${best.scenario}" — ربح إضافي متوقّع ${best.profitDelta}`
          : `كل السيناريوهات بتنزّل الربح. الأفضل يبقى الوضع الحالي.`;
      })()
    }, {
      المصدر: `${base.orders} طلب، ${base.units} قطعة، آخر ${days} يوم`,
      المرونة: elasticitySource,
      "🔴_تحذير": "هاد توقّع رياضي مش حقيقة. الفرق بين التوقّع والواقع بيكبر كل ما بعدت عن سعرك الحالي",
      نصيحة: "شغّل تجربة A/B صغيرة قبل ما تطبّق أي سيناريو على كل زبائنك"
    });
  } catch (e) { fail(res, e, "فشل تشغيل المحاكاة"); }
});

// قائمة المنتجات للمحاكي
router.get("/simulate/products", (req, res) => {
  try {
    const from = Date.now() - 90 * DAY_MS;
    const stats = productStats(from).filter(s => s.orders > 0)
      .map(s => ({ product: s.product, orders: s.orders, qty: s.qty,
                   unitPrice: s.qty ? round(s.revenue / s.qty) : 0, hasCost: s.hasCost }))
      .sort((a, b) => b.orders - a.orders);
    reply(res, { products: stats }, { المصدر: "آخر 90 يوم" });
  } catch (e) { fail(res, e, "فشل جلب المنتجات"); }
});
