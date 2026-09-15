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

  // قاعدة الطلبات المتعددة: مهما كان عدد الأصناف/الأحجام في الطلب العادي،
  // تُحسب أسعارها كلها أولاً، ثم تُضاف رسوم التوصيل مرة واحدة فقط على كامل الطلب.
  // العرض المعلن الذي يتضمن التوصيل هو الاستثناء الوحيد.


  // عروض الحزمة: إذا كانت السلة تطابق جميع مكونات عرض، نستخدم سعر العرض مرة واحدة.
  // أي مكونات زائدة تُحسب بأسعارها العادية.
  const bundles = Array.isArray(pageConfig.BUNDLE_OFFERS) ? pageConfig.BUNDLE_OFFERS : [];
  const used = new Set();
  for (const b of bundles) {
    const products = Array.isArray(b.products) ? b.products : [];
    if (!products.length) continue;
    const matched = products.every(prod => Number(cart[prod] || 0) >= 1);
    if (!matched) continue;
    products.forEach(prod => used.add(prod));
    total += round2(Number(b.price) || 0);
    lines.push(b.label || products.join(" + "));
    detailed.push(`• ${b.label || products.join(" + ")} = ${round2(Number(b.price) || 0)}د${b.includesDelivery ? " شامل التوصيل" : ""}`);
  }

  for (const [product, qty] of Object.entries(cart)) {
    if (used.has(product)) continue;
    if (!qty || qty <= 0) continue;
    const base = prices[product] != null ? prices[product] : CONFIG.DEFAULT_PRICE;
    const offerPrice = offers[product] && offers[product][qty];
    const lineTotal = round2(offerPrice != null ? offerPrice : base * qty);
    total += lineTotal;
    const unit = units[product] || defaultUnit;
    lines.push(`${product} (${qty} ${unit})`);
    detailed.push(`• ${product} × ${qty} ${unit} = ${lineTotal}د`);
  }

  const bundleIncludesDelivery = bundles.some(b => {
    const products = Array.isArray(b.products) ? b.products : [];
    return !!b.includesDelivery && products.length && products.every(prod => used.has(prod));
  });

  // توصيل واحد فقط على كامل الطلب العادي، وليس لكل سطر أو لكل منتج.
  const delivery = bundleIncludesDelivery ? 0 : Number(pageConfig.DELIVERY || 0);
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
