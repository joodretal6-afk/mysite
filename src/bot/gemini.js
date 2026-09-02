// ═══════════════════════════════════════════════════════════
// دالة المحادثة مع Gemini (دعم الصوت + CRM)
// ═══════════════════════════════════════════════════════════
import { CONFIG } from "../config.js";
import { COMMON_KNOWLEDGE, SALES_PERSONA, SALES_BEHAVIOR } from "./brain.js";
import { ADDRESS_EXPERT } from "./addressExpert.js";

export function buildNextTask(memory) {
  const cartItemsCount = memory.cart ? Object.keys(memory.cart).length : 0;

  // 🧠 تثبيت السياق (ضد فقدان الذاكرة): نذكّر النموذج صراحةً بكل ما جمعناه حتى لا يعيد الترحيب أو السؤال
  let ctx = "";
  if ((memory.history || []).length > 0) {
    ctx += "⚠️ هذه محادثة مستمرة (ليست جديدة): ممنوع الترحيب من جديد كأنها بداية — كمّل من حيث توقفت مباشرة.\n";
  }
  const known = [];
  if (cartItemsCount > 0) known.push("الطلب: " + Object.entries(memory.cart).map(([p, q]) => p + " ×" + q).join("، "));
  if (memory.area) known.push("العنوان: " + memory.area);
  if (memory.phone) known.push("الرقم: " + memory.phone);
  if (known.length) ctx += "✅ معلومات مؤكدة محفوظة (لا تسأل عنها مرة أخرى أبداً): " + known.join(" | ") + "\n";

  if (memory.invalidPhoneProvided) {
    return ctx + "الآن: أخبر الزبون أن الرقم خطأ، واطلب رقم أردني صحيح (10 أرقام) فوراً.";
  }
  if (cartItemsCount === 0) {
    return ctx + "الآن: اطلب من الزبون اختيار النوع والكمية.";
  }
  if (!memory.area && !memory.phone) {
    return ctx + "الآن: اطلب المحافظة ورقم الهاتف لتثبيت الطلب. (ممنوع طباعة الفاتورة أو تأكيد الطلب)";
  }
  if (!memory.area) {
    return ctx + "الآن: اطلب منه اسم المحافظة والمنطقة. (ممنوع تأكيد الطلب)";
  }
  if (!memory.phone) {
    return ctx + "الآن: 🔴 اطلب رقم الهاتف فوراً وبشكل حازم. (ممنوع تأكيد الطلب أو طباعة فاتورة قبل أخذ الرقم!)";
  }
  return ctx;
}

export async function askGemini(history, userMsg, audioPart, pageConfig, memory, crmData, extraKnowledge = "") {
  let crmContext = "";
  if (crmData && crmData.lastOrder) {
    // 🔴 ممنوع نحقن العنوان السابق. منرحّب بالزبون القديم ومنعرض تكرار
    //    طلبه، بس العنوان لازم يبعثه من جديد بهالمحادثة — ما منفترضه.
    crmContext = `\nملاحظة هامة: هذا زبون قديم (رحّب به كزبون دائم واعرض عليه تكرار طلبه إن رغب). 🔴 لا تفترض عنوانه أو رقمه من طلب سابق — اطلبهما منه في هذه المحادثة.`;
  }

  // 🧠 معلومات إضافية يغذّيها الأدمن لهذه الصفحة (لها أولوية عالية)
  const adminKnowledge = extraKnowledge && extraKnowledge.trim()
    ? `\n\n[معلومات إضافية موثوقة من إدارة الصفحة — اعتمدها بأولوية عالية]\n${extraKnowledge.trim()}`
    : "";

  const nextTask = buildNextTask(memory);
  // معرفة خاصة بالصفحة (SYSTEM) تتجاوز معرفة الجبنة العامة — لصفحات بمجال مختلف (مثل مواد التنظيف)
  // سلوك المبيعات طبقة مستقلة عن المنتج: تنطبق على كل الصفحات حتى اللي عندها برومبت خاص.
  const baseKnowledge = SALES_PERSONA + "\n\n" + (pageConfig.SYSTEM || COMMON_KNOWLEDGE) + "\n\n" + SALES_BEHAVIOR;
  const systemInst = `${baseKnowledge}\n\n${ADDRESS_EXPERT}\n\nصفحة: ${pageConfig.name}\n${pageConfig.INFO}${adminKnowledge}${crmContext}\n${nextTask}`;

  const contents = (history || []).map(h => ({
    role: h.role === "assistant" ? "model" : "user",
    parts: [{ text: h.content }]
  }));

  const currentParts = [];
  if (userMsg && userMsg !== "[رسالة صوتية]") currentParts.push({ text: userMsg });
  if (audioPart) {
    currentParts.push({ text: "رسالة صوتية من الزبون، افهمها ورد عليها:" });
    currentParts.push(audioPart);
  }
  if (currentParts.length === 0) currentParts.push({ text: userMsg || "..." });
  contents.push({ role: "user", parts: currentParts });

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.MODEL_NAME}:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInst }] },
          contents: contents,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 800   // رفعناها لأن الموديلات الجديدة تستهلك جزء بالتفكير
          }
        }),
        signal: AbortSignal.timeout(CONFIG.GEMINI_TIMEOUT_MS)
      }
    );

    if (!resp.ok) {
      console.error("Gemini error:", resp.status, await resp.text());
      // 🔴 ما منبعت رسالة تعبئة لمّا الذكاء يفشل.
      //    "أبشر كمّل طلبك" بتوهم الزبون إنّ في حدا فاهمه، فبيكمّل
      //    كلام ما حدا بيقراه، وبيروح الطلب. السكوت أصدق: الزبون
      //    بيعيد أو بيتصل، وإنت بتشوف المحادثة بالوارد.
      return null;
    }

    const data = await resp.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map(p => p.text || "").join("").replace(/\*\*/g, "").trim();
    return text || null;   // رد فاضي = سكوت كمان
  } catch (e) {
    console.error("Gemini failed:", e && e.message);
    return null;   // 🔴 فشل الذكاء = سكوت، مش رسالة تعبئة
  }
}
