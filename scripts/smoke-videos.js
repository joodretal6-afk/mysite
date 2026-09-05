// ═══════════════════════════════════════════════════════════
// 🧪 اختبار وحدة فيديوهات المنتجات
// بيغطي: الرفع (base64) والتخزين على القرص وبناء الرابط المطلق،
// الإضافة برابط، ربط الفيديو بصفحة معروفة فقط، سقف الحجم،
// التفعيل/الإيقاف، الحذف (ومسح الملف)، ودالة البوت videosForPage.
// ═══════════════════════════════════════════════════════════
if (!process.env.DB_PATH || /platform\.db/.test(process.env.DB_PATH))
  process.env.DB_PATH = "./data/smoke-videos.db";
if (/platform\.db/.test(process.env.DB_PATH)) {
  console.error("🔴 رفض: الاختبار ما بيشتغل على قاعدة الإنتاج"); process.exit(1);
}
import fs from "node:fs";
import path from "node:path";
const wipe = () => ["", "-wal", "-shm"].forEach(x => { try { fs.rmSync(process.env.DB_PATH + x); } catch {} });
wipe();

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { console.log("❌ " + m); fail++; } };
const threw = async (fn) => { try { await fn(); return false; } catch { return true; } };

const vids = await import("../src/features/videos.js");
await new Promise(r => setTimeout(r, 400));
const { PAGES } = await import("../src/bot/brain.js");
const { VIDEOS_DIR } = await import("../src/media.js");

// صفحة معروفة نختبر عليها (فاتي)
const FATI = "514074765127663";
ok(!!PAGES[FATI], "صفحة فاتي موجودة بالإعدادات");

// ── محاكي req/res بسيط ──
const mkReq = (body) => ({ body, query: {}, params: {}, headers: { host: "ajban-bot.onrender.com", "x-forwarded-proto": "https" } });
function mkRes() {
  const r = { code: 200, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (j) => { r.body = j; return r; };
  return r;
}
// نلاقي المعالج المسجّل على الراوتر لمسار وطريقة
function handlerFor(method, urlPath) {
  const layer = vids.router.stack.find(l => l.route && l.route.path === urlPath && l.route.methods[method]);
  if (!layer) throw new Error(`ما لقينا معالج ${method} ${urlPath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
const call = async (method, urlPath, { body = {}, params = {}, query = {} } = {}) => {
  const req = mkReq(body); req.params = params; req.query = query;
  const res = mkRes();
  await handlerFor(method, urlPath)(req, res);
  return res;
};

// فيديو صغير وهمي (بايتات) → base64
const fakeVideo = Buffer.from("FAKE-MP4-BYTES-" + "x".repeat(500));
const b64 = "data:video/mp4;base64," + fakeVideo.toString("base64");

// ── (1) الرفع لصفحة معروفة ──
let r = await call("post", "/upload", { body: { page_id: FATI, label: "جل غسيل فاتي", filename: "clip.mp4", base64: b64 } });
ok(r.body && r.body.ok && r.body.id > 0, "انرفع الفيديو وانحفظ سجلّه");
const vid1 = r.body.id;
ok(/^https:\/\/ajban-bot\.onrender\.com\/media\/videos\/.+\.mp4$/.test(r.body.url), "الرابط مطلق https وتحت /media/videos");
const savedName = r.body.url.split("/").pop();
ok(fs.existsSync(path.join(VIDEOS_DIR, savedName)), "الملف انكتب فعلاً على القرص");

// ── (2) الرفع لصفحة مجهولة يُرفض ──
ok(await threw(async () => {
  const rr = await call("post", "/upload", { body: { page_id: "999", label: "x", filename: "a.mp4", base64: b64 } });
  if (!rr.body.ok) throw new Error(rr.body.error);
}), "الرفع لصفحة غير معروفة بينرفض");

// ── (3) الرفع بلا ملف يُرفض ──
r = await call("post", "/upload", { body: { page_id: FATI, base64: "" } });
ok(!r.body.ok, "الرفع بلا ملف بينرفض");

// ── (4) سقف الحجم (25 ميغا) ──
const big = "data:video/mp4;base64," + Buffer.alloc(26 * 1048576, 1).toString("base64");
r = await call("post", "/upload", { body: { page_id: FATI, filename: "big.mp4", base64: big } });
ok(!r.body.ok && /ميغا/.test(r.body.error), "فيديو أكبر من 25 ميغا بينرفض");

// ── (5) إضافة برابط مباشر ──
r = await call("post", "/url", { body: { page_id: FATI, label: "منظّف", url: "https://cdn.example.com/v2.mp4" } });
ok(r.body.ok && r.body.id > 0, "انضاف فيديو برابط مباشر");
const vid2 = r.body.id;
r = await call("post", "/url", { body: { page_id: FATI, url: "ftp://bad" } });
ok(!r.body.ok, "رابط مش https بينرفض");

// ── (6) دالة البوت: فيديوهات الصفحة المفعّلة ──
let list = vids.videosForPage(FATI);
ok(list.length === 2, "البوت بيشوف فيديوهين مفعّلين للصفحة");
ok(list.every(v => v.url && v.url.startsWith("https://")), "كل رابط للبوت مطلق https");

// ── (7) الإيقاف بيخفّيه عن البوت ──
await call("post", "/:id/toggle", { params: { id: String(vid2) } });
list = vids.videosForPage(FATI);
ok(list.length === 1, "بعد الإيقاف صار البوت يشوف فيديو واحد");

// ── (8) العزل بين الصفحات ──
ok(vids.videosForPage("618622274665182").length === 0, "صفحة ثانية ما إلها فيديوهات — عزل تام");

// ── (9) الحذف بيمسح السجل والملف ──
r = await call("delete", "/:id", { params: { id: String(vid1) } });
ok(r.body.ok && r.body.deleted, "انحذف الفيديو");
ok(!fs.existsSync(path.join(VIDEOS_DIR, savedName)), "الملف انمسح من القرص كمان");
ok(vids.videosForPage(FATI).length === 0, "ما ضل فيديو مفعّل بعد الحذف والإيقاف");

// تنظيف
wipe();
console.log(`\n${fail ? "🔴" : "🟢"} نجح ${pass} / فشل ${fail}`);
process.exit(fail ? 1 : 0);
