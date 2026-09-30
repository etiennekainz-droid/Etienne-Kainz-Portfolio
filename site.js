/* Site behaviour: menu, page changes that keep the background running,
   pictures flowing in, project pages from project-data.js, and the lightbox. */
(function () {
  "use strict";

  var doc = document;
  var body = doc.body;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var field = function () { return window.EKField || { setScene: function () {}, pulse: function () {} }; };

  function qsa(selector, scope) {
    return Array.prototype.slice.call((scope || doc).querySelectorAll(selector));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
    });
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  // ------------------------------------------------------------------ menu
  var menu = doc.getElementById("menu");
  var menuToggle = doc.getElementById("menuToggle");
  var menuLabel = menuToggle && menuToggle.querySelector(".menu-toggle__label");

  function setMenu(open) {
    if (!menu || !menuToggle) return;
    body.classList.toggle("menu-open", open);
    menu.setAttribute("aria-hidden", open ? "false" : "true");
    menuToggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (menuLabel) menuLabel.textContent = open ? "Close" : "Menu";
    if (open) {
      var first = menu.querySelector("a");
      if (first) first.focus({ preventScroll: true });
    }
  }

  if (menuToggle) {
    menuToggle.addEventListener("click", function () {
      setMenu(!body.classList.contains("menu-open"));
    });
  }

  function markCurrent() {
    var here = pageKey(window.location.href);
    qsa(".menu nav a").forEach(function (link) {
      var target = pageKey(link.href);
      var current = target === here || (here === "project.html" && target === "projects.html");
      if (current) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function pageKey(href) {
    var path = new URL(href, window.location.href).pathname;
    var file = path.slice(path.lastIndexOf("/") + 1);
    return file === "" ? "index.html" : file;
  }

  // ------------------------------------------------------------- reveals
  var observer = null;

  function reveal(scope) {
    var targets = qsa("[data-reveal]:not(.is-in)", scope);
    if (reduced || !("IntersectionObserver" in window)) {
      targets.forEach(function (el) { el.classList.add("is-in"); });
      return;
    }
    if (observer) observer.disconnect();
    observer = new IntersectionObserver(function (entries) {
      var entering = entries.filter(function (entry) { return entry.isIntersecting; });
      entering.forEach(function (entry, index) {
        entry.target.style.setProperty("--d", (index * 0.09).toFixed(2) + "s");
        entry.target.classList.add("is-in");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 });
    targets.forEach(function (el) { observer.observe(el); });
  }

  // ------------------------------------------------------------ projects
  var data = window.PORTFOLIO_PROJECTS || {};
  var order = window.PORTFOLIO_PROJECT_ORDER || Object.keys(data);

  function figure(src, caption, w, h, index, eager) {
    var size = w && h ? ' width="' + w + '" height="' + h + '"' : "";
    return '<figure class="item" data-reveal data-lightbox data-caption="' + escapeHtml(caption) + '">' +
      '<div class="item__media"><img src="' + escapeHtml(src) + '"' + size + ' alt="' + escapeHtml(caption) +
      '" loading="' + (eager ? "eager" : "lazy") + '" decoding="async"></div>' +
      '<figcaption class="label"><span>' + pad(index + 1) + '</span><span>' + escapeHtml(caption) + '</span></figcaption></figure>';
  }

  function renderProjectList(scope) {
    var grid = scope.querySelector("[data-project-list]");
    if (!grid) return;
    grid.innerHTML = order.filter(function (key) { return data[key]; }).map(function (key, index) {
      var p = data[key];
      var cover = p.cover || p.images[0][0];
      return '<a class="item item--project" data-reveal href="project.html?p=' + encodeURIComponent(key) + '">' +
        '<div class="item__media"><img src="' + escapeHtml(cover) + '" alt="" loading="' + (index < 2 ? "eager" : "lazy") + '" decoding="async"></div>' +
        '<div class="item__caption label"><span>' + pad(index + 1) + '</span><span>' + escapeHtml(p.tags || "") + '</span></div>' +
        '<h2>' + escapeHtml(p.title) + '<span class="item__arrow" aria-hidden="true">↗</span></h2>' +
        '<p>' + escapeHtml(p.short || p.line) + '</p></a>';
    }).join("");
  }

  function renderProject(scope) {
    var holder = scope.querySelector("[data-project]");
    if (!holder) return;
    var keys = order.filter(function (key) { return data[key]; });
    var key = new URLSearchParams(window.location.search).get("p");
    var index = keys.indexOf(key);
    if (index < 0) {
      holder.innerHTML = '<header class="page-head"><div class="page-head__meta label"><a href="projects.html">← Projects</a></div>' +
        '<h1 class="shine">Project not found</h1><p>This project does not exist or has moved.</p></header>';
      return;
    }
    var p = data[key];
    doc.title = p.title + " — Etienne Kainz";
    var tags = (p.meta || []).map(function (m) { return "<span>" + escapeHtml(m) + "</span>"; }).join("");
    var docs = (p.docs || []).map(function (d) {
      return '<a href="' + escapeHtml(d[0]) + '" target="_blank" rel="noopener"><span>PDF</span>' + escapeHtml(d[1]) + ' ↗</a>';
    }).join("");
    var next = keys[(index + 1) % keys.length];
    var prev = keys[(index - 1 + keys.length) % keys.length];
    holder.innerHTML =
      '<header class="page-head">' +
        '<div class="page-head__meta label"><a href="projects.html">← Projects</a><span>' + pad(index + 1) + ' / ' + pad(keys.length) + '</span><span>' + escapeHtml(p.status || "") + '</span></div>' +
        '<h1 class="shine">' + escapeHtml(p.title) + '</h1>' +
        '<p>' + escapeHtml(p.line) + '</p>' +
        (tags ? '<div class="page-head__tags label">' + tags + '</div>' : "") +
        (docs ? '<div class="page-head__docs label">' + docs + '</div>' : "") +
      '</header>' +
      '<div class="gallery gallery--drawings">' +
        p.images.map(function (img, i) { return figure(img[0], img[1], img[2], img[3], i, i < 2); }).join("") +
      '</div>' +
      '<nav class="page-end" aria-label="More projects">' +
        '<a href="project.html?p=' + encodeURIComponent(prev) + '"><span class="label">Previous</span><span class="page-end__title">' + escapeHtml(data[prev].title) + '</span></a>' +
        '<a class="page-end__next" href="project.html?p=' + encodeURIComponent(next) + '"><span class="label">Next</span><span class="page-end__title">' + escapeHtml(data[next].title) + '</span></a>' +
      '</nav>';
  }

  // ------------------------------------------------------------ lightbox
  var box = doc.getElementById("lightbox");
  var boxImg = box && box.querySelector("img");
  var boxCaption = box && box.querySelector("[data-lightbox-caption]");
  var boxCount = box && box.querySelector("[data-lightbox-count]");
  var boxItems = [];
  var boxIndex = 0;
  var boxReturn = null;

  function collectLightbox(scope) {
    boxItems = qsa("[data-lightbox]", scope);
    boxItems.forEach(function (item, index) {
      item.setAttribute("tabindex", "0");
      item.setAttribute("role", "button");
      item.addEventListener("click", function () { openBox(index); });
      item.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openBox(index);
        }
      });
    });
  }

  function showBox(index) {
    if (!boxItems.length) return;
    boxIndex = (index + boxItems.length) % boxItems.length;
    var item = boxItems[boxIndex];
    var img = item.querySelector("img");
    boxImg.src = img.currentSrc || img.src;
    boxImg.alt = img.alt || "";
    boxImg.classList.toggle("is-light", item.classList.contains("is-light"));
    if (boxCaption) boxCaption.textContent = item.getAttribute("data-caption") || img.alt || "";
    if (boxCount) boxCount.textContent = pad(boxIndex + 1) + " / " + pad(boxItems.length);
  }

  function openBox(index) {
    if (!box) return;
    boxReturn = doc.activeElement;
    showBox(index);
    body.classList.add("lightbox-open");
    box.setAttribute("aria-hidden", "false");
    var close = box.querySelector("[data-lightbox-close]");
    if (close) close.focus({ preventScroll: true });
  }

  function closeBox() {
    if (!box || !body.classList.contains("lightbox-open")) return;
    body.classList.remove("lightbox-open");
    box.setAttribute("aria-hidden", "true");
    if (boxReturn && boxReturn.focus) boxReturn.focus({ preventScroll: true });
  }

  if (box) {
    box.querySelector("[data-lightbox-close]").addEventListener("click", closeBox);
    box.querySelector("[data-lightbox-prev]").addEventListener("click", function () { showBox(boxIndex - 1); });
    box.querySelector("[data-lightbox-next]").addEventListener("click", function () { showBox(boxIndex + 1); });
    box.addEventListener("click", function (event) {
      if (event.target === box) closeBox();
    });
    var touchX = null;
    box.addEventListener("touchstart", function (event) { touchX = event.touches[0].clientX; }, { passive: true });
    box.addEventListener("touchend", function (event) {
      if (touchX === null) return;
      var dx = event.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 50) showBox(boxIndex + (dx < 0 ? 1 : -1));
      touchX = null;
    }, { passive: true });
  }

  doc.addEventListener("keydown", function (event) {
    if (body.classList.contains("lightbox-open")) {
      if (event.key === "Escape") closeBox();
      else if (event.key === "ArrowRight") showBox(boxIndex + 1);
      else if (event.key === "ArrowLeft") showBox(boxIndex - 1);
      return;
    }
    if (event.key === "Escape" && body.classList.contains("menu-open")) {
      setMenu(false);
      if (menuToggle) menuToggle.focus();
    }
  });

  // ---------------------------------------------------------------- page
  function initPage() {
    var main = doc.querySelector("main");
    if (!main) return;
    renderProjectList(main);
    renderProject(main);
    collectLightbox(main);
    reveal(main);
    markCurrent();
    field().setScene(body.getAttribute("data-page"));
  }

  // -------------------------------------------------------------- router
  // Internal links swap <main> in place, so the field never restarts; the
  // change sends a ring through the dust from where the link was clicked.
  var navToken = 0;
  if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function routable(link, event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
    if ((link.target && link.target !== "_self") || link.hasAttribute("download")) return null;
    var url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin) return null;
    if (!/(\.html|\/)$/.test(url.pathname)) return null;
    if (url.pathname === window.location.pathname && url.search === window.location.search) {
      return url.hash ? null : url;
    }
    return url;
  }

  function navigate(url, push, x, y) {
    var token = ++navToken;
    setMenu(false);
    closeBox();
    body.classList.add("is-leaving");
    field().pulse(x, y);
    Promise.all([
      fetch(url.href, { credentials: "same-origin" }).then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.text();
      }),
      wait(reduced ? 0 : 380)
    ]).then(function (results) {
      if (token !== navToken) return;
      var next = new DOMParser().parseFromString(results[0], "text/html");
      var nextMain = next.querySelector("main");
      if (!nextMain) throw new Error("no main");
      if (push) window.history.pushState({}, "", url.href);
      doc.title = next.title;
      body.setAttribute("data-page", next.body.getAttribute("data-page") || "page");
      body.classList.add("is-entering");
      doc.querySelector("main").replaceWith(doc.importNode(nextMain, true));
      window.scrollTo(0, 0);
      initPage();
      body.classList.remove("is-leaving");
      // One frame in the entering state, then let the transition run.
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () { body.classList.remove("is-entering"); });
      });
      var main = doc.querySelector("main");
      if (main) main.focus({ preventScroll: true });
    }).catch(function () {
      window.location.href = url.href;
    });
  }

  doc.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest("a[href]");
    if (!link) return;
    var url = routable(link, event);
    if (!url) return;
    event.preventDefault();
    if (url.href === window.location.href) {
      setMenu(false);
      return;
    }
    navigate(url, true, event.clientX || undefined, event.clientY || undefined);
  });

  window.addEventListener("popstate", function () {
    navigate(new URL(window.location.href), false);
  });

  initPage();
})();
