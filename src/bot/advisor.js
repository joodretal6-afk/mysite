// ═══════════════════════════════════════════════════════════
// 🧠 مستشار المبيعات — خبير أعمال يدردش مع صاحب المشروع داخل اللوحة
// - يرى بيانات الشغل الحقيقية (مبيعات، ذروة، إلغاءات، أداء الصفحات، الأهداف)
// - أي هدف يتفق عليه معك يكتبه بصيغة [[GOAL:{...}]] فيُحفظ تلقائياً بصفحة الأهداف
// - يعمل على نفس مفتاح/كود Gemini تبع البوت
// ═══════════════════════════════════════════════════════════
import { CONFIG } from "../config.js";
import { salesReport, topProducts, peakHeatmap, cancelReasonsReport, perPageStats,
         listGoalsWithProgress, addGoal, reviewStats } from "../db/database.js";

const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

const ADVISOR_PERSONA = `أنت "المستشار" — خبير مبيعات وتطوير أعمال أردني محترف، فنان بالمبيعات، شغلك تحويل مشاريع البيع عبر السوشال ميديا لآلات بيع منظمة.
أنت مستشار شخصي لصاحب مشروع بيع (أجبان بلدية + مواد تنظيف) عبر بوت ماسنجر ذكي وموقع إدارة.

━━ أسلوبك ━━
- لهجة أردنية مهنية ودافئة، مباشر وواضح، بدون حشو.
- ردودك منظمة وقصيرة نسبياً: نقاط عملية قابلة للتنفيذ، مش محاضرات.
- اعتمد حصرياً على الأرقام الحقيقية المعطاة لك أدناه — لا تخترع أرقاماً. إذا البيانات قليلة قلها بصراحة وابنِ على الموجود.
- شخّص الضعف بصراحة (وقات ميتة، صفحات ضعيفة، نسبة تسرّب، أسباب إلغاء) واقترح علاجاً عملياً لكل نقطة.
- فكّر كمدير مبيعات: أهداف رقمية، خطوات أسبوعية، مؤشرات متابعة.

━━ إنشاء الأهداف (مهم جداً) ━━
عندما تتفقان على هدف (أو يطلب صاحب المشروع هدفاً)، أنهِ ردّك بسطر منفصل بهذه الصيغة بالضبط (JSON صالح):
[[GOAL:{"title":"عنوان قصير للهدف","target":100000,"metric":"revenue","days":90,"plan":"المطلوب لتحقيقه: 1) ... 2) ... 3) ..."}]]
- metric: "revenue" لهدف مبيعات بالدينار، أو "orders" لهدف عدد طلبات.
- days: مدة الهدف بالأيام من اليوم.
- plan: خطة مختصرة عملية (ماذا يلزم يومياً/أسبوعياً لتحقيقه — احسبها من أرقامه الفعلية).
- لا تضع هذا السطر إلا عند إنشاء هدف فعلي متفق عليه. يمكنك وضع أكثر من سطر GOAL إذا لزم.
- قبل السطر اشرح للمالك الهدف وخطته بالعربي عادي.

━━ حدودك ━━
- موضوعك: تطوير هذا المشروع ومبيعاته فقط (تسويق، تسعير، عروض، خدمة زبائن، توسّع). أي سؤال خارج الشغل رُدّه بلطف لموضوع العمل.`;

// يبني ملخّص البيانات الحقيقية الحيّة للمستشار
export function buildBusinessSnapshot() {
  const parts = [];
  try {
    const r = salesReport();
    parts.push(`📊 المبيعات (طلبات مكتملة): اليوم ${r.today.c} طلب/${Math.round(r.today.s)}د — آخر 7 أيام ${r.week.c}/${Math.round(r.week.s)}د — آخر 30 يوم ${r.month.c}/${Math.round(r.month.s)}د — الإجمالي ${r.all.c}/${Math.round(r.all.s)}د.`);
    const avg = r.month.c > 0 ? Math.round(r.month.s / r.month.c * 10) / 10 : 0;
    parts.push(`💰 متوسط قيمة الطلب (آخر 30 يوم): ${avg}د.`);
  } catch {}
  try {
    const tp = topProducts(5);
    if (tp.length) parts.push("🏆 الأكثر مبيعاً: " + tp.map(p => `${p.product} (${p.qty})`).join("، ") + ".");
  } catch {}
  try {
    const grid = peakHeatmap();
    const flat = [];
    grid.forEach((row, d) => row.forEach((v, h) => { if (v > 0) flat.push({ d, h, v }); }));
    flat.sort((a, b) => b.v - a.v);
    if (flat.length) {
      parts.push("🔥 أوقات الذروة: " + flat.slice(0, 4).map(x => `${DAYS[x.d]} س${x.h} (${x.v})`).join("، ") + ".");
      const deadDays = grid.map((row, d) => ({ d, t: row.reduce((a, b) => a + b, 0) })).sort((a, b) => a.t - b.t).slice(0, 2);
      parts.push("😴 أضعف الأيام: " + deadDays.map(x => `${DAYS[x.d]} (${x.t} طلب)`).join("، ") + ".");
    }
  } catch {}
  try {
    const pp = perPageStats() || [];
    if (pp.length) parts.push("📄 أداء الصفحات: " + pp.map(p => `${p.page_name}: ${p.count} طلب/${Math.round(p.sum)}د`).join(" — ") + ".");
  } catch {}
  try {
    const cr = cancelReasonsReport();
    if (cr.length) parts.push("❌ أسباب الإلغاء: " + cr.slice(0, 5).map(x => `${x.reason} (${x.count})`).join("، ") + ".");
  } catch {}
  try {
    const rs = reviewStats();
    if (rs && rs.c > 0) parts.push(`⭐ التقييمات: متوسط ${Math.round(rs.avg * 10) / 10}/5 من ${rs.c} تقييم.`);
  } catch {}
  try {
    const goals = listGoalsWithProgress().filter(g => g.status === "نشط");
    if (goals.length) parts.push("🎯 الأهداف النشطة: " + goals.map(g =>
      `«${g.title}» ${g.current}/${g.target}${g.metric === "orders" ? " طلب" : "د"} (${g.pct}%، باقي ${g.daysLeft} يوم)`).join(" — ") + ".");
    else parts.push("🎯 لا توجد أهداف نشطة حالياً.");
  } catch {}
  return parts.join("\n");
}

// استخراج أسطر [[GOAL:{...}]] من رد المستشار وحفظها
export function extractAndSaveGoals(reply) {
  const created = [];
  const re = /\[\[GOAL:(\{[\s\S]*?\})\]\]/g;
  let m;
  while ((m = re.exec(reply)) !== null) {
    try {
      const g = JSON.parse(m[1]);
      if (!g.title || !g.target) continue;
      const days = Math.max(1, Number(g.days) || 30);
      const id = addGoal({
        title: g.title, target: g.target, metric: g.metric === "orders" ? "orders" : "revenue",
        to_at: Date.now() + days * 86400000, plan: g.plan || ""
      });
      created.push({ id, title: g.title, target: g.target });
    } catch (e) { console.error("goal parse:", e && e.message); }
  }
  const clean = reply.replace(re, "").trim();
  return { clean, created };
}

// محادثة المستشار (نفس كود/مفتاح Gemini تبع البوت)
export async function askAdvisor(history) {
  const sys = ADVISOR_PERSONA + "\n\n━━ بيانات الشغل الحقيقية الآن (حدّثت لحظة السؤال) ━━\n" + buildBusinessSnapshot();
  const contents = (history || []).slice(-24).map(h => ({
    role: h.role === "assistant" ? "model" : "user",
    parts: [{ text: String(h.content || "").slice(0, 4000) }]
  }));
  // يمرّ من الطبقة الموحّدة — يشتغل بأي مزوّد مربوط (AIsa أو Gemini)
  const { aiComplete } = await import("./aiCore.js");
  const convo = contents.map(c => {
    const who = c.role === "model" ? "المستشار" : "التاجر";
    return `${who}: ${(c.parts || []).map(p => p.text || "").join("")}`;
  }).join("\n\n");
  const res = await aiComplete(`${sys}\n\n━━ المحادثة ━━\n${convo}`,
    { temperature: 0.5, maxTokens: 1200, timeoutMs: 45000 });
  if (!res.ok) throw new Error(res.error || "فشل الذكاء الاصطناعي");
  const raw = String(res.text || "").replace(/\*\*/g, "").trim();
  const { clean, created } = extractAndSaveGoals(raw);
  return { reply: clean || "تمام، خبّرني أكثر عن وضع الشغل.", createdGoals: created };
}
