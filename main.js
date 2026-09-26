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

  var initialHash = window.location.hash;
  var scrollAnimationsReady = false;
  // Set by the inline <head> script when this page was reached through a site
  // transition: the wipe is still closed and this page must lift it.
  var arriving = root.classList.contains("is-arriving");

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
    // width/height are required: without an intrinsic ratio the browser
    // reserves no space until the PNG decodes and the name visibly reflows.
    kChar.innerHTML = '<img src="assets/brand/k-mark.png?v=3" alt="" width="407" height="900">';
    if (kChar.parentNode) kChar.parentNode.classList.add("char-clip--kmark");
    var trace = doc.querySelector(".wordmark--trace");
    if (trace) {
      trace.innerHTML = 'Etienne<img class="wordmark__kmark-trace" src="assets/brand/k-mark.png?v=3" ' +
        'alt="" width="407" height="900">ainz';
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

  // getElementById, not querySelector: a hash is not a CSS selector, and
  // querySelector throws on shared links such as "#1", which used to abort the
  // whole post-loader setup.
  function hashTarget(hash) {
    if (!hash || hash.length < 2) return null;
    try {
      return doc.getElementById(decodeURIComponent(hash.slice(1)));
    } catch (error) {
      return null;
    }
  }

  function jumpTo(target) {
    if (!target) {
      window.scrollTo(0, 0);
      if (lenis && lenis.scrollTo) lenis.scrollTo(0, { immediate: true, force: true });
      return;
    }
    if (lenis && lenis.scrollTo) lenis.scrollTo(target, { immediate: true, force: true });
    else target.scrollIntoView({ block: "start" });
  }

  // Scrubbed timelines ease toward the scroll position over ~0.7s. After an
  // instant jump that catch-up would fast-forward the whole opening sequence
  // on screen, so complete every scrub tween at once.
  function settleScrubs() {
    if (!ScrollTrigger) return;
    ScrollTrigger.update();
    ScrollTrigger.getAll().forEach(function (trigger) {
      var tween = trigger.getTween && trigger.getTween();
      if (tween) tween.progress(1);
    });
  }

  // Positions the page on its initial route. Runs while something still
  // covers the page — the loader or the arrival wipe — so the reveal lands
  // directly on the destination instead of flashing the hero first.
  function placeInitialRoute() {
    var target = hashTarget(initialHash);
    if (target || !initialHash) jumpTo(target);
    if (ScrollTrigger) ScrollTrigger.refresh();
    settleScrubs();
    if (window.quantumField) window.quantumField.refresh();
    remeasureRail();
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

  // Runs while the loader still covers the page: release the loading layout,
  // build the scroll scenes and put the page on its route, so the loader lifts
  // straight onto the destination. It used to position only after the lift,
  // which flashed the hero before jumping to e.g. #contact.
  var revealPrepared = false;
  var preparedWidth = 0;
  function prepareReveal() {
    if (revealPrepared) return;
    revealPrepared = true;
    body.classList.remove("is-loading");
    initScrollAnimations();
    placeInitialRoute();
    preparedWidth = root.clientWidth;
  }

  function finishLoader() {
    var loader = doc.getElementById("loader");
    prepareReveal();
    setScrollLocked(false);
    // Where scrollbars take up space (Windows), unlocking narrows the page;
    // re-measure so triggers match the final layout.
    if (preparedWidth && root.clientWidth !== preparedWidth) {
      if (ScrollTrigger) ScrollTrigger.refresh();
      remeasureRail();
    }
    if (window.quantumField) window.quantumField.setIntroProgress(1);
    if (loader) {
      loader.setAttribute("aria-hidden", "true");
      window.setTimeout(function () {
        if (loader.parentNode) loader.parentNode.removeChild(loader);
      }, reduceMotion ? 0 : 950);
    }
    playHero();
  }

  // Arrival through a site transition. The intro loader is a first-visit
  // overture, not a page transition, so it is skipped: the page settles under
  // the still-closed wipe, then the wipe lifts — the second half of the motion
  // that started on the previous page.
  function arrive(loader) {
    var fromLoader = !!loader;
    if (loader && loader.parentNode) loader.parentNode.removeChild(loader);
    body.classList.remove("is-loading");
    // No scroll lock here: toggling overflow would change the page width on
    // platforms with space-taking scrollbars right as the wipe lifts.
    var started = false;
    function settle() {
      if (started) return;
      started = true;
      revealPrepared = true;
      initScrollAnimations();
      placeInitialRoute();
      // Let the positioned page paint once under the wipe before lifting, so
      // the reveal never uncovers a half-updated frame.
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { liftArrival(fromLoader); });
      });
    }
    // Final fonts first, so nothing reflows mid-reveal — but never wait on a
    // slow font server.
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(settle, settle);
    window.setTimeout(settle, 700);
    if (!doc.fonts || !doc.fonts.ready) settle();
  }

  function resetWipe(wipe) {
    wipe.classList.remove("is-active");
    wipe.style.clipPath = "inset(100% 0 0 0)";
  }

  function liftArrival(fromLoader) {
    var wipe = doc.querySelector(".page-wipe");
    playHero();
    if (window.quantumField) {
      if (fromLoader && gsap) {
        // The field normally assembles behind the loader; here it assembles
        // as the wipe uncovers it.
        var intro = { value: 0.35 };
        gsap.to(intro, {
          value: 1,
          duration: 1.3,
          ease: "power3.out",
          onUpdate: function () { window.quantumField.setIntroProgress(intro.value); }
        });
      } else {
        window.quantumField.setIntroProgress(1);
      }
    }
    if (!wipe || !gsap) {
      root.classList.remove("is-arriving");
      if (wipe) resetWipe(wipe);
      return;
    }
    // Hand the closed state from the class to an inline style, then drop the
    // class (and its failsafe animation) before tweening.
    wipe.style.clipPath = "inset(0% 0 0 0)";
    wipe.classList.add("is-active");
    root.classList.remove("is-arriving");
    gsap.to(wipe, {
      clipPath: "inset(0 0 100% 0)",
      duration: 0.82,
      ease: "power4.inOut",
      onComplete: function () { resetWipe(wipe); }
    });
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
    if (arriving) {
      arrive(loader);
      return;
    }
    if (!loader) {
      body.classList.remove("is-loading");
      if (window.quantumField) window.quantumField.setIntroProgress(1);
      playHero();
      revealPrepared = true;
      initScrollAnimations();
      requestAnimationFrame(placeInitialRoute);
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
      // Still fully covered: settle the page onto its route before the lift.
      .call(prepareReveal, null, 2.14)
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
      // A function, so invalidateOnRefresh re-reads the viewport: a fixed
      // radius measured at load left the mask short after a rotation/resize.
      var maxMaskRadius = function () {
        return Math.ceil(Math.hypot(window.innerWidth, window.innerHeight) * 0.92) + "px";
      };
      gsap.set(".wordmark--fill .char-clip", { yPercent: 0, rotate: 0 });
      // Assigned below once the mark exists; the scrub calls it every frame
      // so the overlay tracks the inline mark's live position exactly.
      var applyKPose = null;
      var openingTimeline = gsap.timeline({
        defaults: { ease: "none" },
        onUpdate: function () {
          var progress = this.progress();
          body.classList.toggle("is-field-solo", progress > 0.2 && progress < 0.9);
          if (applyKPose) applyKPose();
          if (window.quantumField && window.quantumField.setOpeningProgress) {
            window.quantumField.setOpeningProgress(progress);
          }
        },
        scrollTrigger: {
          id: "opening-sequence",
          trigger: hero,
          start: "top top",
          end: "bottom bottom",
          // Smoothed scrub: the sequence eases toward the scroll position
          // instead of snapping to it, so a coarse wheel notch still reads as
          // a glide. applyKPose runs from onUpdate, so the K stays in sync.
          scrub: 0.7,
          invalidateOnRefresh: true,
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
          "--wordmark-mask-radius": maxMaskRadius,
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
        // offsetTop is 0 through the inline-block char chain, so it cannot
        // locate the mark. Capture the live rect while the glide is at its
        // start, then reuse the stable geometry through the scrub. This keeps
        // the overlay exact without forcing layout reads on every frame.
        var kProxy = { glide: 0, drift: 0 };
        var kAnchor = null;
        var kLogoWidth = 0;
        var kLogoHeight = 0;
        var kGeometryDirty = false;
        window.addEventListener("resize", function () {
          kGeometryDirty = true;
        }, { passive: true });
        applyKPose = function () {
          if (kProxy.glide <= 0.0005 || !kAnchor) {
            var stageBounds = heroStage.getBoundingClientRect();
            var markBounds = kInline.getBoundingClientRect();
            kLogoWidth = kLogo.offsetWidth;
            kLogoHeight = kLogo.offsetHeight;
            kAnchor = {
              x: markBounds.left + markBounds.width / 2 - stageBounds.left,
              y: markBounds.top + markBounds.height / 2 - stageBounds.top,
              scale: markBounds.height / Math.max(1, kLogoHeight),
              stageLeft: stageBounds.left,
              stageTop: stageBounds.top,
              xRatio: (markBounds.left + markBounds.width / 2 - stageBounds.left) /
                Math.max(1, stageBounds.width),
              yRatio: (markBounds.top + markBounds.height / 2 - stageBounds.top) /
                Math.max(1, stageBounds.height)
            };
            kGeometryDirty = false;
          } else if (kGeometryDirty) {
            var refreshedStageBounds = heroStage.getBoundingClientRect();
            kLogoWidth = kLogo.offsetWidth;
            kLogoHeight = kLogo.offsetHeight;
            kAnchor.x = kAnchor.xRatio * refreshedStageBounds.width;
            kAnchor.y = kAnchor.yRatio * refreshedStageBounds.height;
            kAnchor.stageLeft = refreshedStageBounds.left;
            kAnchor.stageTop = refreshedStageBounds.top;
            kGeometryDirty = false;
          }
          var targetHeight = Math.min(window.innerHeight * 0.55, window.innerWidth * 0.54);
          var endScale = targetHeight / Math.max(1, kLogoHeight);
          var t = kProxy.glide;
          var centreX = kAnchor.x + (window.innerWidth * 0.51 - kAnchor.stageLeft - kAnchor.x) * t;
          var centreY = kAnchor.y + (window.innerHeight * 0.45 - kAnchor.stageTop - kAnchor.y) * t;
          var scale = kAnchor.scale + (endScale - kAnchor.scale) * t;
          gsap.set(kLogo, {
            x: centreX - kLogoWidth / 2,
            y: centreY - kLogoHeight / 2 - kProxy.drift * 30,
            scale: scale + kProxy.drift * 0.04,
            force3D: true
          });
        };
        openingTimeline
          // Overlap handoff: the overlay rises to full opacity while the
          // inline mark is still showing, both at identical position and
          // size, so the swap is literally invisible — then the covered
          // inline mark is switched off.
          .fromTo(kLogo, { opacity: 0 }, {
            opacity: 1,
            duration: 0.03,
            ease: "sine.inOut"
          }, 0.005)
          .to(".char-clip--kmark", { opacity: 0, duration: 0.004, ease: "none" }, 0.045)
          .to(kProxy, {
            glide: 1,
            duration: 0.24,
            ease: "power2.inOut"
          }, 0.06)
          // The dust keeps drifting up as it converts into the live field.
          .to(kProxy, {
            drift: 1,
            duration: 0.3,
            ease: "sine.out"
          }, 0.3);
        applyKPose();

        // The erosion PNGs are deliberately sparse dust, not full-opacity
        // replacements. Keep the solid silhouette present until the particle
        // K is coherent, then fade it separately while the dust layers bloom
        // additively over the live field.
        var kDissolveStart = 0.31;
        var kDustStep = 0.055;
        var kDustIn = 0.06;
        var kDustOut = 0.115;
        openingTimeline.to(kFrames[0], {
          opacity: 0,
          duration: 0.17,
          ease: "sine.inOut"
        }, kDissolveStart);
        for (var kIndex = 1; kIndex < kFrames.length; kIndex += 1) {
          var dustStart = kDissolveStart + (kIndex - 1) * kDustStep;
          openingTimeline.fromTo(kFrames[kIndex], { opacity: 0 }, {
            opacity: 1,
            duration: kDustIn,
            ease: "sine.out"
          }, dustStart);
          openingTimeline.to(kFrames[kIndex], {
            opacity: 0,
            duration: kDustOut,
            ease: "sine.in"
          }, dustStart + kDustIn);
        }
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

  // Full-screen opaque layers (menu, project file, lightbox) hide both
  // canvases completely. They listen for this and stop rendering, which frees
  // the frame budget for the overlay's own animation.
  var occluders = {};
  function setOccluder(name, on) {
    occluders[name] = !!on;
    var occluded = Object.keys(occluders).some(function (key) { return occluders[key]; });
    try {
      doc.dispatchEvent(new CustomEvent("ek:occlusion", { detail: { occluded: occluded } }));
    } catch (error) {}
  }

  // Each layer remembers what had focus when it opened and returns it on
  // close. One shared slot let a lightbox overwrite the project's return
  // target, so closing the project focused a detached node. preventScroll
  // matters under Lenis: native focus scrolling jumps the page.
  function restoreFocus(node) {
    if (!node || !node.focus || !doc.contains(node)) return;
    try {
      node.focus({ preventScroll: true });
    } catch (error) {
      node.focus();
    }
  }

  // Menu.
  var menuToggle = doc.getElementById("menuToggle");
  var menuOverlay = doc.getElementById("menuOverlay");
  var menuReturn = null;
  var menuOcclusionTimer = 0;
  function setMenu(open) {
    if (!menuToggle || !menuOverlay) return;
    var wasOpen = body.classList.contains("menu-open");
    body.classList.toggle("menu-open", open);
    menuToggle.setAttribute("aria-expanded", String(open));
    menuOverlay.setAttribute("aria-hidden", String(!open));
    setScrollLocked(open);
    if (open && !wasOpen) menuReturn = doc.activeElement;
    // The overlay's clip-path opens over .85s; pause the canvases only once
    // it fully covers them, resume the moment it starts to close.
    window.clearTimeout(menuOcclusionTimer);
    if (open) menuOcclusionTimer = window.setTimeout(function () { setOccluder("menu", true); }, 900);
    else setOccluder("menu", false);
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
    if (!open && wasOpen) restoreFocus(menuReturn);
  }
  if (menuToggle && menuOverlay) {
    menuToggle.addEventListener("click", function () {
      setMenu(!body.classList.contains("menu-open"));
    });
    qsa("[data-menu-link]", menuOverlay).forEach(function (link) {
      link.addEventListener("click", function () { setMenu(false); });
    });
  }

  // Escape closes the topmost layer only. It used to close the lightbox and
  // the project file underneath it in one keystroke.
  doc.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    if (body.classList.contains("lightbox-open")) closeLightbox();
    else if (body.classList.contains("project-open")) closeProject();
    else if (body.classList.contains("menu-open")) setMenu(false);
  });

  // Sticky section observer and page progress.
  var scenes = qsa(".scene[data-section]");
  var railCurrent = doc.getElementById("railCurrent");
  var railName = doc.getElementById("railName");
  var railProgress = doc.getElementById("railProgress");
  var activeScene = null;

  // Scene extents in document space, cached so the scroll handler does no
  // layout reads. Eight getBoundingClientRect calls per frame forced a style
  // recalc on every scroll tick, which is exactly the work that makes a
  // smooth-scrolled page feel gritty.
  var sceneBounds = [];
  var scrollRange = 1;
  function measureScenes() {
    var offset = window.scrollY;
    sceneBounds = scenes.map(function (scene) {
      var bounds = scene.getBoundingClientRect();
      return { node: scene, top: bounds.top + offset, bottom: bounds.bottom + offset };
    });
    scrollRange = Math.max(1, doc.documentElement.scrollHeight - window.innerHeight);
  }

  function updateRail() {
    var focus = window.scrollY + window.innerHeight * 0.46;
    var best = null;
    var distance = Infinity;
    for (var i = 0; i < sceneBounds.length; i += 1) {
      var entry = sceneBounds[i];
      var inside = entry.top <= focus && entry.bottom >= focus;
      var d = inside ? 0 : Math.min(Math.abs(entry.top - focus), Math.abs(entry.bottom - focus));
      if (d < distance) {
        best = entry.node;
        distance = d;
      }
    }
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
    var progress = clamp(window.scrollY / scrollRange, 0, 1);
    if (railProgress) railProgress.style.transform = "scaleY(" + progress.toFixed(4) + ")";
  }
  // Coalesce rail updates to one frame.
  var railFrame = 0;
  function scheduleRail() {
    if (!railFrame) {
      railFrame = requestAnimationFrame(function () {
        railFrame = 0;
        updateRail();
      });
    }
  }
  function remeasureRail() {
    measureScenes();
    updateRail();
  }
  window.addEventListener("scroll", scheduleRail, { passive: true });
  // Debounced: a resize burst (window drag, mobile toolbar) re-measured every
  // scene on every event.
  var railResizeTimer = 0;
  window.addEventListener("resize", function () {
    window.clearTimeout(railResizeTimer);
    railResizeTimer = window.setTimeout(remeasureRail, 150);
  }, { passive: true });
  remeasureRail();

  function refreshLayout() {
    if (ScrollTrigger) ScrollTrigger.refresh();
    if (window.quantumField) window.quantumField.refresh();
    remeasureRail();
  }

  // Project filter. Only rows whose visibility actually changes animate —
  // rows that stayed visible used to collapse to zero and grow back, so the
  // whole list flickered — and the layout refresh runs once after the last
  // row settles instead of once per row (up to seven full refreshes a click).
  var filterSettleTimer = 0;
  qsa("[data-filter]").forEach(function (button) {
    button.addEventListener("click", function () {
      var filter = button.getAttribute("data-filter");
      qsa("[data-filter]").forEach(function (item) {
        var active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      var changed = false;
      qsa(".project-row").forEach(function (row) {
        var show = filter === "all" || (row.getAttribute("data-category") || "").split(/\s+/).indexOf(filter) > -1;
        var shown = row.getAttribute("data-filtered") !== "out";
        if (show === shown) return;
        changed = true;
        row.setAttribute("data-filtered", show ? "in" : "out");
        if (gsap && !reduceMotion) {
          gsap.killTweensOf(row);
          if (show) {
            // Fully collapsed rows grow from zero; a row caught mid-collapse
            // reverses from wherever it is.
            var from = row.hidden ? { height: 0, opacity: 0, y: 20 } : {};
            row.hidden = false;
            gsap.fromTo(row, from, {
              height: "auto", opacity: 1, y: 0, duration: 0.62, ease: "power4.out", clearProps: "height"
            });
          } else {
            gsap.to(row, {
              height: 0, opacity: 0, y: -12, duration: 0.45, ease: "power3.inOut",
              onComplete: function () { row.hidden = true; }
            });
          }
        } else {
          row.hidden = !show;
        }
      });
      if (!changed) return;
      window.clearTimeout(filterSettleTimer);
      filterSettleTimer = window.setTimeout(refreshLayout, gsap && !reduceMotion ? 680 : 0);
    });
  });

  // Floating project preview.
  var preview = doc.getElementById("projectPreview");
  if (preview && finePointer) {
    var previewImage = preview.querySelector("img");
    var previewCaption = preview.querySelector("figcaption");
    var projectRows = qsa(".project-row");
    var projectTotal = String(projectRows.length).padStart(2, "0");
    var moveX = gsap ? gsap.quickTo(preview, "x", { duration: 0.52, ease: "power3.out" }) : null;
    var moveY = gsap ? gsap.quickTo(preview, "y", { duration: 0.52, ease: "power3.out" }) : null;
    // Warm every preview the first time the pointer reaches the list, so a
    // hovered row never shows the previous project's image while its own
    // is still downloading.
    var projectIndexNode = doc.getElementById("projectIndex");
    if (projectIndexNode) {
      projectIndexNode.addEventListener("pointerenter", function warmPreviews() {
        projectIndexNode.removeEventListener("pointerenter", warmPreviews);
        projectRows.forEach(function (row) {
          var image = new Image();
          image.decoding = "async";
          image.src = row.getAttribute("data-preview");
        });
      });
    }
    projectRows.forEach(function (row, index) {
      row.addEventListener("mouseenter", function () {
        var src = row.getAttribute("data-preview");
        if (previewImage && previewImage.getAttribute("src") !== src) previewImage.src = src;
        if (previewCaption) {
          previewCaption.textContent = "OPEN CASE / " + String(index + 1).padStart(2, "0") + "—" + projectTotal;
        }
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
  var projectReturn = null;

  function buildProject(project) {
    var docs = (project.docs || []).map(function (item) {
      return '<a href="' + item[0] + '" target="_blank" rel="noopener"><span>PDF</span>' + item[1] + '<i>↗</i></a>';
    }).join("");
    var images = project.images.map(function (item, index) {
      var no = String(index + 1).padStart(2, "0");
      // [src, caption, width, height] — the size lets the sheet lay out before
      // the images arrive, so the gallery does not jump while it loads.
      var size = item[2] && item[3] ? ' width="' + item[2] + '" height="' + item[3] + '"' : "";
      return '<figure class="project-sheet__figure" data-project-image="' + index + '" tabindex="0" role="button">' +
        '<div><img src="' + item[0] + '"' + size + ' alt="' + item[1].replace(/"/g, "&quot;") + '" loading="' + (index < 2 ? "eager" : "lazy") + '" decoding="async"></div>' +
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
    projectReturn = doc.activeElement;
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
      gsap.killTweensOf(projectOverlay);
      gsap.fromTo(projectOverlay, { clipPath: "inset(100% 0 0 0)" }, {
        clipPath: "inset(0% 0 0 0)", duration: 0.92, ease: "power4.inOut",
        onComplete: function () { setOccluder("project", true); }
      });
      gsap.fromTo(".project-sheet__header > *, .project-sheet__docs", { y: 55, opacity: 0 }, {
        y: 0, opacity: 1, duration: 0.9, stagger: 0.07, delay: 0.48, ease: "power4.out"
      });
    } else {
      setOccluder("project", true);
    }
    if (projectClose) restoreFocus(projectClose);
  }

  function closeProject() {
    if (!projectOverlay || projectOverlay.getAttribute("aria-hidden") === "true") return;
    // Resume the canvases now: the page shows through as the file slides away.
    setOccluder("project", false);
    function finish() {
      projectOverlay.setAttribute("aria-hidden", "true");
      body.classList.remove("project-open");
      setScrollLocked(false);
      if (projectContent) projectContent.innerHTML = "";
      restoreFocus(projectReturn);
    }
    if (gsap && !reduceMotion) {
      gsap.killTweensOf(projectOverlay);
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
  var lightboxReturn = null;

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
    lightboxReturn = doc.activeElement;
    lightboxItems = items;
    lightboxIndex = clamp(index || 0, 0, items.length - 1);
    lightboxProjectWasOpen = body.classList.contains("project-open");
    renderLightbox();
    lightbox.setAttribute("aria-hidden", "false");
    body.classList.add("lightbox-open");
    setScrollLocked(true);
    if (gsap && !reduceMotion) {
      gsap.killTweensOf(lightbox);
      gsap.fromTo(lightbox, { opacity: 0 }, {
        opacity: 1, duration: 0.42, ease: "power2.out",
        onComplete: function () { setOccluder("lightbox", true); }
      });
      gsap.fromTo(lightboxImage, { clipPath: "inset(0 0 100% 0)", scale: 1.04 }, {
        clipPath: "inset(0 0 0% 0)", scale: 1, duration: 0.82, ease: "power4.inOut"
      });
    } else {
      setOccluder("lightbox", true);
    }
    if (lightboxClose) restoreFocus(lightboxClose);
  }

  function closeLightbox() {
    if (!lightbox || lightbox.getAttribute("aria-hidden") === "true") return;
    setOccluder("lightbox", false);
    function finish() {
      lightbox.setAttribute("aria-hidden", "true");
      body.classList.remove("lightbox-open");
      if (!lightboxProjectWasOpen) setScrollLocked(false);
      restoreFocus(lightboxReturn);
    }
    if (gsap && !reduceMotion) {
      gsap.killTweensOf(lightbox);
      gsap.to(lightbox, { opacity: 0, duration: 0.3, onComplete: finish });
    } else finish();
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
    // The ring chases the dot with an exponential ease, so it only needs to
    // run while it is actually catching up. Parking the loop once it has
    // settled keeps an idle page off the main thread instead of burning a
    // rAF callback every frame for a cursor nobody is moving.
    function drawCursor() {
      ringX += (cursorX - ringX) * 0.16;
      ringY += (cursorY - ringY) * 0.16;
      cursorDot.style.transform = "translate3d(" + cursorX + "px," + cursorY + "px,0)";
      cursorRing.style.transform = "translate3d(" + ringX + "px," + ringY + "px,0)";
      if (Math.abs(cursorX - ringX) > 0.1 || Math.abs(cursorY - ringY) > 0.1) {
        cursorFrame = requestAnimationFrame(drawCursor);
      } else {
        cursorFrame = 0;
      }
    }
    function requestCursorFrame() {
      if (!cursorFrame) cursorFrame = requestAnimationFrame(drawCursor);
    }
    window.addEventListener("pointermove", function (event) {
      cursorX = event.clientX;
      cursorY = event.clientY;
      body.classList.add("cursor-ready");
      requestCursorFrame();
    }, { passive: true });
    doc.addEventListener("pointerover", function (event) {
      var target = event.target.closest("a, button, [role='button'], canvas");
      cursorRing.classList.toggle("is-active", !!target);
      cursorRing.classList.toggle("is-open", !!event.target.closest("[data-cursor='open'], [data-project-open], [data-gallery-group]"));
    });
  }

  // Cross-page wipe.
  //
  // One route table is the single source of truth for what the wipe announces.
  // Every entry point — teaser card, footer, menu — resolves through it, so the
  // same destination always shows the same number and name no matter where the
  // click came from. Nothing is read back from the markup, which is what used
  // to let a page's own hard-coded number leak into an unrelated transition.
  var SECTION_ROUTES = {
    "#about": ["01", "About"],
    "#projects": ["02", "Projects"],
    "#figure": ["03", "Interactive figure"],
    "#drawings": ["04", "Drawings + Misc."],
    "#aerial": ["05", "Aerial"],
    "#certifications": ["06", "Certifications"],
    "#contact": ["07", "Contact"]
  };
  var PAGE_ROUTES = {
    "drawings.html": ["04", "Drawings + Misc."],
    "aerial.html": ["05", "Aerial"]
  };
  var INDEX_ROUTE = ["00", "Index"];

  function resolveRoute(link, href) {
    var explicit = link && link.getAttribute("data-transition-section");
    var destination;
    try {
      destination = new URL(href, window.location.href);
    } catch (error) {
      return { no: explicit || INDEX_ROUTE[0], name: INDEX_ROUTE[1], hash: "", samePage: false };
    }
    var page = destination.pathname.split("/").pop().toLowerCase();
    var hash = destination.hash.toLowerCase();
    var here = window.location.pathname.split("/").pop().toLowerCase();
    // Hash first: a fragment always names a section, whereas the page name is
    // only meaningful when no fragment is present. Resolving the page first
    // meant a bare "#contact" on drawings.html answered "04 / Drawings",
    // silently labelling the transition with the page it was leaving.
    var route = (hash && SECTION_ROUTES[hash]) || PAGE_ROUTES[page] || INDEX_ROUTE;
    return {
      no: explicit || route[0],
      name: route[1],
      hash: PAGE_ROUTES[page] && !hash ? "" : hash,
      // A hash on the page we are already on never needs a document load.
      samePage: !!hash && !PAGE_ROUTES[page] &&
        (page === here || ((!page || page === "index.html") && (!here || here === "index.html")))
    };
  }

  function paintWipe(route) {
    var wipe = doc.querySelector(".page-wipe");
    if (!wipe) return null;
    var number = wipe.querySelector(".page-wipe__no");
    var name = wipe.querySelector(".page-wipe__name");
    if (number) number.textContent = route.no;
    if (name) name.textContent = route.name;
    return wipe;
  }

  function goToHash(hash) {
    jumpTo(hashTarget(hash));
    if (hash && history.replaceState) history.replaceState(null, "", hash);
  }

  // Hands the wipe's label to the next page. The inline <head> script there
  // reads it before first paint and keeps the wipe closed, so the motion
  // continues across the page load instead of cutting to a blank frame.
  function markArrival(href, route) {
    try {
      var destination = new URL(href, window.location.href);
      window.sessionStorage.setItem("ek:wipe", JSON.stringify({
        no: route.no,
        name: route.name,
        to: destination.pathname.replace(/index\.html$/, ""),
        t: Date.now()
      }));
    } catch (error) {}
  }

  function runTransition(href, route) {
    var wipe = paintWipe(route);
    if (!wipe || !gsap || reduceMotion) {
      if (route.samePage) goToHash(route.hash);
      else window.location.href = href;
      return;
    }
    wipe.classList.add("is-active");
    gsap.killTweensOf(wipe);
    gsap.fromTo(wipe, { clipPath: "inset(100% 0 0 0)" }, {
      clipPath: "inset(0% 0 0 0)",
      duration: route.samePage ? 0.62 : 0.75,
      ease: "power4.inOut",
      onComplete: function () {
        if (!route.samePage) {
          markArrival(href, route);
          window.location.href = href;
          return;
        }
        // In-page destinations reuse the identical treatment, then lift again
        // so menu navigation reads the same whether or not a document loads.
        // Layout has not changed, so no full refresh — just jump and settle
        // the scrubbed scenes so nothing fast-forwards under the lifting wipe.
        goToHash(route.hash);
        settleScrubs();
        updateRail();
        gsap.to(wipe, {
          clipPath: "inset(0 0 100% 0)",
          duration: 0.68,
          ease: "power4.inOut",
          delay: 0.12,
          onComplete: function () { resetWipe(wipe); }
        });
      }
    });
  }

  // Warm the next document on intent (hover, focus, touch) so the page behind
  // the wipe is usually already in cache when the wipe closes.
  var prefetched = {};
  function prefetch(link) {
    var href = link.getAttribute("href");
    if (!href || href.charAt(0) === "#") return;
    var url;
    try {
      url = new URL(href, window.location.href);
    } catch (error) {
      return;
    }
    if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
    if (prefetched[url.pathname]) return;
    prefetched[url.pathname] = true;
    var hint = doc.createElement("link");
    hint.rel = "prefetch";
    hint.href = url.pathname;
    doc.head.appendChild(hint);
  }

  function bindTransition(link) {
    if (link.dataset.transitionBound) return;
    link.dataset.transitionBound = "true";
    var warm = function () { prefetch(link); };
    link.addEventListener("pointerenter", warm);
    link.addEventListener("focus", warm);
    link.addEventListener("touchstart", warm, { passive: true });
    link.addEventListener("click", function (event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey ||
          event.shiftKey || event.altKey || link.target === "_blank") return;
      var href = link.getAttribute("href");
      if (!href) return;
      // Anything leaving the site keeps the browser's own behaviour.
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.indexOf("//") === 0) return;
      var route = resolveRoute(link, href);
      if (!route.samePage && href.charAt(0) === "#") return;
      event.preventDefault();
      // Only a menu that is actually open needs closing. Closing it
      // unconditionally restored focus to whatever last had it, and the
      // browser scrolled that element into view as the wipe began.
      if (body.classList.contains("menu-open")) setMenu(false);
      runTransition(href, route);
    });
  }

  qsa("[data-transition-link]").forEach(bindTransition);
  // Menu entries that point at a section of the current page get the same
  // treatment; previously they fell through to a raw anchor jump, which is why
  // the menu felt like a different piece of software from the rest of the site.
  if (menuOverlay) qsa("[data-menu-link]", menuOverlay).forEach(bindTransition);

  // Footer section links stay lightweight — no wipe — but they route through
  // Lenis so they glide instead of teleporting under the smooth-scroll layer.
  qsa('.site-footer a[href^="#"]').forEach(function (link) {
    link.addEventListener("click", function (event) {
      var hash = link.getAttribute("href");
      var target = hashTarget(hash);
      if (!target || !lenis || !lenis.scrollTo || reduceMotion) return;
      event.preventDefault();
      lenis.scrollTo(target, { offset: 0 });
      if (history.replaceState) history.replaceState(null, "", hash);
    });
  });

  // Back/forward cache restores the page exactly as it was left: with the
  // departure wipe closed. Lift it like an arrival. Only for restores — on a
  // normal load this handler used to unlock scrolling in the middle of the
  // intro loader.
  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    if (body.classList.contains("menu-open")) setMenu(false);
    body.classList.remove("project-open", "lightbox-open");
    setScrollLocked(false);
    var wipe = doc.querySelector(".page-wipe");
    if (!wipe) return;
    if (gsap && !reduceMotion && wipe.classList.contains("is-active")) {
      gsap.killTweensOf(wipe);
      gsap.fromTo(wipe, { clipPath: "inset(0% 0 0 0)" }, {
        clipPath: "inset(0 0 100% 0)",
        duration: 0.7,
        ease: "power4.inOut",
        onComplete: function () { resetWipe(wipe); }
      });
    } else {
      resetWipe(wipe);
    }
  });

  window.addEventListener("load", function () {
    if (ScrollTrigger) ScrollTrigger.refresh();
    if (window.quantumField) window.quantumField.refresh();
    remeasureRail();
  });
})();
