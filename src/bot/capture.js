import { createHash } from "node:crypto";
// ═══════════════════════════════════════════════════════════
// 🎣 التقاط الطلبات من المحادثات الخارجية — مرتبط بـ computeOrder المحصّن
// ═══════════════════════════════════════════════════════════
import { logMessage, saveOrder, updateOrder, getSetting, getRecentOpenOrderId, getLatestEditableOrderId, getOrderBySourceFingerprint } from "../db/database.js";
import { extractOrderWithAI } from "./ai.js";
import { computeOrder } from "./order.js";
import { withSessionLock } from "./lock.js";

const MIN_MS = 60000;

export function captureEnabled() {
  try {
    if (handedOverToMeta()) return true;
    return String(getSetting("capture_external") || "") === "on";
  } catch { return false; }
}

export function handedOverToMeta() {
  try { return String(getSetting("handover_meta") || "") === "on"; }
  catch { return false; }
}

export function captureDelayMs() {
  const m = Number(getSetting("capture_delay_min"));
  return (Number.isFinite(m) && m >= 1 && m <= 120 ? m : 3) * MIN_MS;
}

export function isStandbyCustomerMessage(event) {
  return !!(event && event.message && !event.message.is_echo && event.sender?.id && event.recipient?.id);
}

export function isPageEcho(event) {
  return !!(event && event.message && event.message.is_echo);
}

export function isOurOwnEcho(event, ourAppId) {
  if (!ourAppId) return false;
  return String(event?.message?.app_id || "") === String(ourAppId);
}

export function archiveExternal({ pageId, pageName, senderId, direction, body, source }) {
  const text = String(body || "").trim();
  if (!text) return false;
  try {
    logMessage({
      page_id: String(pageId), page_name: String(pageName || ""),
      sender_id: String(senderId),
      direction,
      body: direction === "out" && source ? `${source} ${text}` : text,
      created_at: Date.now()
    });
    return true;
  } catch (e) { console.error("archiveExternal:", e && e.message); return false; }
}

export function customerOnlyText(rows) {
  return (rows || [])
    .filter((r) => r.direction === "in")
    .map((r) => String(r.body || "").trim())
    .filter(Boolean)
    .join("\n");
}

function captureFingerprint(pageId, senderId, rows) {
  const cust = (rows || []).filter(r => r.direction === "in" && String(r.body || "").trim());
  const last = cust[cust.length - 1];
  const prior = cust.slice(-3).map(r => `${r.created_at || ""}:${String(r.body || "").trim()}`).join("\n");
  const raw = `${pageId}|${senderId}|${last?.created_at || ""}|${last?.body || ""}|${prior}`;
  try {
    return createHash("sha256").update(raw).digest("hex");
  } catch { return Buffer.from(raw).toString("base64url").slice(0, 200); }
}

function recentPurchaseSignal(pageConfig, rows) {
  const lastText = (rows || []).filter(r => r.direction === "in").slice(-4).map(r => String(r.body || "")).join(" ");
  const names = Object.keys(pageConfig?.PRICES || {}).filter(Boolean);
  const productHit = names.some(n => lastText.includes(n)) || /(جبن|جبنة|كيلو|جل|كلور|فلاش|طلب|بدي|بدّي|اريد|أريد|هات|اعطيني|اعطني|نفس الطلب|عيد|كرر|كمان|اضف|أضف|بدل|عدل|غيّر|غير|شيل|احذف)/i.test(lastText);
  const contactOrAddress = /(?:07\d{7,8}|\+962\d{8,9}|الاسم|اسمي|الهاتف|رقم الهاتف|العنوان|المنطقة|عمان|اربد|الزرقاء|السلط|المفرق|تلاع|شارع|دوار|قريب|عمارة|بناية)/i.test(lastText);
  return productHit || contactOrAddress;
}

function explicitRepeat(rows) {
  const t = (rows || []).filter(r => r.direction === "in").slice(-3).map(r => String(r.body || "")).join(" ");
  return /(نفس الطلب|الطلب السابق|زي المرة|عيد طلبي|أعد طلبي|اعد طلبي|نفس السابق|كرر الطلب|كرر طلبي|نفس الطلبية|نفس طلبي)/i.test(t);
}

export async function captureOrderFrom({ pageId, senderId, pageConfig, rows, source = "خارجي" }) {
  if (!pageId || !senderId) return { saved: false, reason: "هوية ناقصة" };
  if (!pageConfig || !Object.keys(pageConfig.PRICES || {}).length)
    return { saved: false, reason: "الصفحة بلا أسعار مضبوطة" };

  const convText = customerOnlyText(rows);
  if (!convText) return { saved: false, reason: "ما في رسائل من الزبون" };
  const recentOpenOrderId = getRecentOpenOrderId(pageId, senderId);
  if (!recentOpenOrderId && !recentPurchaseSignal(pageConfig, rows)) return { saved: false, reason: "ما في إشارة شراء/متابعة حديثة" };
  const sourceFingerprint = captureFingerprint(pageId, senderId, rows);
  const priorCapture = getOrderBySourceFingerprint(sourceFingerprint);
  if (priorCapture) return { saved: false, reason: "نفس الحدث ملتقط مسبقاً", orderId: priorCapture.id };

  return withSessionLock(`${pageId}_${senderId}`, async () => {
    const ai = await extractOrderWithAI(convText, pageConfig);
    if (!ai || !ai.ok) return { saved: false, reason: ai?.error || "فشل الاستخراج" };
    if (!ai.is_order || !Array.isArray(ai.items) || !ai.items.length)
      return { saved: false, reason: ai?.below_min_qty ? "الكمية أقل من الحد الأدنى للصفحة" : "المحادثة ما فيها طلب واضح" };

    const prices = pageConfig.PRICES || {};
    const cart = {};
    for (const it of ai.items) {
      const name = String(it?.product || "").trim();
      const qty = Number(it?.qty);
      if (!name || prices[name] == null || !Number.isFinite(qty) || qty <= 0) continue;
      cart[name] = qty;
    }
    if (!Object.keys(cart).length) return { saved: false, reason: "ما في صنف معروف بأسعار الصفحة" };

    // 🛡️ حساب الطلب عبر computeOrder الموحّد لضمان إضافة التوصيل ومنع أي طلب تحت 10 دنانير في أجبان الرياض
    const computed = computeOrder(pageConfig, cart, null);
    if (computed.belowMinimum || !computed.canIssueInvoice || computed.total <= 0) {
      return { saved: false, reason: "الطلب أقل من الحد الأدنى المعتمد للصفحة" };
    }

    const orderString = computed.orderString;
    const total = computed.total;
    const repeat = explicitRepeat(rows);
    let orderId = null;
    if (!repeat) {
      orderId = recentOpenOrderId ? Number(recentOpenOrderId) : null;
      if (!orderId && /(عدل|عدّل|تعديل|غير|غيّر|بدل|بدّل|زيد|زود|أضف|اضف|احذف|شيل|كمان)/i.test((rows || []).filter(r => r.direction === "in").slice(-4).map(r => String(r.body || "")).join(" "))) {
        try { orderId = getLatestEditableOrderId(pageId, senderId); } catch {}
      }
    }

    if (orderId) {
      updateOrder(orderId, {
        order_string: orderString,
        total: Math.round(total * 100) / 100,
        area: String(ai.area || ""),
        phone: String(ai.phone || ""),
        status: "بحاجة مراجعة",
        source_fingerprint: sourceFingerprint
      });
      console.log(`🎣 حدّثنا طلب #${orderId} من ${source}: ${orderString} (${total}د)`);
      return { saved: true, updated: true, reason: source, orderId, missing: missingFields(ai) };
    }

    const orderIdNew = saveOrder({
      page_id: pageId, page_name: pageConfig.name || "",
      sender_id: senderId,
      order_string: orderString,
      total: Math.round(total * 100) / 100,
      area: String(ai.area || ""),
      phone: String(ai.phone || ""),
      status: "بحاجة مراجعة",
      messenger_url: `https://business.facebook.com/latest/inbox/all?asset_id=${pageId}&thread_id=${senderId}`,
      created_at: Date.now(),
      source_fingerprint: sourceFingerprint,
      session_key: `${pageId}_${senderId}`
    });

    console.log(`🎣 التقطنا طلب #${orderIdNew} من ${source}: ${orderString} (${total}د)`);
    return { saved: true, created: true, reason: source, orderId: orderIdNew, missing: missingFields(ai) };
  });
}

export function missingFields(ai) {
  const out = [];
  if (!String(ai?.area || "").trim()) out.push("العنوان");
  if (!String(ai?.phone || "").trim()) out.push("رقم الهاتف");
  return out;
}
