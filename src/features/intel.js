// ═══════════════════════════════════════════════════════════
// 🧠 وحدة ذكاء العملاء (intel)
// 1) Customer Brain — عقل العميل
// 2) Purchase Intent Engine — محرك نية الشراء
// 3) Lost Money Detector — كاشف الفلوس الضائعة
// 5) Customer DNA — شرائح تلقائية
// 6) Objection Miner — منجم الاعتراضات
//
// كل شي هون مبني على بياناتك إنت: رسائل صفحاتك وطلباتك.
// ولا استخراج من برّا، ولا شراء بيانات، ولا تتبّع خارج المنصة.
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import { db, retryDb } from "../db/database.js";
import {
  since, round, pct, confidence, reply, fail, DAY_MS, CANCEL,
  conversations, customerStats, scanConversation, productStats,
  parseItems, SIGNALS, OBJECTIONS, replyDelayMin
} from "../brain/core.js";
import { recordDecision } from "../brain/learn.js";

export const slug = "intel";
export const title = "ذكاء العملاء";
export const icon = "🧠";

export const router = Router();

// ═══════════════════════════════════════════════════════════
// 1) 🧠 CUSTOMER BRAIN — عقل العميل
// ملف سلوكي كامل لكل زبون، من بياناتك المتاحة فقط.
// ═══════════════════════════════════════════════════════════
router.get("/brain", (req, res) => {
  try {
    const { days, from } = since(req, 90);
    const q = String(req.query.q || "").trim().toLowerCase();
    const limit = Math.min(500, Math.max(10, parseInt(req.query.limit, 10) || 100));

    let list = customerStats(from);
    if (q) list = list.filter(c =>
      c.sender_id.includes(q) || (c.page_name || "").toLowerCase().includes(q) ||
      c.products.some(p => p.name.toLowerCase().includes(q)));

    // ترتيب حسب الأهمية الفعلية: مين يستاهل انتباهك اليوم
    list.sort((a, b) => (b.spend + b.intent * 2) - (a.spend + a.intent * 2));

    const rows = list.slice(0, limit).map(c => ({
      ...c,
      dna: classifyDNA(c),
      buyProbability: buyProbability(c),
      url: "https://m.me/" + c.sender_id
    }));

    reply(res, {
      days, total: list.length, rows,
      summary: {
        زبائن_معروفين: list.length,
        منهم_اشتروا: list.filter(c => c.orders > 0).length,
        منهم_حكوا_وما_اشتروا: list.filter(c => c.orders === 0 && c.messagesIn > 0).length,
        عالي_النية: list.filter(c => c.intent >= 70).length
      }
    }, {
      المصدر: "جدول messages + جدول orders لصفحاتك",
      الفترة: `آخر ${days} يوم`,
      ملاحظة: "احتمالية الشراء تقدير من سلوك سابق — مش وعد"
    });
  } catch (e) { fail(res, e, "فشل بناء ملفات العملاء"); }
});

// ── ملف زبون واحد بالتفصيل ──
router.get("/brain/:senderId", (req, res) => {
  try {
    const sid = String(req.params.senderId);
    const from = Date.now() - 365 * DAY_MS;
    const c = customerStats(from).find(x => x.sender_id === sid);
    if (!c) return res.status(404).json({ error: "ما لقينا هاد الزبون" });

    const conv = conversations(from).find(x => x.sender_id === sid);
    const scan = conv ? scanConversation(conv) : null;
    const timeline = retryDb(() => db.prepare(
      `SELECT order_string, total, status, created_at FROM orders
       WHERE sender_id = ? ORDER BY created_at DESC LIMIT 50`
    ).all(sid));

    reply(res, {
      customer: { ...c, dna: classifyDNA(c), buyProbability: buyProbability(c) },
      intentBreakdown: scan ? scan.reasons : [],
      orders: timeline,
      messages: conv ? conv.msgs.slice(-40) : []
    }, { المصدر: "كل سجل هذا الزبون عندك", ملاحظة: "سبب كل نقطة بالنية مبيّن بالتفصيل" });
  } catch (e) { fail(res, e, "فشل جلب ملف الزبون"); }
});

// ═══════════════════════════════════════════════════════════
// 2) 🔥 PURCHASE INTENT ENGINE — محرك نية الشراء
// كل محادثة بتاخد 0–100، والأهم: ليش أخذت هالرقم.
// ═══════════════════════════════════════════════════════════
router.get("/intent", (req, res) => {
  try {
    const { days, from } = since(req, 30);
    const minScore = Math.max(0, Math.min(100, parseInt(req.query.min, 10) || 0));
    const convs = conversations(from);

    // مين طلب فعلياً — عشان نفصل "نية" عن "زبون خلص اشترى"
    const buyers = new Set(retryDb(() => db.prepare(
      `SELECT DISTINCT sender_id FROM orders WHERE created_at >= ? AND status <> ?`
    ).all(from, CANCEL)).map(r => r.sender_id));

    const rows = convs.map(cv => {
      const scan = scanConversation(cv);
      const bought = buyers.has(cv.sender_id);
      return {
        page_id: cv.page_id, page_name: cv.page_name, sender_id: cv.sender_id,
        intent: scan.intent,
        stage: bought ? "عميل" : scan.stage,
        bought,
        reasons: scan.reasons,           // ← ليش هالدرجة
        objections: scan.objections,
        messages: cv.inCount,
        last_at: cv.last_at,
        replyDelayMin: replyDelayMin(cv),
        url: "https://m.me/" + cv.sender_id
      };
    }).filter(r => r.intent >= minScore)
      .sort((a, b) => b.intent - a.intent);

    // القمع الحقيقي
    const stages = ["بارد", "فضولي", "مهتم", "جاهز للشراء", "عميل"];
    const funnel = stages.map(s => ({ stage: s, n: rows.filter(r => r.stage === s).length }));

    // 🔴 الرقم اللي بيوجع: جاهزين للشراء وما صاروا زباين
    const hotNotBought = rows.filter(r => r.stage === "جاهز للشراء" && !r.bought);

    reply(res, {
      days, total: rows.length, funnel,
      hotNotBought: hotNotBought.length,
      hotList: hotNotBought.slice(0, 50),
      rows: rows.slice(0, 300),
      confidence: confidence(rows.length)
    }, {
      المصدر: `${convs.length} محادثة من صفحاتك`,
      الطريقة: "معجم إشارات عربي موزون + وزن للرسائل الأحدث + إشارات سلوكية",
      تحذير: "الدرجة تقدير لغوي — راجع المحادثة قبل أي إجراء"
    });
  } catch (e) { fail(res, e, "فشل حساب نية الشراء"); }
});

// ═══════════════════════════════════════════════════════════
// 3) 💰 LOST MONEY DETECTOR — كاشف الفلوس الضائعة
// كل يوم بيقلك: كم محادثة ما صارت طلب، وليش، وقديش بتساوي.
// ═══════════════════════════════════════════════════════════
router.get("/lost", (req, res) => {
  try {
    const { days, from } = since(req, 30);
    const convs = conversations(from);
    const buyers = new Set(retryDb(() => db.prepare(
      `SELECT DISTINCT sender_id FROM orders WHERE created_at >= ? AND status <> ?`
    ).all(from, CANCEL)).map(r => r.sender_id));

    // متوسط قيمة الطلب — أساس تقدير قيمة الفرصة
    const biz = retryDb(() => db.prepare(
      `SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM orders
       WHERE created_at >= ? AND status <> ?`
    ).get(from, CANCEL));
    const aov = Number(biz && biz.n) ? round(Number(biz.s) / Number(biz.n)) : 0;

    const lost = [];
    const byReason = new Map();
    for (const cv of convs) {
      if (buyers.has(cv.sender_id)) continue;      // هاد اشترى، مش ضايع
      const scan = scanConversation(cv);
      if (scan.intent < 30) continue;              // بارد تماماً — مش فرصة ضائعة، هاد ما كان زبون
      // سبب الضياع = أقوى اعتراض، وإذا ما في اعتراض منشوف السلوك
      let reason, reasonKey;
      if (scan.objections.length) {
        reasonKey = scan.objections[0].key;
        reason = scan.objections[0].label;
      } else if (replyDelayMin(cv) === null && cv.inCount > 0) {
        reasonKey = "no_reply"; reason = "ما إجاه رد أصلاً";
      } else if ((replyDelayMin(cv) || 0) > 60) {
        reasonKey = "obj_delay"; reason = "بطء الرد";
      } else {
        reasonKey = "unknown"; reason = "غير محدد";
      }

      // قيمة الفرصة مرجّحة بالنية — مش كل محادثة بتساوي طلب كامل
      const value = round(aov * (scan.intent / 100));
      lost.push({
        page_name: cv.page_name, sender_id: cv.sender_id,
        intent: scan.intent, reason, reasonKey, value,
        messages: cv.inCount, last_at: cv.last_at,
        url: "https://m.me/" + cv.sender_id
      });
      const b = byReason.get(reasonKey) || { key: reasonKey, reason, n: 0, value: 0 };
      b.n++; b.value = round(b.value + value);
      byReason.set(reasonKey, b);
    }

    const total = lost.length;
    const reasons = [...byReason.values()]
      .map(r => ({ ...r, share: pct(r.n, total) }))
      .sort((a, b) => b.value - a.value);      // ← مرتّبة حسب الفلوس مش حسب العدد
    const totalValue = round(reasons.reduce((s, r) => s + r.value, 0));

    // نسجّل القرار عشان نحاسب حالنا لاحقاً
    if (reasons.length) {
      recordDecision("lost-money", `أكبر سبب ضياع: ${reasons[0].reason}`,
        `${reasons[0].n} محادثة (${reasons[0].share}%) بقيمة تقديرية ${reasons[0].value}`,
        { total, totalValue, aov, days }, confidence(total));
    }

    reply(res, {
      days, total, totalValue, aov, reasons,
      rows: lost.sort((a, b) => b.value - a.value).slice(0, 300),
      confidence: confidence(total),
      headline: total
        ? `عندك ${total} محادثة ما تحوّلت لطلب، بقيمة تقديرية ${totalValue}`
        : "ما في فرص ضائعة مسجّلة بهالفترة"
    }, {
      المصدر: `${convs.length} محادثة، ${Number(biz && biz.n) || 0} طلب`,
      حساب_القيمة: `متوسط الطلب (${aov}) × درجة النية ÷ 100`,
      تحذير: "القيمة تقديرية — مش كل محادثة كانت رح تصير طلب"
    });
  } catch (e) { fail(res, e, "فشل كشف الفرص الضائعة"); }
});

// ═══════════════════════════════════════════════════════════
// 5) 🧬 CUSTOMER DNA — شرائح تلقائية من السلوك
// مش "جديد/قديم". شرائح بتفيدك فعلياً بالتعامل.
// ═══════════════════════════════════════════════════════════
function classifyDNA(c) {
  const tags = [];
  const objKeys = (c.objections || []).map(o => o.key);

  if (c.orders >= 3) tags.push({ tag: "عميل متكرر", why: `${c.orders} طلب` });
  if (c.spend >= 300 || (c.aov >= 100 && c.orders >= 2))
    tags.push({ tag: "عالي القيمة", why: `أنفق ${c.spend}` });
  if (objKeys.includes("obj_price"))
    tags.push({ tag: "عميل السعر", why: "اعترض على السعر" });
  if (objKeys.includes("obj_trust"))
    tags.push({ tag: "عميل الجودة", why: "سأل عن الأصلية/الضمان" });
  if (objKeys.includes("obj_hesitation"))
    tags.push({ tag: "متردد", why: "قال بفكر/بشوف" });
  if (c.messagesIn >= 8 && c.orders === 0)
    tags.push({ tag: "بيسأل كثير وما بيشتري", why: `${c.messagesIn} رسالة بلا طلب` });
  if (c.messagesIn > 0 && c.messagesIn <= 3 && c.orders >= 1)
    tags.push({ tag: "بيشتري بسرعة", why: `طلب بعد ${c.messagesIn} رسالة` });
  if (c.orders === 0 && c.intent >= 70)
    tags.push({ tag: "فرصة ساخنة", why: `نية ${c.intent}% بلا طلب` });
  if (c.cancelled >= 2)
    tags.push({ tag: "كثير الإلغاء", why: `${c.cancelled} إلغاء` });
  if (c.daysSinceOrder != null && c.daysSinceOrder > 90 && c.orders >= 2)
    tags.push({ tag: "زبون فقدناه", why: `${c.daysSinceOrder} يوم بلا طلب` });
  if (c.avgGapDays != null && c.avgGapDays <= 30 && c.orders >= 3)
    tags.push({ tag: "منتظم", why: `بيطلب كل ${c.avgGapDays} يوم` });

  if (!tags.length) tags.push({ tag: "لسه ما تحدد", why: "بيانات غير كافية" });
  return tags;
}

// احتمالية الشراء — تقدير صريح، مبني على عوامل مبيّنة
function buyProbability(c) {
  let p = 10;
  const factors = [];
  if (c.orders > 0) { p += 30; factors.push({ f: "اشترى قبل", v: +30 }); }
  if (c.orders >= 3) { p += 15; factors.push({ f: "متكرر", v: +15 }); }
  if (c.intent >= 70) { p += 25; factors.push({ f: "نية عالية بالمحادثة", v: +25 }); }
  else if (c.intent >= 50) { p += 12; factors.push({ f: "نية متوسطة", v: +12 }); }
  if (c.avgGapDays && c.daysSinceOrder != null && c.daysSinceOrder >= c.avgGapDays) {
    p += 18; factors.push({ f: "حان موعد طلبه المعتاد", v: +18 });
  }
  if (c.daysSinceOrder != null && c.daysSinceOrder > 120) { p -= 20; factors.push({ f: "غايب من زمان", v: -20 }); }
  if (c.cancelled >= 2) { p -= 15; factors.push({ f: "كثير الإلغاء", v: -15 }); }
  if ((c.objections || []).length >= 2) { p -= 10; factors.push({ f: "اعتراضات متعددة", v: -10 }); }
  return { score: Math.max(0, Math.min(95, Math.round(p))), factors };
}

router.get("/dna", (req, res) => {
  try {
    const { days, from } = since(req, 90);
    const list = customerStats(from);
    const seg = new Map();
    for (const c of list) {
      for (const t of classifyDNA(c)) {
        const s = seg.get(t.tag) || { tag: t.tag, n: 0, spend: 0, orders: 0, samples: [] };
        s.n++; s.spend = round(s.spend + c.spend); s.orders += c.orders;
        if (s.samples.length < 8) s.samples.push({ sender_id: c.sender_id, why: t.why, spend: c.spend });
        seg.set(t.tag, s);
      }
    }
    const segments = [...seg.values()].map(s => ({
      ...s,
      share: pct(s.n, list.length),
      avgSpend: s.n ? round(s.spend / s.n) : 0,
      // القيمة الفعلية للشريحة — هون بتعرف على مين تركّز
      valueShare: pct(s.spend, list.reduce((t, c) => t + c.spend, 0))
    })).sort((a, b) => b.spend - a.spend);

    reply(res, { days, customers: list.length, segments, confidence: confidence(list.length) }, {
      المصدر: `${list.length} زبون`,
      الطريقة: "تصنيف بقواعد سلوكية — الزبون ممكن يقع بأكثر من شريحة",
      ملاحظة: "الشرائح مبنية على سلوك مسجّل عندك فقط"
    });
  } catch (e) { fail(res, e, "فشل بناء الشرائح"); }
});

// ═══════════════════════════════════════════════════════════
// 6) 🕵️ OBJECTION MINER — منجم الاعتراضات
// أقوى محرك بالوحدة. بيقلك بالضبط شو بيمنع الناس تشتري منك.
// ═══════════════════════════════════════════════════════════
router.get("/objections", (req, res) => {
  try {
    const { days, from } = since(req, 30);
    const convs = conversations(from);
    const buyers = new Set(retryDb(() => db.prepare(
      `SELECT DISTINCT sender_id FROM orders WHERE created_at >= ? AND status <> ?`
    ).all(from, CANCEL)).map(r => r.sender_id));

    const agg = new Map();
    for (const o of OBJECTIONS)
      agg.set(o.key, { key: o.key, label: o.label, raised: 0, converted: 0, quotes: [] });

    for (const cv of convs) {
      const scan = scanConversation(cv);
      const bought = buyers.has(cv.sender_id);
      const seen = new Set();
      for (const ob of scan.objections) {
        if (seen.has(ob.key)) continue;
        seen.add(ob.key);
        const a = agg.get(ob.key);
        if (!a) continue;
        a.raised++;
        if (bought) a.converted++;
        // اقتباس حقيقي — التاجر لازم يشوف كلام زبونه بالحرف
        if (a.quotes.length < 5) {
          const msg = cv.msgs.find(m => m.dir === "in" &&
            (SIGNALS[ob.key] || { words: [] }).words.some(w => String(m.body || "").toLowerCase().includes(w)));
          if (msg) a.quotes.push({ text: String(msg.body).slice(0, 160), sender_id: cv.sender_id, at: msg.at });
        }
      }
    }

    const rows = [...agg.values()].filter(a => a.raised > 0).map(a => ({
      ...a,
      lost: a.raised - a.converted,
      // 🔴 الرقم الذهبي: لما الزبون بيقول هالاعتراض، قديش بيشتري رغمه
      conversionWhenRaised: pct(a.converted, a.raised),
      share: 0
    }));
    const totalRaised = rows.reduce((s, r) => s + r.raised, 0);
    rows.forEach(r => { r.share = pct(r.raised, totalRaised); });
    rows.sort((a, b) => b.lost - a.lost);

    // معدل التحويل العام للمقارنة — بلا هالمرجع الأرقام فوق ما إلها معنى
    const overallConv = pct([...buyers].filter(b =>
      convs.some(c => c.sender_id === b)).length, convs.length);

    reply(res, {
      days, totalRaised, rows, overallConv,
      confidence: confidence(totalRaised),
      insight: rows.length
        ? `"${rows[0].label}" أكبر مانع — طلع بـ${rows[0].raised} محادثة، ` +
          `وبس ${rows[0].conversionWhenRaised}% منهم اشتروا (المعدل العام ${overallConv}%)`
        : "ما رصدنا اعتراضات واضحة بهالفترة"
    }, {
      المصدر: `${convs.length} محادثة`,
      الطريقة: "مطابقة معجم اعتراضات عربي على رسائل الزبائن الواردة",
      قيد: "المعجم بيمسك الصياغات الشائعة — مش كل اعتراض بينكتب بكلمات متوقّعة"
    });
  } catch (e) { fail(res, e, "فشل تحليل الاعتراضات"); }
});

export { classifyDNA, buyProbability };
