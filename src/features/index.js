// ═══════════════════════════════════════════════════════════
// ⚡ محمّل وحدات الميزات (160 ميزة / 16 وحدة)
// تحميل دفاعي: أي وحدة فيها خطأ تُتخطّى بدون ما توقف المنصة.
// ═══════════════════════════════════════════════════════════
const SLUGS = [
  // ── الطبقة الأولى: التشغيل اليومي ──
  "ordersops", "crm", "reports", "finance", "marketing", "botquality", "team", "system",
  // ── الطبقة الثانية: القيادة والتوسع (إمبراطورية) ──
  "command", "leads", "pricing", "geo", "intel", "supply", "retention", "quality", "growth"
];

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
