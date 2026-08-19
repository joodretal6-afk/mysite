/* ✦ Motion System — لغة حركة موحّدة، GPU فقط، تحترم reduced-motion والموبايل.
   بصري بحت، دفاعي بالكامل — ما بيلمس أي منطق ولا بيكسر أي وظيفة. */
(function () {
  var reduce = false, touch = false;
  try { reduce = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
  try { touch = matchMedia("(hover: none), (pointer: coarse)").matches || "ontouchstart" in window; } catch (e) {}
  var desktop = !touch && window.innerWidth > 900;

  function ready(fn) { if (document.body) fn(); else document.addEventListener("DOMContentLoaded", fn); }

  ready(function () {
    // 1) هالة ضوئية ثانية حيّة (خلفية)
    try { if (!document.querySelector(".pm-aura2")) { var a = document.createElement("div"); a.className = "pm-aura2"; document.body.appendChild(a); } } catch (e) {}

    if (reduce) return;   // من هون وطالع كله تحسينات حركة — نوقف لو المستخدم مايبغاش

    // 2) Scroll reveal للكتل الرئيسية فقط (مش صفوف الجداول)
    try {
      var io = new IntersectionObserver(function (ents) {
        ents.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
      }, { threshold: .08, rootMargin: "0px 0px -6% 0px" });

      function observe(el, i) {
        if (el.__pm) return; el.__pm = 1;
        el.classList.add("pm-reveal"); if (i) el.classList.add("d" + Math.min(i, 5));
        io.observe(el);
      }
      function scan() {
        // نختار الكتل العليا: البطاقات/المؤشرات/شريط الأدوات/بطاقة الجدول/الأقسام
        var groups = document.querySelectorAll(".stats, .grid.stats");
        groups.forEach(function (g) { Array.prototype.forEach.call(g.children, function (c, i) { observe(c, (i % 5) + 1); }); });
        document.querySelectorAll(".toolbar, .tbl-card, .pm-page > .card, .wrap > .card, section.view > .card")
          .forEach(function (el) { observe(el); });
      }
      scan();
      // العناصر اللي بتنحقن لاحقاً (مثل بطاقات المؤشرات) — نراقب #stats/الحاويات
      var host = document.querySelector(".stats") || document.querySelector("main") || document.body;
      if (host) { var mo = new MutationObserver(function () { scan(); countScan(); }); mo.observe(host.parentNode || host, { childList: true, subtree: true }); }
    } catch (e) {}

    // 3) Count-up لأرقام المؤشرات (مرة وحدة لكل عنصر)
    function animateCount(el) {
      var raw = el.textContent.trim(); if (!raw) return;
      var m = raw.match(/^([^\d]*)([\d,.]+)(.*)$/); if (!m) return;
      var pre = m[1], suf = m[3], numStr = m[2];
      var hasComma = numStr.indexOf(",") >= 0;
      var target = parseFloat(numStr.replace(/,/g, "")); if (!isFinite(target)) return;
      var dec = (numStr.split(".")[1] || "").length;
      el.setAttribute("data-counted", "1");
      var dur = 900, t0 = null;
      function fmt(v) { var s = dec ? v.toFixed(dec) : Math.round(v).toString(); if (hasComma) s = Number(s).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }); return pre + s + suf; }
      function step(ts) { if (!t0) t0 = ts; var p = Math.min((ts - t0) / dur, 1); var e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(target * e); if (p < 1) requestAnimationFrame(step); else el.textContent = pre + numStr + suf; }
      requestAnimationFrame(step);
    }
    function countScan() {
      document.querySelectorAll(".stat .n, .stat .num, .stat .value, .pm-count").forEach(function (el) {
        if (el.getAttribute("data-counted")) return;
        if (!el.textContent.trim()) return;
        animateCount(el);
      });
    }
    setTimeout(countScan, 260);

    // 4) ديسكتوب فقط: إمالة خفيفة للبطاقات + سبوت لايت للأزرار
    if (desktop) {
      // Spotlight للأزرار الرئيسية
      document.addEventListener("mousemove", function (e) {
        var b = e.target.closest && e.target.closest(".btn.primary, .pm-navbtn"); if (!b) return;
        var r = b.getBoundingClientRect();
        b.style.setProperty("--mx", (e.clientX - r.left) + "px");
        b.style.setProperty("--my", (e.clientY - r.top) + "px");
      }, { passive: true });

      // Tilt خفيف جداً على البطاقات (rAF-throttled)
      var raf = null;
      function bindTilt(card) {
        if (card.__tilt) return; card.__tilt = 1; card.classList.add("pm-tilt");
        card.addEventListener("mousemove", function (e) {
          if (raf) return;
          raf = requestAnimationFrame(function () {
            raf = null;
            var r = card.getBoundingClientRect();
            var rx = ((e.clientY - r.top) / r.height - .5) * -4;
            var ry = ((e.clientX - r.left) / r.width - .5) * 4;
            card.style.transform = "perspective(800px) rotateX(" + rx.toFixed(2) + "deg) rotateY(" + ry.toFixed(2) + "deg) translateY(-3px)";
          });
        }, { passive: true });
        card.addEventListener("mouseleave", function () { card.style.transform = ""; });
      }
      document.querySelectorAll(".stat").forEach(bindTilt);
      // البطاقات المحقونة لاحقاً
      try { var mo2 = new MutationObserver(function () { document.querySelectorAll(".stat").forEach(bindTilt); }); mo2.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    }
  });
})();
