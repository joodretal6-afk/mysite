// ═══════════════════════════════════════════════════════════
// 📚 القارئ الشامل للملفات
//
// أي ملف بتحمّله على المنصة بيمرّ من هون: كشف PDF، ملف إكسل،
// CSV مصدّر من نظام تاني، أو نص عادي. بيرجّع نفس الشكل دايماً:
//   { kind, table:{headers,rows}, sheets, pages, text }
// فأي ميزة بالمنصة بتقدر تقرأ أي ملف بلا ما تعرف نوعه.
//
// 🔴 القاعدة نفسها: منقرأ اللي بالملف. ما منكمّل ناقص من راسنا.
// ═══════════════════════════════════════════════════════════
import { pdfToText } from "./pdfText.js";

const EXT = (name) => String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";

// ═══════════════ الترميز ═══════════════
// الملفات العربية المصدّرة من أنظمة قديمة غالباً windows-1256.
// منجرّب UTF-8 أول، وإذا طلع حروف مكسورة منرجع للترميز العربي.
export function decodeText(buf) {
  const raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  // BOM صريح = UTF-8 أكيد
  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf)
    return raw.subarray(3).toString("utf8");
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(raw.subarray(2));

  const utf8 = raw.toString("utf8");
  const broken = (utf8.match(/�/g) || []).length;
  if (broken === 0) return utf8;
  try {
    const ar = new TextDecoder("windows-1256").decode(raw);
    // منختار الترميز اللي بيطلّع عربي أكثر وكسور أقل
    const arBroken = (ar.match(/�/g) || []).length;
    if (arBroken < broken) return ar;
  } catch { /* الترميز مش مدعوم بهالبيئة */ }
  return utf8;
}

// ═══════════════ CSV / TSV ═══════════════
/** يخمّن الفاصل من أول سطر: فاصلة، تاب، فاصلة منقوطة، أو | */
export function sniffDelimiter(text) {
  const line = String(text).split(/\r?\n/).find((l) => l.trim()) || "";
  const cands = [",", "\t", ";", "|"];
  let best = ",", bestN = 0;
  for (const d of cands) {
    const n = line.split(d).length - 1;
    if (n > bestN) { bestN = n; best = d; }
  }
  return best;
}

/** محلّل CSV كامل: اقتباسات، اقتباس داخل اقتباس، أسطر جوّا الخانة */
export function parseDelimited(text, delim) {
  const d = delim || sniffDelimiter(text);
  const rows = [];
  let row = [], cell = "", q = false;
  const s = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === d) { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ""));
}

/** يفصل صف العناوين عن الصفوف — وإذا العناوين كلها أرقام يعتبرها بيانات */
export function toTable(matrix) {
  if (!matrix.length) return { headers: [], rows: [] };
  const first = matrix[0].map((x) => String(x ?? "").trim());
  const looksHeader = first.some((h) => h && !/^-?\d+(\.\d+)?$/.test(h));
  const headers = looksHeader ? first : first.map((_, i) => `عمود ${i + 1}`);
  const body = looksHeader ? matrix.slice(1) : matrix;
  return {
    headers,
    rows: body.map((r) => {
      const o = {};
      headers.forEach((h, i) => { o[h || `عمود ${i + 1}`] = r[i] ?? ""; });
      return o;
    })
  };
}

// ═══════════════ إكسل ═══════════════
async function readXlsx(buf) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheets = [];
  wb.eachSheet((ws) => {
    const matrix = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        const v = cell.value;
        if (v == null) vals.push("");
        else if (typeof v === "object") {
          // الخانة المحسوبة بتحمل النتيجة، والتاريخ بيجي ككائن Date
          if (v instanceof Date) vals.push(v.toISOString().slice(0, 10));
          else if ("result" in v) vals.push(v.result ?? "");
          else if ("text" in v) vals.push(v.text ?? "");
          else if ("richText" in v) vals.push(v.richText.map((t) => t.text).join(""));
          else vals.push("");
        } else vals.push(v);
      });
      matrix.push(vals);
    });
    if (matrix.length) sheets.push({ name: ws.name, ...toTable(matrix) });
  });
  return sheets;
}

// ═══════════════ الواجهة الموحّدة ═══════════════
/**
 * يقرأ أي ملف مدعوم ويرجّع شكل موحّد.
 * @param {Buffer} buffer محتوى الملف
 * @param {string} filename الاسم (لتحديد النوع)
 */
export async function readAnyFile(buffer, filename) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const ext = EXT(filename);
  const fail = (error) => ({ ok: false, error, kind: ext || "?", table: { headers: [], rows: [] }, sheets: [], pages: [], text: "" });

  if (!buf.length) return fail("الملف فاضي");
  if (buf.length > 30 * 1024 * 1024) return fail("الملف أكبر من 30 ميجا");

  const head = buf.subarray(0, 8).toString("latin1");

  // ── PDF ──
  if (head.startsWith("%PDF-") || ext === "pdf") {
    // الملف المحمي بكلمة سر ما بينقرأ — منقولها بصراحة بدل ما نطلّع فاضي
    if (/\/Encrypt\b/.test(buf.subarray(0, Math.min(buf.length, 2_000_000)).toString("latin1")))
      return fail("الـPDF محمي بكلمة سر. احفظ نسخة بلا حماية وارفعها.");
    const p = pdfToText(buf);
    if (!p.ok) return fail(p.error || "تعذّر قراءة الـPDF");
    if (!p.text.trim())
      return fail("الـPDF ما فيه نص — يعني صورة ممسوحة (Scan). لازم نسخة PDF نصية.");
    return {
      ok: true, kind: "pdf", pages: p.pages, text: p.text,
      arabic: p.arabic, sheets: [], table: { headers: [], rows: [] }
    };
  }

  // ── إكسل (PK = ملف مضغوط، وهيك بتبدأ ملفات xlsx) ──
  if (head.startsWith("PK") || ["xlsx", "xlsm", "xltx"].includes(ext)) {
    try {
      const sheets = await readXlsx(buf);
      if (!sheets.length) return fail("ملف الإكسل ما فيه ولا صف");
      return {
        ok: true, kind: "xlsx", sheets, table: sheets[0],
        pages: [], text: "", arabic: true
      };
    } catch (e) { return fail("تعذّر قراءة ملف الإكسل: " + (e && e.message)); }
  }

  // ── الإكسل القديم .xls (تنسيق ثنائي مختلف تماماً) ──
  if (ext === "xls" || head.startsWith("\xD0\xCF\x11\xE0"))
    return fail("صيغة .xls القديمة مش مدعومة. افتحه بإكسل و«حفظ باسم» xlsx أو CSV.");

  // ── JSON ──
  if (ext === "json") {
    try {
      const data = JSON.parse(decodeText(buf));
      const arr = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : null;
      if (!arr) return fail("الـJSON لازم يكون مصفوفة صفوف");
      const headers = [...new Set(arr.flatMap((o) => Object.keys(o || {})))];
      return { ok: true, kind: "json", table: { headers, rows: arr }, sheets: [], pages: [], text: "" };
    } catch (e) { return fail("JSON غير صالح: " + (e && e.message)); }
  }

  // ── نص مفصول (CSV/TSV) أو نص عادي ──
  const text = decodeText(buf);
  if (["csv", "tsv", "txt", "tab"].includes(ext) || /[,;\t|]/.test(text.split("\n")[0] || "")) {
    const table = toTable(parseDelimited(text));
    if (table.rows.length)
      return { ok: true, kind: ext === "txt" ? "text" : "csv", table, sheets: [], pages: [], text };
  }
  if (text.trim())
    return { ok: true, kind: "text", text, table: { headers: [], rows: [] }, sheets: [], pages: [] };

  return fail("نوع الملف غير مدعوم. المدعوم: PDF، Excel (xlsx)، CSV، TSV، JSON، نص.");
}

export const SUPPORTED = ["pdf", "xlsx", "xlsm", "csv", "tsv", "txt", "json"];

// ═══════════════════════════════════════════════════════════
// 🧭 مطابقة الأعمدة بالعربي والإنجليزي
// ملفات الجرد بتيجي بأسماء أعمدة مختلفة من كل نظام. بدل ما
// نجبر المستخدم على قالب واحد، منتعرّف على العمود من اسمه.
// ═══════════════════════════════════════════════════════════
const SYNONYMS = {
  name:    ["الصنف", "المنتج", "اسم الصنف", "اسم المنتج", "البند", "item", "product", "name", "description"],
  qty:     ["الكمية", "العدد", "الجرد", "المعدود", "الرصيد", "qty", "quantity", "count", "stock", "balance"],
  cost:    ["التكلفة", "سعر التكلفة", "الكلفة", "cost", "unit cost", "buy"],
  price:   ["السعر", "سعر البيع", "price", "sell", "unit price"],
  barcode: ["الباركود", "الرمز", "barcode", "sku", "code"],
  unit:    ["الوحدة", "unit", "uom"],
  expiry:  ["الصلاحية", "تاريخ الصلاحية", "الانتهاء", "expiry", "expiration", "exp"],
  batch:   ["الدفعة", "التشغيلة", "batch", "lot"],
  note:    ["ملاحظة", "ملاحظات", "note", "notes", "remark"]
};

const clean = (s) => String(s || "").normalize("NFKC").replace(/[ً-ْـ]/g, "")
  .replace(/[إأآ]/g, "ا").replace(/ة/g, "ه").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * يربط أعمدة الملف بالحقول اللي بدنا ياها.
 * @param {string[]} headers عناوين الملف
 * @returns {Object} مثل { name:"اسم الصنف", qty:"العدد" }
 */
export function matchColumns(headers) {
  const out = {};
  const hs = headers.map((h) => ({ raw: h, c: clean(h) }));
  for (const [field, words] of Object.entries(SYNONYMS)) {
    const ws = words.map(clean);
    // تطابق تام أولاً، وبعدها احتواء — حتى ما "سعر التكلفة" تصير "السعر"
    let hit = hs.find((h) => ws.includes(h.c));
    if (!hit) hit = hs.find((h) => ws.some((w) => h.c === w || h.c.includes(w)));
    if (hit && !Object.values(out).includes(hit.raw)) out[field] = hit.raw;
  }
  return out;
}

/** رقم من خانة قد تكون نص أو فيها فواصل أو أرقام عربية */
export function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[,\s ]/g, "")
    .replace(/[^\d.\-]/g, "");
  if (!s || s === "-" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
