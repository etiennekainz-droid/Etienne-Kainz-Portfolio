/* Background field.
 *
 * One WebGL point cloud, drawn additively on black: fine dust spread over the
 * whole screen, and the K mark as a denser, breathing cloud inside it that
 * sheds particles into the dust and takes them back.
 *
 * The pointer cuts through both. A coarse grid on the CPU holds, per cell,
 *   - a smooth displacement (the wake a moving pointer drags along), and
 *   - a cut: an opening amplitude plus the signed distance to the cut line.
 * Every cell is a spring-damper, so a cut bursts open and heals. The vertex
 * shader samples the grid at each particle: the sign of the distance tells it
 * which side of the cut it is on, the distance gradient which way to move, so
 * the two sides part cleanly along the line instead of smearing.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("field");
  if (!canvas) return;

  var root = document.documentElement;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var api = { setScene: function () {}, disperse: function () {} };
  window.EKField = api;

  var gl = null;
  try {
    gl = canvas.getContext("webgl", {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, powerPreference: "high-performance"
    });
  } catch (error) { gl = null; }
  if (!gl) {
    root.classList.add("no-webgl");
    return;
  }

  var useDisp = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) > 0;

  // ---------------------------------------------------------------- shaders
  var VERT = [
    "precision highp float;",
    "attribute vec4 aA;",          // xyz, kind (0 dust, 1 K outline, 2 K body)
    "attribute float aS;",         // seed 0..1
    "uniform vec2 uRes;",          // canvas size, CSS px
    "uniform float uDpr;",
    "uniform float uTime;",
    "uniform float uScroll;",
    "uniform vec4 uK;",            // centre x, centre y, height px, intensity
    "uniform vec3 uRot;",          // yaw, pitch, bob px
    "uniform float uDust;",
    "uniform float uDisperse;",
    "uniform vec3 uMouse;",        // x, y, halo strength
    "uniform vec2 uCell;",         // one grid cell, CSS px
    "uniform sampler2D uDisp;",
    "varying float vA;",
    "float h(float n) { return fract(sin(n) * 43758.5453123); }",
    "void main() {",
    "  float s = aS;",
    "  float t = uTime;",
    "  vec2 p;",
    "  float a;",
    "  float size;",
    "  if (aA.w < 0.5) {",
    "    float d = aA.z;",
    "    vec2 q = aA.xy;",
    "    q += vec2(0.0022 + 0.0045 * d, -0.0011 - 0.0016 * d) * t;",
    "    q.y -= uScroll / uRes.y * (0.03 + 0.1 * d);",
    "    float w1 = t * (0.05 + 0.09 * s) + s * 61.0;",
    "    float w2 = t * (0.04 + 0.08 * h(s * 7.3)) + s * 17.0;",
    "    q += vec2(sin(w1), cos(w2)) * (0.002 + 0.006 * d);",
    "    q = fract(q);",
    "    p = q * uRes;",
    "    size = 0.5 + 1.0 * d * d;",
    "    a = (0.03 + 0.2 * d) * (0.55 + 0.45 * sin(t * (0.3 + 1.1 * h(s * 3.1)) + s * 97.0));",
    "    if (s > 0.993) { a = a * 2.2 + 0.08; size *= 1.3; }",
    "    a *= uDust;",
    "  } else {",
    "    vec3 k = aA.xyz;",
    // A share of the K wanders far and dim: its edge frays into the dust.
    "    float wanderer = step(0.62, h(s * 11.7));",
    "    float amp = mix(0.004, 0.085, wanderer);",
    // A slow wave of dissolution travels through the mark and reforms it.
    "    float wave = sin(k.y * 4.2 + k.x * 2.3 - t * 0.28 + 1.3);",
    "    amp *= 1.0 + 1.6 * smoothstep(0.5, 1.0, wave);",
    "    amp *= 1.0 + 4.0 * uDisperse;",
    "    vec3 o = vec3(",
    "      sin(t * (0.13 + 0.21 * s) + s * 50.0),",
    "      cos(t * (0.11 + 0.19 * h(s * 3.3)) + s * 31.0),",
    "      sin(t * (0.09 + 0.15 * h(s * 5.9)) + s * 13.0));",
    "    k += o * amp;",
    "    vec3 dir = vec3(h(s * 13.1) - 0.5, h(s * 29.7) - 0.5, h(s * 47.3) - 0.5);",
    "    k += dir * uDisperse * uDisperse * (0.5 + 1.5 * h(s * 5.1));",
    "    float cy = cos(uRot.x); float sy = sin(uRot.x);",
    "    k = vec3(cy * k.x + sy * k.z, k.y, -sy * k.x + cy * k.z);",
    "    float cp = cos(uRot.y); float sp = sin(uRot.y);",
    "    k = vec3(k.x, cp * k.y - sp * k.z, sp * k.y + cp * k.z);",
    "    float persp = 2.6 / (2.6 - k.z);",
    "    p = uK.xy + vec2(k.x, -k.y) * uK.z * persp + vec2(0.0, uRot.z);",
    "    float outline = step(aA.w, 1.5);",
    "    size = mix(0.85, 1.0, outline) * (0.7 + 0.6 * h(s * 17.9)) * persp;",
    "    a = mix(0.065, 0.24, outline) * (0.7 + 0.3 * sin(t * (0.4 + 0.9 * s) + s * 60.0));",
    "    a *= mix(1.0, 0.42, wanderer);",
    "    a *= uK.w * (1.0 - 0.55 * uDisperse);",
    "  }",
    "#ifdef USE_DISP",
    "  vec2 uv = clamp(p / uRes, 0.0, 1.0);",
    "  vec4 f = texture2D(uDisp, uv);",
    "  vec2 e = f.rg * 2.0 - 1.0;",
    "  vec2 disp = sign(e) * e * e * 160.0;",
    "  float cut = f.b;",
    "  if (cut > 0.004) {",
    "    vec2 du = vec2(uCell.x / uRes.x, 0.0);",
    "    vec2 dv = vec2(0.0, uCell.y / uRes.y);",
    "    vec2 n = vec2(texture2D(uDisp, uv + du).a - texture2D(uDisp, uv - du).a,",
    "                  texture2D(uDisp, uv + dv).a - texture2D(uDisp, uv - dv).a);",
    "    float nl = length(n);",
    "    if (nl > 0.00001) {",
    "      float side = f.a >= 0.5 ? 1.0 : -1.0;",
    "      disp += n / nl * side * cut * 84.0 * (0.75 + 0.5 * h(s * 41.0));",
    "    }",
    "  }",
    "  p += disp * (0.85 + 0.3 * h(s * 71.3));",
    "  a *= 1.0 + 1.4 * cut;",
    "#endif",
    "  vec2 dm = p - uMouse.xy;",
    "  float dl2 = dot(dm, dm);",
    "  p += dm * inversesqrt(dl2 + 1.0) * uMouse.z * 12.0 * exp(-dl2 / 3000.0);",
    "  vec2 c = p / uRes * 2.0 - 1.0;",
    "  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);",
    "  float dev = size * uDpr;",
    "  gl_PointSize = max(dev, 1.0);",
    "  vA = a * min(dev, 1.0);",
    "}"
  ].join("\n");

  var FRAG = [
    "precision mediump float;",
    "varying float vA;",
    "void main() {",
    "  vec2 c = gl_PointCoord - 0.5;",
    "  float v = vA * (1.0 - smoothstep(0.1, 0.25, dot(c, c)));",
    "  gl_FragColor = vec4(v, v, v, 1.0);",
    "}"
  ].join("\n");

  function compile(type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(log);
    }
    return shader;
  }

  function link(withDisp) {
    var program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, (withDisp ? "#define USE_DISP\n" : "") + VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(program, 0, "aA");
    gl.bindAttribLocation(program, 1, "aS");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    return program;
  }

  var program;
  try {
    program = link(useDisp);
  } catch (error) {
    try {
      useDisp = false;
      program = link(false);
    } catch (fatal) {
      root.classList.add("no-webgl");
      return;
    }
  }
  gl.useProgram(program);
  var U = {};
  ["uRes", "uDpr", "uTime", "uScroll", "uK", "uRot", "uDust", "uDisperse", "uMouse", "uCell", "uDisp"]
    .forEach(function (name) { U[name] = gl.getUniformLocation(program, name); });

  // -------------------------------------------------------------- particles
  var compact = Math.min(window.screen.width, window.screen.height) < 700;
  // Dust per CSS px² of screen; the draw count follows the window, the buffer
  // is sized for the whole screen so a resize never reallocates.
  var DUST_DENSITY = compact ? 0.26 : 0.24;
  var screenArea = Math.max(window.screen.width * window.screen.height, window.innerWidth * window.innerHeight);
  var nDust = Math.min(compact ? 240000 : 900000, Math.round(screenArea * DUST_DENSITY));
  var nK = compact ? 70000 : 190000;
  var nKOutline = Math.round(nK * 0.62);
  var buffer = gl.createBuffer();
  var total = 0;

  function buildParticles(mask) {
    total = nDust + (mask ? nK : 0);
    var pos = new Float32Array(total * 4);
    var seed = new Float32Array(total);
    var i;
    for (i = 0; i < nDust; i += 1) {
      pos[i * 4] = Math.random();
      pos[i * 4 + 1] = Math.random();
      pos[i * 4 + 2] = Math.pow(Math.random(), 1.7);
      pos[i * 4 + 3] = 0;
      seed[i] = Math.random();
    }
    if (mask) {
      for (i = 0; i < nK; i += 1) {
        var outline = i < nKOutline;
        var list = outline ? mask.outline : mask.body;
        if (!list.length) list = mask.outline;
        var index = list[(Math.random() * list.length) | 0];
        var px = index % mask.w + Math.random();
        var py = (index / mask.w | 0) + Math.random();
        var j = nDust + i;
        pos[j * 4] = (px - mask.w * 0.5) / mask.h;
        pos[j * 4 + 1] = (mask.h * 0.5 - py) / mask.h;
        pos[j * 4 + 2] = (Math.random() - 0.5) * (outline ? 0.05 : 0.03);
        pos[j * 4 + 3] = outline ? 1 : 2;
        seed[j] = Math.random();
      }
    }
    // Interleave: [x, y, z, kind, seed]. Particles of each kind are in random
    // order, so drawing a prefix of a range is a uniform subsample.
    var data = new Float32Array(total * 5);
    for (i = 0; i < total; i += 1) {
      data[i * 5] = pos[i * 4];
      data[i * 5 + 1] = pos[i * 4 + 1];
      data[i * 5 + 2] = pos[i * 4 + 2];
      data[i * 5 + 3] = pos[i * 4 + 3];
      data[i * 5 + 4] = seed[i];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16);
  }

  // The K: its strokes become the outline cloud, the regions they enclose
  // (found by flood-filling the outside) the fainter body.
  function sampleMark(image) {
    var w = image.naturalWidth;
    var h = image.naturalHeight;
    var scratch = document.createElement("canvas");
    scratch.width = w;
    scratch.height = h;
    var context = scratch.getContext("2d");
    context.drawImage(image, 0, 0);
    var alpha = context.getImageData(0, 0, w, h).data;
    var n = w * h;
    var solid = new Uint8Array(n);
    for (var i = 0; i < n; i += 1) solid[i] = alpha[i * 4 + 3] > 127 ? 1 : 0;
    var outside = new Uint8Array(n);
    var queue = new Int32Array(n);
    var head = 0;
    var tail = 0;
    function push(index) {
      if (!solid[index] && !outside[index]) {
        outside[index] = 1;
        queue[tail++] = index;
      }
    }
    for (var x = 0; x < w; x += 1) { push(x); push((h - 1) * w + x); }
    for (var y = 0; y < h; y += 1) { push(y * w); push(y * w + w - 1); }
    while (head < tail) {
      var at = queue[head++];
      var cx = at % w;
      if (cx > 0) push(at - 1);
      if (cx < w - 1) push(at + 1);
      if (at >= w) push(at - w);
      if (at < n - w) push(at + w);
    }
    var outlineList = [];
    var bodyList = [];
    for (var k = 0; k < n; k += 1) {
      if (solid[k]) outlineList.push(k);
      else if (!outside[k]) bodyList.push(k);
    }
    return { w: w, h: h, outline: outlineList, body: bodyList };
  }

  // ----------------------------------------------------------- cut grid
  var CELL = compact ? 10 : 12;
  var SDMAX = 48;          // px, signed-distance range stored per cell
  var grid = { w: 0, h: 0, cw: 1, ch: 1 };
  var dX, dY, vX, vY, cutA, cutV, sdist, texels;
  var gridActive = false;
  var gridDirty = true;
  var texture = gl.createTexture();

  function allocGrid() {
    grid.w = Math.max(8, Math.min(256, Math.ceil(width / CELL)));
    grid.h = Math.max(8, Math.min(256, Math.ceil(height / CELL)));
    grid.cw = width / grid.w;
    grid.ch = height / grid.h;
    var n = grid.w * grid.h;
    dX = new Float32Array(n); dY = new Float32Array(n);
    vX = new Float32Array(n); vY = new Float32Array(n);
    cutA = new Float32Array(n); cutV = new Float32Array(n);
    sdist = new Float32Array(n);
    for (var i = 0; i < n; i += 1) sdist[i] = SDMAX;
    texels = new Uint8Array(n * 4);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gridActive = false;
    gridDirty = true;
    encodeGrid();
  }

  function encodeGrid() {
    var n = grid.w * grid.h;
    for (var i = 0; i < n; i += 1) {
      var o = i * 4;
      // sqrt encoding: fine steps near zero, where a healing cut settles.
      var ex = dX[i] / 160;
      var ey = dY[i] / 160;
      ex = ex > 0 ? Math.sqrt(Math.min(ex, 1)) : -Math.sqrt(Math.min(-ex, 1));
      ey = ey > 0 ? Math.sqrt(Math.min(ey, 1)) : -Math.sqrt(Math.min(-ey, 1));
      texels[o] = Math.round((ex * 0.5 + 0.5) * 255);
      texels[o + 1] = Math.round((ey * 0.5 + 0.5) * 255);
      texels[o + 2] = Math.round(Math.max(0, Math.min(1, cutA[i])) * 255);
      texels[o + 3] = Math.round((Math.max(-1, Math.min(1, sdist[i] / SDMAX)) * 0.5 + 0.5) * 255);
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, grid.w, grid.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, texels);
    gridDirty = false;
  }

  var segments = [];

  function applySegment(x0, y0, x1, y1, seconds) {
    var sx = x1 - x0;
    var sy = y1 - y0;
    var length = Math.sqrt(sx * sx + sy * sy);
    if (length < 0.5) return;
    var speed = Math.min(4200, length / Math.max(seconds, 0.008)) / 1000;
    if (speed < 0.12) return;
    var tx = sx / length;
    var ty = sy / length;
    var nx = -ty;
    var ny = tx;
    var cutR = 18 + 6 * speed;
    var wakeR = 46 + 12 * speed;
    var reach = Math.max(wakeR * 1.8, SDMAX);
    var i0 = Math.max(0, Math.floor((Math.min(x0, x1) - reach) / grid.cw));
    var i1 = Math.min(grid.w - 1, Math.ceil((Math.max(x0, x1) + reach) / grid.cw));
    var j0 = Math.max(0, Math.floor((Math.min(y0, y1) - reach) / grid.ch));
    var j1 = Math.min(grid.h - 1, Math.ceil((Math.max(y0, y1) + reach) / grid.ch));
    // Superlinear in speed: an ordinary pass nudges the dots, a flick cuts.
    var cutGain = (reduced ? 0.4 : 1.15) * Math.pow(speed, 1.6);
    for (var j = j0; j <= j1; j += 1) {
      var cy = (j + 0.5) * grid.ch;
      for (var i = i0; i <= i1; i += 1) {
        var cx = (i + 0.5) * grid.cw;
        var rx = cx - x0;
        var ry = cy - y0;
        var along = rx * tx + ry * ty;
        var clampAlong = along < 0 ? 0 : along > length ? length : along;
        var ox = rx - tx * clampAlong;
        var oy = ry - ty * clampAlong;
        var d2 = ox * ox + oy * oy;
        if (d2 > reach * reach) continue;
        var k = j * grid.w + i;
        var across = ox * nx + oy * ny;
        var wc = Math.exp(-d2 / (cutR * cutR));
        if (wc > 0.02) {
          cutV[k] += wc * cutGain;
          if (Math.abs(across) < SDMAX && (wc > 0.2 || cutA[k] < 0.05)) sdist[k] = across;
        }
        var ww = Math.exp(-d2 / (wakeR * wakeR)) * speed;
        vX[k] += tx * ww * 70;
        vY[k] += ty * ww * 70;
      }
    }
    gridActive = true;
  }

  function stepGrid(dt) {
    var n = grid.w * grid.h;
    var energy = 0;
    // Spring-dampers: cut (k 3.2, c 2.7 — ζ≈0.75, heals in ~2.5 s) and
    // wake (k 5, c 3.1).
    for (var i = 0; i < n; i += 1) {
      var a = cutA[i];
      var av = cutV[i] + (-3.2 * a - 2.7 * cutV[i]) * dt;
      a += av * dt;
      if (a < 0) { a = 0; if (av < 0) av *= 0.3; }
      cutA[i] = a;
      cutV[i] = av;
      var vx = vX[i] + (-5 * dX[i] - 3.1 * vX[i]) * dt;
      var vy = vY[i] + (-5 * dY[i] - 3.1 * vY[i]) * dt;
      vX[i] = vx;
      vY[i] = vy;
      dX[i] += vx * dt;
      dY[i] += vy * dt;
      energy += a + Math.abs(av) + Math.abs(dX[i]) + Math.abs(dY[i]) + Math.abs(vx) + Math.abs(vy);
    }
    if (energy < 0.02 * n * 0.01) {
      for (var z = 0; z < n; z += 1) {
        dX[z] = dY[z] = vX[z] = vY[z] = cutA[z] = cutV[z] = 0;
      }
      gridActive = false;
    }
    gridDirty = true;
  }

  // --------------------------------------------------------------- state
  var width = 1;
  var height = 1;
  var visible = 1;
  var dpr = 1;
  var quality = 1;
  var time = Math.random() * 100;
  var last = 0;
  var frame = 0;
  var running = false;
  var ready = false;

  var scene = document.body.getAttribute("data-page") === "home" ? "home" : "page";
  var kIntensity = 0;
  var dustIntensity = 0;
  var disperse = reduced ? 0 : 1;
  var disperseTarget = 0;
  var pointer = { x: -9999, y: -9999, sx: 0.5, sy: 0.5, halo: 0, active: false, t: 0, has: false };
  var scrollY = window.scrollY || 0;
  var smoothScroll = scrollY;

  function sceneTargets() {
    var home = scene === "home";
    return { k: home ? 1 : 0.42, dust: home ? 1 : 0.8 };
  }

  function kPlacement() {
    if (width < 761) {
      var hPhone = Math.min(visible * 0.7, width * 1.75);
      return [width * 0.52, visible * 0.5, hPhone];
    }
    return [width * 0.47, visible * 0.48, visible * 0.9];
  }

  function resize() {
    width = Math.max(1, canvas.clientWidth || window.innerWidth);
    height = Math.max(1, canvas.clientHeight || window.innerHeight);
    visible = Math.min(height, window.innerHeight || height);
    dpr = Math.min(window.devicePixelRatio || 1, compact ? 3 : 2);
    var bw = Math.round(width * dpr);
    var bh = Math.round(height * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    gl.viewport(0, 0, bw, bh);
    allocGrid();
  }

  // ------------------------------------------------------------ rendering
  var frameAvg = 16;
  var slowFrames = 0;

  function render(now) {
    frame = window.requestAnimationFrame(render);
    if (!last) last = now;
    var dt = Math.min(0.05, (now - last) / 1000);
    if (dt < 0.012) return; // ~60 fps is plenty for motion this slow
    last = now;

    // Quality: sustained slow frames thin the cloud (never below 35 %).
    frameAvg += (dt * 1000 - frameAvg) * 0.05;
    if (frameAvg > 24) slowFrames += 1; else slowFrames = Math.max(0, slowFrames - 2);
    if (slowFrames > 90 && quality > 0.35) {
      quality *= 0.82;
      slowFrames = 0;
    }

    time += dt * (reduced ? 0.12 : 1);
    if (time > 5000) time -= 5000;
    var targets = sceneTargets();
    var ease = 1 - Math.exp(-dt * 1.6);
    kIntensity += (targets.k - kIntensity) * ease;
    dustIntensity += (targets.dust - dustIntensity) * ease;
    disperse += (disperseTarget - disperse) * (1 - Math.exp(-dt * (disperseTarget > disperse ? 6 : 1.4)));
    smoothScroll += (scrollY - smoothScroll) * (1 - Math.exp(-dt * 6));

    // Pointer: segments since the last frame cut the grid; the halo follows.
    if (useDisp && segments.length) {
      for (var s = 0; s < segments.length; s += 1) {
        var seg = segments[s];
        applySegment(seg[0], seg[1], seg[2], seg[3], seg[4]);
      }
      segments.length = 0;
    }
    if (useDisp && gridActive) stepGrid(dt);
    if (useDisp && gridDirty) encodeGrid();
    pointer.halo += ((pointer.active ? 1 : 0) - pointer.halo) * (1 - Math.exp(-dt * 3));
    if (pointer.has) {
      pointer.sx += (pointer.x / width - pointer.sx) * (1 - Math.exp(-dt * 1.2));
      pointer.sy += (pointer.y / visible - pointer.sy) * (1 - Math.exp(-dt * 1.2));
    }

    var place = kPlacement();
    var motion = reduced ? 0.2 : 1;
    var yaw = Math.sin(time * 0.07) * 0.2 * motion + (pointer.sx - 0.5) * 0.14;
    var pitch = Math.sin(time * 0.05 + 1.1) * 0.05 * motion + (pointer.sy - 0.5) * -0.08;
    var bob = Math.sin(time * 0.31) * 5 * motion;

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniform2f(U.uRes, width, height);
    gl.uniform1f(U.uDpr, dpr);
    gl.uniform1f(U.uTime, time);
    gl.uniform1f(U.uScroll, smoothScroll);
    gl.uniform4f(U.uK, place[0], place[1] + bob, place[2], kIntensity);
    gl.uniform3f(U.uRot, yaw, pitch, 0);
    gl.uniform1f(U.uDust, dustIntensity);
    gl.uniform1f(U.uDisperse, disperse);
    gl.uniform3f(U.uMouse, pointer.x, pointer.y, pointer.halo);
    gl.uniform2f(U.uCell, grid.cw, grid.ch);
    if (useDisp) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(U.uDisp, 0);
    }
    var dustDraw = Math.min(nDust, Math.round(width * height * DUST_DENSITY * quality));
    if (dustDraw > 0) gl.drawArrays(gl.POINTS, 0, dustDraw);
    if (total > nDust) {
      var kDraw = Math.round(nK * Math.max(0.5, quality));
      gl.drawArrays(gl.POINTS, nDust, kDraw);
    }
    if (!ready) {
      ready = true;
      root.classList.add("field-ready");
    }
  }

  function start() {
    if (running || document.hidden) return;
    running = true;
    last = 0;
    frame = window.requestAnimationFrame(render);
  }

  function stop() {
    running = false;
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
  }

  // -------------------------------------------------------------- input
  function pointAt(x, y, now) {
    // Events arrive further apart on a busy device; a gap up to 300 ms still
    // counts as one stroke, with its speed measured over the real gap.
    if (pointer.has && now - pointer.t < 300 && pointer.x > -9000) {
      segments.push([pointer.x, pointer.y, x, y, (now - pointer.t) / 1000]);
      if (segments.length > 64) segments.shift();
    }
    pointer.x = x;
    pointer.y = y;
    pointer.t = now;
    pointer.has = true;
    pointer.active = true;
  }

  window.addEventListener("pointermove", function (event) {
    if (event.pointerType === "touch") return;
    pointAt(event.clientX, event.clientY, event.timeStamp || performance.now());
  }, { passive: true });
  window.addEventListener("touchstart", function (event) {
    var touch = event.touches[0];
    if (!touch) return;
    pointer.has = false;
    pointAt(touch.clientX, touch.clientY, event.timeStamp || performance.now());
  }, { passive: true });
  window.addEventListener("touchmove", function (event) {
    var touch = event.touches[0];
    if (touch) pointAt(touch.clientX, touch.clientY, event.timeStamp || performance.now());
  }, { passive: true });
  window.addEventListener("touchend", function () { pointer.active = false; }, { passive: true });
  document.addEventListener("mouseleave", function () {
    pointer.active = false;
    pointer.has = false;
  });
  window.addEventListener("scroll", function () { scrollY = window.scrollY || 0; }, { passive: true });

  var resizeTimer = 0;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  }, { passive: true });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else start();
  });

  canvas.addEventListener("webglcontextlost", function (event) {
    event.preventDefault();
    stop();
  });
  canvas.addEventListener("webglcontextrestored", function () {
    window.location.reload();
  });

  // ---------------------------------------------------------------- api
  api.setScene = function (name) {
    scene = name === "home" ? "home" : "page";
  };
  // Page changes scatter the K into the dust and let it re-form.
  api.disperse = function (on) {
    disperseTarget = on && !reduced ? 0.6 : 0;
  };

  // ---------------------------------------------------------------- boot
  resize();
  var mark = new Image();
  mark.decoding = "async";
  mark.onload = function () {
    var sampled = null;
    try { sampled = sampleMark(mark); } catch (error) { sampled = null; }
    buildParticles(sampled);
    start();
  };
  mark.onerror = function () {
    buildParticles(null);
    start();
  };
  mark.src = canvas.getAttribute("data-mark") || "assets/brand/k-mark.png";
})();
