// ═══════════════════════════════════════════════════════════
// 💰 اقتصاديات مشروع غذائي — حساب صرف، ولا رقم منه من AI
//
// 🔴 قاعدة الملف: كل رقم هون بيطلع من معادلة تقدر تتبعها بورقة وقلم.
//    الذكاء الاصطناعي بيبحث ويقترح، بس ما بيحسب — لأن نموذج لغوي
//    بيغلط بالحساب وهو واثق، وغلطة برقم التعادل بتفلّس مشروع.
//
// خصوصية الأغذية اللي بتفرقها عن أي منتج تاني:
//   • الفاقد والتلف (spoilage) — بند ما بيوجد بالإلكترونيات
//   • الصلاحية — بضاعة ما انباعت بتصير صفر مش مخزون
//   • سلسلة التبريد — تكلفة ثابتة بترفع نقطة التعادل
//   • التغليف الغذائي أغلى من العادي
//   • المرتجعات بالدفع عند الاستلام أعلى بالأكل (الزبون بيرفض لو شكله مش حلو)
// ═══════════════════════════════════════════════════════════

export const round = (n, p = 2) => {
  const f = Math.pow(10, p);
  return Math.round((Number(n) || 0) * f) / f;
};
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const pctOf = (part, whole) => whole ? round(part * 100 / whole, 1) : 0;

// ═══════════════════════════════════════════════════════════
// المدخلات وقيمها الافتراضية — كل افتراضي مكتوب من وين جاي
// ═══════════════════════════════════════════════════════════
export const DEFAULTS = {
  sellPrice:      0,     // سعر البيع للزبون
  unitCost:       0,     // تكلفة الوحدة (جملة)
  packaging:      0.35,  // تغليف غذائي آمن — أغلى من الكرتون العادي
  shipping:       0,     // شحن الجملة موزّع على الوحدة
  delivery:       2.5,   // أجرة التوصيل للزبون (الأردن، متوسط شائع)
  deliveryCharged: 0,    // كم بتحمّل الزبون من التوصيل
  adCostPerOrder: 3,     // كلفة الإعلان لكل طلب (CPA)
  spoilageRate:   7,     // % الفاقد والتلف — الأغذية أعلى بند مهمل
  returnRate:     10,    // % مرتجعات الدفع عند الاستلام
  codFee:         0,     // عمولة شركة التوصيل على التحصيل
  monthlyFixed:   0,     // ثابت شهري: تبريد، إيجار، تراخيص، عمالة
  targetOrders:   100    // حجم شهري مستهدف
};

// ═══════════════════════════════════════════════════════════
// 📊 اقتصاديات الوحدة
//
// الدقة المهمة: المرتجع بالدفع عند الاستلام ما بيرجّعلك بضاعة
// صالحة بالأكل — بترجع تتلف. فالخسارة = التكلفة كاملة + التوصيل
// رايح جاي، مش بس فرق الربح. أغلب الحاسبات بتغلط هون.
// ═══════════════════════════════════════════════════════════
export function unitEconomics(input = {}) {
  const i = { ...DEFAULTS, ...input };
  const sell = num(i.sellPrice);
  const cost = num(i.unitCost);
  const pack = num(i.packaging);
  const ship = num(i.shipping);
  const deliv = num(i.delivery);
  const delivCharged = Math.min(num(i.deliveryCharged), deliv);
  const ad = num(i.adCostPerOrder);
  const spoil = Math.max(0, Math.min(60, num(i.spoilageRate))) / 100;
  const ret = Math.max(0, Math.min(60, num(i.returnRate))) / 100;
  const codFee = num(i.codFee);

  const errors = [];
  if (sell <= 0) errors.push("سعر البيع لازم يكون أكبر من صفر");
  if (cost <= 0) errors.push("تكلفة الوحدة لازم تكون أكبر من صفر — بلاها كل الحساب وهمي");
  if (errors.length) return { ok: false, errors };

  // ── 1) تكلفة البضاعة الفعلية بعد الفاقد ──
  // لو 7% بيتلف، فكل وحدة بتبيعها كلّفتك أكثر من سعر شرائها.
  // القسمة على (1 - نسبة الفاقد) هي الطريقة الصحيحة، مش الضرب.
  const effectiveCost = spoil < 1 ? round(cost / (1 - spoil)) : cost;
  const spoilageCost = round(effectiveCost - cost);

  // ── 2) تكلفة الطلب الناجح ──
  const netDelivery = round(deliv - delivCharged);   // اللي بتدفعه إنت
  const successCost = round(effectiveCost + pack + ship + netDelivery + ad + codFee);
  const grossPerSuccess = round(sell - successCost);

  // ── 3) خسارة الطلب المرتجع ──
  // بضاعة غذائية رجعت = تالفة. بتخسر: التكلفة + التغليف + الشحن
  // + توصيل رايح جاي + كلفة الإعلان (صرفتها وما رجعت).
  const returnLoss = round(effectiveCost + pack + ship + (deliv * 2) + ad);

  // ── 4) الربح المرجّح باحتمال المرتجع ──
  // هاد الرقم الحقيقي اللي بتربحه بالمتوسط عن كل طلب بيوصلك.
  const perOrder = round((1 - ret) * grossPerSuccess - ret * returnLoss);

  const margin = pctOf(perOrder, sell);
  const grossMargin = pctOf(grossPerSuccess, sell);
  const multiple = cost ? round(sell / cost, 2) : 0;

  // تفكيك التكلفة — عشان تعرف وين بتروح فلوسك
  const breakdown = [
    { بند: "تكلفة الوحدة", value: round(cost), share: pctOf(cost, sell) },
    { بند: "الفاقد والتلف", value: spoilageCost, share: pctOf(spoilageCost, sell),
      note: `${round(spoil * 100, 1)}% — بند خاص بالأغذية` },
    { بند: "التغليف", value: round(pack), share: pctOf(pack, sell) },
    { بند: "شحن الجملة", value: round(ship), share: pctOf(ship, sell) },
    { بند: "التوصيل (صافي)", value: netDelivery, share: pctOf(netDelivery, sell),
      note: delivCharged ? `الزبون بيدفع ${delivCharged} من أصل ${deliv}` : "إنت بتتحمّله كامل" },
    { بند: "الإعلان", value: round(ad), share: pctOf(ad, sell) },
    { بند: "عمولة التحصيل", value: round(codFee), share: pctOf(codFee, sell) },
    { بند: "كلفة المرتجعات", value: round(ret * returnLoss), share: pctOf(ret * returnLoss, sell),
      note: `${round(ret * 100, 1)}% مرتجع × ${returnLoss} خسارة الواحد` }
  ].filter(b => b.value !== 0);

  // ── التشخيص: شو بيقتل ربحك ──
  const biggest = [...breakdown].filter(b => b.بند !== "تكلفة الوحدة")
    .sort((a, b) => b.value - a.value)[0];

  const verdict = perOrder <= 0
    ? { level: "خاسر", text: `بتخسر ${Math.abs(perOrder)} عن كل طلب. المشروع بهالأرقام بيوكل رأسمالك.` }
    : margin < 10
    ? { level: "خطر", text: `هامش ${margin}% — أي ارتفاع بالتوصيل أو المرتجعات بيوديك تحت الصفر.` }
    : margin < 20
    ? { level: "ضعيف", text: `هامش ${margin}% — بيمشي بس ما بيتحمّل أخطاء ولا منافسة سعرية.` }
    : margin < 35
    ? { level: "صحي", text: `هامش ${margin}% — مساحة معقولة للنمو والاختبار.` }
    : { level: "قوي", text: `هامش ${margin}% — قوي. تأكد إنه سعرك واقعي مقابل المنافسين.` };

  return {
    ok: true,
    sell: round(sell),
    perOrder, margin, grossPerSuccess, grossMargin, multiple,
    effectiveCost, spoilageCost, successCost, returnLoss,
    breakdown, verdict,
    biggestCost: biggest ? { بند: biggest.بند, value: biggest.value, share: biggest.share } : null,
    basis: {
      المعادلة: "الربح = (1−مرتجع) × (سعر − تكلفة الطلب) − مرتجع × خسارة المرتجع",
      الفاقد: "التكلفة الفعلية = التكلفة ÷ (1 − نسبة الفاقد) — مش ضرب",
      المرتجع: "الأكل المرتجع بيتلف — الخسارة كاملة مش فرق الربح",
      "🔴": "كل الأرقام حساب مباشر من مدخلاتك. ولا رقم منها من ذكاء اصطناعي."
    }
  };
}

// ═══════════════════════════════════════════════════════════
// ⚖️ نقطة التعادل — كم طلب بالشهر لازم تبيع عشان ما تخسر
// ═══════════════════════════════════════════════════════════
export function breakEven(input = {}) {
  const u = unitEconomics(input);
  if (!u.ok) return u;
  const fixed = num(input.monthlyFixed, DEFAULTS.monthlyFixed);

  if (u.perOrder <= 0) {
    return {
      ok: true, impossible: true, perOrder: u.perOrder, fixed: round(fixed),
      text: "ما في نقطة تعادل — كل طلب بيخسّرك. زيادة الحجم بتزيد الخسارة مش بتحلها.",
      fixes: suggestFixes(input, u),
      basis: { السبب: `ربح الوحدة ${u.perOrder} (سالب أو صفر)` }
    };
  }

  const orders = Math.ceil(fixed / u.perOrder);
  const perDay = round(orders / 30, 1);
  const revenue = round(orders * u.sell);
  const target = Math.max(1, num(input.targetOrders, DEFAULTS.targetOrders));
  const targetProfit = round(target * u.perOrder - fixed);

  return {
    ok: true, impossible: false,
    perOrder: u.perOrder, fixed: round(fixed),
    ordersToBreakEven: orders,
    ordersPerDay: perDay,
    revenueToBreakEven: revenue,
    target, targetProfit,
    marginOfSafety: target > orders ? pctOf(target - orders, target) : 0,
    text: fixed > 0
      ? `لازم ${orders} طلب بالشهر (${perDay} باليوم) عشان تغطي ${round(fixed)} ثابت.`
      : "ما في مصاريف ثابتة — بتربح من أول طلب. بس سجّل ثابتك الحقيقي (تبريد، إيجار، تراخيص) عشان الرقم يصير واقعي.",
    verdict: perDay > 15
      ? "🔴 هاد حجم كبير لبداية — راجع التكاليف الثابتة أو ارفع الهامش"
      : perDay > 5 ? "🟠 ممكن بس بيحتاج إعلان جدّي من اليوم الأول"
      : "🟢 حجم واقعي للبداية",
    basis: {
      المعادلة: "طلبات التعادل = الثابت الشهري ÷ ربح الطلب الواحد",
      ربح_الطلب: `${u.perOrder} (بعد الفاقد والمرتجعات والإعلان)`,
      تنبيه: "الثابت الشهري لازم يشمل التبريد والتراخيص — أغلب الناس بينسوهم"
    }
  };
}

// ═══════════════════════════════════════════════════════════
// 🔄 تسعير عكسي — من الربح اللي بدك إياه للسعر المطلوب
// ═══════════════════════════════════════════════════════════
export function reversePricing(input = {}) {
  const i = { ...DEFAULTS, ...input };
  const targetMargin = Math.max(1, Math.min(80, num(i.targetMargin, 25))) / 100;
  const cost = num(i.unitCost);
  if (cost <= 0) return { ok: false, errors: ["أدخل تكلفة الوحدة"] };

  // منحل عكسياً: منجرّب أسعار لحد ما نوصل للهامش المطلوب.
  // (المعادلة قابلة للحل جبرياً، بس البحث الرقمي أوضح للقراءة
  //  وبيضمن إنه النتيجة متسقة مع نفس دالة unitEconomics بالضبط.)
  let lo = cost, hi = cost * 20, best = null;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    const u = unitEconomics({ ...i, sellPrice: mid });
    if (!u.ok) break;
    best = { price: round(mid), margin: u.margin, perOrder: u.perOrder };
    if (u.margin < targetMargin * 100) lo = mid; else hi = mid;
  }
  if (!best) return { ok: false, errors: ["تعذّر الحساب"] };

  const at = unitEconomics({ ...i, sellPrice: best.price });
  return {
    ok: true,
    targetMargin: round(targetMargin * 100, 1),
    suggestedPrice: best.price,
    multiple: round(best.price / cost, 2),
    economics: at,
    basis: {
      الطريقة: "بحث ثنائي على السعر لحد ما يتحقق الهامش المطلوب بنفس معادلة اقتصاديات الوحدة",
      تحذير: "السعر المطلوب رياضياً مش دايماً مقبول بالسوق — قارنه بالمنافسين قبل ما تعتمده"
    }
  };
}

// ═══════════════════════════════════════════════════════════
// 🎬 سيناريوهات — متشائم / واقعي / متفائل
// السيناريو المتشائم مقصود: أغلب المشاريع بتفشل لأن صاحبها
// خطّط على المتفائل بس.
// ═══════════════════════════════════════════════════════════
export function scenarios(input = {}) {
  const base = { ...DEFAULTS, ...input };
  const cases = [
    { name: "متشائم", adj: { adCostPerOrder: 1.6, returnRate: 1.5, spoilageRate: 1.5, ordersMul: 0.5 },
      why: "الإعلان أغلى 60%، المرتجعات والفاقد +50%، والمبيعات نص المتوقع" },
    { name: "واقعي",  adj: { adCostPerOrder: 1, returnRate: 1, spoilageRate: 1, ordersMul: 1 },
      why: "مدخلاتك كما هي" },
    { name: "متفائل", adj: { adCostPerOrder: 0.7, returnRate: 0.7, spoilageRate: 0.7, ordersMul: 1.5 },
      why: "الإعلان أرخص 30%، المرتجعات والفاقد أقل 30%، والمبيعات +50%" }
  ];

  const target = Math.max(1, num(base.targetOrders, DEFAULTS.targetOrders));
  const fixed = num(base.monthlyFixed);

  const rows = cases.map(c => {
    const inp = {
      ...base,
      adCostPerOrder: round(num(base.adCostPerOrder) * c.adj.adCostPerOrder),
      returnRate: round(num(base.returnRate) * c.adj.returnRate, 1),
      spoilageRate: round(num(base.spoilageRate) * c.adj.spoilageRate, 1)
    };
    const u = unitEconomics(inp);
    if (!u.ok) return { name: c.name, ok: false, errors: u.errors };
    const orders = Math.round(target * c.adj.ordersMul);
    const monthly = round(orders * u.perOrder - fixed);
    return {
      name: c.name, why: c.why, ok: true,
      orders, perOrder: u.perOrder, margin: u.margin,
      revenue: round(orders * u.sell),
      monthlyProfit: monthly,
      adCost: inp.adCostPerOrder, returnRate: inp.returnRate, spoilageRate: inp.spoilageRate
    };
  });

  const worst = rows.find(r => r.name === "متشائم");
  return {
    ok: true, rows, fixed: round(fixed), target,
    verdict: worst && worst.ok && worst.monthlyProfit >= 0
      ? "🟢 حتى بالسيناريو المتشائم بتربح — هاد مشروع يستاهل"
      : worst && worst.ok
      ? `🔴 بالسيناريو المتشائم بتخسر ${Math.abs(worst.monthlyProfit)} بالشهر. ` +
        `اسأل حالك: بتتحمّل هالخسارة 3 شهور لحد ما تظبط الأرقام؟`
      : "بيانات غير كافية",
    basis: {
      لماذا_المتشائم: "أغلب المشاريع بتفشل لأن صاحبها خطّط على المتفائل بس",
      المعاملات: "نسب تعديل ثابتة ومعلنة — مش عشوائية ولا من AI"
    }
  };
}

// ═══════════════════════════════════════════════════════════
// 💸 ميزانية الإطلاق والتدفق النقدي
// أهم رقم للتاجر الجديد: قديش لازم يكون بجيبتي قبل ما أبدأ
// ═══════════════════════════════════════════════════════════
export function launchBudget(input = {}) {
  const i = { ...DEFAULTS, ...input };
  const u = unitEconomics(i);
  if (!u.ok) return u;

  const testOrders = Math.max(20, num(i.testOrders, 40));   // عيّنة أول اختبار
  const firstStock = Math.max(testOrders, num(i.firstStock, testOrders * 1.5));
  const adTestBudget = num(i.adTestBudget, testOrders * num(i.adCostPerOrder));
  const licenses = num(i.licenses, 0);
  const equipment = num(i.equipment, 0);

  const items = [
    { بند: "بضاعة أول دفعة", value: round(firstStock * num(i.unitCost)),
      note: `${firstStock} وحدة × ${num(i.unitCost)}` },
    { بند: "تغليف", value: round(firstStock * num(i.packaging)) },
    { بند: "شحن الجملة", value: round(firstStock * num(i.shipping)) },
    { بند: "ميزانية اختبار الإعلان", value: round(adTestBudget),
      note: `${testOrders} طلب × ${num(i.adCostPerOrder)} كلفة متوقعة` },
    { بند: "تراخيص وتصاريح غذائية", value: round(licenses),
      note: licenses ? "" : "⚠️ صفر — تأكد إنك ما بتحتاج ترخيص لهاد الصنف" },
    { بند: "معدات (تبريد/تخزين)", value: round(equipment),
      note: equipment ? "" : "⚠️ صفر — لو المنتج بيحتاج تبريد هاد الرقم غلط" }
  ].filter(x => x.value > 0 || x.note);

  const total = round(items.reduce((s, x) => s + x.value, 0));

  // ── التدفق النقدي: الفجوة اللي بتقتل المشاريع ──
  // بالدفع عند الاستلام، فلوسك بترجع بعد أسبوع لأسبوعين من التسليم،
  // بينما الإعلان والبضاعة بتدفعهم اليوم. الفجوة هاي بتفلّس مشاريع رابحة.
  const cycleDays = Math.max(3, num(i.cashCycleDays, 14));
  const dailyOrders = Math.max(1, round(num(i.targetOrders, 100) / 30, 1));
  const cashGap = round(dailyOrders * cycleDays * (num(i.unitCost) + num(i.packaging) + num(i.adCostPerOrder)));

  return {
    ok: true, items, total,
    workingCapital: cashGap,
    totalNeeded: round(total + cashGap),
    cycleDays, dailyOrders,
    perOrder: u.perOrder,
    monthsToRecover: u.perOrder > 0
      ? round(total / (u.perOrder * Math.max(1, num(i.targetOrders, 100))), 1) : null,
    basis: {
      رأس_المال_العامل: `${dailyOrders} طلب/يوم × ${cycleDays} يوم دورة تحصيل × تكلفة الطلب المدفوعة مقدماً`,
      "🔴_الفجوة_النقدية": "بالدفع عند الاستلام بتدفع البضاعة والإعلان اليوم، وبتقبض بعد أسبوعين. " +
                           "مشاريع رابحة على الورق بتفلّس من هالفجوة — لازم يكون معك سيولة تغطيها",
      الاسترداد: u.perOrder > 0 ? "الشهور المتوقعة لاسترجاع رأس المال بالحجم المستهدف" : "غير محسوب — الربح سالب"
    }
  };
}

// ── اقتراحات إصلاح لما الأرقام تكون خاسرة ──
function suggestFixes(input, u) {
  const i = { ...DEFAULTS, ...input };
  const fixes = [];
  const test = (label, patch) => {
    const r = unitEconomics({ ...i, ...patch });
    if (r.ok) fixes.push({ الإجراء: label, ربح_الطلب: r.perOrder, الهامش: r.margin,
                           يحل_المشكلة: r.perOrder > 0 });
  };
  test(`ارفع السعر 20% (${round(num(i.sellPrice) * 1.2)})`, { sellPrice: num(i.sellPrice) * 1.2 });
  test(`نزّل تكلفة الشراء 15% (${round(num(i.unitCost) * 0.85)})`, { unitCost: num(i.unitCost) * 0.85 });
  test("حمّل الزبون التوصيل كامل", { deliveryCharged: num(i.delivery) });
  test(`نزّل كلفة الإعلان للنص (${round(num(i.adCostPerOrder) / 2)})`, { adCostPerOrder: num(i.adCostPerOrder) / 2 });
  test("نزّل المرتجعات للنص (تأكيد الطلب بمكالمة)", { returnRate: num(i.returnRate) / 2 });
  test("نزّل الفاقد للنص (تخزين وتخطيط أفضل)", { spoilageRate: num(i.spoilageRate) / 2 });
  fixes.sort((a, b) => b.ربح_الطلب - a.ربح_الطلب);

  // لو ولا إصلاح مفرد بيكفي، منجرّب الثلاثة الأقوى مع بعض.
  // مهم: التاجر لازم يعرف إذا مشكلته "تعديل بسيط" ولا "النموذج نفسه غلط".
  if (!fixes.some(f => f.يحل_المشكلة)) {
    const combo = unitEconomics({
      ...i,
      sellPrice: num(i.sellPrice) * 1.2,
      unitCost: num(i.unitCost) * 0.85,
      deliveryCharged: num(i.delivery)
    });
    if (combo.ok) fixes.push({
      الإجراء: "الثلاثة مع بعض: ارفع السعر 20% + نزّل الشراء 15% + حمّل الزبون التوصيل",
      ربح_الطلب: combo.perOrder, الهامش: combo.margin,
      يحل_المشكلة: combo.perOrder > 0, مركّب: true,
      ملاحظة: combo.perOrder > 0
        ? "بيشتغل — بس بيتطلب تنجح بثلاث جبهات مع بعض. صعب بس ممكن."
        : "🔴 حتى الثلاثة مع بعض ما بيكفوا. المشكلة مش بالتفاصيل — " +
          "النموذج نفسه ما بيمشي بهاد الصنف بهالتكلفة. دوّر على صنف أرخص أو سعر بيع أعلى."
    });
  }
  return fixes;
}

export { suggestFixes };
