// ═══════════════════════════════════════════════════════════
// 🔎 دراسة السوق (Taleb Product Hunter 🇯🇴) — باحث حقيقي
// وكيل بحث فعلي: يبحث بالويب، يفتح الصفحات، يقرأها، ويبني الدراسة
// من مصادر حقيقية بروابطها. يتعلم من مبيعاتك ونتائج تجاربك.
// ═══════════════════════════════════════════════════════════
import { CONFIG } from "../config.js";
import { salesReport, topProducts, cancelReasonsReport, studyOutcomes, addStudy } from "../db/database.js";
import { webSearch, fetchPage } from "./webtools.js";

const MAX_STEPS = 7;   // أقصى عدد عمليات بحث/فتح صفحات لكل سؤال

const HUNTER_PERSONA = `أنت "صيّاد المنتجات" — باحث سوق أردني محترف لاكتشاف المنتجات الرابحة (بيع عبر فيسبوك/إنستغرام بالدفع عند الاستلام في الأردن).

━━ 🌐 أدوات البحث الحقيقية (استخدمها إلزامياً قبل أي دراسة) ━━
معك أداتان تنفذهما المنصة فعلياً وترجع لك نتائجها الحقيقية:
1) للبحث بالويب اكتب سطراً منفصلاً: [[SEARCH:عبارة البحث]]
2) لفتح صفحة وقراءة نصها اكتب: [[FETCH:الرابط]]
- أرسل أمراً واحداً فقط ثم توقف تماماً وانتظر النتيجة (لا تكمل الرد بعد الأمر).
- ابحث بالعربي (للسوق المحلي: فيسبوك، أسعار الأردن) وبالإنجليزي (للترندات العالمية والموردين).
- أمثلة بحث ذكية: "site:facebook.com {المنتج} الأردن" ، "{product} trending dropshipping 2026" ، "{product} aliexpress price" ، "{المنتج} سعر الأردن".
- افتح 2-3 صفحات مهمة من النتائج لقراءة التفاصيل الفعلية (أسعار، تقييمات، مواصفات).
- ممنوع تأليف أرقام: كل سعر أو معلومة سوقية لازم تكون من نتيجة بحث فعلية أو مصرّحاً أنها تقدير خبرة.
- بعد ما تجمع معلومات كافية (3-6 عمليات)، اكتب الدراسة النهائية مع ذكر المصادر (الروابط) اللي اعتمدت عليها.

━━ معايير المنتج الرابح بالأردن ━━
هامش ×2.5 بعد التوصيل (2-3د) | سعر بيع 10-30د للدفع عند الاستلام | بدون مقاسات | وزن خفيف | مشكلة واضحة أو إبهار "قبل/بعد" لفيديو قصير | متوفر جملة | راعِ المواسم الأردنية.

━━ Opportunity Score (من 100) ━━
الهامش (25) + قابلية الفيديو (20) + وضوح الحاجة (15) + المنافسة (15) + سهولة الشحن (15) + الموسمية (10). كن صارماً: 90+ نادر.

━━ حفظ الدراسة (بعد اكتمال البحث فقط) ━━
أنهِ الدراسة النهائية بسطر لكل منتج (JSON صالح بسطر واحد):
[[STUDY:{"product":"الاسم","score":88,"wholesale":5.5,"sell":14.9,"category":"سيارات","data":{"why":"لماذا (من نتائج البحث)","audience":"الجمهور","videos":["فكرة1","فكرة2","فكرة3"],"angles":["زاوية1","زاوية2","زاوية3"],"suppliers":"الموردون (من البحث)","risks":"المخاطر","economics":"جملة+توصيل مقابل بيع وهامش","keywords_ar":"كلمات بحث عربية","keywords_en":"english sourcing keywords","sources":["رابط1","رابط2"]}}]]

━━ أسلوبك ━━
لهجة أردنية مهنية مختصرة، أرقام من المصادر، صريح بالمخاطر. إذا فيسبوك حجب صفحة (تسجيل دخول) قلها بصراحة واعتمد على المصادر المفتوحة.`;

export function buildMarketContext() {
  const parts = [];
  try {
    const r = salesReport();
    const avg = r.month.c > 0 ? Math.round(r.month.s / r.month.c * 10) / 10 : 0;
    parts.push(`📊 مشروعه: ${r.month.c} طلب آخر 30 يوم بمتوسط ${avg}د (أجبان + تنظيف، ماسنجر، دفع عند الاستلام، الأردن).`);
  } catch {}
  try {
    const tp = topProducts(5);
    if (tp.length) parts.push("🏆 الأكثر مبيعاً عنده: " + tp.map(p => `${p.product} (${p.qty})`).join("، "));
  } catch {}
  try {
    const cr = cancelReasonsReport();
    if (cr.length) parts.push("❌ أسباب إلغاء زبائنه: " + cr.slice(0, 4).map(x => `${x.reason} (${x.count})`).join("، "));
  } catch {}
  try {
    const out = studyOutcomes();
    const win = out.filter(s => s.status === "رابح"), lose = out.filter(s => s.status === "فاشل");
    if (win.length) parts.push("✅ نجح عنده (رشّح المشابه): " + win.map(s => `${s.product} (${s.sell}د، ${s.category})`).join("، "));
    if (lose.length) parts.push("🛑 فشل عنده (تجنّب المشابه): " + lose.map(s => `${s.product} (${s.category})`).join("، "));
  } catch {}
  return parts.length ? parts.join("\n") : "لا بيانات تجارب بعد.";
}

export function extractAndSaveStudies(reply) {
  const created = [];
  const re = /\[\[STUDY:(\{[\s\S]*?\})\]\]/g;
  let m;
  while ((m = re.exec(reply)) !== null) {
    try {
      const s = JSON.parse(m[1]);
      if (!s.product) continue;
      const id = addStudy(s);
      created.push({ id, product: s.product, score: s.score || 0 });
    } catch (e) { console.error("study parse:", e && e.message); }
  }
  return { clean: reply.replace(re, "").trim(), created };
}

async function callGemini(sys, contents) {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.MODEL_NAME}:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents,
        generationConfig: { temperature: 0.5, maxOutputTokens: 2200 }
      }),
      signal: AbortSignal.timeout(60000)
    }
  );
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const d = await resp.json();
  return (d?.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("").replace(/\*\*/g, "").trim();
}

// 🕵️ حلقة الوكيل الباحث: يبحث → يقرأ → يبحث... → دراسة نهائية بمصادر
export async function askMarket(history, onStep) {
  const sys = HUNTER_PERSONA + "\n\n━━ بيانات مشروعه (تعلّم منها) ━━\n" + buildMarketContext();
  const contents = (history || []).slice(-16).map(h => ({
    role: h.role === "assistant" ? "model" : "user",
    parts: [{ text: String(h.content || "").slice(0, 4000) }]
  }));

  const steps = [];   // سجل عمليات البحث الفعلية (يُعرض للمستخدم)
  for (let i = 0; i < MAX_STEPS; i++) {
    const text = await callGemini(sys, contents);
    const search = text.match(/\[\[SEARCH:([\s\S]*?)\]\]/);
    const fetchM = text.match(/\[\[FETCH:([\s\S]*?)\]\]/);

    if (!search && !fetchM) {
      // دراسة نهائية
      const { clean, created } = extractAndSaveStudies(text);
      return { reply: clean || "خبّرني شو بدك أدرس.", createdStudies: created, steps };
    }

    // تنفيذ الأداة الفعلية
    let toolResult = "";
    try {
      if (search) {
        const q = search[1].trim().slice(0, 200);
        steps.push({ type: "search", q });
        if (onStep) onStep({ type: "search", q });
        const res = await webSearch(q, 8);
        toolResult = res.length
          ? "[نتائج البحث الحقيقية عن: " + q + "]\n" + res.map((r, j) => `${j + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n")
          : "[لا نتائج لهذا البحث — جرّب صياغة أخرى]";
      } else {
        const url = fetchM[1].trim().slice(0, 500);
        steps.push({ type: "fetch", q: url });
        if (onStep) onStep({ type: "fetch", q: url });
        const p = await fetchPage(url);
        toolResult = p.status >= 400 || !p.text
          ? `[تعذّر قراءة الصفحة (HTTP ${p.status}) — ${url} — جرّب مصدراً آخر]`
          : `[محتوى الصفحة الحقيقي: ${p.title || url}]\n${p.text}`;
      }
    } catch (e) {
      toolResult = "[فشل تنفيذ الأداة: " + (e && e.message) + " — جرّب طريقة أخرى]";
    }

    contents.push({ role: "model", parts: [{ text }] });
    contents.push({ role: "user", parts: [{ text: toolResult + "\n\n(تابع بحثك أو اكتب الدراسة النهائية إن اكتفيت)" }] });
  }

  // وصلنا الحد: نطلب الخلاصة النهائية
  contents.push({ role: "user", parts: [{ text: "وصلت حد عمليات البحث. اكتب الآن الدراسة النهائية من المعلومات التي جمعتها، مع المصادر." }] });
  const finalText = await callGemini(sys, contents);
  const { clean, created } = extractAndSaveStudies(finalText);
  return { reply: clean, createdStudies: created, steps };
}

// ═══════════════════════════════════════════════════════════
// 🏛️ مجلس المستشارين — 8 وكلاء AI متخصصون + رئيس مجلس يقرر
// ═══════════════════════════════════════════════════════════
import { getSetting, setSetting, getStudy, updateStudyData } from "../db/database.js";

const COUNCIL = [
  { role: "الباحث",        q: "هل هناك فرصة حقيقية بالسوق الأردني لهذا المنتج؟ حلّل الطلب والاتجاه." },
  { role: "التاجر",        q: "هل يمكن تحقيق ربح فعلي؟ حلّل الجملة والهامش والتشغيل بواقعية تاجر أردني." },
  { role: "المسوّق",       q: "هل يمكن بيعه بإعلانات فيسبوك/تيك توك بالأردن؟ ما الزاوية والفيديو الأقوى؟ وهل الإعلان سيكون رخيصاً أم غالياً؟" },
  { role: "العميل",        q: "تقمّص زبوناً أردنياً عادياً: هل ستشتريه بهذا السعر بالدفع عند الاستلام؟ ما اعتراضاتك؟" },
  { role: "المنافس",       q: "لو كنت منافساً قوياً بالسوق، كيف ستحارب هذا المنتج؟ وما نقاط ضعف من يدخل به الآن؟" },
  { role: "المحاسب",       q: "دقق الأرقام: جملة + شحن + تغليف + توصيل + مرتجعات + إعلان متوقع. هل الأرقام منطقية؟ أعطِ الهامش الصافي الواقعي." },
  { role: "مدير المخاطر",  q: "أين يمكن أن نخسر؟ (كسر، تقليد، موسمية، مرتجعات، حساسية قانونية، تشبع). قيّم كل خطر." },
  { role: "الاستراتيجي",   q: "هل هذه فرصة سريعة مؤقتة أم يمكن بناء علامة/خط منتجات حولها؟ وما الخطوة التالية لو نجح؟" }
];

async function askOne(prompt, maxTokens = 500) {
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.MODEL_NAME}:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: maxTokens } }),
        signal: AbortSignal.timeout(45000) });
    if (!resp.ok) return null;
    const d = await resp.json();
    return (d?.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("").replace(/\*\*/g, "").trim() || null;
  } catch { return null; }
}

// يعقد المجلس على منتج: 8 آراء بالتوازي ثم قرار الرئيس
export async function runCouncil(productBrief) {
  const base = `منتج مقترح للبيع بالأردن (فيسبوك + دفع عند الاستلام):\n${productBrief}\n\n`;
  const opinions = await Promise.all(COUNCIL.map(async m => {
    const txt = await askOne(
      base + `أنت "${m.role}" في مجلس استشاري تجاري أردني. ${m.q}\n` +
      `أجب بالعربي في 3-5 أسطر مركّزة، وأنهِ ردك بسطر أخير بالضبط: "تقييمي: N/10" حيث N رقم.`);
    const score = txt ? parseInt((txt.match(/تقييمي:\s*(\d+)/) || [])[1] || "0", 10) : 0;
    return { role: m.role, opinion: txt || "تعذّر الحصول على الرأي", score: Math.min(10, score) };
  }));

  const chairPrompt = base +
    "أنت رئيس مجلس الاستشاريين. هذه آراء أعضاء مجلسك الثمانية:\n\n" +
    opinions.map(o => `【${o.role} — ${o.score}/10】\n${o.opinion}`).join("\n\n") +
    `\n\nمهمتك: خذ القرار النهائي. أجب بالعربي بهذا الشكل بالضبط:\nالقرار: (ادخل / لا تدخل / ادخل بشروط)\nالنتيجة النهائية: N/100\nالأسباب: 3 نقاط\nالشروط أو الخطوة الأولى: نقطتان عمليتان`;
  const chair = await askOne(chairPrompt, 700);
  const finalScore = chair ? parseInt((chair.match(/النهائية:\s*(\d+)/) || [])[1] || "0", 10) : 0;
  const decision = chair ? ((chair.match(/القرار:\s*(.+)/) || [])[1] || "").trim() : "";
  const avg = Math.round(opinions.reduce((a, o) => a + o.score, 0) / opinions.length * 10);
  return { opinions, chairman: chair || "تعذّر قرار الرئيس", decision, finalScore: finalScore || avg, avgScore: avg };
}

// ═══════════════════════════════════════════════════════════
// 💵 محرك التسعير — سيناريوهات أسعار مع الربح المتوقع (نموذج تقديري شفاف)
// ═══════════════════════════════════════════════════════════
export function priceScenarios({ wholesale, shipping = 0.5, delivery = 2.5, adCost = 3, returns = 0.07 }) {
  const cost = Number(wholesale) + Number(shipping);
  if (!cost || cost <= 0) return { error: "أدخل سعر الجملة" };
  const candidates = [9.9, 12.9, 14.9, 16.9, 19.9, 22.9, 24.9, 27.9, 29.9].filter(p => p > (cost + Number(delivery)) * 1.15);
  const anchor = candidates[Math.floor(candidates.length / 2)] || cost * 2.5;
  const ELASTICITY = 2.4;                 // حساسية السعر بالسوق الأردني (تقديري — تعطي نقطة مثلى داخلية)
  const BASE_CONV = 3.0;                  // نسبة تحويل مرجعية % عند السعر الوسيط
  const rows = candidates.map(price => {
    const conv = Math.min(8, BASE_CONV * Math.pow(anchor / price, ELASTICITY));
    const ordersPer100 = conv;            // لكل 100 زيارة مدفوعة
    const margin = price - cost - Number(delivery) - Number(adCost);
    const netMargin = margin * (1 - Number(returns));
    const profitPer100 = Math.round(ordersPer100 * netMargin * 100) / 100;
    return { price, conv: Math.round(conv * 100) / 100, margin: Math.round(margin * 100) / 100,
             netMargin: Math.round(netMargin * 100) / 100, profitPer100 };
  });
  const best = rows.reduce((a, b) => (b.profitPer100 > a.profitPer100 ? b : a), rows[0]);
  return { rows, best, note: "نموذج تقديري (مرونة سعر 1.6، تحويل مرجعي 3%، مرتجعات 7%) — القرار النهائي بعد اختبار إعلاني حقيقي." };
}

// ═══════════════════════════════════════════════════════════
// 🧬 Winner DNA — استخراج نمط المنتج الرابح من نتائج تجاربك
// ═══════════════════════════════════════════════════════════
export async function generateWinnerDNA() {
  const out = studyOutcomes();
  const win = out.filter(s => s.status === "رابح");
  const lose = out.filter(s => s.status === "فاشل");
  if (!win.length && !lose.length) return { error: "علّم منتجات (رابح/فاشل) بخط المنتجات أولاً ليتعلم النظام" };
  const txt = await askOne(
    `حلّل نتائج تجارب تاجر أردني (بيع فيسبوك + دفع عند الاستلام):\n` +
    `✅ منتجات ربحت: ${win.map(s => `${s.product} (بيع ${s.sell}د، جملة ${s.wholesale}د، ${s.category})`).join(" | ") || "لا يوجد بعد"}\n` +
    `❌ منتجات فشلت: ${lose.map(s => `${s.product} (بيع ${s.sell}د، ${s.category})`).join(" | ") || "لا يوجد بعد"}\n\n` +
    `استخرج "DNA المنتج الرابح" لهذا التاجر تحديداً: 6-9 خصائص مشتركة (نطاق سعر، فئات، هامش، قابلية فيديو، جمهور...) بنقاط قصيرة عملية، وخاصية أو اثنتين يجب تجنبها. كن دقيقاً بالأنماط الفعلية ولا تعمّم من عيّنة صغيرة دون تنبيه.`, 600);
  if (!txt) return { error: "تعذّر الاتصال بالذكاء" };
  try { setSetting("winner_dna", txt); } catch {}
  return { dna: txt, winners: win.length, losers: lose.length };
}

// ═══════════════════════════════════════════════════════════
// 💰 FIND ME MONEY — البايبلاين الكامل بضغطة واحدة
// اكتشاف حقيقي → فلترة AI → مجلس المستشارين للأفضل → حفظ TOP
// ═══════════════════════════════════════════════════════════
export async function findMeMoney() {
  const steps = [];
  // 1) اكتشاف حقيقي من الويب (بحثات فعلية)
  const queries = [
    "trending dropshipping products this month cod middle east",
    "winning products 2026 problem solving under 25",
    "منتجات مطلوبة الأردن تجارة الكترونية",
    "best selling gadgets aliexpress trending"
  ];
  let discoveries = [];
  for (const q of queries) {
    try {
      steps.push({ type: "search", q });
      const res = await webSearch(q, 6);
      discoveries.push(...res.map(r => `${r.title} — ${r.snippet}`.slice(0, 220)));
      await new Promise(r => setTimeout(r, 1200));   // مهلة بين البحثات (تفادي حدّ المحرك)
    } catch {}
  }
  const signalsNote = discoveries.length
    ? `هذه إشارات حقيقية جُمعت من الويب الآن:\n${discoveries.slice(0, 40).join("\n")}`
    : "تعذّر جمع إشارات الويب هذه اللحظة — رشّح من خبرتك العميقة بالسوق الأردني وصرّح أن الترشيح خبرة بلا إشارات لحظية.";
  if (!discoveries.length) steps.push({ type: "search", q: "⚠️ محرك البحث محدود مؤقتاً — ترشيح بالخبرة" });

  // 2) فلترة وترشيح AI: قائمة مرشحين بدرجات أولية (مع DNA التاجر إن وُجد)
  let dna = ""; try { dna = getSetting("winner_dna", "") || ""; } catch {}
  const shortlistRaw = await askOne(
    `أنت صيّاد منتجات للسوق الأردني (فيسبوك + دفع عند الاستلام).` +
    (dna ? `\nDNA المنتج الرابح عند هذا التاجر (رشّح ما يطابقه):\n${dna}\n` : "") +
    `\n${signalsNote}\n\n` +
    `استخرج منها 8 منتجات محددة واقعية مناسبة للأردن (سعر بيع 10-30د، بلا مقاسات، قابلة لفيديو، هامش محتمل جيد).` +
    `\nأعد JSON فقط: {"candidates":[{"product":"...","category":"...","est_wholesale":5,"est_sell":15,"quick_score":80,"reason":"سطر واحد"}]}`, 1200);
  let candidates = [];
  try { candidates = JSON.parse((shortlistRaw.match(/\{[\s\S]*\}/) || ["{}"])[0]).candidates || []; } catch {}
  if (!candidates.length) return { error: "لم يستخرج مرشحين — أعد المحاولة", steps };
  candidates = candidates.slice(0, 8).sort((a, b) => (b.quick_score || 0) - (a.quick_score || 0));
  steps.push({ type: "shortlist", q: candidates.map(c => c.product).join("، ") });

  // 3) مجلس المستشارين للأفضل ثلاثة
  const finalists = [];
  for (const c of candidates.slice(0, 3)) {
    steps.push({ type: "council", q: c.product });
    const brief = `المنتج: ${c.product}\nالفئة: ${c.category}\nجملة تقديرية: ${c.est_wholesale}د | بيع مقترح: ${c.est_sell}د\nالسبب: ${c.reason}`;
    const council = await runCouncil(brief);
    const id = addStudy({
      product: c.product, score: council.finalScore, wholesale: c.est_wholesale, sell: c.est_sell,
      category: c.category,
      data: { why: c.reason, council, keywords_ar: c.product, keywords_en: c.product, source: "FIND ME MONEY" }
    });
    finalists.push({ id, product: c.product, score: council.finalScore, decision: council.decision });
  }
  finalists.sort((a, b) => b.score - a.score);
  return { steps, candidates, finalists };
}
