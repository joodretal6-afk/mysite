// ═══════════════════════════════════════════════════════════
// شيخ الجبنة — سيرفر مستقل تماماً (لا علاقة له بالبوت الأساسي)
// دردشة + لوحة إدارة (5 صفحات) + قاعدة بيانات ملفات بسيطة
// ═══════════════════════════════════════════════════════════
import express from "express";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { store, nextId } from "./store.js";
import { chat, extractOrder } from "./ai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const PORT = process.env.CHEESE_PORT || process.env.PORT || 4000;

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// ── مصادقة بسيطة للوحة الإدارة ──
const SECRET = process.env.CHEESE_SECRET || crypto.randomBytes(16).toString("hex");
function sign(v) { return crypto.createHmac("sha256", SECRET).update(v).digest("hex"); }
function makeToken() { const v = "ok." + Date.now(); return v + "." + sign(v); }
function validToken(t) {
  if (!t) return false;
  const i = t.lastIndexOf(".");
  const v = t.slice(0, i), sig = t.slice(i + 1);
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(v))); } catch { return false; }
}
function requireAuth(req, res, next) {
  if (validToken(req.cookies?.cheese_admin)) return next();
  return res.status(401).json({ error: "unauthorized" });
}

// ═══════════════════════════════════════════════════════════
// 💬 الدردشة (عامة)
// ═══════════════════════════════════════════════════════════
app.post("/api/chat", async (req, res) => {
  const history = Array.isArray(req.body?.messages) ? req.body.messages
    .filter(m => m && m.content && (m.role === "user" || m.role === "assistant"))
    .slice(-20) : [];
  if (!history.length) return res.json({ reply: "يا هلا فيك 🌹 أنا شيخ الجبنة، شو بتحب أجهّزلك؟" });

  const result = await chat(store, history);
  if (result.error) return res.json({ reply: "🙏 " + result.error });

  // نحاول نستخرج الطلب ونحفظه إن اكتمل (بصمت — لا يعطّل الرد)
  let order = null;
  try {
    const full = [...history, { role: "assistant", content: result.reply }];
    const ex = await extractOrder(store, full);
    if (ex?.complete) {
      const orders = store.orders();
      // منع التكرار: نفس الرقم + نفس المجموع خلال آخر 10 دقائق
      const dup = orders.find(o => o.phone === ex.phone && o.total === ex.total && (Date.now() - o.createdAt) < 6e5);
      if (!dup) {
        const id = nextId(orders);
        orders.unshift({ id, ...ex, status: "جديد", createdAt: Date.now() });
        store.saveOrders(orders);
        order = { id, total: ex.total };
      }
    }
  } catch {}
  res.json({ reply: result.reply, order });
});

// معلومات العلامة التجارية للواجهة
app.get("/api/brand", (req, res) => {
  const s = store.settings();
  res.json({ brand: s.brand, tagline: s.tagline, ready: Boolean(s.apiKey) });
});

// ═══════════════════════════════════════════════════════════
// 🔐 تسجيل الدخول للإدارة
// ═══════════════════════════════════════════════════════════
app.post("/api/login", (req, res) => {
  const pass = String(req.body?.password || "");
  if (pass && pass === store.settings().adminPass) {
    res.cookie("cheese_admin", makeToken(), { httpOnly: true, sameSite: "lax", maxAge: 7 * 864e5 });
    return res.json({ ok: true });
  }
  res.status(401).json({ error: "كلمة السر غير صحيحة" });
});
app.post("/api/logout", (req, res) => { res.clearCookie("cheese_admin"); res.json({ ok: true }); });
app.get("/api/auth", (req, res) => res.json({ authed: validToken(req.cookies?.cheese_admin) }));

// ═══════════════════════════════════════════════════════════
// ⚙️ واجهات الإدارة (5 صفحات: منتجات، أسعار، أسئلة، طلبات، إعدادات)
// ═══════════════════════════════════════════════════════════
// المنتجات + الأسعار (نفس المصدر — الأسعار تعديل مباشر)
app.get("/api/products", requireAuth, (req, res) => res.json({ products: store.products() }));
app.post("/api/products", requireAuth, (req, res) => {
  const products = store.products();
  const b = req.body || {};
  const item = {
    id: b.id || nextId(products),
    name: String(b.name || "").trim().slice(0, 80),
    type: String(b.type || "").trim().slice(0, 40),
    price: Math.max(0, Number(b.price) || 0),
    unit: String(b.unit || "").trim().slice(0, 40) || "قطعة",
    note: String(b.note || "").trim().slice(0, 160)
  };
  if (!item.name) return res.status(400).json({ error: "اسم المنتج مطلوب" });
  const idx = products.findIndex(p => p.id === item.id);
  if (idx >= 0) products[idx] = item; else products.push(item);
  store.saveProducts(products);
  res.json({ ok: true, item });
});
app.delete("/api/products/:id", requireAuth, (req, res) => {
  store.saveProducts(store.products().filter(p => String(p.id) !== req.params.id));
  res.json({ ok: true });
});

// الأسئلة والأجوبة
app.get("/api/faqs", requireAuth, (req, res) => res.json({ faqs: store.faqs() }));
app.post("/api/faqs", requireAuth, (req, res) => {
  const faqs = store.faqs();
  const b = req.body || {};
  const item = { id: b.id || nextId(faqs), q: String(b.q || "").trim().slice(0, 200), a: String(b.a || "").trim().slice(0, 600) };
  if (!item.q || !item.a) return res.status(400).json({ error: "السؤال والجواب مطلوبان" });
  const idx = faqs.findIndex(f => f.id === item.id);
  if (idx >= 0) faqs[idx] = item; else faqs.push(item);
  store.saveFaqs(faqs);
  res.json({ ok: true, item });
});
app.delete("/api/faqs/:id", requireAuth, (req, res) => {
  store.saveFaqs(store.faqs().filter(f => String(f.id) !== req.params.id));
  res.json({ ok: true });
});

// الطلبات
app.get("/api/orders", requireAuth, (req, res) => res.json({ orders: store.orders() }));
app.post("/api/orders/:id/status", requireAuth, (req, res) => {
  const orders = store.orders();
  const o = orders.find(x => String(x.id) === req.params.id);
  if (o) { o.status = String(req.body?.status || o.status).slice(0, 30); store.saveOrders(orders); }
  res.json({ ok: true });
});
app.delete("/api/orders/:id", requireAuth, (req, res) => {
  store.saveOrders(store.orders().filter(o => String(o.id) !== req.params.id));
  res.json({ ok: true });
});

// الإعدادات (المفتاح لا يُرجَع كاملاً للحماية)
app.get("/api/settings", requireAuth, (req, res) => {
  const s = store.settings();
  res.json({ settings: { ...s, adminPass: undefined, apiKey: s.apiKey ? "•••• محفوظ ••••" : "" } });
});
app.post("/api/settings", requireAuth, (req, res) => {
  const b = req.body || {};
  const patch = {};
  for (const k of ["brand", "tagline", "provider", "model", "delivery", "weight", "salt", "storage", "hours", "phone", "extraKnowledge"]) {
    if (b[k] != null) patch[k] = String(b[k]).slice(0, 4000);
  }
  // المفتاح: نحدّثه فقط لو أرسل قيمة جديدة فعلية (مش الحاجب ••••)
  if (b.apiKey && !b.apiKey.includes("••••")) patch.apiKey = String(b.apiKey).trim();
  if (b.adminPass && String(b.adminPass).length >= 4) patch.adminPass = String(b.adminPass);
  store.saveSettings(patch);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════
// الصفحات
// ═══════════════════════════════════════════════════════════
app.get("/", (req, res) => res.sendFile(path.join(publicDir, "index.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(publicDir, "admin.html")));
app.get("/health", (req, res) => res.json({ ok: true }));

// يعمل مستقلاً لو شُغّل مباشرةً (npm start)، ويُركَّب كـ sub-app لو استُورد في سيرفر آخر.
const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  app.listen(PORT, () => {
    console.log(`🧀 شيخ الجبنة يعمل على المنفذ ${PORT}`);
    console.log(`   الدردشة:  http://localhost:${PORT}/`);
    console.log(`   الإدارة:  http://localhost:${PORT}/admin`);
  });
}

export default app;
