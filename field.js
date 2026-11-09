/* Background field.
 *
 * A night sky, drawn additively on black with WebGL:
 *   - the sky: most of the stars, very fine and very far away. They are not
 *     spread evenly but follow a map made anew on every visit: one broad band
 *     along a diagonal, like the Milky Way, swelling into a bulge at one
 *     place, bunched into star clouds and cut by dark streaks, lanes and
 *     threads that run with it;
 *   - its glow: the same map drawn once more as a faint haze, the light of
 *     all the stars too faint to draw, so the dark lanes stand against it;
 *   - things in it: a few globular clusters, a small spiral galaxy seen at a
 *     slant and a couple of remoter ones, each a few hundred to a few
 *     thousand of the sky's stars and a touch of glow; and two nebulae, wisps
 *     of glow alone;
 *   - stars in depth: the rest lie at every distance in front of the sky. The
 *     view drifts slowly sideways, so near stars slide past faster than far
 *     ones, and the same parallax answers the pointer and scrolling;
 *   - twinkle: every star flickers slightly, at its own pace; the few
 *     brightest carry the fine cross a telescope's mirror gives them;
 *   - a sway: where the pointer (or a finger) moves, the stars near it are
 *     drawn a few px along with it, the near ones most, and swing back when
 *     it stops. Nothing is drawn at the pointer itself;
 *   - ripples: a click or tap sends a ring through the sky, a page change a
 *     stronger one that also pushes the near stars outward for a moment.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("field");
  if (!canvas) return;

  var root = document.documentElement;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var api = { setScene: function () {}, pulse: function () {}, ripple: function () {} };
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

  var RIPPLES = 4;
  var W_SKY = 0.05; // how much of the view's movement the sky follows; the nearest stars follow all of it

  // ---------------------------------------------------------------- shaders
  var VERT = [
    "precision highp float;",
    "attribute vec4 aA;",          // x, y on the tile (0..1); below a half: a sky star's brightness, above: a nearer star's depth; seed
    "uniform vec2 uRes;",          // canvas size, CSS px
    "uniform float uPad;",         // margin of stars past every edge, CSS px
    "uniform float uDpr;",
    "uniform float uTime;",
    "uniform vec2 uCam;",          // where the view has moved to, in tiles
    "uniform float uDust;",        // overall intensity
    "uniform float uReveal;",      // intro radius, px (large = done)
    "uniform float uPush;",        // page change: near stars pushed outward
    "uniform vec4 uSway;",         // the pointer: x, y, and how far it carries the stars (px)
    "uniform vec4 uRip[" + RIPPLES + "];", // x, y, age s, strength
    "varying float vA;",
    "varying float vK;",           // 1 for a star with a cross of spikes
    "float h(float n) { return fract(sin(n) * 43758.5453123); }",
    "void main() {",
    "  float s = aA.w;",
    "  float t = uTime;",
    "  float k = aA.z * 2.0;",
    "  bool sky = k < 1.0;",
    "  float z = sky ? 0.0 : k - 1.0;",
    // Parallax: a star follows the view by its nearness.
    "  float w = sky ? " + W_SKY.toFixed(2) + " : 0.1 + 0.9 * z;",
    // The stars are laid out past every edge by uPad and wrap there, out of
    // sight, so the drifting view never runs out of sky.
    "  vec2 span = uRes + 2.0 * uPad;",
    "  vec2 p = fract(aA.xy + uCam * w) * span - uPad;",
    "  p += (p - uRes * 0.5) * uPush * w;",
    "  float size;",
    "  float a;",
    "  vK = 0.0;",
    "  float f = 0.3 + 1.1 * h(s * 3.1);",
    "  if (sky) {",
    "    size = 0.5 + 0.3 * k;",
    "    a = 0.24 * (0.28 + 2.6 * k) * (0.76 + 0.24 * sin(t * f + s * 97.0));",
    "  } else {",
    "    size = 0.5 + 1.05 * z * z;",
    "    a = (0.026 + 0.15 * z) * (0.56 + 0.44 * sin(t * f + s * 97.0));",
    // A few brighter stars, and a handful of bright ones.
    "    if (s > 0.992) { a = a * 2.2 + 0.07; size *= 1.3; }",
    "    if (s > 0.9997) { a += 0.34; size *= 1.5; }",
    "    if (s > 0.99994) { a += 0.3; size *= 1.35; vK = 1.0; }",
    "  }",
    "  a *= uDust * 1.1;",
    "  for (int i = 0; i < " + RIPPLES + "; i++) {",
    "    vec4 r = uRip[i];",
    "    if (r.w > 0.0) {",
    "      vec2 dv = p - r.xy;",
    "      float dist = length(dv) + 0.001;",
    "      float front = r.z * 560.0;",
    "      float ring = exp(-pow((dist - front) / 64.0, 2.0)) * r.w * exp(-r.z * 1.1) * (1.0 - smoothstep(2.4, 3.2, r.z));",
    "      p += dv / dist * ring * (8.0 + 22.0 * w);",
    "      a *= 1.0 + ring * 0.9;",
    "    }",
    "  }",
    // A moving pointer carries the stars around it along, the near ones most.
    "  vec2 dm = p - uSway.xy;",
    "  p += uSway.zw * exp(-dot(dm, dm) / 26000.0) * (0.35 + 0.65 * w);",
    // Intro: the sky appears behind a front expanding from the centre.
    "  float rd = length(p - uRes * vec2(0.5, 0.46));",
    "  float edge = uReveal - rd;",
    "  a *= smoothstep(-40.0, 60.0, edge) * (1.0 + 2.2 * exp(-edge * edge / 3000.0));",
    "  vec2 cl = p / uRes * 2.0 - 1.0;",
    "  gl_Position = vec4(cl.x, -cl.y, 0.0, 1.0);",
    // Each star is a gaussian spot, never narrower than half a device pixel,
    // so it glides across the pixel grid instead of snapping from one pixel to
    // the next. The sprite spans 2.5 sigma either side; the spot carries the
    // light of a disc of the star's size, whatever the pixel density.
    "  float dev = size * uDpr;",
    "  float sig = max(0.5, 0.3 * dev);",
    // A spiked star's sprite is three times as wide, to hold the spikes.
    "  gl_PointSize = 5.0 * sig * (1.0 + 2.0 * vK);",
    "  vA = a * 0.55 * dev * dev / (5.382 * sig * sig);",
    "}"
  ].join("\n");

  // The gaussian over the sprite, cut at its rim (2.5 sigma) and lowered to
  // reach zero there, so no pixel pops in or out at the edge. A spiked star
  // adds four thin rays, a little off the axes, that die away along their
  // length and before the sprite's edge.
  var FRAG = [
    "precision mediump float;",
    "varying float vA;",
    "varying float vK;",
    "void main() {",
    "  vec2 c = gl_PointCoord - 0.5;",
    "  float rays = 0.0;",
    "  if (vK > 0.5) {",
    "    c *= 3.0;",
    "    vec2 q = abs(vec2(0.9553 * c.x - 0.2955 * c.y, 0.2955 * c.x + 0.9553 * c.y));",
    "    rays = 0.3 * (exp(-q.x / 0.42 - q.y * q.y / 0.008) + exp(-q.y / 0.42 - q.x * q.x / 0.008))",
    "      * (1.0 - smoothstep(1.1, 1.5, max(q.x, q.y)));",
    "  }",
    "  float v = vA * (max(exp(-12.5 * dot(c, c)) - 0.0439, 0.0) * 1.0459 + rays);",
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

  var program;
  try {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(program, 0, "aA");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  } catch (error) {
    root.classList.add("no-webgl");
    return;
  }
  gl.useProgram(program);
  var U = {};
  ["uRes", "uPad", "uDpr", "uTime", "uCam", "uDust", "uReveal", "uPush", "uSway"]
    .forEach(function (name) { U[name] = gl.getUniformLocation(program, name); });
  U.uRip = gl.getUniformLocation(program, "uRip[0]") || gl.getUniformLocation(program, "uRip");

  // The sky's glow: its map as a texture over the whole canvas, moving with
  // the sky, with a grain of noise so that so faint a gradient shows no steps.
  var haze = null;
  var UH = {};
  try {
    haze = gl.createProgram();
    gl.attachShader(haze, compile(gl.VERTEX_SHADER, [
      "attribute vec4 aA;",
      "void main() {",
      "  gl_Position = vec4(aA.xy, 0.0, 1.0);",
      "}"
    ].join("\n")));
    gl.attachShader(haze, compile(gl.FRAGMENT_SHADER, [
      "#ifdef GL_FRAGMENT_PRECISION_HIGH",
      "precision highp float;",
      "#else",
      "precision mediump float;",
      "#endif",
      "uniform sampler2D uSky;",
      "uniform vec2 uRes;",        // canvas size, CSS px
      "uniform float uPad;",
      "uniform float uDpr;",
      "uniform vec2 uCam;",        // where the sky has moved to, in tiles
      "uniform float uGain;",
      "uniform float uReveal;",
      "void main() {",
      "  vec2 p = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;",
      "  float v = texture2D(uSky, (p + uPad) / (uRes + 2.0 * uPad) - uCam).r * uGain;",
      "  v *= smoothstep(-40.0, 60.0, uReveal - length(p - uRes * vec2(0.5, 0.46)));",
      "  v += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;",
      "  gl_FragColor = vec4(v, v, v, 1.0);",
      "}"
    ].join("\n")));
    gl.bindAttribLocation(haze, 0, "aA");
    gl.linkProgram(haze);
    if (!gl.getProgramParameter(haze, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(haze));
    ["uSky", "uRes", "uPad", "uDpr", "uCam", "uGain", "uReveal"].forEach(function (name) { UH[name] = gl.getUniformLocation(haze, name); });
  } catch (error) {
    haze = null; // no glow, the stars as usual
  }
  // ------------------------------------------------------------------ stars
  var compact = Math.min(window.screen.width, window.screen.height) < 700;
  // Stars per CSS px², over the window plus its margin; the draw count follows
  // the window, the buffer is sized for the whole screen (either way up) so a
  // resize or rotation never reallocates.
  var DENSITY = 1;
  var SKY_SHARE = 0.64;     // of all stars, how many belong to the far sky
  var PAD = 24;             // px of sky past every edge, where the stars wrap: more than the sway can pull into view
  var MAP = 512;            // the sky's map, cells a side
  var screenW = Math.max(window.screen.width, window.innerWidth);
  var screenH = Math.max(window.screen.height, window.innerHeight);
  var nStars = Math.min(compact ? 620000 : 2600000, Math.round((screenW + 2 * PAD) * (screenH + 2 * PAD) * DENSITY));

  function smooth(e0, e1, x) {
    var u = x <= e0 ? 0 : x >= e1 ? 1 : (x - e0) / (e1 - e0);
    return u * u * (3 - 2 * u);
  }

  function gauss() {
    return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(6.2832 * Math.random());
  }

  // The sky: where its stars gather (density), what glows (glow), and the
  // things in it. Both maps cover the tile and wrap at its edges like the
  // stars themselves.
  //
  // One broad band runs along a diagonal of the tile (x + y = const), bent by
  // noise, swelling into a bulge at one place and laid anew on every visit.
  // Inside it the stars bunch into clouds, a few octaves of lattice noise
  // stretched along the band. Three kinds of dark texture run with the band,
  // across the whole sky: long streaks, a noise drawn out some twenty times
  // along the diagonal; lanes, the lines where a second noise crosses its
  // middle value; and finer threads, the same of a third, curled by a fourth.
  function makeSky() {
    var N = MAP;
    function layer(fx, fy) {
      var grid = new Float32Array(fx * fy);
      for (var k = 0; k < grid.length; k += 1) grid[k] = Math.random();
      return function (x, y) {
        var gx = x * fx;
        var gy = y * fy;
        var ix = Math.floor(gx);
        var iy = Math.floor(gy);
        var tx = gx - ix;
        var ty = gy - iy;
        tx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
        ty = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
        var x0 = ((ix % fx) + fx) % fx;
        var y0 = ((iy % fy) + fy) % fy;
        var x1 = (x0 + 1) % fx;
        var y1 = (y0 + 1) % fy;
        var a = grid[y0 * fx + x0];
        var b = grid[y0 * fx + x1];
        var c = grid[y1 * fx + x0];
        var d = grid[y1 * fx + x1];
        return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
      };
    }
    // Octaves of one noise, each half as strong as the one before; 0..1.
    function fbm(layers) {
      var norm = 2 - 1 / (1 << (layers.length - 1));
      return function (x, y) {
        var sum = 0;
        for (var o = 0; o < layers.length; o += 1) sum += layers[o](x, y) / (1 << o);
        return sum / norm;
      };
    }
    // The line where a noise crosses its middle value: 1 on it, 0 from `wide` away.
    function line(value, wide) {
      return 1 - smooth(wide * 0.12, wide, Math.abs(value - 0.5));
    }
    var clouds = fbm([layer(3, 2), layer(6, 4), layer(12, 8), layer(24, 16), layer(48, 32)]);
    var streaks = fbm([layer(10, 1), layer(20, 2), layer(40, 4)]);
    var lanes = fbm([layer(5, 3), layer(10, 6), layer(20, 12)]);
    var threads = fbm([layer(11, 4), layer(22, 8), layer(44, 16)]);
    var bend = layer(3, 2);
    var wave = layer(4, 3);
    var curl = fbm([layer(7, 5), layer(14, 10)]);
    var voids = fbm([layer(6, 2), layer(12, 4), layer(24, 8)]);
    var widths = layer(9, 5);
    var centre = 0.8 + 0.4 * Math.random();
    var bulgeAt = Math.random();

    // The band at a point of the tile (x sheared: constant along the diagonal).
    function bandAt(x, y) {
      var along = y - bulgeAt;
      along -= Math.round(along);
      var bulge = Math.exp(-along * along / 0.05);
      var across = 0.5 + 0.5 * Math.cos(6.2832 * (x - centre + (bend(x, y) - 0.5) * 0.24));
      return Math.pow(across, 2.1 - 0.9 * bulge) * (0.74 + 0.42 * bulge);
    }

    var density = new Float32Array(N * N);
    var glow = new Float32Array(N * N);
    var i;
    var j;
    for (j = 0; j < N; j += 1) {
      for (i = 0; i < N; i += 1) {
        // Sheared: x is constant along the diagonal, so the band and the
        // noises' long axes lie along it; waved a little, so nothing in the
        // sky is ruled straight.
        var y = (j + 0.5) / N;
        var x = (i + 0.5) / N + y;
        var xw = x + (wave(x, y) - 0.5) * 0.09;
        var cloud = smooth(0.3, 0.7, clouds(x, y));
        var band = bandAt(x, y);
        var inBand = smooth(0.1, 0.45, band);
        var streak = smooth(0.34, 0.6, streaks(xw, y));
        var d = (0.07 + 0.2 * cloud) * (0.14 + 0.86 * streak) +
          0.87 * band * (0.2 + 0.8 * cloud) * (0.16 + 0.84 * streak);
        var turn = (curl(x, y) - 0.5) * 0.07;
        // Lanes are wide in places and thin to a hair in others.
        d *= 1 - line(lanes(xw, y), 0.025 + 0.075 * widths(x, y)) * (0.6 + 0.3 * inBand);
        d *= 1 - line(threads(xw + turn, y + turn), 0.03) * (0.4 + 0.3 * inBand);
        // Dark clouds: whole patches where a noise runs low, soft-edged.
        d *= 0.12 + 0.88 * smooth(0.3, 0.46, voids(xw + turn * 0.6, y));
        density[j * N + i] = d;
        glow[j * N + i] = d;
      }
    }

    // Things in the sky. Each knows how to place one of its stars (tile x, y
    // and brightness 0..1) and how brightly it glows at an offset in px.
    // Sizes are in px of the window as it is now.
    var sx = 1 / (window.innerWidth + 2 * PAD);
    var sy = 1 / (window.innerHeight + 2 * PAD);
    var unit = Math.min(window.innerWidth, window.innerHeight);
    var things = [];

    function add(thing) {
      // Its glow, into the map: every cell within its reach.
      var ci = Math.floor(thing.x * N);
      var cj = Math.floor(thing.y * N);
      var ri = Math.ceil(thing.reach * sx * N) + 1;
      var rj = Math.ceil(thing.reach * sy * N) + 1;
      for (var dj = -rj; dj <= rj; dj += 1) {
        for (var di = -ri; di <= ri; di += 1) {
          var px = ((ci + di + 0.5) / N - thing.x) / sx;
          var py = ((cj + dj + 0.5) / N - thing.y) / sy;
          glow[(((cj + dj) % N + N) % N) * N + ((ci + di) % N + N) % N] += thing.glow(px, py);
        }
      }
      things.push(thing);
    }

    // A globular cluster: a ball of stars, crowded at its core.
    function cluster(x, y, core, share) {
      return {
        x: x, y: y, share: share, reach: core * 6,
        star: function () {
          var r = core * Math.sqrt(Math.pow(1 - 0.985 * Math.random(), -2 / 3) - 1);
          var th = 6.2832 * Math.random();
          return [x + r * Math.cos(th) * sx, y + r * Math.sin(th) * sy, 0.08 + 0.6 * Math.pow(Math.random(), 2.5)];
        },
        glow: function (px, py) {
          var q = 1 + (px * px + py * py) / (core * core);
          return 1.6 / (q * q);
        }
      };
    }

    // A galaxy seen at a slant: with arms, a spiral of two; without, a remote
    // smudge. R is its radius in px, tilt how flat it looks, turn its angle on
    // the sky.
    function galaxy(x, y, R, tilt, turn, arms, share) {
      var cs = Math.cos(turn);
      var sn = Math.sin(turn);
      var hand = Math.random() < 0.5 ? 1 : -1;
      function wind(r) {
        return hand * 2.6 * Math.log(r / (0.1 * R) + 1);
      }
      return {
        x: x, y: y, share: share, reach: R * 1.05,
        star: function () {
          var r;
          var th = 6.2832 * Math.random();
          var round = tilt;
          if (Math.random() < (arms ? 0.13 : 0.4)) {
            // The bulge: a ball, so less flattened than the disc.
            r = R * 0.09 * Math.sqrt(-2 * Math.log(1 - Math.random()));
            round = 0.5 + 0.5 * tilt;
          } else {
            r = R * 0.26 * -Math.log(1 - 0.97 * Math.random());
            // The arms are loose near the centre and tighten outward.
            if (arms && Math.random() < 0.74) th = (Math.random() < 0.5 ? 0 : Math.PI) + wind(r) + gauss() * (0.28 + 1.1 * Math.exp(-r / (0.13 * R)));
          }
          var u = r * Math.cos(th);
          var v = r * Math.sin(th) * round;
          return [x + (u * cs - v * sn) * sx, y + (u * sn + v * cs) * sy, 0.3 * Math.pow(Math.random(), 5)];
        },
        glow: function (px, py) {
          var u = px * cs + py * sn;
          var v = (py * cs - px * sn) / tilt;
          var r = Math.sqrt(u * u + v * v);
          var arm = arms ? 0.5 + 0.5 * Math.cos(2 * (Math.atan2(v, u) - wind(r))) : 1;
          arm = 0.3 + 0.7 * arm * arm * smooth(0.06 * R, 0.3 * R, r) + 0.7 * (1 - smooth(0.06 * R, 0.3 * R, r));
          return (1.5 * Math.exp(-r * r / (0.0162 * R * R)) +
            0.85 * Math.exp(-r / (0.3 * R)) * arm) * (1 - smooth(0.8 * R, R, r));
        }
      };
    }

    // A nebula: no stars of its own, only wisps of glow, the mid-lines of a
    // noise folded by another. A third noise gives it a ragged outline, so
    // it never shows as a disc.
    function nebula(x, y, R) {
      var wisps = fbm([layer(8, 8), layer(16, 16), layer(32, 32)]);
      var fold = fbm([layer(5, 5), layer(10, 10)]);
      var shape = fbm([layer(6, 6), layer(12, 12)]);
      return {
        x: x, y: y, share: 0, reach: R,
        glow: function (px, py) {
          var r2 = (px * px + py * py) / (R * R);
          if (r2 >= 1) return 0;
          var tx = x + px * sx;
          var ty = y + py * sy;
          var n = wisps(tx + (fold(tx, ty) - 0.5) * 0.07, ty + (fold(ty + 0.37, tx + 0.61) - 0.5) * 0.07);
          var ridge = 1 - Math.abs(2 * n - 1);
          var body = smooth(0.4, 0.62, shape(tx, ty) + 0.3 * (1 - r2) - 0.1);
          return (1 - r2) * (1 - r2) * body * (0.2 + 1.7 * ridge * ridge * ridge);
        }
      };
    }

    // Away from the band, as galaxies are seen: the best of a few tries.
    function clearSpot() {
      var best = [0, 0, 9];
      for (var k = 0; k < 14; k += 1) {
        var x = Math.random();
        var y = Math.random();
        var b = bandAt(x + y, y);
        if (b < best[2]) best = [x, y, b];
      }
      return best;
    }

    // Nebulae first: they have no stars, and the last thing must.
    for (i = 0; i < 2; i += 1) {
      add(nebula(Math.random(), Math.random(), 0.13 * unit * (1 + 0.6 * Math.random())));
    }
    var spot = clearSpot();
    add(galaxy(spot[0], spot[1], 34 + 0.065 * unit, 0.3 + 0.25 * Math.random(), 6.2832 * Math.random(), true, 0.013));
    for (i = 0; i < 2; i += 1) {
      spot = clearSpot();
      add(galaxy(spot[0], spot[1], 12 + 0.012 * unit * (1 + Math.random()), 0.35 + 0.5 * Math.random(), 6.2832 * Math.random(), false, 0.0003));
    }
    for (i = 0; i < 3; i += 1) {
      add(cluster(Math.random(), Math.random(), 3 + 0.003 * unit * (1 + Math.random()), 0.0011));
    }

    // To draw stars by the density: running sums along each row, and of the rows.
    var rows = new Float64Array(N);
    var total = 0;
    for (j = 0; j < N; j += 1) {
      var sum = 0;
      for (i = 0; i < N; i += 1) {
        sum += density[j * N + i];
        density[j * N + i] = sum;
      }
      total += sum;
      rows[j] = total;
    }

    return {
      glow: glow,
      things: things,
      // One star of the sky at large: into out[0], out[1].
      star: function (out) {
        var r = Math.random() * total;
        var lo = 0;
        var hi = N - 1;
        var mid;
        while (lo < hi) {
          mid = (lo + hi) >> 1;
          if (rows[mid] > r) hi = mid; else lo = mid + 1;
        }
        var row = lo * N;
        r = Math.random() * density[row + N - 1];
        var a = 0;
        hi = N - 1;
        while (a < hi) {
          mid = (a + hi) >> 1;
          if (density[row + mid] > r) hi = mid; else a = mid + 1;
        }
        out[0] = (a + Math.random()) / N;
        out[1] = (lo + Math.random()) / N;
      }
    };
  }

  var starBuffer = gl.createBuffer();
  var quadBuffer = gl.createBuffer();
  var skyTexture = null;

  (function buildStars() {
    // Interleaved [x, y, brightness or depth, seed] as 16-bit fractions, in
    // random order, so drawing a prefix is an even subsample of the sky, the
    // things in it and the stars in front of it.
    var sky = makeSky();
    var things = sky.things;
    var shares = 0;
    var k;
    for (k = 0; k < things.length; k += 1) shares += things[k].share;
    var data = new Uint16Array(nStars * 4);
    var at = [0, 0];
    for (var i = 0; i < nStars; i += 1) {
      var o = i * 4;
      var third;
      if (Math.random() < SKY_SHARE) {
        var pick = Math.random();
        if (pick < shares) {
          // One of a cluster's or a galaxy's stars.
          k = 0;
          while (k < things.length - 1 && pick >= things[k].share) {
            pick -= things[k].share;
            k += 1;
          }
          var star = things[k].star();
          at[0] = star[0] - Math.floor(star[0]);
          at[1] = star[1] - Math.floor(star[1]);
          third = star[2] * 32767;
        } else {
          // Far sky: placed by the map; most are faint, a few many times brighter.
          sky.star(at);
          third = Math.pow(Math.random(), 6) * 32767;
        }
      } else {
        // In front of it: anywhere, most of them far.
        at[0] = Math.random();
        at[1] = Math.random();
        third = 32768 + Math.max(1, Math.pow(Math.random(), 1.8) * 32767);
      }
      data[o] = at[0] * 65535;
      data[o + 1] = at[1] * 65535;
      data[o + 2] = third;
      data[o + 3] = Math.random() * 65535;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, starBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);

    if (haze) {
      var bytes = new Uint8Array(MAP * MAP);
      for (k = 0; k < bytes.length; k += 1) bytes[k] = Math.min(255, sky.glow[k] * 100);
      skyTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, skyTexture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, MAP, MAP, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, bytes);
    }
  })();

  // --------------------------------------------------------------- state
  var width = 1;
  var height = 1;
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
  var reveal = reduced ? 1e5 : 0;
  var push = 0;             // near stars pushed outward, and what it eases toward
  var pushTo = 0;
  var cam = { x: 0, y: 0 }; // the drifting view, in tiles
  var ripples = [];
  var rippleData = new Float32Array(RIPPLES * 4);
  var pointer = { x: -9999, y: -9999, px: 0, py: 0, vx: 0, vy: 0, t: 0, has: false };
  // The sway: where it is centred (it trails the pointer a little), how far
  // it carries the stars now, and how fast that is changing.
  var sway = { x: 0, y: 0, dx: 0, dy: 0, vx: 0, vy: 0 };
  var SWAY = 9;             // px, the most a fast pointer carries the nearest stars
  var scrollY = window.scrollY || 0;
  var smoothScroll = scrollY;

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

    // Quality: sustained slow frames thin the stars (never below 35 %).
    frameAvg += (dt * 1000 - frameAvg) * 0.05;
    if (frameAvg > 24) slowFrames += 1; else slowFrames = Math.max(0, slowFrames - 2);
    if (slowFrames > 90 && quality > 0.35) {
      quality *= 0.82;
      slowFrames = 0;
    }

    var pace = reduced ? 0.12 : 1;
    time += dt * pace;
    if (time > 20000) time -= 20000;
    var target = scene === "home" ? 1 : 0.72;
    intensity += (target - intensity) * (1 - Math.exp(-dt * 1.4));
    if (reveal < 1e5) {
      reveal += dt * (320 + reveal * 1.1);
      if (reveal > Math.sqrt(width * width + height * height) + 400) reveal = 1e5;
    }
    smoothScroll += (scrollY - smoothScroll) * (1 - Math.exp(-dt * 6));
    pushTo *= Math.exp(-dt * 2.2);
    push += (pushTo - push) * (1 - Math.exp(-dt * 9));

    // The view drifts sideways on a long, slowly turning course: the nearest
    // stars pass at a few px a second, the sky at a twentieth of that.
    var spanX = width + 2 * PAD;
    var spanY = height + 2 * PAD;
    var heading = -0.36 + 0.5 * Math.sin(time * 0.013) + 0.3 * Math.sin(time * 0.0057 + 1.3);
    var drift = (3 + 0.003 * width) * dt * pace;
    cam.x += Math.cos(heading) * drift / spanX;
    cam.y += Math.sin(heading) * drift / spanY;

    if (pointer.has) {
      pointer.px += ((pointer.x / width - 0.5) - pointer.px) * (1 - Math.exp(-dt * 1.5));
      pointer.py += ((pointer.y / visible - 0.5) - pointer.py) * (1 - Math.exp(-dt * 1.5));
      sway.x += (pointer.x - sway.x) * (1 - Math.exp(-dt * 10));
      sway.y += (pointer.y - sway.y) * (1 - Math.exp(-dt * 10));
    }
    // The sway follows the pointer's speed on a soft spring, so the stars
    // lag a little, swing a little past, and settle.
    pointer.vx *= Math.exp(-dt * 5);
    pointer.vy *= Math.exp(-dt * 5);
    var speed = Math.sqrt(pointer.vx * pointer.vx + pointer.vy * pointer.vy);
    var carry = reduced || speed < 1 ? 0 : SWAY * Math.min(1, speed / 800) / speed;
    sway.vx += (70 * (pointer.vx * carry - sway.dx) - 2 * 0.42 * Math.sqrt(70) * sway.vx) * dt;
    sway.vy += (70 * (pointer.vy * carry - sway.dy) - 2 * 0.42 * Math.sqrt(70) * sway.vy) * dt;
    sway.dx += sway.vx * dt;
    sway.dy += sway.vy * dt;

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

    // The view: its drift, a lean after the pointer, and a share of the scroll.
    var camX = cam.x - pointer.px * 46 / spanX;
    var camY = cam.y - (pointer.py * 46 + smoothScroll * 0.14) / spanY;

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    if (haze) {
      gl.useProgram(haze);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, skyTexture);
      gl.uniform1i(UH.uSky, 0);
      gl.uniform2f(UH.uRes, width, height);
      gl.uniform1f(UH.uPad, PAD);
      gl.uniform1f(UH.uDpr, dpr);
      gl.uniform2f(UH.uCam, camX * W_SKY, camY * W_SKY);
      gl.uniform1f(UH.uGain, 0.125 * intensity);
      gl.uniform1f(UH.uReveal, reveal);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.useProgram(program);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, starBuffer);
    gl.vertexAttribPointer(0, 4, gl.UNSIGNED_SHORT, true, 8, 0);
    gl.uniform2f(U.uRes, width, height);
    gl.uniform1f(U.uPad, PAD);
    gl.uniform1f(U.uDpr, dpr);
    gl.uniform1f(U.uTime, time);
    gl.uniform2f(U.uCam, camX, camY);
    gl.uniform1f(U.uDust, intensity);
    gl.uniform1f(U.uReveal, reveal);
    gl.uniform1f(U.uPush, push);
    gl.uniform4f(U.uSway, sway.x, sway.y, sway.dx, sway.dy);
    gl.uniform4fv(U.uRip, rippleData);
    var count = Math.min(nStars, Math.round(spanX * spanY * DENSITY * quality));
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
      var seconds = Math.max(0.004, (now - pointer.t) / 1000);
      var blend = Math.min(1, seconds * 30);
      pointer.vx += ((x - pointer.x) / seconds - pointer.vx) * blend;
      pointer.vy += ((y - pointer.y) / seconds - pointer.vy) * blend;
    } else if (!pointer.has) {
      // The pointer has just arrived: the sway starts where it lands.
      sway.x = x;
      sway.y = y;
    }
    pointer.x = x;
    pointer.y = y;
    pointer.t = now;
    pointer.has = true;
  }

  function lift() {
    pointer.has = false;
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
    lift();
    pointAt(touch.clientX, touch.clientY, event.timeStamp || performance.now());
  }, { passive: true });
  window.addEventListener("touchmove", function (event) {
    var touch = event.touches[0];
    if (touch) pointAt(touch.clientX, touch.clientY, event.timeStamp || performance.now());
  }, { passive: true });
  window.addEventListener("touchend", function (event) {
    if (!event.touches.length) lift();
  }, { passive: true });
  window.addEventListener("touchcancel", lift, { passive: true });
  document.addEventListener("mouseleave", function () {
    lift();
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
  // Page changes: a strong ring from where the visitor clicked, and the near
  // stars pushed outward for a moment.
  api.pulse = function (x, y) {
    var px = typeof x === "number" ? x : width * 0.5;
    var py = typeof y === "number" ? y : visible * 0.5;
    addRipple(px, py, 1.6);
    if (!reduced) pushTo = Math.min(0.06, pushTo + 0.035);
  };
  // A softer ring and no push: the home page's preview cards being dealt.
  api.ripple = function (x, y, strength) {
    addRipple(x, y, strength);
  };

  resize();
  start();
})();
