// Halation orb skin — eclipse corona: a near-black glass disc wrapped in an
// additive light-wrap corona (canvas-2d, conic-gradient ring layers).
// Faithful port of docs/jarvis-orb-f.html into the OrbEngine skin contract.
// Classic script (no modules); registers itself as 'halation' on window.OrbEngine.
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  // ---------- helpers ----------
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function mix3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  function hash(i) { var s = Math.sin(i * 127.1) * 43758.5453; return s - Math.floor(s); }
  function angDist(a, b) {
    var d = (a - b) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return Math.abs(d);
  }
  function rgba(r, g, b, a) {
    return 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + (a <= 0 ? 0 : (a >= 1 ? 1 : +a.toFixed(4))) + ')';
  }
  function colClamp(v) { return v > 255 ? 255 : v; }

  // ---------- palettes (circumferential color stops) ----------
  var PAL_OBSIDIAN = [
    [255, 62, 172],    // magenta
    [189, 86, 255],    // violet
    [104, 120, 255],   // indigo
    [52, 216, 255],    // cyan
    [96, 158, 255],    // azure
    [219, 72, 236]     // purple-magenta
  ];
  var PAL_GOLD = [
    [255, 148, 24],
    [255, 182, 48],
    [255, 214, 122],
    [255, 178, 31],
    [255, 122, 14],
    [255, 196, 80]
  ];
  var CRES_OBS = [226, 235, 255];
  var CRES_GOLD = [255, 241, 212];
  var GREY_OBS = [44, 46, 60];
  var GREY_GOLD = [58, 47, 32];

  var DISC_OBS = [[13, 14, 22], [6, 7, 11], [8, 9, 15], [15, 17, 27]];
  var DISC_GOLD = [[19, 14, 9], [8, 7, 5], [11, 9, 6], [25, 19, 11]];

  function sampPal(pal, ang) {
    var n = pal.length;
    var p = (ang / TAU * n) % n;
    if (p < 0) p += n;
    var i = Math.floor(p), f = p - i;
    var u = f * f * (3 - 2 * f);
    var a = pal[i], b = pal[(i + 1) % n];
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  }

  // ---------- mood targets (idle / listening / thinking) ----------
  var STATES = {
    idle:      { gain: 0.94, ripple: 0.10, ripSpd: 0.55, rot: 0.045, rayGain: 0.60, flare: 0.0, shim: 1.0, breA: 0.06, breP: 6.4 },
    listening: { gain: 1.30, ripple: 0.46, ripSpd: 2.70, rot: 0.100, rayGain: 0.88, flare: 0.0, shim: 3.1, breA: 0.11, breP: 2.3 },
    thinking:  { gain: 1.01, ripple: 0.17, ripSpd: 0.95, rot: 0.430, rayGain: 0.74, flare: 1.0, shim: 1.5, breA: 0.05, breP: 4.8 }
  };

  var N = 96;            // circumferential samples
  var NRAY = 9;          // soft angular ray spikes
  var KEY_A = -2.05;     // key-light angle (upper-left)

  class HalationOrb {
    constructor(canvas) {
      this.canvas = canvas;
      // Alpha-enabled context: the app stage shows through everywhere the orb isn't.
      this.ctx = canvas.getContext('2d');
      this.scratch = document.createElement('canvas'); // offscreen only, never appended
      this.sctx = this.scratch.getContext('2d');
      this.hasConic = typeof this.sctx.createConicGradient === 'function';

      // state machine (smoothed params, prototype-faithful)
      this.appState = 'ready';
      this.mood = 'idle';
      this.p = {};
      for (var k in STATES.idle) this.p[k] = STATES.idle[k];
      this.mMix = 1;      // 0 = obsidian, 1 = gold — gold (JARVIS amber) is the default
      this.mTarget = 1;
      this.dimMix = 0;    // 1 = dimmed (error/offline), intensity settles near 55%
      this.dimTarget = 0;
      this.audio = 0;
      this.targetAudio = 0;
      this.audioOn = false;

      // deterministic seeded randomness (flare spawning)
      this.seed = 911;

      this.flares = [];
      this.flareTimer = 0.45;

      this.rayAng = [];
      this.rayW = [];
      this.raySig = [];
      for (var ri = 0; ri < NRAY; ri++) {
        this.rayAng.push((ri * 2.399963) % TAU);
        this.rayW.push(0.35 + 0.65 * hash(ri + 3));
        this.raySig.push(0.032 + 0.075 * hash(ri + 11));
      }
      this.rayRot = 0;
      this.hueRot = 0;

      // per-frame sampled arrays
      this.colR = new Float32Array(N);
      this.colG = new Float32Array(N);
      this.colB = new Float32Array(N);
      this.iArr = new Float32Array(N);
      this.rayArr = new Float32Array(N);
      this.cresArr = new Float32Array(N);
      this.palMixed = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
      this.avgCol = [0, 0, 0];
      this.cresCol = [0, 0, 0];
      this.greyCol = [0, 0, 0];
      this.discCols = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];

      // sizing
      this.W = 0; this.H = 0; this.dpr = 1;
      this.R = 100; this.CX = 0; this.CY = 0;
      this.EXT = 200; this.S = 0; this.gs = 1;

      this.t = 7.0;      // animation clock (frozen under reduced motion)
      this.lastNow = 0;
      this.rafId = 0;
      this.running = false;
      this.paused = false;
      this.destroyed = false;

      this._frame = this.frame.bind(this);
      this._onVis = () => {
        if (this.destroyed) return;
        if (document.hidden) {
          if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = 0; }
          this.running = false;
        } else {
          this.ensureLoop();
        }
      };
      this._onRmq = (e) => {
        if (this.destroyed) return;
        this.reduced = e.matches;
        this.ensureLoop();
      };

      this.rmq = typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
      this.reduced = this.rmq ? this.rmq.matches : false;
      if (this.rmq && this.rmq.addEventListener) this.rmq.addEventListener('change', this._onRmq);
      document.addEventListener('visibilitychange', this._onVis);

      this.ro = null;
      if (typeof ResizeObserver === 'function' && canvas.parentElement) {
        this.ro = new ResizeObserver(() => this.resize());
        this.ro.observe(canvas.parentElement);
      }

      this.resize(); // paints a first frame + kicks off the loop
    }

    random() {
      this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
      return this.seed / 4294967296;
    }

    // ---------- public skin API ----------
    setState(appState) {
      if (this.destroyed) return;
      this.appState = appState || 'ready';
      var mapped = window.OrbEngine.mapStateToMood(this.appState);
      this.mood = STATES[mapped.mood] ? mapped.mood : 'idle';
      this.dimTarget = mapped.dim ? 1 : 0;
      this.audioOn = this.appState === 'listening' || this.appState === 'speaking';
      if (this.mood === 'thinking') this.flareTimer = Math.min(this.flareTimer, 0.4);
      this.ensureLoop();
    }

    setAudioLevel(level) {
      this.targetAudio = clamp(Number(level) || 0, 0, 1);
    }

    setPalette(name) {
      if (this.destroyed) return;
      var norm = window.OrbEngine.normalizePalette(name);
      this.mTarget = norm === 'gold' ? 1 : 0;
      this.ensureLoop();
    }

    setPaused(paused) {
      this.paused = Boolean(paused);
      if (this.paused) {
        if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = 0; }
        this.running = false;
      } else {
        this.ensureLoop();
      }
    }

    resize() {
      if (this.destroyed) return;
      var rect = this.canvas.getBoundingClientRect();
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.W = Math.max(1, rect.width);
      this.H = Math.max(1, rect.height);
      this.canvas.width = Math.max(2, Math.round(this.W * this.dpr));
      this.canvas.height = Math.max(2, Math.round(this.H * this.dpr));
      // Prototype used R = windowHeight * 0.20; in a sized stage the shorter
      // side plays that role so the full corona (R * 2.35) always fits.
      this.R = Math.min(340, Math.min(this.W, this.H) * 0.20);
      this.CX = this.W / 2;
      this.CY = this.H / 2;
      this.EXT = this.R * 2.35;
      this.S = Math.min(1500, Math.max(2, Math.ceil(this.EXT * 2 * this.dpr)));
      this.scratch.width = this.S;
      this.scratch.height = this.S;
      this.gs = this.S / (this.EXT * 2);
      if (!this.running) { this.computeFrame(0.016); this.render(); }
      this.ensureLoop();
    }

    destroy() {
      this.destroyed = true;
      this.paused = true;
      if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = 0; }
      this.running = false;
      if (this.ro) { this.ro.disconnect(); this.ro = null; }
      document.removeEventListener('visibilitychange', this._onVis);
      if (this.rmq && this.rmq.removeEventListener) this.rmq.removeEventListener('change', this._onRmq);
      this.rmq = null;
      this.flares = [];
      this.canvas = null;
      this.ctx = null;
      this.scratch = null;
      this.sctx = null;
    }

    // ---------- simulation ----------
    computeFrame(dt) {
      var p = this.p;
      var t = this.t;

      // smooth params toward mood targets
      var tgt = STATES[this.mood];
      var kk = 1 - Math.exp(-3.4 * dt);
      for (var key in tgt) p[key] += (tgt[key] - p[key]) * kk;
      this.mMix += (this.mTarget - this.mMix) * (1 - Math.exp(-4.4 * dt));
      this.dimMix += (this.dimTarget - this.dimMix) * (1 - Math.exp(-4.4 * dt));
      this.audio += (this.targetAudio - this.audio) * (1 - Math.exp(-9 * dt));

      this.hueRot += p.rot * dt;
      this.rayRot += (p.rot * 0.45 + 0.008) * dt;

      // flares (thinking) — deterministic seeded spawning
      if (p.flare > 0.03) {
        this.flareTimer -= dt;
        if (this.flareTimer <= 0 && this.flares.length < 4) {
          this.flares.push({
            ang: this.random() * TAU,
            t0: t,
            dur: 1.7 + this.random() * 1.2,
            str: (0.55 + this.random() * 0.5) * p.flare
          });
          this.flareTimer = 1.0 + this.random() * 1.7;
        }
      } else {
        this.flareTimer = Math.min(this.flareTimer, 0.45);
      }
      for (var fi = this.flares.length - 1; fi >= 0; fi--) {
        if (t - this.flares[fi].t0 > this.flares[fi].dur) this.flares.splice(fi, 1);
      }

      // mixed palette + shared colors
      var s6;
      for (s6 = 0; s6 < 6; s6++) {
        this.palMixed[s6] = mix3(PAL_OBSIDIAN[s6], PAL_GOLD[s6], this.mMix);
      }
      this.avgCol[0] = this.avgCol[1] = this.avgCol[2] = 0;
      for (s6 = 0; s6 < 6; s6++) {
        this.avgCol[0] += this.palMixed[s6][0] / 6;
        this.avgCol[1] += this.palMixed[s6][1] / 6;
        this.avgCol[2] += this.palMixed[s6][2] / 6;
      }
      this.cresCol = mix3(CRES_OBS, CRES_GOLD, this.mMix);
      this.greyCol = mix3(GREY_OBS, GREY_GOLD, this.mMix);
      for (var d4 = 0; d4 < 4; d4++) this.discCols[d4] = mix3(DISC_OBS[d4], DISC_GOLD[d4], this.mMix);

      var breathe = 1 + p.breA * Math.sin(t * TAU / p.breP);
      // subtle audio-coupled energy while listening/speaking (skipped under reduced motion)
      var audioBoost = (this.audioOn && !this.reduced) ? 1 + this.audio * 0.22 : 1;
      var gain = p.gain * breathe * audioBoost;
      var wt1 = t * p.ripSpd, wt2 = t * p.ripSpd * 0.77 + 1.7, wt3 = t * p.ripSpd * 1.31 + 4.1;

      for (var i = 0; i < N; i++) {
        var th = i * TAU / N;

        // corona intensity: anisotropy toward key light + travelling ripple + flares
        var dKey = angDist(th, KEY_A);
        var aniso = 0.66 + 0.62 * Math.exp(-(dKey * dKey) / (2 * 0.95 * 0.95));
        var wave = 1 + p.ripple * (0.50 * Math.sin(3 * th - wt1)
                                 + 0.33 * Math.sin(5 * th + wt2)
                                 + 0.22 * Math.sin(8 * th - wt3));
        // fine filamentary shimmer so the corona is articulate, not airbrushed
        // (three incommensurate frequencies so it never reads as petals)
        var fil = 1 + 0.10 * Math.sin(11 * th + t * 0.7 + 2.0 * Math.sin(th + t * 0.23))
                    + 0.07 * Math.sin(17 * th - t * 0.5)
                    + 0.06 * Math.sin(7 * th + t * 0.31 + 1.3 * Math.sin(2 * th - t * 0.17));
        var I = gain * aniso * wave * fil;

        var fWhite = 0;
        for (var f = 0; f < this.flares.length; f++) {
          var fl = this.flares[f];
          var u = (t - fl.t0) / fl.dur;
          if (u < 0 || u > 1) continue;
          var env = Math.pow(Math.sin(Math.PI * u), 1.6) * fl.str;
          var fa = env * Math.exp(-(angDist(th, fl.ang) * angDist(th, fl.ang)) / (2 * 0.45 * 0.45));
          I += fa;
          fWhite += fa;
        }
        if (I < 0) I = 0;
        this.iArr[i] = I;

        // color: rotating hue field with wandering interleaved bands (aurora flow)
        var hueTh = th + this.hueRot + 0.38 * Math.sin(2 * th + t * 0.13) + 0.22 * Math.sin(5 * th - t * 0.09);
        var col = sampPal(this.palMixed, hueTh);
        var w = clamp(fWhite * 0.5, 0, 0.55) + 0.10 * Math.exp(-(dKey * dKey) / (2 * 0.5 * 0.5));
        this.colR[i] = col[0] + (255 - col[0]) * w;
        this.colG[i] = col[1] + (255 - col[1]) * w;
        this.colB[i] = col[2] + (255 - col[2]) * w;

        // rays: soft angular spikes + broad wings around key light, coupled to corona
        var ray = 0;
        for (var rj = 0; rj < NRAY; rj++) {
          var ra = this.rayAng[rj] + this.rayRot;
          var rd = angDist(th, ra);
          var shim = 0.72 + 0.28 * Math.sin(t * (1.05 + hash(rj) * 0.9) * p.shim + rj * 2.7);
          ray += this.rayW[rj] * shim * Math.exp(-(rd * rd) / (2 * this.raySig[rj] * this.raySig[rj]));
        }
        ray += 0.5 * Math.exp(-(angDist(th, KEY_A - 0.85) * angDist(th, KEY_A - 0.85)) / (2 * 0.42 * 0.42));
        ray += 0.4 * Math.exp(-(angDist(th, KEY_A + 0.95) * angDist(th, KEY_A + 0.95)) / (2 * 0.38 * 0.38));
        ray += fWhite * 0.8;
        this.rayArr[i] = clamp(ray, 0, 1.6) * p.rayGain * (0.30 + 0.55 * clamp(I, 0, 1.4));

        // crescent: bright wrap of light at the key angle, with a white-hot core,
        // plus a faint counter-light opposite so the sphere reads in 3D
        var dOpp = angDist(th, KEY_A + Math.PI);
        var cres = 0.62 * Math.exp(-(dKey * dKey) / (2 * 0.62 * 0.62))
                 + 0.60 * Math.exp(-(dKey * dKey) / (2 * 0.24 * 0.24))
                 + 0.55 * Math.exp(-(dKey * dKey) / (2 * 0.085 * 0.085))
                 + 0.16 * Math.exp(-(dOpp * dOpp) / (2 * 0.55 * 0.55));
        this.cresArr[i] = cres * (0.85 + 0.35 * (gain - 0.9));
      }
    }

    // ---------- ring layer rendering (conic color field × gaussian radial ring mask) ----------
    ringMaskFill(mu, sIn, sOut) {
      var sctx = this.sctx;
      var S = this.S, gs = this.gs;
      var c = S / 2, ext = S / 2;
      var m = mu * gs, si = Math.max(0.75, sIn * gs), so = Math.max(0.75, sOut * gs);
      var g = sctx.createRadialGradient(c, c, 0, c, c, ext);
      var lo = Math.max(0, m - 5 * si), hi = Math.min(ext, m + 5 * so);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      if (lo > 0) g.addColorStop(Math.min(1, lo / ext), 'rgba(255,255,255,0)');
      var K = 24;
      for (var i = 0; i <= K; i++) {
        var r = lo + (hi - lo) * i / K;
        var d = r - m;
        var sg = d < 0 ? si : so;
        var a = Math.exp(-(d * d) / (2 * sg * sg));
        // fade out any energy approaching the scratch edge so no square seam exists
        var edge = clamp((ext - r) / (ext * 0.10), 0, 1);
        a *= edge * edge;
        g.addColorStop(clamp(r / ext, 0, 1), 'rgba(255,255,255,' + (a < 0.0002 ? 0 : +a.toFixed(4)) + ')');
      }
      if (hi < ext) g.addColorStop(Math.min(1, hi / ext + 0.002), 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      sctx.globalCompositeOperation = 'destination-in';
      sctx.fillStyle = g;
      sctx.fillRect(0, 0, S, S);
    }

    ringLayer(alphaArr, scale, mu, sIn, sOut, cr, cg, cb) {
      // cr/cg/cb: either Float32Array per-sample colors or a flat [r,g,b]
      var sctx = this.sctx;
      var ctx = this.ctx;
      var S = this.S, gs = this.gs;
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.globalCompositeOperation = 'source-over';
      sctx.clearRect(0, 0, S, S);
      var c = S / 2, i, j, a;
      var perSample = cr.length === N;
      if (this.hasConic) {
        var g = sctx.createConicGradient(0, c, c);
        for (i = 0; i <= N; i++) {
          j = i % N;
          a = clamp(alphaArr[j] * scale, 0, 1);
          if (perSample) g.addColorStop(i / N, rgba(colClamp(cr[j]), colClamp(cg[j]), colClamp(cb[j]), a));
          else g.addColorStop(i / N, rgba(cr[0], cr[1], cr[2], a));
        }
        sctx.fillStyle = g;
        sctx.fillRect(0, 0, S, S);
      } else {
        // fallback: overlapping soft blobs along the ring, then the same mask
        sctx.globalCompositeOperation = 'lighter';
        var rad = (sIn + sOut) * 2.2 * gs;
        for (i = 0; i < N; i += 2) {
          a = clamp(alphaArr[i] * scale, 0, 1) * 0.55;
          if (a <= 0.002) continue;
          var th = i * TAU / N;
          var bx = c + Math.cos(th) * mu * gs, by = c + Math.sin(th) * mu * gs;
          var bg = sctx.createRadialGradient(bx, by, 0, bx, by, rad);
          var rr = perSample ? cr[i] : cr[0], gg = perSample ? cg[i] : cr[1], bb = perSample ? cb[i] : cr[2];
          bg.addColorStop(0, rgba(rr, gg, bb, a));
          bg.addColorStop(0.5, rgba(rr, gg, bb, a * 0.35));
          bg.addColorStop(1, rgba(rr, gg, bb, 0));
          sctx.fillStyle = bg;
          sctx.fillRect(bx - rad, by - rad, rad * 2, rad * 2);
        }
      }
      this.ringMaskFill(mu, sIn, sOut);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.scratch, this.CX - this.EXT, this.CY - this.EXT, this.EXT * 2, this.EXT * 2);
      ctx.globalCompositeOperation = 'source-over';
    }

    // ---------- main render ----------
    render() {
      var ctx = this.ctx;
      var p = this.p;
      var t = this.t;
      var R = this.R, CX = this.CX, CY = this.CY;

      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      // transparent stage — no background fill, no vignette; only the orb and its glow
      ctx.clearRect(0, 0, this.W, this.H);

      var dimF = 1 - 0.45 * this.dimMix; // error/offline settles near 55% intensity
      var gainN = clamp(p.gain, 0.5, 1.6);

      // ambient wash — corona light bleeding onto whatever sits behind the orb
      var wash = ctx.createRadialGradient(CX, CY, 0, CX, CY, R * 3.1);
      var wA = 0.075 * gainN * dimF;
      wash.addColorStop(0,    rgba(this.avgCol[0], this.avgCol[1], this.avgCol[2], wA));
      wash.addColorStop(0.30, rgba(this.avgCol[0], this.avgCol[1], this.avgCol[2], wA * 0.55));
      wash.addColorStop(0.60, rgba(this.avgCol[0], this.avgCol[1], this.avgCol[2], wA * 0.18));
      wash.addColorStop(1,    rgba(this.avgCol[0], this.avgCol[1], this.avgCol[2], 0));
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.globalCompositeOperation = 'source-over';

      // BACK: broad aurora bleed, core corona, rays (disc occludes their inner halves)
      var wideGain = lerp(0.055, 0.036, this.mMix) * dimF;
      this.ringLayer(this.iArr, wideGain, R * 1.02, R * 0.32, R * 0.74, this.colR, this.colG, this.colB);
      this.ringLayer(this.iArr, 0.50 * dimF, R * 1.04, R * 0.12, R * 0.30, this.colR, this.colG, this.colB);
      this.ringLayer(this.rayArr, 0.22 * dimF, R * 1.34, R * 0.22, R * 0.50, this.colR, this.colG, this.colB);

      // DISC: near-black glass
      var dg = ctx.createRadialGradient(CX - R * 0.18, CY - R * 0.22, R * 0.08, CX, CY, R);
      dg.addColorStop(0,    rgba(this.discCols[0][0], this.discCols[0][1], this.discCols[0][2], 1));
      dg.addColorStop(0.60, rgba(this.discCols[1][0], this.discCols[1][1], this.discCols[1][2], 1));
      dg.addColorStop(0.88, rgba(this.discCols[2][0], this.discCols[2][1], this.discCols[2][2], 1));
      dg.addColorStop(1,    rgba(this.discCols[3][0], this.discCols[3][1], this.discCols[3][2], 1));
      ctx.fillStyle = dg;
      ctx.beginPath(); ctx.arc(CX, CY, R, 0, TAU); ctx.fill();

      // faint internal mist
      ctx.save();
      ctx.beginPath(); ctx.arc(CX, CY, R * 0.99, 0, TAU); ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      for (var mk = 0; mk < 3; mk++) {
        var ma = t * 0.05 + mk * 2.094;
        var mr = R * (0.28 + 0.18 * Math.sin(t * 0.037 + mk * 1.7));
        var mx = CX + Math.cos(ma) * mr * 0.9, my = CY + Math.sin(ma) * mr;
        var mc = mix3(sampPal(this.palMixed, ma + this.hueRot), this.greyCol, 0.55);
        var mA = 0.045 * gainN * dimF;
        var mgr = ctx.createRadialGradient(mx, my, 0, mx, my, R * 0.62);
        mgr.addColorStop(0, rgba(mc[0], mc[1], mc[2], mA));
        mgr.addColorStop(0.5, rgba(mc[0], mc[1], mc[2], mA * 0.4));
        mgr.addColorStop(1, rgba(mc[0], mc[1], mc[2], 0));
        ctx.fillStyle = mgr;
        ctx.fillRect(mx - R * 0.62, my - R * 0.62, R * 1.24, R * 1.24);
      }
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';

      // FRONT: rim corona hugging the edge (bleeds slightly onto the glass = light wrap)
      this.ringLayer(this.iArr, 0.62 * dimF, R * 1.005, R * 0.050, R * 0.100, this.colR, this.colG, this.colB);

      // bright crescent at the key light
      this.ringLayer(this.cresArr, 0.85 * dimF, R * 0.995, R * 0.035, R * 0.022, this.cresCol, 0, 0);
    }

    // ---------- loop control ----------
    settled() {
      var tgt = STATES[this.mood];
      var m = Math.abs(this.mMix - this.mTarget);
      m = Math.max(m, Math.abs(this.dimMix - this.dimTarget));
      for (var key in tgt) m = Math.max(m, Math.abs(this.p[key] - tgt[key]));
      return m < 0.002;
    }

    frame(nowMs) {
      if (this.destroyed) return;
      this.rafId = 0;
      var now = nowMs / 1000;
      var dt = clamp(now - this.lastNow, 0, 0.05);
      this.lastNow = now;
      if (!this.reduced) this.t += dt;
      this.computeFrame(dt);
      this.render();
      if (this.paused || document.hidden) { this.running = false; return; }
      if (this.reduced && this.settled()) { this.running = false; return; }
      this.rafId = requestAnimationFrame(this._frame);
    }

    ensureLoop() {
      if (this.destroyed || this.running || this.paused || document.hidden) return;
      this.running = true;
      this.lastNow = performance.now() / 1000;
      this.rafId = requestAnimationFrame(this._frame);
    }
  }

  if (typeof window !== 'undefined' && window.OrbEngine && typeof window.OrbEngine.register === 'function') {
    window.OrbEngine.register('halation', {
      label: 'Halation',
      create: function (canvas) { return new HalationOrb(canvas); }
    });
  }
})();
