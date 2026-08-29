// ═══════════════════════════════════════════════════════════
// موزّع الذكاء: يختار بين Gemini و OpenAI (ChatGPT)
// - AI_PROVIDER="gemini" أو "openai"، أو فاضي (يختار تلقائياً حسب المفتاح)
// - OpenAI يدعم الصوت عبر تحويله لنص بـ Whisper
// ═══════════════════════════════════════════════════════════
import { CONFIG } from "../config.js";
import { COMMON_KNOWLEDGE, SALES_PERSONA, SALES_BEHAVIOR } from "./brain.js";
import { ADDRESS_EXPERT } from "./addressExpert.js";
import { buildNextTask, askGemini } from "./gemini.js";

// عنوان البوابة المتوافقة مع OpenAI (افتراضياً AIsa — تم التحقق منها)
const OAI_BASE = (process.env.OPENAI_BASE_URL || "https://api.aisa.one/v1").replace(/\/+$/, "");

// 🔑 المفتاح والنموذج: متغيّر بيئة أولاً، وإلا المحفوظ بصفحة /admin/ai.
//    (نقرأه لحظياً عشان يشتغل فوراً بعد ما تحفظه بالموقع بلا إعادة تشغيل)
function siteSetting(key) {
  try {
    // استيراد متزامن كسول عبر ذاكرة الوحدة (database.js محمّلة أصلاً)
    return (globalThis.__aiSettings && globalThis.__aiSettings(key)) || "";
  } catch { return ""; }
}
export function oaiKey()   { return process.env.OPENAI_API_KEY || siteSetting("ai_key") || ""; }
export function oaiModel() { return process.env.OPENAI_MODEL || siteSetting("ai_model") || "qwen-flash"; }

function chosenProvider() {
  if (CONFIG.AI_PROVIDER === "openai") return "openai";
  if (CONFIG.AI_PROVIDER === "gemini") return "gemini";
  // تلقائي: لو في مفتاح بوابة استخدمها، وإلا Gemini
  return oaiKey() ? "openai" : "gemini";
}

// نقطة الدخول الموحّدة (نفس توقيع askGemini)
export async function askAI(history, userMsg, audioPart, pageConfig, memory, crmData, extraKnowledge = "") {
  if (chosenProvider() === "openai") {
    return askOpenAI(history, userMsg, audioPart, pageConfig, memory, crmData, extraKnowledge);
  }
  return askGemini(history, userMsg, audioPart, pageConfig, memory, crmData, extraKnowledge);
}

// ═══════════════════════════════════════════════════════════
// 🧠 استخراج الطلب بالذكاء الاصطناعي (يفهم أي صياغة طبيعية)
// يرجّع: { is_order, items:[{product, qty}], area, phone }
// ═══════════════════════════════════════════════════════════
const PHONE_STRICT = /^(?:07[789]\d{7})$/;

function normalizePhone(raw) {
  if (!raw) return "";
  let p = String(raw).replace(/[\s\-\.]/g, "");
  if (p.startsWith("00962")) p = "0" + p.slice(5);
  else if (p.startsWith("+962")) p = "0" + p.slice(4);
  else if (p.startsWith("962")) p = "0" + p.slice(3);
  return PHONE_STRICT.test(p) ? p : "";
}

export async function extractOrderWithAI(conversationText, pageConfig) {
  const allowed = Object.keys(pageConfig.PRICES || {});
  if (!conversationText || !conversationText.trim() || !allowed.length) {
    return { ok: false, is_order: false, items: [], area: "", phone: "" };
  }

  const prompt =
`أنت محلّل طلبات دقيق لمتجر أردني (${pageConfig.name}). استخرج الطلب من محادثة الزبون التالية.
الأصناف المتاحة في هذه الصفحة فقط (لا تخترع غيرها): ${allowed.join(" ، ")}.

${ADDRESS_EXPERT}

أعد JSON فقط بهذا الشكل بالضبط:
{"is_order": true أو false, "items": [{"product": "<اسم صنف من القائمة أعلاه حرفياً>", "qty": <عدد صحيح>}], "area": "<العنوان كما كتبه الزبون حرفياً بكلماته، أو فراغ>", "phone": "<رقم أردني بصيغة 07xxxxxxxx كتبه الزبون، أو فراغ>"}

🔴🔴 القاعدة الأهم فوق كل شي — ممنوع الاختراع أو الافتراض أو التخمين:
- لا تكتب في "area" إلا كلمات ذكرها الزبون **حرفياً** في رسائله. ممنوع تستنتج محافظة، ممنوع تكمّل عنوان ناقص، ممنوع تضيف منطقة أو شارع أو معلم ما كتبه الزبون. لو الزبون قال "المفرق" بس، اكتب "المفرق" بس — لا تحوّلها لعنوان كامل من عندك.
- لا تكتب رقم هاتف إلا إذا كان مكتوباً فعلاً في رسائل الزبون. ممنوع تكمّل رقم ناقص، ممنوع تخترع أرقام.
- إذا المعلومة غير موجودة بوضوح في كلام الزبون: اترك الحقل فراغاً "". فراغ أفضل ألف مرة من قيمة مخترعة.
- ممنوع تاخد عنوان أو رقم من أي مصدر غير رسائل هذا الزبون في هذه المحادثة.

قواعد الكمية (دقيقة جداً — التزم بها حرفياً):
- 🔴 الوزن ليس كمية إطلاقاً. النصية الواحدة وزنها 4 كيلو (4200غ). أي ذكر لـ "4 كيلو" أو "4200غ" = كمية 1 (نصية واحدة) وليس 4.
- التطابق: نصية/حبة/وحدة/عبوة/واحدة = 1 ، نصيتين/حبتين/عبوتين = 2 ، ثلاث = 3 ، أربع = 4.
- "8 كيلو"=2 ، "12 كيلو"=3 ، "16 كيلو"=4 (كل 4 كيلو = نصية واحدة).
- لا تحسب أرقام الهاتف أو العنوان أو السعر أو الغرامات كأنها كمية أبداً.
- إذا الزبون قال "حبة/وحدة/واحدة/نصية" فالكمية = 1 مهما ذُكر من كيلوهات أو غرامات معها.
- إذا الكمية غير واضحة أو مبهمة، اجعل الكمية 1 (لا تضاعفها من عندك أبداً).
- لو ما في نية طلب واضحة (مجرد سؤال/سلام) اجعل is_order=false و items فارغة.
- طابق اسم الصنف مع القائمة المتاحة (مثلاً "بلدية"→"غنم" إن لم يوجد "بلدية").

المحادثة:
${conversationText.slice(0, 6000)}`;

  let raw = "";
  try {
    if (chosenProvider() === "openai") {
      const resp = await fetch(`${OAI_BASE}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${oaiKey()}` },
        body: JSON.stringify({
          model: oaiModel(),
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          response_format: { type: "json_object" }
        }),
        signal: AbortSignal.timeout(CONFIG.GEMINI_TIMEOUT_MS)
      });
      if (!resp.ok) { console.error("AI extract (openai) error:", resp.status, await resp.text()); return { ok: false, is_order: false, items: [], area: "", phone: "" }; }
      const d = await resp.json();
      raw = d?.choices?.[0]?.message?.content || "";
    } else {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.MODEL_NAME}:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 500 }
          }),
          signal: AbortSignal.timeout(CONFIG.GEMINI_TIMEOUT_MS)
        }
      );
      if (!resp.ok) { console.error("AI extract (gemini) error:", resp.status, await resp.text()); return { ok: false, is_order: false, items: [], area: "", phone: "" }; }
      const d = await resp.json();
      raw = (d?.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
    }

    // تنظيف وتحليل JSON
    const m = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : raw);

    // تحقّق وتصفية الأصناف ضمن المتاح فقط
    const items = (Array.isArray(parsed.items) ? parsed.items : [])
      .map(it => ({ product: String(it.product || "").trim(), qty: parseInt(it.qty, 10) || 1 }))
      .filter(it => allowed.includes(it.product) && it.qty > 0);

    return {
      ok: true,
      is_order: !!parsed.is_order && items.length > 0,
      items,
      area: String(parsed.area || "").slice(0, 200).trim(),
      phone: normalizePhone(parsed.phone)
    };
  } catch (e) {
    console.error("AI extract failed:", e && e.message);
    return { ok: false, is_order: false, items: [], area: "", phone: "" };
  }
}

// ── تحويل رسالة صوتية لنص عبر Whisper ──
async function transcribeOpenAI(audioPart) {
  try {
    const bytes = Buffer.from(audioPart.inlineData.data, "base64");
    const blob = new Blob([bytes], { type: audioPart.inlineData.mimeType || "audio/mp4" });
    const form = new FormData();
    form.append("file", blob, "audio.m4a");
    form.append("model", CONFIG.OPENAI_TRANSCRIBE_MODEL);
    const r = await fetch(`${OAI_BASE}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${oaiKey()}` },
      body: form,
      signal: AbortSignal.timeout(CONFIG.GEMINI_TIMEOUT_MS)
    });
    if (!r.ok) { console.error("Whisper error:", r.status, await r.text()); return ""; }
    const d = await r.json();
    return d.text || "";
  } catch (e) {
    console.error("Whisper failed:", e && e.message);
    return "";
  }
}

async function askOpenAI(history, userMsg, audioPart, pageConfig, memory, crmData, extraKnowledge) {
  let crmContext = "";
  if (crmData && crmData.lastOrder) {
    // 🔴 ممنوع نحقن العنوان السابق. ترحيب وعرض تكرار فقط — العنوان
    //    والرقم لازم يبعثهم الزبون من جديد بهالمحادثة، ما منفترضهم.
    crmContext = `\nملاحظة هامة: هذا زبون قديم (رحّب به كزبون دائم واعرض عليه تكرار طلبه إن رغب). 🔴 لا تفترض عنوانه أو رقمه من طلب سابق — اطلبهما منه في هذه المحادثة.`;
  }
  const adminKnowledge = extraKnowledge && extraKnowledge.trim()
    ? `\n\n[معلومات إضافية موثوقة من إدارة الصفحة — اعتمدها بأولوية عالية]\n${extraKnowledge.trim()}`
    : "";

  const nextTask = buildNextTask(memory);
  // سلوك المبيعات طبقة مستقلة عن المنتج: تنطبق على كل الصفحات حتى اللي عندها برومبت خاص.
  const baseKnowledge = SALES_PERSONA + "\n\n" + (pageConfig.SYSTEM || COMMON_KNOWLEDGE) + "\n\n" + SALES_BEHAVIOR;
  const systemInst = `${baseKnowledge}\n\n${ADDRESS_EXPERT}\n\nصفحة: ${pageConfig.name}\n${pageConfig.INFO}${adminKnowledge}${crmContext}\n${nextTask}`;

  const messages = [{ role: "system", content: systemInst }];
  (history || []).forEach(h => {
    messages.push({ role: h.role === "assistant" ? "assistant" : "user", content: h.content || "" });
  });

  // نص المستخدم (+ تحويل الصوت لو موجود)
  let finalUser = (userMsg && userMsg !== "[رسالة صوتية]") ? userMsg : "";
  if (audioPart) {
    const transcript = await transcribeOpenAI(audioPart);
    if (transcript) finalUser = (finalUser ? finalUser + "\n" : "") + transcript;
    else if (!finalUser) finalUser = "الزبون بعت رسالة صوتية غير واضحة، اطلب منه يعيدها كتابةً بلطف.";
  }
  messages.push({ role: "user", content: finalUser || "..." });

  try {
    const resp = await fetch(`${OAI_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${oaiKey()}`
      },
      body: JSON.stringify({
        model: oaiModel(),
        messages,
        temperature: 0.2,
        max_tokens: 400
      }),
      signal: AbortSignal.timeout(CONFIG.GEMINI_TIMEOUT_MS)
    });

    if (!resp.ok) {
      console.error("OpenAI error:", resp.status, await resp.text());
      // 🔴 ما منبعت رسالة تعبئة لمّا الذكاء يفشل.
      //    "أبشر كمّل طلبك" بتوهم الزبون إنّ في حدا فاهمه، فبيكمّل
      //    كلام ما حدا بيقراه، وبيروح الطلب. السكوت أصدق: الزبون
      //    بيعيد أو بيتصل، وإنت بتشوف المحادثة بالوارد.
      return null;
    }
    const data = await resp.json();
    const text = (data?.choices?.[0]?.message?.content || "").replace(/\*\*/g, "").trim();
    return text || null;   // رد فاضي = سكوت كمان
  } catch (e) {
    console.error("OpenAI failed:", e && e.message);
    return null;   // 🔴 فشل الذكاء = سكوت، مش رسالة تعبئة
  }
}
