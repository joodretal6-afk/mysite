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

// ── الإعداد الفعّال: متغيّر البيئة أولاً، وإلا إعدادات الموقع ──
export async function aiConfig() {
  const provider = process.env.AI_PROVIDER || (await setting("ai_provider")) || "";
  const key      = process.env.OPENAI_API_KEY || (await setting("ai_key")) || "";
  const base     = (process.env.OPENAI_BASE_URL || (await setting("ai_base")) || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model    = process.env.OPENAI_MODEL || (await setting("ai_model")) || CONFIG.OPENAI_MODEL || "gpt-4o-mini";
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
