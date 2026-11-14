// ═══════════════════════════════════════════════════════════
// src/bot/gemini.js — بناء المهمة التالية + الاتصال المباشر بـ Gemini
// ═══════════════════════════════════════════════════════════
import { CONFIG } from "../config.js";
import { computeOrder } from "./order.js";

/**
 * تحديد المهمة التالية للبوت بناءً على حالة الجلسة الحالية (السلة، العنوان، الرقم، الحد الأدنى)
 */
export function buildNextTask(memory = {}, pageConfig = {}, crmData = null) {
  // 1) فحص حالة تحت الحد الأدنى للطلب (مثل نص كيلو أو 1 كيلو إذا كان الحد الأدنى أعلى)
  if (memory.belowMinQty) {
    const minNote = pageConfig.MIN_ORDER_NOTE || "أقل كمية للطلب والتوصيل هي 2 كيلو (أو حسب العرض المتوفر في الصفحة)";
    return `[توجيه حاسم]: الزبون طلب كمية أقل من الحد الأدنى المسموح (${
      typeof memory.belowMinQty === "string" ? memory.belowMinQty : "كمية صغيرة"
    }). اعتذر منه بلطف ووضّح له أن ${minNote}، واعرض عليه رفع الكمية للحد الأدنى حتى نعتمد طلبه فوراً. ممنوع إصدار فاتورة أو تأكيد الطلب قبل رفع الكمية.`;
  }

  const cart = memory.cart || {};
  const items = Object.keys(cart).filter(k => Number(cart[k]) > 0);
  const hasCart = items.length > 0;

  let preview = null;
  if (hasCart) {
    try {
      preview = computeOrder(pageConfig, cart, memory.coupon);
    } catch {}
  }

  // لو السلة فيها أصناف لكن computeOrder اعتبرها تحت الحد الأدنى
  if (preview && preview.belowMinimum) {
    const minMsg = preview.minimumMessage || pageConfig.MIN_ORDER_NOTE || "الكمية المطلوبة أقل من الحد الأدنى المعتمد للتوصيل";
    return `[توجيه حاسم]: السلة الحالية تحت الحد الأدنى (${minMsg}). اعتذر بلطف واطلب من الزبون زيادة الكمية للحد الأدنى، ولا تعده بإصدار فاتورة على السعر الحالي.`;
  }

  // 2) الزبون لم يحدد الصنف/الكمية بعد
  if (!hasCart) {
    if (crmData?.lastOrder) {
      return `[المهمة الحالية]: رحّب بالزبون بلطف ووضح له الأصناف والأسعار المتوفرة باختصار، واسأله شو حابب يطلب اليوم (علماً أن آخر طلب له كان: ${crmData.lastOrder}).`;
    }
    return `[المهمة الحالية]: أجب على استفسار الزبون بوضوح من معلومات الصفحة فقط، واسأله أي صنف وكم الكمية اللي حابب يطلبها.`;
  }

  const cartSummary = preview?.orderString || items.map(k => `${k} (${cart[k]})`).join(" + ");
  const totalStr = preview?.total ? ` — الحساب المبدئي: ${preview.total} دنانير` : "";

  // 3) الزبون أعطى رقم هاتف خاطئ/ناقص في الرسالة الأخيرة
  if (memory.invalidPhoneProvided) {
    return `[المهمة الحالية]: الطلب في السلة (${cartSummary}${totalStr}). الرقم الذي أرسله الزبون غير مكتمل أو غير صحيح؛ اطلب منه بلطف رقم موبايل أردني صحيح من 10 خانات يبدأ بـ 07.`;
  }

  const needArea = !memory.area || memory.addressReady === false;
  const needPhone = !memory.phone;

  // 4) ينقص العنوان والرقم معاً
  if (needArea && needPhone) {
    const addrQ = memory.addressQuestion || "المحافظة والمنطقة وأقرب معلم واضح";
    return `[المهمة الحالية]: السلة جاهزة (${cartSummary}${totalStr}). اطلب من الزبون شغلتين فقط لتثبيت الطلب: (1) العنوان بالتفصيل (${addrQ})، و(2) رقم الموبايل الأردني (10 أرقام يبدأ بـ 07). لا تطبع فاتورة نهائية من عندك.`;
  }

  // 5) ينقص العنوان فقط (أو العنوان غير كافٍ للتوصيل)
  if (needArea) {
    const addrQ = memory.addressQuestion || "في أي محافظة وأي منطقة/حي وأقرب معلم؟";
    return `[المهمة الحالية]: السلة جاهزة (${cartSummary}${totalStr}) ورقم الهاتف محفوظ (${memory.phone}). اطلب من الزبون العنوان فقط: ${addrQ}. لا تطبع فاتورة نهائية من عندك.`;
  }

  // 6) ينقص رقم الهاتف فقط
  if (needPhone) {
    return `[المهمة الحالية]: السلة جاهزة (${cartSummary}${totalStr}) والعنوان محفوظ (${memory.area}). اطلب من الزبون رقم موبايله الأردني فقط (10 خانات يبدأ بـ 07) لتثبيت الفاتورة فوراً.`;
  }

  // 7) الطلب مكتمل أو سبق إرسال الفاتورة
  if (memory.sent) {
    return `[المهمة الحالية]: الفاتورة أُرسلت وتثبّت الطلب مسبقاً (${cartSummary} — العنوان: ${memory.area} — الرقم: ${memory.phone}). أجب على استفسار الزبون باختصار واطمئنان، وإذا طلب تعديل الكمية أو الإلغاء تجاوب معه بلطف.`;
  }

  return `[المهمة الحالية]: البيانات مكتملة (${cartSummary} — ${memory.area} — ${memory.phone}). أكّد له بلطف وبجملة قصيرة استلام البيانات.`;
}

/**
 * جمع مفاتيح Gemini من الإعدادات أو متغيرات البيئة (يدعم مفتاح واحد أو عدة مفاتيح للتناوب)
 */
function resolveGeminiKeys() {
  const keys = [];
  if (Array.isArray(CONFIG?.GEMINI_KEYS)) keys.push(...CONFIG.GEMINI_KEYS);
  if (CONFIG?.GEMINI_API_KEY) keys.push(CONFIG.GEMINI_API_KEY);
  if (process.env.GEMINI_API_KEYS) keys.push(...process.env.GEMINI_API_KEYS.split(","));
  if (process.env.GEMINI_KEYS) keys.push(...process.env.GEMINI_KEYS.split(","));
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
  if (process.env.GOOGLE_API_KEY) keys.push(process.env.GOOGLE_API_KEY);
  return [...new Set(keys.map(k => String(k || "").trim()).filter(Boolean))];
}

/**
 * إرسال المحادثة (نص + صوت اختياري) إلى Google Gemini وإرجاع النص النظيف
 * متوافقة مع كلا صيغتي الاستدعاء:
 * 1) askGemini(history, userMsg, audioPart, pageConfig, memory, crmData, extraKnowledge)
 * 2) askGemini({ systemPrompt, history, userMsg, audioPart, model, temperature })
 */
export async function askGemini(arg1, userMsg = "", audioPart = null, pageConfig = {}, memory = {}, crmData = null, extraKnowledge = "") {
  let systemPrompt = "";
  let history = [];
  let text = "";
  let audio = null;
  let model = CONFIG?.GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
  let temperature = 0.35;

  // دعم الاستدعاء ككائن إعدادات جاهز من ai.js أو كمعاملات متتابعة مباشرة
  if (arg1 && typeof arg1 === "object" && !Array.isArray(arg1)) {
    systemPrompt = arg1.systemPrompt || arg1.system || arg1.systemInstruction || "";
    history = Array.isArray(arg1.history) ? arg1.history : [];
    text = String(arg1.userMsg ?? arg1.prompt ?? arg1.text ?? "");
    audio = arg1.audioPart || arg1.audio || null;
    if (arg1.model) model = arg1.model;
    if (typeof arg1.temperature === "number") temperature = arg1.temperature;
  } else {
    history = Array.isArray(arg1) ? arg1 : [];
    text = String(userMsg || "");
    audio = audioPart;
    const baseSystem =
      pageConfig?.SYSTEM ||
      pageConfig?.SYSTEM_PROMPT ||
      `أنت موظف مبيعات أردني لبق ومختصر في صفحة "${pageConfig?.name || "المتجر"}". التزم بأسعار الصفحة فقط ولا تخترع أي سعر أو عرض أو عنوان.`;
    const pricesBlock = pageConfig?.PRICES
      ? "\n\n[الأسعار المعتمدة بالدينار الأردني]:\n" +
        Object.entries(pageConfig.PRICES)
          .map(([k, v]) => `• ${k}: ${v}د${pageConfig?.UNITS?.[k] ? ` (${pageConfig.UNITS[k]})` : ""}`)
          .join("\n")
      : "";
    const nextTask = buildNextTask(memory, pageConfig, crmData);
    systemPrompt = [baseSystem, pricesBlock, extraKnowledge, nextTask].filter(Boolean).join("\n\n");
  }

  const keys = resolveGeminiKeys();
  if (!keys.length) {
    console.error("🔴 askGemini: لا يوجد أي مفتاح GEMINI_API_KEY في البيئة أو الإعدادات");
    return "";
  }

  // بناء سجل المحادثة بصيغة Gemini API
  const contents = [];
  for (const h of history.slice(-(CONFIG?.MAX_HISTORY || 12))) {
    if (!h || !h.content) continue;
    const role = h.role === "assistant" || h.role === "model" ? "model" : "user";
    const cleanText = String(h.content).trim();
    if (!cleanText) continue;
    contents.push({ role, parts: [{ text: cleanText }] });
  }

  // بناء رسالة الزبون الحالية (نص + مرفق صوتي إن وُجد)
  const userParts = [];
  if (audio && audio.data) {
    userParts.push({
      inlineData: {
        mimeType: audio.mimeType || audio.mime_type || "audio/ogg",
        data: audio.data
      }
    });
  }
  if (text && text !== "[رسالة صوتية]") {
    userParts.push({ text });
  } else if (userParts.length > 0) {
    userParts.push({ text: "استمع للرسالة الصوتية من الزبون وأجب عليها باللهجة الأردنية حسب تعليمات الصفحة." });
  }

  if (!userParts.length) return "";
  contents.push({ role: "user", parts: userParts });

  const payload = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: 700
    }
  };

  if (systemPrompt && String(systemPrompt).trim()) {
    payload.systemInstruction = { parts: [{ text: String(systemPrompt).trim() }] };
  }

  // تجربة الموديل الأساسي ثم الاحتياطي في حال ضغط السيرفر أو اختلاف اسم الموديل
  const modelsToTry = [...new Set([model, "gemini-2.0-flash", "gemini-1.5-flash"].filter(Boolean))];

  for (const m of modelsToTry) {
    for (const key of keys) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(key)}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(20000)
        });

        if (!res.ok) {
          const errTxt = await res.text().catch(() => "");
          console.warn(`⚠️ askGemini HTTP ${res.status} (${m}): ${errTxt.slice(0, 180)}`);
          if (res.status === 404) break; // الموديل غير متاح، انتقل للموديل الاحتياطي فوراً
          continue;                      // المفتاح عليه ضغط 429/403، جرّب المفتاح التالي
        }

        const data = await res.json();
        const reply = (data?.candidates?.[0]?.content?.parts || [])
          .map(p => p?.text || "")
          .join("")
          .trim();

        if (reply) return reply;
      } catch (err) {
        console.error(`🔴 askGemini error (${m}):`, err && err.message);
      }
    }
  }

  return "";
}

export default { buildNextTask, askGemini };
