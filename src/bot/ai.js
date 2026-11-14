// ═══════════════════════════════════════════════════════════
// موزّع الذكاء: يختار بين Gemini و OpenAI (ChatGPT)
// ═══════════════════════════════════════════════════════════
import { CONFIG } from "../config.js";
import { COMMON_KNOWLEDGE, SALES_PERSONA, SALES_BEHAVIOR } from "./brain.js";
import { ADDRESS_EXPERT } from "./addressExpert.js";
import { buildNextTask, askGemini } from "./gemini.js";
import { extractQty, isKiloModePage } from "./parser.js";

const DEFAULT_BASE = "https://api.openai.com/v1";
function oaiBase() {
  const b = process.env.OPENAI_BASE_URL || siteSetting("ai_base") || DEFAULT_BASE;
  return String(b).replace(/\/+$/, "");
}

function siteSetting(key) {
  try {
    return (globalThis.__aiSettings && globalThis.__aiSettings(key)) || "";
  } catch { return ""; }
}
export function oaiKey()   { return process.env.OPENAI_API_KEY || siteSetting("ai_key") || ""; }
export function oaiModel() { return process.env.OPENAI_MODEL || siteSetting("ai_model") || "gpt-4o-mini"; }

async function oaiBody(args) {
  const { buildBody } = await import("./aiCore.js");
  return buildBody(args);
}

function chosenProvider() {
  return "openai";
}

export async function askAI(history, userMsg, audioPart, pageConfig, memory, crmData, extraKnowledge = "") {
  if (chosenProvider() === "openai") {
    return askOpenAI(history, userMsg, audioPart, pageConfig, memory, crmData, extraKnowledge);
  }
  return askGemini(history, userMsg, audioPart, pageConfig, memory, crmData, extraKnowledge);
}

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

  const kiloMode = isKiloModePage(pageConfig);
  const minQty = Number(pageConfig.MINIMUM_QUANTITY || 0);

  const bundles = Array.isArray(pageConfig.BUNDLE_OFFERS) ? pageConfig.BUNDLE_OFFERS : [];
  const bundleText = bundles.length
    ? `\nالعروض المتاحة: ${bundles.map(b => {
        const comps = (b.products || []).map(p => typeof p === "string" ? p : p.name).filter(Boolean).join(" + ");
        const inc = b.includesDelivery || b.deliveryIncluded;
        return `${b.label || b.name} = ${b.price} دينار${inc ? " شامل التوصيل" : ""}; مكونات العرض: ${comps}`;
      }).join("\n")}. إذا قال الزبون «العرض» أو «البكج» أو طلب هذه المكونات كحزمة، أخرج مكونات العرض بالأسماء الحرفية من القائمة.`
    : "";

  // 🔴 قواعد كمية مخصصة حسب نظام بيع الصفحة (بالكيلو مقابل النصية/العبوة) لمنع تحويل "4 كيلو" إلى 1!
  const quantityRulesPrompt = kiloMode
    ? `قواعد الكمية لهذه الصفحة (البيع بالكيلو مباشرة — التزم بها حرفياً):
- 🔴 البيع في هذه الصفحة (${pageConfig.name}) بالكيلو مباشرة وليس بالنصية! الوحدة الواحدة = 1 كيلو.
- أي ذكر لـ "2 كيلو" أو "كيلوين" ⇒ qty = 2.
- أي ذكر لـ "3 كيلو" أو "ثلاث كيلو" ⇒ qty = 3.
- أي ذكر لـ "4 كيلو" أو "اربع كيلو" أو "أربعة كيلو" ⇒ qty = 4 (ممنوع منعاً باتاً إرجاع 1 عندما يطلب 4 كيلو!).
- أي ذكر لـ "5 كيلو" ⇒ qty = 5، وهكذا (qty تساوي عدد الكيلوات الفعلي الذي طلبه الزبون).
- ${minQty > 1 ? `أقل كمية مسموحة للطلب في هذه الصفحة هي ${minQty} كيلو. إذا طلب الزبون 1 كيلو اكتب qty: 1 ليرفضه حارس الحد الأدنى، وإذا لم يذكر الزبون عدد الكيلوات بعد فلا تفترض qty: 1 من عندك أبداً بل اجعل items فارغة [] حتى يحدد الكمية.` : `إذا لم يذكر الزبون كمية واضحة اجعل qty = 1.`}
- لا تحسب أرقام الهاتف أو العنوان أو السعر بالدينار (مثل 10 دنانير أو 18 دينار) كأنها كمية أبداً.`
    : `قواعد الكمية (دقيقة جداً — التزم بها حرفياً):
- 🔴 الوزن ليس كمية إطلاقاً في صفحات النصية. النصية الواحدة وزنها 4 كيلو (4200غ). أي ذكر لـ "4 كيلو" أو "4200غ" = كمية 1 (نصية واحدة) وليس 4.
- التطابق: نصية/حبة/وحدة/عبوة/واحدة/عرض = 1 ، نصيتين/حبتين/عبوتين/عرضين = 2 ، ثلاث = 3 ، أربع = 4.
- "8 كيلو"=2 ، "12 كيلو"=3 ، "16 كيلو"=4 (كل 4 كيلو = نصية واحدة).
- لا تحسب أرقام الهاتف أو العنوان أو السعر أو الغرامات كأنها كمية أبداً.
- إذا الزبون قال "حبة/وحدة/واحدة/نصية" فالكمية = 1 مهما ذُكر من كيلوهات أو غرامات معها.
- إذا الكمية غير واضحة أو مبهمة، اجعل الكمية 1 (لا تضاعفها من عندك أبداً).`;

  const prompt =
`أنت محلّل طلبات دقيق لمتجر أردني (${pageConfig.name}). استخرج الطلب من محادثة الزبون التالية.
الأصناف المتاحة في هذه الصفحة فقط (لا تخترع غيرها): ${allowed.join(" ، ")}.${bundleText}

${ADDRESS_EXPERT}

أعد JSON فقط بهذا الشكل بالضبط:
{"is_order": true أو false, "items": [{"product": "<اسم صنف من القائمة أعلاه حرفياً>", "qty": <عدد صحيح>}], "area": "<العنوان كما كتبه الزبون حرفياً بكلماته، أو فراغ>", "phone": "<رقم أردني بصيغة 07xxxxxxxx كتبه الزبون، أو فراغ>"}

🔴🔴 القاعدة الأهم فوق كل شي — ممنوع الاختراع أو الافتراض أو التخمين:
- لا تكتب في "area" إلا كلمات ذكرها الزبون **حرفياً** في رسائله. ممنوع تستنتج محافظة، ممنوع تكمّل عنوان ناقص، ممنوع تضيف منطقة أو شارع أو معلم ما كتبه الزبون.
- لا تكتب رقم هاتف إلا إذا كان مكتوباً فعلاً في رسائل الزبون.
- إذا المعلومة غير موجودة بوضوح في كلام الزبون: اترك الحقل فراغاً "".

${quantityRulesPrompt}
- لو ما في نية طلب واضحة (مجرد سؤال/سلام) اجعل is_order=false و items فارغة.
- طابق اسم الصنف مع القائمة المتاحة.

المحادثة:
${conversationText.slice(0, 6000)}`;

  let raw = "";
  try {
    if (chosenProvider() === "openai") {
      const resp = await fetch(`${oaiBase()}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${oaiKey()}` },
        body: JSON.stringify(await oaiBody({
          model: oaiModel(), prompt, json: true, temperature: 0, maxTokens: 700
        })),
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

    const m = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : raw);

    // 🛡️ تصحيح حتمي لصفحات الكيلو (أجبان الرياض):
    // 1) نأخذ آخر كمية صريحة ذكرها الزبون في رسائله (فلو كتب "4 كيلو" ورجّع النموذج 1 بالخطأ، نصححها فوراً إلى 4).
    // 2) لو كانت الصفحة بحد أدنى > 1 ولم يذكر الزبون أي كمية إطلاقاً، نمنع افتراض qty=1 الذي يولّد طلب 6 دنانير.
    const lines = String(conversationText).split("\n").map(s => s.trim()).filter(Boolean);
    let latestExplicitQty = 0;
    for (const ln of lines) {
      const q = extractQty(ln, pageConfig);
      if (q > 0) latestExplicitQty = q;
    }

    let items = (Array.isArray(parsed.items) ? parsed.items : [])
      .map(it => ({ product: String(it.product || "").trim(), qty: parseFloat(it.qty) || 1 }))
      .filter(it => allowed.includes(it.product) && it.qty > 0);

    if (kiloMode) {
      if (latestExplicitQty >= (minQty || 1) && items.length === 1) {
        items[0].qty = latestExplicitQty;
      } else if (minQty > 1) {
        if (latestExplicitQty > 0 && latestExplicitQty < minQty) {
          // الزبون طلب صراحة أقل من الحد الأدنى (مثلاً 1 كيلو) -> نفرغ السلة حتى لا ينزل طلب 6 دنانير
          items = [];
        } else if (latestExplicitQty === 0) {
          // الزبون لم يذكر أي كمية في المحادثة -> امنع أي كمية مخترعة أقل من الحد الأدنى
          items = items.filter(it => it.qty >= minQty && latestExplicitQty >= minQty);
        } else {
          items = items.filter(it => it.qty >= minQty);
        }
      }
    }

    return {
      ok: true,
      is_order: !!parsed.is_order && items.length > 0,
      below_min_qty: (kiloMode && minQty > 1 && latestExplicitQty > 0 && latestExplicitQty < minQty) ? latestExplicitQty : 0,
      items,
      area: String(parsed.area || "").slice(0, 200).trim(),
      phone: normalizePhone(parsed.phone)
    };
  } catch (e) {
    console.error("AI extract failed:", e && e.message);
    return { ok: false, is_order: false, items: [], area: "", phone: "" };
  }
}

async function transcribeOpenAI(audioPart) {
  try {
    const bytes = Buffer.from(audioPart.inlineData.data, "base64");
    const blob = new Blob([bytes], { type: audioPart.inlineData.mimeType || "audio/mp4" });
    const form = new FormData();
    form.append("file", blob, "audio.m4a");
    form.append("model", CONFIG.OPENAI_TRANSCRIBE_MODEL);
    const r = await fetch(`${oaiBase()}/audio/transcriptions`, {
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
    crmContext = `\nملاحظة هامة: هذا زبون قديم (رحّب به كزبون دائم واعرض عليه تكرار طلبه إن رغب). 🔴 لا تفترض عنوانه أو رقمه من طلب سابق — اطلبهما منه في هذه المحادثة.`;
  }
  const adminKnowledge = extraKnowledge && extraKnowledge.trim()
    ? `\n\n[معلومات إضافية موثوقة من إدارة الصفحة — اعتمدها بأولوية عالية]\n${extraKnowledge.trim()}`
    : "";

  const nextTask = buildNextTask(memory, pageConfig);
  const unitLabel = pageConfig.DEFAULT_UNIT ? ` لكل ${pageConfig.DEFAULT_UNIT}` : "";
  const catalog = Object.keys(pageConfig.PRICES || {}).map(k => `${k} = ${pageConfig.PRICES[k]} د${unitLabel}`).join("، ");
  const bundleCatalog = (Array.isArray(pageConfig.BUNDLE_OFFERS) ? pageConfig.BUNDLE_OFFERS : [])
    .map(b => `${b.label || b.name || (b.products || []).map(p => typeof p === "string" ? p : p.name).join(" + ")} = ${b.price} د${(b.includesDelivery || b.deliveryIncluded) ? " شامل التوصيل" : ""}`)
    .join(" | ");
  const minOrderNote = pageConfig.MINIMUM_QUANTITY
    ? `\n🔴 الحد الأدنى للطلب في هذه الصفحة: ${pageConfig.MINIMUM_QUANTITY} ${pageConfig.DEFAULT_UNIT || "قطعة"}${pageConfig.MINIMUM_INVOICE_TOTAL ? ` (أقل فاتورة ${pageConfig.MINIMUM_INVOICE_TOTAL} دنانير شامل التوصيل — ممنوع نهائياً قبول كمية أقل أو ذكر فاتورة بـ 6 دنانير)` : ""}.`
    : "";

  const hardCatalog = `\n\n[كتالوج منتجات وأسعار إلزامي — هذه معلومات مؤكدة يجب الاعتماد عليها قبل أي شيء]
المنتجات: ${catalog || "لا يوجد"}
التوصيل: ${Number(pageConfig.DELIVERY || 0)} د${minOrderNote}
${bundleCatalog ? `العروض: ${bundleCatalog}\n` : ""}
إذا سأل الزبون عن أي منتج موجود أعلاه، فهو متوفر. ممنوع قول «ما عندي معلومات عنه» أو «غير موجود» لمنتج موجود في هذه القائمة. لا تغيّر الأسعار.`;

  const baseKnowledge = SALES_PERSONA + "\n\n" + (pageConfig.SYSTEM || COMMON_KNOWLEDGE) + "\n\n" + SALES_BEHAVIOR;
  const systemInst = `${baseKnowledge}\n\n${hardCatalog}\n\n${ADDRESS_EXPERT}\n\nصفحة: ${pageConfig.name}\n${pageConfig.INFO}${adminKnowledge}${crmContext}\n${nextTask}`;

  const messages = [{ role: "system", content: systemInst }];
  (history || []).forEach(h => {
    messages.push({ role: h.role === "assistant" ? "assistant" : "user", content: h.content || "" });
  });

  let finalUser = (userMsg && userMsg !== "[رسالة صوتية]") ? userMsg : "";
  if (audioPart) {
    const transcript = await transcribeOpenAI(audioPart);
    if (transcript) finalUser = (finalUser ? finalUser + "\n" : "") + transcript;
    else if (!finalUser) finalUser = "الزبون بعت رسالة صوتية غير واضحة، اطلب منه يعيدها كتابةً بلطف.";
  }
  messages.push({ role: "user", content: finalUser || "..." });

  try {
    const model = oaiModel();
    const body = await oaiBody({ model, prompt: "", json: false, temperature: 0.2, maxTokens: 400 });
    body.messages = messages;

    const resp = await fetch(`${oaiBase()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${oaiKey()}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CONFIG.GEMINI_TIMEOUT_MS)
    });

    if (!resp.ok) {
      console.error("OpenAI error:", resp.status, await resp.text());
      return null;
    }
    const data = await resp.json();
    let text = (data?.choices?.[0]?.message?.content || "").replace(/\*\*/g, "").trim();

    if (text && /(?:ما\s*عندي|لا\s*يوجد|غير\s*متوفر|غير\s*معروف).{0,40}(?:كلور|فلاش)/iu.test(text)) {
      const hasChlorine = Object.keys(pageConfig.PRICES || {}).some(k => /كلور/.test(k));
      const hasFlash = Object.keys(pageConfig.PRICES || {}).some(k => /فلاش/.test(k));
      if (/كلور/iu.test(text) && hasChlorine && !/فلاش/iu.test(text)) {
        text = `نعم، الكلور متوفر بـ7 دنانير، والتوصيل 2 دينار على الطلب الفردي.`;
      } else if (/فلاش/iu.test(text) && hasFlash && !/كلور/iu.test(text)) {
        text = `نعم، الفلاش متوفر بـ7 دنانير، والتوصيل 2 دينار على الطلب الفردي.`;
      }
    }
    return text || null;
  } catch (e) {
    console.error("OpenAI failed:", e && e.message);
    return null;
  }
}
