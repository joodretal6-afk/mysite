// ═══════════════════════════════════════════════════════════
// 🚀 وحدة النمو (growth)
//  9) Product Opportunity Radar — رادار الفرص
// 10) Product Ranking Engine — ترتيب المنتجات
// 11) Customer Magnet Engine — مغناطيس العملاء
// 12) AI Sales Copy Lab — مختبر النسخ البيعية
// 19) Market Commander — قائد السوق
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import { db, retryDb } from "../db/database.js";
import {
  since, round, pct, confidence, reply, fail, DAY_MS, CANCEL,
  productStats, costMap, conversations, scanConversation,
  customerStats, parseItems, SIGNALS
} from "../brain/core.js";
import { recordDecision, lessons } from "../brain/learn.js";

export const slug = "growth";
export const title = "النمو والتوسع";
export const icon = "🚀";

export const router = Router();

// ═══════════════════════════════════════════════════════════
// 9) 📈 PRODUCT OPPORTUNITY RADAR — رادار الفرص
//
// المبدأ: بنقارن آخر 7 أيام بالـ7 اللي قبلهم.
// أهم إشارة عندنا: الاستفسارات ارتفعت والمبيعات ما لحقت.
// هاي بتعني طلب موجود وإنت مش ماسكه — أغلى فجوة بالتجارة.
// ═══════════════════════════════════════════════════════════
router.get("/radar", (req, res) => {
  try {
    const win = Math.min(30, Math.max(3, parseInt(req.query.window, 10) || 7));
    const now = Date.now();
    const recentFrom = now - win * DAY_MS;
    const priorFrom = now - 2 * win * DAY_MS;

    const recent = productStats(recentFrom);
    // فترة سابقة = من priorFrom لحد recentFrom
    const priorAll = productStats(priorFrom);
    const priorMap = new Map();
    for (const p of priorAll) {
      const r = recent.find(x => x.product === p.product);
      // نطرح الحديث من الإجمالي عشان نعزل الفترة السابقة
      priorMap.set(p.product, {
        qty: Math.max(0, p.qty - (r ? r.qty : 0)),
        orders: Math.max(0, p.orders - (r ? r.orders : 0)),
        revenue: round(Math.max(0, p.revenue - (r ? r.revenue : 0))),
        mentions: Math.max(0, p.mentions - (r ? r.mentions : 0)),
        askers: Math.max(0, p.askers - (r ? r.askers : 0))
      });
    }

    const signals = [];
    for (const r of recent) {
      const p = priorMap.get(r.product) || { qty: 0, orders: 0, revenue: 0, mentions: 0, askers: 0 };
      const growth = (a, b) => b > 0 ? round((a - b) * 100 / b, 1) : (a > 0 ? null : 0);
      const askGrowth = growth(r.askers, p.askers);
      const salesGrowth = growth(r.orders, p.orders);
      const revGrowth = growth(r.revenue, p.revenue);

      // العيّنة لازم تكون معقولة قبل ما نصرخ
      if (r.askers < 5 && r.orders < 3) continue;

      let flag = null, why = "", priority = 0;
      if (askGrowth != null && askGrowth >= 40 && (salesGrowth == null || salesGrowth < askGrowth / 2)) {
        flag = "🔴 طلب مش ممسوك";
        why = `الاستفسارات ارتفعت ${askGrowth}% بس المبيعات ${salesGrowth == null ? "ما تحركت" : salesGrowth + "%"} — ` +
              `الناس بتسأل وما بتشتري. افحص السعر والتوفر وسرعة الرد.`;
        priority = 100;
      } else if (askGrowth != null && askGrowth >= 40 && salesGrowth != null && salesGrowth >= 40) {
        flag = "🟢 صاعد";
        why = `الاستفسارات +${askGrowth}% والمبيعات +${salesGrowth}% — الطلب حقيقي. وسّع بسرعة قبل ما ينطفي.`;
        priority = 90;
      } else if (salesGrowth != null && salesGrowth <= -35) {
        flag = "🟠 هابط";
        why = `المبيعات نزلت ${Math.abs(salesGrowth)}% — افحص التوفر، المنافسة، أو موسمية المنتج.`;
        priority = 70;
      } else if (r.askToOrder != null && r.askers >= 12 && r.askToOrder < 12) {
        flag = "🟡 تسريب";
        why = `${r.askers} سأل وبس ${r.askToOrder}% اشترى — عندك تسريب مستمر مش موسمي.`;
        priority = 60;
      }
      if (!flag) continue;

      signals.push({
        product: r.product, flag, why, priority,
        recent: { askers: r.askers, orders: r.orders, qty: r.qty, revenue: r.revenue },
        prior: p,
        askGrowth, salesGrowth, revGrowth,
        askToOrder: r.askToOrder,
        confidence: confidence(r.askers + r.orders, { low: 15, mid: 50 })
      });
    }
    signals.sort((a, b) => b.priority - a.priority);

    if (signals.length)
      recordDecision("radar", `رادار: ${signals[0].flag} ${signals[0].product}`, signals[0].why,
        { window: win, count: signals.length }, signals[0].confidence);

    reply(res, {
      window: win, total: signals.length, signals,
      headline: signals.length ? `${signals[0].product}: ${signals[0].why}`
                               : `ما في تحركات لافتة بآخر ${win} يوم`
    }, {
      المقارنة: `آخر ${win} يوم مقابل الـ${win} اللي قبلهم`,
      المصدر: "طلباتك + ذكر المنتجات برسائل الزبائن",
      قيد: "نافذة قصيرة = تقلّب أعلى. النسب المئوية على أعداد صغيرة بتضخّم"
    });
  } catch (e) { fail(res, e, "فشل تشغيل الرادار"); }
});

// ═══════════════════════════════════════════════════════════
// 10) 🥇 PRODUCT RANKING ENGINE — ترتيب المنتجات
//
// الترتيب مركّب من 6 محاور موزونة. مهم: الوزن الأكبر للربح
// مش للإيراد — لأن أكثر منتج بيبيع مش دايماً أكثر منتج بيربّح،
// وهاد الخلط بيفلّس تجّار وهم "ناجحين" بالأرقام.
// ═══════════════════════════════════════════════════════════
router.get("/ranking", (req, res) => {
  try {
    const { days, from } = since(req, 90);
    const stats = productStats(from).filter(s => s.orders > 0 || s.askers > 0);
    if (!stats.length) return reply(res, { days, rows: [] }, { ملاحظة: "ما في بيانات كافية" });

    const max = k => Math.max(...stats.map(s => Number(s[k]) || 0), 1);
    const mx = { profit: max("profit"), revenue: max("revenue"), qty: max("qty"),
                 askers: max("askers"), buyers: max("buyers") };

    const rows = stats.map(s => {
      const axes = {
        الربح:        { v: round((Math.max(0, s.profit) / mx.profit) * 100), w: 0.30, raw: s.profit },
        الطلب:        { v: round((s.qty / mx.qty) * 100), w: 0.20, raw: s.qty },
        التحويل:      { v: s.askToOrder != null ? Math.min(100, s.askToOrder * 2) : 40, w: 0.20,
                        raw: s.askToOrder != null ? s.askToOrder + "%" : "غير معروف" },
        الاستفسارات:  { v: round((s.askers / mx.askers) * 100), w: 0.10, raw: s.askers },
        تكرار_الشراء: { v: Math.min(100, s.repeatRate * 50), w: 0.10, raw: s.repeatRate },
        سلامة_الإلغاء:{ v: Math.max(0, 100 - s.cancelRate * 2), w: 0.10, raw: s.cancelRate + "%" }
      };
      const score = round(Object.values(axes).reduce((t, a) => t + a.v * a.w, 0), 1);

      let verdict, action;
      if (score >= 65 && s.margin >= 25) {
        verdict = "🏆 وسّع"; action = "زوّد المخزون والميزانية — هاد بيربّح وبيتحرك";
      } else if (s.askToOrder != null && s.askers >= 10 && s.askToOrder < 15) {
        verdict = "🔧 عدّل"; action = "الاهتمام موجود والتحويل ضعيف — المشكلة بالسعر أو العرض مش بالمنتج";
      } else if (s.margin < 12 && s.hasCost) {
        verdict = "🔧 عدّل"; action = `هامش ${s.margin}% ما بيطعمي — ارفع السعر أو نزّل التكلفة`;
      } else if (s.cancelRate >= 30) {
        verdict = "🔧 عدّل"; action = `إلغاء ${s.cancelRate}% — في فجوة بين التوقّع والواقع`;
      } else if (score < 30 && s.orders <= 2) {
        verdict = "🛑 أوقف الاختبار"; action = "ما أثبت نفسه — وقتك وميزانيتك أنفع بغيره";
      } else {
        verdict = "⏳ راقب"; action = "أداء متوسط — استنى بيانات أكثر";
      }

      return {
        product: s.product, score, verdict, action, axes,
        orders: s.orders, qty: s.qty, revenue: s.revenue, profit: s.profit,
        margin: s.margin, askers: s.askers, askToOrder: s.askToOrder,
        cancelRate: s.cancelRate, repeatRate: s.repeatRate, hasCost: s.hasCost,
        confidence: confidence(s.orders + s.askers, { low: 15, mid: 60 })
      };
    }).sort((a, b) => b.score - a.score);

    const groups = {
      وسّع: rows.filter(r => r.verdict.includes("وسّع")),
      عدّل: rows.filter(r => r.verdict.includes("عدّل")),
      أوقف: rows.filter(r => r.verdict.includes("أوقف")),
      راقب: rows.filter(r => r.verdict.includes("راقب"))
    };

    reply(res, {
      days, rows, groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
      noCost: rows.filter(r => !r.hasCost).length
    }, {
      الأوزان: "ربح 30% · طلب 20% · تحويل 20% · استفسارات 10% · تكرار 10% · سلامة إلغاء 10%",
      لماذا_الربح_أولاً: "أكثر منتج بيبيع مش دايماً أكثر واحد بيربّح",
      تنبيه: rows.filter(r => !r.hasCost).length
        ? `${rows.filter(r => !r.hasCost).length} منتج بلا تكلفة مسجّلة — ترتيبهم ناقص`
        : "كل المنتجات عندها تكلفة مسجّلة"
    });
  } catch (e) { fail(res, e, "فشل ترتيب المنتجات"); }
});

// ═══════════════════════════════════════════════════════════
// 11) 🧲 CUSTOMER MAGNET — ليش الناس بتنجذب لمنتج
// بيستخرج من كلام زبائنك الحقيقي: Hook / Benefit / Objection / CTA
// ═══════════════════════════════════════════════════════════
function magnetFor(productName, convs, buyers) {
  const p = String(productName).toLowerCase();
  const relevant = convs.filter(cv =>
    cv.msgs.some(m => m.dir === "in" && String(m.body || "").toLowerCase().includes(p)));
  if (!relevant.length) return null;

  const asks = new Map(), objs = new Map(), quotes = [];
  let bought = 0;
  for (const cv of relevant) {
    if (buyers.has(cv.sender_id)) bought++;
    const scan = scanConversation(cv);
    for (const o of scan.objections) objs.set(o.label, (objs.get(o.label) || 0) + 1);
    for (const m of cv.msgs) {
      if (m.dir !== "in") continue;
      const t = String(m.body || "");
      if (!t.toLowerCase().includes(p)) continue;
      if (quotes.length < 12) quotes.push(t.slice(0, 140));
      // شو بيسألوا عنه بالضبط — هاد بيقلك شو بيهمهم
      for (const [k, sig] of Object.entries(SIGNALS)) {
        if (!k.startsWith("intent")) continue;
        for (const w of sig.words)
          if (t.toLowerCase().includes(w)) { asks.set(w, (asks.get(w) || 0) + 1); break; }
      }
    }
  }

  const topObj = [...objs.entries()].sort((a, b) => b[1] - a[1]);
  const topAsk = [...asks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const conv = pct(bought, relevant.length);

  return {
    product: productName,
    conversations: relevant.length, bought, conversionRate: conv,
    hook: topAsk.length
      ? `أكثر شي بيسألوا عنه: "${topAsk[0][0]}" (${topAsk[0][1]} مرة) — ابدأ إعلانك من هون`
      : "ما في نمط سؤال واضح لسه",
    benefit: conv >= 25
      ? `${conv}% ممن سألوا اشتروا — المنتج بيبيع حاله لما يوصل للشخص الصح`
      : `${conv}% بس اشتروا — الرسالة مش واصلة أو في مانع`,
    objection: topObj.length
      ? `${topObj[0][0]} (${topObj[0][1]} مرة) — عالجها بالإعلان قبل ما يسألوها`
      : "ما في اعتراض متكرر",
    cta: conv >= 25 ? "اطلب الآن — التوصيل لباب البيت" : "اسأل عن التفاصيل بلا التزام",
    positioning: topObj.length && topObj[0][0] === "السعر"
      ? "موقعك: القيمة مقابل السعر. اشرح ليش بيستاهل."
      : topObj.length && topObj[0][0] === "الثقة والجودة"
      ? "موقعك: الضمان والأصالة. صور وفيديو حقيقي وسياسة إرجاع واضحة."
      : "موقعك: السهولة والسرعة.",
    questions: topAsk.map(([w, n]) => ({ q: w, times: n })),
    quotes
  };
}

router.get("/magnet", (req, res) => {
  try {
    const { days, from } = since(req, 90);
    const only = String(req.query.product || "").trim();
    const convs = conversations(from);
    const buyers = new Set(retryDb(() => db.prepare(
      `SELECT DISTINCT sender_id FROM orders WHERE created_at >= ? AND status <> ?`
    ).all(from, CANCEL)).map(r => r.sender_id));

    const products = only ? [only]
      : productStats(from).sort((a, b) => b.askers - a.askers).slice(0, 12).map(s => s.product);

    const rows = products.map(p => magnetFor(p, convs, buyers)).filter(Boolean)
      .sort((a, b) => b.conversations - a.conversations);

    reply(res, { days, rows }, {
      المصدر: `${convs.length} محادثة حقيقية من صفحاتك`,
      الطريقة: "استخراج الأسئلة والاعتراضات المتكررة من كلام الزبائن نفسه",
      قوة_هالطريقة: "الزوايا الإعلانية طالعة من لغة زبونك مش من خيالنا"
    });
  } catch (e) { fail(res, e, "فشل تحليل الانجذاب"); }
});

// ═══════════════════════════════════════════════════════════
// 12) ✍️ AI SALES COPY LAB — مختبر النسخ البيعية
// النسخة مبنية من: بيانات المنتج + اعتراضات زبائنك + العرض.
// مش نص عام — نص طالع من واقعك.
// ═══════════════════════════════════════════════════════════
router.get("/copy", (req, res) => {
  try {
    const product = String(req.query.product || "").trim();
    if (!product) return res.status(400).json({ error: "حدّد المنتج" });
    const { days, from } = since(req, 90);

    const convs = conversations(from);
    const buyers = new Set(retryDb(() => db.prepare(
      `SELECT DISTINCT sender_id FROM orders WHERE created_at >= ? AND status <> ?`
    ).all(from, CANCEL)).map(r => r.sender_id));
    const magnet = magnetFor(product, convs, buyers);
    const stat = productStats(from).find(s => s.product === product);
    const price = stat && stat.qty ? round(stat.revenue / stat.qty) : null;

    if (!magnet)
      return res.status(404).json({ error: "ما في محادثات كافية عن هاد المنتج لبناء نسخة مبنية على بيانات" });

    const objLabel = magnet.objection.split(" (")[0];
    const topQ = magnet.questions.length ? magnet.questions[0].q : "التفاصيل";

    // كل نسخة معها زاويتها وأساسها — عشان تعرف ليش تختبرها
    const variants = [
      {
        angle: "معالجة الاعتراض",
        why: `"${objLabel}" أكثر اعتراض على ${product} — النسخة بتقتله من أول سطر`,
        headline: objLabel === "السعر" ? `${product} — بسعر بيستاهل، وهاي الأسباب`
                : objLabel === "التوصيل" ? `${product} — يوصلك لباب بيتك`
                : objLabel === "الثقة والجودة" ? `${product} أصلي ومضمون — شوف بعينك`
                : `${product} — بلا تفكير طويل`,
        body: `${magnet.positioning}\n\nأكثر شي بيسألوا عنه: ${topQ}.\nالجواب واضح والتفاصيل كلها موجودة.`,
        cta: magnet.cta
      },
      {
        angle: "الدليل الاجتماعي",
        why: `${magnet.bought} زبون اشتروه فعلياً من ${magnet.conversations} سألوا`,
        headline: `${magnet.bought} زبون اختاروا ${product}`,
        body: `مش كلام — أرقام. ${magnet.conversionRate}% ممن سألوا عنه طلبوه.\n${magnet.benefit}`,
        cta: "انضم إلهم — اطلب اليوم"
      },
      {
        angle: "السؤال المباشر",
        why: `الناس بتفتح المحادثة بـ"${topQ}" — النسخة بتبلّش من نفس مكانهم`,
        headline: `${topQ}؟ خلينا نجاوبك عن ${product}`,
        body: `${price ? `السعر ${price}. ` : ""}${magnet.positioning}\nاسأل أي شي — بنرد بسرعة.`,
        cta: "ابعتلنا رسالة"
      }
    ];

    const messenger = `مرحبا 👋\nشفت إنك سألت عن ${product}.\n` +
      `${price ? `سعره ${price}. ` : ""}${objLabel !== "ما في اعتراض متكرر" ? `وبخصوص ${objLabel} — ` : ""}` +
      `احكيلي شو بيهمك بالضبط وبرتبلك ياه.`;

    reply(res, {
      product, price, variants,
      messenger,
      productPage: {
        title: variants[0].headline,
        bullets: [
          magnet.hook, magnet.benefit, magnet.objection, magnet.positioning
        ],
        cta: magnet.cta
      },
      testAdvice: `اختبر "${variants[0].angle}" مقابل "${variants[1].angle}" أول — ` +
                  `هدول أبعد زاويتين عن بعض، فالفرق بينهم بيبان بأسرع وقت`,
      confidence: confidence(magnet.conversations, { low: 15, mid: 60 })
    }, {
      المصدر: `${magnet.conversations} محادثة عن ${product}`,
      الطريقة: "النسخة مبنية من أسئلة واعتراضات زبائنك الفعلية",
      "🔴_مهم": "ولا رقم بالنسخة مخترع. لو ما عندنا الرقم ما بنكتبه — الادعاء الكاذب بيكسر ثقة الزبون وبيعرّضك قانونياً"
    });
  } catch (e) { fail(res, e, "فشل توليد النسخ"); }
});

// ═══════════════════════════════════════════════════════════
// 19) 🏆 MARKET COMMANDER — خطة دخول السوق
// بيبني خطة كاملة من بياناتك + مدخلات التاجر.
// اللي ما عندنا عنه بيانات بنقول عنه "يحتاج بحث منك" — ما بنخترعه.
// ═══════════════════════════════════════════════════════════
router.post("/market-plan", (req, res) => {
  try {
    const b = req.body || {};
    const product = String(b.product || "").trim();
    const country = String(b.country || "").trim() || "غير محدّد";
    const category = String(b.category || "").trim() || "غير محدّد";
    if (!product) return res.status(400).json({ error: "أدخل اسم المنتج" });

    const from = Date.now() - 180 * DAY_MS;
    const convs = conversations(from);
    const buyers = new Set(retryDb(() => db.prepare(
      `SELECT DISTINCT sender_id FROM orders WHERE created_at >= ? AND status <> ?`
    ).all(from, CANCEL)).map(r => r.sender_id));

    // في بيانات عن منتج شبيه عندنا؟
    const magnet = magnetFor(product, convs, buyers);
    const stats = productStats(from);
    const similar = stats.filter(s =>
      s.product.toLowerCase().includes(product.toLowerCase()) ||
      product.toLowerCase().includes(s.product.toLowerCase()));

    const customers = customerStats(from);
    const withOrders = customers.filter(c => c.orders > 0);
    const areas = new Map();
    for (const c of withOrders) for (const a of c.areas) areas.set(a, (areas.get(a) || 0) + 1);
    const topAreas = [...areas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const aov = withOrders.length
      ? round(withOrders.reduce((s, c) => s + c.spend, 0) / withOrders.reduce((s, c) => s + c.orders, 0)) : 0;

    // الاعتراضات العامة عندك — بتنطبق على أي منتج جديد كمان
    const objAll = new Map();
    for (const cv of convs)
      for (const o of scanConversation(cv).objections)
        objAll.set(o.label, (objAll.get(o.label) || 0) + 1);
    const topObj = [...objAll.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

    const hasData = !!(magnet || similar.length);

    const plan = {
      product, country, category,
      dataBacked: hasData,

      targetCustomer: {
        value: withOrders.length
          ? `زبونك الحالي: متوسط طلب ${aov}، أكثر مناطق طلباً ${topAreas.map(a => a[0]).slice(0, 3).join("، ") || "غير مسجّلة"}`
          : "ما عندك تاريخ طلبات كافي لرسم الملف",
        basis: `${withOrders.length} زبون فعلي، ${topAreas.length} منطقة`,
        source: "بياناتك"
      },
      positioning: {
        value: magnet ? magnet.positioning
          : topObj.length && topObj[0][0] === "السعر"
          ? "زبائنك حساسين للسعر عموماً — ابدأ بموقع القيمة مقابل السعر"
          : "يحتاج تحديد بعد أول أسبوع بيانات",
        basis: magnet ? `${magnet.conversations} محادثة عن المنتج` : `${convs.length} محادثة عامة`,
        source: magnet ? "بياناتك" : "استنتاج من نمطك العام"
      },
      pricing: {
        value: similar.length && similar[0].qty
          ? `منتج مشابه عندك بيتباع بـ${round(similar[0].revenue / similar[0].qty)} — ابدأ قريب منه واختبر`
          : `متوسط طلبك ${aov} — ابدأ ضمن هالمدى واختبر صعوداً`,
        basis: similar.length ? `منتج مشابه: ${similar[0].product}` : `متوسط ${aov} من ${withOrders.length} زبون`,
        source: "بياناتك"
      },
      offer: {
        value: topObj.length && topObj[0][0] === "التوصيل"
          ? "ابدأ بتوصيل مجاني — التوصيل أكبر اعتراض عند زبائنك"
          : "ابدأ بعرض أول طلب — أسهل طريقة تكسر التردد",
        basis: topObj.length ? `أكثر اعتراض: ${topObj[0][0]} (${topObj[0][1]} مرة)` : "لا يوجد نمط اعتراض",
        source: "بياناتك"
      },
      competition: {
        value: "🔴 ما عندي بيانات منافسين — النظام ما بيسحب بيانات من برّا",
        basis: "لا يوجد",
        source: "يحتاج بحث منك",
        todo: "افحص 3 منافسين يدوياً: سعرهم، عرضهم، سرعة توصيلهم"
      },
      channels: {
        value: (() => {
          const byPage = new Map();
          for (const c of withOrders) byPage.set(c.page_name || "غير معروف",
            (byPage.get(c.page_name || "غير معروف") || 0) + c.orders);
          const top = [...byPage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
          return top.length ? `أقوى قنواتك: ${top.map(t => `${t[0]} (${t[1]} طلب)`).join("، ")}`
                            : "ما في قنوات مسجّلة";
        })(),
        basis: `${withOrders.length} زبون موزّعين على صفحاتك`,
        source: "بياناتك"
      },
      messaging: {
        value: magnet ? [magnet.hook, magnet.objection, magnet.cta]
                      : topObj.map(o => `عالج اعتراض "${o[0]}" — طلع ${o[1]} مرة`),
        basis: magnet ? `${magnet.conversations} محادثة` : `${convs.length} محادثة`,
        source: "بياناتك"
      },
      complements: {
        value: similar.length
          ? stats.filter(s => s.product !== similar[0].product).slice(0, 4).map(s => s.product)
          : stats.slice(0, 4).map(s => s.product),
        basis: "منتجاتك الحالية الأكثر حركة",
        source: "بياناتك"
      },
      risks: [
        !hasData ? "🔴 ما عندك بيانات عن هاد المنتج — الخطة مبنية على نمطك العام، والثقة فيها منخفضة" : null,
        topObj.length ? `اعتراض "${topObj[0][0]}" رح يواجهك بهاد المنتج كمان — جهّز جوابه قبل الإطلاق` : null,
        !aov ? "ما في متوسط طلب مسجّل — صعب تحدد سعر مرجعي" : null,
        "المنافسة غير معروفة — هاي أكبر فجوة بالخطة"
      ].filter(Boolean),

      plan30: [
        "أسبوع 1: أطلق بمنتج واحد وسعر واحد. لا تختبر متغيّرين مع بعض.",
        `أسبوع 1: جهّز رد جاهز لاعتراض "${topObj.length ? topObj[0][0] : "السعر"}"`,
        "أسبوع 2: قيس تحويل الاستفسار لطلب. تحت 15% = المشكلة بالعرض مش بالحجم.",
        "أسبوع 3: شغّل أول تجربة A/B على الزاوية الإعلانية.",
        "أسبوع 4: احسب الربح الفعلي بعد التكلفة والتوصيل والإلغاء — مش الإيراد."
      ],
      plan90: [
        "شهر 2: وسّع اللي ثبت بس. المنتج اللي ما وصل 20% تحويل بعد 60 يوم أوقفه.",
        "شهر 2: ابنِ منتج مكمّل للي نجح — الزبون الحالي أرخص من زبون جديد.",
        "شهر 3: اشتغل على الطلب الثاني. تكرار الشراء هو اللي بيبني تجارة.",
        "شهر 3: راجع دروس النظام المتراكمة وطبّق اللي ثبت إحصائياً."
      ],
      confidence: hasData
        ? confidence(magnet ? magnet.conversations : similar[0].orders, { low: 20, mid: 80 })
        : { level: "منخفضة", score: 1, n: 0, note: "ما في بيانات عن هاد المنتج تحديداً" }
    };

    recordDecision("market-commander", `خطة دخول: ${product} / ${country}`,
      `مبنية على ${hasData ? "بيانات منتج مشابه" : "النمط العام فقط"}`,
      { product, country, category, hasData }, plan.confidence);

    reply(res, { plan }, {
      المصدر: `${convs.length} محادثة، ${withOrders.length} زبون، ${stats.length} منتج`,
      "🔴_صراحة": "كل بند مكتوب جنبه مصدره. اللي مكتوب 'يحتاج بحث منك' يعني ما عندي بيانات عنه وما رح أخترعه",
      قيد: "ما في بيانات منافسين ولا بيانات سوق خارجية — النظام بيشتغل على بياناتك بس"
    });
  } catch (e) { fail(res, e, "فشل بناء خطة السوق"); }
});
