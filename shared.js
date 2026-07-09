/* Shared behavior: nav, subtle reveals, lightbox. No frameworks. */
(function () {
  "use strict";

  /* mobile menu */
  var menuBtn = document.getElementById("menuBtn");
  var navLinks = document.getElementById("navLinks");
  if (menuBtn) menuBtn.addEventListener("click", function () { navLinks.classList.toggle("open"); });

  /* year */
  var y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();

  /* scroll progress bar */
  var pb = document.createElement("div");
  pb.className = "scroll-progress";
  document.body.appendChild(pb);
  function onScrollProgress() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    pb.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + "%";
  }
  window.addEventListener("scroll", onScrollProgress, { passive: true });
  onScrollProgress();

  /* subtle scroll reveal */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    });
  }, { threshold: 0.1, rootMargin: "0px 0px -6% 0px" });
  document.querySelectorAll("[data-reveal]").forEach(function (n) { io.observe(n); });

  /* ---------- lightbox ----------
     Any element with [data-lb-group] joins a gallery. Image source is
     data-full (or the contained img's src); caption is data-cap. */
  var lb = document.getElementById("lightbox");
  if (!lb) return;
  var lbImg = document.getElementById("lbImg");
  var lbCap = document.getElementById("lbCap");
  var items = [], idx = 0;

  function collect(group) {
    return Array.prototype.slice.call(document.querySelectorAll('[data-lb-group="' + group + '"]'))
      .map(function (n) {
        var img = n.querySelector("img");
        return { src: n.getAttribute("data-full") || (img && img.getAttribute("src")), cap: n.getAttribute("data-cap") || "" };
      })
      .filter(function (it) { return !!it.src; });
  }
  function render() {
    var it = items[idx];
    lbImg.src = it.src; lbImg.alt = it.cap;
    lbCap.textContent = it.cap + "   ·   " + (idx + 1) + " / " + items.length;
  }
  function open(group, i) {
    items = collect(group);
    if (!items.length) return;
    idx = i; render();
    lb.classList.add("open");
    document.body.style.overflow = "hidden";
  }
  function close() { lb.classList.remove("open"); document.body.style.overflow = ""; }
  function step(d) { idx = (idx + d + items.length) % items.length; render(); }

  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-lb-group]");
    if (!t) return;
    var group = t.getAttribute("data-lb-group");
    var all = Array.prototype.slice.call(document.querySelectorAll('[data-lb-group="' + group + '"]'));
    open(group, all.indexOf(t));
  });
  document.getElementById("lbClose").addEventListener("click", close);
  document.getElementById("lbPrev").addEventListener("click", function () { step(-1); });
  document.getElementById("lbNext").addEventListener("click", function () { step(1); });
  lb.addEventListener("click", function (e) { if (e.target === lb) close(); });
  document.addEventListener("keydown", function (e) {
    if (!lb.classList.contains("open")) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
  });
})();
