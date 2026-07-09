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
    if (REDUCED) { draw(2.0); return; }
    var running = false, raf = 0, t0 = performance.now();
    function loop(now) {
      draw((now - t0) / 1000);
      if (running) raf = requestAnimationFrame(loop);
    }
    new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && !running) { running = true; raf = requestAnimationFrame(loop); }
        else if (!en.isIntersecting && running) { running = false; cancelAnimationFrame(raf); }
      });
    }, { threshold: 0.05 }).observe(canvas);
  }

  /* ============================================================
     1. CRYSTAL LATTICE — 3-D elastic wave propagation
     ============================================================ */
  var lattice = document.getElementById("latticeCanvas");
  if (lattice) (function () {
    var H = 340;
    var L = setupCanvas(lattice, H);

    /* ---- lattice geometry (world space, centered) ---- */
    var NX = 15, NY = 6, NZ = 5, S = 46;
    var atoms = [], bonds = [];
    (function build() {
      for (var i = 0; i < NX; i++) for (var j = 0; j < NY; j++) for (var k = 0; k < NZ; k++) {
        atoms.push({
          x: (i - (NX - 1) / 2) * S,
          y: (j - (NY - 1) / 2) * S,
          z: (k - (NZ - 1) / 2) * S,
          i: i, j: j, k: k
        });
      }
      var idx = function (i, j, k) { return (i * NY + j) * NZ + k; };
      for (var a = 0; a < NX; a++) for (var b = 0; b < NY; b++) for (var c = 0; c < NZ; c++) {
        if (a + 1 < NX) bonds.push([idx(a, b, c), idx(a + 1, b, c)]);
        if (b + 1 < NY) bonds.push([idx(a, b, c), idx(a, b + 1, c)]);
        if (c + 1 < NZ) bonds.push([idx(a, b, c), idx(a, b, c + 1)]);
      }
    })();

    /* ---- wavepacket: longitudinal displacement along x ---- */
    var AMP = 11, WID = 62, KW = 0.055, SPEED = 175;
    var SPAN = (NX - 1) * S, PAD = 260;
    function waveU(x, t) {
      var c = ((t * SPEED) % (SPAN + 2 * PAD)) - SPAN / 2 - PAD;
      var d = x - c;
      return AMP * Math.exp(-(d * d) / (2 * WID * WID)) * Math.sin(KW * d * 2.2);
    }

    /* ---- pointer parallax ---- */
    var tgt = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
    if (!REDUCED) {
      lattice.addEventListener("pointermove", function (e) {
        var r = lattice.getBoundingClientRect();
        tgt.x = (e.clientX - r.left) / r.width - 0.5;
        tgt.y = (e.clientY - r.top) / r.height - 0.5;
      });
      lattice.addEventListener("pointerleave", function () { tgt.x = 0; tgt.y = 0; });
    }

    /* ---- projection ---- */
    var F = 760, CAMZ = 560;
    function project(p, sin1, cos1, sin2, cos2, out) {
      // rotate Y then X
      var x = p.x * cos1 + p.z * sin1;
      var z = -p.x * sin1 + p.z * cos1;
      var y = p.y * cos2 - z * sin2;
      z = p.y * sin2 + z * cos2;
      var zz = z + CAMZ;
      var sc = F / zz;
      out.sx = L.w / 2 + x * sc;
      out.sy = H / 2 - 14 + y * sc;
      out.sc = sc;
      out.z = zz;
      return out;
    }

    var proj = atoms.map(function () { return { sx: 0, sy: 0, sc: 0, z: 0 }; });
    var disp = new Array(atoms.length);
    var order = atoms.map(function (_, n) { return n; });
    var epsMax = 0;

    function hud(ctx, t, eps) {
      ctx.font = "10px 'IBM Plex Mono', monospace";
      var x = 18, y = 26, lh = 16;
      ctx.fillStyle = ACC + "0.9)";
      ctx.fillText("ELASTIC WAVE — LONGITUDINAL MODE", x, y);
      ctx.fillStyle = INK + "0.55)";
      ctx.fillText("v_p ≈ 5.9 km·s⁻¹  (STEEL, P-WAVE)", x, y + lh);
      ctx.fillText("ε_max = 0.00" + String(Math.round(20 + eps * 28)).padStart(2, "0"), x, y + lh * 2);
      ctx.fillText("t = " + t.toFixed(1).padStart(5, " ") + " s", x, y + lh * 3);
      ctx.strokeStyle = INK + "0.25)";
      ctx.beginPath(); ctx.moveTo(x, y + 8 + lh * 3); ctx.lineTo(x + 148, y + 8 + lh * 3); ctx.stroke();
      ctx.fillStyle = INK + "0.35)";
      ctx.fillText("N = " + atoms.length + " ATOMS · CUBIC · a = 46", x, y + lh * 4 + 4);
    }

    function triad(ctx, sin1, cos1, sin2, cos2) {
      var ox = L.w - 64, oy = H - 46, len = 22;
      var axes = [
        { p: { x: 1, y: 0, z: 0 }, l: "x" },
        { p: { x: 0, y: -1, z: 0 }, l: "y" },
        { p: { x: 0, y: 0, z: 1 }, l: "z" }
      ];
      ctx.font = "9px 'IBM Plex Mono', monospace";
      axes.forEach(function (a) {
        var x = a.p.x * cos1 + a.p.z * sin1;
        var z = -a.p.x * sin1 + a.p.z * cos1;
        var y = a.p.y * cos2 - z * sin2;
        ctx.strokeStyle = ACC + "0.55)";
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + x * len, oy + y * len); ctx.stroke();
        ctx.fillStyle = INK + "0.6)";
        ctx.fillText(a.l, ox + x * (len + 8) - 2, oy + y * (len + 8) + 3);
      });
    }

    animate(lattice, function (t) {
      var ctx = L.ctx;
      ctx.clearRect(0, 0, L.w, H);

      // ease pointer, compose rotation
      cur.x += (tgt.x - cur.x) * 0.06;
      cur.y += (tgt.y - cur.y) * 0.06;
      var ry = t * 0.13 + cur.x * 0.7;
      var rx = -0.34 + cur.y * 0.30;
      var sin1 = Math.sin(ry), cos1 = Math.cos(ry);
      var sin2 = Math.sin(rx), cos2 = Math.cos(rx);

      // displace + project
      var n, a, u;
      epsMax = 0;
      var P = { x: 0, y: 0, z: 0 };
      for (n = 0; n < atoms.length; n++) {
        a = atoms[n];
        u = waveU(a.x, t);
        disp[n] = u;
        P.x = a.x + u; P.y = a.y; P.z = a.z;
        project(P, sin1, cos1, sin2, cos2, proj[n]);
      }

      // bonds — strain-tinted, depth-faded
      var i, b, p1, p2, strain, alpha;
      ctx.lineWidth = 1;
      for (i = 0; i < bonds.length; i++) {
        b = bonds[i];
        p1 = proj[b[0]]; p2 = proj[b[1]];
        strain = Math.abs(disp[b[0]] - disp[b[1]]) / AMP;      // 0..~1
        if (strain > epsMax) epsMax = strain;
        alpha = 0.05 + 0.32 * Math.max(0, 1 - (p1.z + p2.z - 2 * (CAMZ - 180)) / 700);
        ctx.strokeStyle = strain > 0.12
          ? AMB + Math.min(0.85, alpha + strain * 0.9) + ")"
          : INK + alpha + ")";
        ctx.beginPath(); ctx.moveTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy); ctx.stroke();
      }

      // atoms — painter's order, wave brightens passing atoms
      order.sort(function (m, n2) { return proj[n2].z - proj[m].z; });
      var pr, exc;
      for (i = 0; i < order.length; i++) {
        n = order[i];
        pr = proj[n];
        exc = Math.min(1, Math.abs(disp[n]) / AMP * 1.6);      // excitation 0..1
        var depth = Math.max(0, Math.min(1, (1100 - pr.z) / 750));
        var r = (1.35 + exc * 1.1) * pr.sc * 1.55;
        if (exc > 0.25) {                                      // soft halo on excited atoms
          ctx.beginPath(); ctx.arc(pr.sx, pr.sy, r * 2.6, 0, 6.2832);
          ctx.fillStyle = ACC + (0.10 * exc * depth) + ")"; ctx.fill();
        }
        ctx.beginPath(); ctx.arc(pr.sx, pr.sy, r, 0, 6.2832);
        ctx.fillStyle = INK + (0.22 + 0.55 * depth + 0.25 * exc) + ")";
        ctx.fill();
      }

      hud(ctx, t, epsMax);
      triad(ctx, sin1, cos1, sin2, cos2);
    });

    // rebuild projection on resize
    var rto;
    window.addEventListener("resize", function () {
      clearTimeout(rto);
      rto = setTimeout(function () { L = setupCanvas(lattice, H); }, 150);
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
    var H2 = 330;
    var S2 = setupCanvas(stress, H2);
    var WIDE = S2.w >= 720;                       // side panel only on wide canvases
    var panelW = WIDE ? 300 : 0;
    var m = { l: 64, r: panelW + 26, t: 30, b: 46 };
    var pw = S2.w - m.l - m.r, ph = H2 - m.t - m.b;
    var X = function (u) { return m.l + u * pw; };
    var Y = function (v) { return m.t + (1 - v) * ph; };

    // engineering stress–strain, structural steel (schematic):
    function sigma(u) {
      if (u < 0.10) return u * 6.2;                                   // elastic
      if (u < 0.16) return 0.62 + 0.015 * Math.sin((u - 0.10) * 90);  // yield plateau
      if (u < 0.62) { var q = (u - 0.16) / 0.46; return 0.62 + 0.26 * (1 - Math.pow(1 - q, 2.2)); } // hardening
      var q2 = (u - 0.62) / 0.38; return 0.88 - 0.17 * q2 * q2;       // necking
    }
    var YIELD_U = 0.10, UTS_U = 0.62, END_U = 0.97;
    var SIG_SCALE = 505 / 0.88;                   // display MPa (UTS ≈ 505 MPa)
    var EPS_SCALE = 25;                           // display % strain at u = 1

    function state(u) {
      if (u < YIELD_U) return "ELASTIC";
      if (u < 0.16) return "YIELD";
      if (u < UTS_U) return "STRAIN HARDENING";
      if (u < END_U - 0.004) return "NECKING";
      return "FRACTURE";
    }

    function axes(ctx) {
      ctx.strokeStyle = INK + "0.05)"; ctx.lineWidth = 1;
      for (var gx = 0; gx <= 10; gx++) { ctx.beginPath(); ctx.moveTo(X(gx / 10), Y(0)); ctx.lineTo(X(gx / 10), Y(1)); ctx.stroke(); }
      for (var gy = 0; gy <= 5; gy++) { ctx.beginPath(); ctx.moveTo(X(0), Y(gy / 5)); ctx.lineTo(X(1), Y(gy / 5)); ctx.stroke(); }
      ctx.strokeStyle = INK + "0.45)";
      ctx.beginPath(); ctx.moveTo(X(0), Y(1)); ctx.lineTo(X(0), Y(0)); ctx.lineTo(X(1), Y(0)); ctx.stroke();
      ctx.fillStyle = INK + "0.5)";
      ctx.font = "10px 'IBM Plex Mono', monospace";
      ctx.fillText("STRESS σ (MPa)", 12, m.t + 8);
      ctx.fillText("STRAIN ε →", X(1) - 74, Y(0) + 30);
      // y ticks
      for (var ty = 1; ty <= 5; ty++) {
        var mpa = Math.round(ty / 5 * SIG_SCALE);
        ctx.fillStyle = INK + "0.30)";
        ctx.fillText(String(mpa), 26, Y(ty / 5) + 3);
      }
    }
    function label(ctx, txt, x, y, alignRight) {
      ctx.font = "10px 'IBM Plex Mono', monospace";
      ctx.fillStyle = ACC + "0.9)";
      ctx.fillText(txt, alignRight ? x - ctx.measureText(txt).width : x, y);
    }

    /* ---- specimen (horizontal dogbone) ---- */
    function specimen(ctx, u, frac) {
      var px0 = S2.w - panelW - 4, pw2 = panelW - 26;
      var cx = px0 + pw2 / 2 + 12, cy = 96;
      // panel chrome
      ctx.strokeStyle = INK + "0.18)";
      ctx.strokeRect(px0 + 12, 24, pw2, 132);
      ctx.font = "9.5px 'IBM Plex Mono', monospace";
      ctx.fillStyle = INK + "0.45)";
      ctx.fillText("TENSILE SPECIMEN — SCHEMATIC", px0 + 24, 42);

      var eps = u * EPS_SCALE / 100;              // true-ish visual strain
      var L0 = pw2 * 0.44;
      var L = L0 * (1 + eps * 2.4);               // exaggerated for visibility
      var gripW = 22, gripH = 40, gaugeH = 18;
      var neckP = u <= UTS_U ? 0 : Math.min(1, (u - UTS_U) / (END_U - UTS_U));
      var broken = u >= END_U - 0.004;
      var gap = broken ? 7 : 0;

      var xL = cx - L / 2 - gripW, xR = cx + L / 2;
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = INK + "0.75)";
      ctx.fillStyle = "rgba(147,180,205,.10)";

      function half(sideR) {
        ctx.beginPath();
        var s0 = sideR ? cx + gap / 2 : xL + gripW;   // gauge start x
        var s1 = sideR ? xR : cx - gap / 2;           // gauge end x
        var gx0 = sideR ? xR : xL, gx1 = sideR ? xR + gripW : xL + gripW;
        // grip block
        ctx.rect(Math.min(gx0, gx1), cy - gripH / 2, gripW, gripH);
        // gauge section — tapers toward centre with necking
        var wEnd = gaugeH / 2, wMid = (gaugeH / 2) * (1 - 0.55 * neckP);
        ctx.moveTo(s0, cy - (sideR ? wMid : wEnd));
        ctx.lineTo(s1, cy - (sideR ? wEnd : wMid));
        ctx.lineTo(s1, cy + (sideR ? wEnd : wMid));
        ctx.lineTo(s0, cy + (sideR ? wMid : wEnd));
        ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
      half(false); half(true);

      if (broken) {                                // fracture flash + jag
        ctx.strokeStyle = AMB + "0.9)";
        ctx.beginPath();
        ctx.moveTo(cx - gap / 2, cy - 9); ctx.lineTo(cx - 1, cy - 2);
        ctx.lineTo(cx - gap / 2 - 1, cy + 3); ctx.lineTo(cx - 2, cy + 9);
        ctx.stroke();
        if (frac < 0.5) {                          // brief flash after break
          ctx.beginPath(); ctx.arc(cx, cy, 14 * (1 - frac * 2) + 4, 0, 6.2832);
          ctx.fillStyle = AMB + (0.25 * (1 - frac * 2)) + ")"; ctx.fill();
        }
      }
      // gauge marks
      ctx.strokeStyle = ACC + "0.5)";
      ctx.beginPath();
      ctx.moveTo(cx - L / 2, cy + 22); ctx.lineTo(cx - L / 2, cy + 28);
      ctx.moveTo(cx + L / 2, cy + 22); ctx.lineTo(cx + L / 2, cy + 28);
      ctx.moveTo(cx - L / 2, cy + 25); ctx.lineTo(cx + L / 2, cy + 25);
      ctx.stroke();
      ctx.fillStyle = INK + "0.4)";
      ctx.fillText("L = L₀ + ΔL", cx - 30, cy + 40);
    }

    /* ---- readout block ---- */
    function readout(ctx, u) {
      var px0 = S2.w - panelW - 4, pw2 = panelW - 26;
      var x = px0 + 24, y = 186, lh = 19;
      var sig = Math.round(sigma(u) * SIG_SCALE);
      var eps = (u * EPS_SCALE).toFixed(1);
      ctx.font = "10px 'IBM Plex Mono', monospace";
      ctx.strokeStyle = INK + "0.18)";
      ctx.strokeRect(px0 + 12, 168, pw2, 118);
      ctx.fillStyle = INK + "0.45)"; ctx.fillText("LIVE READOUT", x, y);
      ctx.fillStyle = INK + "0.65)";
      ctx.fillText("σ  = " + String(sig).padStart(3, " ") + " MPa", x, y + lh);
      ctx.fillText("ε  = " + eps + " %", x, y + lh * 2);
      ctx.fillText("E  = 210 GPa", x, y + lh * 3);
      var st = state(u);
      ctx.fillStyle = st === "FRACTURE" ? AMB + "0.95)" : ACC + "0.95)";
      ctx.fillText("STATE: " + st, x, y + lh * 4 + 4);
      // state indicator dot
      ctx.beginPath(); ctx.arc(x + pw2 - 34, y + lh * 4, 3.5, 0, 6.2832);
      ctx.fillStyle = st === "FRACTURE" ? AMB + "0.95)" : ACC + "0.9)"; ctx.fill();
    }

    var PERIOD = 12;  // s: 7.5 trace + hold
    animate(stress, function (t) {
      var ctx = S2.ctx;
      var cycle = REDUCED ? 7.5 : (t % PERIOD);
      var prog = Math.min(cycle / 7.5, 1);
      var uMax = END_U * (1 - Math.pow(1 - prog, 3));
      var fracT = Math.max(0, cycle - 7.5);        // time since fracture

      ctx.clearRect(0, 0, S2.w, H2);
      axes(ctx);

      // gradient fill under traced curve
      var grad = ctx.createLinearGradient(0, m.t, 0, Y(0));
      grad.addColorStop(0, "rgba(147,180,205,.14)");
      grad.addColorStop(1, "rgba(147,180,205,0)");
      ctx.beginPath(); ctx.moveTo(X(0), Y(0));
      for (var u = 0; u <= uMax; u += 0.004) ctx.lineTo(X(u), Y(sigma(u)));
      ctx.lineTo(X(uMax), Y(0)); ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();

      // curve
      ctx.strokeStyle = INK + "0.9)"; ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (u = 0; u <= uMax; u += 0.004) {
        var px = X(u), py = Y(sigma(u));
        u === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();

      // annotations as trace passes
      if (uMax > YIELD_U) {
        var yx = X(YIELD_U), yy = Y(sigma(YIELD_U));
        ctx.strokeStyle = ACC + "0.35)"; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(X(0), yy); ctx.lineTo(yx, yy); ctx.stroke(); ctx.setLineDash([]);
        label(ctx, "σy  YIELD", yx + 8, yy - 6);
        label(ctx, "E = Δσ/Δε", X(0.035), Y(0.30));
      }
      if (uMax > UTS_U) {
        var ux = X(UTS_U), uy = Y(sigma(UTS_U));
        ctx.beginPath(); ctx.arc(ux, uy, 3, 0, Math.PI * 2); ctx.fillStyle = ACC + "0.95)"; ctx.fill();
        label(ctx, "UTS", ux - 10, uy - 10, true);
      }
      if (uMax >= END_U - 0.001) {
        var fx = X(END_U), fy = Y(sigma(END_U));
        ctx.strokeStyle = AMB + "0.95)"; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(fx - 4, fy - 4); ctx.lineTo(fx + 4, fy + 4);
        ctx.moveTo(fx + 4, fy - 4); ctx.lineTo(fx - 4, fy + 4); ctx.stroke();
        ctx.fillStyle = AMB + "0.9)";
        ctx.font = "10px 'IBM Plex Mono', monospace";
        ctx.fillText("FRACTURE", fx - 62, fy - 12);
      }

      // scan cursor with soft glow + crosshair (while tracing)
      if (prog < 1) {
        var cxp = X(uMax), cyp = Y(sigma(uMax));
        ctx.strokeStyle = ACC + "0.25)"; ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(cxp, cyp); ctx.lineTo(cxp, Y(0));
        ctx.moveTo(cxp, cyp); ctx.lineTo(X(0), cyp); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(cxp, cyp, 9, 0, 6.2832); ctx.fillStyle = ACC + "0.12)"; ctx.fill();
        ctx.beginPath(); ctx.arc(cxp, cyp, 4.5, 0, 6.2832); ctx.fillStyle = ACC + "0.35)"; ctx.fill();
        ctx.beginPath(); ctx.arc(cxp, cyp, 2, 0, 6.2832); ctx.fillStyle = "rgba(230,244,252,.95)"; ctx.fill();
      }

      if (WIDE) { specimen(ctx, uMax, fracT); readout(ctx, uMax); }
      else {
        // narrow: compact readout inside plot
        var sig = Math.round(sigma(uMax) * SIG_SCALE);
        ctx.font = "10px 'IBM Plex Mono', monospace";
        ctx.fillStyle = INK + "0.6)";
        ctx.fillText("σ = " + sig + " MPa   ε = " + (uMax * EPS_SCALE).toFixed(1) + " %   " + state(uMax), m.l + 8, m.t + 24);
      }
    });
  })();
})();
