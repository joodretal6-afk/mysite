// ═══════════════════════════════════════════════════════════
// الرادار الذكي الخارق: استخراج الهاتف + الكمية + المنطقة + السلة
// ═══════════════════════════════════════════════════════════
import { normalizeDigits } from "./utils.js";
import { mergeAddress, looksLikeAddressAttempt, isCorrection } from "./address.js";
import { recordSource, clearSource } from "./validate.js";

const CLEAR_WORD = "(?:امسح|الغي|ألغي|إلغاء|الغاء|بطلت|شيل|فضّي|فضي)";
const ORDER_WORD = "(?:الطلب|الطلبيه|الطلبية|السله|السلة|الاوردر|الأوردر|كل شي|كلشي|الكل)";
export const RESET_INTENT = new RegExp(
  `(غيرت\\s*رأي|غيرت\\s*راي|بلّشنا من جديد|من الاول|من البدايه|من البداية` +
  `|${CLEAR_WORD}\\s+${ORDER_WORD}|${ORDER_WORD}\\s+${CLEAR_WORD})`, "i");

const JORDAN_TERMS = [
  "عمان","العاصمة","اربد","إربد","الزرقاء","الزرقا","البلقاء","السلط","المفرق","جرش","عجلون",
  "الكرك","الطفيلة","معان","العقبة","مادبا","مأدبا",
  "الرصيفة","الرصيفه","الرمثا","الرمثه","دير علا","الشوبك","القويرة","القويره","الحسا","القطرانة","القطرانه",
  "وادي موسى","وادي موسي","البترا","الجفر","الشونة","الشونه","الاغوار","الأغوار","غور الصافي","الصافي",
  "الكرامة","الكرامه","المزار","المزار الجنوبي","المزار الشمالي","القصر","عي","فقوع","الربة","الربه",
  "عبدون","الصويفية","الصويفيه","الشميساني","ام اذينة","أم أذينة","خلدا","دابوق","دير غبار","ام السماق","أم السماق",
  "الرابية","الرابيه","تلاع العلي","الجاردنز","الجاردنر","الجندويل","صويلح","الجبيهة","الجبيهه",
  "شفا بدران","المدينة الرياضية","المدينه الرياضيه","ياجوز","الكمالية","الكماليه","العبدلي","جبل عمان","جبل الحسين",
  "جبل اللويبدة","اللويبدة","اللويبده","الدوار الاول","الدوار الثاني","الدوار الثالث","الدوار الرابع","الدوار الخامس",
  "الدوار السادس","الدوار السابع","الدوار الثامن","السابع","الثامن","الرابع","الخامس","السادس","دوار الداخلية",
  "ماركا","ماركا الشمالية","ماركا الجنوبية","طبربور","النصر","حي نزال","نزال","الوحدات","المحطة","المحطه","رأس العين",
  "راس العين","القويسمة","القويسمه","اليرموك","الجويدة","الجويده","ابو علندا","أبو علندا","المقابلين","الاشرفية",
  "الأشرفية","جبل النظيف","جبل النصر","الهاشمي الشمالي","الهاشمي","المنارة","المناره","العروب","الزهور","المدينة",
  "طارق","الذراع الغربي","حي الطفايلة","اربد الجديدة","الحزام","النزهة","النزهه","المريخ",
  "ابو نصير","أبو نصير","الياسمين","المنطقة الحرة","اسكان","إسكان","ضاحية الاميرة","ضاحية الأميرة","ضاحية الرشيد",
  "ضاحية الحسين","ضاحية الاقصى","ضاحية الياسمين","رجم عميش",
  "الزرقاء الجديدة","حي الامير محمد","حي معصوم","الهاشمية","الهاشميه","الازرق","الأزرق","بيرين","الضليل",
  "جبل طارق","حي الجندي","حي رمزي","السخنة","السخنه","الظليل",
  "الحصن","الصريح","حوارة","حواره","ايدون","إيدون","بني كنانة","النعيمة","النعيمه","بشرى","سال","حبراص","كفريوبا",
  "الطيبة","الطيبه","الوسطية","دير ابي سعيد","كفرابيل","عنجرة","عنجره","صخرة","كفرنجة","كفرنجه","برما","سوف","المصطبة",
  "الشجرة","بيت راس","حكما","الاغوار الشمالية","الشونة الشمالية","المشارع","معاذ بن جبل",
  "مؤتة","مؤته","العدنانية","غور المزرعة","الثنية","الثنيه","ادر","أدر",
  "بصيرا","العيص","القادسية","القادسيه","بسيرا",
  "الحسينية","الحسينيه","اذرح","الديسة","الديسه","وادي رم",
  "رم","الريشة","المدورة","المدوره","الرويشد","صفاوي","البادية الشمالية","البادية الوسطى","البادية الجنوبية",
  "ذيبان","حسبان","ماعين","لب","مليح","جرينة","الفيصلية","الفيحاء","العريض",
  "البقعة","البقعه","مخيم البقعة","مخيم الوحدات","مخيم حطين","مخيم سوف","مخيم غزة","مخيم غزه","مخيم الحصن","مخيم اربد",
  "مخيم الطالبية","مخيم الزرقاء","مخيم ماركا","مخيم جرش","مخيم الشهيد","مخيم","الشهيد عزمي المفتي",
  "شارع","شارعنا","حي","دخلة","دخله","حارة","حاره","دوار","اشارة","إشارة","اشاره","لواء","قضاء","ضاحية","ضاحيه",
  "بناية","عمارة","عماره","بناء","طابق","الطابق","طوابق","شقة","شقه","بيت","دار","فيلا","منزل",
  "قرب","بجانب","جمب","جنب","مقابل","خلف","ورا","امام","أمام","عند","تحت","فوق","وسط","نص","جوا","بالقرب",
  "مسجد","جامع","كنيسة","كنيسه","مدرسة","مدرسه","جامعة","جامعه","مستشفى","مستوصف","مركز صحي","مركز","صيدلية","صيدليه",
  "مخبز","فرن","بقالة","بقاله","سوبر ماركت","سوبرماركت","ماركت","صالون","مطعم","كازية","محطة","محطه","بنك","صراف",
  "حديقة","حديقه","ملعب","ساحة","ساحه","مجمع","مول","سيتي مول","بلازا","برج","اوتوستراد","اوتستراد","الطريق","طريق",
  "المنطقة","المنطقه","منطقة","بلدة","بلده","قرية","قريه","ضيعة","ريف","العنوان","عنواني","سكني","سكن","منطقتي","بلدنا"
];

const _terms = JORDAN_TERMS.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const _bound = "[\\s،.,:/\\-]";
export const JORDAN_PLACES = new RegExp(`(?:^|${_bound})(?:${_terms})(?=$|${_bound})`, "i");

export function isKiloModePage(pageConfig) {
  return Boolean(pageConfig && (pageConfig.QTY_MODE === "kilo" || pageConfig.DEFAULT_UNIT === "كيلو"));
}

export function extractPhone(memory, text, sourceMid = null) {
  const norm = text.replace(/[\s\-\.]/g, "").replace(/(?:\+962|00962)7/g, "07");
  const valid = norm.match(/07[789]\d{7}/);
  if (valid) {
    memory.phone = valid[0]; memory.invalidPhoneProvided = false;
    recordSource(memory, "phone", valid[0], sourceMid);
    return;
  }

  const looksLikePhoneAttempt = /(?:^|[^0-9])(?:07\d{4,}|(?:\+962|00962)\d{6,})/.test(text.replace(/[\s\-\.]/g, ""));
  memory.invalidPhoneProvided = (!memory.phone && looksLikePhoneAttempt) ? true : false;
}

export function extractQty(text, pageConfig = {}) {
  const normalized = normalizeDigits(String(text || ""));
  const kiloPage = isKiloModePage(pageConfig);

  // ═══════════════════════════════════════════════════════════
  // ⚖️ مسار الصفحات التي تبيع بالكيلو (مثل أجبان الرياض):
  // "4 كيلو" = 4 وليس 1! مع تجاهل أرقام الهواتف والأسعار والعناوين.
  // ═══════════════════════════════════════════════════════════
  if (kiloPage) {
    const stripped = normalized
      .replace(/(?:\+?962|00962)?0?7[789]\d{7}/g, " ")
      .replace(/(?:عمارة|عماره|بناية|بنايه|شارع|طابق|رقم|شقة|شقه|دوار|حي)\s*\d+/gi, " ")
      .replace(/\d+(?:\.\d+)?\s*(?:دينار|دنانير|jd|د\.ا|د)(?=\s|$|[.,،!؟])/gi, " ");

    // 1) رقم متبوع بكلمة كيلو ("4 كيلو" / "2 كيلو" / "1 كيلو")
    const kgNum = stripped.match(/(\d+(?:\.\d+)?)\s*(?:كيلو|كيلوات|كغ|كغم|كجم|كيلوغرام)/i);
    if (kgNum) return parseFloat(kgNum[1]);

    // 2) كلمات عددية بالكيلو ("اربع كيلو"، "كيلوين"، "ثلاث كيلو"...)
    if (/(?:كيلوين|اثنين\s*كيلو|اتنين\s*كيلو|ثنتين\s*كيلو|تنتين\s*كيلو)/i.test(stripped)) return 2;
    if (/(?:ثلاث|ثلاثة|ثلاثه|تلات|تلاتة|تلت)\s*(?:كيلو|كيلوات|كغ|كغم)/i.test(stripped)) return 3;
    if (/(?:اربع|أربع|اربعة|أربعة|اربعه|أربعه)\s*(?:كيلو|كيلوات|كغ|كغم)/i.test(stripped)) return 4;
    if (/(?:خمس|خمسة|خمسه)\s*(?:كيلو|كيلوات|كغ|كغم)/i.test(stripped)) return 5;
    if (/(?:ست|ستة|سته)\s*(?:كيلو|كيلوات|كغ|كغم)/i.test(stripped)) return 6;
    if (/(?:سبع|سبعة|سبعه)\s*(?:كيلو|كيلوات|كغ|كغم)/i.test(stripped)) return 7;
    if (/(?:ثمان|ثمانية|ثمانيه|تمن)\s*(?:كيلو|كيلوات|كغ|كغم)/i.test(stripped)) return 8;
    if (/(?:تسع|تسعة|تسعه)\s*(?:كيلو|كيلوات|كغ|كغم)/i.test(stripped)) return 9;
    if (/(?:عشر|عشرة|عشره)\s*(?:كيلو|كيلوات|كغ|كغم)/i.test(stripped)) return 10;
    if (/(?:كيلو\s*واحد|واحد\s*كيلو|نص\s*كيلو)/i.test(stripped)) return 1;
    if (/(?:^|\s)(?:بدي|اعطيني|ابعتلي|وصلي|هات)\s+كيلو(?:\s|$)/i.test(stripped)) return 1;

    // 3) رد مختصر بالعدد بعد سؤال البوت عن الكمية (مثل: "بدي 4" أو "4" أو "اربعة")
    const directBuyNum = stripped.match(/(?:^|\s)(?:بدي|اعطيني|اعتمدلي|سجل|خليهم|خليها)\s*([1-9]\d?)(?:\s|$)/i);
    if (directBuyNum) return parseInt(directBuyNum[1], 10);

    const trimmedOnly = stripped.trim();
    if (/^[1-9]\d?$/.test(trimmedOnly)) return parseInt(trimmedOnly, 10);
    if (/^(?:اثنين|اتنين|ثنتين|تنتين)$/.test(trimmedOnly)) return 2;
    if (/^(?:ثلاث|ثلاثة|ثلاثه|تلات|تلاتة)$/.test(trimmedOnly)) return 3;
    if (/^(?:اربع|أربع|اربعة|أربعة|اربعه|أربعه)$/.test(trimmedOnly)) return 4;
    if (/^(?:خمس|خمسة|خمسه)$/.test(trimmedOnly)) return 5;

    return 0;
  }

  // ═══════════════════════════════════════════════════════════
  // 📦 مسار الصفحات التي تبيع بالنصية/العبوة/العرض:
  // ═══════════════════════════════════════════════════════════
  const clean = normalized
    .replace(/(عمارة|بناية|شارع|طابق|رقم|شقة|دوار|حي)\s*\d+/gi, " ")
    .replace(/\d+(?:\.\d+)?\s*(?:كيلو|كغ|كجم|كيلوغرام|غرام|جرام|غم|جم|كباو|كباية|علبة|علب)/gi, " وزن ")
    .replace(/\d+(?:\.\d+)?\s*(?:دينار|دنانير|jd)/gi, " ")
    .replace(/\b\d{3,}\b/g, " ");

  // كمية من ذكر الكيلوهات صراحةً لصفحات النصية (النصية = 4 كيلو)
  if (/(16\s*كيلو|ستة عشر كيلو)/.test(normalized)) return 4;
  if (/(12\s*كيلو|اثنا عشر كيلو|اثنعش كيلو)/.test(normalized)) return 3;
  if (/(8\s*كيلو|ثمانية كيلو|ثماني كيلو|ثمن كيلو)/.test(normalized)) return 2;
  if (/(4\s*كيلو|اربعة كيلو|أربعة كيلو|اربع كيلو|أربع كيلو)/.test(normalized)) return 1;

  // كلمات الكمية الصريحة (تثنية/جمع/مفرد) + دعم العروض (عرضين / 3 عروض)
  if (/(نصيتين|نصيّتين|ثنتين|تنتين|اثنتين|عبوتين|قصتين|سطليتين|ربعيتين|حبتين|علبتين|كباويتين|عرضين)/.test(clean)) return 2;
  if (/(ثلاث|تلات|تلت)\s*(?:نصيات|نصايا|عبوات|حبات|قصص|قطع|علب|كباوي|عروض)?/.test(clean)) return 3;
  if (/(اربع|أربع|أربعة|اربعة)\s*(?:نصيات|نصايا|عبوات|حبات|قصص|قطع|علب|كباوي|عروض)/.test(clean)) return 4;
  if (/(خمس|خمسة)\s*(?:نصيات|نصايا|عبوات|حبات|قصص|قطع|علب|كباوي|عروض)/.test(clean)) return 5;

  if (/(نصية|نصيه|نصّية|وحدة|وحده|واحدة|واحده|عبوة|عبوه|قصة|قصه|سطلية|ربعية|حبة|حبه|حباية|كباية|كباوة|كباوه)/.test(clean)) return 1;

  const m = clean.match(/(?:^|\s|بدي|عدد|كمية|كميه)\s*([1-9])\s*(نصي|نصاي|عبو|حب|قص|قطع|سطلي|ربعي|علب|كباو|وحد|عرض|عروض)/);
  if (m) return parseInt(m[1], 10);

  return 0;
}

export function extractArea(memory, text, sourceMid = null) {
  const stripped = text.replace(/(?:\+962|00962)?0?7[789]\d{7}/g, " ").trim();
  if (stripped.length < 2) return;

  const wasAsked = !!(memory.lastReply &&
    /(عنوان|موقع|محافظ|وين|منطقت|مكانك|سكنك|أقرب معلم|اقرب معلم)/.test(memory.lastReply));

  const correcting = isCorrection(stripped);
  if (!correcting && !looksLikeAddressAttempt(stripped, { wasAsked })) return;

  const before = memory.addr || null;
  const next = mergeAddress(before, stripped, { force: correcting, fuzzy: wasAsked || correcting });

  if (before && !correcting && next.score < before.score) return;

  memory.addr = next;
  memory.area = next.formatted;
  memory.addressScore = next.score;
  memory.addressLevel = next.level;
  memory.addressReady = next.deliverable;
  memory.addressMissing = next.missing;
  memory.addressQuestion = next.nextQuestion;
  recordSource(memory, "area", next.formatted, sourceMid);
}

export function parseMessage(memory, originalText, pageConfig, sourceMid = null) {
  const text = normalizeDigits(originalText);
  if (!memory.cart) memory.cart = {};

  const minQty = Number(pageConfig?.MINIMUM_QUANTITY || 0);
  const cartBefore = JSON.stringify(memory.cart);

  // 🎁 عروض مواد التنظيف (يدعم مصفوفة نصوص أو كائنات {name, quantity})
  const bundles = Array.isArray(pageConfig.BUNDLE_OFFERS) ? pageConfig.BUNDLE_OFFERS : [];
  const wantsBundle = /(?:^|\s)(?:العرض|عرض|البكج|الباكدج|الباقة|الثلاثة|الثلاث|كلهم|كلهن)(?:\s|$)/i.test(text);
  if (wantsBundle && bundles.length) {
    const b = bundles[0];
    for (const item of (b.products || [])) {
      const prodName = typeof item === "string" ? item : String(item?.name || "").trim();
      const prodQty = typeof item === "object" && item?.quantity ? Number(item.quantity) : 1;
      if (prodName && pageConfig.PRICES?.[prodName] != null) {
        memory.cart[prodName] = Math.max(prodQty, Number(memory.cart[prodName] || 0));
      }
    }
  }

  extractPhone(memory, text, sourceMid);

  const qty = extractQty(text, pageConfig);

  // 🛡️ إذا كانت الصفحة لها حد أدنى للكمية (مثل أجبان الرياض: 2 كيلو) وطلب الزبون أقل منه (مثل 1 كيلو):
  // لا نُدخل الكمية المخالفة في السلة نهائياً حتى لا تتحول إلى طلب 6 دنانير!
  if (minQty > 1 && qty > 0 && qty < minQty) {
    memory.belowMinQty = qty;
    for (const k of Object.keys(memory.cart)) {
      if (Number(memory.cart[k]) < minQty) delete memory.cart[k];
    }
    if (!Object.keys(memory.cart).length) clearSource(memory, "order");
    extractArea(memory, text, sourceMid);
    return memory;
  }
  if (minQty > 1 && qty >= minQty) {
    memory.belowMinQty = null;
    memory.needsQtySelection = false;
  }

  const keywords = pageConfig.PRODUCT_KEYWORDS || {};
  const hits = [];
  for (const [product, regex] of Object.entries(keywords)) {
    const rx = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
    let m;
    while ((m = rx.exec(text)) !== null) {
      hits.push({ product, at: m.index, end: m.index + m[0].length });
      if (m.index === rx.lastIndex) rx.lastIndex++;
    }
  }
  hits.sort((a, b) => a.at - b.at);

  const productFound = hits.length > 0;
  if (hits.length === 1) {
    const h = hits[0];
    if (qty > 0) {
      memory.cart[h.product] = qty;
      memory.needsQtySelection = false;
    } else if (!memory.cart[h.product]) {
      // 🔴 في صفحات الحد الأدنى (مثل أجبان الرياض): ممنوع افتراض 1 كيلو تلقائياً عند ذكر كلمة "جبنة" بدون كمية!
      if (minQty > 1) {
        memory.needsQtySelection = true;
      } else {
        memory.cart[h.product] = 1;
      }
    }
  } else if (hits.length > 1) {
    let prevEnd = 0;
    const seen = new Set();
    for (const h of hits) {
      if (seen.has(h.product)) { prevEnd = h.end; continue; }
      seen.add(h.product);
      const segment = text.slice(prevEnd, h.at);
      const segQty = extractQty(segment, pageConfig);
      if (segQty > 0) {
        if (minQty <= 1 || segQty >= minQty) memory.cart[h.product] = segQty;
      } else if (!memory.cart[h.product]) {
        if (minQty > 1) memory.needsQtySelection = true;
        else memory.cart[h.product] = 1;
      }
      prevEnd = h.end;
    }
  }

  // ذكر كمية بدون صنف: إذا السلة فيها صنف واحد أو الصفحة أصلاً بمنتج وحيد (مثل أجبان الرياض)
  if (qty > 0 && !productFound) {
    const keys = Object.keys(memory.cart);
    const pageProducts = Object.keys(pageConfig.PRICES || {});
    if (keys.length === 1) {
      memory.cart[keys[0]] = qty;
      memory.needsQtySelection = false;
    } else if (keys.length === 0 && pageProducts.length === 1 && (minQty <= 1 || qty >= minQty)) {
      memory.cart[pageProducts[0]] = qty;
      memory.needsQtySelection = false;
    }
  }

  if (JSON.stringify(memory.cart) !== cartBefore && Object.keys(memory.cart).length) {
    recordSource(memory, "order", { ...memory.cart }, sourceMid);
  }

  extractArea(memory, text, sourceMid);
  return memory;
}
