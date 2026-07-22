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
  distinctPages, ordersStats
} from "../db/database.js";
import { requireAuth, setAuthCookie, clearAuthCookie } from "./auth.js";

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

// جلب فلاتر البيانات (الصفحات + الإحصائيات)
adminRouter.get("/api/meta", requireAuth, (req, res) => {
  res.json({ user: req.user, pages: distinctPages(), stats: ordersStats() });
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
