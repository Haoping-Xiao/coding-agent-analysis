(function () {
  "use strict";
  var D = window.SITE_DATA || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(x) { return String(x == null ? "" : x); }

  /* ---------- 滚动进度 + 导航态 ---------- */
  var nav = $("#nav");
  var progress = $("#scrollProgress");
  function onScroll() {
    var h = document.documentElement;
    var sc = h.scrollTop || document.body.scrollTop;
    var max = h.scrollHeight - h.clientHeight;
    if (progress) progress.style.width = (max > 0 ? (sc / max) * 100 : 0) + "%";
    if (nav) nav.classList.toggle("is-scrolled", sc > 12);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- 移动端菜单 ---------- */
  var toggle = $("#navToggle");
  var links = $(".nav__links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("is-open");
      toggle.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    $$(".nav__links a").forEach(function (a) {
      a.addEventListener("click", function () {
        links.classList.remove("is-open");
        toggle.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* ---------- 导航高亮 + reveal 动画 ---------- */
  var sections = $$("main section[id]");
  var navMap = {};
  $$(".nav__links a").forEach(function (a) {
    var id = a.getAttribute("href").slice(1);
    navMap[id] = a;
  });
  if ("IntersectionObserver" in window) {
    var navObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && navMap[e.target.id]) {
          $$(".nav__links a").forEach(function (x) { x.classList.remove("is-active"); });
          navMap[e.target.id].classList.add("is-active");
        }
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    sections.forEach(function (s) { navObs.observe(s); });

    var revObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-in"); revObs.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    $$(".reveal").forEach(function (el) { revObs.observe(el); });
  } else {
    $$(".reveal").forEach(function (el) { el.classList.add("is-in"); });
  }

  /* ---------- 核心循环 ---------- */
  var loopSteps = $$("#loopSteps .loop__step");
  var loopDetail = $("#loopDetail");
  var dots = $$(".orbit__dot");
  function renderLoop(i) {
    var d = (D.loop || [])[i];
    if (!d || !loopDetail) return;
    loopSteps.forEach(function (s, k) { s.classList.toggle("is-active", k === i); });
    dots.forEach(function (dot, k) { dot.style.opacity = k === i ? "1" : ""; dot.style.transform = "rotate(" + (k * 72) + "deg) translateX(86px) scale(" + (k === i ? 1.5 : 1) + ")"; });
    loopDetail.innerHTML =
      '<h3>' + esc(d.t) + '</h3>' +
      '<p>' + esc(d.d) + '</p>' +
      '<code class="mini-code">' + esc(d.code) + '</code>' +
      '<p class="note">💡 ' + esc(d.note) + '</p>';
    loopDetail.classList.remove("fade-swap"); void loopDetail.offsetWidth; loopDetail.classList.add("fade-swap");
  }
  loopSteps.forEach(function (s) {
    s.addEventListener("click", function () { renderLoop(parseInt(s.getAttribute("data-step"), 10)); });
  });
  renderLoop(0);

  /* ---------- 五大部件 tabs ---------- */
  var anatomyBody = $("#anatomyBody");
  function renderAtom(key) {
    var a = (D.anatomy || {})[key];
    if (!a || !anatomyBody) return;
    var pts = (a.points || []).map(function (p) {
      return '<div class="atom__point"><h4>' + esc(p[0]) + '</h4><p>' + esc(p[1]) + '</p></div>';
    }).join("");
    anatomyBody.innerHTML =
      '<div class="atom fade-swap">' +
        '<h3>' + esc(a.title) + '</h3>' +
        '<p class="atom__lead">' + esc(a.lead) + '</p>' +
        '<div class="atom__points">' + pts + '</div>' +
        '<p class="evidence">📄 证据文件：' + a.evidence + '</p>' +
      '</div>';
  }
  $$("#anatomyTabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      $$("#anatomyTabs button").forEach(function (x) { x.classList.remove("is-active"); });
      b.classList.add("is-active");
      renderAtom(b.getAttribute("data-a"));
    });
  });
  renderAtom("tools");

  /* ---------- 厂商 tabs ---------- */
  var vendorBody = $("#vendorBody");
  var vColors = { codex: "var(--codex)", claude: "var(--claude)", gemini: "var(--gemini)", opencode: "var(--opencode)", kimi: "var(--kimi)" };
  function renderVendor(key) {
    var v = (D.vendors || {})[key];
    if (!v || !vendorBody) return;
    var col = vColors[key] || "var(--accent)";
    var tricks = (v.tricks || []).map(function (t, i) {
      return '<div class="trick" style="--vc:' + col + '"><h4><i>0' + (i + 1) + '</i>' + esc(t[0]) + '</h4><p>' + esc(t[1]) + '</p></div>';
    }).join("");
    vendorBody.innerHTML =
      '<div class="vd fade-swap">' +
        '<div class="vd__top"><h3 class="vd__name">' + esc(v.name) + '</h3><span class="vd__who">' + esc(v.who) + '</span></div>' +
        '<span class="vd__tag" style="background:' + col + '">招牌：' + esc(v.tag) + '</span>' +
        '<p class="vd__summary">' + esc(v.summary) + '</p>' +
        '<div class="vd__tricks">' + tricks + '</div>' +
        '<p class="evidence">📄 证据文件：' + v.evidence + '</p>' +
      '</div>';
  }
  $$("#vendorTabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      $$("#vendorTabs button").forEach(function (x) { x.classList.remove("is-active"); });
      b.classList.add("is-active");
      renderVendor(b.getAttribute("data-v"));
    });
  });
  renderVendor("codex");

  /* hero chips → 跳到对应厂商 */
  $$("#heroChips .chip").forEach(function (c) {
    c.addEventListener("click", function () {
      var v = c.getAttribute("data-v");
      var btn = $('#vendorTabs button[data-v="' + v + '"]');
      if (btn) { btn.click(); document.getElementById("vendors").scrollIntoView({ behavior: "smooth" }); }
    });
  });

  /* ---------- 对比表 ---------- */
  var tbody = $("#compareTable tbody");
  if (tbody && D.compare) {
    tbody.innerHTML = D.compare.map(function (row) {
      return "<tr>" + row.map(function (cell, i) {
        return (i === 0 ? "<td>" : "<td>") + esc(cell) + "</td>";
      }).join("") + "</tr>";
    }).join("");
  }
})();
