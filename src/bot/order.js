// ═══════════════════════════════════════════════════════════
// حساب الطلب
// ═══════════════════════════════════════════════════════════
import { CONFIG } from "../config.js";
import { round2 } from "./utils.js";

export function computeOrder(pageConfig, cart) {
  const prices = pageConfig.PRICES || {};
  const offers = pageConfig.OFFERS || {};
  const units = pageConfig.UNITS || {};
  const defaultUnit = pageConfig.DEFAULT_UNIT || "نصية";

  let total = 0;
  const lines = [];

  for (const [product, qty] of Object.entries(cart)) {
    if (!qty || qty <= 0) continue;
    const base = prices[product] != null ? prices[product] : CONFIG.DEFAULT_PRICE;
    const offerPrice = offers[product] && offers[product][qty];
    const lineTotal = offerPrice != null ? offerPrice : base * qty;
    total += lineTotal;
    lines.push(`${product} (${qty} ${units[product] || defaultUnit})`);
  }

  const delivery = pageConfig.DELIVERY || 0;
  total = round2(total + delivery);

  return {
    total,
    orderString: lines.join(" + "),
    priceString: delivery > 0
      ? `${total}د (شامل التوصيل ${delivery}د)`
      : `${total}د (شامل التوصيل)`
  };
}
