// Zen orb skin — gradient pearl. Ported from docs/jarvis-orb-e.html.
// A soft aurora sphere: sunrise base gradient, drifting screen-blend color
// blobs, iridescent rim whisper, heartbeat ripples while listening.
// The prototype's half-resolution + CSS-upscale softness trick is internal
// here: the scene renders into a small offscreen buffer, then gets drawn up
// onto the visible canvas with high-quality smoothing.
// Classic script, no modules. Registers into window.OrbEngine as 'zen'.
(function () {
  'use strict';
  var TAU = Math.PI * 2;

  /* ---------- palette (obsidian <-> gold/jarvis, lerped) ---------- */
  var PAL = {
    bgGlow:   { ob: [ 96,  82, 230], jv: [255, 170,  56] },
    baseTop:  { ob: [ 32,  27,  76], jv: [116,  68,  20] },
    baseMid:  { ob: [ 18,  14,  48], jv: [ 66,  33,  10] },
    baseBot:  { ob: [  8,   6,  24], jv: [ 24,  10,   3] },
    shade:    { ob: [  4,   2,  16], jv: [ 16,   6,   1] },
    core:     { ob: [156, 136, 255], jv: [255, 226, 168] },
    ripple:   { ob: [158, 146, 255], jv: [255, 205, 130] },
    blobs: [
      /* upper — violet / cream */
      { ob: [140, 100, 255], jv: [255, 238, 205], a: 0.55, px: -0.26, py: -0.38, br: 1.28,
        ax: 0.11, ay: 0.08, fx: 0.071, fy: 0.053, p1: 0.0, p2: 1.7 },
      /* center — indigo / amber */
      { ob: [ 76,  72, 240], jv: [255, 178,  31], a: 0.58, px:  0.30, py:  0.04, br: 1.18,
        ax: 0.09, ay: 0.11, fx: 0.049, fy: 0.067, p1: 2.1, p2: 4.0 },
      /* lower — blue / deep orange */
      { ob: [ 48, 128, 244], jv: [240, 116,  32], a: 0.50, px: -0.10, py:  0.55, br: 1.05,
        ax: 0.10, ay: 0.07, fx: 0.061, fy: 0.043, p1: 4.3, p2: 0.9 },
      /* whisper — teal / gold */
      { ob: [ 74, 196, 212], jv: [255, 216, 126], a: 0.20, px:  0.16, py: -0.08, br: 1.35,
        ax: 0.14, ay: 0.12, fx: 0.037, fy: 0.031, p1: 1.1, p2: 3.2 }
    ],
    rim: {
      ob: [[180, 154, 255], [127, 168, 255], [143, 230, 221], [217, 160, 255]],
      jv: [[255, 231, 189], [255, 178,  31], [255, 151,  82], [255, 217, 138]]
    }
  };

  function mix(a, b, t) { return a + (b - a) * t; }
  function mixc(c1, c2, t) {
    return [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];
  }
  function css(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a.toFixed(4) + ')';
  }
  function smoothstep(a, b, x) {
    var t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }
  /* eased radial gradient — cosine-squared falloff, no hard edges, no banding */
  function aura(ctx, x, y, r, c, peak) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    for (var i = 0; i <= 10; i++) {
      var p = i / 10;
      var e = 0.5 + 0.5 * Math.cos(Math.PI * p);
      g.addColorStop(p, css(c, peak * e * e));
    }
    return g;
  }

  function ZenOrb(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    /* small offscreen buffer — the internal "half resolution" surface */
    this.buf = document.createElement('canvas');
    this.bctx = this.buf.getContext('2d');
    this.ok = Boolean(this.ctx && this.bctx);

    /* tiny dither tile (invisible; prevents gradient banding) — seeded, deterministic */
    this.noisePat = null;
    if (this.ok) {
      var tile = document.createElement('canvas');
      tile.width = tile.height = 128;
      var nctx = tile.getContext('2d');
      if (nctx) {
        var id = nctx.createImageData(128, 128);
        var seed = 4107;
        for (var i = 0; i < id.data.length; i += 4) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          var v = (seed / 4294967296 * 255) | 0;
          id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
          id.data[i + 3] = 4;
        }
        nctx.putImageData(id, 0, 0);
        this.noisePat = this.bctx.createPattern(tile, 'repeat');
      }
    }

    /* state — everything eases toward its target, never snaps */
    this.palette = 'gold';        /* app default: JARVIS amber */
    this.mood = 'idle';
    this.dim = false;
    this.m = 1;                   /* 0 = obsidian, 1 = gold; start on target */
    this.wL = 0;                  /* listening weight  */
    this.wT = 0;                  /* thinking weight   */
    this.dimCur = 1;              /* 1 = full, 0.55 = dimmed (error/offline) */
    this.audio = 0;               /* smoothed audio level */
    this.audioTarget = 0;
    this.theta = 0;               /* internal gradient rotation */
    this.rimSpin = 0;             /* iridescence rotation       */
    this.tAcc = 0;
    this._raf = 0;
    this._lastNow = 0;
    this.paused = false;
    this.destroyed = false;

    /* reduced motion: one static gentle frame, no loop */
    this.reduced = false;
    this._mq = null;
    this._onMQ = null;
    try {
      var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reduced = mq.matches;
      var self = this;
      this._onMQ = function () {
        self.reduced = mq.matches;
        if (self.reduced) { self.stopLoop(); self.snap(); self.renderStatic(); }
        else self.startLoop();
      };
      if (mq.addEventListener) { mq.addEventListener('change', this._onMQ); this._mq = mq; }
    } catch (_) {}

    this._ro = null;
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      var that = this;
      this._ro = new ResizeObserver(function () { that.resize(); });
      this._ro.observe(canvas.parentElement);
    }
    this.resize();

    this._frameBound = this._frame.bind(this);
    if (this.reduced) { this.snap(); this.renderStatic(); }
    else this.startLoop();
  }

  /* ---------- skin contract ---------- */
  ZenOrb.prototype.setState = function (appState) {
    var mapped = window.OrbEngine.mapStateToMood(appState);
    this.mood = mapped.mood;
    this.dim = Boolean(mapped.dim);
    if (this.reduced) { this.snap(); this.renderStatic(); }
  };

  ZenOrb.prototype.setAudioLevel = function (level) {
    this.audioTarget = Math.max(0, Math.min(1, Number(level) || 0));
  };

  ZenOrb.prototype.setPalette = function (name) {
    this.palette = window.OrbEngine.normalizePalette(name);
    if (this.reduced) { this.snap(); this.renderStatic(); }
  };

  ZenOrb.prototype.setPaused = function (paused) {
    this.paused = Boolean(paused);
    if (this.paused) this.stopLoop();
    else this.startLoop();
  };

  ZenOrb.prototype.resize = function () {
    if (!this.ok || this.destroyed) return;
    var rect = this.canvas.getBoundingClientRect();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(2, rect.width);
    this.height = Math.max(2, rect.height);
    this.canvas.width = Math.max(2, Math.round(this.width * dpr));
    this.canvas.height = Math.max(2, Math.round(this.height * dpr));
    /* buffer at ~half res — upscaled with smoothing at blit = extra softness */
    this.bufScale = dpr * 0.55;
    this.buf.width = Math.max(2, Math.round(this.width * this.bufScale));
    this.buf.height = Math.max(2, Math.round(this.height * this.bufScale));
    this.cx = this.width / 2;
    this.cy = this.height / 2;
    this.R = Math.min(this.width, this.height) * 0.20;   /* orb ~= 40% of short side */
    if (!this._raf) this.renderStatic();                 /* keep a frame while paused/reduced */
  };

  ZenOrb.prototype.destroy = function () {
    this.destroyed = true;
    this.stopLoop();
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    if (this._mq && this._onMQ) {
      try { this._mq.removeEventListener('change', this._onMQ); } catch (_) {}
    }
    this._mq = null;
    this._onMQ = null;
    this.buf = null;
    this.bctx = null;
    this.ctx = null;
    this.canvas = null;
    this.noisePat = null;
    this.ok = false;
  };

  /* ---------- loop ---------- */
  ZenOrb.prototype.startLoop = function () {
    if (this._raf || this.reduced || this.paused || this.destroyed || !this.ok) return;
    this._lastNow = 0;
    this._raf = requestAnimationFrame(this._frameBound);
  };

  ZenOrb.prototype.stopLoop = function () {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
  };

  ZenOrb.prototype._frame = function (now) {
    if (this.destroyed || this.paused || this.reduced) { this._raf = 0; return; }
    this._raf = requestAnimationFrame(this._frameBound);
    if (!this._lastNow) this._lastNow = now;
    var dt = Math.min(0.05, (now - this._lastNow) / 1000);
    this._lastNow = now;
    this.tAcc += dt;
    this.render(this.tAcc, dt);
  };

  ZenOrb.prototype.snap = function () {
    this.m = (this.palette === 'gold') ? 1 : 0;
    this.wL = (this.mood === 'listening') ? 1 : 0;
    this.wT = (this.mood === 'thinking') ? 1 : 0;
    this.dimCur = this.dim ? 0.55 : 1;
    this.audio = this.audioTarget;
  };

  ZenOrb.prototype.renderStatic = function () {
    if (!this.ok || this.destroyed) return;
    this.render(this.tAcc || 13.7, 0.016);   /* one gentle, fixed frame */
  };

  /* ---------- render ---------- */
  ZenOrb.prototype.render = function (t, dt) {
    if (!this.ok || this.destroyed) return;
    var ctx = this.bctx;
    var W = this.width, H = this.height;
    var cx = this.cx, cy = this.cy, R = this.R;

    /* smooth interpolation toward targets — never snap */
    var mTgt = (this.palette === 'gold') ? 1 : 0;
    var lTgt = (this.mood === 'listening') ? 1 : 0;
    var tTgt = (this.mood === 'thinking') ? 1 : 0;
    var dTgt = this.dim ? 0.55 : 1;
    var km = 1 - Math.exp(-dt * 2.2);
    var ks = 1 - Math.exp(-dt * 2.6);
    this.m += (mTgt - this.m) * km;
    this.wL += (lTgt - this.wL) * ks;
    this.wT += (tTgt - this.wT) * ks;
    this.dimCur += (dTgt - this.dimCur) * ks;
    this.audio += (this.audioTarget - this.audio) * 0.16;
    var m = this.m, wL = this.wL, wT = this.wT, aud = this.audio;

    this.theta += dt * mix(0.02, 0.30, wT);   /* thinking: gradient slowly rotates */
    this.rimSpin += dt * 0.12;
    var theta = this.theta;

    ctx.setTransform(this.bufScale, 0, 0, this.bufScale, 0, 0);
    ctx.clearRect(0, 0, W, H);

    /* heartbeat phase (listening) */
    var T = 1.25;
    var beatPhase = (t % T) / T;
    var pulse = Math.exp(-4.5 * beatPhase);

    /* breathing — audio adds a whisper of extra swell while listening/speaking */
    var amp = mix(0.013, 0.020 + 0.006 * aud, wL);
    var breath = 1 + amp * Math.sin(TAU * t / 6.5);

    /* ---- ambient background glow ---- */
    var glowC = mixc(PAL.bgGlow.ob, PAL.bgGlow.jv, m);
    ctx.fillStyle = aura(ctx, cx, cy, R * 2.6, glowC,
      mix(0.11, 0.13, m) * (1 + (0.10 * pulse + 0.14 * aud) * wL));
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(cx, cy); ctx.scale(breath, breath); ctx.translate(-cx, -cy);

    /* ---- listening: soft ripple rings from the rim, heartbeat pace ---- */
    if (wL > 0.01) {
      var L = 1.9;
      var rc = mixc(PAL.ripple.ob, PAL.ripple.jv, m);
      var offs = [0, 0.22];
      for (var oi = 0; oi < 2; oi++) {
        var tt = t - offs[oi];
        var g0 = Math.floor(tt / T);
        for (var g = g0; g >= g0 - 1; g--) {
          var age = tt - g * T;
          if (age < 0 || age >= L) continue;
          var p = age / L;
          var pr = 1 - Math.pow(1 - p, 2.2);
          var rr = R * (1.005 + 0.50 * pr);
          var a = 0.30 * Math.pow(1 - p, 1.7) * wL * (oi === 0 ? 1 : 0.55);
          ctx.beginPath();
          ctx.arc(cx, cy, rr, 0, TAU);
          ctx.strokeStyle = css(rc, a);
          ctx.lineWidth = 2.4 * (1 - p) + 0.4;
          ctx.stroke();
        }
      }
    }

    /* ---- orb interior ---- */
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();

    /* base: vertical sunrise gradient */
    var bg = ctx.createLinearGradient(cx, cy - R, cx, cy + R);
    bg.addColorStop(0.00, css(mixc(PAL.baseTop.ob, PAL.baseTop.jv, m), 1));
    bg.addColorStop(0.28, css(mixc(mixc(PAL.baseTop.ob, PAL.baseTop.jv, m),
                                   mixc(PAL.baseMid.ob, PAL.baseMid.jv, m), 0.55), 1));
    bg.addColorStop(0.55, css(mixc(PAL.baseMid.ob, PAL.baseMid.jv, m), 1));
    bg.addColorStop(1.00, css(mixc(PAL.baseBot.ob, PAL.baseBot.jv, m), 1));
    ctx.fillStyle = bg;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

    /* aurora blobs — screen blend, ultra-slow drift, thinking rotates + concentrates */
    ctx.globalCompositeOperation = 'screen';
    var orbitScale = 1 - 0.16 * wT;
    var cosT = Math.cos(theta), sinT = Math.sin(theta);
    var alphaMul = (1 + 0.38 * wT) * (1 + (0.10 * pulse + 0.12 * aud) * wL);
    for (var bi = 0; bi < PAL.blobs.length; bi++) {
      var b = PAL.blobs[bi];
      var ox = (b.px + b.ax * Math.sin(TAU * t * b.fx + b.p1)) * orbitScale;
      var oy = (b.py + b.ay * Math.sin(TAU * t * b.fy + b.p2)) * orbitScale;
      var rx = ox * cosT - oy * sinT;
      var ry = ox * sinT + oy * cosT;
      var bxp = cx + rx * R;
      var byp = cy + ry * R;
      var brr = R * b.br * (1 + 0.04 * Math.sin(TAU * t * 0.023 + b.p1 * 2));
      var col = mixc(b.ob, b.jv, m);
      ctx.fillStyle = aura(ctx, bxp, byp, brr, col, b.a * alphaMul);
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    }

    /* soft core glow — lit from within */
    var coreC = mixc(PAL.core.ob, PAL.core.jv, m);
    ctx.fillStyle = aura(ctx, cx, cy - R * 0.10, R * 0.85, coreC,
      mix(0.16, 0.20, m) * (1 + (0.15 * pulse + 0.18 * aud) * wL));
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.globalCompositeOperation = 'source-over';

    /* thinking: the interior deepens */
    if (wT > 0.005) {
      ctx.fillStyle = css(mixc(PAL.baseBot.ob, PAL.baseBot.jv, m), 0.13 * wT);
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    }

    /* spherical edge shading — offset up-left so the lower limb falls into shadow */
    var shadeC = mixc(PAL.shade.ob, PAL.shade.jv, m);
    var sx = cx - R * 0.10, sy = cy - R * 0.14;
    var sh = ctx.createRadialGradient(sx, sy, 0, sx, sy, R * 1.18);
    for (var si = 0; si <= 12; si++) {
      var sp = si / 12;
      var sa = (0.40 + 0.10 * wT) * Math.pow(smoothstep(0.50, 1.0, sp), 2);
      sh.addColorStop(sp, css(shadeC, sa));
    }
    ctx.fillStyle = sh;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

    /* top-light — barely-there highlight */
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = aura(ctx, cx - R * 0.30, cy - R * 0.42, R * 0.95,
      mixc([235, 235, 255], [255, 244, 220], m),
      mix(0.07, 0.10, m) * (1 + (0.25 * pulse + 0.20 * aud) * wL));
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.globalCompositeOperation = 'source-over';

    ctx.restore(); /* clip */

    /* ---- whisper of iridescent rim ---- */
    var rimAlphaMul = (1 + (0.35 * pulse + 0.30 * aud) * wL) * (1 - 0.15 * wT);
    var rimStyle;
    var hues = PAL.rim.ob.map(function (c, i) { return mixc(c, PAL.rim.jv[i], m); });
    if (ctx.createConicGradient) {
      rimStyle = ctx.createConicGradient(this.rimSpin, cx, cy);
      rimStyle.addColorStop(0.00, css(hues[0], 1));
      rimStyle.addColorStop(0.25, css(hues[1], 1));
      rimStyle.addColorStop(0.50, css(hues[2], 1));
      rimStyle.addColorStop(0.75, css(hues[3], 1));
      rimStyle.addColorStop(1.00, css(hues[0], 1));
    } else {
      rimStyle = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      rimStyle.addColorStop(0, css(hues[0], 1));
      rimStyle.addColorStop(1, css(hues[1], 1));
    }
    ctx.strokeStyle = rimStyle;
    /* soft halo stroke */
    ctx.globalAlpha = 0.10 * rimAlphaMul;
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(cx, cy, R + 1.5, 0, TAU); ctx.stroke();
    /* fine rim line */
    ctx.globalAlpha = 0.42 * rimAlphaMul;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(cx, cy, R - 0.3, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.restore(); /* breath */

    /* ---- imperceptible dither to keep gradients silky ----
       source-atop: dither lands only where the orb/glow already painted,
       so the transparent stage around it stays perfectly clear */
    if (this.noisePat) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = this.noisePat;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }

    /* ---- blit small buffer up onto the visible canvas (the softness trick) ---- */
    var out = this.ctx;
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.clearRect(0, 0, this.canvas.width, this.canvas.height);
    out.globalAlpha = this.dimCur;          /* dim to ~55% for error/offline */
    out.imageSmoothingEnabled = true;
    out.imageSmoothingQuality = 'high';
    out.drawImage(this.buf, 0, 0, this.buf.width, this.buf.height,
      0, 0, this.canvas.width, this.canvas.height);
    out.globalAlpha = 1;
  };

  window.OrbEngine.register('zen', {
    label: 'Zen',
    create: function (canvas) { return new ZenOrb(canvas); }
  });
})();
