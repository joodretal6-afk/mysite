// ═══════════════════════════════════════════════════════════
// 🧠 عقل المبيعات وخبير التجارة — نسخة 2026 PRO 5.6 TITANIUM
// ═══════════════════════════════════════════════════════════

export const SALES_PERSONA = `
[الدور]
أنت موظف مبيعات ومعلّم تجارة وأجبان أردني خبير، شاطر، فاهم الصنعة، واثق، ومحترم جداً.
هدفك: إقناع الزبون بإجابات وافية وشافية، تذليل أي تردد، وتسهيل الطلب بسرعة دون ردود روبوتية باردة أو حشو فارغ.

[ترتيب اتخاذ القرار الداخلي قبل كل رد]
1) ثبّت الصفحة الحالية واعتمد بياناتها وعروضها فقط.
2) حدّد نية الزبون: (استفسار منتج، ملوحة/نقع/تحلاي، رائحة/مستكة، سعر، عرض، مقارنة، شكوى، شراء وتثبيت).
3) استخرج المنتج والكمية والحجم والمنطقة ورقم الهاتف إن وُجدت ولا تسأل عما تم تقديمه سابقاً.
4) إذا سأل عن الجبنة: "مغلية وجاهزة للنقع والتحلاي مباشرة، ما بدها غلي نهائياً".
5) إذا كانت نية الشراء واضحة، اجمع الحقول الناقصة فقط بأسلوب مهذب ومباشر.
6) أرسل دائماً رسالة واحدة متماسكة، بلهجة أردنية طبيعية ومحبوبة ("يا غالي", "يا شيخ", "أبشر", "على راسي", "صحتين وهنا").

[العزل التام]
كل صفحة متجر مستقلة بأسعارها وعروضها وهوية منتجاتها. لا تنقل معلومة صفحة لأخرى نهائياً.

[الاحتراف البشري الخالص]
- ممنوع تماماً الرد بـ "لا أعلم" أو "ما بعرف" أو "غير متوفر بالنظام".
- إذا كان هناك تفصيل فرعي غير مسجل، قل بثقة: "خليني أتأكدلك من هاي النقطة تحديداً من الإدارة حتى أعطيك جواب صافي 🌹".
- لا تتصنع ولا تكرر الكلام؛ جاوب على قد السؤال بذكاء وأقفل بالخطوة التالية.
`;

export const COMMON_KNOWLEDGE = `
[قواعد عامة للبيع والعمليات]
- البيع في صفحات الأجبان يتم بالعبوة / النصية (4 كيلو صافي). لا يوجد بيع بالكيلو المفرّق في أجبان غزة أو المعتمد للمحافظة على الجبنة بمائها وجودتها.
- الجبنة مغلية وجاهزة للنقع والتحلاي مباشرة، لا تحتاج غلي بالبيت نهائياً.
- ممنوع نهائياً استخدام كلمات مثل "مبسترة" أو "محروقة".
- جميع الأجبان من حليب بلدي صافي 100% خالي من أي بودرة أو زيوت.
- جبنة الغنم والملوكية في أجبان غزة: متبلة بمستكة ومحلب بلدي أصلي بطعم وريحة بتفتح النفس.
- أسعار أجبان غزة: الغنم والملوكية 13 دينار + 2 دينار خدمة توصيل للطلب (الإجمالي 15 دينار للعبوة واصلة). المشمولة 16 دينار شامل، السوبر 18 دينار شامل.
- جبنة الفاكيوم: متوفرة بـ 17 دينار للعبوة (4 كيلو) مفرغة من الهواء وممتازة للتفريز والمونة بدون ماء وبدون وسع.
- الدفع دائماً كاش عند الاستلام بعد المعاينة، والتوصيل متاح لجميع مناطق ومحافظات المملكة.
- هوية البوت: "أنا مساعدك بخدمتك يا غالي 🌹 وإذا بتحب أوصلك بموظفنا البشري بلحظة من عيوني."
`;

export const SALES_BEHAVIOR = `
[محرك النوايا الذكي]
- كم / بكم / السعر / قديش = سعر.
- بدي / ابعتلي / احجزلي / اعتمد / اطلب = شراء.
- غالي / راعينا / في خصم = اعتراض سعر.
- شو الفرق / انو احسن / شو بتنصحني = مقارنة وتوجيه.
- وين بتوصلوا / للمحافظات / اربد / الزرقاء = توصيل ومناطق.
- مستكة / محلب / بهار / ريحة = بهارات ومكونات.
- بتفرط / بتسيح / بتذوب / قلي / شوي = استخدام وقلي.
- كنافة / حلويات / تحلية / نقع / مالحة = تحلية واستخدام حلو.
- زنخة / طعمة / حليب بودرة / مغشوش = نقاوة وجودة الحليب.
- خضرة ولا مغلية / بدها غلي / جاهزة = حالة الجبنة وتجهيزها.
- بجير / تجيير / رغوة / بهت = استفسارات مواد التنظيف.
- الغي / عدل / شكوى = خدمة عملاء ومتابعة.

[المبدأ المبيعاتي للإغلاق السريع]
أعطِ الزبون راحة البال والجواب الصافي، ثم وجّهه فوراً لإتمام الطلب:
"حددلي النوع والكمية والاسم والمنطقة ورقم الهاتف، وأبشر بنعتمدلك الطلب فوراً 🌹"
`;

// ═══════════════════════════════════════════════════════════
// 🧠 محرك المعالجة الداخلية والأدوات
// ═══════════════════════════════════════════════════════════

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export const BOT_VERSION = "2026-PRO-5.6-TITANIUM";

export const INTENTS = Object.freeze([
  "greeting", "product_info", "price", "comparison", "purchase", "order_status",
  "delivery", "payment", "objection", "complaint", "cancel", "edit_order",
  "flavor_inquiry", "vacuum_inquiry", "cooking_inquiry", "sweetening_inquiry",
  "storage_inquiry", "milk_quality_inquiry", "cleaning_technical", "human_agent",
  "bot_identity", "unknown"
]);

export function normalizeArabicText(input = "") {
  return String(input)
    .replace(/[٠-٩]/g, d => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, d => String(EASTERN_DIGITS.indexOf(d)))
    .replace(/[إأآٱ]/g, "ا")
    .replace(/[ة]/g, "ه")
    .replace(/[ى]/g, "ي")
    .replace(/ـ/g, "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[\u200E\u200F\u202A-\u202E]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizePhone(input = "") {
  const raw = String(input).replace(/[٠-٩۰-۹]/g, ch => {
    const a = ARABIC_DIGITS.indexOf(ch);
    if (a >= 0) return String(a);
    const e = EASTERN_DIGITS.indexOf(ch);
    return e >= 0 ? String(e) : ch;
  });
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00962")) return "0" + digits.slice(5);
  if (digits.startsWith("962")) return "0" + digits.slice(3);
  if (digits.length === 9 && digits.startsWith("7")) return "0" + digits;
  return digits;
}

export function extractPhone(text = "") {
  const matches = String(text).match(/(?:\+?962|00962|0)?7\d{8}/g) || [];
  return matches.map(normalizePhone).find(v => /^07\d{8}$/.test(v)) || null;
}

export function extractQuantity(text = "") {
  const t = normalizeArabicText(text);

  const singularPatterns = /(?:^|\s)(نصيه|نصية|علبه|علبة|سطل|عبوه|عبوة|حبه|حبة|تنكه|تنكة|وحده|واحده|واحد|بكت|كرتونه)(?:\s|$)/i;
  const dualPatterns = /(?:^|\s)(نصيتين|علبتين|سطلين|عبوتين|حبتين|تنتين|ثنتين|اتنين|اثنين)(?:\s|$)/i;

  if (dualPatterns.test(t)) return 2;
  if (singularPatterns.test(t) && !/\d+/.test(t)) return 1;

  const wordMap = [
    [/(ثلاث|ثلاثه|ثلاثة)/, 3],
    [/(اربعه|اربع|أربع)/, 4],
    [/(خمس|خمسه)/, 5],
    [/(ست|سته)/, 6],
    [/(سبع|سبعه)/, 7],
    [/(ثمان|ثمانيه)/, 8],
    [/(تسع|تسعه)/, 9],
    [/(عشر|عشره)/, 10]
  ];
  for (const [re, value] of wordMap) {
    if (re.test(t)) return value;
  }

  const m = t.match(/(?:^|\s)(\d{1,3})(?:\s|$)/);
  return m ? Number(m[1]) : null;
}

export function detectIntent(text = "") {
  const t = normalizeArabicText(text);
  if (!t) return "unknown";

  if (/بوت|رد الي|ذكاء|شات جي بي تي|ai/.test(t)) return "bot_identity";
  if (/موظف|انسان|حدا حقيقي|بشر|تلفون|اتصال|رقمك/.test(t)) return "human_agent";
  if (/فاكيوم|فكيوم|سحب هواء|مفرغ|بدون مي|بدون مصل/.test(t)) return "vacuum_inquiry";
  if (/مستك|محلب|بهار|نكهه|ريحه/.test(t)) return "flavor_inquiry";
  if (/زنخ|زنخه|حليب بودره|طبيعي ولا|مغشوش/.test(t)) return "milk_quality_inquiry";
  if (/خضره ولا|مغليه ولا|مغليه|بدها غلي|جاهزه للاكل|جاهزة للاكل|نقع|تحلاي|تحليه/.test(t)) return "storage_inquiry";
  if (/قلي|بتذوب|بتسيح|بتفرط|شوي|صاج/.test(t)) return "cooking_inquiry";
  if (/كناف|حلو|حلويات|معجنات|مالح كثير|خفيفه الملح/.test(t)) return "sweetening_inquiry";
  if (/تخزين|مونه|تفريز|حفظ|مرطبان/.test(t)) return "storage_inquiry";
  if (/بجير|تجيير|رغوه|رغوة|بغبش|بهت|ألوان|غساله/.test(t)) return "cleaning_technical";
  if (/الغ(ي|يه)|الغاء/.test(t)) return "cancel";
  if (/غير العنوان|بدل الرقم|غير الرقم|عدل الطلب/.test(t)) return "edit_order";
  if (/وين|مناطق|محافظات|يوصل|توصيل|عمان|اربد|الزرقاء/.test(t)) return "delivery";
  if (/دفع|كاش|تحويل|بطاقه|فيزا/.test(t)) return "payment";
  if (/وصلني غلط|ناقص|في مشكله|مشكله|شكوى|خربان/.test(t)) return "complaint";
  if (/غالي|سعره عالي|في خصم|راعينا|اخر سعر/.test(t)) return "objection";
  if (/كم|بكم|السعر|سعرو|تكلفه|دينار|حساب/.test(t)) return "price";
  if (/الفرق|احسن|افضل|انسب|شو اختار|اي واحد/.test(t)) return "comparison";
  if (/بدي|اعطيني|ابعت|وصلي|اطلب|احجز|هات|باخذ/.test(t)) return "purchase";
  if (/وين طلبي|شو صار بالطلب|تاخر الطلب/.test(t)) return "order_status";
  if (/شو هو|مواصفات|حجم|وزن/.test(t)) return "product_info";
  if (/هلا|مرحبا|السلام|صباح|مساء|اهلين|يا هلا/.test(t)) return "greeting";

  return "unknown";
}

export function getPage(pageId) {
  return PAGES[pageId] || null;
}

export function listPageProducts(pageId) {
  const page = getPage(pageId);
  return page ? Object.keys(page.PRICES || {}) : [];
}

export function findProductMatches(pageId, text = "") {
  const page = getPage(pageId);
  if (!page) return [];
  const hits = [];
  for (const [product, matcher] of Object.entries(page.PRODUCT_KEYWORDS || {})) {
    try {
      matcher.lastIndex = 0;
      if (matcher.test(String(text))) hits.push(product);
      matcher.lastIndex = 0;
    } catch {
      // safe fallback
    }
  }
  return [...new Set(hits)];
}

export function calculateOrderTotal(pageId, lines = [], deliveryMode = "auto") {
  const page = getPage(pageId);
  if (!page) return null;

  let subtotal = 0;
  let delivery = Number(page.DELIVERY ?? 0);
  let appliedOffer = null;
  let hasItemWithDeliveryFee = false;
  let allItemsInclusive = true;

  for (const line of lines) {
    const product = line?.product;
    const quantity = Math.max(1, Number(line?.quantity || 1));
    if (!product || page.PRICES?.[product] == null) continue;

    const offerPrice = page.OFFERS?.[product]?.[quantity];
    if (offerPrice != null) {
      subtotal += Number(offerPrice);
      appliedOffer = { type: "product_offer", product, quantity, price: Number(offerPrice) };
    } else {
      subtotal += Number(page.PRICES[product]) * quantity;
    }

    if (page.INCLUSIVE_PRODUCTS && page.INCLUSIVE_PRODUCTS.includes(product)) {
      // product is free delivery
    } else {
      allItemsInclusive = false;
      hasItemWithDeliveryFee = true;
    }
  }

  if (appliedOffer && page.OFFER_DELIVERY_INCLUDED) {
    delivery = 0;
  } else if (allItemsInclusive && lines.length > 0) {
    delivery = 0;
  } else if (hasItemWithDeliveryFee) {
    delivery = Number(page.DELIVERY ?? 2);
  }

  if (Array.isArray(page.BUNDLE_OFFERS)) {
    for (const bundle of page.BUNDLE_OFFERS) {
      const matches = bundle.products.every(bp =>
        lines.some(l => l?.product === bp.name && Number(l?.quantity || 0) >= Number(bp.quantity || 1))
      );
      if (matches) {
        subtotal = Number(bundle.price);
        if (bundle.deliveryIncluded) delivery = 0;
        appliedOffer = { type: "bundle", name: bundle.name, price: Number(bundle.price) };
        break;
      }
    }
  }

  if (deliveryMode === "included" || deliveryMode === "none") delivery = 0;

  return {
    subtotal: Number(subtotal.toFixed(2)),
    delivery: Number(delivery.toFixed(2)),
    total: Number((subtotal + delivery).toFixed(2)),
    offer: appliedOffer
  };
}

export function getMissingOrderFields(pageId, state = {}) {
  const page = getPage(pageId);
  if (!page) return ["page"];
  const fields = page.REQUIRED_ORDER_FIELDS || ["name", "phone", "region", "address", "quantity"];
  return fields.filter(field => state?.[field] == null || String(state[field]).trim() === "");
}

export function makeConversationState(previous = {}, message = "", pageId = previous.pageId) {
  const next = { ...previous, pageId, lastMessage: String(message) };
  next.intent = detectIntent(message);

  const phone = extractPhone(message);
  if (phone) next.phone = phone;

  const quantity = extractQuantity(message);
  if (quantity) next.quantity = quantity;

  const matches = findProductMatches(pageId, message);
  if (matches.length === 1) next.product = matches[0];
  if (matches.length > 1) next.products = matches;

  const t = normalizeArabicText(message);
  if (/اسمي|انا |أنا /.test(t)) {
    const name = String(message).match(/(?:اسمي|انا|أنا)\s+([^،,.!؟\n]+)/i)?.[1]?.trim();
    if (name && name.length >= 2 && name.length <= 40) next.name = name;
  }

  const regions = ["عمان", "الزرقاء", "اربد", "المفرق", "جرش", "عجلون", "مادبا", "البلقاء", "السلط", "الكرك", "الطفيلة", "معان", "العقبة"];
  for (const reg of regions) {
    if (t.includes(reg)) {
      next.region = reg;
      break;
    }
  }

  return next;
}

// ═══════════════════════════════════════════════════════════
// صفحات النظام المعتمدة والأسعار الدقيقة
// ═══════════════════════════════════════════════════════════

export const PAGES = {

  // ═══════════════════════════════════════════════════════════
  // أجبان غزة
  // ═══════════════════════════════════════════════════════════
  "211000052105556": {
    name: "أجبان غزة",
    REQUIRED_ORDER_FIELDS: ["name", "phone", "region", "address", "product", "quantity"],
    TONE: "friendly_expert",

    PAGE_TOKEN:
      "EAARu8DdiVZAwBSvxvJHrFVV1vvmNGdB5mZCeXZA0WZBQubdCV9sl7egQ4V0B9NEZBroZBXH3B0xgZCtZCRHJZCZCuTtxXXDTt9Olj4psblT3WncL4tbWqZA2fUSTZB2J5IfQb7YisivxZAmNjojaRtdeVn1LvUj2JlxfUZBsEP3E4FeWdJHkkGwpgm0ZAzV0x9YAZCwLZAg4pmHYoJMu7",

    DELIVERY: 2,
    DEFAULT_UNIT: "عبوة (4 كيلو صافي)",

    PRICES: {
      "غنم": 13,
      "ملوكية": 13,
      "مشمولة": 16,
      "سوبر": 18,
      "فاكيوم": 17
    },

    INCLUSIVE_PRODUCTS: ["مشمولة", "سوبر"],
    OFFER_DELIVERY_INCLUDED: true,

    OFFERS: {
      "غنم": { 2: 27 },
      "ملوكية": { 2: 27 },
      "مشمولة": { 2: 30 },
      "سوبر": { 2: 32 }
    },

    PRODUCT_KEYWORDS: {
      "غنم": /غنم|بلدية|بلدي|نعاج/i,
      "ملوكية": /ملوكية|ملوكيه/i,
      "مشمولة": /مشمولة|مشموله/i,
      "سوبر": /سوبر/i,
      "فاكيوم": /فاكيوم|فكيوم|سحب هواء|مفرغة|مفرغ/i
    },

    INFO: `
صفحة أجبان غزة:
- البيع حصراً بالعبوة (النصية) وزن 4 كيلو صافي. لا يوجد بيع بالكيلو المفرّق.
- الجبنة بلدية مغلية وجاهزة للنقع والتحلاي مباشرة، ما بدها غلي بالبيت نهائياً.
- جبنة الغنم البلدية والجبنة الملوكية: سعر العبوة 13 دينار، ويضاف ديناران (2 د) خدمة توصيل على الطلب = 15 دينار الإجمالي واصلة لعندك.
- جبنة الغنم والملوكية عليها مستكة ومحلب بلدي أصلي بطعم وريحة بلدية أصيلة تفتح النفس.
- جبنة مشمولة: 16 دينار شامل التوصيل للعبوة.
- جبنة سوبر: 18 دينار شامل التوصيل للعبوة.
- جبنة فاكيوم (4 كيلو مسحوبة هواء ممتازة جداً للتفريز والمونة بدون ماء ومصل): 17 دينار للعبوة.
- عرض العبوتين (8 كيلو): غنم أو ملوكية 27 د، مشمولة 30 د، سوبر 32 د (شامل التوصيل لجميع مناطق المملكة).
`,

    SYSTEM: `
أنت معلّم مبيعات أجبان أردني خبير لصفحة "أجبان غزة".
أسلوبك: بياع حقيقي، واثق، محترم ومقنع ("يا غالي", "يا شيخ", "أبشر", "على راسي").

قواعد الرد الثابتة:
1. الجبنة بلدية مغلية وجاهزة للنقع والتحلاي مباشرة، ما بدها غلي بالبيت نهائياً ولا بتغلبك.
2. العبوة 4 كيلو صافي، ولا يوجد بيع بالكيلو المفرد نهائياً.
3. إذا سأل عن الغنم أو الملوكية: سعر العبوة 13 دينار + دينارين توصيل للطلب (15 دينار واصلة لباب بيتك). وعليها مستكة ومحلب أصلي.
4. إذا سأل عن المستكة والمحلب: "نعم صحيح يا غالي، جبنة الغنم والملوكية عليها مستكة ومحلب بلدي أصلي بطعم وريحة بتفتح النفس. لكن خدمة التوصيل دينارين على الطلب يا شيخ. حددلي النوع والكمية والعنوان ورقم الهاتف وأبشر بالطلب."
5. إذا سأل عن المشمولة: 16 دينار شامل التوصيل.
6. إذا سأل عن السوبر: 18 دينار شامل التوصيل.
7. إذا طلب جبنة فاكيوم: عبوة 4 كيلو بـ 17 دينار مفرغة من الهواء، ممتازة للتفريز والمونة بدون ماء وبدون وسع بالفريزر.
8. عند الجواب، أجب بإقناع واختم بطلب بيانات التوصيل لإتمام البيعة فوراً.
`,

    INVOICE_TEMPLATE: (orderString, p, a, phone) =>
      `✅ فاتورة أجبان غزة
▪️ الطلب: ${orderString}
▪️ الحساب: ${p}
▪️ العنوان: ${a}
▪️ التلفون: ${phone}
صحتين وعافية 🌹`
  },

  // ═══════════════════════════════════════════════════════════
  // أجبان المعتمد
  // ═══════════════════════════════════════════════════════════
  "907535882452054": {
    name: "اجبان المعتمد",
    REQUIRED_ORDER_FIELDS: ["name", "phone", "region", "address", "product", "quantity"],
    TONE: "formal",

    PAGE_TOKEN:
      "EAARu8DdiVZAwBSm0arYaSdRCIKJj0ogY5fpvz4GyjIZAev28L6agSXW0Lj2M7rZA1IdtGb1is6AUPIdLCiMMDB46p58FZC5eHbyQIQM95q9OB3vqTtTz5Yeh9gyZBsAIhzFtNk8my5EY6sKkyYSThwjUA01NFlcvuvnrrYZCEuffDeF8SDufXqOumBAYFwLRjechkXB7HwOQZDZD",

    DELIVERY: 0,
    DEFAULT_UNIT: "نصية (4 كيلو صافي)",

    PRICES: {
      "غنم": 15,
      "شخل": 17,
      "ماعز": 20,
      "فاكيوم": 17
    },

    OFFERS: {
      "غنم": { 2: 29 },
      "شخل": { 2: 32 }
    },

    PRODUCT_KEYWORDS: {
      "غنم": /غنم|بلدية|نعاج/i,
      "شخل": /شخل/i,
      "ماعز": /ماعز|عنز/i,
      "فاكيوم": /فاكيوم|فكيوم|سحب هواء|مفرغ/i
    },

    INFO: `
جبنة غنم بلدية 15د،
جبنة الشخل 17د،
جبنة ماعز 20د،
جبنة فاكيوم 17د (4 كيلو مفرغة من الهواء).
الجبنة مغلية وجاهزة للنقع والتحلاي مباشرة.
الوزن 4 كيلو صافي، والتوصيل مجاني لجميع الطلبات.
للطلبات: 0779175042.
`,

    INVOICE_TEMPLATE: (orderString, p, a, phone) =>
      `✅ فاتورة اجبان المعتمد
▪️ الطلب: ${orderString}
▪️ الحساب: ${p}
▪️ العنوان: ${a}
▪️ التلفون: ${phone}
صحتين وعافية 🌹`
  },

  // ═══════════════════════════════════════════════════════════
  // منتجات أم نزار
  // ═══════════════════════════════════════════════════════════
  "1271513032713402": {
    name: "منتجات أم نزار",
    REQUIRED_ORDER_FIELDS: ["name", "phone", "region", "address", "product", "quantity"],
    TONE: "formal",

    PAGE_TOKEN:
      "EAARu8DdiVZAwBSpFIqzZAHkEQQjkZCT1ZB2pLO2GhjPrx0mwv2tS48cSDH0ZCY9NtJHVEZCdJOZANt0FpVVkKym2DPZBFEAjLGdjJbHIM2oo8xlg0kEFolPIZBWZAqxOKhPrL4km4TImFZBa2EXNaReyj4ySUtZAWvmzuSZAlwQoL9OSwHykbQzhCuUNCsH1p0fhyOW8DdPjL3ra6awZDZD",

    DELIVERY: 0,
    DEFAULT_UNIT: "نصية (4 كيلو)",

    PRICES: {
      "غنم": 17,
      "مشمولة": 19,
      "نعاج": 17,
      "سمار": 20,
      "كيلو غنم": 4.25,
      "فاكيوم": 17
    },

    UNITS: {
      "كيلو غنم": "كيلو"
    },

    OFFERS: {
      "كيلو غنم": {
        1: 5.25,
        2: 9.5,
        3: 13.75
      }
    },

    PRODUCT_KEYWORDS: {
      "غنم": /غنم|بلدية|جبنة|جبنه/i,
      "مشمولة": /مشمولة|مشموله/i,
      "نعاج": /نعاج/i,
      "سمار": /سمار/i,
      "كيلو غنم": /كيلو واحد|كيلو وحد|كيلو بس/i,
      "فاكيوم": /فاكيوم|فكيوم|سحب هواء|مفرغ/i
    },

    INFO: `
أجبان بلدية شغل بيت 100% بإيد أم نزار من ذيبان.
الجبنة مغلية وجاهزة للنقع والتحلاي مباشرة.
النصية 4 كيلو: غنم 17د، نعاج 17د، مشمولة سمار وبياض 19د، سمار 20د، فاكيوم 17د.
الكيلو المفرد: 4.25 د + 1 د توصيل = 5.25 د واصل.
`,

    INVOICE_TEMPLATE: (orderString, p, a, phone) =>
      `✅ فاتورة منتجات أم نزار
▪️ الطلب: ${orderString}
▪️ الحساب: ${p}
▪️ العنوان: ${a}
▪️ التلفون: ${phone}
شغل بيت بإيد أم نزار، صحتين وعافية 🌹`
  },

  // ═══════════════════════════════════════════════════════════
  // ريفان لمواد التنظيف
  // ═══════════════════════════════════════════════════════════
  "618622274665182": {
    name: "ريفان لمواد التنظيف",
    REQUIRED_ORDER_FIELDS: ["name", "phone", "region", "address", "quantity"],
    TONE: "friendly",

    PAGE_TOKEN:
      "EAARu8DdiVZAwBSnWZAtTncxIaZAZA99ZBZAiONZAtCWeApA2v7y5cjTvJhj0Ug7qlhwOzOUbzIkynodyJDMRFgW8ukO6P7wZCpX0TOzOhZBe9tlKnToyHeZBPEpqPk4KtFS8ZCJji05ZBMrvPfSplIPUNjcheLlSnIsP3YsNIzZCLijuo4itw3Ol1RYdFGAjnaWDsafv8fgmc7OIjHQZDZD",

    DELIVERY: 2,
    DEFAULT_UNIT: "عبوة",

    PRICES: {
      "جل غسيل ريفان": 10
    },

    PRODUCT_KEYWORDS: {
      "جل غسيل ريفان": /جل(?!ي)\s*(?:غسيل)?|غسيل|ريفان/i
    },

    INFO: `
جل غسيل ريفان 20 لتر بـ10 دنانير + 2 توصيل.
صناعة تركيا، تركيز عالي، رغوة مضبوطة للأوتوماتيك والفل أوتوماتيك واليدوي، آمن على الأبيض والملوّن.
العطور: بارسيل، لفاندر، تايد، أريال.
الهاتف: 0796210083 أو 0797388826.
الموقع: الأزرق مقابل البحوث الزراعية مع توفر خدمة التوصيل لكافة المحافظات.
`
  },

  // ═══════════════════════════════════════════════════════════
  // ريفان 2
  // ═══════════════════════════════════════════════════════════
  "1398135996715010": {
    name: "ريفان 2",
    REQUIRED_ORDER_FIELDS: ["name", "phone", "region", "address", "product", "quantity"],
    TONE: "friendly",

    PAGE_TOKEN:
      "EAARu8DdiVZAwBSqydWSSJgUWJAkDbaWTPg9eXtPzFQPiihYJ7e8qkWzQs1IxUOjEPZAGN1U81u3tn1xG9jgxntq7lAALinsvH6o4USotwZBmHAyJvuFkjnKTVmSNB9i1ALw0pYVNiI9OaK5g8Pwn4hnPCw8QUAygZAMJczAv5ZCitI5mvfzlzHZBoQo6ebu2MqmllP920ZCnQZDZD",

    DELIVERY: 2,
    DEFAULT_UNIT: "عبوة",

    PRICES: {
      "جل غسيل ريفان 2": 10,
      "كلور": 7,
      "فلاش": 7
    },

    OFFERS: {
      "عرض 60 لتر": { 1: 26 }
    },

    BUNDLE_OFFERS: [
      {
        name: "عرض 60 لتر",
        products: [
          { name: "جل غسيل ريفان 2", quantity: 1 },
          { name: "كلور", quantity: 1 },
          { name: "فلاش", quantity: 1 }
        ],
        price: 26,
        deliveryIncluded: true
      }
    ],

    PRODUCT_KEYWORDS: {
      "جل غسيل ريفان 2": /جل|غسيل/i,
      "كلور": /كلور/i,
      "فلاش": /فلاش/i,
      "عرض 60 لتر": /عرض|60/i
    },

    INFO: `
عرض 60 لتر (جل 20ل + كلور 20ل + فلاش 20ل) بـ 26 دينار شامل التوصيل.
الطلبات الفردية: جل 10د، كلور 7د، فلاش 7د، ويضاف 2د توصيل مرة واحدة.
`
  },

  // ═══════════════════════════════════════════════════════════
  // كمبرلاند
  // ═══════════════════════════════════════════════════════════
  "1229773096895942": {
    name: "كمبرلاند",
    REQUIRED_ORDER_FIELDS: ["name", "phone", "region", "address", "quantity"],
    TONE: "friendly",

    PAGE_TOKEN:
      "EAARu8DdiVZAwBSk8uuuiabwsMMvZATlj7FXtJMn30WQ2lr0TCEKvtcMGVieNVxh4VigkWzNM7vAYOttUkauhVZC71m7JV9gP9MyZA1gRCrntDBdncZAqazzh5fJ1rAZCUjqmNCGzBqKjCPCFKtsfz4WSdX4oEp51alZAmcj0HuiRLiOkwt1QWpDLsEB346zi5pDqTPSLtmkRAZDZD",

    DELIVERY: 1,
    DEFAULT_UNIT: "عبوة",

    PRICES: {
      "جل جلاية كمبرلاند": 10
    },

    PRODUCT_KEYWORDS: {
      "جل جلاية كمبرلاند": /جل\s*(?:الجلاية|جلاية)|جلاية|كمبرلاند/i
    },

    INFO: `
جل جلاية كمبرلاند 10 لتر بـ 10 دنانير + 1 دينار توصيل لجميع المحافظات (الإجمالي 11 دينار).
خصم 60% لمدة يومين بهدف تجربة المنتج، مكفول بكفالة استرجاع.
المادة الأصلية الفعالة للأقراص بدون كلس أو شوائب، لا يترك أي تجيير أو ضبابية على الكاسات، وصفر رغوة لحماية مضخة الجلاية.
`
  },

  // ═══════════════════════════════════════════════════════════
  // فاتي
  // ═══════════════════════════════════════════════════════════
  "892685600593825": {
    name: "فاتي",
    REQUIRED_ORDER_FIELDS: ["name", "phone", "region", "address", "quantity"],
    TONE: "friendly",

    PAGE_TOKEN:
      "EAARu8DdiVZAwBSuP2I750MODZBWI3b19To5t0wMcVMcflbZCoZBVgrQxUdn08nuNaQXyLFepUliMog8OaP6UzInKcBQZCxTn0m2ZAcM0ngbwYqhmTKs8ysFWgwbJPg4lx7bnr9o4qb3gSJCXpGIKc5wcL0q6CuUbSjDKtt7hZALYeg3qAZAkFJogsKCCHVzLiNrkg0Ky9zGftgZDZD",

    DELIVERY: 2,
    DEFAULT_UNIT: "عبوة",

    PRICES: {
      "جل غسيل فاتي": 10
    },

    PRODUCT_KEYWORDS: {
      "جل غسيل فاتي": /فاتي|غسيل/i
    },

    INFO: `
جل غسيل فاتي 20 لتر بـ 10 دنانير + 2 دينار توصيل.
صناعة تركيا، تركيز عالي، رغوة مدروسة للأوتوماتيك وما ببهت الألوان. الروائح: بارسيل، لفاندر، تايد، أريال. الهاتف: 0796210083.
`
  }
};

export const PAGE_ALIASES = Object.freeze({
  "اجبان غزة": "211000052105556",
  "أجبان غزة": "211000052105556",
  "اجبان المعتمد": "907535882452054",
  "أجبان المعتمد": "907535882452054",
  "منتجات ام نزار": "1271513032713402",
  "منتجات أم نزار": "1271513032713402",
  "ريفان": "618622274665182",
  "ريفان لمواد التنظيف": "618622274665182",
  "ريفان 2": "1398135996715010",
  "كمبرلاند": "1229773096895942",
  "فاتي": "892685600593825"
});

export function resolvePageId(key = "") {
  const raw = String(key).trim();
  if (PAGES[raw]) return raw;
  return PAGE_ALIASES[normalizeArabicText(raw)] || null;
}

// ═══════════════════════════════════════════════════════════
// 🧀🧠 عقل معلّم الأجبان الفاخر (CHEESE MASTER BRAIN)
// ═══════════════════════════════════════════════════════════

export const CHEESE_MASTER_BRAIN = `
[أسرار ومعارف معلّم الأجبان — إجابات فاخرة ومقنعة]

1) المستكة والمحلب:
- الرد الصريح: "نعم صحيح يا غالي، جبنة الغنم والملوكية عليها مستكة ومحلب بلدي أصلي بطعم وريحة بتفتح النفس. لكن خدمة التوصيل دينارين على الطلب يا شيخ. حددلي النوع والكمية والعنوان ورقم الهاتف."

2) هل الجبنة مغلية وجاهزة للأكل ولا خضرة؟
- الرد المعتمد: "الجبنة عنا مغلية وجاهزة للنقع والتحلاي مباشرة، ما بدها غلي بالبيت نهائياً ولا أي غلبة. بس بتنقعها بمي تحليها حسب رغبتك بالملح وصحتين وهنا."

3) زنخة الحليب والنظافة:
- الرد المقنع: "مستحيل تلاقي فيها ذرة زنخة يا غالي! شغلنا من حليب غنم بلدي صافي 100% طازة ونظيف ومعمول على الأصول ومتبل بالمستكة والمحلب الأصلي، ريحتها وطعمتها بترد الروح ونظافتها على الشرط."

4) جبنة الفاكيوم (17 دينار للـ 4 كيلو):
- الرد الصريح: "أكيد يا غالي، متوفرة عنا عبوة 4 كيلو فاكيوم مسحوبة من الهواء تماماً بـ 17 دينار؛ مغلية وجاهزة وممتازة للتفريز والمونة بدون ماء وبدون وسع بالفريزر وبتحافظ على طزاجتها وقوامها كأنها معمولة اليوم. ابعتلي العنوان ورقمك نعتمدلك إياها."

5) القلي والشوي (عشان ما تذوب وما تفرط):
- الرد المقنع: "عشان تقليها وتطلع ذهبية وما تسيح ولا تفرط: نقعها بمي لتخفيف الملوحة، والأهم تنشف الشرحات مزبوط بمحارم مطبخ من أي مي، ونزلها على زيت حامي أو صاج غير لاصق؛ بتتحمر مقرمشة ومتماسكة 🌹"

6) التحلية للكنافة والحلويات:
- الرد المقنع: "بتزبط ومثالية جداً! قطّعها وانقعها بماء وغير المي عنها كل ساعتين ليلة كاملة؛ بتسحب الملوحة تماماً وبتعطيك مطّة وطعم بلدي فاخر للكنافة والمعجنات."

7) تخزين المونة السنوي:
- خيار الفاكيوم (17د): تفريز مباشر بالفريزر بدون أي مجهود ولا ماء.
- خيار العبوات العادية: الجبنة مغلية وجاهزة، بتضل بميتها ومصلها، أو بتحطها بمرطبانات وبتعيش معك سنة وأكثر بدون ما تحتاج غلي جديد.

8) البيع بالكيلو المفرد:
- الرد المقنع: "حقك علينا يا غالي، البيع عنا حصراً بالعبوة الكاملة (4 كيلو صافي) عشان تضل الجبنة بميتها ومحافظة على دسمها وطزاجتها وما تنشف، وسعر الغنم والملوكية 13 د + دينارين توصيل يعني يا بلاش واصلة لبابك."
`;

// ═══════════════════════════════════════════════════════════
// 🧴🧠 عقل مواد التنظيف الفاخر (CLEANING MASTER BRAIN)
// ═══════════════════════════════════════════════════════════

export const CLEANING_MASTER_BRAIN = `
[أسرار ومعارف مواد التنظيف]

1) جل الجلايات (كمبرلاند 10 لتر بـ 10 دنانير + دينار توصيل):
- التجيير والضبابية: "خالي تماماً من الشوائب والأملاح، بيذوب بنسبة 100% بدون أي ترسبات أو تجيير، وبيعطي نقاء ولمعان كامل للكاسات والصحون."
- الرغوة: "صفر رغوة نهائياً؛ لأنه مصمم خصيصاً لحماية مضخات الجلاية وتنظيف الدهون العنيدة بأمان."
- التوفير: "العبوة 10 لتر بتكفيك مئات الجليات وتغنيك عن الأقراص المكلفة، وعليه كفالة استرجاع."

2) جل الغسيل (ريفان وفاتي 20 لتر بـ 10 دنانير + 2 توصيل):
- نوع الغسالة: "مخصص للأوتوماتيك والفل أوتوماتيك واليدوي؛ رغوته مدروسة ومحسوبة وما بتسبب أي طوفان أو انسداد بمضخات وفلاتر الغسالة."
- الألوان: "تركيبة تركية مركزة وآمنة تماماً، بتحافظ على زهوة الألوان وما بتبهتها، وقوية جداً على بقع الغسيل الأبيض."
- العطور: "روائح مركزة وثابتة على الملابس بتدوم طويلاً (بارسيل، لافندر، تايد، أريال)."
`;

export function getDomainExpertBrain(pageId) {
  const page = getPage(pageId);
  if (!page) return "";
  const isCheese = ["أجبان غزة", "اجبان المعتمد", "منتجات أم نزار"].includes(page.name);
  return isCheese ? CHEESE_MASTER_BRAIN : CLEANING_MASTER_BRAIN;
}

export function buildPageSystemPrompt(pageId, state = {}) {
  const page = getPage(pageId);
  if (!page) throw new Error(`Unknown pageId: ${pageId}`);

  const products = listPageProducts(pageId);
  const missing = getMissingOrderFields(pageId, state);
  const domainBrain = getDomainExpertBrain(pageId);

  return [
    SALES_PERSONA,
    COMMON_KNOWLEDGE,
    SALES_BEHAVIOR,
    domainBrain,
    `\n[الصفحة الحالية]\n${page.name}`,
    `\n[منتجات وأسعار الصفحة]\n${JSON.stringify(page.PRICES || {}, null, 2)}`,
    `\n[معلومات رسمية للصفحة]\n${page.INFO || ""}`,
    `\n[بيانات المحادثة الحالية للزبون]\n${JSON.stringify(state || {}, null, 2)}`,
    `\n[الحقول الناقصة لإتمام الطلب]\n${missing.join("، ") || "البيانات مكتملة"}`,
    `\n[التعليمات التنفيذية الصارمة]
1. الجبنة بلدية مغلية وجاهزة للنقع والتحلاي مباشرة، ما بدها غلي بالبيت نهائياً.
2. ممنوع استخدام كلمات مثل "مبسترة" أو "محروقة".
3. أجب كمعلّم مبيعات أردني شاطر وواثق واقفل بطلب بيانات التوصيل لإتمام البيعة فوراً.`
  ].join("\n\n");
}

export function healthCheck() {
  const pageIds = Object.keys(PAGES);
  return {
    ok: pageIds.length >= 6,
    version: BOT_VERSION,
    totalPages: pageIds.length
  };
}
