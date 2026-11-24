// ═══════════════════════════════════════════════════════════
// معالجة حدث واحد (منطق البوت الأصلي + حفظ الأوردر في قاعدة البيانات)
// ═══════════════════════════════════════════════════════════
import { CONFIG } from "../config.js";
import { PAGES, extractPhone } from "./brain.js";
import { sendText, sendTyping, graphSend, sendAttachment, notifyTelegram, fetchAudioAsBase64, openReplyWindow, closeReplyWindow } from "./messenger.js";
import { parseMessage, RESET_INTENT } from "./parser.js";
import { computeOrder } from "./order.js";
import { parseAddress, groundAddress } from "./address.js";
import { withSessionLock } from "./lock.js";
import { attributeReorder } from "../features/whatsapp.js";
import { validateOrder, recordSource, sessionFingerprint } from "./validate.js";
import { inboxUrl } from "../brain/links.js";
import { askAI, extractOrderWithAI } from "./ai.js";
import { saveOrder, updateOrder, updateOrderStatus, getKnowledge, logMessage, customerCompletedCount, customerCompletedCountBySender, addReview, getActiveAddons, getRecentOpenOrderId, getLatestEditableOrderId, getActiveCouponsList, incrementCouponUse, flagHandoff, isBotPaused, customerHistoryHint, isBlocked, priceOverrideMap, getSetting, lastCompletedOrder, setCancelReason, db, retryDb } from "../db/database.js";

// إلغاء صريح للطلب (منفصل عن "تعديل/تغيير الرأي")
const CANCEL_INTENT = /(الغي الطلب|ألغي الطلب|الغاء الطلب|إلغاء الطلب|بطّل الطلب|بطل الطلب|ما بدي الطلب|ما عاد بدي|ما بديش|كنسل|cancel|لا تبعت|لا ترسل|ما بدي اكمل|ما بدي أكمل)/i;

// إعادة الطلب السابق بضغطة
const REPEAT_INTENT = /(نفس الطلب|الطلب السابق|زي المرة|زي كل مرة|عيد طلبي|أعد طلبي|اعد طلبي|نفس اللي طلبت|نفس السابق|كرر الطلب|كرر طلبي|نفس الطلبية|الطلب الي فات|اللي فات|نفس طلبي)/i;

// تعديل الطلب الحالي بعد صدور الفاتورة: نحدّث نفس الصف والفاتورة.
const EDIT_ORDER_INTENT = /(عدّل|عدل|تعديل|غيّر|غير|بدّل|بدل|زيد|زِد|زود|زوّد|أضف|اضف|احذف|شيل|شيللي|بدي.*كمان|بدّي.*كمان|كمان|زيادة|بدون|ناقص)/i;
// طلب جديد صريح بعد فاتورة سابقة: ننشئ طلبًا وفاتورةً جديدين.
const NEW_ORDER_INTENT = /(طلب جديد|طلب ثاني|طلب تاني|طلب اخر|طلب آخر|فاتورة جديدة)/i;

// كشف تاجر الجملة
const WHOLESALE_INTENT = /(جملة|بالجملة|تاجر|كرتون|كرتونة|كراتين|محل|بقالة|بقالية|سوبر ?ماركت|سوبرماركت|كمية كبيرة|كميات كبيرة|بسعر الجملة|عرض جملة)/i;

// 🛡️ معرّفات صفحات أجبان الرياض وقواعد الأوزان الصارمة (مضاعفات الـ 2 كيلو فقط)
const RIYADH_PAGE_IDS = new Set(["1229773096895942", "1488299554357978"]);

function isRiyadhPageId(pageId) {
  return RIYADH_PAGE_IDS.has(String(pageId || "").trim());
}

function isEvenMultipleOfTwo(qty) {
  const n = Number(qty);
  return Number.isFinite(n) && Number.isInteger(n) && n >= 2 && n % 2 === 0;
}

function normalizeForQty(text = "") {
  const ar = "٠١٢٣٤٥٦٧٨٩";
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  return String(text)
    .replace(/[٠-٩]/g, d => String(ar.indexOf(d)))
    .replace(/[۰-۹]/g, d => String(fa.indexOf(d)))
    .replace(/[إأآٱ]/g, "ا")
    .replace(/[ة]/g, "ه")
    .replace(/[ى]/g, "ي")
    .replace(/ـ/g, "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// كشف هل الرسالة سؤال معلوماتي/تحية بحتة بدون نية شراء صريحة
function isPureInfoOrGreeting(text = "") {
  const t = normalizeForQty(text);
  if (!t) return true;
  const isInquiryPhrase = /(?:بدي|اريد|حاب|حابب)\s+(?:اسال|اعرف|استفسر|اتاكد|معلومات|معلومه|تفاصيل)/.test(t);
  const hasBuyVerb = !isInquiryPhrase && /(?:^|\s)(?:بدي|اعطيني|ابعت|ابعتلي|وصلي|وصليلي|اطلب|احجز|احجزلي|هات|باخذ|سجل|اعتمد|بدنا)(?:\s|$)/.test(t);
  if (hasBuyVerb) return false;
  // إذا فيها رقم هاتف أردني، قد يكون الزبون يكمل طلبه
  if (/(?:\+?962|00962|0)?7\d{8}/.test(t)) return false;
  // إذا كانت مجرد رقم أو كمية صريحة مثل "4 كيلو" أو "كيلوين" ليست سؤالاً معلوماتياً
  if (/^\d{1,2}(?:\s*كيلو)?$/.test(t) || /^(?:كيلوين|نص\s*كيلو|كيلو\s*واحد|اربع\s*كيلو|اربعه\s*كيلو|ثلاث\s*كيلو|ثلاثه\s*كيلو)$/.test(t)) {
    return false;
  }
  return true;
}

// استخراج كمية الكيلوات الصريحة فقط من الرسالة الحالية (بدون التقاط الهواتف، الأسعار، النسب، الأوقات، حبة البركة، أو "بكم الكيلو")
function detectExplicitKiloRequest(text = "") {
  let t = normalizeForQty(text);
  if (!t) return null;

  // استبعاد الهواتف، الأسعار، العناوين، النسب المئوية، الأوقات، وعبارة حبة البركة
  t = t.replace(/(?:\+?962|00962|0)?7\d{8}/g, " ");
  t = t.replace(/\b\d+(?:\.\d+)?\s*(?:دينار|دنانير|د\.ا|jd|د)(?=\s|$|[؟?!،,.])/gi, " ");
  t = t.replace(/(?:بنايه|عماره|شقه|طابق|شارع|منزل|بيت|دوار)\s*\d+/g, " ");
  t = t.replace(/حبه\s*البركه|حبه\s*سوداء|الحبه\s*السوداء/g, " ");
  t = t.replace(/\b\d+(?:\.\d+)?\s*(?:%|بالميه|بالمئه|بالمائه)/g, " ");
  t = t.replace(/\b\d+(?:\.\d+)?\s*(?:دقيقه|دقائق|دقايق|ساعه|ساعات|يوم|ايام|اسبوع|اسابيع|شهر|شهور|اشهر|سنه|سنوات|سنين|لتر|ليتر)(?=\s|$|[؟?!،,.])/g, " ");
  t = t.replace(/ثلاثه?\s*اثلاث|ثلث/g, " ");
  t = t.replace(/[؟?!،,.:;()]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;

  // نصف كيلو / كيلو ونص
  if (/(?:^|\s)(?:نص|نصف)\s*كيلو(?:\s|$)/.test(t)) return 0.5;
  if (/(?:^|\s)كيلو\s*و\s*(?:نص|نصف)(?:\s|$)/.test(t)) return 1.5;

  // رقم مباشر متبوع بكلمة كيلو (مثل: "1 كيلو", "3 كيلو", "4 كيلو")
  const numKilo = t.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:كيلو|كيلوات|كغم|كغ)(?=\s|$)/);
  if (numKilo) {
    const v = Number(numKilo[1]);
    if (Number.isFinite(v) && v > 0) return v;
  }

  // كلمات عددية متبوعة بكلمة كيلو
  const wordKiloMap = [
    [/(?:^|\s)(?:كيلو\s*واحد|واحد\s*كيلو|كيلو\s*بس|بس\s*كيلو)(?=\s|$)/, 1],
    [/(?:^|\s)(?:كيلوين|اثنين\s*كيلو|اتنين\s*كيلو)(?=\s|$)/, 2],
    [/(?:^|\s)(?:ثلاث|ثلاثه)\s*(?:كيلو|كيلوات|كغم|كغ)(?=\s|$)/, 3],
    [/(?:^|\s)(?:اربع|اربعه)\s*(?:كيلو|كيلوات|كغم|كغ)(?=\s|$)/, 4],
    [/(?:^|\s)(?:خمس|خمسه)\s*(?:كيلو|كيلوات|كغم|كغ)(?=\s|$)/, 5],
    [/(?:^|\s)(?:ست|سته)\s*(?:كيلو|كيلوات|كغم|كغ)(?=\s|$)/, 6],
    [/(?:^|\s)(?:سبع|سبعه)\s*(?:كيلو|كيلوات|كغم|كغ)(?=\s|$)/, 7],
    [/(?:^|\s)(?:ثمان|ثمانيه)\s*(?:كيلو|كيلوات|كغم|كغ)(?=\s|$)/, 8],
    [/(?:^|\s)(?:تسع|تسعه)\s*(?:كيلو|كيلوات|كغم|كغ)(?=\s|$)/, 9],
    [/(?:^|\s)(?:عشر|عشره)\s*(?:كيلو|كيلوات|كغم|كغ)(?=\s|$)/, 10]
  ];
  for (const [rx, val] of wordKiloMap) {
    if (rx.test(t)) return val;
  }

  // فعل شراء متبوع بكلمة "كيلو" مفردة (مثل: "بدي كيلو" أو "ابعتلي كيلو" — وليس "بكم الكيلو")
  const isInquiryPhrase = /(?:بدي|اريد|حاب|حابب)\s+(?:اسال|اعرف|استفسر|اتاكد)/.test(t);
  const hasBuyVerb = !isInquiryPhrase && /(?:^|\s)(?:بدي|اعطيني|ابعت|ابعتلي|وصلي|وصليلي|اطلب|احجز|احجزلي|هات|باخذ|سجل|اعتمد|بدنا)(?:\s|$)/.test(t);
  if (hasBuyVerb && /(?:^|\s)(?:بدي|اعطيني|ابعت|ابعتلي|وصلي|وصليلي|اطلب|احجز|احجزلي|هات|باخذ|سجل|اعتمد|بدنا)\s+(?:بس\s+)?كيلو(?:\s|$)/.test(t)) {
    return 1;
  }

  // رسالة مختصرة عبارة عن رقم فقط (رداً على سؤال "كم كيلو؟")
  const bareNum = t.match(/^(\d{1,2})$/);
  if (bareNum) {
    const v = Number(bareNum[1]);
    if (v >= 1 && v <= 50) return v;
  }

  return null;
}

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
  const mid = event.message.mid;
  if (mid) {
    const seen = await env.SESSIONS_KV.get("MID_" + mid);
    if (seen) return;
    await env.SESSIONS_KV.put("MID_" + mid, "1", { expirationTtl: 600 });
  }
  ctx.waitUntil(sendTyping(token, senderId));

  const sessionKey = `${recipientId}_${senderId}`;
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
  if (memory.sessionKey && memory.sessionKey !== sessionKey) {
    console.error(`🔴 عدم تطابق بصمة الجلسة: ${memory.sessionKey} ≠ ${sessionKey} — ذاكرة نظيفة`);
    memory = { cart: {}, area: null, phone: null, sent: false, history: [],
               lastReply: "", invalidPhoneProvided: false, upsellOffered: false,
               prov: {}, sessionKey };
  }
  if (!memory.sessionKey) memory.sessionKey = sessionKey;
  if (!memory.prov) memory.prov = {};

  // 🧹 إصلاح ذاتي فوري لأي سلة عالقة من جلسات سابقة بكمية مرفوضة (مثل 1 كيلو أو 3 كيلو في أجبان الرياض)
  const isRiyadh = isRiyadhPageId(recipientId);
  const pageMinQty = Number(effConfig.MINIMUM_QUANTITY || 0);
  if (memory.cart && Object.keys(memory.cart).length) {
    const staleQty = Object.values(memory.cart).reduce((a, b) => a + (Number(b) || 0), 0);
    const staleInvalid = isRiyadh
      ? (staleQty > 0 && !isEvenMultipleOfTwo(staleQty))
      : (pageMinQty > 1 && staleQty > 0 && staleQty < pageMinQty);
    if (staleInvalid) {
      memory.cart = {};
      if (memory.prov) delete memory.prov.order;
    }
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

  // 🤝 التسليم الكامل لذكاء ميتا
  try {
    const { handedOverToMeta } = await import("./capture.js");
    if (handedOverToMeta()) return;
  } catch (e) { console.error("handover check:", e && e.message); }

  // 🙋 لو البوت معلّق لهذا الزبون (تدخّل بشري نشط)
  try {
    if (isBotPaused(recipientId, senderId)) {
      memory.history = memory.history || [];
      memory.history.push({ role: "user", content: userMsg });
      memory.history = memory.history.slice(-CONFIG.MAX_HISTORY);
      // 📞 حتى والبوت معلّق: لو ظهر رقم بكلام الزبون نثبّته بالذاكرة فقط
      //    (بلا ما نصنع طلب بقيمة 0) — والرقم محفوظ أصلاً بصفحة الأرقام.
      try {
        const ph = extractPhone(userMsg);
        if (ph && /^07\d{8}$/.test(ph)) {
          memory.phone = ph;
          if (memory.orderId) updateOrder(memory.orderId, { phone: ph });
        }
      } catch (e) { console.error("paused phone capture:", e && e.message); }
      await env.SESSIONS_KV.put(sessionKey, JSON.stringify(memory), { expirationTtl: CONFIG.SESSION_TTL });
      return;
    }
  } catch (e) { console.error("pause check:", e && e.message); }

  // ⭐ التقاط التقييمات من كلام الزبون
  try {
    const review = detectReview(userMsg);
    const isCustomer = memory.sent || customerCompletedCountBySender(senderId) > 0 ||
      (memory.phone && customerCompletedCount(memory.phone) > 0);
    const buildingOrder = cartAddedThisTurn(userMsg, pageConfig);
    if (review && isCustomer && !memory.reviewed && !buildingOrder) {
      addReview({
        page_id: recipientId, page_name: pageConfig.name, sender_id: senderId,
        phone: memory.phone || "", rating: review.rating, comment: review.comment
      });
      memory.reviewed = true;
    }
  } catch (e) { console.error("review capture:", e && e.message); }

  // 👩 كشف جنس الزبون (مرة تُثبَّت)
  try { if (!memory.gender) { const g = detectGender(userMsg); if (g) memory.gender = g; } } catch {}

  // 🎬 فيديوهات المنتجات
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

  // 📝 التقاط سبب الإلغاء
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

  // 🚫 إلغاء صريح للطلب
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
    if (cancelledId) memory.awaitingCancelReason = cancelledId;
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

  // 🔴 تغيير الرأي صريحاً = طلب جديد مستقل.
  if (RESET_INTENT.test(userMsg)) {
    memory.cart = {};
    memory.sent = false;
    memory.orderId = null;
    memory._repeated = false;
    memory._newOrder = true;
  }

  // 🔁 إعادة الطلب = دائماً فاتورة/طلب جديد
  if (REPEAT_INTENT.test(userMsg)) {
    try {
      const last = lastCompletedOrder(senderId, recipientId);
      if (last && last.order_string) {
        memory.cart = parseOrderStringToCart(last.order_string);
        if (!memory.phone) memory.phone = last.phone || "";
        memory.orderId = null;
        memory.sent = false;
        memory._repeated = true;
        memory._newOrder = true;
        memory.area = null;
        memory.addr = null;
        memory.addressReady = false;
        memory.addressQuestion = null;
      }
    } catch (e) { console.error("repeat order:", e && e.message); }
  }

  // 🛒 تعديل بعد الفاتورة
  if (memory.sent && (EDIT_ORDER_INTENT.test(userMsg) || activeAddons.some(a => addonMentioned(userMsg, a.name)))) {
    memory.sent = false;
    if (!memory.orderId) {
      try { memory.orderId = getLatestEditableOrderId(recipientId, senderId); } catch {}
    }
    memory._editingExisting = !!memory.orderId;
  }

  // 🆕 طلب جديد صريح بعد فاتورة سابقة.
  if (memory.sent && NEW_ORDER_INTENT.test(userMsg)) {
    memory.sent = false;
    memory.orderId = null;
    memory.cart = {};
    memory._newOrder = true;
    memory._editingExisting = false;
  }

  // 🙋 كشف حاجة الزبون لتدخّل بشري
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
      return;
    }
  } catch (e) { console.error("handoff detect:", e && e.message); }

  // ═══════════════════════════════════════════════════════════
  // 🛡️ حماية ضد تلويث السلة في الأسئلة المعلوماتية (أجبان الرياض وصفحات الحد الأدنى)
  // ═══════════════════════════════════════════════════════════
  const prevValidCart = { ...(memory.cart || {}) };
  const prevValidOrderProv = memory.prov?.order ? { ...memory.prov.order } : null;
  const explicitKiloThisTurn = (isRiyadh || pageConfig.QTY_MODE === "kilo") && userMsg !== "[رسالة صوتية]"
    ? detectExplicitKiloRequest(userMsg)
    : null;
  const skipOrderExtractionForInfo = (isRiyadh || pageMinQty > 1)
    && Object.keys(prevValidCart).length === 0
    && explicitKiloThisTurn == null
    && isPureInfoOrGreeting(userMsg);

  let explicitInvalidQtyThisTurn = null;
  let explicitInvalidReason = null;

  if (explicitKiloThisTurn != null && isRiyadh) {
    if (explicitKiloThisTurn < 2) {
      explicitInvalidQtyThisTurn = explicitKiloThisTurn;
      explicitInvalidReason = "below_min";
    } else if (!isEvenMultipleOfTwo(explicitKiloThisTurn)) {
      explicitInvalidQtyThisTurn = explicitKiloThisTurn;
      explicitInvalidReason = "odd_kilo";
    }
  } else if (explicitKiloThisTurn != null && pageMinQty > 1 && explicitKiloThisTurn < pageMinQty) {
    explicitInvalidQtyThisTurn = explicitKiloThisTurn;
    explicitInvalidReason = "below_min";
  }

  if (!memory.sent && !skipOrderExtractionForInfo && explicitInvalidQtyThisTurn == null && userMsg !== "[رسالة صوتية]") {
    parseMessage(memory, userMsg, effConfig, srcId);
  }

  // في أجبان الرياض: لو الزبون كتب وزن زوجي صريح بالكلمات (مثل "اربع كيلو") نثبته بدقة
  if (isRiyadh && explicitKiloThisTurn != null && isEvenMultipleOfTwo(explicitKiloThisTurn) && !memory.sent) {
    const riyadhProduct = Object.keys(effConfig.PRICES || {})[0] || "جبنة الرياض";
    memory.cart = { [riyadhProduct]: explicitKiloThisTurn };
    recordSource(memory, "order", { ...memory.cart }, srcId);
  }

  // احتفظ بنتيجة محلّل الكمية الحتمي قبل أن يحاول الذكاء إعادة بناء السلة.
  const parsedCartBeforeAI = { ...(memory.cart || {}) };

  // 🧠 استخراج ذكي من كامل المحادثة (نتخطّاه في الأسئلة المعلوماتية الصرفة أو عند رفض كمية صريحة)
  if (!memory.sent && !memory._repeated && !skipOrderExtractionForInfo && explicitInvalidQtyThisTurn == null) {
    try {
      const convText = [
        ...(memory.history || []).filter(h => h.role === "user").map(h => h.content),
        userMsg
      ].filter(Boolean).join("\n");
      const ai = await extractOrderWithAI(convText, effConfig);
      if (ai.ok) {
        if (ai.is_order && ai.items.length) {
          memory.cart = {};
          ai.items.forEach(it => {
            const deterministicQty = Number(parsedCartBeforeAI?.[it.product] || 0);
            memory.cart[it.product] = pageConfig.QTY_MODE === "kilo" && deterministicQty > 0
              ? deterministicQty : it.qty;
          });
          recordSource(memory, "order", { ...memory.cart }, srcId);
        }
        if (ai.area) {
          const g = groundAddress(ai.area, convText);
          if (g.ok) {
            const checked = parseAddress(g.grounded);
            if (!memory.addr || checked.score >= (memory.addressScore || 0)) {
              memory.addr = checked;
              memory.area = checked.formatted;
              memory.addressScore = checked.score;
              memory.addressLevel = checked.level;
              memory.addressReady = checked.deliverable;
              memory.addressQuestion = checked.nextQuestion;
              recordSource(memory, "area", checked.formatted, srcId);
            }
          } else {
            console.warn(`🛑 عنوان الذكاء الاصطناعي مرفوض (${g.reason}): "${ai.area}"`);
          }
        }
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
    } catch (e) {
      console.error("live AI extract failed:", e && e.message);
    }
  }

  // 🧹 حارس السلة بعد الاستخراج: لو دخلت كمية افتراضية غير مسموحة (مثل 1 كيلو أو 3 كيلو) بدون طلب صريح، نمسحها فوراً حتى لا تعلق وتمنع الذكاء الاصطناعي من الرد!
  if (memory.cart && Object.keys(memory.cart).length) {
    const currentCartQty = Object.values(memory.cart).reduce((a, b) => a + (Number(b) || 0), 0);
    const cartInvalidNow = isRiyadh
      ? (currentCartQty > 0 && !isEvenMultipleOfTwo(currentCartQty))
      : (pageMinQty > 1 && currentCartQty > 0 && currentCartQty < pageMinQty);

    if (cartInvalidNow) {
      memory.cart = prevValidCart;
      if (prevValidOrderProv) memory.prov.order = prevValidOrderProv;
      else if (memory.prov) delete memory.prov.order;
    }
  }

  // 🏠 الرقم المحفوظ فقط (ممنوع تعبئة العنوان تلقائياً)
  try {
    const cartHasItems = memory.cart && Object.keys(memory.cart).length > 0;
    if (cartHasItems && !memory.phone) {
      const last = lastCompletedOrder(senderId, recipientId);
      memory.phone = (last && last.phone) || (crmData && crmData.phone) || memory.phone;
    }
  } catch (e) { console.error("saved phone:", e && e.message); }

  // 📞 التقاط الرقم مباشرة من كلام الزبون — مستقل عن الذكاء الاصطناعي.
  //    أي رقم أردني (07xxxxxxxx) بيظهر برسالة الزبون بنلتقطه فوراً حتى
  //    لو الذكاء سكت أو فشل، وحتى لو ما في صنف بالسلة. هيك ما بيضيع
  //    ولا رقم ولا طلب — بنمسكه ونحطه "بحاجة متابعة" للتاجر لو ناقص.
  try {
    const foundPhone = extractPhone(userMsg);
    if (foundPhone && foundPhone !== memory.phone) {
      memory.phone = foundPhone;
      memory.invalidPhoneProvided = false;
      try { recordSource(memory, "phone", foundPhone, srcId); } catch {}
    }
  } catch (e) { console.error("direct phone capture:", e && e.message); }

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

  // 🎟️ كشف كود الخصم من رسالة الزبون
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

  // 📍 بوابة العنوان
  if (memory.area && !memory.addr) {
    try {
      const original = String(memory.area).trim();
      const checked = parseAddress(original);
      memory.addr = checked;
      memory.area = checked.formatted;
      memory.addressScore = checked.score;
      memory.addressLevel = checked.level;
      memory.addressReady = checked.deliverable;
      memory.addressQuestion = checked.nextQuestion;
    } catch (e) { console.error("address gate:", e && e.message); }
  }

  const cartItemsCount = memory.cart ? Object.keys(memory.cart).length : 0;
  const addrCoarse = !!(memory.addr && memory.addr.coarse);
  const addrUnknown = !!memory.area && memory.addressReady === false;

  const check = validateOrder(memory, { pageId: recipientId, senderId });
  if (check.reasons.length)
    console.log(`🧾 تحقق الطلب [${sessionKey}]: ${check.complete ? "مكتمل" : "ناقص → " + check.missing.join(",")} | ${check.reasons.join(" · ")}`);
  const complete = check.complete && !check.blocked;
  const readyForInvoice = complete && !memory.sent && explicitInvalidQtyThisTurn == null;
  const needsAddressReview = complete && addrCoarse;

  // 🔴 الإصلاح الجذري: لا نستدعي computeOrder ولا نفعّل حظر الحد الأدنى على سلة فاضية أبداً!
  const orderCalculation = cartItemsCount > 0
    ? computeOrder(effConfig, memory.cart || {}, memory.coupon)
    : { subtotal: 0, delivery: 0, total: 0, orderString: "", detailedString: "", priceString: "", invoiceBlocked: false };
  const minimumOrderBlocked = explicitInvalidQtyThisTurn != null || (cartItemsCount > 0 && !!orderCalculation.invoiceBlocked);

  // سؤال واحد محدّد عن العنوان الناقص
  if (cartItemsCount > 0 && memory.phone && addrUnknown
      && memory.addressQuestion && !memory._addrAsked && !memory.sent && !minimumOrderBlocked) {
    const ask = `تمام 👌 ضلّ إشي واحد بس عشان يوصلك الطلب صح:\n${memory.addressQuestion}`;
    await sendText(token, senderId, ask);
    memory._addrAsked = true;
    memory.lastReply = memory.addressQuestion;
    logMessage({ page_id: recipientId, page_name: pageConfig.name, sender_id: senderId,
                 direction: "out", body: ask, created_at: Date.now() });
    await env.SESSIONS_KV.put(sessionKey, JSON.stringify(memory), { expirationTtl: CONFIG.SESSION_TTL });
    return;
  }

  const messengerUrl = inboxUrl(recipientId, senderId);

  // 🎯 التقاط العميل المحتمل
  if (cartItemsCount > 0 && !memory.area && !memory.phone && !minimumOrderBlocked) {
    try {
      const names = Object.keys(memory.cart).join("، ");
      let est = 0;
      try { est = Number(orderCalculation.total) || 0; } catch {}
      const now = Date.now();
      retryDb(() => db.prepare(
        `INSERT INTO leads_prospects (page_id, page_name, sender_id, interest, est_value, first_at, last_at, status)
         VALUES (?,?,?,?,?,?,?, 'open')
         ON CONFLICT(page_id, sender_id) DO UPDATE SET
           interest = excluded.interest, est_value = excluded.est_value, last_at = excluded.last_at`
      ).run(recipientId, pageConfig.name || "", senderId, names, est, now, now));
    } catch (e) { console.error("prospect capture:", e && e.message); }
  }

  // 🟢 وصول فوري للسستم — بنحفظ الطلبات الحقيقية فقط (صنف + رقم/منطقة).
  //    🔴 ما بنصنع طلبات بقيمة 0: الرقم بلا طلب، أو الكمية المرفوضة
  //    (أقل من الحد)، ما بينحفظوا كطلب — الرقم محفوظ بصفحة «أرقام من
  //    المحادثات» وبذاكرة الجلسة، فما بيضيع، وبلا ما يوسّخ جدول الطلبات.
  const hasIntent = cartItemsCount > 0 && (memory.area || memory.phone);
  if (hasIntent && !minimumOrderBlocked) {
    try {
      const { total, orderString } = orderCalculation;
      const status = complete ? "جديد" : "ناقص";
      if (!memory.orderId && !memory._newOrder) memory.orderId = getRecentOpenOrderId(recipientId, senderId);
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
      try {
        retryDb(() => db.prepare(
          "UPDATE leads_prospects SET status = 'converted' WHERE page_id = ? AND sender_id = ? AND status = 'open'"
        ).run(recipientId, senderId));
      } catch {}
      try { if (memory.phone) attributeReorder({ page_id: recipientId, phone: memory.phone, order_id: memory.orderId, total }); } catch {}
      memory._newOrder = false;
      memory._editingExisting = false;
    } catch (e) {
      console.error("🔴 live upsert FAILED:", e && e.message, e && e.stack);
    }
  }

  let reply = "";
  let justSentInvoice = false;

  // 🔴 إصدار الفاتورة للزبون عند اكتمال الطلب (مرة واحدة)
  if (readyForInvoice && !minimumOrderBlocked) {
    const { total, orderString, detailedString, priceString } = orderCalculation;
    const builtInvoice = pageConfig.INVOICE_TEMPLATE(detailedString || orderString, priceString, memory.area, memory.phone);
    if (builtInvoice) {
      reply = builtInvoice;
      if (needsAddressReview)
        reply += "\n\n📍 لو بتقدر تبعتلي أقرب معلم بيسهّل على السائق يوصلك أسرع.";
      memory.sent = true;
      justSentInvoice = true;

      if (memory.coupon) { try { incrementCouponUse(memory.coupon.code); } catch {} }

      try {
        const loyaltyCount = customerCompletedCount(memory.phone);
        if (loyaltyCount > 0 && loyaltyCount % 5 === 0) {
          reply += `\n\n🎁 مبروك! هذا طلبك رقم ${loyaltyCount} معنا — كزبون وفيّ إلك خصم خاص على طلبك الجاي 🌹`;
        }
      } catch (e) { console.error("loyalty check:", e && e.message); }

      ctx.waitUntil(notifyTelegram(
        `🔔 طلب جديد من (${pageConfig.name})!\n\n🧀 الطلب: ${orderString}\n💰 الحساب: ${total}د\n` +
        `📍 العنوان: ${memory.area}` +
        (needsAddressReview
          ? `\n⚠️ العنوان ناقص (${memory.addressLevel || "—"} ${memory.addressScore ?? "—"}%) — اتصل وأكّده قبل التوصيل`
          : "") +
        `\n📞 التلفون: ${memory.phone}\n🔗 رابط الماسنجر: ${messengerUrl}`
      ));

      ctx.waitUntil(env.SESSIONS_KV.put(crmKey, JSON.stringify({
        lastOrder: orderString, lastArea: memory.area, phone: memory.phone, page: pageConfig.name
      }), { expirationTtl: CONFIG.CRM_TTL }));
    } else {
      // حماية إضافية لو قالب الفاتورة رفضها
      reply = isRiyadh
        ? "أهلاً فيك 🌹 الأوزان المتوفرة في أجبان الرياض هي مضاعفات الـ 2 كيلو فقط (2 كيلو بـ 10 دنانير، أو 4 كيلو بـ 18 دينار شامل التوصيل)."
        : "أهلاً فيك 🌹 يرجى تأكيد الكمية الصحيحة لإتمام الفاتورة.";
    }

  } else if (minimumOrderBlocked) {
    if (explicitInvalidReason === "odd_kilo") {
      reply = "أهلاً فيك 🌹 الأوزان المتوفرة في أجبان الرياض هي مضاعفات الـ 2 كيلو فقط (2 كيلو بـ 10 دنانير، 4 كيلو بـ 18 دينار، 6 كيلو بـ 26 دينار شامل التوصيل). أي وزن بناسبك نعتمدلك؟";
    } else if (explicitInvalidReason === "below_min" || orderCalculation.error === "minimum_quantity") {
      const minQ = orderCalculation.minimumQuantity || effConfig.MINIMUM_QUANTITY || 2;
      const minTotal = orderCalculation.minimumInvoiceTotal || effConfig.MINIMUM_INVOICE_TOTAL || 10;
      reply = `أهلاً فيك 🌹 أقل كمية للطلب هي ${minQ} كيلو، وما بنقدر نثبت كمية أقل.\n\n${minQ} كيلو = ${minTotal} دنانير شامل التوصيل.`;
    } else {
      const minTotal = orderCalculation.minimumInvoiceTotal || effConfig.MINIMUM_INVOICE_TOTAL || 10;
      reply = `أهلاً فيك 🌹 أقل قيمة للفاتورة هي ${minTotal} دينار شامل التوصيل.`;
    }
    // تأكيد إضافي أن السلة لا تحتفظ بالكمية المرفوضة للرسالة القادمة
    if (explicitInvalidQtyThisTurn == null && cartItemsCount > 0) {
      memory.cart = {};
      if (memory.prov) delete memory.prov.order;
    }
  } else {
    let extraKnowledge = getKnowledge(recipientId);
    if (activeAddons.length) {
      extraKnowledge += "\n\n[أصناف إضافية متوفّرة للبيع فعلاً — لا تنكر وجودها أبداً. اعرضها وبِعها عادي، وإذا طلبها الزبون أضِفها لطلبه بسعرها]:\n" +
        activeAddons.map(a => `• ${a.name} — ${a.price}د${a.weight ? ` (${a.weight})` : ""}${a.description ? ` — ${a.description}` : ""}`).join("\n");
    }
    try { extraKnowledge += customerHistoryHint(senderId); } catch {}
    if (memory.gender === "f") {
      extraKnowledge += "\n\n[هام جداً] الزبونة أنثى — خاطبها دائماً بصيغة المؤنث (حياكي الله، تفضلي، يا هلا فيكي، شو حابة، بدك تطلبي) ولا تستخدم أبداً صيغ المذكر (يا أخوي، يا غالي، يا شيخ، يا زعيم، حابب). وإذا كان لهذه الصفحة أسلوب نداء خاص بها فالتزم به هو.";
    }
    reply = await askAI(memory.history, userMsg, audioPart, pageConfig, memory, crmData, extraKnowledge);

    // 🛡️ حارس منتجات التنظيف
    if (pageConfig.BUNDLE_OFFERS && /(?:ريفان|فاتي|كمبرلاند|تنظيف|غسيل|كلور|فلاش)/i.test(pageConfig.name || "")) {
      const q = String(userMsg || "");
      const denied = /(?:ما عندي معلومات|لا يوجد معلومات|غير متوفر|مش متوفر|غير موجود|ما بعرف|لا أعرف|ما عندي)/i.test(String(reply || ""));
      if (denied && /كلور/i.test(q)) {
        reply = "نعم، الكلور المركز متوفر 20 لتر بـ7 دنانير + 2 دينار توصيل 🌹";
      } else if (denied && /(?:فلاش|مزيل التكلس|مزيل الكلس)/i.test(q)) {
        reply = "نعم، فلاش مزيل التكلس متوفر 20 لتر بـ7 دنانير + 2 دينار توصيل 🌹";
      } else if (denied && /(?:العرض|البكج|الباكدج|الباقة)/i.test(q)) {
        reply = "أكيد، العرض: جل غسيل + كلور + فلاش، كل واحد 20 لتر بـ26 دينار شامل التوصيل 🌹";
      }
    }
    memory.invalidPhoneProvided = false;

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

  // 🕐 تنبيه خارج ساعات العمل
  try {
    if (!memory.offHoursNotified) {
      const oh = offHoursMessage();
      if (oh) { reply = oh + "[[SPLIT]]" + reply; memory.offHoursNotified = true; }
    }
  } catch (e) { console.error("off-hours:", e && e.message); }

  // 🏢 ملاحظة الجملة
  if (memory._wholesaleNote) { reply = reply + "[[SPLIT]]" + memory._wholesaleNote; memory._wholesaleNote = null; }

  // 🔴 رسالة واحدة فقط لكل رد
  const chunks = String(reply || "").split("[[SPLIT]]").map(s => s.trim()).filter(Boolean);
  let single = chunks.join("\n\n");

  // 🛒 بيع إضافي
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

  await env.SESSIONS_KV.put(sessionKey, JSON.stringify(memory), { expirationTtl: CONFIG.SESSION_TTL });
}
