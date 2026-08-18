// ═══════════════════════════════════════════════════════════
// مصادقة لوحة التحكم (كوكيز موقّعة HMAC)
// ═══════════════════════════════════════════════════════════
import crypto from "node:crypto";
import { WEB } from "../config.js";
import { getUser } from "../db/database.js";

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

// ═══════════════════════════════════════════════════════════
// 👑 حارس الأدوار
//
// جدول users فيه عمود role من زمان، بس ما كان في شي بيفحصه —
// فأي موظف بيقدر يوصل لإدارة الفريق والتوكنات والأسعار والنسخ
// الاحتياطية. الدور موجود بالبيانات ومهمل بالتنفيذ.
//
// الحسابات القائمة محمية: role افتراضياً 'admin'، فما بينقفل
// عليها شي بهاد التغيير — بس الحسابات الجديدة (staff) بتنحصر.
// ═══════════════════════════════════════════════════════════
export function requireAdmin(req, res, next) {
  try {
    const u = getUser(req.user);
    // ما لقينا المستخدم = جلسة لحساب انحذف ⇒ نرفض
    if (!u) return res.status(401).json({ error: "الحساب مش موجود — سجّل دخول من جديد" });
    if ((u.role || "admin") !== "admin") {
      return res.status(403).json({ error: "هاي العملية لمدير الحساب فقط" });
    }
    next();
  } catch (e) {
    console.error("requireAdmin:", e && e.message);
    // عند فشل الفحص منمنع — الصلاحية ما بتنعطى بالشك
    res.status(500).json({ error: "تعذّر التحقق من الصلاحية" });
  }
}

export { COOKIE_NAME };
