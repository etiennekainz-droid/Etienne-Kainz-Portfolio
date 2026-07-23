(function () {
  "use strict";

  var canvas = document.getElementById("latticeCanvas");
  var stage = document.getElementById("elasticWaveStudy");
  if (!canvas || !stage) return;

  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var compact = window.matchMedia("(max-width: 760px)").matches;
  var statusNode = document.getElementById("waveStatus");
  var strainNode = document.getElementById("waveStrain");
  var displacementNode = document.getElementById("waveDisplacement");
  var energyNode = document.getElementById("waveEnergy");
  var nodeCountNode = document.getElementById("waveNodes");
  var pauseButton = document.getElementById("wavePause");

  var INK = "rgba(0,0,0,";
  var width = 1;
  var height = 1;
  var dpr = 1;
  var pageVisible = document.visibilityState !== "hidden";
  var onscreen = false;
  var userPaused = false;
  var raf = 0;
  var clock = reducedMotion ? 2.4 : 0;
  var lastFrame = 0;
  var lastHud = 0;
  var pointerPulse = { x: 0, born: -10, strength: 0 };
  var targetView = { x: 0, y: 0 };
  var view = { x: 0, y: 0 };

  var NX = compact ? 11 : 15;
  var NY = compact ? 5 : 6;
  var NZ = compact ? 4 : 5;
  var SPACING = compact ? 50 : 46;
  var atoms = [];
  var bonds = [];
  var projections = [];
  var motions = [];
  var order = [];
  var span = (NX - 1) * SPACING;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function buildLattice() {
    var i;
    var j;
    var k;
    function index(x, y, z) {
      return (x * NY + y) * NZ + z;
    }

    for (i = 0; i < NX; i += 1) {
      for (j = 0; j < NY; j += 1) {
        for (k = 0; k < NZ; k += 1) {
          atoms.push({
            x: (i - (NX - 1) / 2) * SPACING,
            y: (j - (NY - 1) / 2) * SPACING,
            z: (k - (NZ - 1) / 2) * SPACING
          });
          projections.push({ x: 0, y: 0, z: 0, scale: 0 });
          motions.push({ x: 0, y: 0, z: 0, energy: 0, p: 0, s: 0, r: 0 });
          order.push(atoms.length - 1);
        }
      }
    }

    for (i = 0; i < NX; i += 1) {
      for (j = 0; j < NY; j += 1) {
        for (k = 0; k < NZ; k += 1) {
          var here = index(i, j, k);
          if (i + 1 < NX) bonds.push({ a: here, b: index(i + 1, j, k), rest: SPACING });
          if (j + 1 < NY) bonds.push({ a: here, b: index(i, j + 1, k), rest: SPACING });
          if (k + 1 < NZ) bonds.push({ a: here, b: index(i, j, k + 1), rest: SPACING });
        }
      }
    }
  }

  buildLattice();
  if (nodeCountNode) nodeCountNode.textContent = String(atoms.length).padStart(3, "0");

  function resize() {
    var bounds = canvas.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    dpr = Math.min(window.devicePixelRatio || 1, compact ? 1.35 : 1.8);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(clock);
  }

  function pulseAt(x, time, speed, phase, packetWidth, frequency, direction) {
    var pad = 230;
    var cycle = span + pad * 2;
    var travel = (time * speed + phase) % cycle;
    var centre = direction * (travel - pad - span / 2);
    var delta = x - centre;
    var envelope = Math.exp(-(delta * delta) / (2 * packetWidth * packetWidth));
    return envelope * Math.sin(delta * frequency - time * speed * frequency * 0.46);
  }

  function displacement(atom, time) {
    var p = pulseAt(atom.x, time, 168, 0, 66, 0.052, 1);
    var s = pulseAt(atom.x, time, 111, 226, 84, 0.041, 1);
    var reflection = pulseAt(atom.x, time, 131, 420, 74, 0.048, -1);
    var transverse = Math.cos(atom.z * 0.035) * (0.72 + 0.28 * Math.cos(atom.y * 0.048));
    var age = time - pointerPulse.born;
    var local = 0;

    if (age > 0 && age < 1.55) {
      var distance = Math.abs(atom.x - pointerPulse.x);
      var ring = distance - age * 205;
      local = Math.exp(-(ring * ring) / 2300) * Math.sin(ring * 0.065) *
        pointerPulse.strength * Math.exp(-age * 1.7);
    }

    var dx = 12.5 * p - 5.4 * reflection + local * 8;
    var dy = (6.9 * s + 2.2 * reflection) * transverse + local * 3.2;
    var dz = 4.9 * s * Math.sin(atom.y * 0.055 + 0.8) - 2.5 * reflection;
    var energy = Math.min(1, Math.abs(p) * 0.83 + Math.abs(s) * 0.58 +
      Math.abs(reflection) * 0.34 + Math.abs(local) * 0.5);

    return { x: dx, y: dy, z: dz, energy: energy, p: p, s: s, r: reflection };
  }

  function project(point, sinYaw, cosYaw, sinPitch, cosPitch, out) {
    var rotatedX = point.x * cosYaw + point.z * sinYaw;
    var rotatedZ = -point.x * sinYaw + point.z * cosYaw;
    var rotatedY = point.y * cosPitch - rotatedZ * sinPitch;
    rotatedZ = point.y * sinPitch + rotatedZ * cosPitch;

    var cameraZ = compact ? 710 : 595;
    var perspective = compact ? 840 : 780;
    var depth = rotatedZ + cameraZ;
    var fit = Math.min(1, Math.max(0.32, (width - 36) / (compact ? 720 : 900)));
    var scale = perspective / depth * fit;

    out.x = width / 2 + rotatedX * scale;
    out.y = height / 2 + rotatedY * scale;
    out.z = depth;
    out.scale = scale;
  }

  function drawGrid(time) {
    var shift = (time * 12) % 36;
    var x;
    var y;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = INK + "0.035)";
    for (x = 18 + shift; x < width - 16; x += 36) {
      ctx.beginPath();
      ctx.moveTo(x, 14);
      ctx.lineTo(x, height - 18);
      ctx.stroke();
    }
    for (y = 18; y < height - 15; y += 36) {
      ctx.beginPath();
      ctx.moveTo(16, y);
      ctx.lineTo(width - 16, y);
      ctx.stroke();
    }
    ctx.strokeStyle = INK + "0.16)";
    ctx.beginPath();
    ctx.moveTo(16, height - 18);
    ctx.lineTo(width - 16, height - 18);
    ctx.stroke();
    ctx.restore();
  }

  function drawWaveMonitor(time) {
    var x0 = 18;
    var y0 = height - 54;
    var monitorWidth = Math.min(240, width * 0.4);
    var i;

    ctx.save();
    ctx.strokeStyle = INK + "0.22)";
    ctx.strokeRect(x0, y0, monitorWidth, 22);
    ctx.font = "8px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.fillStyle = INK + "0.52)";
    ctx.fillText(width < 520 ? "P/S ENVELOPE" : "COUPLED-MODE ENVELOPE", x0 + 5, y0 - 7);
    ctx.beginPath();
    for (i = 0; i <= 90; i += 1) {
      var q = i / 90;
      var virtualX = (q - 0.5) * span;
      var p = pulseAt(virtualX, time, 168, 0, 66, 0.052, 1);
      var s = pulseAt(virtualX, time, 111, 226, 84, 0.041, 1);
      var yy = y0 + 11 - (p * 6.4 + s * 3.5);
      if (i === 0) ctx.moveTo(x0 + q * monitorWidth, yy);
      else ctx.lineTo(x0 + q * monitorWidth, yy);
    }
    ctx.strokeStyle = INK + "0.78)";
    ctx.stroke();
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    for (i = 0; i <= 90; i += 1) {
      var qq = i / 90;
      var sampleX = (qq - 0.5) * span;
      var sampleS = pulseAt(sampleX, time, 111, 226, 84, 0.041, 1);
      var sampleY = y0 + 11 - sampleS * 5.3;
      if (i === 0) ctx.moveTo(x0 + qq * monitorWidth, sampleY);
      else ctx.lineTo(x0 + qq * monitorWidth, sampleY);
    }
    ctx.strokeStyle = INK + "0.42)";
    ctx.stroke();
    ctx.restore();
  }

  function drawTriad(sinYaw, cosYaw, sinPitch, cosPitch) {
    if (width < 560) return;
    var originX = width - 62;
    var originY = height - 44;
    var length = 22;
    var axes = [
      { x: 1, y: 0, z: 0, label: "x" },
      { x: 0, y: -1, z: 0, label: "y" },
      { x: 0, y: 0, z: 1, label: "z" }
    ];

    ctx.save();
    ctx.font = "9px 'IBM Plex Mono', ui-monospace, monospace";
    axes.forEach(function (axis, index) {
      var xx = axis.x * cosYaw + axis.z * sinYaw;
      var zz = -axis.x * sinYaw + axis.z * cosYaw;
      var yy = axis.y * cosPitch - zz * sinPitch;
      ctx.setLineDash(index === 1 ? [2, 2] : []);
      ctx.strokeStyle = INK + (index === 2 ? "0.42)" : "0.68)");
      ctx.beginPath();
      ctx.moveTo(originX, originY);
      ctx.lineTo(originX + xx * length, originY + yy * length);
      ctx.stroke();
      ctx.fillStyle = INK + "0.72)";
      ctx.fillText(axis.label, originX + xx * (length + 8) - 2, originY + yy * (length + 8) + 3);
    });
    ctx.restore();
  }

  function updateHud(metrics, now) {
    if (now - lastHud < 110 && !reducedMotion) return;
    lastHud = now;
    if (strainNode) strainNode.textContent = (metrics.strain * 0.08).toFixed(4);
    if (displacementNode) displacementNode.textContent = metrics.displacement.toFixed(1) + " a.u.";
    if (energyNode) energyNode.textContent = String(Math.round(metrics.energy * 100)).padStart(2, "0") + "%";
    if (statusNode) {
      statusNode.textContent = metrics.energy > 0.28 ? "PACKET TRANSIT / LIVE" : "COUPLED MODES / LIVE";
    }
  }

  function draw(time, now) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    drawGrid(time);

    view.x += (targetView.x - view.x) * 0.055;
    view.y += (targetView.y - view.y) * 0.055;
    var yaw = time * 0.105 + view.x * 0.84;
    var pitch = -0.31 + view.y * 0.36;
    var sinYaw = Math.sin(yaw);
    var cosYaw = Math.cos(yaw);
    var sinPitch = Math.sin(pitch);
    var cosPitch = Math.cos(pitch);
    var metrics = { strain: 0, displacement: 0, energy: 0 };
    var i;

    for (i = 0; i < atoms.length; i += 1) {
      var atom = atoms[i];
      var motion = displacement(atom, time);
      motions[i] = motion;
      project({
        x: atom.x + motion.x,
        y: atom.y + motion.y,
        z: atom.z + motion.z
      }, sinYaw, cosYaw, sinPitch, cosPitch, projections[i]);
      metrics.energy += motion.energy;
      metrics.displacement = Math.max(metrics.displacement,
        Math.sqrt(motion.x * motion.x + motion.y * motion.y + motion.z * motion.z));
    }
    metrics.energy /= atoms.length;

    ctx.save();
    for (i = 0; i < bonds.length; i += 1) {
      var bond = bonds[i];
      var one = projections[bond.a];
      var two = projections[bond.b];
      var oneMotion = motions[bond.a];
      var twoMotion = motions[bond.b];
      var restX = atoms[bond.b].x - atoms[bond.a].x;
      var restY = atoms[bond.b].y - atoms[bond.a].y;
      var restZ = atoms[bond.b].z - atoms[bond.a].z;
      var currentX = restX + twoMotion.x - oneMotion.x;
      var currentY = restY + twoMotion.y - oneMotion.y;
      var currentZ = restZ + twoMotion.z - oneMotion.z;
      var currentLength = Math.sqrt(currentX * currentX + currentY * currentY + currentZ * currentZ);
      var signedStrain = (currentLength - bond.rest) / bond.rest;
      var strain = Math.abs(signedStrain);
      var near = clamp((1180 - (one.z + two.z) * 0.5) / 800, 0, 1);
      metrics.strain = Math.max(metrics.strain, strain);

      ctx.setLineDash(signedStrain < -0.012 ? [2.5, 2.5] : []);
      ctx.strokeStyle = INK + clamp(0.035 + near * 0.23 + strain * 3.1, 0.04, 0.82) + ")";
      ctx.lineWidth = 0.55 + near * 0.65 + strain * 2.4;
      ctx.beginPath();
      ctx.moveTo(one.x, one.y);
      ctx.lineTo(two.x, two.y);
      ctx.stroke();
    }
    ctx.restore();

    order.sort(function (left, right) {
      return projections[right].z - projections[left].z;
    });

    for (i = 0; i < order.length; i += 1) {
      var id = order[i];
      var point = projections[id];
      var excitation = motions[id].energy;
      var depth = clamp((1190 - point.z) / 800, 0, 1);
      var radius = (1.05 + excitation * 1.38) * point.scale * 1.55;

      if (excitation > 0.2) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius * (2.2 + excitation), 0, Math.PI * 2);
        ctx.fillStyle = INK + (0.025 + excitation * 0.07) * depth + ")";
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = INK + clamp(0.15 + depth * 0.62 + excitation * 0.18, 0.12, 0.94) + ")";
      ctx.fill();
    }

    drawWaveMonitor(time);
    drawTriad(sinYaw, cosYaw, sinPitch, cosPitch);
    updateHud(metrics, now || performance.now());
  }

  function active() {
    return onscreen && pageVisible && !userPaused && !reducedMotion;
  }

  function requestFrame() {
    if (!raf && active()) raf = requestAnimationFrame(loop);
  }

  function loop(now) {
    raf = 0;
    if (!active()) {
      lastFrame = 0;
      return;
    }

    if (compact && lastFrame && now - lastFrame < 28) {
      requestFrame();
      return;
    }

    if (lastFrame) clock += Math.min(0.05, Math.max(0, now - lastFrame) / 1000);
    lastFrame = now;
    draw(clock, now);
    requestFrame();
  }

  function setOnscreen(value) {
    onscreen = value;
    document.body.classList.toggle("wave-active", value);
    if (value) {
      draw(clock);
      requestFrame();
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      lastFrame = 0;
    }
  }

  function steer(event) {
    if (reducedMotion) return;
    var bounds = canvas.getBoundingClientRect();
    targetView.x = clamp((event.clientX - bounds.left) / bounds.width - 0.5, -0.5, 0.5);
    targetView.y = clamp((event.clientY - bounds.top) / bounds.height - 0.5, -0.5, 0.5);
  }

  function excite(event) {
    if (reducedMotion) return;
    var bounds = canvas.getBoundingClientRect();
    var normalized = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    pointerPulse.x = (normalized - 0.5) * span;
    pointerPulse.born = clock;
    pointerPulse.strength = event.pointerType === "touch" ? 0.72 : 0.48;
  }

  canvas.addEventListener("pointermove", steer, { passive: true });
  canvas.addEventListener("pointerdown", excite, { passive: true });
  canvas.addEventListener("pointerleave", function () {
    targetView.x = 0;
    targetView.y = 0;
  });
  canvas.addEventListener("keydown", function (event) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight" ||
        event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      if (event.key === "ArrowLeft") targetView.x = clamp(targetView.x - 0.12, -0.5, 0.5);
      if (event.key === "ArrowRight") targetView.x = clamp(targetView.x + 0.12, -0.5, 0.5);
      if (event.key === "ArrowUp") targetView.y = clamp(targetView.y - 0.12, -0.5, 0.5);
      if (event.key === "ArrowDown") targetView.y = clamp(targetView.y + 0.12, -0.5, 0.5);
    }
    if ((event.key === "Enter" || event.key === " ") && !reducedMotion) {
      event.preventDefault();
      pointerPulse.x = 0;
      pointerPulse.born = clock;
      pointerPulse.strength = 0.72;
    }
  });

  if (pauseButton) {
    if (reducedMotion) {
      pauseButton.hidden = true;
    } else {
      pauseButton.addEventListener("click", function () {
        userPaused = !userPaused;
        pauseButton.setAttribute("aria-pressed", String(userPaused));
        pauseButton.textContent = userPaused ? "RESUME FIELD" : "PAUSE FIELD";
        if (statusNode) statusNode.textContent = userPaused ? "FIELD HOLD / PAUSED" : "COUPLED MODES / LIVE";
        if (userPaused) {
          if (raf) cancelAnimationFrame(raf);
          raf = 0;
          lastFrame = 0;
          draw(clock);
        } else {
          requestFrame();
        }
      });
    }
  }

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        setOnscreen(entry.isIntersecting && entry.intersectionRatio > 0.03);
      });
    }, { threshold: [0, 0.04, 0.2] }).observe(stage);
  } else {
    setOnscreen(true);
  }

  document.addEventListener("visibilitychange", function () {
    pageVisible = document.visibilityState !== "hidden";
    if (pageVisible) requestFrame();
    else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      lastFrame = 0;
    }
  });

  var resizeTimer = 0;
  function scheduleResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 90);
  }

  window.addEventListener("resize", scheduleResize, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scheduleResize, { passive: true });
  }
  if ("ResizeObserver" in window) {
    new ResizeObserver(scheduleResize).observe(stage);
  }

  resize();
  if (reducedMotion) draw(clock);
})();
