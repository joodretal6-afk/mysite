// ═══════════════════════════════════════════════════════════
// مصادقة لوحة التحكم (كوكيز موقّعة HMAC)
// ═══════════════════════════════════════════════════════════
import crypto from "node:crypto";
import { WEB } from "../config.js";

const COOKIE_NAME = "ajban_sid";

function sign(data) {
  return crypto.createHmac("sha256", WEB.SESSION_SECRET).update(data).digest("base64url");
}

// إنشاء توكن الجلسة
export function issueToken(username) {
  const payload = Buffer.from(JSON.stringify({
    u: username,
    exp: Date.now() + WEB.ADMIN_SESSION_TTL_MS
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

// التحقق من التوكن
export function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = sign(payload);
  // مقارنة آمنة ضد هجمات التوقيت
  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

// إعداد الكوكي
export function setAuthCookie(res, username) {
  const token = issueToken(username);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: WEB.ADMIN_SESSION_TTL_MS,
    secure: false   // خليه true لو شغّلت على HTTPS
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

// ميدلوير الحماية
export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  const session = verifyToken(token);
  if (!session) {
    // طلبات الـ API ترجع 401 (وليس تحويلاً) حتى تتعامل معها الواجهة بشكل صحيح.
    // ملاحظة: وحدات الميزات مركّبة على /admin/f-api/<slug> فيكون req.path هو المسار الداخلي فقط،
    // لذلك نفحص العنوان الكامل أيضاً — وإلا رجع 302 وحاولت الصفحة قراءة HTML كأنه JSON.
    const url = String(req.originalUrl || "");
    const wantsJson = String(req.headers.accept || "").includes("application/json");
    if (req.path.startsWith("/api/") || req.path.includes("export") || url.includes("/f-api/") || wantsJson) {
      return res.status(401).json({ error: "غير مصرّح" });
    }
    return res.redirect("/admin/login");
  }
  req.user = session.u;
  next();
}

export { COOKIE_NAME };
