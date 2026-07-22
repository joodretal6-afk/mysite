// ═══════════════════════════════════════════════════════════
// إرسال الرسائل (فيسبوك ماسنجر + تيليجرام + تحميل الصوت)
// ═══════════════════════════════════════════════════════════
import { CONFIG } from "../config.js";
import { bufferToBase64 } from "./utils.js";

export async function graphSend(pageToken, payload) {
  if (!pageToken) return;
  try {
    const res = await fetch(
      `https://graph.facebook.com/${CONFIG.GRAPH_VERSION}/me/messages?access_token=${pageToken}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
    );
    if (!res.ok) console.error("Graph error:", res.status, await res.text());
  } catch (e) {
    console.error("Graph fetch failed:", e && e.message);
  }
}

export async function sendText(pageToken, senderId, text) {
  if (!text || !text.trim()) return;
  await graphSend(pageToken, {
    recipient: { id: senderId },
    messaging_type: "RESPONSE",
    message: { text: text.slice(0, 1900) }
  });
}

export async function sendTyping(pageToken, senderId) {
  await graphSend(pageToken, { recipient: { id: senderId }, sender_action: "typing_on" });
}

// إرسال إشعار تيليجرام
export async function notifyTelegram(message) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN || CONFIG.TELEGRAM_BOT_TOKEN.includes("YOUR")) return;
  try {
    const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CONFIG.TELEGRAM_CHAT_ID, text: message })
    });
  } catch (e) {
    console.error("Telegram failed:", e && e.message);
  }
}

// تحميل وتحويل الصوت
export async function fetchAudioAsBase64(audioUrl) {
  try {
    const response = await fetch(audioUrl);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > 15 * 1024 * 1024) return null;
    const mimeType = (response.headers.get("content-type") || "audio/mp4").split(";")[0];
    return { inlineData: { data: bufferToBase64(arrayBuffer), mimeType } };
  } catch (e) {
    console.error("Audio fetch failed:", e && e.message);
    return null;
  }
}
