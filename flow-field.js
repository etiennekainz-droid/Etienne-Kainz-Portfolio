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

  var canvas = document.getElementById("flowField");
  if (!canvas) return;

  var ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!ctx) return;

  var root = document.documentElement;
  var body = document.body;
  var TAU = Math.PI * 2;
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var compactQuery = window.matchMedia("(max-width: 760px)");
  var mediumQuery = window.matchMedia("(min-width: 761px) and (max-width: 1180px)");
  var compact = compactQuery.matches;
  var medium = mediumQuery.matches;
  // Reduced motion shows one still frame, so it can afford a denser, more
  // legible point cloud than the old static field did.
  var particleCount = reducedMotion ?
    (compact ? 460 : medium ? 760 : 980) :
    (compact ? 1150 : medium ? 1950 : 2750);
  var phase = new Float32Array(particleCount);
  var seedA = new Float32Array(particleCount);
  var seedB = new Float32Array(particleCount);
  var seedC = new Float32Array(particleCount);
  var seedD = new Float32Array(particleCount);
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
  var scrollState = { a: 0, b: 0, mix: 0, global: 0 };
  var pointer = {
    x: -9999, y: -9999, active: false, moved: 0, swirl: 0,
    vx: 0, vy: 0, fx: -1, fy: -1, pending: false
  };
  var ripples = [];
  var bursts = [];
  var glyphs = [];
  var markSprite = null;
  var scrollEnergy = 0;
  var scrollBias = 0;
  var signedScrollPhase = 0;
  var appliedScrollPhase = 0;
  var lastScrollY = window.scrollY;
  var lastScrollStamp = performance.now();
  var hasOpening = body.classList.contains("home-page") && !!document.querySelector(".hero");
  var openingProgress = hasOpening && !reducedMotion ? 0 : 1;
  var openingTarget = openingProgress;
  var openingExternallyDriven = false;
  var openingStart = 0;
  var openingTravel = 1;
  var pageScrollMax = 1;
  var renderCostAverage = 6;
  var occluded = false;
  var lastEventSerial = -1;
  // Backing-store density: dprScale is lowered by the resolution governor
  // (see governResolution); dprFloor is the density it may not go below.
  var dprScale = 1;
  var dprFloor = 1;

  // Staged quality governor: 2 = full detail, 1 = no echo effects and a
  // lighter solver, 0 = particle stride + single-cell splat, bare solver.
  // Hysteresis avoids flapping.
  var quality = 2;

  // The glyph raster: projected mechanism density is accumulated on a fixed
  // character grid every frame and rendered as a brightness ramp of
  // drafting marks with motion-aligned strokes. The flow solver runs on the
  // very same grid, so one cell is one glyph is one fluid cell.
  var cellSize = compact ? 15 : 13;
  var rasterCols = 0;
  var rasterRows = 0;
  var rasterDensity = null;
  var rasterFlowX = null;
  var rasterFlowY = null;
  var rampSprites = [];
  var directionSprites = [];
  var smokeSprites = [];
  var smokeDot = null;
  var smokeCurl = null;
  var hatchSprite = null;

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
    this.shift = spec.shift || 0;
    this.anchorY = spec.anchorY == null ? -1 : spec.anchorY;
    for (var i = 0; i < n; i += 1) spec.build(this, i, seedA[i], seedB[i], seedC[i], seedD[i]);
  }

  function put(f, i, part, a, b, c, heat) {
    f.part[i] = part;
    f.a[i] = a;
    f.b[i] = b;
    f.c[i] = c;
    f.h[i] = heat;
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
    build: function (f, i, a, b, c, d) {
      var lane = i % 24;
      var angle;
      var radius;
      if (lane < 13 || lane > 21) {
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
    compactZoom: 0.82,
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
      } else if (roll < 0.82) {
        r = rootR - G.R * 0.1;
        angle = a * TAU;
        heat = 0.24;
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
      cl: 2 * gamma / chord,
      alphaDeg: 7
    };
  })();

  var WING_SPAN = 0.62;
  var wing = new Formation({
    unit: 640,
    wind: 1,
    rake: 0,
    shift: -0.1,
    compactZoom: 0.82,
    yaw: 0.14,
    pitch: 0.1,
    build: function (f, i, a, b, c, d) {
      var lane = i % 24;
      var pt = [0, 0, 0];
      if (lane < 7) {
        var station = Math.floor(d * 7);
        WING.outline(a * TAU, pt);
        put(f, i, 0, pt[0], pt[1], -WING_SPAN + station * (WING_SPAN * 2 / 6), pt[2]);
      } else if (lane < 10) {
        var thetas = [WING.leTheta, WING.teTheta, Math.PI * 0.72, Math.PI * 0.4, -Math.PI * 0.55];
        WING.outline(thetas[Math.floor(d * thetas.length)], pt);
        put(f, i, 0, pt[0], pt[1], -WING_SPAN + a * WING_SPAN * 2, pt[2] * 0.9);
      } else if (lane < 22) {
        put(f, i, 1, Math.floor(d * WING.count), b, (c - 0.5) * 0.16, 0.3);
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
        out[3] = 1 - band(1.25, 1.6, Math.abs(out[0]));
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
      g.chain.push([le[0] - dx / len * 0.2, le[1] - dy / len * 0.2, 0, te[0] + dx / len * 0.3, te[1] + dy / len * 0.3, 0]);
      g.thin.push([le[0], le[1], 0, le[0] + 0.95, le[1], 0]);
      g.arcs.push([le[0], le[1], 0, 0.78, 0, Math.atan2(dy, dx), WING.alphaDeg + "°"]);
      g.callouts.push([le[0], le[1], 0, "STAGNATION PT", -1]);
      g.callouts.push([WING.suction[0], WING.suction[1], 0, "SUCTION PEAK", 1]);
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
    compactZoom: 0.8,
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
    }
  });

  // ---------------------------------------------------------------------
  // 05 — three-axis gyroscope (certifications). Outer, middle and inner
  // gimbals turn on alternating axes around a flywheel spinning at speed:
  // four nested elements for four credentials.
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
    build: function (f, i, a, b, c, d) {
      var lane = i % 24;
      var r;
      var angle;
      if (lane < 9) {
        if (d < 0.56) {
          r = (Math.floor(b * 6) + 1) / 6 * DISH_R;
          angle = a * TAU;
        } else {
          r = Math.sqrt(a) * DISH_R;
          angle = Math.floor(b * 16) / 16 * TAU;
        }
        put(f, i, 0, Math.cos(angle) * r, Math.sin(angle) * r, r * r / (4 * DISH_F), 0.3 + 0.32 * Math.pow(r / DISH_R, 2));
      } else if (lane < 11) {
        var minor = b * TAU;
        r = DISH_R + Math.cos(minor) * 0.02;
        put(f, i, 0, Math.cos(a * TAU) * r, Math.sin(a * TAU) * r,
          DISH_R * DISH_R / (4 * DISH_F) + Math.sin(minor) * 0.02, 0.56);
      } else if (lane < 14) {
        if (d < 0.4) {
          var along = a;
          r = 0.02 + along * 0.06;
          put(f, i, 0, Math.cos(b * TAU) * r, Math.sin(b * TAU) * r, DISH_F - 0.08 + along * 0.14, 0.92);
        } else {
          var strut = Math.floor(b * 4) / 4 * TAU + Math.PI / 4;
          var sx = Math.cos(strut) * DISH_R;
          var sy = Math.sin(strut) * DISH_R;
          var sz = DISH_R * DISH_R / (4 * DISH_F);
          put(f, i, 0, sx * (1 - a), sy * (1 - a), sz + (DISH_F + 0.06 - sz) * a, 0.44);
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
      dishPoint(0, 0, DISH_F, feed);
      g.label = "FIG. 06 — GROUND STATION, OPEN CHANNEL";
      g.data = "X-BAND 8.4 GHZ · AZ " + fmt(200 + e.dishAz * 57.3, 1) + "°";
      g.chain.push([v[0], v[1], v[2], far[0], far[1], far[2]]);
      g.callouts.push([rim[0], rim[1], rim[2], "f/D 0.24", 1]);
      g.callouts.push([feed[0], feed[1], feed[2], "FEED HORN", -1]);
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
      if (b < 0.8) {
        var strut = Math.floor(d * 4) * Math.PI / 2 + Math.PI / 4;
        put(f, i, 0, Math.cos(strut) * 0.2 * (1 - a), -0.8 - 0.3 * a, Math.sin(strut) * 0.2 * (1 - a), 0.32);
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
    compactZoom: 0.6,
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
    compactZoom: 0.6,
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
  if (hasOpening && !reducedMotion) {
    var kImage = new Image();
    kImage.onload = function () {
      var sampleH = 110;
      var sampleW = Math.max(1, Math.round(sampleH * kImage.width / kImage.height));
      var sampler = document.createElement("canvas");
      sampler.width = sampleW;
      sampler.height = sampleH;
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
    };
    kImage.src = "assets/brand/k-mark.png?v=3";
  }

  // Baked in device pixels against the largest size a mark is ever drawn at
  // (~23 CSS px for the Ø marker), so the sprite is always downscaled and
  // never stretched.
  var GLYPH_CSS_MAX = 24;
  function makeGlyph(char, weight) {
    var device = Math.max(24, Math.min(96, Math.round(GLYPH_CSS_MAX * dpr)));
    var sprite = document.createElement("canvas");
    sprite.width = device;
    sprite.height = device;
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
  // a rare diameter mark drifting through the hardware.
  function buildParticleSprites() {
    glyphs = [
      makeGlyph("+", "400"),
      makeGlyph("×", "400"),
      makeGlyph("+", "500"),
      makeGlyph("×", "500")
    ];
    markSprite = makeGlyph("Ø", "400");
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
    // then FEM/tolerance marks in the hot core, like a contour plot.
    rampSprites = [
      makeRasterGlyph("·", "400", 1.05),
      makeRasterGlyph(":", "400", 0.92),
      makeRasterGlyph("+", "400", 0.98),
      makeRasterGlyph("×", "400", 0.98),
      makeRasterGlyph("Δ", "500", 0.92),
      makeRasterGlyph("±", "500", 0.98)
    ];
    // Motion-aligned strokes by screen direction (8 sectors, y down).
    directionSprites = [
      makeRasterGlyph(">", "400", 0.94),
      makeRasterGlyph("\\", "400", 0.98),
      makeRasterGlyph("|", "400", 0.98),
      makeRasterGlyph("/", "400", 0.98),
      makeRasterGlyph("<", "400", 0.94),
      makeRasterGlyph("\\", "400", 0.98),
      makeRasterGlyph("|", "400", 0.98),
      makeRasterGlyph("/", "400", 0.98)
    ];
    // Smoke: thin streak marks along the local flow direction.
    smokeSprites = [
      makeRasterGlyph("-", "400", 1),
      makeRasterGlyph("\\", "400", 0.9),
      makeRasterGlyph("|", "400", 0.9),
      makeRasterGlyph("/", "400", 0.9)
    ];
    smokeDot = makeRasterGlyph("·", "400", 0.9);
    smokeCurl = makeRasterGlyph("~", "400", 1);
    // Section-cut hatching (ISO 128: thin 45° lines).
    hatchSprite = makeRasterGlyph("/", "500", 1.08);
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

    // Inflow column and the smoke rake: pulsed timelines, so streak spacing
    // shows local speed the way a smoke-wire does in a real tunnel.
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
    cx: 0, cy: 0, scale: 1,
    cosYaw: 1, sinYaw: 0, cosPitch: 1, sinPitch: 0, cosRoll: 1, sinRoll: 0
  };

  function project(x, y, z, out) {
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
  var guides = { label: "", data: "", chain: [], thin: [], circles: [], callouts: [], balloons: [], arcs: [] };
  var PA = new Float32Array(3);
  var PB = new Float32Array(3);
  // Smoothed screen-space extents of the mechanism, with the positions of
  // its extreme points so extension lines start on real geometry.
  var bbox = { valid: false, l: 0, r: 0, t: 0, b: 0, ly: 0, ry: 0, tx: 0, bx: 0 };
  var bboxRaw = { l: 0, r: 0, t: 0, b: 0, ly: 0, ry: 0, tx: 0, bx: 0 };
  var fontPx = compact ? 8.5 : 10;
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
    var dimY = Math.min(height - 46, bbox.b + 20);
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
    var top = bbox.t - 20;
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
    ctx.lineDashOffset = -time * 7;
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

    // View label, set like a drawing's view title.
    if (guides.label && bbox.valid) {
      setFont("500");
      var labelWidth = ctx.measureText(guides.label).width;
      var railClear = compact ? 16 : 96;
      var lx = clamp(bbox.l, railClear, Math.max(railClear, width - labelWidth - 18));
      var ly = dimY > 0 ? dimY + 24 : bbox.t - 30;
      ly = clamp(ly, 40, height - 30);
      ctx.globalAlpha = alpha * 0.6;
      ctx.fillRect(lx, ly - fontPx - 5, Math.min(labelWidth, 28) * grow, 1);
      knockoutText(guides.label, lx, ly, "left", alpha * 0.72 * grow);
      setFont("400");
      knockoutText(guides.data, lx, ly + fontPx + 5, "left", alpha * 0.5 * grow);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------
  var lastViewportW = 0;
  var lastViewportH = 0;

  function resize() {
    lastViewportW = window.innerWidth;
    lastViewportH = window.innerHeight;
    // Breakpoints are re-read here, not just at load: rotating a phone or
    // resizing a window crosses them, and every quality knob below keys off
    // them. Particle count stays put — reallocating the formation buffers
    // mid-session would cost far more than the extra points are worth.
    compact = compactQuery.matches;
    medium = mediumQuery.matches;
    cellSize = compact ? 15 : 13;
    fontPx = compact ? 8.5 : 10;
    var bounds = canvas.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    // Render at native resolution where the pixel budget allows — the
    // glyphs stay razor sharp on retina displays. The pixel budget is the
    // real cost governor, so the caps can sit near native density.
    var requestedDpr = Math.min(window.devicePixelRatio || 1, compact ? 2.5 : medium ? 2.25 : 2);
    var pixelBudget = compact ? 2600000 : medium ? 3500000 : 5600000;
    var baseDpr = Math.max(0.9, Math.min(requestedDpr, Math.sqrt(pixelBudget / Math.max(1, width * height))));
    // The governor may trade density for frame rate, but never below the
    // floor.
    dprFloor = Math.min(baseDpr, compact ? 1.5 : 1);
    dpr = Math.max(dprFloor, baseDpr * dprScale);
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
    }
    allocFluid();
    buildParticleSprites();
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
    pageScrollMax = Math.max(1, document.documentElement.scrollHeight - height);
    // The opening chain lands on formation 1, so the hero stop must agree —
    // otherwise the first scroll past the hero lerps abruptly back toward 0.
    if (hasOpening && !reducedMotion && sectionStops.length && sectionStops[0].index === 0) {
      sectionStops[0].index = 1;
    }
    if (!sectionStops.length) sectionStops = [{ index: 0, center: height * 0.5 }];
  }

  function readScroll(dtSeconds) {
    var focus = window.scrollY + height * 0.52;
    scrollState.global = clamp(window.scrollY / pageScrollMax, 0, 1);
    if (hasOpening) {
      if (!openingExternallyDriven) {
        openingTarget = reducedMotion ? 1 : clamp((window.scrollY - openingStart) / openingTravel, 0, 1);
        openingProgress += (openingTarget - openingProgress) *
          (1 - Math.exp(-dtSeconds * 7.2));
      }
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
    if (median > 25 && renderCostAverage < median * 0.45 && dpr > dprFloor + 0.05) {
      dprScale *= 0.82;
      window.setTimeout(resize, 0);
    }
  }

  // rAF entry point. On high-refresh displays the field renders at most every
  // ~10.5 ms — every other vsync at 120 Hz — because its motion is slow and
  // ambient; the halved cost goes to scrolling and the page's own animations.
  var MIN_FRAME_GAP = 10.5;
  function tick(now) {
    frame = 0;
    if (!pageVisible || occluded) return;
    if (now - lastFrame < MIN_FRAME_GAP) {
      frame = requestAnimationFrame(tick);
      return;
    }
    render(now);
  }

  function blend(fa, fb, key, mix) {
    return fa[key] + (fb[key] - fa[key]) * mix;
  }

  var CUT_PERIOD = 14;
  var CUT_TIME = 3.6;

  function render(now) {
    // render is invoked both by rAF and synchronously (resize/refresh);
    // cancelling any pending frame prevents duplicate rAF chains from
    // stacking up and multiplying the per-frame cost.
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (!pageVisible || occluded) return;

    var gap = now - lastFrame;
    var dt = clamp(gap, 1, 50);
    lastFrame = now;
    governResolution(gap);
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
    var peakOpeningScale = compact ? 1.04 : medium ? 1.07 : 1.1;
    var openingScale = 1 + (peakOpeningScale - 1) * openingRamp * (1 - openingSettle);
    // During the visible K handoff, both the DOM mark and the sampled particle
    // mark share one pose. The lock releases gradually as the K disperses.
    var kHandoffLock = hasOpening && kFormation && !reducedMotion ?
      ease(clamp((openingPhase - 0.18) / 0.12, 0, 1)) *
      (1 - ease(clamp((openingPhase - 0.48) / 0.18, 0, 1))) : 0;
    var kHandoffDrift = Math.sin(clamp((openingPhase - 0.3) / 0.3, 0, 1) * Math.PI * 0.5);

    // Which two formations are on stage, and how far between them.
    var fA = formations[scrollState.a];
    var fB = formations[scrollState.b];
    var mix = scrollState.mix;
    if (hasOpening && openingPhase < 0.999) {
      if (kFormation) {
        // Fan stage → the Kainz mark → thrust chamber → ignition → gears.
        if (openingPhase < 0.36) {
          fA = formations[0];
          fB = kFormation;
          mix = ease(clamp((openingPhase - 0.08) / 0.22, 0, 1));
        } else if (openingPhase < 0.62) {
          fA = kFormation;
          fB = engine;
          mix = ease(clamp((openingPhase - 0.4) / 0.22, 0, 1));
        } else if (openingPhase < 0.86) {
          fA = engine;
          fB = ignition;
          mix = ease(clamp((openingPhase - 0.62) / 0.1, 0, 1));
        } else {
          fA = ignition;
          fB = formations[1];
          mix = ease(clamp((openingPhase - 0.86) / 0.14, 0, 1));
        }
      } else if (openingPhase < 0.5) {
        fA = formations[0];
        fB = engine;
        mix = ease(clamp((openingPhase - 0.12) / 0.34, 0, 1));
      } else if (openingPhase < 0.86) {
        fA = engine;
        fB = ignition;
        mix = ease(clamp((openingPhase - 0.62) / 0.1, 0, 1));
      } else {
        fA = ignition;
        fB = formations[1];
        mix = ease(clamp((openingPhase - 0.86) / 0.14, 0, 1));
      }
    }
    var dominant = mix < 0.5 ? fA : fB;

    // Drive state. Scroll is the throttle; scrolling also turns the gears.
    var throttle = 1 + scrollEnergy * 2.4 + openingDrive * 0.8;
    var scrollDelta = signedScrollPhase - appliedScrollPhase;
    appliedScrollPhase = signedScrollPhase;
    var ignitionLevel = hasOpening && !reducedMotion ?
      band(0.62, 0.7, openingPhase) * (1 - band(0.88, 0.97, openingPhase)) : 0;
    env.t = motionTime;
    env.ign = ignitionLevel;
    env.clock = Math.max(0, openingPhase - 0.64) * 14;
    if (!reducedMotion) {
      env.spinRate = 1.05 * throttle;
      env.gearRate = 0.3 * throttle + scrollDelta * 0.9 / Math.max(0.008, dtSeconds);
      env.spin += dtSeconds * env.spinRate;
      env.gear += dtSeconds * 0.3 * throttle + scrollDelta * 0.9;
      env.slow += dtSeconds * 0.42 * (1 + scrollEnergy);
      env.flow += dtSeconds * 0.55 * throttle;
      env.fly += dtSeconds * 0.16 * throttle;
    }
    if (fA.frame) fA.frame(env);
    if (fB !== fA && fB.frame) fB.frame(env);

    var centerX = width * (compact ? 0.54 : 0.51) +
      (reducedMotion ? 0 :
        Math.sin(motionTime * 0.14 + scrollState.global * 3.2) * width * 0.012 +
        Math.sin(openingPhase * Math.PI * 2) * width * 0.018 * openingEnergy);
    var driftY = height * (0.42 + scrollState.global * 0.16 +
      Math.sin(scrollState.global * Math.PI * 5) * 0.018);
    var targetA = fA.anchorY >= 0 ? height * fA.anchorY : driftY + height * fA.shift;
    var targetB = fB.anchorY >= 0 ? height * fB.anchorY : driftY + height * fB.shift;
    var centerY = targetA + (targetB - targetA) * mix +
      (reducedMotion ? 0 : Math.sin(motionTime * 0.1) * height * 0.008);
    var baseScale = Math.min(width, height) * (compact ? 0.43 : 0.405) *
      openingScale * blend(fA, fB, compact ? "compactZoom" : "zoom", mix) *
      (reducedMotion ? 1 : 1 + Math.sin(motionTime * 0.38) * 0.012 + scrollEnergy * 0.018);
    if (kHandoffLock > 0.001) {
      var targetKHeight = Math.min(height * 0.55, width * 0.54);
      var targetKScale = targetKHeight / (1.2 * (2.85 / 3.1));
      var lockedCenterX = width * 0.51;
      var lockedCenterY = height * 0.45 - kHandoffDrift * 30;
      centerX += (lockedCenterX - centerX) * kHandoffLock;
      centerY += (lockedCenterY - centerY) * kHandoffLock;
      baseScale += (targetKScale - baseScale) * kHandoffLock;
    }
    var yaw = blend(fA, fB, "yaw", mix) + (scrollState.global - 0.5) * 0.34 +
      (reducedMotion ? 0 :
        Math.sin(motionTime * 0.17) * 0.06 + scrollEnergy * 0.05 +
        openingEnergy * Math.sin(openingPhase * Math.PI * 2) * 0.05);
    var pitch = blend(fA, fB, "pitch", mix) + (reducedMotion ? 0 :
      Math.cos(motionTime * 0.13) * 0.035);
    // The whole projection banks slightly with scroll momentum.
    var roll = reducedMotion ? 0 : Math.sin(motionTime * 0.11) * 0.014 + scrollBias * 0.05;
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
    var morphStagger = 0.44;
    var morphActive = mix > 0.0001 && mix < 0.9999;
    var intro = ease(introProgress);
    var tick = Math.floor(motionTime * 2.2);
    var rasterTick = reducedMotion ? 7 : Math.floor(time * 1.6);
    var pointerAge = Math.max(0, time - pointer.moved);
    var proximityStrength = !reducedMotion && pointer.active ? Math.exp(-pointerAge * 1.35) : 0;
    var pointerRadius = compact ? 112 : 172;
    // Ambient pressure pulse: a blast front that crosses the field now and
    // then, displacing glyphs and kicking the smoke outward.
    var eventPeriod = compact ? 14.5 : 13.2;
    var eventSerial = Math.floor(time / eventPeriod);
    var eventAge = time - eventSerial * eventPeriod;
    var eventLife = reducedMotion ? 0 :
      Math.sin(clamp(eventAge / 4.8, 0, 1) * Math.PI) * Math.exp(-Math.max(0, eventAge - 4.8) * 0.62);
    eventLife *= 1 - openingEnergy * 0.82;
    var eventX = width * (0.18 + hash(eventSerial * 17 + 3) * 0.64);
    var eventY = height * (0.2 + hash(eventSerial * 29 + 7) * 0.58);
    var eventFront = eventAge * Math.min(width, height) * (compact ? 0.072 : 0.088);
    if (!reducedMotion && eventSerial !== lastEventSerial && eventAge < 0.5) {
      lastEventSerial = eventSerial;
      bursts.push([eventX, eventY, 26, 0.6]);
    }
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
      kWindow = ease(clamp((openingPhase - 0.12) / 0.18, 0, 1)) *
        (1 - ease(clamp((openingPhase - 0.42) / 0.2, 0, 1)));
    }
    var particleStride = quality === 0 ? 2 : 1;
    var splatSpread = quality === 0 ? 0 : 1;
    var detailEffects = quality === 2;
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
    var foundBox = false;
    var boxL = 1e9;
    var boxR = -1e9;
    var boxT = 1e9;
    var boxB = -1e9;
    var boxLY = 0;
    var boxRY = 0;
    var boxTX = 0;
    var boxBX = 0;

    for (var i = 0; i < particleCount; i += particleStride) {
      var localMix = mix;
      if (morphActive) {
        // Each particle joins the morph on its own seeded delay, so
        // formations reassemble as a travelling swarm wave.
        localMix = ease(clamp((mix - seedB[i] * morphStagger) / (1 - morphStagger), 0, 1));
      }
      var x;
      var y;
      var z;
      var presence;
      var heat;
      var tracer;
      OUT[5] = 0;
      if (localMix < 0.9999) {
        fA.motion(fA, i, env, OUT);
        x = OUT[0];
        y = OUT[1];
        z = OUT[2];
        presence = OUT[3];
        heat = OUT[4];
        tracer = OUT[5];
        if (localMix > 0.0001) {
          OUT[5] = 0;
          fB.motion(fB, i, env, OUT);
          x += (OUT[0] - x) * localMix;
          y += (OUT[1] - y) * localMix;
          z += (OUT[2] - z) * localMix;
          presence += (OUT[3] - presence) * localMix;
          heat += (OUT[4] - heat) * localMix;
          if (localMix > 0.5) tracer = OUT[5];
        }
      } else {
        fB.motion(fB, i, env, OUT);
        x = OUT[0];
        y = OUT[1];
        z = OUT[2];
        presence = OUT[3];
        heat = OUT[4];
        tracer = OUT[5];
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
          var swirlAngle = localMorph * (seedC[i] - 0.5) * 1.7;
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
        (0.003 + seedB[i] * 0.004) * (1 - kWindow * 0.85) + localMorph * 0.01;
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
          // drags a visible swirl behind the cursor.
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
        var rippleBand = Math.exp(-Math.pow((radial - ripple.front) / 38, 2)) * ripple.decay;
        if (rippleBand > 0.005 && radial > 0.5) {
          px += rdx / radial * rippleBand * 14;
          py += rdy / radial * rippleBand * 14;
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

      // Two-way coupling: gusts in the air (pointer wakes, the plume, blast
      // fronts) buffet the glyphs; the steady freestream does not.
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
      var probability = clamp(0.1 + heat * 0.64 + packet * 0.12 + autoBand * 0.42 +
        localMorph * 0.05 + scrollEnergy * 0.03 +
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
      if (sample > probability + 0.08) continue;

      var size = ((compact ? 4.4 : 4.9) +
        depth * (compact ? 4.5 : 7.4) + probability * 0.9) *
        (1 + openingEnergy * (compact ? 0.05 : 0.1));
      var alpha = clamp((0.09 + probability * 0.7) * (0.3 + depth * 0.84) *
        (1 + openingEnergy * 0.11) * intro * presence, 0, 0.92);
      if (intro < 0.38) alpha *= intro / 0.38;
      if (alpha < 0.015) continue;

      var flicker = Math.sin(phase[i] + motionTime * 0.92 + heat * 3) > 0 ? 1 : 0;
      if (fastHash(i * 43 + tick * 97) > 0.992) flicker = 1 - flicker;
      var spriteWeight = depth > 0.66 ? 2 : 0;

      // Sparse motion echoes make direction legible on the moving parts.
      if (!reducedMotion && !compact && detailEffects && i % 15 === 0 && alpha > 0.12 &&
          velocityX * velocityX + velocityY * velocityY > 0.6) {
        var trail = 1.6 + depth * 2.4 + localMorph * 2 + scrollEnergy * 2;
        ctx.globalAlpha = alpha * 0.2;
        ctx.drawImage(
          glyphs[spriteWeight + (1 - flicker)],
          px - velocityX * trail - size * 0.34,
          py - velocityY * trail - size * 0.34,
          size * 0.68,
          size * 0.68
        );
      }

      ctx.globalAlpha = alpha;
      if (i % 97 === 0) {
        var markSize = size * 1.25;
        ctx.drawImage(markSprite, px - markSize * 0.5, py - markSize * 0.5, markSize, markSize);
      } else {
        ctx.drawImage(glyphs[spriteWeight + flicker], px - size * 0.5, py - size * 0.5, size, size);
      }
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
          jdx / jl * jetSpeed, (jdy / jl + wobble * 0.18) * jetSpeed, 0.5 * ignitionLevel, 1);
      }
      var rakeOn = frac(time * 0.85) < 0.56;
      var rakeLevel = blend(fA, fB, "rake", mix);
      fluidStep(fdt, dtSeconds, {
        ux: freestream,
        uy: -scrollBias * 4,
        solid: blend(fA, fB, "solid", mix) * (1 - kWindow * 0.6),
        emit: morphEnergy * 1.3,
        rake: rakeOn && rakeLevel > 0.02 ? (0.55 + 0.45 * rakeLevel) * (1 - kWindow) : 0,
        rakeTop: rakeTop,
        rakeBottom: rakeBottom,
        rakeSpacing: compact ? 4 : 5,
        confine: quality === 2 ? 9 : quality === 1 ? 6 : 0,
        iters: (quality === 2 ? 14 : 8) - (fluid.n > 14000 ? 4 : 0),
        decay: 0.19
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
    var rasterAlphaBase = intro * (compact ? 0.7 : 0.78);
    if (rasterAlphaBase > 0.02) {
      var flowThreshold2 = Math.pow(dt * 0.062, 2);
      var dye = fluidOn ? fluid.dye : null;
      var smokeU = fluidOn ? fluid.u : null;
      var smokeV = fluidOn ? fluid.v : null;
      var curl = fluidOn ? fluid.curl : null;
      var smokeAlphaBase = rasterAlphaBase * 0.95;
      var cutCellMin = cutX > -9999 ? cutX - cellSize * 1.4 : 1e9;
      var cutCellMax = cutX > -9999 ? cutX + cellSize * 0.4 : -1e9;
      for (var cy = 0; cy < rasterRows; cy += 1) {
        var rowOffset = cy * rasterCols;
        var drawY = cy * cellSize;
        for (var cx = 0; cx < rasterCols; cx += 1) {
          var idx = rowOffset + cx;
          var density = rasterDensity[idx];
          var sprite;
          var cellAlpha;
          if (density >= 0.17) {
            cellAlpha = Math.min(0.8, 0.09 + density * 0.34) * rasterAlphaBase;
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
            } else if (!reducedMotion && speed2 > flowThreshold2 && density > 0.55) {
              var sector = Math.round(Math.atan2(meanFlowY, meanFlowX) * 4 / Math.PI);
              sprite = directionSprites[(sector + 8) % 8];
              cellAlpha = Math.min(0.82, cellAlpha * 1.35);
            } else if (density < 0.45) {
              sprite = rampSprites[0];
            } else if (density < 0.8) {
              sprite = rampSprites[1];
            } else {
              var bit = fastHash(idx * 31 + rasterTick * 7) > 0.5 ? 1 : 0;
              sprite = rampSprites[density < 2.05 ? 2 + bit : 4 + bit];
            }
            ctx.globalAlpha = cellAlpha;
            ctx.drawImage(sprite, drawX, drawY, cellSize, cellSize);
          } else if (dye) {
            var smoke = dye[idx];
            if (smoke < 0.07) continue;
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
            if (smoke < 0.13) {
              sprite = smokeDot;
            } else if (curl && Math.abs(curl[idx]) > 2.6 && smoke > 0.3) {
              sprite = smokeCurl;
            } else {
              var smokeSector = Math.round(Math.atan2(sv, su) * 4 / Math.PI);
              sprite = smokeSprites[(smokeSector + 8) % 4];
            }
            ctx.globalAlpha = Math.min(0.58, 0.08 + smoke * 0.55) * smokeAlphaBase;
            ctx.drawImage(sprite, cx * cellSize, drawY, cellSize, cellSize);
          }
        }
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

    ctx.globalAlpha = 1;
    var renderCost = performance.now() - renderStarted;
    renderCostAverage = renderCostAverage * 0.94 + renderCost * 0.06;
    if (quality === 2 && renderCostAverage > (compact ? 10.5 : 12.5)) quality = 1;
    else if (quality === 1 && renderCostAverage > (compact ? 13.5 : 15.5)) quality = 0;
    else if (quality === 1 && renderCostAverage < (compact ? 7.6 : 8.8)) quality = 2;
    else if (quality === 0 && renderCostAverage < (compact ? 10.2 : 11.5)) quality = 1;
    if (!reducedMotion) requestFrame();
  }

  function requestFrame() {
    if (!frame && pageVisible && !occluded) frame = requestAnimationFrame(tick);
  }

  // A full-screen opaque layer (menu, project file, lightbox) hides the field
  // completely; stop rendering until it starts to move away.
  document.addEventListener("ek:occlusion", function (event) {
    var next = !!(event.detail && event.detail.occluded);
    if (next === occluded) return;
    occluded = next;
    resetGovernor(30);
    if (occluded) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    } else {
      lastFrame = performance.now();
      requestFrame();
    }
  });

  function addRipple(x, y, strength) {
    ripples.push({ x: x, y: y, born: performance.now() / 1000, strength: strength || 1 });
    if (ripples.length > 3) ripples.shift();
    bursts.push([x, y, 34 * (strength || 1), 0.9 * (strength || 1)]);
    requestFrame();
  }

  window.addEventListener("pointermove", function (event) {
    if (event.pointerType === "touch") return;
    var stamp = performance.now() / 1000;
    var dt = Math.max(0.004, stamp - pointer.moved);
    if (pointer.active) {
      var mx = event.clientX - pointer.x;
      var my = event.clientY - pointer.y;
      var speed = Math.sqrt(mx * mx + my * my) / dt;
      pointer.swirl = clamp(pointer.swirl + speed * 0.00028, 0, 0.85);
      if (dt < 0.25) {
        pointer.vx = pointer.vx * 0.4 + mx / dt * 0.6;
        pointer.vy = pointer.vy * 0.4 + my / dt * 0.6;
        pointer.pending = true;
      } else {
        pointer.fx = event.clientX;
        pointer.fy = event.clientY;
      }
    } else {
      pointer.fx = event.clientX;
      pointer.fy = event.clientY;
    }
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.active = true;
    pointer.moved = stamp;
    if (hash(Math.floor(stamp * 8)) > 0.83) {
      ripples.push({ x: pointer.x, y: pointer.y, born: stamp, strength: 0.45 });
      if (ripples.length > 3) ripples.shift();
    }
    requestFrame();
  }, { passive: true });

  window.addEventListener("pointerdown", function (event) {
    if (event.pointerType === "touch") return;
    addRipple(event.clientX, event.clientY, 1);
  }, { passive: true });

  document.addEventListener("mouseleave", function () {
    pointer.active = false;
    pointer.fx = -1;
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
    resetGovernor(30);
    if (pageVisible) {
      lastFrame = performance.now();
      requestFrame();
    }
  });

  window.flowField = {
    // Read-only snapshot for diagnostics and automated tests.
    stats: function () {
      return {
        dpr: Math.round(dpr * 100) / 100,
        dprFloor: Math.round(dprFloor * 100) / 100,
        quality: quality,
        occluded: occluded,
        renderCost: Math.round(renderCostAverage * 10) / 10,
        fluidCells: fluid.n,
        streamlines: WING.count,
        opening: Math.round(openingProgress * 1000) / 1000,
        stage: [scrollState.a, scrollState.b, Math.round(scrollState.mix * 100) / 100]
      };
    },
    setIntroProgress: function (value) {
      introProgress = clamp(value, 0, 1);
      requestFrame();
    },
    setOpeningProgress: function (value) {
      openingExternallyDriven = true;
      openingProgress = clamp(value, 0, 1);
      openingTarget = openingProgress;
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

  root.classList.add("flow-field-ready");
  resize();
  requestFrame();
})();
