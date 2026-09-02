// ═══════════════════════════════════════════════════════════
// 🧪 اختبار وضع الالتقاط
//
// السيناريو اللي بيغطيه: ذكاء ميتا (أو موظف من الموبايل) رد
// على الزبون، وبوتنا ما شاف المحادثة. لازم الطلب يوصل الموقع
// من كلام الزبون — وبحالة «بحاجة مراجعة» مش «جديد».
//
// وأهم فحص فيه: 🔴 لو رد ذكاء ميتا فيه سعر أو عنوان مخترع،
// ممنوع ينتقل لقاعدتنا. الاستخراج من كلام الزبون بس.
// ═══════════════════════════════════════════════════════════
if (!process.env.DB_PATH || /platform\.db/.test(process.env.DB_PATH))
  process.env.DB_PATH = "./data/smoke-capture.db";
if (/platform\.db/.test(process.env.DB_PATH)) {
  console.error("🔴 رفض: الاختبار ما بيشتغل على قاعدة الإنتاج"); process.exit(1);
}
import fs from "node:fs";
const wipe = () => ["", "-wal", "-shm"].forEach(x => { try { fs.rmSync(process.env.DB_PATH + x); } catch {} });
wipe();

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { console.log("❌ " + m); fail++; } };

const cap = await import("../src/bot/capture.js");
const { db, getSetting, setSetting, getChatMessages, listOrders } = await import("../src/db/database.js");
await new Promise(r => setTimeout(r, 500));

// ═══════════ تمييز الأحداث ═══════════
ok(cap.isPageEcho({ message: { is_echo: true, text: "أهلين" } }) === true, "رد الصفحة بينتعرف كـecho");
ok(cap.isPageEcho({ message: { text: "بدي جبنة" } }) === false, "رسالة الزبون مش echo");
ok(cap.isStandbyCustomerMessage({ message: { text: "بدي" }, sender: { id: "u" }, recipient: { id: "p" } }) === true,
   "رسالة زبون بقناة standby بتنتعرف");
ok(cap.isStandbyCustomerMessage({ message: { is_echo: true, text: "x" }, sender: { id: "u" }, recipient: { id: "p" } }) === false,
   "echo داخل standby مش رسالة زبون");

ok(cap.isOurOwnEcho({ message: { app_id: "123" } }, "123") === true, "ردنا نحنا بينتعرف بمعرّف التطبيق");
ok(cap.isOurOwnEcho({ message: { app_id: "999" } }, "123") === false, "رد تطبيق تاني مش ردنا");
ok(cap.isOurOwnEcho({ message: { app_id: "999" } }, "") === false,
   "بلا معرّف تطبيق مضبوط ما منعتبر أي رد ردنا (وإلا بنبلع ردود ميتا)");

// ═══════════ الإعداد ═══════════
ok(cap.captureEnabled() === false, "وضع الالتقاط مطفأ افتراضياً — التاجر بيشغّله بوعي");
setSetting("capture_external", "on");
ok(cap.captureEnabled() === true, "بينشتغل لمّا ينحفظ الإعداد");
ok(cap.captureDelayMs() === 3 * 60000, "مدة الانتظار الافتراضية 3 دقايق");
setSetting("capture_delay_min", "7");
ok(cap.captureDelayMs() === 7 * 60000, "مدة الانتظار بتتغيّر من الإعدادات");
setSetting("capture_delay_min", "999");
ok(cap.captureDelayMs() === 3 * 60000, "قيمة خارج المدى بترجع للافتراضي بدل ما تكسر");

// ═══════════ 🤝 التسليم الكامل لذكاء ميتا ═══════════
setSetting("capture_external", "");
ok(cap.handedOverToMeta() === false, "التسليم لميتا مطفأ افتراضياً");
ok(cap.captureEnabled() === false, "وبلا تسليم وبلا التقاط، الوحدة ساكتة");

setSetting("handover_meta", "on");
ok(cap.handedOverToMeta() === true, "التسليم بينشتغل من الإعدادات");
ok(cap.captureEnabled() === true,
   "🔴 التسليم بيشغّل الالتقاط ضمناً — وإلا بتضيع كل الطلبات وإنت مش داري");
setSetting("handover_meta", "");
setSetting("capture_external", "on");

// 🔴 البوت لازم يخرس عند التسليم — مفحوص على الكود نفسه
const handler = fs.readFileSync("src/bot/handler.js", "utf8");
ok(/handedOverToMeta\(\)\)\s*return/.test(handler.replace(/\s+/g, " ")) ||
   /handedOverToMeta[\s\S]{0,80}return;/.test(handler),
   "🔴 المعالج بيرجع فوراً لمّا يكون التسليم شغّال — ولا رسالة بتطلع");

// ═══════════ 🔇 فشل الذكاء = سكوت مش رسالة تعبئة ═══════════
for (const f of ["src/bot/ai.js", "src/bot/gemini.js"]) {
  const src = fs.readFileSync(f, "utf8");
  ok(!/return\s*"أبشر/.test(src), `🔴 ${f}: ما عاد يبعت "أبشر كمّل طلبك" لمّا الذكاء يفشل`);
  ok(!/return\s*text\s*\|\|\s*"/.test(src), `🔴 ${f}: الرد الفاضي ما بينستبدل برسالة تعبئة`);
  ok(/return null/.test(src), `${f}: الفشل بيرجع null (سكوت)`);
}
ok(/reply == null/.test(handler) || /reply === null/.test(handler),
   "المعالج بيفحص الرد الفاضي قبل الإرسال");
ok(/String\(reply \|\| ""\)\.split/.test(handler),
   "مسار الإرسال محمي من القيمة الفاضية فما بينهار");

// ═══════════ 🧠 نماذج التفكير (gpt-5) — قيود مختلفة ═══════════
// مكتشفة بالفحص الفعلي على المفتاح، مش من التوثيق.
const { isReasoningModel, buildBody } = await import("../src/bot/aiCore.js");

ok(isReasoningModel("gpt-5-nano") === true, "gpt-5-nano بينتعرف كنموذج تفكير");
ok(isReasoningModel("gpt-5-mini") === true, "gpt-5-mini كمان");
ok(isReasoningModel("o3-mini") === true, "عائلة o بينتعرفوا");
ok(isReasoningModel("gpt-4o-mini") === false, "gpt-4o-mini نموذج عادي");
ok(isReasoningModel("gpt-4o-mini") === false, "نماذج GPT-4 عادية مش تفكير");
ok(isReasoningModel("") === false && isReasoningModel(null) === false, "قيمة فاضية ما بتنكسر");

const classic = buildBody({ model: "gpt-4o-mini", prompt: "x", json: false,
                            temperature: 0.2, maxTokens: 400 });
ok(classic.max_tokens === 400 && classic.temperature === 0.2,
   "النموذج العادي بياخد max_tokens و temperature زي ما هي");
ok(classic.max_completion_tokens === undefined, "وما بينبعتلو max_completion_tokens");

const reasoning = buildBody({ model: "gpt-5-nano", prompt: "x", json: true,
                              temperature: 0.2, maxTokens: 400 });
ok(reasoning.max_tokens === undefined,
   "🔴 نموذج التفكير ما بينبعتلو max_tokens — بيرفض النداء كلياً لو انبعت");
ok(reasoning.temperature === undefined,
   "🔴 وما بينبعتلو temperature — بيرفض أي قيمة غير 1");
ok(reasoning.max_completion_tokens === 800,
   "الرصيد بينضاعف لأنّ التفكير بياكل منه قبل ما يكتب الرد");
ok(reasoning.reasoning_effort === "minimal",
   "🔴 التفكير على الأدنى — شغلنا استخراج طلبات مش رياضيات");
ok(reasoning.response_format?.type === "json_object", "وضع الـJSON بيضل شغّال");
ok(buildBody({ model: "gpt-5-nano", prompt: "x", maxTokens: 50 }).max_completion_tokens === 600,
   "في حد أدنى للرصيد — رصيد ضيّق بيخلي النموذج يرجع فاضي");

// ═══════ البوابات الجاهزة: المختار أول والتحذيرات ظاهرة ═══════
const { PRESETS } = await import("../src/bot/aiCore.js");
ok(PRESETS[0].model === "gpt-4o-mini", "المختار بالفحص (gpt-4o-mini) أول خيار");
ok(/الأوفر/.test(PRESETS[0].name), "ومعلّم إنه الأوفر");
ok(PRESETS.every(p => p.base.includes("openai.com")),
   "🔴 كل البوابات على GPT — جروك انشال زي ما طلب صاحب المشروع");
const nano = PRESETS.find(p => p.model === "gpt-5-nano");
ok(nano && /دقة أقل|4\/6/.test(nano.name),
   "🔴 النموذج اللي فشل بالفحص موجود كخيار بس بتحذيره مكتوب");
const mini = PRESETS.find(p => p.model === "gpt-5-mini");
ok(mini && /إيقافه/.test(mini.name),
   "🔴 النموذج المعلن إيقافه مكتوب عليه تاريخه — حتى ما نبني عليه");
ok(PRESETS.every(p => p.base && p.model && Array.isArray(p.models)),
   "كل بوابة إلها عنوان ونموذج وقائمة نماذج");
// النمط بيمسك المفتاح الحقيقي (بادئة + 20 محرف على الأقل)، مش
// نص الإرشاد اللي بيقول للمستخدم "المفتاح بيبدأ بـgsk_"
const KEYLIKE = /(gsk_|sk-proj-|sk-ant-)[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}/;
ok(!KEYLIKE.test(JSON.stringify(PRESETS)),
   "🔴 ولا مفتاح محفوظ بالبوابات الجاهزة");
ok(KEYLIKE.test("gsk_" + "a".repeat(25)), "نمط كشف المفاتيح شغّال فعلاً (فحص ذاتي)");

// ═══════════ 🩺 تشخيص «ليش ما بيوصل رد» ═══════════
const { botDiagnose } = await import("../src/bot/aiCore.js");
const d = await botDiagnose();
ok(Array.isArray(d.checks) && d.checks.length >= 6, "التشخيص بيفحص كل حلقات السلسلة");
ok(d.checks.every(c => c.name && typeof c.ok === "boolean" && c.detail),
   "كل فحص بيرجع اسمه ونتيجته والدليل");
ok(d.checks.filter(c => !c.ok).every(c => c.fix),
   "🔴 كل حلقة مكسورة بيجي معها الحل — مش بس «في مشكلة»");
ok(/أول حلقة مكسورة|كل الحلقات سليمة/.test(d.verdict),
   "الخلاصة بتسمّي أول حلقة مكسورة بالاسم");
ok(d.checks.some(c => /موقوف عام/.test(c.name)), "بيفحص الإيقاف العام");
ok(d.checks.some(c => /ذكاء ميتا/.test(c.name)), "بيفحص التسليم لميتا");
ok(d.checks.some(c => /توكن/.test(c.name)), "بيفحص توكنات الصفحات");
ok(d.checks.some(c => /الذكاء بيرد/.test(c.name)), "بيجرّب نداء حقيقي للذكاء");
const noKey = d.checks.find(c => /مفتاح الذكاء/.test(c.name));
ok(noKey && !noKey.ok && /ما في مفتاح/.test(noKey.detail),
   "بلا مفتاح بيوقف عند المفتاح ويقول السبب صراحةً");

const uiSrc = fs.readFileSync("public/ai.html", "utf8");
ok(/diagnose\(\)/.test(uiSrc), "زر التشخيص موجود بالصفحة");
const srvSrc = fs.readFileSync("src/server.js", "utf8");
ok(/botDiagnose/.test(srvSrc),
   "🔴 التشخيص بينطبع بسجل الاستضافة عند الإقلاع — فالتاجر بيشوف السبب بلا ما يدخل الموقع");
ok(/فحص جاهزية البوت/.test(srvSrc), "وبعنوان واضح بالسجل");

// 🔴 مسار البوت ما عاد مثبّت على بوابة وحدة
const aiSrc = fs.readFileSync("src/bot/ai.js", "utf8");
ok(!/const OAI_BASE\s*=/.test(aiSrc),
   "🔴 الثابت المثبّت على بوابة وحدة انشال — كان بيخلي تغيير المزوّد ما يوصل البوت");
ok(/siteSetting\("ai_base"\)/.test(aiSrc), "مسار البوت بيقرأ عنوان البوابة من الإعدادات");
ok(/oaiBody\(/.test(aiSrc), "مسار البوت بيبني الجسم حسب نوع النموذج");

// ═══════════ الأرشفة ═══════════
const PAGE = "111", USER = "222";
ok(cap.archiveExternal({ pageId: PAGE, pageName: "غزة", senderId: USER,
                         direction: "in", body: "بدي جبنتين" }) === true, "أرشفة رسالة الزبون");
ok(cap.archiveExternal({ pageId: PAGE, pageName: "غزة", senderId: USER,
                         direction: "out", body: "أهلاً فيك", source: "🤖 رد خارجي:" }) === true,
   "أرشفة رد خارجي بوسم مصدره");
ok(cap.archiveExternal({ pageId: PAGE, pageName: "غزة", senderId: USER,
                         direction: "in", body: "   " }) === false, "الرسالة الفاضية ما بتنأرشف");

const rows = getChatMessages(PAGE, USER) || [];
ok(rows.length === 2, "الرسالتين انحفظوا بالأرشيف");
ok(rows.some(r => r.direction === "out" && /رد خارجي/.test(r.body)),
   "الرد الخارجي موسوم فبتعرف مين رد فعلاً");

// ═══════════ 🔴 الاستخراج من كلام الزبون فقط ═══════════
const convo = [
  { direction: "in",  body: "بدي جبنتين نابلسية" },
  // 🔴 رد فيه عنوان وسعر ما ذكرهم الزبون — ممنوع ينتقلوا لقاعدتنا
  { direction: "out", body: "🤖 رد خارجي: تمام، بنوصلك عمّان الدوار السابع، السعر 40 دينار" },
  { direction: "in",  body: "اوكي" }
];
const only = cap.customerOnlyText(convo);
ok(only.includes("جبنتين"), "نص الاستخراج فيه كلام الزبون");
ok(!only.includes("الدوار السابع"), "🔴 العنوان اللي اخترعه الرد الخارجي ما دخل نص الاستخراج");
ok(!only.includes("40"), "🔴 السعر اللي ذكره الرد الخارجي ما دخل نص الاستخراج");
ok(cap.customerOnlyText([]) === "", "محادثة فاضية بترجع نص فاضي");
ok(cap.customerOnlyText([{ direction: "out", body: "رد بس" }]) === "",
   "محادثة كلها ردود بلا رسالة زبون = ما في نص نستخرج منه");

// ═══════════ الناقص بينتبلّغ ═══════════
ok(cap.missingFields({ area: "", phone: "" }).length === 2, "العنوان والرقم الناقصين بينتبلّغوا");
ok(cap.missingFields({ area: "اربد", phone: "0791111111" }).length === 0, "الطلب الكامل ما إلو نواقص");
ok(cap.missingFields({ area: "اربد", phone: "" })[0] === "رقم الهاتف", "بيسمّي الناقص بالاسم");

// ═══════════ الحفظ ═══════════
const PC = { name: "أجبان غزة", PRICES: { "جبنة نابلسية": 15, "لبنة": 8 } };

let r = await cap.captureOrderFrom({ pageId: "", senderId: USER, pageConfig: PC, rows: convo });
ok(r.saved === false && /هوية/.test(r.reason), "بلا هوية صفحة ما بينحفظ طلب");

r = await cap.captureOrderFrom({ pageId: PAGE, senderId: USER, pageConfig: { name: "x", PRICES: {} }, rows: convo });
ok(r.saved === false && /أسعار/.test(r.reason), "صفحة بلا أسعار ما بتلتقط");

r = await cap.captureOrderFrom({ pageId: PAGE, senderId: USER, pageConfig: PC,
                                 rows: [{ direction: "out", body: "أهلاً" }] });
ok(r.saved === false && /رسائل من الزبون/.test(r.reason), "بلا رسالة زبون ما في التقاط");

// ═══════════ الوحدة مربوطة بالخادم ═══════════
const server = fs.readFileSync("src/server.js", "utf8");
ok(/entry\.standby/.test(server), "الخادم بيقرأ قناة standby");
ok(/is_echo.*captureEcho|captureEcho/.test(server), "الخادم بيمرّر الـecho للالتقاط");
ok(!/sendText\(/.test(fs.readFileSync("src/bot/capture.js", "utf8")),
   "🔴 وحدة الالتقاط ما بترسل ولا رسالة — استماع بحت");

const ui = fs.readFileSync("public/ai.html", "utf8");
ok(/api\/capture/.test(ui), "صفحة الإعدادات فيها تحكم بوضع الالتقاط");
ok(/message_echoes/.test(ui), "الصفحة بتقول للمستخدم شو لازم يشترك فيه عند ميتا");

wipe();
console.log(`\n${fail ? "🔴" : "🟢"} نجح ${pass} / فشل ${fail}`);
process.exit(fail ? 1 : 0);
