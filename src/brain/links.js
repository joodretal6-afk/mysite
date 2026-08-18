// ═══════════════════════════════════════════════════════════
// 🔗 روابط فتح محادثات الزبائن
//
// ⚠️ الخطأ اللي كان بكل المنصة: استخدام https://m.me/<sender_id>
//
// الـ sender_id اللي بيجي من ويبهوك ماسنجر هو PSID
// (Page-Scoped ID) — معرّف مربوط بصفحتك إنت تحديداً.
// ورابط m.me بيتوقع **معرّف صفحة** مش معرّف زبون، عشان هيك
// كان بيطلع "غير متوفر": هو بيدوّر على صفحة بهاد الرقم وما بيلاقي.
//
// الصيغة الصح لفتح محادثة زبون معيّن هي رابط صندوق الصفحة:
//   facebook.com/<page_id>/inbox/?selected_item_id=<PSID>
//
// وبما إن الـ PSID بلا معنى بلا صفحته، أي رابط لازم ياخد
// page_id معه. بلا page_id ما في رابط صحيح — منرجّع فاضي
// بدل ما نعطي رابط مكسور.
// ═══════════════════════════════════════════════════════════

// الرابط الأساسي: صندوق الصفحة الكلاسيكي (بيشتغل على الويب والموبايل)
export function inboxUrl(pageId, senderId) {
  const p = String(pageId || "").trim();
  const s = String(senderId || "").trim();
  if (!p || !s) return "";
  return `https://www.facebook.com/${encodeURIComponent(p)}/inbox/?selected_item_id=${encodeURIComponent(s)}`;
}

// بديل Business Suite — بعض الحسابات بينفتح معها أسرع
export function businessInboxUrl(pageId, senderId) {
  const p = String(pageId || "").trim();
  const s = String(senderId || "").trim();
  if (!p || !s) return "";
  return `https://business.facebook.com/latest/inbox/all?asset_id=${encodeURIComponent(p)}` +
         `&selected_item_id=${encodeURIComponent(s)}`;
}

// واتساب: هون الرقم رقم هاتف حقيقي، فـ wa.me صحيح فعلاً
export function whatsappUrl(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : "";
}

// حزمة جاهزة للواجهة: الأساسي + البديل
export function contactLinks(pageId, senderId) {
  return {
    inbox: inboxUrl(pageId, senderId),
    business: businessInboxUrl(pageId, senderId),
    // ما في رابط صالح بلا page_id — الواجهة بتخفي الزر ساعتها
    ok: !!(pageId && senderId)
  };
}
