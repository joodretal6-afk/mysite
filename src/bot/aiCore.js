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

// الافتراضي: OpenAI + gpt-4o-mini — بطلب صاحب المشروع (GPT فقط).
//
// انفحص على مهمة البوت الحقيقية (4 حالات × 3 جولات):
//   gpt-4o-mini   8/8 ×3 ✅  1045ms  $0.15/م إدخال · $0.60/م إخراج  ← المختار
//   gpt-5-mini    8/8 ×3 ✅  1196ms  $0.25/م إدخال · $2.00/م إخراج
//   gpt-5-nano    4/6 ×3 ⚠️  1120ms  — بيبتر العنوان وبيغلط بالكمية
//
// ليش 4o-mini: نفس دقة 5-mini بالضبط، وأرخص 3 أضعاف بالإخراج،
// وما في تاريخ إيقاف معلن إلو (بينما 5-mini معلن إيقافه 11/12/2026).
// ومسار الرد على الزبون انفحص فعلياً وطلع رد أردني سليم بأسعار
// الصفحة الحقيقية.
const DEFAULT_BASE  = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

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
  { id: "gpt4omini", name: "GPT-4o mini (الأفضل والأوفر)",
    base: "https://api.openai.com/v1", model: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-5-mini", "gpt-4o"],
    hint: "دقة كاملة بالفحص وأرخص خيار — المفتاح من platform.openai.com" },
  { id: "gpt5mini", name: "GPT-5 mini (دقيق — بس معلن إيقافه 11/12/2026)",
    base: "https://api.openai.com/v1", model: "gpt-5-mini",
    models: ["gpt-5-mini", "gpt-5"],
    hint: "نموذج تفكير — النظام بيضبط إعداداته لحاله" },
  { id: "gpt5nano", name: "GPT-5 nano (⚠️ الأرخص بس دقته 4/6 بالفحص)",
    base: "https://api.openai.com/v1", model: "gpt-5-nano",
    models: ["gpt-5-nano"],
    hint: "⚠️ بيبتر العنوان وبيغلط بالكمية — ما بنوصي فيه للطلبات" }
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

// ═══════════════════════════════════════════════════════════
// 🩺 تشخيص «ليش ما بيوصل رد للزبون؟»
//
// الرد بيمر بسلسلة حلقات، وأي حلقة مكسورة بتوقف كل شي بصمت.
// بدل ما تحزر، هون منفحصهم كلهم بالترتيب ومنقول أول حلقة
// مكسورة وشو الحل — بلا تخمين، كل فحص بيرجع الدليل معه.
// ═══════════════════════════════════════════════════════════
export async function botDiagnose() {
  const checks = [];
  const add = (name, ok, detail, fix = "") => checks.push({ name, ok, detail, fix });

  // 1) الإيقاف العام
  const paused = CONFIG.GLOBAL_PAUSE;
  add("البوت مش موقوف عام", !paused,
      paused ? "BOT_PAUSED=true — البوت بيأرشف بس وما بيرد" : "شغّال",
      "شيل متغيّر BOT_PAUSED أو خلّيه false");

  // 2) التسليم لذكاء ميتا (بيخرس بوتنا عمداً)
  let handed = false;
  try { ({ handedOverToMeta: handed } = await import("./capture.js"), handed = (await import("./capture.js")).handedOverToMeta()); }
  catch { /* الوحدة مش محمّلة */ }
  add("مش مسلّم لذكاء ميتا", !handed,
      handed ? "التسليم شغّال — بوتنا صامت بالكامل عمداً" : "بوتنا هو اللي بيرد",
      "من /admin/ai غيّر «مين بيرد على الزبائن» لـ«بوتنا»");

  // 3) مفتاح الذكاء
  const c = await aiConfig();
  const hasKey = c.useOpenAI ? !!c.key : !!c.gKey;
  add("مفتاح الذكاء مضبوط", hasKey,
      hasKey ? `${c.useOpenAI ? c.base : "Gemini"} · ${c.useOpenAI ? c.model : c.gModel}` : "ما في مفتاح",
      "احفظ المفتاح من /admin/ai");

  // 4) الذكاء بيرد فعلاً (نداء حقيقي)
  let aiOk = false, aiDetail = "ما انفحص — ما في مفتاح";
  if (hasKey) {
    const t = await aiComplete("اكتب كلمة: جاهز", { maxTokens: 20, timeoutMs: 20000 });
    aiOk = t.ok && !!String(t.text || "").trim();
    aiDetail = aiOk ? `رد: «${String(t.text).trim().slice(0, 40)}»` : (t.error || "رد فاضي");
  }
  add("الذكاء بيرد", aiOk, aiDetail, "افحص المفتاح والرصيد عند المزوّد");

  // 5) توكنات الصفحات — بلا توكن الرسالة بتنبنى وما بتنبعت
  let pages = [];
  try {
    const { PAGES } = await import("./brain.js");
    pages = Object.entries(PAGES).map(([id, p]) => ({
      id, name: p.name, token: !!p.PAGE_TOKEN, source: p._tokenSource || "الكود"
    }));
  } catch { /* لا شيء */ }
  const noTok = pages.filter((p) => !p.token);
  add("كل الصفحات إلها توكن", pages.length > 0 && noTok.length === 0,
      pages.length ? (noTok.length ? `بلا توكن: ${noTok.map((p) => p.name).join("، ")}`
                                   : `${pages.length} صفحة — كلها مربوطة`)
                   : "ما في صفحات معرّفة",
      "ضيف PAGE_TOKEN_<معرّف الصفحة> بمتغيّرات البيئة");

  // 6) مساحة القرص — القرص الممتلئ بيوقف كتابة الطلبات نفسها،
  //    وهاي أخطر من توقف الرد: الزبون بيطلب والطلب ما بينحفظ.
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dbPath = process.env.DB_PATH || "./data/platform.db";
    if (fs.existsSync(dbPath)) {
      const dir = path.dirname(dbPath);
      const st = fs.statfsSync(dir);
      const freeMb = Math.round((Number(st.bavail) * Number(st.bsize)) / 1048576);
      const dbMb = Math.round(fs.statSync(dbPath).size / 1048576);
      add("في مساحة على القرص", freeMb > Math.max(20, dbMb * 2),
          `${freeMb} ميجا فاضي · القاعدة ${dbMb} ميجا`,
          "احذف النسخ القديمة من /data/backups أو كبّر القرص من لوحة الاستضافة");
    }
  } catch { /* مش وضع قرص محلي */ }

  // 7) هل الذكاء شغّال على المزوّد اللي اخترته فعلاً؟
  //    لو في GEMINI_API_KEY بالبيئة وما في مفتاح بوابة، النظام
  //    بيقع على Gemini بصمت — والتاجر فاكر إنه على GPT.
  if (!c.useOpenAI && (process.env.GEMINI_API_KEY || c.gKey))
    add("المزوّد هو اللي اخترته", false,
        `شغّال على Gemini (${c.gModel}) — مش على GPT`,
        "احفظ مفتاح GPT من /admin/ai، أو شيل GEMINI_API_KEY من متغيّرات البيئة");

  // 8) توقيع الويبهوك — بلا سر أي حدا بيقدر يزوّر أحداث
  const sig = !!process.env.FB_APP_SECRET;
  add("سر التطبيق مضبوط", sig,
      sig ? "الأحداث بتتحقق" : "⚠️ الويبهوك بيقبل أي حدث بلا تحقق",
      "ضيف FB_APP_SECRET بمتغيّرات البيئة");

  const firstBroken = checks.find((x) => !x.ok);
  return {
    ok: !firstBroken,
    verdict: firstBroken
      ? `أول حلقة مكسورة: ${firstBroken.name} — ${firstBroken.detail}`
      : "كل الحلقات سليمة — البوت المفروض يرد",
    checks,
    pages
  };
}
