// The stage shape layer: how JARVIS HIMSELF becomes rock, paper, or
// scissors on the main screen. Adam's spec killed the overlay ("That is not
// the orb. I never wanted to leave the main screen"), and the eight souls
// each own a private render loop — one of them a WebGL shader — so the soul
// canvases cannot be taught new geometry without eight implementations.
//
// Instead, the proven trick from the file-search effect (.searching in
// styles.css) one level up: a sibling canvas positioned over #hologram's
// exact box. On morphTo(), the soul fades to a blurred ghost via a body
// class and is PAUSED (defense-ui's pattern — remember the prior flag,
// restore it, never blanket-resume), while this canvas draws the orb
// becoming the shape using the same test-pinned polar math the game chips
// used (OrbShapes.morphRadius + tints), scissors glyph fallback included —
// the polar scissors reads as a blob on real hardware, found live in the
// games build.
//
// Plain script, window.OrbShapeLayer only. Loaded on both builds; inert
// until morphTo() is called, and only JR's rps driver calls it.
(function () {
  var raf = 0;
  var activeShape = null;   // shape currently shown/held
  var priorPaused = null;   // the soul's paused flag before we touched it

  function canvas() { return document.getElementById('orb-shape'); }

  function sizeCanvas(el) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return null;
    if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
    }
    var ctx = el.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The soul sizing convention (src/hologram.js) so the shape appears
    // exactly where the orb lives, at the orb's own size.
    return { ctx: ctx, cx: w / 2, cy: h / 2, radius: Math.min(w * 0.34, h * 0.44, 335) };
  }

  function accent() {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--accent-bright');
    return (v && v.trim()) || '#e8c880';
  }

  function tintFor(shape) {
    var tints = (window.OrbShapes && window.OrbShapes.SHAPE_TINTS) || {};
    return tints[shape] || accent();
  }

  function trace(ctx, cx, cy, radiusFn) {
    ctx.beginPath();
    var first = true;
    for (var theta = 0; theta < Math.PI * 2; theta += 0.04) {
      var r = radiusFn(theta);
      var x = cx + Math.cos(theta) * r;
      var y = cy + Math.sin(theta) * r;
      if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function easeInOut(p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }

  function drawScissorsGlyph(ctx, cx, cy, size, alpha) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    var tint = tintFor('scissors');
    ctx.strokeStyle = tint;
    ctx.lineWidth = Math.max(3, size * 0.1);
    ctx.lineCap = 'round';
    [2.62, 0.52].forEach(function (angle) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * size * 1.05, cy + Math.sin(angle) * size * 1.05);
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(4, size * 0.14), 0, Math.PI * 2);
    ctx.fillStyle = tint;
    ctx.fill();
    ctx.restore();
  }

  // One frame of "orb becoming `to`" (or back), progress 0..1, t for wobble.
  function drawFrame(from, to, progress, t) {
    var el = canvas();
    if (!el || !window.OrbShapes) return;
    var box = sizeCanvas(el);
    if (!box) return;
    box.ctx.clearRect(0, 0, el.clientWidth, el.clientHeight);
    var scissorsInvolved = from === 'scissors' || to === 'scissors';
    if (scissorsInvolved) {
      // Glyph fallback: the polar scissors is a blob at stage size too.
      // Blend to/from a small core and draw the blades over it.
      var f = easeInOut(progress);
      var fromR = from === 'scissors' ? 0.5 : null;
      var toR = to === 'scissors' ? 0.5 : null;
      trace(box.ctx, box.cx, box.cy, function (theta) {
        var a = fromR !== null ? fromR : window.OrbShapes.SHAPES[from](theta, t);
        var b = toR !== null ? toR : window.OrbShapes.SHAPES[to](theta, t);
        return box.radius * (a * (1 - f) + b * f);
      });
    } else {
      trace(box.ctx, box.cx, box.cy, function (theta) {
        return box.radius * window.OrbShapes.morphRadius(from, to, progress, theta, t);
      });
    }
    var blend = to === 'orb' ? from : to;
    box.ctx.fillStyle = progress < 0.5 && to !== 'orb' ? accent() : tintFor(blend);
    box.ctx.fill();
    if (scissorsInvolved) {
      var alpha = to === 'scissors' ? easeInOut(progress) : (from === 'scissors' ? 1 - easeInOut(progress) : 0);
      drawScissorsGlyph(box.ctx, box.cx, box.cy, box.radius, alpha);
    }
  }

  function animate(from, to, duration) {
    return new Promise(function (resolve) {
      var start = null;
      cancelAnimationFrame(raf);
      function tick(now) {
        if (start === null) start = now;
        var progress = Math.min(1, (now - start) / duration);
        drawFrame(from, to, progress, now);
        if (progress < 1) { raf = requestAnimationFrame(tick); } else { resolve(); }
      }
      raf = requestAnimationFrame(tick);
    });
  }

  // Held shape breathes gently so it reads as JARVIS being the shape, not a
  // freeze-frame. Runs only while held; cancelled by the next animate/clear.
  function holdLoop(shape) {
    cancelAnimationFrame(raf);
    function tick(now) {
      if (activeShape !== shape) return;
      drawFrame(shape, shape, 1, now);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
  }

  function soul() { return window.jarvisHologram || null; }

  function morphTo(shape) {
    if (!canvas() || !window.OrbShapes || !window.OrbShapes.SHAPES[shape]) return Promise.resolve(false);
    if (priorPaused === null) {
      var host = soul();
      priorPaused = host && typeof host.setPaused === 'function' ? Boolean(host.paused) : false;
      try { host && host.setPaused(true); } catch (error) { /* the fade alone still works */ }
    }
    document.body.classList.add('orb-shape-active');
    var from = activeShape || 'orb';
    activeShape = shape;
    return animate(from, shape, 420).then(function () {
      holdLoop(shape);
      return true;
    });
  }

  function morphBack() {
    if (!activeShape) return Promise.resolve();
    var from = activeShape;
    activeShape = null;
    return animate(from, 'orb', 420).then(function () {
      cancelAnimationFrame(raf);
      var el = canvas();
      if (el) {
        var ctx = el.getContext('2d');
        ctx.clearRect(0, 0, el.width, el.height);
      }
      document.body.classList.remove('orb-shape-active');
      try { soul() && soul().setPaused(priorPaused === true); } catch (error) { /* soul stays faded-in regardless */ }
      priorPaused = null;
    });
  }

  window.OrbShapeLayer = {
    morphTo: morphTo,
    morphBack: morphBack,
    active: function () { return activeShape !== null; }
  };
})();
