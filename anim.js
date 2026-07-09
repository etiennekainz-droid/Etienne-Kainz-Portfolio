/* ============================================================
   Scientific figure animations — drafting-style, no libraries.
   1) #latticeCanvas — 3-D crystal lattice, full-bleed; alternating
      P-wave (longitudinal) and S-wave (transverse) packets at true
      relative speeds, strain-tinted bonds, live seismogram probe,
      pointer-steered camera.
   2) #armCanvas     — 6-axis manipulator, scroll-driven kinematics,
      drafting line-work on graph paper, live joint readouts.
   3) #stressCanvas  — tensile-test dashboard (curve + specimen).
   All pause off-screen and render a static frame under
   prefers-reduced-motion.
   ============================================================ */
(function () {
  "use strict";

  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var INK = "rgba(200,214,226,";     // line ink
  var ACC = "rgba(147,180,205,";     // drafting blue
  var AMB = "rgba(207,160,104,";     // strain amber
  var BG  = "#0f1114";

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
    }, { threshold: 0.03 }).observe(canvas);
  }

  function smooth(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }

  /* ============================================================
     1. CRYSTAL LATTICE — P/S elastic wave propagation
     ============================================================ */
  var lattice = document.getElementById("latticeCanvas");
  if (lattice) (function () {
    var H = 460;
    var L = setupCanvas(lattice, H);
    window.addEventListener("resize", (function () {
      var to; return function () { clearTimeout(to); to = setTimeout(function () { L = setupCanvas(lattice, H); }, 160); };
    })());

    /* ---- geometry ---- */
    var NX = 18, NY = 6, NZ = 6, S = 44;
    var atoms = [], bonds = [], PROBE = 0;
    (function build() {
      for (var i = 0; i < NX; i++) for (var j = 0; j < NY; j++) for (var k = 0; k < NZ; k++) {
        atoms.push({ x: (i - (NX - 1) / 2) * S, y: (j - (NY - 1) / 2) * S, z: (k - (NZ - 1) / 2) * S });
      }
      var idx = function (i, j, k) { return (i * NY + j) * NZ + k; };
      for (var a = 0; a < NX; a++) for (var b = 0; b < NY; b++) for (var c = 0; c < NZ; c++) {
        if (a + 1 < NX) bonds.push([idx(a, b, c), idx(a + 1, b, c)]);
        if (b + 1 < NY) bonds.push([idx(a, b, c), idx(a, b + 1, c)]);
        if (c + 1 < NZ) bonds.push([idx(a, b, c), idx(a, b, c + 1)]);
      }
      PROBE = idx(Math.floor(NX / 2), Math.floor(NY / 2), Math.floor(NZ / 2));
    })();

    /* ---- two wave modes, true relative speeds (v_s ≈ 0.55 v_p) ---- */
    var SPAN = (NX - 1) * S, PAD = 300;
    function packet(x, t, speed, amp, wid, kw) {
      var c = ((t * speed) % (SPAN + 2 * PAD)) - SPAN / 2 - PAD;
      var d = x - c;
      return amp * Math.exp(-(d * d) / (2 * wid * wid)) * Math.sin(kw * d);
    }
    var CYCLE = 18;                       // s: P 8 · blend 1 · S 8 · blend 1
    function modeMix(t) {
      var ph = t % CYCLE;
      if (ph < 8)  return { fP: 1, fS: 0, label: "P-WAVE — LONGITUDINAL", v: "v_p ≈ 5.9 km·s⁻¹" };
      if (ph < 9)  { var q = smooth(ph - 8); return { fP: 1 - q, fS: q, label: "MODE TRANSITION", v: "—" }; }
      if (ph < 17) return { fP: 0, fS: 1, label: "S-WAVE — TRANSVERSE", v: "v_s ≈ 3.2 km·s⁻¹" };
      var q2 = smooth(ph - 17); return { fP: q2, fS: 1 - q2, label: "MODE TRANSITION", v: "—" };
    }

    /* ---- pointer-steered camera ---- */
    var tgt = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
    if (!REDUCED) {
      lattice.addEventListener("pointermove", function (e) {
        var r = lattice.getBoundingClientRect();
        tgt.x = (e.clientX - r.left) / r.width - 0.5;
        tgt.y = (e.clientY - r.top) / r.height - 0.5;
      });
      lattice.addEventListener("pointerleave", function () { tgt.x = 0; tgt.y = 0; });
    }

    /* ---- projection (fitted so nothing clips at top/bottom) ---- */
    var F = 680, CAMZ = 760;
    function project(px, py, pz, sin1, cos1, sin2, cos2, out) {
      var x = px * cos1 + pz * sin1;
      var z = -px * sin1 + pz * cos1;
      var y = py * cos2 - z * sin2;
      z = py * sin2 + z * cos2;
      var zz = z + CAMZ, sc = F / zz;
      out.sx = L.w / 2 + x * sc;
      out.sy = H / 2 + y * sc;
      out.sc = sc; out.z = zz;
    }

    var proj = atoms.map(function () { return { sx: 0, sy: 0, sc: 0, z: 0 }; });
    var disp = new Array(atoms.length);
    var order = atoms.map(function (_, n) { return n; });

    /* ---- seismogram ring buffer ---- */
    var TR_N = 240, trace = new Float32Array(TR_N), trHead = 0;

    function hud(ctx, t, eps, mix) {
      ctx.font = "10px 'IBM Plex Mono', monospace";
      var x = 20, y = 30, lh = 16;
      ctx.fillStyle = ACC + "0.95)";
      ctx.fillText("ELASTIC WAVE — " + mix.label, x, y);
      ctx.fillStyle = INK + "0.55)";
      ctx.fillText(mix.v + "  (STEEL)", x, y + lh);
      ctx.fillText("ε_max = 0.00" + String(Math.round(18 + eps * 30)).padStart(2, "0"), x, y + lh * 2);
      ctx.fillText("t = " + t.toFixed(1).padStart(5, " ") + " s", x, y + lh * 3);
      ctx.strokeStyle = INK + "0.25)";
      ctx.beginPath(); ctx.moveTo(x, y + 8 + lh * 3); ctx.lineTo(x + 168, y + 8 + lh * 3); ctx.stroke();
      ctx.fillStyle = INK + "0.35)";
      ctx.fillText("N = " + atoms.length + " ATOMS · CUBIC LATTICE", x, y + lh * 4 + 4);
    }

    function seismogram(ctx) {
      var w = 250, h = 66, x = 20, y = H - h - 22;
      ctx.strokeStyle = INK + "0.20)"; ctx.strokeRect(x, y, w, h);
      ctx.font = "9px 'IBM Plex Mono', monospace";
      ctx.fillStyle = INK + "0.45)";
      ctx.fillText("PROBE ATOM — u(t)  SEISMOGRAM", x + 8, y - 6);
      ctx.strokeStyle = INK + "0.12)";
      ctx.beginPath(); ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); ctx.stroke();
      ctx.strokeStyle = ACC + "0.85)"; ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (var i = 0; i < TR_N; i++) {
        var v = trace[(trHead + i) % TR_N];
        var px2 = x + (i / (TR_N - 1)) * w;
        var py2 = y + h / 2 - v * 2.1;
        i === 0 ? ctx.moveTo(px2, py2) : ctx.lineTo(px2, py2);
      }
      ctx.stroke(); ctx.lineWidth = 1;
    }

    function triad(ctx, sin1, cos1, sin2, cos2) {
      var ox = L.w - 74, oy = H - 52, len = 22;
      var axes = [{ x: 1, y: 0, z: 0, l: "x" }, { x: 0, y: -1, z: 0, l: "y" }, { x: 0, y: 0, z: 1, l: "z" }];
      ctx.font = "9px 'IBM Plex Mono', monospace";
      for (var i = 0; i < 3; i++) {
        var a = axes[i];
        var x = a.x * cos1 + a.z * sin1;
        var z = -a.x * sin1 + a.z * cos1;
        var y = a.y * cos2 - z * sin2;
        ctx.strokeStyle = ACC + "0.55)";
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + x * len, oy + y * len); ctx.stroke();
        ctx.fillStyle = INK + "0.6)";
        ctx.fillText(a.l, ox + x * (len + 8) - 2, oy + y * (len + 8) + 3);
      }
    }

    animate(lattice, function (t) {
      var ctx = L.ctx;
      ctx.clearRect(0, 0, L.w, H);

      cur.x += (tgt.x - cur.x) * 0.06;
      cur.y += (tgt.y - cur.y) * 0.06;
      var ry = t * 0.11 + cur.x * 0.8;
      var rx = -0.30 + cur.y * 0.3 + 0.04 * Math.sin(t * 0.23);
      var sin1 = Math.sin(ry), cos1 = Math.cos(ry);
      var sin2 = Math.sin(rx), cos2 = Math.cos(rx);

      var mix = modeMix(t);
      var n, a, uP, uS;
      for (n = 0; n < atoms.length; n++) {
        a = atoms[n];
        uP = mix.fP ? packet(a.x, t, 185, 11, 64, 0.12) * mix.fP : 0;
        uS = mix.fS ? packet(a.x, t, 105, 13, 70, 0.10) * mix.fS : 0;
        disp[n] = uP + uS;
        project(a.x + uP, a.y + uS, a.z, sin1, cos1, sin2, cos2, proj[n]);
      }
      trace[trHead] = disp[PROBE]; trHead = (trHead + 1) % TR_N;

      /* bonds — bucketed ink strokes + individual amber strained bonds */
      var b1 = [], b2 = [], b3 = [], hot = [];
      var i, b, p1, p2, strain, depth, epsMax = 0;
      for (i = 0; i < bonds.length; i++) {
        b = bonds[i];
        p1 = proj[b[0]]; p2 = proj[b[1]];
        strain = Math.abs(disp[b[0]] - disp[b[1]]) / 13;
        if (strain > epsMax) epsMax = strain;
        if (strain > 0.14) { hot.push([p1, p2, strain]); continue; }
        depth = (p1.z + p2.z) / 2;
        (depth < 640 ? b1 : depth < 860 ? b2 : b3).push([p1, p2]);
      }
      function strokeBucket(list, alpha) {
        if (!list.length) return;
        ctx.strokeStyle = INK + alpha + ")";
        ctx.beginPath();
        for (var q = 0; q < list.length; q++) {
          ctx.moveTo(list[q][0].sx, list[q][0].sy);
          ctx.lineTo(list[q][1].sx, list[q][1].sy);
        }
        ctx.stroke();
      }
      ctx.lineWidth = 1;
      strokeBucket(b3, "0.06"); strokeBucket(b2, "0.13"); strokeBucket(b1, "0.24");
      for (i = 0; i < hot.length; i++) {
        ctx.strokeStyle = AMB + Math.min(0.9, 0.25 + hot[i][2]) + ")";
        ctx.beginPath(); ctx.moveTo(hot[i][0].sx, hot[i][0].sy); ctx.lineTo(hot[i][1].sx, hot[i][1].sy); ctx.stroke();
      }

      /* atoms — painter's order, excited atoms glow */
      order.sort(function (m, n2) { return proj[n2].z - proj[m].z; });
      var pr, exc;
      for (i = 0; i < order.length; i++) {
        n = order[i];
        pr = proj[n];
        exc = Math.min(1, Math.abs(disp[n]) / 13 * 1.7);
        var dfog = Math.max(0, Math.min(1, (1250 - pr.z) / 800));
        var r = (1.15 + exc * 1.15) * pr.sc * 1.85;
        if (exc > 0.25) {
          ctx.beginPath(); ctx.arc(pr.sx, pr.sy, r * 2.7, 0, 6.2832);
          ctx.fillStyle = ACC + (0.11 * exc * dfog) + ")"; ctx.fill();
        }
        ctx.beginPath(); ctx.arc(pr.sx, pr.sy, r, 0, 6.2832);
        ctx.fillStyle = INK + (0.2 + 0.58 * dfog + 0.25 * exc) + ")";
        ctx.fill();
      }

      hud(ctx, t, epsMax, mix);
      seismogram(ctx);
      triad(ctx, sin1, cos1, sin2, cos2);
    });
  })();

  /* ============================================================
     2. SIX-AXIS ARM — scroll-driven kinematics, drafting style
     ============================================================ */
  var armC = document.getElementById("armCanvas");
  if (armC) (function () {
    var H = 460;
    var A = setupCanvas(armC, H);
    window.addEventListener("resize", (function () {
      var to; return function () { clearTimeout(to); to = setTimeout(function () { A = setupCanvas(armC, H); }, 160); };
    })());

    var D2R = Math.PI / 180;
    /* keyframes over scroll progress p: [J2,J3,J4] deg · grip · J1 turntable deg */
    var K = [
      { p: 0.00, a: [115, -95, -40], g: 0.85, tt:   0 },
      { p: 0.25, a: [ 72, -58, -46], g: 1.00, tt:  14 },
      { p: 0.48, a: [ 50, -34, -58], g: 0.15, tt:  14 },
      { p: 0.72, a: [ 96, -72, -14], g: 0.15, tt: -24 },
      { p: 1.00, a: [ 62, -22, -36], g: 0.90, tt: -40 }
    ];
    function poseAt(p) {
      var i = 0;
      while (i < K.length - 2 && p > K[i + 1].p) i++;
      var k0 = K[i], k1 = K[i + 1];
      var q = smooth((p - k0.p) / (k1.p - k0.p));
      return {
        a: [k0.a[0] + (k1.a[0] - k0.a[0]) * q, k0.a[1] + (k1.a[1] - k0.a[1]) * q, k0.a[2] + (k1.a[2] - k0.a[2]) * q],
        g: k0.g + (k1.g - k0.g) * q,
        tt: k0.tt + (k1.tt - k0.tt) * q
      };
    }
    var curPose = poseAt(0), scrollP = 0;

    function fk(pose, u, bx, fy) {
      var L1 = 168 * u, L2 = 142 * u, L3 = 60 * u;
      var t1 = pose.a[0] * D2R, t2 = t1 + pose.a[1] * D2R, t3 = t2 + pose.a[2] * D2R;
      var S0 = { x: bx, y: fy - 118 * u };
      var E = { x: S0.x + L1 * Math.cos(t1), y: S0.y - L1 * Math.sin(t1) };
      var W1 = { x: E.x + L2 * Math.cos(t2), y: E.y - L2 * Math.sin(t2) };
      var T = { x: W1.x + L3 * Math.cos(t3), y: W1.y - L3 * Math.sin(t3) };
      return { S: S0, E: E, W: W1, T: T, t1: t1, t2: t2, t3: t3 };
    }

    /* link with parallel edges, soft fill, dashed centerline */
    function link(ctx, a, b, w1, w2) {
      var dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / d, ny = dx / d;
      ctx.beginPath();
      ctx.moveTo(a.x + nx * w1, a.y + ny * w1);
      ctx.lineTo(b.x + nx * w2, b.y + ny * w2);
      ctx.lineTo(b.x - nx * w2, b.y - ny * w2);
      ctx.lineTo(a.x - nx * w1, a.y - ny * w1);
      ctx.closePath();
      ctx.fillStyle = "rgba(147,180,205,.055)"; ctx.fill();
      ctx.strokeStyle = INK + "0.8)"; ctx.lineWidth = 1.3; ctx.stroke();
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle = INK + "0.22)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
    }
    function joint(ctx, p, r, ang) {
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.2832);
      ctx.fillStyle = BG; ctx.fill();
      ctx.strokeStyle = INK + "0.85)"; ctx.lineWidth = 1.3; ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.45, 0, 6.2832);
      ctx.strokeStyle = INK + "0.5)"; ctx.lineWidth = 1; ctx.stroke();
      for (var i = 0; i < 6; i++) {
        var th = ang + i * Math.PI / 3;
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(th) * r * 0.72, p.y + Math.sin(th) * r * 0.72, 1.3, 0, 6.2832);
        ctx.fillStyle = INK + "0.6)"; ctx.fill();
      }
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, 6.2832);
      ctx.fillStyle = ACC + "0.9)"; ctx.fill();
    }
    function angleArc(ctx, p, r, from, to, label) {
      ctx.strokeStyle = ACC + "0.45)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, -from, -to, from < to); ctx.stroke();
      ctx.font = "9px 'IBM Plex Mono', monospace";
      ctx.fillStyle = ACC + "0.8)";
      var mid = -(from + to) / 2;
      ctx.fillText(label, p.x + Math.cos(mid) * (r + 12) - 10, p.y + Math.sin(mid) * (r + 12) + 3);
    }

    var trail = [];

    animate(armC, function (t) {
      var ctx = A.ctx, W = A.w;
      var u = Math.min(1, W / 1150);
      var bx = W * 0.44, fy = H - 72;

      /* scroll scrub */
      var r = armC.getBoundingClientRect();
      var vh = window.innerHeight;
      var p = Math.max(0, Math.min(1, (vh - r.top) / (vh + r.height * 0.6)));
      scrollP += (p - scrollP) * 0.09;
      var target = poseAt(scrollP);
      for (var i = 0; i < 3; i++) curPose.a[i] += (target.a[i] - curPose.a[i]) * 0.14;
      curPose.g += (target.g - curPose.g) * 0.14;
      curPose.tt += (target.tt - curPose.tt) * 0.14;
      /* servo dither — tiny life */
      var dith = [Math.sin(t * 6.1) * 0.22, Math.sin(t * 7.3 + 1) * 0.25, Math.sin(t * 8.7 + 2) * 0.3];
      var shown = { a: [curPose.a[0] + dith[0], curPose.a[1] + dith[1], curPose.a[2] + dith[2]], g: curPose.g, tt: curPose.tt };

      ctx.clearRect(0, 0, W, H);

      /* graph paper */
      ctx.lineWidth = 1;
      ctx.strokeStyle = INK + "0.045)";
      ctx.beginPath();
      for (var gx = 0; gx <= W; gx += 36) { ctx.moveTo(gx, 0); ctx.lineTo(gx, H); }
      for (var gy = 0; gy <= H; gy += 36) { ctx.moveTo(0, gy); ctx.lineTo(W, gy); }
      ctx.stroke();
      ctx.strokeStyle = INK + "0.08)";
      ctx.beginPath();
      for (gx = 0; gx <= W; gx += 180) { ctx.moveTo(gx, 0); ctx.lineTo(gx, H); }
      ctx.stroke();

      /* floor + hatching */
      ctx.strokeStyle = INK + "0.5)";
      ctx.beginPath(); ctx.moveTo(bx - 240 * u, fy); ctx.lineTo(bx + 420 * u, fy); ctx.stroke();
      ctx.strokeStyle = INK + "0.25)";
      ctx.beginPath();
      for (var hx = bx - 236 * u; hx < bx + 418 * u; hx += 14) { ctx.moveTo(hx, fy); ctx.lineTo(hx - 8, fy + 8); }
      ctx.stroke();

      /* pick / place targets from keyframes */
      var pk = fk(poseAt(0.48), u, bx, fy), pl = fk(poseAt(1), u, bx, fy);
      function targetMark(pt, lbl) {
        ctx.strokeStyle = AMB + "0.55)"; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pt.x - 9, pt.y); ctx.lineTo(pt.x + 9, pt.y);
        ctx.moveTo(pt.x, pt.y - 9); ctx.lineTo(pt.x, pt.y + 9);
        ctx.stroke();
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 5.5, 0, 6.2832); ctx.stroke();
        ctx.setLineDash([3, 5]);
        ctx.strokeStyle = AMB + "0.25)";
        ctx.beginPath(); ctx.moveTo(pt.x, pt.y + 9); ctx.lineTo(pt.x, fy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = "9px 'IBM Plex Mono', monospace";
        ctx.fillStyle = AMB + "0.75)";
        ctx.fillText(lbl, pt.x + 12, pt.y - 6);
      }
      targetMark(pk.T, "P1 — PICK");
      targetMark(pl.T, "P2 — PLACE");

      /* base pedestal + turntable */
      var bw = 88 * u;
      ctx.strokeStyle = INK + "0.8)"; ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(bx - bw, fy); ctx.lineTo(bx - bw * 0.62, fy - 96 * u);
      ctx.lineTo(bx + bw * 0.62, fy - 96 * u); ctx.lineTo(bx + bw, fy);
      ctx.closePath();
      ctx.fillStyle = "rgba(147,180,205,.04)"; ctx.fill(); ctx.stroke();
      ctx.strokeStyle = INK + "0.2)"; ctx.lineWidth = 1;
      ctx.beginPath();
      for (var hb = 0; hb < 5; hb++) {
        ctx.moveTo(bx - bw * 0.8 + hb * bw * 0.4, fy - 4);
        ctx.lineTo(bx - bw * 0.55 + hb * bw * 0.4, fy - 92 * u);
      }
      ctx.stroke();
      /* turntable ellipse + J1 tick marks */
      var tty = fy - 100 * u, ttr = 64 * u;
      ctx.strokeStyle = INK + "0.7)"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(bx, tty, ttr, ttr * 0.22, 0, 0, 6.2832); ctx.stroke();
      var ttRad = shown.tt * D2R;
      for (i = 0; i < 12; i++) {
        var ta = ttRad + i * Math.PI / 6;
        var tx = bx + Math.cos(ta) * ttr * 0.92, tyy = tty + Math.sin(ta) * ttr * 0.22 * 0.92;
        ctx.beginPath(); ctx.arc(tx, tyy, 1.1, 0, 6.2832);
        ctx.fillStyle = ACC + "0.65)"; ctx.fill();
      }

      /* kinematic chain */
      var f = fk(shown, u, bx, fy);
      /* cable — sagging service loop */
      ctx.strokeStyle = ACC + "0.30)"; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(bx - bw * 0.7, fy - 40 * u);
      ctx.bezierCurveTo(bx - 150 * u, fy - 180 * u, f.E.x - 120 * u, f.E.y - 60 * u, f.E.x - 8, f.E.y - 14);
      ctx.stroke();

      link(ctx, f.S, f.E, 15 * u, 11.5 * u);
      link(ctx, f.E, f.W, 11.5 * u, 8.5 * u);
      link(ctx, f.W, f.T, 7 * u, 5 * u);
      joint(ctx, f.S, 17 * u, f.t1);
      joint(ctx, f.E, 13 * u, f.t2);
      joint(ctx, f.W, 9.5 * u, f.t3);
      angleArc(ctx, f.S, 24 * u, 0, f.t1, "J2 " + Math.round(shown.a[0]) + "°");
      angleArc(ctx, f.E, 20 * u, f.t1, f.t2, "J3 " + Math.round(shown.a[1]) + "°");
      angleArc(ctx, f.W, 16 * u, f.t2, f.t3, "J4 " + Math.round(shown.a[2]) + "°");

      /* gripper */
      ctx.save();
      ctx.translate(f.T.x, f.T.y);
      ctx.rotate(-f.t3);
      var gap = (5 + 13 * shown.g) * u, jl = 26 * u;
      ctx.strokeStyle = INK + "0.85)"; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(0, -gap - 6 * u); ctx.lineTo(0, gap + 6 * u); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -gap); ctx.lineTo(jl, -gap); ctx.lineTo(jl, -gap + 5 * u);
      ctx.moveTo(0, gap); ctx.lineTo(jl, gap); ctx.lineTo(jl, gap - 5 * u);
      ctx.stroke();
      /* J5 roll collar */
      var roll = scrollP * 4;
      for (i = 0; i < 4; i++) {
        var ra = roll + i * Math.PI / 2;
        ctx.beginPath();
        ctx.arc(-9 * u, 0, 6 * u, ra, ra + 0.7);
        ctx.strokeStyle = ACC + "0.7)"; ctx.stroke();
      }
      ctx.restore();

      /* TCP trail + marker */
      trail.push({ x: f.T.x, y: f.T.y });
      if (trail.length > 110) trail.shift();
      ctx.beginPath();
      for (i = 0; i < trail.length; i++) i === 0 ? ctx.moveTo(trail[i].x, trail[i].y) : ctx.lineTo(trail[i].x, trail[i].y);
      ctx.strokeStyle = ACC + "0.22)"; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(f.T.x, f.T.y, 2.4, 0, 6.2832);
      ctx.fillStyle = ACC + "0.95)"; ctx.fill();

      /* HUD */
      ctx.font = "10px 'IBM Plex Mono', monospace";
      var hx2 = 20, hy = 30, lh = 16;
      ctx.fillStyle = ACC + "0.95)";
      ctx.fillText("6-AXIS MANIPULATOR — KINEMATIC STUDY", hx2, hy);
      ctx.fillStyle = INK + "0.55)";
      ctx.fillText("J1 " + String(Math.round(shown.tt)).padStart(4) + "°   J2 " + String(Math.round(shown.a[0])).padStart(4) + "°   J3 " + String(Math.round(shown.a[1])).padStart(4) + "°", hx2, hy + lh);
      ctx.fillText("J4 " + String(Math.round(shown.a[2])).padStart(4) + "°   J5 " + String(Math.round(roll / D2R) % 360).padStart(4) + "°   GRIP " + Math.round(shown.g * 100) + "%", hx2, hy + lh * 2);
      ctx.fillText("TCP  x=" + Math.round((f.T.x - bx) * 2) + "  z=" + Math.round((fy - f.T.y) * 2) + "  mm", hx2, hy + lh * 3);
      var hint = 1 - Math.min(1, scrollP / 0.07);
      if (hint > 0.02) {
        ctx.fillStyle = AMB + (0.85 * hint) + ")";
        ctx.fillText("SCROLL — ACTUATES JOINTS ↓", hx2, hy + lh * 4 + 6);
      }
      ctx.fillStyle = INK + "0.3)";
      ctx.fillText("SEQ: PARK → REACH → GRIP → LIFT → PLACE", Math.max(hx2, W - 300), H - 24);
    });
  })();

  /* ============================================================
     3. STRESS–STRAIN — tensile test dashboard
     ============================================================ */
  var stress = document.getElementById("stressCanvas");
  if (stress) (function () {
    var H2 = 330;
    var S2 = setupCanvas(stress, H2);
    var WIDE = S2.w >= 720;
    var panelW = WIDE ? 300 : 0;
    var m = { l: 64, r: panelW + 26, t: 30, b: 46 };
    var pw = S2.w - m.l - m.r, ph = H2 - m.t - m.b;
    var X = function (u) { return m.l + u * pw; };
    var Y = function (v) { return m.t + (1 - v) * ph; };

    function sigma(u) {
      if (u < 0.10) return u * 6.2;
      if (u < 0.16) return 0.62 + 0.015 * Math.sin((u - 0.10) * 90);
      if (u < 0.62) { var q = (u - 0.16) / 0.46; return 0.62 + 0.26 * (1 - Math.pow(1 - q, 2.2)); }
      var q2 = (u - 0.62) / 0.38; return 0.88 - 0.17 * q2 * q2;
    }
    var YIELD_U = 0.10, UTS_U = 0.62, END_U = 0.97;
    var SIG_SCALE = 505 / 0.88, EPS_SCALE = 25;

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

    function specimen(ctx, u, frac) {
      var px0 = S2.w - panelW - 4, pw2 = panelW - 26;
      var cx = px0 + pw2 / 2 + 12, cy = 96;
      ctx.strokeStyle = INK + "0.18)";
      ctx.strokeRect(px0 + 12, 24, pw2, 132);
      ctx.font = "9.5px 'IBM Plex Mono', monospace";
      ctx.fillStyle = INK + "0.45)";
      ctx.fillText("TENSILE SPECIMEN — SCHEMATIC", px0 + 24, 42);

      var eps = u * EPS_SCALE / 100;
      var L0 = pw2 * 0.44;
      var L = L0 * (1 + eps * 2.4);
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
        var s0 = sideR ? cx + gap / 2 : xL + gripW;
        var s1 = sideR ? xR : cx - gap / 2;
        var gx0 = sideR ? xR : xL, gx1 = sideR ? xR + gripW : xL + gripW;
        ctx.rect(Math.min(gx0, gx1), cy - gripH / 2, gripW, gripH);
        var wEnd = gaugeH / 2, wMid = (gaugeH / 2) * (1 - 0.55 * neckP);
        ctx.moveTo(s0, cy - (sideR ? wMid : wEnd));
        ctx.lineTo(s1, cy - (sideR ? wEnd : wMid));
        ctx.lineTo(s1, cy + (sideR ? wEnd : wMid));
        ctx.lineTo(s0, cy + (sideR ? wMid : wEnd));
        ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
      half(false); half(true);

      if (broken) {
        ctx.strokeStyle = AMB + "0.9)";
        ctx.beginPath();
        ctx.moveTo(cx - gap / 2, cy - 9); ctx.lineTo(cx - 1, cy - 2);
        ctx.lineTo(cx - gap / 2 - 1, cy + 3); ctx.lineTo(cx - 2, cy + 9);
        ctx.stroke();
        if (frac < 0.5) {
          ctx.beginPath(); ctx.arc(cx, cy, 14 * (1 - frac * 2) + 4, 0, 6.2832);
          ctx.fillStyle = AMB + (0.25 * (1 - frac * 2)) + ")"; ctx.fill();
        }
      }
      ctx.strokeStyle = ACC + "0.5)";
      ctx.beginPath();
      ctx.moveTo(cx - L / 2, cy + 22); ctx.lineTo(cx - L / 2, cy + 28);
      ctx.moveTo(cx + L / 2, cy + 22); ctx.lineTo(cx + L / 2, cy + 28);
      ctx.moveTo(cx - L / 2, cy + 25); ctx.lineTo(cx + L / 2, cy + 25);
      ctx.stroke();
      ctx.fillStyle = INK + "0.4)";
      ctx.fillText("L = L₀ + ΔL", cx - 30, cy + 40);
    }

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
      ctx.beginPath(); ctx.arc(x + pw2 - 34, y + lh * 4, 3.5, 0, 6.2832);
      ctx.fillStyle = st === "FRACTURE" ? AMB + "0.95)" : ACC + "0.9)"; ctx.fill();
    }

    var PERIOD = 12;
    animate(stress, function (t) {
      var ctx = S2.ctx;
      var cycle = REDUCED ? 7.5 : (t % PERIOD);
      var prog = Math.min(cycle / 7.5, 1);
      var uMax = END_U * (1 - Math.pow(1 - prog, 3));
      var fracT = Math.max(0, cycle - 7.5);

      ctx.clearRect(0, 0, S2.w, H2);
      axes(ctx);

      var grad = ctx.createLinearGradient(0, m.t, 0, Y(0));
      grad.addColorStop(0, "rgba(147,180,205,.14)");
      grad.addColorStop(1, "rgba(147,180,205,0)");
      ctx.beginPath(); ctx.moveTo(X(0), Y(0));
      for (var u = 0; u <= uMax; u += 0.004) ctx.lineTo(X(u), Y(sigma(u)));
      ctx.lineTo(X(uMax), Y(0)); ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();

      ctx.strokeStyle = INK + "0.9)"; ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (u = 0; u <= uMax; u += 0.004) {
        var px = X(u), py = Y(sigma(u));
        u === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();

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
        var sig2 = Math.round(sigma(uMax) * SIG_SCALE);
        ctx.font = "10px 'IBM Plex Mono', monospace";
        ctx.fillStyle = INK + "0.6)";
        ctx.fillText("σ = " + sig2 + " MPa   ε = " + (uMax * EPS_SCALE).toFixed(1) + " %   " + state(uMax), m.l + 8, m.t + 24);
      }
    });
  })();
})();
