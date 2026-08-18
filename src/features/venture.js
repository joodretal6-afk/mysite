// ═══════════════════════════════════════════════════════════
// 🏗️ باني المشاريع الغذائية (venture) — 30 خدمة
//
// من "بدي أبيع صنف" لحد "صفحة جاهزة وأرقام أعرف فيها أربح ولا لأ".
//
// تقسيم الشغل بهاي الوحدة:
//   • الأرقام      → حساب صرف (venture/economics) — ولا رقم من AI
//   • المعرفة الغذائية → قاعدة مكتوبة (venture/food) — ثابتة ومراجَعة
//   • السوق        → بحث ويب حقيقي (venture/research) — بمصادر
//   • بياناتك      → المحركات الـ20 (brain) لما يكون عندك تاريخ
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import { db, retryDb } from "../db/database.js";
import {
  unitEconomics, breakEven, reversePricing, scenarios, launchBudget, round, DEFAULTS
} from "../venture/economics.js";
import {
  CATEGORIES, guessCategory, complianceChecklist, adPolicyNotes, defaultSpoilage
} from "../venture/food.js";
import { adLibraryLinks, searchQueries, research, DISCOVERY_LIMITS } from "../venture/research.js";
import { productStats, customerStats, pct, confidence } from "../brain/core.js";

export const slug = "venture";
export const title = "باني المشاريع الغذائية";
export const icon = "🏗️";

try {
  // مشروع قيد الدراسة
  db.exec(`CREATE TABLE IF NOT EXISTS venture_projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    product     TEXT NOT NULL,
    category    TEXT DEFAULT 'dry_shelf',
    country     TEXT DEFAULT 'الأردن',
    status      TEXT DEFAULT 'دراسة',
    inputs      TEXT DEFAULT '{}',
    notes       TEXT DEFAULT '',
    decision    TEXT DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  )`);
  // منافس مرصود يدوياً — أدق من أي استخراج آلي
  db.exec(`CREATE TABLE IF NOT EXISTS venture_competitors (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER,
    name        TEXT NOT NULL,
    page_url    TEXT DEFAULT '',
    price       REAL DEFAULT 0,
    delivery    REAL DEFAULT 0,
    offer       TEXT DEFAULT '',
    angle       TEXT DEFAULT '',
    strength    TEXT DEFAULT '',
    weakness    TEXT DEFAULT '',
    followers   INTEGER DEFAULT 0,
    ads_active  INTEGER DEFAULT 0,
    source      TEXT DEFAULT 'رصد يدوي',
    created_at  INTEGER NOT NULL
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS venture_comp_proj ON venture_competitors(project_id)`);
  // نتائج البحث المحفوظة
  db.exec(`CREATE TABLE IF NOT EXISTS venture_research (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER,
    kind        TEXT NOT NULL,
    query       TEXT DEFAULT '',
    report      TEXT DEFAULT '',
    steps       TEXT DEFAULT '[]',
    created_at  INTEGER NOT NULL
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS venture_res_proj ON venture_research(project_id, kind)`);
} catch (e) { console.error("venture schema:", e.message); }

export const router = Router();

const J = s => { try { return JSON.parse(s || "{}"); } catch { return {}; } };
const ok = (res, payload, basis) => res.json({ ...payload, basis: basis || null, generated_at: Date.now() });
const bad = (res, msg) => res.status(400).json({ error: msg });
const boom = (res, e, msg) => { console.error("venture:", e && e.message); res.status(500).json({ error: msg || "فشل" }); };

function getProject(id) {
  const p = retryDb(() => db.prepare("SELECT * FROM venture_projects WHERE id = ?").get(Number(id)));
  return p ? { ...p, inputs: J(p.inputs) } : null;
}

// ═══════════════════════════════════════════════════════════
// إدارة المشاريع (الأساس اللي بتبني عليه الـ30 خدمة)
// ═══════════════════════════════════════════════════════════
router.get("/projects", (req, res) => {
  try {
    const rows = retryDb(() => db.prepare(
      "SELECT * FROM venture_projects ORDER BY updated_at DESC LIMIT 100"
    ).all()).map(p => ({ ...p, inputs: J(p.inputs),
      categoryLabel: (CATEGORIES[p.category] || {}).label || p.category }));
    ok(res, { total: rows.length, projects: rows });
  } catch (e) { boom(res, e); }
});

router.post("/projects", (req, res) => {
  try {
    const b = req.body || {};
    const product = String(b.product || "").trim();
    if (!product) return bad(res, "أدخل اسم الصنف");
    const cat = b.category && CATEGORIES[b.category] ? b.category : guessCategory(product).key;
    const now = Date.now();
    // الفاقد الافتراضي من الفئة — أهم رقم بيغفلوا عنه بالأغذية
    const inputs = { ...DEFAULTS, spoilageRate: defaultSpoilage(cat), ...(b.inputs || {}) };
    const r = retryDb(() => db.prepare(
      `INSERT INTO venture_projects (product, category, country, inputs, created_at, updated_at)
       VALUES (?,?,?,?,?,?)`
    ).run(product.slice(0, 120), cat, String(b.country || "الأردن").slice(0, 60),
          JSON.stringify(inputs), now, now));
    ok(res, { id: Number(r.lastInsertRowid), category: { key: cat, ...CATEGORIES[cat] } });
  } catch (e) { boom(res, e); }
});

router.post("/projects/:id", (req, res) => {
  try {
    const p = getProject(req.params.id);
    if (!p) return res.status(404).json({ error: "المشروع مش موجود" });
    const b = req.body || {};
    const inputs = { ...p.inputs, ...(b.inputs || {}) };
    retryDb(() => db.prepare(
      `UPDATE venture_projects SET inputs=?, category=?, country=?, status=?, notes=?, decision=?, updated_at=?
       WHERE id=?`
    ).run(JSON.stringify(inputs),
          b.category && CATEGORIES[b.category] ? b.category : p.category,
          String(b.country ?? p.country).slice(0, 60),
          String(b.status ?? p.status).slice(0, 40),
          String(b.notes ?? p.notes).slice(0, 4000),
          String(b.decision ?? p.decision).slice(0, 2000),
          Date.now(), p.id));
    ok(res, { updated: true, inputs });
  } catch (e) { boom(res, e); }
});

router.delete("/projects/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    retryDb(() => db.prepare("DELETE FROM venture_competitors WHERE project_id = ?").run(id));
    retryDb(() => db.prepare("DELETE FROM venture_research WHERE project_id = ?").run(id));
    retryDb(() => db.prepare("DELETE FROM venture_projects WHERE id = ?").run(id));
    ok(res, { deleted: true });
  } catch (e) { boom(res, e); }
});

// ═══════════════════════════════════════════════════════════
// 🅰️ الاكتشاف والتحقق (1–6)
// ═══════════════════════════════════════════════════════════

// 1) 🔍 تصنيف الصنف وتشخيصه الغذائي
router.get("/1/classify", (req, res) => {
  try {
    const product = String(req.query.product || "").trim();
    if (!product) return bad(res, "أدخل اسم الصنف");
    const g = guessCategory(product);
    ok(res, {
      product, category: g,
      allCategories: Object.entries(CATEGORIES).map(([k, v]) => ({ key: k, ...v })),
      impact: {
        الفاقد_المتوقع: `${g.spoilage}%`,
        يحتاج_تبريد: g.coldChain ? "نعم — بيرفع تكلفتك الثابتة كثير" : "لا",
        مستوى_الخطر: g.riskLevel,
        الصلاحية: g.shelfLife
      }
    }, {
      الطريقة: "مطابقة اسم الصنف على قاعدة فئات غذائية مكتوبة يدوياً",
      "🔴": g.guessed ? "تخمين من الاسم — صحّحه لو غلط، لأنه بيغيّر كل الحسابات بعده"
                      : "ما قدرنا نحدد الفئة — راجعها يدوياً"
    });
  } catch (e) { boom(res, e); }
});

// 2) 🕵️ كاشف المنافسين — روابط جاهزة + حدود صريحة
router.get("/2/competitors/discover", (req, res) => {
  try {
    const product = String(req.query.product || "").trim();
    if (!product) return bad(res, "أدخل اسم الصنف");
    const country = String(req.query.country || "الأردن");
    const cc = String(req.query.cc || "JO");
    ok(res, {
      product, country,
      adLibrary: adLibraryLinks(product, cc),
      webQueries: searchQueries(product, country),
      limits: DISCOVERY_LIMITS,
      howTo: [
        "1. افتح أول رابط من مكتبة إعلانات ميتا — بيعرضلك كل إعلان نشط لصنفك بالبلد",
        "2. لكل منافس يستاهل: خذ اسمه، سعره، عرضه، وزاويته الإعلانية",
        "3. سجّلهم بجدول المنافسين تحت — وقتها كل التحليلات بتشتغل على بيانات حقيقية",
        "4. 10 منافسين مرصودين بعينك أنفع من 100 صف مستخرج آلياً"
      ]
    }, {
      المصدر: "مكتبة إعلانات ميتا — أداة شفافية علنية رسمية من ميتا",
      "🔴_بصراحة": "ما بنقدر نجيبلك كل المنافسين تلقائياً. ولا أداة بتقدر. " +
                   "بنعطيك أدق طريق للوصول إلهم، والرصد بيصير بعينك."
    });
  } catch (e) { boom(res, e); }
});

// 3) 📝 تسجيل وإدارة المنافسين
router.get("/3/competitors", (req, res) => {
  try {
    const pid = Number(req.query.project_id) || null;
    const rows = pid
      ? retryDb(() => db.prepare("SELECT * FROM venture_competitors WHERE project_id=? ORDER BY price ASC").all(pid))
      : retryDb(() => db.prepare("SELECT * FROM venture_competitors ORDER BY created_at DESC LIMIT 200").all());

    const priced = rows.filter(r => Number(r.price) > 0);
    const prices = priced.map(r => Number(r.price)).sort((a, b) => a - b);
    const stats = prices.length ? {
      count: prices.length,
      min: prices[0], max: prices[prices.length - 1],
      median: prices[Math.floor(prices.length / 2)],
      avg: round(prices.reduce((s, p) => s + p, 0) / prices.length)
    } : null;

    ok(res, {
      total: rows.length, rows, priceStats: stats,
      confidence: confidence(rows.length, { low: 5, mid: 12 }),
      insight: stats
        ? `السوق بين ${stats.min} و${stats.max}، والوسيط ${stats.median}. ` +
          (stats.max / stats.min > 2.5
            ? "الفرق كبير — يعني في مساحة لمواقع سعرية مختلفة، مش سوق سعر واحد."
            : "الأسعار متقاربة — المنافسة على السعر صعبة، ميّز نفسك بإشي تاني.")
        : "سجّل منافسين بأسعارهم عشان نقدر نحلل السوق"
    }, { المصدر: `${rows.length} منافس مرصود يدوياً`,
         قوة_الطريقة: "بيانات شفتها بعينك — أدق من أي استخراج آلي" });
  } catch (e) { boom(res, e); }
});

router.post("/3/competitors", (req, res) => {
  try {
    const b = req.body || {};
    if (!String(b.name || "").trim()) return bad(res, "أدخل اسم المنافس");
    const r = retryDb(() => db.prepare(
      `INSERT INTO venture_competitors
       (project_id,name,page_url,price,delivery,offer,angle,strength,weakness,followers,ads_active,source,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(Number(b.project_id) || null, String(b.name).slice(0, 120),
          String(b.page_url || "").slice(0, 400), Number(b.price) || 0, Number(b.delivery) || 0,
          String(b.offer || "").slice(0, 300), String(b.angle || "").slice(0, 300),
          String(b.strength || "").slice(0, 300), String(b.weakness || "").slice(0, 300),
          Number(b.followers) || 0, Number(b.ads_active) || 0,
          String(b.source || "رصد يدوي").slice(0, 60), Date.now()));
    ok(res, { id: Number(r.lastInsertRowid) });
  } catch (e) { boom(res, e); }
});

router.delete("/3/competitors/:id", (req, res) => {
  try {
    retryDb(() => db.prepare("DELETE FROM venture_competitors WHERE id=?").run(Number(req.params.id)));
    ok(res, { deleted: true });
  } catch (e) { boom(res, e); }
});

// 4) 🕳️ فجوة السوق — وين المساحة الفاضية
router.get("/4/gap", (req, res) => {
  try {
    const pid = Number(req.query.project_id) || null;
    const rows = pid
      ? retryDb(() => db.prepare("SELECT * FROM venture_competitors WHERE project_id=?").all(pid))
      : retryDb(() => db.prepare("SELECT * FROM venture_competitors").all());
    if (rows.length < 3)
      return ok(res, { enough: false, rows: rows.length },
        { ملاحظة: "سجّل 3 منافسين على الأقل — بأقل من هيك أي استنتاج بيكون وهم" });

    const angles = new Map(), offers = new Map();
    for (const r of rows) {
      for (const [map, val] of [[angles, r.angle], [offers, r.offer]]) {
        const v = String(val || "").trim();
        if (v) map.set(v, (map.get(v) || 0) + 1);
      }
    }
    const priced = rows.filter(r => Number(r.price) > 0).map(r => Number(r.price)).sort((a, b) => a - b);

    // فجوة سعرية: أكبر مسافة بين سعرين متتاليين
    let gap = null;
    for (let i = 1; i < priced.length; i++) {
      const d = priced[i] - priced[i - 1];
      if (!gap || d > gap.size) gap = { size: round(d), from: priced[i - 1], to: priced[i] };
    }

    const freeDelivery = rows.filter(r => Number(r.delivery) === 0).length;
    const gaps = [];
    if (gap && gap.size > 0)
      gaps.push({ نوع: "فجوة سعرية", الفرصة: `ما في منافس بين ${gap.from} و${gap.to}`,
                  الأساس: `أكبر مسافة بين سعرين متجاورين من ${priced.length} سعر مرصود` });
    if (freeDelivery === 0 && rows.length >= 3)
      gaps.push({ نوع: "التوصيل", الفرصة: "ولا منافس بيعطي توصيل مجاني — هاي زاوية مفتوحة",
                  الأساس: `0 من ${rows.length} منافس` });
    if (offers.size === 0)
      gaps.push({ نوع: "العروض", الفرصة: "ما في عروض واضحة بالسوق — عرض بسيط بيميّزك",
                  الأساس: "ما في عرض مسجّل عند أي منافس" });
    const dominant = [...angles.entries()].sort((a, b) => b[1] - a[1])[0];
    if (dominant && dominant[1] >= rows.length * 0.6)
      gaps.push({ نوع: "الزاوية الإعلانية",
                  الفرصة: `${dominant[1]} من ${rows.length} بيستخدموا زاوية "${dominant[0]}" — أي زاوية ثانية بتلفت النظر`,
                  الأساس: "تكرار الزاوية بين المنافسين المرصودين" });

    ok(res, {
      enough: true, competitors: rows.length, gaps,
      angleSpread: [...angles.entries()].map(([a, n]) => ({ زاوية: a, عدد: n })),
      confidence: confidence(rows.length, { low: 5, mid: 12 })
    }, { المصدر: `${rows.length} منافس سجّلتهم`,
         قيد: "الفجوات محسوبة من عيّنتك إنت — منافس ما رصدته ممكن يكون ساد الفجوة" });
  } catch (e) { boom(res, e); }
});

// 5) 📈 إشارة الطلب من بياناتك (لو عندك تاريخ)
router.get("/5/demand", (req, res) => {
  try {
    const product = String(req.query.product || "").trim();
    const from = Date.now() - 180 * 86400000;
    const stats = productStats(from);
    const match = stats.filter(s =>
      s.product.toLowerCase().includes(product.toLowerCase()) ||
      product.toLowerCase().includes(s.product.toLowerCase()));
    const customers = customerStats(from).filter(c => c.orders > 0);

    ok(res, {
      product,
      hasHistory: match.length > 0,
      matches: match,
      yourBaseline: {
        زبائن: customers.length,
        متوسط_الطلب: customers.length
          ? round(customers.reduce((s, c) => s + c.spend, 0) / customers.reduce((s, c) => s + c.orders, 0))
          : 0,
        أصناف_شغّالة: stats.filter(s => s.orders > 0).length
      },
      note: match.length
        ? `عندك تاريخ فعلي لهاد الصنف — استخدم أرقامه بدل التقديرات`
        : "ما عندك تاريخ لهاد الصنف. أرقام المشروع رح تكون تقديرات لحد ما تختبر فعلياً."
    }, { المصدر: "طلباتك آخر 180 يوم", قيد: "بيانات حسابك فقط — مش حجم السوق الكلي" });
  } catch (e) { boom(res, e); }
});

// 6) 🔎 بحث سوق حقيقي (وكيل بحث)
router.post("/6/research", async (req, res) => {
  try {
    const b = req.body || {};
    const product = String(b.product || "").trim();
    if (!product) return bad(res, "أدخل اسم الصنف");
    const kind = String(b.kind || "market");
    const country = String(b.country || "الأردن");
    const topics = {
      market: `ابحث عن سوق "${product}" الغذائي بـ${country}: مين بيبيعه أونلاين، الأسعار السائدة، ` +
              `وكيف بيسوّقوه. ركّز على البيع عبر فيسبوك بالدفع عند الاستلام.`,
      supply: `ابحث عن موردي "${product}" وأسعار الجملة بـ${country} أو الاستيراد. ` +
              `اذكر نطاق الأسعار ومصادرها.`,
      trend: `هل "${product}" صنف صاعد أو هابط؟ ابحث عن مؤشرات الطلب والاهتمام، وموسميته.`,
      rules: `ما هي متطلبات بيع "${product}" الغذائي بـ${country}: تراخيص، اشتراطات صحية، ` +
             `متطلبات تغليف وبيانات. اذكر المصادر الرسمية إن وُجدت.`
    };
    const topic = topics[kind] || topics.market;

    const r = await research(topic, null);
    if (!r.ok) return res.status(502).json({ error: r.error || "فشل البحث", steps: r.steps });

    if (b.project_id) {
      retryDb(() => db.prepare(
        `INSERT INTO venture_research (project_id, kind, query, report, steps, created_at)
         VALUES (?,?,?,?,?,?)`
      ).run(Number(b.project_id), kind, topic.slice(0, 500), String(r.report).slice(0, 20000),
            JSON.stringify(r.steps || []), Date.now()));
    }
    ok(res, { kind, report: r.report, steps: r.steps, truncated: !!r.truncated }, {
      المصدر: `${(r.steps || []).length} عملية بحث/قراءة فعلية على الويب`,
      "🔴_تحذير": "النتائج من بحث ويب عام. راجع أي رقم قبل ما تبني عليه قرار — " +
                  "خصوصاً الأسعار والمتطلبات القانونية."
    });
  } catch (e) { boom(res, e, "فشل البحث"); }
});

router.get("/6/research/saved", (req, res) => {
  try {
    const pid = Number(req.query.project_id) || null;
    const rows = pid
      ? retryDb(() => db.prepare(
          "SELECT * FROM venture_research WHERE project_id=? ORDER BY created_at DESC LIMIT 50").all(pid))
      : retryDb(() => db.prepare("SELECT * FROM venture_research ORDER BY created_at DESC LIMIT 50").all());
    ok(res, { total: rows.length, rows: rows.map(r => ({ ...r, steps: J(r.steps) })) });
  } catch (e) { boom(res, e); }
});

// ═══════════════════════════════════════════════════════════
// 🅱️ الاقتصاديات (7–12) — حساب صرف
// ═══════════════════════════════════════════════════════════

// 7) 💰 اقتصاديات الوحدة
router.post("/7/unit", (req, res) => {
  try {
    const r = unitEconomics(req.body || {});
    if (!r.ok) return bad(res, r.errors.join(" · "));
    ok(res, r, r.basis);
  } catch (e) { boom(res, e); }
});

// 8) ⚖️ نقطة التعادل
router.post("/8/breakeven", (req, res) => {
  try {
    const r = breakEven(req.body || {});
    if (!r.ok) return bad(res, (r.errors || ["فشل"]).join(" · "));
    ok(res, r, r.basis);
  } catch (e) { boom(res, e); }
});

// 9) 🔄 تسعير عكسي
router.post("/9/pricing", (req, res) => {
  try {
    const r = reversePricing(req.body || {});
    if (!r.ok) return bad(res, (r.errors || ["فشل"]).join(" · "));
    ok(res, r, r.basis);
  } catch (e) { boom(res, e); }
});

// 10) 🎬 السيناريوهات
router.post("/10/scenarios", (req, res) => {
  try {
    const r = scenarios(req.body || {});
    ok(res, r, r.basis);
  } catch (e) { boom(res, e); }
});

// 11) 💸 ميزانية الإطلاق والتدفق النقدي
router.post("/11/budget", (req, res) => {
  try {
    const r = launchBudget(req.body || {});
    if (!r.ok) return bad(res, (r.errors || ["فشل"]).join(" · "));
    ok(res, r, r.basis);
  } catch (e) { boom(res, e); }
});

// 12) 🩺 تشخيص وإصلاح الأرقام الخاسرة
router.post("/12/fix", (req, res) => {
  try {
    const u = unitEconomics(req.body || {});
    if (!u.ok) return bad(res, u.errors.join(" · "));
    const be = breakEven(req.body || {});
    const fixes = be.fixes || [];
    ok(res, {
      current: { perOrder: u.perOrder, margin: u.margin, verdict: u.verdict },
      biggestCost: u.biggestCost,
      fixes: fixes.length ? fixes : null,
      healthy: u.perOrder > 0,
      advice: u.perOrder > 0
        ? `أكبر بند بيأكل ربحك: ${u.biggestCost ? u.biggestCost.بند : "—"} ` +
          `(${u.biggestCost ? u.biggestCost.share : 0}% من السعر). هون ابدأ التحسين.`
        : "الأرقام خاسرة. جرّب الإصلاحات تحت — مرتّبة حسب أثرها."
    }, u.basis);
  } catch (e) { boom(res, e); }
});

// ═══════════════════════════════════════════════════════════
// 🅲 التوريد والامتثال (13–16)
// ═══════════════════════════════════════════════════════════

// 13) ✅ قائمة الامتثال الغذائي
router.get("/13/compliance", (req, res) => {
  try {
    const cat = String(req.query.category || "dry_shelf");
    ok(res, complianceChecklist(CATEGORIES[cat] ? cat : "dry_shelf"),
       { "🔴": "إرشادات عامة مش استشارة قانونية — راجع الجهة الرسمية عندك" });
  } catch (e) { boom(res, e); }
});

// 14) 📋 سياسة إعلانات ميتا لفئتك
router.get("/14/adpolicy", (req, res) => {
  try {
    const cat = String(req.query.category || "dry_shelf");
    ok(res, { category: (CATEGORIES[cat] || CATEGORIES.dry_shelf).label,
              notes: adPolicyNotes(CATEGORIES[cat] ? cat : "dry_shelf") },
       { المصدر: "ملخّص لسياسات ميتا الشائعة بالأغذية",
         قيد: "السياسات بتتغيّر — راجع سياسة ميتا الرسمية قبل الإطلاق" });
  } catch (e) { boom(res, e); }
});

// 15) ❄️ متطلبات التخزين والتبريد وأثرها على التكلفة
router.get("/15/coldchain", (req, res) => {
  try {
    const cat = String(req.query.category || "dry_shelf");
    const c = CATEGORIES[cat] || CATEGORIES.dry_shelf;
    const monthlyFixed = Number(req.query.monthlyFixed) || 0;
    ok(res, {
      category: c.label, coldChain: c.coldChain, shelfLife: c.shelfLife,
      spoilage: c.spoilage, riskLevel: c.riskLevel,
      watchOut: c.watchOut,
      requirements: c.coldChain ? [
        "ثلاجة/فريزر بسعة تكفي أول دفعة + هامش",
        "شركة توصيل عندها مبرّدات — التوصيل العادي ما بينفع",
        "مقياس حرارة وسجل يومي — إثبات لو صار خلاف",
        "خطة طوارئ لانقطاع الكهرباء",
        "تسليم بنفس اليوم أو اليوم التالي كحد أقصى"
      ] : [
        "تخزين جاف بعيد عن الرطوبة والشمس",
        "تدوير المخزون: الأقدم يطلع أول (FIFO)",
        "مراقبة تواريخ الانتهاء أسبوعياً"
      ],
      costImpact: c.coldChain
        ? `التبريد بيضيف ثابت شهري حقيقي. لو ثابتك الحالي ${monthlyFixed} وما فيه تبريد، ` +
          `فرقمك ناقص — ضيفه قبل ما تحسب التعادل.`
        : "ما في تكلفة تبريد — ميزة كبيرة لهالفئة"
    }, { المصدر: "قاعدة معرفة غذائية مكتوبة يدوياً" });
  } catch (e) { boom(res, e); }
});

// 16) 📉 حاسبة الفاقد وأثره
router.post("/16/spoilage", (req, res) => {
  try {
    const b = req.body || {};
    const cat = String(b.category || "dry_shelf");
    const base = { ...DEFAULTS, ...b };
    const rates = [0, defaultSpoilage(cat), Number(b.spoilageRate) || defaultSpoilage(cat),
                   defaultSpoilage(cat) * 2].filter((v, i, a) => a.indexOf(v) === i).sort((x, y) => x - y);
    const rows = rates.map(r => {
      const u = unitEconomics({ ...base, spoilageRate: r });
      return u.ok ? { spoilageRate: r, perOrder: u.perOrder, margin: u.margin,
                      effectiveCost: u.effectiveCost } : null;
    }).filter(Boolean);
    const zero = rows.find(r => r.spoilageRate === 0);
    const real = rows.find(r => r.spoilageRate === (Number(b.spoilageRate) || defaultSpoilage(cat)));
    ok(res, {
      rows,
      cost: zero && real ? round(zero.perOrder - real.perOrder) : null,
      insight: zero && real
        ? `الفاقد بيكلّفك ${round(zero.perOrder - real.perOrder)} عن كل طلب — ` +
          `يعني ${pct(zero.perOrder - real.perOrder, zero.perOrder)}% من ربحك.`
        : "",
      advice: "الفاقد أكثر بند بينساه اللي بيبيع أكل. كل 1% تنزّله بيروح مباشرة لجيبتك."
    }, { المعادلة: "التكلفة الفعلية = التكلفة ÷ (1 − نسبة الفاقد)" });
  } catch (e) { boom(res, e); }
});

// ═══════════════════════════════════════════════════════════
// 🅳 المنتج والعرض (17–21) — بناء على المنافسين المرصودين
// ═══════════════════════════════════════════════════════════
function competitorContext(pid) {
  const rows = pid
    ? retryDb(() => db.prepare("SELECT * FROM venture_competitors WHERE project_id=?").all(Number(pid)))
    : retryDb(() => db.prepare("SELECT * FROM venture_competitors").all());
  const priced = rows.filter(r => Number(r.price) > 0).map(r => Number(r.price)).sort((a, b) => a - b);
  return {
    rows, count: rows.length,
    min: priced[0] || null, max: priced[priced.length - 1] || null,
    median: priced.length ? priced[Math.floor(priced.length / 2)] : null,
    freeDelivery: rows.filter(r => Number(r.delivery) === 0).length,
    angles: [...new Set(rows.map(r => String(r.angle || "").trim()).filter(Boolean))]
  };
}

// 17) 🎯 الموقع التنافسي
router.get("/17/positioning", (req, res) => {
  try {
    const c = competitorContext(req.query.project_id);
    const myPrice = Number(req.query.sellPrice) || 0;
    if (!c.count) return ok(res, { enough: false },
      { ملاحظة: "سجّل منافسين أول — الموقع التنافسي بينبنى مقارنة فيهم" });

    let position = "غير محدّد", strategy = "";
    if (myPrice && c.median) {
      if (myPrice < c.median * 0.85) {
        position = "الأرخص";
        strategy = "موقع خطر بالأغذية — الزبون بيربط السعر الرخيص بالجودة الواطية. " +
                   "لو رح تمشي فيه، اشرح ليش أرخص (بيع مباشر، بلا وسيط) عشان ما ينقرأ رخص.";
      } else if (myPrice > c.median * 1.15) {
        position = "الأعلى سعراً";
        strategy = "لازم تبرّر الفرق بإشي ملموس: مصدر، طزاجة، تغليف، ضمان استبدال. " +
                   "بلا تبرير واضح ما رح تبيع.";
      } else {
        position = "ضمن السوق";
        strategy = "سعرك مقارب — يعني المنافسة رح تكون على الخدمة والثقة مش على السعر. " +
                   "ركّز على سرعة الرد والتوصيل والعرض.";
      }
    }
    ok(res, {
      enough: true, myPrice, market: { min: c.min, max: c.max, median: c.median, competitors: c.count },
      position, strategy,
      differentiators: [
        c.freeDelivery === 0 ? "توصيل مجاني — ولا منافس بيعمله" : null,
        !c.angles.length ? "زاوية إعلانية واضحة — المنافسين ما عندهم" : null,
        "ضمان استبدال لو وصل تالف — نادر بالأغذية وبيبني ثقة فوراً",
        "إثبات المصدر بالصور والفيديو — بيحل اعتراض الجودة قبل ما يُسأل"
      ].filter(Boolean)
    }, { المصدر: `${c.count} منافس مرصود`, قيد: "المقارنة مقابل عيّنتك مش السوق كله" });
  } catch (e) { boom(res, e); }
});

// 18) 🎁 بناء العرض
router.get("/18/offer", (req, res) => {
  try {
    const c = competitorContext(req.query.project_id);
    const sell = Number(req.query.sellPrice) || 0;
    const cost = Number(req.query.unitCost) || 0;
    const offers = [];
    if (sell && cost) {
      const margin = pct(sell - cost, sell);
      if (c.freeDelivery === 0)
        offers.push({ عرض: "توصيل مجاني فوق مبلغ معيّن", لماذا: "ولا منافس بيعمله — تمايز فوري",
                      الشرط: `اضبط الحد فوق ${round(sell * 1.6)} عشان يرفع متوسط الطلب مش يأكل ربحك` });
      if (margin >= 35)
        offers.push({ عرض: "خذ 3 بسعر 2.5", لماذا: `هامشك ${margin}% بيتحمّله`,
                      الشرط: "بيرفع الكمية وبيقلل كلفة التوصيل النسبية — مناسب للأصناف طويلة الصلاحية" });
      offers.push({ عرض: "ضمان استبدال لو وصل تالف", لماذا: "أقوى مزيل اعتراض بالأغذية",
                    الشرط: "كلفته الفعلية منخفضة لو تغليفك كويس — احسبها ضمن نسبة المرتجعات" });
      offers.push({ عرض: "خصم أول طلب", لماذا: "الطلب الثاني هو اللي بيبني تجارة",
                    الشرط: `لا تنزّل تحت ${round(cost * 1.25)} — هون بيصير الخصم خسارة` });
    }
    ok(res, { offers, market: { median: c.median, competitors: c.count },
              existingOffers: c.rows.map(r => r.offer).filter(Boolean) },
       { المصدر: "هامشك + عروض المنافسين المرصودين",
         قاعدة: "كل عرض معه شرطه — العرض بلا حد بيأكل ربحك" });
  } catch (e) { boom(res, e); }
});

// 19-21) 🏷️ الهوية وصفحة المنتج والباقات — عبر الذكاء الاصطناعي بسياق حقيقي
router.post("/19/build", async (req, res) => {
  try {
    const b = req.body || {};
    const product = String(b.product || "").trim();
    if (!product) return bad(res, "أدخل اسم الصنف");
    const what = String(b.what || "identity");
    const cat = guessCategory(product);
    const c = competitorContext(b.project_id);

    const ctx = `الصنف: ${product}
الفئة الغذائية: ${cat.label} (صلاحية ${cat.shelfLife}، ${cat.coldChain ? "يحتاج تبريد" : "لا يحتاج تبريد"})
البلد: ${b.country || "الأردن"}
سعر البيع المقترح: ${b.sellPrice || "غير محدد"}
منافسون مرصودون: ${c.count}${c.median ? ` — وسيط أسعارهم ${c.median}` : ""}
زوايا المنافسين: ${c.angles.join("، ") || "غير مسجّلة"}
عروض المنافسين: ${c.rows.map(r => r.offer).filter(Boolean).join(" | ") || "غير مسجّلة"}
نقاط ضعف رصدتها: ${c.rows.map(r => r.weakness).filter(Boolean).join(" | ") || "غير مسجّلة"}`;

    const asks = {
      identity: `اقترح 5 أسماء لصفحة فيسبوك تبيع ${product}، مع شرح لكل اسم. ` +
                `ثم اقترح وصف الصفحة (bio) ونبرة التواصل. تجنّب أي اسم يوحي بادعاء صحي.`,
      page: `اكتب صفحة منتج كاملة لـ${product}: عنوان، وصف، 5 نقاط بيعية، ` +
            `معالجة أهم 3 اعتراضات متوقعة، ودعوة للطلب. لا تخترع أرقاماً أو شهادات.`,
      bundles: `اقترح 4 باقات لـ${product} تناسب البيع بالدفع عند الاستلام، ` +
               `مع منطق تسعير كل باقة وليش رح ترفع متوسط الطلب.`,
      content: `اكتب خطة محتوى 30 يوم لصفحة فيسبوك تبيع ${product}: ` +
               `أنواع المنشورات، التكرار، وأفكار محددة. ركّز على بناء الثقة لأنه منتج غذائي.`,
      angles: `اقترح 6 زوايا إعلانية لـ${product} مختلفة عن زوايا المنافسين المذكورة، ` +
              `ولكل زاوية: الجمهور، الرسالة، وفكرة فيديو قصير.`,
      botreplies: `اكتب ردود جاهزة لبوت ماسنجر يبيع ${product}: الترحيب، السعر، التوصيل، ` +
                  `الصلاحية، الجودة، وطلب بيانات الطلب. لهجة أردنية ودودة ومختصرة.`
    };
    const ask = asks[what] || asks.identity;

    const r = await research(`${ctx}\n\nالمطلوب: ${ask}\n\n` +
      `إذا احتجت معلومة سوقية ابحث عنها. إذا ما احتجت، اكتب الجواب مباشرة بلا بحث.`, null);
    if (!r.ok) return res.status(502).json({ error: r.error || "فشل التوليد" });

    ok(res, { what, product, output: r.report, steps: r.steps, context: { category: cat.label, competitors: c.count } },
       { المصدر: "سياق مشروعك + المنافسين اللي سجّلتهم" + ((r.steps || []).length ? " + بحث ويب" : ""),
         "🔴": "راجع أي رقم أو ادعاء قبل النشر. المحتوى الغذائي فيه مسؤولية قانونية." });
  } catch (e) { boom(res, e, "فشل التوليد"); }
});

// ═══════════════════════════════════════════════════════════
// 🅴 الإطلاق والقرار (27–30)
// ═══════════════════════════════════════════════════════════

// 27) 🧪 خطة اختبار الإعلانات
router.post("/27/testplan", (req, res) => {
  try {
    const b = req.body || {};
    const u = unitEconomics(b);
    if (!u.ok) return bad(res, u.errors.join(" · "));
    const budget = Number(b.adTestBudget) || 150;
    const cpa = Number(b.adCostPerOrder) || DEFAULTS.adCostPerOrder;
    const expectedOrders = cpa > 0 ? Math.floor(budget / cpa) : 0;

    ok(res, {
      budget, expectedOrders, perOrder: u.perOrder,
      expectedResult: round(expectedOrders * u.perOrder),
      phases: [
        { المرحلة: "1 — إثبات الطلب", المدة: "5 أيام", الميزانية: round(budget * 0.3),
          الهدف: "هل في ناس بتسأل أصلاً؟",
          القرار: "أقل من 20 رسالة = الصنف أو الزاوية غلط. وقّف وغيّر." },
        { المرحلة: "2 — إثبات التحويل", المدة: "7 أيام", الميزانية: round(budget * 0.4),
          الهدف: "هل السائل بيتحوّل لطلب؟",
          القرار: "تحويل أقل من 15% = المشكلة بالسعر أو العرض مش بالإعلان." },
        { المرحلة: "3 — إثبات الربح", المدة: "10 أيام", الميزانية: round(budget * 0.3),
          الهدف: `هل كلفة الطلب بتضل تحت ${round(u.perOrder + cpa)}؟`,
          القرار: `كلفة طلب فوق ${round(u.perOrder + cpa)} = بتخسر مع كل طلب. وقّف.` }
      ],
      killCriteria: [
        `كلفة الطلب تجاوزت ${round(u.perOrder + cpa)} لمدة 3 أيام متتالية`,
        "أقل من 20 استفسار بأول 5 أيام",
        "تحويل الاستفسار لطلب تحت 10% بعد 50 استفسار",
        "نسبة المرتجعات فوق 25% — نموذج الدفع عند الاستلام ما بيمشي لهاد الصنف",
        "شكاوى جودة أو وصول تالف فوق 10% — أوقف فوراً وعالج التغليف والتوصيل"
      ],
      scaleCriteria: [
        `كلفة الطلب ثابتة تحت ${round((u.perOrder + cpa) * 0.7)}`,
        "تحويل استفسار لطلب فوق 25%",
        "مرتجعات تحت 12%",
        "ولا شكوى جودة خلال أول 50 طلب"
      ]
    }, {
      الأساس: `ربح الطلب ${u.perOrder} محسوب من مدخلاتك`,
      "🔴": "معايير الإيقاف أهم من معايير التوسع. أكثر الناس بتخسر لأنها ما وقّفت بالوقت."
    });
  } catch (e) { boom(res, e); }
});

// 28) ⚠️ سجل المخاطر
router.get("/28/risks", (req, res) => {
  try {
    const cat = String(req.query.category || "dry_shelf");
    const c = CATEGORIES[cat] || CATEGORIES.dry_shelf;
    const comp = competitorContext(req.query.project_id);
    const risks = [
      { خطر: "الفاقد أعلى من المتوقع", احتمال: c.spoilage > 8 ? "عالي" : "متوسط",
        الأثر: "بياكل الهامش بصمت", التخفيف: "ابدأ بدفعة صغيرة وقيس الفاقد الفعلي أول شهر" },
      { خطر: "المرتجعات بالدفع عند الاستلام", احتمال: "عالي",
        الأثر: "الأكل المرتجع خسارة كاملة", التخفيف: "أكّد كل طلب بمكالمة قبل الإرسال" },
      ...(c.coldChain ? [{ خطر: "انقطاع سلسلة التبريد", احتمال: "متوسط",
        الأثر: "🔴 خطر صحي ومسؤولية قانونية", التخفيف: "شركة توصيل مبرّدة + سجل حرارة" }] : []),
      { خطر: "رفض إعلانك على ميتا", احتمال: cat === "supplements" ? "عالي جداً" : "متوسط",
        الأثر: "توقف كامل للمبيعات", التخفيف: "نسخة إعلانية محافظة + حساب إعلاني احتياطي" },
      { خطر: "منافس بينزّل السعر", احتمال: comp.count > 5 ? "عالي" : "متوسط",
        الأثر: "حرب أسعار بتأكل الهامش", التخفيف: "ابنِ تمايز مش سعري من اليوم الأول" },
      { خطر: "شكوى صحية من زبون", احتمال: "منخفض", الأثر: "🔴 قد يوقف نشاطك بالكامل",
        التخفيف: "توثيق المصدر + بيانات كاملة + استجابة فورية لأي شكوى" },
      { خطر: "الفجوة النقدية", احتمال: "عالي",
        الأثر: "بتفلّس وإنت رابح على الورق", التخفيف: "احتفظ بسيولة تغطي دورتين تحصيل" }
    ];
    ok(res, { category: c.label, riskLevel: c.riskLevel, risks,
              criticalCount: risks.filter(r => String(r.الأثر).includes("🔴")).length },
       { المصدر: "قاعدة مخاطر غذائية + عدد منافسيك المرصودين" });
  } catch (e) { boom(res, e); }
});

// 29) 📊 لوحة القرار — كل شي بمكان واحد
router.post("/29/verdict", (req, res) => {
  try {
    const b = req.body || {};
    const u = unitEconomics(b);
    if (!u.ok) return bad(res, u.errors.join(" · "));
    const be = breakEven(b);
    const sc = scenarios(b);
    const bud = launchBudget(b);
    const cat = CATEGORIES[b.category] || CATEGORIES.dry_shelf;
    const comp = competitorContext(b.project_id);

    // درجة مركّبة — كل محور معلن ووزنه معلن
    const axes = [];
    const add = (name, score, why, w) => axes.push({ المحور: name, الدرجة: score, السبب: why, الوزن: w });

    add("ربحية الوحدة", u.perOrder <= 0 ? 0 : u.margin >= 30 ? 100 : u.margin >= 20 ? 70 : u.margin >= 10 ? 40 : 15,
        `هامش ${u.margin}% وربح ${u.perOrder} للطلب`, 0.30);
    const worst = (sc.rows || []).find(r => r.name === "متشائم");
    add("متانة السيناريو", worst && worst.ok && worst.monthlyProfit > 0 ? 100 : worst && worst.ok && worst.monthlyProfit > -200 ? 45 : 10,
        worst && worst.ok ? `بالمتشائم: ${worst.monthlyProfit}` : "غير محسوب", 0.25);
    add("سهولة التشغيل", cat.coldChain ? 30 : cat.spoilage > 10 ? 55 : 90,
        `${cat.label} — فاقد ${cat.spoilage}%${cat.coldChain ? "، يحتاج تبريد" : ""}`, 0.20);
    add("وضوح السوق", comp.count >= 8 ? 90 : comp.count >= 3 ? 60 : 25,
        `${comp.count} منافس مرصود`, 0.15);
    add("مستوى المخاطرة", cat.riskLevel === "منخفض" ? 95 : cat.riskLevel === "متوسط" ? 65 : 30,
        `خطورة الفئة: ${cat.riskLevel}`, 0.10);

    const score = round(axes.reduce((s, a) => s + a.الدرجة * a.الوزن, 0), 1);
    const verdict = u.perOrder <= 0
      ? { قرار: "🔴 لا تبدأ", سبب: "الأرقام خاسرة من الأساس. زيادة الحجم بتكبّر الخسارة." }
      : score >= 70
      ? { قرار: "🟢 ابدأ باختبار محدود", سبب: "الأرقام والمخاطر مقبولة. اختبر بميزانية صغيرة قبل التوسع." }
      : score >= 50
      ? { قرار: "🟠 عدّل قبل ما تبدأ", سبب: "في مشاكل قابلة للحل — راجع أضعف المحاور تحت." }
      : { قرار: "🔴 مش الآن", سبب: "أكثر من محور ضعيف. صنف تاني أو أرقام أفضل." };

    ok(res, {
      score, axes: axes.sort((a, b2) => a.الدرجة - b2.الدرجة), verdict,
      economics: { perOrder: u.perOrder, margin: u.margin, verdict: u.verdict },
      breakEven: be.impossible ? null : { orders: be.ordersToBreakEven, perDay: be.ordersPerDay },
      capital: { total: bud.totalNeeded, working: bud.workingCapital },
      weakest: axes.sort((a, b2) => a.الدرجة - b2.الدرجة)[0],
      confidence: confidence(comp.count, { low: 5, mid: 12 })
    }, {
      الأوزان: "ربحية 30% · متانة 25% · تشغيل 20% · وضوح السوق 15% · مخاطرة 10%",
      "🔴": "الدرجة أداة ترتيب أولويات مش نبوءة. الأرقام مدخلاتك إنت — لو غلط، الدرجة غلط."
    });
  } catch (e) { boom(res, e); }
});

// 30) 🗓️ خطة التنفيذ 30/90 يوم
router.post("/30/roadmap", (req, res) => {
  try {
    const b = req.body || {};
    const cat = CATEGORIES[b.category] || CATEGORIES.dry_shelf;
    const u = unitEconomics(b);
    const comp = competitorContext(b.project_id);
    ok(res, {
      week1: [
        "حدّد الصنف والفئة بدقة، واملأ كل أرقام التكلفة الحقيقية (لا تقديرات)",
        cat.coldChain ? "🔴 أمّن التبريد والتوصيل المبرّد قبل أي إشي تاني" : "أمّن تخزين جاف مناسب",
        `افتح مكتبة إعلانات ميتا وسجّل ${Math.max(5, 10 - comp.count)} منافس بأسعارهم وعروضهم`,
        "راجع قائمة الامتثال — أي بند حرج ناقص بيوقّفك لاحقاً"
      ],
      week2: [
        "جهّز الصفحة: اسم، صورة، وصف، بيانات تواصل واضحة",
        "صوّر المنتج فعلياً — صور حقيقية مش من الإنترنت",
        "اكتب سياسة الإرجاع والصلاحية بوضوح على الصفحة",
        "جهّز ردود البوت الجاهزة"
      ],
      week3: [
        "أطلق المرحلة 1 من خطة الاختبار — بميزانية صغيرة",
        "قيس: عدد الاستفسارات، سرعة ردك، تحويل الاستفسار لطلب",
        "لا تغيّر متغيّرين مع بعض — بتضيع السبب"
      ],
      week4: [
        "احسب الأرقام الفعلية: الفاقد الحقيقي، المرتجعات الحقيقية، كلفة الطلب الحقيقية",
        "قارنها بتقديراتك — الفرق هو أهم درس رح تتعلمه",
        u.ok ? `قرار: كلفة طلب فوق ${round(u.perOrder + (Number(b.adCostPerOrder) || 3))} = وقّف` : "قرار استمرار أو إيقاف"
      ],
      month2: [
        "وسّع اللي ثبت بس — الصنف اللي ما وصل تحويل 20% أوقفه",
        "اشتغل على الطلب الثاني: تكرار الشراء هو اللي بيبني تجارة غذائية",
        "ابنِ صنف مكمّل للي نجح"
      ],
      month3: [
        "راجع الفاقد والمرتجعات — كل نقطة تنزّلها ربح صافي",
        "شغّل تجارب A/B على الزاوية والعرض",
        "ابنِ قائمة زبائن متكررين — هدول أرخص مبيعات ممكن تعملها"
      ],
      note: cat.coldChain
        ? "🔴 فئتك بتحتاج تبريد — أي تأخير بتأمينه بيخلّي كل الجدول فوق بلا معنى"
        : "فئتك ما بتحتاج تبريد — هاي أكبر ميزة عندك، استغلها بالسرعة"
    }, { المصدر: "فئتك الغذائية + أرقامك + عدد منافسيك المرصودين" });
  } catch (e) { boom(res, e); }
});

// ── فهرس الخدمات الـ30 ──
router.get("/services", (req, res) => {
  ok(res, {
    groups: [
      { المجموعة: "الاكتشاف والتحقق", الخدمات: [
        "1 تصنيف الصنف الغذائي", "2 كاشف المنافسين", "3 سجل المنافسين",
        "4 فجوة السوق", "5 إشارة الطلب من بياناتك", "6 بحث سوق حقيقي"] },
      { المجموعة: "الاقتصاديات", الخدمات: [
        "7 اقتصاديات الوحدة", "8 نقطة التعادل", "9 تسعير عكسي",
        "10 السيناريوهات", "11 ميزانية الإطلاق", "12 تشخيص وإصلاح"] },
      { المجموعة: "التوريد والامتثال", الخدمات: [
        "13 قائمة الامتثال", "14 سياسة إعلانات ميتا", "15 التبريد والتخزين", "16 حاسبة الفاقد"] },
      { المجموعة: "المنتج والعرض", الخدمات: [
        "17 الموقع التنافسي", "18 بناء العرض", "19 الهوية والاسم",
        "20 صفحة المنتج", "21 الباقات"] },
      { المجموعة: "الصفحة والمحتوى", الخدمات: [
        "22 خطة المحتوى", "23 الزوايا الإعلانية", "24 ردود البوت",
        "25 سيناريوهات الفيديو", "26 بناء الصفحة"] },
      { المجموعة: "الإطلاق والقرار", الخدمات: [
        "27 خطة اختبار الإعلانات", "28 سجل المخاطر", "29 لوحة القرار", "30 خطة 30/90 يوم"] }
    ],
    note: "الخدمات 19–26 بتشتغل من نقطة /19/build بمعامل what مختلف"
  });
});

export { competitorContext };
