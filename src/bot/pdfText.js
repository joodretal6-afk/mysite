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

// ── استخراج النص من محتوى صفحة (عوامل Tj / TJ / ' / ") ──
function textFromContent(str, cmap) {
  const parts = [];
  // كل السلاسل داخل مصفوفات TJ أو قبل Tj
  const re = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>/g;
  let m;
  while ((m = re.exec(str))) {
    const tok = m[0];
    parts.push(tok[0] === "(" ? unescapePdfString(tok.slice(1, -1)) : hexToText(tok.slice(1, -1), cmap));
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

  // تمريرة أولى: نجمع كل خرائط ToUnicode قبل ما نفك أي نص
  const streams = extractStreams(buffer).map((raw) => (inflateSafe(raw) || raw).toString("latin1"));
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
