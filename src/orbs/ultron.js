// Orb skin: "ultron" — 2D-canvas port of the MIT-licensed ULTRON orb by
// Sagar Tamang (https://github.com/SAGAR-TAMANG/ultron-by-sagar-builds).
// A rotating holographic wireframe sphere: dense latitude/longitude shell
// with four bright cross meridians and a hot equator band, a counter-rotating
// shell of partial arcs, a fast spiral inner core, a surging icosahedral hot
// center, orbiting debris, drifting code-text sprites, scan rings, and dust.
// The finishing pass (chromatic fringe / grade / flicker) comes from the
// shared OrbFX layer like every other skin. Voice accelerates the whole
// machine — this skin is built to visibly TALK.
// Classic script (no ES modules); registers itself on window.OrbEngine.
(function () {
  'use strict';

  var U = window.OrbUtils;
  var mix3 = U.mix3;
  var css = U.css;

  // ------------------------------------------------------------ palettes
  var JAR = { bright: [255, 170, 48], mid: [221, 119, 0], dim: [136, 68, 0], faint: [85, 51, 0], hot: [255, 204, 102] };
  var OBS = { bright: [111, 195, 255], mid: [61, 126, 221], dim: [39, 74, 136], faint: [26, 48, 90], hot: [191, 230, 255] };

  // ------------------------------------------------------------ motion states
  var STATES = {
    idle:      { rot: 1.00, glow: 1.00, surge: 1.00, mix: 1, dim: 1 },
    listening: { rot: 1.40, glow: 1.35, surge: 1.20, mix: 1, dim: 1 },
    thinking:  { rot: 2.60, glow: 1.15, surge: 1.60, mix: 1, dim: 1 }
  };
  var MOOD_TO_STATE = { idle: 'idle', listening: 'listening', thinking: 'thinking' };

  var CODE = [
    'sys.init()', '0xFF3A', '>> SCAN', 'ACK', 'SYNC OK', 'exec()', 'core.0',
    '01101001', '>>> RDY', 'TCP/SYN', 'IRQ 0x7', 'REG EAX', 'kernel.d',
    'fork()', 'eth0: UP', 'AES-256', 'TLS 1.3', 'latency', '200 OK',
    'fn main', 'impl Orb', 'async {}', 'spawn()', '.unwrap'
  ];

  var PERSP_K = 4.2;

  function createUltron(canvas) {
    var ctx = canvas.getContext('2d');
    var fx = window.OrbFX ? window.OrbFX.create(canvas) : null;

    var REDUCED = false;
    try { REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

    var W = 0, H = 0, DPR = 1, CX = 0, CY = 0, R = 100;
    var detail = 1; // halved on tiny canvases (floating widget)

    var srand = U.lcg(4107);

    // -------------------------------------------------------- palette state
    var mode = 'gold';
    var stateName = 'idle';
    var dimTarget = 1;
    var targetAudio = 0, audio = 0;

    function targets() {
      var t = STATES[stateName];
      return { rot: t.rot, glow: t.glow, surge: t.surge, mix: (mode === 'gold') ? 1 : 0, dim: dimTarget };
    }
    var cur = { rot: 1, glow: 1, surge: 1, mix: 1, dim: 1 };

    var PAL = {};
    function rebuildPal(m) {
      PAL.bright = mix3(OBS.bright, JAR.bright, m);
      PAL.mid = mix3(OBS.mid, JAR.mid, m);
      PAL.dim = mix3(OBS.dim, JAR.dim, m);
      PAL.faint = mix3(OBS.faint, JAR.faint, m);
      PAL.hot = mix3(OBS.hot, JAR.hot, m);
    }
    rebuildPal(1);

    // -------------------------------------------------------- geometry
    // Unit-sphere polylines, rebuilt when the detail level flips. Each entry:
    // { pts: [[x,y,z]...], color: 'bright'|'mid'|'dim'|'faint', alpha, shell }
    // shell 1 = outer grid, 2 = arcs (counter-rotating), 3 = spiral core.
    var lines = [];
    var debris = [];
    var dust = [];
    var text = [];

    function ringPts(lat, segs, r) {
      var pts = [], cl = Math.cos(lat) * r, y = Math.sin(lat) * r;
      for (var i = 0; i <= segs; i++) {
        var a = (i / segs) * 6.2832;
        pts.push([cl * Math.cos(a), y, cl * Math.sin(a)]);
      }
      return pts;
    }
    function meridianPts(lon, segs, r, lat0, lat1) {
      var pts = [];
      for (var i = 0; i <= segs; i++) {
        var lat = lat0 + (i / segs) * (lat1 - lat0);
        pts.push([r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(lon)]);
      }
      return pts;
    }

    function buildGeometry() {
      lines = [];
      var segs = Math.round(36 * detail) || 12;
      var i, j;

      // outer shell: latitude rings + meridians (major lines pop)
      var latCount = Math.round(11 * detail);
      for (i = 0; i < latCount; i++) {
        var lat = ((i + 0.5) / latCount - 0.5) * 2.9;
        var major = i % 3 === 0;
        lines.push({ pts: ringPts(lat, segs, 0.86), color: major ? 'mid' : 'faint', alpha: major ? 0.5 : 0.16, shell: 1 });
      }
      var lonCount = Math.round(14 * detail);
      for (i = 0; i < lonCount; i++) {
        var lon = (i / lonCount) * 6.2832;
        var majorM = i % 4 === 0;
        lines.push({ pts: meridianPts(lon, segs, 0.86, -1.5, 1.5), color: majorM ? 'mid' : 'faint', alpha: majorM ? 0.5 : 0.12, shell: 1 });
      }
      // four bright cross meridians (the "plus"), each a 3-line band
      for (i = 0; i < 4; i++) {
        var clon = (i / 4) * 6.2832;
        for (j = -1; j <= 1; j++) {
          lines.push({
            pts: meridianPts(clon + j * 0.06, segs, 0.865, -1.55, 1.55),
            color: j === 0 ? 'bright' : 'mid', alpha: j === 0 ? 0.85 : 0.4, shell: 1
          });
        }
      }
      // hot equator band
      for (j = -1; j <= 1; j++) {
        lines.push({ pts: ringPts(j * 0.05, segs, 0.868), color: j === 0 ? 'bright' : 'mid', alpha: j === 0 ? 0.8 : 0.38, shell: 1 });
      }
      // secondary shell: partial arcs, counter-rotating
      var arcCount = Math.round(12 * detail);
      for (i = 0; i < arcCount; i++) {
        var alat = (srand() - 0.5) * 2.5;
        var start = srand() * 6.2832;
        var len = 0.5 + srand() * 1.4;
        var pts = [], r2 = 0.93, clat = Math.cos(alat) * r2, ay = Math.sin(alat) * r2;
        var asegs = Math.max(8, Math.round(16 * detail));
        for (j = 0; j <= asegs; j++) {
          var aa = start + (j / asegs) * len;
          pts.push([clat * Math.cos(aa), ay, clat * Math.sin(aa)]);
        }
        lines.push({ pts: pts, color: 'dim', alpha: 0.2 + srand() * 0.25, shell: 2 });
      }
      // spiral inner core
      var spiralCount = Math.max(4, Math.round(6 * detail));
      var ssegs = Math.max(40, Math.round(80 * detail));
      for (i = 0; i < spiralCount; i++) {
        var phase = (i / spiralCount) * 6.2832;
        var turns = 3 + (i % 3);
        var spts = [];
        for (j = 0; j <= ssegs; j++) {
          var t = j / ssegs;
          var slat = t * 3.1416 - 1.5708;
          var slon = t * turns * 6.2832 + phase;
          spts.push([0.42 * Math.cos(slat) * Math.cos(slon), 0.42 * Math.sin(slat), 0.42 * Math.cos(slat) * Math.sin(slon)]);
        }
        lines.push({ pts: spts, color: 'bright', alpha: 0.3, shell: 3 });
      }

      // orbiting debris
      debris = [];
      var dc = Math.round(44 * detail);
      for (i = 0; i < dc; i++) {
        debris.push({
          r: 1.02 + srand() * 0.55,
          speed: (0.15 + srand() * 0.65) * (srand() > 0.5 ? 1 : -1),
          tilt: (srand() - 0.5) * 2.4,
          phase: srand() * 6.2832,
          size: 0.7 + srand() * 1.6,
          hot: srand() > 0.72
        });
      }
      // dust
      dust = [];
      var duc = Math.round(90 * detail);
      for (i = 0; i < duc; i++) {
        var dr = 0.5 + Math.pow(srand(), 0.6) * 1.4;
        var dph = Math.acos(2 * srand() - 1), dth = srand() * 6.2832;
        dust.push({ x: dr * Math.sin(dph) * Math.cos(dth), y: dr * Math.cos(dph), z: dr * Math.sin(dph) * Math.sin(dth), a: 0.06 + srand() * 0.2 });
      }
      // code-text sprites, prerendered per palette refresh
      text = [];
      var tc = Math.round(30 * detail);
      for (i = 0; i < tc; i++) {
        text.push({
          str: CODE[Math.floor(srand() * CODE.length)],
          phi: Math.acos(2 * srand() - 1),
          theta: srand() * 6.2832,
          r: 0.9 + srand() * 0.24,
          speed: (0.02 + srand() * 0.06) * (srand() > 0.5 ? 1 : -1),
          a: 0.3 + srand() * 0.5,
          sprite: null
        });
      }
    }

    var spriteMode = '';
    function buildSprites() {
      if (spriteMode === mode) return;
      spriteMode = mode;
      var col = (mode === 'gold') ? JAR : OBS;
      for (var i = 0; i < text.length; i++) {
        var c = document.createElement('canvas');
        c.width = 72; c.height = 12;
        var tctx = c.getContext('2d');
        tctx.font = 'bold 9px Consolas, monospace';
        tctx.fillStyle = css(mix3(col.mid, col.bright, srand()), 0.9);
        tctx.textBaseline = 'middle';
        tctx.fillText(text[i].str, 1, 6);
        text[i].sprite = c;
      }
    }

    // -------------------------------------------------------- projection
    function rotProj(p, yaw, nod, scale, out) {
      var cy = Math.cos(yaw), sy = Math.sin(yaw);
      var x = p[0] * cy + p[2] * sy;
      var z = -p[0] * sy + p[2] * cy;
      var cn = Math.cos(nod), sn = Math.sin(nod);
      var y = p[1] * cn - z * sn;
      z = p[1] * sn + z * cn;
      var s = PERSP_K / (PERSP_K - z);
      out.x = CX + x * scale * s;
      out.y = CY + y * scale * s;
      out.z = z;
      return out;
    }
    var P0 = { x: 0, y: 0, z: 0 };

    // -------------------------------------------------------- sizing
    function doResize() {
      var rect = canvas.getBoundingClientRect();
      DPR = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(2, rect.width); H = Math.max(2, rect.height);
      canvas.width = Math.max(2, Math.round(W * DPR));
      canvas.height = Math.max(2, Math.round(H * DPR));
      CX = W / 2; CY = H / 2;
      R = Math.min(W, H) * 0.34;
      var wantDetail = R < 80 ? 0.5 : 1;
      if (wantDetail !== detail || !lines.length) {
        detail = wantDetail;
        srand = U.lcg(4107);
        buildGeometry();
        spriteMode = '';
        buildSprites();
      }
    }

    // -------------------------------------------------------- update
    var T = 8.0;
    var yawO = 0, yawA = 0, yawS = 0; // outer / arcs / spiral accumulated angles

    function update(dt) {
      var k = U.smoothK(3.4, dt);
      var t = targets();
      for (var key in t) cur[key] += (t[key] - cur[key]) * k;
      audio += (targetAudio - audio) * U.smoothK(9, dt);
      rebuildPal(cur.mix);
      buildSprites();

      // Voice hits the throttle hard — this skin talks with its whole body.
      var dtA = REDUCED ? 0 : dt * cur.rot * (1 + audio * 1.6);
      T += dtA;
      yawO += dtA * 0.30;
      yawA -= dtA * 0.20;
      yawS -= dtA * 1.30;
    }

    // -------------------------------------------------------- render
    function render() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.globalCompositeOperation = 'lighter';

      var gain = cur.dim * cur.glow;
      var sg = REDUCED ? 0 : U.surgeEnvelope(T, { strength: cur.surge });
      var nod = Math.sin(T * 0.08) * 0.14;
      var i, j, L, p;

      // dust
      for (i = 0; i < dust.length; i++) {
        var d = dust[i];
        rotProj([d.x, d.y, d.z], yawO * 0.3, nod * 0.5, R, P0);
        ctx.fillStyle = css(PAL.mid, d.a * gain * (0.6 + 0.4 * (P0.z + 1.4) / 2.8));
        ctx.fillRect(P0.x, P0.y, 1, 1);
      }

      // wireframe shells + spiral core
      ctx.lineWidth = 1;
      for (i = 0; i < lines.length; i++) {
        L = lines[i];
        var yaw = L.shell === 1 ? yawO : L.shell === 2 ? yawA : yawS;
        var boost = (L.color === 'bright') ? (1 + 0.5 * sg + audio * 0.4) : 1;
        ctx.strokeStyle = css(PAL[L.color], Math.min(1, L.alpha * gain * boost));
        ctx.beginPath();
        for (j = 0; j < L.pts.length; j++) {
          rotProj(L.pts[j], yaw, nod, R, P0);
          if (j === 0) ctx.moveTo(P0.x, P0.y); else ctx.lineTo(P0.x, P0.y);
        }
        ctx.stroke();
      }

      // code text riding the outer shell
      for (i = 0; i < text.length; i++) {
        var tx = text[i];
        tx.theta += 0; // drift is folded into yaw; per-sprite drift below
        var th = tx.theta + T * tx.speed;
        var sp = Math.sin(tx.phi), cp = Math.cos(tx.phi);
        rotProj([tx.r * sp * Math.cos(th), tx.r * cp, tx.r * sp * Math.sin(th)], yawO, nod, R, P0);
        var depth = (P0.z + 1.2) / 2.4;
        if (depth < 0.25) continue; // hide the far side
        ctx.globalAlpha = tx.a * gain * depth * 0.8;
        ctx.drawImage(tx.sprite, P0.x - 18, P0.y - 3);
      }
      ctx.globalAlpha = 1;

      // orbiting debris with short motion streaks
      for (i = 0; i < debris.length; i++) {
        var b = debris[i];
        var a0 = T * b.speed + b.phase;
        var ct = Math.cos(b.tilt), st = Math.sin(b.tilt);
        var bx = b.r * Math.cos(a0), bz = b.r * Math.sin(a0), by = bz * st * 0.6;
        rotProj([bx, by, bz * ct], yawO * 0.5, nod, R, P0);
        var bd = (P0.z + 1.8) / 3.6;
        var col = b.hot ? PAL.bright : PAL.mid;
        var ba = (b.hot ? 0.8 : 0.45) * gain * (0.4 + 0.6 * bd);
        // streak: previous position a moment ago
        var a1 = a0 - 0.10 * (b.speed > 0 ? 1 : -1) * (1 + audio);
        var px2 = b.r * Math.cos(a1), pz2 = b.r * Math.sin(a1), py2 = pz2 * st * 0.6;
        var prev = rotProj([px2, py2, pz2 * ct], yawO * 0.5, nod, R, { x: 0, y: 0, z: 0 });
        ctx.strokeStyle = css(col, ba * 0.35);
        ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(P0.x, P0.y); ctx.stroke();
        ctx.fillStyle = css(col, ba);
        ctx.beginPath(); ctx.arc(P0.x, P0.y, b.size * (0.8 + 0.5 * bd), 0, 6.2832); ctx.fill();
      }

      // scan rings sweeping the shell
      if (!REDUCED) {
        var sweeps = [U.scanSweep(T, 0.4), U.scanSweep(T, 0.6, 2)];
        for (i = 0; i < sweeps.length; i++) {
          var sw = sweeps[i];
          var swR = sw.scale * R * 0.87;
          if (swR > 2) {
            ctx.strokeStyle = css(PAL.bright, (i === 0 ? 0.22 : 0.14) * sw.alpha * gain);
            ctx.lineWidth = i === 0 ? 1.4 : 1;
            ctx.beginPath();
            ctx.ellipse(CX, CY + sw.y * R * 0.87 * Math.cos(nod), swR, swR * 0.22, 0, 0, 6.2832);
            ctx.stroke();
            ctx.lineWidth = 1;
          }
        }
      }

      // hot center: surging glow + twin rotating hex wireframes
      var pulse = 1 + sg * 1.6 + audio * 0.35 * Math.abs(Math.sin(T * 9));
      var coreR = R * 0.12 * pulse;
      var g = ctx.createRadialGradient(CX, CY, 0, CX, CY, coreR * 2.6);
      g.addColorStop(0, css(PAL.hot, Math.min(1, (0.5 + sg * 0.5) * gain)));
      g.addColorStop(0.35, css(PAL.bright, 0.25 * gain * (1 + sg)));
      g.addColorStop(1, css(PAL.mid, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(CX, CY, coreR * 2.6, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = css(PAL.hot, Math.min(1, 0.75 * gain * (1 + sg * 0.6)));
      for (i = 0; i < 2; i++) {
        var hexA = T * (i === 0 ? 0.9 : -1.3);
        ctx.beginPath();
        for (j = 0; j <= 6; j++) {
          var ha = hexA + (j / 6) * 6.2832;
          var hr = coreR * (i === 0 ? 1.5 : 1.1);
          var hx = CX + Math.cos(ha) * hr, hy = CY + Math.sin(ha) * hr * (0.7 + 0.3 * Math.cos(hexA * 0.7));
          if (j === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
        }
        ctx.stroke();
      }

      ctx.globalCompositeOperation = 'source-over';

      if (fx) fx.apply(ctx, { t: T, palette: mode, intensity: cur.dim, reduced: REDUCED });
    }

    // -------------------------------------------------------- loop control
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
    function renderStatic() {
      var t = targets();
      for (var k in t) cur[k] = t[k];
      rebuildPal(cur.mix);
      buildSprites();
      render();
    }

    var resizeObserver = null;
    try {
      resizeObserver = new ResizeObserver(function () {
        if (destroyed) return;
        doResize();
        if (REDUCED) renderStatic(); else { update(0.0001); render(); }
      });
      resizeObserver.observe(canvas.parentElement || canvas);
    } catch (e) { /* resize() still works */ }

    doResize();
    if (REDUCED) renderStatic();
    else { update(0.0001); render(); start(); }

    var unbindVis = U.bindVisibility(function () {
      if (destroyed) return;
      if (document.hidden) stop(); else start();
    });

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
        if (REDUCED) renderStatic(); else { update(0.0001); render(); }
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
    window.OrbEngine.register('ultron', {
      label: 'Ultron',
      create: function (canvas) { return createUltron(canvas); }
    });
  }
})();
