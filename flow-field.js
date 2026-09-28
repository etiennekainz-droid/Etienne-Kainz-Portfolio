(function () {
  "use strict";

  // The engineering field: a live test section behind the portfolio.
  //
  // Three layers share one canvas and one character grid:
  //   1. Mechanisms — particle point clouds of real hardware (fan stage,
  //      gear train, wing section, shaft assembly, terrain, gyroscope, dish,
  //      thrust chamber) that move the way the hardware moves.
  //   2. Flow — an incompressible Navier–Stokes solver (stable fluids) runs
  //      on the glyph grid. The mechanisms are moving solid boundaries in a
  //      wind-tunnel freestream; smoke-wire timelines, the pointer and the
  //      ignition plume inject dye that the solver advects.
  //   3. Drafting — a technical-drawing overlay that tracks the mechanism:
  //      chain-line axes, pitch circles, live overall dimensions, leaders,
  //      balloons, and a sweeping section cut with hatching.
  //
  // This one file plays two roles. Loaded by the page it is the host: it
  // measures the document, forwards scroll, pointer and layout, and hands
  // the canvas to a copy of itself running as a worker (OffscreenCanvas), so
  // the simulation never competes with scrolling for the main thread. Loaded
  // as that worker it is the engine. Where workers or OffscreenCanvas are
  // unavailable, the host runs the same engine in the page.

  var IN_WORKER = typeof document === "undefined" && typeof importScripts === "function";
  var scope = typeof self !== "undefined" ? self : window;

  // Workers do not see the page's webfonts. Read the same Google Fonts
  // stylesheet and register the IBM Plex Mono faces with the worker's own
  // font set, so the drafting text matches the site.
  function loadWorkerFonts(cssUrl) {
    if (!cssUrl || typeof fetch !== "function" || typeof FontFace !== "function" || !scope.fonts) {
      return Promise.resolve(false);
    }
    return fetch(cssUrl).then(function (response) {
      return response.text();
    }).then(function (css) {
      var pending = [];
      css.replace(/@font-face\s*\{([^}]*)\}/g, function (all, block) {
        if (!/font-family:\s*['"]?IBM Plex Mono/.test(block)) return all;
        var src = /src:\s*([^;]+);/.exec(block);
        if (!src) return all;
        var weight = /font-weight:\s*(\d+)/.exec(block);
        var range = /unicode-range:\s*([^;]+);/.exec(block);
        var descriptors = { weight: weight ? weight[1] : "400" };
        if (range) descriptors.unicodeRange = range[1].trim();
        var face = new FontFace("IBM Plex Mono", src[1].trim(), descriptors);
        scope.fonts.add(face);
        // Canvas text never triggers a lazy load, so fetch the Latin subset
        // (every glyph the field draws) up front.
        if (!range || /U\+0000-00FF/i.test(range[1])) pending.push(face.load());
        return all;
      });
      return Promise.all(pending).then(function () { return pending.length > 0; });
    }).catch(function () {
      return false;
    });
  }

  function createEngine(canvas, config, emit) {
    // desynchronized skips compositor sync for a main-thread canvas; a
    // worker-owned canvas is already off that path.
    var ctx = canvas.getContext("2d", IN_WORKER ? { alpha: true } : { alpha: true, desynchronized: true });
    if (!ctx) return null;

    var TAU = Math.PI * 2;
    var TIME_ORIGIN = performance.timeOrigin || 0;
    var reducedMotion = !!config.reducedMotion;
    // The host measures the page; the engine only ever sees these snapshots.
    var viewport = config.viewport;
    var layout = config.layout;
    var compact = viewport.compact;
    var medium = viewport.medium;
    // Reduced motion shows one still frame, so it can afford a denser, more
    // legible point cloud than the old static field did.
    var particleCount = reducedMotion ?
      (compact ? 640 : medium ? 900 : 1200) :
      (compact ? 1800 : medium ? 2600 : 3600);
    var phase = new Float32Array(particleCount);
    var seedA = new Float32Array(particleCount);
    var seedB = new Float32Array(particleCount);
    var seedC = new Float32Array(particleCount);
    var seedD = new Float32Array(particleCount);
    var prevScreenX = new Float32Array(particleCount);
    var prevScreenY = new Float32Array(particleCount);
    // Per-frame sample buffers. Samples are projected first, then splatted in
    // a second pass once the depth buffer knows what sits in front.
    var sampleCell = new Int32Array(particleCount);
    var sampleX = new Float32Array(particleCount);
    var sampleY = new Float32Array(particleCount);
    var sampleZ = new Float32Array(particleCount);
    var sampleWeight = new Float32Array(particleCount);
    var sampleVX = new Float32Array(particleCount);
    var sampleVY = new Float32Array(particleCount);
    var sampleAlpha = new Float32Array(particleCount);
    var sampleMark = new Uint8Array(particleCount);
    var sampleTracer = new Uint8Array(particleCount);
    var sectionStops = [];
    var width = 1;
    var height = 1;
    // The part of the canvas actually on screen. The canvas is sized to the
    // large viewport, so while a phone's toolbars show, its lower edge sits
    // behind them; everything that is laid out — formation centre, scale,
    // the K handoff, labels, the scroll focus line — uses this height, the
    // same window.innerHeight main.js positions the K overlay against.
    var viewHeight = 1;
    var dpr = 1;
    var introProgress = config.introProgress;
    var frame = 0;
    var lastFrame = 0;
    var pageVisible = config.visible !== false;
    var scrollState = { a: 0, b: 0, mix: 0, global: 0 };
    var pointer = {
      x: -9999, y: -9999, active: false, moved: 0, swirl: 0,
      vx: 0, vy: 0, fx: -1, fy: -1, pending: false
    };
    var ripples = [];
    var bursts = [];
    var glyphs = [];
    var scrollEnergy = 0;
    var scrollBias = 0;
    var signedScrollPhase = 0;
    var appliedScrollPhase = 0;
    var hostScrollY = config.scrollY || 0;
    var lastScrollY = hostScrollY;
    var lastScrollStamp = performance.now();
    var hasOpening = !!config.hasOpening;
    var openingProgress = hasOpening && !reducedMotion ? 0 : 1;
    var openingTarget = openingProgress;
    var openingExternallyDriven = false;
    // Journey coordinate. 0..1 is the opening chain; beyond that, 1 + k + t
    // sits between section stops k and k+1 (gallery pages start at 0). The
    // field displays `stage`, which trails the scroll-derived target under
    // per-phase speed limits — a fast flick can no longer skip the fan stage
    // or the ignition; they play out, then the field catches up.
    var stage = 0;
    var stageSnap = true;
    var openingStart = 0;
    var openingTravel = 1;
    var pageScrollMax = 1;
    var renderCostAverage = 6;
    var occluded = false;
    // Backing-store density: dprScale is lowered by the resolution governor
    // (see governResolution); dprFloor is the density it may not go below.
    var dprScale = 1;
    var dprFloor = 1;

    // Staged quality governor: 2 = full detail, 1 = a lighter solver,
    // 0 = particle stride + single-cell splat, bare solver.
    // Hysteresis avoids flapping.
    var quality = 2;
    // Reports to the host: a stats snapshot a few times a second, and the
    // displayed journey position whenever it moves (the scroll governor reads it).
    var lastReport = -Infinity;
    var reportedStage = -1;

    // The glyph raster: projected mechanism density is accumulated on a fixed
    // character grid every frame and rendered as a brightness ramp of
    // drafting marks with motion-aligned strokes. The flow solver runs on the
    // very same grid, so one cell is one glyph is one fluid cell. Phones get
    // a finer grid: a mechanism a phone-width wide needs more than 25 glyphs
    // across to read as hardware.
    var cellSize = compact ? 9 : 11;
    // Portrait phones lay tall mechanisms out vertically (engine firing
    // downward, gear train and shaft stacked) instead of shrinking them.
    var portraitMode = false;
    var rasterCols = 0;
    var rasterRows = 0;
    var rasterDensity = null;
    var rasterFlowX = null;
    var rasterFlowY = null;
    // Depth buffer: nearest sample depth per cell, then dilated one cell so a
    // sparse front surface still hides what is behind it (hidden-line view).
    var rasterNear = null;
    var rasterNearDil = null;
    // Share of each cell's density that comes from flow tracers.
    var rasterTracer = null;
    var rasterGX = null;
    var rasterGY = null;
    var rampSprites = [];
    var directionSprites = [];
    var smokeSprites = [];
    var smokeDot = null;
    var smokeCurl = null;
    var hatchSprite = null;
    var edgeSprites = [];

    function hash(n) {
      var x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
      return x - Math.floor(x);
    }

    function fastHash(n) {
      n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
      n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
      n ^= n >>> 16;
      return (n >>> 0) / 4294967296;
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function ease(value) {
      value = clamp(value, 0, 1);
      return value * value * (3 - 2 * value);
    }

    function band(edge0, edge1, value) {
      return ease((value - edge0) / (edge1 - edge0));
    }

    function frac(value) {
      return value - Math.floor(value);
    }

    // Engineering number format: space-grouped thousands, fixed decimals.
    function fmt(value, decimals) {
      var parts = Math.abs(value).toFixed(decimals).split(".");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
      return (value < 0 ? "−" : "") + parts.join(".");
    }

    // Sprites and samplers: OffscreenCanvas inside the worker, a detached
    // canvas element on the main thread.
    function makeCanvas(w, h) {
      var surface = IN_WORKER ? new OffscreenCanvas(w, h) : document.createElement("canvas");
      surface.width = w;
      surface.height = h;
      return surface;
    }

    function loadImage(url, done) {
      if (!IN_WORKER) {
        var image = new Image();
        image.onload = function () { done(image); };
        image.src = url;
        return;
      }
      if (typeof fetch !== "function" || typeof createImageBitmap !== "function") return;
      fetch(url)
        .then(function (response) { return response.blob(); })
        .then(function (blob) { return createImageBitmap(blob); })
        .then(done, function () {});
    }

    var raf = typeof scope.requestAnimationFrame === "function" ?
      function (callback) { return scope.requestAnimationFrame(callback); } :
      function (callback) { return setTimeout(function () { callback(performance.now()); }, 16); };
    var caf = typeof scope.cancelAnimationFrame === "function" ?
      function (id) { scope.cancelAnimationFrame(id); } :
      function (id) { clearTimeout(id); };

    for (var seedIndex = 0; seedIndex < particleCount; seedIndex += 1) {
      seedA[seedIndex] = hash(seedIndex + 11);
      seedB[seedIndex] = hash(seedIndex + 1011);
      seedC[seedIndex] = hash(seedIndex + 9001);
      seedD[seedIndex] = hash(seedIndex * 3 + 17);
      phase[seedIndex] = hash(seedIndex + 501) * Math.PI * 2;
      prevScreenX[seedIndex] = -9999;
      prevScreenY[seedIndex] = -9999;
    }

    // Shared per-frame drive state. The angle accumulators integrate speed, so
    // a throttle change (scroll) never makes a mechanism jump.
    var env = {
      t: 0,
      spin: 0.6,
      spinRate: 1,
      gear: 0.4,
      gearRate: 0.3,
      slow: 1.1,
      flow: 0.3,
      fly: 0.5,
      ign: 0,
      clock: 0
    };
    // Motion output: x, y, z, presence (0..1), heat (0..1), tracer flag. Heat
    // is the physical hot-spot of each mechanism — contact stress, tip speed,
    // throat heat flux, suction peak — and sets how dense its glyphs render.
    // Tracers (streamlines, plume, wavefronts) are flow, not hardware, so the
    // live dimensions ignore them.
    var OUT = new Float32Array(6);

    function Formation(spec) {
      var n = particleCount;
      this.part = new Uint8Array(n);
      this.a = new Float32Array(n);
      this.b = new Float32Array(n);
      this.c = new Float32Array(n);
      this.h = new Float32Array(n);
      this.motion = spec.motion || staticMotion;
      this.frame = spec.frame || null;
      this.guides = spec.guides || null;
      this.wind = spec.wind == null ? 1 : spec.wind;
      this.rake = spec.rake || 0;
      this.solid = spec.solid == null ? 1 : spec.solid;
      this.dims = spec.dims !== false;
      this.unit = spec.unit || 1000;
      this.prefix = spec.prefix || "";
      this.yaw = spec.yaw || 0;
      this.pitch = spec.pitch || 0;
      this.zoom = spec.zoom || 1;
      // Phones are portrait: wide mechanisms shrink to fit the narrow axis.
      this.compactZoom = spec.compactZoom || this.zoom;
      this.portrait = !!spec.portrait;
      this.shift = spec.shift || 0;
      this.anchorY = spec.anchorY == null ? -1 : spec.anchorY;
      this.portraitAnchorY = spec.portraitAnchorY == null ? this.anchorY : spec.portraitAnchorY;
      // Finish: drift scales the thermal shimmer, haze the smoke drawn over
      // the formation, and tracerStroke draws its flow tracers as thin
      // streamline strokes instead of motion chevrons.
      this.drift = spec.drift == null ? 1 : spec.drift;
      this.haze = spec.haze == null ? 1 : spec.haze;
      this.tracerStroke = spec.tracerStroke ? 1 : 0;
      for (var i = 0; i < n; i += 1) spec.build(this, i, seedA[i], seedB[i], seedC[i], seedD[i]);
    }

    function put(f, i, part, a, b, c, heat) {
      f.part[i] = part;
      f.a[i] = a;
      f.b[i] = b;
      f.c[i] = c;
      f.h[i] = heat;
    }

    // Evaluates a formation's pose for one particle into OUT, turning it a
    // quarter-turn for the portrait layout where the formation asks for it.
    function evalMotion(f, i) {
      OUT[5] = 0;
      f.motion(f, i, env, OUT);
      if (portraitMode && f.portrait) {
        var t = OUT[0];
        OUT[0] = -OUT[1];
        OUT[1] = t;
      }
    }

    function staticMotion(f, i, e, out) {
      out[0] = f.a[i];
      out[1] = f.b[i];
      out[2] = f.c[i];
      out[3] = 1;
      out[4] = f.h[i];
    }

    // Spur-gear outline radius at a local angle. Tooth centres sit at whole
    // pitches; tip land, involute-like flank, root land.
    function toothRadius(angle, teeth, pitchRadius, module) {
      var t = angle * teeth / TAU;
      t = Math.abs(t - Math.round(t));
      var tip = pitchRadius + module;
      var rootR = pitchRadius - module * 1.25;
      if (t < 0.16) return tip;
      if (t > 0.31) return rootR;
      return tip - (tip - rootR) * Math.pow((t - 0.16) / 0.15, 0.9);
    }

    // A point on a gear outline, sampled uniformly along the outline so the
    // steep flanks are as dense as the lands. Writes [r, localAngle].
    var gearPoint = [0, 0];
    function sampleGearOutline(teeth, pitchRadius, module, a, b, c) {
      var pitch = TAU / teeth;
      var tip = pitchRadius + module;
      var rootR = pitchRadius - module * 1.25;
      if (b < 0.44) {
        var angle = a * TAU;
        gearPoint[0] = toothRadius(angle, teeth, pitchRadius, module);
        gearPoint[1] = angle;
      } else {
        var r = rootR + (tip - rootR) * c;
        var t = 0.16 + 0.15 * Math.pow((tip - r) / (tip - rootR), 1 / 0.9);
        gearPoint[0] = r;
        gearPoint[1] = (Math.floor(a * teeth) + (b < 0.72 ? t : -t)) * pitch;
      }
      return gearPoint;
    }

    // ---------------------------------------------------------------------
    // 00 — turbofan fan stage (hero). The rotor turns, the nacelle and outlet
    // guide vanes stay put, and the painted spinner spiral makes the rotation
    // read even at glyph resolution.
    var FAN_BLADES = 18;
    var fan = new Formation({
      unit: 930,
      prefix: "Ø ",
      wind: 0.7,
      rake: 0.4,
      solid: 0.35,
      yaw: -0.12,
      pitch: 0.05,
      zoom: 0.9,
      compactZoom: 0.9,
      build: function (f, i, a, b, c, d) {
        var lane = i % 24;
        var angle;
        var radius;
        if (lane === 23) {
          // Bolt circles: spinner retaining bolts (rotating) and the rear
          // casing flange (static). Each bolt is a tiny ring of samples.
          var boltRing = b < 0.38;
          var bolts = boltRing ? 12 : 36;
          var boltAngle = Math.floor(a * bolts) / bolts * TAU + (boltRing ? 0.13 : 0);
          var pitchR = boltRing ? 0.205 : 1.1;
          var headR = boltRing ? 0.014 : 0.016;
          var bxp = Math.cos(boltAngle) * pitchR + Math.cos(c * TAU) * headR;
          var byp = Math.sin(boltAngle) * pitchR + Math.sin(c * TAU) * headR;
          if (boltRing) put(f, i, 1, Math.sqrt(bxp * bxp + byp * byp), Math.atan2(byp, bxp), -0.012, 0.52);
          else put(f, i, 2, bxp, byp, 0.68, 0.48);
        } else if (lane < 13 || lane > 21) {
          var blade = Math.floor(d * FAN_BLADES);
          var span = 0.27 + 0.73 * Math.sqrt(a);
          var chord = b < 0.3 ? -0.5 : b < 0.6 ? 0.5 : c - 0.5;
          var reach = (span - 0.27) / 0.73;
          put(f, i, 0, span,
            blade / FAN_BLADES * TAU + 0.5 * Math.pow(reach, 1.5) + chord * (0.06 + 0.06 * span),
            -chord * (0.26 - 0.14 * span),
            0.26 + 0.62 * span * span * span + 0.4 * Math.exp(-Math.pow((span - 0.27) / 0.05, 2)));
        } else if (lane < 16) {
          var along = Math.pow(a, 0.8);
          radius = 0.25 * Math.pow(Math.sin(along * Math.PI / 2), 0.75);
          angle = b < 0.55 ? (d < 0.5 ? 0 : Math.PI) + along * 4.4 : c * TAU;
          put(f, i, 1, radius, angle, -0.38 + 0.38 * along, 0.42);
        } else if (lane < 20) {
          angle = c * TAU;
          if (b < 0.48) {
            var minor = d * TAU;
            radius = 1.13 + Math.cos(minor) * 0.055;
            put(f, i, 2, Math.cos(angle) * radius, Math.sin(angle) * radius, -0.17 + Math.sin(minor) * 0.055, 0.46);
          } else if (b < 0.68) {
            put(f, i, 2, Math.cos(angle) * 1.07, Math.sin(angle) * 1.07, 0.68, 0.36);
          } else {
            var panel = Math.floor(d * 18) / 18 * TAU + 0.09;
            radius = 1.17 - 0.1 * a;
            put(f, i, 2, Math.cos(panel) * radius, Math.sin(panel) * radius, -0.12 + 0.8 * a, 0.3);
          }
        } else if (b < 0.7) {
          var vane = Math.floor(d * 14) / 14 * TAU + 0.11;
          radius = 0.5 + 0.56 * a;
          angle = vane + 0.16 * (radius - 0.5);
          put(f, i, 3, Math.cos(angle) * radius, Math.sin(angle) * radius, 0.38 + (c - 0.5) * 0.06, 0.3);
        } else {
          put(f, i, 3, Math.cos(c * TAU) * 0.5, Math.sin(c * TAU) * 0.5, 0.32, 0.34);
        }
      },
      motion: function (f, i, e, out) {
        if (f.part[i] < 2) {
          var r = f.a[i];
          var angle = f.b[i] + e.spin;
          out[0] = Math.cos(angle) * r;
          out[1] = Math.sin(angle) * r;
          out[2] = f.c[i];
        } else {
          out[0] = f.a[i];
          out[1] = f.b[i];
          out[2] = f.c[i];
        }
        out[3] = 1;
        out[4] = f.h[i];
      },
      guides: function (e, g) {
        g.label = "FIG. 00 — TURBOFAN, FAN STAGE";
        g.data = "18 BLADES · N1 " + fmt(e.spinRate * 5400, 0) + " RPM";
        g.chain.push([-1.34, 0, 0, 1.34, 0, 0], [0, -1.34, 0, 0, 1.34, 0], [0, 0, -0.8, 0, 0, 1.1]);
      }
    });

    // ---------------------------------------------------------------------
    // 01 — spur gear train (about). Three gears in true mesh: every phase is
    // solved from the one before, and scrolling the page turns the train.
    var GEAR_MODULE = 0.08;
    var GEARS = (function () {
      var specs = [{ z: 16, w: 0.1, holes: 4 }, { z: 10, w: 0.08, holes: 0 }, { z: 13, w: 0.085, holes: 3 }];
      var i;
      for (i = 0; i < specs.length; i += 1) specs[i].R = GEAR_MODULE * specs[i].z / 2;
      var a12 = -0.36;
      var a23 = 0.98;
      specs[0].x = 0;
      specs[0].y = 0;
      specs[1].x = Math.cos(a12) * (specs[0].R + specs[1].R);
      specs[1].y = Math.sin(a12) * (specs[0].R + specs[1].R);
      specs[2].x = specs[1].x + Math.cos(a23) * (specs[1].R + specs[2].R);
      specs[2].y = specs[1].y + Math.sin(a23) * (specs[1].R + specs[2].R);
      var minX = Infinity;
      var maxX = -Infinity;
      var minY = Infinity;
      var maxY = -Infinity;
      for (i = 0; i < specs.length; i += 1) {
        minX = Math.min(minX, specs[i].x - specs[i].R);
        maxX = Math.max(maxX, specs[i].x + specs[i].R);
        minY = Math.min(minY, specs[i].y - specs[i].R);
        maxY = Math.max(maxY, specs[i].y + specs[i].R);
      }
      for (i = 0; i < specs.length; i += 1) {
        specs[i].x -= (minX + maxX) / 2;
        specs[i].y -= (minY + maxY) / 2;
      }
      // Mesh condition: a tooth of A at angle alpha + delta sits in the gap of
      // B at alpha + PI - delta * zA / zB.
      function mesh(A, B, alpha) {
        var pitchA = TAU / A.z;
        var delta = A.phase - alpha;
        delta -= Math.round(delta / pitchA) * pitchA;
        B.phase = alpha + Math.PI - delta * A.z / B.z - Math.PI / B.z;
        B.dir = -A.dir * A.z / B.z;
      }
      specs[0].phase = 0.05;
      specs[0].dir = 1;
      mesh(specs[0], specs[1], a12);
      mesh(specs[1], specs[2], a23);
      specs.contacts = [
        [specs[0].x + Math.cos(a12) * specs[0].R, specs[0].y + Math.sin(a12) * specs[0].R],
        [specs[1].x + Math.cos(a23) * specs[1].R, specs[1].y + Math.sin(a23) * specs[1].R]
      ];
      return specs;
    })();

    var gears = new Formation({
      unit: 520,
      wind: 0.8,
      rake: 0.45,
      solid: 0.7,
      yaw: 0.12,
      pitch: 0.1,
      zoom: 1,
      shift: -0.03,
      compactZoom: 1.15,
      portrait: true,
      build: function (f, i, a, b, c, d) {
        var lane = i % 24;
        var gi = lane < 11 ? 0 : lane < 17 ? 1 : 2;
        var G = GEARS[gi];
        var face = -G.w;
        var roll = frac(d * 7.31);
        var rootR = G.R - GEAR_MODULE * 1.25;
        var r;
        var angle;
        var z = face;
        var heat = 0.3;
        if (roll < 0.66 || (roll < 0.76 && !G.holes)) {
          sampleGearOutline(G.z, G.R, GEAR_MODULE, a, b, c);
          r = gearPoint[0];
          angle = gearPoint[1];
          if (roll > 0.6) z = -G.w + frac(c * 5.7) * 2 * G.w;
          heat = r < rootR + 0.012 ? 0.46 : 0.3;
        } else if (roll < 0.76) {
          var hole = Math.floor(a * G.holes);
          var holeAngle = hole / G.holes * TAU;
          var holeR = G.R * 0.155;
          var cx = Math.cos(holeAngle) * G.R * 0.6 + Math.cos(b * TAU) * holeR;
          var cy = Math.sin(holeAngle) * G.R * 0.6 + Math.sin(b * TAU) * holeR;
          r = Math.sqrt(cx * cx + cy * cy);
          angle = Math.atan2(cy, cx);
        } else if (roll < 0.79) {
          r = rootR - G.R * 0.1;
          angle = a * TAU;
          heat = 0.24;
        } else if (roll < 0.83) {
          // Hub bolt circle.
          var boltCount = G.holes ? 8 : 6;
          var boltAt = Math.floor(a * boltCount) / boltCount * TAU + 0.2;
          var boltPitch = G.R * (G.holes ? 0.42 : 0.5);
          var hx = Math.cos(boltAt) * boltPitch + Math.cos(b * TAU) * G.R * 0.035;
          var hy = Math.sin(boltAt) * boltPitch + Math.sin(b * TAU) * G.R * 0.035;
          r = Math.sqrt(hx * hx + hy * hy);
          angle = Math.atan2(hy, hx);
          heat = 0.5;
        } else if (roll < 0.91) {
          r = G.R * 0.3;
          angle = a * TAU;
          heat = 0.38;
        } else {
          // Bore with a keyway notch at the top of the hub.
          var bore = G.R * 0.14;
          if (b < 0.7) {
            angle = a * TAU;
            r = bore;
            if (Math.abs(Math.sin(angle / 2 - Math.PI / 4)) < 0.14) r = bore * 1.32;
          } else {
            var side = b < 0.85 ? -1 : 1;
            var kx = side * bore * 0.28;
            var ky = -bore * (0.95 + 0.37 * a);
            r = Math.sqrt(kx * kx + ky * ky);
            angle = Math.atan2(ky, kx);
          }
          heat = 0.44;
        }
        put(f, i, gi, r, angle, z, heat);
      },
      motion: function (f, i, e, out) {
        var G = GEARS[f.part[i]];
        var angle = f.b[i] + G.phase + G.dir * e.gear;
        var r = f.a[i];
        var x = G.x + Math.cos(angle) * r;
        var y = G.y + Math.sin(angle) * r;
        var c0 = GEARS.contacts[0];
        var c1 = GEARS.contacts[1];
        var d0 = (x - c0[0]) * (x - c0[0]) + (y - c0[1]) * (y - c0[1]);
        var d1 = (x - c1[0]) * (x - c1[0]) + (y - c1[1]) * (y - c1[1]);
        out[0] = x;
        out[1] = y;
        out[2] = f.c[i];
        out[3] = 1;
        // Hertzian contact: glyphs pile up where the teeth are in mesh.
        out[4] = f.h[i] + 0.58 * Math.exp(-Math.min(d0, d1) / 0.01);
      },
      guides: function (e, g) {
        var names = ["z 16 · m 4", "z 10", "z 13"];
        var callAngles = [-2.35, -1.25, 0.55];
        g.label = "FIG. 01 — SPUR GEAR TRAIN";
        g.data = "i 1.60 · n1 " + fmt(Math.abs(e.gearRate) * 380, 0) + " RPM";
        g.plot = "mesh";
        for (var k = 0; k < GEARS.length; k += 1) {
          var G = GEARS[k];
          var reach = G.R + GEAR_MODULE * 2.4;
          g.circles.push([G.x, G.y, 0, G.R]);
          g.chain.push([G.x - reach, G.y, 0, G.x + reach, G.y, 0], [G.x, G.y - reach, 0, G.x, G.y + reach, 0]);
          g.callouts.push([
            G.x + Math.cos(callAngles[k]) * (G.R + GEAR_MODULE),
            G.y + Math.sin(callAngles[k]) * (G.R + GEAR_MODULE),
            GEARS[k].w, names[k], k === 0 ? -1 : 1
          ]);
        }
      }
    });

    // ---------------------------------------------------------------------
    // 02 — wing section (projects). A Joukowski airfoil with Kutta
    // circulation: exact potential-flow streamlines are integrated once at
    // load, and particles ride them at the local flow speed — visibly faster
    // over the suction side, exactly as a smoke-pulse tunnel test shows.
    var WING = (function () {
      var lam = 1;
      var mx = -0.09;
      var my = 0.11;
      var radius = Math.sqrt((lam - mx) * (lam - mx) + my * my);
      var alpha = 7 * Math.PI / 180;
      var beta = Math.asin(my / radius);
      var gamma = 4 * Math.PI * radius * Math.sin(alpha + beta);
      var ca = Math.cos(alpha);
      var sa = Math.sin(alpha);
      var vel = [0, 0];

      // Complex velocity u − iv = (dW/dζ) / (dz/dζ), ζ from the inverse map.
      function velocity(zx, zy) {
        var wx = zx * zx - zy * zy - 4 * lam * lam;
        var wy = 2 * zx * zy;
        var m = Math.sqrt(Math.sqrt(wx * wx + wy * wy));
        var half = Math.atan2(wy, wx) / 2;
        var sx = m * Math.cos(half);
        var sy = m * Math.sin(half);
        var z1x = (zx + sx) / 2;
        var z1y = (zy + sy) / 2;
        var z2x = (zx - sx) / 2;
        var z2y = (zy - sy) / 2;
        var d1 = Math.hypot(z1x - mx, z1y - my);
        var d2 = Math.hypot(z2x - mx, z2y - my);
        var zetaX = d1 >= d2 ? z1x : z2x;
        var zetaY = d1 >= d2 ? z1y : z2y;
        if (Math.max(d1, d2) < radius * 1.0005) {
          vel[0] = 0;
          vel[1] = 0;
          return false;
        }
        var qx = zetaX - mx;
        var qy = zetaY - my;
        var qm = qx * qx + qy * qy;
        var q2x = qx * qx - qy * qy;
        var q2y = 2 * qx * qy;
        var q2m = q2x * q2x + q2y * q2y;
        var t1x = radius * radius * (ca * q2x + sa * q2y) / q2m;
        var t1y = radius * radius * (sa * q2x - ca * q2y) / q2m;
        var gx = gamma / (TAU * qm) * qy;
        var gy = gamma / (TAU * qm) * qx;
        var dWx = ca - t1x + gx;
        var dWy = -sa - t1y + gy;
        var s2x = zetaX * zetaX - zetaY * zetaY;
        var s2y = 2 * zetaX * zetaY;
        var s2m = s2x * s2x + s2y * s2y;
        var jx = 1 - lam * lam * s2x / s2m;
        var jy = lam * lam * s2y / s2m;
        var jm = jx * jx + jy * jy;
        var cx = (dWx * jx + dWy * jy) / jm;
        var cy = (dWy * jx - dWx * jy) / jm;
        vel[0] = cx;
        vel[1] = -cy;
        return true;
      }

      function shape(theta, grow) {
        var zx = mx + radius * grow * Math.cos(theta);
        var zy = my + radius * grow * Math.sin(theta);
        var m = zx * zx + zy * zy;
        return [zx + lam * lam * zx / m, zy - lam * lam * zy / m];
      }

      // Airfoil frame → field: rotate the freestream to horizontal, flip y to
      // screen-down, scale to the target chord, centre on mid-chord.
      var minX = Infinity;
      var leTheta = Math.PI;
      for (var k = 0; k < 720; k += 1) {
        var th = k / 720 * TAU;
        var p = shape(th, 1);
        if (p[0] < minX) {
          minX = p[0];
          leTheta = th;
        }
      }
      var chord = 2 * lam - minX;
      var scale = 1.95 / chord;
      var le = shape(leTheta, 1);
      var te = [2 * lam, 0];
      var midX = ((le[0] + te[0]) / 2) * ca + ((le[1] + te[1]) / 2) * sa;
      var midY = -((le[0] + te[0]) / 2) * sa + ((le[1] + te[1]) / 2) * ca;
      function toField(x, y, out) {
        var fx = x * ca + y * sa;
        var fy = -x * sa + y * ca;
        out[0] = (fx - midX) * scale;
        out[1] = -(fy - midY) * scale;
        return out;
      }

      // Streamlines: RK2 from far upstream, stored at equal time steps so a
      // particle stepping through samples at a constant rate moves at the true
      // local speed.
      var lines = [];
      var offsets = [];
      var lengths = [];
      var store = [];
      var tmp = [0, 0];
      var count = 7;
      for (var j = 0; j < count; j += 1) {
        var y0 = -1.05 + 2.1 * j / (count - 1) + 0.07;
        var x = -4.4 * ca - y0 * sa;
        var y = -4.4 * sa + y0 * ca;
        var pts = [];
        var ok = false;
        for (var step = 0; step < 1100; step += 1) {
          if (!velocity(x, y)) break;
          var u1 = vel[0];
          var v1 = vel[1];
          if (!velocity(x + 0.014 * u1, y + 0.014 * v1)) break;
          x += 0.028 * vel[0];
          y += 0.028 * vel[1];
          toField(x, y, tmp);
          pts.push(tmp[0], tmp[1], Math.sqrt(vel[0] * vel[0] + vel[1] * vel[1]));
          if (x * ca + y * sa > 4.6) {
            ok = true;
            break;
          }
        }
        if (ok && pts.length > 30) lines.push(pts);
      }
      for (j = 0; j < lines.length; j += 1) {
        offsets.push(store.length / 3);
        lengths.push(lines[j].length / 3);
        for (k = 0; k < lines[j].length; k += 1) store.push(lines[j][k]);
      }

      var outline = function (theta, out) {
        var pt = shape(theta, 1);
        toField(pt[0], pt[1], out);
        var probe = shape(theta, 1.035);
        velocity(probe[0], probe[1]);
        var speed = Math.sqrt(vel[0] * vel[0] + vel[1] * vel[1]);
        // Pressure contour: stagnation and suction peak both run hot.
        out[2] = 0.3 + 0.52 * Math.max(clamp(1 - speed / 0.55, 0, 1), clamp((speed - 1.05) / 1.1, 0, 1));
        return out;
      };
      var leField = toField(le[0], le[1], [0, 0]);
      var teField = toField(te[0], te[1], [0, 0]);
      var suction = outline(leTheta - 0.55, [0, 0, 0]);

      // Surface envelope in field space (for rib lightening holes) and the
      // pressure distribution Cp = 1 − (V/U)² over the chord, upper and lower.
      var bins = 48;
      var binMinX = Math.min(leField[0], teField[0]);
      var binSpan = Math.abs(teField[0] - leField[0]);
      var upperY = new Float32Array(bins).fill(1e9);
      var lowerY = new Float32Array(bins).fill(-1e9);
      var cpUpper = [];
      var cpLower = [];
      var probePoint = [0, 0, 0];
      for (k = 0; k <= 400; k += 1) {
        var sweep = -beta + k / 400 * TAU;
        outline(sweep, probePoint);
        var bin = Math.floor((probePoint[0] - binMinX) / binSpan * bins);
        if (bin >= 0 && bin < bins) {
          if (probePoint[1] < upperY[bin]) upperY[bin] = probePoint[1];
          if (probePoint[1] > lowerY[bin]) lowerY[bin] = probePoint[1];
        }
        if (k % 5 === 0) {
          var surf = shape(sweep, 1);
          var near = shape(sweep, 1.012);
          velocity(near[0], near[1]);
          var cp = clamp(1 - (vel[0] * vel[0] + vel[1] * vel[1]), -3.2, 1);
          var xc = clamp((surf[0] - minX) / chord, 0, 1);
          if (sweep < leTheta) cpUpper.push(xc, cp);
          else cpLower.push(xc, cp);
        }
      }
      function envelope(fraction, out) {
        var bin = clamp(Math.round(fraction * (bins - 1)), 0, bins - 1);
        out[0] = binMinX + (bin + 0.5) / bins * binSpan;
        out[1] = upperY[bin];
        out[2] = lowerY[bin];
        return out;
      }
      return {
        data: new Float32Array(store),
        offsets: offsets,
        lengths: lengths,
        count: lines.length,
        outline: outline,
        leTheta: leTheta,
        teTheta: -beta,
        le: leField,
        te: teField,
        suction: suction,
        envelope: envelope,
        cpUpper: cpUpper,
        cpLower: cpLower,
        cl: 2 * gamma / chord,
        alphaDeg: 7
      };
    })();

    // Drawn like an extruded section sketch: the root rib nearest the viewer
    // carries a dense, crisp section outline; a mid rib and the tip rib sit
    // back, offset up and away so no outline crosses another, tied together
    // by the leading edge, trailing edge and spar caps. The streamlines wrap
    // the root section in its own plane, as in a section plot.
    var WING_SPAN = 0.4;
    var WING_RIBS = 3;
    var WING_ROOT = -WING_SPAN;
    var wing = new Formation({
      unit: 640,
      wind: 1,
      rake: 0,
      shift: -0.1,
      compactZoom: 0.95,
      yaw: 0.32,
      pitch: 0.18,
      drift: 0.25,
      haze: 0.4,
      tracerStroke: true,
      build: function (f, i, a, b, c, d) {
        var lane = i % 24;
        var pt = [0, 0, 0];
        if (lane < 11) {
          var station = lane < 7 ? 0 : 1 + Math.floor(d * (WING_RIBS - 1));
          var ribZ = WING_ROOT + station * (WING_SPAN * 2 / (WING_RIBS - 1));
          if (frac(d * 13) < 0.2) {
            // Lightening holes through each rib, sized to the local depth.
            var holeAt = [0.3, 0.48, 0.66][Math.floor(frac(d * 29) * 3)];
            WING.envelope(holeAt, pt);
            var holeR = (pt[2] - pt[1]) * 0.3;
            put(f, i, 0, pt[0] + Math.cos(a * TAU) * holeR, (pt[1] + pt[2]) / 2 + Math.sin(a * TAU) * holeR, ribZ, 0.42);
          } else {
            WING.outline(a * TAU, pt);
            put(f, i, 0, pt[0], pt[1], ribZ, station === 0 ? pt[2] + 0.12 : pt[2] * 0.7);
          }
        } else if (lane < 13) {
          // Spanwise members: leading and trailing edge, then the upper and
          // lower caps of the front (30 % c) and rear (68 % c) spars.
          var member = Math.floor(d * 6);
          var z = WING_ROOT + a * WING_SPAN * 2;
          if (member < 2) {
            WING.outline(member === 0 ? WING.leTheta : WING.teTheta, pt);
            put(f, i, 0, pt[0], pt[1], z, 0.5);
          } else {
            WING.envelope(member < 4 ? 0.3 : 0.68, pt);
            put(f, i, 0, pt[0], member % 2 ? pt[2] : pt[1], z, 0.4);
          }
        } else if (lane < 22) {
          put(f, i, 1, Math.floor(d * WING.count), b, WING_ROOT + (c - 0.5) * 0.06, 0.3);
        } else {
          put(f, i, 2, a, b * TAU, 0, 0.5);
        }
      },
      motion: function (f, i, e, out) {
        var part = f.part[i];
        if (part === 0) {
          out[0] = f.a[i];
          out[1] = f.b[i];
          out[2] = f.c[i];
          out[3] = 1;
          out[4] = f.h[i];
          return;
        }
        if (part === 1) {
          var line = f.a[i];
          var length = WING.lengths[line];
          var cursor = f.b[i] * length + e.flow * 88;
          cursor -= Math.floor(cursor / length) * length;
          var k = Math.floor(cursor);
          var t = cursor - k;
          var next = k + 1 < length ? k + 1 : k;
          var base = (WING.offsets[line] + k) * 3;
          var nextBase = (WING.offsets[line] + next) * 3;
          var data = WING.data;
          var speed = data[base + 2];
          out[0] = data[base] + (data[nextBase] - data[base]) * t;
          out[1] = data[base + 1] + (data[nextBase + 1] - data[base + 1]) * t;
          out[2] = f.c[i];
          out[3] = (1 - band(1.25, 1.6, Math.abs(out[0]))) * 0.72;
          out[4] = 0.22 + 0.55 * clamp((speed - 0.75) / 1.0, 0, 1);
          out[5] = 1;
          return;
        }
        // Tip vortex: a helix shed from the wing tip, growing downstream.
        var s = frac(f.a[i] + e.flow * 0.22);
        var r = 0.028 + 0.075 * s;
        var angle = s * 26 - e.flow * 7 + f.b[i];
        out[0] = WING.te[0] + s * 1.55;
        out[1] = WING.te[1] + 0.12 * s + Math.cos(angle) * r;
        out[2] = WING_SPAN + 0.02 + Math.sin(angle) * r;
        out[3] = band(0, 0.08, s) * (1 - band(0.75, 1, s));
        out[4] = 0.62 - 0.3 * s;
        out[5] = 1;
      },
      guides: function (e, g) {
        var le = WING.le;
        var te = WING.te;
        var dx = te[0] - le[0];
        var dy = te[1] - le[1];
        var len = Math.sqrt(dx * dx + dy * dy);
        g.label = "FIG. 02 — WING SECTION, POTENTIAL FLOW";
        g.data = "JOUKOWSKI · KUTTA · CL " + WING.cl.toFixed(2);
        var z = WING_ROOT;
        // Chord line, angle of attack and callouts sit on the root rib.
        g.chain.push([le[0] - dx / len * 0.2, le[1] - dy / len * 0.2, z, te[0] + dx / len * 0.3, te[1] + dy / len * 0.3, z]);
        g.chain.push([le[0], le[1], WING_ROOT - 0.12, le[0], le[1], WING_SPAN + 0.12]);
        g.thin.push([le[0], le[1], z, le[0] + 0.95, le[1], z]);
        g.arcs.push([le[0], le[1], z, 0.78, 0, Math.atan2(dy, dx), WING.alphaDeg + "°"]);
        g.callouts.push([le[0], le[1], z, "STAGNATION PT", -1]);
        g.plot = "cp";
        g.callouts.push([WING.suction[0], WING.suction[1], z, "SUCTION PEAK", 1]);
      }
    });

    // ---------------------------------------------------------------------
    // 03 — drive shaft assembly, exploded (drawings). Parts slide apart along
    // the chain-line axis and back together, the key pops out of its seat,
    // and ballooned leaders track every part like an assembly drawing.
    var SHAFT_SEGS = [[-1.1, -0.86, 0.1], [-0.86, -0.2, 0.15], [-0.2, -0.05, 0.2], [-0.05, 0.74, 0.15], [0.74, 1.1, 0.12]];
    var SHAFT_STEPS = [-0.86, -0.2, -0.05, 0.74];
    // [assembled centre x, top radius, explode dx, explode dy]
    var SHAFT_PARTS = [
      [0, 0.2, 0, 0],
      [-0.97, 0.19, -0.46, 0],
      [-0.64, 0.3, -0.26, 0],
      [0.06, 0.42, 0.2, 0],
      [0.385, 0.19, 0.36, 0],
      [0.67, 0.3, 0.54, 0],
      [0.99, 0.34, 0.74, 0],
      [0.06, 0.2, 0, -0.38]
    ];
    var BALL_COUNT = 9;

    function shaftRadius(x) {
      for (var k = 0; k < SHAFT_SEGS.length; k += 1) {
        if (x <= SHAFT_SEGS[k][1]) return SHAFT_SEGS[k][2];
      }
      return SHAFT_SEGS[SHAFT_SEGS.length - 1][2];
    }

    function ringPoint(f, i, part, x, r, angle, heat) {
      put(f, i, part, x, Math.cos(angle) * r, Math.sin(angle) * r, heat);
    }

    function bearingPoint(f, i, part, cx, a, b, c, d) {
      if (d < 0.3) {
        ringPoint(f, i, part, cx + (b < 0.5 ? -0.065 : 0.065), c < 0.5 ? 0.3 : 0.262, a * TAU, 0.3);
      } else if (d < 0.55) {
        ringPoint(f, i, part, cx + (b < 0.5 ? -0.065 : 0.065), c < 0.5 ? 0.155 : 0.19, a * TAU, 0.3);
      } else {
        var ball = Math.floor(a * BALL_COUNT) / BALL_COUNT * TAU;
        var theta = b * TAU;
        var phi = Math.acos(1 - 2 * c);
        var br = 0.035;
        var by = Math.cos(ball) * 0.226 + Math.sin(phi) * Math.cos(theta) * br;
        var bz = Math.sin(ball) * 0.226 + Math.sin(phi) * Math.sin(theta) * br;
        put(f, i, part, cx + Math.cos(phi) * br, by, bz, 0.56);
      }
    }

    var shaft = new Formation({
      unit: 180,
      wind: 0.6,
      rake: 0.35,
      solid: 0.6,
      yaw: 0.4,
      pitch: 0.26,
      zoom: 1.08,
      compactZoom: 1.1,
      portrait: true,
      build: function (f, i, a, b, c, d) {
        var lane = i % 24;
        var x;
        var angle;
        if (lane < 6) {
          if (d < 0.55) {
            x = -1.1 + a * 2.2;
            angle = Math.floor(b * 10) / 10 * TAU;
            var near = 9;
            for (var k = 0; k < SHAFT_STEPS.length; k += 1) near = Math.min(near, Math.abs(x - SHAFT_STEPS[k]));
            ringPoint(f, i, 0, x, shaftRadius(x), angle, 0.3 + 0.55 * Math.exp(-near * near / 0.0016));
          } else if (d < 0.82) {
            var edges = [-1.1, -0.86, -0.86, -0.2, -0.2, -0.05, -0.05, 0.74, 0.74, 1.1];
            var radii = [0.1, 0.1, 0.15, 0.15, 0.2, 0.2, 0.15, 0.15, 0.12, 0.12];
            var pick = Math.floor(b * edges.length);
            ringPoint(f, i, 0, edges[pick], radii[pick], a * TAU, 0.36);
          } else {
            x = -1.1 + a * 0.24;
            ringPoint(f, i, 0, x, 0.1, x / 0.03 * TAU, 0.33);
          }
        } else if (lane < 8) {
          var cx = SHAFT_PARTS[1][0];
          if (d < 0.7) {
            var corner = Math.floor(a * 6);
            var t = frac(a * 6);
            var a0 = corner / 6 * TAU;
            var a1 = (corner + 1) / 6 * TAU;
            var hy = 0.19 * (Math.cos(a0) + (Math.cos(a1) - Math.cos(a0)) * t);
            var hz = 0.19 * (Math.sin(a0) + (Math.sin(a1) - Math.sin(a0)) * t);
            put(f, i, 1, cx + (b < 0.5 ? -0.05 : 0.05), hy, hz, 0.33);
          } else if (d < 0.85) {
            var edge = Math.floor(b * 6) / 6 * TAU;
            put(f, i, 1, cx - 0.05 + a * 0.1, Math.cos(edge) * 0.19, Math.sin(edge) * 0.19, 0.33);
          } else {
            ringPoint(f, i, 1, cx + (b < 0.5 ? -0.05 : 0.05), 0.1, a * TAU, 0.29);
          }
        } else if (lane < 11) {
          bearingPoint(f, i, 2, SHAFT_PARTS[2][0], a, b, c, d);
        } else if (lane < 16) {
          var gx = SHAFT_PARTS[3][0];
          if (d < 0.7) {
            sampleGearOutline(18, 0.4, 0.0444, a, b, c);
            ringPoint(f, i, 3, gx + (d < 0.35 ? -0.11 : 0.11), gearPoint[0], gearPoint[1], 0.40);
          } else if (d < 0.82) {
            sampleGearOutline(18, 0.4, 0.0444, a, 0.2, c);
            ringPoint(f, i, 3, gx - 0.11 + b * 0.22, gearPoint[0], gearPoint[1], 0.36);
          } else {
            ringPoint(f, i, 3, gx + (b < 0.5 ? -0.11 : 0.11), c < 0.5 ? 0.22 : 0.15, a * TAU, 0.29);
          }
        } else if (lane < 18) {
          if (d < 0.6) ringPoint(f, i, 4, b < 0.5 ? 0.17 : 0.6, c < 0.5 ? 0.19 : 0.155, a * TAU, 0.26);
          else ringPoint(f, i, 4, 0.17 + a * 0.43, 0.19, Math.floor(b * 6) / 6 * TAU, 0.24);
        } else if (lane < 21) {
          bearingPoint(f, i, 5, SHAFT_PARTS[5][0], a, b, c, d);
        } else if (lane < 23) {
          var capX = SHAFT_PARTS[6][0] + (b < 0.5 ? -0.03 : 0.03);
          if (d < 0.5) ringPoint(f, i, 6, capX, 0.34, a * TAU, 0.30);
          else if (d < 0.75) ringPoint(f, i, 6, capX, 0.13, a * TAU, 0.33);
          else {
            var bolt = Math.floor(a * 4) / 4 * TAU + Math.PI / 4;
            put(f, i, 6, capX, Math.cos(bolt) * 0.25 + Math.cos(c * TAU) * 0.035,
              Math.sin(bolt) * 0.25 + Math.sin(c * TAU) * 0.035, 0.42);
          }
        } else {
          // Feather key: the twelve edges of a box sitting in the gear seat.
          var e12 = Math.floor(a * 12);
          var u = b;
          var kx0 = -0.02;
          var kx1 = 0.14;
          var ky0 = -0.125;
          var ky1 = -0.205;
          var kz = 0.032;
          var px;
          var py;
          var pz;
          if (e12 < 4) {
            px = kx0 + (kx1 - kx0) * u;
            py = e12 & 1 ? ky1 : ky0;
            pz = e12 & 2 ? kz : -kz;
          } else if (e12 < 8) {
            px = e12 & 1 ? kx1 : kx0;
            py = ky0 + (ky1 - ky0) * u;
            pz = e12 & 2 ? kz : -kz;
          } else {
            px = e12 & 1 ? kx1 : kx0;
            py = e12 & 2 ? ky1 : ky0;
            pz = -kz + 2 * kz * u;
          }
          put(f, i, 7, px, py, pz, 0.43);
        }
      },
      motion: function (f, i, e, out) {
        var off = SHAFT_PARTS[f.part[i]];
        var x = f.a[i] + off[2] * e.explode;
        var y = f.b[i] + off[3] * e.explode;
        var z = f.c[i];
        var ry = y * e.shaftCos - z * e.shaftSin;
        out[0] = x;
        out[1] = ry;
        out[2] = y * e.shaftSin + z * e.shaftCos;
        out[3] = 1;
        out[4] = f.h[i];
      },
      frame: function (e) {
        // Mostly exploded, with a brief reassembly every cycle.
        var cycle = 0.5 - 0.5 * Math.cos(e.slow * 0.9);
        e.explode = band(0.04, 0.5, cycle);
        e.shaftCos = Math.cos(e.spin * 0.22);
        e.shaftSin = Math.sin(e.spin * 0.22);
      },
      guides: function (e, g) {
        g.label = "FIG. 03 — DRIVE SHAFT, EXPLODED VIEW";
        g.data = "7 PARTS · BEARING SEAT Ø30 k6";
        g.chain.push([-1.62, 0, 0, 1.86, 0, 0]);
        for (var k = 1; k < SHAFT_PARTS.length; k += 1) {
          var p = SHAFT_PARTS[k];
          var ax = p[0] + p[2] * e.explode;
          var ay = -p[1] + p[3] * e.explode;
          g.balloons.push([ax, ay, 0, ax, ay - 0.3 - (k % 2) * 0.15, String(k)]);
        }
      }
    });

    // ---------------------------------------------------------------------
    // 04 — terrain survey flyover (aerial). A digital elevation model streams
    // toward the viewer; contour intervals render as bold glyph isolines and a
    // survey line sweeps across the swath.
    var TER_COLS = Math.max(26, Math.round(Math.sqrt(particleCount * 1.9)));
    var TER_ROWS = Math.ceil(particleCount / TER_COLS);
    var TER_DEPTH = 2.8;

    function lattice(x, y) {
      return fastHash(Math.imul(x, 73856093) ^ Math.imul(y, 19349663));
    }

    function valueNoise(x, y) {
      var xi = Math.floor(x);
      var yi = Math.floor(y);
      var xf = x - xi;
      var yf = y - yi;
      var u = xf * xf * (3 - 2 * xf);
      var v = yf * yf * (3 - 2 * yf);
      var n00 = lattice(xi, yi);
      var n10 = lattice(xi + 1, yi);
      var n01 = lattice(xi, yi + 1);
      var n11 = lattice(xi + 1, yi + 1);
      return n00 + (n10 - n00) * u + (n01 - n00) * v + (n00 - n10 - n01 + n11) * u * v;
    }

    function terrainHeight(x, s) {
      var n = valueNoise(x * 1.05 + 11.3, s * 1.05) * 0.5 +
        valueNoise(x * 2.1 + 3.7, s * 2.1 + 5.1) * 0.25 +
        valueNoise(x * 4.2 - 7.9, s * 4.2 + 1.3) * 0.125 +
        valueNoise(x * 8.4 + 2.2, s * 8.4 - 3.3) * 0.0625;
      var h = Math.pow(n / 0.9375, 1.8) * 1.35;
      var river = x - Math.sin(s * 0.62) * 0.7;
      return h * (1 - 0.75 * Math.exp(-river * river / 0.05));
    }

    var terrain = new Formation({
      wind: 0.45,
      rake: 0,
      solid: 0,
      dims: false,
      zoom: 1.08,
      anchorY: 0.46,
      build: function (f, i) {
        var col = i % TER_COLS;
        var row = Math.floor(i / TER_COLS);
        put(f, i, 0, (col / (TER_COLS - 1) - 0.5) * 3.4, (row + 0.5) / TER_ROWS * TER_DEPTH, 0, 0.3);
      },
      motion: function (f, i, e, out) {
        var x = f.a[i];
        var depth = f.b[i] - e.fly;
        depth -= Math.floor(depth / TER_DEPTH) * TER_DEPTH;
        var h = terrainHeight(x, depth + e.fly);
        var z = depth - TER_DEPTH * 0.36;
        var contour = frac(h * 10);
        var scan = Math.exp(-Math.pow((x - e.scan) / 0.05, 2));
        out[0] = x;
        out[1] = 0.66 - h * 0.5 - z * 0.34;
        out[2] = z;
        out[3] = band(0, 0.5, depth) * (1 - band(TER_DEPTH - 0.6, TER_DEPTH, depth));
        out[4] = (contour < 0.14 || contour > 0.94 ? 0.86 : 0.14 + h * 0.22) + scan * 0.45;
      },
      frame: function (e) {
        e.scan = Math.sin(e.slow * 0.7) * 1.45;
      },
      guides: function (e, g) {
        g.label = "FIG. 04 — TERRAIN SURVEY, DEM FLYOVER";
        g.data = "AGL 120 M · GSD 3.1 CM · CONTOURS 10 M";
        g.plot = "profile";
      }
    });

    // ---------------------------------------------------------------------
    // 05 — three-axis gyroscope (certifications). Outer, middle and inner
    // gimbals turn on alternating axes around a flywheel spinning at speed:
    // three nested gimbals for three credentials, the rotor at their core.
    var GYRO_S = 0.8;
    var GYRO_Y = -0.12;
    var GY = new Float32Array(8);

    function gyroTransform(part, x, y, z, out) {
      var t;
      if (part === 3) {
        t = y * GY[7] - z * GY[6];
        z = y * GY[6] + z * GY[7];
        y = t;
      }
      if (part === 2 || part === 3) {
        t = x * GY[5] + z * GY[4];
        z = -x * GY[4] + z * GY[5];
        x = t;
      }
      if (part >= 1 && part <= 3) {
        t = y * GY[3] - z * GY[2];
        z = y * GY[2] + z * GY[3];
        y = t;
      }
      if (part <= 3) {
        t = x * GY[1] + z * GY[0];
        z = -x * GY[0] + z * GY[1];
        x = t;
      }
      out[0] = x * GYRO_S;
      out[1] = y * GYRO_S + GYRO_Y;
      out[2] = z * GYRO_S;
    }

    function gimbalRing(f, i, part, outer, inner, thick, a, b, heat) {
      var r = b < 0.5 ? outer : inner;
      var z = frac(b * 4) < 0.5 ? thick : -thick;
      put(f, i, part, Math.cos(a * TAU) * r, Math.sin(a * TAU) * r, z, heat);
    }

    var gyro = new Formation({
      unit: 380,
      wind: 0.6,
      rake: 0.35,
      solid: 0.5,
      yaw: 0.2,
      pitch: 0.1,
      zoom: 0.95,
      compactZoom: 1.1,
      build: function (f, i, a, b, c, d) {
        var lane = i % 24;
        if (lane < 5) {
          if (d < 0.86) gimbalRing(f, i, 0, 1, 0.92, 0.04, a, b, 0.4);
          else put(f, i, 0, (b < 0.5 ? -1 : 1) * (0.82 + a * 0.1), 0, 0, 0.66);
        } else if (lane < 9) {
          if (d < 0.86) gimbalRing(f, i, 1, 0.82, 0.75, 0.035, a, b, 0.42);
          else put(f, i, 1, 0, (b < 0.5 ? -1 : 1) * (0.66 + a * 0.09), 0, 0.66);
        } else if (lane < 12) {
          if (d < 0.78) gimbalRing(f, i, 2, 0.66, 0.6, 0.03, a, b, 0.44);
          else put(f, i, 2, -0.6 + a * 1.2, 0, 0, 0.5);
        } else if (lane < 18) {
          if (d < 0.62) {
            put(f, i, 3, b < 0.5 ? -0.05 : 0.05, Math.cos(a * TAU) * (c < 0.55 ? 0.44 : 0.38),
              Math.sin(a * TAU) * (c < 0.55 ? 0.44 : 0.38), 0.84);
          } else if (d < 0.8) {
            var spoke = Math.floor(b * 6) / 6 * TAU;
            var sr = 0.09 + a * 0.29;
            put(f, i, 3, 0, Math.cos(spoke) * sr, Math.sin(spoke) * sr, 0.5);
          } else {
            put(f, i, 3, (b < 0.5 ? -0.07 : 0.07), Math.cos(a * TAU) * 0.09, Math.sin(a * TAU) * 0.09, 0.56);
          }
        } else {
          // Stand: post under the outer pivot and a turned base.
          if (d < 0.3) put(f, i, 4, (c - 0.5) * 0.03, 1 + a * 0.34, (b - 0.5) * 0.03, 0.34);
          else if (d < 0.8) {
            var br = b < 0.5 ? 0.5 : 0.4;
            put(f, i, 4, Math.cos(a * TAU) * br, c < 0.5 ? 1.36 : 1.44, Math.sin(a * TAU) * br, 0.28);
          } else put(f, i, 4, (c - 0.5) * 0.03, -1 - a * 0.1, (b - 0.5) * 0.03, 0.4);
        }
      },
      motion: function (f, i, e, out) {
        gyroTransform(f.part[i], f.a[i], f.b[i], f.c[i], out);
        out[3] = 1;
        out[4] = f.h[i];
      },
      frame: function (e) {
        var o = 0.3 + e.slow * 0.36;
        var m = 1.1 + e.slow * 0.62;
        var n = 0.4 + e.slow * 0.95;
        var r = e.spin * 5.2;
        GY[0] = Math.sin(o);
        GY[1] = Math.cos(o);
        GY[2] = Math.sin(m);
        GY[3] = Math.cos(m);
        GY[4] = Math.sin(n);
        GY[5] = Math.cos(n);
        GY[6] = Math.sin(r);
        GY[7] = Math.cos(r);
      },
      guides: function (e, g) {
        var rim = [0, 0, 0];
        var ring = [0, 0, 0];
        gyroTransform(3, 0, 0.44, 0, rim);
        gyroTransform(0, 0.96, 0, 0, ring);
        g.label = "FIG. 05 — THREE-AXIS GYROSCOPE";
        g.data = "3 GIMBALS + ROTOR · PRECESSION " + (0.36 * (1 + scrollEnergy)).toFixed(2) + " RAD/S";
        g.chain.push([0, -1.22 * GYRO_S + GYRO_Y, 0, 0, 1.52 * GYRO_S + GYRO_Y, 0],
          [-1.12 * GYRO_S, GYRO_Y, 0, 1.12 * GYRO_S, GYRO_Y, 0]);
        g.callouts.push([rim[0], rim[1], rim[2], "ROTOR 12 000 RPM", 1]);
        g.callouts.push([ring[0], ring[1], ring[2], "OUTER GIMBAL", -1]);
      }
    });

    // ---------------------------------------------------------------------
    // 06 — ground-station dish (contact). A paraboloid on an az-el mount slews
    // slowly while plane wavefronts leave the aperture along the boresight.
    var DISH_R = 0.86;
    var DISH_F = 0.42;
    var DISH_SUB = 0.13;
    var DB = new Float32Array(12);

    function dishPoint(x, y, z, out) {
      out[0] = DB[9] + DB[0] * x + DB[3] * y + DB[6] * z;
      out[1] = DB[10] + DB[1] * x + DB[4] * y + DB[7] * z;
      out[2] = DB[11] + DB[2] * x + DB[5] * y + DB[8] * z;
    }

    var dish = new Formation({
      unit: 2100,
      prefix: "Ø ",
      wind: 0.8,
      rake: 0.35,
      solid: 0.6,
      yaw: -0.08,
      pitch: 0.06,
      zoom: 0.96,
      compactZoom: 1,
      build: function (f, i, a, b, c, d) {
        var lane = i % 24;
        var r;
        var angle;
        if (lane < 9) {
          if (d < 0.56) {
            r = (Math.floor(b * 8) + 1) / 8 * DISH_R;
            angle = a * TAU;
          } else {
            r = Math.sqrt(a) * DISH_R;
            angle = Math.floor(b * 24) / 24 * TAU;
          }
          put(f, i, 0, Math.cos(angle) * r, Math.sin(angle) * r, r * r / (4 * DISH_F), 0.3 + 0.32 * Math.pow(r / DISH_R, 2));
        } else if (lane < 11) {
          var minor = b * TAU;
          r = DISH_R + Math.cos(minor) * 0.02;
          put(f, i, 0, Math.cos(a * TAU) * r, Math.sin(a * TAU) * r,
            DISH_R * DISH_R / (4 * DISH_F) + Math.sin(minor) * 0.02, 0.56);
        } else if (lane < 14) {
          // Cassegrain optics: feed horn at the vertex, convex subreflector
          // near the prime focus on a quadripod.
          if (d < 0.22) {
            r = 0.035 + a * 0.045;
            put(f, i, 0, Math.cos(b * TAU) * r, Math.sin(b * TAU) * r, 0.02 + a * 0.18, 0.9);
          } else if (d < 0.5) {
            r = b < 0.5 ? DISH_SUB : DISH_SUB * Math.sqrt(a);
            put(f, i, 0, Math.cos(c * TAU) * r, Math.sin(c * TAU) * r, DISH_F - 0.03 - r * r * 1.6, 0.86);
          } else {
            var strut = Math.floor(b * 4) / 4 * TAU + Math.PI / 4;
            var sx = Math.cos(strut) * DISH_R;
            var sy = Math.sin(strut) * DISH_R;
            var sz = DISH_R * DISH_R / (4 * DISH_F);
            var tx = Math.cos(strut) * DISH_SUB;
            var ty = Math.sin(strut) * DISH_SUB;
            put(f, i, 0, sx + (tx - sx) * a, sy + (ty - sy) * a, sz + (DISH_F - 0.03 - sz) * a, 0.44);
          }
        } else if (lane < 15) {
          put(f, i, 0, Math.cos(a * TAU) * 0.16, Math.sin(a * TAU) * 0.16, -0.02 - b * 0.14, 0.34);
        } else if (lane < 17) {
          put(f, i, 1, a, b, c, 0.28);
        } else {
          put(f, i, 2, frac(Math.floor(d * 5) / 5 + (a - 0.5) * 0.012), b, c * TAU, 0.7);
        }
      },
      motion: function (f, i, e, out) {
        var part = f.part[i];
        if (part === 0) {
          dishPoint(f.a[i], f.b[i], f.c[i], out);
          out[3] = 1;
          out[4] = f.h[i];
          return;
        }
        if (part === 1) {
          // Pedestal: column from the elevation axle to a turned base.
          var jx = DB[9] - DB[6] * 0.2;
          var jz = DB[11] - DB[8] * 0.2;
          var jy = DB[10] - DB[7] * 0.2 + 0.1;
          if (f.b[i] < 0.55) {
            out[0] = jx + (f.c[i] - 0.5) * 0.05;
            out[1] = jy + (1.12 - jy) * f.a[i];
            out[2] = jz + (frac(f.c[i] * 7) - 0.5) * 0.05;
          } else {
            var br = f.b[i] < 0.8 ? 0.34 : 0.26;
            out[0] = jx + Math.cos(f.a[i] * TAU) * br;
            out[1] = 1.14;
            out[2] = jz + Math.sin(f.a[i] * TAU) * br;
          }
          out[3] = 1;
          out[4] = 0.28;
          return;
        }
        // Plane wavefronts leaving the aperture along the boresight.
        var s = frac(f.a[i] + e.flow * 0.3);
        var reach = DISH_F + s * 2.3;
        var radius = DISH_R * (0.92 + 0.22 * s) * (f.b[i] < 0.72 ? 1 : Math.sqrt(frac(f.b[i] * 13)));
        dishPoint(Math.cos(f.c[i]) * radius, Math.sin(f.c[i]) * radius, reach, out);
        out[3] = band(0, 0.06, s) * Math.pow(1 - s, 1.1);
        out[4] = 0.78 * (1 - s * 0.6);
        out[5] = 1;
      },
      frame: function (e) {
        var az = -0.5 + Math.sin(e.slow * 0.45) * 0.2;
        var el = 0.52 + Math.sin(e.slow * 0.31) * 0.06;
        var fx = Math.sin(az) * Math.cos(el);
        var fy = -Math.sin(el);
        var fz = -Math.cos(az) * Math.cos(el);
        var rx = fz;
        var rz = -fx;
        var rl = Math.sqrt(rx * rx + rz * rz) || 1;
        rx /= rl;
        rz /= rl;
        var ux = fy * rz;
        var uy = fz * rx - fx * rz;
        var uz = -fy * rx;
        DB[0] = rx; DB[1] = 0; DB[2] = rz;
        DB[3] = ux; DB[4] = uy; DB[5] = uz;
        DB[6] = fx; DB[7] = fy; DB[8] = fz;
        DB[9] = 0.12; DB[10] = 0.12; DB[11] = 0.2;
        e.dishAz = az;
      },
      guides: function (e, g) {
        var v = [0, 0, 0];
        var far = [0, 0, 0];
        var rim = [0, 0, 0];
        var feed = [0, 0, 0];
        dishPoint(0, 0, 0, v);
        dishPoint(0, 0, 2.7, far);
        dishPoint(DISH_R, 0, DISH_R * DISH_R / (4 * DISH_F), rim);
        dishPoint(0, 0, DISH_F - 0.03, feed);
        g.label = "FIG. 06 — GROUND STATION, OPEN CHANNEL";
        g.data = "X-BAND 8.4 GHZ · AZ " + fmt(200 + e.dishAz * 57.3, 1) + "°";
        g.chain.push([v[0], v[1], v[2], far[0], far[1], far[2]]);
        g.callouts.push([rim[0], rim[1], rim[2], "f/D 0.24", 1]);
        g.plot = "beam";
        g.callouts.push([feed[0], feed[1], feed[2], "SUBREFLECTOR", -1]);
      }
    });

    // ---------------------------------------------------------------------
    // Opening — thrust chamber assembly, then ignition. Both share every
    // hardware particle, so the engine holds perfectly still while the plume
    // particles blast out of the chamber and settle into shock diamonds.
    // Engine space: axial coordinate y (throat 0, exit 0.95), radial x/z.
    // Field space puts the axis horizontal — a test-stand firing, plume
    // running out along the freestream.
    var ENG_S = 0.64;
    var ENG_Y = -1.17;
    var ENG_RT = 0.11;
    var ENG_RE = 0.5;
    var ENG_RC = 0.25;
    var ENG_EXIT = 0.95;
    var ENG_PUMP = [0.54, -0.6, 0.14];
    var ENG_PLUME = 3.3;

    function engineToField(rx, axial, rz, out) {
      out[0] = (axial + ENG_Y) * ENG_S;
      out[1] = -rx * ENG_S;
      out[2] = rz * ENG_S;
      return out;
    }

    function nozzleRadius(s) {
      return ENG_RT + (ENG_RE - ENG_RT) * (1 - Math.pow(1 - s, 2.3));
    }

    function chamberRadius(y) {
      if (y <= -0.28) return ENG_RC;
      var t = (y + 0.28) / 0.28;
      return ENG_RT + (ENG_RC - ENG_RT) * (0.5 + 0.5 * Math.cos(t * Math.PI));
    }

    function bezier(p0, p1, p2, t, k) {
      var u = 1 - t;
      return u * u * p0[k] + 2 * u * t * p1[k] + t * t * p2[k];
    }

    function buildEngine(f, i, a, b, c, d) {
      var lane = i % 24;
      var angle;
      var r;
      var y;
      if (lane < 5) {
        var s;
        if (b < 0.5) {
          angle = Math.floor(d * 12) / 12 * TAU;
          s = a;
        } else {
          s = Math.floor(c * 6) / 5;
          angle = a * TAU;
        }
        r = nozzleRadius(s) + 0.006;
        put(f, i, 0, Math.cos(angle) * r, s * ENG_EXIT, Math.sin(angle) * r, 0.2 + 0.6 * Math.exp(-s * 6));
      } else if (lane < 7) {
        if (b < 0.55) {
          angle = Math.floor(d * 8) / 8 * TAU;
          y = -0.72 + a * 0.72;
        } else {
          angle = a * TAU;
          y = -0.72 + Math.floor(c * 5) / 4 * 0.72;
        }
        r = chamberRadius(y);
        put(f, i, 0, Math.cos(angle) * r, y, Math.sin(angle) * r, 0.3 + 0.45 * band(-0.3, 0, y));
      } else if (lane < 8) {
        r = ENG_RC * Math.sqrt(a);
        angle = c * TAU;
        put(f, i, 0, Math.cos(angle) * r, -0.72 - 0.15 * Math.sqrt(Math.max(0, 1 - (r / ENG_RC) * (r / ENG_RC))),
          Math.sin(angle) * r, 0.42);
      } else if (lane < 9) {
        if (b < 0.42) {
          var strut = Math.floor(d * 4) * Math.PI / 2 + Math.PI / 4;
          put(f, i, 0, Math.cos(strut) * 0.2 * (1 - a), -0.8 - 0.3 * a, Math.sin(strut) * 0.2 * (1 - a), 0.32);
        } else if (b < 0.62) {
          // Gimbal actuators: cylinder body, then the rod, from the thrust
          // frame to lugs on the chamber — one in each gimbal plane.
          var pitchPlane = d < 0.5;
          var ax0 = pitchPlane ? -0.46 : 0;
          var az0 = pitchPlane ? 0 : 0.46;
          var ax1 = pitchPlane ? -0.27 : 0;
          var az1 = pitchPlane ? 0 : 0.27;
          var along = a;
          var cylR = along < 0.58 ? 0.034 : 0.013;
          var ring = c * TAU;
          var cx0 = ax0 + (ax1 - ax0) * along;
          var cz0 = az0 + (az1 - az0) * along;
          var cy0 = -1.0 + 0.54 * along;
          if (pitchPlane) put(f, i, 0, cx0 + Math.cos(ring) * cylR * 0.94, cy0 - Math.cos(ring) * cylR * 0.35, cz0 + Math.sin(ring) * cylR, 0.46);
          else put(f, i, 0, cx0 + Math.sin(ring) * cylR, cy0 - Math.cos(ring) * cylR * 0.35, cz0 + Math.cos(ring) * cylR * 0.94, 0.46);
        } else {
          var e12 = Math.floor(a * 12);
          var q = c * 0.14 - 0.07;
          var g0 = e12 & 1 ? 0.07 : -0.07;
          var g1 = e12 & 2 ? 0.07 : -0.07;
          if (e12 < 4) put(f, i, 0, q, -1.14 + g0, g1, 0.5);
          else if (e12 < 8) put(f, i, 0, g0, -1.14 + q, g1, 0.5);
          else put(f, i, 0, g0, -1.14 + g1, q, 0.5);
        }
      } else if (lane < 11) {
        if (b < 0.45) {
          // Turbine disk: blades in the y–z plane, spun about the pump axis.
          var blade = Math.floor(d * 12) / 12 * TAU;
          r = 0.03 + a * 0.12;
          put(f, i, 1, 0.02, Math.cos(blade) * r, Math.sin(blade) * r, 0.72);
        } else if (b < 0.8) {
          var around = a * TAU;
          var tube = c * TAU;
          r = 0.15 + Math.cos(tube) * 0.05;
          put(f, i, 2, ENG_PUMP[0] - 0.08 + Math.sin(tube) * 0.05, ENG_PUMP[1] + Math.cos(around) * r,
            ENG_PUMP[2] + Math.sin(around) * r, 0.5);
        } else {
          put(f, i, 2, ENG_PUMP[0] - 0.16 + a * 0.3, ENG_PUMP[1], ENG_PUMP[2], 0.46);
        }
      } else if (lane < 12) {
        var t = a;
        var jitter = c * TAU;
        var p0;
        var p1;
        var p2;
        if (b < 0.5) {
          p0 = [ENG_PUMP[0] - 0.12, ENG_PUMP[1] + 0.12, ENG_PUMP[2]];
          p1 = [0.4, -0.22, 0.1];
          p2 = [0.25, -0.36, 0.05];
        } else {
          p0 = [ENG_PUMP[0] + 0.1, ENG_PUMP[1] + 0.12, ENG_PUMP[2]];
          p1 = [0.68, 0.1, 0.18];
          p2 = [0.6, 0.64, 0.2];
        }
        put(f, i, 0, bezier(p0, p1, p2, t, 0) + Math.cos(jitter) * 0.018, bezier(p0, p1, p2, t, 1),
          bezier(p0, p1, p2, t, 2) + Math.sin(jitter) * 0.018, 0.38);
      } else if (lane < 13) {
        var major = nozzleRadius(0.93) + 0.035;
        var minorAngle = b * TAU;
        r = major + Math.cos(minorAngle) * 0.028;
        angle = a * TAU;
        put(f, i, 0, Math.cos(angle) * r, 0.93 * ENG_EXIT + Math.sin(minorAngle) * 0.028, Math.sin(angle) * r, 0.52);
      } else {
        put(f, i, 3, a, b, c * TAU, 0.6);
      }
    }

    function engineHardware(f, i, e, out, rumble) {
      var part = f.part[i];
      var x = f.a[i];
      var y = f.b[i];
      var z = f.c[i];
      if (part === 1) {
        var spin = e.spin * 3.4;
        var cs = Math.cos(spin);
        var sn = Math.sin(spin);
        var ry = y * cs - z * sn;
        z = y * sn + z * cs + ENG_PUMP[2];
        y = ry + ENG_PUMP[1];
        x += ENG_PUMP[0];
      }
      if (rumble > 0) {
        x += Math.sin(e.t * 47 + i * 1.7) * 0.004 * rumble;
        z += Math.cos(e.t * 41 + i * 0.9) * 0.004 * rumble;
      }
      engineToField(x, y, z, out);
      out[3] = 1;
      out[4] = f.h[i];
    }

    function engineGuides(g, ignite) {
      function E(x, y, z) {
        return engineToField(x, y, z, [0, 0, 0]);
      }
      var top = E(0, -1.36, 0);
      var bottom = E(0, ignite ? ENG_EXIT + 3.2 : ENG_EXIT + 0.3, 0);
      g.chain.push([top[0], top[1], top[2], bottom[0], bottom[1], bottom[2]]);
      var throat = E(ENG_RT, 0, 0);
      var exit = E(ENG_RE, ENG_EXIT, 0);
      var pump = E(ENG_PUMP[0] + 0.08, ENG_PUMP[1] - 0.16, ENG_PUMP[2]);
      if (!ignite) {
        g.label = "FIG. 00.1 — THRUST CHAMBER ASSEMBLY";
        g.data = "LOX / RP-1 · Pc 70 BAR · EXPANSION 20.7 : 1";
        g.callouts.push([throat[0], throat[1], throat[2], "THROAT Ø 180", -1]);
        g.callouts.push([pump[0], pump[1], pump[2], "TURBOPUMP 36 000 RPM", 1]);
        g.callouts.push([exit[0], exit[1], exit[2], "EXIT Ø 820", 1]);
      } else {
        var disk = E(0, ENG_EXIT + 0.36, 0);
        var shear = E(ENG_RE * 1.2, ENG_EXIT + 0.9, 0);
        g.label = "FIG. 00.2 — IGNITION, MAIN STAGE";
        g.data = "T+ " + fmt(env.clock, 1).padStart(4, "0") + " S · THRUST " + fmt(845 * env.ign, 0) + " kN";
        g.callouts.push([disk[0], disk[1], disk[2], "MACH DISK", -1]);
        g.plot = "pc";
        g.callouts.push([shear[0], shear[1], shear[2], "SHOCK DIAMONDS", 1]);
        g.callouts.push([throat[0], throat[1], throat[2], "THROAT", -1]);
      }
    }

    var engine = new Formation({
      unit: 1550,
      wind: 0.25,
      rake: 0,
      solid: 0.5,
      yaw: 0.34,
      pitch: 0.08,
      anchorY: 0.5,
      // Standing on a phone, the chamber sits lower so its top clears the
      // menu; the plume still has the lower half to fire into.
      portraitAnchorY: 0.57,
      compactZoom: 1.3,
      portrait: true,
      build: buildEngine,
      motion: function (f, i, e, out) {
        if (f.part[i] === 3) {
          // Before ignition the plume particles idle as chamber glow.
          var r = ENG_RC * 0.75 * Math.sqrt(frac(f.b[i] * 7.3));
          var angle = f.c[i] + e.t * 0.6;
          engineToField(Math.cos(angle) * r, -0.68 + f.a[i] * 0.6, Math.sin(angle) * r, out);
          out[3] = 0.06;
          out[4] = 0.4;
          out[5] = 1;
          return;
        }
        engineHardware(f, i, e, out, 0);
      },
      guides: function (e, g) {
        engineGuides(g, false);
      }
    });

    var ignition = new Formation({
      unit: 1550,
      wind: 0.25,
      rake: 0,
      solid: 0.5,
      dims: false,
      yaw: 0.34,
      pitch: 0.08,
      anchorY: 0.5,
      // Standing on a phone, the chamber sits lower so its top clears the
      // menu; the plume still has the lower half to fire into.
      portraitAnchorY: 0.57,
      compactZoom: 1.3,
      portrait: true,
      build: buildEngine,
      motion: function (f, i, e, out) {
        if (f.part[i] !== 3) {
          engineHardware(f, i, e, out, e.ign);
          return;
        }
        // Gas streams through standing shock cells: the particles flow, the
        // diamonds hold still — exactly how an over-expanded exhaust looks.
        var d = frac(f.a[i] + e.flow * 0.62);
        var yy = d * ENG_PLUME;
        var cell = 0.34 + 0.045 * yy;
        var cellPhase = frac(yy / cell);
        var diamond = 1 - Math.abs(2 * cellPhase - 1);
        var select = f.b[i];
        var angle = f.c[i];
        var r;
        var heat;
        if (select < 0.46) {
          r = ENG_RE * 0.78 * diamond * (1 - 0.24 * d) * (0.93 + 0.07 * frac(select * 17));
          heat = 0.74 + 0.24 * (1 - d);
        } else if (select < 0.56) {
          yy = Math.round(yy / cell) * cell;
          r = ENG_RE * 0.34 * Math.sqrt(frac(select * 23)) * (1 - d * 0.3);
          heat = 0.96;
        } else if (select < 0.9) {
          r = ENG_RE * (1 + 0.3 * yy) * (0.86 + 0.24 * frac(select * 31)) +
            0.05 * Math.sin(yy * 7.1 + angle * 3 - e.t * 6.2);
          heat = 0.52 * (1 - d * 0.6);
        } else {
          r = 0.035 * frac(select * 13);
          heat = 0.82;
        }
        engineToField(Math.cos(angle) * r, ENG_EXIT + yy, Math.sin(angle) * r, out);
        out[3] = band(0, 0.025, d) * (1 - band(0.72, 1, d));
        out[4] = heat;
        out[5] = 1;
      },
      guides: function (e, g) {
        engineGuides(g, true);
      }
    });

    var formations = [fan, gears, wing, shaft, terrain, gyro, dish];
    var formationCount = formations.length;

    // The Kainz mark, sampled from the logo artwork into field space. The
    // opening chain assembles it out of the fan stage, holds it, then
    // disperses it into the thrust chamber — the K embeds into the field.
    var kFormation = null;
    if (hasOpening && !reducedMotion && config.kMark) {
      loadImage(config.kMark, function (kImage) {
        var sampleH = 110;
        var sampleW = Math.max(1, Math.round(sampleH * kImage.width / kImage.height));
        var sampler = makeCanvas(sampleW, sampleH);
        var samplerContext = sampler.getContext("2d", { willReadFrequently: true });
        samplerContext.drawImage(kImage, 0, 0, sampleW, sampleH);
        var pixels = samplerContext.getImageData(0, 0, sampleW, sampleH).data;
        var cells = [];
        for (var sy = 0; sy < sampleH; sy += 1) {
          for (var sx = 0; sx < sampleW; sx += 1) {
            if (pixels[(sy * sampleW + sx) * 4 + 3] > 110) cells.push(sy * sampleW + sx);
          }
        }
        if (!cells.length) return;
        var unit = 1.2 / sampleH;
        kFormation = new Formation({
          wind: 0.35,
          rake: 0,
          solid: 0.5,
          dims: false,
          build: function (f, i, a, b, c) {
            var cell = cells[(a * cells.length) | 0];
            put(f, i, 0,
              (cell % sampleW - sampleW / 2 + (b - 0.5) * 0.65) * unit,
              (Math.floor(cell / sampleW) - sampleH / 2 + (c - 0.5) * 0.65) * unit,
              (hash(i + 77) - 0.5) * 0.08, 0.62);
          }
        });
        requestFrame();
      });
    }

    // Baked at the exact device-pixel size each mark is drawn at, so particle
    // glyphs are blitted 1:1 and stay razor sharp on any display density.
    function makeGlyph(char, weight, cssSize) {
      var device = Math.max(4, Math.round(cssSize * dpr));
      var sprite = makeCanvas(device, device);
      var spriteContext = sprite.getContext("2d");
      spriteContext.clearRect(0, 0, device, device);
      spriteContext.fillStyle = "#000";
      spriteContext.textAlign = "center";
      spriteContext.textBaseline = "middle";
      spriteContext.font = weight + " " + (device * 0.625).toFixed(1) +
        "px 'IBM Plex Mono', ui-monospace, monospace";
      spriteContext.fillText(char, device * 0.5, device * 0.5);
      return sprite;
    }

    // Scatter marks read as measurement samples: crosses for the point cloud,
    // a rare diameter mark drifting through the hardware. Three depth sizes.
    function buildParticleSprites() {
      // Phones get larger, heavier marks: at hairline weight a 5 px cross
      // renders as a grey speck rather than a drawn mark.
      var sizes = compact ? [6.5, 8.5, 10.5] : [6.5, 9.5, 12.5];
      var light = compact ? "500" : "400";
      var heavy = compact ? "600" : "500";
      glyphs = sizes.map(function (size) {
        return [
          makeGlyph("+", light, size),
          makeGlyph("×", light, size),
          makeGlyph("+", heavy, size),
          makeGlyph("×", heavy, size),
          makeGlyph("Ø", light, size * 1.2)
        ];
      });
    }
    buildParticleSprites();

    function makeRasterGlyph(char, weight, scale) {
      var device = Math.max(4, Math.round(cellSize * dpr));
      var sprite = makeCanvas(device, device);
      var spriteContext = sprite.getContext("2d");
      spriteContext.clearRect(0, 0, device, device);
      spriteContext.fillStyle = "#000";
      spriteContext.textAlign = "center";
      spriteContext.textBaseline = "middle";
      spriteContext.font = weight + " " + (device * scale).toFixed(1) +
        "px 'IBM Plex Mono', ui-monospace, monospace";
      spriteContext.fillText(char, device * 0.5, device * 0.54);
      return sprite;
    }

    function buildRasterSprites() {
      // On phones every stroke goes one weight up: a 9 px cell at hairline
      // weight is under a CSS pixel wide and reads as grey, not as ink.
      var w4 = compact ? "500" : "400";
      var w5 = compact ? "600" : "500";
      // Brightness ramp, faint to solid — mesh nodes and sample crosses first,
      // then FEM/tolerance marks in the hot core, like a contour plot.
      rampSprites = [
        makeRasterGlyph("·", w4, 1.05),
        makeRasterGlyph(":", w4, 0.92),
        makeRasterGlyph("+", w4, 0.98),
        makeRasterGlyph("×", w4, 0.98),
        makeRasterGlyph("Δ", w5, 0.92),
        makeRasterGlyph("±", w5, 0.98)
      ];
      // Motion-aligned strokes by screen direction (8 sectors, y down).
      directionSprites = [
        makeRasterGlyph(">", w4, 0.94),
        makeRasterGlyph("\\", w4, 0.98),
        makeRasterGlyph("|", w4, 0.98),
        makeRasterGlyph("/", w4, 0.98),
        makeRasterGlyph("<", w4, 0.94),
        makeRasterGlyph("\\", w4, 0.98),
        makeRasterGlyph("|", w4, 0.98),
        makeRasterGlyph("/", w4, 0.98)
      ];
      // Smoke: thin streak marks along the local flow direction.
      smokeSprites = [
        makeRasterGlyph("-", w4, 1),
        makeRasterGlyph("\\", w4, 0.9),
        makeRasterGlyph("|", w4, 0.9),
        makeRasterGlyph("/", w4, 0.9)
      ];
      smokeDot = makeRasterGlyph("·", w4, 0.9);
      smokeCurl = makeRasterGlyph("~", w4, 1);
      // Section-cut hatching (ISO 128: thin 45° lines).
      hatchSprite = makeRasterGlyph("/", w5, 1.08);
      // Outline strokes along detected edges and thin members, by line
      // orientation (0°, 45°, 90°, 135°, screen y down).
      edgeSprites = [
        makeRasterGlyph("-", "600", 1.12),
        makeRasterGlyph("\\", w5, 1.02),
        makeRasterGlyph("|", w5, 1.02),
        makeRasterGlyph("/", w5, 1.02)
      ];
    }

    // ---------------------------------------------------------------------
    // Flow solver — stable fluids on the glyph grid (semi-Lagrangian
    // advection, vorticity confinement, Gauss–Seidel pressure projection).
    // Units: cells and seconds.
    var fluidEnabled = !reducedMotion;
    var fluid = {
      cols: 0, rows: 0, n: 0,
      u: null, v: null, tu: null, tv: null,
      p: null, div: null, dye: null, tdye: null, mdye: null, curl: null
    };

    function allocFluid() {
      if (!fluidEnabled) return;
      if (fluid.u && fluid.cols === rasterCols && fluid.rows === rasterRows) return;
      var n = rasterCols * rasterRows;
      fluid.cols = rasterCols;
      fluid.rows = rasterRows;
      fluid.n = n;
      fluid.u = new Float32Array(n);
      fluid.v = new Float32Array(n);
      fluid.tu = new Float32Array(n);
      fluid.tv = new Float32Array(n);
      fluid.p = new Float32Array(n);
      fluid.div = new Float32Array(n);
      fluid.dye = new Float32Array(n);
      fluid.tdye = new Float32Array(n);
      fluid.mdye = new Float32Array(n);
      fluid.curl = new Float32Array(n);
    }

    // Gaussian splat in cell units. mode 0 adds velocity, 1 drives toward it
    // (a jet), 2 pushes radially outward (a blast).
    function splat(cx, cy, radius, vx, vy, dyeAmount, mode) {
      if (!fluid.u) return;
      var cols = fluid.cols;
      var rows = fluid.rows;
      var reach = Math.ceil(radius * 2.2);
      var x0 = Math.max(1, Math.floor(cx - reach));
      var x1 = Math.min(cols - 2, Math.ceil(cx + reach));
      var y0 = Math.max(1, Math.floor(cy - reach));
      var y1 = Math.min(rows - 2, Math.ceil(cy + reach));
      var inv = 1 / (radius * radius);
      for (var y = y0; y <= y1; y += 1) {
        for (var x = x0; x <= x1; x += 1) {
          var dx = x + 0.5 - cx;
          var dy = y + 0.5 - cy;
          var d2 = dx * dx + dy * dy;
          var w = Math.exp(-d2 * inv);
          if (w < 0.03) continue;
          var idx = y * cols + x;
          if (mode === 1) {
            fluid.u[idx] += (vx - fluid.u[idx]) * w;
            fluid.v[idx] += (vy - fluid.v[idx]) * w;
          } else if (mode === 2) {
            var d = Math.sqrt(d2) + 0.001;
            fluid.u[idx] += dx / d * vx * w;
            fluid.v[idx] += dy / d * vx * w;
          } else {
            fluid.u[idx] += vx * w;
            fluid.v[idx] += vy * w;
          }
          fluid.dye[idx] = Math.min(1.6, fluid.dye[idx] + dyeAmount * w);
        }
      }
    }

    function fluidStep(dt, frameDt, params) {
      var cols = fluid.cols;
      var rows = fluid.rows;
      var n = fluid.n;
      if (cols < 4 || rows < 4) return;
      var u = fluid.u;
      var v = fluid.v;
      var p = fluid.p;
      var div = fluid.div;
      var dye = fluid.dye;
      var curl = fluid.curl;
      var ux = params.ux;
      var uy = params.uy;
      var relax = 1 - Math.exp(-dt * 0.6);
      var solid = params.solid;
      var toCells = 1 / (cellSize * Math.max(frameDt, 0.008));
      var emit = params.emit * dt;
      var x;
      var y;
      var idx;

      // Freestream relaxation and moving-boundary coupling: dense mechanism
      // cells drag the air along at the mechanism's own screen velocity.
      for (idx = 0; idx < n; idx += 1) {
        u[idx] += (ux - u[idx]) * relax;
        v[idx] += (uy - v[idx]) * relax;
        var dens = rasterDensity[idx];
        if (dens > 0.45 && solid > 0) {
          var k = Math.min(1, (dens - 0.45) * 1.8) * solid;
          var inv = 0.45 / dens;
          var bu = clamp(rasterFlowX[idx] * inv * toCells, -24, 24);
          var bv = clamp(rasterFlowY[idx] * inv * toCells, -24, 24);
          u[idx] += (bu - u[idx]) * k;
          v[idx] += (bv - v[idx]) * k;
          if (emit > 0) dye[idx] = Math.min(1.4, dye[idx] + emit * Math.min(1, dens));
        }
      }

      // Inflow column and the smoke rake: continuous streaklines, like a
      // smoke-wire in a real tunnel.
      var rakeTop = params.rakeTop;
      var rakeBottom = params.rakeBottom;
      for (y = 0; y < rows; y += 1) {
        idx = y * cols;
        u[idx] = ux;
        v[idx] = uy;
        u[idx + 1] = ux;
        v[idx + 1] = uy;
        var streak = params.rake > 0 && y >= rakeTop && y <= rakeBottom && y % params.rakeSpacing === 0;
        dye[idx] = streak ? params.rake : 0;
        dye[idx + 1] = streak ? params.rake : dye[idx + 1] * 0.5;
      }

      if (params.confine > 0) {
        for (y = 1; y < rows - 1; y += 1) {
          for (x = 1; x < cols - 1; x += 1) {
            idx = y * cols + x;
            curl[idx] = 0.5 * ((v[idx + 1] - v[idx - 1]) - (u[idx + cols] - u[idx - cols]));
          }
        }
        var eps = params.confine * dt;
        for (y = 2; y < rows - 2; y += 1) {
          for (x = 2; x < cols - 2; x += 1) {
            idx = y * cols + x;
            var nx = 0.5 * (Math.abs(curl[idx + 1]) - Math.abs(curl[idx - 1]));
            var ny = 0.5 * (Math.abs(curl[idx + cols]) - Math.abs(curl[idx - cols]));
            var w = curl[idx] * eps / (Math.sqrt(nx * nx + ny * ny) + 1e-5);
            u[idx] += ny * w;
            v[idx] -= nx * w;
          }
        }
      }

      // Projection. Left edge is inflow (Neumann), the other three are open
      // (p = 0), so the wake leaves the domain instead of piling up.
      for (y = 0; y < rows; y += 1) {
        for (x = 0; x < cols; x += 1) {
          idx = y * cols + x;
          var uR = x < cols - 1 ? u[idx + 1] : u[idx];
          var uL = x > 0 ? u[idx - 1] : u[idx];
          var vD = y < rows - 1 ? v[idx + cols] : v[idx];
          var vU = y > 0 ? v[idx - cols] : v[idx];
          div[idx] = -0.5 * (uR - uL + vD - vU);
          p[idx] *= 0.85;
        }
      }
      for (var iter = 0; iter < params.iters; iter += 1) {
        var forward = !(iter & 1);
        for (var yy = 0; yy < rows; yy += 1) {
          y = forward ? yy : rows - 1 - yy;
          var row = y * cols;
          for (x = 0; x < cols; x += 1) {
            idx = row + x;
            var pl = x > 0 ? p[idx - 1] : p[idx];
            var pr = x < cols - 1 ? p[idx + 1] : 0;
            var pu = y > 0 ? p[idx - cols] : 0;
            var pd = y < rows - 1 ? p[idx + cols] : 0;
            p[idx] = (div[idx] + pl + pr + pu + pd) * 0.25;
          }
        }
      }
      for (y = 0; y < rows; y += 1) {
        for (x = 0; x < cols; x += 1) {
          idx = y * cols + x;
          var gl = x > 0 ? p[idx - 1] : p[idx];
          var gr = x < cols - 1 ? p[idx + 1] : 0;
          var gu = y > 0 ? p[idx - cols] : 0;
          var gd = y < rows - 1 ? p[idx + cols] : 0;
          u[idx] = clamp(u[idx] - 0.5 * (gr - gl), -90, 90);
          v[idx] = clamp(v[idx] - 0.5 * (gd - gu), -90, 90);
        }
      }

      // Semi-Lagrangian advection of velocity; MacCormack for the dye, so
      // smoke streaks stay sharp instead of blurring out within a second.
      var tu = fluid.tu;
      var tv = fluid.tv;
      var tdye = fluid.tdye;
      var mdye = fluid.mdye;
      var maxX = cols - 1.001;
      var maxY = rows - 1.001;
      var decay = Math.exp(-dt * params.decay);
      for (y = 0; y < rows; y += 1) {
        for (x = 0; x < cols; x += 1) {
          idx = y * cols + x;
          var bx = x - dt * u[idx];
          var by = y - dt * v[idx];
          bx = bx < 0 ? 0 : bx > maxX ? maxX : bx;
          by = by < 0 ? 0 : by > maxY ? maxY : by;
          var ix = bx | 0;
          var iy = by | 0;
          var fx = bx - ix;
          var fy = by - iy;
          var i00 = iy * cols + ix;
          var i10 = i00 + 1;
          var i01 = i00 + cols;
          var i11 = i01 + 1;
          var w00 = (1 - fx) * (1 - fy);
          var w10 = fx * (1 - fy);
          var w01 = (1 - fx) * fy;
          var w11 = fx * fy;
          tu[idx] = u[i00] * w00 + u[i10] * w10 + u[i01] * w01 + u[i11] * w11;
          tv[idx] = v[i00] * w00 + v[i10] * w10 + v[i01] * w01 + v[i11] * w11;
          tdye[idx] = dye[i00] * w00 + dye[i10] * w10 + dye[i01] * w01 + dye[i11] * w11;
        }
      }
      for (y = 0; y < rows; y += 1) {
        for (x = 0; x < cols; x += 1) {
          idx = y * cols + x;
          var ox = x - dt * u[idx];
          var oy = y - dt * v[idx];
          ox = ox < 0 ? 0 : ox > maxX ? maxX : ox;
          oy = oy < 0 ? 0 : oy > maxY ? maxY : oy;
          var o00 = (oy | 0) * cols + (ox | 0);
          var d00 = dye[o00];
          var d10 = dye[o00 + 1];
          var d01 = dye[o00 + cols];
          var d11 = dye[o00 + cols + 1];
          var lo = Math.min(d00, d10, d01, d11);
          var hi = Math.max(d00, d10, d01, d11);
          var rx = x + dt * u[idx];
          var ry = y + dt * v[idx];
          rx = rx < 0 ? 0 : rx > maxX ? maxX : rx;
          ry = ry < 0 ? 0 : ry > maxY ? maxY : ry;
          var jx = rx | 0;
          var jy = ry | 0;
          var gx = rx - jx;
          var gy = ry - jy;
          var j00 = jy * cols + jx;
          var back = tdye[j00] * (1 - gx) * (1 - gy) + tdye[j00 + 1] * gx * (1 - gy) +
            tdye[j00 + cols] * (1 - gx) * gy + tdye[j00 + cols + 1] * gx * gy;
          var corrected = tdye[idx] + 0.5 * (dye[idx] - back);
          mdye[idx] = (corrected < lo ? lo : corrected > hi ? hi : corrected) * decay;
        }
      }
      fluid.u = tu;
      fluid.tu = u;
      fluid.v = tv;
      fluid.tv = v;
      fluid.dye = mdye;
      fluid.mdye = dye;
    }

    // ---------------------------------------------------------------------
    // Projection shared by particles and the drafting layer.
    var view = {
      cx: 0, cy: 0, scale: 1, rot90: false,
      cosYaw: 1, sinYaw: 0, cosPitch: 1, sinPitch: 0, cosRoll: 1, sinRoll: 0
    };

    function project(x, y, z, out) {
      if (view.rot90) {
        var q = x;
        x = -y;
        y = q;
      }
      var rx = x * view.cosYaw - z * view.sinYaw;
      var rz = x * view.sinYaw + z * view.cosYaw;
      var ry = y * view.cosPitch - rz * view.sinPitch;
      rz = y * view.sinPitch + rz * view.cosPitch;
      var t = rx * view.cosRoll - ry * view.sinRoll;
      ry = rx * view.sinRoll + ry * view.cosRoll;
      rx = t;
      var perspective = 2.85 / (3.1 + rz);
      out[0] = view.cx + rx * view.scale * perspective;
      out[1] = view.cy + ry * view.scale * perspective;
      out[2] = perspective;
      return out;
    }

    // ---------------------------------------------------------------------
    // Drafting layer.
    var guides = { label: "", data: "", chain: [], thin: [], circles: [], callouts: [], balloons: [], arcs: [], plot: "" };
    var PA = new Float32Array(3);
    var PB = new Float32Array(3);
    // Smoothed screen-space extents of the mechanism, with the positions of
    // its extreme points so extension lines start on real geometry.
    var bbox = { valid: false, l: 0, r: 0, t: 0, b: 0, ly: 0, ry: 0, tx: 0, bx: 0 };
    var bboxRaw = { l: 0, r: 0, t: 0, b: 0, ly: 0, ry: 0, tx: 0, bx: 0 };
    var fontPx = compact ? 8 : 10;
    var hasLetterSpacing = "letterSpacing" in ctx;

    function setFont(weight) {
      ctx.font = weight + " " + fontPx + "px 'IBM Plex Mono', ui-monospace, monospace";
      if (hasLetterSpacing) ctx.letterSpacing = "0.07em";
    }

    function knockoutText(text, x, y, align, alpha) {
      var textWidth = ctx.measureText(text).width;
      var left = align === "right" ? x - textWidth : align === "center" ? x - textWidth / 2 : x;
      ctx.globalAlpha = alpha * 0.86;
      ctx.fillStyle = "#fff";
      ctx.fillRect(left - 3, y - fontPx * 0.86, textWidth + 6, fontPx * 1.24);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#000";
      ctx.fillText(text, left, y);
      return textWidth;
    }

    function arrowHead(x, y, dx, dy, size) {
      var length = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / length;
      var uy = dy / length;
      ctx.moveTo(x, y);
      ctx.lineTo(x - ux * size - uy * size * 0.28, y - uy * size + ux * size * 0.28);
      ctx.lineTo(x - ux * size + uy * size * 0.28, y - uy * size - ux * size * 0.28);
      ctx.closePath();
    }

    function segment3(seg, grow) {
      project(seg[0], seg[1], seg[2], PA);
      project(seg[3], seg[4], seg[5], PB);
      var mx = (PA[0] + PB[0]) * 0.5;
      var my = (PA[1] + PB[1]) * 0.5;
      ctx.moveTo(mx + (PA[0] - mx) * grow, my + (PA[1] - my) * grow);
      ctx.lineTo(mx + (PB[0] - mx) * grow, my + (PB[1] - my) * grow);
    }

    function circle3(c, grow) {
      var steps = 64;
      var end = Math.max(1, Math.round(steps * grow));
      for (var k = 0; k <= end; k += 1) {
        var angle = k / steps * TAU - Math.PI / 2;
        project(c[0] + Math.cos(angle) * c[3], c[1] + Math.sin(angle) * c[3], c[2], PA);
        if (k === 0) ctx.moveTo(PA[0], PA[1]);
        else ctx.lineTo(PA[0], PA[1]);
      }
    }

    function drawDimensions(f, alpha, grow) {
      var bw = bbox.r - bbox.l;
      var bh = bbox.b - bbox.t;
      if (bw < 70 || bh < 50) return -1;
      var perUnit = view.scale * 0.92;
      var dimY = Math.min(viewHeight - 46, bbox.b + 20);
      var left = Math.max(8, bbox.l);
      var right = Math.min(width - 8, bbox.r);
      var cx = (left + right) / 2;
      var half = (right - left) / 2 * grow;
      ctx.globalAlpha = alpha * 0.5;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      if (left === bbox.l) {
        ctx.moveTo(bbox.l, bbox.ly + 6);
        ctx.lineTo(bbox.l, dimY + 6);
      }
      if (right === bbox.r) {
        ctx.moveTo(bbox.r, bbox.ry + 6);
        ctx.lineTo(bbox.r, dimY + 6);
      }
      ctx.moveTo(cx - half, dimY);
      ctx.lineTo(cx + half, dimY);
      ctx.stroke();
      if (grow > 0.98) {
        ctx.beginPath();
        if (left === bbox.l) arrowHead(bbox.l, dimY, -1, 0, 7);
        if (right === bbox.r) arrowHead(bbox.r, dimY, 1, 0, 7);
        ctx.fill();
      }
      setFont("400");
      knockoutText(f.prefix + fmt(bw / perUnit * f.unit, 1), cx, dimY - 4, "center", alpha * 0.78 * grow);

      if (!compact) {
        var dimX = Math.min(width - 30, bbox.r + 24);
        var cy = (bbox.t + bbox.b) / 2;
        var halfH = bh / 2 * grow;
        ctx.globalAlpha = alpha * 0.5;
        ctx.beginPath();
        ctx.moveTo(bbox.tx + 6, bbox.t);
        ctx.lineTo(dimX + 6, bbox.t);
        ctx.moveTo(bbox.bx + 6, bbox.b);
        ctx.lineTo(dimX + 6, bbox.b);
        ctx.moveTo(dimX, cy - halfH);
        ctx.lineTo(dimX, cy + halfH);
        ctx.stroke();
        if (grow > 0.98) {
          ctx.beginPath();
          arrowHead(dimX, bbox.t, 0, -1, 7);
          arrowHead(dimX, bbox.b, 0, 1, 7);
          ctx.fill();
        }
        ctx.save();
        ctx.translate(dimX - 4, cy);
        ctx.rotate(-Math.PI / 2);
        knockoutText(fmt(bh / perUnit * f.unit, 1), 0, 0, "center", alpha * 0.78 * grow);
        ctx.restore();
      }
      return dimY;
    }

    function drawCallout(c, alpha, grow) {
      project(c[0], c[1], c[2], PA);
      var side = c[4] || 1;
      var ax = PA[0];
      var ay = PA[1];
      var ex = ax + side * 34 * grow;
      var ey = ay - 30 * grow;
      setFont("400");
      var textWidth = ctx.measureText(c[3]).width;
      if (side > 0 && ex + textWidth + 22 > width - 12) side = -1;
      if (side < 0 && ex - textWidth - 22 < 12) side = 1;
      ex = ax + side * 34 * grow;
      if (ey < 18) ey = ay + 30 * grow;
      var shelf = ex + side * (textWidth + 10) * grow;
      ctx.globalAlpha = alpha * 0.55;
      ctx.beginPath();
      ctx.arc(ax, ay, 1.8, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ex, ey);
      ctx.lineTo(shelf, ey);
      ctx.stroke();
      if (grow > 0.6) {
        knockoutText(c[3], side > 0 ? ex + 5 : ex - 5, ey - 4, side > 0 ? "left" : "right", alpha * 0.74 * (grow - 0.6) / 0.4);
      }
    }

    function drawBalloon(bl, alpha, grow) {
      project(bl[0], bl[1], bl[2], PA);
      project(bl[3], bl[4], bl[2], PB);
      var radius = compact ? 7 : 8.5;
      var dx = PA[0] - PB[0];
      var dy = PA[1] - PB[1];
      var length = Math.sqrt(dx * dx + dy * dy) || 1;
      ctx.globalAlpha = alpha * 0.5;
      ctx.beginPath();
      ctx.moveTo(PB[0] + dx / length * radius, PB[1] + dy / length * radius);
      ctx.lineTo(PB[0] + dx / length * (radius + (length - radius) * grow), PB[1] + dy / length * (radius + (length - radius) * grow));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(PA[0], PA[1], 1.7, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = alpha * 0.86;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(PB[0], PB[1], radius * grow, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.globalAlpha = alpha * 0.6;
      ctx.stroke();
      if (grow > 0.7) {
        setFont("500");
        ctx.globalAlpha = alpha * 0.8;
        ctx.textAlign = "center";
        ctx.fillText(bl[5], PB[0], PB[1] + fontPx * 0.36);
        ctx.textAlign = "left";
      }
    }

    function drawArc(arc, alpha, grow) {
      var steps = 24;
      var a0 = arc[4];
      var a1 = arc[4] + (arc[5] - arc[4]) * grow;
      ctx.globalAlpha = alpha * 0.5;
      ctx.beginPath();
      for (var k = 0; k <= steps; k += 1) {
        var angle = a0 + (a1 - a0) * k / steps;
        project(arc[0] + Math.cos(angle) * arc[3], arc[1] + Math.sin(angle) * arc[3], arc[2], PA);
        if (k === 0) ctx.moveTo(PA[0], PA[1]);
        else ctx.lineTo(PA[0], PA[1]);
      }
      ctx.stroke();
      var mid = (arc[4] + arc[5]) / 2;
      project(arc[0] + Math.cos(mid) * arc[3] * 1.18, arc[1] + Math.sin(mid) * arc[3] * 1.18, arc[2], PA);
      setFont("400");
      knockoutText(arc[6], PA[0] + 6, PA[1] + 4, "left", alpha * 0.74 * grow);
    }

    function drawSectionCut(cutX, alpha) {
      // The cut's end marks stay below the menu toggle on phones.
      var top = Math.max(compact ? 84 : 24, bbox.t - 20);
      var bottom = bbox.b + 16;
      ctx.globalAlpha = alpha * 0.55;
      ctx.lineWidth = 0.9;
      ctx.setLineDash([18, 4, 3, 4]);
      ctx.beginPath();
      ctx.moveTo(cutX, top);
      ctx.lineTo(cutX, bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cutX, top - 12);
      ctx.lineTo(cutX, top);
      ctx.moveTo(cutX, bottom);
      ctx.lineTo(cutX, bottom + 12);
      ctx.stroke();
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(cutX, top - 6);
      ctx.lineTo(cutX - 16, top - 6);
      ctx.moveTo(cutX, bottom + 6);
      ctx.lineTo(cutX - 16, bottom + 6);
      ctx.stroke();
      ctx.beginPath();
      arrowHead(cutX - 18, top - 6, -1, 0, 6);
      arrowHead(cutX - 18, bottom + 6, -1, 0, 6);
      ctx.fill();
      setFont("500");
      ctx.globalAlpha = alpha * 0.8;
      ctx.fillText("A", cutX + 6, top - 3);
      ctx.fillText("A", cutX + 6, bottom + 12);
    }

    // ---------------------------------------------------------------------
    // Live engineering plots beside the mechanism, drawn like figure insets.
    var PLOT_W = 196;
    var PLOT_H = 92;

    function plotOrigin(kind) {
      var x0;
      var y0;
      if (kind === "profile") {
        x0 = width - PLOT_W - 64;
        y0 = 150;
      } else if (kind === "pc") {
        x0 = bbox.r + 72;
        y0 = bbox.b + 34;
      } else {
        x0 = bbox.r + 48;
        y0 = bbox.t + 10;
        if (x0 + PLOT_W > width - 32) {
          x0 = bbox.r - PLOT_W;
          y0 = bbox.t - PLOT_H - 58;
        }
      }
      return [clamp(x0, 96, width - PLOT_W - 24), clamp(y0, 84, viewHeight - PLOT_H - 56)];
    }

    function plotFrame(x0, y0, title, xLabel, yLabel, alpha, grow) {
      ctx.globalAlpha = alpha * 0.5;
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0, y0 + PLOT_H);
      ctx.lineTo(x0 + PLOT_W * grow, y0 + PLOT_H);
      for (var t = 0; t <= 4; t += 1) {
        var tx = x0 + PLOT_W * t / 4;
        ctx.moveTo(tx, y0 + PLOT_H);
        ctx.lineTo(tx, y0 + PLOT_H + 3);
      }
      for (t = 0; t <= 2; t += 1) {
        var ty = y0 + PLOT_H * t / 2;
        ctx.moveTo(x0 - 3, ty);
        ctx.lineTo(x0, ty);
      }
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.18;
      ctx.setLineDash([1, 3]);
      ctx.beginPath();
      ctx.moveTo(x0, y0 + PLOT_H / 2);
      ctx.lineTo(x0 + PLOT_W, y0 + PLOT_H / 2);
      ctx.moveTo(x0 + PLOT_W / 2, y0);
      ctx.lineTo(x0 + PLOT_W / 2, y0 + PLOT_H);
      ctx.stroke();
      ctx.setLineDash([]);
      setFont("500");
      knockoutText(title, x0, y0 - 10, "left", alpha * 0.7 * grow);
      setFont("400");
      ctx.globalAlpha = alpha * 0.55 * grow;
      ctx.fillText(yLabel, x0 + 5, y0 + fontPx);
      ctx.textAlign = "right";
      ctx.fillText(xLabel, x0 + PLOT_W, y0 + PLOT_H + fontPx + 5);
      ctx.textAlign = "left";
    }

    function plotCurve(x0, y0, points, xs, ys, grow, dash) {
      var last = Math.max(2, Math.floor(points.length / 2 * grow));
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      for (var k = 0; k < last; k += 1) {
        var px = x0 + xs(points[k * 2]) * PLOT_W;
        var py = y0 + (1 - ys(points[k * 2 + 1])) * PLOT_H;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    function pcAt(t) {
      return 70 * (1 - Math.exp(-t / 0.22)) * (1 + 0.14 * Math.exp(-t / 0.35) * Math.sin(t * 16));
    }

    function meshStiffness(u) {
      // Alternating double / single tooth-pair contact, contact ratio 1.62.
      u = frac(u);
      var edge = 0.035;
      var high = u < 0.62 ? 1 : 0;
      if (u < edge) high = u / edge;
      else if (Math.abs(u - 0.62) < edge) high = 0.5 - (u - 0.62) / edge * 0.5;
      return 0.42 + high * 0.46;
    }

    function drawPlot(kind, alpha, grow) {
      var origin = plotOrigin(kind);
      var x0 = origin[0];
      var y0 = origin[1];
      var pts = [];
      var k;
      ctx.save();
      ctx.strokeStyle = "#000";
      ctx.fillStyle = "#000";
      if (kind === "cp") {
        plotFrame(x0, y0, "PRESSURE COEFFICIENT · α 7°", "x/c", "−Cp", alpha, grow);
        var sx = function (v) { return v; };
        var sy = function (v) { return (-v + 1) / 4.2; };
        ctx.globalAlpha = alpha * 0.72;
        ctx.lineWidth = 1;
        plotCurve(x0, y0, WING.cpUpper, sx, sy, grow);
        plotCurve(x0, y0, WING.cpLower, sx, sy, grow, [3, 2]);
        setFont("400");
        ctx.globalAlpha = alpha * 0.5 * grow;
        ctx.fillText("UPPER", x0 + PLOT_W * 0.2, y0 + PLOT_H * 0.16);
        ctx.fillText("LOWER", x0 + PLOT_W * 0.55, y0 + PLOT_H * 0.78);
      } else if (kind === "pc") {
        plotFrame(x0, y0, "CHAMBER PRESSURE", "T+ s", "Pc bar", alpha, grow);
        var tEnd = clamp(env.clock, 0, 3);
        for (k = 0; k <= 90; k += 1) {
          var t = tEnd * k / 90;
          pts.push(t / 3, pcAt(t) / 90);
        }
        ctx.globalAlpha = alpha * 0.8;
        ctx.lineWidth = 1.1;
        plotCurve(x0, y0, pts, function (v) { return v; }, function (v) { return v; }, 1);
        var cxp = x0 + tEnd / 3 * PLOT_W;
        var cyp = y0 + (1 - pcAt(tEnd) / 90) * PLOT_H;
        ctx.beginPath();
        ctx.arc(cxp, cyp, 2.2, 0, TAU);
        ctx.fill();
        setFont("400");
        knockoutText(fmt(pcAt(tEnd), 1), cxp + 6, cyp - 4, "left", alpha * 0.75);
      } else if (kind === "mesh") {
        plotFrame(x0, y0, "MESH STIFFNESS · εα 1.62", "ROLL ANGLE", "k", alpha, grow);
        for (k = 0; k <= 150; k += 1) pts.push(k / 150, meshStiffness(k / 50));
        ctx.globalAlpha = alpha * 0.72;
        ctx.lineWidth = 1;
        plotCurve(x0, y0, pts, function (v) { return v; }, function (v) { return v; }, grow);
        var G0 = GEARS[0];
        var toothPhase = frac((G0.phase + G0.dir * env.gear) * G0.z / TAU);
        var mx = x0 + (1 + toothPhase) / 3 * PLOT_W;
        var my = y0 + (1 - meshStiffness(toothPhase)) * PLOT_H;
        ctx.globalAlpha = alpha * 0.35;
        ctx.beginPath();
        ctx.moveTo(mx, y0);
        ctx.lineTo(mx, y0 + PLOT_H);
        ctx.stroke();
        ctx.globalAlpha = alpha * 0.85;
        ctx.beginPath();
        ctx.arc(mx, my, 2.2, 0, TAU);
        ctx.fill();
      } else if (kind === "beam") {
        setFont("500");
        knockoutText("BEAM PATTERN · SIDELOBE −13.3 dB", x0, y0 - 10, "left", alpha * 0.7 * grow);
        var bcx = x0 + PLOT_W / 2;
        var bcy = y0 + PLOT_H;
        var br = PLOT_H - 4;
        ctx.globalAlpha = alpha * 0.3;
        ctx.lineWidth = 0.75;
        ctx.setLineDash([1, 3]);
        for (k = 1; k <= 3; k += 1) {
          ctx.beginPath();
          ctx.arc(bcx, bcy, br * k / 3, Math.PI, TAU);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = alpha * 0.5;
        ctx.beginPath();
        ctx.moveTo(bcx - br - 4, bcy);
        ctx.lineTo(bcx + br + 4, bcy);
        ctx.moveTo(bcx, bcy);
        ctx.lineTo(bcx, bcy - br - 4);
        ctx.stroke();
        ctx.globalAlpha = alpha * 0.78;
        ctx.lineWidth = 1;
        ctx.beginPath();
        var steps = Math.max(2, Math.round(240 * grow));
        for (k = 0; k <= steps; k += 1) {
          var phi = -Math.PI / 2 + Math.PI * k / 240;
          var u = Math.PI * 5 * Math.sin(phi);
          var gain = Math.abs(u) < 1e-4 ? 1 : Math.pow(Math.sin(u) / u, 2);
          var db = Math.max(-30, 10 * Math.log(gain) / Math.LN10);
          var rr = (db + 30) / 30 * br;
          var qx = bcx + Math.sin(phi) * rr;
          var qy = bcy - Math.cos(phi) * rr;
          if (k === 0) ctx.moveTo(qx, qy);
          else ctx.lineTo(qx, qy);
        }
        ctx.stroke();
        setFont("400");
        ctx.globalAlpha = alpha * 0.5 * grow;
        ctx.fillText("0 dB", bcx + 4, bcy - br - 6);
        ctx.fillText("−20", bcx + br / 3 + 2, bcy - 3);
      } else if (kind === "profile") {
        plotFrame(x0, y0, "ELEVATION · SURVEY LINE", "ALONG TRACK", "h", alpha, grow);
        for (k = 0; k <= 120; k += 1) {
          var along = k / 120 * TER_DEPTH;
          pts.push(k / 120, clamp(terrainHeight(env.scan, along + env.fly) / 1.3, 0, 1));
        }
        ctx.globalAlpha = alpha * 0.72;
        ctx.lineWidth = 1;
        plotCurve(x0, y0, pts, function (v) { return v; }, function (v) { return v * 0.9 + 0.04; }, grow);
      }
      ctx.restore();
    }

    // The build front of a morph, drawn like a print gantry crossing the
    // plate: a fine dotted rule with its progress readout.
    function drawBuildFront(position, horizontal, percent, alpha) {
      ctx.save();
      ctx.strokeStyle = "#000";
      ctx.fillStyle = "#000";
      ctx.lineWidth = 0.75;
      ctx.globalAlpha = alpha * 0.4;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(0, position);
        ctx.lineTo(width, position);
      } else {
        ctx.moveTo(position, 0);
        ctx.lineTo(position, height);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      setFont("500");
      var label = "BUILD " + String(Math.round(percent)).padStart(2, "0") + "%";
      if (horizontal) knockoutText(label, 18, position - 6, "left", alpha * 0.7);
      else knockoutText(label, position + 6, viewHeight * 0.12, "left", alpha * 0.7);
      ctx.restore();
    }

    function drawDrafting(f, alpha, time, cutX) {
      if (!f || !f.guides || alpha < 0.02) return;
      guides.label = "";
      guides.data = "";
      guides.chain.length = 0;
      guides.thin.length = 0;
      guides.circles.length = 0;
      guides.callouts.length = 0;
      guides.balloons.length = 0;
      guides.arcs.length = 0;
      guides.plot = "";
      f.guides(env, guides);
      var grow = ease(alpha);
      var k;
      ctx.save();
      ctx.strokeStyle = "#000";
      ctx.fillStyle = "#000";
      ctx.textBaseline = "alphabetic";
      ctx.lineWidth = 0.75;

      // Chain lines (ISO 128 long-dash–dot) for axes, centres and pitch
      // circles, marching slowly along their length.
      ctx.globalAlpha = alpha * 0.4;
      ctx.setLineDash(compact ? [11, 3, 2, 3] : [16, 4, 2, 4]);
      ctx.lineDashOffset = -time * 3;
      ctx.beginPath();
      for (k = 0; k < guides.chain.length; k += 1) segment3(guides.chain[k], grow);
      for (k = 0; k < guides.circles.length; k += 1) circle3(guides.circles[k], grow);
      ctx.stroke();
      ctx.setLineDash([]);
      if (guides.thin.length) {
        ctx.globalAlpha = alpha * 0.32;
        ctx.beginPath();
        for (k = 0; k < guides.thin.length; k += 1) segment3(guides.thin[k], grow);
        ctx.stroke();
      }

      var detail = !compact;
      if (cutX > -9999) drawSectionCut(cutX, alpha);
      var dimY = f.dims && bbox.valid ? drawDimensions(f, alpha, grow) : -1;
      if (detail) {
        for (k = 0; k < guides.arcs.length; k += 1) drawArc(guides.arcs[k], alpha, grow);
        for (k = 0; k < guides.callouts.length; k += 1) drawCallout(guides.callouts[k], alpha, grow);
      } else if (guides.callouts.length) {
        drawCallout(guides.callouts[0], alpha, grow);
      }
      ctx.lineWidth = 0.75;
      for (k = 0; k < guides.balloons.length; k += 1) drawBalloon(guides.balloons[k], alpha, grow);
      if (detail && guides.plot && bbox.valid) drawPlot(guides.plot, alpha, grow);

      // View label, set like a drawing's view title.
      if (guides.label && bbox.valid) {
        setFont("500");
        var labelWidth = ctx.measureText(guides.label).width;
        var railClear = compact ? 16 : 96;
        var lx = clamp(bbox.l, railClear, Math.max(railClear, width - labelWidth - 18));
        var ly = dimY > 0 ? dimY + 24 : bbox.t - 30;
        // Phones keep the label clear of the menu toggle.
        ly = clamp(ly, compact ? 100 : 40, viewHeight - 30);
        ctx.globalAlpha = alpha * 0.6;
        ctx.fillRect(lx, ly - fontPx - 5, Math.min(labelWidth, 28) * grow, 1);
        knockoutText(guides.label, lx, ly, "left", alpha * 0.72 * grow);
        setFont("400");
        knockoutText(guides.data, lx, ly + fontPx + 5, "left", alpha * 0.5 * grow);
      }
      ctx.restore();
    }

    // ---------------------------------------------------------------------
    function resize() {
      // Breakpoints are re-read here, not just at load: rotating a phone or
      // resizing a window crosses them, and every quality knob below keys off
      // them. Particle count stays put — reallocating the formation buffers
      // mid-session would cost far more than the extra points are worth.
      compact = viewport.compact;
      medium = viewport.medium;
      cellSize = compact ? 9 : 11;
      fontPx = compact ? 8 : 10;
      portraitMode = viewport.portrait;
      width = Math.max(1, viewport.width);
      height = Math.max(1, viewport.height);
      // Render at native resolution where the pixel budget allows — the
      // glyphs stay razor sharp on retina displays. The pixel budget is the
      // real cost governor, so the caps can sit near native density.
      var requestedDpr = Math.min(viewport.dpr || 1, compact ? 3.5 : medium ? 2.25 : 2);
      if (compact) {
        // Phones render at exactly the native density, always. A backing
        // store that does not map 1:1 onto device pixels is resampled by the
        // compositor, and at glyph size that resampling is the blur (2.46x
        // on a 3x screen smears every stroke). Their frame budget is kept by
        // the frame-rate step in governResolution instead.
        dprFloor = requestedDpr;
        dpr = requestedDpr;
      } else {
        var pixelBudget = medium ? 3500000 : 5600000;
        var baseDpr = Math.max(0.9, Math.min(requestedDpr, Math.sqrt(pixelBudget / Math.max(1, width * height))));
        // The governor may trade density for frame rate, but never below
        // the floor.
        dprFloor = Math.min(baseDpr, 1);
        dpr = Math.max(dprFloor, baseDpr * dprScale);
      }
      resetGovernor(45);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      rasterCols = Math.max(4, Math.ceil(width / cellSize));
      rasterRows = Math.max(4, Math.ceil(height / cellSize));
      var cellCount = rasterCols * rasterRows;
      if (!rasterDensity || rasterDensity.length !== cellCount) {
        rasterDensity = new Float32Array(cellCount);
        rasterFlowX = new Float32Array(cellCount);
        rasterFlowY = new Float32Array(cellCount);
        rasterNear = new Float32Array(cellCount);
        rasterNearDil = new Float32Array(cellCount);
        rasterTracer = new Float32Array(cellCount);
        rasterGX = new Float32Array(cellCount);
        rasterGY = new Float32Array(cellCount);
      }
      allocFluid();
      buildParticleSprites();
      buildRasterSprites();
      applyLayout();
      if (reducedMotion && sectionStops.length) {
        scrollState.a = sectionStops[0].index;
        scrollState.b = sectionStops[0].index;
        scrollState.mix = 0;
        scrollState.global = 0;
      }
      render(performance.now());
    }

    function applyLayout() {
      viewHeight = Math.min(height, Math.max(1, viewport.visible || height));
      sectionStops = layout.stops.map(function (stop) {
        return { index: clamp(stop[0], 0, formationCount - 1), center: stop[1] };
      });
      if (layout.opening) {
        openingStart = layout.opening[0];
        openingTravel = Math.max(1, layout.opening[1] - viewHeight);
      }
      pageScrollMax = Math.max(1, layout.scrollHeight - viewHeight);
      // The opening chain lands on formation 1, so the hero stop must agree —
      // otherwise the first scroll past the hero lerps abruptly back toward 0.
      if (hasOpening && !reducedMotion && sectionStops.length && sectionStops[0].index === 0) {
        sectionStops[0].index = 1;
      }
      if (!sectionStops.length) sectionStops = [{ index: 0, center: viewHeight * 0.5 }];
    }

    function sectionCoordinate(focus) {
      var count = sectionStops.length;
      if (count < 2 || focus <= sectionStops[0].center) return 0;
      if (focus >= sectionStops[count - 1].center) return count - 1;
      for (var i = 0; i < count - 1; i += 1) {
        var next = sectionStops[i + 1];
        if (focus < next.center) {
          var current = sectionStops[i];
          return i + (focus - current.center) / Math.max(1, next.center - current.center);
        }
      }
      return count - 1;
    }

    function stageTarget() {
      if (hasOpening) {
        if (!openingExternallyDriven) {
          openingTarget = clamp((hostScrollY - openingStart) / openingTravel, 0, 1);
        }
        if (openingTarget < 0.999) return openingTarget;
      }
      return (hasOpening ? 1 : 0) + sectionCoordinate(hostScrollY + viewHeight * 0.52);
    }

    function stopFormation(k) {
      return sectionStops[clamp(k, 0, sectionStops.length - 1)].index;
    }

    // Journey units per second, forward. Showcase moments crawl; plateaus
    // where nothing changes on screen are crossed almost instantly.
    function stageSpeed(j) {
      if (hasOpening && j < 1) {
        if (j < 0.16) return 0.15;          // fan stage spools up
        if (j < 0.34) return 0.34;          // fan → K
        if (j < 0.42) return 0.14;          // the Kainz mark holds
        if (j < 0.6) return 0.34;           // K → thrust chamber
        if (j < 0.67) return 0.06;          // chamber assembled, dimensioned
        if (j < 0.74) return 0.2;           // ignition transient
        if (j < 0.88) return 0.07;          // main stage, shock diamonds
        return 0.3;                         // plume → gear train
      }
      var s = j - (hasOpening ? 1 : 0);
      var k = Math.floor(s);
      var t = s - k;
      if (stopFormation(k) === stopFormation(k + 1)) return 6;
      return t > 0.18 && t < 0.82 ? 0.62 : 0.5;
    }

    function readScroll(dtSeconds) {
      scrollState.global = clamp(hostScrollY / pageScrollMax, 0, 1);
      var target = stageTarget();
      var gap = target - stage;
      if (stageSnap) {
        stage = target;
        stageSnap = false;
      } else if (Math.abs(gap) > 1e-5) {
        var limit = stageSpeed(stage) * (gap > 0 ? 1 : 3) * dtSeconds;
        // A long jump between sections catches up instead of touring every
        // mechanism on the way. The opening never hurries: its moments are
        // the point.
        var sectionFloor = hasOpening ? 1 : 0;
        if (stage >= sectionFloor && target >= sectionFloor && Math.abs(gap) > 1.4) {
          limit *= 1 + (Math.abs(gap) - 1.4) * 3;
        }
        var step = gap * (1 - Math.exp(-dtSeconds * 5));
        if (Math.abs(step) > limit) step = gap > 0 ? limit : -limit;
        stage += step;
      }
      if (hasOpening && stage < 1) {
        openingProgress = stage;
        scrollState.a = 0;
        scrollState.b = 0;
        scrollState.mix = 0;
        return;
      }
      if (hasOpening) openingProgress = 1;
      var s = stage - (hasOpening ? 1 : 0);
      var k = Math.floor(s);
      var raw = s - k;
      if (k >= sectionStops.length - 1) {
        scrollState.a = stopFormation(sectionStops.length - 1);
        scrollState.b = scrollState.a;
        scrollState.mix = 0;
        return;
      }
      // Hold each formation, then transition with a pronounced custom curve.
      scrollState.a = stopFormation(k);
      scrollState.b = stopFormation(k + 1);
      scrollState.mix = ease(clamp((raw - 0.18) / 0.64, 0, 1));
    }

    // Resolution governor. The quality governor below reacts to script time,
    // but on phones the cost that actually drops frames is often pixel fill,
    // which script timing never sees. If the field sustains well under 60 fps
    // while its own script cost is modest, the GPU is the bottleneck: step the
    // backing-store density down (never below the floor) and rebuild once.
    var gapSamples = [];
    var governorQuietFrames = 0;
    function resetGovernor(quietFrames) {
      gapSamples.length = 0;
      governorQuietFrames = quietFrames || 0;
    }
    function governResolution(gap) {
      if (reducedMotion || introProgress < 1 || occluded) return;
      if (governorQuietFrames > 0) {
        governorQuietFrames -= 1;
        return;
      }
      if (gap >= 50) return;            // a pause, not a frame
      gapSamples.push(gap);
      if (gapSamples.length < 90) return;
      var sorted = gapSamples.slice().sort(function (a, b) { return a - b; });
      var median = sorted[sorted.length >> 1];
      resetGovernor();
      if (median > 25 && renderCostAverage < median * 0.45) {
        if (compact) {
          // Phones keep their pixels and give up frames: every other vsync
          // still reads as smooth for motion this slow.
          minFrameGap = 30;
        } else if (dpr > dprFloor + 0.05) {
          dprScale *= 0.82;
          setTimeout(resize, 0);
        }
      }
    }

    // rAF entry point. On high-refresh displays the field renders at most every
    // ~10.5 ms — every other vsync at 120 Hz — because its motion is slow and
    // ambient; the halved cost goes to scrolling and the page's own animations.
    var minFrameGap = 10.5;
    function tick(now) {
      frame = 0;
      if (!pageVisible || occluded) return;
      if (now - lastFrame < minFrameGap) {
        frame = raf(tick);
        return;
      }
      render(now);
    }

    // Structure tensor over a 3×3 window of density gradients. Where the
    // local structure is strongly oriented — a silhouette edge or a thin
    // member such as a tube, spoke or blade — the cell draws a stroke along
    // it instead of a density mark, like an edge-aware ASCII renderer.
    function edgeGlyph(idx, cx, cy, density) {
      if (cx < 1 || cy < 1 || cx > rasterCols - 2 || cy > rasterRows - 2 || density < 0.34) return null;
      var jxx = 0;
      var jyy = 0;
      var jxy = 0;
      for (var ty = -1; ty <= 1; ty += 1) {
        var row = idx + ty * rasterCols;
        for (var tx = -1; tx <= 1; tx += 1) {
          var gxv = rasterGX[row + tx];
          var gyv = rasterGY[row + tx];
          jxx += gxv * gxv;
          jyy += gyv * gyv;
          jxy += gxv * gyv;
        }
      }
      var trace = jxx + jyy;
      if (trace < density * density * 1.6 + 0.06) return null;
      var diff = jxx - jyy;
      if (Math.sqrt(diff * diff + 4 * jxy * jxy) < trace * 0.45) return null;
      var sector = Math.round((0.5 * Math.atan2(2 * jxy, diff) + Math.PI / 2) * 4 / Math.PI);
      return edgeSprites[((sector % 4) + 4) % 4];
    }

    function blend(fa, fb, key, mix) {
      return fa[key] + (fb[key] - fa[key]) * mix;
    }

    var CUT_PERIOD = 20;
    var CUT_TIME = 4.5;

    function render(now) {
      // render is invoked both by rAF and synchronously (resize/refresh);
      // cancelling any pending frame prevents duplicate rAF chains from
      // stacking up and multiplying the per-frame cost.
      if (frame) caf(frame);
      frame = 0;
      if (!pageVisible || occluded) return;

      var gap = now - lastFrame;
      var dt = clamp(gap, 1, 50);
      lastFrame = now;
      governResolution(gap);
      var dtSeconds = dt / 1000;
      if (!reducedMotion) {
        readScroll(dtSeconds);
        if (Math.abs(stage - reportedStage) > 0.0004) {
          reportedStage = stage;
          emit({ type: "stage", stage: stage });
        }
      }
      scrollEnergy *= Math.exp(-dtSeconds * 4.1);
      scrollBias *= Math.exp(-dtSeconds * 3.4);
      pointer.swirl *= Math.exp(-dtSeconds * 2.6);
      var renderStarted = performance.now();

      ctx.clearRect(0, 0, width, height);

      var time = reducedMotion ? 2.1 : now / 1000;
      var motionTime = reducedMotion ? 2.1 : time * 0.46;
      var openingPhase = hasOpening ? openingProgress : 1;
      var openingWindow = clamp((openingPhase - 0.16) / 0.68, 0, 1);
      var openingEnergy = reducedMotion ? 0 :
        Math.pow(Math.max(0, Math.sin(openingWindow * Math.PI)), 1.4);
      var openingDrive = openingEnergy * 0.34 + scrollEnergy * 0.17;
      var openingRamp = ease(clamp((openingPhase - 0.1) / 0.4, 0, 1));
      var openingSettle = ease(clamp((openingPhase - 0.72) / 0.28, 0, 1));
      var peakOpeningScale = compact ? 1.04 : medium ? 1.07 : 1.1;
      var openingScale = 1 + (peakOpeningScale - 1) * openingRamp * (1 - openingSettle);
      // During the visible K handoff, both the DOM mark and the sampled particle
      // mark share one pose. The lock releases gradually as the K disperses.
      var kHandoffLock = hasOpening && kFormation && !reducedMotion ?
        ease(clamp((openingPhase - 0.2) / 0.12, 0, 1)) *
        (1 - ease(clamp((openingPhase - 0.46) / 0.16, 0, 1))) : 0;
      var kHandoffDrift = Math.sin(clamp((openingPhase - 0.3) / 0.3, 0, 1) * Math.PI * 0.5);

      // Which two formations are on stage, and how far between them.
      var fA = formations[scrollState.a];
      var fB = formations[scrollState.b];
      var mix = scrollState.mix;
      if (hasOpening && openingPhase < 0.999) {
        if (kFormation) {
          // Fan stage → the Kainz mark → thrust chamber → ignition → gears.
          if (openingPhase < 0.38) {
            fA = formations[0];
            fB = kFormation;
            mix = ease(clamp((openingPhase - 0.16) / 0.18, 0, 1));
          } else if (openingPhase < 0.64) {
            fA = kFormation;
            fB = engine;
            mix = ease(clamp((openingPhase - 0.42) / 0.18, 0, 1));
          } else if (openingPhase < 0.88) {
            fA = engine;
            fB = ignition;
            mix = ease(clamp((openingPhase - 0.67) / 0.07, 0, 1));
          } else {
            fA = ignition;
            fB = formations[1];
            mix = ease(clamp((openingPhase - 0.88) / 0.12, 0, 1));
          }
        } else if (openingPhase < 0.64) {
          fA = formations[0];
          fB = engine;
          mix = ease(clamp((openingPhase - 0.16) / 0.44, 0, 1));
        } else if (openingPhase < 0.88) {
          fA = engine;
          fB = ignition;
          mix = ease(clamp((openingPhase - 0.67) / 0.07, 0, 1));
        } else {
          fA = ignition;
          fB = formations[1];
          mix = ease(clamp((openingPhase - 0.88) / 0.12, 0, 1));
        }
      }
      var dominant = mix < 0.5 ? fA : fB;
      // A quarter-turned formation trades its yaw and pitch, so the same tilt
      // still shows its hoops and faces in 3-D.
      var rotA = portraitMode && fA.portrait;
      var rotB = portraitMode && fB.portrait;
      var viewYawA = rotA ? fA.pitch : fA.yaw;
      var viewYawB = rotB ? fB.pitch : fB.yaw;
      var viewPitchA = rotA ? fA.yaw : fA.pitch;
      var viewPitchB = rotB ? fB.yaw : fB.pitch;
      view.rot90 = portraitMode && dominant.portrait;

      // Drive state. Scroll is the throttle; scrolling also turns the gears.
      var throttle = 1 + scrollEnergy * 1.4 + openingDrive * 0.5;
      var scrollDelta = signedScrollPhase - appliedScrollPhase;
      appliedScrollPhase = signedScrollPhase;
      var ignitionLevel = hasOpening && !reducedMotion ?
        band(0.67, 0.74, openingPhase) * (1 - band(0.9, 0.98, openingPhase)) : 0;
      env.t = motionTime;
      env.ign = ignitionLevel;
      env.clock = Math.max(0, openingPhase - 0.69) * 14;
      if (!reducedMotion) {
        // The fan stage spools up through the first beat of the opening.
        var spool = hasOpening ? 1 + band(0.02, 0.16, openingPhase) * 1.6 : 1;
        env.spinRate = 0.5 * throttle * spool;
        env.gearRate = 0.2 * throttle + scrollDelta * 0.7 / Math.max(0.008, dtSeconds);
        env.spin += dtSeconds * env.spinRate;
        env.gear += dtSeconds * 0.2 * throttle + scrollDelta * 0.7;
        env.slow += dtSeconds * 0.3 * (1 + scrollEnergy * 0.5);
        env.flow += dtSeconds * 0.42 * throttle;
        env.fly += dtSeconds * 0.1 * throttle;
      }
      if (fA.frame) fA.frame(env);
      if (fB !== fA && fB.frame) fB.frame(env);

      var centerX = width * (compact ? 0.54 : 0.51) +
        (reducedMotion ? 0 :
          Math.sin(motionTime * 0.14 + scrollState.global * 3.2) * width * 0.005 +
          Math.sin(openingPhase * Math.PI * 2) * width * 0.008 * openingEnergy);
      var driftY = viewHeight * (0.42 + scrollState.global * 0.16 +
        Math.sin(scrollState.global * Math.PI * 5) * 0.018);
      var anchorA = rotA ? fA.portraitAnchorY : fA.anchorY;
      var anchorB = rotB ? fB.portraitAnchorY : fB.anchorY;
      var targetA = anchorA >= 0 ? viewHeight * anchorA : driftY + viewHeight * fA.shift;
      var targetB = anchorB >= 0 ? viewHeight * anchorB : driftY + viewHeight * fB.shift;
      var centerY = targetA + (targetB - targetA) * mix +
        (reducedMotion ? 0 : Math.sin(motionTime * 0.1) * viewHeight * 0.004);
      var baseScale = Math.min(width, viewHeight) * (compact ? 0.46 : 0.405) *
        openingScale * blend(fA, fB, compact ? "compactZoom" : "zoom", mix) *
        (reducedMotion ? 1 : 1 + Math.sin(motionTime * 0.38) * 0.005 + scrollEnergy * 0.008);
      if (kHandoffLock > 0.001) {
        var targetKHeight = Math.min(viewHeight * 0.55, width * 0.54);
        var targetKScale = targetKHeight / (1.2 * (2.85 / 3.1));
        var lockedCenterX = width * 0.51;
        var lockedCenterY = viewHeight * 0.45 - kHandoffDrift * 30;
        centerX += (lockedCenterX - centerX) * kHandoffLock;
        centerY += (lockedCenterY - centerY) * kHandoffLock;
        baseScale += (targetKScale - baseScale) * kHandoffLock;
      }
      var yaw = viewYawA + (viewYawB - viewYawA) * mix + (scrollState.global - 0.5) * 0.34 +
        (reducedMotion ? 0 :
          Math.sin(motionTime * 0.17) * 0.03 + scrollEnergy * 0.02 +
          openingEnergy * Math.sin(openingPhase * Math.PI * 2) * 0.03);
      var pitch = viewPitchA + (viewPitchB - viewPitchA) * mix + (reducedMotion ? 0 :
        Math.cos(motionTime * 0.13) * 0.018);
      // The whole projection banks slightly with scroll momentum.
      var roll = reducedMotion ? 0 : Math.sin(motionTime * 0.11) * 0.006 + scrollBias * 0.02;
      yaw *= 1 - kHandoffLock;
      pitch *= 1 - kHandoffLock;
      roll *= 1 - kHandoffLock;
      var cosYaw = Math.cos(yaw);
      var sinYaw = Math.sin(yaw);
      var cosPitch = Math.cos(pitch);
      var sinPitch = Math.sin(pitch);
      var cosRoll = Math.cos(roll);
      var sinRoll = Math.sin(roll);
      view.cx = centerX;
      view.cy = centerY;
      view.scale = baseScale;
      view.cosYaw = cosYaw;
      view.sinYaw = sinYaw;
      view.cosPitch = cosPitch;
      view.sinPitch = sinPitch;
      view.cosRoll = cosRoll;
      view.sinRoll = sinRoll;

      var morphEnergy = reducedMotion ? 0 : Math.sin(mix * Math.PI);
      var morphActive = mix > 0.0001 && mix < 0.9999;
      var intro = ease(introProgress);
      var pointerAge = Math.max(0, time - pointer.moved);
      var proximityStrength = !reducedMotion && pointer.active ? Math.exp(-pointerAge * 1.35) : 0;
      var pointerRadius = compact ? 112 : 172;
      // A moving inspection highlight, like an ultrasonic probe crossing the
      // part.
      var packetCenterX = Math.sin(motionTime * 0.25 + scrollState.global * 4.2) * 0.62;
      var packetCenterY = Math.cos(motionTime * 0.22 - scrollState.global * 2.8) * 0.46;
      var packetCenterZ = Math.sin(motionTime * 0.18 + 1.4) * 0.38;
      var openingShockProgress = clamp((openingPhase - 0.2) / 0.58, 0, 1);
      var openingShockFront = 0.12 + openingShockProgress * 2.4;
      // While the field spells the Kainz mark, ambient motion quiets down so
      // the glyph reads crisp, then releases as it disperses.
      var kWindow = 0;
      if (hasOpening && kFormation && !reducedMotion && openingPhase < 0.999) {
        kWindow = ease(clamp((openingPhase - 0.16) / 0.16, 0, 1)) *
          (1 - ease(clamp((openingPhase - 0.44) / 0.18, 0, 1)));
      }
      var particleStride = quality === 0 ? 2 : 1;
      var driftScale = blend(fA, fB, "drift", mix);
      var tracerStroke = !reducedMotion && dominant.tracerStroke > 0;
      var splatSpread = quality === 0 ? 0 : 1;
      // Density normalisation keeps the raster exposure stable whenever the
      // particle budget is reduced.
      var densityGain = particleStride;
      var fluidOn = fluidEnabled && fluid.u && fluid.cols === rasterCols && fluid.rows === rasterRows;
      var fluidU = fluidOn ? fluid.u : null;
      var fluidV = fluidOn ? fluid.v : null;
      var freestream = (compact ? 6 : 7.5) * blend(fA, fB, "wind", mix) * (1 + scrollEnergy * 1.8);

      var activeRipples = [];
      for (var rippleIndex = ripples.length - 1; rippleIndex >= 0; rippleIndex -= 1) {
        var rippleAge = time - ripples[rippleIndex].born;
        if (rippleAge > 1.65) {
          ripples.splice(rippleIndex, 1);
        } else if (!reducedMotion) {
          var rippleFront = rippleAge * (compact ? 170 : 235);
          var rippleWidth = 38;
          activeRipples.push({
            x: ripples[rippleIndex].x,
            y: ripples[rippleIndex].y,
            front: rippleFront,
            inner2: Math.pow(Math.max(0, rippleFront - rippleWidth * 3), 2),
            outer2: Math.pow(rippleFront + rippleWidth * 3, 2),
            decay: Math.exp(-rippleAge * 1.45) * ripples[rippleIndex].strength
          });
        }
      }

      rasterDensity.fill(0);
      rasterFlowX.fill(0);
      rasterFlowY.fill(0);
      rasterTracer.fill(0);
      var foundBox = false;
      var boxL = 1e9;
      var boxR = -1e9;
      var boxT = 1e9;
      var boxB = -1e9;
      var boxLY = 0;
      var boxRY = 0;
      var boxTX = 0;
      var boxBX = 0;

      var sampleCount = 0;
      rasterNear.fill(1e9);
      for (var i = 0; i < particleCount; i += particleStride) {
        var localMix = mix;
        var x;
        var y;
        var z;
        var presence;
        var heat;
        var tracer;
        if (!morphActive) {
          evalMotion(mix < 0.5 ? fA : fB, i);
          x = OUT[0];
          y = OUT[1];
          z = OUT[2];
          presence = OUT[3];
          heat = OUT[4];
          tracer = OUT[5];
        } else {
          // Build sweep: the next mechanism assembles along a moving front,
          // like a print head crossing the build plate, so each sample joins
          // when the front reaches its own target position.
          evalMotion(fB, i);
          var bx = OUT[0];
          var by = OUT[1];
          var bz = OUT[2];
          var bPresence = OUT[3];
          var bHeat = OUT[4];
          var bTracer = OUT[5];
          var sweepU = clamp(((rotB ? by : bx) + 1.7) / 3.4, 0, 1);
          localMix = ease(clamp((mix - sweepU * 0.5 - seedB[i] * 0.12) / 0.38, 0, 1));
          evalMotion(fA, i);
          x = OUT[0] + (bx - OUT[0]) * localMix;
          y = OUT[1] + (by - OUT[1]) * localMix;
          z = OUT[2] + (bz - OUT[2]) * localMix;
          presence = OUT[3] + (bPresence - OUT[3]) * localMix;
          heat = OUT[4] + (bHeat - OUT[4]) * localMix;
          tracer = localMix > 0.5 ? bTracer : OUT[5];
        }
        if (presence < 0.02) {
          prevScreenX[i] = -9999;
          continue;
        }
        var localMorph = morphActive ? Math.sin(localMix * Math.PI) : 0;
        var openingBand = 0;

        if (!reducedMotion) {
          // Mid-morph the swarm swirls through a seeded vortex before it
          // settles into the next mechanism.
          if (localMorph > 0.004) {
            var swirlAngle = localMorph * (seedC[i] - 0.5) * 0.7;
            var swirlCos = Math.cos(swirlAngle);
            var swirlSin = Math.sin(swirlAngle);
            var swirlX = x * swirlCos - y * swirlSin;
            y = x * swirlSin + y * swirlCos;
            x = swirlX;
            z += localMorph * (seedA[i] - 0.5) * 0.3;
            x += Math.sin(motionTime * 1.22 + phase[i] + y * 3.8) * localMorph * (0.011 + seedA[i] * 0.016);
            y += Math.cos(motionTime * 1.02 + phase[i] * 1.17 + z * 3.2) * localMorph * (0.01 + seedB[i] * 0.015);
          }

          // A reversible shock front travels out from the core during the
          // field-only scroll beat of the opening.
          if (openingEnergy > 0.002) {
            var openingRadius = Math.sqrt(x * x + y * y + z * z) + 0.001;
            openingBand = Math.exp(-Math.pow((openingRadius - openingShockFront) / 0.2, 2)) *
              openingEnergy;
            var shockDisplacement = openingBand * (0.014 + scrollEnergy * 0.01);
            x += x / openingRadius * shockDisplacement;
            y += y / openingRadius * shockDisplacement;
            z += z / openingRadius * shockDisplacement;
          }
        }

        // Mechanisms stay crisp: only a whisper of thermal drift.
        var drift = reducedMotion ? 0 :
          (0.003 + seedB[i] * 0.004) * (1 - kWindow * 0.85) * driftScale + localMorph * 0.01;
        x += Math.sin(motionTime * (0.61 + seedA[i] * 0.43) + phase[i]) * drift;
        y += Math.cos(motionTime * (0.52 + seedC[i] * 0.38) + phase[i] * 1.23) * drift;
        z += Math.sin(motionTime * 0.68 + phase[i] * 0.73) * drift * 1.52;

        if (intro < 0.999) {
          var scatter = (1 - intro) * (1.9 + seedC[i] * 2.7);
          x += (seedA[i] - 0.5) * scatter * 3.1;
          y += (seedB[i] - 0.5) * scatter * 2.2;
          z += (seedC[i] - 0.5) * scatter * 2.2;
        }

        var rotatedX = x * cosYaw - z * sinYaw;
        var rotatedZ = x * sinYaw + z * cosYaw;
        var rotatedY = y * cosPitch - rotatedZ * sinPitch;
        rotatedZ = y * sinPitch + rotatedZ * cosPitch;
        if (roll) {
          var rolledX = rotatedX * cosRoll - rotatedY * sinRoll;
          rotatedY = rotatedX * sinRoll + rotatedY * cosRoll;
          rotatedX = rolledX;
        }
        var perspective = 2.85 / (3.1 + rotatedZ);
        var px = centerX + rotatedX * baseScale * perspective;
        var py = centerY + rotatedY * baseScale * perspective;

        if (proximityStrength > 0.015) {
          var dx = px - pointer.x;
          var dy = py - pointer.y;
          var distanceSquared = dx * dx + dy * dy;
          if (distanceSquared < pointerRadius * pointerRadius && distanceSquared > 0.25) {
            var distance = Math.sqrt(distanceSquared);
            var influence = Math.pow(1 - distance / pointerRadius, 2) * proximityStrength;
            var radialPush = influence * 9;
            // Pointer velocity feeds a decaying vortex: sweeping the field
            // drags a visible swirl behind the cursor.
            var phaseShear = influence * (4 + pointer.swirl * 18);
            px += dx / distance * radialPush - dy / distance * phaseShear;
            py += dy / distance * radialPush + dx / distance * phaseShear;
          }
        }

        for (rippleIndex = 0; rippleIndex < activeRipples.length; rippleIndex += 1) {
          var ripple = activeRipples[rippleIndex];
          var rdx = px - ripple.x;
          var rdy = py - ripple.y;
          var radialSquared = rdx * rdx + rdy * rdy;
          if (radialSquared < ripple.inner2 || radialSquared > ripple.outer2) continue;
          var radial = Math.sqrt(radialSquared);
          var rippleBand = Math.exp(-Math.pow((radial - ripple.front) / 38, 2)) * ripple.decay;
          if (rippleBand > 0.005 && radial > 0.5) {
            px += rdx / radial * rippleBand * 14;
            py += rdy / radial * rippleBand * 14;
          }
        }

        // Two-way coupling: gusts in the air (pointer wakes, the plume, click
        // blasts) buffet the glyphs; the steady freestream does not.
        if (fluidU) {
          var fcx = (px / cellSize) | 0;
          var fcy = (py / cellSize) | 0;
          if (fcx >= 0 && fcx < rasterCols && fcy >= 0 && fcy < rasterRows) {
            var fidx = fcy * rasterCols + fcx;
            px += clamp(fluidU[fidx] - freestream, -40, 40) * 0.1;
            py += clamp(fluidV[fidx], -40, 40) * 0.1;
          }
        }

        if (!tracer && presence > 0.5 && intro > 0.98) {
          if (px < boxL) { boxL = px; boxLY = py; }
          if (px > boxR) { boxR = px; boxRY = py; }
          if (py < boxT) { boxT = py; boxTX = px; }
          if (py > boxB) { boxB = py; boxBX = px; }
          foundBox = true;
        }

        if (px < -24 || px > width + 24 || py < -24 || py > height + 24) {
          prevScreenX[i] = px;
          prevScreenY[i] = py;
          continue;
        }

        var packetDx = x - packetCenterX;
        var packetDy = y - packetCenterY;
        var packetDz = z - packetCenterZ;
        var packet = Math.exp(-(packetDx * packetDx * 1.55 + packetDy * packetDy * 1.82 +
          packetDz * packetDz * 1.25));
        // The build front runs hot, like a melt pool under the laser.
        var probability = clamp(0.1 + heat * 0.66 + packet * 0.05 +
          localMorph * 0.32 + scrollEnergy * 0.03 +
          openingBand * 0.24 + kWindow * 0.3, 0, 1) * presence;
        var depth = clamp((perspective - 0.58) / 0.8, 0, 1);

        // Splat density and screen velocity onto the glyph raster.
        var velocityX = px - prevScreenX[i];
        var velocityY = py - prevScreenY[i];
        prevScreenX[i] = px;
        prevScreenY[i] = py;
        if (velocityX * velocityX + velocityY * velocityY > 2600) {
          // Teleporting samples (first frame, wraps, snaps) carry no flow.
          velocityX = 0;
          velocityY = 0;
        }
        var cellX = (px / cellSize) | 0;
        var cellY = (py / cellSize) | 0;
        if (cellX < 0 || cellX >= rasterCols || cellY < 0 || cellY >= rasterRows) continue;
        var cellIndex = cellY * rasterCols + cellX;
        if (rotatedZ < rasterNear[cellIndex]) rasterNear[cellIndex] = rotatedZ;
        sampleCell[sampleCount] = cellIndex;
        sampleX[sampleCount] = px;
        sampleY[sampleCount] = py;
        sampleZ[sampleCount] = rotatedZ;
        sampleWeight[sampleCount] = probability * (0.32 + depth * 0.68) * 1.45 * densityGain;
        sampleVX[sampleCount] = velocityX;
        sampleVY[sampleCount] = velocityY;
        // A stable subset of samples draws as crisp measurement marks. The
        // subset never reshuffles over time, so nothing twinkles.
        var alpha = 0;
        if (seedA[i] <= probability * 0.85 + 0.05) {
          alpha = clamp((0.12 + probability * 0.72) * (0.34 + depth * 0.8) *
            intro * presence, 0, 0.9);
          if (intro < 0.38) alpha *= intro / 0.38;
          // Streamline tracers read as lines, not as a scatter of crosses.
          if (tracer && tracerStroke) alpha *= 0.3;
        }
        sampleAlpha[sampleCount] = alpha;
        sampleTracer[sampleCount] = tracer ? 1 : 0;
        // Mark: size bucket * 5 + glyph (0–3 crosses, 4 diameter mark).
        sampleMark[sampleCount] = (depth < 0.36 ? 0 : depth < 0.72 ? 5 : 10) +
          (i % 97 === 0 ? 4 : (heat > 0.62 ? 2 : 0) + (seedC[i] > 0.5 ? 1 : 0));
        sampleCount += 1;
      }

      // Dilate the depth buffer one cell, so the front surface of a sparse
      // point cloud still counts as a surface.
      for (var ny = 0; ny < rasterRows; ny += 1) {
        var nRow = ny * rasterCols;
        for (var nx = 0; nx < rasterCols; nx += 1) {
          var nearest = rasterNear[nRow + nx];
          for (var oy = ny > 0 ? -1 : 0; oy <= (ny < rasterRows - 1 ? 1 : 0); oy += 1) {
            var oRow = nRow + oy * rasterCols;
            for (var ox = nx > 0 ? -1 : 0; ox <= (nx < rasterCols - 1 ? 1 : 0); ox += 1) {
              var candidate = rasterNear[oRow + nx + ox];
              if (candidate < nearest) nearest = candidate;
            }
          }
          rasterNearDil[nRow + nx] = nearest;
        }
      }

      // Second pass: hidden-line splat. Samples well behind the front surface
      // of their cell fade back, like hidden edges in a CAD view.
      for (var si = 0; si < sampleCount; si += 1) {
        var sCell = sampleCell[si];
        var behind = sampleZ[si] - rasterNearDil[sCell];
        var fade = behind < 0.12 ? 1 : behind > 0.42 ? 0.26 : 1 - (behind - 0.12) / 0.3 * 0.74;
        var w = sampleWeight[si] * fade;
        rasterDensity[sCell] += w;
        rasterFlowX[sCell] += sampleVX[si] * w;
        rasterFlowY[sCell] += sampleVY[si] * w;
        if (sampleTracer[si]) rasterTracer[sCell] += w;
        if (splatSpread) {
          var spill = w * 0.2;
          var scx = sCell % rasterCols;
          if (scx > 0) rasterDensity[sCell - 1] += spill;
          if (scx < rasterCols - 1) rasterDensity[sCell + 1] += spill;
          if (sCell >= rasterCols) rasterDensity[sCell - rasterCols] += spill;
          if (sCell < rasterDensity.length - rasterCols) rasterDensity[sCell + rasterCols] += spill;
        }
        var markAlpha = sampleAlpha[si] * fade * fade;
        if (compact) {
          // Phones draw the marks after the raster pass, in empty cells only.
          sampleAlpha[si] = markAlpha;
          continue;
        }
        if (markAlpha < 0.02) continue;
        // Three baked sizes, each drawn 1:1 in device pixels and snapped to
        // the pixel grid — no resampling blur.
        var code = sampleMark[si];
        var mark = glyphs[(code / 5) | 0][code % 5];
        var half = mark.width * 0.5;
        ctx.globalAlpha = markAlpha;
        ctx.drawImage(mark, Math.round(sampleX[si] * dpr - half) / dpr,
          Math.round(sampleY[si] * dpr - half) / dpr, mark.width / dpr, mark.height / dpr);
      }

      // Flow solver step, fed by this frame's mechanism raster.
      if (fluidOn) {
        var fdt = Math.min(dtSeconds, 1 / 30);
        var rakeTop = 0;
        var rakeBottom = -1;
        if (bbox.valid) {
          var extent = (bbox.b - bbox.t) * 0.3 + 30;
          rakeTop = Math.max(1, Math.floor((bbox.t - extent) / cellSize));
          rakeBottom = Math.min(rasterRows - 2, Math.ceil((bbox.b + extent) / cellSize));
        }
        // Pointer smoke: splat along the swept segment so a fast flick still
        // leaves an unbroken trail.
        if (pointer.pending) {
          pointer.pending = false;
          if (pointer.fx >= 0) {
            var sdx = pointer.x - pointer.fx;
            var sdy = pointer.y - pointer.fy;
            var sweep = Math.sqrt(sdx * sdx + sdy * sdy);
            var steps = Math.min(24, Math.max(1, Math.ceil(sweep / (cellSize * 1.4))));
            var speed = Math.sqrt(pointer.vx * pointer.vx + pointer.vy * pointer.vy) / cellSize;
            var push = Math.min(1, 50 / Math.max(1, speed));
            for (var s = 1; s <= steps; s += 1) {
              var t = s / steps;
              splat((pointer.fx + sdx * t) / cellSize, (pointer.fy + sdy * t) / cellSize,
                compact ? 1.7 : 2.1,
                pointer.vx / cellSize * 0.2 * push / steps * 2.2,
                pointer.vy / cellSize * 0.2 * push / steps * 2.2,
                Math.min(0.5, speed * 0.012) / Math.sqrt(steps), 0);
            }
          }
          pointer.fx = pointer.x;
          pointer.fy = pointer.y;
        }
        for (var bi = 0; bi < bursts.length; bi += 1) {
          var burst = bursts[bi];
          splat(burst[0] / cellSize, burst[1] / cellSize, 2.6, burst[2], 0, burst[3], 2);
        }
        bursts.length = 0;
        // Ignition: the chamber exhausts a real jet into the solver.
        if (ignitionLevel > 0.01) {
          var jetFrom = engineToField(0, ENG_EXIT, 0, [0, 0, 0]);
          var jetTo = engineToField(0, ENG_EXIT + 0.4, 0, [0, 0, 0]);
          project(jetFrom[0], jetFrom[1], jetFrom[2], PA);
          project(jetTo[0], jetTo[1], jetTo[2], PB);
          var jdx = PB[0] - PA[0];
          var jdy = PB[1] - PA[1];
          var jl = Math.sqrt(jdx * jdx + jdy * jdy) || 1;
          var jetSpeed = 42 * ignitionLevel * (1 + scrollEnergy * 0.8);
          var exitRadius = ENG_RE * ENG_S * baseScale * PA[2] / cellSize;
          var wobble = Math.sin(time * 9.1) * 0.25 + Math.sin(time * 5.3) * 0.2;
          splat(PA[0] / cellSize + 0.4 * jdx / jl, PA[1] / cellSize + 0.4 * jdy / jl,
            Math.max(1.4, exitRadius * 0.62),
            jdx / jl * jetSpeed, (jdy / jl + wobble * 0.18) * jetSpeed, 0.26 * ignitionLevel, 1);
        }
        var rakeLevel = blend(fA, fB, "rake", mix);
        fluidStep(fdt, dtSeconds, {
          ux: freestream,
          uy: -scrollBias * 1.5,
          solid: blend(fA, fB, "solid", mix) * (1 - kWindow * 0.6),
          emit: morphEnergy * 0.35,
          rake: rakeLevel > 0.02 ? (0.5 + 0.4 * rakeLevel) * (1 - kWindow) : 0,
          rakeTop: rakeTop,
          rakeBottom: rakeBottom,
          rakeSpacing: compact ? 6 : 5,
          confine: quality === 2 ? 9 : quality === 1 ? 6 : 0,
          iters: (quality === 2 ? 14 : 8) - (fluid.n > 14000 ? 4 : 0),
          decay: 0.3
        });
      }

      // Drafting visibility: only a settled mechanism gets dimensioned.
      var settle = 1 - morphEnergy;
      var draftAlpha = Math.pow(settle, 3) * intro * (1 - kWindow) *
        (dominant === kFormation ? 0 : 1) * (dominant.guides ? 1 : 0);
      var cutX = -99999;
      var cutAge = frac((time + 5) / CUT_PERIOD) * CUT_PERIOD;
      if (!reducedMotion && dominant.dims && bbox.valid && draftAlpha > 0.5 && cutAge < CUT_TIME) {
        cutX = bbox.l - 14 + (bbox.r - bbox.l + 28) * ease(cutAge / CUT_TIME);
      }

      // Glyph raster pass — the body of the field. Cells sit on a fixed
      // character grid: mechanism density picks the glyph, coherent motion
      // replaces it with a stroke, the section cut hatches it, and where no
      // hardware is, the smoke shows.
      var rasterAlphaBase = intro * (compact ? 0.94 : 0.86);
      var cellFloor = compact ? 0.15 : 0.1;
      var smokeMin = compact ? 0.16 : 0.12;
      if (rasterAlphaBase > 0.02) {
        var flowThreshold2 = Math.pow(dt * 0.062, 2);
        var dye = fluidOn ? fluid.dye : null;
        var smokeU = fluidOn ? fluid.u : null;
        var smokeV = fluidOn ? fluid.v : null;
        var curl = fluidOn ? fluid.curl : null;
        var smokeAlphaBase = rasterAlphaBase * 0.95 * blend(fA, fB, "haze", mix);
        var cutCellMin = cutX > -9999 ? cutX - cellSize * 1.4 : 1e9;
        var cutCellMax = cutX > -9999 ? cutX + cellSize * 0.4 : -1e9;
        // Density gradients for the structure tensor below.
        for (var gy = 1; gy < rasterRows - 1; gy += 1) {
          var gRow = gy * rasterCols;
          for (var gx = 1; gx < rasterCols - 1; gx += 1) {
            var gi = gRow + gx;
            rasterGX[gi] = rasterDensity[gi + 1] - rasterDensity[gi - 1];
            rasterGY[gi] = rasterDensity[gi + rasterCols] - rasterDensity[gi - rasterCols];
          }
        }
        for (var cy = 0; cy < rasterRows; cy += 1) {
          var rowOffset = cy * rasterCols;
          var drawY = cy * cellSize;
          for (var cx = 0; cx < rasterCols; cx += 1) {
            var idx = rowOffset + cx;
            var density = rasterDensity[idx];
            var sprite;
            var cellAlpha;
            if (density >= 0.24) {
              cellAlpha = Math.min(0.9, cellFloor + density * 0.4) * rasterAlphaBase;
              if (cellAlpha < 0.02) continue;
              var drawX = cx * cellSize;
              var flowX = rasterFlowX[idx];
              var flowY = rasterFlowY[idx];
              var flowScale = density > 0.001 ? 1 / density : 0;
              var meanFlowX = flowX * flowScale;
              var meanFlowY = flowY * flowScale;
              var speed2 = meanFlowX * meanFlowX + meanFlowY * meanFlowY;
              if (density > 0.5 && drawX >= cutCellMin && drawX <= cutCellMax) {
                sprite = hatchSprite;
                cellAlpha = Math.min(0.85, cellAlpha * 1.6);
              } else if (tracerStroke && rasterTracer[idx] > density * 0.6) {
                // Streamlines: one thin stroke per cell along the local
                // flow, so each line reads as a continuous drawn curve.
                var tracerSector = Math.round(Math.atan2(meanFlowY, meanFlowX) * 4 / Math.PI);
                sprite = speed2 > flowThreshold2 * 0.25 ? smokeSprites[(tracerSector + 8) % 4] : smokeDot;
                cellAlpha = Math.min(0.62, cellAlpha * 1.1);
              } else if (!reducedMotion && speed2 > flowThreshold2 && density > 0.55) {
                var sector = Math.round(Math.atan2(meanFlowY, meanFlowX) * 4 / Math.PI);
                sprite = directionSprites[(sector + 8) % 8];
                cellAlpha = Math.min(0.82, cellAlpha * 1.35);
              } else if ((sprite = edgeGlyph(idx, cx, cy, density))) {
                cellAlpha = Math.min(0.95, cellAlpha * 1.25 + 0.08);
              } else if (density < 0.45) {
                sprite = rampSprites[0];
              } else if (density < 0.8) {
                sprite = rampSprites[1];
              } else {
                var bit = fastHash(idx * 31) > 0.5 ? 1 : 0;
                sprite = rampSprites[density < 2.05 ? 2 + bit : 4 + bit];
              }
              ctx.globalAlpha = cellAlpha;
              ctx.drawImage(sprite, drawX, drawY, cellSize, cellSize);
            } else if (dye) {
              var smoke = dye[idx];
              if (smoke < smokeMin) continue;
              var su = smokeU[idx];
              var sv = smokeV[idx];
              // Thin the smoke to ridge lines across the local flow, so
              // streaks stay one glyph wide instead of smearing into bands.
              if (smoke < 0.62) {
                var horizontal = Math.abs(su) >= Math.abs(sv);
                var n1 = horizontal ? (cy > 0 ? dye[idx - rasterCols] : 0) : (cx > 0 ? dye[idx - 1] : 0);
                var n2 = horizontal ? (cy < rasterRows - 1 ? dye[idx + rasterCols] : 0) :
                  (cx < rasterCols - 1 ? dye[idx + 1] : 0);
                if (smoke < n1 || smoke < n2) continue;
              }
              if (smoke < 0.18) {
                sprite = smokeDot;
              } else if (curl && Math.abs(curl[idx]) > 2.6 && smoke > 0.3) {
                sprite = smokeCurl;
              } else {
                var smokeSector = Math.round(Math.atan2(sv, su) * 4 / Math.PI);
                sprite = smokeSprites[(smokeSector + 8) % 4];
              }
              ctx.globalAlpha = Math.min(0.42, 0.06 + smoke * 0.4) * smokeAlphaBase;
              ctx.drawImage(sprite, cx * cellSize, drawY, cellSize, cellSize);
            }
          }
        }
      }
      // Phones: scatter marks only where the raster left the cell empty.
      // Piled on top of grid glyphs at phone scale they read as dust over
      // the drawing, which the eye takes for blur; around the silhouette they
      // read as the measured point cloud.
      if (compact) {
        for (var mi = 0; mi < sampleCount; mi += 1) {
          var mAlpha = sampleAlpha[mi];
          if (mAlpha < 0.02 || rasterDensity[sampleCell[mi]] >= 0.24) continue;
          var mCode = sampleMark[mi];
          var mMark = glyphs[(mCode / 5) | 0][mCode % 5];
          var mHalf = mMark.width * 0.5;
          ctx.globalAlpha = mAlpha;
          ctx.drawImage(mMark, Math.round(sampleX[mi] * dpr - mHalf) / dpr,
            Math.round(sampleY[mi] * dpr - mHalf) / dpr, mMark.width / dpr, mMark.height / dpr);
        }
      }
      if (foundBox) {
        bboxRaw.l = boxL; bboxRaw.r = boxR; bboxRaw.t = boxT; bboxRaw.b = boxB;
        bboxRaw.ly = boxLY; bboxRaw.ry = boxRY;
        bboxRaw.tx = boxTX; bboxRaw.bx = boxBX;
        var smooth = bbox.valid && !reducedMotion ? 1 - Math.exp(-dtSeconds * 7) : 1;
        bbox.l += (bboxRaw.l - bbox.l) * smooth;
        bbox.r += (bboxRaw.r - bbox.r) * smooth;
        bbox.t += (bboxRaw.t - bbox.t) * smooth;
        bbox.b += (bboxRaw.b - bbox.b) * smooth;
        bbox.ly += (bboxRaw.ly - bbox.ly) * smooth;
        bbox.ry += (bboxRaw.ry - bbox.ry) * smooth;
        bbox.tx += (bboxRaw.tx - bbox.tx) * smooth;
        bbox.bx += (bboxRaw.bx - bbox.bx) * smooth;
        bbox.valid = true;
      }

      drawDrafting(dominant, draftAlpha, time, cutX);
      if (morphActive && !reducedMotion && morphEnergy > 0.06 && intro > 0.9 && fB !== kFormation) {
        var frontU = clamp((mix - 0.25) / 0.5, 0, 1);
        var savedRot = view.rot90;
        view.rot90 = rotB;
        project(frontU * 3.4 - 1.7, 0, 0, PA);
        view.rot90 = savedRot;
        drawBuildFront(rotB ? PA[1] : PA[0], rotB, frontU * 100, morphEnergy * intro);
      }

      ctx.globalAlpha = 1;
      var renderCost = performance.now() - renderStarted;
      renderCostAverage = renderCostAverage * 0.94 + renderCost * 0.06;
      if (quality === 2 && renderCostAverage > (compact ? 10.5 : 12.5)) quality = 1;
      else if (quality === 1 && renderCostAverage > (compact ? 13.5 : 15.5)) quality = 0;
      else if (quality === 1 && renderCostAverage < (compact ? 7.6 : 8.8)) quality = 2;
      else if (quality === 0 && renderCostAverage < (compact ? 10.2 : 11.5)) quality = 1;
      if (now - lastReport > 240) {
        lastReport = now;
        emit({ type: "stats", stats: stats() });
      }
      if (!reducedMotion) requestFrame();
    }

    function requestFrame() {
      if (!frame && pageVisible && !occluded) frame = raf(tick);
    }

    // A full-screen opaque layer (menu, project file, lightbox) hides the field
    // completely; stop rendering until it starts to move away.
    function setOccluded(next) {
      if (next === occluded) return;
      occluded = next;
      resetGovernor(30);
      emit({ type: "stats", stats: stats() });
      if (occluded) {
        if (frame) caf(frame);
        frame = 0;
      } else {
        lastFrame = performance.now();
        requestFrame();
      }
    }

    function addRipple(x, y, strength) {
      ripples.push({ x: x, y: y, born: performance.now() / 1000, strength: strength || 1 });
      if (ripples.length > 3) ripples.shift();
      bursts.push([x, y, 34 * (strength || 1), 0.9 * (strength || 1)]);
      requestFrame();
    }

    function pointerMove(x, y, stamp) {
      var dt = Math.max(0.004, stamp - pointer.moved);
      if (pointer.active) {
        var mx = x - pointer.x;
        var my = y - pointer.y;
        var speed = Math.sqrt(mx * mx + my * my) / dt;
        pointer.swirl = clamp(pointer.swirl + speed * 0.00028, 0, 0.85);
        if (dt < 0.25) {
          pointer.vx = pointer.vx * 0.4 + mx / dt * 0.6;
          pointer.vy = pointer.vy * 0.4 + my / dt * 0.6;
          pointer.pending = true;
        } else {
          pointer.fx = x;
          pointer.fy = y;
        }
      } else {
        pointer.fx = x;
        pointer.fy = y;
      }
      pointer.x = x;
      pointer.y = y;
      pointer.active = true;
      pointer.moved = stamp;
      requestFrame();
    }

    function scrolled(y, stamp) {
      hostScrollY = y;
      if (reducedMotion) return;
      var deltaTime = Math.max(8, stamp - lastScrollStamp);
      var scrollDelta = y - lastScrollY;
      if (Math.abs(scrollDelta) > height * 1.4) stageSnap = true;
      var instantaneous = Math.min(0.68, Math.abs(scrollDelta) / deltaTime * 0.22);
      scrollEnergy = Math.max(scrollEnergy * 0.56, instantaneous);
      scrollBias = clamp(scrollBias + scrollDelta / deltaTime * 0.045, -1, 1);
      signedScrollPhase += clamp(scrollDelta / Math.max(1, height), -0.28, 0.28) * 1.9;
      lastScrollY = y;
      lastScrollStamp = stamp;
      requestFrame();
    }

    // Host timestamps are absolute (timeOrigin + now), so they keep their
    // meaning across the hop into a worker whose clock has its own origin.
    function localTime(t) {
      return typeof t === "number" ? t - TIME_ORIGIN : performance.now();
    }

    function stats() {
      return {
        mode: IN_WORKER ? "worker" : "inline",
        dpr: Math.round(dpr * 100) / 100,
        dprFloor: Math.round(dprFloor * 100) / 100,
        quality: quality,
        occluded: occluded,
        renderCost: Math.round(renderCostAverage * 10) / 10,
        fluidCells: fluid.n,
        streamlines: WING.count,
        opening: Math.round(openingProgress * 1000) / 1000,
        journey: Math.round(stage * 1000) / 1000,
        stage: [scrollState.a, scrollState.b, Math.round(scrollState.mix * 100) / 100]
      };
    }

    function receive(msg) {
      switch (msg.type) {
        case "scroll":
          scrolled(msg.y, localTime(msg.t));
          break;
        case "pointer":
          if (msg.kind === "move") pointerMove(msg.x, msg.y, localTime(msg.t) / 1000);
          else if (msg.kind === "down") addRipple(msg.x, msg.y, 1);
          else {
            pointer.active = false;
            pointer.fx = -1;
          }
          break;
        case "resize":
          var sameSize = viewport && msg.viewport.width === viewport.width &&
            msg.viewport.height === viewport.height && msg.viewport.dpr === viewport.dpr &&
            msg.viewport.compact === viewport.compact && msg.viewport.medium === viewport.medium &&
            msg.viewport.portrait === viewport.portrait;
          viewport = msg.viewport;
          layout = msg.layout;
          hostScrollY = msg.scrollY;
          // A phone URL bar showing or hiding moves the page but not the
          // canvas (it is sized to the large viewport): re-measure only, no
          // realloc and re-bake.
          if (sameSize) {
            applyLayout();
            requestFrame();
          } else {
            resize();
          }
          break;
        case "layout":
          layout = msg.layout;
          hostScrollY = msg.scrollY;
          applyLayout();
          if (msg.refresh) {
            if (Math.abs(stageTarget() - stage) > 1.2) stageSnap = true;
            render(performance.now());
          } else {
            requestFrame();
          }
          break;
        case "visibility":
          pageVisible = !!msg.visible;
          resetGovernor(30);
          if (pageVisible) {
            lastFrame = performance.now();
            requestFrame();
          }
          break;
        case "occlusion":
          setOccluded(!!msg.occluded);
          break;
        case "intro":
          introProgress = clamp(msg.value, 0, 1);
          requestFrame();
          break;
        case "opening":
          openingExternallyDriven = true;
          openingTarget = clamp(msg.value, 0, 1);
          requestFrame();
          break;
        case "burst":
          addRipple(typeof msg.x === "number" ? msg.x : width * 0.5, typeof msg.y === "number" ? msg.y : viewHeight * 0.5, 1);
          break;
        case "fonts":
          // Sprites are baked at startup; rebake once the webfont arrives so
          // the marks render in IBM Plex Mono rather than the fallback.
          buildParticleSprites();
          buildRasterSprites();
          requestFrame();
          break;
      }
    }

    if (IN_WORKER) {
      loadWorkerFonts(config.fonts).then(function (loaded) {
        if (loaded) receive({ type: "fonts" });
      });
    }

    resize();
    requestFrame();
    return { receive: receive };
  }

  // ---------------------------------------------------------------------
  // Worker entry. The first message carries the canvas and the page state;
  // everything after it is forwarded to the engine.
  if (IN_WORKER) {
    var workerEngine = null;
    scope.onmessage = function (event) {
      var msg = event.data;
      if (msg.type === "init") {
        workerEngine = createEngine(msg.canvas, msg.config, function (out) { scope.postMessage(out); });
        if (!workerEngine) scope.postMessage({ type: "failed" });
      } else if (workerEngine) {
        workerEngine.receive(msg);
      }
    };
    return;
  }

  // ---------------------------------------------------------------------
  // Host — the page side. It owns every DOM read and turns page events into
  // messages; the engine never touches the document.
  var canvas = document.getElementById("flowField");
  if (!canvas) return;

  var root = document.documentElement;
  var body = document.body;
  var script = document.currentScript;
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var compactQuery = window.matchMedia("(max-width: 760px)");
  var mediumQuery = window.matchMedia("(min-width: 761px) and (max-width: 1180px)");
  var hasOpening = body.classList.contains("home-page") && !!document.querySelector(".hero");
  var TIME_ORIGIN = performance.timeOrigin || 0;
  var worker = null;
  var engine = null;
  var send = function () {};
  var lastStats = {};
  // The journey position the field is actually displaying, as last reported.
  var journey = 0;
  var journeyKnown = false;
  // What the page has told the field so far, replayed into a fresh engine.
  var told = { intro: body.classList.contains("is-loading") ? 0 : 1, opening: -1, occluded: false };
  var layoutCache = null;
  var viewportCache = null;

  function stamp() {
    return TIME_ORIGIN + performance.now();
  }

  function measureViewport() {
    var bounds = canvas.getBoundingClientRect();
    var compact = compactQuery.matches;
    viewportCache = {
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height),
      visible: Math.max(1, Math.min(bounds.height, window.innerHeight)),
      dpr: window.devicePixelRatio || 1,
      compact: compact,
      medium: mediumQuery.matches,
      portrait: compact && window.innerHeight > window.innerWidth * 1.15
    };
    return viewportCache;
  }

  function measureLayout() {
    var offset = window.scrollY;
    var stops = Array.prototype.map.call(document.querySelectorAll(".scene[data-field]"), function (node) {
      var bounds = node.getBoundingClientRect();
      return [parseInt(node.getAttribute("data-field"), 10) || 0, bounds.top + offset + bounds.height * 0.5];
    });
    var hero = hasOpening ? document.querySelector(".hero") : null;
    var heroBounds = hero ? hero.getBoundingClientRect() : null;
    layoutCache = {
      stops: stops,
      opening: heroBounds ? [heroBounds.top + offset, heroBounds.height] : null,
      scrollHeight: root.scrollHeight
    };
    return layoutCache;
  }

  function engineConfig() {
    var fontLink = document.querySelector('link[href*="fonts.googleapis.com/css"]');
    return {
      reducedMotion: reducedMotion,
      hasOpening: hasOpening,
      introProgress: told.intro,
      visible: document.visibilityState !== "hidden",
      viewport: measureViewport(),
      layout: measureLayout(),
      scrollY: window.scrollY,
      kMark: new URL("assets/brand/k-mark.png?v=3", document.baseURI).href,
      fonts: fontLink ? fontLink.href : ""
    };
  }

  function onEngine(msg) {
    if (msg.type === "stage") {
      journey = msg.stage;
      journeyKnown = true;
    } else if (msg.type === "stats") {
      lastStats = msg.stats;
    } else if (msg.type === "failed") {
      runInline();
    }
  }

  function replay() {
    if (told.opening >= 0) send({ type: "opening", value: told.opening });
    if (told.occluded) send({ type: "occlusion", occluded: true });
  }

  function runInline() {
    if (worker) {
      worker.terminate();
      worker = null;
      // The old element's drawing surface went to the worker; start clean.
      var fresh = canvas.cloneNode(false);
      canvas.parentNode.replaceChild(fresh, canvas);
      canvas = fresh;
    }
    if (engine) return;
    engine = createEngine(canvas, engineConfig(), onEngine);
    send = engine ? engine.receive : function () {};
    replay();
    if (engine && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { send({ type: "fonts" }); });
    }
  }

  function offscreenCapable() {
    if (/[?&]field=inline\b/.test(window.location.search)) return false;
    if (typeof Worker !== "function" || typeof OffscreenCanvas !== "function") return false;
    if (typeof canvas.transferControlToOffscreen !== "function" || !script || !script.src) return false;
    if (window.location.protocol === "file:") return false;
    try {
      return !!new OffscreenCanvas(1, 1).getContext("2d");
    } catch (error) {
      return false;
    }
  }

  function runWorker() {
    var offscreen;
    try {
      worker = new Worker(script.src);
      offscreen = canvas.transferControlToOffscreen();
    } catch (error) {
      if (worker) worker.terminate();
      worker = null;
      return false;
    }
    worker.onmessage = function (event) { onEngine(event.data); };
    // A worker that cannot start (or dies) hands the field back to the page.
    worker.onerror = function (event) {
      if (event && event.preventDefault) event.preventDefault();
      runInline();
    };
    send = function (msg) {
      if (worker) worker.postMessage(msg);
    };
    worker.postMessage({ type: "init", canvas: offscreen, config: engineConfig() }, [offscreen]);
    replay();
    return true;
  }

  // Journey coordinate at a scroll position — the same mapping as the
  // engine's stageTarget: 0..1 is the opening, then one unit per section gap.
  function sectionCoordinate(focus) {
    var stops = layoutCache.stops;
    var count = stops.length;
    if (count < 2 || focus <= stops[0][1]) return 0;
    if (focus >= stops[count - 1][1]) return count - 1;
    for (var i = 0; i < count - 1; i += 1) {
      if (focus < stops[i + 1][1]) {
        return i + (focus - stops[i][1]) / Math.max(1, stops[i + 1][1] - stops[i][1]);
      }
    }
    return count - 1;
  }

  function journeyAt(y) {
    var h = viewportCache.visible;
    if (hasOpening && layoutCache.opening) {
      var travel = Math.max(1, layoutCache.opening[1] - h);
      var opening = Math.min(1, Math.max(0, (y - layoutCache.opening[0]) / travel));
      if (opening < 0.999) return opening;
    }
    return (hasOpening ? 1 : 0) + sectionCoordinate(y + h * 0.52);
  }

  window.addEventListener("scroll", function () {
    if (!reducedMotion) send({ type: "scroll", y: window.scrollY, t: stamp() });
  }, { passive: true });

  window.addEventListener("pointermove", function (event) {
    if (event.pointerType === "touch") return;
    send({ type: "pointer", kind: "move", x: event.clientX, y: event.clientY, t: stamp() });
  }, { passive: true });

  window.addEventListener("pointerdown", function (event) {
    if (event.pointerType === "touch") return;
    send({ type: "pointer", kind: "down", x: event.clientX, y: event.clientY, t: stamp() });
  }, { passive: true });

  document.addEventListener("mouseleave", function () {
    send({ type: "pointer", kind: "leave" });
  });

  // Debounced: the full rebuild (canvas realloc, sprite bake, re-measure)
  // must not run on every mobile URL-bar show/hide tick.
  var lastViewportW = window.innerWidth;
  var lastViewportH = window.innerHeight;
  var resizeDebounce = 0;
  function resized() {
    lastViewportW = window.innerWidth;
    lastViewportH = window.innerHeight;
    send({ type: "resize", viewport: measureViewport(), layout: measureLayout(), scrollY: window.scrollY });
  }
  // A toolbar showing or hiding only moves the visible height; the canvas
  // (large viewport) keeps its size. That update is cheap, and main.js moves
  // the K overlay against innerHeight at once, so it goes out on the next
  // frame instead of after the debounce — the field's K stays under it.
  var visibleFrame = 0;
  function visibleChanged() {
    visibleFrame = 0;
    if (canvas.getBoundingClientRect().height === viewportCache.height) resized();
  }
  window.addEventListener("resize", function () {
    var minor = window.innerWidth === lastViewportW &&
      Math.abs(window.innerHeight - lastViewportH) < 140;
    clearTimeout(resizeDebounce);
    if (minor && !visibleFrame) visibleFrame = window.requestAnimationFrame(visibleChanged);
    resizeDebounce = setTimeout(resized, minor ? 240 : 90);
  }, { passive: true });

  window.addEventListener("load", function () {
    send({ type: "layout", layout: measureLayout(), scrollY: window.scrollY });
  }, { once: true });

  document.addEventListener("visibilitychange", function () {
    send({ type: "visibility", visible: document.visibilityState !== "hidden" });
  });

  document.addEventListener("ek:occlusion", function (event) {
    told.occluded = !!(event.detail && event.detail.occluded);
    send({ type: "occlusion", occluded: told.occluded });
  });

  window.flowField = {
    // Diagnostics snapshot; in worker mode it is at most a few frames old.
    stats: function () {
      return lastStats;
    },
    setIntroProgress: function (value) {
      told.intro = value;
      send({ type: "intro", value: value });
    },
    setOpeningProgress: function (value) {
      told.opening = value;
      send({ type: "opening", value: value });
    },
    burst: function (x, y) {
      send({ type: "burst", x: x, y: y });
    },
    refresh: function () {
      send({ type: "layout", refresh: true, layout: measureLayout(), scrollY: window.scrollY });
    },
    // How far the page at scroll position y would run ahead of what the
    // field is showing, in journey units. main.js uses it to add weight to
    // the scroll when a visitor outruns the animation.
    lead: function (y) {
      if (reducedMotion || !journeyKnown || !layoutCache || !viewportCache) return null;
      return { ahead: journeyAt(y) - journey, opening: hasOpening && journey < 1 };
    }
  };

  root.classList.add("flow-field-ready");
  if (!offscreenCapable() || !runWorker()) runInline();
})();
