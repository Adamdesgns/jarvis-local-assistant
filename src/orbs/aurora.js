// Aurora orb skin — formless plasma cloud (port of docs/jarvis-orb-g.html).
// Classic script: registers itself into window.OrbEngine. The prototype's
// 7px CSS blur is reproduced in-canvas: the plasma renders to an offscreen
// canvas at 0.75 scale, then composites onto the shared canvas through
// ctx.filter = 'blur(7px)' — no CSS touches the shared element.
// Background is fully transparent; the app stage shows through.
(function () {
  'use strict';

  if (typeof window === 'undefined' || !window.OrbEngine || typeof window.OrbEngine.register !== 'function') return;

  var SCALE = 0.75;   // offscreen render scale; upscaling adds softness (prototype-identical)
  var BLUR_PX = 7;    // prototype's CSS blur, applied at composite time

  // ---- seeded randomness (stable look every load, prototype seed) ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- color helpers -------------------------------------------------------
  function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2, r = 0, g = 0, b = 0;
    if (h < 60)       { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else              { r = c; b = x; }
    return [r + m, g + m, b + m];
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function mixRGB(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  }

  // ---- mood targets (prototype state machine, verbatim) --------------------
  var STATE_TARGETS = {
    idle:      { spread: 1.0,  bright: 1.0,  speed: 1.0,  turb: 1.0, swirl: 0.10, shimmer: 1.0 },
    listening: { spread: 0.8,  bright: 1.35, speed: 1.15, turb: 1.0, swirl: 0.22, shimmer: 2.3 },
    thinking:  { spread: 0.95, bright: 1.12, speed: 1.5,  turb: 2.2, swirl: 1.55, shimmer: 1.6 }
  };

  // hue offsets relative to the drifting base hue: a one-directional spectral
  // ramp, so the cloud always reads as 3-4 neighboring hues blending
  var HUE_OFF = [0, -24, -48, -72, -98, -124, 20, -150];

  function createAurora(canvas) {
    var ctx = canvas.getContext('2d');
    var off = document.createElement('canvas'); // never appended to the DOM
    var octx = off.getContext('2d');

    var reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var reduceMotion = !!(reduceQuery && reduceQuery.matches);

    var DPR = 1, W = 0, H = 0;
    var rafId = null;
    var lastTs = 0;
    var paused = false;
    var destroyed = false;
    var everDrawn = false;

    // ---- geometry: lobes + wisps (prototype-identical rnd sequence) --------
    var rnd = mulberry32(1337);

    var lobes = [];
    for (var i = 0; i < 8; i++) {
      lobes.push({
        // primary drift (slow, wide)
        ax: 0.26 + rnd() * 0.22, fx: 0.11 + rnd() * 0.10, px: rnd() * Math.PI * 2,
        ay: 0.22 + rnd() * 0.20, fy: 0.09 + rnd() * 0.11, py: rnd() * Math.PI * 2,
        // turbulent drift (faster, scaled by state)
        tax: 0.08 + rnd() * 0.10, tfx: 0.5 + rnd() * 0.5, tpx: rnd() * Math.PI * 2,
        tay: 0.08 + rnd() * 0.10, tfy: 0.5 + rnd() * 0.5, tpy: rnd() * Math.PI * 2,
        // size + breathing
        r0: 0.5 + rnd() * 0.38, rA: 0.06 + rnd() * 0.08, rF: 0.13 + rnd() * 0.1, rP: rnd() * Math.PI * 2,
        // eccentricity (never a circle)
        e0: 0.35 + rnd() * 0.3, eF: 0.07 + rnd() * 0.06, eP: rnd() * Math.PI * 2,
        rot0: rnd() * Math.PI * 2, rotV: (rnd() - 0.5) * 0.14,
        hueOff: HUE_OFF[i],
        sat: 0.82 + rnd() * 0.14,
        // far-offset accent lobes get extra light + alpha so the cool
        // end of the aurora ramp (cyan/teal/emerald) visibly glows
        lit: 0.54 + rnd() * 0.12 + (Math.abs(HUE_OFF[i]) > 90 ? 0.07 : 0),
        alpha: 0.2 + rnd() * 0.13 + (Math.abs(HUE_OFF[i]) > 90 ? 0.05 : 0),
        swirlDir: (i % 3 === 0) ? -1 : 1,
        warmPhase: rnd() * Math.PI * 2,
        whiteness: rnd() * 0.25
      });
    }

    // shimmer wisps — small fast sparkle blobs inside the cloud
    var wisps = [];
    for (var w = 0; w < 12; w++) {
      wisps.push({
        orbit: 0.1 + rnd() * 0.42,
        of: 0.35 + rnd() * 0.6,
        op: rnd() * Math.PI * 2,
        dir: (w % 2 === 0) ? 1 : -1,
        r: 0.08 + rnd() * 0.09,
        flickF: 1.5 + rnd() * 2.5,
        flickP: rnd() * Math.PI * 2,
        hueOff: (rnd() - 0.5) * 80
      });
    }

    // ---- interpolated parameters ------------------------------------------
    var cur = { spread: 1, bright: 1, speed: 1, turb: 1, swirl: 0.1, shimmer: 1 };
    var tgt = STATE_TARGETS.idle;
    var modeCur = 1, modeTgt = 1;   // 0 = obsidian, 1 = jarvis/gold (gold is the default palette)
    var dimCur = 0, dimTgt = 0;     // 1 = error/offline look (~55% intensity)
    var audioCur = 0, audioTgt = 0; // smoothed voice level

    // continuous phase accumulators (no snapping when rates change)
    var mt = 20.0;   // primary motion time
    var tt = 8.0;    // turbulent motion time
    var sa = 0.6;    // swirl angle
    var st = 5.0;    // shimmer time
    var ht = 0.0;    // hue time
    var HUE_START = 305;   // begins in magenta/violet territory
    var HUE_RATE = 7.5;    // deg per second -> full spectrum ~48s

    // ---- sizing ------------------------------------------------------------
    function resize() {
      if (destroyed) return;
      var rect = canvas.getBoundingClientRect();
      DPR = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, rect.width);
      H = Math.max(1, rect.height);
      canvas.width = Math.max(2, Math.round(W * DPR));
      canvas.height = Math.max(2, Math.round(H * DPR));
      off.width = Math.max(2, Math.floor(W * DPR * SCALE));
      off.height = Math.max(2, Math.floor(H * DPR * SCALE));
      if (reduceMotion || paused) renderStatic();
    }

    var resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      resizeObserver = new ResizeObserver(function () { resize(); });
      resizeObserver.observe(canvas.parentElement);
    }

    // ---- one lobe draw (into the offscreen) --------------------------------
    // gaussian-ish falloff: buttery, no rim, no edge
    function drawBlob(x, y, r, rot, ex, ey, rgb, alpha) {
      if (alpha <= 0.002 || r <= 1) return;
      octx.save();
      octx.translate(x, y);
      octx.rotate(rot);
      octx.scale(ex, ey);
      var g = octx.createRadialGradient(0, 0, 0, 0, 0, r);
      var R = Math.round(rgb[0] * 255), G = Math.round(rgb[1] * 255), B = Math.round(rgb[2] * 255);
      g.addColorStop(0.0,  'rgba(' + R + ',' + G + ',' + B + ',' + (alpha).toFixed(4) + ')');
      g.addColorStop(0.18, 'rgba(' + R + ',' + G + ',' + B + ',' + (alpha * 0.86).toFixed(4) + ')');
      g.addColorStop(0.35, 'rgba(' + R + ',' + G + ',' + B + ',' + (alpha * 0.6).toFixed(4) + ')');
      g.addColorStop(0.52, 'rgba(' + R + ',' + G + ',' + B + ',' + (alpha * 0.33).toFixed(4) + ')');
      g.addColorStop(0.68, 'rgba(' + R + ',' + G + ',' + B + ',' + (alpha * 0.15).toFixed(4) + ')');
      g.addColorStop(0.84, 'rgba(' + R + ',' + G + ',' + B + ',' + (alpha * 0.05).toFixed(4) + ')');
      g.addColorStop(1.0,  'rgba(' + R + ',' + G + ',' + B + ',0)');
      octx.fillStyle = g;
      octx.fillRect(-r, -r, r * 2, r * 2);
      octx.restore();
    }

    // per-lobe color, blended between the two palettes
    function lobeColor(lb, extraLight) {
      // Obsidian: free-spectrum aurora drift
      var baseHue = HUE_START + ht * HUE_RATE;
      var hObs = baseHue + lb.hueOff + Math.sin(mt * 0.07 + lb.px) * 8;
      var obs = hsl2rgb(hObs, lb.sat, Math.min(0.75, lb.lit + extraLight));

      if (modeCur < 0.004) return obs;

      // JARVIS/gold: warm family — deep amber -> gold -> copper -> soft white-gold
      var hw = 28 + 16 * (0.5 + 0.5 * Math.sin(ht * 0.22 + lb.warmPhase)); // 28..44
      var wg = lb.whiteness + extraLight * 0.9;                            // white-gold lift
      var jar = hsl2rgb(hw + wg * 8, 1.0 - wg * 0.45, Math.min(0.82, 0.54 + lb.lit * 0.18 + wg * 0.3 + extraLight));

      return mixRGB(obs, jar, modeCur);
    }

    // ---- frame -------------------------------------------------------------
    function drawFrame() {
      if (destroyed) return;
      everDrawn = true;

      // 1) plasma into the offscreen (transparent — no background fill)
      octx.setTransform(DPR * SCALE, 0, 0, DPR * SCALE, 0, 0);
      octx.globalCompositeOperation = 'source-over';
      octx.clearRect(0, 0, W, H);
      octx.globalCompositeOperation = 'lighter';

      var cx = W / 2, cy = H / 2;
      var u = Math.min(W, H) * 0.24;            // cloud unit -> plasma ~45-55% of the stage
      var spread = cur.spread, turb = cur.turb;
      // dim (error/offline) pulls intensity to ~55%; voice level adds a subtle lift
      var bright = cur.bright * (1 - 0.45 * dimCur) * (1 + audioCur * 0.25);
      var turbAmp = 0.45 + 0.55 * turb;

      var sumX = 0, sumY = 0;

      // main lobes
      for (var i = 0; i < lobes.length; i++) {
        var lb = lobes[i];
        var ox = lb.ax * Math.sin(mt * lb.fx + lb.px) + lb.tax * turbAmp * Math.sin(tt * lb.tfx + lb.tpx);
        var oy = lb.ay * Math.sin(mt * lb.fy + lb.py) + lb.tay * turbAmp * Math.sin(tt * lb.tfy + lb.tpy);
        // swirl: rotate the offset vector around the center
        var ang = sa * lb.swirlDir * (0.55 + 0.45 * (i / lobes.length));
        var ca = Math.cos(ang), sn = Math.sin(ang);
        var rx = (ox * ca - oy * sn) * spread * u;
        var ry = (ox * sn + oy * ca) * spread * u;

        var x = cx + rx, y = cy + ry;
        sumX += x; sumY += y;

        var r = u * (lb.r0 + lb.rA * Math.sin(mt * lb.rF + lb.rP)) * (0.86 + 0.14 * spread);
        var e = lb.e0 * (1 + 0.35 * Math.sin(mt * lb.eF + lb.eP));
        var ex = 1 + e, ey = 1 / (1 + e * 0.75);
        var rot = lb.rot0 + mt * lb.rotV + sa * 0.3 * lb.swirlDir;

        var col = lobeColor(lb, 0);
        var a = lb.alpha * bright * (0.92 + 0.08 * Math.sin(st * 0.9 + lb.py * 3));
        drawBlob(x, y, r, rot, ex, ey, col, a);
      }

      // inner core — the "glows from within" heart, follows the cloud's centroid
      var coreX = lerp(cx, sumX / lobes.length, 0.6);
      var coreY = lerp(cy, sumY / lobes.length, 0.6);
      var coreLobe = lobes[0];
      var coreCol = lobeColor(coreLobe, 0.24);
      // desaturate the core toward white for luminosity
      var wht = [1, 1, 1];
      coreCol = mixRGB(coreCol, wht, 0.26 + modeCur * 0.08);
      var coreR = u * (0.55 + 0.05 * Math.sin(mt * 0.3));
      var coreE = 1 + 0.3 * Math.sin(mt * 0.11 + 1.3);
      drawBlob(coreX, coreY, coreR, mt * 0.05, coreE, 1 / (1 + (coreE - 1) * 0.6),
               coreCol, 0.26 * bright);

      // ambient halo — huge, faint, elongated; bleeds into the darkness
      var haloCol = lobeColor(lobes[3], 0.05);
      drawBlob(cx, cy + u * 0.05, u * 1.75, 0.4 + Math.sin(mt * 0.04) * 0.3,
               1.35, 0.8, haloCol, 0.07 * bright);

      // shimmer wisps
      for (var k = 0; k < wisps.length; k++) {
        var wp = wisps[k];
        var oa = st * wp.of * wp.dir + wp.op;
        var wr2 = wp.orbit * spread * u * (1 + 0.15 * Math.sin(tt * 0.7 + wp.op));
        var wx = coreX + Math.cos(oa) * wr2 * 1.25;
        var wy = coreY + Math.sin(oa) * wr2 * 0.85;
        var flick = 0.5 + 0.5 * Math.sin(st * wp.flickF + wp.flickP);
        var wCol = lobeColor({
          hueOff: wp.hueOff, sat: 0.55, lit: 0.68, px: wp.op,
          warmPhase: wp.op, whiteness: 0.45
        }, 0.1);
        drawBlob(wx, wy, u * wp.r * 1.6, oa, 1.3, 0.85, wCol,
                 0.08 * bright * flick * (0.6 + 0.4 * cur.shimmer / 2.3));
      }

      // 2) composite onto the shared canvas through the blur
      // (ctx.filter blur is applied in user space, so with the DPR transform
      // active this is exactly the prototype's 7 CSS-pixel blur)
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, W, H);
      ctx.filter = 'blur(' + BLUR_PX + 'px)';
      ctx.drawImage(off, 0, 0, W, H);
      ctx.filter = 'none';
    }

    // ---- animation loop ----------------------------------------------------
    function tick(ts) {
      if (destroyed || paused) { rafId = null; return; }
      rafId = requestAnimationFrame(tick);
      if (!lastTs) { lastTs = ts; return; }
      var dt = Math.min((ts - lastTs) / 1000, 0.05);
      lastTs = ts;

      // ease state params + palette blend + dim (never snap)
      var kState = 1 - Math.exp(-3.0 * dt);
      for (var key in cur) cur[key] += (tgt[key] - cur[key]) * kState;
      modeCur += (modeTgt - modeCur) * (1 - Math.exp(-2.8 * dt));
      dimCur += (dimTgt - dimCur) * kState;
      audioCur += (audioTgt - audioCur) * 0.16;

      // advance continuous accumulators (audio adds a touch of shimmer energy)
      mt += dt * cur.speed * 0.55;
      tt += dt * cur.speed * cur.turb * 0.8;
      sa += dt * cur.swirl * 0.55;
      st += dt * cur.shimmer * (1 + audioCur * 0.5);
      ht += dt;

      drawFrame();
    }

    function startLoop() {
      if (rafId === null && !reduceMotion && !paused && !destroyed) {
        lastTs = 0;
        rafId = requestAnimationFrame(tick);
      }
    }
    function stopLoop() {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    }

    // snap everything to its target and paint one gentle frame
    function renderStatic() {
      for (var key in cur) cur[key] = tgt[key];
      modeCur = modeTgt;
      dimCur = dimTgt;
      audioCur = audioTgt;
      drawFrame();
    }

    function onMotionPrefChange() {
      reduceMotion = !!(reduceQuery && reduceQuery.matches);
      if (reduceMotion) { stopLoop(); renderStatic(); }
      else startLoop();
    }
    if (reduceQuery) {
      if (typeof reduceQuery.addEventListener === 'function') reduceQuery.addEventListener('change', onMotionPrefChange);
      else if (typeof reduceQuery.addListener === 'function') reduceQuery.addListener(onMotionPrefChange);
    }

    // ---- instance interface ------------------------------------------------
    var instance = {
      setState: function (appState) {
        var m = window.OrbEngine.mapStateToMood(appState);
        tgt = STATE_TARGETS[m.mood] || STATE_TARGETS.idle;
        dimTgt = m.dim ? 1 : 0;
        if (!everDrawn) { // before the first frame, arrive already in-state
          for (var key in cur) cur[key] = tgt[key];
          dimCur = dimTgt;
        }
        if (reduceMotion) renderStatic();
      },
      setAudioLevel: function (level) {
        audioTgt = Math.max(0, Math.min(1, Number(level) || 0));
      },
      setPalette: function (name) {
        var p = window.OrbEngine.normalizePalette(name);
        modeTgt = (p === 'gold') ? 1 : 0;
        if (!everDrawn) modeCur = modeTgt;
        if (reduceMotion) renderStatic();
      },
      setPaused: function (value) {
        var next = Boolean(value);
        if (next === paused) return;
        paused = next;
        if (paused) stopLoop();
        else startLoop();
      },
      resize: resize,
      destroy: function () {
        destroyed = true;
        stopLoop();
        if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
        if (reduceQuery) {
          if (typeof reduceQuery.removeEventListener === 'function') reduceQuery.removeEventListener('change', onMotionPrefChange);
          else if (typeof reduceQuery.removeListener === 'function') reduceQuery.removeListener(onMotionPrefChange);
        }
        reduceQuery = null;
        octx = null;
        off = null;
        ctx = null;
        canvas = null;
      }
    };

    resize();
    if (reduceMotion) renderStatic();
    else startLoop();

    return instance;
  }

  window.OrbEngine.register('aurora', {
    label: 'Aurora',
    create: createAurora
  });
})();
