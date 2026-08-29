// ═══════════════════════════════════════════════════════════
// 🧠 طبقة الذكاء الموحّدة — مزوّد واحد يخدم كل الموقع
//
// المشكلة اللي بتحلّها: كانت 11 ميزة تنادي Gemini بعنوان مثبّت بالكود،
// فما بتقدر تربط أي مزوّد تاني. هون منوحّد النداء، فأي مفتاح تحطّه
// بيشغّل **كل** الميزات: البوت، المستشار، دراسة السوق، رادار السوق،
// باني المشاريع، تحليل المنافسين، والتقارير.
//
// بيدعم:
//  • أي بوابة متوافقة مع OpenAI (زي AIsa) عبر base URL قابل للضبط
//  • Gemini الأصلي
//
// 🔴 المفاتيح ما بتنكتب بالكود أبداً (المستودع عام). مصدرها:
//    1) متغيّر بيئة   2) إعدادات الموقع (قاعدة البيانات)
// ═══════════════════════════════════════════════════════════
import { CONFIG } from "../config.js";

// نقرأ الإعداد من قاعدة البيانات بشكل كسول (تفادي دورة استيراد)
let _getSetting = null;
async function setting(key) {
  try {
    if (!_getSetting) ({ getSetting: _getSetting } = await import("../db/database.js"));
    return _getSetting(key) || "";
  } catch { return ""; }
}

// الافتراضي جاهز لبوابة Groq (تم فحصها فعلياً على الجهاز):
//   العنوان: https://api.groq.com/openai/v1
//   النموذج: qwen/qwen3.8-27b — انفحص مقابل باقي نماذج Groq على
//   نفس مهمة البوت (استخراج طلب أردني كـJSON) وطلع الأفضل:
//     • أسرع رد (~450ms مقابل 1000-1400 للباقي)
//     • الوحيد اللي رجّع الكمية **رقم** (حبتين ⇒ 2) — الباقي رجّعها
//       نص فبتكسر حساب السعر عنا
//     • احترم قاعدة عدم الاختراع: العنوان والهاتف الناقصين رجعوا null
//     • بيدعم وضع JSON المطلوب للاستخراج
// 🔴 المفتاح **ما بينكتب هون أبداً** — المستودع عام، ولو انكتب بالكود
//    بترصده المنصات وبيتلغى خلال دقائق. مصدره: صفحة /admin/ai أو
//    متغيّر بيئة. (صار معنا فعلياً: مفتاح Gemini كان مكتوب بالكود،
//    انلغى، ووقف البوت.)
const DEFAULT_BASE  = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "qwen/qwen3.8-27b";

// بوابات جاهزة للاختيار من صفحة الإعدادات — بلا حفظ مفاتيح
export const PRESETS = [
  { id: "groq", name: "Groq (موصى به — الأسرع)", base: "https://api.groq.com/openai/v1",
    model: "qwen/qwen3.8-27b",
    models: ["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b", "groq/compound"],
    hint: "المفتاح بيبدأ بـgsk_ — من console.groq.com" },
  { id: "aisa", name: "AIsa", base: "https://api.aisa.one/v1", model: "qwen-flash",
    models: ["qwen-flash"], hint: "المفتاح بيبدأ بـsk-aisa-" },
  { id: "openai", name: "OpenAI", base: "https://api.openai.com/v1", model: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o"], hint: "المفتاح بيبدأ بـsk-" }
];

// ── الإعداد الفعّال: متغيّر البيئة أولاً، وإلا إعدادات الموقع ──
export async function aiConfig() {
  const provider = process.env.AI_PROVIDER || (await setting("ai_provider")) || "";
  const key      = process.env.OPENAI_API_KEY || (await setting("ai_key")) || "";
  const base     = (process.env.OPENAI_BASE_URL || (await setting("ai_base")) || DEFAULT_BASE).replace(/\/+$/, "");
  const model    = process.env.OPENAI_MODEL || (await setting("ai_model")) || DEFAULT_MODEL;
  const gKey     = CONFIG.GEMINI_API_KEY;
  const gModel   = CONFIG.MODEL_NAME;
  // "openai" = أي بوابة متوافقة (AIsa وغيرها)
  const useOpenAI = provider === "openai" ? true
                  : provider === "gemini" ? false
                  : !!key;                       // تلقائي: لو في مفتاح بوابة استخدمها
  return { useOpenAI, key, base, model, gKey, gModel, provider };
}

// حالة الاتصال (للعرض بصفحة الإعدادات)
export async function aiStatus() {
  const c = await aiConfig();
  return {
    provider: c.useOpenAI ? "بوابة متوافقة (OpenAI/AIsa)" : "Gemini",
    base: c.useOpenAI ? c.base : "generativelanguage.googleapis.com",
    model: c.useOpenAI ? c.model : c.gModel,
    configured: c.useOpenAI ? !!c.key : !!c.gKey,
    key_source: process.env.OPENAI_API_KEY ? "متغيّر بيئة" : "إعدادات الموقع",
    key_masked: c.key ? c.key.slice(0, 7) + "•".repeat(8) + c.key.slice(-4) : ""
  };
}

// ═══════════════════════════════════════════════════════════
// 🎯 النداء الموحّد: نص داخل ← نص خارج (أو JSON)
//    aiComplete(prompt, { json:true, temperature, maxTokens, timeoutMs })
// ═══════════════════════════════════════════════════════════
export async function aiComplete(prompt, opts = {}) {
  const c = await aiConfig();
  const json = !!opts.json;
  const temperature = opts.temperature ?? (json ? 0 : 0.3);
  const maxTokens = opts.maxTokens || 1200;
  const timeoutMs = opts.timeoutMs || CONFIG.GEMINI_TIMEOUT_MS || 30000;

  if (c.useOpenAI) {
    if (!c.key) return { ok: false, text: "", error: "مفتاح المزوّد غير مضبوط" };
    try {
      const r = await fetch(`${c.base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.key}` },
        body: JSON.stringify({
          model: opts.model || c.model,
          messages: [{ role: "user", content: prompt }],
          temperature, max_tokens: maxTokens,
          ...(json ? { response_format: { type: "json_object" } } : {})
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, text: "", error: d?.error?.message || `HTTP ${r.status}` };
      return { ok: true, text: d?.choices?.[0]?.message?.content || "" };
    } catch (e) { return { ok: false, text: "", error: e && e.message }; }
  }

  // Gemini
  if (!c.gKey) return { ok: false, text: "", error: "مفتاح Gemini غير مضبوط" };
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${opts.model || c.gModel}:generateContent?key=${c.gKey}`,
      {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature, maxOutputTokens: maxTokens,
            ...(json ? { responseMimeType: "application/json" } : {})
          }
        }),
        signal: AbortSignal.timeout(timeoutMs)
      }
    );
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, text: "", error: d?.error?.message || `HTTP ${r.status}` };
    const text = (d?.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
    return { ok: true, text };
  } catch (e) { return { ok: false, text: "", error: e && e.message }; }
}

// مساعد: يرجّع كائن JSON مُحلّل (أو null)
export async function aiJSON(prompt, opts = {}) {
  const r = await aiComplete(prompt, { ...opts, json: true });
  if (!r.ok) return { ok: false, data: null, error: r.error };
  try {
    const m = r.text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    return { ok: true, data: JSON.parse(m ? m[0] : r.text) };
  } catch (e) { return { ok: false, data: null, error: "رد غير صالح: " + (e && e.message) }; }
}

// اختبار الاتصال (لزر "فحص الاتصال" بالإعدادات)
export async function aiTest() {
  const t0 = Date.now();
  const r = await aiComplete("اكتب كلمة: جاهز", { maxTokens: 20, timeoutMs: 20000 });
  const st = await aiStatus();
  return { ...st, ok: r.ok, ms: Date.now() - t0, sample: (r.text || "").trim().slice(0, 60), error: r.error || null };
}
