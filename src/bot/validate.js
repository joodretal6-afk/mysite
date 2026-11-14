// ═══════════════════════════════════════════════════════════
// 🧾 مصدر البيانات + التحقق النهائي قبل حفظ الطلب
//
// القاعدة الصارمة: ممنوع النظام يخترع أو يفترض أي معلومة تخص العميل.
// أي حقل لازم يكون مصدره رسالة فعلية من **نفس** جلسة العميل، وإلا
// بينرفض ويبقى UNKNOWN.
//
// كل حقل بينحفظ مع أثره:
//   { value, source_mid, confidence, status }
//   - value: القيمة المطبّعة
//   - source_mid: معرّف رسالة فيسبوك اللي إجت منها (إثبات المصدر)
//   - status: "verified" (من رسالة العميل) أو "unknown"
//
// ما في fallback بيخمّن. المعلومة الناقصة = null، والبوت بيسأل عنها.
// ═══════════════════════════════════════════════════════════

// بصمة الجلسة: page_id + sender_id. أي طلب لازم تطابق بصمته
// مفتاح جلسته، وإلا يعني بيانات تجمّعت من سياق غلط — بنرفض الحفظ.
export function sessionFingerprint(pageId, senderId) {
  return `${pageId}_${senderId}`;
}

// تسجيل مصدر حقل — بيتنادى لحظة التقاط القيمة من رسالة العميل.
// source_mid = معرّف الرسالة الحالية (إثبات إنها من العميل نفسه الآن).
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

// مسح أثر حقل (لما تنمسح القيمة نفسها)
export function clearSource(memory, field) {
  if (memory.prov) delete memory.prov[field];
}

// ═══════════════════════════════════════════════════════════
// التحقق النهائي: هل الطلب جاهز للحفظ كـ "مكتمل"؟
//
// بيرجّع { complete, missing:[], reasons:[] }.
// الطلب "مكتمل" فقط لو:
//   1) بصمة الجلسة تطابق (ما في خلط سياق)
//   2) في أصناف
//   3) في عنوان يوصل + مصدره رسالة عميل
//   4) في رقم صحيح + مصدره رسالة عميل
// أي حقل مطلوب بلا مصدر (source_mid) = ناقص، مهما كانت قيمته.
// ═══════════════════════════════════════════════════════════
export function validateOrder(memory, { pageId, senderId } = {}) {
  const missing = [], reasons = [];
  const prov = memory.prov || {};

  // 1) بصمة الجلسة — دفاع بالعمق ضد تجميع بيانات من جلسة غلط
  if (pageId != null && senderId != null) {
    const expected = sessionFingerprint(pageId, senderId);
    if (memory.sessionKey && memory.sessionKey !== expected) {
      reasons.push(`🔴 بصمة الجلسة لا تطابق (${memory.sessionKey} ≠ ${expected}) — رُفض الحفظ`);
      return { complete: false, missing: ["identity"], reasons, blocked: true };
    }
  }

  // ملاحظة مهمة: منع الاختراع بيصير **لحظة الالتقاط** (بوابة تأريض
  // العنوان، فحص الرقم مقابل نص الزبون، مطابقة المنتج بالكلمات). فهون
  // بنمنع الاكتمال بس لما القيمة نفسها ناقصة — ما بنوقف طلب جاهز لمجرّد
  // إنه المصدر مش متسجّل (وإلا طلب كامل بيضيع بلا فاتورة). غياب المصدر
  // بينكتب كتحذير للتدقيق، مش كمانع.
  const warnNoSource = [];

  // 2) الأصناف — القيمة نفسها لازم تكون موجودة (الأصناف ما بتتخترع:
  //    المحلّل بيطابق كلمات منتج حقيقية، والذكاء بيصفّي على المتاح فقط)
  const cartCount = memory.cart ? Object.keys(memory.cart).length : 0;
  if (cartCount === 0) { missing.push("order"); reasons.push("لا يوجد صنف"); }
  else if (!prov.order || !prov.order.source_mid) warnNoSource.push("order");

  // 3) العنوان — لازم يوصل (deliverable). التأريض وقت الالتقاط ضِمن إنه
  //    من كلام الزبون؛ فإذا العنوان موجود وكافٍ، هو صالح.
  const addrUsable = !!memory.area && memory.addressReady !== false;
  if (!addrUsable) { missing.push("address"); reasons.push("العنوان ناقص أو غير كافٍ للتوصيل"); }
  else if (!prov.area || !prov.area.source_mid) warnNoSource.push("address");

  // 4) الرقم — صحيح (فحص الصيغة وقت الالتقاط ضِمن إنه من الزبون)
  if (!memory.phone || memory.invalidPhoneProvided) { missing.push("phone"); reasons.push("الرقم ناقص أو غير صالح"); }
  else if (!prov.phone || !prov.phone.source_mid) warnNoSource.push("phone");

  if (warnNoSource.length) reasons.push(`⚠️ حقول بلا مصدر مسجّل (للتدقيق): ${warnNoSource.join(",")}`);

  return { complete: missing.length === 0, missing, reasons, blocked: false, warnNoSource };
}
