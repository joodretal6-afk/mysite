// ═══════════════════════════════════════════════════════════
// الرادار الذكي الخارق: استخراج الهاتف + الكمية + المنطقة + السلة
// ═══════════════════════════════════════════════════════════
import { normalizeDigits } from "./utils.js";

// 🔴 تصليح مهم: القديم كان فيه "الغ" فأي زبون يكتب "بدي الغنم" كانت السلة بتنمسح
export const RESET_INTENT = /(غيرت\s*رأي|غيرت\s*راي|بطلت|بدال|بدّل|بدل\s|امسح|الغي|ألغي|إلغاء|الغاء|تعديل)/i;

export const JORDAN_PLACES = /(عمان|اربد|إربد|الزرقاء|السلط|البلقاء|المفرق|جرش|عجلون|الكرك|الطفيلة|معان|العقبة|مادبا|الرمثا|صويلح|ماركا|طبربور|خلدا|عبدون|دابوق|تلاع العلي|الجبيهة|شفا بدران|ابو نصير|سحاب|الموقر|الياسمين|نزال|الوحدات|البقعة|الرصيفة|الهاشمية|الحصن|الصريح|حوارة|ايدون|بني كنانة|الاغوار|الأغوار|دير علا|الشونة|الصافي|الكرامة|مؤتة|المزار|الحسينية|شارع|حي|دخلة|دوار|إشارة|لواء|قضاء|مخيم|ضاحية|إسكان|بناية|عمارة|طابق|شقة|بيت|حارة|قرب|بجانب|جمب|مقابل|خلف|ورا|عند|بقالة|سوبر ماركت|مسجد|جامع|مدرسة|مستشفى|مركز|صيدلية|مخبز)/i;

export function extractPhone(memory, text) {
  const compact = text.replace(/[\s\-\.]/g, "");
  const attempt = compact.match(/(?:07\d*|\+962\d*|00962\d*|\d{6,14})/);
  if (!attempt) { memory.invalidPhoneProvided = false; return; }

  let p = attempt[0];
  const strict = /^(?:07[789]\d{7}|(?:00|\+)9627[789]\d{7})$/;

  if (strict.test(p)) {
    if (p.startsWith("00962")) p = "0" + p.slice(5);
    else if (p.startsWith("+962")) p = "0" + p.slice(4);
    memory.phone = p;
    memory.invalidPhoneProvided = false;
  } else if (!memory.phone && p.length >= 6) {
    memory.invalidPhoneProvided = true;
  }
}

export function extractQty(text, pageConfig) {
  // نشيل أرقام العناوين حتى ما تنحسب كمية
  const clean = text.replace(/(عمارة|بناية|شارع|طابق|رقم|شقة|دوار)\s*\d+/gi, "");

  if (pageConfig.QTY_MODE === "kilo") {
    const kg = clean.match(/(\d+(?:\.\d+)?)\s*(?:كيلو|كغ|كجم)/);
    if (kg) return parseFloat(kg[1]);
  } else {
    if (/(8\s*كيلو|ثمانية كيلو|ثماني كيلو)/.test(clean)) return 2;
    if (/(12\s*كيلو)/.test(clean)) return 3;
    if (/(4\s*كيلو|اربعة كيلو|أربعة كيلو|اربع كيلو)/.test(clean)) return 1;
  }

  if (/(نصيتين|ثنتين|تنتين|اثنتين|عبوتين|قصتين|سطليتين|ربعيتين)/.test(clean)) return 2;
  if (/(ثلاث|تلات|تلت)/.test(clean)) return 3;
  if (/(اربع|أربع)/.test(clean)) return 4;
  if (/(نصية|وحدة|واحدة|عبوة|قصة|سطلية|ربعية)/.test(clean)) return 1;

  const m = clean.match(/(?:^|\s)([1-9])(?:\s|$)/);
  if (m) return parseInt(m[1], 10);

  return 0;
}

export function extractArea(memory, text) {
  if (memory.area) return;

  const stripped = text.replace(/(?:07\d*|\+962\d*|00962\d*|\d{6,14})/g, "").trim();
  if (stripped.length < 3) return;

  const isFiller = /^(طيب|تمام|اوك|أوك|ماشي|ان شاء الله|إن شاء الله|اه|ايه|نعم|لا|مرحبا|السلام عليكم|سلام|يسلمو|شكرا|يعطيك العافية|غلط|صح|هلا)$/i.test(stripped);
  const isQuestion = /(بكم|سعر|شو|مالحة|حلوة|بتسيح|بتمط|كم|كيف|ليش|وين|\?|؟)/i.test(stripped);
  if (isFiller || isQuestion) return;

  const wasAskedForLocation = memory.lastReply &&
    /(عنوان|موقع|محافظة|وين|منطقتك|مكانك|توصيل|سكنك)/.test(memory.lastReply);

  if (wasAskedForLocation || JORDAN_PLACES.test(stripped)) {
    memory.area = stripped.slice(0, 200);
  }
}

export function parseMessage(memory, originalText, pageConfig) {
  const text = normalizeDigits(originalText);

  if (!memory.cart) memory.cart = {};

  extractPhone(memory, text);

  const qty = extractQty(text, pageConfig);

  let productFound = false;
  const keywords = pageConfig.PRODUCT_KEYWORDS || {};
  for (const [product, regex] of Object.entries(keywords)) {
    if (regex.test(text)) {
      memory.cart[product] = qty > 0 ? qty : (memory.cart[product] || 1);
      productFound = true;
    }
  }

  // ذكر كمية بدون صنف والسلة فيها صنف واحد → حدّث كميته
  if (qty > 0 && !productFound) {
    const keys = Object.keys(memory.cart);
    if (keys.length === 1) memory.cart[keys[0]] = qty;
  }

  extractArea(memory, text);
  return memory;
}
