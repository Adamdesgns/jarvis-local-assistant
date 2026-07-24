// Neural orb skin — faithful port of docs/jarvis-orb-c.html ("Holographic
// Obsidian Orb, Variant C"). Canvas-2D filament brain: layered radial
// gradients + additive bezier filaments + drifting sparks + iridescent rim.
//
// Port notes:
// - The prototype used a second, CSS-blurred, screen-blended canvas for bloom.
//   Here bloom is done entirely inside the one canvas we are given: the scene
//   is downscaled into an offscreen (never-appended) half-res canvas, then
//   drawn back over itself with ctx.filter blur + 'screen' compositing.
// - Background is fully transparent — only the orb and its glow are drawn.
// - Randomness is seeded (LCG, same recipe as hologram.js) so the filament
//   ball is identical every launch.
(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.OrbEngine) return;

  var TAU = Math.PI * 2;

  // Motion states, verbatim from the prototype.
  // speed: inner clock | turb: noise amplitude | bright: light multiplier
  // rot: Y rotation | swirl: travelling-wave twist | breath: breathing speed
  // spark: particle head-count | core: inner glow strength
  var STATES = {
    idle:      { speed: 0.35, turb: 0.032, bright: 0.55, rot: 0.10, swirl: 0.06, breath: 0.55, spark: 0.35, core: 0.60 },
    listening: { speed: 0.95, turb: 0.048, bright: 1.05, rot: 0.22, swirl: 0.12, breath: 1.60, spark: 1.00, core: 1.30 },
    thinking:  { speed: 1.55, turb: 0.100, bright: 0.85, rot: 0.30, swirl: 0.95, breath: 0.90, spark: 0.70, core: 0.95 }
  };

  var FIL_COUNT = 22;
  var SPARK_COUNT = 36;

  // ---------- color helpers (pure, shared) ----------
  function hsl2rgb(h, s, l) {
    h = (((h % 360) + 360) % 360) / 360;
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    function f(t) {
      t = ((t % 1) + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  function lighten(c, f) {
    return [c[0] + (255 - c[0]) * f, c[1] + (255 - c[1]) * f, c[2] + (255 - c[2]) * f];
  }
  function mix3(a, b, m) {
    return [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m];
  }
  function css(c, a) {
    a = a < 0 ? 0 : a > 1 ? 1 : a;
    return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a.toFixed(3) + ')';
  }

  // ==================================================================
  function NeuralOrb(canvas) {
    var self = this;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    // Offscreen bloom buffer — created, never appended to the DOM.
    this.bloomC = document.createElement('canvas');
    this.bctx = this.bloomC.getContext('2d');
    this.hasConic = !!(this.ctx && typeof this.ctx.createConicGradient === 'function');

    // Deterministic seeded RNG (same LCG as hologram.js).
    this.seed = 20260723;

    this.curState = 'idle';        // 'idle' | 'listening' | 'thinking'
    this.mixTarget = 1;            // palette mix target: 0 = obsidian, 1 = gold (default)
    this.dimTarget = 1;            // 0.55 when dimmed (error / offline)
    this.dim = 1;
    this.audioTarget = 0;
    this.audio = 0;

    // Live smoothed parameter set — starts as a copy of idle, gold palette.
    this.P = { mix: 1 };
    var s = STATES.idle;
    for (var k in s) this.P[k] = s[k];

    // Phase accumulators (monotonic doubles, no wrap needed).
    this.tI = 7.3;
    this.rotA = 0.6;
    this.swirlT = 0;
    this.breathT = 0;
    this.rimShift = this.random();
    this.rimRot = -1.2;
    this.cosR = 1;
    this.sinR = 0;

    this.dpr = 1;
    this.orbR = 160;
    this.width = 1;
    this.height = 1;
    this.bloomBlur = 12;

    this.raf = 0;
    this.last = 0;
    this.paused = false;
    this.reduced = false;
    this.destroyed = false;

    this.makeFils();
    this.makeSparks();

    // rAF callback, bound once.
    this.frame = function (ts) {
      if (self.destroyed) return;
      self.raf = requestAnimationFrame(self.frame);
      var dt = (ts - self.last) / 1000;
      self.last = ts;
      if (dt < 0) dt = 0;
      if (dt > 0.1) dt = 0.1;      // clamp after tab-switch / stalls
      self.step(dt);
      self.draw();
    };

    // Track the parent container like hologram.js does.
    this.resizeObserver = null;
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(function () { self.resize(); });
      this.resizeObserver.observe(canvas.parentElement || canvas);
    }

    // prefers-reduced-motion: one static gentle frame, no loop.
    this.rmq = null;
    this.onRM = function (e) { self.applyReduced(e.matches); };
    try { this.rmq = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch (e) {}
    if (this.rmq) {
      this.reduced = this.rmq.matches;
      if (this.rmq.addEventListener) this.rmq.addEventListener('change', this.onRM);
      else if (this.rmq.addListener) this.rmq.addListener(this.onRM);
    }

    this.resize();
    if (this.reduced) {
      this.snapParams();
      this.draw();
    } else {
      this.start();
    }
  }

  // ---------- seeded randomness ----------
  NeuralOrb.prototype.random = function () {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  };
  NeuralOrb.prototype.rnd6 = function () { return this.random() * TAU; };
  NeuralOrb.prototype.freq = function () { return 0.5 + this.random() * 1.1; };

  // ---------- palette ----------
  // Seamlessly cycling palette (period 1 in t), crossfaded between modes.
  // Obsidian: cyan -> violet -> magenta sweep. Gold: narrow amber band (#ffb21f).
  NeuralOrb.prototype.pal = function (t) {
    t = t - Math.floor(t);
    var w = 0.5 - 0.5 * Math.cos(TAU * t);
    var o = hsl2rgb(188 + 152 * w, 0.85, 0.55 + 0.06 * Math.sin(TAU * t));
    var j = hsl2rgb(34 + 16 * w, 1.0, 0.52 + 0.10 * w);
    var m = this.P.mix;
    return [o[0] + (j[0] - o[0]) * m,
            o[1] + (j[1] - o[1]) * m,
            o[2] + (j[2] - o[2]) * m];
  };

  // ---------- geometry: filaments ----------
  NeuralOrb.prototype.makeFils = function () {
    this.fils = [];
    for (var i = 0; i < FIL_COUNT; i++) {
      var px, py, pz;
      do {
        px = this.random() * 2 - 1;
        py = this.random() * 2 - 1;
        pz = this.random() * 2 - 1;
      } while (px * px + py * py + pz * pz > 1);
      px *= 0.55; py *= 0.55; pz *= 0.55;

      var dx = this.random() * 2 - 1, dy = this.random() * 2 - 1, dz = this.random() * 2 - 1;
      var dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;

      var n = 6 + ((this.random() * 3) | 0);
      var pts = [];
      for (var jj = 0; jj < n; jj++) {
        pts.push({
          x: px, y: py, z: pz,
          p1: this.rnd6(), p2: this.rnd6(), p3: this.rnd6(),
          f1: this.freq(), f2: this.freq(), f3: this.freq()
        });
        dx += (this.random() * 2 - 1) * 0.7;
        dy += (this.random() * 2 - 1) * 0.7;
        dz += (this.random() * 2 - 1) * 0.7;
        dl = Math.hypot(dx, dy, dz) || 1;
        dx /= dl; dy /= dl; dz /= dl;
        px += dx * 0.30; py += dy * 0.30; pz += dz * 0.30;
        var pl = Math.hypot(px, py, pz);
        if (pl > 0.78) {             // bounced off the inner glass wall
          px *= 0.78 / pl; py *= 0.78 / pl; pz *= 0.78 / pl;
          var nx = px / 0.78, ny = py / 0.78, nz = pz / 0.78;
          dx -= nx * 1.5; dy -= ny * 1.5; dz -= nz * 1.5;
          dl = Math.hypot(dx, dy, dz) || 1;
          dx /= dl; dy /= dl; dz /= dl;
        }
      }
      this.fils.push({ pts: pts, hue: this.random() });
    }
  };

  // ---------- geometry: sparks ----------
  NeuralOrb.prototype.respawn = function (s, stagger) {
    var x, y, z;
    do {
      x = this.random() * 2 - 1; y = this.random() * 2 - 1; z = this.random() * 2 - 1;
    } while (x * x + y * y + z * z > 1);
    s.x = x * 0.70; s.y = y * 0.70; s.z = z * 0.70;
    s.vx = (this.random() * 2 - 1) * 0.06;
    s.vy = (this.random() * 2 - 1) * 0.06 - 0.015;   // faint upward bias
    s.vz = (this.random() * 2 - 1) * 0.06;
    s.ttl = 2 + this.random() * 3;
    s.age = stagger ? this.random() * s.ttl : 0;
    s.r = 0.7 + this.random() * 1.0;
    s.hue = this.random();
    s.ph = this.rnd6();
    s.tw = 0.6 + this.random() * 1.2;
  };

  NeuralOrb.prototype.makeSparks = function () {
    this.sparks = [];
    for (var i = 0; i < SPARK_COUNT; i++) {
      var s = {};
      this.respawn(s, true);
      this.sparks.push(s);
    }
  };

  // ---------- sizing ----------
  NeuralOrb.prototype.resize = function () {
    if (this.destroyed) return;
    var rect = this.canvas.getBoundingClientRect();
    var w = Math.max(1, rect.width);
    var h = Math.max(1, rect.height);
    this.width = w;
    this.height = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Same orb-to-stage ratio as the prototype (side = orbR * 3.3).
    this.orbR = Math.max(24, Math.min(w, h) / 3.3);

    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));

    // Bloom buffer at half resolution — the blur hides the downscale.
    this.bloomC.width = Math.max(1, Math.round(this.canvas.width / 2));
    this.bloomC.height = Math.max(1, Math.round(this.canvas.height / 2));
    this.bloomBlur = Math.max(1, Math.round(this.orbR * 0.09));

    // Loop repaints on its own; static/paused modes need a manual repaint.
    if (!this.raf) this.draw();
  };

  // ---------- simulation ----------
  NeuralOrb.prototype.step = function (dt) {
    var P = this.P;
    var T = STATES[this.curState];
    var k = 1 - Math.exp(-dt * 3);           // exponential smoothing — never snaps
    for (var key in T) P[key] += (T[key] - P[key]) * k;
    P.mix += (this.mixTarget - P.mix) * k;
    this.dim += (this.dimTarget - this.dim) * k;
    this.audio += (this.audioTarget - this.audio) * (1 - Math.exp(-dt * 10));

    this.tI += dt * P.speed;
    this.rotA += dt * P.rot;
    this.swirlT += dt * (0.5 + P.speed * 0.9);
    this.breathT += dt * P.breath;
    this.rimShift += dt * 0.015 * (0.5 + P.speed);
    this.rimRot += dt * 0.05;

    for (var i = 0; i < SPARK_COUNT; i++) {
      var s = this.sparks[i];
      s.age += dt * (0.4 + P.speed * 0.9);
      var sp = dt * (0.2 + P.speed);
      s.x += s.vx * sp; s.y += s.vy * sp; s.z += s.vz * sp;
      if (s.age >= s.ttl || (s.x * s.x + s.y * s.y + s.z * s.z) > 0.72) this.respawn(s, false);
    }
  };

  NeuralOrb.prototype.snapParams = function () {
    var T = STATES[this.curState];
    for (var key in T) this.P[key] = T[key];
    this.P.mix = this.mixTarget;
    this.dim = this.dimTarget;
    this.audio = this.audioTarget;
  };

  // ---------- projection ----------
  // unit-sphere point -> screen (CSS px, origin at orb center). [sx, sy, depthZ]
  NeuralOrb.prototype.project = function (x, y, z, R) {
    var X = x * this.cosR + z * this.sinR;   // rotate about Y
    var Z = z * this.cosR - x * this.sinR;
    var Y = y;
    var rho = Math.hypot(X, Y);
    // travelling-wave differential twist — bounded, never winds up into mush
    var sa = this.P.swirl * 1.4 * Math.sin(this.swirlT - rho * 2.2);
    var cs = Math.cos(sa), sn = Math.sin(sa);
    var X2 = X * cs - Y * sn;
    var Y2 = X * sn + Y * cs;
    // glass-ball magnification: front points scale up (fake refraction parallax)
    var per = 1 / (1.05 - Z * 0.30);
    return [X2 * per * R * 0.97, Y2 * per * R * 0.97, Z];
  };

  // ---------- drawing helpers ----------
  NeuralOrb.prototype.rg = function (x, y, r0, r1, stops) {
    var g = this.ctx.createRadialGradient(x, y, r0, x, y, r1);
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    return g;
  };
  NeuralOrb.prototype.fillCircle = function (r, style) {
    var ctx = this.ctx;
    ctx.fillStyle = style;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
  };
  NeuralOrb.prototype.pathThrough = function (pts) {
    var ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length - 1; i++) {
      var mx = (pts[i][0] + pts[i + 1][0]) / 2;
      var my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    var l = pts.length - 1;
    ctx.lineTo(pts[l][0], pts[l][1]);
  };

  // Iridescent rim ring: two palette cycles around the circumference with an
  // angular hot side. Conic gradient when available, arc segments otherwise.
  NeuralOrb.prototype.drawRim = function (R, w, aMul, lf) {
    var ctx = this.ctx;
    ctx.lineWidth = w;
    var N, t, col, a, kk;
    if (this.hasConic) {
      var g = ctx.createConicGradient(this.rimRot, 0, 0);
      N = 16;
      for (kk = 0; kk <= N; kk++) {
        t = kk / N;
        col = lighten(this.pal(2 * t + this.rimShift), lf);
        a = aMul * (0.62 + 0.38 * Math.cos(t * TAU - 2.3));
        g.addColorStop(t, css(col, a));
      }
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.stroke();
    } else {
      N = 48;
      var seg = TAU / N;
      for (kk = 0; kk < N; kk++) {
        t = kk / N;
        var a0 = this.rimRot + t * TAU;
        col = lighten(this.pal(2 * t + this.rimShift), lf);
        a = aMul * (0.62 + 0.38 * Math.cos(t * TAU - 2.3));
        ctx.strokeStyle = css(col, a);
        ctx.beginPath();
        ctx.arc(0, 0, R, a0 - seg * 0.65, a0 + seg * 0.65);
        ctx.stroke();
      }
    }
  };

  // ---------- main render ----------
  NeuralOrb.prototype.draw = function () {
    var ctx = this.ctx;
    if (!ctx || this.destroyed) return;
    var P = this.P;
    // dim (error/offline ~55%) and audio (subtle energy while talking) fold
    // straight into the global brightness factor.
    var brFac = P.bright * (1 + 0.05 * Math.sin(this.breathT + 1.2)) * this.dim * (1 + this.audio * 0.35);
    var R = this.orbR * (1 + 0.013 * Math.sin(this.breathT) + 0.010 * this.audio);
    var sc = this.orbR / 170;                              // stroke-width scale
    this.cosR = Math.cos(this.rotA);
    this.sinR = Math.sin(this.rotA);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, this.canvas.width / 2, this.canvas.height / 2);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    var i, j, g, colHalo;

    // 1) ambient halo behind the orb
    colHalo = this.pal(this.tI * 0.02 + 0.15);
    g = this.rg(0, 0, R * 0.80, R * 1.58, [
      [0, css(colHalo, 0.05 + 0.09 * brFac)],
      [0.45, css(colHalo, 0.03 * brFac)],
      [1, css(colHalo, 0)]
    ]);
    this.fillCircle(R * 1.6, g);

    // 2) obsidian glass body — dark, slightly lit top-left
    var bt = mix3([20, 23, 36], [30, 23, 12], P.mix);
    var bm = mix3([9, 11, 19], [14, 11, 7], P.mix);
    var be = mix3([4, 5, 10], [7, 5, 4], P.mix);
    g = this.rg(-R * 0.30, -R * 0.35, R * 0.05, R * 1.05, [
      [0, css(bt, 1)],
      [0.40, css(bm, 1)],
      [1, css(be, 1)]
    ]);
    this.fillCircle(R, g);

    // ------- interior (clipped to the sphere disc) -------
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.995, 0, TAU);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';

    // 3) energy core glow
    var cc = this.pal(this.tI * 0.045 + 0.55);
    g = this.rg(0, R * 0.05, 0, R * 0.85, [
      [0, css(cc, (0.05 + 0.13 * P.core) * brFac)],
      [0.5, css(cc, 0.045 * P.core * brFac)],
      [1, css(cc, 0)]
    ]);
    this.fillCircle(R, g);

    // 4) bottom bounce light
    var cb = this.pal(this.tI * 0.045 + 0.95);
    g = this.rg(0, R * 0.75, 0, R * 0.70, [
      [0, css(cb, 0.07 * brFac)],
      [1, css(cb, 0)]
    ]);
    this.fillCircle(R, g);

    // 5) neural filaments — additive, 3 stroke passes (haze / mid / hot core)
    for (i = 0; i < this.fils.length; i++) {
      var f = this.fils[i];
      var proj = [];
      var zsum = 0;
      var A = P.turb;
      for (j = 0; j < f.pts.length; j++) {
        var pt = f.pts[j];
        var x = pt.x + A * Math.sin(this.tI * pt.f1 + pt.p1);
        var y = pt.y + A * Math.sin(this.tI * pt.f2 + pt.p2);
        var z = pt.z + A * Math.sin(this.tI * pt.f3 + pt.p3);
        var pr = this.project(x, y, z, R);
        proj.push(pr);
        zsum += pr[2];
      }
      var az = zsum / proj.length;
      var L = 0.40 + 0.60 * ((az + 0.9) / 1.8);    // depth shading
      var col = this.pal(f.hue + this.tI * 0.05 + az * 0.06);
      var colL = lighten(col, 0.5);

      this.pathThrough(proj);
      ctx.lineWidth = 5.5 * sc;
      ctx.strokeStyle = css(col, 0.055 * L * brFac);
      ctx.stroke();
      ctx.lineWidth = 2.3 * sc;
      ctx.strokeStyle = css(col, 0.13 * L * brFac);
      ctx.stroke();
      ctx.lineWidth = Math.max(1.0 * sc, 0.75);
      ctx.strokeStyle = css(colL, 0.50 * L * brFac);
      ctx.stroke();

      // synapse nodes at start / middle / end
      var idxs = [0, proj.length >> 1, proj.length - 1];
      for (j = 0; j < 3; j++) {
        var q = proj[idxs[j]];
        var pulse = 0.5 + 0.5 * Math.sin(this.tI * 1.6 + f.hue * 17 + j * 2.1);
        var r = (1.5 + 2.2 * pulse) * sc;
        ctx.fillStyle = css(col, 0.10 * L * brFac);
        ctx.beginPath(); ctx.arc(q[0], q[1], r * 2.6, 0, TAU); ctx.fill();
        ctx.fillStyle = css(colL, (0.25 + 0.45 * pulse) * L * brFac);
        ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, TAU); ctx.fill();
      }
    }

    // 6) drifting sparks
    for (i = 0; i < SPARK_COUNT; i++) {
      var s = this.sparks[i];
      var gate = P.spark * SPARK_COUNT - i;          // smooth head-count lerp
      if (gate <= 0.02) continue;
      if (gate > 1) gate = 1;
      var ageFrac = s.age / s.ttl;
      if (ageFrac < 0) ageFrac = 0;
      if (ageFrac > 1) ageFrac = 1;
      var env = Math.sin(Math.PI * ageFrac);         // fade in / fade out
      var tw = 0.7 + 0.3 * Math.sin(this.tI * 3 * s.tw + s.ph);
      var spr = this.project(s.x, s.y, s.z, R);
      var depthL = 0.4 + 0.6 * ((spr[2] + 0.9) / 1.8);
      var sa2 = 0.55 * env * tw * gate * brFac * depthL;
      if (sa2 <= 0.004) continue;
      var scol = this.pal(s.hue + this.tI * 0.02);
      var scolL = lighten(scol, 0.6);
      var rr = s.r * sc * (0.8 + 0.4 * tw);
      g = this.rg(spr[0], spr[1], 0, rr * 5, [
        [0, css(scolL, sa2)],
        [0.25, css(scol, sa2 * 0.45)],
        [1, css(scol, 0)]
      ]);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(spr[0], spr[1], rr * 5, 0, TAU); ctx.fill();
    }

    // 7) glass edge absorption — darkens the interior toward the silhouette
    ctx.globalCompositeOperation = 'source-over';
    g = this.rg(0, 0, R * 0.55, R, [
      [0, 'rgba(2,3,6,0)'],
      [1, 'rgba(2,3,6,0.42)']
    ]);
    this.fillCircle(R, g);

    // 8) inner fresnel glow (rim tint inside the glass)
    ctx.globalCompositeOperation = 'lighter';
    var fc = this.pal(this.tI * 0.03 + 0.02);
    g = this.rg(0, 0, R * 0.72, R, [
      [0, css(fc, 0)],
      [0.75, css(fc, 0.04 * brFac)],
      [1, css(lighten(fc, 0.2), 0.22 * brFac)]
    ]);
    this.fillCircle(R, g);

    ctx.restore();   // clip off; composite restored to source-over
    // ------- end interior -------

    // 9) iridescent oil-slick rim — wide soft band + hot thin line
    ctx.globalCompositeOperation = 'lighter';
    this.drawRim(R, R * 0.05, 0.30 * brFac, 0.10);
    this.drawRim(R, Math.max(1.2, R * 0.016), 0.90 * brFac, 0.35);

    // 10) specular highlight (soft squashed ellipse, top-left)
    var sun = lighten(this.pal(0.12), 0.75);
    ctx.save();
    ctx.translate(-R * 0.34, -R * 0.44);
    ctx.rotate(0.7);
    ctx.scale(1, 0.5);
    g = this.rg(0, 0, 0, R * 0.30, [
      [0, css(sun, 0.34 * brFac)],
      [0.6, css(sun, 0.07 * brFac)],
      [1, css(sun, 0)]
    ]);
    this.fillCircle(R * 0.30, g);
    ctx.restore();
    // hot dot inside the highlight
    g = this.rg(-R * 0.34, -R * 0.44, 0, R * 0.05, [
      [0, css([255, 255, 255], 0.50 * brFac)],
      [1, css([255, 255, 255], 0)]
    ]);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(-R * 0.34, -R * 0.44, R * 0.05, 0, TAU); ctx.fill();
    // faint transmitted catchlight, bottom-right
    var cl = lighten(this.pal(0.55), 0.4);
    g = this.rg(R * 0.30, R * 0.38, 0, R * 0.14, [
      [0, css(cl, 0.10 * brFac)],
      [1, css(cl, 0)]
    ]);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(R * 0.30, R * 0.38, R * 0.14, 0, TAU); ctx.fill();

    ctx.globalCompositeOperation = 'source-over';

    // 11) bloom — in-canvas replacement for the prototype's CSS-blurred layer:
    // downscale the finished scene into the offscreen half-res buffer, then
    // draw it back over itself blurred + screen-blended at 85%.
    var bc = this.bloomC, bx = this.bctx;
    bx.setTransform(1, 0, 0, 1, 0, 0);
    bx.clearRect(0, 0, bc.width, bc.height);
    bx.drawImage(this.canvas, 0, 0, bc.width, bc.height);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.85;
    if (typeof ctx.filter === 'string') {
      ctx.filter = 'blur(' + this.bloomBlur + 'px) saturate(1.3)';
    }
    ctx.drawImage(bc, 0, 0, this.width, this.height);
    if (typeof ctx.filter === 'string') ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  // ---------- loop control ----------
  NeuralOrb.prototype.start = function () {
    if (!this.raf && !this.reduced && !this.paused && !this.destroyed) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  };
  NeuralOrb.prototype.stop = function () {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  };
  NeuralOrb.prototype.applyReduced = function (matches) {
    this.reduced = Boolean(matches);
    if (this.reduced) {
      this.stop();
      this.snapParams();
      this.draw();
    } else {
      this.start();
    }
  };

  // ---------- skin interface ----------
  NeuralOrb.prototype.setState = function (appState) {
    var m = window.OrbEngine.mapStateToMood(appState);
    this.curState = STATES[m.mood] ? m.mood : 'idle';
    this.dimTarget = m.dim ? 0.55 : 1;
    if (this.reduced) { this.snapParams(); this.draw(); }
  };

  NeuralOrb.prototype.setAudioLevel = function (level) {
    this.audioTarget = Math.max(0, Math.min(1, Number(level) || 0));
  };

  NeuralOrb.prototype.setPalette = function (name) {
    var p = window.OrbEngine.normalizePalette(name);
    this.mixTarget = p === 'obsidian' ? 0 : 1;
    if (this.reduced) { this.snapParams(); this.draw(); }
  };

  NeuralOrb.prototype.setPaused = function (paused) {
    this.paused = Boolean(paused);
    if (this.paused) this.stop();
    else this.start();
  };

  NeuralOrb.prototype.destroy = function () {
    this.destroyed = true;
    this.stop();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.rmq) {
      if (this.rmq.removeEventListener) this.rmq.removeEventListener('change', this.onRM);
      else if (this.rmq.removeListener) this.rmq.removeListener(this.onRM);
      this.rmq = null;
    }
    this.fils = null;
    this.sparks = null;
    this.ctx = null;
    this.bctx = null;
    this.bloomC = null;
    this.canvas = null;
  };

  window.OrbEngine.register('neural', {
    label: 'Neural',
    create: function (canvas) { return new NeuralOrb(canvas); }
  });
})();
