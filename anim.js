/* ============================================================
   Scientific figure animations — drafting-style, no libraries.
   1) #latticeCanvas — 3-D crystal lattice, rotating in perspective;
      a longitudinal elastic wavepacket sweeps through, bonds tint
      amber with strain; pointer steers the view; live HUD readout.
   2) #stressCanvas  — engineering stress–strain curve, self-tracing.
   Both pause off-screen and render a static frame under
   prefers-reduced-motion.
   ============================================================ */
(function () {
  "use strict";

  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var INK = "rgba(200,214,226,";     // line ink
  var ACC = "rgba(147,180,205,";     // drafting blue
  var AMB = "rgba(207,160,104,";     // strain amber

  function setupCanvas(canvas, cssH) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = canvas.clientWidth || canvas.parentElement.clientWidth;
    canvas.width = w * dpr;
    canvas.height = cssH * dpr;
    canvas.style.height = cssH + "px";
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: cssH };
  }

  /* run `draw(t)` only while visible; single static frame if reduced motion */
  function animate(canvas, draw) {
    if (REDUCED) {
      draw(2.0);
      return function () { draw(2.0); };
    }

    var onscreen = false, pageVisible = !document.hidden, raf = 0;
    var clock = 0, lastFrame = null;
    function active() { return onscreen && pageVisible; }
    function stop() {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      lastFrame = null;
    }
    function loop(now) {
      raf = 0;
      if (!active()) { lastFrame = null; return; }
      if (lastFrame !== null) clock += Math.max(0, now - lastFrame) / 1000;
      lastFrame = now;
      draw(clock);
      if (active()) raf = requestAnimationFrame(loop);
    }
    function sync() {
      if (active()) {
        if (!raf) {
          lastFrame = null;
          raf = requestAnimationFrame(loop);
        }
      } else {
        stop();
      }
    }
    function setVisible(isVisible) {
      onscreen = isVisible;
      sync();
    }

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { setVisible(en.isIntersecting); });
      }, { threshold: 0.05 }).observe(canvas);
    } else {
      setVisible(true);
    }
    document.addEventListener("visibilitychange", function () {
      pageVisible = !document.hidden;
      sync();
    });
    return function () { draw(clock); };
  }

  /* ============================================================
     1. CRYSTAL LATTICE — coupled elastic-wave field
     P and S packets travel through a cubic steel-like lattice,
     with a delayed reflected packet and bond-level strain response.
     ============================================================ */
  var lattice = document.getElementById("latticeCanvas");
  if (lattice) (function () {
    var H = 390;
    var L;
    function resizeLattice() {
      H = lattice.clientWidth < 560 ? 332 : 390;
      L = setupCanvas(lattice, H);
    }
    resizeLattice();

    var NX = 15, NY = 6, NZ = 5, S = 46;
    var atoms = [], bonds = [];
    var span = (NX - 1) * S;
    var pad = 230;

    (function build() {
      var i, j, k;
      for (i = 0; i < NX; i += 1) for (j = 0; j < NY; j += 1) for (k = 0; k < NZ; k += 1) {
        atoms.push({
          x: (i - (NX - 1) / 2) * S,
          y: (j - (NY - 1) / 2) * S,
          z: (k - (NZ - 1) / 2) * S,
          i: i, j: j, k: k
        });
      }
      function index(x, y, z) { return (x * NY + y) * NZ + z; }
      for (i = 0; i < NX; i += 1) for (j = 0; j < NY; j += 1) for (k = 0; k < NZ; k += 1) {
        var here = index(i, j, k);
        if (i + 1 < NX) bonds.push({ a: here, b: index(i + 1, j, k), axis: "x", rest: S });
        if (j + 1 < NY) bonds.push({ a: here, b: index(i, j + 1, k), axis: "y", rest: S });
        if (k + 1 < NZ) bonds.push({ a: here, b: index(i, j, k + 1), axis: "z", rest: S });
      }
    })();

    function pulseAt(x, time, speed, phase, width, frequency, direction) {
      var cycle = span + pad * 2;
      var travel = (time * speed + phase) % cycle;
      var centre = direction * (travel - pad - span / 2);
      var delta = x - centre;
      var envelope = Math.exp(-(delta * delta) / (2 * width * width));
      return envelope * Math.sin(delta * frequency - time * speed * frequency * 0.46);
    }

    function displacement(atom, time) {
      var p = pulseAt(atom.x, time, 168, 0, 66, 0.052, 1);
      var s = pulseAt(atom.x, time, 111, 226, 84, 0.041, 1);
      var reflection = pulseAt(atom.x, time, 131, 420, 74, 0.048, -1);
      var transverseShape = Math.cos(atom.z * 0.035) * (0.72 + 0.28 * Math.cos(atom.y * 0.048));
      var dx = 12.5 * p - 5.4 * reflection;
      var dy = (6.9 * s + 2.2 * reflection) * transverseShape;
      var dz = 4.9 * s * Math.sin(atom.y * 0.055 + 0.8) - 2.5 * reflection;
      var energy = Math.min(1, Math.abs(p) * 0.83 + Math.abs(s) * 0.58 + Math.abs(reflection) * 0.34);
      return { x: dx, y: dy, z: dz, energy: energy, p: p, s: s, r: reflection };
    }

    var target = { x: 0, y: 0 };
    var view = { x: 0, y: 0 };
    if (!REDUCED) {
      lattice.addEventListener("pointermove", function (event) {
        var rect = lattice.getBoundingClientRect();
        target.x = (event.clientX - rect.left) / rect.width - 0.5;
        target.y = (event.clientY - rect.top) / rect.height - 0.5;
      });
      lattice.addEventListener("pointerleave", function () { target.x = 0; target.y = 0; });
    }

    var F = 780, CAMZ = 595;
    function project(point, sy, cy, sx, cx, out) {
      var x = point.x * cy + point.z * sy;
      var z = -point.x * sy + point.z * cy;
      var y = point.y * cx - z * sx;
      z = point.y * sx + z * cx;
      var depth = z + CAMZ;
      var fit = Math.min(1, Math.max(0.26, (L.w - 28) / 900));
      var scale = F / depth * fit;
      out.x = L.w / 2 + x * scale;
      out.y = H / 2 + y * scale;
      out.s = scale;
      out.z = depth;
      return out;
    }

    var projections = atoms.map(function () { return { x: 0, y: 0, s: 0, z: 0 }; });
    var motions = atoms.map(function () { return { x: 0, y: 0, z: 0, energy: 0, p: 0, s: 0, r: 0 }; });
    var order = atoms.map(function (_, index) { return index; });
    var world = { x: 0, y: 0, z: 0 };

    function drawFieldGrid(ctx, time) {
      var shift = (time * 12) % 34;
      ctx.lineWidth = 1;
      ctx.strokeStyle = INK + "0.035)";
      var x;
      var y;
      for (x = 18 + shift; x < L.w - 16; x += 34) {
        ctx.beginPath(); ctx.moveTo(x, 14); ctx.lineTo(x, H - 18); ctx.stroke();
      }
      for (y = 18; y < H - 15; y += 34) {
        ctx.beginPath(); ctx.moveTo(16, y); ctx.lineTo(L.w - 16, y); ctx.stroke();
      }
      ctx.strokeStyle = ACC + "0.13)";
      ctx.beginPath();
      ctx.moveTo(16, H - 18); ctx.lineTo(L.w - 16, H - 18);
      ctx.stroke();
    }

    function drawWaveMonitor(ctx, time) {
      var x0 = 18, y0 = H - 50, width = Math.min(224, L.w * 0.35);
      var i;
      ctx.strokeStyle = INK + "0.20)";
      ctx.strokeRect(x0, y0, width, 22);
      ctx.font = "8.5px 'IBM Plex Mono', monospace";
      ctx.fillStyle = INK + "0.44)";
      ctx.fillText(L.w < 480 ? "P/S ENVELOPE" : "COUPLED-MODE ENVELOPE", x0 + 6, y0 - 7);
      ctx.beginPath();
      for (i = 0; i <= 90; i += 1) {
        var q = i / 90;
        var virtualX = (q - 0.5) * span;
        var p = pulseAt(virtualX, time, 168, 0, 66, 0.052, 1);
        var s = pulseAt(virtualX, time, 111, 226, 84, 0.041, 1);
        var yy = y0 + 11 - (p * 6.4 + s * 3.5);
        if (i === 0) ctx.moveTo(x0 + q * width, yy);
        else ctx.lineTo(x0 + q * width, yy);
      }
      ctx.strokeStyle = ACC + "0.72)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = AMB + "0.78)";
      ctx.fillText("P", x0 + width - 28, y0 + 16);
      ctx.fillStyle = ACC + "0.78)";
      ctx.fillText("S", x0 + width - 15, y0 + 16);
    }

    function drawHud(ctx, time, metrics) {
      var x = 18, y = 28, line = 16;
      var energy = String(Math.round(metrics.energy * 100)).padStart(2, "0");
      ctx.font = "10px 'IBM Plex Mono', monospace";
      ctx.fillStyle = ACC + "0.95)";
      if (L.w < 500) {
        ctx.fillText("P + S LATTICE FIELD", x, y);
        ctx.fillStyle = INK + "0.56)";
        ctx.fillText("P 5.9  ·  S 3.2 km·s⁻¹", x, y + line);
        ctx.fillText("εmax " + metrics.strain.toFixed(4) + "  ·  Δu " + metrics.displacement.toFixed(1), x, y + line * 2);
        ctx.fillText("E " + energy + "%  ·  N " + atoms.length, x, y + line * 3);
      } else if (L.w < 720) {
        ctx.fillText("LATTICE DYNAMICS — P + S MODES", x, y);
        ctx.fillStyle = INK + "0.56)";
        ctx.fillText("P 5.9 / S 3.2 km·s⁻¹ / REFLECTION", x, y + line);
        ctx.fillText("εmax = " + metrics.strain.toFixed(4) + "    Δu = " + metrics.displacement.toFixed(1) + " a.u.", x, y + line * 2);
        ctx.fillText("ENERGY " + energy + "%    N = " + atoms.length + " ATOMS", x, y + line * 3);
      } else {
        ctx.fillText("LATTICE DYNAMICS — COUPLED ELASTIC MODES", x, y);
        ctx.fillStyle = INK + "0.56)";
        ctx.fillText("P-WAVE 5.9 km·s⁻¹   /   S-WAVE 3.2 km·s⁻¹   /   REFLECTION", x, y + line);
        ctx.fillText("εmax = " + metrics.strain.toFixed(4) + "    Δu = " + metrics.displacement.toFixed(1) + " a.u.", x, y + line * 2);
        ctx.fillText("ENERGY " + energy + "%    N = " + atoms.length + " ATOMS    a = 46", x, y + line * 3);
      }
      ctx.strokeStyle = INK + "0.26)";
      ctx.beginPath(); ctx.moveTo(x, y + line * 3 + 8); ctx.lineTo(x + Math.min(278, L.w - x - 18), y + line * 3 + 8); ctx.stroke();
    }

    function drawTriad(ctx, sy, cy, sx, cx) {
      var ox = L.w - 62, oy = H - 44, len = 22;
      var axes = [
        { x: 1, y: 0, z: 0, label: "x" },
        { x: 0, y: -1, z: 0, label: "y" },
        { x: 0, y: 0, z: 1, label: "z" }
      ];
      ctx.font = "9px 'IBM Plex Mono', monospace";
      axes.forEach(function (axis) {
        var xx = axis.x * cy + axis.z * sy;
        var zz = -axis.x * sy + axis.z * cy;
        var yy = axis.y * cx - zz * sx;
        ctx.strokeStyle = ACC + "0.65)";
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + xx * len, oy + yy * len); ctx.stroke();
        ctx.fillStyle = INK + "0.70)";
        ctx.fillText(axis.label, ox + xx * (len + 8) - 2, oy + yy * (len + 8) + 3);
      });
    }

    function drawLattice(time) {
      var ctx = L.ctx;
      ctx.clearRect(0, 0, L.w, H);
      drawFieldGrid(ctx, time);

      view.x += (target.x - view.x) * 0.055;
      view.y += (target.y - view.y) * 0.055;
      var yaw = time * 0.105 + view.x * 0.84;
      var pitch = -0.31 + view.y * 0.36;
      var sy = Math.sin(yaw), cy = Math.cos(yaw);
      var sx = Math.sin(pitch), cx = Math.cos(pitch);
      var index;
      var atom;
      var motion;
      var metrics = { strain: 0, displacement: 0, energy: 0 };

      for (index = 0; index < atoms.length; index += 1) {
        atom = atoms[index];
        motion = displacement(atom, time);
        motions[index] = motion;
        world.x = atom.x + motion.x;
        world.y = atom.y + motion.y;
        world.z = atom.z + motion.z;
        project(world, sy, cy, sx, cx, projections[index]);
        metrics.energy += motion.energy;
        metrics.displacement = Math.max(metrics.displacement, Math.sqrt(motion.x * motion.x + motion.y * motion.y + motion.z * motion.z));
      }
      metrics.energy /= atoms.length;

      ctx.lineWidth = 1;
      for (index = 0; index < bonds.length; index += 1) {
        var bond = bonds[index];
        var one = projections[bond.a];
        var two = projections[bond.b];
        var oneMotion = motions[bond.a];
        var twoMotion = motions[bond.b];
        var restDx = atoms[bond.b].x - atoms[bond.a].x;
        var restDy = atoms[bond.b].y - atoms[bond.a].y;
        var restDz = atoms[bond.b].z - atoms[bond.a].z;
        var currentDx = restDx + twoMotion.x - oneMotion.x;
        var currentDy = restDy + twoMotion.y - oneMotion.y;
        var currentDz = restDz + twoMotion.z - oneMotion.z;
        var currentLength = Math.sqrt(currentDx * currentDx + currentDy * currentDy + currentDz * currentDz);
        var signedStrain = (currentLength - bond.rest) / bond.rest;
        var strain = Math.abs(signedStrain);
        var near = Math.max(0, Math.min(1, (1130 - (one.z + two.z) * 0.5) / 770));
        metrics.strain = Math.max(metrics.strain, strain);
        var alpha = 0.035 + near * 0.22 + strain * 1.1;
        var colour = signedStrain >= 0 ? AMB : ACC;
        ctx.strokeStyle = strain > 0.014 ? colour + Math.min(0.88, alpha) + ")" : INK + alpha + ")";
        ctx.lineWidth = 0.55 + near * 0.65 + strain * 1.2;
        ctx.beginPath(); ctx.moveTo(one.x, one.y); ctx.lineTo(two.x, two.y); ctx.stroke();

        if (strain > 0.034 && index % 11 === 0) {
          var packet = (time * (0.28 + strain * 2.2) + bond.a * 0.037) % 1;
          var px = one.x + (two.x - one.x) * packet;
          var py = one.y + (two.y - one.y) * packet;
          ctx.beginPath(); ctx.arc(px, py, 0.8 + near * 0.85, 0, 6.2832);
          ctx.fillStyle = colour + Math.min(0.58, strain * 9) + ")";
          ctx.fill();
        }
      }

      order.sort(function (left, right) { return projections[right].z - projections[left].z; });
      for (index = 0; index < order.length; index += 1) {
        var id = order[index];
        var point = projections[id];
        var excitation = motions[id].energy;
        var depth = Math.max(0, Math.min(1, (1120 - point.z) / 740));
        var radius = (1.12 + excitation * 1.45) * point.s * 1.65;
        if (excitation > 0.22) {
          ctx.beginPath(); ctx.arc(point.x, point.y, radius * (2.25 + excitation), 0, 6.2832);
          ctx.fillStyle = (motions[id].p >= 0 ? ACC : AMB) + (0.055 + excitation * 0.105) * depth + ")";
          ctx.fill();
        }
        ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, 6.2832);
        ctx.fillStyle = INK + (0.17 + depth * 0.56 + excitation * 0.22) + ")";
        ctx.fill();
      }

      drawHud(ctx, time, metrics);
      drawWaveMonitor(ctx, time);
      drawTriad(ctx, sy, cy, sx, cx);
    }

    var redrawLattice = animate(lattice, drawLattice);

    var resizeTimer;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        resizeLattice();
        if (REDUCED) redrawLattice();
      }, 150);
    });
  })();

  /* ============================================================
     2. STRESS–STRAIN — tensile test dashboard
     Self-tracing engineering σ–ε curve with a live tensile
     specimen (stretch → neck → fracture), scan cursor, and
     mono readouts. Structural-steel values, schematic.
     ============================================================ */
  var stress = document.getElementById("stressCanvas");
  if (stress) (function () {
    var H2;
    var S2;
    var wide;
    var sideW;
    var m, pw, ph;
    function reflow() {
      H2 = stress.clientWidth && stress.clientWidth < 560 ? 308 : 360;
      S2 = setupCanvas(stress, H2);
      wide = S2.w >= 820;
      sideW = wide ? Math.min(278, Math.round(S2.w * 0.30)) : 0;
      m = {
        l: S2.w < 460 ? 48 : 62,
        r: sideW + (wide ? 30 : 22),
        t: S2.w < 460 ? 36 : 38,
        b: 46
      };
      pw = S2.w - m.l - m.r;
      ph = H2 - m.t - m.b;
    }
    reflow();

    var X = function (u) { return m.l + u * pw; };
    var Y = function (v) { return m.t + (1 - v) * ph; };

    var SIG_SCALE = 510;
    var EPS_SCALE = 25;
    var E_MODULUS = 210;
    var YIELD_SIG = 0.695;
    // σy / E = 0.16875% strain, kept consistent with the displayed 210 GPa.
    var YIELD_U = YIELD_SIG * SIG_SCALE * 100 / (E_MODULUS * 1000 * EPS_SCALE);
    var YIELD_END = 0.036, UTS_U = 0.60, END_U = 0.91;

    // Engineering stress–strain response for a structural-steel specimen.
    // The narrow elastic toe is to scale; later response remains schematic.
    function sigma(u) {
      if (u <= 0) return 0;
      if (u < YIELD_U) return YIELD_SIG * u / YIELD_U;                  // elastic
      if (u < YIELD_END) {
        var plateau = (u - YIELD_U) / (YIELD_END - YIELD_U);
        return YIELD_SIG - 0.021 * Math.sin(plateau * Math.PI) - 0.009 * plateau;
      }
      if (u < UTS_U) {
        var hardening = (u - YIELD_END) / (UTS_U - YIELD_END);
        return 0.686 + 0.314 * (1 - Math.pow(1 - hardening, 1.82));
      }
      var necking = (u - UTS_U) / (END_U - UTS_U);
      return 1 - 0.17 * necking * necking;
    }

    function state(u) {
      if (u < YIELD_U) return "ELASTIC";
      if (u < YIELD_END) return "YIELDING";
      if (u < UTS_U) return "WORK HARDENING";
      if (u < END_U - 0.004) return "NECKING";
      return "FRACTURE";
    }

    function tangent(u) {
      var du = 0.0015;
      var lo = Math.max(0, u - du);
      var hi = Math.min(END_U, u + du);
      return (sigma(hi) - sigma(lo)) * SIG_SCALE / ((hi - lo) * EPS_SCALE);
    }

    function responseInk(u) {
      return u >= UTS_U ? AMB : ACC;
    }

    function drawZones(ctx) {
      ctx.fillStyle = ACC + "0.035)";
      ctx.fillRect(X(0), m.t, X(YIELD_END) - X(0), ph);
      ctx.fillStyle = ACC + "0.070)";
      ctx.fillRect(X(YIELD_END), m.t, X(UTS_U) - X(YIELD_END), ph);
      ctx.fillStyle = AMB + "0.055)";
      ctx.fillRect(X(UTS_U), m.t, X(END_U) - X(UTS_U), ph);
      ctx.fillStyle = AMB + "0.025)";
      ctx.fillRect(X(END_U), m.t, X(1) - X(END_U), ph);

      ctx.save();
      ctx.setLineDash([2, 5]);
      ctx.lineWidth = 1;
      var limits = [YIELD_U, YIELD_END, UTS_U, END_U];
      for (var i = 0; i < limits.length; i += 1) {
        ctx.strokeStyle = (i < 2 ? ACC : AMB) + "0.22)";
        ctx.beginPath(); ctx.moveTo(X(limits[i]), m.t); ctx.lineTo(X(limits[i]), Y(0)); ctx.stroke();
      }
      ctx.restore();

      if (pw > 520) {
        ctx.font = "9px 'IBM Plex Mono', monospace";
        ctx.fillStyle = ACC + "0.56)";
        ctx.fillText("ELASTIC  0–0.17%", m.l + 14, m.t + 13);
        ctx.strokeStyle = ACC + "0.32)";
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(m.l + 10, m.t + 17); ctx.lineTo(X(YIELD_U), m.t + 29); ctx.stroke();
        ctx.fillStyle = INK + "0.34)";
        ctx.fillText("UNIFORM PLASTIC", X(0.27), m.t + 13);
        ctx.fillStyle = AMB + "0.55)";
        ctx.fillText("NECKING", X(0.69), m.t + 13);
      }
    }

    function axes(ctx) {
      var gx, gy;
      drawZones(ctx);
      ctx.strokeStyle = INK + "0.065)";
      ctx.lineWidth = 1;
      for (gx = 0; gx <= 10; gx += 1) {
        ctx.beginPath(); ctx.moveTo(X(gx / 10), Y(0)); ctx.lineTo(X(gx / 10), Y(1)); ctx.stroke();
      }
      for (gy = 0; gy <= 5; gy += 1) {
        ctx.beginPath(); ctx.moveTo(X(0), Y(gy / 5)); ctx.lineTo(X(1), Y(gy / 5)); ctx.stroke();
      }
      ctx.strokeStyle = INK + "0.48)";
      ctx.beginPath(); ctx.moveTo(X(0), Y(1)); ctx.lineTo(X(0), Y(0)); ctx.lineTo(X(1), Y(0)); ctx.stroke();

      ctx.font = "9.5px 'IBM Plex Mono', monospace";
      ctx.fillStyle = INK + "0.50)";
      ctx.fillText("engineering stress σ  (MPa)", Math.max(8, m.l - 52), m.t - 14);
      ctx.fillText("engineering strain ε  (%)", Math.max(m.l, X(1) - 152), Y(0) + 31);
      for (gy = 0; gy <= 5; gy += 1) {
        var mpa = Math.round(gy / 5 * SIG_SCALE);
        ctx.fillStyle = INK + "0.34)";
        ctx.fillText(String(mpa), Math.max(6, m.l - 36), Y(gy / 5) + 3);
      }
      for (gx = 0; gx <= 5; gx += 1) {
        var strainPct = Math.round(gx / 5 * EPS_SCALE);
        var tx = X(gx / 5) - (gx === 0 ? 2 : 6);
        ctx.fillStyle = INK + "0.31)";
        ctx.fillText(String(strainPct), tx, Y(0) + 16);
      }
    }

    function label(ctx, text, x, y, colour, alignRight) {
      ctx.font = "9.5px 'IBM Plex Mono', monospace";
      ctx.fillStyle = (colour || ACC) + "0.90)";
      ctx.fillText(text, alignRight ? x - ctx.measureText(text).width : x, y);
    }

    function curvePath(ctx, until) {
      var step = 0.003;
      var u;
      ctx.beginPath();
      for (u = 0; u <= until + step * 0.5; u += step) {
        var capped = Math.min(until, u);
        var x = X(capped);
        var y = Y(sigma(capped));
        if (u === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }

    function strokeCurve(ctx, from, until, colour, width) {
      if (until <= from) return;
      var step = 0.003;
      var u;
      ctx.beginPath();
      for (u = from; u <= until + step * 0.5; u += step) {
        var capped = Math.min(until, u);
        if (u === from) ctx.moveTo(X(capped), Y(sigma(capped)));
        else ctx.lineTo(X(capped), Y(sigma(capped)));
      }
      ctx.strokeStyle = colour + "0.94)";
      ctx.lineWidth = width;
      ctx.stroke();
    }

    function drawCurve(ctx, uMax, time) {
      // Full response remains as a quiet reference while the live trace grows.
      curvePath(ctx, END_U);
      ctx.strokeStyle = INK + "0.18)";
      ctx.lineWidth = 1;
      ctx.stroke();

      var fill = ctx.createLinearGradient(0, m.t, 0, Y(0));
      fill.addColorStop(0, ACC + "0.16)");
      fill.addColorStop(0.72, ACC + "0.055)");
      fill.addColorStop(1, ACC + "0)");
      curvePath(ctx, uMax);
      ctx.lineTo(X(uMax), Y(0));
      ctx.lineTo(X(0), Y(0));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();

      var blueUntil = Math.min(uMax, UTS_U);
      strokeCurve(ctx, 0, blueUntil, ACC, 1.8);
      if (uMax > UTS_U) strokeCurve(ctx, UTS_U, uMax, AMB, 1.95);

      // A small travelling signal rides on the active trace, echoing the specimen field.
      if (!REDUCED && uMax > 0.08) {
        var sweep = Math.max(0.018, uMax - 0.18 + ((time * 0.036) % 0.18));
        var sx = X(sweep), sy = Y(sigma(sweep));
        ctx.beginPath(); ctx.arc(sx, sy, 2.1, 0, 6.2832);
        ctx.fillStyle = responseInk(sweep) + "0.75)";
        ctx.fill();
      }
    }

    function marker(ctx, u, caption, colour, active, dx, dy) {
      var px = X(u), py = Y(sigma(u));
      var alpha = active ? 0.96 : 0.24;
      ctx.strokeStyle = colour + alpha + ")";
      ctx.lineWidth = active ? 1.25 : 0.85;
      ctx.beginPath(); ctx.arc(px, py, active ? 3.2 : 2.3, 0, 6.2832); ctx.stroke();
      if (pw < 405) return;

      ctx.font = "9px 'IBM Plex Mono', monospace";
      var textW = ctx.measureText(caption).width;
      var tx = Math.max(m.l + 6, Math.min(X(1) - textW - 4, px + dx));
      var ty = Math.max(m.t + 15, Math.min(Y(0) - 6, py + dy));
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tx - 4, ty - 3); ctx.stroke();
      ctx.fillStyle = colour + (active ? "0.88)" : "0.38)");
      ctx.fillText(caption, tx, ty);
    }

    function scanCursor(ctx, u, time) {
      var px = X(u), py = Y(sigma(u));
      var colour = responseInk(u);
      var pulse = 0.5 + 0.5 * Math.sin(time * 7.5);
      ctx.save();
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = colour + "0.30)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, Y(0)); ctx.moveTo(px, py); ctx.lineTo(X(0), py); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalCompositeOperation = "lighter";
      ctx.beginPath(); ctx.arc(px, py, 8 + pulse * 4, 0, 6.2832);
      ctx.fillStyle = colour + (0.06 + pulse * 0.04) + ")"; ctx.fill();
      ctx.beginPath(); ctx.arc(px, py, 4.4, 0, 6.2832);
      ctx.fillStyle = colour + "0.54)"; ctx.fill();
      ctx.beginPath(); ctx.arc(px, py, 1.8, 0, 6.2832);
      ctx.fillStyle = "rgba(230,244,252,.96)"; ctx.fill();
      ctx.restore();
    }

    function drawGrip(ctx, x, y, width, height, reverse) {
      var i;
      ctx.fillStyle = ACC + "0.085)";
      ctx.fillRect(x, y - height / 2, width, height);
      ctx.strokeStyle = INK + "0.62)";
      ctx.lineWidth = 1.05;
      ctx.strokeRect(x, y - height / 2, width, height);
      ctx.strokeStyle = INK + "0.22)";
      ctx.lineWidth = 0.7;
      for (i = 6; i < height; i += 7) {
        ctx.beginPath();
        if (reverse) {
          ctx.moveTo(x + 3, y - height / 2 + i);
          ctx.lineTo(x + width - 3, y - height / 2 + i - 4);
        } else {
          ctx.moveTo(x + 3, y - height / 2 + i - 4);
          ctx.lineTo(x + width - 3, y - height / 2 + i);
        }
        ctx.stroke();
      }
    }

    function drawGaugeField(ctx, start, end, cy, height, time, intensity, neck, colour) {
      if (end - start < 12) return;
      var x, y, i, lane;
      var width = end - start;
      var amp = height * (0.10 + 0.13 * intensity + 0.09 * neck);
      ctx.lineWidth = 0.8;
      for (lane = -1; lane <= 1; lane += 1) {
        ctx.beginPath();
        for (i = 0; i <= 20; i += 1) {
          x = start + width * i / 20;
          y = cy + lane * height * 0.19 + Math.sin((x - start) * 0.15 - time * 6.2 + lane * 1.4) * amp;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = colour + (0.12 + intensity * 0.16) + ")";
        ctx.stroke();
      }
      for (i = 0; i < 3; i += 1) {
        var packet = (time * 0.34 + i * 0.37) % 1;
        x = start + packet * width;
        ctx.beginPath(); ctx.arc(x, cy + Math.sin(packet * 8 + time * 4) * amp, 1.15 + intensity, 0, 6.2832);
        ctx.fillStyle = colour + (0.28 + intensity * 0.25) + ")";
        ctx.fill();
      }
    }

    /* ---- live dogbone specimen with axial-wave strain field ---- */
    function specimen(ctx, u, time, fractureAge) {
      var panelX = S2.w - sideW + 12;
      var specimenW = sideW - 24;
      var cx = panelX + specimenW / 2;
      var cy = 103;
      var eps = u * EPS_SCALE / 100;
      var L0 = Math.min(126, specimenW * 0.58);
      var gaugeLength = L0 * (1 + eps * 1.12);
      var gripW = 22, gripH = 42, gaugeH = 17;
      var neck = u <= UTS_U ? 0 : Math.min(1, (u - UTS_U) / (END_U - UTS_U));
      var fractured = u >= END_U - 0.003;
      var gap = fractured ? 7.5 : 0;
      var gaugeLeft = cx - gaugeLength / 2;
      var gaugeRight = cx + gaugeLength / 2;
      var innerLeft = cx - gap / 2;
      var innerRight = cx + gap / 2;
      var tone = responseInk(u);
      var outerHalf = gaugeH / 2;
      var innerHalf = outerHalf * (1 - neck * 0.61);

      ctx.font = "9.5px 'IBM Plex Mono', monospace";
      ctx.fillStyle = ACC + "0.86)";
      ctx.fillText("AXIAL TENSILE SPECIMEN", panelX, 27);
      ctx.fillStyle = INK + "0.38)";
      ctx.fillText("S355-TYPE  ·  εx FIELD", panelX, 43);
      ctx.strokeStyle = INK + "0.18)";
      ctx.beginPath(); ctx.moveTo(panelX, 51); ctx.lineTo(panelX + specimenW, 51); ctx.stroke();

      drawGrip(ctx, gaugeLeft - gripW, cy, gripW, gripH, false);
      drawGrip(ctx, gaugeRight, cy, gripW, gripH, true);

      function gaugePath(left) {
        if (left) {
          ctx.moveTo(gaugeLeft, cy - outerHalf);
          ctx.lineTo(innerLeft, cy - innerHalf);
          ctx.lineTo(innerLeft, cy + innerHalf);
          ctx.lineTo(gaugeLeft, cy + outerHalf);
        } else {
          ctx.moveTo(innerRight, cy - innerHalf);
          ctx.lineTo(gaugeRight, cy - outerHalf);
          ctx.lineTo(gaugeRight, cy + outerHalf);
          ctx.lineTo(innerRight, cy + innerHalf);
        }
        ctx.closePath();
      }

      var specimenFill = ctx.createLinearGradient(gaugeLeft, cy, gaugeRight, cy);
      specimenFill.addColorStop(0, ACC + "0.09)");
      specimenFill.addColorStop(0.50, tone + (0.12 + neck * 0.10) + ")");
      specimenFill.addColorStop(1, ACC + "0.09)");
      ctx.beginPath(); gaugePath(true); gaugePath(false);
      ctx.fillStyle = specimenFill; ctx.fill();

      ctx.save();
      ctx.beginPath(); gaugePath(true); gaugePath(false); ctx.clip();
      drawGaugeField(ctx, gaugeLeft, gaugeRight, cy, gaugeH, time, sigma(u), neck, tone);
      ctx.restore();

      ctx.beginPath(); gaugePath(true); gaugePath(false);
      ctx.strokeStyle = INK + "0.76)";
      ctx.lineWidth = 1.15;
      ctx.stroke();

      // Extension gauge, moving ticks, and a quiet centreline.
      var dimY = cy + 34;
      ctx.strokeStyle = ACC + "0.48)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(gaugeLeft, dimY - 4); ctx.lineTo(gaugeLeft, dimY + 4);
      ctx.moveTo(gaugeRight, dimY - 4); ctx.lineTo(gaugeRight, dimY + 4);
      ctx.moveTo(gaugeLeft, dimY); ctx.lineTo(gaugeRight, dimY);
      ctx.stroke();
      ctx.fillStyle = INK + "0.48)";
      ctx.font = "9px 'IBM Plex Mono', monospace";
      ctx.fillText("L = L0 + ΔL  ·  ε = " + (u * EPS_SCALE).toFixed(2) + " %", cx - 61, dimY + 16);

      if (fractured) {
        var flash = Math.max(0, 1 - fractureAge / 0.75);
        ctx.strokeStyle = AMB + "0.94)";
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(cx - gap / 2, cy - innerHalf);
        ctx.lineTo(cx - 1, cy - 3);
        ctx.lineTo(cx - gap / 2 - 1, cy + 2);
        ctx.lineTo(cx - 2, cy + innerHalf);
        ctx.stroke();
        if (flash > 0) {
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.beginPath(); ctx.arc(cx, cy, 8 + flash * 18, 0, 6.2832);
          ctx.fillStyle = AMB + (flash * 0.18) + ")"; ctx.fill();
          ctx.restore();
        }
      }
    }

    function telemetryWave(ctx, x, y, width, time, intensity, colour) {
      var i;
      ctx.strokeStyle = INK + "0.18)";
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + width, y); ctx.stroke();
      ctx.beginPath();
      for (i = 0; i <= 28; i += 1) {
        var px = x + width * i / 28;
        var py = y + Math.sin(i * 0.56 - time * 5.4) * (2 + intensity * 3.2) * Math.exp(-Math.pow((i - 15) / 12, 2));
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = colour + "0.74)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    /* ---- floating diagnostic readout; no panel chrome ---- */
    function readout(ctx, u, time) {
      var x = S2.w - sideW + 12;
      var width = sideW - 24;
      var y = 190;
      var sig = Math.round(sigma(u) * SIG_SCALE);
      var eps = (u * EPS_SCALE).toFixed(2);
      var slope = tangent(u);
      var st = state(u);
      var tone = responseInk(u);

      ctx.font = "9.5px 'IBM Plex Mono', monospace";
      ctx.fillStyle = ACC + "0.86)";
      ctx.fillText("TEST TELEMETRY", x, y);
      ctx.strokeStyle = INK + "0.20)";
      ctx.beginPath(); ctx.moveTo(x, y + 7); ctx.lineTo(x + width, y + 7); ctx.stroke();

      function row(offset, key, value, colour) {
        ctx.fillStyle = INK + "0.44)";
        ctx.fillText(key, x, y + offset);
        ctx.fillStyle = (colour || INK) + "0.78)";
        ctx.fillText(value, x + 62, y + offset);
      }

      row(25, "σ", String(sig) + " MPa", tone);
      row(41, "ε", eps + " %", tone);
      row(57, "E", E_MODULUS + " GPa", ACC);
      row(73, "dσ/dε", slope.toFixed(0) + " MPa/%", ACC);
      row(89, "STATE", st, tone);

      ctx.fillStyle = INK + "0.36)";
      ctx.fillText("LOAD", x, y + 111);
      ctx.fillText("ε / εf", x, y + 126);
      function bar(by, value, colour) {
        ctx.strokeStyle = INK + "0.20)";
        ctx.beginPath(); ctx.moveTo(x + 48, by); ctx.lineTo(x + width, by); ctx.stroke();
        ctx.strokeStyle = colour + "0.82)";
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(x + 48, by); ctx.lineTo(x + 48 + (width - 48) * Math.max(0, Math.min(1, value)), by); ctx.stroke();
      }
      bar(y + 108, sigma(u), tone);
      bar(y + 123, u / END_U, tone);

      ctx.fillStyle = INK + "0.36)";
      ctx.fillText("AXIAL WAVE / εx", x, y + 146);
      telemetryWave(ctx, x, y + 158, width, time, sigma(u), tone);
    }

    function compactReadout(ctx, u) {
      var sig = Math.round(sigma(u) * SIG_SCALE);
      var text = "σ " + sig + " MPa   ε " + (u * EPS_SCALE).toFixed(2) + " %   " + state(u);
      ctx.font = "9.5px 'IBM Plex Mono', monospace";
      ctx.fillStyle = responseInk(u) + "0.86)";
      if (S2.w < 455) {
        ctx.fillText("σ " + sig + " MPa   ε " + (u * EPS_SCALE).toFixed(2) + " %", m.l + 5, m.t + 22);
        ctx.fillText(state(u), m.l + 5, m.t + 36);
      } else {
        ctx.fillText(text, m.l + 7, m.t + 22);
      }
    }

    var PERIOD = 14;
    var TEST_RUN = 9.6;
    function drawStress(time) {
      var ctx = S2.ctx;
      var cycle = REDUCED ? TEST_RUN : (time % PERIOD);
      var progress = Math.min(cycle / TEST_RUN, 1);
      var uMax = END_U * (1 - Math.pow(1 - progress, 2.35));
      var fractureAge = Math.max(0, cycle - TEST_RUN);

      ctx.clearRect(0, 0, S2.w, H2);
      axes(ctx);
      drawCurve(ctx, uMax, time);

      var yieldActive = uMax >= YIELD_U;
      var utsActive = uMax >= UTS_U;
      var fractureActive = uMax >= END_U - 0.002;
      marker(ctx, YIELD_U, "σy  355 MPa", ACC, yieldActive, 25, 25);
      marker(ctx, UTS_U, "UTS  510 MPa", ACC, utsActive, -83, -18);
      marker(ctx, END_U, "FRACTURE", AMB, fractureActive, -82, 20);

      if (yieldActive && pw > 360) {
        var yieldY = Y(sigma(YIELD_U));
        ctx.save();
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = ACC + "0.28)";
        ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(X(0), yieldY); ctx.lineTo(X(YIELD_U), yieldY); ctx.stroke();
        ctx.restore();
        if (pw > 520) label(ctx, "E = 210 GPa", X(0.075), Y(0.27), ACC, false);
      }

      scanCursor(ctx, uMax, time);
      if (wide) {
        specimen(ctx, uMax, time, fractureAge);
        readout(ctx, uMax, time);
      } else {
        compactReadout(ctx, uMax);
      }
    }

    var redrawStress = animate(stress, drawStress);

    var stressResizeTimer;
    window.addEventListener("resize", function () {
      clearTimeout(stressResizeTimer);
      stressResizeTimer = setTimeout(function () {
        reflow();
        if (REDUCED) redrawStress();
      }, 150);
    });
  })();
})();
