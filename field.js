/* Background field.
 *
 * One WebGL point cloud, drawn additively on black: fine dust over the whole
 * screen in three depth layers. It is never still:
 *   - currents: every dot is carried by the curl of a slowly evolving stream
 *     function (a sum of travelling plane waves), so the dust swirls in
 *     eddies like smoke, and the cores of the eddies, where vorticity peaks,
 *     shimmer faintly;
 *   - depth: near dots are larger, brighter and shift more with the pointer
 *     and with scrolling;
 *   - ripples: a click or tap sends a shock ring through the dust;
 *   - the pointer: a moving cursor stirs the dust around it, and a fast
 *     stroke slashes it.
 *
 * The slash lives on a coarse CPU grid of spring-dampers holding, per cell,
 * a wake (smooth displacement) and a cut (opening amplitude plus signed
 * distance to the cut line). The vertex shader samples the grid: the sign of
 * the distance says which side of the cut a dot is on, its gradient which way
 * to move, so both sides part cleanly along the line, and the cut heals.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("field");
  if (!canvas) return;

  var root = document.documentElement;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var api = { setScene: function () {}, pulse: function () {} };
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
  var RIPPLES = 4;

  // ---------------------------------------------------------------- shaders
  var VERT = [
    "precision highp float;",
    "attribute vec4 aA;",          // x, y (0..1), depth (0..1), unused
    "attribute float aS;",         // seed 0..1
    "uniform vec2 uRes;",          // canvas size, CSS px
    "uniform float uPad;",         // dust margin past every edge, CSS px
    "uniform float uDpr;",
    "uniform float uTime;",
    "uniform float uScroll;",
    "uniform float uDust;",        // overall intensity
    "uniform float uFlow;",        // current strength (gusts raise it)
    "uniform float uReveal;",      // intro radius, px (large = done)
    "uniform vec2 uParallax;",     // smoothed pointer offset, -0.5..0.5
    "uniform vec3 uMouse;",        // x, y, stir strength
    "uniform vec4 uRip[" + RIPPLES + "];", // x, y, age s, strength
    "uniform vec2 uCell;",         // one grid cell, CSS px
    "uniform sampler2D uDisp;",
    "varying float vA;",
    "float h(float n) { return fract(sin(n) * 43758.5453123); }",
    // Stream function psi = sum a sin(k.x + w t + f). Returns curl psi (the
    // divergence-free current) and the vorticity -laplacian psi.
    "vec3 flow(vec2 x, float t) {",
    "  vec3 r = vec3(0.0);",
    "  float ph;",
    "  float c;",
    "  float s;",
    "#define WAVE(kx, ky, w, a, f) ph = kx * x.x + ky * x.y + w * t + f; c = cos(ph); s = sin(ph); r.xy += a * c * vec2(ky, -kx); r.z += a * (kx * kx + ky * ky) * s;",
    "  WAVE( 2.1,  1.3, 0.100, 0.0130, 0.0)",
    "  WAVE(-1.4,  2.4, 0.075, 0.0130, 1.7)",
    "  WAVE( 0.9, -2.6, 0.085, 0.0100, 3.3)",
    "  WAVE( 4.9, -3.1, 0.160, 0.0036, 4.1)",
    "  WAVE( 2.7,  5.6, 0.140, 0.0036, 2.3)",
    "  WAVE(-6.2, -2.2, 0.150, 0.0032, 5.9)",
    "  WAVE(-9.3,  7.2, 0.260, 0.0010, 0.9)",
    "  WAVE( 6.1, 11.4, 0.300, 0.0010, 5.3)",
    "  return r;",
    "}",
    "void main() {",
    "  float s = aS;",
    "  float t = uTime;",
    "  float d = aA.z;",
    "  vec2 q = aA.xy;",
    // The dust is laid out past every edge by uPad: the currents below move
    // it by up to ~15 % of the screen height, and wherever they flow inward
    // from an edge there must be dust outside to carry in, or a bare strip
    // opens along that edge (on a narrow phone, a large share of the screen).
    "  vec2 span = uRes + 2.0 * uPad;",
    // Slow drift, faster for near dots, plus scroll parallax.
    "  q += vec2(0.0016 + 0.0034 * d, -0.0008 - 0.0012 * d) * t * uRes / span;",
    "  q.y -= uScroll / span.y * (0.03 + 0.1 * d);",
    "  q = fract(q);",
    "  vec2 p = q * span - uPad;",
    // Currents, evaluated in screen-height units so eddies stay round.
    "  vec2 x = p / uRes.y;",
    "  vec3 f = flow(x, t);",
    "  p += f.xy * uRes.y * uFlow * (0.55 + 0.7 * d);",
    "  p += uParallax * (d - 0.35) * 34.0;",
    "  float size = 0.5 + 1.0 * d * d;",
    "  float a = (0.019 + 0.135 * d) * (0.55 + 0.45 * sin(t * (0.3 + 1.1 * h(s * 3.1)) + s * 97.0));",
    // Eddy cores shimmer: brighter where the vorticity peaks.
    "  a *= 1.0 + 0.9 * smoothstep(0.12, 0.28, abs(f.z)) * (0.6 + 0.4 * sin(t * 0.7 + s * 30.0));",
    "  if (s > 0.994) { a = a * 2.2 + 0.07; size *= 1.3; }",
    "  a *= uDust;",
    "  for (int i = 0; i < " + RIPPLES + "; i++) {",
    "    vec4 r = uRip[i];",
    "    if (r.w > 0.0) {",
    "      vec2 dv = p - r.xy;",
    "      float dist = length(dv) + 0.001;",
    "      float front = r.z * 560.0;",
    "      float ring = exp(-pow((dist - front) / 64.0, 2.0)) * r.w * exp(-r.z * 1.1);",
    "      p += dv / dist * ring * (18.0 + 22.0 * d);",
    "      a *= 1.0 + ring * 1.4;",
    "    }",
    "  }",
    "#ifdef USE_DISP",
    "  vec2 uv = clamp(p / uRes, 0.0, 1.0);",
    "  vec4 g = texture2D(uDisp, uv);",
    "  vec2 e = g.rg * 2.0 - 1.0;",
    "  vec2 disp = sign(e) * e * e * 160.0;",
    "  float cut = g.b;",
    "  if (cut > 0.004) {",
    "    vec2 du = vec2(uCell.x / uRes.x, 0.0);",
    "    vec2 dvv = vec2(0.0, uCell.y / uRes.y);",
    "    vec2 n = vec2(texture2D(uDisp, uv + du).a - texture2D(uDisp, uv - du).a,",
    "                  texture2D(uDisp, uv + dvv).a - texture2D(uDisp, uv - dvv).a);",
    "    float nl = length(n);",
    "    if (nl > 0.00001) {",
    "      float side = g.a >= 0.5 ? 1.0 : -1.0;",
    "      disp += n / nl * side * cut * 84.0 * (0.75 + 0.5 * h(s * 41.0));",
    "    }",
    "  }",
    "  p += disp * (0.85 + 0.3 * h(s * 71.3));",
    "  a *= 1.0 + 1.6 * cut;",
    "#endif",
    // The cursor pushes the dust aside and, while moving, stirs it round.
    "  vec2 dm = p - uMouse.xy;",
    "  float dl2 = dot(dm, dm);",
    "  float inv = inversesqrt(dl2 + 1.0);",
    "  p += dm * inv * (4.0 + 10.0 * uMouse.z) * exp(-dl2 / 2600.0);",
    "  p += vec2(-dm.y, dm.x) * inv * uMouse.z * 16.0 * exp(-dl2 / 9000.0);",
    // Intro: the dust appears behind a front expanding from the centre.
    "  float rd = length(p - uRes * vec2(0.5, 0.46));",
    "  float edge = uReveal - rd;",
    "  a *= smoothstep(-40.0, 60.0, edge) * (1.0 + 2.2 * exp(-edge * edge / 3000.0));",
    "  vec2 cl = p / uRes * 2.0 - 1.0;",
    "  gl_Position = vec4(cl.x, -cl.y, 0.0, 1.0);",
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
  ["uRes", "uPad", "uDpr", "uTime", "uScroll", "uDust", "uFlow", "uReveal", "uParallax", "uMouse", "uCell", "uDisp"]
    .forEach(function (name) { U[name] = gl.getUniformLocation(program, name); });
  U.uRip = gl.getUniformLocation(program, "uRip[0]") || gl.getUniformLocation(program, "uRip");

  // -------------------------------------------------------------- particles
  var compact = Math.min(window.screen.width, window.screen.height) < 700;
  // Dust per CSS px², over the window plus its margin; the draw count follows
  // the window, the buffer is sized for the whole screen (either way up) so a
  // resize or rotation never reallocates.
  var DUST_DENSITY = compact ? 0.5 : 0.48;
  function margin(h) {
    return Math.round(h * 0.12 + 28);
  }
  var screenW = Math.max(window.screen.width, window.innerWidth);
  var screenH = Math.max(window.screen.height, window.innerHeight);
  var screenPad = margin(Math.max(screenW, screenH));
  var screenArea = (screenW + 2 * screenPad) * (screenH + 2 * screenPad);
  var nDust = Math.min(compact ? 480000 : 2000000, Math.round(screenArea * DUST_DENSITY));

  (function buildParticles() {
    // Interleaved [x, y, depth, 0, seed], in random order, so drawing a
    // prefix is a uniform subsample.
    var data = new Float32Array(nDust * 5);
    for (var i = 0; i < nDust; i += 1) {
      var o = i * 5;
      data[o] = Math.random();
      data[o + 1] = Math.random();
      data[o + 2] = Math.pow(Math.random(), 1.8);
      data[o + 4] = Math.random();
    }
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16);
  })();

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
    // Superlinear in speed: an ordinary pass stirs the dust, a flick cuts.
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
    if (energy < 0.0002 * n) {
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
  var pad = 0;
  var visible = 1;
  var dpr = 1;
  var quality = 1;
  var time = Math.random() * 200;
  var last = 0;
  var frame = 0;
  var running = false;
  var ready = false;

  var scene = document.body.getAttribute("data-page") === "home" ? "home" : "page";
  var intensity = 0;
  var gust = 0;
  var reveal = reduced ? 1e5 : 0;
  var ripples = [];
  var rippleData = new Float32Array(RIPPLES * 4);
  var pointer = { x: -9999, y: -9999, px: 0, py: 0, stir: 0, speed: 0, t: 0, has: false };
  var scrollY = window.scrollY || 0;
  var smoothScroll = scrollY;

  function resize() {
    width = Math.max(1, canvas.clientWidth || window.innerWidth);
    height = Math.max(1, canvas.clientHeight || window.innerHeight);
    pad = margin(height);
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

  function addRipple(x, y, strength) {
    if (reduced) return;
    ripples.push({ x: x, y: y, age: 0, strength: strength });
    if (ripples.length > RIPPLES) ripples.shift();
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

    // Quality: sustained slow frames thin the dust (never below 35 %).
    frameAvg += (dt * 1000 - frameAvg) * 0.05;
    if (frameAvg > 24) slowFrames += 1; else slowFrames = Math.max(0, slowFrames - 2);
    if (slowFrames > 90 && quality > 0.35) {
      quality *= 0.82;
      slowFrames = 0;
    }

    time += dt * (reduced ? 0.12 : 1);
    if (time > 20000) time -= 20000;
    var target = scene === "home" ? 1 : 0.72;
    intensity += (target - intensity) * (1 - Math.exp(-dt * 1.4));
    gust *= Math.exp(-dt * 0.9);
    if (reveal < 1e5) {
      reveal += dt * (320 + reveal * 1.1);
      if (reveal > Math.sqrt(width * width + height * height) + 400) reveal = 1e5;
    }
    smoothScroll += (scrollY - smoothScroll) * (1 - Math.exp(-dt * 6));

    // Pointer: segments since the last frame cut the grid.
    if (useDisp && segments.length) {
      for (var s = 0; s < segments.length; s += 1) {
        var seg = segments[s];
        applySegment(seg[0], seg[1], seg[2], seg[3], seg[4]);
      }
      segments.length = 0;
    }
    if (useDisp && gridActive) stepGrid(dt);
    if (useDisp && gridDirty) encodeGrid();
    pointer.speed *= Math.exp(-dt * 4);
    pointer.stir += (Math.min(1, pointer.speed / 900) - pointer.stir) * (1 - Math.exp(-dt * 5));
    if (pointer.has) {
      pointer.px += ((pointer.x / width - 0.5) - pointer.px) * (1 - Math.exp(-dt * 1.5));
      pointer.py += ((pointer.y / visible - 0.5) - pointer.py) * (1 - Math.exp(-dt * 1.5));
    }

    for (var r = ripples.length - 1; r >= 0; r -= 1) {
      ripples[r].age += dt;
      if (ripples[r].age > 3.2) ripples.splice(r, 1);
    }
    for (var q = 0; q < RIPPLES; q += 1) {
      var ripple = ripples[q];
      rippleData[q * 4] = ripple ? ripple.x : 0;
      rippleData[q * 4 + 1] = ripple ? ripple.y : 0;
      rippleData[q * 4 + 2] = ripple ? ripple.age : 0;
      rippleData[q * 4 + 3] = ripple ? ripple.strength : 0;
    }

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniform2f(U.uRes, width, height);
    gl.uniform1f(U.uPad, pad);
    gl.uniform1f(U.uDpr, dpr);
    gl.uniform1f(U.uTime, time);
    gl.uniform1f(U.uScroll, smoothScroll);
    gl.uniform1f(U.uDust, intensity);
    gl.uniform1f(U.uFlow, (reduced ? 0.4 : 1) * (1 + gust));
    gl.uniform1f(U.uReveal, reveal);
    gl.uniform2f(U.uParallax, pointer.px, pointer.py);
    gl.uniform3f(U.uMouse, pointer.x, pointer.y, pointer.stir);
    gl.uniform4fv(U.uRip, rippleData);
    gl.uniform2f(U.uCell, grid.cw, grid.ch);
    if (useDisp) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(U.uDisp, 0);
    }
    var count = Math.min(nDust, Math.round((width + 2 * pad) * (height + 2 * pad) * DUST_DENSITY * quality));
    if (count > 0) gl.drawArrays(gl.POINTS, 0, count);
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
      var seconds = Math.max(0.008, (now - pointer.t) / 1000);
      var moved = Math.sqrt((x - pointer.x) * (x - pointer.x) + (y - pointer.y) * (y - pointer.y));
      pointer.speed = Math.max(pointer.speed, moved / seconds);
      segments.push([pointer.x, pointer.y, x, y, seconds]);
      if (segments.length > 64) segments.shift();
    }
    pointer.x = x;
    pointer.y = y;
    pointer.t = now;
    pointer.has = true;
  }

  window.addEventListener("pointermove", function (event) {
    if (event.pointerType === "touch") return;
    pointAt(event.clientX, event.clientY, event.timeStamp || performance.now());
  }, { passive: true });
  window.addEventListener("pointerdown", function (event) {
    addRipple(event.clientX, event.clientY, event.pointerType === "touch" ? 0.8 : 1);
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
  document.addEventListener("mouseleave", function () {
    pointer.has = false;
    pointer.x = pointer.y = -9999;
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
  // Page changes: a strong ring from where the visitor clicked, and a gust
  // through the currents.
  api.pulse = function (x, y) {
    addRipple(typeof x === "number" ? x : width * 0.5, typeof y === "number" ? y : visible * 0.5, 1.6);
    if (!reduced) gust = Math.min(2.5, gust + 1.6);
  };

  resize();
  start();
})();
