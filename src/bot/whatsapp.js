// ═══════════════════════════════════════════════════════════
// 📱 قناة واتساب (WhatsApp Cloud API)
// اختيارية بالكامل — تعمل فقط إذا ضُبطت WHATSAPP_TOKEN + WHATSAPP_PHONE_ID.
// تعيد استخدام نفس دماغ البوت (askAI) واستخراج الطلبات (extractOrderWithAI).
// لا تمسّ أي كود أو مفاتيح أصلية.
// ═══════════════════════════════════════════════════════════
import { CONFIG } from "../config.js";
import { PAGES } from "./brain.js";
import { askAI, extractOrderWithAI } from "./ai.js";
import { computeOrder } from "./order.js";
import { saveOrder, getRecentOpenOrderId, updateOrder } from "../db/database.js";
import { notifyTelegram } from "./messenger.js";
import { groundAddress, parseAddress } from "./address.js";

export function whatsappEnabled() {
  return Boolean(CONFIG.WHATSAPP_TOKEN && CONFIG.WHATSAPP_PHONE_ID);
}

// الصفحة التي تُستخدم معرفتها (الأسعار/العروض) لمحادثات واتساب — نُرجع {id, cfg}
function waPage() {
  let id = (CONFIG.WHATSAPP_PAGE_ID && PAGES[CONFIG.WHATSAPP_PAGE_ID]) ? CONFIG.WHATSAPP_PAGE_ID : null;
  if (!id) id = Object.keys(PAGES).find(pid => !CONFIG.DISABLED_PAGES.includes(pid));
  return id ? { id, cfg: PAGES[id] } : null;
}

export async function sendWhatsApp(to, text) {
  if (!whatsappEnabled()) return;
  const url = `https://graph.facebook.com/${CONFIG.GRAPH_VERSION}/${CONFIG.WHATSAPP_PHONE_ID}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Authorization": `Bearer ${CONFIG.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: String(text).slice(0, 4000) } })
    });
    if (!res.ok) console.error("WhatsApp send:", res.status, await res.text());
  } catch (e) { console.error("WhatsApp send error:", e && e.message); }
}

// ذاكرة بسيطة في KV لكل رقم واتساب (نفس نمط جلسات الماسنجر)
async function loadMem(kv, from) {
  try { const raw = await kv.get(`wa:${from}`); return raw ? JSON.parse(raw) : { history: [], cart: [], area: "", phone: "" }; }
  catch { return { history: [], cart: [], area: "", phone: "" }; }
}
async function saveMem(kv, from, mem) {
  try { await kv.put(`wa:${from}`, JSON.stringify(mem), { expirationTtl: CONFIG.SESSION_TTL }); } catch {}
}

// معالجة رسالة واتساب واحدة
export async function handleWhatsAppMessage(msg, contactName, kv) {
  if (CONFIG.GLOBAL_PAUSE) return;   // 🛑 إيقاف عام للبوت
  const p = waPage();
  if (!p) return;
  const page = p.cfg;
  const from = msg.from;                       // رقم المرسل (WhatsApp ID)
  const text = msg.text?.body || "";
  if (!from || !text) return;

  const mem = await loadMem(kv, from);
  mem.history = mem.history || [];
  mem.cart = mem.cart || {};
  mem.history.push({ role: "user", text });
  if (mem.history.length > CONFIG.MAX_HISTORY) mem.history = mem.history.slice(-CONFIG.MAX_HISTORY);

  // الرد الذكي بنفس دماغ الماسنجر
  let reply = "أهلاً وسهلاً 🌹";
  try {
    reply = await askAI(mem.history, text, null, page, mem, { area: mem.area, phone: mem.phone }, "");
  } catch (e) { console.error("WA askAI:", e && e.message); }
  mem.history.push({ role: "model", text: reply });
  await sendWhatsApp(from, reply);

  // استخراج الطلب وحفظه (تحديث حي مثل الماسنجر)
  try {
    const convo = mem.history.map(h => `${h.role === "user" ? "زبون" : "بوت"}: ${h.text}`).join("\n");
    const ai = await extractOrderWithAI(convo, page);
    if (ai?.ok && ai.is_order && Array.isArray(ai.items) && ai.items.length) {
      mem.cart = {};
      ai.items.forEach(it => { mem.cart[it.product] = it.qty; });
      // 🔴 نفس قاعدة الماسنجر: ممنوع نثق بعنوان الذكاء أعمى. كل كلمة
      //    لازم تكون من كلام الزبون الفعلي، وإلا بنرفضه بدل ما نطبع
      //    عنوان مخترع بالفاتورة.
      if (!mem.prov) mem.prov = {};
      if (ai.area) {
        const g = groundAddress(ai.area, convo);
        if (g.ok) {
          mem.area = parseAddress(g.grounded).formatted;
          mem.prov.area = { value: mem.area, source_mid: "wa:" + from, status: "verified" };
        } else console.warn(`🛑 واتساب: عنوان الذكاء مرفوض (${g.reason}): "${ai.area}"`);
      }
      // الرقم لازم يكون مكتوباً بكلام الزبون؛ وإلا منستخدم رقم قناة
      // واتساب نفسه (وهو رقم الزبون الفعلي اللي بيراسل منه — مش رقم
      // زبون تاني). ما منخترع ولا منكمّل.
      if (ai.phone && convo.replace(/[\s\-\.]/g, "").includes(ai.phone)) {
        mem.phone = ai.phone;
        mem.prov.phone = { value: ai.phone, source_mid: "wa:" + from, status: "verified" };
      }
      const { total, orderString } = computeOrder(page, mem.cart, null);
      const phone = mem.phone || from;
      // مكتمل فقط لو عنوان له مصدر + رقم. غير هيك = ناقص ومنكمّل مع الزبون.
      const complete = Boolean(mem.area && mem.prov.area && mem.prov.area.source_mid && phone);
      const payload = {
        page_id: p.id,
        page_name: (page.name || "واتساب") + " (واتساب)",
        sender_id: from, session_key: `${p.id}_${from}`,
        order_string: orderString, total,
        area: mem.area || "", phone,
        status: complete ? "جديد" : "ناقص",
        messenger_url: `https://wa.me/${from}`
      };
      if (!mem.orderId) mem.orderId = getRecentOpenOrderId(p.id, from);
      if (mem.orderId) updateOrder(mem.orderId, payload);
      else {
        mem.orderId = saveOrder(payload);
        notifyTelegram(`🆕 طلب واتساب #${mem.orderId}\n${orderString}\n💵 ${total}د\n📍 ${payload.area || "—"}\n📞 ${phone}`);
      }
    }
  } catch (e) { console.error("WA extract:", e && e.message); }

  await saveMem(kv, from, mem);
}
