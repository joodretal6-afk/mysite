// ═══════════════════════════════════════════════════════════
// حساب الطلب
// ═══════════════════════════════════════════════════════════
import { CONFIG } from "../config.js";
import { round2 } from "./utils.js";

export function computeOrder(pageConfig, cart, coupon) {
  const prices = pageConfig.PRICES || {};
  const offers = pageConfig.OFFERS || {};
  const units = pageConfig.UNITS || {};
  const defaultUnit = pageConfig.DEFAULT_UNIT || "نصية";

  let total = 0;
  const lines = [];        // مختصر (للجدول والتخزين)
  const detailed = [];     // مفصّل بالأسعار (للفاتورة)

  for (const [product, qty] of Object.entries(cart)) {
    if (!qty || qty <= 0) continue;
    const base = prices[product] != null ? prices[product] : CONFIG.DEFAULT_PRICE;
    const offerPrice = offers[product] && offers[product][qty];
    const lineTotal = round2(offerPrice != null ? offerPrice : base * qty);
    total += lineTotal;
    const unit = units[product] || defaultUnit;
    lines.push(`${product} (${qty} ${unit})`);
    detailed.push(`• ${product} × ${qty} ${unit} = ${lineTotal}د`);
  }

  const delivery = pageConfig.DELIVERY || 0;

  // عرض التنظيف الثلاثي: جل + كلور + فلاش، حبة واحدة من كل صنف = 26 شامل التوصيل.
  const isCleaningPage = /ريفان|فاتي|كمبرلاند/i.test(String(pageConfig?.name || ""));
  const names = Object.keys(prices);
  const gelName = names.find(n => /جل غسيل/i.test(n));
  const chlorineName = names.find(n => /كلور/i.test(n));
  const flashName = names.find(n => /فلاش/i.test(n));
  const exactBundle = isCleaningPage && gelName && chlorineName && flashName
    && Number(cart[gelName]) === 1 && Number(cart[chlorineName]) === 1 && Number(cart[flashName]) === 1
    && Object.entries(cart).every(([k, q]) => !q || [gelName, chlorineName, flashName].includes(k));
  if (exactBundle) total = 26;
  else total = round2(total + delivery);

  // 🎟️ تطبيق كود الخصم إن وُجد
  let discount = 0;
  if (coupon && coupon.value > 0) {
    discount = coupon.type === "fixed"
      ? Number(coupon.value)
      : round2(total * Number(coupon.value) / 100);
    discount = Math.min(discount, total);
    total = round2(total - discount);
    detailed.push(`🎟️ خصم (${coupon.code}) = -${round2(discount)}د`);
  }

  const deliveryNote = delivery > 0 ? `شامل التوصيل ${delivery}د` : "شامل التوصيل";
  return {
    total,
    discount,
    orderString: lines.join(" + "),
    detailedString: detailed.join("\n"),
    priceString: discount > 0
      ? `${total}د (بعد خصم ${round2(discount)}د، ${deliveryNote})`
      : `${total}د (${deliveryNote})`
  };
}
