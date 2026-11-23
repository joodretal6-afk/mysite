// ═══════════════════════════════════════════════════════════
// 🧠 EMPIRE INTELLIGENCE — الذكاء الاستراتيجي للمنصة
//
// يجمع حقائق الأعمال الفعلية من قاعدة البيانات، ويمرّرها لطبقة
// الذكاء الموحّدة ليحلّلها ويجاوب أسئلة التاجر الاستراتيجية
// («لماذا انخفضت الأرباح؟»، «أي منتج أزيد ميزانيته؟»…).
//
// 🔴 قواعد صارمة: المحلل يستخدم الأرقام المعطاة فقط، يذكر مصدر كل
//    استنتاج، يوسم التوقعات كتقديرات، ولا يدّعي أنه نفّذ أي إجراء.
//    وضع القراءة فقط — لا تنفيذ. وعند غياب الذكاء نرجّع الحقائق خام.
// ═══════════════════════════════════════════════════════════
import { Router } from "express";
import express from "express";
import {
  profitReport, topProducts, perPageStats, cancelReasonsReport,
  salesReport, dashboardData, ordersStats
} from "../db/database.js";

export const slug = "empireai";
export const title = "الذكاء الاستراتيجي";
export const icon = "🧠";

const DAY = 86400000;
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const pct = (now, before) => {
  now = Number(now) || 0; before = Number(before) || 0;
  if (!before) return now ? 100 : 0;
  return Math.round(((now - before) / before) * 100);
};

function monthRange(offset = 0) {
  const d = new Date();
  const from = new Date(d.getFullYear(), d.getMonth() + offset, 1).getTime();
  const to = new Date(d.getFullYear(), d.getMonth() + offset + 1, 1).getTime();
  return { from, to };
}

// ═══ جمع حقائق الأعمال الحقيقية (كلها من دوال موجودة) ═══
export function gatherStrategicFacts() {
  const facts = [];       // أسطر نصية للذكاء
  const sources = [];     // المصادر المستخدمة
  const data = {};        // للعرض المنظّم بالواجهة

  // 1) المبيعات: اليوم/الأسبوع/الشهر/الكل
  try {
    const s = salesReport();
    data.sales = s;
    facts.push(`المبيعات (باستثناء الملغي): اليوم ${r2(s.today.s)}د (${s.today.c} طلب)، الأسبوع ${r2(s.week.s)}د (${s.week.c})، الشهر ${r2(s.month.s)}د (${s.month.c})، الإجمالي ${r2(s.all.s)}د (${s.all.c}).`);
    sources.push("salesReport()");
  } catch {}

  // 2) الأرباح: هذا الشهر مقابل الشهر الماضي (إيراد/تكلفة/ربح)
  try {
    const cur = profitReport(monthRange(0));
    const prev = profitReport(monthRange(-1));
    data.profit = { current: cur, previous: prev,
      revenue_change: pct(cur.revenue, prev.revenue), profit_change: pct(cur.profit, prev.profit) };
    facts.push(`الأرباح هذا الشهر: إيراد ${r2(cur.revenue)}د، تكلفة بضاعة ${r2(cur.cost)}د، صافي ${r2(cur.profit)}د من ${cur.orders} طلب. الشهر الماضي: إيراد ${r2(prev.revenue)}د، صافي ${r2(prev.profit)}د. تغيّر الإيراد ${pct(cur.revenue, prev.revenue)}% والصافي ${pct(cur.profit, prev.profit)}%.`);
    sources.push("profitReport() لهذا الشهر والماضي");
  } catch {}

  // 3) مؤشرات التشغيل (إكمال، متوسط طلب، عملاء)
  try {
    const dash = dashboardData({ days: 30 });
    data.metrics = dash.metrics; data.series = dash.series;
    const m = dash.metrics || {};
    facts.push(`آخر 30 يوم: نسبة إكمال الطلبات ${m.completion ?? "?"}%، متوسط الطلب ${r2(m.avg_order)}د، عملاء عائدون ${m.returning ?? "?"}، عملاء جدد ${m.new_customers ?? "?"}.`);
    sources.push("dashboardData({days:30})");
  } catch {}

  // 4) أفضل المنتجات والأضعف
  try {
    const top = topProducts(20);
    data.top_products = top.slice(0, 8);
    if (top.length) {
      facts.push(`أكثر المنتجات مبيعاً (بالكمية): ${top.slice(0, 6).map(p => `${p.product} (${p.qty})`).join("، ")}.`);
      if (top.length > 6) {
        data.weak_products = top.slice(-5);
        facts.push(`أضعف المنتجات مبيعاً: ${top.slice(-5).map(p => `${p.product} (${p.qty})`).join("، ")}.`);
      }
      sources.push("topProducts()");
    }
  } catch {}

  // 5) أداء الصفحات
  try {
    const pages = perPageStats().filter(p => p.count > 0).sort((a, b) => b.sum - a.sum).slice(0, 10);
    data.pages = pages;
    if (pages.length) {
      facts.push(`أداء الصفحات (إجمالي): ${pages.map(p => `${p.page_name} (${p.count} طلب، ${r2(p.sum)}د)`).join("، ")}.`);
      sources.push("perPageStats()");
    }
  } catch {}

  // 6) أسباب الإلغاء
  try {
    const cr = cancelReasonsReport();
    data.cancel_reasons = cr;
    if (cr && cr.length) {
      facts.push(`أسباب الإلغاء الأكثر تكراراً: ${cr.slice(0, 6).map(x => `${x.reason || "غير مذكور"} (${x.count})`).join("، ")}.`);
      sources.push("cancelReasonsReport()");
    }
  } catch {}

  // 7) الإجمالي العام
  try { const o = ordersStats(); data.orders_total = o.total; facts.push(`إجمالي الطلبات التاريخي: ${o.total.c} طلب بقيمة ${r2(o.total.s)}د.`); } catch {}

  return { text: facts.join("\n"), sources, data };
}

async function askAI(prompt, maxTokens = 1100) {
  try {
    const { aiComplete } = await import("../bot/aiCore.js");
    const r = await aiComplete(prompt, { temperature: 0.35, maxTokens, timeoutMs: 45000 });
    if (!r || !r.ok) return null;
    return String(r.text || "").replace(/\*\*/g, "").trim() || null;
  } catch { return null; }
}

const ANALYST_RULES =
  "أنت محلّل أعمال استراتيجي لتاجر أردني يبيع أجبان بلدية ومواد تنظيف عبر صفحات فيسبوك.\n" +
  "التزم بالقواعد التالية حرفياً:\n" +
  "1) استخدم الأرقام الواردة في «الحقائق» فقط. ممنوع منعاً باتاً اختراع أي رقم غير موجود.\n" +
  "2) اربط كل استنتاج بالرقم الذي يدعمه (مثال: «الصافي نزل 18% لأن التكلفة ارتفعت من كذا لكذا»).\n" +
  "3) إن كان رقم ما غير متوفر، قل صراحة «البيانات غير كافية لهذا» بدل التخمين.\n" +
  "4) أي توقّع مستقبلي وسمه بوضوح كـ(تقدير) وليس نتيجة فعلية.\n" +
  "5) اختم بـ«خطوات مقترحة» عملية قصيرة قابلة للتنفيذ (2-4 نقاط).\n" +
  "6) لا تدّعِ أنك نفّذت أي إجراء — أنت تحلّل وتنصح فقط.\n" +
  "7) عربية فصيحة مبسّطة، مختصرة ومنظّمة بنقاط، بلا Markdown معقّد.\n";

const PRESETS = [
  "لماذا تغيّرت أرباح هذا الشهر مقارنة بالماضي؟",
  "ما المنتجات التي تستحق زيادة ميزانيتها الإعلانية ولماذا؟",
  "ما المنتجات الضعيفة التي يجب مراجعتها أو إيقافها؟",
  "أي صفحة هي الأفضل أداءً وأين فرص النمو؟",
  "ما أبرز المشاكل التشغيلية التي تضيّع عليّ مبيعات؟",
  "ما أهم 3 قرارات يجب أن أتخذها هذا الأسبوع؟"
];

export const router = Router();
router.use(express.json({ limit: "1mb" }));

router.get("/facts", (req, res) => {
  try { const f = gatherStrategicFacts(); res.json({ ok: true, ...f }); }
  catch (e) { res.status(500).json({ ok: false, error: e && e.message }); }
});

router.get("/presets", (req, res) => res.json({ ok: true, presets: PRESETS }));

// السؤال الاستراتيجي — يحلّل الأرقام الحقيقية ويجيب بأدلة ومصادر
router.post("/ask", async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim().slice(0, 500);
    if (!question) return res.status(400).json({ ok: false, error: "اكتب سؤالك" });
    const facts = gatherStrategicFacts();
    const prompt = `${ANALYST_RULES}\nسؤال صاحب العمل:\n«${question}»\n\nالحقائق (أرقامه الفعلية):\n${facts.text}\n\nاكتب التحليل الآن ملتزماً بالقواعد:`;
    const answer = await askAI(prompt);
    res.json({
      ok: true,
      question,
      answer: answer || null,
      ai_available: !!answer,
      note: answer ? null : "الذكاء الاصطناعي غير مربوط حالياً — هذه هي الأرقام الحقيقية للتحليل اليدوي.",
      sources: facts.sources,
      facts: facts.text,
      data: facts.data
    });
  } catch (e) {
    console.error("empireai/ask:", e && e.message);
    res.status(500).json({ ok: false, error: "تعذّر التحليل" });
  }
});
