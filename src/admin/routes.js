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
  distinctPages, ordersStats, saveOrder, orderExists
} from "../db/database.js";
import { requireAuth, setAuthCookie, clearAuthCookie } from "./auth.js";
import { PAGES } from "../bot/brain.js";
import { fetchConversations, fetchMessages, collectConversationsInRange } from "../bot/inbox.js";
import { parseMessage } from "../bot/parser.js";
import { computeOrder } from "../bot/order.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "..", "public");

export const adminRouter = express.Router();

// ── صفحة الدخول ──
adminRouter.get("/login", (req, res) => {
  res.sendFile(path.join(publicDir, "login.html"));
});

adminRouter.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = getUser((username || "").trim());
  if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
    return res.status(401).json({ error: "اسم المستخدم أو كلمة السر غير صحيحة" });
  }
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

    // نجمع نص رسائل الزبون فقط (مش ردود الصفحة) ونمرّرها على الرادار
    const customerText = messages.filter(m => !m.isPage).map(m => m.text).join("\n");
    const memory = { cart: {}, area: null, phone: null, history: [], lastReply: "" };
    parseMessage(memory, customerText, page);
    const order = computeOrder(page, memory.cart);

    res.json({
      customerId, customerName, messages,
      extracted: {
        cart: memory.cart,
        area: memory.area || "",
        phone: memory.phone || "",
        orderString: order.orderString,
        total: order.total
      }
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// حفظ طلب يدوياً (من صندوق الوارد بعد مراجعة الأدمن)
adminRouter.post("/api/orders/manual", requireAuth, (req, res) => {
  const { page_id, order_string, total, area, phone, customer_id } = req.body || {};
  const page = PAGES[page_id];
  if (!page) return res.status(400).json({ error: "صفحة غير صحيحة" });
  if (!order_string || !order_string.trim()) return res.status(400).json({ error: "اكتب تفاصيل الطلب" });

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

        // نجمع كلام الزبون فقط ونمرّره على الرادار
        const custText = thread.messages.filter(m => !m.isPage).map(m => m.text).join("\n");
        const memory = { cart: {}, area: null, phone: null, history: [], lastReply: "" };
        parseMessage(memory, custText, page);

        const hasItems = Object.keys(memory.cart).length > 0;
        if (!hasItems) { noOrder++; continue; }

        const order = computeOrder(page, memory.cart);

        // طلب مؤكّد = فيه أصناف + رقم هاتف. غير هيك يحتاج مراجعة يدوية.
        if (!memory.phone) { needsReview++; continue; }

        if (orderExists(pid, c.customerId, order.orderString)) { skippedDup++; continue; }

        const id = saveOrder({
          page_id: pid,
          page_name: page.name,
          sender_id: c.customerId,
          order_string: order.orderString,
          total: order.total,
          area: memory.area || "",
          phone: memory.phone,
          status: "جديد",
          messenger_url: c.customerId ? `https://m.me/${c.customerId}` : "",
          created_at: c.updated ? new Date(c.updated).getTime() : Date.now()
        });
        saved++;
        savedOrders.push({ id, page: page.name, customer: c.customerName, order: order.orderString, total: order.total, phone: memory.phone });
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
adminRouter.post("/api/orders/:id/status", requireAuth, (req, res) => {
  const { status } = req.body || {};
  const allowed = ["جديد", "تم التواصل", "تم الشحن", "تم التسليم", "ملغي"];
  if (!allowed.includes(status)) return res.status(400).json({ error: "حالة غير صالحة" });
  updateOrderStatus(req.params.id, status);
  res.json({ ok: true });
});

// حذف أوردر
adminRouter.delete("/api/orders/:id", requireAuth, (req, res) => {
  deleteOrder(req.params.id);
  res.json({ ok: true });
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
