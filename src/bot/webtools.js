// ═══════════════════════════════════════════════════════════
// 🌐 أدوات البحث الحقيقية لصيّاد المنتجات — بحث ويب فعلي + قراءة صفحات
// (بدون مفاتيح إضافية — عبر بحث DuckDuckGo العام وجلب الصفحات مباشرة)
// ═══════════════════════════════════════════════════════════
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ");
}

// 🔍 بحث ويب حقيقي — يرجع نتائج فعلية (عنوان، رابط، مقتطف)
export async function webSearch(query, max = 8) {
  const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "ar,en;q=0.8" },
    signal: AbortSignal.timeout(20000)
  });
  if (!r.ok) throw new Error("search HTTP " + r.status);
  const html = await r.text();
  const results = [];
  const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snipRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<td[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/td>/g;
  const snippets = [];
  let m;
  while ((m = snipRe.exec(html)) !== null) snippets.push(decodeEntities((m[1] || m[2] || "").replace(/<[^>]+>/g, "")).trim());
  let i = 0;
  while ((m = linkRe.exec(html)) !== null && results.length < max) {
    let href = m[1];
    // فك رابط DDG الوسيط
    const uddg = href.match(/uddg=([^&]+)/);
    if (uddg) { try { href = decodeURIComponent(uddg[1]); } catch {} }
    if (href.startsWith("//")) href = "https:" + href;
    const title = decodeEntities(m[2].replace(/<[^>]+>/g, "")).trim();
    // نتخطى روابط إعلانات محرك البحث نفسه (y.js) — بدنا النتائج الحقيقية فقط
    if (title && href.startsWith("http") && !/duckduckgo\.com\/y\.js/.test(href)) {
      results.push({ title, url: href, snippet: snippets[i] || "" });
    }
    i++;
  }
  return results;
}

// 📄 فتح صفحة وقراءة نصها الفعلي
export async function fetchPage(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "ar,en;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(20000)
  });
  const html = await r.text();
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
  const text = decodeEntities(html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")).trim();
  return { title: decodeEntities(title).trim(), status: r.status, text: text.slice(0, 4500) };
}
