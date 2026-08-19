/* ✦ مبدّل الثيمات العائم — موجود بكل صفحة، يحفظ الاختيار محلياً.
   بصري بحت، لا يمسّ أي منطق. */
(function () {
  var THEMES = [
    { id: "aurora",    name: "زمرّد ملكي",   dot: "linear-gradient(135deg,#22c98a,#e2c15f)" },
    { id: "sapphire",  name: "ياقوت الليل",  dot: "linear-gradient(135deg,#5b93ff,#46d5ff)" },
    { id: "champagne", name: "شمبانيا وردية", dot: "linear-gradient(135deg,#d88aa8,#c9a86a)" },
    { id: "sunset",    name: "غروب دافئ",     dot: "linear-gradient(135deg,#ff7a45,#f2a93c)" },
    { id: "mint",      name: "نعناع منعش",    dot: "linear-gradient(135deg,#10b981,#38bdf8)" }
  ];
  var KEY = "pm-theme";

  function current() { try { return localStorage.getItem(KEY) || "aurora"; } catch (e) { return "aurora"; } }
  function apply(id) { document.documentElement.setAttribute("data-theme", id); }
  function save(id) { try { localStorage.setItem(KEY, id); } catch (e) {} }

  // طبّق فوراً (قبل ما يبني الودجت) لتفادي الوميض
  apply(current());

  function build() {
    if (document.getElementById("pm-fab")) return;

    var fab = document.createElement("button");
    fab.id = "pm-fab"; fab.className = "pm-fab"; fab.type = "button";
    fab.title = "غيّر مظهر الموقع"; fab.textContent = "🎨";

    var panel = document.createElement("div");
    panel.className = "pm-panel"; panel.id = "pm-panel";
    var html = '<h4>🎨 اختر مظهر الموقع</h4>';
    THEMES.forEach(function (t) {
      html += '<button type="button" class="pm-swatch" data-theme-id="' + t.id + '">' +
              '<span class="pm-dot" style="background:' + t.dot + '"></span>' +
              '<span>' + t.name + '</span></button>';
    });
    panel.innerHTML = html;

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    function mark() {
      var c = current();
      panel.querySelectorAll(".pm-swatch").forEach(function (b) {
        b.classList.toggle("active", b.getAttribute("data-theme-id") === c);
      });
    }
    mark();

    fab.addEventListener("click", function (e) {
      e.stopPropagation();
      panel.classList.toggle("open");
    });
    panel.addEventListener("click", function (e) {
      var btn = e.target.closest(".pm-swatch");
      if (!btn) return;
      var id = btn.getAttribute("data-theme-id");
      apply(id); save(id); mark();
    });
    document.addEventListener("click", function (e) {
      if (!panel.contains(e.target) && e.target !== fab) panel.classList.remove("open");
    });
  }

  if (document.body) build();
  else document.addEventListener("DOMContentLoaded", build);
})();
