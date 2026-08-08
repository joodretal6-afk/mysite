// ═══════════════════════════════════════════════════════════
// معالجة حدث واحد (منطق البوت الأصلي + حفظ الأوردر في قاعدة البيانات)
// ═══════════════════════════════════════════════════════════
import { CONFIG } from "../config.js";
import { PAGES } from "./brain.js";
import { sendText, sendTyping, graphSend, notifyTelegram, fetchAudioAsBase64, openReplyWindow, closeReplyWindow } from "./messenger.js";
import { parseMessage, RESET_INTENT } from "./parser.js";
import { computeOrder } from "./order.js";
import { askAI, extractOrderWithAI } from "./ai.js";
import { saveOrder, updateOrder, updateOrderStatus, getKnowledge, logMessage, customerCompletedCount, customerCompletedCountBySender, addReview, getActiveAddons, getRecentOpenOrderId, getActiveCouponsList, incrementCouponUse, flagHandoff, isBotPaused, customerHistoryHint, isBlocked, priceOverrideMap, getSetting, lastCompletedOrder, setCancelReason } from "../db/database.js";

// إلغاء صريح للطلب (منفصل عن "تعديل/تغيير الرأي")
const CANCEL_INTENT = /(الغي الطلب|ألغي الطلب|الغاء الطلب|إلغاء الطلب|بطّل الطلب|بطل الطلب|ما بدي الطلب|ما عاد بدي|ما بديش|كنسل|cancel|لا تبعت|لا ترسل|ما بدي اكمل|ما بدي أكمل)/i;

// إعادة الطلب السابق بضغطة
const REPEAT_INTENT = /(نفس الطلب|الطلب السابق|زي المرة|زي كل مرة|عيد طلبي|أعد طلبي|اعد طلبي|نفس اللي طلبت|نفس السابق|كرر الطلب|كرر طلبي|نفس الطلبية|الطلب الي فات|اللي فات|نفس طلبي)/i;

// كشف تاجر الجملة
const WHOLESALE_INTENT = /(جملة|بالجملة|تاجر|كرتون|كرتونة|كراتين|محل|بقالة|بقالية|سوبر ?ماركت|سوبرماركت|كمية كبيرة|كميات كبيرة|بسعر الجملة|عرض جملة)/i;

// هل ذكر الزبون هذا الصنف الإضافي؟ (بالاسم الكامل أو أول كلمة مميّزة منه)
function addonMentioned(text, addonName) {
  const nm = String(addonName || "").trim();
  if (!nm || !text) return false;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const first = nm.split(/\s+/)[0];
  try { return new RegExp(`(?:^|\\s)(?:${esc(nm)}|${esc(first)})`, "i").test(text); }
  catch { return text.includes(nm); }
}

// تحويل نص الطلب ("غنم (2 نصية) + شخل (1 نصية)") إلى سلة {صنف: عدد}
function parseOrderStringToCart(orderString) {
  const cart = {};
  for (const part of String(orderString || "").split("+")) {
    const m = part.match(/(.+?)\s*\((\d+(?:\.\d+)?)/);
    if (m) { const name = m[1].trim(); const qty = parseFloat(m[2]) || 0; if (name && qty > 0) cart[name] = qty; }
  }
  return cart;
}

// 🕐 هل نحن خارج ساعات العمل؟ (إعداد اختياري من الموقع)
function offHoursMessage() {
  try {
    const raw = getSetting("business_hours");
    if (!raw) return null;
    const bh = JSON.parse(raw);
    if (!bh || !bh.enabled) return null;
    const h = new Date().getHours();
    const from = Number(bh.from), to = Number(bh.to);
    const open = from <= to ? (h >= from && h < to) : (h >= from || h < to);
    return open ? null : (bh.msg || "شكراً لتواصلك 🌹 إحنا حالياً خارج ساعات العمل، بس طلبك وصلنا ورح نرد عليك أول ما نفتح بإذن الله.");
  } catch { return null; }
}

// 🙋 كشف حاجة الزبون لتدخّل بشري (غضب / يطلب موظف / حيرة) — بدون تكلفة ذكاء
function detectNeedsHuman(text) {
  if (!text) return null;
  const t = text.trim();
  // غضب/شكوى/شعور بالغش أو الاستياء (بمفردات أردنية) أو تهديد
  if (/(نصاب|نصب|احتيال|تخويت|تخوت|مخوّت|مخوت|بتخوّت|حرامي|حرامية|سرقة|بتسرقوا|بلّغ عنكم|ابلغ عنكم|بشتكي|شكوى|محامي|بقاطعكم|زفت|قرف|مقرف|كذابين|كذاب|وقحين|قليل أدب|قليلين أدب|قلة أدب|بكرهكم|أسوأ|اسوأ|فاشلين|غشيتوني|غششتوني|غش|بتغشوا|زعلان|زعلانة|زعلانه|متضايق|متضايقة|مش راضي|مش راضية|ما رح ارضى|ما راح ارضى|مش عاجبني الاسلوب|اسلوبكم|أسلوبكم|الاسلوب|حرام عليكم|عيب عليكم|غالي كتير|بتغلوا)/i.test(t))
    return { reason: "زبون غاضب/شكوى/استياء", pause: true };
  // يطلب موظف بشري صراحةً
  if (/(بدي (?:احكي|أحكي|اتواصل|أتواصل) مع (?:حدا|موظف|شخص|إنسان|انسان|بشر|مدير|صاحب المحل)|في حدا (?:بيرد|يرد|موجود)|بدي موظف|بدي مدير|بدي صاحب|موظف بشري|مش بوت|إنت بوت|انت بوت|انتا بوت|بدي إنسان|بدي انسان|بدي احكي مع زلمة)/i.test(t))
    return { reason: "يطلب موظف بشري", pause: true };
  return null;
}

// 👩 كشف جنس الزبون من كلامه (علامات المؤنث) — لمخاطبته بالصيغة الصحيحة
function detectGender(text) {
  if (!text) return null;
  // أفعال/صفات تدل على أن المتكلّمة أنثى (تتحدث عن نفسها) — نهاية الكلمة بحدّ غير حرفي
  if (/(زعلان[ةه]|حاس[ةه]|حابب?[ةه]|جاهز[ةه]|موافق[ةه]|متأكد[ةه]|مبسوط[ةه]|متضايق[ةه]|رافض[ةه]|مشتاق[ةه]|مستني[ةه]|قاعد[ةه]|منزعج[ةه]|متضايق[ةه])(?=\s|$|[.,!؟،:])/i.test(text)
      || /(شكرا حبيبتي|أختك الكريمة|اختك الكريمة|انا ست|أنا ست|انا بنت|أنا بنت)/i.test(text))
    return "f";
  return null;
}

// كشف تقييم/رأي الزبون من نص الرسالة (مع تفادي النفي والالتقاط الخاطئ)
function detectReview(text) {
  if (!text) return null;
  const star = text.match(/([1-5])\s*(?:نجوم|نجمة|نجمات|stars?|⭐)/i);
  if (star) return { rating: parseInt(star[1], 10), comment: text.slice(0, 200) };
  // شكوى صريحة فقط (كلمات قوية) — مع استثناء النفي "ما/مش/مو"
  const complaint = /(سيئ|زفت|رديئة|رديء|بشعة|ما عجبتني|مش راضي|زعلان منكم|خربانة)/i.test(text);
  const negated = /(ما|مش|مو|مو في|بدون)\s+\S*(تأخر|سيئ|مشكلة|زفت)/i.test(text);
  if (complaint && !negated) return { rating: 2, comment: text.slice(0, 200) };
  const praise = /(ممتاز|رائع|زاكي|زاكية|طيبة كتير|حلوة كتير|بنصح فيكم|تسلم ايديكم|يعطيكم العافية|أحلى جبنة|احلى جبنة|ما شاء الله عليكم|ماشاء الله عليكم|أفضل جبنة|افضل جبنة)/i.test(text);
  if (praise && text.length < 140) return { rating: 5, comment: text.slice(0, 200) };
  return null;
}

// هل الرسالة تحتوي طلب منتج؟ (حتى لا نلتقط تقييماً وسط بناء طلب)
function cartAddedThisTurn(text, pageConfig) {
  const kws = pageConfig.PRODUCT_KEYWORDS || {};
  return Object.values(kws).some(rx => rx.test(text));
}

// غلاف يفتح "نافذة الرد" أثناء معالجة رسالة واردة فقط، ويقفلها بعدها دائماً.
// خارج هذه النافذة، طبقة الإرسال ترفض أي رسالة للزبون (ضمان عدم الإرسال الاستباقي).
export async function handleEvent(event, env, ctx) {
  openReplyWindow();
  try {
    return await _handleEvent(event, env, ctx);
  } finally {
    closeReplyWindow();
  }
}

async function _handleEvent(event, env, ctx) {
  if (!event || event.optin) return;                       // كبسة الإشعارات OTN
  if (!event.message || event.message.is_echo) return;

  const senderId = event.sender?.id;
  const recipientId = event.recipient?.id;
  if (!senderId || !recipientId) return;

  const pageConfig = PAGES[recipientId];
  if (!pageConfig || !env.SESSIONS_KV) return;

  // 🛑 صفحة موقوفة عن العمل: تجاهل الرسالة تماماً (لا رد ولا حفظ)
  if (CONFIG.DISABLED_PAGES.includes(recipientId)) return;

  // 🚫 زبون محظور: تجاهل تماماً
  try { if (isBlocked(senderId)) return; } catch (e) { console.error("block check:", e && e.message); }

  // 💵 دمج أسعار الموقع (التعديلات اليدوية تتجاوز أسعار الكود) في نسخة فعّالة من إعداد الصفحة
  let effConfig = pageConfig;
  try {
    const ov = priceOverrideMap(recipientId);
    if (ov && Object.keys(ov).length) effConfig = { ...pageConfig, PRICES: { ...pageConfig.PRICES, ...ov } };
  } catch (e) { console.error("price override:", e && e.message); }

  // 🛒 دمج الأصناف الإضافية (addons) — للجبنة فقط. الصفحات ذات المعرفة الخاصة (SYSTEM) مستثناة تماماً.
  let activeAddons = [];
  try { if (!pageConfig.SYSTEM) activeAddons = getActiveAddons() || []; } catch {}
  if (activeAddons.length) {
    const aPrices = {}, aUnits = {};
    for (const a of activeAddons) {
      const nm = String(a.name || "").trim();
      if (!nm) continue;
      aPrices[nm] = Number(a.price) || 0;
      aUnits[nm] = /كيلو|كغ|كجم/.test(a.weight || "") ? "كيلو" : (String(a.weight || "").trim() || "قطعة");
    }
    effConfig = { ...effConfig,
      PRICES: { ...effConfig.PRICES, ...aPrices },
      UNITS: { ...(effConfig.UNITS || {}), ...aUnits }
    };
  }

  const token = pageConfig.PAGE_TOKEN;
  if (!token) { console.error("No page token for", recipientId); return; }

  // منع تكرار المعالجة لما فيسبوك يعيد إرسال نفس الرسالة
  const mid = event.message.mid;
  if (mid) {
    const seen = await env.SESSIONS_KV.get("MID_" + mid);
    if (seen) return;
    ctx.waitUntil(env.SESSIONS_KV.put("MID_" + mid, "1", { expirationTtl: 600 }));
  }

  ctx.waitUntil(sendTyping(token, senderId));

  const sessionKey = `${recipientId}_${senderId}`;
  const crmKey = `CRM_${senderId}`;

  let memory = await env.SESSIONS_KV.get(sessionKey, "json");
  const crmData = await env.SESSIONS_KV.get(crmKey, "json");

  if (!memory) {
    memory = {
      cart: {}, area: null, phone: null, sent: false,
      history: [], lastReply: "", invalidPhoneProvided: false, upsellOffered: false
    };
  }

  let userMsg = event.message.text ? event.message.text.trim() : "";
  let audioPart = null;

  const attachments = event.message.attachments || [];
  const audioAtt = attachments.find(a => a && a.type === "audio");
  if (audioAtt?.payload?.url) {
    audioPart = await fetchAudioAsBase64(audioAtt.payload.url);
    if (!userMsg) userMsg = "[رسالة صوتية]";
  }

  if (!userMsg && !audioPart) return;

  // 💬 حفظ رسالة الزبون في أرشيف الدردشات
  logMessage({
    page_id: recipientId, page_name: pageConfig.name, sender_id: senderId,
    direction: "in", body: userMsg, created_at: Date.now()
  });

  // 🛑 إيقاف عام للبوت (بطلب المالك): نؤرشف الرسالة فقط ولا نرد إطلاقاً
  if (CONFIG.GLOBAL_PAUSE) return;

  // 🙋 لو البوت معلّق لهذا الزبون (تدخّل بشري نشط): نؤرشف الرسالة فقط ولا نرد — الموظف يتولّى
  try {
    if (isBotPaused(recipientId, senderId)) {
      // نحفظ الرسالة في الذاكرة حتى يكمل السياق لو رجع البوت لاحقاً
      memory.history = memory.history || [];
      memory.history.push({ role: "user", content: userMsg });
      memory.history = memory.history.slice(-CONFIG.MAX_HISTORY);
      await env.SESSIONS_KV.put(sessionKey, JSON.stringify(memory), { expirationTtl: CONFIG.SESSION_TTL });
      return;
    }
  } catch (e) { console.error("pause check:", e && e.message); }

  // ⭐ التقاط التقييمات من كلام الزبون (نجوم / مديح / شكوى)
  try {
    const review = detectReview(userMsg);
    const isCustomer = memory.sent || customerCompletedCountBySender(senderId) > 0 ||
      (memory.phone && customerCompletedCount(memory.phone) > 0);
    // تقييم واحد لكل زبون بالجلسة (بدون تكرار) + ليس أثناء بناء طلب جديد
    const buildingOrder = cartAddedThisTurn(userMsg, pageConfig);
    if (review && isCustomer && !memory.reviewed && !buildingOrder) {
      addReview({
        page_id: recipientId, page_name: pageConfig.name, sender_id: senderId,
        phone: memory.phone || "", rating: review.rating, comment: review.comment
      });
      memory.reviewed = true;
    }
  } catch (e) { console.error("review capture:", e && e.message); }

  // 👩 كشف جنس الزبون (مرة تُثبَّت) — مبكراً حتى قبل أي تحويل بشري
  try { if (!memory.gender) { const g = detectGender(userMsg); if (g) memory.gender = g; } } catch {}

  // أمر التصفير
  if (/^(مسح|امسح|reset)$/i.test(userMsg)) {
    await env.SESSIONS_KV.delete(sessionKey);
    await sendText(token, senderId, "تم تفريغ السلة والبيانات، تفضل اطلب من جديد.");
    return;
  }

  // 📝 التقاط سبب الإلغاء (لو سألناه بعد إلغاء) — لتحليله لاحقاً
  if (memory.awaitingCancelReason) {
    try { setCancelReason(memory.awaitingCancelReason, userMsg); } catch {}
    memory.awaitingCancelReason = null;
    const th = "يسلمو على صراحتك 🌹 رح ناخد ملاحظتك بعين الاعتبار. وإذا بيوم غيّرت رأيك، إحنا بخدمتك دايماً.";
    await sendText(token, senderId, th);
    memory.history.push({ role: "user", content: userMsg }, { role: "assistant", content: th });
    memory.history = memory.history.slice(-CONFIG.MAX_HISTORY);
    await env.SESSIONS_KV.put(sessionKey, JSON.stringify(memory), { expirationTtl: CONFIG.SESSION_TTL });
    return;
  }

  // 🚫 إلغاء صريح للطلب: نعلّم الطلب "ملغي" ونؤكّد للزبون بوضوح (بدل ما يجادله البوت)
  if (CANCEL_INTENT.test(userMsg)) {
    try {
      if (!memory.orderId) memory.orderId = getRecentOpenOrderId(recipientId, senderId);
      if (memory.orderId) updateOrderStatus(memory.orderId, "ملغي");
    } catch (e) { console.error("cancel order:", e && e.message); }
    const cancelledId = memory.orderId;
    memory.cart = {};
    memory.sent = false;
    memory.coupon = null;
    memory.orderId = null;
    if (cancelledId) memory.awaitingCancelReason = cancelledId;   // نسأله عن السبب لتحليله
    const fem = memory.gender === "f";
    const ask = memory.gender === "f" ? "حابة" : "حابب";
    const ack = (fem
      ? "تم إلغاء طلبك 🌹 ولا يهمّك."
      : "تم إلغاء طلبك 🌹 ولا يهمّك.")
      + (cancelledId ? " بس عشان نتحسّن، ممكن تقلّي شو السبب؟ (السعر، الوقت، غيّرت رأيك...)" : ` إذا ${ask} تطلب من جديد أنا بخدمتك.`);
    await sendText(token, senderId, ack);
    logMessage({ page_id: recipientId, page_name: pageConfig.name, sender_id: senderId, direction: "out", body: ack, created_at: Date.now() });
    memory.history.push({ role: "user", content: userMsg }, { role: "assistant", content: ack });
    memory.history = memory.history.slice(-CONFIG.MAX_HISTORY);
    await env.SESSIONS_KV.put(sessionKey, JSON.stringify(memory), { expirationTtl: CONFIG.SESSION_TTL });
    return;
  }

  // 🔴 تغيير الرأي: بيفرّغ السلة وبيسمح بفاتورة جديدة حتى بعد ما تطلع فاتورة
  if (RESET_INTENT.test(userMsg)) {
    memory.cart = {};
    memory.sent = false;
  }

  // 🛒 إضافة صنف إضافي بعد الفاتورة: لو الزبون طلب صنف إضافي بعد ما طلعت الفاتورة،
  // نعيد فتح الطلب (بدون مسح السلة) ليُحدَّث ويُصدَّر من جديد شامل الإضافة.
  if (memory.sent && activeAddons.some(a => addonMentioned(userMsg, a.name))) {
    memory.sent = false;
  }

  // 🔁 إعادة الطلب السابق بضغطة: نعبّي السلة والعنوان والرقم من آخر طلب مكتمل
  if (REPEAT_INTENT.test(userMsg) && !memory.sent) {
    try {
      const last = lastCompletedOrder(senderId);
      if (last && last.order_string) {
        memory.cart = parseOrderStringToCart(last.order_string);
        if (!memory.area) memory.area = last.area || "";
        if (!memory.phone) memory.phone = last.phone || "";
        memory._repeated = true;   // نتخطى استخراج الذكاء هالدور حتى ما يمسح السلة
      }
    } catch (e) { console.error("repeat order:", e && e.message); }
  }

  // 🙋 كشف حاجة الزبون لتدخّل بشري (غضب / يطلب موظف) → تنبيه فوري + تعليق البوت + رسالة طمأنة
  try {
    const need = detectNeedsHuman(userMsg);
    if (need && !memory.handoffFlagged) {
      memory.handoffFlagged = true;
      flagHandoff({
        page_id: recipientId, page_name: pageConfig.name, sender_id: senderId,
        reason: need.reason, snippet: userMsg, pause: need.pause ? 1 : 0
      });
      ctx.waitUntil(notifyTelegram(
        `🙋 تدخّل بشري مطلوب — (${pageConfig.name})\n⚠️ ${need.reason}\n💬 «${userMsg.slice(0, 200)}»\n🔗 https://m.me/${senderId}`
      ));
      const ack = "آسفين على أي إزعاج 🌹 وصلت رسالتك، ورح يتواصل معك موظف من الفريق حالاً ويهتم فيك شخصياً. لحظات ونكون معك 🙏";
      await sendText(token, senderId, ack);
      logMessage({
        page_id: recipientId, page_name: pageConfig.name, sender_id: senderId,
        direction: "out", body: ack, created_at: Date.now()
      });
      memory.history.push({ role: "user", content: userMsg }, { role: "assistant", content: ack });
      memory.history = memory.history.slice(-CONFIG.MAX_HISTORY);
      await env.SESSIONS_KV.put(sessionKey, JSON.stringify(memory), { expirationTtl: CONFIG.SESSION_TTL });
      return;   // نوقف البوت هنا — الموظف يتولّى
    }
  } catch (e) { console.error("handoff detect:", e && e.message); }

  if (!memory.sent && userMsg !== "[رسالة صوتية]") {
    parseMessage(memory, userMsg, effConfig);
  }

  // 🧠 استخراج ذكي من كامل المحادثة (يفهم أي صياغة طبيعية ويكمّل النواقص)
  // نتخطّاه لو الزبون طلب إعادة طلبه السابق (حتى لا نمسح السلة المُعادة)
  if (!memory.sent && !memory._repeated) {
    try {
      const convText = [
        ...(memory.history || []).filter(h => h.role === "user").map(h => h.content),
        userMsg
      ].filter(Boolean).join("\n");
      const ai = await extractOrderWithAI(convText, effConfig);
      if (ai.ok) {
        // نستبدل السلة فقط لو الذكاء لقى طلباً فعلياً (حتى لا نمسح سلة سابقة برسالة سؤال/سلام)
        if (ai.is_order && ai.items.length) {
          memory.cart = {};
          ai.items.forEach(it => { memory.cart[it.product] = it.qty; });
        }
        // نحدّث العنوان/الرقم فقط لو الذكاء رجّع قيمة فعلية (لا نمسحهم)
        if (ai.area) memory.area = ai.area;
        if (ai.phone) { memory.phone = ai.phone; memory.invalidPhoneProvided = false; }
      }
      // لو فشل الذكاء (ai.ok=false) نُبقي نتائج الرادار كما هي
    } catch (e) {
      console.error("live AI extract failed:", e && e.message);
    }
  }

  // 🏠 العنوان المحفوظ: زبون قديم عندو أصناف بالسلة بس ناقص عنوان/رقم → نعبّيه من آخر طلب/الـCRM
  try {
    const cartHasItems = memory.cart && Object.keys(memory.cart).length > 0;
    if (cartHasItems && (!memory.area || !memory.phone)) {
      const last = lastCompletedOrder(senderId);
      if (!memory.area) memory.area = (crmData && crmData.lastArea) || (last && last.area) || memory.area;
      if (!memory.phone) memory.phone = (last && last.phone) || (crmData && crmData.phone) || memory.phone;
    }
  } catch (e) { console.error("saved address:", e && e.message); }

  // 🏢 كشف تاجر الجملة: كمية كبيرة أو كلمات جملة → تنبيه + ملاحظة (مرة لكل جلسة)
  try {
    const totalQty = memory.cart ? Object.values(memory.cart).reduce((a, b) => a + (Number(b) || 0), 0) : 0;
    if (!memory.wholesaleFlagged && (WHOLESALE_INTENT.test(userMsg) || totalQty >= 6)) {
      memory.wholesaleFlagged = true;
      const note = getSetting("wholesale_note") ||
        "🏢 إذا حابب كميات كبيرة أو بالجملة، عنا أسعار خاصة للتجار! خبّرني وبنرتّبلك عرض مميز.";
      memory._wholesaleNote = note;
      ctx.waitUntil(notifyTelegram(`🏢 زبون جملة محتمل — (${pageConfig.name})\n💬 «${userMsg.slice(0, 150)}»\n🔗 https://m.me/${senderId}`));
    }
  } catch (e) { console.error("wholesale detect:", e && e.message); }

  // 🎟️ كشف كود الخصم من رسالة الزبون (يُطبّق على الحساب)
  if (!memory.coupon) {
    try {
      const upper = userMsg.toUpperCase();
      for (const c of getActiveCouponsList()) {
        if (new RegExp(`(^|\\s)${c.code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(upper)) {
          memory.coupon = { code: c.code, type: c.type, value: c.value };
          break;
        }
      }
    } catch (e) { console.error("coupon detect:", e && e.message); }
  }

  const cartItemsCount = memory.cart ? Object.keys(memory.cart).length : 0;
  const complete = cartItemsCount > 0 && memory.area && memory.phone && !memory.invalidPhoneProvided;
  const readyForInvoice = complete && !memory.sent;

  const messengerUrl = `https://m.me/${senderId}`;

  // 🟢 وصول فوري للسستم: أي أوردر فيه أصناف + (عنوان أو رقم) ينزل باللوحة مباشرة
  const hasIntent = cartItemsCount > 0 && (memory.area || memory.phone);
  if (hasIntent) {
    try {
      const { total, orderString } = computeOrder(effConfig, memory.cart, memory.coupon);
      const status = complete ? "جديد" : "ناقص";
      // منع التكرار: لو ضاع orderId (انتهت الجلسة) استرجع الأوردر المفتوح لنفس الزبون
      if (!memory.orderId) memory.orderId = getRecentOpenOrderId(recipientId, senderId);
      if (memory.orderId) {
        updateOrder(memory.orderId, {
          order_string: orderString, total,
          area: memory.area || "", phone: memory.phone || "", status
        });
      } else {
        memory.orderId = saveOrder({
          page_id: recipientId, page_name: pageConfig.name, sender_id: senderId,
          order_string: orderString, total,
          area: memory.area || "", phone: memory.phone || "", status,
          messenger_url: messengerUrl, created_at: Date.now()
        });
      }
    } catch (e) {
      console.error("🔴 live upsert FAILED:", e && e.message, e && e.stack);
    }
  }

  let reply = "";
  let justSentInvoice = false;

  // 🔴 إصدار الفاتورة للزبون عند اكتمال الطلب (مرة واحدة)
  if (readyForInvoice) {
    const { total, orderString, detailedString, priceString } = computeOrder(effConfig, memory.cart, memory.coupon);
    reply = pageConfig.INVOICE_TEMPLATE(detailedString || orderString, priceString, memory.area, memory.phone);
    memory.sent = true;
    justSentInvoice = true;

    if (memory.coupon) { try { incrementCouponUse(memory.coupon.code); } catch {} }

    // 🎁 برنامج الولاء: كل طلب خامس مكتمل → مكافأة
    try {
      const loyaltyCount = customerCompletedCount(memory.phone);
      if (loyaltyCount > 0 && loyaltyCount % 5 === 0) {
        reply += `\n\n🎁 مبروك! هذا طلبك رقم ${loyaltyCount} معنا — كزبون وفيّ إلك خصم خاص على طلبك الجاي 🌹`;
      }
    } catch (e) { console.error("loyalty check:", e && e.message); }

    ctx.waitUntil(notifyTelegram(
      `🔔 طلب جديد من (${pageConfig.name})!\n\n🧀 الطلب: ${orderString}\n💰 الحساب: ${total}د\n📍 العنوان: ${memory.area}\n📞 التلفون: ${memory.phone}\n🔗 رابط الماسنجر: ${messengerUrl}`
    ));

    ctx.waitUntil(env.SESSIONS_KV.put(crmKey, JSON.stringify({
      lastOrder: orderString, lastArea: memory.area, phone: memory.phone, page: pageConfig.name
    }), { expirationTtl: CONFIG.CRM_TTL }));

  } else {
    let extraKnowledge = getKnowledge(recipientId);
    // 🛒 نُعلِم البوت بالأصناف الإضافية المتوفّرة حتى لا ينكر وجودها ويقدر يبيعها
    if (activeAddons.length) {
      extraKnowledge += "\n\n[أصناف إضافية متوفّرة للبيع فعلاً — لا تنكر وجودها أبداً. اعرضها وبِعها عادي، وإذا طلبها الزبون أضِفها لطلبه بسعرها]:\n" +
        activeAddons.map(a => `• ${a.name} — ${a.price}د${a.weight ? ` (${a.weight})` : ""}${a.description ? ` — ${a.description}` : ""}`).join("\n");
    }
    // 🎯 تخصيص للزبون السابق: نحقن أكثر أصنافه طلباً ليقترحها البوت بذكاء
    try { extraKnowledge += customerHistoryHint(senderId); } catch {}
    // 👩 مخاطبة الأنثى بالصيغة الصحيحة إن اكتُشف جنسها
    if (memory.gender === "f") {
      extraKnowledge += "\n\n[هام جداً] الزبونة أنثى — خاطبها دائماً بصيغة المؤنث (حياكي الله، تفضلي، يا هلا فيكي، أهلين فيكي، حبيبتي/أختي الكريمة، شو حابة، بدك تطلبي) ولا تستخدم أبداً (يا أخوي، يا غالي، يا شيخ، يا زعيم، حابب، بدك). كوني لطيفة ومحترمة.";
    }
    reply = await askAI(memory.history, userMsg, audioPart, pageConfig, memory, crmData, extraKnowledge);
    memory.invalidPhoneProvided = false;   // بعد ما ننبّه الزبون منصفّر الفلاغ
  }

  // 🕐 تنبيه خارج ساعات العمل (مرة واحدة لكل جلسة) قبل الرد العادي
  try {
    if (!memory.offHoursNotified) {
      const oh = offHoursMessage();
      if (oh) { reply = oh + "[[SPLIT]]" + reply; memory.offHoursNotified = true; }
    }
  } catch (e) { console.error("off-hours:", e && e.message); }

  // 🏢 ملاحظة الجملة (لو اكتُشف تاجر) بعد الرد
  if (memory._wholesaleNote) { reply = reply + "[[SPLIT]]" + memory._wholesaleNote; memory._wholesaleNote = null; }

  // إرسال الرد (مع دعم تقسيمه لرسالتين عبر [[SPLIT]])
  const chunks = reply.split("[[SPLIT]]").map(s => s.trim()).filter(Boolean);
  for (const chunk of chunks) {
    await sendText(token, senderId, chunk);
  }

  // 🛒 بيع إضافي: بعد اكتمال الطلب (للجبنة فقط — الصفحات ذات المعرفة الخاصة مستثناة)
  if (justSentInvoice && !pageConfig.SYSTEM) {
    try {
      const addons = getActiveAddons();
      if (addons.length) {
        const lines = addons.map(a =>
          `• ${a.name} — ${a.price}د${a.weight ? ` (${a.weight})` : ""}${a.description ? ` — ${a.description}` : ""}`
        ).join("\n");
        await sendText(token, senderId,
          `🌟 وقبل ما نجهّز طلبك، عنا كمان أصناف بتحب تضيفها؟\n\n${lines}\n\nإذا حاب شي، بس قلّي شو بتضيف ونزيده على طلبك 🌹`);
      }
    } catch (e) { console.error("cross-sell:", e && e.message); }
  }

  // ⚠️ حُذف زر الإشعارات (OTN) نهائياً — إشعارات استباقية خارج المحادثة (شبهة مخالفة).

  memory.lastReply = chunks.join(" ");

  // 💬 حفظ رد البوت في أرشيف الدردشات
  logMessage({
    page_id: recipientId, page_name: pageConfig.name, sender_id: senderId,
    direction: "out", body: memory.lastReply, created_at: Date.now()
  });

  memory.history.push(
    { role: "user", content: userMsg },
    { role: "assistant", content: memory.lastReply }
  );
  memory.history = memory.history.slice(-CONFIG.MAX_HISTORY);

  // (أُزيلت جدولة المتابعة التلقائية — لا إرسال استباقي إطلاقاً)

  await env.SESSIONS_KV.put(sessionKey, JSON.stringify(memory), { expirationTtl: CONFIG.SESSION_TTL });
}
