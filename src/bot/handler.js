// ═══════════════════════════════════════════════════════════
// معالجة حدث واحد (منطق البوت الأصلي + حفظ الأوردر في قاعدة البيانات)
// ═══════════════════════════════════════════════════════════
import { CONFIG } from "../config.js";
import { PAGES } from "./brain.js";
import { sendText, sendTyping, graphSend, notifyTelegram, fetchAudioAsBase64 } from "./messenger.js";
import { parseMessage, RESET_INTENT } from "./parser.js";
import { computeOrder } from "./order.js";
import { askAI, extractOrderWithAI } from "./ai.js";
import { saveOrder, updateOrder, getKnowledge, logMessage, customerCompletedCount, customerCompletedCountBySender, addReview, getActiveAddons, armFollowup, completeFollowup } from "../db/database.js";

// كشف تقييم/رأي الزبون من نص الرسالة
function detectReview(text) {
  if (!text) return null;
  const star = text.match(/([1-5])\s*(?:نجوم|نجمة|نجمات|stars?|⭐)/i);
  if (star) return { rating: parseInt(star[1], 10), comment: text.slice(0, 200) };
  const complaint = /(سيئ|زفت|مش حلو|مو حلو|ما عجبت|رديئة|رديء|بطيء|تأخر|زعلان|مش راضي|ما بنصح)/i.test(text);
  if (complaint) return { rating: 2, comment: text.slice(0, 200) };
  const praise = /(ممتاز|رائع|زاكي|زاكية|طيبة كتير|حلوة كتير|بنصح فيكم|تسلم ايديكم|يعطيكم العافية|أحلى جبنة|احلى جبنة|ما شاء الله عليكم|ماشاء الله عليكم|أفضل جبنة|افضل جبنة)/i.test(text);
  if (praise && text.length < 140) return { rating: 5, comment: text.slice(0, 200) };
  return null;
}

export async function handleEvent(event, env, ctx) {
  if (!event || event.optin) return;                       // كبسة الإشعارات OTN
  if (!event.message || event.message.is_echo) return;

  const senderId = event.sender?.id;
  const recipientId = event.recipient?.id;
  if (!senderId || !recipientId) return;

  const pageConfig = PAGES[recipientId];
  if (!pageConfig || !env.SESSIONS_KV) return;

  // 🛑 صفحة موقوفة عن العمل: تجاهل الرسالة تماماً (لا رد ولا حفظ)
  if (CONFIG.DISABLED_PAGES.includes(recipientId)) return;

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

  // ⭐ التقاط التقييمات من كلام الزبون (نجوم / مديح / شكوى)
  try {
    const review = detectReview(userMsg);
    const isCustomer = memory.sent || customerCompletedCountBySender(senderId) > 0 ||
      (memory.phone && customerCompletedCount(memory.phone) > 0);
    if (review && isCustomer) {
      addReview({
        page_id: recipientId, page_name: pageConfig.name, sender_id: senderId,
        phone: memory.phone || "", rating: review.rating, comment: review.comment
      });
    }
  } catch (e) { console.error("review capture:", e && e.message); }

  // أمر التصفير
  if (/^(مسح|امسح|reset)$/i.test(userMsg)) {
    await env.SESSIONS_KV.delete(sessionKey);
    await sendText(token, senderId, "تم تفريغ السلة والبيانات، تفضل اطلب من جديد.");
    return;
  }

  // 🔴 تغيير الرأي: بيفرّغ السلة وبيسمح بفاتورة جديدة حتى بعد ما تطلع فاتورة
  if (RESET_INTENT.test(userMsg)) {
    memory.cart = {};
    memory.sent = false;
  }

  if (!memory.sent && userMsg !== "[رسالة صوتية]") {
    parseMessage(memory, userMsg, pageConfig);
  }

  // 🧠 استخراج ذكي من كامل المحادثة (يفهم أي صياغة طبيعية ويكمّل النواقص)
  if (!memory.sent) {
    try {
      const convText = [
        ...(memory.history || []).filter(h => h.role === "user").map(h => h.content),
        userMsg
      ].filter(Boolean).join("\n");
      const ai = await extractOrderWithAI(convText, pageConfig);
      if (ai.ok) {
        // الذكاء الاصطناعي مرجع نهائي (يرى المحادثة كاملة) — يصحّح أخطاء الرادار
        memory.cart = {};
        ai.items.forEach(it => { memory.cart[it.product] = it.qty; });
        memory.area = ai.area || "";                 // يمسح أي عنوان خاطئ التقطه الرادار
        if (ai.phone) { memory.phone = ai.phone; memory.invalidPhoneProvided = false; }
      }
      // لو فشل الذكاء (ai.ok=false) نُبقي نتائج الرادار كما هي
    } catch (e) {
      console.error("live AI extract failed:", e && e.message);
    }
  }

  const cartItemsCount = memory.cart ? Object.keys(memory.cart).length : 0;
  const complete = cartItemsCount > 0 && memory.area && memory.phone && !memory.invalidPhoneProvided;
  const readyForInvoice = complete && !memory.sent;

  const messengerUrl = `https://m.me/${senderId}`;

  // 🟢 وصول فوري للسستم: أي أوردر فيه أصناف + (عنوان أو رقم) ينزل باللوحة مباشرة
  //    ويتحدّث لحظياً لين يكتمل. الحالة "ناقص" حتى يكتمل ثم "جديد".
  const hasIntent = cartItemsCount > 0 && (memory.area || memory.phone);
  if (hasIntent) {
    try {
      const { total, orderString } = computeOrder(pageConfig, memory.cart);
      const status = complete ? "جديد" : "ناقص";
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
    const { total, orderString, detailedString, priceString } = computeOrder(pageConfig, memory.cart);
    reply = pageConfig.INVOICE_TEMPLATE(detailedString || orderString, priceString, memory.area, memory.phone);
    memory.sent = true;
    justSentInvoice = true;

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
    const extraKnowledge = getKnowledge(recipientId);
    reply = await askAI(memory.history, userMsg, audioPart, pageConfig, memory, crmData, extraKnowledge);
    memory.invalidPhoneProvided = false;   // بعد ما ننبّه الزبون منصفّر الفلاغ
  }

  // إرسال الرد (مع دعم تقسيمه لرسالتين عبر [[SPLIT]])
  const chunks = reply.split("[[SPLIT]]").map(s => s.trim()).filter(Boolean);
  for (const chunk of chunks) {
    await sendText(token, senderId, chunk);
  }

  // 🛒 بيع إضافي: بعد اكتمال الطلب، اعرض الأصناف الإضافية (موحّدة لكل الصفحات)
  if (justSentInvoice) {
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

  // 🔴 زر الإشعارات (OTN) مباشرة بعد الفاتورة (فقط لو مفعّل وعندك الصلاحية)
  if (justSentInvoice && CONFIG.ENABLE_OTN) {
    ctx.waitUntil(graphSend(token, {
      recipient: { id: senderId },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "one_time_notif_req",
            title: "حاب نبلغك بس تنزل عروضنا الجديدة؟ 🌹",
            payload: "NEW_OFFERS_OTN"
          }
        }
      }
    }));
  }

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

  // ⏰ المتابعة التلقائية: لو أكمل الطلب لا تتابعه، وإلا اضبط تايمر 10 دقائق
  try {
    if (memory.sent) completeFollowup(recipientId, senderId);
    else armFollowup(recipientId, senderId);
  } catch (e) { console.error("followup arm:", e && e.message); }

  await env.SESSIONS_KV.put(sessionKey, JSON.stringify(memory), { expirationTtl: CONFIG.SESSION_TTL });
}
