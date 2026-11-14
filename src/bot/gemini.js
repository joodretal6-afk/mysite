export function buildNextTask(memory, pageConfig = {}) {
  const cartItemsCount = memory.cart ? Object.keys(memory.cart).length : 0;
  const minQty = Number(pageConfig?.MINIMUM_QUANTITY || 0);
  const minTotal = Number(pageConfig?.MINIMUM_INVOICE_TOTAL || 0);

  let ctx = "";
  if ((memory.history || []).length > 0) {
    ctx += "⚠️ هذه محادثة مستمرة (ليست جديدة): ممنوع الترحيب من جديد كأنها بداية — كمّل من حيث توقفت مباشرة.\n";
  }
  const known = [];
  if (cartItemsCount > 0) known.push("الطلب: " + Object.entries(memory.cart).map(([p, q]) => p + " ×" + q).join("، "));
  if (memory.area) known.push("العنوان: " + memory.area);
  if (memory.phone) known.push("الرقم: " + memory.phone);
  if (memory.customerName) known.push("الاسم: " + memory.customerName);
  if (known.length) ctx += "✅ معلومات مؤكدة محفوظة (لا تسأل عنها مرة أخرى أبداً): " + known.join(" | ") + "\n";

  if (memory.belowMinQty && minQty > 1) {
    return ctx + `الآن: 🔴 الزبون طلب كمية (${memory.belowMinQty}) وهي أقل من الحد الأدنى المسموح! اعتذر بلباقة ووضّح أن أقل كمية للطلب هي ${minQty} ${pageConfig.DEFAULT_UNIT || "كيلو"}${minTotal ? ` بقيمة ${minTotal} دنانير شامل التوصيل` : ""} (والـ 4 كيلو بـ 18 دينار شامل التوصيل)، واسأله كم كيلو نعتمد له. ممنوع إصدار فاتورة الآن!`;
  }
  if (memory.invalidPhoneProvided) {
    return ctx + "الآن: أخبر الزبون أن الرقم خطأ، واطلب رقم أردني صحيح (10 أرقام) فوراً.";
  }
  if (cartItemsCount === 0) {
    if (memory.needsQtySelection && minQty > 1) {
      return ctx + `الآن: اسأل الزبون كم ${pageConfig.DEFAULT_UNIT || "كيلو"} يحب أن يطلب (وضّح أن أقل طلب ${minQty} ${pageConfig.DEFAULT_UNIT || "كيلو"}${minTotal ? ` بـ ${minTotal} دنانير شامل التوصيل` : ""}).`;
    }
    return ctx + "الآن: اطلب من الزبون اختيار النوع والكمية.";
  }
  if (!memory.area && !memory.phone) {
    return ctx + "الآن: اطلب المحافظة ورقم الهاتف لتثبيت الطلب. (ممنوع طباعة الفاتورة أو تأكيد الطلب)";
  }
  if (!memory.area) {
    return ctx + "الآن: اطلب منه اسم المحافظة والمنطقة. (ممنوع تأكيد الطلب)";
  }
  if (!memory.phone) {
    return ctx + "الآن: 🔴 اطلب رقم الهاتف فوراً وبشكل حازم. (ممنوع تأكيد الطلب أو طباعة فاتورة قبل أخذ الرقم!)";
  }
  if (!memory.customerName) {
    return ctx + "الآن: اطلب الاسم فقط، ولا تطلب رقم الهاتف أو المنطقة أو العنوان مرة أخرى لأنها محفوظة.";
  }
  return ctx;
}
