(function () {
  "use strict";

  var canvas = document.getElementById("quantumField");
  if (!canvas) return;

  var ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  var root = document.documentElement;
  var body = document.body;
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var compact = window.matchMedia("(max-width: 760px)").matches;
  var particleCount = reducedMotion ? (compact ? 260 : 560) : (compact ? 560 : 1480);
  var formationCount = 8;
  var formations = [];
  var phase = new Float32Array(particleCount);
  var seedA = new Float32Array(particleCount);
  var seedB = new Float32Array(particleCount);
  var seedC = new Float32Array(particleCount);
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
  var pointer = { x: -9999, y: -9999, active: false, moved: 0 };
  var ripples = [];
  var glyphs = [];
  var scrollEnergy = 0;
  var lastScrollY = window.scrollY;
  var lastScrollStamp = performance.now();

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
  }

  // 00 — a winged probability body: a recognisable living field, never a literal animal.
  formations.push(makeFormation(function (i, u, a, b, c) {
    var lane = i % 12;
    if (lane < 3) {
      var bodyY = -1.24 + u * 2.48;
      return [Math.sin(u * 29) * 0.055 * (0.2 + b), bodyY, (a - 0.5) * 0.25];
    }
    if (lane < 10) {
      var side = lane % 2 ? -1 : 1;
      var reach = Math.pow(a, 0.62);
      var sweep = (b - 0.5) * (0.36 + reach * 0.72);
      var wingY = 0.34 - reach * 0.8 + sweep;
      if (lane > 6) wingY = -0.28 + reach * 0.53 + sweep * 0.55;
      return [
        side * (0.11 + reach * (1.38 - Math.abs(sweep) * 0.24)),
        wingY,
        Math.sin(b * Math.PI) * (lane > 6 ? 0.32 : 0.52) * (c > 0.5 ? 1 : -1)
      ];
    }
    var tail = u * Math.PI * 7;
    return [Math.cos(tail) * (0.13 + a * 0.12), -0.44 - a * 1.08, Math.sin(tail) * 0.22];
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

  function makeGlyph(char, weight) {
    var sprite = document.createElement("canvas");
    sprite.width = 40;
    sprite.height = 40;
    var spriteContext = sprite.getContext("2d");
    spriteContext.clearRect(0, 0, 40, 40);
    spriteContext.fillStyle = "#000";
    spriteContext.textAlign = "center";
    spriteContext.textBaseline = "middle";
    spriteContext.font = weight + " 25px 'IBM Plex Mono', ui-monospace, monospace";
    spriteContext.fillText(char, 20, 20);
    return sprite;
  }

  glyphs = [
    makeGlyph("0", "400"),
    makeGlyph("1", "400"),
    makeGlyph("0", "500"),
    makeGlyph("1", "500")
  ];

  function resize() {
    var bounds = canvas.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    var requestedDpr = Math.min(window.devicePixelRatio || 1, compact ? 1.3 : 1.7);
    var pixelBudget = compact ? 1350000 : 3900000;
    dpr = Math.max(0.78, Math.min(requestedDpr, Math.sqrt(pixelBudget / Math.max(1, width * height))));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    if (!sectionStops.length) sectionStops = [{ index: 0, center: height * 0.5 }];
  }

  function readScroll() {
    var focus = window.scrollY + height * 0.52;
    var pageMax = Math.max(1, document.documentElement.scrollHeight - height);
    scrollState.global = clamp(window.scrollY / pageMax, 0, 1);
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
    frame = 0;
    if (!pageVisible) return;
    if (!reducedMotion) readScroll();

    if (!reducedMotion && now - lastFrame < (compact ? 15 : 14)) {
      requestFrame();
      return;
    }
    lastFrame = now;
    scrollEnergy *= 0.972;

    ctx.clearRect(0, 0, width, height);

    var time = reducedMotion ? 2.1 : now / 1000;
    var targetOpacity = body.classList.contains("wave-active") ? 0.22 : 1;
    fieldOpacity += (targetOpacity - fieldOpacity) * 0.055;
    var centerX = width * (compact ? 0.54 : 0.51) +
      (reducedMotion ? 0 : Math.sin(time * 0.16 + scrollState.global * 4.2) * width * 0.018);
    var centerY = height * (0.4 + scrollState.global * 0.19 +
      Math.sin(scrollState.global * Math.PI * 5) * 0.032) +
      (reducedMotion ? 0 : Math.sin(time * 0.11) * height * 0.014);
    var baseScale = Math.min(width, height) * (compact ? 0.43 : 0.405) *
      (reducedMotion ? 1 : 1 + Math.sin(time * 0.42) * 0.035 + scrollEnergy * 0.032);
    var yaw = -0.25 + scrollState.global * 0.94 +
      (reducedMotion ? 0 : Math.sin(time * 0.19) * 0.14 + scrollEnergy * 0.11);
    var pitch = 0.07 + (reducedMotion ? 0 : Math.cos(time * 0.15) * 0.085);
    var cosYaw = Math.cos(yaw);
    var sinYaw = Math.sin(yaw);
    var cosPitch = Math.cos(pitch);
    var sinPitch = Math.sin(pitch);
    var pointsA = formations[scrollState.a];
    var pointsB = formations[scrollState.b];
    var mix = scrollState.mix;
    var morphEnergy = reducedMotion ? 0 : Math.sin(mix * Math.PI);
    var formationSettle = 1 - morphEnergy * 0.92;
    var activeFormation = mix < 0.5 ? scrollState.a : scrollState.b;
    var intro = ease(introProgress);
    var tick = Math.floor(time * 4.6);
    var pointerAge = Math.max(0, time - pointer.moved);
    var proximityStrength = !reducedMotion && pointer.active ? Math.exp(-pointerAge * 1.55) : 0;
    var eventPeriod = compact ? 7.8 : 6.6;
    var eventSerial = Math.floor(time / eventPeriod);
    var eventAge = time - eventSerial * eventPeriod;
    var eventLife = reducedMotion ? 0 :
      Math.sin(clamp(eventAge / 3.7, 0, 1) * Math.PI) * Math.exp(-Math.max(0, eventAge - 3.7) * 0.72);
    var eventX = width * (0.18 + hash(eventSerial * 17 + 3) * 0.64);
    var eventY = height * (0.2 + hash(eventSerial * 29 + 7) * 0.58);
    var eventFront = eventAge * Math.min(width, height) * (compact ? 0.13 : 0.17);
    var packetCenterX = Math.sin(time * 0.31 + scrollState.global * 5.2) * 0.72;
    var packetCenterY = Math.cos(time * 0.27 - scrollState.global * 3.4) * 0.56;
    var packetCenterZ = Math.sin(time * 0.22 + 1.4) * 0.48;

    var activeRipples = [];
    for (var rippleIndex = ripples.length - 1; rippleIndex >= 0; rippleIndex -= 1) {
      var rippleAge = time - ripples[rippleIndex].born;
      if (rippleAge > 1.65) {
        ripples.splice(rippleIndex, 1);
      } else if (!reducedMotion) {
        var rippleFront = rippleAge * (compact ? 170 : 230);
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

    for (var i = 0; i < particleCount; i += 1) {
      var offset = i * 3;
      var x = pointsA[offset] + (pointsB[offset] - pointsA[offset]) * mix;
      var y = pointsA[offset + 1] + (pointsB[offset + 1] - pointsA[offset + 1]) * mix;
      var z = pointsA[offset + 2] + (pointsB[offset + 2] - pointsA[offset + 2]) * mix;

      if (!reducedMotion) {
        // Each settled section has its own continuously evolving quantum current.
        if (activeFormation === 0) {
          var wingReach = Math.min(1.4, Math.abs(x));
          y += Math.sin(time * 1.52 + wingReach * 2.7 + phase[i] * 0.08) *
            wingReach * 0.075 * formationSettle;
          z += Math.cos(time * 1.18 + y * 2.4) * wingReach * 0.045 * formationSettle;
        } else if (activeFormation === 1) {
          x += Math.cos(time * 0.92 + y * 2.35 + phase[i] * 0.14) * 0.105 * formationSettle;
          z += Math.sin(time * 0.92 + y * 2.35 + phase[i] * 0.14) * 0.105 * formationSettle;
        } else if (activeFormation === 2) {
          var rotorRadius = Math.sqrt(x * x + y * y) + 0.08;
          var rotorFlow = Math.sin(time * 1.18 + rotorRadius * 3.3) * 0.068 * formationSettle;
          var rotorX = x;
          x += -y / rotorRadius * rotorFlow;
          y += rotorX / rotorRadius * rotorFlow;
        } else if (activeFormation === 3) {
          var waveCenter = Math.sin(time * 0.34) * 0.52;
          var waveEnvelope = Math.exp(-Math.pow((x - waveCenter) / 0.82, 2));
          x += Math.sin(x * 8.4 - time * 3.25) * waveEnvelope * 0.105 * formationSettle;
          y += Math.sin(x * 6.15 - time * 2.25 + z * 2.2) * waveEnvelope * 0.088 * formationSettle;
          z += Math.cos(x * 5.3 - time * 1.82 + y * 1.7) * waveEnvelope * 0.052 * formationSettle;
        } else if (activeFormation === 4) {
          x += Math.sign(x || 1) * Math.sin(time * 0.88 + phase[i] * 0.17) * 0.048 * formationSettle;
          z += Math.cos(time * 0.73 + y * 3.1) * 0.042 * formationSettle;
        } else if (activeFormation === 5) {
          y += Math.sin(x * 3.45 + z * 2.15 - time * 1.42) * 0.075 * formationSettle;
          z += Math.cos(x * 2.2 - time * 0.76) * 0.035 * formationSettle;
        } else if (activeFormation === 6) {
          var shellRadius = Math.sqrt(x * x + y * y) + 0.09;
          var shellFlow = (0.038 + seedC[i] * 0.04) * formationSettle;
          var shellX = x;
          x += -y / shellRadius * shellFlow * Math.sin(time * 0.82 + phase[i]);
          y += shellX / shellRadius * shellFlow * Math.cos(time * 0.82 + phase[i]);
        } else if (activeFormation === 7) {
          var collapseBreath = 1 + Math.sin(time * 1.34 + phase[i] * 0.04) * 0.072 * formationSettle;
          x *= collapseBreath;
          y *= collapseBreath;
          z *= collapseBreath;
        }

        // Probability current: a phase-driven, divergence-free orbital drift.
        var currentRadius = Math.sqrt(x * x + y * y) + 0.16;
        var currentPhase = phase[i] + time * (0.76 + seedA[i] * 0.62) +
          x * 1.85 - y * 1.2 + z * 0.94;
        var flow = (0.032 + seedC[i] * 0.062) *
          (1 + morphEnergy * 1.15 + scrollEnergy * 0.72);
        var currentX = x;
        x += -y / currentRadius * flow * (0.56 + Math.sin(currentPhase) * 0.44);
        y += currentX / currentRadius * flow * (0.56 + Math.cos(currentPhase * 0.91) * 0.44);
        z += Math.sin(currentPhase * 0.73) * flow * 1.12;

        // During a scroll morph, the state briefly decoheres before settling.
        x += Math.sin(time * 1.72 + phase[i] + y * 3.8) *
          morphEnergy * (0.07 + seedA[i] * 0.1);
        y += Math.cos(time * 1.43 + phase[i] * 1.17 + z * 3.2) *
          morphEnergy * (0.06 + seedB[i] * 0.095);
        z += Math.sin(time * 1.28 + phase[i] * 0.81 + x * 2.7) *
          morphEnergy * (0.08 + seedC[i] * 0.11);
      }

      var drift = reducedMotion ? 0 : 0.038 + seedB[i] * 0.046;
      x += Math.sin(time * (0.61 + seedA[i] * 0.43) + phase[i]) * drift;
      y += Math.cos(time * (0.52 + seedC[i] * 0.38) + phase[i] * 1.23) * drift;
      z += Math.sin(time * 0.68 + phase[i] * 0.73) * drift * 1.72;

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
      var perspective = 2.85 / (3.1 + rotatedZ);
      var px = centerX + rotatedX * baseScale * perspective;
      var py = centerY + rotatedY * baseScale * perspective;
      var autoBand = 0;

      if (proximityStrength > 0.015) {
        var dx = px - pointer.x;
        var dy = py - pointer.y;
        var radius = compact ? 94 : 138;
        var distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < radius * radius && distanceSquared > 0.25) {
          var distance = Math.sqrt(distanceSquared);
          var influence = Math.pow(1 - distance / radius, 2) * proximityStrength;
          var wave = Math.sin(distance * 0.105 - time * 9.5);
          var radialPush = influence * (16 + wave * 10);
          var phaseShear = influence * (10 + Math.cos(distance * 0.07 - time * 7.4) * 6);
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
          px += rdx / radial * band * 24;
          py += rdy / radial * band * 24;
        }
      }

      if (eventLife > 0.015) {
        var edx = px - eventX;
        var edy = py - eventY;
        var eventDistance = Math.sqrt(edx * edx + edy * edy);
        var eventWidth = compact ? 30 : 44;
        autoBand = Math.exp(-Math.pow((eventDistance - eventFront) / eventWidth, 2)) * eventLife;
        if (autoBand > 0.004 && eventDistance > 0.5) {
          var eventTurn = Math.sin(eventAge * 5.4 - eventDistance * 0.034) * autoBand;
          px += edx / eventDistance * autoBand * (compact ? 15 : 26) -
            edy / eventDistance * eventTurn * (compact ? 7 : 12);
          py += edy / eventDistance * autoBand * (compact ? 15 : 26) +
            edx / eventDistance * eventTurn * (compact ? 7 : 12);
        }
      }

      if (px < -24 || px > width + 24 || py < -24 || py > height + 24) continue;

      // |ψ|² from three coherent plane waves plus a moving Gaussian packet.
      var phaseTime = time * (1 + scrollEnergy * 0.52);
      var q1 = x * 3.72 + y * 1.34 - phaseTime * 1.28 + scrollState.global * 4.1;
      var q2 = -x * 1.92 + z * 3.36 - phaseTime * 1.03 - scrollState.global * 2.7;
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
        morphEnergy * 0.07 + scrollEnergy * 0.045, 0, 1);
      var sample = seedA[i] * 0.92 +
        fastHash(i * 19 + tick * 131 + Math.floor(time * 1.35) * 17) * 0.08;
      if (sample > probability + 0.08) continue;

      var depth = clamp((perspective - 0.58) / 0.8, 0, 1);
      var size = (compact ? 4.9 : 5.15) + depth * (compact ? 4.8 : 7.4) + probability * 0.8;
      var alpha = clamp((0.09 + probability * 0.72) * (0.3 + depth * 0.84) *
        intro * fieldOpacity, 0, 0.9);
      if (intro < 0.38) alpha *= intro / 0.38;
      if (alpha < 0.015) continue;

      var flicker = psiReal + Math.sin(phase[i] + time * 2.35) > 0 ? 1 : 0;
      if (fastHash(i * 43 + tick * 97) > 0.9) flicker = 1 - flicker;
      var weight = depth > 0.66 ? 2 : 0;

      // Sparse path-amplitude echoes make depth and direction legible without
      // introducing any mark other than binary glyphs.
      if (!reducedMotion && !compact && i % 9 === 0) {
        var trailLength = 3.5 + depth * 7.5 + morphEnergy * 4.5 + scrollEnergy * 5.5;
        var trailAngle = currentPhase * 0.46 + yaw;
        ctx.globalAlpha = alpha * 0.17;
        ctx.drawImage(
          glyphs[weight + (1 - flicker)],
          px - Math.cos(trailAngle) * trailLength - size * 0.34,
          py - Math.sin(trailAngle) * trailLength - size * 0.34,
          size * 0.68,
          size * 0.68
        );
      }

      if (!reducedMotion && i % 67 === 0) {
        var pairWindow = Math.pow(Math.max(0, Math.sin(time * 1.14 + phase[i] * 0.73)), 10);
        if (pairWindow > 0.12) {
          var pairGap = 4 + pairWindow * (compact ? 5 : 8);
          ctx.globalAlpha = alpha * pairWindow * 0.32;
          ctx.drawImage(glyphs[weight], px - pairGap - size * 0.42, py - size * 0.42, size * 0.84, size * 0.84);
          ctx.drawImage(glyphs[weight + 1], px + pairGap - size * 0.42, py - size * 0.42, size * 0.84, size * 0.84);
        }
      }

      ctx.globalAlpha = alpha;
      ctx.drawImage(glyphs[weight + flicker], px - size * 0.5, py - size * 0.5, size, size);
    }

    ctx.globalAlpha = 1;
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
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.active = true;
    pointer.moved = performance.now() / 1000;
    if (hash(Math.floor(pointer.moved * 8)) > 0.83) addRipple(pointer.x, pointer.y, 0.45);
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
    var instantaneous = Math.min(1.25, Math.abs(window.scrollY - lastScrollY) / deltaTime * 0.22);
    scrollEnergy = Math.max(scrollEnergy * 0.68, instantaneous);
    lastScrollY = window.scrollY;
    lastScrollStamp = stamp;
    requestFrame();
  }, { passive: true });

  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("load", function () {
    measureSections();
    requestFrame();
  }, { once: true });

  document.addEventListener("visibilitychange", function () {
    pageVisible = document.visibilityState !== "hidden";
    if (pageVisible) requestFrame();
  });

  window.quantumField = {
    setIntroProgress: function (value) {
      introProgress = clamp(value, 0, 1);
      requestFrame();
    },
    burst: function (x, y) {
      addRipple(typeof x === "number" ? x : width * 0.5, typeof y === "number" ? y : height * 0.5, 1);
    },
    refresh: function () {
      measureSections();
      requestFrame();
    }
  };

  root.classList.add("quantum-field-ready");
  resize();
  requestFrame();
})();
