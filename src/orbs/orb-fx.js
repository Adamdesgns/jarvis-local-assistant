// Shared cinematic finishing pass for the 2D orb skins — chromatic
// aberration, palette color grade, subtle flicker, soft vignette. Adapted
// from the post-processing stack of the MIT-licensed ULTRON orb by Sagar
// Tamang (https://github.com/SAGAR-TAMANG/ultron-by-sagar-builds), whose
// shader displaces each channel radially from center: a uniform scale about
// the canvas center produces the same displacement field, so the whole pass
// is a handful of composited drawImage calls instead of per-pixel work.
// Browser-only: all node-testable math lives in orb-utils.js.
(function () {
  if (typeof window === 'undefined') return;

  function create(canvas) {
    var U = window.OrbUtils;
    if (!U) return null;

    // Half-res scratch buffers: the fringe is soft by nature, so the
    // downscale is invisible and quarters the fill cost.
    var base = document.createElement('canvas');
    var bctx = base.getContext('2d');
    var chR = document.createElement('canvas');
    var rctx = chR.getContext('2d');
    var chB = document.createElement('canvas');
    var xctx = chB.getContext('2d');
    var destroyed = false;

    function isolate(cctx, cnv, fill) {
      cctx.setTransform(1, 0, 0, 1, 0, 0);
      cctx.globalCompositeOperation = 'source-over';
      cctx.clearRect(0, 0, cnv.width, cnv.height);
      cctx.drawImage(base, 0, 0);
      cctx.globalCompositeOperation = 'multiply';
      cctx.fillStyle = fill;
      cctx.fillRect(0, 0, cnv.width, cnv.height);
      // multiply flood-fills transparent areas; re-mask to the frame's alpha
      cctx.globalCompositeOperation = 'destination-in';
      cctx.drawImage(base, 0, 0);
      cctx.globalCompositeOperation = 'source-over';
    }

    // opts: { t (seconds), palette ('gold'|'obsidian'), intensity (0..1),
    //         reduced (bool) }. Invariant: leaves ctx at identity transform,
    // source-over, alpha 1 — same state every skin ends its own frame in.
    function apply(ctx, opts) {
      if (destroyed) return;
      var w = canvas.width, h = canvas.height;
      if (w < 2 || h < 2) return;
      var intensity = Math.max(0, Math.min(1, opts.intensity !== undefined ? opts.intensity : 1));
      if (intensity <= 0) return;
      var reduced = Boolean(opts.reduced);
      var flick = reduced ? 1 : U.flicker(opts.t || 0);
      var gold = opts.palette !== 'obsidian';

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      // --- chromatic aberration (skipped on tiny canvases) ---------------
      var k = U.caScale(Math.min(w, h));
      if (k > 0) {
        var hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
        if (base.width !== hw || base.height !== hh) {
          base.width = chR.width = chB.width = hw;
          base.height = chR.height = chB.height = hh;
        }
        bctx.setTransform(1, 0, 0, 1, 0, 0);
        bctx.clearRect(0, 0, hw, hh);
        bctx.drawImage(canvas, 0, 0, hw, hh);
        isolate(rctx, chR, '#f00');
        isolate(xctx, chB, '#00f');
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.32 * intensity * flick;
        // red fringe pushed outward, blue pulled inward and weaker
        ctx.drawImage(chR, -w * k / 2, -h * k / 2, w * (1 + k), h * (1 + k));
        ctx.drawImage(chB, w * k * 0.25, h * k * 0.25, w * (1 - k * 0.5), h * (1 - k * 0.5));
        ctx.globalAlpha = 1;
      }

      // --- color grade (source-atop = lerp toward the tint, transparent
      // stage untouched) --------------------------------------------------
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = gold
        ? 'rgba(255,183,90,' + (0.05 * intensity).toFixed(4) + ')'
        : 'rgba(120,150,255,' + (0.04 * intensity).toFixed(4) + ')';
      ctx.fillRect(0, 0, w, h);

      // --- flicker veil (±1%) --------------------------------------------
      if (!reduced && flick !== 1) {
        var fa = Math.abs(flick - 1) * 0.5;
        ctx.fillStyle = flick < 1 ? 'rgba(0,0,0,' + fa.toFixed(4) + ')' : 'rgba(255,255,255,' + fa.toFixed(4) + ')';
        ctx.fillRect(0, 0, w, h);
      }

      // --- soft vignette on large canvases -------------------------------
      if (Math.min(w, h) > 400) {
        var cx = w / 2, cy = h / 2;
        var rOut = Math.sqrt(cx * cx + cy * cy);
        var grad = ctx.createRadialGradient(cx, cy, rOut * 0.55, cx, cy, rOut);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0.88)');
        ctx.globalCompositeOperation = 'destination-in';
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }

      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }

    function destroy() {
      destroyed = true;
      base = chR = chB = null;
      bctx = rctx = xctx = null;
      canvas = null;
    }

    return { apply: apply, destroy: destroy };
  }

  window.OrbFX = { create: create };
})();
