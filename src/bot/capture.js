// ═══════════════════════════════════════════════════════════
// 🎣 التقاط الطلبات من المحادثات اللي مش بوتنا اللي رد عليها
//
// ليش هالملف موجود:
//   ذكاء ميتا (Meta Business Agent) بيرد على زبائنك جوّا
//   ماسنجر، **وما بيعطيك الطلب**. ما في API ولا ويبهوك بيقول
//   "أخذت طلب، تفضّل". هو منتج مقفل عند ميتا.
//   ونفس الشي لمّا ترد إنت أو موظفك بالإيد من الموبايل.
//   بالحالتين الطلب بيضيع من الموقع.
//
//   الحل الوحيد الشرعي: منسمع المحادثة كاملة عبر قنوات
//   الويبهوك الرسمية (echo وstandby)، ومنستخرج الطلب بذكائنا
//   نحنا من كلام الزبون الحرفي.
//
// 🔴 القواعد اللي ما بتنكسر:
//   • الاستخراج من **كلام الزبون بس** — ما بنقرأ نية من رد
//     الذكاء ولا من رد الموظف. لأنّ ردهم ممكن يكون غلط أو
//     مخترع، ولو بنينا عليه بنورّث الغلط لقاعدتنا.
//   • الطلب الملتقط بينحفظ بحالة "بحاجة مراجعة" مش "جديد" —
//     لأنّ ما في تأكيد صريح منّا إنه اكتمل.
//   • ممنوع نرد على الزبون من هون إطلاقاً. هاي قناة استماع
//     بحتة — الرد بيضاعف الرسائل على الزبون.
// ═══════════════════════════════════════════════════════════
import { logMessage, saveOrder, orderExists, getSetting } from "../db/database.js";
import { extractOrderWithAI } from "./ai.js";
import { withSessionLock } from "./lock.js";

// المحادثات الملتقطة بالذاكرة: مفتاح "pageId_senderId" → رسائل الزبون
// ما منخزّنها بقاعدة البيانات لأنّ الأرشيف (messages) أصلاً بيحفظها،
// ومنقراها من هناك لمّا نحتاجها كاملة.
const MIN_MS = 60000;

/** هل وضع الالتقاط مفعّل؟ (افتراضياً لأ — التاجر بيشغّله بوعي) */
export function captureEnabled() {
  try { return String(getSetting("capture_external") || "") === "on"; }
  catch { return false; }
}

/** كم دقيقة نستنى بعد آخر رسالة قبل ما نحاول نستخرج الطلب */
export function captureDelayMs() {
  const m = Number(getSetting("capture_delay_min"));
  return (Number.isFinite(m) && m >= 1 && m <= 120 ? m : 3) * MIN_MS;
}

// ═══════════════════════════════════════════════════════════
// 📥 استقبال أحداث القنوات الجانبية
// ═══════════════════════════════════════════════════════════

/**
 * حدث من قناة standby: بوت تاني (أو ذكاء ميتا) ماسك المحادثة،
 * واحنا بس بنسمع. الرسالة هون من الزبون.
 */
export function isStandbyCustomerMessage(event) {
  return !!(event && event.message && !event.message.is_echo && event.sender?.id && event.recipient?.id);
}

/**
 * حدث echo: الصفحة بعتت رسالة — إمّا ذكاء ميتا أو موظف من
 * الموبايل أو بوت تاني. منسجّلها بالأرشيف حتى يكون تاريخ
 * المحادثة كامل، بس **ما منبني عليها استخراج**.
 */
export function isPageEcho(event) {
  return !!(event && event.message && event.message.is_echo);
}

/** بيحدد إذا الحدث echo صادر من تطبيقنا نحنا (فما بدنا نكرّره) */
export function isOurOwnEcho(event, ourAppId) {
  if (!ourAppId) return false;
  return String(event?.message?.app_id || "") === String(ourAppId);
}

/**
 * يسجّل رسالة من قناة جانبية بالأرشيف.
 * @param {"in"|"out"} direction الاتجاه من منظور الصفحة
 */
export function archiveExternal({ pageId, pageName, senderId, direction, body, source }) {
  const text = String(body || "").trim();
  if (!text) return false;
  try {
    logMessage({
      page_id: String(pageId), page_name: String(pageName || ""),
      sender_id: String(senderId),
      direction,
      // منوسم الرسالة بمصدرها حتى تعرف بالأرشيف مين رد فعلاً
      body: direction === "out" && source ? `${source} ${text}` : text,
      created_at: Date.now()
    });
    return true;
  } catch (e) { console.error("archiveExternal:", e && e.message); return false; }
}

// ═══════════════════════════════════════════════════════════
// 🧾 استخراج الطلب من محادثة ما ملكناها
// ═══════════════════════════════════════════════════════════

/**
 * يبني نص المحادثة من رسائل الزبون فقط.
 * 🔴 عمداً بنتجاهل ردود الصفحة: لو الذكاء تبع ميتا اخترع سعر
 *    أو عنوان، ما بدنا نورّث اختراعه لقاعدة بياناتنا.
 */
export function customerOnlyText(rows) {
  return (rows || [])
    .filter((r) => r.direction === "in")
    .map((r) => String(r.body || "").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * يحاول يلتقط طلب من محادثة خارجية ويحفظه.
 *
 * @param {object} a
 * @param {string} a.pageId
 * @param {string} a.senderId
 * @param {object} a.pageConfig إعدادات الصفحة (فيها PRICES)
 * @param {Array}  a.rows رسائل المحادثة من الأرشيف
 * @param {string} a.source وسم المصدر ("ذكاء ميتا" / "رد يدوي" / …)
 * @returns {Promise<{saved:boolean, reason:string, orderId?:number}>}
 */
export async function captureOrderFrom({ pageId, senderId, pageConfig, rows, source = "خارجي" }) {
  if (!pageId || !senderId) return { saved: false, reason: "هوية ناقصة" };
  if (!pageConfig || !Object.keys(pageConfig.PRICES || {}).length)
    return { saved: false, reason: "الصفحة بلا أسعار مضبوطة" };

  const convText = customerOnlyText(rows);
  if (!convText) return { saved: false, reason: "ما في رسائل من الزبون" };

  // 🔒 نفس قفل الجلسة تبع البوت — حتى ما يتسابق الالتقاط مع
  //    البوت لو صادف إنه اشتغل على نفس الزبون بنفس اللحظة
  return withSessionLock(`${pageId}_${senderId}`, async () => {
    const ai = await extractOrderWithAI(convText, pageConfig);
    if (!ai || !ai.ok) return { saved: false, reason: ai?.error || "فشل الاستخراج" };
    if (!ai.is_order || !Array.isArray(ai.items) || !ai.items.length)
      return { saved: false, reason: "المحادثة ما فيها طلب واضح" };

    // منبني نص الطلب والمجموع من أسعار الصفحة — مش من أي رقم
    // ذكره الذكاء تبع ميتا بالمحادثة
    const prices = pageConfig.PRICES || {};
    const parts = [];
    let total = 0;
    for (const it of ai.items) {
      const name = String(it?.product || "").trim();
      const qty = Number(it?.qty);
      if (!name || !prices[name] || !Number.isInteger(qty) || qty <= 0) continue;
      const line = Number(prices[name]) * qty;
      total += line;
      parts.push(`${name} (${qty})`);
    }
    if (!parts.length) return { saved: false, reason: "ما في صنف معروف بأسعار الصفحة" };

    const orderString = parts.join(" + ");
    try {
      if (orderExists(pageId, senderId, orderString))
        return { saved: false, reason: "الطلب مسجّل من قبل" };
    } catch { /* الفحص مش حاسم — منكمّل */ }

    // 🔴 الحالة "بحاجة مراجعة" مش "جديد": ما في تأكيد صريح إنّ
    //    الطلب اكتمل، والعنوان والرقم ممكن يكونوا ناقصين.
    const orderId = saveOrder({
      page_id: pageId, page_name: pageConfig.name || "",
      sender_id: senderId,
      order_string: orderString,
      total: Math.round(total * 100) / 100,
      area: String(ai.area || ""),
      phone: String(ai.phone || ""),
      status: "بحاجة مراجعة",
      messenger_url: `https://business.facebook.com/latest/inbox/all?asset_id=${pageId}&thread_id=${senderId}`,
      created_at: Date.now(),
      session_key: `${pageId}_${senderId}`
    });

    console.log(`🎣 التقطنا طلب #${orderId} من ${source}: ${orderString}`);
    return { saved: true, reason: source, orderId, missing: missingFields(ai) };
  });
}

/** شو ناقص بالطلب الملتقط — بيتعرض للتاجر حتى يكمّله بنفسه */
export function missingFields(ai) {
  const out = [];
  if (!String(ai?.area || "").trim()) out.push("العنوان");
  if (!String(ai?.phone || "").trim()) out.push("رقم الهاتف");
  return out;
}
