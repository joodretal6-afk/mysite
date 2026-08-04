// ═══════════════════════════════════════════════════════════
// قاعدة بيانات بسيطة مبنية على ملفات JSON (بدون أي اعتماديات)
// كل تغيير يُحفظ فوراً على القرص — تغيّر سعراً → يتغيّر رد البوت مباشرةً.
// ═══════════════════════════════════════════════════════════
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

function file(name) { return path.join(DATA_DIR, name + ".json"); }
function read(name, def) {
  try { return JSON.parse(fs.readFileSync(file(name), "utf8")); }
  catch { return def; }
}
function write(name, data) {
  fs.writeFileSync(file(name), JSON.stringify(data, null, 2));
  return data;
}

// ── القيم الافتراضية (تُزرع أول تشغيل، وتبقى قابلة للتعديل من اللوحة) ──
const DEFAULT_PRODUCTS = [
  { id: 1, name: "جبنة نابلسية غنم بلدية", type: "غنم", price: 15, unit: "نصية (4 كيلو)", note: "مغلية، بلدية، الأكثر طلباً" },
  { id: 2, name: "جبنة نابلسية بقر", type: "بقر", price: 8, unit: "كيلو", note: "طرية، ممتازة للتحلية والقلي" },
  { id: 3, name: "جبنة ملوكية", type: "غنم", price: 15, unit: "نصية", note: "بالمحلب والمستكة" },
  { id: 4, name: "جبنة مشمولة", type: "غنم", price: 16, unit: "نصية", note: "نكهة غنية" },
  { id: 5, name: "لبنة بلدية", type: "لبنة", price: 5, unit: "كيلو", note: "لبنة مدحبرة بزيت الزيتون" },
  { id: 6, name: "حلوم", type: "حلوم", price: 6, unit: "كيلو", note: "ممتاز للشوي والقلي" },
  { id: 7, name: "عكاوي", type: "عكاوي", price: 6, unit: "كيلو", note: "مالحة قليلاً، للكنافة والفطور" }
];

const DEFAULT_FAQS = [
  { id: 1, q: "قديش وزن النصية؟", a: "النصية وزنها 4 كيلو صافي." },
  { id: 2, q: "نسبة الملح؟", a: "نسبة الملح عنا خفيفة ومعتدلة، مضبوطة بحيث تكون لذيذة ومش مالحة زيادة." },
  { id: 3, q: "كيف أخزّن الجبنة؟", a: "بالثلاجة بتدوم أسابيع، وبالفريزر بتدوم لسنة كاملة بدون ما تتأثر — بس نزّليها الثلاجة قبل الاستعمال بيوم." },
  { id: 4, q: "الجبنة بتذوب؟", a: "جبنتنا البلدية المغلية ما بتذوب ولا بتفرّط، بتضل متماسكة حتى بعد القلي." },
  { id: 5, q: "التوصيل لوين؟", a: "منوصّل لكل محافظات المملكة، والتوصيل مجاني." }
];

const DEFAULT_SETTINGS = {
  brand: "شيخ الجبنة",
  tagline: "خبير الأجبان النابلسية 🧀",
  // مزوّد الذكاء ومفتاحه (يُضبط من صفحة الإعدادات)
  provider: "gemini",                 // gemini | openai
  apiKey: "",                         // 🔑 حط مفتاحك هنا
  model: "gemini-flash-latest",       // gemini: gemini-flash-latest | openai: gpt-4o-mini
  // معلومات المتجر (تدخل بمعرفة البوت)
  delivery: "التوصيل مجاني لكل محافظات المملكة، والوصول خلال يوم إلى يومين.",
  weight: "النصية 4 كيلو صافي.",
  salt: "نسبة الملح خفيفة ومعتدلة.",
  storage: "بالثلاجة تدوم أسابيع، وبالفريزر تدوم سنة كاملة.",
  hours: "متوفرون للطلب من 9 صباحاً حتى 10 مساءً.",
  phone: "",
  extraKnowledge: "",                 // أي معلومات إضافية تكتبها الإدارة
  adminPass: process.env.ADMIN_PASS || "admin123"
};

// ── واجهة القراءة/الكتابة ──
export const store = {
  products: () => read("products", null) || write("products", DEFAULT_PRODUCTS),
  saveProducts: (p) => write("products", p),
  faqs: () => read("faqs", null) || write("faqs", DEFAULT_FAQS),
  saveFaqs: (f) => write("faqs", f),
  orders: () => read("orders", []),
  saveOrders: (o) => write("orders", o),
  settings: () => ({ ...DEFAULT_SETTINGS, ...(read("settings", null) || {}) }),
  saveSettings: (s) => write("settings", { ...store.settings(), ...s }),
};

export function nextId(arr) {
  return arr.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
}
