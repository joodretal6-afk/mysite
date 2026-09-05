// ═══════════════════════════════════════════════════════════
// معالجة حدث واحد (منطق البوت الأصلي + حفظ الأوردر في قاعدة البيانات)
// ═══════════════════════════════════════════════════════════
import { CONFIG } from "../config.js";
import { PAGES } from "./brain.js";
import { sendText, sendTyping, graphSend, sendAttachment, notifyTelegram, fetchAudioAsBase64, openReplyWindow, closeReplyWindow } from "./messenger.js";
import { parseMessage, RESET_INTENT } from "./parser.js";
import { computeOrder } from "./order.js";
import { parseAddress, groundAddress } from "./address.js";
import { withSessionLock } from "./lock.js";
import { attributeReorder } from "../features/whatsapp.js";
import { validateOrder, recordSource, sessionFingerprint } from "./validate.js";
import { inboxUrl } from "../brain/links.js";
import { askAI, extractOrderWithAI } from "./ai.js";
import { saveOrder, updateOrder, updateOrderStatus, getKnowledge, logMessage, customerCompletedCount, customerCompletedCountBySender, addReview, getActiveAddons, getRecentOpenOrderId, getActiveCouponsList, incrementCouponUse, flagHandoff, isBotPaused, customerHistoryHint, isBlocked, priceOverrideMap, getSetting, lastCompletedOrder, setCancelReason, db, retryDb } from "../db/database.js";

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
  // 🔒 قفل لكل جلسة: أحداث نفس العميل تنعالج بالتسلسل (الترتيب مضمون،
  //    ولا race على الجلسة). أحداث عملاء مختلفين تضل متوازية تماماً.
  const sid = event?.sender?.id, rid = event?.recipient?.id;
  const lockKey = (sid && rid) ? sessionFingerprint(rid, sid) : null;
  return withSessionLock(lockKey, async () => {
    openReplyWindow();
    try {
      return await _handleEvent(event, env, ctx);
    } finally {
      closeReplyWindow();
    }
  });
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

  // منع تكرار المعالجة لما فيسبوك يعيد إرسال نفس الرسالة.
  // 🔴 ذرّي: منكتب العلامة **قبل** المعالجة وننتظرها (await مش waitUntil).
  //    مع قفل الجلسة، فحص+كتابة العلامة بيصيروا بلا تسابق — فإعادة
  //    إرسال سريعة ما بتنعالج مرتين ولا بتطلع فاتورة/طلب مكرر.
  const mid = event.message.mid;
  if (mid) {
    const seen = await env.SESSIONS_KV.get("MID_" + mid);
    if (seen) return;
    await env.SESSIONS_KV.put("MID_" + mid, "1", { expirationTtl: 600 });
  }
  ctx.waitUntil(sendTyping(token, senderId));

  const sessionKey = `${recipientId}_${senderId}`;

  // مصدر البيانات: نستخدم معرّف رسالة فيسبوك لو موجود، وإلا معرّف
  // محلّي — المهم إثبات إنه من رسالة بهالجلسة (مش قيمة مفترَضة). بلا
  // هيك رسالة بلا mid كانت رح تخلّي كل الحقول "بلا مصدر" فما يكمل طلب.
  // 🔴 كان معرّف فوق **قبل** تعريف sessionKey — TDZ بيرمي ReferenceError
  //    وبيوقف المعالج كلياً لأي رسالة بلا mid. نقلناه تحت التعريف.
  const srcId = mid || `local:${sessionKey}:${Date.now()}`;
  const crmKey = `CRM_${senderId}`;

  let memory = await env.SESSIONS_KV.get(sessionKey, "json");
  const crmData = await env.SESSIONS_KV.get(crmKey, "json");

  if (!memory) {
    memory = {
      cart: {}, area: null, phone: null, sent: false,
      history: [], lastReply: "", invalidPhoneProvided: false, upsellOffered: false,
      prov: {}, sessionKey
    };
  }
  // 🔒 نثبّت بصمة الجلسة ونتحقق منها: لو الذاكرة المقروءة مفتاحها مش
  //    مفتاح جلستنا، يعني قراءة من سياق غلط — منبلّش من ذاكرة نظيفة
  //    بدل ما نخاطر نخلط بيانات عميل بعميل.
  if (memory.sessionKey && memory.sessionKey !== sessionKey) {
    console.error(`🔴 عدم تطابق بصمة الجلسة: ${memory.sessionKey} ≠ ${sessionKey} — ذاكرة نظيفة`);
    memory = { cart: {}, area: null, phone: null, sent: false, history: [],
               lastReply: "", invalidPhoneProvided: false, upsellOffered: false,
               prov: {}, sessionKey };
  }
  if (!memory.sessionKey) memory.sessionKey = sessionKey;
  if (!memory.prov) memory.prov = {};

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

  // 🤝 التسليم الكامل لذكاء ميتا: بوتنا يخرس تماماً — ولا رسالة
  //    ولا فاتورة ولا تنبيه. الرسالة انأرشفت فوق، ووضع الالتقاط
  //    بيتكفّل باستخراج الطلب. أي رد منّا هون بيتضاعف على الزبون.
  try {
    const { handedOverToMeta } = await import("./capture.js");
    if (handedOverToMeta()) return;
  } catch (e) { console.error("handover check:", e && e.message); }

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

  // 🎬 فيديوهات المنتجات: لو الزبون سأل عن المنتجات (الثانية) وعندنا
  //    فيديوهات مرفوعة لهالصفحة، نبعتها مرة وحدة بالجلسة. بينضاف فوق
  //    رد البوت العادي، وما بيشتغل وإحنا بنكمّل طلب (رقم/منطقة).
  try {
    const asksProducts = /منتجات|المنتج|منتجاتك|اصناف|أصناف|بضاعة|بضائع|بتبيعو|شو عندك|شو في عندك|ايش عندك|وش عندك|شو المتوفر|شو متوفر|معاين|أعاين|اعاين|أشوف|اشوف|فرجيني|فيديو|صور/i.test(userMsg);
    if (asksProducts && !memory.videosSent && !cartAddedThisTurn(userMsg, pageConfig)) {
      const { videosForPage } = await import("../features/videos.js");
      const vids = videosForPage(recipientId);
      if (vids && vids.length) {
        for (const v of vids.slice(0, 10)) {
          await sendAttachment(token, senderId, v.url, "video");
          if (v.label) await sendText(token, senderId, v.label);
        }
        memory.videosSent = true;
        // نثبّت العلامة فوراً بالجلسة — حتى لو البوت سكت بعدها (بلا رد
        // من الذكاء) وما وصل لحفظ الذاكرة بالآخر، ما بتنبعت الفيديوهات مرتين.
        try { await env.SESSIONS_KV.put(sessionKey, JSON.stringify(memory), { expirationTtl: CONFIG.SESSION_TTL }); } catch {}
        logMessage({
          page_id: recipientId, page_name: pageConfig.name, sender_id: senderId,
          direction: "out", body: `🎬 أرسل ${vids.length} فيديو منتجات`, created_at: Date.now()
        });
      }
    }
  } catch (e) { console.error("product videos:", e && e.message); }

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
        if (!memory.phone) memory.phone = last.phone || "";
        // 🔴 حتى بإعادة الطلب: ما منعبّي العنوان القديم لحالنا. منعيد
        //    الأصناف بس، والعنوان بيسأل عنه الزبون من جديد — بلكي الطلب
        //    لمكان ثاني. ما منفترض إنه نفس العنوان.
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
        `🙋 تدخّل بشري مطلوب — (${pageConfig.name})\n⚠️ ${need.reason}\n💬 «${userMsg.slice(0, 200)}»\n🔗 ${inboxUrl(recipientId, senderId)}`
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
    parseMessage(memory, userMsg, effConfig, srcId);
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
          // 🧾 مصدر الطلب: الذكاء استخرجه من رسائل الزبون بهالجلسة. بدون
          //    هالتسجيل كان التحقق النهائي يعتبر الطلب "ناقص" فما تطلع
          //    فاتورة أبداً — والبوت يأكّد بالكلام بس والطلب ما ينزل.
          recordSource(memory, "order", { ...memory.cart }, srcId);
        }
        // 🔴 ممنوع نثق بعنوان الذكاء الاصطناعي أعمى — ممكن يكون مخترعاً.
        // بنمرّره من بوابة التأريض: كل كلمة لازم تكون من كلام الزبون
        // الفعلي. إذا اخترع منطقة، بترفض ونضل نسأل الزبون بدل ما نطبع
        // عنوان غلط بالفاتورة.
        if (ai.area) {
          const g = groundAddress(ai.area, convText);
          if (g.ok) {
            const checked = parseAddress(g.grounded);
            // ما نستبدل عنواناً أقوى بأضعف
            if (!memory.addr || checked.score >= (memory.addressScore || 0)) {
              memory.addr = checked;
              memory.area = checked.formatted;
              memory.addressScore = checked.score;
              memory.addressLevel = checked.level;
              memory.addressReady = checked.deliverable;
              memory.addressQuestion = checked.nextQuestion;
              // 🧾 مصدره رسالة العميل الحالية (التأريض أثبت إنه من كلامه).
              recordSource(memory, "area", checked.formatted, srcId);
            }
          } else {
            console.warn(`🛑 عنوان الذكاء الاصطناعي مرفوض (${g.reason}): "${ai.area}"`);
          }
        }
        // 🔴 حتى رقم الذكاء لازم يكون موجود حرفياً بكلام العميل — مش
        //    مكمّل ولا مفترَض. منتحقق إنه أرقامه ظاهرة بنص العميل.
        if (ai.phone) {
          const digitsInConv = convText.replace(/[\s\-\.]/g, "").includes(ai.phone);
          if (digitsInConv) {
            memory.phone = ai.phone; memory.invalidPhoneProvided = false;
            recordSource(memory, "phone", ai.phone, srcId);
          } else {
            console.warn(`🛑 رقم الذكاء مرفوض (مش موجود بكلام العميل): "${ai.phone}"`);
          }
        }
      }
      // لو فشل الذكاء (ai.ok=false) نُبقي نتائج الرادار كما هي
    } catch (e) {
      console.error("live AI extract failed:", e && e.message);
    }
  }

  // 🏠 الرقم المحفوظ فقط: زبون قديم ناقص رقم → نعبّيه من آخر طلب/الـCRM.
  //
  // 🔴 العنوان: ممنوع منعاً باتاً نحطّه لحالنا. لا من طلب سابق، ولا من
  //    الـCRM، ولا من أي توقّع. العنوان بينعتمد بس لما الزبون يبعثه
  //    بهالمحادثة. الزبون ممكن يكون نقل بيت أو الطلب لمكان ثاني —
  //    فأي عنوان قديم منطبعه بالفاتورة = طلب بيروح غلط. إذا ناقص عنوان
  //    منسأل الزبون، مش منفترض.
  try {
    const cartHasItems = memory.cart && Object.keys(memory.cart).length > 0;
    if (cartHasItems && !memory.phone) {
      const last = lastCompletedOrder(senderId);
      memory.phone = (last && last.phone) || (crmData && crmData.phone) || memory.phone;
    }
  } catch (e) { console.error("saved phone:", e && e.message); }

  // 🏢 كشف تاجر الجملة: كمية كبيرة أو كلمات جملة → تنبيه + ملاحظة (مرة لكل جلسة)
  try {
    const totalQty = memory.cart ? Object.values(memory.cart).reduce((a, b) => a + (Number(b) || 0), 0) : 0;
    if (!memory.wholesaleFlagged && (WHOLESALE_INTENT.test(userMsg) || totalQty >= 6)) {
      memory.wholesaleFlagged = true;
      const note = getSetting("wholesale_note") ||
        "🏢 إذا حابب كميات كبيرة أو بالجملة، عنا أسعار خاصة للتجار! خبّرني وبنرتّبلك عرض مميز.";
      memory._wholesaleNote = note;
      ctx.waitUntil(notifyTelegram(`🏢 زبون جملة محتمل — (${pageConfig.name})\n💬 «${userMsg.slice(0, 150)}»\n🔗 ${inboxUrl(recipientId, senderId)}`));
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

  // ═══════════════════════════════════════════════════════════
  // 📍 بوابة العنوان — ولا فاتورة بتطلع بعنوان ناقص
  //
  // العنوان ممكن يجي من 3 مصادر: الرادار، الذكاء الاصطناعي، أو طلب سابق.
  // كلهم بيمرّوا من نفس المحرّك هون، عشان يكون في مقياس واحد للجاهزية
  // بدل ما مصدر يمرّر ناقص ومصدر يرفض كامل.
  // ═══════════════════════════════════════════════════════════
  if (memory.area && !memory.addr) {
    // عنوان جا من الذكاء الاصطناعي أو من طلب سابق — منقيسه بنفس المسطرة
    try {
      const original = String(memory.area).trim();
      const checked = parseAddress(original);
      memory.addr = checked;
      // parseAddress بترجّع التنسيق + أي جزء مفيد ضاع منه، بلا تكرار.
      // (المنطق القديم هون كان بيضيف الأصل بين قوسين فيطبع العنوان
      //  مرتين بالفاتورة: "عمان، البيادر (عمان - البيادر)")
      memory.area = checked.formatted;
      memory.addressScore = checked.score;
      memory.addressLevel = checked.level;
      memory.addressReady = checked.deliverable;
      memory.addressQuestion = checked.nextQuestion;
    } catch (e) { console.error("address gate:", e && e.message); }
  }

  const cartItemsCount = memory.cart ? Object.keys(memory.cart).length : 0;

  // ═══════════════════════════════════════════════════════════
  // 🔴 قاعدة فوق كل شي: البوت ما بيسكت أبداً.
  //
  // نسخة سابقة كانت بتوقف الفاتورة لما العنوان ناقص، وإذا الزبون
  // ما حسّن العنوان بتضل واقفة للأبد — فالزبون بيعطي رقمه وبيستنى
  // ولا إشي بيجي. هاد أسوأ من عنوان ناقص بكثير: طلب جاهز بيضيع كامل.
  //
  // القاعدة الصح: نسأل **مرة وحدة** عن اللي ناقص. إذا الزبون ما زوّدنا،
  // بنكمّل الطلب عادي ومنعلّمه للمراجعة البشرية + تنبيه تيليجرام.
  // موظف بيتصل ويسأل أرخص بكثير من زبون ضاع وهو جاهز يدفع.
  // ═══════════════════════════════════════════════════════════
  // العنوان "خشن" = عرفنا المنطقة بس بلا تفاصيل (مثل "البيادر").
  // هاد **بيوصل** — السائق معه رقم الزبون. فما بنوقف الطلب عشانه،
  // بس بنضيف سطر لطيف بالفاتورة بيطلب معلم، وبننبّه للمراجعة.
  const addrCoarse = !!(memory.addr && memory.addr.coarse);
  // ما عرفنا وين أصلاً (محافظة لحالها أو وصف بلا مكان) = مش جاهز
  const addrUnknown = !!memory.area && memory.addressReady === false;

  // 🔴 الاكتمال يمرّ من التحقق النهائي: كل حقل مطلوب لازم يكون موجود
  //    **ومصدره رسالة من نفس جلسة العميل** (source_mid). أي حقل بلا
  //    مصدر (احتمال مفترَض) بيخلّي الطلب "ناقص" ومنسأل عنه — ما منطبع
  //    فاتورة ببيانات ما قدرنا نثبت مصدرها.
  const check = validateOrder(memory, { pageId: recipientId, senderId });
  if (check.reasons.length)
    console.log(`🧾 تحقق الطلب [${sessionKey}]: ${check.complete ? "مكتمل" : "ناقص → " + check.missing.join(",")} | ${check.reasons.join(" · ")}`);
  const complete = check.complete && !check.blocked;
  const readyForInvoice = complete && !memory.sent;
  const needsAddressReview = complete && addrCoarse;

  // معه صنف ورقم، بس ما بنعرف وين ⇒ سؤال واحد محدّد، مرة وحدة بس.
  // بعدها بيكمّل مع الذكاء الاصطناعي عادي — ما بنسكت ولا بنعلّق الطلب.
  if (cartItemsCount > 0 && memory.phone && addrUnknown
      && memory.addressQuestion && !memory._addrAsked && !memory.sent) {
    const ask = `تمام 👌 ضلّ إشي واحد بس عشان يوصلك الطلب صح:\n${memory.addressQuestion}`;
    // 🔴 ترتيب المعاملات: sendText(pageToken, senderId, text) — لا تعكسه.
    // عكسه سابقاً كان يمرّر كائن مكان النص فترمي .trim() خطأً وينهار
    // المعالج كاملاً ⇒ الزبون ما بيوصله ولا رد والطلب بيعلق.
    await sendText(token, senderId, ask);
    // ما بنعلّم "سألنا" إلا بعد نجاح الإرسال فعلاً — وإلا لو فشل الإرسال
    // بنكون حرقنا السؤال الوحيد بلا ما يسمعه الزبون.
    memory._addrAsked = true;
    memory.lastReply = memory.addressQuestion;
    logMessage({ page_id: recipientId, page_name: pageConfig.name, sender_id: senderId,
                 direction: "out", body: ask, created_at: Date.now() });
    await env.SESSIONS_KV.put(sessionKey, JSON.stringify(memory), { expirationTtl: CONFIG.SESSION_TTL });
    return;
  }

  const messengerUrl = inboxUrl(recipientId, senderId);

  // 🎯 التقاط العميل المحتمل: حدّد صنف بس لسا ما أعطى رقم ولا عنوان.
  // بدون هاد بيختفي كلياً من النظام. لا يرسل أي شيء — تسجيل فقط.
  if (cartItemsCount > 0 && !memory.area && !memory.phone) {
    try {
      const names = Object.keys(memory.cart).join("، ");
      let est = 0;
      try { est = Number(computeOrder(effConfig, memory.cart, memory.coupon).total) || 0; } catch {}
      const now = Date.now();
      retryDb(() => db.prepare(
        `INSERT INTO leads_prospects (page_id, page_name, sender_id, interest, est_value, first_at, last_at, status)
         VALUES (?,?,?,?,?,?,?, 'open')
         ON CONFLICT(page_id, sender_id) DO UPDATE SET
           interest = excluded.interest, est_value = excluded.est_value, last_at = excluded.last_at`
      ).run(recipientId, pageConfig.name || "", senderId, names, est, now, now));
    } catch (e) { console.error("prospect capture:", e && e.message); }
  }

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
          session_key: sessionKey,
          order_string: orderString, total,
          area: memory.area || "", phone: memory.phone || "", status,
          address_score: memory.addressScore ?? -1, address_level: memory.addressLevel || "",
          messenger_url: messengerUrl, created_at: Date.now()
        });
      }
      // صار طلب فعلي — يخرج من قائمة العملاء المحتملين
      try {
        retryDb(() => db.prepare(
          "UPDATE leads_prospects SET status = 'converted' WHERE page_id = ? AND sender_id = ? AND status = 'open'"
        ).run(recipientId, senderId));
      } catch {}
      // 📲 ربط إعادة الشراء: لو هالزبون كان مستهدَف بحملة واتساب حديثة
      try { if (memory.phone) attributeReorder({ page_id: recipientId, phone: memory.phone, order_id: memory.orderId, total }); } catch {}
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
    // العنوان خشن: منطلب المعلم **مع** الفاتورة مش بدالها.
    // الطلب بيمشي، والزبون بيقدر يزوّدنا بلا ما يستنى ولا يضيع.
    if (needsAddressReview)
      reply += "\n\n📍 لو بتقدر تبعتلي أقرب معلم بيسهّل على السائق يوصلك أسرع.";
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
      `🔔 طلب جديد من (${pageConfig.name})!\n\n🧀 الطلب: ${orderString}\n💰 الحساب: ${total}د\n` +
      `📍 العنوان: ${memory.area}` +
      // 🔴 تنبيه صريح: الطلب مشى بس عنوانه ناقص — لازم مكالمة تأكيد
      (needsAddressReview
        ? `\n⚠️ العنوان ناقص (${memory.addressLevel || "—"} ${memory.addressScore ?? "—"}%) — اتصل وأكّده قبل التوصيل`
        : "") +
      `\n📞 التلفون: ${memory.phone}\n🔗 رابط الماسنجر: ${messengerUrl}`
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
      extraKnowledge += "\n\n[هام جداً] الزبونة أنثى — خاطبها دائماً بصيغة المؤنث (حياكي الله، تفضلي، يا هلا فيكي، شو حابة، بدك تطلبي) ولا تستخدم أبداً صيغ المذكر (يا أخوي، يا غالي، يا شيخ، يا زعيم، حابب). وإذا كان لهذه الصفحة أسلوب نداء خاص بها فالتزم به هو.";
    }
    reply = await askAI(memory.history, userMsg, audioPart, pageConfig, memory, crmData, extraKnowledge);
    memory.invalidPhoneProvided = false;   // بعد ما ننبّه الزبون منصفّر الفلاغ

    // 🔴 الذكاء رجع فاضي (فشل نداء أو مزوّد واقف) = **سكوت تام**.
    //    زمان كنا نبعت "أبشر كمّل طلبك" — وهاي أسوأ من السكوت:
    //    بتوهم الزبون إنّ في حدا فاهمه فبيكمّل كلام ما حدا بيقراه،
    //    وبيروح الطلب وهو مبسوط. بلا رد، بيعيد أو بيتصل، والمحادثة
    //    بتضل بالوارد عندك تشوفها.
    if (reply == null || !String(reply).trim()) {
      console.warn(`🔇 الذكاء ما رجّع رد — سكتنا بدل ما نبعت تعبئة (${senderId})`);
      try {
        flagHandoff({
          page_id: recipientId, page_name: pageConfig.name, sender_id: senderId,
          reason: "الذكاء ما رد — الزبون مستني", snippet: userMsg, pause: 0
        });
      } catch (e) { console.error("flagHandoff:", e && e.message); }
      return;
    }
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

  // 🔴 رسالة واحدة فقط لكل رد: أي [[SPLIT]] يُدمج في رسالة وحدة (سؤال = جواب واحد)
  const chunks = String(reply || "").split("[[SPLIT]]").map(s => s.trim()).filter(Boolean);
  let single = chunks.join("\n\n");

  // 🛒 بيع إضافي: يُدمج بنفس رسالة الفاتورة (مش رسالة ثانية) — للجبنة فقط
  if (justSentInvoice && !pageConfig.SYSTEM) {
    try {
      const addons = getActiveAddons();
      if (addons.length) {
        const lines = addons.map(a =>
          `• ${a.name} — ${a.price}د${a.weight ? ` (${a.weight})` : ""}`).join("\n");
        single += `\n\n🌟 وعنا كمان لو حاب تضيف:\n${lines}\nبس قلّي وبزيده على طلبك 🌹`;
      }
    } catch (e) { console.error("cross-sell:", e && e.message); }
  }

  if (single) await sendText(token, senderId, single);

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
