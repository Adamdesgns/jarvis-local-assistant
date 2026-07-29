// Pure polar-coordinate shape math for the JR games orb morph. Every function
// here is (theta, t) -> r: theta is the angle around the orb (radians), t is
// elapsed time (ms or ticks — only `orb` uses it), r is the radius multiplier
// at that angle. No DOM, no canvas, no state — just numbers, so node:test can
// pin the formulas AND the renderer can script-tag this file directly. Dual
// export like orb-engine.js:52-53.
(function () {
  const TAU = Math.PI * 2;

  // Wrap an angle difference into [-π, π] so "distance around the circle"
  // is always the short way, whichever direction that is.
  function angleDiff(a, b) {
    let d = (a - b) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }

  // Resting shape: the classic idle-orb wobble. Two slow sine ripples drift
  // in opposite directions over time so the surface never looks static.
  function orb(theta, t) {
    return 1
      + Math.sin(3 * theta + t * 0.035) * 0.035 // 3-lobe ripple, drifts forward
      + Math.sin(5 * theta - t * 0.022) * 0.022; // 5-lobe ripple, drifts backward
  }

  // Rock: low-frequency lumps, frozen in time (a fist doesn't wiggle).
  function rock(theta) {
    const BASE = 0.9;      // rock sits smaller than the resting orb (radius 1)
    const LUMP_2 = 0.08;   // big single bulge (2 lobes) — the knuckle mass
    const LUMP_5 = 0.05;   // mid bumps (5 lobes) — knuckle ridges
    const LUMP_9 = 0.02;   // fine texture (9 lobes) — surface roughness
    return BASE
      + Math.sin(2 * theta + 0.7) * LUMP_2
      + Math.sin(5 * theta + 2.1) * LUMP_5
      + Math.sin(9 * theta) * LUMP_9;
  }

  // Paper: a superellipse (squareness n=4) — reads as a rounded square sheet.
  function paper(theta) {
    const N = 4;          // superellipse exponent — higher = squarer corners
    const SCALE = 0.82;   // shrink so the "square" fits inside the orb's normal footprint
    const c = Math.abs(Math.cos(theta));
    const s = Math.abs(Math.sin(theta));
    return Math.pow(Math.pow(c, N) + Math.pow(s, N), -1 / N) * SCALE;
  }

  // One blade lobe: a raised-cosine bump centered on `at`, zero outside
  // [-width, width] of it. Width note: the brief's literal formula
  // (width 0.30) was measured to yield ~20 local maxima instead of 2 — with
  // no clamp, max(0, cos(d·(π/2)/width))² keeps re-entering its positive
  // half-cycle every 4·width radians of angular distance, so a narrow width
  // packs several extra lobes into the reachable domain (verified: peaks
  // stayed >= 10 for exponents 2 through 64, since a lobe's own peak value is
  // always cos(0)=1 regardless of exponent — only WIDTH controls how many
  // lobes fit). Widening to 0.95 keeps exactly one lobe (the intended blade)
  // per spike within range before the next would start, confirmed by
  // sweeping widths 0.30–2.00 at multiple sample resolutions (720–5000):
  // peak count is 2 starting at width ≈0.87, so 0.95 keeps a safety margin
  // while the two blades (2.10 rad apart) still stay well clear of merging.
  function spike(theta, at, width) {
    const d = angleDiff(theta, at);
    if (Math.abs(d) >= width) return 0; // outside the blade's cone — no contribution
    const c = Math.cos((d * (Math.PI / 2)) / width);
    return c * c; // exponent 2, per the brief — squaring sharpens the blade's ridge
  }

  // Scissors: a small core with two blade spikes at 10 and 2 o'clock.
  function scissors(theta) {
    const CORE = 0.45;         // core radius — small enough that the blades read
    const BLADE_AT_10 = 2.62;  // ~10 o'clock, radians
    const BLADE_AT_2 = 0.52;   // ~2 o'clock, radians
    const BLADE_WIDTH = 0.95;  // half-angle of each blade cone (see spike() note above)
    const BLADE_HEIGHT = 0.65; // how far a blade rises above the core at its peak
    return CORE
      + spike(theta, BLADE_AT_10, BLADE_WIDTH) * BLADE_HEIGHT
      + spike(theta, BLADE_AT_2, BLADE_WIDTH) * BLADE_HEIGHT;
  }

  const SHAPES = { orb, rock, paper, scissors };

  // Smoothstep-style ease (quadratic in/out) — slow start, slow finish, so
  // the morph doesn't feel linear/robotic.
  function ease(p) {
    return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  }

  // Blend two named shapes at a given progress [0,1]. Endpoints are exact
  // (f=0 -> "from" shape, f=1 -> "to" shape) so callers can trust the morph
  // snaps cleanly into rock/paper/scissors at reveal time.
  function morphRadius(from, to, progress, theta, t) {
    const f = ease(progress);
    return SHAPES[from](theta, t) * (1 - f) + SHAPES[to](theta, t) * f;
  }

  // Per-shape tint overlay for the reveal. null = "keep the soul's own
  // palette" (the resting orb doesn't get re-skinned).
  const SHAPE_TINTS = {
    rock: '#8a8f98',    // slate grey — stone
    paper: '#e8e6df',   // warm off-white — paper sheet
    scissors: '#c0c8d8', // cool steel-blue — blade metal
    orb: null
  };

  const api = { SHAPES, morphRadius, SHAPE_TINTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.OrbShapes = api;
})();
