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
