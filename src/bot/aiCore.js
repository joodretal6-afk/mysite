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

// الافتراضي: Groq + openai/gpt-oss-20b — انختار بالفحص مش بالحدس.
//
// الفحص: مهمة البوت الحقيقية (استخراج طلب أردني)، 4 حالات × 3
// جولات، + 6 حالات عدائية لقاعدة عدم الاختراع.
//
//   النموذج            الدقة        السرعة   إدخال$/م  إخراج$/م
//   gpt-oss-20b        8/8 ×3 ✅     605ms    0.07      0.30   ← المختار
//   qwen3.8-27b        8/8 ×3 ✅     516ms    0.80      4.00
//   gpt-5-mini         8/8 ×3 ✅    1097ms    0.25      2.00
//   gpt-oss-120b       7/8 ⚠️        948ms    0.15      0.60
//   gpt-5-nano         4/6 ⚠️       1120ms    0.05      0.40
//
// ليش gpt-oss-20b: دقة كاملة زي الأغلى منه، وأرخص بـ13 ضعف
// بالإخراج من qwen3.8 وبـ7 أضعاف من gpt-5-mini. والفرق بالسرعة
// عنه وعن الأسرع 90 ملّي ثانية — ما بيحسها زبون.
// ونجح 6/6 بالحالات العدائية: ما كمّل رقم ناقص، ما حوّل "المفرق"
// لعنوان كامل، ما اخترع صنف مش بالقائمة، وحفظ العنوان الطويل حرفياً.
//
// 🔴 وتجنّبنا gpt-5-mini عمداً رغم دقته: معلن إيقافه بـ11/12/2026،
//    فبناء البوت عليه يعني كسر مؤكد بعد شهور.
// 🔴 المفتاح **ما بينكتب هون أبداً** — المستودع عام، ولو انكتب بالكود
//    بترصده المنصات وبيتلغى خلال دقائق. مصدره: صفحة /admin/ai أو
//    متغيّر بيئة. (صار معنا فعلياً: مفتاح Gemini كان مكتوب بالكود،
//    انلغى، ووقف البوت.)
const DEFAULT_BASE  = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "openai/gpt-oss-20b";

// ═══════════════════════════════════════════════════════════
// 🧠 نماذج التفكير (gpt-5 وأخواتها) — قيود مختلفة تماماً
//
// اكتُشفت بالفحص الفعلي على المفتاح، مش من التوثيق:
//   1) بترفض max_tokens وبتطلب max_completion_tokens بدلها.
//      بلا هالتعديل كل نداء بيفشل من أساسه.
//   2) بترفض أي temperature غير 1. فمنشيلها بدل ما نبعتها.
//   3) 🔴 الأخطر: بتاكل الرصيد كله بالتفكير وبترجع نص **فاضي**.
//      جرّبنا رصيد 50 → رجع "" و50 توكن راحوا تفكير. فمنجبر
//      reasoning_effort=minimal ومنرفع سقف الرصيد.
// ═══════════════════════════════════════════════════════════
const REASONING_RE = /^(gpt-5|o1|o3|o4)/i;
export const isReasoningModel = (m) => REASONING_RE.test(String(m || "").trim());

/** يبني جسم النداء الصحيح حسب نوع النموذج */
export function buildBody({ model, prompt, json, temperature, maxTokens }) {
  const base = {
    model,
    messages: [{ role: "user", content: prompt }],
    ...(json ? { response_format: { type: "json_object" } } : {})
  };
  if (!isReasoningModel(model))
    return { ...base, temperature, max_tokens: maxTokens };

  // نموذج تفكير: الرصيد بينقسم بين التفكير والرد، فمنضاعفه
  // ومنخلّي التفكير أدنى شي — شغلنا استخراج مش رياضيات.
  return {
    ...base,
    max_completion_tokens: Math.max(600, maxTokens * 2),
    reasoning_effort: "minimal"
  };
}

// بوابات جاهزة للاختيار من صفحة الإعدادات — بلا حفظ مفاتيح
export const PRESETS = [
  { id: "groq", name: "Groq — gpt-oss-20b (الأفضل والأوفر)",
    base: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-20b",
    models: ["openai/gpt-oss-20b", "qwen/qwen3.8-27b", "openai/gpt-oss-120b"],
    hint: "دقة كاملة بالفحص وأرخص خيار — المفتاح بيبدأ بـgsk_ من console.groq.com" },
  { id: "openai5mini", name: "OpenAI GPT-5 mini (دقيق — بس معلن إيقافه 11/12/2026)", base: "https://api.openai.com/v1",
    model: "gpt-5-mini",
    models: ["gpt-5-mini", "gpt-5", "gpt-5-nano", "gpt-4o-mini"],
    hint: "المفتاح بيبدأ بـsk-proj- أو sk- — من platform.openai.com" },
  { id: "openai4", name: "OpenAI GPT-4o mini", base: "https://api.openai.com/v1",
    model: "gpt-4o-mini", models: ["gpt-4o-mini", "gpt-4o"], hint: "المفتاح بيبدأ بـsk-" },
  { id: "openai5nano", name: "OpenAI GPT-5 nano (⚠️ دقة أقل — 4/6 بالفحص)", base: "https://api.openai.com/v1",
    model: "gpt-5-nano",
    models: ["gpt-5-nano", "gpt-5-mini", "gpt-4o-mini"],
    hint: "⚠️ انفحص وطلع 4/6 — بيغلط بالكمية وبيبتر العنوان أحياناً" },
  { id: "aisa", name: "AIsa", base: "https://api.aisa.one/v1", model: "qwen-flash",
    models: ["qwen-flash"], hint: "المفتاح بيبدأ بـsk-aisa-" },
  // ⚠️ الترتيب مقصود: gpt-5-mini أول لأنه انفحص وطلع 6/6 بكل,
  //    جولة، بينما nano ثبت على 4/6 — بيغلط بالكمية أو بيبتر,
  //    العنوان ("كفر اسد" صارت "الكفر"). نفس المفتاح ونفس الحساب.
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
        body: JSON.stringify(buildBody({
          model: opts.model || c.model, prompt, json, temperature, maxTokens
        })),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, text: "", error: d?.error?.message || `HTTP ${r.status}` };
      const out = d?.choices?.[0]?.message?.content || "";
      // نموذج تفكير خلص رصيده قبل ما يكتب الرد → نص فاضي.
      // بنعتبرها فشل صريح، لأنّ الرد الفاضي بيمشي بصمت وبيوقف
      // البوت عن الرد بلا ما تعرف السبب.
      if (!out.trim() && d?.choices?.[0]?.finish_reason === "length")
        return { ok: false, text: "",
                 error: "النموذج خلّص رصيد التوكنات بالتفكير قبل ما يكتب الرد — كبّر الحد أو استعمل نموذج أخف" };
      return { ok: true, text: out };
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
