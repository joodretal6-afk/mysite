// ═══════════════════════════════════════════════════════════
// 📲 طبقة تكامل واتساب الرسمية (WhatsApp Business Cloud API)
//
// 🔴 رسمية فقط. ممنوع منعاً باتاً أي أتمتة غير رسمية:
//    لا Puppeteer، لا Selenium، لا WhatsApp Web، لا QR غير رسمي،
//    لا session hijacking، ولا أي تجاوز لحدود واتساب/ميتا.
//
// التصميم Modular: كل مزوّد بيوفّر نفس الواجهة (sendTemplate/sendText/
// verify)، فبتقدر تضيف مزوّد رسمي تاني مستقبلاً بلا ما تلمس باقي النظام.
//
// السياسة:
//  • الرسائل التسويقية = رسائل قوالب (template) معتمدة من ميتا، وبتنبعت
//    بس للعملاء الموافقين (OPTED_IN). هاي الآلية الرسمية للتواصل خارج
//    نافذة 24 ساعة.
//  • رسائل الخدمة (متعلقة بالطلب) داخل نافذة 24 ساعة ممكن تكون نص حر.
//
// الاعتماد (credentials) بتيجي من متغيّرات البيئة أو من إعداد الحساب،
// وما بتنكتب بالكود أبداً (المستودع عام).
// ═══════════════════════════════════════════════════════════
import { CONFIG } from "../config.js";

const GRAPH = `https://graph.facebook.com/${CONFIG.GRAPH_VERSION || "v21.0"}`;

// ── تطبيع الرقم لصيغة E.164 دولية بلا "+" (مطلوب Cloud API) ──
// أردني: 07XXXXXXXX → 9627XXXXXXXX. بنحتفظ بالأصلي للعرض بمكان تاني.
export function toE164Jordan(raw) {
  let p = String(raw || "").replace(/[\s\-().]/g, "");
  p = p.replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
       .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("00")) p = p.slice(2);
  if (/^0?7[789]\d{7}$/.test(p)) p = "962" + p.replace(/^0/, "");
  else if (/^9627[789]\d{7}$/.test(p)) { /* جاهز */ }
  else if (/^7[789]\d{7}$/.test(p)) p = "962" + p;
  return /^9627[789]\d{7}$/.test(p) ? p : null;   // غير صالح = null
}

// صيغة العرض المحلية 07XXXXXXXX من أي إدخال
export function toLocalJordan(raw) {
  const e = toE164Jordan(raw);
  return e ? "0" + e.slice(3) : null;
}

export function isValidJordan(raw) { return !!toE164Jordan(raw); }

// ═══════════════════════════════════════════════════════════
// مزوّد: WhatsApp Cloud API الرسمي
// ═══════════════════════════════════════════════════════════
const cloudProvider = {
  name: "cloud",

  // اعتماد الحساب: من إعداد الحساب مباشرة، أو من متغيّر بيئة باسمه.
  //   account.token_env = "WA_TOKEN_GHAZA" → process.env.WA_TOKEN_GHAZA
  //   account.phone_id_env = "WA_PHONE_ID_GHAZA"
  creds(account) {
    const token = (account.token_env && process.env[account.token_env]) || account.token || "";
    const phoneId = (account.phone_id_env && process.env[account.phone_id_env]) || account.phone_number_id || "";
    return { token: String(token).trim(), phoneId: String(phoneId).trim() };
  },

  configured(account) {
    const { token, phoneId } = this.creds(account);
    return !!(token && phoneId);
  },

  // فحص الاتصال: نجيب بيانات رقم الحساب من Graph (بلا إرسال أي رسالة)
  async verify(account) {
    const { token, phoneId } = this.creds(account);
    if (!token || !phoneId) return { ok: false, error: "ناقص TOKEN أو PHONE_ID (اضبطهم كمتغيّرات بيئة)" };
    try {
      const r = await fetch(`${GRAPH}/${phoneId}?fields=verified_name,display_phone_number,quality_rating`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const d = await r.json();
      if (!r.ok) return { ok: false, error: d?.error?.message || `HTTP ${r.status}` };
      return { ok: true, info: d };
    } catch (e) { return { ok: false, error: e && e.message }; }
  },

  // رسالة قالب معتمد (تسويقية/خارج النافذة) — الآلية الرسمية
  async sendTemplate(account, toRaw, templateName, langCode, components) {
    const to = toE164Jordan(toRaw);
    if (!to) return { ok: false, error: "رقم غير صالح" };
    const { token, phoneId } = this.creds(account);
    if (!token || !phoneId) return { ok: false, error: "الحساب غير مهيأ" };
    const body = {
      messaging_product: "whatsapp", to, type: "template",
      template: { name: templateName, language: { code: langCode || "ar" },
                  ...(components ? { components } : {}) }
    };
    return this._post(phoneId, token, body);
  },

  // رسالة نص حر — صالحة فقط داخل نافذة 24 ساعة (رسالة خدمة/رد)
  async sendText(account, toRaw, text) {
    const to = toE164Jordan(toRaw);
    if (!to) return { ok: false, error: "رقم غير صالح" };
    const { token, phoneId } = this.creds(account);
    if (!token || !phoneId) return { ok: false, error: "الحساب غير مهيأ" };
    const body = { messaging_product: "whatsapp", to, type: "text",
                   text: { body: String(text).slice(0, 4000) } };
    return this._post(phoneId, token, body);
  },

  async _post(phoneId, token, body) {
    try {
      const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const d = await r.json();
      if (!r.ok) return { ok: false, error: d?.error?.message || `HTTP ${r.status}`, raw: d };
      return { ok: true, id: d?.messages?.[0]?.id || null, raw: d };
    } catch (e) { return { ok: false, error: e && e.message }; }
  }
};

const PROVIDERS = { cloud: cloudProvider };

export function getProvider(name) { return PROVIDERS[name] || cloudProvider; }

// واجهة موحّدة يستخدمها باقي النظام
export const WA = {
  configured: (acc) => getProvider(acc?.provider).configured(acc || {}),
  verify:     (acc) => getProvider(acc?.provider).verify(acc || {}),
  sendText:   (acc, to, text) => getProvider(acc?.provider).sendText(acc || {}, to, text),
  sendTemplate: (acc, to, tpl, lang, comp) => getProvider(acc?.provider).sendTemplate(acc || {}, to, tpl, lang, comp)
};
