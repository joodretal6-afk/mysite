// ═══════════════════════════════════════════════════════════
// دالة المحادثة مع Gemini (دعم الصوت + CRM)
// ═══════════════════════════════════════════════════════════
import { CONFIG } from "../config.js";
import { COMMON_KNOWLEDGE } from "./brain.js";

export function buildNextTask(memory) {
  const cartItemsCount = memory.cart ? Object.keys(memory.cart).length : 0;

  if (memory.invalidPhoneProvided) {
    return "الآن: أخبر الزبون أن الرقم خطأ، واطلب رقم أردني صحيح (10 أرقام) فوراً.";
  }
  if (cartItemsCount === 0) {
    return "الآن: اطلب من الزبون اختيار النوع والكمية.";
  }
  if (!memory.area && !memory.phone) {
    return "الآن: اطلب المحافظة ورقم الهاتف لتثبيت الطلب. (ممنوع طباعة الفاتورة أو تأكيد الطلب)";
  }
  if (!memory.area) {
    return "الآن: اطلب منه اسم المحافظة والمنطقة. (ممنوع تأكيد الطلب)";
  }
  if (!memory.phone) {
    return "الآن: 🔴 اطلب رقم الهاتف فوراً وبشكل حازم. (ممنوع تأكيد الطلب أو طباعة فاتورة قبل أخذ الرقم!)";
  }
  return "";
}

export async function askGemini(history, userMsg, audioPart, pageConfig, memory, crmData) {
  let crmContext = "";
  if (crmData && crmData.lastOrder) {
    crmContext = `\nملاحظة هامة: هذا زبون قديم. آخر طلب له كان (${crmData.lastOrder}) وعنوانه (${crmData.lastArea}). رحب به كزبون دائم واعرض عليه تكرار طلبه.`;
  }

  const nextTask = buildNextTask(memory);
  const systemInst = `${COMMON_KNOWLEDGE}\nصفحة: ${pageConfig.name}\n${pageConfig.INFO}${crmContext}\n${nextTask}`;

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
      return "أبشر، كمّل طلبك.";
    }

    const data = await resp.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map(p => p.text || "").join("").replace(/\*\*/g, "").trim();
    return text || "يا هلا، تفضل شو طلبك؟";
  } catch (e) {
    console.error("Gemini failed:", e && e.message);
    return "أبشر، كمّل طلبك.";
  }
}
