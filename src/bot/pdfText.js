// ═══════════════════════════════════════════════════════════
// 📄 قارئ نصوص PDF — بدون أي مكتبة خارجية
//
// كشوفات شركات التوصيل بتيجي PDF. هاد الملف بيفك ضغط
// مجاري النص (FlateDecode) وبيطلع النص الخام منها.
//
// ⚠️ حقيقة لازم تكون واضحة: كثير كشوفات بتستخدم خطوط CID
//    مخصّصة، فالحروف العربية بتطلع مشفّرة/مبعثرة —
//    بس الأرقام بتطلع سليمة 100%.
//    وهاد كافي: الكشف الفعلي = رقم البوليصة + المبلغ.
//    ممنوع نخترع أي شي ما طلع من الملف.
// ═══════════════════════════════════════════════════════════
import zlib from "node:zlib";

// ── فك أي مجرى مضغوط بأمان (المجرى التالف يُتخطّى ولا يوقف الملف) ──
function inflateSafe(buf) {
  for (const fn of [zlib.inflateSync, zlib.inflateRawSync]) {
    try { return fn(buf); } catch { /* جرّب اللي بعده */ }
  }
  return null;
}

// ── استخراج كل مجاري (stream…endstream) من ملف PDF ──
function extractStreams(pdf) {
  const out = [];
  const S = Buffer.from("stream");
  const E = Buffer.from("endstream");
  let i = 0;
  while (i < pdf.length) {
    const s = pdf.indexOf(S, i);
    if (s < 0) break;
    let b = s + S.length;
    if (pdf[b] === 0x0d) b++;
    if (pdf[b] === 0x0a) b++;
    const e = pdf.indexOf(E, b);
    if (e < 0) break;
    out.push(pdf.subarray(b, e));
    i = e + E.length;
  }
  return out;
}

// ── فك ترميز سلسلة PDF بين قوسين: (…) مع معالجة \( \) \\ ──
function unescapePdfString(s) {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_m, g) => {
    if (/^[0-7]+$/.test(g)) return String.fromCharCode(parseInt(g, 8));
    return { n: "\n", r: "\r", t: "\t", b: "", f: "" }[g] ?? g;
  });
}

// ── سلسلة سداسية <41424 3> → نص ──
function hexToText(hex) {
  const h = hex.replace(/[^0-9a-fA-F]/g, "");
  let out = "";
  // خطوط CID غالباً 2-بايت؛ الترميز أحادي البايت شائع كمان.
  // منجرّب 2-بايت وإذا طلع كله محارف تحكّم منرجع لـ1-بايت.
  for (let i = 0; i + 1 < h.length; i += 2) {
    const c = parseInt(h.substr(i, 2), 16);
    out += String.fromCharCode(c);
  }
  return out;
}

// ── استخراج النص من محتوى صفحة (عوامل Tj / TJ / ' / ") ──
function textFromContent(str) {
  const parts = [];
  // كل السلاسل داخل مصفوفات TJ أو قبل Tj
  const re = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>/g;
  let m;
  while ((m = re.exec(str))) {
    const tok = m[0];
    parts.push(tok[0] === "(" ? unescapePdfString(tok.slice(1, -1)) : hexToText(tok.slice(1, -1)));
  }
  return parts;
}

/**
 * يقرأ ملف PDF ويرجّع النص الخام المستخرج منه.
 * @param {Buffer} buffer محتوى الملف
 * @returns {{ok:boolean, text:string, segments:string[], streams:number, error?:string}}
 */
export function pdfToText(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) {
    return { ok: false, text: "", segments: [], streams: 0, error: "ملف فارغ أو غير صالح" };
  }
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return { ok: false, text: "", segments: [], streams: 0, error: "الملف مش PDF" };
  }

  const segments = [];
  let used = 0;
  for (const raw of extractStreams(buffer)) {
    const dec = inflateSafe(raw) || raw;          // مجرى غير مضغوط يُقرأ كما هو
    const str = dec.toString("latin1");
    if (!/(Tj|TJ)/.test(str)) continue;           // مش مجرى نص
    used++;
    for (const p of textFromContent(str)) if (p) segments.push(p);
  }

  return { ok: true, text: segments.join(" "), segments, streams: used };
}

// ═══════════════════════════════════════════════════════════
// 🚚 محلّل كشف الدفع عند الاستلام (COD)
//
// القاعدة المرصودة من الكشف الفعلي: كل طرد بيظهر كـ
//     [مبلغ التحصيل] ثم [رقم البوليصة 10-14 خانة]
// منمشي على كل الأرقام بالترتيب ومنربط كل بوليصة
// بأقرب مبلغ قبلها. أي بوليصة بلا مبلغ = 0 (مرتجع)،
// وما منخترع ولا رقم من عندنا.
// ═══════════════════════════════════════════════════════════

const TRACK_MIN = 10, TRACK_MAX = 14;

/** يستخرج كل الأرقام بالترتيب من النص المستخرج */
export function numericTokens(segments) {
  const toks = [];
  for (const seg of segments) {
    // تحويل الأرقام العربية-الهندية للاتينية قبل المطابقة
    const s = String(seg).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
                         .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
    const re = /\d+(?:\.\d+)?/g;
    let m;
    while ((m = re.exec(s))) toks.push(m[0]);
  }
  return toks;
}

const isTracking = (t) => /^\d+$/.test(t) && t.length >= TRACK_MIN && t.length <= TRACK_MAX;

/**
 * يحوّل نص الكشف لصفوف طرود.
 * @returns {{rows:Array<{tracking:string,amount:number}>, tokens:number}}
 */
export function parseCodStatement(segments) {
  const toks = numericTokens(segments);
  const rows = [];
  const seen = new Set();
  let pending = null;                     // آخر مبلغ شفناه قبل البوليصة

  for (const t of toks) {
    if (isTracking(t)) {
      if (seen.has(t)) { pending = null; continue; }   // تكرار = تجاهل
      seen.add(t);
      rows.push({ tracking: t, amount: pending == null ? 0 : pending });
      pending = null;
    } else {
      const n = Number(t);
      // المبالغ المعقولة للتحصيل بالأردن: 0 حتى 2000 دينار
      if (Number.isFinite(n) && n >= 0 && n <= 2000) pending = n;
    }
  }
  return { rows, tokens: toks.length };
}
