/*
  FIG. 0.1 — MK-VI multi-axis manipulator.
  A procedural scene deliberately avoids a downloaded model: every link, joint,
  cable, work envelope and reticle is assembled from simple Three.js geometry.
*/
(function () {
  "use strict";

  var canvas = document.getElementById("robotArmCanvas");
  if (!canvas) return;

  var status = document.getElementById("armStatus");
  var hint = document.querySelector(".arm-hud__hint");
  var armRegion = (canvas.closest && canvas.closest(".arm-stage")) || canvas;
  var motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  var reducedMotion = motionQuery.matches;

  // This is a read-only visualisation. The motion is intentionally tied to
  // document progress, not to mouse/touch controls on the canvas.
  canvas.style.cursor = "default";
  canvas.setAttribute("aria-label", "Scroll-driven three-dimensional six-axis robotic arm");
  if (hint) hint.textContent = "SCROLL TO TRACE KINEMATIC PATH";

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function easeInOut(value) {
    return value * value * (3 - 2 * value);
  }

  function readArmScrollProgress() {
    var bounds = armRegion.getBoundingClientRect();
    var viewport = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    var scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
    var regionTop = bounds.top + scrollTop;
    var start = regionTop - Math.min(96, viewport * 0.12);
    var travel = Math.max(bounds.height * 1.2, viewport * 0.82);
    return clamp((scrollTop - start) / travel, 0, 1);
  }

  function interpolatePath(path, progress, output) {
    var last = path.length - 1;
    var stepped = clamp(progress, 0, 1) * last;
    var lower = Math.min(last - 1, Math.floor(stepped));
    var mix = easeInOut(stepped - lower);
    for (var index = 0; index < output.length; index += 1) {
      output[index] = path[lower][index] + (path[lower + 1][index] - path[lower][index]) * mix;
    }
    return output;
  }

  function bootFallback(reason) {
    var ctx = canvas.getContext("2d");
    if (!ctx) return;

    var visible = true;
    var raf = 0;
    var started = performance.now();
    var fallbackPoses = [
      [-1.07, 0.06, -0.55],
      [-0.95, 0.12, -0.38],
      [-1.17, 0.10, -0.46],
      [-0.88, -0.06, -0.40]
    ];
    var fallbackCommand = fallbackPoses[0].slice();
    var fallbackCurrent = fallbackPoses[0].slice();
    var fallbackScrollTarget = readArmScrollProgress();
    var fallbackScrollProgress = fallbackScrollTarget;

    function size() {
      var bounds = canvas.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var width = Math.max(1, Math.floor(bounds.width * dpr));
      var height = Math.max(1, Math.floor(bounds.height * dpr));
      // Resetting a canvas buffer each frame is needlessly expensive and can
      // leave the fallback choppy on integrated graphics.
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w: Math.max(1, bounds.width), h: Math.max(1, bounds.height) };
    }

    function line(x1, y1, x2, y2, width, color) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.lineCap = "round";
      ctx.stroke();
    }

    function point(origin, length, angle) {
      return {
        x: origin.x + Math.cos(angle) * length,
        y: origin.y + Math.sin(angle) * length
      };
    }

    function draw(now) {
      // A requestAnimationFrame id becomes stale as soon as its callback runs.
      // Clearing it here lets IntersectionObserver restart the loop on return.
      raf = 0;
      var dims = size();
      var w = dims.w;
      var h = dims.h;
      var t = reducedMotion ? 0 : (now - started) / 1000;
      var scale = Math.min(w / 620, h / 500);
      fallbackScrollTarget = readArmScrollProgress();
      if (reducedMotion) {
        fallbackScrollProgress = fallbackScrollTarget;
      } else {
        fallbackScrollProgress += (fallbackScrollTarget - fallbackScrollProgress) * 0.1;
      }
      interpolatePath(fallbackPoses, fallbackScrollProgress, fallbackCommand);
      for (var jointIndex = 0; jointIndex < fallbackCurrent.length; jointIndex += 1) {
        if (reducedMotion) {
          fallbackCurrent[jointIndex] = fallbackCommand[jointIndex];
        } else {
          fallbackCurrent[jointIndex] += (fallbackCommand[jointIndex] - fallbackCurrent[jointIndex]) * 0.12;
        }
      }
      // Keep the silhouette in an elbow-up working posture: shoulder lifts,
      // forearm comes back toward the work, and the wrist picks the tool up.
      var cx = w * 0.32;
      var cy = h * 0.77;
      var a1 = fallbackCurrent[0] + Math.sin(t * 0.78) * 0.008;
      var a2 = fallbackCurrent[1] + Math.cos(t * 0.91) * 0.006;
      var a3 = fallbackCurrent[2] + Math.sin(t * 1.08) * 0.005;
      var p0 = { x: cx, y: cy };
      var p1 = point(p0, 108 * scale, a1);
      var p2 = point(p1, 128 * scale, a2);
      var p3 = point(p2, 66 * scale, a3);
      var reticle = point(p3, 82 * scale, a3);

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#0c1116";
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = "rgba(147,180,205,.11)";
      ctx.lineWidth = 1;
      for (var gx = 0; gx < w; gx += 28) line(gx, 0, gx, h, 1, "rgba(147,180,205,.08)");
      for (var gy = 0; gy < h; gy += 28) line(0, gy, w, gy, 1, "rgba(147,180,205,.08)");

      ctx.save();
      ctx.translate(cx, cy + 38 * scale);
      ctx.scale(scale, scale);
      ctx.strokeStyle = "rgba(147,180,205,.32)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, 166, 42, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#202a31";
      ctx.beginPath();
      ctx.ellipse(0, -6, 58, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      line(p0.x, p0.y, p1.x, p1.y, 38 * scale, "#202c34");
      line(p0.x, p0.y, p1.x, p1.y, 25 * scale, "#7c9ab0");
      line(p1.x, p1.y, p2.x, p2.y, 34 * scale, "#1b262d");
      line(p1.x, p1.y, p2.x, p2.y, 20 * scale, "#a3c1d5");
      line(p2.x, p2.y, p3.x, p3.y, 24 * scale, "#25333c");
      line(p2.x, p2.y, p3.x, p3.y, 12 * scale, "#90b0c5");

      [p0, p1, p2, p3].forEach(function (p, index) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, (index === 0 ? 25 : 19) * scale, 0, Math.PI * 2);
        ctx.fillStyle = index === 2 ? "#cfa068" : "#11181e";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(195,217,234,.74)";
        ctx.stroke();
      });

      ctx.save();
      ctx.translate(p3.x, p3.y);
      ctx.rotate(a3);
      line(0, 0, 52 * scale, 0, 15 * scale, "#b6d0df");
      line(47 * scale, 0, 68 * scale, -17 * scale, 6 * scale, "#cfa068");
      line(47 * scale, 0, 68 * scale, 17 * scale, 6 * scale, "#cfa068");
      ctx.restore();

      ctx.save();
      ctx.translate(reticle.x, reticle.y);
      ctx.strokeStyle = "rgba(207,160,104,.9)";
      ctx.lineWidth = Math.max(1, 1.2 * scale);
      ctx.beginPath();
      ctx.arc(0, 0, 10 * scale, 0, Math.PI * 2);
      ctx.stroke();
      line(-16 * scale, 0, -5 * scale, 0, 1.1 * scale, "rgba(195,217,234,.82)");
      line(5 * scale, 0, 16 * scale, 0, 1.1 * scale, "rgba(195,217,234,.82)");
      line(0, -16 * scale, 0, -5 * scale, 1.1 * scale, "rgba(195,217,234,.82)");
      line(0, 5 * scale, 0, 16 * scale, 1.1 * scale, "rgba(195,217,234,.82)");
      ctx.restore();

      ctx.fillStyle = "#c3d9ea";
      ctx.font = "10px 'IBM Plex Mono', monospace";
      ctx.fillText("WEBGL FALLBACK · PROCEDURAL KINEMATIC SILHOUETTE", 18, 29);
      ctx.fillStyle = "rgba(226,230,234,.64)";
      ctx.fillText(reason || "RENDER PATH READY", 18, 47);
      ctx.fillStyle = "rgba(147,180,205,.76)";
      ctx.fillText("SCROLL " + String(Math.round(fallbackScrollProgress * 100)).padStart(3, "0") + "% · ELEVATED ELBOW-UP PATH", 18, h - 22);

      if (visible && !reducedMotion) raf = requestAnimationFrame(draw);
    }

    if (window.IntersectionObserver) {
      var observer = new IntersectionObserver(function (entries) {
        visible = entries[0] ? entries[0].isIntersecting : true;
        if (!visible) return;
        if (reducedMotion) {
          draw(performance.now());
        } else if (!raf) {
          raf = requestAnimationFrame(draw);
        }
      }, { threshold: 0.05 });
      observer.observe(canvas);
    }
    window.addEventListener("scroll", function () {
      fallbackScrollTarget = readArmScrollProgress();
      if (reducedMotion && visible) draw(performance.now());
    }, { passive: true });
    window.addEventListener("resize", function () {
      if (!raf && visible) draw(performance.now());
    }, { passive: true });
    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        if (!raf && visible) draw(performance.now());
      }).observe(armRegion);
    }
    function handleFallbackMotionChange(event) {
      reducedMotion = event.matches;
      if (visible) draw(performance.now());
    }
    if (motionQuery.addEventListener) {
      motionQuery.addEventListener("change", handleFallbackMotionChange);
    } else if (motionQuery.addListener) {
      motionQuery.addListener(handleFallbackMotionChange);
    }
    setStatus("CANVAS KINEMATICS · SCROLL PATH");
    draw(performance.now());
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

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.22;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    var scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0b1015, 0.075);

    // A slightly higher, wider survey view leaves visual air above the base
    // and keeps the raised elbow, tool centre point, and floor datum together.
    var camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
    camera.position.set(8.4, 5.6, 10.8);
    var cameraTarget = new THREE.Vector3(1.55, 1.82, -0.12);
    camera.lookAt(cameraTarget);

    var palette = {
      steel: new THREE.MeshStandardMaterial({ color: 0x87a9bc, metalness: 0.91, roughness: 0.23 }),
      steelLight: new THREE.MeshStandardMaterial({ color: 0xb8ceda, metalness: 0.75, roughness: 0.22 }),
      carbon: new THREE.MeshStandardMaterial({ color: 0x151d23, metalness: 0.74, roughness: 0.31 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x0c1115, metalness: 0.66, roughness: 0.38 }),
      blue: new THREE.MeshStandardMaterial({ color: 0x547c95, metalness: 0.84, roughness: 0.2, emissive: 0x0b1b25, emissiveIntensity: 0.46 }),
      amber: new THREE.MeshStandardMaterial({ color: 0xc98e45, metalness: 0.53, roughness: 0.25, emissive: 0x5b2e09, emissiveIntensity: 0.55 }),
      cable: new THREE.MeshStandardMaterial({ color: 0x151c21, metalness: 0.2, roughness: 0.42 }),
      diagnostic: new THREE.MeshStandardMaterial({ color: 0x4fcce4, metalness: 0.48, roughness: 0.24, emissive: 0x0b5368, emissiveIntensity: 0.48 }),
      ghost: new THREE.MeshBasicMaterial({ color: 0x6fa5c7, transparent: true, opacity: 0.15, depthWrite: false }),
      envelope: new THREE.MeshBasicMaterial({ color: 0x7db6d8, transparent: true, opacity: 0.18, depthWrite: false }),
      waveCyan: new THREE.MeshBasicMaterial({ color: 0x58d5ec, transparent: true, opacity: 0.6, depthWrite: false }),
      waveAmber: new THREE.MeshBasicMaterial({ color: 0xe5a55b, transparent: true, opacity: 0.48, depthWrite: false })
    };
    var diagnosticMarkers = [];

    function cast(mesh, receive) {
      mesh.castShadow = true;
      mesh.receiveShadow = !!receive;
      return mesh;
    }

    function mesh(geometry, material, position, rotation, parent) {
      var item = cast(new THREE.Mesh(geometry, material));
      if (position) item.position.set(position[0], position[1], position[2]);
      if (rotation) item.rotation.set(rotation[0], rotation[1], rotation[2]);
      (parent || scene).add(item);
      return item;
    }

    function group(parent, position) {
      var item = new THREE.Group();
      if (position) item.position.set(position[0], position[1], position[2]);
      (parent || scene).add(item);
      return item;
    }

    function joint(parent, radius, width, accent) {
      var shell = group(parent);
      mesh(new THREE.CylinderGeometry(radius, radius, width, 48), palette.carbon, [0, 0, 0], [Math.PI / 2, 0, 0], shell);
      mesh(new THREE.CylinderGeometry(radius * 0.81, radius * 0.81, width + 0.012, 48), palette.steel, [0, 0, 0], [Math.PI / 2, 0, 0], shell);
      mesh(new THREE.TorusGeometry(radius * 0.74, 0.027, 10, 48), accent ? palette.amber : palette.blue, [0, 0, width * 0.51], [0, 0, 0], shell);
      mesh(new THREE.TorusGeometry(radius * 0.74, 0.027, 10, 48), accent ? palette.amber : palette.blue, [0, 0, -width * 0.51], [0, 0, 0], shell);
      for (var n = 0; n < 6; n += 1) {
        var theta = (n / 6) * Math.PI * 2;
        var bolt = mesh(new THREE.CylinderGeometry(0.047, 0.047, width + 0.026, 12), palette.dark,
          [Math.cos(theta) * radius * 0.55, Math.sin(theta) * radius * 0.55, 0], [Math.PI / 2, 0, 0], shell);
        bolt.castShadow = false;
      }
      return shell;
    }

    function link(parent, length, radius, tint) {
      var assembly = group(parent);
      var tube = mesh(new THREE.CapsuleGeometry(radius, Math.max(0.15, length - radius * 2), 8, 20), tint || palette.steel,
        [length * 0.5, 0, 0], [0, 0, Math.PI / 2], assembly);
      tube.castShadow = true;

      var core = mesh(new THREE.BoxGeometry(length * 0.65, radius * 0.78, radius * 1.3), palette.carbon,
        [length * 0.5, 0, 0], [0, 0, 0], assembly);
      core.castShadow = true;

      mesh(new THREE.BoxGeometry(length * 0.42, 0.035, radius * 1.57), palette.blue,
        [length * 0.5, radius * 0.77, 0], [0, 0, 0], assembly);
      mesh(new THREE.BoxGeometry(length * 0.42, 0.035, radius * 1.57), palette.blue,
        [length * 0.5, -radius * 0.77, 0], [0, 0, 0], assembly);

      // Recessed service trace and ID plate: machine-readable detail rather
      // than decorative lighting, with a restrained cyan/amber diagnostic cue.
      var trace = mesh(new THREE.BoxGeometry(length * 0.2, 0.022, 0.032), palette.diagnostic,
        [length * 0.45, radius * 0.84, radius * 0.8], null, assembly);
      trace.castShadow = false;
      diagnosticMarkers.push(trace);
      mesh(new THREE.BoxGeometry(length * 0.095, 0.032, radius * 1.66), palette.amber,
        [length * 0.79, 0, 0], null, assembly);
      return assembly;
    }

    function cable(parent, points) {
      var curve = new THREE.CatmullRomCurve3(points.map(function (point) {
        return new THREE.Vector3(point[0], point[1], point[2]);
      }));
      var tube = mesh(new THREE.TubeGeometry(curve, 36, 0.028, 8, false), palette.cable, null, null, parent);
      tube.castShadow = false;
      return tube;
    }

    var hemi = new THREE.HemisphereLight(0x9bc6dd, 0x101419, 1.62);
    scene.add(hemi);

    var key = new THREE.DirectionalLight(0xd6efff, 3.6);
    key.position.set(4.4, 8.2, 5.6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 22;
    key.shadow.camera.left = -7;
    key.shadow.camera.right = 7;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -7;
    scene.add(key);

    var rim = new THREE.PointLight(0x6ca8d0, 12, 12, 2);
    rim.position.set(-4, 3.7, -3.6);
    scene.add(rim);

    var warm = new THREE.PointLight(0xd28a42, 5.4, 8, 2);
    warm.position.set(2.8, 1.4, 3.2);
    scene.add(warm);

    var floor = mesh(new THREE.PlaneGeometry(22, 22), new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.42 }),
      [0, -0.035, 0], [-Math.PI / 2, 0, 0]);
    floor.receiveShadow = true;

    var grid = new THREE.GridHelper(14, 28, 0x315165, 0x20333e);
    grid.material.transparent = true;
    grid.material.opacity = 0.38;
    scene.add(grid);

    var plinth = group(scene, [0, 0, 0]);
    mesh(new THREE.CylinderGeometry(1.1, 1.18, 0.18, 64), palette.dark, [0, 0.09, 0], null, plinth);
    mesh(new THREE.CylinderGeometry(0.92, 1.01, 0.27, 64), palette.carbon, [0, 0.29, 0], null, plinth);
    mesh(new THREE.CylinderGeometry(0.89, 0.89, 0.035, 64), palette.blue, [0, 0.44, 0], null, plinth);
    mesh(new THREE.TorusGeometry(0.95, 0.024, 10, 64), palette.steelLight, [0, 0.456, 0], [Math.PI / 2, 0, 0], plinth);
    var baseSignal = mesh(new THREE.TorusGeometry(1.16, 0.011, 5, 96), palette.waveCyan,
      [0, 0.468, 0], [Math.PI / 2, 0, 0], plinth);
    baseSignal.castShadow = false;

    var root = group(scene, [0, 0.45, 0]);
    var j1 = group(root);
    mesh(new THREE.CylinderGeometry(0.73, 0.83, 0.6, 48), palette.steel, [0, 0.3, 0], null, j1);
    mesh(new THREE.CylinderGeometry(0.59, 0.59, 0.11, 48), palette.dark, [0, 0.63, 0], null, j1);
    mesh(new THREE.TorusGeometry(0.62, 0.033, 10, 48), palette.amber, [0, 0.66, 0], [Math.PI / 2, 0, 0], j1);

    var shoulder = group(j1, [0, 0.95, 0]);
    joint(shoulder, 0.51, 0.39, true);
    mesh(new THREE.BoxGeometry(0.8, 0.82, 0.52), palette.carbon, [0.2, 0.02, 0], null, shoulder);
    mesh(new THREE.BoxGeometry(0.59, 0.55, 0.57), palette.steel, [0.22, 0.03, 0], null, shoulder);

    var upperLength = 2.1;
    link(shoulder, upperLength, 0.3, palette.steel);
    cable(shoulder, [[0.08, 0.34, 0.34], [0.58, 0.62, 0.37], [1.32, 0.48, 0.35], [1.96, 0.17, 0.32]]);

    var elbow = group(shoulder, [upperLength, 0, 0]);
    joint(elbow, 0.45, 0.43, false);
    mesh(new THREE.BoxGeometry(0.54, 0.62, 0.54), palette.carbon, [0.05, 0, 0], null, elbow);

    var foreLength = 1.72;
    link(elbow, foreLength, 0.265, palette.steelLight);
    cable(elbow, [[0.06, -0.31, 0.31], [0.48, -0.56, 0.34], [1.08, -0.43, 0.31], [1.58, -0.13, 0.28]]);

    var j4 = group(elbow, [foreLength, 0, 0]);
    joint(j4, 0.34, 0.52, true);
    mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.5, 36), palette.carbon, [0.28, 0, 0], [0, 0, Math.PI / 2], j4);

    var j5 = group(j4, [0.55, 0, 0]);
    joint(j5, 0.3, 0.36, false);
    mesh(new THREE.BoxGeometry(0.6, 0.38, 0.45), palette.steel, [0.26, 0, 0], null, j5);

    var j6 = group(j5, [0.58, 0, 0]);
    joint(j6, 0.24, 0.38, true);
    mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.55, 30), palette.steelLight, [0.38, 0, 0], [0, 0, Math.PI / 2], j6);

    var tool = group(j6, [0.7, 0, 0]);
    mesh(new THREE.BoxGeometry(0.32, 0.4, 0.48), palette.carbon, [0, 0, 0], null, tool);
    var gripperA = group(tool, [0.18, 0.18, 0]);
    var gripperB = group(tool, [0.18, -0.18, 0]);
    mesh(new THREE.BoxGeometry(0.44, 0.1, 0.13), palette.steelLight, [0.22, 0, 0], null, gripperA);
    mesh(new THREE.BoxGeometry(0.15, 0.22, 0.13), palette.amber, [0.49, 0.09, 0], null, gripperA);
    mesh(new THREE.BoxGeometry(0.44, 0.1, 0.13), palette.steelLight, [0.22, 0, 0], null, gripperB);
    mesh(new THREE.BoxGeometry(0.15, 0.22, 0.13), palette.amber, [0.49, -0.09, 0], null, gripperB);

    var envelope = group(scene, [0, 0.06, 0]);
    var arcA = new THREE.Mesh(new THREE.TorusGeometry(5.1, 0.012, 5, 128, Math.PI * 1.26), palette.envelope);
    arcA.rotation.set(Math.PI / 2, 0.52, -1.75);
    envelope.add(arcA);
    var arcB = new THREE.Mesh(new THREE.TorusGeometry(4.05, 0.01, 5, 96, Math.PI * 1.02), palette.envelope);
    arcB.rotation.set(0.88, 0.25, 0.1);
    envelope.add(arcB);
    var ring = new THREE.Mesh(new THREE.RingGeometry(5.48, 5.5, 112), palette.envelope);
    ring.rotation.x = -Math.PI / 2;
    envelope.add(ring);

    // The target begins at the gripper centreline rather than near the
    // pedestal, so the planned motion reads as an actual working operation.
    var target = group(scene, [4.7, 2.42, -0.96]);
    var targetRing = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.018, 8, 48), palette.amber);
    target.add(targetRing);
    var targetCross = new THREE.Group();
    target.add(targetCross);
    mesh(new THREE.BoxGeometry(0.64, 0.016, 0.016), palette.steelLight, null, null, targetCross);
    mesh(new THREE.BoxGeometry(0.016, 0.64, 0.016), palette.steelLight, null, null, targetCross);
    var targetGlow = new THREE.PointLight(0xaadcf5, 2.8, 2.4);
    target.add(targetGlow);
    var targetTelemetry = group(target);
    var targetWaveA = mesh(new THREE.TorusGeometry(0.47, 0.009, 5, 72, Math.PI * 0.66), palette.waveCyan,
      null, [0.42, -0.3, -0.72], targetTelemetry);
    var targetWaveB = mesh(new THREE.TorusGeometry(0.39, 0.009, 5, 64, Math.PI * 0.52), palette.waveAmber,
      null, [-0.44, 0.5, 1.06], targetTelemetry);
    targetWaveA.castShadow = false;
    targetWaveB.castShadow = false;

    var axes = new THREE.AxesHelper(0.72);
    axes.position.set(-2.88, 0.08, 2.46);
    scene.add(axes);

    // Conservative joint limits and elbow-up poses keep the rendered robot
    // within a believable industrial working range instead of folding it
    // down around the pedestal.
    var jointLimits = [
      [-2.62, 2.62],
      [0.22, 1.62],
      [-2.09, -0.2],
      [-2.62, 2.62],
      [-1.92, 1.92],
      [-2.62, 2.62]
    ];
    var poses = [
      [0.20, 0.86, -1.58, 0.20, 1.22, -0.36],
      [-0.36, 0.70, -1.30, -0.28, 1.00, 0.56],
      [0.56, 1.02, -1.76, 0.42, 1.42, -0.72],
      [-0.12, 0.53, -1.08, -0.16, 1.05, 0.24]
    ];
    var targetPositions = [
      [4.7, 2.42, -0.96],
      [5.04, 2.25, 1.9],
      [3.67, 2.9, -2.3],
      [5.35, 2.22, 0.64]
    ];
    var scrollTarget = readArmScrollProgress();
    var scrollProgress = scrollTarget;
    var scrollVelocity = 0;
    var commandedPose = poses[0].slice();
    var targetCommand = targetPositions[0].slice();
    interpolatePath(poses, scrollProgress, commandedPose);
    interpolatePath(targetPositions, scrollProgress, targetCommand);
    var current = commandedPose.slice();
    target.position.fromArray(targetCommand);
    var targetGoal = target.position.clone();
    var lastStatus = -1;
    var active = true;
    var hasVisibility = true;
    var resizeObserver;
    var animationFrame = 0;
    var contextLost = false;

    function requestFrame() {
      if (!animationFrame && active && hasVisibility) {
        animationFrame = requestAnimationFrame(animate);
      }
    }

    function handleSceneMotionChange(event) {
      reducedMotion = event.matches;
      requestFrame();
    }
    if (motionQuery.addEventListener) {
      motionQuery.addEventListener("change", handleSceneMotionChange);
    } else if (motionQuery.addListener) {
      motionQuery.addListener(handleSceneMotionChange);
    }

    canvas.addEventListener("webglcontextlost", function (event) {
      event.preventDefault();
      // A canvas cannot switch from an existing WebGL context to a 2D context,
      // so wait for the browser's recoverable WebGL restoration instead of
      // attempting a fallback that cannot acquire its drawing context.
      contextLost = true;
      setStatus("WEBGL CONTEXT LOST · RESTORING");
    });
    canvas.addEventListener("webglcontextrestored", function () {
      contextLost = false;
      lastStatus = -1;
      resize();
      setStatus("WEBGL RESTORED · SCROLL PATH READY");
      requestFrame();
    });

    function resize() {
      var bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(bounds.width, bounds.height, false);
      camera.aspect = bounds.width / bounds.height;
      camera.updateProjectionMatrix();
      scrollTarget = readArmScrollProgress();
      requestFrame();
    }

    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(canvas);
    } else {
      window.addEventListener("resize", resize, { passive: true });
    }
    resize();

    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        active = entries[0] ? entries[0].isIntersecting : true;
        if (active) requestFrame();
      }, { threshold: 0.06 }).observe(canvas);
    }

    document.addEventListener("visibilitychange", function () {
      hasVisibility = document.visibilityState !== "hidden";
      if (hasVisibility) requestFrame();
    });

    window.addEventListener("scroll", function () {
      scrollTarget = readArmScrollProgress();
      requestFrame();
    }, { passive: true });

    function animate(now) {
      animationFrame = 0;
      if (!active || !hasVisibility || contextLost) return;

      var time = now / 1000;
      var progressDelta = scrollTarget - scrollProgress;
      if (reducedMotion) {
        scrollProgress = scrollTarget;
        scrollVelocity = 0;
      } else {
        scrollVelocity += (progressDelta - scrollVelocity) * 0.16;
        scrollProgress += progressDelta * 0.11;
      }

      interpolatePath(poses, scrollProgress, commandedPose);
      interpolatePath(targetPositions, scrollProgress, targetCommand);
      targetGoal.fromArray(targetCommand);

      for (var index = 0; index < current.length; index += 1) {
        var scrollImpulse = clamp(scrollVelocity, -0.16, 0.16) * (index === 0 ? 0.075 : 0.045);
        var microMotion = reducedMotion ? 0 : Math.sin(time * (0.72 + index * 0.09) + index * 1.7) * 0.0045;
        var commandedAngle = clamp(
          commandedPose[index] + scrollImpulse + microMotion,
          jointLimits[index][0],
          jointLimits[index][1]
        );
        current[index] += (commandedAngle - current[index]) * (reducedMotion ? 1 : 0.12);
      }

      j1.rotation.y = current[0];
      shoulder.rotation.z = current[1];
      elbow.rotation.z = current[2];
      j4.rotation.x = current[3];
      j5.rotation.z = current[4];
      j6.rotation.x = current[5];
      gripperA.rotation.z = reducedMotion ? 0.03 : 0.055 + Math.sin(time * 1.4) * 0.012;
      gripperB.rotation.z = reducedMotion ? -0.03 : -0.055 - Math.sin(time * 1.4) * 0.012;

      var diagnosticPulse = reducedMotion ? 0.5 : (Math.sin(time * 1.35 + scrollProgress * 7.5) + 1) * 0.5;
      palette.diagnostic.emissiveIntensity = 0.34 + diagnosticPulse * 0.34;
      palette.waveCyan.opacity = 0.42 + diagnosticPulse * 0.2;
      palette.waveAmber.opacity = 0.34 + diagnosticPulse * 0.16;
      diagnosticMarkers.forEach(function (marker, markerIndex) {
        var markerPulse = reducedMotion ? 1 : 0.94 + Math.sin(time * 1.16 + markerIndex * 1.18) * 0.055;
        marker.scale.x = markerPulse;
      });
      baseSignal.scale.setScalar(reducedMotion ? 1 : 0.985 + diagnosticPulse * 0.025);
      targetRing.rotation.y = reducedMotion ? 0 : time * 0.38;
      targetRing.scale.setScalar(1 + (reducedMotion ? 0 : Math.sin(time * 1.45) * 0.035));
      targetCross.rotation.z = reducedMotion ? 0 : -time * 0.18;
      targetTelemetry.rotation.z = reducedMotion ? scrollProgress * 0.32 : -time * 0.22 + scrollProgress * 0.7;
      targetWaveA.scale.setScalar(reducedMotion ? 1 : 0.96 + diagnosticPulse * 0.08);
      targetWaveB.scale.setScalar(reducedMotion ? 1 : 1.03 - diagnosticPulse * 0.055);
      target.position.lerp(targetGoal, reducedMotion ? 1 : 0.12);
      envelope.rotation.y = (scrollProgress - 0.5) * 0.16 + (reducedMotion ? 0 : Math.sin(time * 0.15) * 0.024);
      palette.envelope.opacity = reducedMotion ? 0.16 : 0.13 + scrollProgress * 0.055;

      var statusProgress = Math.round(scrollProgress * 100);
      if (statusProgress !== lastStatus) {
        lastStatus = statusProgress;
        var j1Degrees = Math.round(current[0] * 180 / Math.PI);
        var j2Degrees = Math.round(current[1] * 180 / Math.PI);
        var segment = Math.min(poses.length, Math.floor(scrollProgress * (poses.length - 1)) + 1);
        setStatus("SCROLL " + String(statusProgress).padStart(3, "0") + "% · SEG " + String(segment).padStart(2, "0") + " · J1 " + j1Degrees + "° · J2 " + j2Degrees + "°");
      }

      renderer.render(scene, camera);
      if (!reducedMotion) requestFrame();
    }

    setStatus("SCROLL PATH · ELEVATED WORKING ENVELOPE");
    requestFrame();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootScene, { once: true });
  } else {
    bootScene();
  }
})();
