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
 *   - ripples: a click or tap sends a ring through the dust;
 *   - the pointer: the cursor presses the dust aside, and moving it (or a
 *     finger) cuts the dust like a blade through a soft solid.
 *
 * A cut is a crack along the stroke. Its faces part behind the blade with the
 * square-root opening of a crack tip, the blade drags the grains along and
 * they spring back, the crack closes behind a blade that keeps moving, and
 * once it stops, what is still open closes from both tips inward. Every
 * closed stretch leaves a weld seam that fades. The cracks are painted every frame into a
 * fine grid texture (signed distance to the crack, opening, seam, drag); the
 * vertex shader moves each dot off the line on its own side, so the cut stays
 * a clean, thin line.
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
  var SDMAX = 40;   // px, signed-distance range stored per grid cell
  var OMAX = 8;     // px, largest crack opening per face
  var DRAGMAX = 5;  // px, largest drag along a cut

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
    // A second, slower wave field that folds the currents' own coordinates
    // (domain warping): the eddies stretch, twist and wrap around each other
    // instead of repeating as clean rolls.
    "vec2 warp(vec2 x, float t) {",
    "  return vec2(sin(1.7 * x.y + 0.21 * t + 1.3), cos(1.9 * x.x - 0.17 * t + 0.4))",
    "    + 0.5 * vec2(sin(3.9 * x.y - 0.33 * t + 4.2), cos(3.3 * x.x + 0.29 * t + 2.8))",
    "    + 0.25 * vec2(sin(7.1 * x.x + 5.3 * x.y + 0.47 * t), cos(6.3 * x.y - 4.7 * x.x - 0.41 * t));",
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
    "  vec3 f = flow(x + warp(x, t) * 0.07, t);",
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
    "      float ring = exp(-pow((dist - front) / 64.0, 2.0)) * r.w * exp(-r.z * 1.1) * (1.0 - smoothstep(2.4, 3.2, r.z));",
    "      p += dv / dist * ring * (14.0 + 16.0 * d);",
    "      a *= 1.0 + ring * 0.9;",
    "    }",
    "  }",
    "#ifdef USE_DISP",
    "  vec2 uv = clamp(p / uRes, 0.0, 1.0);",
    "  vec4 g = texture2D(uDisp, uv);",
    "  float drag = (g.a * 255.0 - 128.0) / 127.0 * " + DRAGMAX.toFixed(1) + ";",
    "  if (g.g > 0.002 || g.b > 0.004 || abs(drag) > 0.03) {",
    "    vec2 du = vec2(uCell.x / uRes.x, 0.0);",
    "    vec2 dv = vec2(0.0, uCell.y / uRes.y);",
    // The gradient of the signed distance is the crack normal. Where two
    // cracks' fields meet, the distance jumps instead of running through
    // zero; its gradient there is far from 1, and nothing moves.
    "    vec2 gr = vec2(texture2D(uDisp, uv + du).r - texture2D(uDisp, uv - du).r,",
    "                   texture2D(uDisp, uv + dv).r - texture2D(uDisp, uv - dv).r) * " + SDMAX.toFixed(1) + " / uCell;",
    "    float gm = length(gr);",
    "    float ok = smoothstep(0.3, 0.6, gm) * (1.0 - smoothstep(1.35, 1.9, gm));",
    "    vec2 n = gr / max(gm, 0.0001);",
    "    float sd = (g.r * 2.0 - 1.0) * " + SDMAX.toFixed(1) + ";",
    "    float r = abs(sd);",
    "    float open = g.g * " + OMAX.toFixed(1) + " * ok;",
    // Each face moves off the line on its own side, most at the face and
    // fading into the bulk, so the grains bank up along the lips. Every
    // grain sits a little deeper or shallower in its face: the lips are
    // granular, not ruled.
    "    p += n * (sd >= 0.0 ? 1.0 : -1.0) * open * exp(-r / 18.0) * (0.9 + 0.2 * h(s * 41.0));",
    // The blade drags both faces along the cut.
    "    p += vec2(n.y, -n.x) * drag * ok * exp(-r / 11.0);",
    // A faint lip on each face and, where the crack has closed, a hairline
    // weld seam.
    "    a *= 1.0 + 1.1 * min(open / 3.0, 1.0) * exp(-r / 3.0) + 3.4 * g.b * ok * exp(-r / 2.3);",
    "  }",
    "#endif",
    // The cursor presses the dust aside, harder while it moves.
    "  vec2 dm = p - uMouse.xy;",
    "  float dl2 = dot(dm, dm);",
    "  p += dm * inversesqrt(dl2 + 1.0) * (3.0 + 6.0 * uMouse.z) * exp(-dl2 / 2600.0);",
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
    return Math.round(h * 0.14 + 28);
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

  // ---------------------------------------------------------------- cracks
  // Any movement cuts the dust like a blade through a soft solid. The cut is
  // a crack along the stroke (the pointer samples smoothed into a curve and
  // resampled every STEP px), and each point of it follows the mechanics of a
  // cut in an elastic material:
  //   - opening: the faces spring apart behind the blade with a little
  //     overshoot, then hold. Toward either tip the opening falls off as the
  //     square root of the distance to the tip, as at the tip of a crack in
  //     linear elastic fracture mechanics, so the ends are sharp and a short
  //     cut opens less than a long one;
  //   - drag: the blade carries the grains along the cut, and they spring
  //     back past rest before they settle;
  //   - healing: while the blade keeps moving, the cut closes behind it a
  //     fixed time after it was made, so a long stroke trails an open crack
  //     that zips shut from its tail. A beat after the blade leaves, both
  //     tips of what is still open run inward to meet somewhere along it,
  //     while the faces relax. Each stretch that closes leaves a hairline
  //     weld seam, which fades.
  // Every frame the cracks are painted into a fine grid texture the vertex
  // shader samples: per cell, the signed distance to the nearest crack (its
  // zero set is the cut line, which linear filtering keeps sharp), the
  // opening there, the seam, and the drag.
  var CELL = compact ? 5 : 6;
  var REACH = SDMAX;        // px either side of a crack that it moves
  var SEAM_REACH = 12;      // px either side of a closed stretch
  var CUT_SPEED = 0.12;     // px/ms: any ordinary movement cuts...
  var CUT_KEEP = 0.06;      // ...and only a near stop lifts the blade
  var OPEN = 1.2;           // s a stretch stays open while the blade moves on
  var TRAIL = OPEN + 4;     // s of stroke kept: older stretches have faded
  var TIP = compact ? 40 : 56; // px: the tip zone, where the opening grows
  var HOLD = 0.4;           // s a crack stays open after the blade leaves
  var STEP = 10;            // px between crack points
  var MAX_CRACKS = 6;
  var grid = { w: 0, h: 0, cw: 1, ch: 1 };
  var best, texels, strip;
  var painted = null;       // cells painted last frame
  var texture = gl.createTexture();
  var cracks = [];
  var live = null;          // the crack the blade is cutting now
  var clock = 0;            // s, the cracks' own clock

  function blank(k) {
    var o = k * 4;
    texels[o] = 255;        // far away, on the positive side
    texels[o + 1] = 0;
    texels[o + 2] = 0;
    texels[o + 3] = 128;    // no drag
  }

  function allocGrid() {
    grid.w = Math.max(8, Math.min(512, Math.ceil(width / CELL)));
    grid.h = Math.max(8, Math.min(512, Math.ceil(height / CELL)));
    grid.cw = width / grid.w;
    grid.ch = height / grid.h;
    var n = grid.w * grid.h;
    best = new Float32Array(n);
    best.fill(REACH * REACH);
    texels = new Uint8Array(n * 4);
    strip = new Uint8Array(n * 4);
    for (var k = 0; k < n; k += 1) blank(k);
    painted = null;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, grid.w, grid.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, texels);
  }

  function smooth(e0, e1, x) {
    var u = x <= e0 ? 0 : x >= e1 ? 1 : (x - e0) / (e1 - e0);
    return u * u * (3 - 2 * u);
  }

  // Step response of a spring at zeta 0.55: the faces open and overshoot by
  // about an eighth before they settle.
  function opening(t) {
    if (t <= 0) return 0;
    if (t > 0.6) return 1;
    return 1 - Math.exp(-14.3 * t) * (Math.cos(21.71 * t) + 0.659 * Math.sin(21.71 * t));
  }

  // Impulse response at zeta 0.45, scaled to peak at 1: dragged along, then
  // back past rest by a fifth, then still.
  function recoil(t) {
    if (t <= 0 || t > 1) return 0;
    return 1.96 * Math.exp(-8.1 * t) * Math.sin(16.07 * t);
  }

  function newCrack(x, y, v) {
    return {
      rx: [x], ry: [y], rt: [clock], rv: [v], last: clock, dirty: true,
      n: 0, len: 0, heal: -1, T: 1, m: 0, a0: 0, pa: 0, pb: 0
    };
  }

  // Smooth the pointer samples into quadratic curves through their midpoints
  // (the crack runs along the stroke without the kinks of the event rate),
  // then resample every STEP px of arc length.
  function build(c) {
    var rx = c.rx, ry = c.ry, rt = c.rt, rv = c.rv;
    var k = rx.length;
    var X = [rx[0]], Y = [ry[0]], T = [rt[0]], V = [rv[0]];
    function mid(f, i) { return (f[i] + f[i + 1]) * 0.5; }
    if (k === 2) {
      X.push(rx[1]); Y.push(ry[1]); T.push(rt[1]); V.push(rv[1]);
    } else {
      X.push(mid(rx, 0)); Y.push(mid(ry, 0)); T.push(mid(rt, 0)); V.push(mid(rv, 0));
      for (var i = 1; i < k - 1; i += 1) {
        var ax = mid(rx, i - 1), ay = mid(ry, i - 1), bx = mid(rx, i), by = mid(ry, i);
        var ta = mid(rt, i - 1), tb = mid(rt, i), va = mid(rv, i - 1), vb = mid(rv, i);
        var m = Math.max(2, Math.ceil(Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) / 3));
        for (var q = 1; q <= m; q += 1) {
          var u = q / m;
          var w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
          X.push(w0 * ax + w1 * rx[i] + w2 * bx);
          Y.push(w0 * ay + w1 * ry[i] + w2 * by);
          T.push(ta + (tb - ta) * u);
          V.push(va + (vb - va) * u);
        }
      }
      X.push(rx[k - 1]); Y.push(ry[k - 1]); T.push(rt[k - 1]); V.push(rv[k - 1]);
    }
    var total = 0;
    for (var d = 1; d < X.length; d += 1) total += Math.sqrt((X[d] - X[d - 1]) * (X[d] - X[d - 1]) + (Y[d] - Y[d - 1]) * (Y[d] - Y[d - 1]));
    var n = Math.max(2, Math.ceil(total / STEP) + 1);
    c.n = n;
    c.len = total;
    c.x = new Float32Array(n); c.y = new Float32Array(n); c.s = new Float32Array(n);
    c.t = new Float32Array(n); c.amp = new Float32Array(n); c.drag = new Float32Array(n);
    c.open = new Float32Array(n); c.dr = new Float32Array(n); c.seam = new Float32Array(n);
    c.closed = new Float32Array(n).fill(-1);
    var seg = 1, s0 = 0;
    var sl = Math.sqrt((X[1] - X[0]) * (X[1] - X[0]) + (Y[1] - Y[0]) * (Y[1] - Y[0]));
    for (var j = 0; j < n; j += 1) {
      var s = j === n - 1 ? total : j * STEP;
      while (s > s0 + sl && seg < X.length - 1) {
        s0 += sl;
        seg += 1;
        sl = Math.sqrt((X[seg] - X[seg - 1]) * (X[seg] - X[seg - 1]) + (Y[seg] - Y[seg - 1]) * (Y[seg] - Y[seg - 1]));
      }
      var f = sl > 0 ? Math.min(1, Math.max(0, (s - s0) / sl)) : 1;
      c.x[j] = X[seg - 1] + (X[seg] - X[seg - 1]) * f;
      c.y[j] = Y[seg - 1] + (Y[seg] - Y[seg - 1]) * f;
      c.s[j] = s;
      c.t[j] = T[seg - 1] + (T[seg] - T[seg - 1]) * f;
      var v = V[seg - 1] + (V[seg] - V[seg - 1]) * f;
      // A faster blade opens a wider cut and drags harder; even a slow one
      // opens a clear gap.
      c.amp[j] = Math.min(6.4, Math.max(3.2, 2 + 1.1 * v)) * (reduced ? 0.6 : 1);
      c.drag[j] = reduced ? 0 : Math.min(4, 0.9 * v);
    }
    // For painting, runs of points that lie within half a pixel of a straight
    // line (up to 60 px) merge into one segment: far fewer cells to visit,
    // the same crack.
    var knots = [0];
    var from = 0;
    for (var to = 2; to < n; to += 1) {
      var ax = c.x[from], ay = c.y[from];
      var lx = c.x[to] - ax, ly = c.y[to] - ay;
      var ll = Math.sqrt(lx * lx + ly * ly);
      var straight = ll <= 60;
      for (var mi = from + 1; straight && mi < to; mi += 1) {
        straight = Math.abs((c.x[mi] - ax) * ly - (c.y[mi] - ay) * lx) <= 0.5 * ll;
      }
      if (!straight) {
        from = to - 1;
        knots.push(from);
      }
    }
    knots.push(n - 1);
    c.knots = knots;
    c.dirty = false;
  }

  // How far the tail has closed behind a moving blade: to the point cut
  // OPEN seconds ago.
  function trail(c, t) {
    var due = t - OPEN;
    if (c.t[0] > due) return 0;
    for (var j = 1; j < c.n; j += 1) {
      if (c.t[j] > due) return c.s[j - 1] + (c.s[j] - c.s[j - 1]) * (due - c.t[j - 1]) / (c.t[j] - c.t[j - 1]);
    }
    return c.len;
  }

  function release(c) {
    if (live === c) live = null;
    if (c.dirty) build(c);
    c.a0 = trail(c, clock);
    if (c.len - c.a0 < 12) {
      if (c.a0 === 0) {
        var i = cracks.indexOf(c);
        if (i >= 0) cracks.splice(i, 1);
        return;
      }
      c.a0 = c.len;
    }
    // What is still open heals from both ends.
    var rest = c.len - c.a0;
    c.heal = clock + HOLD;
    c.T = 1 + rest / 1200 + Math.random() * 0.2;
    c.m = c.a0 + rest * (0.35 + 0.3 * Math.random());
    c.pa = Math.random() * 6.283;
    c.pb = Math.random() * 6.283;
  }

  function cut(x0, y0, x1, y1, v) {
    if (!live) {
      live = newCrack(x0, y0, v);
      cracks.push(live);
      // Too many at once: the oldest start healing now, and quickly.
      var waiting = 0;
      for (var i = cracks.length - 2; i >= 0; i -= 1) {
        waiting += 1;
        if (waiting >= MAX_CRACKS && cracks[i].heal > clock) {
          cracks[i].heal = clock;
          cracks[i].T = Math.min(cracks[i].T, 0.6);
        }
      }
      if (cracks.length > MAX_CRACKS + 4) cracks.shift();
    }
    live.rx.push(x1); live.ry.push(y1); live.rt.push(clock); live.rv.push(v);
    live.last = clock;
    live.dirty = true;
    // A long stroke keeps only its last few seconds; the rest has healed and
    // its seam faded.
    var drop = 0;
    while (drop < live.rt.length - 2 && (live.rt[drop + 1] < clock - TRAIL || live.rt.length - drop > 900)) drop += 1;
    if (drop) {
      live.rx.splice(0, drop); live.ry.splice(0, drop);
      live.rt.splice(0, drop); live.rv.splice(0, drop);
    }
  }

  // Where the closing tip has run to, 0..1, at heal time u. The tips run on
  // an S-curve with a slight stick-slip, each at its own phase.
  function run(u, phase) {
    u = Math.min(1, Math.max(0, u + 0.022 * Math.sin(31.4 * u + phase) * Math.sin(3.1416 * u)));
    return u * u * u * (u * (u * 6 - 15) + 10);
  }

  // The crack's state now, per point. False once it has healed and its seam
  // has faded.
  function stepCrack(c, t) {
    var L = c.len;
    var a = 0;
    var b = L;
    var healing = c.heal >= 0 && t > c.heal;
    var rel = 1;
    if (c.heal < 0) a = trail(c, t);
    else a = c.a0;
    if (healing) {
      var u = (t - c.heal) / c.T;
      a = c.a0 + run(u, c.pa) * (c.m - c.a0);
      b = L - run(u, c.pb) * (L - c.m);
      u = Math.min(1, u);
      rel = 1 - 0.3 * u * u * (3 - 2 * u);
    }
    var alive = !healing || b > a;
    var tail = healing ? c.a0 : a;  // closed behind the moving blade
    for (var j = 0; j < c.n; j += 1) {
      var s = c.s[j];
      var tip = Math.min(s - a, b - s);
      var age = t - c.t[j];
      var o = 0;
      if (tip > 0) o = c.amp[j] * Math.sqrt(Math.min(1, tip / TIP)) * opening(age) * rel;
      // Closed behind the moving blade: exactly OPEN after it was cut.
      else if (c.closed[j] < 0 && (healing || s < a)) c.closed[j] = s < tail ? Math.min(t, c.t[j] + OPEN) : t;
      c.open[j] = o;
      var seam = c.closed[j] >= 0 ? Math.exp(-(t - c.closed[j]) / 0.8) : 0;
      c.seam[j] = seam;
      if (seam > 0.02) alive = true;
      c.dr[j] = c.drag[j] * recoil(age) * Math.min(1, Math.min(s, L - s) / 20);
    }
    return alive;
  }

  // Paint one crack into the grid: every cell within reach of a segment that
  // is nearer to it than to anything painted before takes its values.
  function paint(c, box) {
    var w = grid.w, cw = grid.cw, ch = grid.ch;
    var X = c.x, Y = c.y, O = c.open, D = c.dr, E = c.seam, K = c.knots;
    var last = K.length - 2;
    for (var q = 0; q <= last; q += 1) {
      var fa = K[q], fb = K[q + 1];
      var reach = 0;
      for (var m = fa; m <= fb; m += 1) {
        if (O[m] > 0.01 || Math.abs(D[m]) > 0.02) { reach = REACH; break; }
        if (E[m] > 0.01) reach = SEAM_REACH;
      }
      if (!reach) continue;
      var x0 = X[fa], y0 = Y[fa];
      var lx = X[fb] - x0, ly = Y[fb] - y0;
      var l2 = lx * lx + ly * ly;
      if (l2 < 1e-6) continue;
      var sl = Math.sqrt(l2);
      var span = fb - fa;
      var ia = Math.max(0, Math.floor((Math.min(x0, x0 + lx) - reach) / cw));
      var ib = Math.min(w - 1, Math.floor((Math.max(x0, x0 + lx) + reach) / cw));
      var ja = Math.max(0, Math.floor((Math.min(y0, y0 + ly) - reach) / ch));
      var jb = Math.min(grid.h - 1, Math.floor((Math.max(y0, y0 + ly) + reach) / ch));
      if (ia > ib || ja > jb) continue;
      var r2max = reach * reach;
      for (var cj = ja; cj <= jb; cj += 1) {
        var py = (cj + 0.5) * ch - y0;
        for (var ci = ia; ci <= ib; ci += 1) {
          var px = (ci + 0.5) * cw - x0;
          var u = (px * lx + py * ly) / l2;
          var beyond = 0;
          if (u < 0) {
            if (q === 0) beyond = -u * sl;
            u = 0;
          } else if (u > 1) {
            if (q === last) beyond = (u - 1) * sl;
            u = 1;
          }
          var ox = px - lx * u;
          var oy = py - ly * u;
          var d2 = ox * ox + oy * oy;
          var k = cj * w + ci;
          if (d2 >= r2max || d2 >= best[k]) continue;
          best[k] = d2;
          var r = Math.sqrt(d2);
          // The values between the two crack points either side.
          var fi = fa + u * span;
          var j = fi | 0;
          if (j >= fb) j = fb - 1;
          var t = fi - j;
          // Past either end of the crack, nothing but its field fading out.
          var f = beyond > 0 ? Math.max(0, 1 - beyond / 6) : 1;
          var op = (O[j] + (O[j + 1] - O[j]) * t) * f * (1 - smooth(24, 38, r));
          var dg = (D[j] + (D[j + 1] - D[j]) * t) * f * (1 - smooth(18, 30, r));
          var sm = (E[j] + (E[j + 1] - E[j]) * t) * f * (1 - smooth(5, 11, r));
          var sd = lx * oy - ly * ox >= 0 ? r : -r;
          var o = k * 4;
          texels[o] = (Math.max(-1, Math.min(1, sd / SDMAX)) * 127.5 + 128) | 0;
          texels[o + 1] = (Math.min(1, op / OMAX) * 255 + 0.5) | 0;
          texels[o + 2] = (Math.min(1, sm) * 255 + 0.5) | 0;
          texels[o + 3] = 128 + Math.round(Math.max(-1, Math.min(1, dg / DRAGMAX)) * 127);
        }
      }
      if (!box.on) {
        box.on = true;
        box.i0 = ia; box.i1 = ib; box.j0 = ja; box.j1 = jb;
      } else {
        if (ia < box.i0) box.i0 = ia;
        if (ib > box.i1) box.i1 = ib;
        if (ja < box.j0) box.j0 = ja;
        if (jb > box.j1) box.j1 = jb;
      }
    }
  }

  // Send the cells in a box to the texture.
  function upload(b) {
    var w = grid.w;
    var bw = b.i1 - b.i0 + 1;
    var bh = b.j1 - b.j0 + 1;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (bw * bh > w * grid.h * 0.6) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, grid.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, texels);
      return;
    }
    for (var j = 0; j < bh; j += 1) {
      var from = ((b.j0 + j) * w + b.i0) * 4;
      strip.set(texels.subarray(from, from + bw * 4), j * bw * 4);
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, b.i0, b.j0, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, strip.subarray(0, bw * bh * 4));
  }

  function stepCracks() {
    var w = grid.w;
    var i;
    var j;
    // Wipe what was painted last frame, paint the cracks as they are now,
    // and send both regions.
    if (painted) {
      for (j = painted.j0; j <= painted.j1; j += 1) {
        for (i = painted.i0; i <= painted.i1; i += 1) {
          best[j * w + i] = REACH * REACH;
          blank(j * w + i);
        }
      }
    }
    var box = { on: false, i0: 0, i1: 0, j0: 0, j1: 0 };
    for (var c = cracks.length - 1; c >= 0; c -= 1) {
      var crack = cracks[c];
      if (crack.dirty) build(crack);
      if (!stepCrack(crack, clock) && crack !== live) {
        cracks.splice(c, 1);
        continue;
      }
      paint(crack, box);
    }
    var both = box.on ? box : painted;
    if (box.on && painted) {
      both = {
        i0: Math.min(box.i0, painted.i0), i1: Math.max(box.i1, painted.i1),
        j0: Math.min(box.j0, painted.j0), j1: Math.max(box.j1, painted.j1)
      };
    }
    if (both) upload(both);
    painted = box.on ? box : null;
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

    // Cracks: the blade has left once no fast movement has come for a beat.
    clock += dt;
    if (live && clock - live.last > 0.12) release(live);
    if (useDisp && (cracks.length || painted)) stepCracks();
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
    // The currents breathe: slow swells, never in step, on top of gusts.
    var swell = 1 + 0.28 * Math.sin(time * 0.093) * Math.sin(time * 0.041 + 0.7);
    gl.uniform1f(U.uFlow, (reduced ? 0.4 : swell) * (1 + gust));
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
    // Events arrive further apart on a busy device, and closer on a fast
    // mouse; a gap up to 300 ms still counts as one stroke, with its speed
    // measured over the real gap.
    if (pointer.has && now - pointer.t < 300 && pointer.x > -9000) {
      var seconds = Math.max(0.002, (now - pointer.t) / 1000);
      var moved = Math.sqrt((x - pointer.x) * (x - pointer.x) + (y - pointer.y) * (y - pointer.y));
      pointer.speed = Math.max(pointer.speed, moved / seconds);
      // Moving, it cuts; stopping lifts the blade. Sub-pixel jitter does
      // neither.
      var v = moved / seconds / 1000;
      if (moved > 0.75) {
        if (useDisp && v >= (live ? CUT_KEEP : CUT_SPEED)) cut(pointer.x, pointer.y, x, y, Math.min(v, 5));
        else if (live) release(live);
      }
    } else if (live) {
      release(live);
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
    var px = typeof x === "number" ? x : width * 0.5;
    var py = typeof y === "number" ? y : visible * 0.5;
    addRipple(px, py, 1.6);
    if (!reduced) gust = Math.min(2.5, gust + 1.6);
  };

  resize();
  start();
})();
