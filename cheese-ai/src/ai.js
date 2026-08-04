// ═══════════════════════════════════════════════════════════
// محرك الذكاء: يبني معرفة البوت من قاعدة البيانات (RAG بسيط)
// ويعطيه شخصية إنسان حقيقي — بائع أجبان نابلسي لبق — دون أن يبدو بوتاً.
// يدعم Gemini و OpenAI، والمفتاح/الموديل من الإعدادات.
// ═══════════════════════════════════════════════════════════

// 🧀 شخصية البوت وأسلوب حديثه (الأهم — يخليه يحكي طبيعي زي إنسان)
const PERSONA = `أنت "{BRAND}" — خبير أجبان نابلسي حقيقي، ابن كار، بتحب شغلك وبتعتز بجبنتك.
إنت مش موظف رسمي ولا آلة — إنت زلمة طيّب، بشوش، ودمّك خفيف، وبتحكي مع الزبون زي ما بيحكي صاحب المحل مع جاره.

━━ كيف تحكي (الأسلوب) ━━
- لهجتك أردنية/شامية دافية وطبيعية: "يا هلا والله"، "تكرم عينك"، "من عيوني"، "صحتين وعافية"، "نورتنا".
- خلي كلامك قصير وحيوي زي محادثة واتساب، مش خطابات طويلة. جملة أو جملتين بالردّ الغالب.
- تفاعل مع مشاعر الزبون: إذا متردد طمّنه، إذا مستعجل جهّزله بسرعة، إذا مبسوط شاركه الفرحة.
- استعمل إيموجي بسيط وبمكانه (🧀 🌹 😋) بدون مبالغة.
- لا تكرّر نفس الجملة، ولا ترد بشكل آلي أو مسطرة. كل رد يكون طبيعي حسب سياق الكلام.
- إذا سألك "كيفك" أو دردش معك عادي، ردّ بلطف إنساني ورجّعه للجبنة بلبقة، مثلاً: "الحمدلله تمام، منوّرين! شو بتحب أجهّزلك اليوم؟ 🧀".

━━ كيف ترحّب وكيف تنهي ━━
- الترحيب: دافي ومختصر، مثل: "يا هلا فيك، نوّرت! 🌹 شو بخدمك؟".
- النهاية: إذا خلص الطلب أو ودّعك، ودّعه بمحبة: "صحتين وعافية، ومنتظرينك دايماً 🌹".

━━ حدودك (مهم جداً) ━━
- إنت متخصص بالأجبان فقط: الأنواع، الأسعار، اللبنة، الحلوم، العكاوي، التخزين، الملح، الوزن، التوصيل، الطلبات.
- إذا سألك عن أي شي خارج الجبنة (سياسة، رياضة، رياضيات، أخبار، برمجة، أي موضوع تاني) ردّ بلطف وخفة: "هههه أنا اختصاصي جبنة بس 🧀 بس اسألني عن أي شي بالأجبان وأنا جاهز!" — بدون ما تجاوب على السؤال نفسه.
- لا تخترع معلومات غير موجودة. إذا صنف مش عندك بالقائمة، قول بصدق: "لا والله هالصنف مش متوفر حالياً" واقترح البديل الأقرب.

━━ البيع وإتمام الطلب ━━
- إذا حابب صنف، خبّره سعره ووزنه بوضوح.
- احسب الحساب صح لما يطلب كمية (السعر × العدد).
- عشان تعتمد الطلب لازم: (١) الصنف والكمية، (٢) العنوان، (٣) رقم الهاتف. إذا ناقص إشي، اطلبه بلطف — إشي واحد بس مش كلهم مرة وحدة.
- لما تكتمل كل التفاصيل، لخّص الطلب بفاتورة واضحة وأكّده بحماس.
- اقترح صنف إضافي مناسب مرّة وحدة بلطف بدون إلحاح (مثلاً مع الجبنة يناسبها لبنة أو زعتر).

تذكّر: هدفك تخلّي الزبون يحس إنه بيحكي مع "شيخ جبنة" حقيقي بيفهم بصنعته ويحبّه — مش مع برنامج.`;

// 📚 يبني المعرفة الحيّة من قاعدة البيانات (تتحدّث لحظياً مع أي تعديل)
export function buildKnowledge(store) {
  const s = store.settings();
  const products = store.products();
  const faqs = store.faqs();

  const priceLines = products.map(p =>
    `• ${p.name}${p.type ? ` (${p.type})` : ""}: ${p.price} دينار / ${p.unit}${p.note ? ` — ${p.note}` : ""}`
  ).join("\n");

  const faqLines = faqs.map(f => `س: ${f.q}\nج: ${f.a}`).join("\n");

  return `📋 قائمة المنتجات والأسعار الحالية (اعتمدها حرفياً):
${priceLines}

ℹ️ معلومات المتجر:
- الوزن: ${s.weight}
- الملح: ${s.salt}
- التخزين: ${s.storage}
- التوصيل: ${s.delivery}
- أوقات العمل: ${s.hours}${s.phone ? `\n- للتواصل: ${s.phone}` : ""}

❓ أسئلة شائعة وإجاباتها:
${faqLines}${s.extraKnowledge ? `\n\n📌 معلومات إضافية من الإدارة:\n${s.extraKnowledge}` : ""}`;
}

function systemPrompt(store) {
  const s = store.settings();
  return PERSONA.replace(/\{BRAND\}/g, s.brand || "شيخ الجبنة") + "\n\n" + buildKnowledge(store);
}

// ── الرد على الزبون (يختار المزوّد حسب الإعدادات) ──
export async function chat(store, history) {
  const s = store.settings();
  if (!s.apiKey) return { error: "لم يُضبط مفتاح API بعد. افتح لوحة الإدارة ← الإعدادات وأدخل مفتاحك." };
  const sys = systemPrompt(store);
  try {
    const text = s.provider === "openai"
      ? await callOpenAI(s, sys, history)
      : await callGemini(s, sys, history);
    return { reply: (text || "").replace(/\*\*/g, "").trim() || "يا هلا فيك 🌹 شو بتحب أجهّزلك؟" };
  } catch (e) {
    console.error("chat error:", e && e.message);
    return { error: "صار خطأ بالاتصال بمزوّد الذكاء: " + (e && e.message) };
  }
}

async function callGemini(s, sys, history) {
  const contents = history.map(h => ({
    role: h.role === "assistant" ? "model" : "user",
    parts: [{ text: h.content }]
  }));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${s.model}:generateContent?key=${s.apiKey}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sys }] },
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 600 }
    }),
    signal: AbortSignal.timeout(30000)
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return (d?.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
}

async function callOpenAI(s, sys, history) {
  const messages = [{ role: "system", content: sys },
    ...history.map(h => ({ role: h.role === "assistant" ? "assistant" : "user", content: h.content }))];
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.apiKey}` },
    body: JSON.stringify({ model: s.model, messages, temperature: 0.7, max_tokens: 600 }),
    signal: AbortSignal.timeout(30000)
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return d?.choices?.[0]?.message?.content || "";
}

// ── استخراج الطلب من المحادثة (يحفظ الأوردر عند اكتماله) ──
export async function extractOrder(store, history) {
  const s = store.settings();
  if (!s.apiKey) return null;
  const products = store.products();
  const names = products.map(p => p.name).join(" | ");
  const convo = history.map(h => `${h.role === "assistant" ? "البوت" : "الزبون"}: ${h.content}`).join("\n");
  const prompt = `حلّل المحادثة التالية بين زبون وبائع أجبان، واستخرج الطلب إن وُجد.
المنتجات المتاحة (طابِق الاسم الأقرب): ${names}
أعد JSON فقط بالشكل:
{"is_order": true/false, "complete": true/false, "items":[{"name":"<اسم من القائمة>","qty":<عدد>}], "area":"<العنوان أو فراغ>", "phone":"<رقم أردني 07xxxxxxxx أو فراغ>", "customer":"<اسم الزبون أو فراغ>"}
- complete=true فقط إذا في أصناف + عنوان + رقم هاتف.
- إذا ما في نية طلب، is_order=false.
المحادثة:
${convo.slice(0, 5000)}`;
  try {
    let raw = "";
    if (s.provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.apiKey}` },
        body: JSON.stringify({ model: s.model, messages: [{ role: "user", content: prompt }], temperature: 0, response_format: { type: "json_object" } }),
        signal: AbortSignal.timeout(20000)
      });
      if (!r.ok) return null;
      raw = (await r.json())?.choices?.[0]?.message?.content || "";
    } else {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${s.model}:generateContent?key=${s.apiKey}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 500 } }),
        signal: AbortSignal.timeout(20000)
      });
      if (!r.ok) return null;
      raw = ((await r.json())?.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
    }
    const m = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : raw);
    const items = (Array.isArray(parsed.items) ? parsed.items : [])
      .map(it => {
        const prod = products.find(p => p.name === it.name) || products.find(p => it.name && (p.name.includes(it.name) || it.name.includes(p.name)));
        return prod ? { name: prod.name, qty: parseInt(it.qty, 10) || 1, price: prod.price, unit: prod.unit } : null;
      }).filter(Boolean);
    if (!parsed.is_order || !items.length) return null;
    const total = items.reduce((t, it) => t + it.price * it.qty, 0);
    return {
      is_order: true,
      complete: Boolean(parsed.complete && parsed.area && parsed.phone),
      items, total,
      area: String(parsed.area || "").slice(0, 200),
      phone: String(parsed.phone || "").replace(/[^\d+]/g, "").slice(0, 15),
      customer: String(parsed.customer || "").slice(0, 60)
    };
  } catch (e) { console.error("extractOrder:", e && e.message); return null; }
}
