// ═══════════════════════════════════════════════════════════
// موزّع الذكاء: يختار بين Gemini و OpenAI (ChatGPT)
// - AI_PROVIDER="gemini" أو "openai"، أو فاضي (يختار تلقائياً حسب المفتاح)
// - OpenAI يدعم الصوت عبر تحويله لنص بـ Whisper
// ═══════════════════════════════════════════════════════════
import { CONFIG } from "../config.js";
import { COMMON_KNOWLEDGE } from "./brain.js";
import { buildNextTask, askGemini } from "./gemini.js";

function chosenProvider() {
  if (CONFIG.AI_PROVIDER === "openai") return "openai";
  if (CONFIG.AI_PROVIDER === "gemini") return "gemini";
  // تلقائي: لو في مفتاح OpenAI استخدمه، وإلا Gemini
  return CONFIG.OPENAI_API_KEY ? "openai" : "gemini";
}

// نقطة الدخول الموحّدة (نفس توقيع askGemini)
export async function askAI(history, userMsg, audioPart, pageConfig, memory, crmData, extraKnowledge = "") {
  if (chosenProvider() === "openai") {
    return askOpenAI(history, userMsg, audioPart, pageConfig, memory, crmData, extraKnowledge);
  }
  return askGemini(history, userMsg, audioPart, pageConfig, memory, crmData, extraKnowledge);
}

// ── تحويل رسالة صوتية لنص عبر Whisper ──
async function transcribeOpenAI(audioPart) {
  try {
    const bytes = Buffer.from(audioPart.inlineData.data, "base64");
    const blob = new Blob([bytes], { type: audioPart.inlineData.mimeType || "audio/mp4" });
    const form = new FormData();
    form.append("file", blob, "audio.m4a");
    form.append("model", CONFIG.OPENAI_TRANSCRIBE_MODEL);
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${CONFIG.OPENAI_API_KEY}` },
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
    crmContext = `\nملاحظة هامة: هذا زبون قديم. آخر طلب له كان (${crmData.lastOrder}) وعنوانه (${crmData.lastArea}). رحب به كزبون دائم واعرض عليه تكرار طلبه.`;
  }
  const adminKnowledge = extraKnowledge && extraKnowledge.trim()
    ? `\n\n[معلومات إضافية موثوقة من إدارة الصفحة — اعتمدها بأولوية عالية]\n${extraKnowledge.trim()}`
    : "";

  const nextTask = buildNextTask(memory);
  const systemInst = `${COMMON_KNOWLEDGE}\nصفحة: ${pageConfig.name}\n${pageConfig.INFO}${adminKnowledge}${crmContext}\n${nextTask}`;

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
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: CONFIG.OPENAI_MODEL,
        messages,
        temperature: 0.2,
        max_tokens: 400
      }),
      signal: AbortSignal.timeout(CONFIG.GEMINI_TIMEOUT_MS)
    });

    if (!resp.ok) {
      console.error("OpenAI error:", resp.status, await resp.text());
      return "أبشر، كمّل طلبك.";
    }
    const data = await resp.json();
    const text = (data?.choices?.[0]?.message?.content || "").replace(/\*\*/g, "").trim();
    return text || "يا هلا، تفضل شو طلبك؟";
  } catch (e) {
    console.error("OpenAI failed:", e && e.message);
    return "أبشر، كمّل طلبك.";
  }
}
