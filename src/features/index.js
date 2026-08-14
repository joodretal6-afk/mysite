// ═══════════════════════════════════════════════════════════
// ⚡ محمّل وحدات الميزات (80 ميزة / 8 وحدات)
// تحميل دفاعي: أي وحدة فيها خطأ تُتخطّى بدون ما توقف المنصة.
// ═══════════════════════════════════════════════════════════
const SLUGS = ["ordersops", "crm", "reports", "finance", "marketing", "botquality", "team", "system"];

export async function loadFeatures() {
  const loaded = [];
  for (const slug of SLUGS) {
    try {
      const m = await import(`./${slug}.js`);
      if (m.router && m.slug) {
        loaded.push({ slug: m.slug, title: m.title || m.slug, icon: m.icon || "⚡", router: m.router });
        console.log(`⚡ وحدة ميزات مُحمّلة: ${m.icon || ""} ${m.title || m.slug}`);
      }
    } catch (e) {
      console.error(`⚠️ تعذّر تحميل وحدة ${slug} (تُتخطى بدون تعطيل المنصة):`, e && e.message);
    }
  }
  return loaded;
}
