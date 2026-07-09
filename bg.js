/* ============================================================
   Ambient atom field
   A deliberately restrained technical background: it suggests a
   small quantum / molecular laboratory without competing with the
   portfolio itself. Everything is canvas-only and capped for calm,
   battery-friendly rendering.
   ============================================================ */
(function () {
  "use strict";

  function boot() {
    if (!document.body || document.querySelector("canvas.atom-bg")) return;

    var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var canvas = document.createElement("canvas");
    canvas.className = "atom-bg";
    canvas.setAttribute("aria-hidden", "true");
    document.body.insertBefore(canvas, document.body.firstChild);

    var ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    var dpr = 1;
    var W = 0;
    var H = 0;
    var atoms = [];
    var positions = [];
    var photons = [];
    var ionizations = [];
    var molecules = [];
    var collisions = [];
    var energyWaves = [];
    var pulse = null;
    var pointer = { x: 0.5, y: 0.5 };
    var pageVisible = document.visibilityState !== "hidden";
    var raf = 0;
    var last = performance.now();
    var transitionClock = 0.45 + Math.random() * 0.8;
    var moleculeClock = 1.4 + Math.random() * 1.7;
    var collisionClock = 0.72 + Math.random() * 1.1;
    var excitationClock = 1.8 + Math.random() * 2.2;
    var pulseClock = 3.1 + Math.random() * 2.7;
    var resizeTimer = 0;

    var MAX_PHOTONS = 26;
    var MAX_IONIZATIONS = 6;
    var MAX_MOLECULES = 7;
    var MAX_COLLISIONS = 8;
    var MAX_ENERGY_WAVES = 15;

    var ink = [214, 226, 235];
    var blue = [128, 190, 224];
    var cyan = [129, 213, 232];
    var amber = [221, 172, 102];

    function rgba(rgb, alpha) {
      return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + Math.max(0, alpha).toFixed(3) + ")";
    }

    function rand(min, max) {
      return min + Math.random() * (max - min);
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function smoothstep(value) {
      return value * value * (3 - value * 2);
    }

    function makeElectron(atom, index) {
      return {
        shell: index % atom.shells,
        angle: rand(0, Math.PI * 2),
        speed: rand(0.72, 1.42) * (Math.random() < 0.5 ? -1 : 1),
        hue: index >= atom.electronCount - 2 && atom.shells >= 3 ? amber : blue,
        trail: [],
        trailClock: rand(0, 0.04),
        transition: null,
        ionized: false
      };
    }

    function seed() {
      var desired = Math.max(15, Math.min(30, Math.round(W * H / 70000)));
      atoms = [];
      positions = [];
      photons = [];
      ionizations = [];
      molecules = [];
      collisions = [];
      energyWaves = [];
      pulse = null;

      for (var index = 0; index < desired; index += 1) {
        var depth = rand(0.31, 1);
        var isHeavy = index === Math.floor(desired * 0.38) || Math.random() < 0.035;
        var shells = isHeavy ? 4 : (Math.random() < 0.18 ? 3 : (Math.random() < 0.43 ? 2 : 1));
        var atom = {
          x: rand(-80, W + 80),
          y: rand(-80, H + 80),
          vx: rand(-7.5, 7.5) * (0.42 + depth * 0.58),
          vy: rand(-5.8, 5.8) * (0.42 + depth * 0.58),
          depth: depth,
          r: (1.05 + depth * 2.1) * (isHeavy ? rand(1.58, 2.05) : 1),
          shells: shells,
          electronCount: isHeavy ? 5 + Math.floor(Math.random() * 3) : (shells === 3 ? 3 : (shells === 2 ? 2 : 1)),
          orbitX: rand(10, 19) * depth * (isHeavy ? 1.45 : 1),
          orbitY: rand(3.4, 8.4) * depth * (isHeavy ? 1.36 : 1),
          tilt: rand(0, Math.PI),
          field: rand(0, Math.PI * 2),
          flicker: rand(0, Math.PI * 2),
          heavy: isHeavy,
          excitation: null,
          ionizedCount: 0,
          electrons: []
        };
        for (var electron = 0; electron < atom.electronCount; electron += 1) {
          atom.electrons.push(makeElectron(atom, electron));
        }
        atoms.push(atom);
        positions.push({ x: 0, y: 0 });
      }
    }

    function resize() {
      W = Math.max(1, window.innerWidth);
      H = Math.max(1, window.innerHeight);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
      if (reducedMotion) {
        updateAtoms(0, 0);
        drawScene(0, 0);
      }
    }

    function orbitalPoint(atom, shell, angle) {
      var rx = atom.orbitX * (1 + shell * 0.42);
      var ry = atom.orbitY * (1 + shell * 0.28);
      var x = Math.cos(angle) * rx;
      var y = Math.sin(angle) * ry;
      var tilt = atom.tilt + shell * 0.78;
      var ct = Math.cos(tilt);
      var st = Math.sin(tilt);
      return { x: x * ct - y * st, y: x * st + y * ct };
    }

    function electronPoint(atom, electron) {
      if (!electron.transition) return orbitalPoint(atom, electron.shell, electron.angle);
      var transition = electron.transition;
      var mix = smoothstep(clamp(transition.age / transition.life, 0, 1));
      var from = orbitalPoint(atom, transition.from, electron.angle);
      var to = orbitalPoint(atom, transition.to, electron.angle + transition.kick * mix);
      return {
        x: from.x + (to.x - from.x) * mix,
        y: from.y + (to.y - from.y) * mix
      };
    }

    function addPhoton(x, y, dx, dy, colour, energy) {
      if (photons.length >= MAX_PHOTONS) photons.shift();
      var length = Math.sqrt(dx * dx + dy * dy) || 1;
      photons.push({
        x: x,
        y: y,
        vx: dx / length * (58 + energy * 46),
        vy: dy / length * (58 + energy * 46),
        age: 0,
        life: 0.65 + Math.random() * 0.55,
        colour: colour,
        energy: energy
      });
    }

    function releaseEnergy(x, y, strength, colour, large) {
      if (energyWaves.length >= MAX_ENERGY_WAVES) energyWaves.shift();
      energyWaves.push({
        x: x,
        y: y,
        age: 0,
        life: large ? rand(1.35, 1.8) : rand(0.88, 1.32),
        strength: strength,
        colour: colour || amber,
        radius: (large ? 102 : 66) + strength * (large ? 58 : 34),
        phase: rand(0, Math.PI * 2)
      });
    }

    function beginTransition() {
      var eligibleAtoms = atoms.filter(function (atom) {
        return atom.shells > 1 && atom.electrons.some(function (electron) {
          return !electron.ionized && !electron.transition;
        });
      });
      if (!eligibleAtoms.length) return;
      var atom = eligibleAtoms[Math.floor(Math.random() * eligibleAtoms.length)];
      var available = atom.electrons.filter(function (electron) {
        return !electron.ionized && !electron.transition;
      });
      if (!available.length) return;
      var electron = available[Math.floor(Math.random() * available.length)];
      var point = electronPoint(atom, electron);
      var absoluteX = positions[atoms.indexOf(atom)].x + point.x;
      var absoluteY = positions[atoms.indexOf(atom)].y + point.y;

      // Rare ionization: a free electron leaves, then a calm recombination returns it.
      if (Math.random() < 0.22 && atom.electronCount > 1 && ionizations.length < MAX_IONIZATIONS) {
        electron.ionized = true;
        atom.ionizedCount += 1;
        ionizations.push({
          atom: atom,
          electron: electron,
          x: absoluteX,
          y: absoluteY,
          vx: rand(-30, 30),
          vy: rand(-26, 26),
          age: 0,
          life: rand(2.1, 3.5),
          phase: rand(0, Math.PI * 2)
        });
        addPhoton(absoluteX, absoluteY, rand(-1, 1), rand(-1, 1), amber, 1.15);
        releaseEnergy(absoluteX, absoluteY, 1.05, amber, atom.heavy);
        return;
      }

      var from = electron.shell;
      var to;
      if (atom.shells === 1) {
        to = 0;
      } else if (from === 0) {
        to = 1;
      } else if (from === atom.shells - 1) {
        to = Math.random() < 0.72 ? from - 1 : 0;
      } else {
        to = Math.random() < 0.55 ? from + 1 : from - 1;
      }
      if (to === from) return;

      var outward = to > from;
      electron.transition = {
        from: from,
        to: to,
        age: 0,
        life: rand(0.42, 0.82),
        kick: rand(-0.72, 0.72),
        outward: outward,
        emitted: false
      };
      // Downward transitions release a short blue / amber photon packet.
      if (!outward) {
        var direction = Math.atan2(point.y, point.x) + rand(-0.55, 0.55);
        addPhoton(absoluteX, absoluteY, Math.cos(direction), Math.sin(direction), electron.hue, 0.8 + from * 0.28);
        releaseEnergy(absoluteX, absoluteY, 0.56 + from * 0.24, amber, atom.heavy && from >= 2);
        electron.transition.emitted = true;
      } else if (atom.heavy) {
        releaseEnergy(absoluteX, absoluteY, 0.3, cyan, false);
      }
    }

    function beginExcitation() {
      var candidates = atoms.filter(function (atom) {
        return !atom.excitation && atom.electrons.some(function (electron) { return !electron.ionized; });
      });
      if (!candidates.length) return;
      candidates.sort(function (a, b) {
        return (b.heavy ? 2 : b.depth) - (a.heavy ? 2 : a.depth);
      });
      var pool = candidates.slice(0, Math.min(5, candidates.length));
      var atom = pool[Math.floor(Math.random() * pool.length)];
      atom.excitation = {
        age: 0,
        life: rand(1.15, 2.05),
        phase: rand(0, Math.PI * 2),
        strength: atom.heavy ? rand(1.15, 1.5) : rand(0.66, 1.05)
      };
      var point = positions[atoms.indexOf(atom)];
      if (point) releaseEnergy(point.x, point.y, atom.excitation.strength * 0.38, cyan, false);
    }

    function beginMolecule() {
      if (molecules.length >= MAX_MOLECULES || atoms.length < 2) return;
      var candidates = [];
      for (var i = 0; i < atoms.length; i += 1) {
        for (var j = i + 1; j < atoms.length; j += 1) {
          var dx = positions[i].x - positions[j].x;
          var dy = positions[i].y - positions[j].y;
          var distance = Math.sqrt(dx * dx + dy * dy);
          if (distance > 55 && distance < 195 && Math.min(atoms[i].depth, atoms[j].depth) > 0.47) {
            candidates.push({ a: i, b: j, distance: distance });
          }
        }
      }
      if (!candidates.length) return;
      var choice = candidates[Math.floor(Math.random() * candidates.length)];
      molecules.push({
        a: choice.a,
        b: choice.b,
        age: 0,
        life: rand(2.8, 5.3),
        phase: rand(0, Math.PI * 2),
        type: Math.random() < 0.33 ? "exchange" : "bond"
      });
    }

    function beginCollision() {
      if (collisions.length >= MAX_COLLISIONS || atoms.length < 2) return;
      var candidates = [];
      for (var i = 0; i < atoms.length; i += 1) {
        for (var j = i + 1; j < atoms.length; j += 1) {
          var dx = positions[j].x - positions[i].x;
          var dy = positions[j].y - positions[i].y;
          var distance = Math.sqrt(dx * dx + dy * dy) || 1;
          if (distance > 18 && distance < 176 && Math.min(atoms[i].depth, atoms[j].depth) > 0.42) {
            candidates.push({ a: i, b: j, dx: dx, dy: dy, distance: distance });
          }
        }
      }
      if (!candidates.length) return;
      candidates.sort(function (a, b) { return a.distance - b.distance; });
      var choice = candidates[Math.floor(Math.random() * Math.min(8, candidates.length))];
      var a = atoms[choice.a];
      var b = atoms[choice.b];
      var nx = choice.dx / choice.distance;
      var ny = choice.dy / choice.distance;
      var impact = 8 + Math.min(a.depth, b.depth) * 9;
      a.vx -= nx * impact;
      a.vy -= ny * impact;
      b.vx += nx * impact;
      b.vy += ny * impact;

      var x = (positions[choice.a].x + positions[choice.b].x) * 0.5;
      var y = (positions[choice.a].y + positions[choice.b].y) * 0.5;
      var strength = (a.heavy || b.heavy ? 1.2 : 0.72) + Math.min(a.depth, b.depth) * 0.34;
      collisions.push({
        x: x,
        y: y,
        nx: nx,
        ny: ny,
        age: 0,
        life: rand(0.68, 1.08),
        strength: strength,
        phase: rand(0, Math.PI * 2)
      });
      addPhoton(x, y, nx, ny, amber, strength);
      addPhoton(x, y, -nx, -ny, cyan, strength * 0.82);
      releaseEnergy(x, y, strength, amber, a.heavy || b.heavy);
    }

    function drawGrid(time) {
      var spacing = 76;
      var offsetX = ((time * 3.2) % spacing + spacing) % spacing;
      var offsetY = ((time * 1.7) % spacing + spacing) % spacing;
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(blue, 0.016);
      for (var x = offsetX; x < W; x += spacing) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (var y = offsetY; y < H; y += spacing) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      ctx.strokeStyle = rgba(blue, 0.052);
      ctx.beginPath();
      ctx.moveTo(24, 10); ctx.lineTo(24, 22); ctx.lineTo(10, 22);
      ctx.moveTo(W - 24, 10); ctx.lineTo(W - 24, 22); ctx.lineTo(W - 10, 22);
      ctx.moveTo(24, H - 10); ctx.lineTo(24, H - 22); ctx.lineTo(10, H - 22);
      ctx.moveTo(W - 24, H - 10); ctx.lineTo(W - 24, H - 22); ctx.lineTo(W - 10, H - 22);
      ctx.stroke();
    }

    function drawAmbientFields(time) {
      var x = W * (0.13 + pointer.x * 0.12);
      var y = H * (0.22 + pointer.y * 0.1);
      var field = ctx.createRadialGradient(x, y, 0, x, y, Math.max(W, H) * 0.42);
      field.addColorStop(0, rgba(blue, 0.018));
      field.addColorStop(1, rgba(blue, 0));
      ctx.fillStyle = field;
      ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = rgba(cyan, 0.025 + Math.sin(time * 0.45) * 0.006);
      ctx.lineWidth = 0.7;
      for (var ring = 0; ring < 3; ring += 1) {
        ctx.beginPath();
        ctx.arc(x, y, 126 + ring * 71 + Math.sin(time * 0.35 + ring) * 4, 0.12, Math.PI * 1.17);
        ctx.stroke();
      }
    }

    function drawPassiveBonds(time) {
      var linkDistance = 157;
      var packets = 0;
      for (var i = 0; i < atoms.length; i += 1) {
        for (var j = i + 1; j < atoms.length; j += 1) {
          var dx = positions[i].x - positions[j].x;
          var dy = positions[i].y - positions[j].y;
          var distanceSquared = dx * dx + dy * dy;
          if (distanceSquared >= linkDistance * linkDistance) continue;
          var distance = Math.sqrt(distanceSquared);
          var strength = (1 - distance / linkDistance) * Math.min(atoms[i].depth, atoms[j].depth);
          var alpha = strength * (0.047 + Math.sin(time * 0.7 + atoms[i].field) * 0.012);
          ctx.strokeStyle = rgba(blue, alpha);
          ctx.lineWidth = 0.5 + strength * 0.45;
          ctx.beginPath();
          ctx.moveTo(positions[i].x, positions[i].y);
          ctx.lineTo(positions[j].x, positions[j].y);
          ctx.stroke();

          if (strength > 0.38 && packets < 12) {
            var progress = (time * (0.07 + strength * 0.11) + atoms[i].field) % 1;
            var px = positions[i].x + (positions[j].x - positions[i].x) * progress;
            var py = positions[i].y + (positions[j].y - positions[i].y) * progress;
            ctx.fillStyle = rgba(blue, strength * 0.12);
            ctx.beginPath();
            ctx.arc(px, py, 0.6 + strength, 0, Math.PI * 2);
            ctx.fill();
            packets += 1;
          }
        }
      }
    }

    function drawMolecules(time) {
      for (var index = molecules.length - 1; index >= 0; index -= 1) {
        var molecule = molecules[index];
        var a = positions[molecule.a];
        var b = positions[molecule.b];
        var fade = Math.min(molecule.age / 0.45, (molecule.life - molecule.age) / 0.65, 1);
        if (!a || !b || fade <= 0) continue;
        var dx = b.x - a.x;
        var dy = b.y - a.y;
        var length = Math.sqrt(dx * dx + dy * dy) || 1;
        var nx = -dy / length;
        var ny = dx / length;
        var offset = 3.2 + Math.sin(time * 2.1 + molecule.phase) * 0.7;
        var colour = molecule.type === "exchange" ? amber : cyan;

        ctx.save();
        ctx.setLineDash([2.5, 5.5]);
        ctx.lineDashOffset = -time * 18;
        ctx.strokeStyle = rgba(colour, 0.09 * fade);
        ctx.lineWidth = 0.75;
        ctx.beginPath();
        ctx.moveTo(a.x + nx * offset, a.y + ny * offset);
        ctx.lineTo(b.x + nx * offset, b.y + ny * offset);
        ctx.moveTo(a.x - nx * offset, a.y - ny * offset);
        ctx.lineTo(b.x - nx * offset, b.y - ny * offset);
        ctx.stroke();
        ctx.restore();

        var packet = (time * 0.24 + molecule.phase) % 1;
        var px = a.x + dx * packet;
        var py = a.y + dy * packet;
        ctx.fillStyle = rgba(colour, 0.19 * fade);
        ctx.beginPath();
        ctx.arc(px, py, 1.25, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function drawElectronTrail(electron, depth) {
      if (electron.trail.length < 2) return;
      ctx.lineWidth = 0.55;
      for (var index = electron.trail.length - 1; index > 0; index -= 1) {
        var current = electron.trail[index];
        var next = electron.trail[index - 1];
        var alpha = (1 - index / electron.trail.length) * depth * 0.095;
        ctx.strokeStyle = rgba(electron.hue, alpha);
        ctx.beginPath();
        ctx.moveTo(current.x, current.y);
        ctx.lineTo(next.x, next.y);
        ctx.stroke();
      }
    }

    function drawAtom(atom, position, time) {
      var depth = atom.depth;
      var flicker = 0.9 + Math.sin(time * 0.72 + atom.flicker) * 0.1;
      var excitation = atom.excitation;
      var excite = excitation ? Math.sin(Math.min(1, excitation.age / excitation.life) * Math.PI) : 0;
      ctx.save();
      ctx.translate(position.x, position.y);

      for (var shell = 0; shell < atom.shells; shell += 1) {
        ctx.strokeStyle = rgba(ink, ((0.02 + depth * 0.037) / (shell + 1)) + excite * 0.025);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.ellipse(0, 0, atom.orbitX * (1 + shell * 0.42), atom.orbitY * (1 + shell * 0.28), atom.tilt + shell * 0.78, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (excitation) {
        var outerShell = atom.shells - 1;
        var spinRadiusX = atom.orbitX * (1 + outerShell * 0.42);
        var spinRadiusY = atom.orbitY * (1 + outerShell * 0.28);
        ctx.strokeStyle = rgba(amber, (0.055 + excite * 0.11) * depth * excitation.strength);
        ctx.lineWidth = 0.75 + excite * 0.55;
        for (var arc = 0; arc < 2; arc += 1) {
          var start = time * (3.8 + excitation.strength) + excitation.phase + arc * Math.PI;
          ctx.beginPath();
          ctx.ellipse(0, 0, spinRadiusX, spinRadiusY, atom.tilt + outerShell * 0.78, start, start + 0.82 + excite * 0.5);
          ctx.stroke();
        }
      }

      var haloScale = atom.ionizedCount ? 7 : (atom.heavy ? 6.4 : 5);
      var glow = ctx.createRadialGradient(0, 0, 0, 0, 0, atom.r * haloScale);
      glow.addColorStop(0, rgba(ink, (0.24 + excite * 0.12) * depth * flicker));
      glow.addColorStop(0.22, rgba(atom.ionizedCount || excitation ? amber : blue, (0.11 + excite * 0.08) * depth));
      glow.addColorStop(1, rgba(blue, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, atom.r * haloScale, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = rgba(ink, 0.19 + depth * 0.27);
      ctx.beginPath();
      ctx.arc(0, 0, atom.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgba(atom.ionizedCount ? amber : blue, 0.09 + depth * 0.13);
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.arc(0, 0, atom.r + 0.55, 0, Math.PI * 2);
      ctx.stroke();
      if (atom.heavy) {
        ctx.strokeStyle = rgba(amber, 0.055 + excite * 0.11);
        ctx.lineWidth = 0.65;
        ctx.beginPath();
        ctx.arc(0, 0, atom.r * 1.72, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (atom.ionizedCount) {
        ctx.fillStyle = rgba(amber, 0.2 * depth);
        ctx.fillRect(-0.7, -0.7, 1.4, 1.4);
      }

      ctx.globalCompositeOperation = "lighter";
      atom.electrons.forEach(function (electron) {
        if (electron.ionized) return;
        drawElectronTrail(electron, depth);
        var point = electronPoint(atom, electron);
        var radius = (0.8 + depth * 0.64) * (atom.heavy ? 1.16 : 1);
        ctx.fillStyle = rgba(electron.hue, 0.12 + depth * 0.2 + excite * 0.08);
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fill();
        if (electron.transition) {
          ctx.strokeStyle = rgba(electron.transition.outward ? cyan : amber, 0.15 * depth);
          ctx.lineWidth = 0.75;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(point.x, point.y);
          ctx.stroke();
        }
      });
      ctx.restore();
    }

    function drawPhotons() {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      photons.forEach(function (photon) {
        var fade = 1 - photon.age / photon.life;
        var length = Math.sqrt(photon.vx * photon.vx + photon.vy * photon.vy) || 1;
        var tail = 11 + photon.energy * 10;
        ctx.strokeStyle = rgba(photon.colour, 0.16 * fade);
        ctx.lineWidth = 0.75 + photon.energy * 0.32;
        ctx.beginPath();
        ctx.moveTo(photon.x - photon.vx / length * tail, photon.y - photon.vy / length * tail);
        ctx.lineTo(photon.x, photon.y);
        ctx.stroke();
        ctx.fillStyle = rgba(photon.colour, 0.19 * fade);
        ctx.beginPath();
        ctx.arc(photon.x, photon.y, 1 + photon.energy * 0.42, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }

    function drawIonizations() {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ionizations.forEach(function (event) {
        var fade = Math.min(event.age / 0.26, (event.life - event.age) / 0.45, 1);
        ctx.strokeStyle = rgba(amber, 0.1 * fade);
        ctx.setLineDash([2, 4]);
        ctx.lineDashOffset = -event.age * 14;
        ctx.beginPath();
        ctx.arc(event.x, event.y, 4 + Math.sin(event.age * 5 + event.phase) * 1.2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = rgba(amber, 0.2 * fade);
        ctx.beginPath();
        ctx.arc(event.x, event.y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }

    function drawCollisions() {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      collisions.forEach(function (collision) {
        var progress = collision.age / collision.life;
        var fade = Math.sin(Math.min(1, progress) * Math.PI);
        var distance = 12 + progress * (34 + collision.strength * 18);
        ctx.strokeStyle = rgba(amber, 0.18 * fade);
        ctx.lineWidth = 0.75 + collision.strength * 0.35;
        ctx.beginPath();
        ctx.moveTo(collision.x - collision.nx * distance * 0.22, collision.y - collision.ny * distance * 0.22);
        ctx.lineTo(collision.x + collision.nx * distance, collision.y + collision.ny * distance);
        ctx.moveTo(collision.x + collision.nx * distance * 0.22, collision.y + collision.ny * distance * 0.22);
        ctx.lineTo(collision.x - collision.nx * distance, collision.y - collision.ny * distance);
        ctx.stroke();
        ctx.fillStyle = rgba(amber, 0.22 * fade);
        ctx.beginPath();
        ctx.arc(collision.x, collision.y, 1.25 + collision.strength * 0.55, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }

    function drawEnergyWaves() {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      energyWaves.forEach(function (wave) {
        var progress = wave.age / wave.life;
        var fade = Math.sin(Math.min(1, progress) * Math.PI);
        for (var ring = 0; ring < 3; ring += 1) {
          var shifted = progress - ring * 0.105;
          if (shifted <= 0) continue;
          var radius = 7 + shifted * wave.radius + ring * 4;
          var alpha = (0.09 + wave.strength * 0.07) * fade * (1 - ring * 0.18);
          ctx.strokeStyle = rgba(wave.colour, alpha);
          ctx.lineWidth = 0.65 + wave.strength * 0.34 - ring * 0.08;
          ctx.beginPath();
          ctx.arc(wave.x, wave.y, radius, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (progress < 0.26) {
          ctx.fillStyle = rgba(wave.colour, (0.12 + wave.strength * 0.06) * (1 - progress / 0.26));
          ctx.beginPath();
          ctx.arc(wave.x, wave.y, 1.2 + wave.strength, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      ctx.restore();
    }

    function drawPulse() {
      if (!pulse) return;
      var origin = positions[pulse.index];
      if (!origin) return;
      var progress = pulse.age / pulse.life;
      var colour = pulse.kind === "amber" ? amber : blue;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (var ring = 0; ring < 3; ring += 1) {
        var shifted = progress - ring * 0.12;
        if (shifted <= 0) continue;
        ctx.strokeStyle = rgba(colour, (1 - shifted) * 0.07 * (1 - ring * 0.16));
        ctx.lineWidth = 0.75;
        ctx.beginPath();
        ctx.arc(origin.x, origin.y, 12 + shifted * (94 + ring * 28), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    function updateAtoms(dt, time) {
      var scroll = window.scrollY || 0;
      for (var index = 0; index < atoms.length; index += 1) {
        var atom = atoms[index];
        atom.x += atom.vx * dt;
        atom.y += atom.vy * dt;
        if (atom.x < -80) atom.x += W + 160;
        else if (atom.x > W + 80) atom.x -= W + 160;
        if (atom.y < -80) atom.y += H + 160;
        else if (atom.y > H + 80) atom.y -= H + 160;

        // Near atoms react slightly more to the cursor, distant atoms barely move.
        var parallax = atom.depth * 13;
        positions[index].x = atom.x + (pointer.x - 0.5) * parallax + Math.sin(time * 0.12 + atom.field) * atom.depth * 4;
        positions[index].y = ((atom.y - scroll * (0.028 + atom.depth * 0.052) + (pointer.y - 0.5) * parallax) % (H + 160) + (H + 160)) % (H + 160) - 80;

        var spinMultiplier = 1;
        if (atom.excitation) {
          atom.excitation.age += dt;
          var excitationProgress = Math.min(1, atom.excitation.age / atom.excitation.life);
          spinMultiplier += Math.sin(excitationProgress * Math.PI) * (atom.heavy ? 5.4 : 3.25) * atom.excitation.strength;
          if (atom.excitation.age >= atom.excitation.life) {
            releaseEnergy(positions[index].x, positions[index].y, atom.excitation.strength, amber, atom.heavy);
            addPhoton(positions[index].x, positions[index].y, Math.cos(atom.excitation.phase), Math.sin(atom.excitation.phase), amber, atom.excitation.strength);
            atom.excitation = null;
          }
        }

        atom.electrons.forEach(function (electron) {
          if (electron.ionized) return;
          electron.angle += electron.speed * dt * (1.26 - electron.shell * 0.12) * spinMultiplier;
          if (electron.transition) {
            electron.transition.age += dt;
            if (electron.transition.age >= electron.transition.life) {
              electron.shell = electron.transition.to;
              electron.transition = null;
            }
          }
          electron.trailClock += dt;
          if (electron.trailClock > 0.038) {
            electron.trailClock = 0;
            electron.trail.unshift(electronPoint(atom, electron));
            if (electron.trail.length > 10) electron.trail.pop();
          }
        });
      }
    }

    function updateEvents(dt) {
      transitionClock -= dt;
      if (transitionClock <= 0) {
        beginTransition();
        transitionClock = rand(0.48, 1.28);
      }

      moleculeClock -= dt;
      if (moleculeClock <= 0) {
        beginMolecule();
        moleculeClock = rand(1.65, 3.25);
      }

      collisionClock -= dt;
      if (collisionClock <= 0) {
        beginCollision();
        collisionClock = rand(0.8, 1.7);
      }

      excitationClock -= dt;
      if (excitationClock <= 0) {
        beginExcitation();
        excitationClock = rand(2.1, 4.1);
      }

      pulseClock -= dt;
      if (pulseClock <= 0 && atoms.length) {
        pulse = { index: Math.floor(Math.random() * atoms.length), age: 0, life: rand(2.2, 3.5), kind: Math.random() < 0.24 ? "amber" : "blue" };
        pulseClock = rand(3.8, 6.2);
      }

      for (var photonIndex = photons.length - 1; photonIndex >= 0; photonIndex -= 1) {
        var photon = photons[photonIndex];
        photon.age += dt;
        photon.x += photon.vx * dt;
        photon.y += photon.vy * dt;
        if (photon.age >= photon.life) photons.splice(photonIndex, 1);
      }

      for (var moleculeIndex = molecules.length - 1; moleculeIndex >= 0; moleculeIndex -= 1) {
        molecules[moleculeIndex].age += dt;
        if (molecules[moleculeIndex].age >= molecules[moleculeIndex].life) molecules.splice(moleculeIndex, 1);
      }

      for (var collisionIndex = collisions.length - 1; collisionIndex >= 0; collisionIndex -= 1) {
        collisions[collisionIndex].age += dt;
        if (collisions[collisionIndex].age >= collisions[collisionIndex].life) collisions.splice(collisionIndex, 1);
      }

      for (var waveIndex = energyWaves.length - 1; waveIndex >= 0; waveIndex -= 1) {
        energyWaves[waveIndex].age += dt;
        if (energyWaves[waveIndex].age >= energyWaves[waveIndex].life) energyWaves.splice(waveIndex, 1);
      }

      for (var ionIndex = ionizations.length - 1; ionIndex >= 0; ionIndex -= 1) {
        var ion = ionizations[ionIndex];
        ion.age += dt;
        var originIndex = atoms.indexOf(ion.atom);
        var origin = positions[originIndex];
        var returnPhase = clamp((ion.age - ion.life * 0.62) / (ion.life * 0.38), 0, 1);
        ion.x += ion.vx * dt;
        ion.y += ion.vy * dt;
        if (origin && returnPhase > 0) {
          ion.x += (origin.x - ion.x) * returnPhase * dt * 3.6;
          ion.y += (origin.y - ion.y) * returnPhase * dt * 3.6;
        }
        if (ion.age >= ion.life) {
          ion.electron.ionized = false;
          ion.electron.shell = 0;
          ion.electron.trail = [];
          ion.atom.ionizedCount = Math.max(0, ion.atom.ionizedCount - 1);
          if (origin) {
            addPhoton(origin.x, origin.y, rand(-1, 1), rand(-1, 1), cyan, 0.72);
            releaseEnergy(origin.x, origin.y, 0.9, amber, ion.atom.heavy);
          }
          ionizations.splice(ionIndex, 1);
        }
      }

      if (pulse) {
        pulse.age += dt;
        if (pulse.age >= pulse.life) pulse = null;
      }
    }

    function drawScene(time, dt) {
      ctx.clearRect(0, 0, W, H);
      drawGrid(time);
      drawAmbientFields(time);
      drawPassiveBonds(time);
      drawMolecules(time);
      for (var index = 0; index < atoms.length; index += 1) drawAtom(atoms[index], positions[index], time);
      drawPhotons();
      drawIonizations();
      drawCollisions();
      drawEnergyWaves();
      drawPulse();
    }

    function frame(now) {
      if (!pageVisible) {
        raf = 0;
        return;
      }
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      var time = now / 1000;
      updateAtoms(dt, time);
      updateEvents(dt);
      drawScene(time, dt);
      raf = requestAnimationFrame(frame);
    }

    window.addEventListener("pointermove", function (event) {
      pointer.x = clamp(event.clientX / Math.max(1, W), 0, 1);
      pointer.y = clamp(event.clientY / Math.max(1, H), 0, 1);
    }, { passive: true });

    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 130);
    }, { passive: true });

    document.addEventListener("visibilitychange", function () {
      pageVisible = document.visibilityState !== "hidden";
      if (!reducedMotion && pageVisible && !raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    });

    resize();
    if (!reducedMotion) raf = requestAnimationFrame(frame);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
