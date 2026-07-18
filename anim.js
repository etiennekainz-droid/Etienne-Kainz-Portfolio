/* ============================================================
   Scientific figure animations — drafting-style, no libraries.
   1) #latticeCanvas — 3-D crystal lattice, rotating in perspective;
      a longitudinal elastic wavepacket sweeps through, bonds tint
      amber with strain; pointer steers the view; live HUD readout.
   The lattice pauses off-screen and renders a static frame under
   prefers-reduced-motion.
   ============================================================ */
(function () {
  "use strict";

  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var INK = "rgba(200,214,226,";     // line ink
  var ACC = "rgba(147,180,205,";     // drafting blue
  var AMB = "rgba(207,160,104,";     // strain amber

  function setupCanvas(canvas, previous) {
    /* CSS owns the displayed box. Mirror that exact box into the backing
       store; otherwise a CSS !important height can silently stretch a bitmap
       that was allocated using an unrelated JavaScript height. */
    var rect = canvas.getBoundingClientRect();
    var fallbackWidth = previous && previous.w ? previous.w :
      (canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || 1);
    var fallbackHeight = previous && previous.h ? previous.h :
      (canvas.clientHeight || parseFloat(canvas.getAttribute("height")) || 340);
    var w = Math.max(1, rect.width || fallbackWidth);
    var h = Math.max(1, rect.height || fallbackHeight);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var pixelWidth = Math.max(1, Math.round(w * dpr));
    var pixelHeight = Math.max(1, Math.round(h * dpr));
    var ctx = canvas.getContext("2d");

    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

    /* The independently derived scales absorb fractional CSS pixels and
       backing-store rounding. In CSS-pixel coordinates circles, type, and
       projected lattice cells therefore retain a 1:1 aspect ratio. */
    ctx.setTransform(pixelWidth / w, 0, 0, pixelHeight / h, 0, 0);
    return {
      ctx: ctx,
      w: w,
      h: h,
      dpr: dpr,
      pixelWidth: pixelWidth,
      pixelHeight: pixelHeight
    };
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
      L = setupCanvas(lattice, L);
      H = L.h;
    }
    function syncLatticeSize() {
      var rect = lattice.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var hasBox = rect.width > 0 && rect.height > 0;
      var expectedWidth = hasBox ? Math.max(1, Math.round(rect.width * dpr)) : (L ? L.pixelWidth : lattice.width);
      var expectedHeight = hasBox ? Math.max(1, Math.round(rect.height * dpr)) : (L ? L.pixelHeight : lattice.height);
      if (!L ||
          (hasBox && (Math.abs(rect.width - L.w) > 0.05 || Math.abs(rect.height - L.h) > 0.05)) ||
          Math.abs(dpr - L.dpr) > 0.001 ||
          lattice.width !== expectedWidth || lattice.height !== expectedHeight) {
        resizeLattice();
      }
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
      syncLatticeSize();
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
    function scheduleLatticeResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        resizeLattice();
        if (REDUCED) redrawLattice();
      }, 80);
    }
    window.addEventListener("resize", scheduleLatticeResize, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", scheduleLatticeResize, { passive: true });
    }
    if (window.ResizeObserver) {
      new ResizeObserver(scheduleLatticeResize).observe(lattice);
    }
  })();

})();
