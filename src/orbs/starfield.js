// Orb skin: "starfield" — soul #8. A pure particle point-cloud sphere in the
// spirit of the Zoey OS orb: hundreds of small drifting dots forming a sphere.
// No rings, no core glow, no filaments — the spherical form comes entirely
// from the fibonacci-sphere dot distribution, depth-graded dot size/brightness
// and the natural limb densification of the projection. Quietly majestic:
// dots twinkle subtly and the sphere slowly rotates.
//   gold     → dots warmed into the JARVIS amber family (#ffb21f tints)
//   obsidian → silvery-white dots with a cool iridescent violet/cyan drift
// Classic script (no ES modules); registers itself on window.OrbEngine.
// Background is fully transparent — the app stage shows through.
(function () {
  'use strict';

  // ------------------------------------------------------------ palettes
  // Per-dot color = base silver/amber blended toward a per-dot iridescent
  // tint (u picks the spot on the tintA→tintB ramp), then whitened toward
  // `white` by depth so near dots read hotter.
  var OBS = {
    base:  [204, 216, 232],
    white: [240, 247, 255],
    tintA: [172, 150, 255],   // soft violet
    tintB: [138, 224, 255],   // soft cyan
    irid:  0.46
  };
  var JAR = {
    base:  [255, 196, 96],    // amber body around #ffb21f
    white: [255, 245, 224],
    tintA: [255, 178, 31],    // #ffb21f
    tintB: [255, 220, 150],   // pale gold
    irid:  0.55
  };

  // ------------------------------------------------------------ motion states
  // idle      = slow majestic drift
  // listening = dots brighten and the shell tightens slightly
  // thinking  = faster swirl with mild per-dot turbulence
  var STATES = {
    idle:      { spin: 1.00, glow: 1.00, tighten: 1.000, turb: 0.00 },
    listening: { spin: 1.15, glow: 1.55, tighten: 0.930, turb: 0.00 },
    thinking:  { spin: 3.40, glow: 1.18, tighten: 0.985, turb: 1.00 }
  };
  var MOOD_TO_STATE = { idle: 'idle', listening: 'listening', thinking: 'thinking' };

  var PERSP_K = 6.0; // perspective distance in units of R

  var mix3 = window.OrbUtils.mix3;
  var css = window.OrbUtils.css;

  function createStarfield(canvas) {
    var ctx = canvas.getContext('2d');
    var fx = window.OrbFX ? window.OrbFX.create(canvas) : null;

    var REDUCED = false;
    try { REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

    var W = 0, H = 0, DPR = 1, CX = 0, CY = 0, R = 100;

    // Deterministic seeded randomness — every boot produces the identical
    // constellation.
    var srand = window.OrbUtils.lcg(4107);

    // ---------------------------------------------------------- geometry
    // Fibonacci-sphere shell (hologram.js particle math ancestry) stored in
    // spherical coords so each dot can drift slowly along its own latitude.
    // A minority of interior dots gives the cloud gentle volume.
    var DOTS = [];
    (function () {
      var N = 620, GA = 2.39996322972865332;
      for (var i = 0; i < N; i++) {
        var y = 1 - 2 * (i + 0.5) / N;
        var inner = srand() < 0.13;
        DOTS.push({
          phi: Math.acos(Math.max(-1, Math.min(1, y))),
          th: i * GA + (srand() - 0.5) * 0.05,
          drift: (srand() - 0.5) * 0.016,             // rad/s along own latitude
          shell: inner ? (0.34 + srand() * 0.55)
                       : (0.962 + srand() * 0.038),
          inner: inner,
          bright: !inner && srand() > 0.91,
          u: srand(),                                  // iridescent ramp position
          tws: 0.55 + srand() * 1.35,                  // twinkle speed
          ph: srand() * Math.PI * 2,                   // twinkle phase
          ph2: srand() * Math.PI * 2,                  // turbulence phases
          ph3: srand() * Math.PI * 2,
          cO: null, cJ: null                           // per-dot palette bases
        });
      }
      var tintO, tintJ, d;
      for (i = 0; i < DOTS.length; i++) {
        d = DOTS[i];
        tintO = mix3(OBS.tintA, OBS.tintB, d.u);
        tintJ = mix3(JAR.tintA, JAR.tintB, d.u);
        d.cO = mix3(OBS.base, tintO, OBS.irid);
        d.cJ = mix3(JAR.base, tintJ, JAR.irid);
      }
    })();

    // ---------------------------------------------------------- live state
    var mode = 'gold';        // palette: 'gold' (default) | 'obsidian'
    var stateName = 'idle';   // motion mood
    var dimTarget = 1;        // 0.55 when dimmed (error/offline)
    var cur = { mix: 1, dim: 1 };  // mix: 0 = obsidian, 1 = gold
    var kk;
    for (kk in STATES.idle) cur[kk] = STATES.idle[kk];

    var targetAudio = 0, audio = 0;

    function targets() {
      var t = { mix: (mode === 'gold') ? 1 : 0, dim: dimTarget };
      var s = STATES[stateName];
      for (var k in s) t[k] = s[k];
      return t;
    }

    var yaw = 0.7;         // sphere rotation
    var T = 8.0;           // animation clock (non-zero for a pretty first frame)
    var master = REDUCED ? 1 : 0;  // global fade-in gain
    var born = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // ---------------------------------------------------------- sizing
    function doResize() {
      var rect = canvas.getBoundingClientRect();
      W = Math.max(2, rect.width);
      H = Math.max(2, rect.height);
      DPR = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(2, Math.round(W * DPR));
      canvas.height = Math.max(2, Math.round(H * DPR));
      ctx.imageSmoothingEnabled = true;
      try { ctx.imageSmoothingQuality = 'high'; } catch (e) {}
      CX = W / 2; CY = H / 2;
      // No rings to clear — the point cloud can own most of the stage.
      R = Math.min(W, H) * 0.335;
    }

    // ---------------------------------------------------------- update
    function update(dt) {
      var t = targets();
      var e = 1 - Math.exp(-dt * 3.4);
      for (var k in t) cur[k] += (t[k] - cur[k]) * e;

      // Audio smoothing (hologram.js setAudioLevel pattern, dt-normalized).
      audio += (targetAudio - audio) * (1 - Math.exp(-dt * 9));

      if (!REDUCED) {
        var age = ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - born) / 1000;
        master = Math.min(1, age / 0.9);
        master = 1 - Math.pow(1 - master, 3); // easeOutCubic
      }

      var dtA = REDUCED ? 0 : dt;
      T += dtA;
      yaw += dtA * 0.10 * cur.spin;
      for (var i = 0; i < DOTS.length; i++) DOTS[i].th += dtA * DOTS[i].drift;
    }

    // ---------------------------------------------------------- render (transparent bg)
    function render() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.globalCompositeOperation = 'lighter';

      var persp = PERSP_K * R;
      var gain = master * cur.dim;
      // Rare dramatic surge — livelier while thinking (spin rises 1 -> 3.4);
      // zero under reduced motion so the frozen clock can't bake one in.
      var sg = REDUCED ? 0 : window.OrbUtils.surgeEnvelope(T, { strength: 1 + 0.2 * cur.spin / 3.4 });
      // Subtle audio-reactive brightness (speaking/listening).
      var glow = cur.glow * (1 + audio * 0.28) * (1 + 0.6 * sg);
      // Barely-there breathing keeps the sphere alive even when nothing changes.
      var breath = 1 + 0.008 * Math.sin(T * 0.5);
      var rEff = R * cur.tighten * breath;
      var wob = cur.turb * 0.032;

      // slow axis nod + roll — the rotation axis itself gently precesses
      var tiltX = 0.42 + 0.05 * Math.sin(T * 0.06);
      var tiltZ = 0.10 * Math.sin(T * 0.045);
      var cy_ = Math.cos(yaw), sy_ = Math.sin(yaw);
      var cx_ = Math.cos(tiltX), sx_ = Math.sin(tiltX);
      var cz_ = Math.cos(tiltZ), sz_ = Math.sin(tiltZ);

      var mixT = cur.mix;
      var mono = (mixT < 0.002) ? 0 : (mixT > 0.998) ? 1 : -1;

      for (var i = 0; i < DOTS.length; i++) {
        var p = DOTS[i];
        var sp = Math.sin(p.phi);
        var x = sp * Math.cos(p.th) * p.shell;
        var y = Math.cos(p.phi) * p.shell;
        var z = sp * Math.sin(p.th) * p.shell;
        // mild turbulence while thinking
        if (wob > 0.0015) {
          x += Math.sin(T * 1.9 + p.ph2) * wob;
          y += Math.sin(T * 1.6 + p.ph3) * wob;
          z += Math.sin(T * 2.3 + p.ph) * wob;
        }
        // yaw (about Y)
        var x1 = x * cy_ + z * sy_;
        var z1 = -x * sy_ + z * cy_;
        // pitch (about X)
        var y2 = y * cx_ - z1 * sx_;
        var z2 = y * sx_ + z1 * cx_;
        // roll (about Z)
        var x3 = x1 * cz_ - y2 * sz_;
        var y3 = x1 * sz_ + y2 * cz_;

        var s = persp / (persp - z2 * rEff);
        var px = CX + x3 * rEff * s;
        var py = CY + y3 * rEff * s;
        var depth = (z2 + 1) * 0.5;              // 0 = far, 1 = near

        var tw = p.bright
          ? 0.68 + 0.32 * Math.sin(T * p.tws + p.ph)
          : 0.78 + 0.22 * Math.sin(T * p.tws + p.ph);
        var a = (0.032 + 0.78 * Math.pow(depth, 1.9)) * tw * glow * gain;
        if (p.inner) a *= 0.42;
        if (p.bright) a *= 1.35;
        if (a > 0.92) a = 0.92;
        if (a < 0.012) continue;

        var rad = (0.45 + 1.3 * depth) * s;
        if (p.inner) rad *= 0.75;
        if (p.bright) rad *= 1.5;

        var whit = depth * 0.45;
        var col;
        if (mono === 0)      col = mix3(p.cO, OBS.white, whit);
        else if (mono === 1) col = mix3(p.cJ, JAR.white, whit);
        else col = mix3(mix3(p.cO, OBS.white, whit), mix3(p.cJ, JAR.white, whit), mixT);

        // soft halo on the standouts — additive blend does the rest
        if (p.bright && a > 0.08) {
          var hr = rad * 3.4;
          var g = ctx.createRadialGradient(px, py, 0, px, py, hr);
          g.addColorStop(0, css(col, a * 0.32));
          g.addColorStop(1, css(col, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(px, py, hr, 0, 6.2832);
          ctx.fill();
        } else if (a > 0.14) {
          // faint aura on bright-enough foreground dots for a velvet finish
          ctx.fillStyle = css(col, a * 0.10);
          ctx.beginPath();
          ctx.arc(px, py, rad * 2.4, 0, 6.2832);
          ctx.fill();
        }

        ctx.fillStyle = css(col, a);
        ctx.beginPath();
        ctx.arc(px, py, rad, 0, 6.2832);
        ctx.fill();
      }

      // Sweeping scan ring: a squashed ellipse riding the sphere's latitude,
      // fading toward the poles (ULTRON scan-ring math via OrbUtils).
      if (!REDUCED) {
        var sw = window.OrbUtils.scanSweep(T, 0.4);
        var swR = sw.scale * rEff;
        if (swR > 2) {
          ctx.strokeStyle = css(mix3(OBS.white, JAR.white, cur.mix), 0.10 * sw.alpha * glow * gain);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(CX, CY + sw.y * rEff * 0.42, swR, swR * 0.24, 0, 0, 6.2832);
          ctx.stroke();
        }
      }

      ctx.globalCompositeOperation = 'source-over';

      if (fx) fx.apply(ctx, { t: T, palette: mode, intensity: master * cur.dim, reduced: REDUCED });
    }

    // ---------------------------------------------------------- loop control
    var running = false, rafId = 0, last = 0, paused = false, destroyed = false;
    function frame(now) {
      if (!running) return;
      var dt = Math.min(0.05, Math.max(0.0005, (now - last) / 1000));
      last = now;
      update(dt);
      render();
      rafId = requestAnimationFrame(frame);
    }
    function start() {
      if (running || paused || destroyed || REDUCED) return;
      running = true;
      last = performance.now();
      rafId = requestAnimationFrame(frame);
    }
    function stop() {
      running = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    }
    function forceFrame() { update(0.0001); render(); }

    // Reduced motion: snap to targets and paint one gentle static frame.
    function renderStatic() {
      var t = targets();
      for (var k in t) cur[k] = t[k];
      master = 1;
      render();
    }

    // ---------------------------------------------------------- observers
    var resizeObserver = null;
    try {
      resizeObserver = new ResizeObserver(function () {
        if (destroyed) return;
        doResize();
        if (REDUCED) renderStatic(); else forceFrame();
      });
      resizeObserver.observe(canvas.parentElement || canvas);
    } catch (e) { /* ResizeObserver unavailable — resize() still works */ }

    // ---------------------------------------------------------- boot
    doResize();
    if (REDUCED) {
      renderStatic();
    } else {
      forceFrame();   // always paint at least one frame before the loop ticks
      start();
    }

    // Stop burning CPU while the window is hidden; start() re-checks
    // paused/destroyed/REDUCED so this can't resurrect a stopped skin.
    var unbindVis = window.OrbUtils ? window.OrbUtils.bindVisibility(function () {
      if (destroyed) return;
      if (document.hidden) stop(); else start();
    }) : null;

    // ---------------------------------------------------------- instance
    return {
      setState: function (appState) {
        var m = window.OrbEngine.mapStateToMood(appState);
        stateName = MOOD_TO_STATE[m.mood] || 'idle';
        dimTarget = m.dim ? 0.55 : 1;
        if (REDUCED) renderStatic();
      },
      setAudioLevel: function (level) {
        targetAudio = Math.max(0, Math.min(1, Number(level) || 0));
      },
      setPalette: function (name) {
        var p = window.OrbEngine.normalizePalette(name);
        mode = (p === 'obsidian') ? 'obsidian' : 'gold';
        if (REDUCED) renderStatic();
      },
      setPaused: function (isPaused) {
        paused = Boolean(isPaused);
        if (paused) stop();
        else if (REDUCED) renderStatic();
        else start();
      },
      resize: function () {
        doResize();
        if (REDUCED) renderStatic(); else forceFrame();
      },
      destroy: function () {
        destroyed = true;
        stop();
        if (unbindVis) { unbindVis(); unbindVis = null; }
        if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
        if (fx) { fx.destroy(); fx = null; }
        ctx = null;
        canvas = null;
      }
    };
  }

  if (typeof window !== 'undefined' && window.OrbEngine) {
    window.OrbEngine.register('starfield', {
      label: 'Starfield',
      create: function (canvas) { return createStarfield(canvas); }
    });
  }
})();
