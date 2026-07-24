(function () {
  "use strict";

  var doc = document;
  var root = doc.documentElement;
  var body = doc.body;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia("(pointer: fine)").matches;
  var gsap = window.gsap;
  var ScrollTrigger = window.ScrollTrigger;
  var lenis = null;
  var lastFocused = null;
  var initialHash = window.location.hash;
  var scrollAnimationsReady = false;

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  function qsa(selector, scope) {
    return Array.prototype.slice.call((scope || doc).querySelectorAll(selector));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function exitEase(t) {
    return 1 - Math.pow(1 - t, 4.2);
  }

  function splitChars(node) {
    if (!node || node.dataset.splitReady) return;
    var text = node.textContent;
    node.textContent = "";
    node.setAttribute("aria-label", text);
    Array.from(text).forEach(function (char) {
      var clip = doc.createElement("span");
      clip.className = "char-clip";
      clip.setAttribute("aria-hidden", "true");
      var inner = doc.createElement("span");
      inner.className = "char";
      inner.textContent = char === " " ? "\u00a0" : char;
      clip.appendChild(inner);
      node.appendChild(clip);
    });
    node.dataset.splitReady = "true";
  }

  function splitWords(node) {
    if (!node || node.dataset.splitReady) return;
    var text = node.textContent.trim();
    if (!text) return;
    node.textContent = "";
    node.setAttribute("aria-label", text);
    text.split(/\s+/).forEach(function (word, index, words) {
      var clip = doc.createElement("span");
      clip.className = "word-clip";
      clip.setAttribute("aria-hidden", "true");
      var inner = doc.createElement("span");
      inner.className = "word";
      inner.textContent = word;
      clip.appendChild(inner);
      node.appendChild(clip);
      if (index < words.length - 1) node.appendChild(doc.createTextNode(" "));
    });
    node.dataset.splitReady = "true";
  }

  qsa(".split-chars").forEach(splitChars);
  qsa(".split-lines").forEach(splitWords);

  // The brand mark replaces the K glyph inside the wordmark itself, in both
  // the fill and the trace layer, so the name carries the logo from frame one.
  (function installKMark() {
    if (!body.classList.contains("home-page")) return;
    var chars = qsa(".wordmark--fill .char");
    if (chars.length < 12) return;
    var kChar = chars[7];
    kChar.classList.add("char--kmark");
    kChar.innerHTML = '<img src="assets/brand/k-mark.png?v=3" alt="">';
    if (kChar.parentNode) kChar.parentNode.classList.add("char-clip--kmark");
    var trace = doc.querySelector(".wordmark--trace");
    if (trace) {
      trace.innerHTML = 'Etienne<img class="wordmark__kmark-trace" src="assets/brand/k-mark.png?v=3" alt="">ainz';
    }
  })();

  function initSmoothScroll() {
    if (reduceMotion || !window.Lenis) return;
    try {
      lenis = new window.Lenis({
        smoothWheel: true,
        syncTouch: false,
        lerp: 0.12,
        wheelMultiplier: 1,
        touchMultiplier: 1,
        overscroll: false
      });
      if (ScrollTrigger) lenis.on("scroll", ScrollTrigger.update);
      if (gsap) {
        gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
        gsap.ticker.lagSmoothing(0);
      } else {
        (function raf(time) {
          lenis.raf(time);
          requestAnimationFrame(raf);
        })(0);
      }
    } catch (error) {
      lenis = null;
    }
  }

  if (gsap && ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);
  }
  initSmoothScroll();

  function setScrollLocked(locked) {
    body.classList.toggle("scroll-locked", locked);
    if (lenis) {
      if (locked && lenis.stop) lenis.stop();
      if (!locked && lenis.start) lenis.start();
    }
  }

  function positionInitialRoute() {
    window.setTimeout(function () {
      var target = initialHash && doc.querySelector(initialHash);
      if (target) {
        if (lenis && lenis.scrollTo) lenis.scrollTo(target, { immediate: true, force: true });
        else target.scrollIntoView({ block: "start" });
      } else if (!initialHash) {
        window.scrollTo(0, 0);
      }
      if (ScrollTrigger) ScrollTrigger.refresh();
      if (window.quantumField) window.quantumField.refresh();
    }, 60);
  }

  // Binary decode for micro labels. Text remains readable to assistive tech.
  var scrambleGlyphs = "01/\\[]{}<>+=*";
  function scramble(node, finalText) {
    if (!node || reduceMotion) {
      if (node && finalText) node.textContent = finalText;
      return;
    }
    var target = finalText || node.getAttribute("data-scramble") || node.textContent;
    var start = performance.now();
    var duration = Math.min(880, 330 + target.length * 23);
    cancelAnimationFrame(node._scrambleFrame);
    function update(now) {
      var progress = clamp((now - start) / duration, 0, 1);
      var resolved = Math.floor(progress * target.length);
      var output = "";
      for (var i = 0; i < target.length; i += 1) {
        if (target[i] === " ") output += " ";
        else if (i < resolved) output += target[i];
        else output += scrambleGlyphs[(i * 7 + Math.floor(now / 42)) % scrambleGlyphs.length];
      }
      node.textContent = output;
      if (progress < 1) node._scrambleFrame = requestAnimationFrame(update);
      else node.textContent = target;
    }
    node._scrambleFrame = requestAnimationFrame(update);
  }

  qsa("[data-scramble]").forEach(function (node) {
    node.addEventListener("mouseenter", function () { scramble(node); });
  });

  // Intro choreography.
  function buildLoaderField() {
    var field = doc.getElementById("loaderField");
    if (!field) return;
    var fragment = doc.createDocumentFragment();
    var count = window.innerWidth < 720 ? 90 : 180;
    for (var i = 0; i < count; i += 1) {
      var glyph = doc.createElement("i");
      glyph.textContent = i % 5 === 0 ? "ψ" : i % 3 ? "+" : "·";
      glyph.style.setProperty("--x", ((i * 47) % 101) + "%");
      glyph.style.setProperty("--y", ((i * 73 + 11) % 101) + "%");
      glyph.style.setProperty("--d", ((i % 17) * 0.018) + "s");
      glyph.style.setProperty("--r", (((i * 29) % 80) - 40) + "deg");
      fragment.appendChild(glyph);
    }
    field.appendChild(fragment);
  }

  function finishLoader() {
    var loader = doc.getElementById("loader");
    body.classList.remove("is-loading");
    setScrollLocked(false);
    if (window.quantumField) window.quantumField.setIntroProgress(1);
    if (loader) {
      loader.setAttribute("aria-hidden", "true");
      window.setTimeout(function () {
        if (loader.parentNode) loader.parentNode.removeChild(loader);
      }, reduceMotion ? 0 : 950);
    }
    playHero();
    initScrollAnimations();
    positionInitialRoute();
  }

  function playHero() {
    var heroRoot = doc.querySelector(".hero") || doc.querySelector(".gallery-hero");
    qsa("[data-scramble]", heroRoot || doc).forEach(function (node, index) {
      window.setTimeout(function () { scramble(node); }, index * 90);
    });
    if (!gsap || reduceMotion) {
      qsa(".hero [data-reveal], .gallery-hero [data-reveal]").forEach(function (node) {
        node.classList.add("is-visible");
      });
      return;
    }
    var hero = heroRoot;
    if (!hero) return;
    var charSelector = hero.classList.contains("gallery-hero") ? ".gallery-hero .char" : ".hero .char";
    var revealSelector = hero.classList.contains("gallery-hero") ? ".gallery-hero [data-reveal]" : ".hero [data-reveal]";
    var tl = gsap.timeline({ defaults: { ease: "power4.out" } });
    tl.fromTo(charSelector, { yPercent: 115, rotate: 2.5 }, {
      yPercent: 0,
      rotate: 0,
      duration: 1.35,
      stagger: 0.032
    }, 0)
      .fromTo(revealSelector, { y: 28, opacity: 0 }, {
        y: 0,
        opacity: 1,
        duration: 0.9,
        stagger: 0.12
      }, 0.55);
    if (hero.classList.contains("hero")) {
      tl.fromTo(".wordmark--trace", { opacity: 0, xPercent: -2.4 }, { opacity: 1, xPercent: 0, duration: 1.4 }, 0.2)
        .fromTo(".scroll-cue", { scaleY: 0, opacity: 0, transformOrigin: "top" }, {
        scaleY: 1,
        opacity: 1,
        duration: 0.8
      }, 0.9);
    }
  }

  function runLoader() {
    var loader = doc.getElementById("loader");
    if (!loader) {
      body.classList.remove("is-loading");
      if (window.quantumField) window.quantumField.setIntroProgress(1);
      playHero();
      initScrollAnimations();
      positionInitialRoute();
      return;
    }
    buildLoaderField();
    setScrollLocked(true);
    if (reduceMotion || !gsap) {
      finishLoader();
      return;
    }
    var counter = doc.getElementById("loaderCounter");
    var bar = doc.getElementById("loaderProgress");
    var status = doc.getElementById("loaderStatus");
    var state = { value: 0 };
    var tl = gsap.timeline({ onComplete: finishLoader });
    tl.fromTo(".loader__field i", {
      opacity: 0,
      scale: 0.2,
      x: function () { return (Math.random() - 0.5) * 90; },
      y: function () { return (Math.random() - 0.5) * 90; }
    }, {
      opacity: 0.72,
      scale: 1,
      x: 0,
      y: 0,
      duration: 0.85,
      stagger: { amount: 0.75, from: "random" },
      ease: "power3.out"
    }, 0)
      .to(state, {
        value: 100,
        duration: 2.15,
        ease: "power2.inOut",
        onUpdate: function () {
          var value = Math.round(state.value);
          if (counter) counter.textContent = String(value).padStart(3, "0") + "%";
          if (bar) bar.style.transform = "scaleX(" + (value / 100) + ")";
          if (window.quantumField) window.quantumField.setIntroProgress(value / 100);
          if (status) {
            status.textContent = value < 30 ? "SCATTERED STATE" :
              value < 72 ? "COHERENCE RISING" :
                value < 96 ? "NORMALISING ψ" : "OBSERVABLE READY";
          }
        }
      }, 0.08)
      .fromTo(".loader__mark", { letterSpacing: "0.28em", opacity: 0 }, {
        letterSpacing: "0.04em",
        opacity: 1,
        duration: 1.25,
        ease: "expo.out"
      }, 0.16)
      .to(".loader__field i", {
        x: function (_, el) {
          var x = parseFloat(el.style.getPropertyValue("--x")) || 50;
          return (50 - x) * 0.58;
        },
        y: function (_, el) {
          var y = parseFloat(el.style.getPropertyValue("--y")) || 50;
          return (50 - y) * 0.36;
        },
        opacity: 0,
        duration: 0.75,
        stagger: { amount: 0.3, from: "edges" },
        ease: "power3.in"
      }, 1.62)
      .to(".loader__core, .loader__top, .loader__bottom", {
        opacity: 0,
        y: -12,
        duration: 0.48,
        ease: "power3.in"
      }, 2.16)
      .to(loader, {
        clipPath: "inset(0 0 100% 0)",
        duration: 0.82,
        ease: "power4.inOut"
      }, 2.22);
  }

  runLoader();

  function initScrollAnimations() {
    if (scrollAnimationsReady) return;
    scrollAnimationsReady = true;
    var revealNodes = qsa("[data-reveal]").filter(function (node) {
      return !node.closest(".hero") && !node.closest(".gallery-hero");
    });
    if (!gsap || !ScrollTrigger || reduceMotion) {
      revealNodes.forEach(function (node) { node.classList.add("is-visible"); });
      qsa(".word").forEach(function (word) { word.style.transform = "none"; });
      return;
    }

    revealNodes.forEach(function (node) {
      var type = node.getAttribute("data-reveal");
      var from;
      var to = {
        duration: type === "media" ? 1.25 : 0.92,
        ease: type === "media" ? "power4.inOut" : "power4.out",
        scrollTrigger: { trigger: node, start: "top 88%", once: true }
      };
      if (type === "clip") from = { clipPath: "inset(0 100% 0 0)", opacity: 1 };
      else if (type === "media") from = { clipPath: "inset(0 0 100% 0)", opacity: 1 };
      else if (type === "line") from = { y: 38, opacity: 0 };
      else from = { y: 32, opacity: 0 };
      var finalState = {
        y: 0,
        opacity: 1,
        onStart: function () {
          qsa("[data-scramble]", node).forEach(function (label) { scramble(label); });
        }
      };
      finalState.clipPath = type === "clip" || type === "media" ?
        "inset(0 0% 0% 0)" : "none";
      gsap.fromTo(node, from, Object.assign({}, to, finalState));
      var image = node.querySelector && node.querySelector("img");
      if (type === "media" && image) {
        gsap.fromTo(image, { scale: 1.14 }, {
          scale: 1,
          duration: 1.55,
          ease: "power4.out",
          scrollTrigger: { trigger: node, start: "top 88%", once: true }
        });
      }
    });

    qsa(".split-lines").filter(function (node) { return !node.closest(".hero"); }).forEach(function (node) {
      var words = qsa(".word", node);
      if (!words.length) return;
      gsap.fromTo(words, { yPercent: 112, rotate: 1.2 }, {
        yPercent: 0,
        rotate: 0,
        duration: 1,
        stagger: 0.022,
        ease: "power4.out",
        scrollTrigger: { trigger: node, start: "top 88%", once: true }
      });
    });

    qsa(".section-number[data-count]").forEach(function (node) {
      var end = parseInt(node.getAttribute("data-count"), 10);
      var value = { n: 0 };
      gsap.to(value, {
        n: end,
        duration: 0.82,
        ease: "power3.out",
        snap: { n: 1 },
        scrollTrigger: { trigger: node, start: "top 90%", once: true },
        onUpdate: function () { node.textContent = String(Math.round(value.n)).padStart(2, "0"); }
      });
    });

    var hero = doc.querySelector(".hero");
    if (hero) {
      var heroStage = hero.querySelector(".hero__stage") || hero;
      var wordmark = hero.querySelector(".hero__wordmark");
      var maxMaskRadius = Math.ceil(Math.hypot(window.innerWidth, window.innerHeight) * 0.92);
      gsap.set(".wordmark--fill .char-clip", { yPercent: 0, rotate: 0 });
      var openingTimeline = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          id: "opening-sequence",
          trigger: hero,
          start: "top top",
          end: "bottom bottom",
          scrub: true,
          invalidateOnRefresh: true,
          onUpdate: function (self) {
            var progress = self.progress;
            body.classList.toggle("is-field-solo", progress > 0.2 && progress < 0.9);
            if (window.quantumField && window.quantumField.setOpeningProgress) {
              window.quantumField.setOpeningProgress(progress);
            }
          },
          onLeave: function () { body.classList.remove("is-field-solo"); },
          onLeaveBack: function () { body.classList.remove("is-field-solo"); }
        }
      });
      openingTimeline
        .to(heroStage, { "--opening-clock": 1, duration: 1 }, 0)
        .to(".hero__meta, .hero__subline, .hero__coordinates, .scroll-cue", {
          yPercent: -42,
          opacity: 0,
          duration: 0.16,
          stagger: 0.012,
          ease: exitEase
        }, 0.035)
        .to(heroStage, {
          "--wordmark-mask-radius": maxMaskRadius + "px",
          "--wordmark-mask-x": "56%",
          "--wordmark-mask-y": "42%",
          duration: 0.34,
          ease: "power4.inOut"
        }, 0.035)
        .to(".wordmark--fill .char-clip:not(.char-clip--kmark)", {
          yPercent: -118,
          rotate: function (index) { return (index % 2 ? 1 : -1) * (1.8 + index * 0.13); },
          duration: 0.24,
          stagger: { amount: 0.08, from: "center" },
          ease: "power3.inOut"
        }, 0.08)
        .to(wordmark, {
          yPercent: -16,
          scale: 0.96,
          opacity: 0,
          duration: 0.23,
          ease: "power3.inOut"
        }, 0.12)
        .to(".hero__overture", {
          y: 0,
          opacity: 1,
          duration: 0.1,
          ease: "power4.out"
        }, 0.25)
        .to(".hero__overture i", {
          scaleX: 1,
          duration: 0.22,
          ease: "power3.inOut"
        }, 0.27)
        .to(".hero__overture", {
          yPercent: -35,
          opacity: 0,
          duration: 0.12,
          ease: "power3.in"
        }, 0.78);

      // The wordmark's brand-K stays behind while the letters scatter, then
      // glides to the field centre and granularly disintegrates through
      // baked erosion frames — crumbling into the very particle K the field
      // assembles underneath it.
      var kLogo = hero.querySelector(".hero__klogo");
      var kInline = hero.querySelector(".char--kmark img");
      if (kLogo && kInline) {
        var kFrames = kLogo.querySelectorAll("img");
        var kStart = function () {
          var stageBounds = heroStage.getBoundingClientRect();
          var markBounds = kInline.getBoundingClientRect();
          return {
            x: markBounds.left - stageBounds.left + markBounds.width / 2 - kLogo.offsetWidth / 2,
            y: markBounds.top - stageBounds.top + markBounds.height / 2 - kLogo.offsetHeight / 2,
            scale: markBounds.height / Math.max(1, kLogo.offsetHeight)
          };
        };
        openingTimeline
          // Atomic takeover: the overlay replaces the inline mark in a
          // single beat, before the mask or the letters begin to move —
          // at no point are two Ks visible.
          .fromTo(kLogo, {
            x: function () { return kStart().x; },
            y: function () { return kStart().y; },
            scale: function () { return kStart().scale; },
            opacity: 0
          }, { opacity: 1, duration: 0.006, ease: "none" }, 0.018)
          .to(".char-clip--kmark", { opacity: 0, duration: 0.006, ease: "none" }, 0.018)
          .to(kLogo, {
            x: function () { return window.innerWidth * 0.51 - kLogo.offsetWidth / 2; },
            y: function () { return window.innerHeight * 0.45 - kLogo.offsetHeight / 2; },
            scale: function () { return window.innerHeight * 0.55 / Math.max(1, kLogo.offsetHeight); },
            duration: 0.26,
            ease: "power2.inOut"
          }, 0.06)
          // The mark converts to field notation: each stage swaps more of
          // the solid artwork for glyph dust, blending long and gently.
          .to(kFrames[0], { opacity: 0, duration: 0.07, ease: "none" }, 0.24)
          .to(kFrames[1], { opacity: 1, duration: 0.06, ease: "none" }, 0.235)
          .to(kFrames[1], { opacity: 0, duration: 0.07, ease: "none" }, 0.305)
          .to(kFrames[2], { opacity: 1, duration: 0.06, ease: "none" }, 0.3)
          .to(kFrames[2], { opacity: 0, duration: 0.07, ease: "none" }, 0.37)
          .to(kFrames[3], { opacity: 1, duration: 0.06, ease: "none" }, 0.365)
          .to(kFrames[3], { opacity: 0, duration: 0.09, ease: "power1.in" }, 0.44)
          // The dust keeps drifting up as it converts into the live field.
          .to(kLogo, { y: "-=28", scale: "+=0.05", duration: 0.27, ease: "none" }, 0.24);
      }
    }

    qsa(".teaser-card__image img").forEach(function (image) {
      gsap.fromTo(image, { yPercent: -7 }, {
        yPercent: 7,
        ease: "none",
        scrollTrigger: { trigger: image.parentElement, start: "top bottom", end: "bottom top", scrub: 0.18 }
      });
    });
  }

  // Menu.
  var menuToggle = doc.getElementById("menuToggle");
  var menuOverlay = doc.getElementById("menuOverlay");
  function setMenu(open) {
    if (!menuToggle || !menuOverlay) return;
    body.classList.toggle("menu-open", open);
    menuToggle.setAttribute("aria-expanded", String(open));
    menuOverlay.setAttribute("aria-hidden", String(!open));
    setScrollLocked(open);
    if (open) lastFocused = doc.activeElement;
    if (gsap && !reduceMotion) {
      if (open) {
        gsap.fromTo(".menu-nav a", { yPercent: 110, opacity: 0 }, {
          yPercent: 0,
          opacity: 1,
          duration: 0.9,
          stagger: 0.055,
          delay: 0.22,
          ease: "power4.out"
        });
        gsap.fromTo(".menu-overlay__meta, .menu-overlay__footer", { opacity: 0 }, {
          opacity: 1,
          duration: 0.65,
          delay: 0.48
        });
      }
    }
    if (!open && lastFocused && lastFocused.focus) lastFocused.focus();
  }
  if (menuToggle && menuOverlay) {
    menuToggle.addEventListener("click", function () {
      setMenu(!body.classList.contains("menu-open"));
    });
    qsa("[data-menu-link]", menuOverlay).forEach(function (link) {
      link.addEventListener("click", function () { setMenu(false); });
    });
  }

  doc.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      if (body.classList.contains("menu-open")) setMenu(false);
      closeProject();
      closeLightbox();
    }
  });

  // Sticky section observer and page progress.
  var scenes = qsa(".scene[data-section]");
  var railCurrent = doc.getElementById("railCurrent");
  var railName = doc.getElementById("railName");
  var railProgress = doc.getElementById("railProgress");
  var activeScene = null;

  function updateRail() {
    var focus = window.innerHeight * 0.46;
    var best = null;
    var distance = Infinity;
    scenes.forEach(function (scene) {
      var bounds = scene.getBoundingClientRect();
      var inside = bounds.top <= focus && bounds.bottom >= focus;
      var d = inside ? 0 : Math.min(Math.abs(bounds.top - focus), Math.abs(bounds.bottom - focus));
      if (d < distance) {
        best = scene;
        distance = d;
      }
    });
    if (best && best !== activeScene) {
      activeScene = best;
      if (railCurrent) railCurrent.textContent = best.getAttribute("data-section");
      if (railName) {
        var title = best.getAttribute("data-title") || "";
        railName.textContent = title.toUpperCase();
        scramble(railName, title.toUpperCase());
      }
      scenes.forEach(function (scene) { scene.classList.toggle("is-active-scene", scene === best); });
    }
    var max = Math.max(1, doc.documentElement.scrollHeight - window.innerHeight);
    var progress = clamp(window.scrollY / max, 0, 1);
    if (railProgress) railProgress.style.transform = "scaleY(" + progress.toFixed(4) + ")";
  }
  // Coalesce rail updates to one layout read per frame.
  var railFrame = 0;
  function scheduleRail() {
    if (!railFrame) {
      railFrame = requestAnimationFrame(function () {
        railFrame = 0;
        updateRail();
      });
    }
  }
  window.addEventListener("scroll", scheduleRail, { passive: true });
  window.addEventListener("resize", scheduleRail, { passive: true });
  updateRail();

  // Project filter.
  qsa("[data-filter]").forEach(function (button) {
    button.addEventListener("click", function () {
      var filter = button.getAttribute("data-filter");
      qsa("[data-filter]").forEach(function (item) {
        var active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      qsa(".project-row").forEach(function (row) {
        var show = filter === "all" || (row.getAttribute("data-category") || "").split(/\s+/).indexOf(filter) > -1;
        if (gsap && !reduceMotion) {
          if (show) {
            row.hidden = false;
            gsap.fromTo(row, { height: 0, opacity: 0, y: 20 }, {
              height: "auto", opacity: 1, y: 0, duration: 0.62, ease: "power4.out",
              onComplete: function () {
                if (ScrollTrigger) ScrollTrigger.refresh();
                if (window.quantumField) window.quantumField.refresh();
              }
            });
          } else {
            gsap.to(row, {
              height: 0, opacity: 0, y: -12, duration: 0.45, ease: "power3.inOut",
              onComplete: function () {
                row.hidden = true;
                if (ScrollTrigger) ScrollTrigger.refresh();
                if (window.quantumField) window.quantumField.refresh();
              }
            });
          }
        } else {
          row.hidden = !show;
        }
      });
    });
  });

  // Floating project preview.
  var preview = doc.getElementById("projectPreview");
  if (preview && finePointer) {
    var previewImage = preview.querySelector("img");
    var moveX = gsap ? gsap.quickTo(preview, "x", { duration: 0.52, ease: "power3.out" }) : null;
    var moveY = gsap ? gsap.quickTo(preview, "y", { duration: 0.52, ease: "power3.out" }) : null;
    qsa(".project-row").forEach(function (row, index) {
      row.addEventListener("mouseenter", function () {
        if (previewImage) previewImage.src = row.getAttribute("data-preview");
        var cap = preview.querySelector("figcaption");
        if (cap) cap.textContent = "OPEN CASE / " + String(index + 1).padStart(2, "0") + "—06";
        preview.classList.add("is-visible");
      });
      row.addEventListener("mouseleave", function () { preview.classList.remove("is-visible"); });
      row.addEventListener("mousemove", function (event) {
        if (moveX && moveY) {
          moveX(event.clientX + 24);
          moveY(event.clientY - preview.offsetHeight * 0.5);
        } else {
          preview.style.transform = "translate3d(" + (event.clientX + 24) + "px," + (event.clientY - 120) + "px,0)";
        }
      });
    });
  }

  // Project case overlay.
  var projectOverlay = doc.getElementById("projectOverlay");
  var projectContent = doc.getElementById("projectOverlayContent");
  var projectOverlayNo = doc.getElementById("projectOverlayNo");
  var projectClose = doc.getElementById("projectOverlayClose");

  function buildProject(project) {
    var docs = (project.docs || []).map(function (item) {
      return '<a href="' + item[0] + '" target="_blank" rel="noopener"><span>PDF</span>' + item[1] + '<i>↗</i></a>';
    }).join("");
    var images = project.images.map(function (item, index) {
      var no = String(index + 1).padStart(2, "0");
      return '<figure class="project-sheet__figure" data-project-image="' + index + '" tabindex="0" role="button">' +
        '<div><img src="' + item[0] + '" alt="' + item[1].replace(/"/g, "&quot;") + '" loading="' + (index < 2 ? "eager" : "lazy") + '" decoding="async"></div>' +
        '<figcaption><span>FIG. ' + project.no + "—" + no + '</span><span>' + item[1] + '</span></figcaption></figure>';
    }).join("");
    return '<article class="project-sheet">' +
      '<header class="project-sheet__header"><div class="micro"><span>' + project.no + '</span><span>' + project.status.toUpperCase() + '</span></div>' +
      '<h2 id="projectOverlayTitle">' + project.title + '</h2><p>' + project.line + '</p>' +
      '<div class="project-sheet__meta micro">' + project.meta.map(function (item) { return "<span>" + item + "</span>"; }).join("") + '</div></header>' +
      (docs ? '<nav class="project-sheet__docs" aria-label="Project documents">' + docs + "</nav>" : "") +
      '<div class="project-sheet__gallery">' + images + "</div></article>";
  }

  function openProject(key) {
    var data = window.PORTFOLIO_PROJECTS && window.PORTFOLIO_PROJECTS[key];
    if (!data || !projectOverlay || !projectContent) return;
    lastFocused = doc.activeElement;
    projectContent.innerHTML = buildProject(data);
    if (projectOverlayNo) projectOverlayNo.textContent = data.no;
    projectOverlay.dataset.project = key;
    projectOverlay.setAttribute("aria-hidden", "false");
    body.classList.add("project-open");
    setScrollLocked(true);
    projectOverlay.scrollTop = 0;
    qsa("[data-project-image]", projectContent).forEach(function (figure, index) {
      function open() { openLightbox(data.images, index); }
      figure.addEventListener("click", open);
      figure.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    });
    if (gsap && !reduceMotion) {
      gsap.fromTo(projectOverlay, { clipPath: "inset(100% 0 0 0)" }, {
        clipPath: "inset(0% 0 0 0)", duration: 0.92, ease: "power4.inOut"
      });
      gsap.fromTo(".project-sheet__header > *, .project-sheet__docs", { y: 55, opacity: 0 }, {
        y: 0, opacity: 1, duration: 0.9, stagger: 0.07, delay: 0.48, ease: "power4.out"
      });
    }
    if (projectClose) projectClose.focus();
  }

  function closeProject() {
    if (!projectOverlay || projectOverlay.getAttribute("aria-hidden") === "true") return;
    function finish() {
      projectOverlay.setAttribute("aria-hidden", "true");
      body.classList.remove("project-open");
      setScrollLocked(false);
      if (projectContent) projectContent.innerHTML = "";
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    }
    if (gsap && !reduceMotion) {
      gsap.to(projectOverlay, {
        clipPath: "inset(0 0 100% 0)", duration: 0.72, ease: "power4.inOut", onComplete: finish
      });
    } else finish();
  }

  qsa("[data-project-open]").forEach(function (button) {
    button.addEventListener("click", function () { openProject(button.getAttribute("data-project-open")); });
  });
  if (projectClose) projectClose.addEventListener("click", closeProject);

  // Shared lightbox.
  var lightbox = doc.getElementById("lightbox");
  var lightboxImage = doc.getElementById("lightboxImage");
  var lightboxCaption = doc.getElementById("lightboxCaption");
  var lightboxClose = doc.getElementById("lightboxClose");
  var lightboxPrev = doc.getElementById("lightboxPrev");
  var lightboxNext = doc.getElementById("lightboxNext");
  var lightboxItems = [];
  var lightboxIndex = 0;
  var lightboxProjectWasOpen = false;

  function renderLightbox() {
    if (!lightboxItems.length || !lightboxImage) return;
    var item = lightboxItems[lightboxIndex];
    lightboxImage.src = item[0];
    lightboxImage.alt = item[1] || "";
    if (lightboxCaption) {
      lightboxCaption.innerHTML = "<span>" + String(lightboxIndex + 1).padStart(2, "0") + " / " + String(lightboxItems.length).padStart(2, "0") + "</span><span>" + (item[1] || "") + "</span>";
    }
  }

  function openLightbox(items, index) {
    if (!lightbox || !items || !items.length) return;
    lastFocused = doc.activeElement;
    lightboxItems = items;
    lightboxIndex = clamp(index || 0, 0, items.length - 1);
    lightboxProjectWasOpen = body.classList.contains("project-open");
    renderLightbox();
    lightbox.setAttribute("aria-hidden", "false");
    body.classList.add("lightbox-open");
    setScrollLocked(true);
    if (gsap && !reduceMotion) {
      gsap.fromTo(lightbox, { opacity: 0 }, { opacity: 1, duration: 0.42, ease: "power2.out" });
      gsap.fromTo(lightboxImage, { clipPath: "inset(0 0 100% 0)", scale: 1.04 }, {
        clipPath: "inset(0 0 0% 0)", scale: 1, duration: 0.82, ease: "power4.inOut"
      });
    }
    if (lightboxClose) lightboxClose.focus();
  }

  function closeLightbox() {
    if (!lightbox || lightbox.getAttribute("aria-hidden") === "true") return;
    function finish() {
      lightbox.setAttribute("aria-hidden", "true");
      body.classList.remove("lightbox-open");
      if (!lightboxProjectWasOpen) setScrollLocked(false);
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    }
    if (gsap && !reduceMotion) gsap.to(lightbox, { opacity: 0, duration: 0.3, onComplete: finish });
    else finish();
  }

  function stepLightbox(direction) {
    if (!lightboxItems.length) return;
    lightboxIndex = (lightboxIndex + direction + lightboxItems.length) % lightboxItems.length;
    if (gsap && !reduceMotion) {
      gsap.to(lightboxImage, {
        opacity: 0, x: direction * -24, duration: 0.18, onComplete: function () {
          renderLightbox();
          gsap.fromTo(lightboxImage, { opacity: 0, x: direction * 24 }, { opacity: 1, x: 0, duration: 0.32 });
        }
      });
    } else renderLightbox();
  }

  if (lightboxClose) lightboxClose.addEventListener("click", closeLightbox);
  if (lightboxPrev) lightboxPrev.addEventListener("click", function () { stepLightbox(-1); });
  if (lightboxNext) lightboxNext.addEventListener("click", function () { stepLightbox(1); });
  if (lightbox) lightbox.addEventListener("click", function (event) {
    if (event.target === lightbox) closeLightbox();
  });
  doc.addEventListener("keydown", function (event) {
    if (!body.classList.contains("lightbox-open")) return;
    if (event.key === "ArrowLeft") stepLightbox(-1);
    if (event.key === "ArrowRight") stepLightbox(1);
  });

  qsa("[data-lightbox-group]").forEach(function (button) {
    button.addEventListener("click", function () {
      var group = button.getAttribute("data-lightbox-group");
      var items = window.PORTFOLIO_LIGHTBOX_GROUPS && window.PORTFOLIO_LIGHTBOX_GROUPS[group];
      openLightbox(items || [], 0);
    });
  });

  qsa("[data-gallery-group]").forEach(function (figure) {
    function open() {
      var group = figure.getAttribute("data-gallery-group");
      var groupNodes = qsa('[data-gallery-group="' + group + '"]');
      var items = groupNodes.map(function (node) {
        var image = node.querySelector("img");
        return [image ? image.getAttribute("src") : "", node.getAttribute("data-caption") || (image ? image.alt : "")];
      });
      openLightbox(items, groupNodes.indexOf(figure));
    }
    figure.addEventListener("click", open);
    figure.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  });

  // Cursor treatment.
  var cursorDot = doc.querySelector(".cursor--dot");
  var cursorRing = doc.querySelector(".cursor--ring");
  if (finePointer && cursorDot && cursorRing && !reduceMotion) {
    var cursorX = 0;
    var cursorY = 0;
    var ringX = 0;
    var ringY = 0;
    var cursorFrame = 0;
    function drawCursor() {
      cursorFrame = requestAnimationFrame(drawCursor);
      ringX += (cursorX - ringX) * 0.16;
      ringY += (cursorY - ringY) * 0.16;
      cursorDot.style.transform = "translate3d(" + cursorX + "px," + cursorY + "px,0)";
      cursorRing.style.transform = "translate3d(" + ringX + "px," + ringY + "px,0)";
    }
    window.addEventListener("pointermove", function (event) {
      cursorX = event.clientX;
      cursorY = event.clientY;
      body.classList.add("cursor-ready");
    }, { passive: true });
    doc.addEventListener("pointerover", function (event) {
      var target = event.target.closest("a, button, [role='button'], canvas");
      cursorRing.classList.toggle("is-active", !!target);
      cursorRing.classList.toggle("is-open", !!event.target.closest("[data-cursor='open'], [data-project-open], [data-gallery-group]"));
    });
    cursorFrame = requestAnimationFrame(drawCursor);
  }

  // Cross-page wipe.
  qsa("[data-transition-link]").forEach(function (link) {
    link.addEventListener("click", function (event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === "_blank") return;
      var href = link.getAttribute("href");
      if (!href || href.charAt(0) === "#") return;
      event.preventDefault();
      setMenu(false);
      var wipe = doc.querySelector(".page-wipe");
      if (!wipe || !gsap || reduceMotion) {
        window.location.href = href;
        return;
      }
      wipe.classList.add("is-active");
      gsap.fromTo(wipe, { clipPath: "inset(100% 0 0 0)" }, {
        clipPath: "inset(0% 0 0 0)", duration: 0.75, ease: "power4.inOut",
        onComplete: function () { window.location.href = href; }
      });
    });
  });

  window.addEventListener("pageshow", function () {
    var wipe = doc.querySelector(".page-wipe");
    if (wipe) {
      wipe.classList.remove("is-active");
      wipe.style.clipPath = "inset(100% 0 0 0)";
    }
    body.classList.remove("menu-open", "project-open", "lightbox-open");
    setScrollLocked(false);
  });

  window.addEventListener("load", function () {
    if (ScrollTrigger) ScrollTrigger.refresh();
    if (window.quantumField) window.quantumField.refresh();
    updateRail();
  });
})();
