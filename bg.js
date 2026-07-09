/* ============================================================
   Ambient background — drifting hydrogen atoms.
   Fixed full-viewport canvas behind all content: sparse nuclei
   with orbiting electrons, faint proximity links, slow drift,
   scroll parallax by depth, occasional emission pulse.
   Very low opacity by design; skipped under reduced motion.
   ============================================================ */
(function () {
  "use strict";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var INK = "rgba(200,214,226,", ACC = "rgba(147,180,205,";

  var c = document.createElement("canvas");
  c.className = "atom-bg";
  c.setAttribute("aria-hidden", "true");
  document.body.insertBefore(c, document.body.firstChild);
  var ctx = c.getContext("2d");
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0, atoms = [];
  var pos = [];                                  // per-frame screen positions

  function seed() {
    var n = Math.max(10, Math.min(24, Math.round(W * H / 85000)));
    atoms = []; pos = [];
    for (var i = 0; i < n; i++) {
      var depth = 0.4 + Math.random() * 0.6;     // 0.4 far … 1.0 near
      atoms.push({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 9,           // px/s — slow drift
        vy: (Math.random() - 0.5) * 7,
        depth: depth,
        r: 1.3 + depth * 1.3,                    // nucleus radius
        two: Math.random() < 0.22,               // a few two-electron atoms
        orx: (9 + Math.random() * 9) * depth,    // orbit semi-axes
        ory: (3.5 + Math.random() * 4) * depth,
        tilt: Math.random() * Math.PI,
        ph: Math.random() * 6.2832,
        spd: (0.55 + Math.random() * 0.85) * (Math.random() < 0.5 ? -1 : 1),
        tw: Math.random() * 6.2832               // twinkle phase
      });
      pos.push({ x: 0, y: 0 });
    }
  }

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    c.width = W * dpr; c.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }
  var rto;
  window.addEventListener("resize", function () { clearTimeout(rto); rto = setTimeout(resize, 160); });
  resize();

  /* occasional emission pulse */
  var pulse = null, nextPulse = 4 + Math.random() * 6;

  function drawAtom(a, p, t) {
    var d = a.depth;
    var flick = 1 + 0.18 * Math.sin(t * 0.8 + a.tw);
    // orbit path
    ctx.strokeStyle = INK + (0.05 * d).toFixed(3) + ")";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, a.orx, a.ory, a.tilt, 0, 6.2832);
    ctx.stroke();
    if (a.two) {
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, a.orx * 0.8, a.ory * 1.5, a.tilt + 1.25, 0, 6.2832);
      ctx.stroke();
    }
    // nucleus
    ctx.beginPath(); ctx.arc(p.x, p.y, a.r, 0, 6.2832);
    ctx.fillStyle = INK + (0.24 * d * flick).toFixed(3) + ")";
    ctx.fill();
    // electron(s)
    var th = a.ph + t * a.spd * 1.9;
    var ex = Math.cos(th) * a.orx, ey = Math.sin(th) * a.ory;
    var ct = Math.cos(a.tilt), st = Math.sin(a.tilt);
    var e1x = p.x + ex * ct - ey * st, e1y = p.y + ex * st + ey * ct;
    ctx.beginPath(); ctx.arc(e1x, e1y, 2.6, 0, 6.2832);
    ctx.fillStyle = ACC + (0.07 * d).toFixed(3) + ")"; ctx.fill();   // halo
    ctx.beginPath(); ctx.arc(e1x, e1y, 1.05, 0, 6.2832);
    ctx.fillStyle = ACC + (0.5 * d).toFixed(3) + ")"; ctx.fill();
    if (a.two) {
      var th2 = -a.ph - t * a.spd * 1.5;
      var fx = Math.cos(th2) * a.orx * 0.8, fy = Math.sin(th2) * a.ory * 1.5;
      var ct2 = Math.cos(a.tilt + 1.25), st2 = Math.sin(a.tilt + 1.25);
      var e2x = p.x + fx * ct2 - fy * st2, e2y = p.y + fx * st2 + fy * ct2;
      ctx.beginPath(); ctx.arc(e2x, e2y, 1.05, 0, 6.2832);
      ctx.fillStyle = ACC + (0.4 * d).toFixed(3) + ")"; ctx.fill();
    }
  }

  var last = performance.now();
  function frame(now) {
    var t = now / 1000;
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    ctx.clearRect(0, 0, W, H);
    var sy = window.scrollY;

    var i, j, a;
    // integrate drift + compute parallaxed screen positions (wrapped)
    for (i = 0; i < atoms.length; i++) {
      a = atoms[i];
      a.x += a.vx * dt; a.y += a.vy * dt;
      if (a.x < -40) a.x += W + 80; else if (a.x > W + 40) a.x -= W + 80;
      if (a.y < -40) a.y += H + 80; else if (a.y > H + 40) a.y -= H + 80;
      pos[i].x = a.x;
      pos[i].y = ((a.y - sy * 0.07 * a.depth) % (H + 80) + (H + 80)) % (H + 80) - 40;
    }

    // proximity links — faint, molecular
    ctx.lineWidth = 1;
    var LINK = 150;
    for (i = 0; i < atoms.length; i++) {
      for (j = i + 1; j < atoms.length; j++) {
        var dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
        var d2 = dx * dx + dy * dy;
        if (d2 < LINK * LINK) {
          var al = 0.05 * (1 - Math.sqrt(d2) / LINK) * Math.min(atoms[i].depth, atoms[j].depth);
          ctx.strokeStyle = INK + al.toFixed(3) + ")";
          ctx.beginPath(); ctx.moveTo(pos[i].x, pos[i].y); ctx.lineTo(pos[j].x, pos[j].y); ctx.stroke();
        }
      }
    }

    // atoms
    for (i = 0; i < atoms.length; i++) drawAtom(atoms[i], pos[i], t);

    // emission pulse — one soft expanding ring every so often
    nextPulse -= dt;
    if (nextPulse <= 0 && !pulse) {
      pulse = { i: Math.floor(Math.random() * atoms.length), age: 0 };
      nextPulse = 6 + Math.random() * 7;
    }
    if (pulse) {
      pulse.age += dt;
      var pr = pulse.age / 1.3;
      if (pr >= 1) pulse = null;
      else {
        var pp = pos[pulse.i];
        ctx.beginPath(); ctx.arc(pp.x, pp.y, 6 + pr * 42, 0, 6.2832);
        ctx.strokeStyle = ACC + (0.16 * (1 - pr)).toFixed(3) + ")";
        ctx.stroke();
      }
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
