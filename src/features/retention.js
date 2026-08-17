// ═══════════════════════════════════════════════════════════
// ♻️ وحدة الاحتفاظ وقيمة العميل (retention)
//  4) Customer Next-Buy Predictor — المنتج التالي
// 16) VIP & Customer Value Engine — قيمة العميل
// 17) Churn Detector — كاشف العملاء المفقودين
//
// 🔴 هاي الوحدة بتعطي قوائم للتاجر يقرر فيها. ما بتبعث ولا رسالة لحالها.
//    أي تواصل استباقي بيضل محكوم بنافذة الـ24 ساعة وبقرار بشري صريح.
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import { db, retryDb } from "../db/database.js";
import {
  since, round, pct, confidence, reply, fail, DAY_MS, CANCEL,
  customerStats, parseItems, productStats, inWindow
} from "../brain/core.js";
import { recordDecision, learn } from "../brain/learn.js";

export const slug = "retention";
export const title = "الاحتفاظ وقيمة العميل";
export const icon = "♻️";

export const router = Router();

// ═══════════════════════════════════════════════════════════
// 4) 🎯 NEXT-BUY PREDICTOR — شو رح يشتري بعدين
//
// الطريقة: تحليل سلة مشتركة (market-basket). بنحسب لكل زوج منتجات
// احتمال إن اللي اشترى A يشتري B، ومنقيسه بالرفع (lift) مش بالعدد الخام —
// لأن المنتج الأكثر مبيعاً بيطلع "مرتبط بكل شي" وهاد استنتاج كاذب.
// ═══════════════════════════════════════════════════════════
function affinityMatrix(from) {
  const ords = retryDb(() => db.prepare(
    `SELECT sender_id, order_string FROM orders
     WHERE created_at >= ? AND status <> ? AND sender_id IS NOT NULL`
  ).all(from, CANCEL));

  const byCustomer = new Map();
  const productBuyers = new Map();
  for (const o of ords) {
    if (!byCustomer.has(o.sender_id)) byCustomer.set(o.sender_id, new Set());
    for (const it of parseItems(o.order_string)) {
      byCustomer.get(o.sender_id).add(it.name);
      if (!productBuyers.has(it.name)) productBuyers.set(it.name, new Set());
      productBuyers.get(it.name).add(o.sender_id);
    }
  }

  const totalCustomers = byCustomer.size;
  const pairs = new Map();
  for (const [, prods] of byCustomer) {
    const arr = [...prods];
    for (let i = 0; i < arr.length; i++)
      for (let j = 0; j < arr.length; j++) {
        if (i === j) continue;
        const k = arr[i] + "→" + arr[j];
        pairs.set(k, (pairs.get(k) || 0) + 1);
      }
  }

  const links = [];
  for (const [k, both] of pairs) {
    const [a, b] = k.split("→");
    const nA = (productBuyers.get(a) || new Set()).size;
    const nB = (productBuyers.get(b) || new Set()).size;
    if (nA < 3 || both < 2) continue;              // عيّنة أصغر من هيك = ضجيج
    const confidenceAB = both / nA;                 // من اشترى A، كم نسبة اشترى B
    const baseline = totalCustomers ? nB / totalCustomers : 0;
    const lift = baseline ? confidenceAB / baseline : 0;
    if (lift <= 1.15) continue;                     // ما في ارتباط حقيقي
    links.push({
      from: a, to: b, both, buyersOfA: nA, buyersOfB: nB,
      confidence: pct(both, nA), lift: round(lift, 2),
      basis: `${both} من ${nA} اشتروا ${a} اشتروا كمان ${b}`
    });
  }
  return { links: links.sort((x, y) => y.lift - x.lift), totalCustomers };
}

router.get("/affinity", (req, res) => {
  try {
    const { days, from } = since(req, 180);
    const { links, totalCustomers } = affinityMatrix(from);
    reply(res, {
      days, totalCustomers, links: links.slice(0, 100),
      confidence: confidence(totalCustomers, { low: 40, mid: 150 })
    }, {
      الطريقة: "تحليل سلة مشتركة مع مقياس الرفع (lift)",
      لماذا_الرفع: "العدد الخام بيخدعك — المنتج الأكثر مبيعاً بيبان مرتبط بكل شي",
      عتبة: "رفع أعلى من 1.15، و3 مشترين على الأقل للمنتج الأساس"
    });
  } catch (e) { fail(res, e, "فشل تحليل الارتباط"); }
});

router.get("/next-buy", (req, res) => {
  try {
    const { days, from } = since(req, 180);
    const { links, totalCustomers } = affinityMatrix(from);
    const byFrom = new Map();
    for (const l of links) {
      if (!byFrom.has(l.from)) byFrom.set(l.from, []);
      byFrom.get(l.from).push(l);
    }

    const customers = customerStats(from).filter(c => c.orders > 0);
    const rows = [];
    for (const c of customers) {
      const owned = new Set(c.products.map(p => p.name));
      const scores = new Map();
      for (const p of c.products) {
        for (const l of (byFrom.get(p.name) || [])) {
          if (owned.has(l.to)) continue;            // عنده منه أصلاً
          const cur = scores.get(l.to) || { product: l.to, score: 0, why: [] };
          cur.score += l.lift * l.confidence;
          if (cur.why.length < 3) cur.why.push(l.basis);
          scores.set(l.to, cur);
        }
      }
      const top = [...scores.values()].sort((a, b) => b.score - a.score).slice(0, 3);
      if (!top.length) continue;

      // توقيت: إمتى المفروض يطلب حسب إيقاعه هو
      const due = c.avgGapDays != null && c.daysSinceOrder != null
        ? c.daysSinceOrder - c.avgGapDays : null;

      rows.push({
        sender_id: c.sender_id, page_name: c.page_name,
        orders: c.orders, spend: c.spend,
        owns: c.products.slice(0, 5).map(p => p.name),
        suggestions: top.map(t => ({ product: t.product, score: round(t.score, 1), why: t.why })),
        daysSinceOrder: c.daysSinceOrder, avgGapDays: c.avgGapDays,
        timing: due == null ? "غير معروف" : due >= 0 ? "متأخر عن موعده" : `بعد ${Math.abs(Math.round(due))} يوم تقريباً`,
        overdue: due != null && due >= 0,
        url: "https://m.me/" + c.sender_id
      });
    }
    rows.sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || b.spend - a.spend);

    reply(res, {
      days, total: rows.length, rows: rows.slice(0, 200),
      overdue: rows.filter(r => r.overdue).length,
      confidence: confidence(totalCustomers, { low: 40, mid: 150 })
    }, {
      الطريقة: "ارتباط المنتجات × إيقاع الشراء الشخصي للزبون",
      قيد: "توصية مبنية على أنماط سابقة — مش ضمان",
      تذكير: "أي رسالة لهدول لازم تكون داخل نافذة 24 ساعة وبقرارك إنت"
    });
  } catch (e) { fail(res, e, "فشل التنبؤ بالشراء التالي"); }
});

// ═══════════════════════════════════════════════════════════
// 16) 👑 VIP & CUSTOMER VALUE — قيمة العميل
//
// CLV هون محسوبة من سلوك فعلي مش من صيغة كتاب:
// متوسط الطلب × تكرار الشراء الشهري × مدة البقاء المتوقعة.
// ═══════════════════════════════════════════════════════════
router.get("/value", (req, res) => {
  try {
    const { days, from } = since(req, 365);
    const list = customerStats(from).filter(c => c.orders > 0);

    const rows = list.map(c => {
      // تكرار شهري فعلي
      const lifeDays = c.firstOrder && c.lastOrder
        ? Math.max(1, (c.lastOrder - c.firstOrder) / DAY_MS) : 1;
      const perMonth = c.orders > 1 ? round((c.orders / lifeDays) * 30, 2) : 0;
      // مدة البقاء المتوقعة: من فجوة الشراء المعتادة، بسقف محافظ 24 شهر
      const expectedMonths = c.avgGapDays
        ? Math.min(24, round(90 / Math.max(7, c.avgGapDays) * 6, 1)) : 6;
      const clv = perMonth > 0
        ? round(c.aov * perMonth * expectedMonths)
        : round(c.aov * 1.3);          // زبون طلب مرة وحدة — تقدير متحفظ

      return {
        sender_id: c.sender_id, page_name: c.page_name,
        orders: c.orders, spend: c.spend, aov: c.aov,
        perMonth, expectedMonths, clv,
        daysSinceOrder: c.daysSinceOrder, avgGapDays: c.avgGapDays,
        url: "https://m.me/" + c.sender_id,
        basis: perMonth > 0
          ? `${c.aov} متوسط × ${perMonth} طلب/شهر × ${expectedMonths} شهر متوقّع`
          : `طلب واحد بقيمة ${c.spend} — تقدير متحفظ`
      };
    }).sort((a, b) => b.clv - a.clv);

    // تدرّج VIP بالربع الأعلى مش برقم عشوائي
    const n = rows.length;
    const p90 = n ? rows[Math.floor(n * 0.10)] : null;
    const p25 = n ? rows[Math.floor(n * 0.25)] : null;
    const vipLine = p90 ? p90.clv : 0;
    const goldLine = p25 ? p25.clv : 0;

    for (const r of rows) {
      r.tier = r.clv >= vipLine ? "VIP"
             : r.clv >= goldLine ? "ذهبي"
             : r.orders >= 2 ? "متكرر" : "عادي";
      r.strategy = r.tier === "VIP"
        ? "تواصل شخصي، أولوية بالتوصيل، عروض حصرية"
        : r.tier === "ذهبي"
        ? "مرشّح ليصير VIP — عرض ترقية أو باقة"
        : r.orders >= 2 ? "حافظ على الإيقاع — تذكير بموعده المعتاد"
        : "هدف: الطلب الثاني. هون بيتقرر إذا بيصير زبون أو لأ";
    }

    const tiers = ["VIP", "ذهبي", "متكرر", "عادي"].map(t => {
      const g = rows.filter(r => r.tier === t);
      return {
        tier: t, n: g.length, share: pct(g.length, n),
        totalCLV: round(g.reduce((s, r) => s + r.clv, 0)),
        valueShare: pct(g.reduce((s, r) => s + r.spend, 0), rows.reduce((s, r) => s + r.spend, 0)),
        strategy: g.length ? g[0].strategy : ""
      };
    });

    const topShare = tiers[0].valueShare;
    reply(res, {
      days, customers: n, tiers, rows: rows.slice(0, 300),
      totalCLV: round(rows.reduce((s, r) => s + r.clv, 0)),
      confidence: confidence(n, { low: 30, mid: 120 }),
      insight: n ? `أعلى 10% من زبائنك بيجيبولك ${topShare}% من مبيعاتك` : ""
    }, {
      الطريقة: "متوسط الطلب × تكرار شهري فعلي × مدة بقاء متوقعة (سقف 24 شهر)",
      حدود_الفئات: `VIP فوق ${vipLine}، ذهبي فوق ${goldLine} — محسوبة من توزيع زبائنك مش أرقام ثابتة`,
      تحذير: "CLV توقّع مستقبلي — بيتغيّر مع كل طلب جديد"
    });
  } catch (e) { fail(res, e, "فشل حساب قيمة العملاء"); }
});

// ═══════════════════════════════════════════════════════════
// 17) ♻️ CHURN DETECTOR — مين وقف يشتري وليش
//
// النقطة المهمة: "غايب 90 يوم" مش نفس المعنى لكل الزبائن.
// زبون بيطلب كل أسبوع وغاب 30 يوم = خسرناه.
// زبون بيطلب كل 4 شهور وغاب 90 يوم = طبيعي.
// فالمقياس نسبي لإيقاع كل زبون، مش رقم واحد للكل.
// ═══════════════════════════════════════════════════════════
router.get("/churn", (req, res) => {
  try {
    const { days, from } = since(req, 365);
    const list = customerStats(from).filter(c => c.orders >= 2 && c.daysSinceOrder != null);

    const rows = list.map(c => {
      const expected = c.avgGapDays || 45;
      const overdueRatio = round(c.daysSinceOrder / expected, 2);
      let risk, label;
      if (overdueRatio >= 3) { risk = 95; label = "مفقود"; }
      else if (overdueRatio >= 2) { risk = 75; label = "خطر عالي"; }
      else if (overdueRatio >= 1.3) { risk = 50; label = "خطر متوسط"; }
      else { risk = 15; label = "طبيعي"; }

      // ليش فقدناه — من الإشارات المتاحة
      const why = [];
      if (c.cancelled >= 1) why.push(`ألغى ${c.cancelled} طلب`);
      if ((c.objections || []).length) why.push("اعترض: " + c.objections.map(o => o.label).join("، "));
      if (c.replyDelayMin != null && c.replyDelayMin > 60)
        why.push(`آخر رد عليه تأخّر ${Math.round(c.replyDelayMin)} دقيقة`);
      if (!why.length) why.push("ما في سبب واضح بالبيانات — يحتاج تواصل");

      return {
        sender_id: c.sender_id, page_name: c.page_name,
        orders: c.orders, spend: c.spend, aov: c.aov,
        daysSinceOrder: c.daysSinceOrder, expectedGap: expected,
        overdueRatio, risk, label, why,
        atRiskValue: round(c.aov * 2),      // قيمة الطلبين الجايين اللي رح نخسرهم
        products: c.products.slice(0, 3).map(p => p.name),
        url: "https://m.me/" + c.sender_id
      };
    }).filter(r => r.label !== "طبيعي")
      .sort((a, b) => b.risk - a.risk || b.spend - a.spend);

    const lostValue = round(rows.reduce((s, r) => s + r.atRiskValue, 0));
    const gone = rows.filter(r => r.label === "مفقود");

    if (rows.length) {
      recordDecision("churn", `${rows.length} زبون بخطر الفقدان`,
        `منهم ${gone.length} يعتبروا مفقودين. القيمة المعرّضة للخسارة: ${lostValue}`,
        { atRisk: rows.length, lost: gone.length, lostValue }, confidence(list.length));
    }

    reply(res, {
      days, analyzed: list.length, atRisk: rows.length, lost: gone.length,
      lostValue, rows: rows.slice(0, 300),
      confidence: confidence(list.length, { low: 25, mid: 100 }),
      headline: rows.length
        ? `${rows.length} زبون اشترى مرتين أو أكثر وصار متأخر عن إيقاعه — قيمة معرّضة ${lostValue}`
        : "ما في زبائن بخطر الفقدان حسب إيقاعهم"
    }, {
      الطريقة: "مقارنة الغياب الحالي بإيقاع الشراء الشخصي لكل زبون",
      لماذا_نسبي: "رقم ثابت (90 يوم مثلاً) بيظلم الزبون البطيء وبيفوّت الزبون السريع",
      شرط: "زبونين طلب على الأقل — لأنه بلا طلبين ما في إيقاع نقيسه"
    });
  } catch (e) { fail(res, e, "فشل كشف العملاء المفقودين"); }
});

// ── قوائم جاهزة للتنفيذ اليدوي، مع علم النافذة ──
router.get("/actionable", (req, res) => {
  try {
    const from = Date.now() - 365 * DAY_MS;
    const lastIn = new Map(retryDb(() => db.prepare(
      `SELECT sender_id, MAX(created_at) at FROM messages
       WHERE direction='in' GROUP BY sender_id`
    ).all()).map(r => [r.sender_id, Number(r.at) || 0]));

    const list = customerStats(from).filter(c => c.orders > 0);
    const rows = list.map(c => ({
      sender_id: c.sender_id, page_name: c.page_name, spend: c.spend, orders: c.orders,
      daysSinceOrder: c.daysSinceOrder,
      canMessage: inWindow(lastIn.get(c.sender_id)),
      url: "https://m.me/" + c.sender_id
    }));
    const open = rows.filter(r => r.canMessage);

    reply(res, {
      total: rows.length, inWindow: open.length, rows: open.slice(0, 200)
    }, {
      قاعدة: "بنعرض بس اللي راسلك خلال آخر 24 ساعة — برّا هالنافذة التواصل ممنوع",
      تنفيذ: "الفتح بيصير بإيدك من الرابط. النظام ما بيبعث لحاله"
    });
  } catch (e) { fail(res, e, "فشل جلب القوائم القابلة للتنفيذ"); }
});
