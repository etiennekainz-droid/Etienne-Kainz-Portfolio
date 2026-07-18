/* Shared behavior: nav, subtle reveals, lightbox. No frameworks. */
(function () {
  "use strict";

  var root = document.documentElement;
  var body = document.body;

  /* A restrained instrumentation layer ties the portfolio pages to the live
     simulations without turning the interface into a fictional cockpit. */
  var telemetry = document.createElement("aside");
  telemetry.className = "site-telemetry";
  telemetry.setAttribute("aria-hidden", "true");
  telemetry.innerHTML =
    '<span class="site-telemetry__code">EK // FIELD</span>' +
    '<span class="site-telemetry__track"><i></i></span>' +
    '<span class="site-telemetry__section">SYSTEM 01</span>' +
    '<span class="site-telemetry__value">000.0%</span>';
  body.appendChild(telemetry);
  var telemetryTrack = telemetry.querySelector("i");
  var telemetryValue = telemetry.querySelector(".site-telemetry__value");
  var telemetrySection = telemetry.querySelector(".site-telemetry__section");

  var pageCode = body.classList.contains("projects-page") ? "PROJECT FIELD 02" :
    body.classList.contains("drawings-page") ? "DRAWING FIELD 03" :
    body.classList.contains("aerial-page") ? "AERIAL FIELD 04" :
    body.classList.contains("certifications-page") ? "KNOWLEDGE FIELD 05" :
    "SYSTEM 01";
  telemetrySection.textContent = pageCode;

  var pointerTargetX = 50;
  var pointerTargetY = 35;
  var pointerX = pointerTargetX;
  var pointerY = pointerTargetY;
  var pointerFrame = 0;
  function paintPointerField() {
    pointerFrame = 0;
    pointerX += (pointerTargetX - pointerX) * 0.12;
    pointerY += (pointerTargetY - pointerY) * 0.12;
    root.style.setProperty("--pointer-x", pointerX.toFixed(2) + "%");
    root.style.setProperty("--pointer-y", pointerY.toFixed(2) + "%");
    if (Math.abs(pointerTargetX - pointerX) > 0.08 || Math.abs(pointerTargetY - pointerY) > 0.08) {
      pointerFrame = requestAnimationFrame(paintPointerField);
    }
  }
  window.addEventListener("pointermove", function (event) {
    pointerTargetX = event.clientX / Math.max(1, window.innerWidth) * 100;
    pointerTargetY = event.clientY / Math.max(1, window.innerHeight) * 100;
    if (!pointerFrame) pointerFrame = requestAnimationFrame(paintPointerField);
  }, { passive: true });

  var fieldShockTimer = 0;
  window.addEventListener("ek:field-event", function () {
    body.classList.remove("field-shock");
    void body.offsetWidth;
    body.classList.add("field-shock");
    clearTimeout(fieldShockTimer);
    fieldShockTimer = setTimeout(function () { body.classList.remove("field-shock"); }, 1300);
  });

  /* mobile menu */
  var menuBtn = document.getElementById("menuBtn");
  var navLinks = document.getElementById("navLinks");
  function setMenuOpen(open) {
    if (!menuBtn || !navLinks) return;
    navLinks.classList.toggle("open", open);
    body.classList.toggle("nav-open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
  }
  if (menuBtn && navLinks) {
    menuBtn.addEventListener("click", function () {
      setMenuOpen(!navLinks.classList.contains("open"));
    });
    navLinks.addEventListener("click", function (event) {
      if (event.target.closest("a")) setMenuOpen(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") setMenuOpen(false);
    });
  }

  /* year */
  var y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();

  /* scroll progress bar */
  var pb = document.createElement("div");
  pb.className = "scroll-progress";
  document.body.appendChild(pb);
  function onScrollProgress() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var progress = max > 0 ? Math.max(0, Math.min(1, window.scrollY / max)) : 0;
    var percent = progress * 100;
    pb.style.width = percent + "%";
    telemetryTrack.style.transform = "scaleY(" + progress.toFixed(4) + ")";
    telemetryValue.textContent = percent.toFixed(1).padStart(5, "0") + "%";
    body.classList.toggle("is-scrolled", window.scrollY > 24);
  }
  window.addEventListener("scroll", onScrollProgress, { passive: true });
  onScrollProgress();

  /* subtle scroll reveal */
  var revealNodes = document.querySelectorAll("[data-reveal]");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.1, rootMargin: "0px 0px -6% 0px" });
    revealNodes.forEach(function (n) { io.observe(n); });
  } else {
    revealNodes.forEach(function (n) { n.classList.add("in"); });
  }

  /* Project pages use a thin positional rail instead of another boxed index. */
  var projects = Array.prototype.slice.call(document.querySelectorAll(".proj[id]"));
  if (projects.length > 1) {
    var projectRail = document.createElement("nav");
    projectRail.className = "project-rail";
    projectRail.setAttribute("aria-label", "Project index");
    projects.forEach(function (project, projectIndex) {
      var link = document.createElement("a");
      link.href = "#" + project.id;
      link.setAttribute("aria-label", "Project " + project.getAttribute("data-project"));
      link.innerHTML = '<span>' + String(projectIndex + 1).padStart(2, "0") + '</span><i></i>';
      projectRail.appendChild(link);
    });
    body.appendChild(projectRail);
    var railLinks = Array.prototype.slice.call(projectRail.querySelectorAll("a"));
    if ("IntersectionObserver" in window) {
      var projectObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var activeIndex = projects.indexOf(entry.target);
          railLinks.forEach(function (link, linkIndex) {
            if (linkIndex === activeIndex) link.setAttribute("aria-current", "true");
            else link.removeAttribute("aria-current");
          });
          telemetrySection.textContent = "PROJECT FIELD " + entry.target.getAttribute("data-project");
        });
      }, { threshold: 0.22, rootMargin: "-18% 0px -48% 0px" });
      projects.forEach(function (project) { projectObserver.observe(project); });
    }
  }

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

  Array.prototype.slice.call(document.querySelectorAll("[data-lb-group]")).forEach(function (node) {
    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
    node.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      var group = node.getAttribute("data-lb-group");
      var all = Array.prototype.slice.call(document.querySelectorAll('[data-lb-group="' + group + '"]'));
      open(group, all.indexOf(node));
    });
  });

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
