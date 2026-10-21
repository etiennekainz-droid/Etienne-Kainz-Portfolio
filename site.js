/* Site behaviour: menu, page changes that keep the background running,
   pictures flowing in, the home page's preview cards, project pages from
   project-data.js, and the lightbox. */
(function () {
  "use strict";

  var doc = document;
  var body = doc.body;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var field = function () { return window.EKField || { setScene: function () {}, pulse: function () {}, ripple: function () {} }; };

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
    if (open && deck) deck.close();
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
        '<p>' + escapeHtml(p.short || [].concat(p.line)[0]) + '</p></a>';
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
        '<div class="page-head__text">' + [].concat(p.line).map(function (text) { return '<p>' + escapeHtml(text) + '</p>'; }).join("") + '</div>' +
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

  // ---------------------------------------------------------------- deck
  // Home: pointing at a category deals a hand of its pictures out of the
  // label. One hand is re-dealt between categories, so running down the list
  // shuffles the same cards instead of swapping them out. Every card is a
  // damped spring (position, turn, scale, opacity) that tilts and catches the
  // light as it moves; the hand drifts, leans after the pointer and slowly
  // opens out while it is held. On touch a tap plays the hand, then the page
  // changes; a second tap goes straight there.
  var DECK_SIZE = 6; // tools/thumbs.py writes this many cards per category
  // The pile around its centre, in card widths and heights, and each card's
  // turn in degrees; later cards lie on top.
  var DECK_SLOTS = [
    [-0.66, -0.40, -13], [0.34, -0.52, 6], [0.84, 0.06, 14],
    [-0.36, 0.34, -7], [0.42, 0.46, 9], [-0.04, -0.02, -2]
  ];
  var DECK_HOLD = 1150; // touch: how long the hand plays before the page changes
  var deck = reduced ? null : makeDeck();

  function makeDeck() {
    var layer = null;
    var cards = [];
    var size = { w: 0, h: 0 };
    var mode = "idle"; // idle | open | launch
    var touch = false;
    var current = null;
    var openedAt = 0;
    var anchor = { x: 0, y: 0 };
    var stage = { x: 0, y: 0 };
    var pointer = { x: 0, y: 0, on: false };
    var running = false;
    var last = 0;
    var hideTimer = 0;
    var goTimer = 0;
    var launchTimer = 0;
    var pending = null;
    var pressType = "";
    var loaded = {};

    function clamp(v, lo, hi) {
      return Math.max(lo, Math.min(hi, v));
    }

    function navLink(target) {
      return target && target.closest ? target.closest(".home__nav a[data-preview]") : null;
    }

    function sources(key) {
      var list = [];
      for (var i = 1; i <= DECK_SIZE; i++) list.push("assets/thumbs/" + key + "-" + i + ".webp");
      return list;
    }

    function preload(key) {
      if (!key || loaded[key]) return;
      loaded[key] = sources(key).map(function (src) {
        var img = new Image();
        img.decoding = "async";
        img.src = src;
        return img;
      });
    }

    function build() {
      if (layer) return;
      layer = doc.createElement("div");
      layer.className = "deck";
      layer.setAttribute("aria-hidden", "true");
      for (var i = 0; i < DECK_SIZE; i++) {
        var el = doc.createElement("div");
        el.className = "deck__card";
        el.innerHTML = '<img alt=""><img alt=""><span>' + pad(i + 1) + "</span>";
        layer.appendChild(el);
        cards.push({
          el: el, imgs: el.querySelectorAll("img"), front: 0, src: "",
          x: 0, y: 0, r: 0, s: 0.3, o: 0, vx: 0, vy: 0, vr: 0, vs: 0, vo: 0,
          k: 240 - i * 16, phase: i * 1.7, wake: 0
        });
      }
      body.appendChild(layer);
    }

    // Cross-fade a card to a new picture once it has decoded.
    function setSource(card, src) {
      if (card.src === src) return;
      card.src = src;
      var next = card.imgs[1 - card.front];
      var prev = card.imgs[card.front];
      card.front = 1 - card.front;
      next.src = src;
      var swap = function () {
        if (card.src !== src) return;
        next.classList.add("is-on");
        prev.classList.remove("is-on");
      };
      if (next.decode) next.decode().then(swap, swap);
      else swap();
    }

    // Where the hand settles. Two columns: the open space under the list.
    // One column, and every tap: above the label, over the intro.
    function place(link) {
      size.w = cards[0].el.offsetWidth;
      size.h = size.w * 0.75;
      var rect = link.getBoundingClientRect();
      var list = link.parentNode.getBoundingClientRect();
      var index = Array.prototype.indexOf.call(link.parentNode.children, link);
      var vw = window.innerWidth;
      var vh = window.innerHeight;
      var pileW = size.w * (touch ? 3.1 : 2.7); // a tapped hand opens out wider
      var pileH = size.h * 2.5;
      anchor.x = rect.left + Math.min(rect.width * 0.18, 36);
      anchor.y = rect.top + rect.height / 2;
      if (!touch && vw > 760) {
        stage.x = list.left + pileW / 2 + index * size.w * 0.08;
        stage.y = list.bottom + pileH / 2 + 34 + index * 8;
      } else {
        stage.x = rect.left + pileW / 2 + rect.width * 0.35;
        stage.y = rect.top - pileH * 0.56;
      }
      stage.x = clamp(stage.x, pileW / 2 + 10, vw - pileW / 2 - 10);
      stage.y = clamp(stage.y, 76 + pileH / 2, vh - pileH / 2 - 12);
    }

    // Each card's goal this frame: x, y, turn, scale, opacity.
    function goal(card, i, now) {
      var slot = DECK_SLOTS[i];
      if (mode === "idle" || now < card.wake) {
        return [anchor.x, anchor.y, slot[2] * 0.3, 0.3, 0];
      }
      if (mode === "launch") {
        return [stage.x + slot[0] * size.w * 2.6, stage.y + slot[1] * size.h * 2.6, slot[2] * 2.2, 1.3, 0];
      }
      var held = Math.min((now - openedAt) / (touch ? DECK_HOLD : 2600), 1);
      var grow = 1 - Math.pow(1 - held, 3);
      var spread = 0.94 + grow * (touch ? 0.34 : 0.14);
      var x = stage.x + slot[0] * size.w * spread + Math.sin(now * 0.0011 + card.phase) * 4;
      var y = stage.y + slot[1] * size.h * spread + Math.cos(now * 0.0009 + card.phase) * 5;
      if (pointer.on) {
        var depth = 0.03 + 0.022 * i;
        x += clamp((pointer.x - stage.x) * depth, -60, 60);
        y += clamp((pointer.y - stage.y) * depth, -22, 22);
      }
      return [x, y, slot[2] + Math.sin(now * 0.0007 + card.phase) * 1.8, 1 + grow * (touch ? 0.16 : 0.05), 1];
    }

    function spring(card, key, vel, to, k, zeta, dt) {
      card[vel] += (k * (to - card[key]) - 2 * zeta * Math.sqrt(k) * card[vel]) * dt;
      card[key] += card[vel] * dt;
    }

    function frame(now) {
      var dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      var settled = mode === "idle";
      cards.forEach(function (card, i) {
        var g = goal(card, i, now);
        spring(card, "x", "vx", g[0], card.k, 0.58, dt);
        spring(card, "y", "vy", g[1], card.k, 0.58, dt);
        spring(card, "r", "vr", g[2], card.k * 0.8, 0.5, dt);
        spring(card, "s", "vs", g[3], card.k, 0.55, dt);
        spring(card, "o", "vo", g[4], 260, 1, dt);
        // Lean and tilt into the motion; the glint slides in with the swing.
        var tiltY = clamp(card.vx * 0.012, -32, 32);
        var tiltX = clamp(-card.vy * 0.012, -32, 32);
        var lean = clamp(card.vx * 0.004, -10, 10);
        var o = clamp(card.o, 0, 1);
        card.el.style.opacity = o.toFixed(3);
        card.el.style.transform =
          "translate3d(" + (card.x - size.w / 2).toFixed(1) + "px," + (card.y - size.h / 2).toFixed(1) + "px,0)" +
          " perspective(700px) rotateX(" + tiltX.toFixed(2) + "deg) rotateY(" + tiltY.toFixed(2) + "deg)" +
          " rotate(" + (card.r + lean).toFixed(2) + "deg) scale(" + Math.max(card.s, 0.01).toFixed(3) + ")";
        card.el.style.setProperty("--glint", clamp(-100 + Math.abs(tiltY) * 5 + Math.abs(tiltX) * 3, -100, 60).toFixed(1));
        if (o > 0.004 || Math.abs(card.vo) > 0.01) settled = false;
      });
      if (settled) {
        running = false;
        layer.classList.remove("is-live");
        return;
      }
      window.requestAnimationFrame(frame);
    }

    function run() {
      if (running) return;
      running = true;
      last = performance.now();
      layer.classList.add("is-live");
      window.requestAnimationFrame(frame);
    }

    function setDealt(link) {
      qsa(".home__nav .is-dealt").forEach(function (a) { a.classList.remove("is-dealt"); });
      qsa(".home__nav.is-dealing").forEach(function (nav) { nav.classList.remove("is-dealing"); });
      if (!link) return;
      link.classList.add("is-dealt");
      link.parentNode.classList.add("is-dealing");
    }

    function open(link, byTouch) {
      clearTimeout(hideTimer);
      if (link === current && mode === "open") return;
      var key = link.getAttribute("data-preview");
      build();
      preload(key);
      var now = performance.now();
      var fresh = mode !== "open";
      current = link;
      touch = byTouch;
      setDealt(touch ? link : null);
      place(link);
      var list = sources(key);
      cards.forEach(function (card, i) {
        if (fresh) {
          // Out of the label: the cards start stacked on it.
          card.x = anchor.x;
          card.y = anchor.y;
          card.r = DECK_SLOTS[i][2] * 0.3;
          card.s = 0.3;
          card.o = 0;
          card.vx = card.vy = card.vr = card.vs = card.vo = 0;
          card.wake = now + i * 42;
          setSource(card, list[i]);
          return;
        }
        // Re-deal: each card hops as its picture changes.
        card.wake = 0;
        setTimeout(function () {
          if (current !== link || mode !== "open") return;
          setSource(card, list[i]);
          card.vs += 1.6;
          card.vr += (i % 2 ? 1 : -1) * 160;
        }, i * 45);
      });
      if (fresh) openedAt = now;
      mode = "open";
      field().ripple(anchor.x, anchor.y, fresh ? 0.6 : 0.3);
      run();
    }

    function close() {
      clearTimeout(hideTimer);
      clearTimeout(goTimer);
      pending = null;
      if (mode !== "open") return;
      mode = "idle";
      current = null;
      touch = false;
      pointer.on = false;
      setDealt(null);
    }

    function closeSoon() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(close, 110);
    }

    // The page is changing: throw the hand outward as <main> fades.
    function launch() {
      clearTimeout(hideTimer);
      clearTimeout(goTimer);
      if (mode !== "open") return;
      mode = "launch";
      pointer.on = false;
      clearTimeout(launchTimer);
      launchTimer = setTimeout(function () {
        if (mode !== "launch") return;
        mode = "idle";
        current = null;
        touch = false;
      }, 700);
    }

    function go() {
      clearTimeout(goTimer);
      var next = pending;
      pending = null;
      if (next) navigate(next.url, true, next.x, next.y);
    }

    // Touch: a tap on a category plays its hand first. Returns true if it
    // took the click.
    function intercept(link, url, event) {
      if (pressType !== "touch" || event.detail === 0 || !link.matches(".home__nav a[data-preview]")) return false;
      pending = { url: url, x: event.clientX, y: event.clientY };
      if (touch && current === link && mode === "open") {
        go();
        return true;
      }
      open(link, true);
      clearTimeout(goTimer);
      goTimer = setTimeout(go, DECK_HOLD);
      return true;
    }

    doc.addEventListener("pointerdown", function (event) {
      pressType = event.pointerType;
      var link = navLink(event.target);
      if (link) preload(link.getAttribute("data-preview"));
      else if (touch && mode === "open") close(); // a tap elsewhere calls it off
    }, true);

    doc.addEventListener("pointerover", function (event) {
      if (event.pointerType === "touch") return;
      var link = navLink(event.target);
      if (link) open(link, false);
    });

    doc.addEventListener("pointerout", function (event) {
      if (event.pointerType === "touch" || touch || mode !== "open") return;
      var from = navLink(event.target);
      if (from && navLink(event.relatedTarget) !== from) closeSoon();
    });

    doc.addEventListener("pointermove", function (event) {
      if (event.pointerType === "touch" || touch || mode !== "open") return;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.on = true;
    }, { passive: true });

    doc.addEventListener("focusin", function (event) {
      var link = navLink(event.target);
      try {
        if (link && link.matches(":focus-visible")) open(link, false);
      } catch (error) { /* no :focus-visible: skip keyboard previews */ }
    });

    doc.addEventListener("focusout", function (event) {
      if (!touch && navLink(event.target)) closeSoon();
    });

    window.addEventListener("resize", function () {
      if (mode === "open" && current) place(current);
    });

    return {
      intercept: intercept,
      launch: launch,
      close: close,
      // Fetch every category's cards ahead of time (mouse users, home page).
      warm: function () {
        qsa(".home__nav a[data-preview]").forEach(function (link) { preload(link.getAttribute("data-preview")); });
      }
    };
  }

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
    if (deck && body.getAttribute("data-page") === "home" && window.matchMedia("(hover: hover)").matches) {
      setTimeout(deck.warm, 1200);
    }
  }

  // -------------------------------------------------------------- router
  // Internal links swap <main> in place, so the field never restarts; the
  // change sends a ring through the dust from where the link was clicked.
  var navToken = 0;
  if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";

  // Visits: GoatCounter (count.js, loaded on every page) counts the page a
  // visitor lands on. Page changes made here never reload, so each one is
  // counted too, referred by the page it came from as a reload would be.
  var lastView = window.location.href;

  function countView() {
    var counter = window.goatcounter;
    if (counter && counter.count) counter.count({ referrer: lastView });
    lastView = window.location.href;
  }

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
    if (deck) deck.launch();
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
      countView();
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
    if (deck && deck.intercept(link, url, event)) return;
    navigate(url, true, event.clientX || undefined, event.clientY || undefined);
  });

  window.addEventListener("popstate", function () {
    navigate(new URL(window.location.href), false);
  });

  initPage();
})();
