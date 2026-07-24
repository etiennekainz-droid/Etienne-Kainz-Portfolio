(function () {
  "use strict";

  var canvas = document.getElementById("quantumField");
  if (!canvas) return;

  var ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!ctx) return;

  var root = document.documentElement;
  var body = document.body;
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var compact = window.matchMedia("(max-width: 760px)").matches;
  var medium = window.matchMedia("(min-width: 761px) and (max-width: 1180px)").matches;
  var particleCount = reducedMotion ?
    (compact ? 300 : medium ? 500 : 650) :
    (compact ? 820 : medium ? 1500 : 2300);
  var formationCount = 8;
  var formations = [];
  var openingFormations = [];
  var phase = new Float32Array(particleCount);
  var seedA = new Float32Array(particleCount);
  var seedB = new Float32Array(particleCount);
  var seedC = new Float32Array(particleCount);
  var prevScreenX = new Float32Array(particleCount);
  var prevScreenY = new Float32Array(particleCount);
  var sectionStops = [];
  var width = 1;
  var height = 1;
  var dpr = 1;
  var introProgress = body.classList.contains("is-loading") ? 0 : 1;
  var frame = 0;
  var lastFrame = 0;
  var pageVisible = document.visibilityState !== "hidden";
  var fieldOpacity = 1;
  var scrollState = { a: 0, b: 0, mix: 0, global: 0 };
  var pointer = { x: -9999, y: -9999, active: false, moved: 0, vx: 0, vy: 0, swirl: 0 };
  var ripples = [];
  var glyphs = [];
  var scrollEnergy = 0;
  var scrollBias = 0;
  var signedScrollPhase = 0;
  var lastScrollY = window.scrollY;
  var lastScrollStamp = performance.now();
  var hasOpening = body.classList.contains("home-page") && !!document.querySelector(".hero");
  var openingProgress = hasOpening && !reducedMotion ? 0 : 1;
  var openingTarget = openingProgress;
  var openingStart = 0;
  var openingTravel = 1;
  var renderCostAverage = 6;

  // Staged quality governor: 2 = full detail, 1 = no echo effects,
  // 0 = particle stride + single-cell splat. Hysteresis avoids flapping.
  var quality = 2;

  // The Dragonfly-inspired ASCII raster: projected probability density is
  // accumulated on a fixed character grid every frame, then rendered as a
  // brightness ramp of binary glyphs with flow-aligned direction marks.
  var cellSize = compact ? 15 : 13;
  var rasterCols = 0;
  var rasterRows = 0;
  var rasterDensity = null;
  var rasterFlowX = null;
  var rasterFlowY = null;
  var rampSprites = [];
  var directionSprites = [];

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

  function setPoint(array, index, x, y, z) {
    var offset = index * 3;
    array[offset] = x;
    array[offset + 1] = y;
    array[offset + 2] = z;
  }

  function makeFormation(builder) {
    var points = new Float32Array(particleCount * 3);
    for (var i = 0; i < particleCount; i += 1) {
      var result = builder(i, i / Math.max(1, particleCount - 1), seedA[i], seedB[i], seedC[i]);
      setPoint(points, i, result[0], result[1], result[2]);
    }
    return points;
  }

  for (var seedIndex = 0; seedIndex < particleCount; seedIndex += 1) {
    seedA[seedIndex] = hash(seedIndex + 11);
    seedB[seedIndex] = hash(seedIndex + 1011);
    seedC[seedIndex] = hash(seedIndex + 9001);
    phase[seedIndex] = hash(seedIndex + 501) * Math.PI * 2;
    prevScreenX[seedIndex] = -9999;
    prevScreenY[seedIndex] = -9999;
  }

  // One semantic topology drives every opening pose: an abstract orbital
  // superposition. Lobe, ring, core, halo, and axis particles retain their
  // roles through the morph instead of crossing toward unrelated targets.
  // Lanes (i % 24): 0–9 cloverleaf lobes, 10–13 polar lobes, 14–18 dashed
  // equatorial orbit, 19 crossed orbit, 20–21 nucleus, 22 halo, 23 axis.
  function orbitalFieldPoint(i, a, b, c, lobe, polar, ring, tilt, halo) {
    var lane = i % 24;

    // Four diagonal probability lobes in the screen plane (d-orbital).
    if (lane < 10) {
      var theta = (i & 3) * (Math.PI / 2) + Math.PI / 4;
      var reach = Math.pow(a, 0.62);
      var envelope = Math.pow(Math.max(0, Math.sin(Math.PI * reach)), 0.8);
      var angle = theta + (b - 0.5) * (0.85 - reach * 0.35);
      var radius = lobe * reach;
      return [
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        (c - 0.5) * (0.12 + envelope * 0.3)
      ];
    }

    // Two polar lobes along the quantization axis (p-orbital).
    if (lane < 14) {
      var side = i & 1 ? 1 : -1;
      var stretch = Math.pow(a, 0.7);
      var waist = Math.sin(Math.PI * stretch) * (0.24 + polar * 0.14);
      var around = b * Math.PI * 2;
      return [
        Math.cos(around) * waist,
        side * polar * (0.12 + 0.88 * stretch),
        Math.sin(around) * waist
      ];
    }

    // Quantised orbit dashes: an equatorial ring plus one crossed ring.
    if (lane < 20) {
      var crossed = lane === 19;
      var dashes = crossed ? 22 : 30;
      var ringTilt = crossed ? tilt + 1.05 : tilt;
      var dashAngle = Math.round(b * dashes) / dashes * Math.PI * 2 +
        (a - 0.5) * 0.16 + (crossed ? 0.4 : 0);
      var ringRadius = ring * (crossed ? 1.16 : 1) * (1 + (c - 0.5) * 0.05);
      var flatX = Math.cos(dashAngle) * ringRadius;
      var flatY = (c - 0.5) * 0.045;
      var flatZ = Math.sin(dashAngle) * ringRadius;
      var cosTilt = Math.cos(ringTilt);
      var sinTilt = Math.sin(ringTilt);
      return [flatX, flatY * cosTilt - flatZ * sinTilt, flatY * sinTilt + flatZ * cosTilt];
    }

    // Dense nucleus / observable core.
    if (lane < 22) {
      var coreTheta = a * Math.PI * 2;
      var corePhi = Math.acos(1 - 2 * b);
      var coreRadius = 0.16 * (0.7 + c * 0.45);
      return [
        Math.cos(coreTheta) * Math.sin(corePhi) * coreRadius,
        Math.cos(corePhi) * coreRadius,
        Math.sin(coreTheta) * Math.sin(corePhi) * coreRadius * 0.95
      ];
    }

    // Sparse probability halo.
    if (lane === 22) {
      var haloTheta = a * Math.PI * 2;
      var haloPhi = Math.acos(1 - 2 * b);
      var haloRadius = halo * (0.35 + Math.pow(c, 1.6) * 0.65);
      return [
        Math.cos(haloTheta) * Math.sin(haloPhi) * haloRadius,
        Math.cos(haloPhi) * haloRadius * 0.82,
        Math.sin(haloTheta) * Math.sin(haloPhi) * haloRadius
      ];
    }

    // Quantization-axis filament threading the whole state.
    return [
      (b - 0.5) * 0.05,
      (a - 0.5) * 2 * polar * 1.12,
      (c - 0.5) * 0.05
    ];
  }

  // 00 — settled orbital superposition.
  formations.push(makeFormation(function (i, u, a, b, c) {
    return orbitalFieldPoint(i, a, b, c, 1.3, 1.5, 1.05, 0.16, 2.15);
  }));

  // 01 — coupled wavefunctions / double helix.
  formations.push(makeFormation(function (i, u, a, b) {
    var connector = i % 7 === 0;
    var t = -1.35 + 2.7 * u;
    var angle = u * Math.PI * 7.2;
    if (connector) {
      var cross = a * 2 - 1;
      return [Math.cos(angle) * cross * 0.72, t, Math.sin(angle) * cross * 0.58];
    }
    var strand = i % 2 ? 1 : -1;
    return [Math.cos(angle) * 0.72 * strand + (b - 0.5) * 0.08, t, Math.sin(angle) * 0.58 * strand];
  }));

  // 02 — rotor / flow-field formation.
  formations.push(makeFormation(function (i, u, a, b, c) {
    if (i % 9 === 0) {
      return [(a - 0.5) * 0.14, (b - 0.5) * 0.14, -1.15 + c * 2.3];
    }
    var blade = i % 7;
    var radius = 0.18 + Math.pow(a, 0.62) * 1.25;
    var angle = blade / 7 * Math.PI * 2 + radius * 1.7 + (b - 0.5) * 0.24;
    var chord = (c - 0.5) * 0.34 * (1.25 - radius * 0.35);
    return [
      Math.cos(angle) * radius - Math.sin(angle) * chord,
      Math.sin(angle) * radius + Math.cos(angle) * chord,
      (b - 0.5) * 0.45 + Math.sin(radius * 4.2) * 0.12
    ];
  }));

  // 03 — continuous crystal lattice carrying a frozen elastic-wave packet.
  formations.push(makeFormation(function (i, u, a, b, c) {
    var nx = compact ? 13 : 19;
    var ny = compact ? 5 : 7;
    var ix = i % nx;
    var iy = Math.floor(i / nx) % ny;
    var iz = Math.floor(i / (nx * ny));
    var nz = Math.max(2, Math.ceil(particleCount / (nx * ny)));
    var x = (ix / Math.max(1, nx - 1) - 0.5) * 2.9;
    var y = (iy / Math.max(1, ny - 1) - 0.5) * 1.15;
    var z = (iz / Math.max(1, nz - 1) - 0.5) * 1.05;
    var envelope = Math.exp(-Math.pow((x + 0.12) / 0.72, 2));
    var pWave = Math.sin(x * 8.2 + iy * 0.12) * envelope;
    var sWave = Math.cos(x * 5.7 + iz * 0.34) * envelope;
    return [
      x + pWave * 0.12,
      y + sWave * 0.13 + (a - 0.5) * 0.018,
      z + sWave * 0.08 + (b - 0.5) * 0.018 + (c - 0.5) * 0.01
    ];
  }));

  // 04 — exploded drawing / orthographic component stack.
  formations.push(makeFormation(function (i, u, a, b, c) {
    var component = i % 3;
    var cx = (component - 1) * 0.9;
    var cy = component === 1 ? 0.22 : -0.18;
    var edge = i % 12;
    var t = a * 1.15 - 0.575;
    var x = 0;
    var y = 0;
    var z = 0;
    if (edge < 4) {
      x = t;
      y = edge % 2 ? 0.56 : -0.56;
      z = edge > 1 ? 0.42 : -0.42;
    } else if (edge < 8) {
      y = t;
      x = edge % 2 ? 0.56 : -0.56;
      z = edge > 5 ? 0.42 : -0.42;
    } else {
      z = t * 0.75;
      x = edge % 2 ? 0.56 : -0.56;
      y = edge > 9 ? 0.56 : -0.56;
    }
    return [x * 0.58 + cx, y * 0.7 + cy, z + (b - 0.5) * 0.04 + c * 0.02];
  }));

  // 05 — sampled topography / aerial survey mesh.
  formations.push(makeFormation(function (i, u, a, b) {
    var cols = Math.max(18, Math.floor(Math.sqrt(particleCount * 1.65)));
    var col = i % cols;
    var row = Math.floor(i / cols);
    var rows = Math.ceil(particleCount / cols);
    var x = (col / Math.max(1, cols - 1) - 0.5) * 2.9;
    var z = (row / Math.max(1, rows - 1) - 0.5) * 2.2;
    var elevation = Math.sin(x * 2.2 + z * 1.1) * 0.22 + Math.cos(z * 3.6 - x * 0.7) * 0.15;
    elevation += Math.exp(-((x - 0.4) * (x - 0.4) + (z + 0.2) * (z + 0.2)) * 2.2) * 0.55;
    return [x, elevation - 0.05 + (a - 0.5) * 0.035, z + (b - 0.5) * 0.035];
  }));

  // 06 — four credential shells / quantised orbital planes.
  formations.push(makeFormation(function (i, u, a, b) {
    var shell = i % 4;
    var angle = u * Math.PI * 17 + shell * 0.7;
    var radius = 0.43 + shell * 0.27 + (a - 0.5) * 0.1;
    var x = Math.cos(angle) * radius;
    var y = Math.sin(angle) * radius;
    var z = (b - 0.5) * 0.18;
    if (shell === 1) {
      var oldY = y;
      y = oldY * 0.45;
      z = Math.sin(angle) * radius * 0.82;
    } else if (shell === 2) {
      var oldX = x;
      x = oldX * 0.5;
      z = Math.cos(angle) * radius * 0.78;
    } else if (shell === 3) {
      y *= 0.72;
      z = Math.sin(angle + 0.8) * radius * 0.55;
    }
    return [x, y, z];
  }));

  // 07 — measurement collapse: concentric rings converging on one observable.
  formations.push(makeFormation(function (i, u, a, b, c) {
    if (i % 8 === 0) {
      var line = -1.15 + a * 2.3;
      return [(b - 0.5) * 0.055, line, (c - 0.5) * 0.055];
    }
    var ring = i % 5;
    var angle = u * Math.PI * 22 + ring;
    var radius = 0.18 + ring * 0.235 + (a - 0.5) * 0.06;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius, Math.sin(angle * 2 + b) * 0.23 * (ring / 4)];
  }));

  // Opening A — the state blooms: lobes stretch, orbits widen and tilt.
  openingFormations.push(makeFormation(function (i, u, a, b, c) {
    return orbitalFieldPoint(i, a, b, c, 1.68, 1.78, 1.32, 0.5, 2.6);
  }));

  // Opening B — partial collapse: lobes draw in, the orbit swings upright.
  openingFormations.push(makeFormation(function (i, u, a, b, c) {
    return orbitalFieldPoint(i, a, b, c, 0.92, 1.12, 1.55, 1.02, 1.7);
  }));

  // 32px sprites sit close to the largest drawn size, so downscaling stays
  // in the sharp 1–2x range instead of blurring through a 4x reduction.
  function makeGlyph(char, weight) {
    var sprite = document.createElement("canvas");
    sprite.width = 32;
    sprite.height = 32;
    var spriteContext = sprite.getContext("2d");
    spriteContext.clearRect(0, 0, 32, 32);
    spriteContext.fillStyle = "#000";
    spriteContext.textAlign = "center";
    spriteContext.textBaseline = "middle";
    spriteContext.font = weight + " 20px 'IBM Plex Mono', ui-monospace, monospace";
    spriteContext.fillText(char, 16, 16);
    return sprite;
  }

  // Scatter marks read as instrument samples, not code: crosses for the
  // quiver body, a rare ψ observable drifting through the field.
  var psiSprite;
  function buildParticleSprites() {
    glyphs = [
      makeGlyph("+", "400"),
      makeGlyph("×", "400"),
      makeGlyph("+", "500"),
      makeGlyph("×", "500")
    ];
    psiSprite = makeGlyph("ψ", "400");
  }
  buildParticleSprites();

  function makeRasterGlyph(char, weight, scale) {
    var device = Math.max(4, Math.round(cellSize * dpr));
    var sprite = document.createElement("canvas");
    sprite.width = device;
    sprite.height = device;
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
    // Brightness ramp, faint to solid — mesh nodes and sample crosses first,
    // then FEM/tolerance marks in the dense core, like a numerical field plot.
    rampSprites = [
      makeRasterGlyph("·", "400", 1.05),
      makeRasterGlyph(":", "400", 0.92),
      makeRasterGlyph("+", "400", 0.98),
      makeRasterGlyph("×", "400", 0.98),
      makeRasterGlyph("Δ", "500", 0.92),
      makeRasterGlyph("±", "500", 0.98)
    ];
    // Flow-aligned marks, indexed by quantised velocity angle (8 sectors,
    // opposite directions share slashes; horizontal keeps its sign).
    directionSprites = [
      makeRasterGlyph(">", "400", 0.94),
      makeRasterGlyph("/", "400", 0.98),
      makeRasterGlyph("|", "400", 0.98),
      makeRasterGlyph("\\", "400", 0.98),
      makeRasterGlyph("<", "400", 0.94),
      makeRasterGlyph("/", "400", 0.98),
      makeRasterGlyph("|", "400", 0.98),
      makeRasterGlyph("\\", "400", 0.98)
    ];
  }

  var lastViewportW = 0;
  var lastViewportH = 0;

  function resize() {
    lastViewportW = window.innerWidth;
    lastViewportH = window.innerHeight;
    var bounds = canvas.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    // Render at native resolution where the pixel budget allows — the
    // glyphs stay razor sharp on retina displays.
    var requestedDpr = Math.min(window.devicePixelRatio || 1, compact ? 1.6 : medium ? 1.85 : 2);
    var pixelBudget = compact ? 1900000 : medium ? 3500000 : 5600000;
    dpr = Math.max(0.78, Math.min(requestedDpr, Math.sqrt(pixelBudget / Math.max(1, width * height))));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rasterCols = Math.max(1, Math.ceil(width / cellSize));
    rasterRows = Math.max(1, Math.ceil(height / cellSize));
    var cellCount = rasterCols * rasterRows;
    rasterDensity = new Float32Array(cellCount);
    rasterFlowX = new Float32Array(cellCount);
    rasterFlowY = new Float32Array(cellCount);
    buildRasterSprites();
    measureSections();
    if (reducedMotion && sectionStops.length) {
      scrollState.a = sectionStops[0].index;
      scrollState.b = sectionStops[0].index;
      scrollState.mix = 0;
      scrollState.global = 0;
    }
    render(performance.now());
  }

  function measureSections() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll(".scene[data-field]"));
    sectionStops = nodes.map(function (node) {
      var bounds = node.getBoundingClientRect();
      return {
        index: clamp(parseInt(node.getAttribute("data-field"), 10) || 0, 0, formationCount - 1),
        center: bounds.top + window.scrollY + bounds.height * 0.5
      };
    });
    var openingNode = document.querySelector(".hero");
    if (openingNode) {
      var openingBounds = openingNode.getBoundingClientRect();
      openingStart = openingBounds.top + window.scrollY;
      openingTravel = Math.max(1, openingBounds.height - height);
    }
    // The opening chain lands on formation 1, so the hero stop must agree —
    // otherwise the first scroll past the hero lerps abruptly back toward 0.
    if (hasOpening && !reducedMotion && sectionStops.length && sectionStops[0].index === 0) {
      sectionStops[0].index = 1;
    }
    if (!sectionStops.length) sectionStops = [{ index: 0, center: height * 0.5 }];
  }

  function readScroll(dtSeconds) {
    var focus = window.scrollY + height * 0.52;
    var pageMax = Math.max(1, document.documentElement.scrollHeight - height);
    scrollState.global = clamp(window.scrollY / pageMax, 0, 1);
    if (hasOpening) {
      openingTarget = reducedMotion ? 1 : clamp((window.scrollY - openingStart) / openingTravel, 0, 1);
      openingProgress += (openingTarget - openingProgress) *
        (1 - Math.exp(-dtSeconds * 7.2));
      if (openingProgress < 0.995) {
        scrollState.a = 0;
        scrollState.b = 0;
        scrollState.mix = 0;
        return;
      }
    }
    var first = sectionStops[0];
    var last = sectionStops[sectionStops.length - 1];
    if (focus <= first.center) {
      scrollState.a = first.index;
      scrollState.b = first.index;
      scrollState.mix = 0;
      return;
    }
    if (focus >= last.center) {
      scrollState.a = last.index;
      scrollState.b = last.index;
      scrollState.mix = 0;
      return;
    }
    for (var i = 0; i < sectionStops.length - 1; i += 1) {
      var current = sectionStops[i];
      var next = sectionStops[i + 1];
      if (focus >= current.center && focus < next.center) {
        var raw = (focus - current.center) / Math.max(1, next.center - current.center);
        // Hold each formation, then transition with a pronounced custom curve.
        var transition = ease(clamp((raw - 0.18) / 0.64, 0, 1));
        scrollState.a = current.index;
        scrollState.b = next.index;
        scrollState.mix = transition;
        return;
      }
    }
  }

  function render(now) {
    // render is invoked both by rAF and synchronously (resize/refresh);
    // cancelling any pending frame prevents duplicate rAF chains from
    // stacking up and multiplying the per-frame cost.
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (!pageVisible) return;

    var dt = clamp(now - lastFrame, 1, 50);
    lastFrame = now;
    var dtSeconds = dt / 1000;
    if (!reducedMotion) readScroll(dtSeconds);
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
    var peakOpeningScale = compact ? 1.2 : medium ? 1.32 : 1.46;
    var openingScale = 1 + (peakOpeningScale - 1) * openingRamp * (1 - openingSettle);
    var targetOpacity = body.classList.contains("wave-active") ? 0.22 : 1;
    fieldOpacity += (targetOpacity - fieldOpacity) * (1 - Math.exp(-dtSeconds * 3.6));
    var centerX = width * (compact ? 0.54 : 0.51) +
      (reducedMotion ? 0 :
        Math.sin(motionTime * 0.14 + scrollState.global * 3.2) * width * 0.014 +
        Math.sin(openingPhase * Math.PI * 2) * width * 0.022 * openingEnergy);
    var centerY = height * (0.4 + scrollState.global * 0.19 +
      Math.sin(scrollState.global * Math.PI * 5) * 0.022) +
      (reducedMotion ? 0 :
        Math.sin(motionTime * 0.1) * height * 0.01 +
        height * 0.1 * ease(clamp((openingPhase - 0.2) / 0.34, 0, 1)) *
        (1 - ease(clamp((openingPhase - 0.67) / 0.28, 0, 1))));
    var baseScale = Math.min(width, height) * (compact ? 0.43 : 0.405) *
      openingScale *
      (reducedMotion ? 1 : 1 + Math.sin(motionTime * 0.38) * 0.018 + scrollEnergy * 0.022);
    var yaw = -0.25 + scrollState.global * 0.94 +
      (reducedMotion ? 0 :
        Math.sin(motionTime * 0.17) * 0.085 + scrollEnergy * 0.05 +
        openingEnergy * (0.3 + Math.sin(openingPhase * Math.PI * 2) * 0.07));
    var pitch = 0.07 + (reducedMotion ? 0 :
      Math.cos(motionTime * 0.13) * 0.048 + openingEnergy * (-0.08 + openingPhase * 0.13));
    // The whole projection banks slightly with scroll momentum.
    var roll = reducedMotion ? 0 : Math.sin(motionTime * 0.11) * 0.018 + scrollBias * 0.055;
    var cosYaw = Math.cos(yaw);
    var sinYaw = Math.sin(yaw);
    var cosPitch = Math.cos(pitch);
    var sinPitch = Math.sin(pitch);
    var cosRoll = Math.cos(roll);
    var sinRoll = Math.sin(roll);
    var pointsA = formations[scrollState.a];
    var pointsB = formations[scrollState.b];
    var mix = scrollState.mix;
    var activeFormation = mix < 0.5 ? scrollState.a : scrollState.b;
    if (hasOpening && openingPhase < 0.999) {
      if (openingPhase < 0.38) {
        pointsA = formations[0];
        pointsB = openingFormations[0];
        mix = ease(clamp((openingPhase - 0.1) / 0.28, 0, 1));
      } else if (openingPhase < 0.76) {
        pointsA = openingFormations[0];
        pointsB = openingFormations[1];
        mix = ease(clamp((openingPhase - 0.38) / 0.38, 0, 1));
      } else {
        pointsA = openingFormations[1];
        pointsB = formations[1];
        mix = ease(clamp((openingPhase - 0.76) / 0.24, 0, 1));
      }
      activeFormation = 0;
    }
    var morphEnergy = reducedMotion ? 0 : Math.sin(mix * Math.PI);
    var morphStagger = 0.44;
    var morphActive = mix > 0.0001 && mix < 0.9999;
    var formationSettle = 1 - morphEnergy * 0.34;
    var intro = ease(introProgress);
    var tick = Math.floor(motionTime * 2.2);
    var rasterTick = reducedMotion ? 7 : Math.floor(time * 1.6);
    var pointerAge = Math.max(0, time - pointer.moved);
    var proximityStrength = !reducedMotion && pointer.active ? Math.exp(-pointerAge * 1.35) : 0;
    var pointerRadius = compact ? 112 : 172;
    var eventPeriod = compact ? 14.5 : 13.2;
    var eventSerial = Math.floor(time / eventPeriod);
    var eventAge = time - eventSerial * eventPeriod;
    var eventLife = reducedMotion ? 0 :
      Math.sin(clamp(eventAge / 4.8, 0, 1) * Math.PI) * Math.exp(-Math.max(0, eventAge - 4.8) * 0.62);
    eventLife *= 1 - openingEnergy * 0.82;
    var eventX = width * (0.18 + hash(eventSerial * 17 + 3) * 0.64);
    var eventY = height * (0.2 + hash(eventSerial * 29 + 7) * 0.58);
    var eventFront = eventAge * Math.min(width, height) * (compact ? 0.072 : 0.088);
    var packetCenterX = Math.sin(motionTime * 0.25 + scrollState.global * 4.2) * 0.58;
    var packetCenterY = Math.cos(motionTime * 0.22 - scrollState.global * 2.8) * 0.44;
    var packetCenterZ = Math.sin(motionTime * 0.18 + 1.4) * 0.38;
    var openingShockProgress = clamp((openingPhase - 0.2) / 0.58, 0, 1);
    var openingShockFront = 0.12 + openingShockProgress * 2.4;
    // Formation 0 internal motion, shared across its particles per frame.
    var precession = motionTime * 0.32;
    var cosPrecess = Math.cos(precession);
    var sinPrecess = Math.sin(precession);
    var orbitSpin = -motionTime * 0.55 - signedScrollPhase * 0.4;
    var cosOrbit = Math.cos(orbitSpin);
    var sinOrbit = Math.sin(orbitSpin);
    var particleStride = quality === 0 ? 2 : 1;
    var splatSpread = quality === 0 ? 0 : 1;
    var detailEffects = quality === 2;
    // While the field idles dimmed behind the elastic-wave figure, halve
    // the work — both canvases would otherwise animate at full cost.
    if (fieldOpacity < 0.3) {
      particleStride *= 2;
      detailEffects = false;
    }
    // Density normalisation keeps the raster exposure stable whenever the
    // particle budget is reduced.
    var densityGain = particleStride;

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

    for (var i = 0; i < particleCount; i += particleStride) {
      var offset = i * 3;
      var lane24 = i % 24;
      var localMix = mix;
      if (morphActive) {
        // Each particle joins the morph on its own seeded delay, so
        // formations reassemble as a travelling swarm wave.
        localMix = ease(clamp((mix - seedB[i] * morphStagger) / (1 - morphStagger), 0, 1));
      }
      var x = pointsA[offset] + (pointsB[offset] - pointsA[offset]) * localMix;
      var y = pointsA[offset + 1] + (pointsB[offset + 1] - pointsA[offset + 1]) * localMix;
      var z = pointsA[offset + 2] + (pointsB[offset + 2] - pointsA[offset + 2]) * localMix;
      var localMorph = morphActive ? Math.sin(localMix * Math.PI) : 0;
      var openingBand = 0;

      if (!reducedMotion) {
        // Mid-morph the state decoheres through a seeded vortex before it
        // settles into the next observable.
        if (localMorph > 0.004) {
          var swirlAngle = localMorph * (seedC[i] - 0.5) * 1.7;
          var swirlCos = Math.cos(swirlAngle);
          var swirlSin = Math.sin(swirlAngle);
          var swirlX = x * swirlCos - y * swirlSin;
          y = x * swirlSin + y * swirlCos;
          x = swirlX;
          z += localMorph * (seedA[i] - 0.5) * 0.3;
        }

        // Each settled section has its own continuously evolving quantum current.
        if (activeFormation === 0) {
          if (lane24 < 10) {
            // Cloverleaf lobes precess about the axis and breathe.
            var precessX = x * cosPrecess - z * sinPrecess;
            z = x * sinPrecess + z * cosPrecess;
            x = precessX;
            var pulse = 1 + Math.sin(motionTime * 1.15 + phase[i] * 0.6) *
              (0.05 + openingDrive * 0.07) * formationSettle;
            x *= pulse;
            y *= pulse;
          } else if (lane24 < 14) {
            // Polar lobes pulse alternately, a Rabi-like beat.
            y *= 1 + Math.sin(motionTime * 0.95 + (y > 0 ? 0 : Math.PI)) *
              (0.055 + openingDrive * 0.05) * formationSettle;
          } else if (lane24 < 20) {
            // Orbit dashes circulate against the precession.
            var orbitX = x * cosOrbit - z * sinOrbit;
            z = x * sinOrbit + z * cosOrbit;
            x = orbitX;
          } else if (lane24 === 23) {
            // Standing wave along the quantization axis.
            x += Math.sin(y * 5.2 - motionTime * 2.1) * 0.05 * formationSettle;
            z += Math.cos(y * 4.4 - motionTime * 1.7) * 0.035 * formationSettle;
          }
        } else if (activeFormation === 1) {
          x += Math.cos(motionTime * 0.92 + y * 2.35 + phase[i] * 0.14) * 0.085 * formationSettle;
          z += Math.sin(motionTime * 0.92 + y * 2.35 + phase[i] * 0.14) * 0.085 * formationSettle;
        } else if (activeFormation === 2) {
          var rotorRadius = Math.sqrt(x * x + y * y) + 0.08;
          var rotorFlow = Math.sin(motionTime * 1.18 + rotorRadius * 3.3) * 0.052 * formationSettle;
          var rotorX = x;
          x += -y / rotorRadius * rotorFlow;
          y += rotorX / rotorRadius * rotorFlow;
        } else if (activeFormation === 3) {
          var waveCenter = Math.sin(motionTime * 0.34) * 0.52;
          var waveEnvelope = Math.exp(-Math.pow((x - waveCenter) / 0.82, 2));
          x += Math.sin(x * 8.4 - motionTime * 2.25) * waveEnvelope * 0.09 * formationSettle;
          y += Math.sin(x * 6.15 - motionTime * 1.6 + z * 2.2) * waveEnvelope * 0.072 * formationSettle;
          z += Math.cos(x * 5.3 - motionTime * 1.28 + y * 1.7) * waveEnvelope * 0.043 * formationSettle;
        } else if (activeFormation === 4) {
          x += Math.sign(x || 1) * Math.sin(motionTime * 0.88 + phase[i] * 0.17) * 0.038 * formationSettle;
          z += Math.cos(motionTime * 0.73 + y * 3.1) * 0.034 * formationSettle;
        } else if (activeFormation === 5) {
          y += Math.sin(x * 3.45 + z * 2.15 - motionTime * 1.42) * 0.06 * formationSettle;
          z += Math.cos(x * 2.2 - motionTime * 0.76) * 0.028 * formationSettle;
        } else if (activeFormation === 6) {
          var shellRadius = Math.sqrt(x * x + y * y) + 0.09;
          var shellFlow = (0.038 + seedC[i] * 0.04) * formationSettle;
          var shellX = x;
          x += -y / shellRadius * shellFlow * Math.sin(motionTime * 0.82 + phase[i]);
          y += shellX / shellRadius * shellFlow * Math.cos(motionTime * 0.82 + phase[i]);
        } else if (activeFormation === 7) {
          var collapseBreath = 1 + Math.sin(motionTime * 1.12 + phase[i] * 0.04) * 0.052 * formationSettle;
          x *= collapseBreath;
          y *= collapseBreath;
          z *= collapseBreath;
        }

        // Probability current: a phase-driven, divergence-free orbital drift.
        var currentRadius = Math.sqrt(x * x + y * y) + 0.16;
        var currentPhase = phase[i] + motionTime * (0.5 + seedA[i] * 0.34) +
          x * 1.72 - y * 1.08 + z * 0.82 + signedScrollPhase * 0.34;
        var flow = (0.024 + seedC[i] * 0.046) *
          (0.82 + morphEnergy * 0.24 + scrollEnergy * 0.22 + openingDrive * 0.3);
        var currentX = x;
        x += -y / currentRadius * flow * (0.56 + Math.sin(currentPhase) * 0.44);
        y += currentX / currentRadius * flow * (0.56 + Math.cos(currentPhase * 0.91) * 0.44);
        z += Math.sin(currentPhase * 0.73) * flow * 0.82;

        // During a scroll morph, the state briefly decoheres before settling.
        x += Math.sin(motionTime * 1.22 + phase[i] + y * 3.8) *
          localMorph * (0.011 + seedA[i] * 0.016);
        y += Math.cos(motionTime * 1.02 + phase[i] * 1.17 + z * 3.2) *
          localMorph * (0.01 + seedB[i] * 0.015);
        z += Math.sin(motionTime * 0.94 + phase[i] * 0.81 + x * 2.7) *
          localMorph * (0.012 + seedC[i] * 0.018);

        // A reversible measurement front travels from the core to the outer
        // probability shell during the field-only scroll beat.
        if (openingEnergy > 0.002) {
          var openingRadius = Math.sqrt(x * x + y * y + z * z) + 0.001;
          openingBand = Math.exp(-Math.pow((openingRadius - openingShockFront) / 0.2, 2)) *
            openingEnergy;
          var shockDisplacement = openingBand * (0.018 + scrollEnergy * 0.012);
          x += x / openingRadius * shockDisplacement;
          y += y / openingRadius * shockDisplacement;
          z += z / openingRadius * shockDisplacement;
        }
      }

      var drift = reducedMotion ? 0 : (0.014 + seedB[i] * 0.02) * (1 - openingEnergy * 0.58);
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
      var autoBand = 0;

      if (proximityStrength > 0.015) {
        var dx = px - pointer.x;
        var dy = py - pointer.y;
        var distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < pointerRadius * pointerRadius && distanceSquared > 0.25) {
          var distance = Math.sqrt(distanceSquared);
          var influence = Math.pow(1 - distance / pointerRadius, 2) * proximityStrength;
          var wave = Math.sin(distance * 0.105 - time * 5.2);
          var radialPush = influence * (10 + wave * 6);
          // Pointer velocity feeds a decaying vortex: sweeping the field
          // drags a visible swirl of probability behind the cursor.
          var phaseShear = influence * (6 + Math.cos(distance * 0.07 - time * 4.4) * 3 +
            pointer.swirl * 26);
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
        var band = Math.exp(-Math.pow((radial - ripple.front) / 38, 2)) * ripple.decay;
        if (band > 0.005 && radial > 0.5) {
          px += rdx / radial * band * 14;
          py += rdy / radial * band * 14;
        }
      }

      if (eventLife > 0.015) {
        var edx = px - eventX;
        var edy = py - eventY;
        var eventDistance = Math.sqrt(edx * edx + edy * edy);
        var eventWidth = compact ? 30 : 44;
        autoBand = Math.exp(-Math.pow((eventDistance - eventFront) / eventWidth, 2)) * eventLife;
        if (autoBand > 0.004 && eventDistance > 0.5) {
          var eventTurn = Math.sin(eventAge * 4.2 - eventDistance * 0.03) * autoBand;
          px += edx / eventDistance * autoBand * (compact ? 8 : 14) -
            edy / eventDistance * eventTurn * (compact ? 4 : 6);
          py += edy / eventDistance * autoBand * (compact ? 8 : 14) +
            edx / eventDistance * eventTurn * (compact ? 4 : 6);
        }
      }

      if (px < -24 || px > width + 24 || py < -24 || py > height + 24) {
        prevScreenX[i] = px;
        prevScreenY[i] = py;
        continue;
      }

      // |ψ|² from three coherent plane waves plus a moving Gaussian packet.
      var phaseTime = motionTime * (1 + scrollEnergy * 0.16 + openingDrive * 0.22);
      var q1 = x * 3.72 + y * 1.34 - phaseTime * 1.28 +
        scrollState.global * 4.1 + signedScrollPhase * 0.86;
      var q2 = -x * 1.92 + z * 3.36 - phaseTime * 1.03 -
        scrollState.global * 2.7 - signedScrollPhase * 0.61;
      var q3 = y * 2.74 - z * 2.08 + phaseTime * 0.86 + phase[i] * 0.08;
      var psiReal = Math.cos(q1) + Math.cos(q2) * 0.82 + Math.cos(q3) * 0.57;
      var psiImag = Math.sin(q1) + Math.sin(q2) * 0.82 + Math.sin(q3) * 0.57;
      var psiSquared = clamp((psiReal * psiReal + psiImag * psiImag) / 5.72, 0, 1);
      var packetDx = x - packetCenterX;
      var packetDy = y - packetCenterY;
      var packetDz = z - packetCenterZ;
      var packet = Math.exp(-(packetDx * packetDx * 1.55 + packetDy * packetDy * 1.82 +
        packetDz * packetDz * 1.25));
      var radialDensity = Math.exp(-(x * x + y * y) * 0.105);
      var probability = clamp(0.055 + Math.pow(psiSquared, 0.68) * 0.68 +
        packet * 0.34 + radialDensity * 0.16 + autoBand * 0.42 +
        localMorph * 0.035 + scrollEnergy * 0.022 +
        openingEnergy * 0.14 + openingBand * 0.24, 0, 1);
      // Orbit dashes, nucleus, and axis stay legible through the opening.
      var structuralSample = hasOpening && openingPhase > 0.12 && openingPhase < 0.9 &&
        ((lane24 >= 14 && lane24 < 22) || lane24 === 23);
      if (structuralSample) probability = Math.max(probability, 0.52 + openingEnergy * 0.14);

      var depth = clamp((perspective - 0.58) / 0.8, 0, 1);

      // Splat probability density and screen velocity onto the ASCII raster.
      var velocityX = px - prevScreenX[i];
      var velocityY = py - prevScreenY[i];
      prevScreenX[i] = px;
      prevScreenY[i] = py;
      if (velocityX * velocityX + velocityY * velocityY > 2600) {
        // Teleporting samples (first frame, morph snaps) carry no flow.
        velocityX = 0;
        velocityY = 0;
      }
      var cellX = (px / cellSize) | 0;
      var cellY = (py / cellSize) | 0;
      if (cellX >= 0 && cellX < rasterCols && cellY >= 0 && cellY < rasterRows) {
        var weight = probability * (0.32 + depth * 0.68) * 1.45 * densityGain;
        var cellIndex = cellY * rasterCols + cellX;
        rasterDensity[cellIndex] += weight;
        rasterFlowX[cellIndex] += velocityX * weight;
        rasterFlowY[cellIndex] += velocityY * weight;
        if (splatSpread) {
          var spill = weight * 0.32;
          if (cellX > 0) rasterDensity[cellIndex - 1] += spill;
          if (cellX < rasterCols - 1) rasterDensity[cellIndex + 1] += spill;
          if (cellY > 0) rasterDensity[cellIndex - rasterCols] += spill;
          if (cellY < rasterRows - 1) rasterDensity[cellIndex + rasterCols] += spill;
        }
      }

      var sample = seedA[i] * 0.97 +
        fastHash(i * 19 + tick * 131 + Math.floor(motionTime * 0.82) * 17) * 0.03;
      if (!structuralSample && sample > probability + 0.08) continue;

      var size = ((compact ? 4.4 : 4.9) +
        depth * (compact ? 4.5 : 7.7) + probability * 0.9) *
        (1 + openingEnergy * (compact ? 0.07 : 0.13));
      if (structuralSample) size *= 1.14;
      var alpha = clamp((0.09 + probability * 0.7) * (0.3 + depth * 0.84) *
        (1 + openingEnergy * 0.11) * intro * fieldOpacity, 0, 0.92);
      if (structuralSample) {
        alpha = Math.max(alpha, (0.25 + depth * 0.46) * intro * fieldOpacity);
      }
      if (intro < 0.38) alpha *= intro / 0.38;
      if (alpha < 0.015) continue;

      var flicker = psiReal + Math.sin(phase[i] + motionTime * 0.92) > 0 ? 1 : 0;
      if (fastHash(i * 43 + tick * 97) > 0.992) flicker = 1 - flicker;
      var spriteWeight = depth > 0.66 ? 2 : 0;

      // Sparse path-amplitude echoes make depth and direction legible without
      // introducing any mark other than binary glyphs.
      if (!reducedMotion && !compact && detailEffects && i % 15 === 0 && alpha > 0.12) {
        var trailLength = 2.5 + depth * 5.5 + localMorph * 2 +
          scrollEnergy * 3 + openingDrive * 4;
        var trailAngle = currentPhase * 0.46 + yaw;
        ctx.globalAlpha = alpha * 0.17;
        ctx.drawImage(
          glyphs[spriteWeight + (1 - flicker)],
          px - Math.cos(trailAngle) * trailLength - size * 0.34,
          py - Math.sin(trailAngle) * trailLength - size * 0.34,
          size * 0.68,
          size * 0.68
        );
      }

      if (!reducedMotion && detailEffects && i % 91 === 0) {
        var pairWindow = Math.pow(Math.max(0, Math.sin(motionTime * 0.82 + phase[i] * 0.73)), 12);
        if (pairWindow > 0.12) {
          var pairGap = 4 + pairWindow * (compact ? 5 : 8);
          ctx.globalAlpha = alpha * pairWindow * 0.32;
          ctx.drawImage(glyphs[spriteWeight], px - pairGap - size * 0.42, py - size * 0.42, size * 0.84, size * 0.84);
          ctx.drawImage(glyphs[spriteWeight + 1], px + pairGap - size * 0.42, py - size * 0.42, size * 0.84, size * 0.84);
        }
      }

      ctx.globalAlpha = alpha;
      if (i % 89 === 0) {
        var psiSize = size * 1.3;
        ctx.drawImage(psiSprite, px - psiSize * 0.5, py - psiSize * 0.5, psiSize, psiSize);
      } else {
        ctx.drawImage(glyphs[spriteWeight + flicker], px - size * 0.5, py - size * 0.5, size, size);
      }
    }

    // ASCII raster pass — the Dragonfly-style body of the field. Cells sit
    // on a fixed character grid; density picks the glyph, coherent flow
    // replaces it with a direction mark, mid tones flicker between 0 and 1.
    var rasterAlphaBase = intro * fieldOpacity * (compact ? 0.7 : 0.78);
    if (rasterAlphaBase > 0.02) {
      var flowThreshold2 = Math.pow(dt * 0.062, 2);
      for (var cy = 0; cy < rasterRows; cy += 1) {
        var rowOffset = cy * rasterCols;
        var drawY = cy * cellSize;
        for (var cx = 0; cx < rasterCols; cx += 1) {
          var density = rasterDensity[rowOffset + cx];
          if (density < 0.15) continue;
          var cellAlpha = Math.min(0.8, 0.09 + density * 0.34) * rasterAlphaBase;
          if (cellAlpha < 0.02) continue;
          var sprite;
          var flowX = rasterFlowX[rowOffset + cx];
          var flowY = rasterFlowY[rowOffset + cx];
          var flowScale = density > 0.001 ? 1 / density : 0;
          var meanFlowX = flowX * flowScale;
          var meanFlowY = flowY * flowScale;
          var speed2 = meanFlowX * meanFlowX + meanFlowY * meanFlowY;
          if (!reducedMotion && speed2 > flowThreshold2 && density > 0.55) {
            var sector = Math.round(Math.atan2(meanFlowY, meanFlowX) * 4 / Math.PI);
            sprite = directionSprites[(sector + 8) % 8];
            cellAlpha = Math.min(0.82, cellAlpha * 1.35);
          } else if (density < 0.45) {
            sprite = rampSprites[0];
          } else if (density < 0.8) {
            sprite = rampSprites[1];
          } else {
            var bit = fastHash((rowOffset + cx) * 31 + rasterTick * 7) > 0.5 ? 1 : 0;
            sprite = rampSprites[density < 2.05 ? 2 + bit : 4 + bit];
          }
          ctx.globalAlpha = cellAlpha;
          ctx.drawImage(sprite, cx * cellSize, drawY, cellSize, cellSize);
        }
      }
    }

    ctx.globalAlpha = 1;
    var renderCost = performance.now() - renderStarted;
    renderCostAverage = renderCostAverage * 0.94 + renderCost * 0.06;
    if (quality === 2 && renderCostAverage > (compact ? 9.5 : 11.5)) quality = 1;
    else if (quality === 1 && renderCostAverage > (compact ? 12.5 : 14.5)) quality = 0;
    else if (quality === 1 && renderCostAverage < (compact ? 7.2 : 8.4)) quality = 2;
    else if (quality === 0 && renderCostAverage < (compact ? 9.8 : 11)) quality = 1;
    if (!reducedMotion) requestFrame();
  }

  function requestFrame() {
    if (!frame && pageVisible) frame = requestAnimationFrame(render);
  }

  function addRipple(x, y, strength) {
    ripples.push({ x: x, y: y, born: performance.now() / 1000, strength: strength || 1 });
    if (ripples.length > 3) ripples.shift();
    requestFrame();
  }

  window.addEventListener("pointermove", function (event) {
    var stamp = performance.now() / 1000;
    var dt = Math.max(0.004, stamp - pointer.moved);
    if (pointer.active) {
      var speed = Math.sqrt(
        Math.pow(event.clientX - pointer.x, 2) +
        Math.pow(event.clientY - pointer.y, 2)
      ) / dt;
      pointer.swirl = clamp(pointer.swirl + speed * 0.00028, 0, 0.85);
    }
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.active = true;
    pointer.moved = stamp;
    if (hash(Math.floor(stamp * 8)) > 0.83) addRipple(pointer.x, pointer.y, 0.45);
    requestFrame();
  }, { passive: true });

  window.addEventListener("pointerdown", function (event) {
    addRipple(event.clientX, event.clientY, 1);
  }, { passive: true });

  document.addEventListener("mouseleave", function () {
    pointer.active = false;
  });

  window.addEventListener("scroll", function () {
    if (reducedMotion) return;
    var stamp = performance.now();
    var deltaTime = Math.max(8, stamp - lastScrollStamp);
    var scrollDelta = window.scrollY - lastScrollY;
    var instantaneous = Math.min(0.68, Math.abs(scrollDelta) / deltaTime * 0.22);
    scrollEnergy = Math.max(scrollEnergy * 0.56, instantaneous);
    scrollBias = clamp(scrollBias + scrollDelta / deltaTime * 0.045, -1, 1);
    signedScrollPhase += clamp(scrollDelta / Math.max(1, height), -0.28, 0.28) * 1.9;
    lastScrollY = window.scrollY;
    lastScrollStamp = stamp;
    requestFrame();
  }, { passive: true });

  // Debounced: the full rebuild (canvas realloc, sprite bake, re-measure)
  // must not run on every mobile URL-bar show/hide tick.
  var resizeDebounce = 0;
  window.addEventListener("resize", function () {
    var minor = window.innerWidth === lastViewportW &&
      Math.abs(window.innerHeight - lastViewportH) < 140;
    clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(resize, minor ? 240 : 90);
  }, { passive: true });
  window.addEventListener("load", function () {
    measureSections();
    requestFrame();
  }, { once: true });

  document.addEventListener("visibilitychange", function () {
    pageVisible = document.visibilityState !== "hidden";
    if (pageVisible) {
      lastFrame = performance.now();
      requestFrame();
    }
  });

  window.quantumField = {
    setIntroProgress: function (value) {
      introProgress = clamp(value, 0, 1);
      requestFrame();
    },
    setOpeningProgress: function (value) {
      openingTarget = clamp(value, 0, 1);
      requestFrame();
    },
    burst: function (x, y) {
      addRipple(typeof x === "number" ? x : width * 0.5, typeof y === "number" ? y : height * 0.5, 1);
    },
    refresh: function () {
      measureSections();
      render(performance.now());
    }
  };

  // Sprites are baked at startup; rebake once the webfont arrives so the
  // marks render in IBM Plex Mono rather than the fallback monospace.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      buildParticleSprites();
      buildRasterSprites();
      requestFrame();
    });
  }

  root.classList.add("quantum-field-ready");
  resize();
  requestFrame();
})();
