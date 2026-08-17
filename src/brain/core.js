// ═══════════════════════════════════════════════════════════
// 🧠 نواة عقل المبيعات (brain/core)
// كل المحركات الـ20 بتشتغل فوق هاي النواة. القاعدة الذهبية هون:
// أي رقم بنطلعه لازم يجي معه `basis` — على أي بيانات انبنى.
// بلا basis الرقم بيصير تخمين، والتاجر بياخد قرار غلط وهو واثق.
// ═══════════════════════════════════════════════════════════
import { db, retryDb } from "../db/database.js";

export const DAY_MS = 86400000;
export const CANCEL = "ملغي";
export const WINDOW_MS = 24 * 3600 * 1000;   // نافذة فيسبوك للرد

// ── مدى زمني آمن من الاستعلام ──
export function since(req, dflt = 30, max = 365) {
  let d = Number(req && req.query && req.query.days);
  if (!Number.isFinite(d) || d < 1 || d > max) d = dflt;
  return { days: d, from: Date.now() - d * DAY_MS };
}

export function round(n, p = 2) {
  const f = Math.pow(10, p);
  return Math.round((Number(n) || 0) * f) / f;
}
export function pct(part, whole, p = 1) {
  const w = Number(whole) || 0;
  if (!w) return 0;
  return round((Number(part) || 0) * 100 / w, p);
}

// ═══════════════════════════════════════════════════════════
// مستوى الثقة — مش زينة. التاجر لازم يعرف إمتى ما يعتمد علينا.
// عيّنة صغيرة = ثقة منخفضة، ومنقولها بصوت عالي مش بخط صغير.
// ═══════════════════════════════════════════════════════════
export function confidence(sampleSize, opts = {}) {
  const n = Number(sampleSize) || 0;
  const low = opts.low || 30, mid = opts.mid || 100;
  if (n < 10) return { level: "لا تكفي", score: 0, n, note: `${n} حالة فقط — مش كافية لأي استنتاج` };
  if (n < low) return { level: "منخفضة", score: 1, n, note: `${n} حالة — مؤشر مبدئي، لا تبني عليه قراراً كبيراً` };
  if (n < mid) return { level: "متوسطة", score: 2, n, note: `${n} حالة — كافية للاختبار، مش كافية للتعميم` };
  return { level: "عالية", score: 3, n, note: `${n} حالة — عيّنة كافية` };
}

// ═══════════════════════════════════════════════════════════
// تفكيك order_string: "غنم (2 نصية) + لبنة (1 كيلو)"
// ═══════════════════════════════════════════════════════════
export function parseItems(orderString) {
  const items = [];
  String(orderString || "").split("+").forEach(part => {
    const p = part.trim();
    if (!p) return;
    const m = p.match(/(.+?)\s*\((\d+)\s*([^)]*)/);
    if (m) items.push({ name: m[1].trim(), qty: parseInt(m[2], 10) || 1, unit: (m[3] || "").trim() });
    else items.push({ name: p, qty: 1, unit: "" });
  });
  return items;
}

// ═══════════════════════════════════════════════════════════
// 🗣️ معجم الإشارات — قلب قراءة المحادثات
// هاد معجم عربي/عامّي شامي-أردني لأنه هيك بيحكي زباينك فعلياً.
// كل إشارة إلها وزن، والوزن مضبوط يدوياً ثم بيتعدّل بالتعلّم (brain/learn).
// ═══════════════════════════════════════════════════════════
export const SIGNALS = {
  // ── نية شراء صاعدة ──
  intent_hot: {
    label: "جاهز للشراء", weight: 34,
    words: ["بدي اطلب", "بدي أطلب", "اطلب", "أطلب", "احجزلي", "احجز لي", "ابعتلي", "ابعث لي",
            "بكم التوصيل", "وين بتوصلو", "متى بيوصل", "بدفع", "كاش", "رقمي", "عنواني",
            "اتفقنا", "ماشي ابعت", "تمام ابعت", "خلص ابعت", "اوكي ابعت"]
  },
  intent_warm: {
    label: "مهتم", weight: 18,
    words: ["كم سعر", "قديش", "شو السعر", "بكم", "متوفر", "في عندكم", "موجود",
            "الوان", "ألوان", "مقاسات", "المقاس", "الحجم", "الكمية", "شو الفرق", "احسن وحدة"]
  },
  intent_cold: {
    label: "فضولي", weight: 5,
    words: ["شو هاد", "شو هذا", "مرحبا", "السلام عليكم", "هلا", "بستفسر", "استفسار", "شو عندكم"]
  },

  // ── الاعتراضات: منجم الفلوس الضائعة ──
  obj_price: {
    label: "السعر", weight: -22, kind: "objection",
    words: ["غالي", "غالية", "كتير", "كثير عليه", "مش قادر", "ما بقدر ادفع", "في ارخص",
            "أرخص", "ارخص", "خصم", "تنزيل", "نزلي", "احسن سعر", "اخر سعر", "آخر سعر", "غالي شوي"]
  },
  obj_shipping: {
    label: "التوصيل", weight: -18, kind: "objection",
    words: ["التوصيل غالي", "اجرة التوصيل", "الشحن غالي", "كم التوصيل", "بعيد", "ما بتوصلو",
            "ما بتوصلوا", "منطقتي", "بتوصلوش", "التوصيل كثير", "التوصيل كتير"]
  },
  obj_stock: {
    label: "عدم التوفر", weight: -20, kind: "objection",
    words: ["مش متوفر", "ما في", "خلص", "خلصان", "نفذ", "لما يتوفر", "امتى بيوصل", "متى بيرجع"]
  },
  obj_trust: {
    label: "الثقة والجودة", weight: -15, kind: "objection",
    words: ["اصلي", "أصلي", "تقليد", "مضمون", "ضمان", "بدي اشوف", "صور حقيقية", "فيديو",
            "جودة", "نوعية", "بترجعو", "استبدال", "تجربة"]
  },
  obj_hesitation: {
    label: "التردد", weight: -12, kind: "objection",
    words: ["بفكر", "رح افكر", "بشوف", "بحكيلك", "بخبرك", "لاحقا", "لاحقاً", "بعدين",
            "استشير", "بسأل", "مش متأكد", "خليني اشوف"]
  },
  obj_delay: {
    label: "بطء الرد", weight: -10, kind: "objection",
    words: ["ما رديتو", "وينكم", "من امبارح", "من زمان", "ما في رد", "حدا موجود", "في حدا"]
  },

  // ── إشارات القيمة ──
  val_bulk: { label: "شراء بالجملة", weight: 12, words: ["جملة", "كمية", "كرتونة", "بالجملة", "عدة قطع"] },
  val_repeat: { label: "زبون راجع", weight: 15, words: ["زي المرة الماضية", "نفس الطلب", "زي قبل", "مثل السابق", "طلبت منكم قبل"] }
};

export const OBJECTIONS = Object.entries(SIGNALS)
  .filter(([, s]) => s.kind === "objection")
  .map(([key, s]) => ({ key, label: s.label, weight: s.weight }));

// ── مطابقة نص واحد مقابل كل الإشارات ──
export function scanText(text) {
  const t = String(text || "").toLowerCase();
  if (!t) return { hits: [], score: 0 };
  const hits = [];
  for (const [key, sig] of Object.entries(SIGNALS)) {
    for (const w of sig.words) {
      if (t.includes(w)) {
        hits.push({ key, label: sig.label, weight: sig.weight, matched: w, kind: sig.kind || "intent" });
        break;   // إشارة وحدة لكل نوع بكل رسالة — ما منكرّر الوزن
      }
    }
  }
  return { hits, score: hits.reduce((s, h) => s + h.weight, 0) };
}

// ═══════════════════════════════════════════════════════════
// 📥 محمّلات البيانات المشتركة (كل محرك بيبني عليها)
// ═══════════════════════════════════════════════════════════

// كل رسائل الفترة مجمّعة حسب المحادث
export function conversations(from, opts = {}) {
  const limit = Math.min(200000, opts.limit || 60000);
  const rows = retryDb(() => db.prepare(
    `SELECT page_id, page_name, sender_id, direction, body, created_at
     FROM messages WHERE created_at >= ? ORDER BY created_at ASC LIMIT ?`
  ).all(from, limit));

  const map = new Map();
  for (const r of rows) {
    const key = r.page_id + "|" + r.sender_id;
    let c = map.get(key);
    if (!c) {
      c = { key, page_id: r.page_id, page_name: r.page_name || "", sender_id: r.sender_id,
            msgs: [], inCount: 0, outCount: 0, first_at: Number(r.created_at) || 0,
            last_at: 0, last_in_at: 0, first_out_at: 0 };
      map.set(key, c);
    }
    const at = Number(r.created_at) || 0;
    c.msgs.push({ dir: r.direction, body: r.body || "", at });
    if (r.direction === "in") { c.inCount++; c.last_in_at = at; }
    else { c.outCount++; if (!c.first_out_at) c.first_out_at = at; }
    if (at > c.last_at) c.last_at = at;
  }
  return [...map.values()];
}

// طلبات الفترة (غير الملغاة افتراضياً)
export function orders(from, opts = {}) {
  const includeCancelled = !!opts.includeCancelled;
  const sql = `SELECT id, page_id, page_name, sender_id, order_string, total, area, phone, status, created_at
               FROM orders WHERE created_at >= ?` + (includeCancelled ? "" : ` AND status <> '${CANCEL}'`);
  return retryDb(() => db.prepare(sql).all(from));
}

// خريطة تكلفة المنتجات — أساس كل حساب ربح
export function costMap() {
  const m = new Map();
  try {
    for (const r of retryDb(() => db.prepare("SELECT product, cost FROM product_costs").all()))
      m.set(String(r.product).trim(), Number(r.cost) || 0);
  } catch { /* الجدول ممكن يكون فاضي */ }
  return m;
}

// ═══════════════════════════════════════════════════════════
// 📦 إحصاءات المنتجات — يخدم الترتيب والرادار والتسعير
// بيربط: الطلب الفعلي + الاستفسارات بالمحادثات + الربح + الإلغاء
// ═══════════════════════════════════════════════════════════
export function productStats(from) {
  const costs = costMap();
  const stats = new Map();
  const get = name => {
    let s = stats.get(name);
    if (!s) {
      s = { product: name, qty: 0, orders: 0, revenue: 0, cost: 0, profit: 0,
            cancelled: 0, buyers: new Set(), mentions: 0, mentioners: new Set(), firstSeen: 0 };
      stats.set(name, s);
    }
    return s;
  };

  // 1) من الطلبات الفعلية
  const all = retryDb(() => db.prepare(
    `SELECT sender_id, order_string, total, status, created_at FROM orders WHERE created_at >= ?`
  ).all(from));
  for (const o of all) {
    const items = parseItems(o.order_string);
    if (!items.length) continue;
    const totalQty = items.reduce((s, i) => s + i.qty, 0) || 1;
    for (const it of items) {
      const s = get(it.name);
      if (o.status === CANCEL) { s.cancelled++; continue; }
      s.qty += it.qty;
      s.orders++;
      if (o.sender_id) s.buyers.add(o.sender_id);
      // توزيع إجمالي الطلب على الأصناف بالنسبة للكمية — تقريب، ومعلن كتقريب
      const share = (Number(o.total) || 0) * (it.qty / totalQty);
      s.revenue += share;
      s.cost += (costs.get(it.name) || 0) * it.qty;
    }
  }

  // 2) الاستفسارات من المحادثات — إشارة الطلب المبكرة
  const names = [...stats.keys()];
  if (names.length) {
    const msgs = retryDb(() => db.prepare(
      `SELECT sender_id, body, created_at FROM messages
       WHERE direction = 'in' AND created_at >= ? LIMIT 60000`
    ).all(from));
    for (const m of msgs) {
      const b = String(m.body || "").toLowerCase();
      if (!b) continue;
      for (const n of names) {
        if (n && b.includes(String(n).toLowerCase())) {
          const s = stats.get(n);
          s.mentions++;
          if (m.sender_id) s.mentioners.add(m.sender_id);
          if (!s.firstSeen) s.firstSeen = Number(m.created_at) || 0;
        }
      }
    }
  }

  return [...stats.values()].map(s => {
    const revenue = round(s.revenue);
    const cost = round(s.cost);
    const askers = s.mentioners.size;
    return {
      product: s.product,
      qty: s.qty,
      orders: s.orders,
      revenue,
      cost,
      profit: round(revenue - cost),
      margin: revenue ? pct(revenue - cost, revenue) : 0,
      buyers: s.buyers.size,
      repeatRate: s.buyers.size ? round(s.orders / s.buyers.size, 2) : 0,
      mentions: s.mentions,
      askers,
      // معدل تحويل الاستفسار → طلب. أهم رقم بالمنتج وأكثر واحد بينتبهلوش التاجر.
      askToOrder: askers ? pct(s.buyers.size, askers) : null,
      cancelled: s.cancelled,
      cancelRate: (s.orders + s.cancelled) ? pct(s.cancelled, s.orders + s.cancelled) : 0,
      hasCost: cost > 0
    };
  });
}

// ═══════════════════════════════════════════════════════════
// 👤 إحصاءات الزبائن — أساس Customer Brain / DNA / CLV / Churn
// ═══════════════════════════════════════════════════════════
export function customerStats(from) {
  const convs = conversations(from);
  const convByKey = new Map(convs.map(c => [c.sender_id, c]));

  const ords = retryDb(() => db.prepare(
    `SELECT sender_id, page_id, page_name, order_string, total, status, area, phone, created_at
     FROM orders WHERE created_at >= ? AND sender_id IS NOT NULL`
  ).all(from));

  const map = new Map();
  const get = (sid, pid, pname) => {
    let c = map.get(sid);
    if (!c) {
      c = { sender_id: sid, page_id: pid || "", page_name: pname || "",
            orders: 0, cancelled: 0, spend: 0, products: new Map(), areas: new Set(),
            firstOrder: 0, lastOrder: 0, gaps: [] };
      map.set(sid, c);
    }
    return c;
  };

  for (const o of ords) {
    const c = get(o.sender_id, o.page_id, o.page_name);
    const at = Number(o.created_at) || 0;
    if (o.status === CANCEL) { c.cancelled++; continue; }
    c.orders++;
    c.spend += Number(o.total) || 0;
    if (o.area) c.areas.add(o.area);
    for (const it of parseItems(o.order_string))
      c.products.set(it.name, (c.products.get(it.name) || 0) + it.qty);
    if (!c.firstOrder || at < c.firstOrder) c.firstOrder = at;
    if (at > c.lastOrder) { c.gaps.push(at); c.lastOrder = at; }
  }

  // ضمّ المحادثين اللي ما طلبوا — هدول أهم ناس بالنظام كله
  for (const cv of convs) if (!map.get(cv.sender_id)) get(cv.sender_id, cv.page_id, cv.page_name);

  const now = Date.now();
  return [...map.values()].map(c => {
    const conv = convByKey.get(c.sender_id);
    const scan = conv ? scanConversation(conv) : { intent: 0, objections: [], stage: "لم يتحدث" };
    const gaps = c.gaps.sort((a, b) => a - b);
    let avgGapDays = null;
    if (gaps.length > 1) {
      let sum = 0;
      for (let i = 1; i < gaps.length; i++) sum += gaps[i] - gaps[i - 1];
      avgGapDays = round(sum / (gaps.length - 1) / DAY_MS, 1);
    }
    const spend = round(c.spend);
    return {
      sender_id: c.sender_id,
      page_id: c.page_id,
      page_name: c.page_name,
      orders: c.orders,
      cancelled: c.cancelled,
      spend,
      aov: c.orders ? round(spend / c.orders) : 0,
      products: [...c.products.entries()].map(([name, qty]) => ({ name, qty }))
                  .sort((a, b) => b.qty - a.qty),
      areas: [...c.areas],
      firstOrder: c.firstOrder,
      lastOrder: c.lastOrder,
      daysSinceOrder: c.lastOrder ? Math.floor((now - c.lastOrder) / DAY_MS) : null,
      avgGapDays,
      messagesIn: conv ? conv.inCount : 0,
      lastSeen: conv ? conv.last_at : c.lastOrder,
      intent: scan.intent,
      stage: scan.stage,
      objections: scan.objections,
      replyDelayMin: conv ? replyDelayMin(conv) : null
    };
  });
}

// ── قراءة محادثة واحدة: نية + مرحلة + اعتراضات ──
export function scanConversation(conv) {
  let score = 0;
  const objections = new Map();
  const reasons = [];
  const msgs = (conv.msgs || []).filter(m => m.dir === "in");

  msgs.forEach((m, i) => {
    const { hits } = scanText(m.body);
    // الرسائل الأحدث أثقل — النية بتتغير، وآخر كلمة أصدق من أول كلمة
    const recency = 0.5 + 0.5 * ((i + 1) / Math.max(1, msgs.length));
    for (const h of hits) {
      score += h.weight * recency;
      if (h.kind === "objection") objections.set(h.key, (objections.get(h.key) || 0) + 1);
      if (reasons.length < 12) reasons.push({ label: h.label, matched: h.matched, weight: round(h.weight * recency, 1) });
    }
  });

  // إشارات سلوكية مش لفظية
  if (msgs.length >= 5) { score += 8; reasons.push({ label: "تفاعل طويل", matched: `${msgs.length} رسالة`, weight: 8 }); }
  if (msgs.length === 1) { score -= 5; reasons.push({ label: "رسالة واحدة فقط", matched: "بلا متابعة", weight: -5 }); }

  const intent = Math.max(0, Math.min(100, Math.round(50 + score)));
  const stage = intent >= 78 ? "جاهز للشراء"
              : intent >= 58 ? "مهتم"
              : intent >= 38 ? "فضولي"
              : "بارد";

  return {
    intent,
    stage,
    reasons,
    objections: [...objections.entries()]
      .map(([key, n]) => ({ key, label: (SIGNALS[key] || {}).label || key, times: n }))
      .sort((a, b) => b.times - a.times)
  };
}

// ── سرعة أول رد من الصفحة (بالدقائق) ──
export function replyDelayMin(conv) {
  const msgs = conv.msgs || [];
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].dir === "in") {
      for (let j = i + 1; j < msgs.length; j++)
        if (msgs[j].dir === "out") return round((msgs[j].at - msgs[i].at) / 60000, 1);
      return null;   // ما إجاه رد أبداً
    }
  }
  return null;
}

// ── هل الزبون داخل نافذة الـ24 ساعة؟ (شرط أي تواصل استباقي) ──
export function inWindow(lastInAt) {
  const at = Number(lastInAt) || 0;
  return at > 0 && (Date.now() - at) < WINDOW_MS;
}

// ═══════════════════════════════════════════════════════════
// 📤 مغلّف رد موحّد — كل محرك بيرجع نفس الشكل
// الحقول: القيمة + على شو انبنت + قد إيش نثق فيها
// ═══════════════════════════════════════════════════════════
export function reply(res, payload, basis) {
  res.json({ ...payload, basis: basis || null, generated_at: Date.now() });
}
export function fail(res, e, msg) {
  console.error(msg || "brain:", e && e.message);
  res.status(500).json({ error: msg || "فشل التحليل" });
}
