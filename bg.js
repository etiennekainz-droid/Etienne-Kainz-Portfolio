/* ============================================================
   Ambient background — drifting hydrogen atoms, Bohr edition.
   Fixed full-viewport canvas behind all content:
   · nuclei with orbiting electrons (a few two-electron atoms)
   · faint proximity bonds; photon sparks travel along them
   · Bohr excitation: electrons jump to n=2 orbit, decay back
     and emit an expanding photon ring — can chain to neighbours
   · cursor proximity excites and gently repels nearby atoms
   · slow drift, scroll parallax by depth
   Low opacity by design; skipped under reduced motion.
   ============================================================ */
(function () {
  "use strict";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var INK = "rgba(200,214,226,", ACC = "rgba(147,180,205,", AMB = "rgba(207,160,104,";

  var c = document.createElement("canvas");
  c.className = "atom-bg";
  c.setAttribute("aria-hidden", "true");
  document.body.insertBefore(c, document.body.firstChild);
  var ctx = c.getContext("2d");
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0, atoms = [], pos = [];

  function seed() {
    var n = Math.max(12, Math.min(32, Math.round(W * H / 60000)));
    atoms = []; pos = [];
    for (var i = 0; i < n; i++) {
      var depth = 0.4 + Math.random() * 0.6;
      atoms.push({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 8,
        depth: depth,
        r: 1.3 + depth * 1.3,
        two: Math.random() < 0.22,
        orx: (9 + Math.random() * 9) * depth,
        ory: (3.5 + Math.random() * 4) * depth,
        tilt: Math.random() * Math.PI,
        ph: Math.random() * 6.2832,
        spd: (0.55 + Math.random() * 0.85) * (Math.random() < 0.5 ? -1 : 1),
        tw: Math.random() * 6.2832,
        exc: 0, excT: 0, decayAt: 0            // Bohr excitation state
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

  /* pointer */
  var mx = -9999, my = -9999;
  window.addEventListener("pointermove", function (e) { mx = e.clientX; my = e.clientY; }, { passive: true });
  window.addEventListener("pointerleave", function () { mx = -9999; my = -9999; });

  /* events: rings (photon emissions) + sparks (photons along bonds) */
  var rings = [], sparks = [];
  var nextExc = 3 + Math.random() * 4;

  function excite(i, now, chain) {
    var a = atoms[i];
    if (a.excT === 1) return;
    a.excT = 1;
    a.decayAt = now + 0.9 + Math.random() * 1.3;
    a.chain = chain || 0;
  }

  function drawAtom(a, p, t, boost) {
    var d = a.depth;
    var flick = 1 + 0.18 * Math.sin(t * 0.8 + a.tw) + 0.5 * a.exc;
    var orx = a.orx * (1 + 0.75 * a.exc), ory = a.ory * (1 + 0.75 * a.exc);
    var lift = 1 + boost;                       // cursor proximity boost

    ctx.strokeStyle = INK + Math.min(0.16, 0.05 * d * lift + 0.05 * a.exc).toFixed(3) + ")";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(p.x, p.y, orx, ory, a.tilt, 0, 6.2832); ctx.stroke();
    if (a.two) {
      ctx.beginPath(); ctx.ellipse(p.x, p.y, orx * 0.8, ory * 1.5, a.tilt + 1.25, 0, 6.2832); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(p.x, p.y, a.r * (1 + 0.3 * a.exc), 0, 6.2832);
    ctx.fillStyle = INK + Math.min(0.6, 0.24 * d * flick * lift).toFixed(3) + ")";
    ctx.fill();

    var wobble = 1 + 0.4 * a.exc * Math.sin(t * 9 + a.tw);   // excited orbit shimmer
    var th = a.ph + t * a.spd * (1.9 + 1.3 * a.exc + 1.2 * boost);
    var ex = Math.cos(th) * orx * wobble, ey = Math.sin(th) * ory * wobble;
    var ct = Math.cos(a.tilt), st = Math.sin(a.tilt);
    var e1x = p.x + ex * ct - ey * st, e1y = p.y + ex * st + ey * ct;
    ctx.beginPath(); ctx.arc(e1x, e1y, 2.6 + 1.6 * a.exc, 0, 6.2832);
    ctx.fillStyle = ACC + Math.min(0.3, 0.07 * d * lift + 0.12 * a.exc).toFixed(3) + ")"; ctx.fill();
    ctx.beginPath(); ctx.arc(e1x, e1y, 1.05 + 0.5 * a.exc, 0, 6.2832);
    ctx.fillStyle = ACC + Math.min(0.95, 0.5 * d * lift + 0.35 * a.exc).toFixed(3) + ")"; ctx.fill();
    if (a.two) {
      var th2 = -a.ph - t * a.spd * 1.5;
      var fx = Math.cos(th2) * orx * 0.8, fy = Math.sin(th2) * ory * 1.5;
      var ct2 = Math.cos(a.tilt + 1.25), st2 = Math.sin(a.tilt + 1.25);
      var e2x = p.x + fx * ct2 - fy * st2, e2y = p.y + fx * st2 + fy * ct2;
      ctx.beginPath(); ctx.arc(e2x, e2y, 1.05, 0, 6.2832);
      ctx.fillStyle = ACC + (0.4 * d * lift).toFixed(3) + ")"; ctx.fill();
    }
  }

  var last = performance.now();
  function frame(nowMs) {
    var t = nowMs / 1000;
    var dt = Math.min(0.05, (nowMs - last) / 1000); last = nowMs;
    ctx.clearRect(0, 0, W, H);
    var sy = window.scrollY;

    var i, j, a;
    for (i = 0; i < atoms.length; i++) {
      a = atoms[i];
      a.x += a.vx * dt; a.y += a.vy * dt;
      if (a.x < -40) a.x += W + 80; else if (a.x > W + 40) a.x -= W + 80;
      if (a.y < -40) a.y += H + 80; else if (a.y > H + 40) a.y -= H + 80;
      pos[i].x = a.x;
      pos[i].y = ((a.y - sy * 0.07 * a.depth) % (H + 80) + (H + 80)) % (H + 80) - 40;

      /* cursor: gentle repulsion */
      var ddx = pos[i].x - mx, ddy = pos[i].y - my;
      var dd = Math.sqrt(ddx * ddx + ddy * ddy);
      if (dd < 240 && dd > 1) {
        var push = (1 - dd / 240) * 22 * dt;
        a.x += ddx / dd * push; a.y += ddy / dd * push;
      }

      /* Bohr decay: fall back to ground state, emit photon */
      if (a.excT === 1 && t > a.decayAt) {
        a.excT = 0;
        rings.push({ x: pos[i].x, y: pos[i].y, age: 0, i: i });
        /* photon hop to a nearby atom — possible chain */
        if ((a.chain || 0) < 2) {
          var best = -1, bd = 210 * 210;
          for (j = 0; j < atoms.length; j++) {
            if (j === i || atoms[j].excT === 1) continue;
            var qx = pos[j].x - pos[i].x, qy = pos[j].y - pos[i].y;
            var q2 = qx * qx + qy * qy;
            if (q2 < bd) { bd = q2; best = j; }
          }
          if (best >= 0 && Math.random() < 0.55) {
            sparks.push({ from: i, to: best, age: 0, dur: 0.55, chain: (a.chain || 0) + 1 });
          }
        }
      }
      a.exc += (a.excT - a.exc) * Math.min(1, dt * 5);
    }

    /* scheduler: spontaneous excitation */
    nextExc -= dt;
    if (nextExc <= 0) {
      excite(Math.floor(Math.random() * atoms.length), t, 0);
      nextExc = 3 + Math.random() * 4.5;
    }

    /* proximity bonds */
    ctx.lineWidth = 1;
    var LINK = 165;
    for (i = 0; i < atoms.length; i++) {
      for (j = i + 1; j < atoms.length; j++) {
        var dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
        var d2 = dx * dx + dy * dy;
        if (d2 < LINK * LINK) {
          var al = 0.08 * (1 - Math.sqrt(d2) / LINK) * Math.min(atoms[i].depth, atoms[j].depth)
                 * (1 + 1.5 * Math.max(atoms[i].exc, atoms[j].exc));
          ctx.strokeStyle = INK + al.toFixed(3) + ")";
          ctx.beginPath(); ctx.moveTo(pos[i].x, pos[i].y); ctx.lineTo(pos[j].x, pos[j].y); ctx.stroke();
        }
      }
    }

    /* atoms with cursor boost */
    for (i = 0; i < atoms.length; i++) {
      var bdx = pos[i].x - mx, bdy = pos[i].y - my;
      var bdd = Math.sqrt(bdx * bdx + bdy * bdy);
      var boost = bdd < 260 ? (1 - bdd / 260) : 0;
      drawAtom(atoms[i], pos[i], t, boost);
    }

    /* photon sparks along bonds */
    for (i = sparks.length - 1; i >= 0; i--) {
      var s = sparks[i];
      s.age += dt;
      var q = s.age / s.dur;
      if (q >= 1) {
        excite(s.to, t, s.chain);
        sparks.splice(i, 1);
        continue;
      }
      var fx2 = pos[s.from].x + (pos[s.to].x - pos[s.from].x) * q;
      var fy2 = pos[s.from].y + (pos[s.to].y - pos[s.from].y) * q;
      ctx.beginPath(); ctx.arc(fx2, fy2, 3.2, 0, 6.2832);
      ctx.fillStyle = AMB + "0.14)"; ctx.fill();
      ctx.beginPath(); ctx.arc(fx2, fy2, 1.3, 0, 6.2832);
      ctx.fillStyle = AMB + "0.8)"; ctx.fill();
    }

    /* emission rings */
    for (i = rings.length - 1; i >= 0; i--) {
      var rg = rings[i];
      rg.age += dt;
      var pr = rg.age / 1.25;
      if (pr >= 1) { rings.splice(i, 1); continue; }
      ctx.beginPath(); ctx.arc(pos[rg.i].x, pos[rg.i].y, 6 + pr * 46, 0, 6.2832);
      ctx.strokeStyle = ACC + (0.2 * (1 - pr)).toFixed(3) + ")";
      ctx.stroke();
      ctx.beginPath(); ctx.arc(pos[rg.i].x, pos[rg.i].y, 6 + pr * 30, 0, 6.2832);
      ctx.strokeStyle = ACC + (0.1 * (1 - pr)).toFixed(3) + ")";
      ctx.stroke();
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
