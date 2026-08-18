// ═══════════════════════════════════════════════════════════
// واجهة مشتركة لصفحات عقل المبيعات.
// كل صفحة بتعرّف تبويباتها بس — العرض والتنسيق من هون.
// ═══════════════════════════════════════════════════════════
window.BUI = (() => {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const num = n => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });
  const dt = t => t ? new Date(Number(t)).toLocaleDateString("ar-EG",
    { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

  const conf = c => c ? `<span class="conf c-${esc(c.level).replace(/\s/g, "_")}" title="${esc(c.note || "")}">ثقة ${esc(c.level)}</span>` : "";

  // شريط الأساس — ما بتنعرض صفحة بلاه. كل رقم لازم يعرف مصدره.
  const basis = b => {
    if (!b) return "";
    const items = Object.entries(b).filter(([, v]) => v != null && v !== "");
    if (!items.length) return "";
    const warn = items.some(([k]) => k.includes("🔴") || k.includes("تحذير"));
    return `<div class="basis ${warn ? "warn" : ""}">
      ${items.map(([k, v]) => `<div><b>${esc(k.replace(/_/g, " "))}:</b> ${esc(Array.isArray(v) ? v.join(" · ") : v)}</div>`).join("")}
    </div>`;
  };

  const kpis = arr => `<div class="kpis">${arr.map(k => `<div class="kpi">
    <div class="lbl">${esc(k.lbl)}</div>
    <div class="val ${k.tone || ""}">${k.raw ? esc(k.val) : num(k.val)}${k.suffix || ""}</div>
    ${k.sub ? `<div class="sub">${esc(k.sub)}</div>` : ""}</div>`).join("")}</div>`;

  const table = (cols, rows, rowFn) => rows && rows.length
    ? `<div class="tw"><table><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
       <tbody>${rows.map(r => `<tr>${rowFn(r).map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
    : `<div class="empty">ما في بيانات لعرضها</div>`;

  const headline = (txt, tone) => txt ? `<div class="headline ${tone || ""}">${esc(txt)}</div>` : "";
  // الرابط بيجي محسوب من السيرفر (رابط صندوق الصفحة) — الـ sender_id لحاله
  // ما بيصلح رابط، لأنه PSID مربوط بالصفحة مش معرّف عام.
  // بلا رابط صالح منعرض المعرّف كنص بدل ما نعطي رابط بيوقّع على "غير متوفر".
  const mlink = (sid, url) => {
    const label = esc(String(sid).slice(0, 12)) + "…";
    return url ? `<a class="m" href="${esc(url)}" target="_blank" rel="noopener"
      title="بيفتح المحادثة بصندوق الصفحة">${label}</a>`
      : `<span class="mut" title="ما في معرّف صفحة لهاد السجل — ما بنقدر نبني رابط">${label}</span>`;
  };
  const bar = (v, max, label) => `<div class="bar"><i style="width:${max ? Math.min(100, v * 100 / max) : 0}%"></i><span>${esc(label)}</span></div>`;

  // إدارة التبويبات + الجلب
  function mount(tabs) {
    const nav = document.querySelector("#tabs"), out = document.querySelector("#out");
    nav.innerHTML = tabs.map((t, i) =>
      `<button data-i="${i}" class="${i ? "" : "on"}">${esc(t.label)}</button>`).join("");

    let cur = 0;
    async function show(i) {
      cur = i;
      [...nav.children].forEach((b, k) => b.classList.toggle("on", k === i));
      out.innerHTML = '<div class="load">⏳ بنحلّل بياناتك…</div>';
      const t = tabs[i];
      try {
        const r = await fetch(t.url(), t.init ? t.init() : undefined);
        const j = await r.json();
        if (j.error) throw new Error(j.error);
        out.innerHTML = t.render(j, API) + basis(j.basis);
        if (t.after) t.after(j);
      } catch (e) {
        out.innerHTML = `<div class="err">تعذّر التحليل: ${esc(e.message)}</div>`;
      }
    }
    nav.addEventListener("click", e => {
      const b = e.target.closest("button[data-i]");
      if (b) show(Number(b.dataset.i));
    });
    const dsel = document.querySelector("#days");
    if (dsel) dsel.addEventListener("change", () => show(cur));
    show(0);
    return { reload: () => show(cur) };
  }

  const days = () => (document.querySelector("#days") || { value: 30 }).value;
  const API = { esc, num, dt, conf, basis, kpis, table, headline, mlink, bar, days };
  return { ...API, mount };
})();
