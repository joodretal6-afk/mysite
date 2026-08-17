// ═══════════════════════════════════════════════════════════
// 📡 رادار السوق اليومي
//
// 🔴 الحقيقة أول شي — عشان تعرف شو بتقرأ:
//
// فيسبوك **ما بينشر مبيعات**. ولا رقم مبيعات لأي منتج، لا لك ولا
// لغيرك ولا لأي أداة بالسوق. أي حدا بيقلك "هاي أكثر منتج مبيعاً
// على فيسبوك" إما بيخمّن أو بيكذب.
//
// بس في إشارة عامة قوية بتشتغل، وأغلب التجار ما بيعرفوها:
//
//   ┌─ مدة بقاء الإعلان نشطاً ─────────────────────────┐
//   │ ولا معلن بيدفع فلوس 30 يوم على إعلان خسران.      │
//   │ إعلان شغّال 30+ يوم = المنتج بيربّح، بنسبة عالية.│
//   │ العتبات المعتمدة عند المحترفين:                  │
//   │   14+ يوم → مؤشر مبدئي                           │
//   │   30+ يوم → مثبت غالباً                          │
//   │   60+ يوم → رابح قوي                             │
//   │ + عدد النسخ الإعلانية = جدّية الاستثمار          │
//   └──────────────────────────────────────────────────┘
//
// ⚠️ وقيد مهم: طول المدة دليل **بقاء** مش برهان **ربح**. ممكن معلن
//    كبير يتحمّل الخسارة لأسباب تانية. فمنعامله كإشارة مرجّحة
//    مش كحقيقة.
//
// 🧱 المصدر الحقيقي لقوة هالرادار: التراكم.
//    اليوم الأول = صورة ثابتة، ما إلها قيمة كبيرة.
//    اليوم الثلاثين = سلسلة زمنية بتشوف فيها شو بيصعد وشو بينطفي —
//    وهاي بيانات ما بيملكها منافسك لأنها انبنت عندك بالوقت.
// ═══════════════════════════════════════════════════════════
import { db, retryDb } from "../db/database.js";
import { webSearch } from "../bot/webtools.js";
import { adLibraryLinks } from "./research.js";
import { round } from "./economics.js";
import { guessCategory } from "./food.js";

const DAY = 86400000;

try {
  // قائمة المراقبة — الأصناف اللي بتتابعها
  db.exec(`CREATE TABLE IF NOT EXISTS radar_watch (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    term       TEXT NOT NULL,
    country    TEXT DEFAULT 'الأردن',
    cc         TEXT DEFAULT 'JO',
    category   TEXT DEFAULT '',
    active     INTEGER DEFAULT 1,
    note       TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  )`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS radar_watch_term ON radar_watch(term, cc)`);

  // لقطة يومية لكل صنف — هون بتتراكم القيمة
  db.exec(`CREATE TABLE IF NOT EXISTS radar_snapshots (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    watch_id      INTEGER NOT NULL,
    day           TEXT NOT NULL,          -- YYYY-MM-DD
    web_results   INTEGER DEFAULT 0,      -- عدد نتائج البحث (إشارة حضور)
    fb_pages      INTEGER DEFAULT 0,      -- صفحات فيسبوك ظهرت بالبحث
    shops         INTEGER DEFAULT 0,      -- متاجر إلكترونية
    advertisers   INTEGER DEFAULT -1,     -- معلنون نشطون (رصد يدوي، -1 = غير مرصود)
    max_days      INTEGER DEFAULT -1,     -- أطول إعلان نشط بالأيام (رصد يدوي)
    variations    INTEGER DEFAULT -1,     -- عدد النسخ الإعلانية (رصد يدوي)
    price_low     REAL DEFAULT 0,
    price_high    REAL DEFAULT 0,
    score         REAL DEFAULT 0,
    signals       TEXT DEFAULT '{}',
    created_at    INTEGER NOT NULL
  )`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS radar_snap_key ON radar_snapshots(watch_id, day)`);

  // سجل تشغيل الفحص اليومي
  db.exec(`CREATE TABLE IF NOT EXISTS radar_runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    day        TEXT NOT NULL,
    scanned    INTEGER DEFAULT 0,
    failed     INTEGER DEFAULT 0,
    digest     TEXT DEFAULT '',
    ms         INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  )`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS radar_runs_day ON radar_runs(day)`);
} catch (e) { console.error("radar schema:", e.message); }

export const today = () => new Date().toISOString().slice(0, 10);
const J = s => { try { return JSON.parse(s || "{}"); } catch { return {}; } };

// ═══════════════════════════════════════════════════════════
// قائمة المراقبة
// ═══════════════════════════════════════════════════════════
export function addTerm(term, country = "الأردن", cc = "JO", note = "") {
  const t = String(term || "").trim();
  if (!t) throw new Error("أدخل اسم الصنف");
  const cat = guessCategory(t);
  retryDb(() => db.prepare(
    `INSERT INTO radar_watch (term, country, cc, category, note, created_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(term, cc) DO UPDATE SET active = 1, note = excluded.note`
  ).run(t.slice(0, 100), String(country).slice(0, 60), String(cc).toUpperCase().slice(0, 2),
        cat.key, String(note).slice(0, 300), Date.now()));
  return retryDb(() => db.prepare("SELECT * FROM radar_watch WHERE term = ? AND cc = ?")
    .get(t.slice(0, 100), String(cc).toUpperCase().slice(0, 2)));
}

export function watchlist(onlyActive = true) {
  return retryDb(() => db.prepare(
    `SELECT * FROM radar_watch ${onlyActive ? "WHERE active = 1" : ""} ORDER BY created_at DESC`
  ).all());
}

export function removeTerm(id) {
  retryDb(() => db.prepare("UPDATE radar_watch SET active = 0 WHERE id = ?").run(Number(id)));
}

// ═══════════════════════════════════════════════════════════
// 🔍 فحص صنف واحد — بحث ويب حقيقي
//
// ما بنقدر نعدّ المعلنين آلياً (مكتبة الإعلانات بتتطلب متصفح)،
// بس بنقدر نقيس الحضور الرقمي: كم متجر وكم صفحة وكم إشارة سعر.
// وهاي إشارة حقيقية بتتحرّك مع الطلب.
// ═══════════════════════════════════════════════════════════
export async function scanTerm(w) {
  const term = w.term, country = w.country || "الأردن";
  const signals = { queries: [], sources: [], prices: [] };
  let webResults = 0, fbPages = 0, shops = 0;

  const queries = [
    `${term} ${country}`,
    `${term} سعر ${country}`,
    `site:facebook.com ${term} ${country}`
  ];

  for (const q of queries) {
    try {
      const res = await webSearch(q, 10);
      signals.queries.push({ q, n: res.length });
      webResults += res.length;
      for (const r of res) {
        const u = String(r.url || "").toLowerCase();
        if (u.includes("facebook.com")) fbPages++;
        else if (/shop|store|market|متجر|سوق|\.jo\b/.test(u)) shops++;
        if (signals.sources.length < 12)
          signals.sources.push({ title: String(r.title || "").slice(0, 120), url: r.url });
        // استخراج إشارات سعر من المقتطفات — تقريبي ومعلن كتقريبي
        const m = String(r.snippet || "").match(/(\d+(?:\.\d+)?)\s*(?:دينار|د\.أ|JOD|jd)/gi);
        if (m) for (const x of m.slice(0, 3)) {
          const n = parseFloat(x);
          if (Number.isFinite(n) && n > 0 && n < 5000) signals.prices.push(n);
        }
      }
    } catch (e) {
      signals.queries.push({ q, error: String(e.message).slice(0, 120) });
    }
    await new Promise(r => setTimeout(r, 900));   // تهدئة — ما بدنا نضغط المحرك
  }

  const prices = signals.prices.sort((a, b) => a - b);
  return {
    watch_id: w.id,
    web_results: webResults,
    fb_pages: fbPages,
    shops,
    price_low: prices.length ? round(prices[0]) : 0,
    price_high: prices.length ? round(prices[prices.length - 1]) : 0,
    signals
  };
}

// ═══════════════════════════════════════════════════════════
// 🎯 الدرجة — كل مكوّن معلن ووزنه معلن
//
// الوزن الأكبر لمدة الإعلان لأنها أقرب إشارة للربحية.
// وإذا ما رصدت إعلانات يدوياً، منقول صراحة إنه الدرجة ناقصة
// بدل ما نعطي رقم واثق مبني على نص الإشارات.
// ═══════════════════════════════════════════════════════════
export function scoreSnapshot(s) {
  const parts = [];
  const add = (name, val, weight, why) => parts.push({ المكوّن: name, القيمة: val, الوزن: weight, السبب: why });

  const hasAds = Number(s.max_days) >= 0 && Number(s.advertisers) >= 0;

  // 1) مدة الإعلان — أقوى إشارة (وزن 40%)
  const d = Number(s.max_days);
  const daysScore = !hasAds ? null
    : d >= 60 ? 100 : d >= 30 ? 80 : d >= 14 ? 55 : d >= 7 ? 30 : 10;
  if (daysScore != null)
    add("مدة أطول إعلان", `${d} يوم`, 0.40,
        d >= 60 ? "رابح قوي — 60+ يوم" : d >= 30 ? "مثبت غالباً — 30+ يوم"
        : d >= 14 ? "مؤشر مبدئي — 14+ يوم" : "قصير — لسه ما أثبت");

  // 2) عدد المعلنين (وزن 20%) — تحقق من السوق، بس كثرتهم منافسة
  const a = Number(s.advertisers);
  const advScore = !hasAds ? null
    : a === 0 ? 20 : a <= 3 ? 90 : a <= 8 ? 75 : a <= 20 ? 50 : 25;
  if (advScore != null)
    add("عدد المعلنين", a, 0.20,
        a === 0 ? "ولا معلن — إما فرصة بكر أو ما في طلب"
        : a <= 3 ? "سوق مثبت وقليل الازدحام — أفضل وضع"
        : a <= 8 ? "منافسة صحية" : a <= 20 ? "مزدحم" : "مشبع — صعب تدخل");

  // 3) عدد النسخ الإعلانية (وزن 15%) — جدّية الاستثمار
  const v = Number(s.variations);
  if (v >= 0) add("النسخ الإعلانية", v, 0.15,
    v >= 10 ? "استثمار جدي وتحسين مستمر" : v >= 3 ? "اختبار نشط" : "استثمار خفيف");

  // 4) الحضور الرقمي (وزن 15%)
  const web = Number(s.web_results) || 0;
  const webScore = web >= 25 ? 90 : web >= 15 ? 70 : web >= 8 ? 50 : web >= 3 ? 30 : 10;
  add("الحضور الرقمي", `${web} نتيجة`, 0.15,
      web >= 15 ? "حضور قوي بالبحث" : web >= 8 ? "حضور متوسط" : "حضور ضعيف");

  // 5) نطاق السعر (وزن 10%) — الفرق الواسع = مساحة مواقع سعرية
  const lo = Number(s.price_low) || 0, hi = Number(s.price_high) || 0;
  const spread = lo > 0 && hi > lo ? hi / lo : 0;
  const priceScore = spread >= 2.5 ? 90 : spread >= 1.5 ? 70 : spread > 0 ? 45 : 25;
  add("نطاق السعر", lo && hi ? `${lo}–${hi}` : "غير معروف", 0.10,
      spread >= 2.5 ? "فرق واسع — مساحة لمواقع سعرية مختلفة"
      : spread >= 1.5 ? "فرق معقول" : spread > 0 ? "أسعار متقاربة — منافسة سعرية"
      : "ما التقطنا أسعار من البحث");

  // الدرجة النهائية: نوزّع الأوزان على المكوّنات المتوفّرة فقط
  const avail = [
    daysScore != null ? { v: daysScore, w: 0.40 } : null,
    advScore != null ? { v: advScore, w: 0.20 } : null,
    v >= 0 ? { v: v >= 10 ? 95 : v >= 3 ? 70 : 40, w: 0.15 } : null,
    { v: webScore, w: 0.15 },
    { v: priceScore, w: 0.10 }
  ].filter(Boolean);
  const wSum = avail.reduce((t, x) => t + x.w, 0);
  const score = wSum ? round(avail.reduce((t, x) => t + x.v * x.w, 0) / wSum, 1) : 0;

  return {
    score, parts,
    complete: hasAds,
    // 🔴 الشفافية اللي بتفرق: نقول إنه الدرجة ناقصة بدل ما نوهم بالاكتمال
    note: hasAds
      ? "الدرجة كاملة — مبنية على إشارات الإعلانات + الحضور الرقمي"
      : "⚠️ درجة ناقصة: ما رصدت بيانات إعلانات لهاد الصنف. " +
        "افتح مكتبة الإعلانات وسجّل عدد المعلنين وأطول مدة — هدول 60% من الدرجة."
  };
}

// ═══════════════════════════════════════════════════════════
// 💾 حفظ لقطة اليوم
// ═══════════════════════════════════════════════════════════
export function saveSnapshot(snap, day = today()) {
  // منحافظ على الرصد اليدوي لو انحفظ قبل بنفس اليوم
  const prev = retryDb(() => db.prepare(
    "SELECT advertisers, max_days, variations FROM radar_snapshots WHERE watch_id=? AND day=?"
  ).get(snap.watch_id, day));

  const merged = {
    advertisers: snap.advertisers ?? (prev ? prev.advertisers : -1),
    max_days: snap.max_days ?? (prev ? prev.max_days : -1),
    variations: snap.variations ?? (prev ? prev.variations : -1)
  };
  const scored = scoreSnapshot({ ...snap, ...merged });

  retryDb(() => db.prepare(
    `INSERT INTO radar_snapshots
       (watch_id, day, web_results, fb_pages, shops, advertisers, max_days, variations,
        price_low, price_high, score, signals, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(watch_id, day) DO UPDATE SET
       web_results=excluded.web_results, fb_pages=excluded.fb_pages, shops=excluded.shops,
       advertisers=excluded.advertisers, max_days=excluded.max_days, variations=excluded.variations,
       price_low=excluded.price_low, price_high=excluded.price_high,
       score=excluded.score, signals=excluded.signals`
  ).run(snap.watch_id, day, snap.web_results || 0, snap.fb_pages || 0, snap.shops || 0,
        merged.advertisers, merged.max_days, merged.variations,
        snap.price_low || 0, snap.price_high || 0, scored.score,
        JSON.stringify(snap.signals || {}), Date.now()));
  return scored;
}

// رصد يدوي من مكتبة الإعلانات — هاد اللي بيكمّل الدرجة
export function logObservation(watchId, obs, day = today()) {
  const cur = retryDb(() => db.prepare(
    "SELECT * FROM radar_snapshots WHERE watch_id=? AND day=?").get(Number(watchId), day))
    || { watch_id: Number(watchId), web_results: 0, fb_pages: 0, shops: 0, price_low: 0, price_high: 0, signals: "{}" };
  return saveSnapshot({
    watch_id: Number(watchId),
    web_results: cur.web_results, fb_pages: cur.fb_pages, shops: cur.shops,
    price_low: cur.price_low, price_high: cur.price_high,
    signals: J(cur.signals),
    advertisers: obs.advertisers != null ? Math.max(0, Number(obs.advertisers)) : undefined,
    max_days: obs.max_days != null ? Math.max(0, Number(obs.max_days)) : undefined,
    variations: obs.variations != null ? Math.max(0, Number(obs.variations)) : undefined
  }, day);
}

// ═══════════════════════════════════════════════════════════
// 📊 اللوحة — الحالة + الحركة
// الحركة هي القيمة الحقيقية، وما بتوجد إلا بالتراكم.
// ═══════════════════════════════════════════════════════════
export function board(days = 30) {
  const list = watchlist(true);
  const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  const rows = [];

  for (const w of list) {
    const snaps = retryDb(() => db.prepare(
      `SELECT * FROM radar_snapshots WHERE watch_id=? AND day >= ? ORDER BY day ASC`
    ).all(w.id, since));
    if (!snaps.length) {
      rows.push({ ...w, hasData: false, score: null, history: [],
                  note: "ما انفحص بعد — شغّل الفحص اليومي" });
      continue;
    }
    const latest = snaps[snaps.length - 1];
    const prev = snaps.length > 1 ? snaps[snaps.length - 2] : null;
    const weekAgo = snaps.find(s => s.day <= new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10));

    const delta = prev ? round(latest.score - prev.score, 1) : null;
    const weekDelta = weekAgo ? round(latest.score - weekAgo.score, 1) : null;
    const scored = scoreSnapshot(latest);

    rows.push({
      ...w, hasData: true,
      score: latest.score, delta, weekDelta,
      advertisers: latest.advertisers, max_days: latest.max_days, variations: latest.variations,
      web_results: latest.web_results, fb_pages: latest.fb_pages,
      price_low: latest.price_low, price_high: latest.price_high,
      complete: scored.complete, scoreNote: scored.note, parts: scored.parts,
      history: snaps.map(s => ({ day: s.day, score: s.score, web: s.web_results, days: s.max_days })),
      dataPoints: snaps.length,
      // 🔴 الثقة بالحركة بتعتمد على طول السلسلة مش على قوة الرقم
      trendConfidence: snaps.length >= 14 ? "عالية" : snaps.length >= 5 ? "متوسطة" : "لا تكفي",
      adLibrary: adLibraryLinks(w.term, w.cc)[0]
    });
  }

  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const withData = rows.filter(r => r.hasData);
  const maxSeries = Math.max(0, ...withData.map(r => r.dataPoints));

  return {
    rows, total: rows.length, scanned: withData.length,
    maxSeries,
    rising: withData.filter(r => (r.weekDelta ?? 0) >= 8).sort((a, b) => b.weekDelta - a.weekDelta),
    falling: withData.filter(r => (r.weekDelta ?? 0) <= -8).sort((a, b) => a.weekDelta - b.weekDelta),
    proven: withData.filter(r => Number(r.max_days) >= 30),
    incomplete: withData.filter(r => !r.complete),
    maturity: maxSeries >= 30 ? "ناضج — الحركة موثوقة"
            : maxSeries >= 14 ? "بيتكوّن — الحركة مؤشر مبدئي"
            : maxSeries >= 2 ? `🔴 لسه بدري — ${maxSeries} يوم فقط. الحركة ما إلها معنى قبل 14 يوم.`
            : "🔴 أول فحص — هاي صورة ثابتة مش اتجاه. القيمة بتيجي بالتراكم."
  };
}

// ═══════════════════════════════════════════════════════════
// 🏃 الفحص اليومي الكامل
// ═══════════════════════════════════════════════════════════
export async function runDailyScan(onProgress) {
  const t0 = Date.now();
  const day = today();
  const list = watchlist(true);
  let scanned = 0, failed = 0;

  for (const w of list) {
    try {
      const snap = await scanTerm(w);
      saveSnapshot(snap, day);
      scanned++;
      if (onProgress) onProgress({ term: w.term, done: scanned, total: list.length });
    } catch (e) {
      failed++;
      console.error(`radar scan "${w.term}":`, e.message);
    }
  }

  const b = board(30);
  const digest = buildDigest(b);
  retryDb(() => db.prepare(
    `INSERT INTO radar_runs (day, scanned, failed, digest, ms, created_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(day) DO UPDATE SET scanned=excluded.scanned, failed=excluded.failed,
       digest=excluded.digest, ms=excluded.ms`
  ).run(day, scanned, failed, digest, Date.now() - t0, Date.now()));

  return { day, scanned, failed, ms: Date.now() - t0, digest, board: b };
}

// ── ملخّص يومي مختصر (للتيليجرام واللوحة) ──
export function buildDigest(b) {
  const L = [];
  L.push(`📡 رادار السوق — ${today()}`);
  L.push("━━━━━━━━━━━━━━━");
  L.push(`🔎 ${b.scanned} صنف مفحوص من ${b.total}`);

  if (b.maturity.startsWith("🔴")) L.push(b.maturity);

  const top = b.rows.filter(r => r.hasData).slice(0, 5);
  if (top.length) {
    L.push("");
    L.push("🏆 الأعلى درجة:");
    for (const r of top)
      L.push(`  ${r.score} · ${r.term}` +
        (Number(r.max_days) >= 0 ? ` (أطول إعلان ${r.max_days}ي)` : " ⚠️ بلا رصد إعلانات"));
  }
  if (b.proven.length) {
    L.push("");
    L.push("✅ إعلاناتها 30+ يوم (مؤشر ربحية):");
    for (const r of b.proven.slice(0, 5)) L.push(`  ${r.term} — ${r.max_days} يوم`);
  }
  if (b.rising.length) {
    L.push("");
    L.push("📈 صاعد هالأسبوع:");
    for (const r of b.rising.slice(0, 5)) L.push(`  ${r.term} +${r.weekDelta}`);
  }
  if (b.falling.length) {
    L.push("");
    L.push("📉 هابط:");
    for (const r of b.falling.slice(0, 4)) L.push(`  ${r.term} ${r.weekDelta}`);
  }
  if (b.incomplete.length) {
    L.push("");
    L.push(`⚠️ ${b.incomplete.length} صنف درجته ناقصة — بدها رصد من مكتبة الإعلانات`);
  }
  return L.join("\n");
}

export function lastRun() {
  return retryDb(() => db.prepare("SELECT * FROM radar_runs ORDER BY day DESC LIMIT 1").get()) || null;
}
export function runHistory(limit = 30) {
  return retryDb(() => db.prepare("SELECT * FROM radar_runs ORDER BY day DESC LIMIT ?").all(Number(limit)));
}
