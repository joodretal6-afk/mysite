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

// ── سلسلة سداسية <0045 0032> → نص، عبر خريطة ToUnicode إن وُجدت ──
function hexToText(hex, cmap) {
  const h = hex.replace(/[^0-9a-fA-F]/g, "");
  let out = "";
  for (let i = 0; i + 1 < h.length; i += 2) {
    const c = parseInt(h.substr(i, 2), 16);
    out += String.fromCharCode(c);
  }
  if (!cmap || !cmap.size) return out;

  // مع الخريطة: الترميز 2-بايت هو الشائع بخطوط CID
  let mapped = "", hits = 0, total = 0;
  for (let i = 0; i + 3 < h.length; i += 4) {
    total++;
    const code = parseInt(h.substr(i, 4), 16);
    if (cmap.has(code)) { mapped += cmap.get(code); hits++; }
    else mapped += String.fromCharCode(code);
  }
  return total && hits / total >= 0.5 ? mapped : out;
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
  tok[0] === "(" ? unescapePdfString(tok.slice(1, -1)) : hexToText(tok.slice(1, -1), cmap);

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

const isTracking = (t) => /^\d+$/.test(t) && t.length >= TRACK_MIN && t.length <= TRACK_MAX;
const near = (a, b) => Math.abs(Math.abs(a) - Math.abs(b)) < 0.005;

/**
 * يحوّل نص الكشف لصفوف طرود.
 *
 * كل بوليصة منجمعلها الأرقام اللي قبلها (نافذة الصف)، وبعدين:
 *  • أجرة التوصيل = الرقم اللي مقداره يساوي الأجرة المعروفة (1.75)
 *    — وبنحتفظ بإشارته: سالب يعني انخصمت علينا.
 *  • مبلغ التحصيل = آخر رقم موجب باقي بالنافذة.
 * إذا ما لقينا عمود أجرة بالكشف، منرجّع fee=null والمحاسبة
 * بتطبّق الأجرة الافتراضية — بلا ما نخترع رقم من الملف.
 *
 * @param {string[]} segments مقاطع النص من pdfToText
 * @param {{feeRate?:number}} [opts]
 * @returns {{rows:Array<{tracking:string,amount:number,fee:number|null,tokens:number[]}>, tokens:number}}
 */
export function parseCodStatement(segments, opts = {}) {
  const feeRate = Number(opts.feeRate) > 0 ? Number(opts.feeRate) : null;
  const toks = numericTokens(segments);
  const rows = [];
  const seen = new Set();
  let win = [];                            // أرقام الصف الحالي

  for (const t of toks) {
    if (isTracking(t)) {
      if (seen.has(t)) { win = []; continue; }        // بوليصة مكرّرة = تجاهل
      seen.add(t);

      let fee = null, rest = win;
      if (feeRate != null) {
        const i = win.findIndex((n) => near(n, feeRate));
        if (i >= 0) { fee = win[i]; rest = win.filter((_, j) => j !== i); }
      }
      const amounts = rest.filter((n) => n >= 0 && n <= 2000);
      rows.push({
        tracking: t,
        amount: amounts.length ? amounts[amounts.length - 1] : 0,
        fee,
        tokens: win.slice()
      });
      win = [];
    } else {
      const n = Number(t);
      if (Number.isFinite(n) && n >= -2000 && n <= 2000) win.push(n);
    }
  }
  return { rows, tokens: toks.length };
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

/** يطلع اسم الحساب من مقاطع صفحة، أو "" إذا ما لقيه */
export function clientNameFrom(segments) {
  const norm = segments.map(arNormalize);
  for (let i = 0; i < norm.length; i++) {
    const flat = norm[i].replace(/\s/g, "");
    const lbl = CLIENT_LABELS.find((l) => flat.includes(l.replace(/\s/g, "")));
    if (!lbl) continue;

    // الاسم إمّا بعد النقطتين بنفس المقطع، أو بالمقطع اللي بعده
    const after = norm[i].split(/[:：]/).slice(1).join(":").trim();
    let name = after;
    if (!name) {
      for (let j = i + 1; j < Math.min(i + 4, norm.length); j++) {
        const c = norm[j].trim();
        if (c && !/^\d/.test(c) && !CLIENT_LABELS.some((l) => c.includes(l))) { name = c; break; }
      }
    }
    name = name.replace(/^[:\s]+/, "").trim();
    if (name) return name.slice(0, 120);
  }
  return "";
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

  pages.forEach((segs, i) => {
    const client = clientNameFrom(segs) || carried;
    if (client) carried = client;
    const { rows } = parseCodStatement(segs, opts);
    out.push({ page: i + 1, client, rows: rows.map((r) => ({ ...r, page_no: i + 1 })) });
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
  return { pages: out, clients: [...byClient.values()] };
}
