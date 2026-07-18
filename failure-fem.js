/*
  FIG. 0.2 — autonomous 3-D material-failure study.
  A procedural S355-type coupon visualises a phenomenological J2/cohesive
  sequence. The deformation is deliberately amplified for legibility; this is
  an engineering illustration, not a production nonlinear-FEA solver.
*/
(function () {
  "use strict";

  var canvas = document.getElementById("stressCanvas");
  var study = document.getElementById("failureStudy");
  if (!canvas || !study) return;

  var statusNode = document.getElementById("failureStatus");
  var loadNode = document.getElementById("failureLoad");
  var stressNode = document.getElementById("failureStress");
  var plasticNode = document.getElementById("failurePlastic");
  var damageNode = document.getElementById("failureDamage");
  var motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  var reducedMotion = motionQuery.matches;
  var compactQuery = window.matchMedia("(max-width: 620px)");
  var CYCLE_SECONDS = 15.2;

  canvas.setAttribute("role", "img");

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function smoothstep(min, max, value) {
    var unit = clamp((value - min) / Math.max(0.00001, max - min), 0, 1);
    return unit * unit * (3 - 2 * unit);
  }

  function stateAt(seconds) {
    var raw = reducedMotion ? 0.535 : ((seconds % CYCLE_SECONDS) / CYCLE_SECONDS);
    var fresh = raw >= 0.92;
    var load;
    var plastic;
    var necking;
    var crack;
    var separation;
    var opacity;

    if (fresh) {
      load = 0;
      plastic = 0;
      necking = 0;
      crack = 0;
      separation = 0;
      opacity = smoothstep(0.92, 0.985, raw);
    } else {
      load = raw < 0.18
        ? 0.72 * smoothstep(0, 0.18, raw)
        : raw < 0.46
          ? 0.72 + 0.28 * smoothstep(0.18, 0.46, raw)
          : raw < 0.78
            ? 1
            : 1 - 0.15 * smoothstep(0.78, 0.86, raw);
      plastic = smoothstep(0.18, 0.43, raw);
      necking = smoothstep(0.40, 0.64, raw);
      crack = smoothstep(0.54, 0.70, raw);
      separation = smoothstep(0.68, 0.80, raw);
      opacity = raw < 0.86 ? 1 : 1 - smoothstep(0.86, 0.92, raw);
    }

    var phase;
    if (raw < 0.18) phase = "ELASTIC FIELD · J2 TRIAL STATE";
    else if (raw < 0.40) phase = "UNIFORM PLASTIC FLOW · STRAIN HARDENING";
    else if (raw < 0.56) phase = "NECKING · VOID NUCLEATION";
    else if (raw < 0.68) phase = "VOID COALESCENCE · SHEAR LIP";
    else if (raw < 0.80) phase = "DUCTILE SEPARATION · ENERGY RELEASE";
    else if (raw < 0.86) phase = "POST-FRACTURE HOLD";
    else if (raw < 0.92) phase = "DISSOLVING FAILED SPECIMEN";
    else phase = "FRESH SPECIMEN · NEXT LOAD CASE";

    return {
      p: raw,
      fresh: fresh,
      load: load,
      plastic: plastic,
      necking: necking,
      crack: crack,
      separation: separation,
      opacity: opacity,
      phase: phase
    };
  }

  var lastHud = "";
  function updateHud(state) {
    var load = state.fresh ? 0 : 73.5 * state.load * (1 - state.necking * 0.10 - state.separation * 0.28);
    var engineeringStress = state.fresh ? 0 : Math.min(490, state.load <= 0.72
      ? 355 * state.load / 0.72
      : 355 + (state.load - 0.72) / 0.28 * 135);
    engineeringStress *= 1 - state.necking * 0.12 - state.separation * 0.38;
    var plastic = state.fresh ? 0 : 12.6 * state.plastic;
    var damage = state.fresh ? 0 : state.crack;
    var signature = state.phase + Math.round(load * 2) + Math.round(damage * 100);
    if (signature === lastHud) return;
    lastHud = signature;
    if (statusNode) statusNode.textContent = state.phase;
    if (loadNode) loadNode.textContent = load.toFixed(1) + " kN";
    if (stressNode) stressNode.textContent = Math.round(engineeringStress) + " MPa";
    if (plasticNode) plasticNode.textContent = plastic.toFixed(1) + "%";
    if (damageNode) damageNode.textContent = damage.toFixed(2);
  }

  function setSceneActive(active) {
    if (document.body) document.body.classList.toggle("failure-active", !!active);
  }

  function bootFallback(reason) {
    var ctx = canvas.getContext("2d");
    if (!ctx) {
      if (statusNode) statusNode.textContent = "3-D RENDERER UNAVAILABLE";
      return;
    }

    var width = 1;
    var height = 1;
    var visible = true;
    var pageVisible = document.visibilityState !== "hidden";
    var frame = 0;
    var elapsed = 0;
    var lastNow = null;
    var lastDraw = -Infinity;
    var kick = null;
    var lastPointer = 0;

    function resize() {
      var bounds = canvas.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, compactQuery.matches ? 1.3 : 1.6);
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lastDraw = -Infinity;
      requestFrame();
    }

    function couponRadius(unitX, state) {
      var shoulder = smoothstep(0.54, 0.92, Math.abs(unitX));
      var local = Math.exp(-Math.pow((unitX - 0.13) / 0.21, 2));
      var lateNeck = 0.31 + state.crack * 0.21;
      return (0.42 + shoulder * 0.24) * (1 - state.necking * local * lateNeck);
    }

    function drawHalf(state, left, cx, cy, scale) {
      var split = 0.13;
      var start = left ? -1 : split;
      var end = left ? split : 1;
      var shift = (left ? -1 : 1) * state.separation * scale * 0.045;
      var steps = 18;
      var top = [];
      var bottom = [];
      var i;
      for (i = 0; i <= steps; i += 1) {
        var u = start + (end - start) * i / steps;
        var stretched = u * (1 + state.load * 0.035 + state.plastic * 0.065);
        var x = cx + stretched * scale + shift;
        var radius = couponRadius(u, state) * scale;
        var impulse = 0;
        if (kick) {
          var age = performance.now() / 1000 - kick.born;
          if (age < 1.8) {
            var distance = (x - kick.x) / Math.max(1, scale);
            impulse = Math.sin(age * 11 - Math.abs(distance) * 12) * Math.exp(-distance * distance * 15) * Math.exp(-age * 2.1) * 8;
          }
        }
        top.push({ x: x, y: cy - radius - impulse });
        bottom.push({ x: x, y: cy + radius + impulse });
      }

      var gradient = ctx.createLinearGradient(cx - scale, cy, cx + scale, cy);
      gradient.addColorStop(0, "rgba(126,151,164," + (0.82 * state.opacity) + ")");
      gradient.addColorStop(0.50, "rgba(191,205,212," + (0.88 * state.opacity) + ")");
      gradient.addColorStop(0.57, "rgba(188,151,108," + ((0.18 + state.plastic * 0.25) * state.opacity) + ")");
      gradient.addColorStop(1, "rgba(119,147,162," + (0.84 * state.opacity) + ")");
      ctx.beginPath();
      top.forEach(function (point, index) { if (!index) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y); });
      for (i = bottom.length - 1; i >= 0; i -= 1) ctx.lineTo(bottom[i].x, bottom[i].y);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = "rgba(200,214,226," + (0.55 * state.opacity) + ")";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.strokeStyle = "rgba(147,180,205," + (0.17 * state.opacity) + ")";
      ctx.lineWidth = 0.7;
      for (i = 0; i <= steps; i += 2) {
        ctx.beginPath(); ctx.moveTo(top[i].x, top[i].y); ctx.lineTo(bottom[i].x, bottom[i].y); ctx.stroke();
        if (i + 2 <= steps) {
          ctx.beginPath(); ctx.moveTo(top[i].x, top[i].y); ctx.lineTo(bottom[i + 2].x, bottom[i + 2].y); ctx.stroke();
        }
      }
    }

    function draw(now) {
      frame = 0;
      if (!visible || !pageVisible) { lastNow = null; return; }
      if (lastNow !== null) elapsed += Math.min(0.08, Math.max(0, now - lastNow) / 1000);
      lastNow = now;
      var interval = compactQuery.matches ? 1000 / 36 : 1000 / 50;
      if (!reducedMotion && now - lastDraw < interval) { requestFrame(); return; }
      lastDraw = now;

      var state = stateAt(elapsed);
      updateHud(state);
      ctx.clearRect(0, 0, width, height);

      var gx;
      var gy;
      ctx.strokeStyle = "rgba(147,180,205,.045)";
      ctx.lineWidth = 1;
      for (gx = 0; gx < width; gx += 34) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, height); ctx.stroke(); }
      for (gy = 0; gy < height; gy += 34) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(width, gy); ctx.stroke(); }

      var scale = Math.min(width * 0.34, 280);
      var cx = width * 0.5;
      var cy = height * 0.52;
      drawHalf(state, true, cx, cy, scale);
      drawHalf(state, false, cx, cy, scale);

      if (state.crack > 0.01 && !state.fresh) {
        var crackX = cx + 0.13 * scale * (1 + state.load * 0.035 + state.plastic * 0.065);
        var radius = couponRadius(0.13, state) * scale;
        ctx.strokeStyle = "rgba(207,160,104," + (0.88 * state.opacity) + ")";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(crackX, cy - radius);
        ctx.lineTo(crackX + Math.sin(state.crack * 10) * 3, cy - radius + radius * 2 * state.crack);
        ctx.stroke();
        for (var ring = 0; ring < 3; ring += 1) {
          var wave = clamp((state.p - 0.70 - ring * 0.018) / 0.12, 0, 1);
          if (wave > 0 && wave < 1) {
            ctx.strokeStyle = (ring === 1 ? "rgba(147,180,205," : "rgba(207,160,104,") + (Math.sin(wave * Math.PI) * 0.34 * state.opacity) + ")";
            ctx.beginPath(); ctx.ellipse(crackX, cy, 12 + wave * 88, 8 + wave * 52, 0, 0, Math.PI * 2); ctx.stroke();
          }
        }
      }

      ctx.font = "8px 'IBM Plex Mono', monospace";
      ctx.fillStyle = "rgba(200,214,226,.42)";
      ctx.fillText("WEBGL FALLBACK · 2-D COHESIVE SECTION", 18, height - 20);
      if (reason) {
        ctx.textAlign = "right";
        ctx.fillText(reason, width - 18, height - 20);
        ctx.textAlign = "left";
      }
      if (!reducedMotion) requestFrame();
    }

    function requestFrame() {
      if (!frame && visible && pageVisible) frame = requestAnimationFrame(draw);
    }

    function perturb(event) {
      var now = performance.now();
      if (event.type === "pointermove" && event.pointerType === "mouse" && now - lastPointer < 120) return;
      if (event.type === "pointermove" && event.pointerType !== "mouse") return;
      lastPointer = now;
      var bounds = canvas.getBoundingClientRect();
      kick = { x: event.clientX - bounds.left, y: event.clientY - bounds.top, born: now / 1000 };
      requestFrame();
    }

    canvas.addEventListener("pointerdown", perturb, { passive: true });
    canvas.addEventListener("pointermove", perturb, { passive: true });
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener("resize", resize, { passive: true });
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        visible = entries[0] ? entries[0].isIntersecting : true;
        setSceneActive(visible);
        if (visible) requestFrame();
      }, { threshold: 0.04 }).observe(study);
    }
    document.addEventListener("visibilitychange", function () {
      pageVisible = document.visibilityState !== "hidden";
      if (pageVisible) requestFrame();
    });
    resize();
    requestFrame();
  }

  async function bootScene() {
    var THREE;
    try {
      THREE = await import("https://cdn.jsdelivr.net/npm/three@0.166.1/+esm");
    } catch (error) {
      bootFallback("WEBGL MODULE UNAVAILABLE");
      return;
    }

    if (!canvas.getContext || !window.WebGLRenderingContext) {
      bootFallback("WEBGL NOT AVAILABLE");
      return;
    }

    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true,
        alpha: true,
        powerPreference: "high-performance"
      });
    } catch (error) {
      bootFallback("WEBGL INITIALIZATION FAILED");
      return;
    }

    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compactQuery.matches ? 1.3 : 1.6));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.16;

    var scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0b1015, 0.052);
    var camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
    var cameraTarget = new THREE.Vector3(0, -0.02, 0);

    scene.add(new THREE.HemisphereLight(0xb9d9ea, 0x101419, 1.55));
    var key = new THREE.DirectionalLight(0xd9efff, 3.15);
    key.position.set(4.8, 6.2, 7.5);
    scene.add(key);
    var rim = new THREE.PointLight(0x62bddf, 8.5, 14, 2);
    rim.position.set(-4.4, 2.7, -3.3);
    scene.add(rim);
    var fractureLight = new THREE.PointLight(0xd7944c, 0, 6.5, 2);
    scene.add(fractureLight);

    var floorGrid = new THREE.GridHelper(12, 28, 0x31586f, 0x20343f);
    floorGrid.position.y = -1.48;
    floorGrid.material.transparent = true;
    floorGrid.material.opacity = 0.2;
    scene.add(floorGrid);

    var specimen = new THREE.Group();
    specimen.rotation.set(-0.035, -0.10, 0.025);
    scene.add(specimen);

    var HALF_LENGTH = 3.55;
    var CRACK_X = 0.46;
    var SIDES = compactQuery.matches ? 12 : 16;
    var tempColour = new THREE.Color();
    var steelColour = new THREE.Color(0x718b99);
    var paleColour = new THREE.Color(0xb9cbd3);
    var warmSteelColour = new THREE.Color(0x9b8c7b);
    var impulses = [];

    function createMachiningTexture() {
      var textureCanvas = document.createElement("canvas");
      textureCanvas.width = 128;
      textureCanvas.height = 8;
      var textureContext = textureCanvas.getContext("2d");
      textureContext.fillStyle = "rgb(154,154,154)";
      textureContext.fillRect(0, 0, textureCanvas.width, textureCanvas.height);
      for (var x = 0; x < textureCanvas.width; x += 2) {
        var value = x % 8 === 0 ? 112 : 138 + (x % 6) * 3;
        textureContext.fillStyle = "rgb(" + value + "," + value + "," + value + ")";
        textureContext.fillRect(x, 0, 1, textureCanvas.height);
      }
      var texture = new THREE.CanvasTexture(textureCanvas);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(2.6, 1);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      return texture;
    }
    var machiningTexture = createMachiningTexture();

    function radiiAt(x) {
      var shoulder = smoothstep(0.52, 0.92, Math.abs(x) / HALF_LENGTH);
      return { y: 0.66 + shoulder * 0.35, z: 0.60 + shoulder * 0.25 };
    }

    function localizedAt(x) {
      return Math.exp(-Math.pow((x - CRACK_X) / 0.74, 2));
    }

    function pointAt(x, theta, state, side, nowSeconds, output) {
      var radii = radiiAt(x);
      var local = localizedAt(x);
      var neckAmount = 0.31 + state.crack * 0.21;
      var neck = 1 - state.necking * local * neckAmount;
      var axial = 1 + state.load * 0.04 + state.plastic * 0.07;
      var rough = Math.abs(x - CRACK_X) < 0.001
        ? side * state.crack * (0.028 * Math.sin(theta * 3 + 0.4) + 0.018 * Math.sin(theta * 7))
        : 0;
      output.set(
        x * axial + side * state.separation * 0.27 + rough,
        Math.cos(theta) * radii.y * neck,
        Math.sin(theta) * radii.z * (1 - state.necking * local * (0.27 + state.crack * 0.12))
      );
      output.y += state.necking * local * (x - CRACK_X) * 0.075;

      for (var impulseIndex = impulses.length - 1; impulseIndex >= 0; impulseIndex -= 1) {
        var impulse = impulses[impulseIndex];
        var age = nowSeconds - impulse.born;
        if (age > 2.1) continue;
        var dx = output.x - impulse.x;
        var dy = output.y - impulse.y;
        var dz = output.z - impulse.z;
        var distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        var pulse = Math.sin(age * 11 - distance * 8.5) * Math.exp(-distance * distance * 1.7) * Math.exp(-age * 1.9) * impulse.strength;
        output.x += pulse * 0.055;
        output.y += Math.cos(theta) * pulse * 0.11;
        output.z += Math.sin(theta) * pulse * 0.11;
      }
      return output;
    }

    function buildSurface(startX, endX, rings, side) {
      var vertexCount = (rings + 1) * SIDES;
      var positions = new Float32Array(vertexCount * 3);
      var colours = new Float32Array(vertexCount * 3);
      var uvs = new Float32Array(vertexCount * 2);
      var params = [];
      var indices = [];
      var linePairs = [];
      var ring;
      var around;

      for (ring = 0; ring <= rings; ring += 1) {
        var x = startX + (endX - startX) * ring / rings;
        for (around = 0; around < SIDES; around += 1) {
          params.push({ x: x, theta: around / SIDES * Math.PI * 2 });
          var uvIndex = (ring * SIDES + around) * 2;
          uvs[uvIndex] = ring / rings;
          uvs[uvIndex + 1] = around / SIDES;
        }
      }

      for (ring = 0; ring < rings; ring += 1) {
        for (around = 0; around < SIDES; around += 1) {
          var next = (around + 1) % SIDES;
          var a = ring * SIDES + around;
          var b = ring * SIDES + next;
          var c = (ring + 1) * SIDES + around;
          var d = (ring + 1) * SIDES + next;
          if ((ring + around) % 2) indices.push(a, c, b, b, c, d);
          else indices.push(a, c, d, a, d, b);
          linePairs.push(a, b, a, c, a, d);
        }
      }
      for (around = 0; around < SIDES; around += 1) {
        linePairs.push(rings * SIDES + around, rings * SIDES + (around + 1) % SIDES);
      }

      var geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      var material = new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        metalness: 0.78,
        roughness: 0.3,
        roughnessMap: machiningTexture,
        bumpMap: machiningTexture,
        bumpScale: 0.012,
        clearcoat: 0.14,
        clearcoatRoughness: 0.38,
        transparent: true,
        opacity: 0.94,
        side: THREE.DoubleSide
      });
      var mesh = new THREE.Mesh(geometry, material);
      specimen.add(mesh);

      var wirePositions = new Float32Array(linePairs.length * 3);
      var wireGeometry = new THREE.BufferGeometry();
      wireGeometry.setAttribute("position", new THREE.BufferAttribute(wirePositions, 3).setUsage(THREE.DynamicDrawUsage));
      var wireMaterial = new THREE.LineBasicMaterial({ color: 0xb1c8d4, transparent: true, opacity: 0.14, depthWrite: false });
      var wire = new THREE.LineSegments(wireGeometry, wireMaterial);
      specimen.add(wire);

      return {
        side: side,
        params: params,
        mesh: mesh,
        wire: wire,
        linePairs: linePairs,
        positions: positions,
        colours: colours,
        wirePositions: wirePositions,
        geometry: geometry,
        wireGeometry: wireGeometry
      };
    }

    var leftSurface = buildSurface(-HALF_LENGTH, CRACK_X, compactQuery.matches ? 14 : 20, -1);
    var rightSurface = buildSurface(CRACK_X, HALF_LENGTH, compactQuery.matches ? 12 : 16, 1);
    var scratchPoint = new THREE.Vector3();

    function updateSurface(surface, state, seconds) {
      var index;
      for (index = 0; index < surface.params.length; index += 1) {
        var param = surface.params[index];
        pointAt(param.x, param.theta, state, surface.side, seconds, scratchPoint);
        var offset = index * 3;
        surface.positions[offset] = scratchPoint.x;
        surface.positions[offset + 1] = scratchPoint.y;
        surface.positions[offset + 2] = scratchPoint.z;

        var hot = clamp(state.necking * localizedAt(param.x) * 0.82, 0, 1);
        tempColour.copy(steelColour).lerp(paleColour, 0.24 + (1 - hot) * 0.12).lerp(warmSteelColour, hot * 0.34);
        surface.colours[offset] = tempColour.r;
        surface.colours[offset + 1] = tempColour.g;
        surface.colours[offset + 2] = tempColour.b;
      }
      for (index = 0; index < surface.linePairs.length; index += 1) {
        var source = surface.linePairs[index] * 3;
        var target = index * 3;
        surface.wirePositions[target] = surface.positions[source];
        surface.wirePositions[target + 1] = surface.positions[source + 1];
        surface.wirePositions[target + 2] = surface.positions[source + 2];
      }
      surface.geometry.attributes.position.needsUpdate = true;
      surface.geometry.attributes.color.needsUpdate = true;
      surface.geometry.computeVertexNormals();
      surface.geometry.computeBoundingSphere();
      surface.wireGeometry.attributes.position.needsUpdate = true;
      surface.mesh.material.opacity = 0.94 * state.opacity;
      surface.wire.material.opacity = 0.14 * state.opacity;
    }

    var fractureCoreColour = new THREE.Color(0x465258);
    var fractureLipColour = new THREE.Color(0x87979d);
    function buildFractureFace(side) {
      var radialSteps = compactQuery.matches ? 4 : 6;
      var angularSteps = compactQuery.matches ? 26 : 38;
      var params = [{ radius: 0, theta: 0 }];
      var indices = [];
      var radial;
      var angular;
      for (radial = 1; radial <= radialSteps; radial += 1) {
        for (angular = 0; angular < angularSteps; angular += 1) {
          params.push({ radius: radial / radialSteps, theta: angular / angularSteps * Math.PI * 2 });
        }
      }
      for (angular = 0; angular < angularSteps; angular += 1) {
        indices.push(0, 1 + angular, 1 + (angular + 1) % angularSteps);
      }
      for (radial = 1; radial < radialSteps; radial += 1) {
        var innerStart = 1 + (radial - 1) * angularSteps;
        var outerStart = 1 + radial * angularSteps;
        for (angular = 0; angular < angularSteps; angular += 1) {
          var next = (angular + 1) % angularSteps;
          var a = innerStart + angular;
          var b = innerStart + next;
          var c = outerStart + angular;
          var d = outerStart + next;
          if ((radial + angular) % 2) indices.push(a, c, b, b, c, d);
          else indices.push(a, c, d, a, d, b);
        }
      }
      var positions = new Float32Array(params.length * 3);
      var colours = new Float32Array(params.length * 3);
      var geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setIndex(indices);
      var material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        metalness: 0.34,
        roughness: 0.82,
        flatShading: true,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide
      });
      var mesh = new THREE.Mesh(geometry, material);
      specimen.add(mesh);
      return { side: side, params: params, positions: positions, colours: colours, geometry: geometry, mesh: mesh };
    }

    var leftFace = buildFractureFace(-1);
    var rightFace = buildFractureFace(1);

    function updateFractureFace(face, state, crackPosition) {
      var radius = radiiAt(CRACK_X);
      var neckY = 1 - state.necking * (0.31 + state.crack * 0.21);
      var neckZ = 1 - state.necking * (0.27 + state.crack * 0.12);
      for (var index = 0; index < face.params.length; index += 1) {
        var param = face.params[index];
        var radial = param.radius;
        var theta = param.theta;
        var centreProfile = 1 - Math.pow(radial, 1.58);
        var shearLip = smoothstep(0.68, 1, radial);
        // One recessed fibrous cup and one complementary protruding cone,
        // bounded by opposing 45-degree shear lips.
        var centreDepth = face.side < 0 ? -0.15 : -0.13;
        var profile = centreDepth * centreProfile - face.side * 0.065 * shearLip;
        var texture = (Math.sin(theta * 5 + radial * 9) * 0.012 + Math.sin(theta * 11 - radial * 7) * 0.006) * (0.25 + radial * 0.75);
        var offset = index * 3;
        face.positions[offset] = crackPosition + face.side * state.separation * 0.27 + (profile + face.side * texture) * state.crack;
        face.positions[offset + 1] = Math.cos(theta) * radius.y * neckY * radial * (1 + texture * 0.8);
        face.positions[offset + 2] = Math.sin(theta) * radius.z * neckZ * radial * (1 - texture * 0.65);
        tempColour.copy(fractureCoreColour).lerp(fractureLipColour, 0.22 + shearLip * 0.62 + Math.abs(texture) * 3.2);
        face.colours[offset] = tempColour.r;
        face.colours[offset + 1] = tempColour.g;
        face.colours[offset + 2] = tempColour.b;
      }
      face.geometry.attributes.position.needsUpdate = true;
      face.geometry.attributes.color.needsUpdate = true;
      face.geometry.computeVertexNormals();
      face.geometry.computeBoundingSphere();
      face.mesh.material.opacity = state.crack * state.opacity * (0.05 + state.separation * 0.88);
    }

    function crackLine(sign) {
      var count = compactQuery.matches ? 34 : 50;
      var geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setDrawRange(0, 0);
      var material = new THREE.LineBasicMaterial({ color: 0xe0a45f, transparent: true, opacity: 0, depthWrite: false });
      var line = new THREE.Line(geometry, material);
      specimen.add(line);
      return { sign: sign, count: count, geometry: geometry, line: line };
    }

    var crackFrontA = crackLine(1);
    var crackFrontB = crackLine(-1);

    function updateCrackLine(front, state) {
      var attr = front.geometry.attributes.position;
      var radius = radiiAt(CRACK_X);
      var neck = 1 - state.necking * (0.31 + state.crack * 0.21);
      var x = CRACK_X * (1 + state.load * 0.04 + state.plastic * 0.07);
      for (var index = 0; index < front.count; index += 1) {
        var theta = front.sign * index / (front.count - 1) * Math.PI;
        attr.setXYZ(index, x, Math.cos(theta) * radius.y * neck, Math.sin(theta) * radius.z * (1 - state.necking * (0.27 + state.crack * 0.12)));
      }
      attr.needsUpdate = true;
      front.geometry.setDrawRange(0, state.crack > 0.006 ? Math.max(2, Math.floor(front.count * state.crack)) : 0);
      front.line.material.opacity = state.crack * (1 - state.separation * 0.82) * 0.92 * state.opacity;
    }

    var clampMaterial = new THREE.MeshStandardMaterial({ color: 0x1b2730, metalness: 0.72, roughness: 0.31, transparent: true, opacity: 1 });
    var clampEdgeMaterial = new THREE.LineBasicMaterial({ color: 0x93b4cd, transparent: true, opacity: 0.48 });
    function makeClamp() {
      var group = new THREE.Group();
      var geometry = new THREE.BoxGeometry(0.32, 2.18, 1.22, 1, 6, 3);
      group.add(new THREE.Mesh(geometry, clampMaterial));
      group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), clampEdgeMaterial));
      specimen.add(group);
      return group;
    }
    var leftClamp = makeClamp();
    var rightClamp = makeClamp();
    var leftArrow = new THREE.ArrowHelper(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(), 0.82, 0x93b4cd, 0.17, 0.09);
    var rightArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.82, 0x93b4cd, 0.17, 0.09);
    specimen.add(leftArrow, rightArrow);

    var randomSeed = 9137;
    function random() {
      randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0;
      return randomSeed / 4294967296;
    }

    var fragmentCount = compactQuery.matches ? 4 : 7;
    var fragmentGeometry = new THREE.TetrahedronGeometry(0.026, 0);
    var fragmentMaterial = new THREE.MeshStandardMaterial({ color: 0x9aa9af, emissive: 0x302319, emissiveIntensity: 0.12, metalness: 0.42, roughness: 0.62, transparent: true, opacity: 0.34 });
    var fragments = new THREE.InstancedMesh(fragmentGeometry, fragmentMaterial, fragmentCount);
    fragments.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    fragments.frustumCulled = false;
    specimen.add(fragments);
    var fragmentSeeds = [];
    for (var fragmentIndex = 0; fragmentIndex < fragmentCount; fragmentIndex += 1) {
      var theta = (random() - 0.5) * 1.18;
      var radial = 0.76 + random() * 0.18;
      fragmentSeeds.push({
        theta: theta,
        y: Math.cos(theta) * 0.49 * radial,
        z: Math.sin(theta) * 0.45 * radial,
        side: random() < 0.5 ? -1 : 1,
        vx: 0.10 + random() * 0.22,
        vy: 0.04 + random() * 0.22,
        vz: (random() - 0.5) * 0.28,
        spin: 0.8 + random() * 1.5,
        scale: 0.42 + random() * 0.46
      });
    }
    var fragmentMatrix = new THREE.Object3D();

    var energyRings = [];
    for (var ringIndex = 0; ringIndex < 4; ringIndex += 1) {
      var ringMaterial = new THREE.MeshBasicMaterial({ color: ringIndex % 2 ? 0x79c9e2 : 0xd99b55, transparent: true, opacity: 0, depthWrite: false });
      var ring = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.012, 5, 64), ringMaterial);
      ring.rotation.y = Math.PI / 2;
      specimen.add(ring);
      energyRings.push(ring);
    }

    var raycaster = new THREE.Raycaster();
    var pointer = new THREE.Vector2();
    var localHit = new THREE.Vector3();
    var lastPointerAt = 0;

    function perturb(event) {
      var now = performance.now();
      if (event.type === "pointermove" && event.pointerType !== "mouse") return;
      if (event.type === "pointermove" && now - lastPointerAt < 120) return;
      lastPointerAt = now;
      var bounds = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      var hits = raycaster.intersectObjects([leftSurface.mesh, rightSurface.mesh], false);
      if (!hits.length) return;
      localHit.copy(hits[0].point);
      specimen.worldToLocal(localHit);
      impulses.push({ x: localHit.x, y: localHit.y, z: localHit.z, born: elapsed, strength: event.type === "pointerdown" ? 0.95 : 0.46 });
      if (impulses.length > 5) impulses.shift();
      requestFrame();
    }

    canvas.addEventListener("pointerdown", perturb, { passive: true });
    canvas.addEventListener("pointermove", perturb, { passive: true });

    var active = true;
    var pageVisible = document.visibilityState !== "hidden";
    var contextLost = false;
    var frame = 0;
    var elapsed = 0;
    var lastNow = null;
    var lastRendered = -Infinity;

    function resize() {
      var bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compactQuery.matches ? 1.3 : 1.6));
      renderer.setSize(bounds.width, bounds.height, false);
      camera.aspect = bounds.width / bounds.height;
      camera.fov = camera.aspect < 1.05 ? 44 : camera.aspect < 1.7 ? 39 : 34;
      camera.updateProjectionMatrix();
      lastRendered = -Infinity;
      requestFrame();
    }

    function requestFrame() {
      if (!frame && active && pageVisible && !contextLost) frame = requestAnimationFrame(render);
    }

    function render(now) {
      frame = 0;
      if (!active || !pageVisible || contextLost) { lastNow = null; return; }
      if (lastNow !== null && !reducedMotion) elapsed += Math.min(0.08, Math.max(0, now - lastNow) / 1000);
      lastNow = now;
      var interval = compactQuery.matches ? 1000 / 36 : 1000 / 50;
      if (!reducedMotion && now - lastRendered < interval) { requestFrame(); return; }
      lastRendered = now;

      for (var impulseIndex = impulses.length - 1; impulseIndex >= 0; impulseIndex -= 1) {
        if (elapsed - impulses[impulseIndex].born > 2.1) impulses.splice(impulseIndex, 1);
      }

      var state = stateAt(elapsed);
      updateHud(state);
      updateSurface(leftSurface, state, elapsed);
      updateSurface(rightSurface, state, elapsed);
      updateCrackLine(crackFrontA, state);
      updateCrackLine(crackFrontB, state);

      var crackPosition = CRACK_X * (1 + state.load * 0.04 + state.plastic * 0.07);
      updateFractureFace(leftFace, state, crackPosition);
      updateFractureFace(rightFace, state, crackPosition);

      var endStretch = HALF_LENGTH * (1 + state.load * 0.04 + state.plastic * 0.07);
      leftClamp.position.x = -endStretch - state.separation * 0.27 - 0.19;
      rightClamp.position.x = endStretch + state.separation * 0.27 + 0.19;
      clampMaterial.opacity = state.opacity;
      clampEdgeMaterial.opacity = 0.48 * state.opacity;
      leftClamp.visible = rightClamp.visible = state.opacity > 0.015;
      leftArrow.position.set(leftClamp.position.x - 0.22, 0, 0);
      rightArrow.position.set(rightClamp.position.x + 0.22, 0, 0);
      leftArrow.setLength(0.58 + state.load * 0.42, 0.16, 0.08);
      rightArrow.setLength(0.58 + state.load * 0.42, 0.16, 0.08);
      leftArrow.visible = rightArrow.visible = state.opacity > 0.04;

      var flight = state.fresh ? 0 : smoothstep(0.70, 0.86, state.p);
      fragmentMaterial.opacity = 0.34 * state.opacity;
      for (fragmentIndex = 0; fragmentIndex < fragmentCount; fragmentIndex += 1) {
        var seed = fragmentSeeds[fragmentIndex];
        var size = flight > 0 ? seed.scale * state.opacity : 0.0001;
        fragmentMatrix.position.set(
          crackPosition + seed.side * (0.05 + seed.vx * flight),
          seed.y + seed.vy * flight - 0.08 * flight * flight,
          seed.z + seed.vz * flight
        );
        fragmentMatrix.rotation.set(seed.spin * flight, seed.theta + seed.spin * flight * 0.72, seed.spin * flight * 0.45);
        fragmentMatrix.scale.setScalar(Math.max(0.0001, size));
        fragmentMatrix.updateMatrix();
        fragments.setMatrixAt(fragmentIndex, fragmentMatrix.matrix);
      }
      fragments.instanceMatrix.needsUpdate = true;

      for (ringIndex = 0; ringIndex < energyRings.length; ringIndex += 1) {
        var wave = clamp((state.p - 0.69 - ringIndex * 0.019) / 0.13, 0, 1);
        var energyRing = energyRings[ringIndex];
        energyRing.position.x = crackPosition;
        energyRing.scale.setScalar(1 + wave * (4.3 + ringIndex * 0.28));
        energyRing.material.opacity = wave > 0 && wave < 1 ? Math.sin(wave * Math.PI) * 0.42 * state.opacity : 0;
      }
      fractureLight.position.set(crackPosition, 0, 0);
      fractureLight.intensity = state.fresh ? 0 : Math.exp(-Math.pow((state.p - 0.715) / 0.028, 2)) * 8;

      var orbit = reducedMotion ? 0 : Math.sin(elapsed * 0.2) * 0.14;
      if (camera.aspect < 1.05) camera.position.set(3.9 + orbit, 5.2, 16.2);
      else if (camera.aspect < 1.7) camera.position.set(5.0 + orbit, 4.3, 12.0);
      else camera.position.set(6.2 + orbit, 4.0, 11.6);
      camera.lookAt(cameraTarget);
      specimen.rotation.y = -0.10 + (reducedMotion ? 0 : Math.sin(elapsed * 0.16) * 0.035);
      renderer.render(scene, camera);
      if (!reducedMotion) requestFrame();
    }

    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener("resize", resize, { passive: true });
    resize();

    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        active = entries[0] ? entries[0].isIntersecting : true;
        setSceneActive(active);
        if (active) requestFrame();
      }, { threshold: 0.04 }).observe(study);
    } else {
      setSceneActive(true);
    }

    document.addEventListener("visibilitychange", function () {
      pageVisible = document.visibilityState !== "hidden";
      if (pageVisible) requestFrame();
    });

    canvas.addEventListener("webglcontextlost", function (event) {
      event.preventDefault();
      contextLost = true;
      if (statusNode) statusNode.textContent = "WEBGL CONTEXT LOST · RESTORING";
    });
    canvas.addEventListener("webglcontextrestored", function () {
      contextLost = false;
      resize();
      requestFrame();
    });

    function handleMotionChange(event) {
      reducedMotion = event.matches;
      lastNow = null;
      requestFrame();
    }
    if (motionQuery.addEventListener) motionQuery.addEventListener("change", handleMotionChange);
    else if (motionQuery.addListener) motionQuery.addListener(handleMotionChange);

    requestFrame();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootScene, { once: true });
  } else {
    bootScene();
  }
})();
