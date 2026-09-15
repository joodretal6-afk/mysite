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

  let subtotal = 0;
  const lines = [];
  const detailed = [];
  const remaining = { ...(cart || {}) };

  // عروض مركبة: مثال جل + كلور + فلاش = 24 + 2 توصيل = 26.
  // يمكن تطبيق أكثر من باقة، والباقي يحسب بالسعر الفردي.
  for (const [offerName, offer] of Object.entries(offers)) {
    const required = offer?.items;
    const offerPrice = Number(offer?.price);
    if (!required || !Number.isFinite(offerPrice) || offerPrice < 0) continue;
    const counts = Object.entries(required).map(([product, need]) => {
      const n = Number(need) || 0;
      return n > 0 ? Math.floor((Number(remaining[product]) || 0) / n) : Infinity;
    });
    const bundleQty = counts.length ? Math.min(...counts) : 0;
    if (!Number.isFinite(bundleQty) || bundleQty <= 0) continue;

    for (const [product, need] of Object.entries(required)) {
      remaining[product] = Math.max(0, (Number(remaining[product]) || 0) - bundleQty * Number(need));
    }
    const lineTotal = round2(bundleQty * offerPrice);
    subtotal += lineTotal;
    const unit = units[offerName] || "عرض";
    lines.push(`${offerName} (${bundleQty} ${unit})`);
    detailed.push(`• ${offerName} × ${bundleQty} = ${lineTotal}د`);
  }

  for (const [product, qtyRaw] of Object.entries(remaining)) {
    const qty = Number(qtyRaw) || 0;
    if (qty <= 0) continue;
    const base = prices[product] != null ? Number(prices[product]) : CONFIG.DEFAULT_PRICE;
    const offerPrice = offers[product] && offers[product][qty];
    const lineTotal = round2(offerPrice != null ? Number(offerPrice) : base * qty);
    subtotal += lineTotal;
    const unit = units[product] || defaultUnit;
    lines.push(`${product} (${qty} ${unit})`);
    detailed.push(`• ${product} × ${qty} ${unit} = ${lineTotal}د`);
  }

  const delivery = pageConfig.DELIVERY || 0;
  let total = round2(subtotal + delivery);

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
