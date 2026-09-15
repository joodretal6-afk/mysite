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
  const lines = [];
  const detailed = [];
  const remaining = { ...cart };

  // 🎁 العروض المركبة: السعر المخزن للباقة هنا بدون التوصيل؛ التوصيل يضاف مرة واحدة لاحقاً.
  const bundles = Array.isArray(pageConfig.BUNDLE_OFFERS) ? pageConfig.BUNDLE_OFFERS : [];
  for (const b of bundles) {
    const products = Array.isArray(b.products) ? b.products : [];
    if (!products.length || !Number.isFinite(Number(b.price))) continue;
    const bundleQty = Math.min(...products.map(p => Math.max(0, Number(remaining[p] || 0))));
    if (bundleQty > 0) {
      total += round2(bundleQty * Number(b.price));
      for (const product of products) remaining[product] = Math.max(0, Number(remaining[product] || 0) - bundleQty);
      const label = b.label || "عرض";
      lines.push(`${label} × ${bundleQty}`);
      detailed.push(`• ${label} × ${bundleQty} = ${round2(bundleQty * Number(b.price) + (pageConfig.DELIVERY || 0))}د شامل التوصيل`);
    }
  }

  for (const [product, qty] of Object.entries(remaining)) {
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
  total = round2(total + delivery);

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
