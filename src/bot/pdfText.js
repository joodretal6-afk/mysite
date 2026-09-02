// ═══════════════════════════════════════════════════════════
// 📄 قارئ نصوص PDF — بدون أي مكتبة خارجية
//
// كشوفات شركات التوصيل بتيجي PDF. هاد الملف بيفك ضغط
// مجاري النص (FlateDecode) وبيطلع النص الخام منها.
//
// الكشوفات بتستخدم خطوط CID مقصوصة، فالعربي مخزّن كأرقام
// داخلية. منقرأ خريطة ToUnicode المرفقة بالملف ومنفك فيها
// النص، فبتطلع الأسماء العربية مقروءة (اسم الزبون/الحساب).
// إذا الملف ما فيه خريطة، الأرقام بتضل سليمة 100% ومنقول
// للمستخدم صراحةً إنّ الأسماء ما انقرأت — بلا ما نخترعها.
// ═══════════════════════════════════════════════════════════
import zlib from "node:zlib";

// ═══════════════════════════════════════════════════════════
// 🔓 فك الضغط — متسامح عمداً
//
// 🔴 هون كانت العلة اللي بتخلّي كشف من 5 صفحات يطلع صفحة:
//    لمّا حدود المجرى تزحّ بايت أو المجرى ينقطع، zlib بترمي
//    خطأ فبتضيع الصفحة كلها بصمت. مع Z_SYNC_FLUSH منرجّع
//    الجزء اللي انفك بدل ما نخسر الصفحة.
// ═══════════════════════════════════════════════════════════
const Z = { finishFlush: zlib.constants.Z_SYNC_FLUSH };

function inflateSafe(buf) {
  const tries = [
    () => zlib.inflateSync(buf, Z),
    () => zlib.inflateRawSync(buf, Z),
    () => zlib.unzipSync(buf, Z),
    // بعض المولّدات بتزيد بايت أو بايتين قبل رأس zlib
    () => zlib.inflateSync(buf.subarray(1), Z),
    () => zlib.inflateRawSync(buf.subarray(1), Z)
  ];
  let best = null;
  for (const fn of tries) {
    try {
      const out = fn();
      if (out && out.length && (!best || out.length > best.length)) best = out;
    } catch { /* جرّب اللي بعده */ }
  }
  return best;
}

// ── ASCII85 / ASCIIHex — مرشّحات بتيجي قبل Flate بسلسلة الفلاتر ──
function a85Decode(buf) {
  const s = buf.toString("latin1").replace(/\s/g, "").replace(/^<~/, "").replace(/~>$/, "");
  const out = [];
  let tup = 0, n = 0;
  for (const ch of s) {
    if (ch === "z" && n === 0) { out.push(0, 0, 0, 0); continue; }
    const v = ch.charCodeAt(0) - 33;
    if (v < 0 || v > 84) continue;
    tup = tup * 85 + v; n++;
    if (n === 5) { out.push((tup >>> 24) & 255, (tup >>> 16) & 255, (tup >>> 8) & 255, tup & 255); tup = 0; n = 0; }
  }
  if (n > 1) {
    for (let i = n; i < 5; i++) tup = tup * 85 + 84;
    const b = [(tup >>> 24) & 255, (tup >>> 16) & 255, (tup >>> 8) & 255, tup & 255];
    out.push(...b.slice(0, n - 1));
  }
  return Buffer.from(out);
}
const ahxDecode = (buf) =>
  Buffer.from(buf.toString("latin1").split(">")[0].replace(/[^0-9A-Fa-f]/g, ""), "hex");

/** يطبّق سلسلة الفلاتر المذكورة بقاموس المجرى */
function applyFilters(raw, filters) {
  let b = raw;
  for (const f of filters) {
    if (/ASCII85/.test(f)) b = a85Decode(b);
    else if (/ASCIIHex/.test(f)) b = ahxDecode(b);
    else if (/Fl(ate)?/.test(f)) { const d = inflateSafe(b); if (!d) return null; b = d; }
    else if (/DCT|JPX|CCITT|JBIG2|RunLength/.test(f)) return null;   // صور — مش نص
  }
  return b;
}

// ── خريطة "رقم الكائن → موقعه" لحلّ /Length غير المباشر ──
function objectOffsets(pdf) {
  const map = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  const s = pdf.toString("latin1");
  let m;
  while ((m = re.exec(s))) map.set(Number(m[1]), m.index);
  return { map, s };
}

// ═══════════════════════════════════════════════════════════
// 📦 استخراج المجاري — بحدود مضبوطة من /Length مش بالتخمين
// ═══════════════════════════════════════════════════════════
function extractStreams(pdf) {
  const out = [];
  const { map: objs, s: str } = objectOffsets(pdf);
  const isWS = (c) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x00 || c === 0x0c;

  let i = 0;
  while (i < pdf.length) {
    const s = pdf.indexOf("stream", i);
    if (s < 0) break;
    // "endstream" كمان بتحتوي "stream" — منتخطّاها
    if (s >= 3 && str.startsWith("end", s - 3)) { i = s + 6; continue; }

    // قاموس المجرى: منرجع لورا لحد "<<" المقابلة
    const dictStart = str.lastIndexOf("<<", s);
    const dict = dictStart >= 0 && s - dictStart < 4000 ? str.slice(dictStart, s) : "";

    // الفلاتر بالترتيب
    const fm = /\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/.exec(dict);
    const filters = fm ? (fm[1].match(/\/([A-Za-z0-9]+)/g) || []).map((x) => x.slice(1)) : [];

    // بداية البيانات: بعد الكلمة وسطر النهاية
    let b = s + 6;
    if (pdf[b] === 0x0d) b++;
    if (pdf[b] === 0x0a) b++;

    // الطول: رقم مباشر، أو إحالة لكائن تاني منحلّها
    let len = null;
    const lm = /\/Length\s+(\d+)(?:\s+(\d+)\s+R)?/.exec(dict);
    if (lm) {
      if (lm[2] !== undefined) {
        const off = objs.get(Number(lm[1]));
        if (off != null) {
          const v = /obj\s+(\d+)/.exec(str.slice(off, off + 200));
          if (v) len = Number(v[1]);
        }
      } else len = Number(lm[1]);
    }

    let e = -1;
    if (len != null && len > 0 && b + len <= pdf.length) {
      // منتحقق إنّ "endstream" فعلاً بعد الطول المذكور
      let k = b + len;
      while (k < pdf.length && isWS(pdf[k])) k++;
      if (str.startsWith("endstream", k)) e = b + len;
    }
    // الطول غلط أو مش موجود → منرجع للبحث عن "endstream"
    if (e < 0) {
      e = pdf.indexOf("endstream", b);
      if (e < 0) break;
      // منشيل سطر النهاية اللي قبل الكلمة
      while (e > b && isWS(pdf[e - 1])) e--;
    }

    out.push({ raw: pdf.subarray(b, e), filters });
    i = Math.max(e + 1, s + 6);
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

// ═══════════════════════════════════════════════════════════
// 🔤 خرائط ToUnicode — هون بينحل لغز العربي المبعثر
//
// الكشف بيستخدم خط مقصوص (subset) فالحرف مخزّن كرقم داخلي
// مش كحرف. بس كل PDF محترم بيرفق خريطة ToUnicode بتقول
// "الرقم 0x0045 = حرف الميم". منقرأ هالخريطة ومنفك فيها
// النص — وهيك بيطلع "اسم الزبون: اجبان غزة" مقروء فعلاً.
// إذا الملف ما فيه الخريطة، منرجع للسلوك القديم (الأرقام
// بتضل سليمة) ومنقول للمستخدم إنّ الأسماء ما انقرأت.
// ═══════════════════════════════════════════════════════════
const hexToStr = (h) => {
  let out = "";
  for (let i = 0; i + 3 < h.length; i += 4) out += String.fromCharCode(parseInt(h.substr(i, 4), 16));
  if (h.length % 4 !== 0) { /* بقايا غير مكتملة تُتجاهل */ }
  return out;
};

function parseCMap(str, map) {
  // bfchar: <src> <dst>
  const bc = /beginbfchar([\s\S]*?)endbfchar/g;
  let m;
  while ((m = bc.exec(str))) {
    const pair = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let p;
    while ((p = pair.exec(m[1]))) map.set(parseInt(p[1], 16), hexToStr(p[2]));
  }
  // bfrange: <lo> <hi> <dst>  أو  <lo> <hi> [<d1> <d2> …]
  const br = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = br.exec(str))) {
    const body = m[1];
    const one = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[^\]]*\])/g;
    let p;
    while ((p = one.exec(body))) {
      const lo = parseInt(p[1], 16), hi = parseInt(p[2], 16);
      if (hi < lo || hi - lo > 65535) continue;
      if (p[3][0] === "<") {
        const base = p[3].slice(1, -1);
        const start = parseInt(base, 16);
        for (let c = lo; c <= hi; c++) {
          // الزيادة بتصير على آخر وحدة ترميز
          const v = start + (c - lo);
          map.set(c, base.length <= 4 ? String.fromCharCode(v)
                                      : hexToStr(base.slice(0, -4) + v.toString(16).padStart(4, "0")));
        }
      } else {
        const items = p[3].slice(1, -1).match(/<([0-9A-Fa-f]+)>/g) || [];
        items.forEach((it, i) => { if (lo + i <= hi) map.set(lo + i, hexToStr(it.slice(1, -1))); });
      }
    }
  }
  return map;
}

// ═══════════════════════════════════════════════════════════
// 🔑 فك السلسلة عبر خريطة الحروف — للسلاسل النصية كمان
//
// 🔴 هون كانت العلة الكبرى اللي خلّت 8 صفحات تطلع 24 طرد:
//    الكشف بيكتب الأرقام والعربي بخط CID مقصوص، وبيمرّرهم
//    كسلسلة عادية (…) مش سداسية <…>. كنا نطبّق الخريطة على
//    السداسية بس، فالأرقام بتطلع محارف تحكّم وبتضيع الصفوف.
//    هلأ منجرّب الخريطة على الاتنين: 2-بايت أول (خطوط CID)،
//    وبعدها 1-بايت، ومنعتمد اللي بيطابق فعلاً.
// ═══════════════════════════════════════════════════════════
function mapBytes(bytes, cmap) {
  if (!cmap || !cmap.size) return null;

  // محاولة 2-بايت (الشائع بخطوط CID المقصوصة)
  if (bytes.length >= 2) {
    let out = "", hits = 0, total = 0;
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      total++;
      const code = (bytes[i] << 8) | bytes[i + 1];
      if (cmap.has(code)) { out += cmap.get(code); hits++; }
      else out += String.fromCharCode(code);
    }
    if (total && hits / total >= 0.5) return out;
  }
  // محاولة 1-بايت
  let out1 = "", hits1 = 0;
  for (const b of bytes) {
    if (cmap.has(b)) { out1 += cmap.get(b); hits1++; }
    else out1 += String.fromCharCode(b);
  }
  return bytes.length && hits1 / bytes.length >= 0.5 ? out1 : null;
}

const bytesOf = (s) => {
  const a = new Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff;
  return a;
};

// ── سلسلة سداسية <0045 0032> → نص ──
function hexToText(hex, cmap) {
  const h = hex.replace(/[^0-9a-fA-F]/g, "");
  const bytes = [];
  for (let i = 0; i + 1 < h.length; i += 2) bytes.push(parseInt(h.substr(i, 2), 16));
  return mapBytes(bytes, cmap) ?? bytes.map((b) => String.fromCharCode(b)).join("");
}

// ── سلسلة عادية (…) → نص، مع تجربة خريطة الحروف كمان ──
function litToText(raw, cmap) {
  const s = unescapePdfString(raw);
  // إذا السلسلة أصلاً نص لاتيني/عربي مقروء، ما إلها داعي للخريطة
  const printable = [...s].filter((c) => c.charCodeAt(0) >= 32).length;
  if (s.length && printable === s.length && !/[-ÿ]/.test(s)) return s;
  return mapBytes(bytesOf(s), cmap) ?? s;
}

// ═══════════════════════════════════════════════════════════
// ✂️ استخراج النص من محتوى صفحة (عوامل Tj / TJ / ' / ")
//
// 🔴 علة ثانية كانت بتضيّع بوليصات: مصفوفة TJ بتقسّم النص
//    لقطع عشان تباعد الحروف — يعني رقم بوليصة واحد بيطلع
//    [(1005)-20(06548034)]. لو حسبنا كل قطعة لحالها، ما بيصير
//    ولا وحدة 12 خانة فبتضيع البوليصة كلها.
//    الحل: كل قطع نفس عامل TJ بتنلزق مقطع واحد.
// ═══════════════════════════════════════════════════════════
const STR_TOK = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>/g;

const decodeTok = (tok, cmap) =>
  tok[0] === "(" ? litToText(tok.slice(1, -1), cmap) : hexToText(tok.slice(1, -1), cmap);

function textFromContent(str, cmap) {
  const parts = [];
  // إمّا مصفوفة [...] TJ كاملة، أو سلسلة وحدها قبل Tj / ' / "
  const re = /\[((?:\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|[^\[\]])*)\]\s*TJ|((?:\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>))\s*(?:Tj|'|")/g;
  let m, last = 0;
  while ((m = re.exec(str))) {
    last = re.lastIndex;
    if (m[1] !== undefined) {
      // مصفوفة TJ: منلزق كل السلاسل جوّاها مقطع واحد
      // (الأرقام اللي بينها تباعد حروف — مش نص، منتجاهلها)
      const inner = m[1].match(STR_TOK) || [];
      const joined = inner.map((t) => decodeTok(t, cmap)).join("");
      if (joined) parts.push(joined);
    } else if (m[2]) {
      const t = decodeTok(m[2], cmap);
      if (t) parts.push(t);
    }
  }
  // ملف بشكل غير متوقّع ما طابق ولا عامل → منرجع للطريقة العامة
  if (!parts.length && last === 0) {
    let x;
    STR_TOK.lastIndex = 0;
    while ((x = STR_TOK.exec(str))) {
      const t = decodeTok(x[0], cmap);
      if (t) parts.push(t);
    }
  }
  return parts;
}

/**
 * يقرأ ملف PDF ويرجّع النص الخام المستخرج منه.
 * @param {Buffer} buffer محتوى الملف
 * `pages` = مقاطع كل صفحة لحالها (كل مجرى محتوى = صفحة).
 * @returns {{ok:boolean, text:string, segments:string[], pages:string[][], arabic:boolean, streams:number, error?:string}}
 */
export function pdfToText(buffer) {
  const fail = (error) => ({ ok: false, text: "", segments: [], pages: [], arabic: false, streams: 0, error });
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) return fail("ملف فارغ أو غير صالح");
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") return fail("الملف مش PDF");

  // تمريرة أولى: نفك كل المجاري ونجمع خرائط ToUnicode
  const found = extractStreams(buffer);
  const streams = [];
  let failed = 0;
  for (const st of found) {
    const dec = st.filters.length ? applyFilters(st.raw, st.filters) : st.raw;
    if (!dec) { failed++; continue; }             // صورة أو مجرى تالف
    streams.push(dec.toString("latin1"));
  }
  const cmap = new Map();
  for (const str of streams) if (/beginbfchar|beginbfrange/.test(str)) parseCMap(str, cmap);

  // تمريرة ثانية: النص، صفحة صفحة
  const pages = [];
  const segments = [];
  for (const str of streams) {
    if (!/(Tj|TJ)/.test(str)) continue;           // مش مجرى نص
    const segs = textFromContent(str, cmap).filter(Boolean);
    if (!segs.length) continue;
    pages.push(segs);
    segments.push(...segs);
  }

  const text = segments.join(" ");
  return {
    ok: true, text, segments, pages, streams: pages.length,
    // تشخيص صريح — حتى لو طلع ناقص تعرف وين ضاع
    stats: { streams_found: found.length, streams_decoded: streams.length,
             streams_failed: failed, text_streams: pages.length,
             segments: segments.length, cmap: cmap.size },
    // هل طلع عربي مقروء فعلاً؟ الواجهة بتقول للمستخدم بصراحة
    arabic: /[؀-ۿ]/.test(text) || /[ﭐ-﻿]/.test(text)
  };
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
    // بنمسك الإشارة السالبة كمان — لأنّ أجرة التوصيل بتيجي بالكشف
    // كـ -1.75 لمّا الزبون يرفض الطلب عند الباب (احنا دفعناها).
    const re = /-?\d+(?:\.\d+)?/g;
    let m;
    while ((m = re.exec(s))) toks.push(m[0]);
  }
  return toks;
}

const near = (a, b) => Math.abs(Math.abs(a) - Math.abs(b)) < 0.005;
const latin = (s) => String(s ?? "")
  .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));

// 🔴 رقم الهاتف الأردني 10 خانات وبيبدأ بصفر — نفس طول بعض
//    البوليصات. لو حسبناه بوليصة بينكسر الصف كله.
const isPhone = (t) => /^0\d{9}$/.test(t) || /^(?:00962|962)7\d{8}$/.test(t);
// تاريخ زي 20/08/26 — أرقامه مش مبالغ
const isDateSeg = (s) => /^\s*\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}(\s|$)/.test(s) ||
                         /^\s*\d{1,2}:\d{2}/.test(s);

/**
 * يتعرّف على شكل رقم البوليصة من الملف نفسه بدل ما نفترضه:
 * منجمع كل الأرقام الصافية بطول 9-16 اللي مش هواتف، ومنعتمد
 * الطول الأكثر تكراراً. هيك بيشتغل مع أي شركة توصيل.
 */
export function detectTrackingLength(segments) {
  const counts = new Map();
  for (const seg of segments) {
    if (isDateSeg(seg)) continue;
    for (const t of latin(seg).match(/\d+/g) || []) {
      if (t.length < 9 || t.length > 16 || isPhone(t)) continue;
      counts.set(t.length, (counts.get(t.length) || 0) + 1);
    }
  }
  let best = null, bestN = 0;
  for (const [len, n] of counts) if (n > bestN || (n === bestN && best != null && len > best)) { best = len; bestN = n; }
  return best;
}

/**
 * يحوّل نص الكشف لصفوف طرود.
 *
 * منمشي على المقاطع بالترتيب. لمّا نلاقي رقم بوليصة، الأرقام
 * اللي قبله هي أرقام صفّه، ومنفكّها هيك:
 *  • أجرة التوصيل = الرقم اللي مقداره يساوي الأجرة المعروفة،
 *    وبنحتفظ بإشارته (سالب = انخصمت علينا).
 *  • مبلغ التحصيل: منستعمل علاقة الكشف نفسها —
 *        التحصيل = الإجمالي + الأجرة
 *    فلمّا نلاقي رقمين بينطبق عليهم هالشرط منعرف مين مين
 *    بلا تخمين. وإذا ما انطبق، منرجع لأول رقم بالصف.
 *  • التواريخ وأرقام الهواتف بتنشال قبل الحساب.
 *
 * @param {string[]} segments مقاطع النص من pdfToText
 * @param {{feeRate?:number, trackLen?:number}} [opts]
 */
export function parseCodStatement(segments, opts = {}) {
  const feeRate = Number(opts.feeRate) > 0 ? Number(opts.feeRate) : null;
  const trackLen = Number(opts.trackLen) || detectTrackingLength(segments);
  const isTracking = (t) =>
    /^\d+$/.test(t) && !isPhone(t) &&
    (trackLen ? t.length === trackLen : t.length >= TRACK_MIN && t.length <= TRACK_MAX);

  const rows = [];
  const seen = new Set();
  let win = [];                            // أرقام الصف الحالي
  let tokens = 0;

  const flush = (t) => {
    let fee = null, rest = win;
    if (feeRate != null) {
      const i = win.findIndex((n) => near(n, feeRate));
      if (i >= 0) { fee = win[i]; rest = win.filter((_, j) => j !== i); }
    }
    const cands = rest.filter((n) => n >= -2000 && n <= 2000);

    // العلاقة الحاسمة: التحصيل = الإجمالي + الأجرة
    let amount = null;
    if (fee != null) {
      const f = Math.abs(fee);
      outer:
      for (const a of cands) for (const b of cands) {
        if (a === b) continue;
        if (Math.abs(a - (b + f)) < 0.011) { amount = a; break outer; }
      }
      // الطرد المرفوض: التحصيل صفر والإجمالي بالسالب بنفس الأجرة
      if (amount == null && cands.some((b) => Math.abs(b + f) < 0.011) && cands.includes(0)) amount = 0;
    }
    if (amount == null) {
      const pos = cands.filter((n) => n >= 0);
      amount = pos.length ? pos[0] : 0;     // أول رقم بالصف = عمود السعر
    }
    rows.push({ tracking: t, amount, fee, tokens: win.slice() });
    win = [];
  };

  for (const seg of segments) {
    if (isDateSeg(seg)) continue;                       // سطر تاريخ/وقت — مش أرقام صف
    const s = latin(seg);
    for (const m of s.match(/-?\d+(?:\.\d+)?/g) || []) {
      tokens++;
      const digits = m.replace(/^-/, "");
      if (isTracking(digits)) {
        if (seen.has(digits)) { win = []; continue; }   // بوليصة مكرّرة = تجاهل
        seen.add(digits);
        flush(digits);
      } else if (isPhone(digits)) {
        continue;                                        // هاتف — مش مبلغ ولا بوليصة
      } else {
        const n = Number(m);
        if (Number.isFinite(n) && n >= -2000 && n <= 2000) win.push(n);
      }
    }
  }
  return { rows, tokens, trackLen };
}

// ═══════════════════════════════════════════════════════════
// 🏷️ فصل الكشف حسب اسم الحساب (اسم الزبون) وحسب الصفحة
//
// الكشف الواحد بيجمع أكثر من حساب — "اجبان غزة جديد" حساب
// و"ريفان" حساب — وكل واحد تحصيله لحاله. منقرأ عنوان
// "اسم الزبون:" بكل صفحة ومنفصل الصفوف تحته.
// ═══════════════════════════════════════════════════════════

/** توحيد العربي: أشكال العرض → حروف عادية، وشيل التشكيل والمسافات الزايدة */
export function arNormalize(s) {
  return String(s || "")
    .normalize("NFKC")                       // ﺍﺳﻢ → اسم
    .replace(/[ً-ْـ]/g, "")   // تشكيل وتطويل
    .replace(/[​-‏‪-‮]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const CLIENT_LABELS = ["اسم الزبون", "اسمالزبون", "الزبون", "اسم العميل", "المرسل"];

/**
 * 🔴 العربي بالـPDF بينحفظ بترتيب العرض (معكوس منطقياً).
 * يعني "اسم الزبون" بتطلع "نوبزلا مسا". منجرّب المقطع كما هو
 * ومعكوساً، ومنعتمد اللي بينطابق مع العنوان — بلا تخمين.
 */
const flip = (s) => [...s].reverse().join("");

/** يرجّع نسختين للمقطع: كما هو، ومعكوساً */
function bothOrders(s) {
  const n = arNormalize(s);
  return [n, flip(n)];
}

/** يطلع اسم الحساب من مقاطع صفحة، أو "" إذا ما لقيه */
export function clientNameFrom(segments) {
  for (const seg of segments) {
    for (const norm of bothOrders(seg)) {
      const flat = norm.replace(/\s/g, "");
      const lbl = CLIENT_LABELS.find((l) => flat.includes(l.replace(/\s/g, "")));
      if (!lbl) continue;
      // الاسم بعد النقطتين
      const parts = norm.split(/[:：]/);
      if (parts.length < 2) continue;
      const name = parts.slice(1).join(":").replace(/^[:\s]+/, "").trim();
      if (name && !/^\d+$/.test(name)) return name.slice(0, 120);
    }
  }
  // العنوان بمقطع والاسم بالمقطع اللي بعده
  for (let i = 0; i < segments.length; i++) {
    const hit = bothOrders(segments[i]).some((n) =>
      CLIENT_LABELS.some((l) => n.replace(/\s/g, "").includes(l.replace(/\s/g, ""))));
    if (!hit) continue;
    for (let j = i + 1; j < Math.min(i + 4, segments.length); j++) {
      const c = arNormalize(segments[j]).trim();
      if (c && !/^\d/.test(c)) return c.slice(0, 120);
    }
  }
  return "";
}

// ═══════════════════════════════════════════════════════════
// ✅ التحقق الذاتي — الكشف بيحمل مجاميعه معه
//
// أغلب الكشوفات بتكتب "مجموع التحصيل" و"مجموع سعر التوصيل"
// بترويسة كل صفحة. منقرأهم ومنقارنهم بالمجموع اللي حسبناه.
// لو تطابقوا للقرش، معناها ما ضاع ولا صف — وهاد أقوى إثبات
// من أي كلام. ولو اختلفوا، منقول للمستخدم بصراحة قد إيش.
// ═══════════════════════════════════════════════════════════
const TOTAL_LABELS = {
  collection: ["مجموع التحصيل", "اجمالي التحصيل", "المجموع المحصل"],
  delivery:   ["مجموع سعر التوصيل", "مجموع التوصيل", "اجمالي التوصيل"]
};

/** يستخرج المجاميع المكتوبة بترويسة الصفحة */
export function statedTotals(segments) {
  const out = {};
  for (const seg of segments) {
    const nums = (latin(seg).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (!nums.length) continue;
    for (const norm of bothOrders(seg)) {
      const flat = norm.replace(/\s/g, "");
      for (const [key, labels] of Object.entries(TOTAL_LABELS)) {
        if (out[key] != null) continue;
        // منطابق الأطول أول حتى "مجموع سعر التوصيل" ما تصير "مجموع التوصيل"
        if (labels.some((l) => flat.includes(l.replace(/\s/g, "")))) out[key] = nums[0];
      }
    }
  }
  return out;
}

/**
 * يقرأ الكشف كامل: صفحة صفحة، وحساب حساب.
 * @param {string[][]} pages من pdfToText().pages
 * @param {{feeRate?:number}} [opts]
 * @returns {{pages:Array<{page:number,client:string,rows:Array}>,
 *            clients:Array<{client:string,pages:number[],rows:Array}>}}
 */
export function parseCodStatementByClient(pages, opts = {}) {
  const out = [];
  let carried = "";                      // الحساب بيمتد لصفحات متتالية
  // شكل رقم البوليصة بينتحدد من الملف كله مرة وحدة — أدق من
  // تحديده لكل صفحة، لأنّ صفحة فيها صف واحد ما بتكفي للحكم.
  const trackLen = Number(opts.trackLen) || detectTrackingLength(pages.flat());
  const o = { ...opts, trackLen };

  pages.forEach((segs, i) => {
    const client = clientNameFrom(segs) || carried;
    if (client) carried = client;
    const { rows } = parseCodStatement(segs, o);
    out.push({ page: i + 1, client, stated: statedTotals(segs),
               rows: rows.map((r) => ({ ...r, page_no: i + 1 })) });
  });

  // تجميع حسب الحساب — لأنّ تحصيل كل حساب لحاله
  const byClient = new Map();
  for (const p of out) {
    const key = p.client || "بلا اسم";
    const g = byClient.get(key) || { client: key, pages: [], rows: [] };
    g.pages.push(p.page);
    // بوليصة مكرّرة بين صفحات نفس الحساب ما بتنحسب مرتين
    const seen = new Set(g.rows.map((r) => r.tracking));
    for (const r of p.rows) if (!seen.has(r.tracking)) g.rows.push(r);
    byClient.set(key, g);
  }
  // مجموع اللي الكشف نفسه بيقوله — للتحقق الذاتي
  const stated = { collection: null, delivery: null };
  for (const p of out) {
    if (p.stated.collection != null) stated.collection = (stated.collection || 0) + p.stated.collection;
    if (p.stated.delivery != null) stated.delivery = (stated.delivery || 0) + p.stated.delivery;
  }
  const r2 = (v) => v == null ? null : Math.round(v * 100) / 100;
  return { pages: out, clients: [...byClient.values()], trackLen,
           stated: { collection: r2(stated.collection), delivery: r2(stated.delivery) } };
}
