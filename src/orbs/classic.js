// Orb skin: "classic" — faithful port of docs/jarvis-orb-d.html ("Classic
// Evolved"). Holographic sphere: glass limb, luminous pulsing core, particle
// shell (fibonacci sphere), three precessing orbit rings with comet arcs and
// head glows, ambient motes + haze. Scene is drawn additively onto an
// offscreen canvas, then composited with two downscaled bloom passes
// (same offscreen-bloom approach as the neural skin). Background is fully
// transparent — the app stage shows through.
// Classic script (no ES modules); registers itself on window.OrbEngine.
(function () {
  'use strict';

  // ------------------------------------------------------------ palettes
  // Verbatim from the prototype. 'obsidian' = OBS, 'gold' = JAR (JARVIS amber).
  var OBS = {
    coreWhite: [236, 247, 255],
    coreHot:   [150, 222, 255],
    primary:   [90, 206, 255],
    secondary: [170, 120, 255],
    rim:       [148, 206, 255],
    haze:      [70, 100, 212],
    deep:      [38, 58, 158]
  };
  var JAR = {
    coreWhite: [255, 249, 232],
    coreHot:   [255, 216, 132],
    primary:   [255, 178, 31],
    secondary: [255, 122, 46],
    rim:       [255, 196, 100],
    haze:      [240, 140, 34],
    deep:      [150, 68, 12]
  };

  // ------------------------------------------------------------ motion states
  // Verbatim prototype state machine; moods map 1:1 onto these.
  var STATES = {
    idle:      { tighten: 1.00, ringGlow: 1.00, precess: 1.00, headSpd: 1.00, pulseAmp: 0.050, pulseHz: 0.34, coreGain: 1.00, partSpd: 1.00, partGlow: 1.00, haze: 1.00 },
    listening: { tighten: 0.40, ringGlow: 1.70, precess: 1.30, headSpd: 1.70, pulseAmp: 0.100, pulseHz: 0.90, coreGain: 1.32, partSpd: 1.55, partGlow: 1.50, haze: 1.25 },
    thinking:  { tighten: 0.92, ringGlow: 1.22, precess: 3.80, headSpd: 2.60, pulseAmp: 0.210, pulseHz: 1.45, coreGain: 1.10, partSpd: 2.10, partGlow: 1.12, haze: 1.10 }
  };
  var MOOD_TO_STATE = { idle: 'idle', listening: 'listening', thinking: 'thinking' };

  var PERSP_K = 6.0; // perspective distance in units of R

  function mix3(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function css(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a.toFixed(4) + ')';
  }

  function createClassic(canvas) {
    var ctx = canvas.getContext('2d');
    // Offscreen canvases only — created, never appended to the DOM.
    var scene = document.createElement('canvas');
    var sctx = scene.getContext('2d');
    var blurA = document.createElement('canvas');
    var actx = blurA.getContext('2d');
    var blurB = document.createElement('canvas');
    var bctx = blurB.getContext('2d');

    var REDUCED = false;
    try { REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    var HAS_FILTER = (typeof ctx.filter === 'string');

    var W = 0, H = 0, DPR = 1, CX = 0, CY = 0, R = 100;

    // Deterministic seeded randomness (hologram.js LCG pattern) — replaces
    // the prototype's Math.random() so every boot looks identical.
    var seed = 4107;
    function srand() {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    }

    // ---------------------------------------------------------- geometry
    // Per-instance ring copies (p / headT mutate over time).
    var RINGS = [
      { k: 1.30, tx: 1.24, tz:  0.16, pSpd:  0.26, p: 0.9,  headSpd:  0.55, headT: 1.2, irid: 0.00, w: 1.00 },
      { k: 1.52, tx: 1.04, tz: -0.55, pSpd: -0.19, p: 2.3,  headSpd: -0.42, headT: 4.1, irid: 0.55, w: 0.85 },
      { k: 1.16, tx: 0.52, tz:  0.95, pSpd:  0.13, p: 4.6,  headSpd:  0.68, headT: 0.4, irid: 1.00, w: 0.72 }
    ];

    var PARTS = [];
    (function () {
      var N = 290, GA = 2.39996322972865332;
      for (var i = 0; i < N; i++) {
        var y = 1 - 2 * (i + 0.5) / N;
        var rad = Math.sqrt(Math.max(0, 1 - y * y));
        var th = i * GA;
        var jitter = 0.965 + 0.045 * Math.abs(Math.sin(i * 12.9898));
        PARTS.push({
          x: rad * Math.cos(th) * jitter,
          y: y * jitter,
          z: rad * Math.sin(th) * jitter,
          u: 0.5 + 0.5 * Math.sin(i * 78.233),          // palette blend
          tws: 0.5 + 1.1 * Math.abs(Math.sin(i * 3.7)), // twinkle speed
          ph: i * 1.7
        });
      }
    })();

    var MOTES = [];
    (function () {
      for (var i = 0; i < 26; i++) {
        MOTES.push({
          a: srand() * Math.PI * 2,
          r: 1.35 + srand() * 0.95,      // in units of R
          spd: (srand() * 0.5 + 0.15) * (srand() < 0.5 ? 1 : -1) * 0.05,
          bob: srand() * Math.PI * 2,
          bobSpd: 0.2 + srand() * 0.4,
          size: 0.7 + srand() * 1.1,
          u: srand(),
          al: 0.05 + srand() * 0.08
        });
      }
    })();

    // ---------------------------------------------------------- live state
    var mode = 'gold';        // palette: 'gold' (default) | 'obsidian'
    var stateName = 'idle';   // motion state (mood)
    var dimTarget = 1;        // 0.55 when dimmed (error/offline)
    var cur = { mix: 1, dim: 1 };  // gold default → mix starts settled at 1
    var kk;
    for (kk in STATES.idle) cur[kk] = STATES.idle[kk];

    var targetAudio = 0, audio = 0;

    var PAL = {}; // rebuilt each frame from mode mix
    function rebuildPal(m) {
      for (var k in OBS) PAL[k] = mix3(OBS[k], JAR[k], m);
    }

    function targets() {
      var t = { mix: (mode === 'gold') ? 1 : 0, dim: dimTarget };
      var s = STATES[stateName];
      for (var k in s) t[k] = s[k];
      return t;
    }

    var shellA = 0.7;      // particle shell yaw
    var T = 8.0;           // animation clock (starts non-zero for a pretty first frame)
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
      scene.width = canvas.width; scene.height = canvas.height;
      blurA.width = Math.max(2, Math.round(canvas.width / 4));
      blurA.height = Math.max(2, Math.round(canvas.height / 4));
      blurB.width = Math.max(2, Math.round(canvas.width / 8));
      blurB.height = Math.max(2, Math.round(canvas.height / 8));
      [ctx, sctx, actx, bctx].forEach(function (c) {
        c.imageSmoothingEnabled = true;
        try { c.imageSmoothingQuality = 'high'; } catch (e) {}
      });
      CX = W / 2; CY = H / 2;
      // Prototype sized off the viewport; here the canvas IS the stage, so the
      // outermost ring (1.52R + perspective swell) must clear the edges.
      R = Math.min(W, H) * 0.26;
    }

    // ---------------------------------------------------------- helpers
    function rg(c, x, y, r, stops) {
      var g = c.createRadialGradient(x, y, 0, x, y, r);
      for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
      return g;
    }

    // ---------------------------------------------------------- update
    function update(dt) {
      var t = targets();
      var e = 1 - Math.exp(-dt * 3.4);
      for (var k in t) cur[k] += (t[k] - cur[k]) * e;
      rebuildPal(cur.mix);

      // Audio smoothing (hologram.js setAudioLevel pattern, dt-normalized).
      audio += (targetAudio - audio) * (1 - Math.exp(-dt * 9));

      if (!REDUCED) {
        var age = ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - born) / 1000;
        master = Math.min(1, age / 0.9);
        master = 1 - Math.pow(1 - master, 3); // easeOutCubic
      }

      var dtA = REDUCED ? 0 : dt;
      T += dtA;
      shellA += dtA * 0.14 * cur.partSpd;
      for (var i = 0; i < RINGS.length; i++) {
        var ring = RINGS[i];
        ring.p += dtA * ring.pSpd * cur.precess;
        ring.headT += dtA * ring.headSpd * cur.headSpd;
      }
    }

    // ---------------------------------------------------------- scene render (additive, transparent bg)
    function drawScene() {
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.clearRect(0, 0, scene.width, scene.height);
      sctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      sctx.globalCompositeOperation = 'lighter';
      sctx.globalAlpha = master * cur.dim;

      var persp = PERSP_K * R;
      // Subtle audio-reactive energy (speaking/listening).
      var ringGain = cur.ringGlow * (1 + audio * 0.15);
      var coreBoost = 1 + audio * 0.30;
      var partBoost = 1 + audio * 0.20;

      // --- ambient room glow ---
      sctx.fillStyle = rg(sctx, CX, CY, R * 2.5, [
        [0,   css(PAL.haze, 0.055 * cur.haze)],
        [0.4, css(PAL.haze, 0.024 * cur.haze)],
        [1,   css(PAL.haze, 0)]
      ]);
      sctx.fillRect(CX - R * 2.5, CY - R * 2.5, R * 5, R * 5);

      // --- ambient motes ---
      for (var i = 0; i < MOTES.length; i++) {
        var mo = MOTES[i];
        var ma = mo.a + T * mo.spd;
        var mr = mo.r * R;
        var mx = CX + Math.cos(ma) * mr;
        var my = CY + Math.sin(ma) * mr * 0.72 + Math.sin(mo.bob + T * mo.bobSpd) * R * 0.06;
        var mcol = mix3(PAL.primary, PAL.secondary, mo.u);
        sctx.fillStyle = css(mcol, mo.al * (0.7 + 0.3 * Math.sin(T * mo.bobSpd * 2 + mo.bob)));
        sctx.beginPath();
        sctx.arc(mx, my, mo.size, 0, 6.2832);
        sctx.fill();
      }

      // --- sphere glass body + limb ---
      var G = R * 1.08;
      sctx.fillStyle = rg(sctx, CX, CY, G, [
        [0,     css(PAL.deep, 0.018)],
        [0.62,  css(PAL.deep, 0.010)],
        [0.900, css(PAL.rim,  0.026)],
        [0.926, css(PAL.rim,  0.115)],
        [0.948, css(PAL.rim,  0.038)],
        [1,     css(PAL.rim,  0)]
      ]);
      sctx.beginPath();
      sctx.arc(CX, CY, G, 0, 6.2832);
      sctx.fill();

      // --- holographic scan shimmer (band sweeping across the sphere) ---
      var bandW = R * 0.55;
      var span = R * 3.2;
      var bandX = CX - R * 1.6 + ((T * R * 0.11) % span);
      sctx.save();
      sctx.beginPath();
      sctx.arc(CX, CY, R * 0.995, 0, 6.2832);
      sctx.clip();
      var lg = sctx.createLinearGradient(bandX - bandW, 0, bandX + bandW, 0);
      lg.addColorStop(0, css(PAL.coreHot, 0));
      lg.addColorStop(0.5, css(PAL.coreHot, 0.035 * cur.haze));
      lg.addColorStop(1, css(PAL.coreHot, 0));
      sctx.fillStyle = lg;
      sctx.fillRect(CX - R, CY - R, R * 2, R * 2);
      sctx.restore();

      // --- luminous core ---
      var pulse = 1 + cur.pulseAmp * (0.62 * Math.sin(6.2832 * cur.pulseHz * T) +
                                      0.26 * Math.sin(6.2832 * cur.pulseHz * 1.71 * T + 1.3));
      var cg = cur.coreGain * pulse * coreBoost;
      // wide inner halo
      sctx.fillStyle = rg(sctx, CX, CY, R * 1.28 * pulse, [
        [0, css(PAL.haze, 0.10 * cg)], [0.45, css(PAL.haze, 0.040 * cg)], [1, css(PAL.haze, 0)]
      ]);
      sctx.beginPath(); sctx.arc(CX, CY, R * 1.28 * pulse, 0, 6.2832); sctx.fill();
      // mid glow
      sctx.fillStyle = rg(sctx, CX, CY, R * 0.60 * pulse, [
        [0, css(PAL.primary, 0.35 * cg)], [0.4, css(PAL.primary, 0.16 * cg)], [1, css(PAL.primary, 0)]
      ]);
      sctx.beginPath(); sctx.arc(CX, CY, R * 0.60 * pulse, 0, 6.2832); sctx.fill();
      // hot center
      sctx.fillStyle = rg(sctx, CX, CY, R * 0.29 * pulse, [
        [0, css(PAL.coreHot, 0.66 * cg)], [0.45, css(PAL.coreHot, 0.32 * cg)], [1, css(PAL.coreHot, 0)]
      ]);
      sctx.beginPath(); sctx.arc(CX, CY, R * 0.29 * pulse, 0, 6.2832); sctx.fill();
      // white-hot pin
      sctx.fillStyle = rg(sctx, CX, CY, R * 0.125 * pulse, [
        [0, css(PAL.coreWhite, 0.95)], [0.5, css(PAL.coreWhite, 0.42)], [1, css(PAL.coreWhite, 0)]
      ]);
      sctx.beginPath(); sctx.arc(CX, CY, R * 0.125 * pulse, 0, 6.2832); sctx.fill();

      // --- particle shell ---
      var tiltX = 0.46 + 0.05 * Math.sin(T * 0.07);
      var tiltZ = 0.09 * Math.sin(T * 0.05);
      var cy_ = Math.cos(shellA), sy_ = Math.sin(shellA);
      var cx_ = Math.cos(tiltX), sx_ = Math.sin(tiltX);
      var cz_ = Math.cos(tiltZ), sz_ = Math.sin(tiltZ);
      for (i = 0; i < PARTS.length; i++) {
        var p = PARTS[i];
        // yaw
        var x1 = p.x * cy_ + p.z * sy_;
        var z1 = -p.x * sy_ + p.z * cy_;
        var y1 = p.y;
        // pitch
        var y2 = y1 * cx_ - z1 * sx_;
        var z2 = y1 * sx_ + z1 * cx_;
        // roll
        var x3 = x1 * cz_ - y2 * sz_;
        var y3 = x1 * sz_ + y2 * cz_;
        var s = persp / (persp - z2 * R);
        var px = CX + x3 * R * s;
        var py = CY + y3 * R * s;
        var depth = (z2 + 1) * 0.5;
        var tw = 0.55 + 0.45 * Math.sin(T * p.tws + p.ph);
        var al = (0.05 + 0.72 * Math.pow(depth, 1.9)) * tw * cur.partGlow * 0.80 * partBoost;
        if (al < 0.012) continue;
        var col = mix3(mix3(PAL.primary, PAL.secondary, p.u), PAL.coreWhite, depth * 0.45);
        sctx.fillStyle = css(col, al);
        sctx.beginPath();
        sctx.arc(px, py, (0.58 + 1.05 * depth) * s, 0, 6.2832);
        sctx.fill();
      }

      // --- orbit ring arcs ---
      sctx.lineCap = 'round';
      for (i = 0; i < RINGS.length; i++) {
        var ring = RINGS[i];
        var rEff = R * (1 + (ring.k - 1) * cur.tighten);
        var ctx_ = Math.cos(ring.tx), stx = Math.sin(ring.tx);
        var ctz = Math.cos(ring.tz), stz = Math.sin(ring.tz);
        var cp = Math.cos(ring.p), sp = Math.sin(ring.p);
        var base = mix3(PAL.primary, PAL.secondary, ring.irid);

        var N = 150;
        var pts = new Array(N + 1);
        for (var j = 0; j <= N; j++) {
          var a = (j / N) * 6.2832;
          var x = Math.cos(a) * rEff, y = Math.sin(a) * rEff, z = 0;
          // pitch (tilt about X)
          var yy = y * ctx_ - z * stx;
          var zz = y * stx + z * ctx_;
          // roll (tilt about Z)
          var xx = x * ctz - yy * stz;
          yy = x * stz + yy * ctz;
          // precession (about Y)
          var xr = xx * cp + zz * sp;
          var zr = -xx * sp + zz * cp;
          var ss = persp / (persp - zr);
          pts[j] = [CX + xr * ss, CY + yy * ss, zr / rEff, ss];
        }
        // base ellipse — thin, depth-graded
        for (j = 0; j < N; j++) {
          var p0 = pts[j], p1 = pts[j + 1];
          var depth2 = (Math.max(-1, Math.min(1, (p0[2] + p1[2]) * 0.5)) + 1) * 0.5;
          var al2 = ringGain * 0.38 * (0.14 + 0.86 * Math.pow(depth2, 1.6));
          sctx.strokeStyle = css(base, al2);
          sctx.lineWidth = (0.55 + 1.05 * depth2) * ring.w * p0[3];
          sctx.beginPath();
          sctx.moveTo(p0[0], p0[1]);
          sctx.lineTo(p1[0], p1[1]);
          sctx.stroke();
        }
        // comet arc behind the head
        var headA = ring.headT;
        var CL = 1.9, CN = 30;
        var cometCol = mix3(base, PAL.coreWhite, 0.35);
        var prev = null;
        for (j = 0; j <= CN; j++) {
          var f = j / CN;
          var a2 = headA - CL * (1 - f);
          var x4 = Math.cos(a2) * rEff, y4 = Math.sin(a2) * rEff, z4 = 0;
          var yy2 = y4 * ctx_ - z4 * stx;
          var zz2 = y4 * stx + z4 * ctx_;
          var xx2 = x4 * ctz - yy2 * stz;
          yy2 = x4 * stz + yy2 * ctz;
          var xr2 = xx2 * cp + zz2 * sp;
          var zr2 = -xx2 * sp + zz2 * cp;
          var ss2 = persp / (persp - zr2);
          var scr = [CX + xr2 * ss2, CY + yy2 * ss2, zr2 / rEff, ss2];
          if (prev) {
            var depth3 = (Math.max(-1, Math.min(1, (prev[2] + scr[2]) * 0.5)) + 1) * 0.5;
            var ramp = f * f;
            var al3 = ringGain * 0.78 * ramp * (0.22 + 0.78 * depth3);
            sctx.strokeStyle = css(cometCol, al3);
            sctx.lineWidth = (0.8 + 1.5 * depth3) * ring.w * scr[3] * (0.4 + 0.6 * f);
            sctx.beginPath();
            sctx.moveTo(prev[0], prev[1]);
            sctx.lineTo(scr[0], scr[1]);
            sctx.stroke();
          }
          prev = scr;
        }
        // head glow dot
        var hd = prev;
        var hDepth = (Math.max(-1, Math.min(1, hd[2])) + 1) * 0.5;
        var hFall = 0.12 + 0.88 * Math.pow(hDepth, 1.5);
        var hr = (2.2 + 2.6 * hDepth) * hd[3];
        sctx.fillStyle = rg(sctx, hd[0], hd[1], hr * 2.4, [
          [0, css(PAL.coreWhite, 0.78 * hFall * ringGain)],
          [0.35, css(cometCol, 0.30 * hFall * ringGain)],
          [1, css(cometCol, 0)]
        ]);
        sctx.beginPath();
        sctx.arc(hd[0], hd[1], hr * 2.4, 0, 6.2832);
        sctx.fill();
      }

      sctx.globalAlpha = 1;
    }

    // ---------------------------------------------------------- composite (scene + bloom, NO background)
    function composite() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      if (HAS_FILTER) ctx.filter = 'none';
      ctx.globalAlpha = 1;

      // Transparent stage — the prototype's opaque radial background is
      // deliberately gone; just clear to transparency.
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // downscale for bloom
      actx.setTransform(1, 0, 0, 1, 0, 0);
      actx.clearRect(0, 0, blurA.width, blurA.height);
      actx.drawImage(scene, 0, 0, blurA.width, blurA.height);
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.clearRect(0, 0, blurB.width, blurB.height);
      bctx.drawImage(blurA, 0, 0, blurB.width, blurB.height);

      // scene, sharp
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(scene, 0, 0);

      // bloom layers, soft + wide
      ctx.globalAlpha = 0.55;
      if (HAS_FILTER) ctx.filter = 'blur(' + (5 * DPR) + 'px)';
      ctx.drawImage(blurA, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 0.42;
      if (HAS_FILTER) ctx.filter = 'blur(' + (13 * DPR) + 'px)';
      ctx.drawImage(blurB, 0, 0, canvas.width, canvas.height);
      if (HAS_FILTER) ctx.filter = 'none';
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    function render() {
      drawScene();
      composite();
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
      rebuildPal(cur.mix);
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
        if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
        scene = blurA = blurB = null;
        sctx = actx = bctx = null;
        ctx = null;
        canvas = null;
      }
    };
  }

  if (typeof window !== 'undefined' && window.OrbEngine) {
    window.OrbEngine.register('classic', {
      label: 'Classic',
      create: function (canvas) { return createClassic(canvas); }
    });
  }
})();
