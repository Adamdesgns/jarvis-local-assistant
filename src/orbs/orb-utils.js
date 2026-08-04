// Shared orb-skin helpers. Dual export like orb-engine.js: node:test requires
// it via module.exports; the browser loads it as a classic <script> and reads
// window.OrbUtils. Pure math only, except bindVisibility (browser-guarded) —
// everything else is node-testable.
//
// The surge/scan/flicker helpers are adapted from the MIT-licensed ULTRON orb
// by Sagar Tamang (https://github.com/SAGAR-TAMANG/ultron-by-sagar-builds).
(function () {
  // ---- deterministic randomness -------------------------------------------
  // LCG closure (the hologram.js recipe, previously copy-pasted per skin).
  function lcg(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- math / color --------------------------------------------------------
  function lerp(a, b, t) { return a + (b - a) * t; }

  function mix3(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  // rgba() string from 0-255 ints (classic/zen/neural/starfield convention).
  function css(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a.toFixed(4) + ')';
  }

  // rgba() string from 0-1 floats (plasma convention).
  function rgba01(c, a) {
    return 'rgba(' + ((c[0] * 255) | 0) + ',' + ((c[1] * 255) | 0) + ',' + ((c[2] * 255) | 0) + ',' + a.toFixed(3) + ')';
  }

  // Chroma-based HSL→RGB, 0-1 floats. Canonical version (aurora's). Neural
  // keeps its own q/p-based 0-255 variant — different scale and rounding;
  // swapping it would shift that skin's rendered colors.
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

  // Frame-rate-independent easing kernel every skin already uses inline.
  function smoothK(rate, dt) { return 1 - Math.exp(-rate * dt); }

  // ---- ULTRON-derived envelopes -------------------------------------------
  // Rare dramatic pulse: two pow-sharpened sine waves whose peaks rarely
  // coincide. Mostly ~0 with occasional surges toward 1.
  function surgeEnvelope(t, opts) {
    opts = opts || {};
    var f1 = opts.f1 !== undefined ? opts.f1 : 0.4;
    var f2 = opts.f2 !== undefined ? opts.f2 : 0.7;
    var p2 = opts.p2 !== undefined ? opts.p2 : 2;
    var strength = opts.strength !== undefined ? opts.strength : 1;
    var w1 = Math.pow(Math.max(0, Math.sin(t * f1)), 5) * 1.5;
    var w2 = Math.pow(Math.max(0, Math.sin(t * f2 + p2)), 8) * 2.0;
    var v = (w1 + w2) / 3.5 * strength;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  // Scan-ring sweep over a unit sphere: y position, ring scale at that
  // latitude, and an alpha that fades the ring out toward the poles.
  function scanSweep(t, speed, phase) {
    var y = Math.sin(t * (speed || 0.4) + (phase || 0));
    var scale = Math.sqrt(Math.max(0, 1 - y * y));
    return { y: y, scale: scale, alpha: scale };
  }

  // Subtle brightness flicker (±2%).
  function flicker(t) {
    return 1 + 0.02 * Math.sin(t * 30) * Math.sin(t * 7.3);
  }

  // Chromatic-aberration scale factor for a canvas whose smaller device-pixel
  // dimension is minDimPx: aims for a fringe of ~fringePx device pixels at the
  // edge, capped so large canvases stay subtle. The cutoff keeps the 64px
  // defense sentinel (128 device px at DPR 2) grade-only while the floating
  // widget keeps the full effect down to its 90px minimum (180 device px).
  function caScale(minDimPx, fringePx) {
    if (!(minDimPx >= 140)) return 0;
    var f = fringePx !== undefined ? fringePx : 3;
    return Math.min(0.02, (2 * f) / minDimPx);
  }

  // ---- browser-only --------------------------------------------------------
  // visibilitychange subscription; returns an unbind function. Safe to call
  // from node (no-op unbind).
  function bindVisibility(handler) {
    if (typeof document === 'undefined') return function () {};
    document.addEventListener('visibilitychange', handler);
    return function () { document.removeEventListener('visibilitychange', handler); };
  }

  var api = {
    lcg: lcg,
    mulberry32: mulberry32,
    lerp: lerp,
    mix3: mix3,
    css: css,
    rgba01: rgba01,
    hsl2rgb: hsl2rgb,
    smoothK: smoothK,
    surgeEnvelope: surgeEnvelope,
    scanSweep: scanSweep,
    flicker: flicker,
    caScale: caScale,
    bindVisibility: bindVisibility
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.OrbUtils = api;
})();
