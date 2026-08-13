// Plasma orb skin — faithful port of docs/jarvis-orb-a.html ("Orb A — Raw
// WebGL Shader": impostor sphere, warped fbm plasma, neural filaments,
// thin-film fresnel rim) into the OrbEngine skin contract.
//
// Differences from the prototype are structural only:
//  - transparent background: the WebGL context is {alpha:true,
//    premultipliedAlpha:true}, clears to transparent, and the fragment shader
//    emits premultiplied rgba (alpha = orb silhouette + halo coverage) so the
//    orb floats over the app stage. The 2D fallback clearRect()s instead of
//    painting #030303.
//  - the WebGL capability probe (software-rasterizer check + shader compile)
//    runs on an offscreen canvas first, so a rejected WebGL path never claims
//    the visible canvas and the 2D fallback can still bind to it.
//  - the 2D fallback's filament layout uses a seeded LCG (deterministic)
//    instead of Math.random().
//  - app states arrive via OrbEngine.mapStateToMood and land on the
//    prototype's idle/listening/thinking motion states, with the same
//    exponential easing; dim states fade overall intensity to ~55%.
(function () {
  'use strict';

  if (typeof window === 'undefined' || !window.OrbEngine || !window.OrbEngine.register) return;

  var TAU = Math.PI * 2;
  var P = 120;                    // master loop period (s); every shader frequency is an integer multiple of TAU/P, so phase wrap is seamless and float precision never drifts

  // ------------------------------------------------------------------ shaders

  // Shared fragment body. Version-agnostic: headers below map `outColor`
  // for GLSL ES 1.00 (gl_FragColor) or declare it for ES 3.00.
  var FRAG_BODY = [
    'uniform vec2  uRes;',
    'uniform float uTime;',    // phase A: churn clock, wraps at 120
    'uniform float uSwirl;',   // phase B: rotation clock, wraps at 120
    'uniform float uMode;',    // 0 = obsidian iridescent, 1 = jarvis amber
    'uniform float uEnergy;',  // brightness / activity
    'uniform float uTurb;',    // domain-warp turbulence
    'uniform float uPulse;',   // breathing amplitude
    'uniform float uFade;',    // overall intensity (dim states ease to 0.55)
    '',
    '#define TAU 6.28318530718',
    '#define W0  0.05235987756',   // TAU / 120
    '',
    'float hash(vec2 p){',
    '  p = fract(p * vec2(123.34, 456.21));',
    '  p += dot(p, p + 45.32);',
    '  return fract(p.x * p.y);',
    '}',
    '',
    'float vnoise(vec2 p){',
    '  vec2 i = floor(p);',
    '  vec2 f = fract(p);',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  float a = hash(i);',
    '  float b = hash(i + vec2(1.0, 0.0));',
    '  float c = hash(i + vec2(0.0, 1.0));',
    '  float d = hash(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
    '}',
    '',
    'float fbm(vec2 p){',
    '  float v = 0.0;',
    '  float a = 0.5;',
    '  mat2 m = mat2(0.8, -0.6, 0.6, 0.8);',
    '  for(int i = 0; i < 4; i++){',          // constant bound: ANGLE/D3D unroll-safe
    '    v += a * vnoise(p);',
    '    p = m * p * 2.02 + vec2(7.3, 3.1);',
    '    a *= 0.5;',
    '  }',
    '  return v;',
    '}',
    '',
    // IQ cosine palettes; integer c (=1) keeps the cycle seamless. ph is an
    // external phase already built from integer multiples of W0.
    'vec3 pal(float x, float ph){',
    '  vec3 o = vec3(0.50, 0.40, 0.80)',
    '         + vec3(0.45, 0.45, 0.15) * cos(TAU * (x + vec3(0.00, 0.50, 0.25)) + ph);',
    '  vec3 j = vec3(0.62, 0.40, 0.125)',
    '         + vec3(0.45, 0.33, 0.115) * cos(TAU * (x + vec3(0.00, 0.03, 0.10)) + ph);',
    '  return max(mix(o, j, uMode), 0.0);',
    '}',
    '',
    'mat2 rot(float a){',
    '  float c = cos(a);',
    '  float s = sin(a);',
    '  return mat2(c, -s, s, c);',
    '}',
    '',
    'void main(){',
    '  vec2 p = (2.0 * gl_FragCoord.xy - uRes) / uRes.y;',
    '  float px = 2.0 / uRes.y;',                       // one pixel in orb space (AA without derivatives ext)
    '  float t = uTime;',
    '  float ph = 3.0 * W0 * t;',                       // global hue drift
    '',
    '  float R = 0.56 * (1.0 + 0.018 * uPulse * sin(24.0 * W0 * t));',  // breathing radius
    '  float r = length(p);',
    '  float d = r - R;',
    '  float ang = atan(p.y, p.x - 0.0001);',           // offset avoids atan(0,0)
    '',
    '  // transparent stage: light accumulates from zero, alpha derived at the end',
    '  vec3 col = vec3(0.0);',
    '',
    '  // outer halo: exponential skirt + 1/d bloom tail, hue swept around the rim',
    '  float od = max(d, 0.0);',
    '  float halo = exp(-od * 6.5) * 0.55 + 0.014 / (od + 0.022);',
    '  halo *= smoothstep(-px, 2.0 * px, d);',          // outside only
    '  vec3 haloCol = pal(0.15 + 0.10 * sin(3.0 * ang + 5.0 * W0 * uSwirl), ph);',
    '  col += haloCol * halo * (0.10 + 0.30 * uEnergy);',
    '',
    '  float inMask = 1.0 - smoothstep(-px, px, d);',   // AA silhouette
    '  if(inMask > 0.001){',
    '    float rr = min(r / R, 1.0);',
    '    float nz = sqrt(max(1.0 - rr * rr, 0.0));',    // impostor sphere: n = (p/R, sqrt(1-(r/R)^2))
    '    vec3 n = vec3(p.x / R, p.y / R, nz);',
    '',
    '    float fres  = pow(1.0 - nz, 5.0);',            // Schlick rim
    '    float rim2  = pow(1.0 - nz, 1.6);',            // soft wide sheen
    '    float depth = pow(nz, 1.25);',                 // interior visibility mask
    '',
    '    // fake refraction: magnify interior toward the rim, swirl, oscillating shear',
    '    vec2 ip = p / (nz + 0.35);',
    '    ip = rot(3.0 * W0 * uSwirl) * ip;',
    '    ip += (0.22 * uTurb) * sin(2.0 * W0 * t) * vec2(p.y, -p.x) / (r + 0.35);',
    '',
    '    // time moves noise-space samples on circles -> perfectly loopable churn',
    '    vec2 e1 = vec2(cos(4.0 * W0 * t), sin(4.0 * W0 * t));',
    '    vec2 e2 = vec2(cos(2.1 - 3.0 * W0 * t), sin(2.1 - 3.0 * W0 * t));',
    '',
    '    // IQ domain warp: f = fbm(p + k*fbm(p + t))',
    '    float wamp = 1.0 + 2.4 * uTurb;',
    '    vec2 q = vec2(fbm(ip * 1.7 + 1.6 * e1),',
    '                  fbm(ip * 1.7 + vec2(4.2, 1.3) + 1.6 * e2));',
    '    vec2 w = ip * 1.7 + wamp * (q - 0.5) * 3.0;',
    '    float f = fbm(w + 1.3 * e2);',
    '',
    '    // near-black obsidian glass base (cool for obsidian, warm for jarvis)',
    '    vec3 inner = mix(vec3(0.016, 0.020, 0.033), vec3(0.030, 0.022, 0.012), uMode);',
    '',
    '    // volumetric-feel plasma: f^2 keeps troughs black so highlights read as glass',
    '    vec3 plasma = pal(0.15 + 1.05 * f + 0.35 * q.x, ph);',
    '    inner += plasma * (0.08 + 0.60 * f * f) * depth * (0.35 + 0.85 * uEnergy);',
    '',
    '    // neural filaments: ridged warped fbm, pow-sharpened, additive with flicker',
    '    float fil1 = pow(max(1.0 - abs(2.0 * fbm(w * 2.3 + 2.0 * e1) - 1.0), 0.0), 9.0);',
    '    float fil2 = pow(max(1.0 - abs(2.0 * fbm(ip * 3.1 + q * 1.5 - 1.5 * e2) - 1.0), 0.0), 12.0);',
    '    float fl1 = 0.6 + 0.4 * sin(10.0 * W0 * t + 6.0 * q.y);',
    '    float fl2 = 0.6 + 0.4 * sin(14.0 * W0 * t + 5.0 * q.x + 2.0);',
    '    vec3 filA = mix(vec3(0.50, 0.85, 1.00), vec3(1.00, 0.80, 0.38), uMode);',
    '    vec3 filB = pal(0.60 + 0.30 * q.y, ph) + 0.30;',
    '    inner += filA * (fil1 * fl1) * depth * (0.55 + 1.50 * uEnergy);',
    '    inner += filB * (fil2 * fl2) * depth * (0.25 + 0.65 * uEnergy) * 0.8;',
    '',
    '    // breathing core glow',
    '    float core = exp(-rr * rr * 5.5) * (0.8 + 0.2 * uPulse * sin(24.0 * W0 * t));',
    '    inner += pal(0.08 + 0.10 * f, ph) * core * (0.10 + 0.38 * uEnergy);',
    '',
    '    // iridescent fresnel rim: cheap thin-film stand-in driven by fresnel+angle+noise',
    '    vec3 irid = pal(1.35 * fres + 0.18 * cos(2.0 * ang + 4.0 * W0 * uSwirl) + 0.25 * f, ph + 2.0);',
    '    inner += irid * (1.25 * fres + 0.20 * rim2) * (0.55 + 0.65 * uEnergy);',
    '',
    '    // glassy specular hotspot (upper-left key light)',
    '    vec3 l = normalize(vec3(-0.45, 0.55, 0.62));',
    '    vec3 hv = normalize(l + vec3(0.0, 0.0, 1.0));',
    '    float spec = pow(max(dot(n, hv), 0.0), 90.0);',
    '    inner += vec3(0.85, 0.92, 1.00) * spec * (0.55 + 0.35 * uEnergy);',
    '',
    '    inner = 1.0 - exp(-inner * 1.5);',             // tonemap: never clips
    '    col = mix(col, inner, inMask);',
    '  }',
    '',
    '  // premultiplied-alpha output: the orb body is opaque glass (alpha 1 inside',
    '  // the AA silhouette); outside, alpha follows halo luminance so the glow',
    '  // screens over whatever the stage shows.',
    '  col *= uFade;',
    '  float alpha = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);',
    '  alpha = mix(alpha, 1.0, inMask);',
    '  col = min(col, vec3(1.0));',                     // keep premultiplied constraint col <= alpha
    '  col += (hash(gl_FragCoord.xy + vec2(0.1, 0.1)) - 0.5) * 0.006 * alpha;',  // dither vs banding, only where the orb is
    '  col = max(col, 0.0);',
    '  outColor = vec4(col, alpha);',
    '}'
  ].join('\n');

  var PRECISION = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';

  // WebGL2: bufferless fullscreen triangle via gl_VertexID
  var VS2 = '#version 300 es\n' +
    'void main(){\n' +
    '  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));\n' +
    '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);\n' +
    '}\n';
  var FS2 = '#version 300 es\n' + PRECISION + 'out vec4 outColor;\n' + FRAG_BODY;

  // WebGL1 fallback: tiny attribute buffer instead of gl_VertexID
  var VS1 = 'attribute vec2 aPos;\nvoid main(){ gl_Position = vec4(aPos, 0.0, 1.0); }\n';
  var FS1 = PRECISION + '#define outColor gl_FragColor\n' + FRAG_BODY;

  // {alpha, premultipliedAlpha} so the orb composites over the app stage;
  // low-power + no AA/depth/stencil exactly like the prototype.
  var GL_ATTRS = {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
    preserveDrawingBuffer: false
  };

  var UNIFORMS = ['uRes', 'uTime', 'uSwirl', 'uMode', 'uEnergy', 'uTurb', 'uPulse', 'uFade'];

  // ------------------------------------------------------------------ moods

  // The prototype's motion states, keyed by OrbEngine mood names.
  var MOODS = {
    idle:      { speed: 0.45, swirlSpeed: 0.30, energy: 0.45, turb: 0.18, pulse: 1.00 },
    listening: { speed: 1.20, swirlSpeed: 0.90, energy: 1.05, turb: 0.40, pulse: 0.55 },
    thinking:  { speed: 1.70, swirlSpeed: 3.40, energy: 0.80, turb: 1.00, pulse: 0.30 }
  };
  var LERP_KEYS = ['speed', 'swirlSpeed', 'energy', 'turb', 'pulse'];

  // ------------------------------------------------------------------ shared helpers

  function compileShader(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      var log = gl.getShaderInfoLog(sh) || 'unknown error';
      gl.deleteShader(sh);
      throw new Error((type === gl.VERTEX_SHADER ? 'vertex' : 'fragment') + ' shader compile error:\n' + log.slice(0, 2000));
    }
    return sh;
  }

  function buildProgram(st) {
    var gl = st.gl;
    var vs = compileShader(gl, gl.VERTEX_SHADER, st.isGL2 ? VS2 : VS1);
    var fs = compileShader(gl, gl.FRAGMENT_SHADER, st.isGL2 ? FS2 : FS1);
    var pr = gl.createProgram();
    gl.attachShader(pr, vs);
    gl.attachShader(pr, fs);
    if (!st.isGL2) gl.bindAttribLocation(pr, 0, 'aPos');
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error('program link error:\n' + (gl.getProgramInfoLog(pr) || ''));
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    st.prog = pr;
    st.U = {};
    for (var i = 0; i < UNIFORMS.length; i++) st.U[UNIFORMS[i]] = gl.getUniformLocation(pr, UNIFORMS[i]);
    if (!st.isGL2) {
      st.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, st.buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }
    gl.useProgram(pr);
  }

  function getGL(target) {
    var gl = target.getContext('webgl2', GL_ATTRS);
    var isGL2 = !!gl;
    if (!gl) gl = target.getContext('webgl', GL_ATTRS) || target.getContext('experimental-webgl', GL_ATTRS);
    return gl ? { gl: gl, isGL2: isGL2 } : null;
  }

  // Full capability probe on an OFFSCREEN canvas (never appended): context
  // availability, software-rasterizer blocklist, shader compile/link. Only if
  // everything passes do we claim the visible canvas with a WebGL context —
  // otherwise it stays free for the 2D fallback.
  function probeGL() {
    var pc = document.createElement('canvas');
    pc.width = 8;
    pc.height = 8;
    var got = getGL(pc);
    if (!got) return false;
    var gl = got.gl;
    var ok = true;
    try {
      var dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) {
        var rname = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
        if (/swiftshader|software|llvmpipe/i.test(rname)) ok = false;   // 2D orb is cheaper there
      }
    } catch (e) { /* renderer string unavailable — assume hardware */ }
    if (ok) {
      try {
        buildProgram({ gl: gl, isGL2: got.isGL2, U: {} });
      } catch (e) {
        ok = false;
      }
    }
    try {
      var lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    } catch (e) { /* best-effort cleanup */ }
    return ok;
  }

  // 2D-fallback palette helpers (JS mirror of the shader's pal()).
  function jsPal(x, ph, m) {
    var out = [0, 0, 0];
    var oa = [0.50, 0.40, 0.80], ob = [0.45, 0.45, 0.15], od = [0.00, 0.50, 0.25];
    var ja = [0.62, 0.40, 0.125], jb = [0.45, 0.33, 0.115], jd = [0.00, 0.03, 0.10];
    for (var i = 0; i < 3; i++) {
      var o = oa[i] + ob[i] * Math.cos(TAU * (x + od[i]) + ph);
      var j = ja[i] + jb[i] * Math.cos(TAU * (x + jd[i]) + ph);
      out[i] = Math.max(0, Math.min(1, o * (1 - m) + j * m));
    }
    return out;
  }
  function mix3(a, b, m) {
    return [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m];
  }
  function rgba(c, a) {
    return 'rgba(' + ((c[0] * 255) | 0) + ',' + ((c[1] * 255) | 0) + ',' + ((c[2] * 255) | 0) + ',' + a.toFixed(3) + ')';
  }

  // ------------------------------------------------------------------ skin

  function createPlasma(canvas) {
    // motion state (prototype defaults; 'gold' = prototype JARVIS mode = uMode 1)
    var cur = { speed: 0.45, swirlSpeed: 0.30, energy: 0.45, turb: 0.18, pulse: 1.00 };
    var tgt = MOODS.idle;
    var modeTgt = 1, modeCur = 1;
    var fadeTgt = 1, fadeCur = 1;       // dim states ease this to 0.55
    var audioTgt = 0, audioCur = 0;
    var phase = 12.0, swirl = 5.0;      // fixed pleasant start (also the reduced-motion pose)
    var last = 0, raf = 0;
    var paused = false, destroyed = false;
    var renderer = null;

    var mqRM = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var reduced = !!(mqRM && mqRM.matches);
    function onRM(e) { reduced = e.matches; kick(); }
    if (mqRM) {
      if (mqRM.addEventListener) mqRM.addEventListener('change', onRM);
      else if (mqRM.addListener) mqRM.addListener(onRM);
    }

    function resizeCanvas() {
      if (!canvas) return;
      // physical pixels; dpr capped at 2, then rendered at 0.75x — the glow content hides the upscale
      var rect = canvas.getBoundingClientRect();
      var s = Math.min(window.devicePixelRatio || 1, 2) * 0.75;
      var w = Math.max(64, Math.round(rect.width * s));
      var h = Math.max(64, Math.round(rect.height * s));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }

    // ---------------------------------------------------------------- WebGL renderer

    function makeGL() {
      if (!probeGL()) return null;
      var got = getGL(canvas);
      if (!got) return null;
      var gl = got.gl;
      var st = { gl: gl, isGL2: got.isGL2, prog: null, U: {}, buf: null };
      try {
        buildProgram(st);
      } catch (e) {
        return null;   // probe passed but real context didn't — instance stays inert rather than crashing
      }
      gl.clearColor(0, 0, 0, 0);   // transparent stage

      st.onLost = function (e) {
        e.preventDefault();          // announce we will restore
        stopLoop();
      };
      st.onRestored = function () {
        try {
          buildProgram(st);          // ALL GPU resources are gone; recreate everything
          gl.clearColor(0, 0, 0, 0);
          kick();
        } catch (err) { /* context came back unusable; stay dark rather than crash */ }
      };
      canvas.addEventListener('webglcontextlost', st.onLost);
      canvas.addEventListener('webglcontextrestored', st.onRestored);

      st.draw = function () {
        if (gl.isContextLost()) return;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(st.prog);
        gl.uniform2f(st.U.uRes, canvas.width, canvas.height);
        gl.uniform1f(st.U.uTime, phase);
        gl.uniform1f(st.U.uSwirl, swirl);
        gl.uniform1f(st.U.uMode, modeCur);
        gl.uniform1f(st.U.uEnergy, cur.energy * (1 + 0.4 * audioCur));
        gl.uniform1f(st.U.uTurb, cur.turb);
        gl.uniform1f(st.U.uPulse, cur.pulse);
        gl.uniform1f(st.U.uFade, fadeCur);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      st.dispose = function () {
        if (canvas) {
          canvas.removeEventListener('webglcontextlost', st.onLost);
          canvas.removeEventListener('webglcontextrestored', st.onRestored);
        }
        try {
          var lose = gl.getExtension('WEBGL_lose_context');
          if (lose) lose.loseContext();
        } catch (e) { /* best-effort GPU cleanup */ }
      };
      return st;
    }

    // ---------------------------------------------------------------- 2D canvas fallback

    function make2D() {
      var ctx = canvas.getContext('2d');
      if (!ctx) return null;

      // precomputed noise-displaced filament chords — deterministic LCG seed
      var seed = 4107;
      function srand() {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      }
      var fils = [];
      for (var i = 0; i < 7; i++) {
        var a0 = srand() * TAU;
        fils.push({
          a0: a0,
          a1: a0 + 1.6 + srand() * 2.4,
          ph: srand() * TAU,
          fq: 2 + srand() * 3,
          amp: 0.10 + srand() * 0.14,
          sp: 6 + (i % 3) * 3
        });
      }

      var st = { is2D: true };
      st.draw = function () {
        var w = canvas.width, h = canvas.height;
        var W0 = TAU / P, t = phase;
        var E = cur.energy * (1 + 0.4 * audioCur), m = modeCur, fade = fadeCur;
        var ph = 3 * W0 * t;
        var R = Math.min(w, h) * 0.28 * (1 + 0.018 * cur.pulse * Math.sin(24 * W0 * t));
        var c = ctx, g, i2, j2;

        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalCompositeOperation = 'source-over';
        c.globalAlpha = 1;
        c.shadowBlur = 0;
        c.clearRect(0, 0, w, h);           // transparent stage — no page fill
        c.translate(w / 2, h / 2);

        // base glass sphere (opaque body; the orb itself still occludes)
        g = c.createRadialGradient(-R * 0.25, -R * 0.3, R * 0.1, 0, 0, R);
        g.addColorStop(0, rgba(mix3([0.055, 0.075, 0.13], [0.105, 0.075, 0.03], m), 1));
        g.addColorStop(0.65, rgba(mix3([0.016, 0.020, 0.038], [0.035, 0.024, 0.010], m), 1));
        g.addColorStop(1, 'rgba(2,2,4,1)');
        c.save();
        c.beginPath();
        c.arc(0, 0, R, 0, TAU);
        c.fillStyle = g;
        c.fill();
        c.clip();

        // orbiting plasma blobs
        c.globalCompositeOperation = 'lighter';
        for (i2 = 0; i2 < 3; i2++) {
          var aa = (4 - i2) * W0 * t * (1 + i2 * 0.3) + i2 * 2.1;
          var bx = Math.cos(aa) * R * 0.35;
          var by = Math.sin(aa * 0.8 + i2) * R * 0.35;
          var bc = jsPal(0.15 + 0.3 * i2, ph, m);
          g = c.createRadialGradient(bx, by, 0, bx, by, R * 0.7);
          g.addColorStop(0, rgba(bc, (0.16 + 0.16 * E) * fade));
          g.addColorStop(1, rgba(bc, 0));
          c.fillStyle = g;
          c.beginPath();
          c.arc(bx, by, R * 0.7, 0, TAU);
          c.fill();
        }

        // filaments
        var filc = mix3([0.5, 0.85, 1.0], [1.0, 0.8, 0.38], m);
        for (i2 = 0; i2 < fils.length; i2++) {
          var f = fils[i2];
          var x0 = Math.cos(f.a0) * R * 0.8, y0 = Math.sin(f.a0) * R * 0.8;
          var x1 = Math.cos(f.a1) * R * 0.8, y1 = Math.sin(f.a1) * R * 0.8;
          var nx = -(y1 - y0), ny = (x1 - x0);
          var nl = Math.sqrt(nx * nx + ny * ny) || 1;
          nx /= nl; ny /= nl;
          c.beginPath();
          for (j2 = 0; j2 <= 20; j2++) {
            var u = j2 / 20;
            var off = Math.sin(u * Math.PI) * Math.sin(u * f.fq * Math.PI + f.ph + f.sp * W0 * t) * f.amp * R;
            var x = x0 + (x1 - x0) * u + nx * off;
            var y = y0 + (y1 - y0) * u + ny * off;
            if (j2 === 0) c.moveTo(x, y); else c.lineTo(x, y);
          }
          var flick = 0.5 + 0.5 * Math.sin(f.ph * 3 + 9 * W0 * t);
          c.strokeStyle = rgba(filc, (0.10 + (0.25 + 0.35 * E) * flick) * fade);
          c.lineWidth = Math.max(1, R * 0.012);
          c.shadowColor = rgba(filc, 0.8 * fade);
          c.shadowBlur = R * 0.06;
          c.stroke();
        }
        c.shadowBlur = 0;

        // core glow
        var cc = jsPal(0.1, ph, m);
        g = c.createRadialGradient(0, 0, 0, 0, 0, R * 0.55);
        g.addColorStop(0, rgba(cc, (0.20 + 0.30 * E) * fade));
        g.addColorStop(1, rgba(cc, 0));
        c.fillStyle = g;
        c.beginPath();
        c.arc(0, 0, R * 0.55, 0, TAU);
        c.fill();
        c.restore();   // drop clip, back to source-over

        // rim ring + halo
        c.globalCompositeOperation = 'lighter';
        var rimc = jsPal(0.55, ph + 2, m);
        g = c.createRadialGradient(0, 0, R * 0.78, 0, 0, R * 1.28);
        g.addColorStop(0, rgba(rimc, 0));
        g.addColorStop(0.42, rgba(rimc, (0.28 + 0.30 * E) * fade));
        g.addColorStop(1, rgba(rimc, 0));
        c.fillStyle = g;
        c.beginPath();
        c.arc(0, 0, R * 1.28, 0, TAU);
        c.fill();
        g = c.createRadialGradient(0, 0, R, 0, 0, R * 2.0);
        g.addColorStop(0, rgba(rimc, (0.10 + 0.12 * E) * fade));
        g.addColorStop(1, rgba(rimc, 0));
        c.fillStyle = g;
        c.beginPath();
        c.arc(0, 0, R * 2.0, 0, TAU);
        c.fill();

        // specular hotspot
        g = c.createRadialGradient(-R * 0.32, -R * 0.38, 0, -R * 0.32, -R * 0.38, R * 0.30);
        g.addColorStop(0, 'rgba(230,240,255,' + (0.30 * fade).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(230,240,255,0)');
        c.fillStyle = g;
        c.beginPath();
        c.arc(-R * 0.32, -R * 0.38, R * 0.30, 0, TAU);
        c.fill();
        c.globalCompositeOperation = 'source-over';
      };
      st.dispose = function () { };
      return st;
    }

    // ---------------------------------------------------------------- animation loop

    function frame(ts) {
      raf = 0;
      if (paused || destroyed) return;
      var dt = (ts - last) / 1000;
      if (!(dt > 0)) dt = 0.016;
      if (dt > 0.1) dt = 0.1;      // clamp resume-from-hidden jumps
      last = ts;

      // exponential ease toward target state — never snaps
      var k = 1 - Math.exp(-dt * 3);
      var kA = 1 - Math.exp(-dt * 10);   // audio tracks faster (hologram-style smoothing)
      var delta = 0, i, key, dv;
      for (i = 0; i < LERP_KEYS.length; i++) {
        key = LERP_KEYS[i];
        dv = tgt[key] - cur[key];
        cur[key] += dv * k;
        if (Math.abs(dv) > delta) delta = Math.abs(dv);
      }
      dv = modeTgt - modeCur;
      modeCur += dv * k;
      if (Math.abs(dv) > delta) delta = Math.abs(dv);
      dv = fadeTgt - fadeCur;
      fadeCur += dv * k;
      if (Math.abs(dv) > delta) delta = Math.abs(dv);
      audioCur += (audioTgt - audioCur) * kA;

      if (!reduced) {
        // two independently integrated phases; both wrap seamlessly at P
        phase = (phase + dt * cur.speed) % P;
        swirl = (swirl + dt * cur.swirlSpeed) % P;
      }

      resizeCanvas();
      if (renderer) renderer.draw();

      // reduced motion: settle transitions, then stop scheduling entirely (0 fps);
      // setState/setPalette kick() a fresh settle-and-render
      var animating = !reduced || delta > 0.002;
      if (!document.hidden && animating) schedule();
    }

    function schedule() { if (!raf) raf = requestAnimationFrame(frame); }
    function kick() {
      if (paused || destroyed) return;
      last = performance.now();
      schedule();
    }
    function stopLoop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

    function onVis() {
      if (document.hidden) stopLoop();
      else if (!paused) kick();
    }
    document.addEventListener('visibilitychange', onVis);

    var ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(function () {
        resizeCanvas();
        kick();
      });
      ro.observe(canvas.parentElement || canvas);
    }

    // ---------------------------------------------------------------- boot

    renderer = makeGL();
    if (!renderer) renderer = make2D();
    if (canvas && canvas.dataset) {
      canvas.dataset.orbRenderer = !renderer ? 'none' : (renderer.is2D ? '2d' : (renderer.isGL2 ? 'webgl2' : 'webgl1'));
    }
    resizeCanvas();
    kick();

    // ---------------------------------------------------------------- instance

    return {
      setState: function (appState) {
        if (destroyed) return;
        var mapped = window.OrbEngine.mapStateToMood(appState);
        tgt = MOODS[mapped.mood] || MOODS.idle;
        fadeTgt = mapped.dim ? 0.55 : 1;
        kick();
      },
      setAudioLevel: function (level) {
        if (destroyed) return;
        var v = Number(level);
        if (!isFinite(v)) v = 0;
        audioTgt = Math.max(0, Math.min(1, v));
      },
      setPalette: function (name) {
        if (destroyed) return;
        modeTgt = window.OrbEngine.normalizePalette(name) === 'gold' ? 1 : 0;
        kick();
      },
      setPaused: function (p) {
        if (destroyed) return;
        paused = Boolean(p);
        if (paused) stopLoop();
        else kick();
      },
      resize: function () {
        if (destroyed) return;
        resizeCanvas();
        kick();
      },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        stopLoop();
        if (ro) { ro.disconnect(); ro = null; }
        document.removeEventListener('visibilitychange', onVis);
        if (mqRM) {
          if (mqRM.removeEventListener) mqRM.removeEventListener('change', onRM);
          else if (mqRM.removeListener) mqRM.removeListener(onRM);
        }
        if (renderer && renderer.dispose) renderer.dispose();
        renderer = null;
        canvas = null;
      }
    };
  }

  window.OrbEngine.register('plasma', { label: 'Plasma', create: createPlasma });
})();
