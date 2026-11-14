// ═══════════════════════════════════════════════════════════
// حساب الطلب — محصّن بالكامل ضد فواتير تحت الحد الأدنى (مثل 6د في أجبان الرياض)
// ═══════════════════════════════════════════════════════════
import { CONFIG } from "../config.js";
import { round2 } from "./utils.js";

export function computeOrder(pageConfig, cart, coupon) {
  const prices = pageConfig.PRICES || {};
  const offers = pageConfig.OFFERS || {};
  const units = pageConfig.UNITS || {};
  const defaultUnit = pageConfig.DEFAULT_UNIT || "نصية";
  const inclusiveProducts = Array.isArray(pageConfig.INCLUSIVE_PRODUCTS) ? pageConfig.INCLUSIVE_PRODUCTS : [];
  const offerDeliveryIncluded = Boolean(pageConfig.OFFER_DELIVERY_INCLUDED);
  const minQty = Number(pageConfig.MINIMUM_QUANTITY || 0);
  const minInvoiceTotal = Number(pageConfig.MINIMUM_INVOICE_TOTAL || 0);

  const safeCart = cart && typeof cart === "object" ? cart : {};
  const totalQty = Object.values(safeCart).reduce((sum, q) => sum + (Number(q) > 0 ? Number(q) : 0), 0);

  // 🛡️ حاجز الحد الأدنى للكمية (في أجبان الرياض أقل كمية 2 كيلو = 10 دنانير، ممنوع 1 كيلو = 6 دنانير نهائياً)
  if (minQty > 0 && totalQty > 0 && totalQty < minQty) {
    return {
      total: 0,
      subtotal: 0,
      delivery: 0,
      discount: 0,
      belowMinimum: true,
      canIssueInvoice: false,
      minimumQuantity: minQty,
      minimumInvoiceTotal: minInvoiceTotal || undefined,
      orderString: "",
      detailedString: "",
      priceString: ""
    };
  }

  if (totalQty <= 0) {
    return {
      total: 0,
      subtotal: 0,
      delivery: 0,
      discount: 0,
      belowMinimum: false,
      canIssueInvoice: false,
      orderString: "",
      detailedString: "",
      priceString: ""
    };
  }

  let subtotal = 0;
  const lines = [];        // مختصر (للجدول والتخزين على الموقع)
  const detailed = [];     // مفصّل بالأسعار (للفاتورة)
  const remaining = { ...safeCart };

  let hasDeliveryIncludedOffer = false;
  let hasChargeableItem = false;
  let hasAnyPricedItem = false;

  // عروض الحزمة: يدعم الصيغتين (مصفوفة نصوص أو مصفوفة كائنات {name, quantity})
  const bundles = Array.isArray(pageConfig.BUNDLE_OFFERS) ? pageConfig.BUNDLE_OFFERS : [];
  for (const b of bundles) {
    const rawProducts = Array.isArray(b.products) ? b.products : [];
    if (!rawProducts.length) continue;

    const normalizedReqs = rawProducts.map(p =>
      typeof p === "string"
        ? { name: p, quantity: 1 }
        : { name: String(p?.name || "").trim(), quantity: Math.max(1, Number(p?.quantity || 1)) }
    ).filter(p => p.name);

    if (!normalizedReqs.length) continue;

    while (normalizedReqs.every(req => Number(remaining[req.name] || 0) >= req.quantity)) {
      for (const req of normalizedReqs) {
        remaining[req.name] = Number(remaining[req.name] || 0) - req.quantity;
        if (remaining[req.name] <= 0) delete remaining[req.name];
      }
      const bPrice = round2(Number(b.price) || 0);
      const incDel = Boolean(b.includesDelivery || b.deliveryIncluded);
      const bLabel = b.label || b.name || normalizedReqs.map(r => r.name).join(" + ");
      subtotal = round2(subtotal + bPrice);
      hasAnyPricedItem = true;
      if (incDel) hasDeliveryIncludedOffer = true;
      else hasChargeableItem = true;

      lines.push(bLabel);
      detailed.push(`• ${bLabel} = ${bPrice}د${incDel ? " شامل التوصيل" : ""}`);
    }
  }

  for (const [product, rawQty] of Object.entries(remaining)) {
    const qty = Number(rawQty);
    if (!qty || qty <= 0) continue;

    const base = prices[product] != null ? Number(prices[product]) : CONFIG.DEFAULT_PRICE;
    const offerPrice = offers[product] && offers[product][qty];
    const lineTotal = round2(offerPrice != null ? Number(offerPrice) : base * qty);

    subtotal = round2(subtotal + lineTotal);
    hasAnyPricedItem = true;

    const itemIncludesDelivery =
      inclusiveProducts.includes(product) ||
      (offerPrice != null && offerDeliveryIncluded);

    if (itemIncludesDelivery) {
      hasDeliveryIncludedOffer = true;
    } else {
      hasChargeableItem = true;
    }

    const unit = units[product] || defaultUnit;
    lines.push(`${product} (${qty} ${unit})`);
    detailed.push(`• ${product} × ${qty} ${unit} = ${lineTotal}د`);
  }

  // توصيل واحد فقط على كامل الطلب إذا وُجد صنف غير شامل للتوصيل
  const delivery = (!hasAnyPricedItem || (!hasChargeableItem && hasDeliveryIncludedOffer))
    ? 0
    : Number(pageConfig.DELIVERY || 0);

  let total = round2(subtotal + delivery);

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

  // 🛡️ حاجز الحد الأدنى لقيمة الفاتورة (مثل 10 دنانير لأجبان الرياض لمنع أي فاتورة 6 دنانير تحت أي ظرف)
  if (minInvoiceTotal > 0 && total < minInvoiceTotal) {
    return {
      total: 0,
      subtotal: 0,
      delivery: 0,
      discount: 0,
      belowMinimum: true,
      canIssueInvoice: false,
      minimumQuantity: minQty || undefined,
      minimumInvoiceTotal: minInvoiceTotal,
      orderString: "",
      detailedString: "",
      priceString: ""
    };
  }

  const deliveryNote = delivery > 0 ? `شامل التوصيل ${delivery}د` : "شامل التوصيل";
  return {
    total,
    subtotal,
    delivery,
    discount,
    belowMinimum: false,
    canIssueInvoice: total > 0,
    orderString: lines.join(" + "),
    detailedString: detailed.join("\n"),
    priceString: discount > 0
      ? `${total}د (بعد خصم ${round2(discount)}د، ${deliveryNote})`
      : `${total}د (${deliveryNote})`
  };
}
