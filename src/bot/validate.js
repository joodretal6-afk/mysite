// ═══════════════════════════════════════════════════════════
// 🧾 مصدر البيانات + التحقق النهائي قبل حفظ الطلب
// ═══════════════════════════════════════════════════════════

export function sessionFingerprint(pageId, senderId) {
  return `${pageId}_${senderId}`;
}

export function recordSource(memory, field, value, sourceMid, confidence = 1) {
  if (!memory.prov) memory.prov = {};
  if (value == null || value === "") return;
  memory.prov[field] = {
    value,
    source_mid: sourceMid || null,
    confidence,
    status: sourceMid ? "verified" : "unsourced"
  };
}

export function clearSource(memory, field) {
  if (memory.prov) delete memory.prov[field];
}

export function validateOrder(memory, { pageId, senderId, pageConfig } = {}) {
  const missing = [], reasons = [];
  const prov = memory.prov || {};

  if (pageId != null && senderId != null) {
    const expected = sessionFingerprint(pageId, senderId);
    if (memory.sessionKey && memory.sessionKey !== expected) {
      reasons.push(`🔴 بصمة الجلسة لا تطابق (${memory.sessionKey} ≠ ${expected}) — رُفض الحفظ`);
      return { complete: false, missing: ["identity"], reasons, blocked: true };
    }
  }

  const warnNoSource = [];
  const cartEntries = memory.cart ? Object.entries(memory.cart).filter(([, q]) => Number(q) > 0) : [];
  const totalQty = cartEntries.reduce((s, [, q]) => s + Number(q), 0);
  const minQty = Number(pageConfig?.MINIMUM_QUANTITY || 0);

  if (cartEntries.length === 0) {
    missing.push("order");
    reasons.push(memory.belowMinQty ? `الكمية أقل من الحد الأدنى (${minQty})` : "لا يوجد صنف أو كمية محددة");
  } else if (minQty > 0 && totalQty < minQty) {
    missing.push("quantity");
    reasons.push(`الكمية (${totalQty}) أقل من الحد الأدنى (${minQty})`);
  } else if (!prov.order || !prov.order.source_mid) {
    warnNoSource.push("order");
  }

  const addrUsable = !!memory.area && memory.addressReady !== false;
  if (!addrUsable) { missing.push("address"); reasons.push("العنوان ناقص أو غير كافٍ للتوصيل"); }
  else if (!prov.area || !prov.area.source_mid) warnNoSource.push("address");

  if (!memory.phone || memory.invalidPhoneProvided) { missing.push("phone"); reasons.push("الرقم ناقص أو غير صالح"); }
  else if (!prov.phone || !prov.phone.source_mid) warnNoSource.push("phone");

  if (warnNoSource.length) reasons.push(`⚠️ حقول بلا مصدر مسجّل (للتدقيق): ${warnNoSource.join(",")}`);

  return { complete: missing.length === 0, missing, reasons, blocked: false, warnNoSource };
}
