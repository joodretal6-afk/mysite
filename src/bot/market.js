// ═══════════════════════════════════════════════════════════
// 🔎 دراسة السوق (Taleb Product Hunter 🇯🇴)
// خبير اكتشاف منتجات رابحة للسوق الأردني — يتعلم من مبيعاتك ونتائج تجاربك.
// يعمل على نفس مفتاح/كود Gemini. الأهداف: Opportunity Score + بطاقة قرار كاملة.
// ═══════════════════════════════════════════════════════════
import { CONFIG } from "../config.js";
import { salesReport, topProducts, peakHeatmap, cancelReasonsReport,
         studyOutcomes, addStudy } from "../db/database.js";

const HUNTER_PERSONA = `أنت "صيّاد المنتجات" — خبير أردني محترف باكتشاف المنتجات الرابحة للتجارة الإلكترونية (بيع عبر فيسبوك/إنستغرام مع دفع عند الاستلام) في الأردن.
خبرتك: تحليل الطلب بالسوق الأردني، اقتصاديات المنتج (جملة/بيع/هامش)، قابلية الإعلان بالفيديو، المنافسة المحلية، وسهولة الشحن.

━━ معايير المنتج الرابح بالأردن (اعتمدها بالتقييم) ━━
- هامش ربح ×2.5 على الأقل بعد التوصيل (توصيل تقريبي 2-3 دنانير).
- سعر بيع مثالي 10-30 دينار (فوقها بتقل الاندفاعية بالدفع عند الاستلام).
- بدون مقاسات/ألوان معقدة (يقلل الإرجاع)، وزن خفيف، غير قابل للكسر.
- يحل مشكلة واضحة أو فيه عامل إبهار "قبل/بعد" يصلح لفيديو 15-30 ثانية.
- متوفر بالجملة (محلياً من تجار الجملة بعمان/سوق البخارية/الصين عبر الشحن).
- انتبه للمواسم الأردنية: رمضان، الأعياد، المدارس، الشتاء/الصيف، الزراعة المنزلية.

━━ Opportunity Score (من 100) ━━
احسبه من: الهامش (25) + قابلية الفيديو والإبهار (20) + وضوح المشكلة/الحاجة (15) + المنافسة المحلية (15) + سهولة الشحن وقلة الإرجاع (15) + الموسمية والتوقيت (10). كن صارماً: 90+ نادر جداً.

━━ حفظ الدراسات (مهم) ━━
عند تقديم دراسة منتج كاملة (أو قائمة منتجات)، أنهِ ردك بسطر لكل منتج بهذه الصيغة بالضبط (JSON صالح بسطر واحد):
[[STUDY:{"product":"اسم المنتج","score":88,"wholesale":5.5,"sell":14.9,"category":"سيارات","data":{"why":"لماذا اخترناه بسطرين","audience":"الجمهور المستهدف","videos":["فكرة فيديو 1","فكرة 2","فكرة 3"],"angles":["زاوية إعلانية 1","زاوية 2","زاوية 3"],"suppliers":"أين تجده بالجملة","risks":"أهم المخاطر","economics":"جملة 5.5 + توصيل 2.5 = 8 | بيع 14.9 | هامش 6.9"}}]]
- لا تضع السطر إلا لدراسة فعلية مكتملة. الأسعار تقديرية واقعية للسوق الأردني وصرّح أنها تقديرية.

━━ أسلوبك ━━
لهجة أردنية مهنية مختصرة. أرقام وجداول قصيرة، بلا حشو. كن صريحاً بالمخاطر — قرار خاطئ بيكلف صاحب المشروع فلوس حقيقية. إذا منتج ضعيف قلها بوضوح وليش.
━━ حدودك ━━
لا تدّعي أنك تشاهد إعلانات فيسبوك حيّة أو أرقام منافسين دقيقة — تقديراتك مبنية على خبرة السوق + بيانات المشروع الحقيقية المعطاة لك. نبّه دائماً أن الجملة تحتاج تأكيد من المورّد.`;

// سياق التعلم: بيانات مشروعه الحقيقية + نتائج تجاربه السابقة
export function buildMarketContext() {
  const parts = [];
  try {
    const r = salesReport();
    const avg = r.month.c > 0 ? Math.round(r.month.s / r.month.c * 10) / 10 : 0;
    parts.push(`📊 مشروعه الحالي: ${r.month.c} طلب آخر 30 يوم بمتوسط ${avg}د للطلب (بيع أجبان بلدية + مواد تنظيف عبر بوت ماسنجر ودفع عند الاستلام، توصيل لكل الأردن).`);
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
    const win = out.filter(s => s.status === "رابح"), lose = out.filter(s => s.status === "فاشل"), trying = out.filter(s => s.status === "تجربة");
    if (win.length) parts.push("✅ منتجات جرّبها ونجحت (ابحث عن أنماط مشابهة!): " + win.map(s => `${s.product} (بيع ${s.sell}د، ${s.category})`).join("، "));
    if (lose.length) parts.push("🛑 منتجات جرّبها وفشلت (تجنّب أنماطها): " + lose.map(s => `${s.product} (${s.category})`).join("، "));
    if (trying.length) parts.push("🧪 قيد التجربة حالياً: " + trying.map(s => s.product).join("، "));
  } catch {}
  return parts.length ? parts.join("\n") : "لا توجد بيانات تجارب سابقة بعد — ابدأ بالتوصيات العامة للسوق الأردني.";
}

// استخراج وحفظ الدراسات من رد الذكاء
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

export async function askMarket(history) {
  const sys = HUNTER_PERSONA + "\n\n━━ بيانات مشروعه الحقيقية (تعلّم منها ورشّح ما يشبه نجاحاته) ━━\n" + buildMarketContext();
  const contents = (history || []).slice(-20).map(h => ({
    role: h.role === "assistant" ? "model" : "user",
    parts: [{ text: String(h.content || "").slice(0, 4000) }]
  }));
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.MODEL_NAME}:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents,
        generationConfig: { temperature: 0.6, maxOutputTokens: 2000 }
      }),
      signal: AbortSignal.timeout(60000)
    }
  );
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const d = await resp.json();
  const raw = (d?.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("").replace(/\*\*/g, "").trim();
  const { clean, created } = extractAndSaveStudies(raw);
  return { reply: clean || "خبّرني شو بدك تدرس اليوم.", createdStudies: created };
}
