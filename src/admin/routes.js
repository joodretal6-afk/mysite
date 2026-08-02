// ═══════════════════════════════════════════════════════════
// مسارات لوحة التحكم: دخول + عرض الأوردرات + تصدير Excel/CSV
// ═══════════════════════════════════════════════════════════
import express from "express";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  getUser, listOrders, updateOrderStatus, deleteOrder,
  distinctPages, ordersStats, saveOrder, orderExists,
  getKnowledge, setKnowledge, listChatThreads, getChatMessages, perPageStats, editOrder, logMessage,
  analyticsData, salesReport, listCustomers, customerOrders,
  listCoupons, addCoupon, toggleCoupon, deleteCoupon, getOrder,
  listReviews, reviewStats,
  listAddons, addAddon, updateAddon, toggleAddon, deleteAddon,
  logActivity, listActivity, setCost, getCosts, deleteCost, profitReport,
  listUsers, setUserRole, deleteUser, addUser,
  listInventory, setInventory, deleteInventory, decrementStock, lowStockList,
  listHandoffs, setHandoffPause, resolveHandoff,
  getSetting, setSetting, isBlocked, listBlocked, addBlock, removeBlock,
  listPriceOverrides, setPriceOverride, deletePriceOverride, topProducts,
  cancelReasonsReport, peakHeatmap
} from "../db/database.js";
import fs from "node:fs";
import { WEB, CONFIG } from "../config.js";
import { sendText } from "../bot/messenger.js";
import { requireAuth, setAuthCookie, clearAuthCookie } from "./auth.js";
import { PAGES } from "../bot/brain.js";
import { fetchConversations, fetchMessages, collectConversationsInRange } from "../bot/inbox.js";
import { parseMessage } from "../bot/parser.js";
import { computeOrder } from "../bot/order.js";
import { extractOrderWithAI } from "../bot/ai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "..", "public");

export const adminRouter = express.Router();

// ── صفحة الدخول ──
adminRouter.get("/login", (req, res) => {
  res.sendFile(path.join(publicDir, "login.html"));
});

// حدّ بسيط لمحاولات الدخول (ضد التخمين): 8 محاولات فاشلة كل 10 دقائق لكل IP
const _loginHits = new Map();
function loginLimited(ip) {
  const now = Date.now();
  const rec = _loginHits.get(ip) || { n: 0, resetAt: now + 600000 };
  if (now > rec.resetAt) { rec.n = 0; rec.resetAt = now + 600000; }
  return { rec, blocked: rec.n >= 8 };
}

adminRouter.post("/login", (req, res) => {
  const ip = req.ip || "unknown";
  const { rec, blocked } = loginLimited(ip);
  if (blocked) return res.status(429).json({ error: "محاولات كثيرة، حاول بعد قليل" });

  const { username, password } = req.body || {};
  const user = getUser((username || "").trim());
  if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
    rec.n++; _loginHits.set(ip, rec);
    return res.status(401).json({ error: "اسم المستخدم أو كلمة السر غير صحيحة" });
  }
  _loginHits.delete(ip);
  setAuthCookie(res, user.username);
  res.json({ ok: true });
});

adminRouter.post("/logout", (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// ── لوحة التحكم (محمية) ──
adminRouter.get("/", requireAuth, (req, res) => {
  res.sendFile(path.join(publicDir, "dashboard.html"));
});

// ── صندوق الوارد (محمي) ──
adminRouter.get("/inbox", requireAuth, (req, res) => {
  res.sendFile(path.join(publicDir, "inbox.html"));
});

// ── صفحات محمية إضافية ──
adminRouter.get("/pages", requireAuth, (req, res) => res.sendFile(path.join(publicDir, "pages.html")));
adminRouter.get("/knowledge", requireAuth, (req, res) => res.sendFile(path.join(publicDir, "knowledge.html")));
adminRouter.get("/chats", requireAuth, (req, res) => res.sendFile(path.join(publicDir, "chats.html")));
adminRouter.get("/analytics", requireAuth, (req, res) => res.sendFile(path.join(publicDir, "analytics.html")));
adminRouter.get("/customers", requireAuth, (req, res) => res.sendFile(path.join(publicDir, "customers.html")));
adminRouter.get("/coupons", requireAuth, (req, res) => res.sendFile(path.join(publicDir, "coupons.html")));
adminRouter.get("/invoice/:id", requireAuth, (req, res) => res.sendFile(path.join(publicDir, "invoice.html")));
adminRouter.get("/reviews", requireAuth, (req, res) => res.sendFile(path.join(publicDir, "reviews.html")));
adminRouter.get("/products", requireAuth, (req, res) => res.sendFile(path.join(publicDir, "products.html")));
adminRouter.get("/profit", requireAuth, (req, res) => res.sendFile(path.join(publicDir, "profit.html")));
adminRouter.get("/team", requireAuth, (req, res) => res.sendFile(path.join(publicDir, "team.html")));
adminRouter.get("/inventory", requireAuth, (req, res) => res.sendFile(path.join(publicDir, "inventory.html")));
adminRouter.get("/handoffs", requireAuth, (req, res) => res.sendFile(path.join(publicDir, "handoffs.html")));
adminRouter.get("/settings", requireAuth, (req, res) => res.sendFile(path.join(publicDir, "settings.html")));
adminRouter.get("/prices", requireAuth, (req, res) => res.sendFile(path.join(publicDir, "prices.html")));

// ── API: المنتجات الإضافية (بيع إضافي) ──
adminRouter.get("/api/addons", requireAuth, (req, res) => res.json({ addons: listAddons() }));
function cleanAddon(b) {
  return {
    name: String(b?.name || "").trim().slice(0, 120),
    price: Math.max(0, Number(b?.price) || 0),
    weight: String(b?.weight || "").slice(0, 60),
    description: String(b?.description || "").slice(0, 200)
  };
}
adminRouter.post("/api/addons", requireAuth, (req, res) => {
  const a = cleanAddon(req.body);
  if (!a.name) return res.status(400).json({ error: "اكتب اسم المنتج" });
  addAddon(a);
  res.json({ ok: true });
});
adminRouter.post("/api/addons/:id", requireAuth, (req, res) => {
  updateAddon(req.params.id, cleanAddon(req.body));
  res.json({ ok: true });
});
adminRouter.post("/api/addons/:id/toggle", requireAuth, (req, res) => {
  toggleAddon(req.params.id, !!req.body?.active);
  res.json({ ok: true });
});
adminRouter.delete("/api/addons/:id", requireAuth, (req, res) => {
  deleteAddon(req.params.id);
  res.json({ ok: true });
});

// ⚠️ حُذفت خدمة "تذكير إعادة الطلب" نهائياً (إرسال ترويجي استباقي — شبهة مخالفة لسياسات فيسبوك).

// ── API: التقييمات ──
adminRouter.get("/api/reviews", requireAuth, (req, res) => {
  res.json({ reviews: listReviews(), stats: reviewStats() });
});

// ── API: تحليلات وتقارير ──
adminRouter.get("/api/analytics", requireAuth, (req, res) => {
  const { from, to } = req.query;
  res.json({
    analytics: analyticsData({
      from: from ? new Date(from).getTime() : undefined,
      to: to ? (new Date(to).getTime() + 86400000 - 1) : undefined
    }),
    report: salesReport()
  });
});

// ── API: ملف الزبائن (CRM) ──
adminRouter.get("/api/customers", requireAuth, (req, res) => {
  res.json({ customers: listCustomers({ search: req.query.search || undefined }) });
});
adminRouter.get("/api/customer", requireAuth, (req, res) => {
  res.json({ orders: customerOrders(req.query.phone || "") });
});

// ── API: أوردر واحد (للفاتورة) ──
adminRouter.get("/api/order/:id", requireAuth, (req, res) => {
  const o = getOrder(req.params.id);
  if (!o) return res.status(404).json({ error: "غير موجود" });
  res.json(o);
});

// ── API: الكوبونات ──
adminRouter.get("/api/coupons", requireAuth, (req, res) => res.json({ coupons: listCoupons() }));
adminRouter.post("/api/coupons", requireAuth, (req, res) => {
  const { code, type, value } = req.body || {};
  if (!code || !code.trim()) return res.status(400).json({ error: "اكتب كود الكوبون" });
  const t = type === "fixed" ? "fixed" : "percent";
  const v = Math.max(0, Number(value) || 0);
  if (v <= 0) return res.status(400).json({ error: "قيمة خصم غير صالحة" });
  if (t === "percent" && v > 100) return res.status(400).json({ error: "النسبة لا تتجاوز 100%" });
  addCoupon(code.trim(), t, v);
  res.json({ ok: true });
});
adminRouter.post("/api/coupons/:code/toggle", requireAuth, (req, res) => {
  toggleCoupon(req.params.code, !!req.body?.active);
  res.json({ ok: true });
});
adminRouter.delete("/api/coupons/:code", requireAuth, (req, res) => {
  deleteCoupon(req.params.code);
  res.json({ ok: true });
});

// ── API: إحصائيات كل صفحة (صفحة الأوردرات المنفصلة) ──
adminRouter.get("/api/page-stats", requireAuth, (req, res) => {
  const stats = perPageStats();
  const byId = Object.fromEntries(stats.map(s => [s.page_id, s]));
  // ندمج كل الصفحات المعرّفة حتى اللي ما إلها طلبات بعد
  const all = Object.entries(PAGES).map(([id, p]) => ({
    page_id: id, page_name: p.name,
    count: byId[id]?.count || 0,
    sum: byId[id]?.sum || 0,
    new_count: byId[id]?.new_count || 0,
    last_at: byId[id]?.last_at || null
  }));
  res.json(all);
});

// ── API: تغذية معلومات البوت لكل صفحة ──
adminRouter.get("/api/knowledge", requireAuth, (req, res) => {
  const { page_id } = req.query;
  if (!PAGES[page_id]) return res.status(400).json({ error: "صفحة غير صحيحة" });
  res.json({ page_id, page_name: PAGES[page_id].name, extra: getKnowledge(page_id) });
});
adminRouter.post("/api/knowledge", requireAuth, (req, res) => {
  const { page_id, extra } = req.body || {};
  if (!PAGES[page_id]) return res.status(400).json({ error: "صفحة غير صحيحة" });
  setKnowledge(page_id, extra || "");
  res.json({ ok: true });
});

// ── API: أرشيف الدردشات المحفوظة محلياً ──
adminRouter.get("/api/chats", requireAuth, (req, res) => {
  const { page_id } = req.query;
  if (!PAGES[page_id]) return res.status(400).json({ error: "صفحة غير صحيحة" });
  res.json({ threads: listChatThreads(page_id) });
});
adminRouter.get("/api/chat", requireAuth, (req, res) => {
  const { page_id, sender_id } = req.query;
  res.json({ messages: getChatMessages(page_id, sender_id) });
});

// جلب فلاتر البيانات (الصفحات + الإحصائيات)
adminRouter.get("/api/meta", requireAuth, (req, res) => {
  res.json({ user: req.user, pages: distinctPages(), stats: ordersStats() });
});

// ═══════════════════════════════════════════════════════════
// 📥 صندوق الوارد (Inbox): قراءة محادثات فيسبوك واستخراج الطلبات
// ═══════════════════════════════════════════════════════════

// قائمة كل الصفحات المتاحة (للاختيار في صندوق الوارد)
adminRouter.get("/api/pages-all", requireAuth, (req, res) => {
  res.json(Object.entries(PAGES).map(([id, p]) => ({ id, name: p.name })));
});

// جلب محادثات صفحة معينة
adminRouter.get("/api/conversations", requireAuth, async (req, res) => {
  try {
    const { page_id } = req.query;
    if (!PAGES[page_id]) return res.status(400).json({ error: "اختر صفحة صحيحة" });
    const conversations = await fetchConversations(page_id);
    res.json({ conversations });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// جلب رسائل محادثة + استخراج الطلب تلقائياً منها
adminRouter.get("/api/conversation", requireAuth, async (req, res) => {
  try {
    const { page_id, id } = req.query;
    const page = PAGES[page_id];
    if (!page) return res.status(400).json({ error: "اختر صفحة صحيحة" });

    const { customerId, customerName, messages } = await fetchMessages(page_id, id);

    // نجمع نص رسائل الزبون فقط (مش ردود الصفحة)
    const customerText = messages.filter(m => !m.isPage).map(m => m.text).join("\n");

    // 🧠 الاستخراج الذكي أولاً (يفهم أي صياغة)، ثم الرادار احتياطاً
    const ai = await extractOrderWithAI(customerText, page);
    let cart = {};
    let area = "", phone = "";

    if (ai.items.length) {
      ai.items.forEach(it => { cart[it.product] = it.qty; });
      area = ai.area; phone = ai.phone;
    } else {
      const memory = { cart: {}, area: null, phone: null, history: [], lastReply: "" };
      parseMessage(memory, customerText, page);
      cart = memory.cart; area = memory.area || ""; phone = memory.phone || "";
    }

    const order = computeOrder(page, cart);

    res.json({
      customerId, customerName, messages,
      extracted: { cart, area, phone, orderString: order.orderString, total: order.total }
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// قائمة المحادثات ضمن مدى تاريخي (للاستخراج المباشر خطوة بخطوة)
adminRouter.get("/api/conversations-range", requireAuth, async (req, res) => {
  try {
    const { page_id, from, to } = req.query;
    if (!PAGES[page_id]) return res.status(400).json({ error: "اختر صفحة صحيحة" });
    const fromTs = from ? new Date(from).getTime() : 0;
    const toTs = to ? (new Date(to).getTime() + 86400000 - 1) : Date.now();
    const conversations = await collectConversationsInRange(page_id, fromTs, toTs);
    res.json({ conversations });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// حفظ طلب يدوياً (من صندوق الوارد بعد مراجعة الأدمن)
adminRouter.post("/api/orders/manual", requireAuth, (req, res) => {
  const { page_id, order_string, total, area, phone, customer_id, dedup } = req.body || {};
  const page = PAGES[page_id];
  if (!page) return res.status(400).json({ error: "صفحة غير صحيحة" });
  if (!order_string || !order_string.trim()) return res.status(400).json({ error: "اكتب تفاصيل الطلب" });

  // منع التكرار أثناء الاستخراج المباشر
  if (dedup && orderExists(page_id, customer_id || "", order_string.trim())) {
    return res.json({ ok: true, skipped: true });
  }

  const id = saveOrder({
    page_id,
    page_name: page.name,
    sender_id: customer_id || "",
    order_string: order_string.trim(),
    total: parseFloat(total) || 0,
    area: area || "",
    phone: phone || "",
    status: "جديد",
    messenger_url: customer_id ? `https://m.me/${customer_id}` : "",
    created_at: Date.now()
  });
  res.json({ ok: true, id });
});

// ═══════════════════════════════════════════════════════════
// 🚀 الاستخراج الجماعي: امسح كل محادثات فترة تاريخية واستخرج الطلبات وأنزلها
// ═══════════════════════════════════════════════════════════
adminRouter.post("/api/bulk-extract", requireAuth, async (req, res) => {
  try {
    const { page_id, from, to } = req.body || {};
    if (page_id !== "all" && !PAGES[page_id]) {
      return res.status(400).json({ error: "اختر صفحة صحيحة أو (كل الصفحات)" });
    }

    const fromTs = from ? new Date(from).getTime() : 0;
    const toTs = to ? (new Date(to).getTime() + 86400000 - 1) : Date.now();
    const targetPages = page_id === "all" ? Object.keys(PAGES) : [page_id];

    let scanned = 0, saved = 0, needsReview = 0, skippedDup = 0, noOrder = 0;
    const errors = [];
    const savedOrders = [];

    for (const pid of targetPages) {
      const page = PAGES[pid];
      let convs;
      try {
        convs = await collectConversationsInRange(pid, fromTs, toTs);
      } catch (e) {
        errors.push(`${page.name}: ${e.message}`);
        continue;
      }

      for (const c of convs) {
        scanned++;
        let thread;
        try {
          thread = await fetchMessages(pid, c.id);
        } catch {
          continue;   // نتجاوز أي محادثة فشل جلبها
        }

        // نجمع كلام الزبون فقط ونستخرج بالذكاء الاصطناعي (مع الرادار احتياطاً)
        const custText = thread.messages.filter(m => !m.isPage).map(m => m.text).join("\n");
        const ai = await extractOrderWithAI(custText, page);
        let cart = {}, area = "", phone = "";
        if (ai.items.length) {
          ai.items.forEach(it => { cart[it.product] = it.qty; });
          area = ai.area; phone = ai.phone;
        } else {
          const memory = { cart: {}, area: null, phone: null, history: [], lastReply: "" };
          parseMessage(memory, custText, page);
          cart = memory.cart; area = memory.area || ""; phone = memory.phone || "";
        }

        const hasItems = Object.keys(cart).length > 0;
        if (!hasItems) { noOrder++; continue; }

        const order = computeOrder(page, cart);

        // طلب مؤكّد = فيه أصناف + رقم هاتف. غير هيك يحتاج مراجعة يدوية.
        if (!phone) { needsReview++; continue; }

        if (orderExists(pid, c.customerId, order.orderString)) { skippedDup++; continue; }

        const id = saveOrder({
          page_id: pid,
          page_name: page.name,
          sender_id: c.customerId,
          order_string: order.orderString,
          total: order.total,
          area: area,
          phone: phone,
          status: "جديد",
          messenger_url: c.customerId ? `https://m.me/${c.customerId}` : "",
          created_at: c.updated ? new Date(c.updated).getTime() : Date.now()
        });
        saved++;
        savedOrders.push({ id, page: page.name, customer: c.customerName, order: order.orderString, total: order.total, phone: phone });
      }
    }

    res.json({ scanned, saved, needsReview, skippedDup, noOrder, errors, orders: savedOrders });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// جلب الأوردرات
adminRouter.get("/api/orders", requireAuth, (req, res) => {
  const { page_id, search, from, to, status } = req.query;
  const result = listOrders({
    page_id: page_id || undefined,
    search: search || undefined,
    status: status || undefined,
    from: from ? new Date(from).getTime() : undefined,
    to: to ? (new Date(to).getTime() + 86400000 - 1) : undefined,
    limit: 1000
  });
  res.json(result);
});

// تحديث حالة أوردر
adminRouter.post("/api/orders/:id/status", requireAuth, async (req, res) => {
  const { status } = req.body || {};
  const allowed = ["ناقص", "جديد", "تم التواصل", "تم الشحن", "تم التسليم", "ملغي"];
  if (!allowed.includes(status)) return res.status(400).json({ error: "حالة غير صالحة" });
  updateOrderStatus(req.params.id, status);
  logActivity(req.user, "تغيير حالة", `أوردر #${req.params.id} → ${status}`);

  // 📦 خصم المخزون تلقائياً عند تسليم الطلب
  if (status === "تم التسليم") {
    try { const o = getOrder(req.params.id); if (o?.order_string) decrementStock(o.order_string); }
    catch (e) { console.error("stock decrement:", e && e.message); }
  }

  // ⚠️ حُذف الإخطار التلقائي للزبون عند تغيير الحالة نهائياً (إرسال استباقي — شبهة مخالفة).
  // تغيير الحالة الآن داخلي فقط (على اللوحة) بدون أي رسالة للزبون.
  res.json({ ok: true });
});

// تعديل حقول أوردر (الطلب/الحساب/العنوان/التلفون)
adminRouter.post("/api/orders/:id/edit", requireAuth, (req, res) => {
  const { order_string, total, area, phone } = req.body || {};
  editOrder(req.params.id, { order_string, total, area, phone });
  res.json({ ok: true });
});

// حذف أوردر
adminRouter.delete("/api/orders/:id", requireAuth, (req, res) => {
  deleteOrder(req.params.id);
  res.json({ ok: true });
});

// ⚠️ حُذفت خدمة "الحملات التسويقية الجماعية" (Broadcast) نهائياً — أكبر مصدر لحظر الصفحات.

// ═══════════════════════════════════════════════════════════
// 💰 الأرباح والتكاليف
// ═══════════════════════════════════════════════════════════
adminRouter.get("/api/costs", requireAuth, (req, res) => res.json({ costs: getCosts() }));
adminRouter.post("/api/costs", requireAuth, (req, res) => {
  const { product, cost } = req.body || {};
  if (!product || !String(product).trim()) return res.status(400).json({ error: "اسم المنتج مطلوب" });
  setCost(product, cost);
  res.json({ ok: true });
});
adminRouter.delete("/api/costs/:product", requireAuth, (req, res) => {
  deleteCost(decodeURIComponent(req.params.product));
  res.json({ ok: true });
});
adminRouter.get("/api/profit", requireAuth, (req, res) => {
  const { from, to } = req.query;
  const parse = v => { const n = Date.parse(v); return Number.isNaN(n) ? undefined : n; };
  res.json(profitReport({ from: from ? parse(from) : undefined, to: to ? parse(to) : undefined }));
});

// ═══════════════════════════════════════════════════════════
// 👤 فريق العمل (المستخدمون + الأدوار) + سجل النشاط
// ═══════════════════════════════════════════════════════════
adminRouter.get("/api/team", requireAuth, (req, res) => {
  res.json({ users: listUsers(), me: req.user });
});
adminRouter.post("/api/team", requireAuth, async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const role = ["admin", "staff"].includes(req.body?.role) ? req.body.role : "staff";
  if (!username || password.length < 4) return res.status(400).json({ error: "اسم مستخدم وكلمة سر (4 أحرف على الأقل)" });
  if (getUser(username)) return res.status(400).json({ error: "اسم المستخدم موجود مسبقاً" });
  const hash = bcrypt.hashSync(password, 10);
  addUser(username, hash, role);
  logActivity(req.user, "إضافة مستخدم", `${username} (${role})`);
  res.json({ ok: true });
});
adminRouter.post("/api/team/:username/role", requireAuth, (req, res) => {
  const role = ["admin", "staff"].includes(req.body?.role) ? req.body.role : "staff";
  setUserRole(req.params.username, role);
  logActivity(req.user, "تغيير دور", `${req.params.username} → ${role}`);
  res.json({ ok: true });
});
adminRouter.delete("/api/team/:username", requireAuth, (req, res) => {
  if (req.params.username === req.user) return res.status(400).json({ error: "لا يمكنك حذف نفسك" });
  deleteUser(req.params.username);
  logActivity(req.user, "حذف مستخدم", req.params.username);
  res.json({ ok: true });
});
adminRouter.get("/api/activity", requireAuth, (req, res) => res.json({ activity: listActivity() }));

// ═══════════════════════════════════════════════════════════
// 📦 المخزون
// ═══════════════════════════════════════════════════════════
adminRouter.get("/api/inventory", requireAuth, (req, res) => {
  res.json({ inventory: listInventory(), low: lowStockList() });
});
adminRouter.post("/api/inventory", requireAuth, (req, res) => {
  const { product, stock, low } = req.body || {};
  if (!product || !String(product).trim()) return res.status(400).json({ error: "اسم المنتج مطلوب" });
  setInventory(product, stock, low);
  res.json({ ok: true });
});
adminRouter.delete("/api/inventory/:product", requireAuth, (req, res) => {
  deleteInventory(decodeURIComponent(req.params.product));
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════
// 🙋 التدخّل البشري (Human Handoff)
// ═══════════════════════════════════════════════════════════
adminRouter.get("/api/handoffs", requireAuth, (req, res) => {
  res.json({ handoffs: listHandoffs() });
});
// تعليق/تشغيل البوت يدوياً لزبون معيّن
adminRouter.post("/api/handoffs/:key/pause", requireAuth, (req, res) => {
  const paused = req.body?.paused ? 1 : 0;
  setHandoffPause(decodeURIComponent(req.params.key), paused);
  logActivity(req.user, paused ? "تعليق البوت" : "تشغيل البوت", decodeURIComponent(req.params.key));
  res.json({ ok: true });
});
// رد الموظف مباشرةً على الزبون (أثناء التدخّل البشري)
adminRouter.post("/api/handoffs/:key/reply", requireAuth, async (req, res) => {
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "اكتب الرسالة" });
  const key = decodeURIComponent(req.params.key);
  const idx = key.indexOf("_");
  const pageId = key.slice(0, idx), senderId = key.slice(idx + 1);
  const page = PAGES[pageId];
  if (!page?.PAGE_TOKEN || !senderId) return res.status(400).json({ error: "صفحة/زبون غير معروف" });
  try {
    await sendText(page.PAGE_TOKEN, senderId, text);
    logMessage({ page_id: pageId, page_name: page.name, sender_id: senderId, direction: "out", body: "👤 " + text, created_at: Date.now() });
    logActivity(req.user, "رد يدوي", key);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e && e.message }); }
});
// إنهاء التدخّل (يرجّع البوت للعمل)
adminRouter.post("/api/handoffs/:key/resolve", requireAuth, (req, res) => {
  resolveHandoff(decodeURIComponent(req.params.key));
  logActivity(req.user, "إنهاء تدخّل", decodeURIComponent(req.params.key));
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════
// 🎯 هدف المبيعات + 🕐 ساعات العمل (إعدادات)
// ═══════════════════════════════════════════════════════════
adminRouter.get("/api/settings", requireAuth, (req, res) => {
  let hours = null; try { hours = JSON.parse(getSetting("business_hours") || "null"); } catch {}
  const rep = salesReport();
  res.json({
    goal: Number(getSetting("sales_goal", "0")) || 0,
    goalProgress: Number(rep.month?.s || 0),
    businessHours: hours || { enabled: false, from: 9, to: 22, msg: "" }
  });
});
adminRouter.post("/api/settings/goal", requireAuth, (req, res) => {
  setSetting("sales_goal", String(Number(req.body?.goal) || 0));
  logActivity(req.user, "تعديل هدف المبيعات", String(req.body?.goal));
  res.json({ ok: true });
});
adminRouter.post("/api/settings/hours", requireAuth, (req, res) => {
  const b = req.body || {};
  const hours = {
    enabled: !!b.enabled,
    from: Math.min(23, Math.max(0, Number(b.from) || 0)),
    to: Math.min(24, Math.max(0, Number(b.to) || 24)),
    msg: String(b.msg || "").slice(0, 500)
  };
  setSetting("business_hours", JSON.stringify(hours));
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════
// 🚫 حظر الزبائن
// ═══════════════════════════════════════════════════════════
adminRouter.get("/api/blocklist", requireAuth, (req, res) => res.json({ blocked: listBlocked() }));
adminRouter.post("/api/blocklist", requireAuth, (req, res) => {
  const { sender_id, page_id, note } = req.body || {};
  if (!sender_id) return res.status(400).json({ error: "معرّف الزبون مطلوب" });
  addBlock(sender_id, page_id, note);
  logActivity(req.user, "حظر زبون", String(sender_id));
  res.json({ ok: true });
});
adminRouter.delete("/api/blocklist/:id", requireAuth, (req, res) => {
  removeBlock(decodeURIComponent(req.params.id));
  logActivity(req.user, "فك حظر", req.params.id);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════
// 💵 تعديل أسعار المنتجات من الموقع
// ═══════════════════════════════════════════════════════════
adminRouter.get("/api/prices", requireAuth, (req, res) => {
  const pageId = String(req.query.page_id || "");
  const base = (PAGES[pageId] && PAGES[pageId].PRICES) || {};
  const overrides = {}; for (const r of listPriceOverrides(pageId)) overrides[r.product] = r.price;
  res.json({ page_id: pageId, base, overrides });
});
adminRouter.post("/api/prices", requireAuth, (req, res) => {
  const { page_id, product, price } = req.body || {};
  if (!page_id || !product) return res.status(400).json({ error: "الصفحة والمنتج مطلوبان" });
  setPriceOverride(page_id, product, price);
  logActivity(req.user, "تعديل سعر", `${product} → ${price}د`);
  res.json({ ok: true });
});
adminRouter.delete("/api/prices", requireAuth, (req, res) => {
  const { page_id, product } = req.query;
  deletePriceOverride(page_id, product);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════
// 🏆 أكثر المنتجات مبيعاً
// ═══════════════════════════════════════════════════════════
adminRouter.get("/api/top-products", requireAuth, (req, res) => {
  res.json({ products: topProducts(20) });
});

// 📊 تحليلات إضافية: أسباب الإلغاء + خريطة أوقات الذروة + رحلة الزبون
adminRouter.get("/api/insights", requireAuth, (req, res) => {
  let funnel = { conversations: 0, carts: 0, completed: 0 };
  try {
    const s = ordersStats();
    // تقدير رحلة الزبون: كل الطلبات (بدأت سلة) مقابل المكتملة
    const all = listOrders({ limit: 100000 });
    const started = all.count;
    const completed = all.rows.filter(o => o.status !== "ناقص" && o.status !== "ملغي").length;
    funnel = { started, completed, dropRate: started ? Math.round((1 - completed / started) * 100) : 0 };
  } catch {}
  res.json({
    cancelReasons: cancelReasonsReport(),
    heatmap: peakHeatmap(),
    funnel
  });
});
adminRouter.get("/insights", requireAuth, (req, res) => res.sendFile(path.join(publicDir, "insights.html")));
adminRouter.get("/wholesale-note", requireAuth, (req, res) => res.json({ note: getSetting("wholesale_note", "") }));
adminRouter.post("/wholesale-note", requireAuth, (req, res) => {
  setSetting("wholesale_note", String(req.body?.note || "").slice(0, 500));
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════
// 💾 تحميل نسخة احتياطية فورية من قاعدة البيانات
// ═══════════════════════════════════════════════════════════
adminRouter.get("/api/backup", requireAuth, (req, res) => {
  const src = WEB.DB_PATH;
  if (!src || !fs.existsSync(src)) return res.status(400).json({ error: "النسخ الاحتياطي متاح فقط بوضع القرص المحلي" });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  logActivity(req.user, "تحميل نسخة احتياطية", stamp);
  res.download(src, `backup-${stamp}.db`);
});

// ── تصدير Excel (.xlsx) ──
adminRouter.get("/export.xlsx", requireAuth, async (req, res) => {
  const { page_id, search, from, to, status } = req.query;
  const { rows } = listOrders({
    page_id: page_id || undefined,
    search: search || undefined,
    status: status || undefined,
    from: from ? new Date(from).getTime() : undefined,
    to: to ? (new Date(to).getTime() + 86400000 - 1) : undefined,
    limit: 100000
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("الأوردرات", { views: [{ rightToLeft: true }] });

  ws.columns = [
    { header: "#", key: "id", width: 8 },
    { header: "الصفحة", key: "page_name", width: 18 },
    { header: "الطلب", key: "order_string", width: 34 },
    { header: "الحساب (د)", key: "total", width: 12 },
    { header: "العنوان", key: "area", width: 30 },
    { header: "التلفون", key: "phone", width: 16 },
    { header: "الحالة", key: "status", width: 14 },
    { header: "رابط الماسنجر", key: "messenger_url", width: 30 },
    { header: "التاريخ", key: "created_at", width: 22 }
  ];

  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E7D32" } };
  ws.getRow(1).alignment = { horizontal: "center", vertical: "middle" };

  for (const r of rows) {
    ws.addRow({
      id: r.id,
      page_name: r.page_name,
      order_string: r.order_string,
      total: r.total,
      area: r.area,
      phone: r.phone,
      status: r.status,
      messenger_url: r.messenger_url,
      created_at: new Date(r.created_at).toLocaleString("ar-EG")
    });
  }

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="orders_${Date.now()}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// ── تصدير CSV (بترميز UTF-8 BOM حتى يفتح صح بالعربي في Excel) ──
adminRouter.get("/export.csv", requireAuth, (req, res) => {
  const { page_id, search, from, to, status } = req.query;
  const { rows } = listOrders({
    page_id: page_id || undefined,
    search: search || undefined,
    status: status || undefined,
    from: from ? new Date(from).getTime() : undefined,
    to: to ? (new Date(to).getTime() + 86400000 - 1) : undefined,
    limit: 100000
  });

  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["#", "الصفحة", "الطلب", "الحساب", "العنوان", "التلفون", "الحالة", "رابط الماسنجر", "التاريخ"];
  const lines = [header.map(esc).join(",")];
  for (const r of rows) {
    lines.push([
      r.id, r.page_name, r.order_string, r.total, r.area, r.phone,
      r.status, r.messenger_url, new Date(r.created_at).toLocaleString("ar-EG")
    ].map(esc).join(","));
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="orders_${Date.now()}.csv"`);
  res.send("﻿" + lines.join("\r\n"));
});
