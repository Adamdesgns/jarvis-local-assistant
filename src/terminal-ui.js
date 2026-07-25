// THE TERMINAL, stage 1 — the view.
//
// Matrix rain on a canvas, the console log on top of it, both tinted with the
// accent of whichever orb soul is currently wearing the window. The rain is
// decoration only: it never blocks input and it stops dead under REDUCED
// MOTION or the OS "reduce motion" setting.
(function () {
  const GLYPHS = 'アカサタナハマヤラワイキシチニヒミリヲウクスツヌフムユルンヲ0123456789<>[]{}/\\=+*';
  const FONT_SIZE = 14;
  const FRAME_MS = 55; // ~18fps. Rain does not need 60 and this is somebody's laptop.

  function createRain(canvas) {
    const ctx = canvas.getContext('2d');
    let drops = [];
    let columns = 0;
    let accent = '#ffb21f';
    let raf = 0;
    let last = 0;
    let running = false;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (!rect.width || !rect.height) return false;
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      columns = Math.max(1, Math.floor(rect.width / FONT_SIZE));
      // Stagger the starting heights so it never begins as one flat wall.
      drops = Array.from({ length: columns }, () => Math.random() * -40);
      return true;
    }

    function paint(width, height) {
      // Fade the previous frame instead of clearing: that smear IS the trail.
      ctx.fillStyle = 'rgba(3, 4, 5, 0.16)';
      ctx.fillRect(0, 0, width, height);
      ctx.font = `${FONT_SIZE}px "IBM Plex Mono", ui-monospace, monospace`;

      for (let i = 0; i < drops.length; i += 1) {
        const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        const x = i * FONT_SIZE;
        const y = drops[i] * FONT_SIZE;
        // The leading character is bright; the tail is the accent, dimmed.
        ctx.fillStyle = Math.random() > 0.975 ? '#ffffff' : accent;
        ctx.globalAlpha = Math.random() > 0.9 ? 0.55 : 0.22;
        ctx.fillText(glyph, x, y);
        if (y > height && Math.random() > 0.975) drops[i] = 0;
        else drops[i] += 1;
      }
      ctx.globalAlpha = 1;
    }

    function frame(now) {
      if (!running) return;
      raf = window.requestAnimationFrame(frame);
      if (now - last < FRAME_MS) return;
      last = now;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      if (columns !== Math.max(1, Math.floor(rect.width / FONT_SIZE))) resize();
      paint(rect.width, rect.height);
    }

    return {
      start() {
        if (running) return;
        if (!resize()) return;
        running = true;
        raf = window.requestAnimationFrame(frame);
      },
      stop() {
        running = false;
        if (raf) window.cancelAnimationFrame(raf);
        raf = 0;
        const rect = canvas.getBoundingClientRect();
        if (rect.width && rect.height) {
          ctx.clearRect(0, 0, rect.width, rect.height);
        }
      },
      // Paint exactly one frame, independent of requestAnimationFrame. Rigs
      // run in background tabs where rAF never fires, so without this there
      // is no way to prove the rain actually draws anything.
      renderOnce() {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return false;
        if (!drops.length && !resize()) return false;
        paint(rect.width, rect.height);
        return true;
      },
      resize,
      setAccent(hex) { accent = hex; },
      isRunning: () => running,
    };
  }

  // Renders the log into a list element. Appends only what's new, so a busy
  // console doesn't rebuild hundreds of rows every tick.
  function createView(listEl) {
    let renderedId = 0;

    function atBottom() {
      return listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 40;
    }

    return {
      render(lines) {
        const T = window.JarvisTerminal;
        // A clear() rewinds nothing but the array; if the oldest line we have
        // is newer than what we drew, history was dropped — start over.
        if (!lines.length || (lines[0].id > renderedId + 1 && renderedId !== 0)) {
          listEl.replaceChildren();
          renderedId = 0;
        }
        const stick = atBottom();
        for (const line of lines) {
          if (line.id <= renderedId) continue;
          const row = document.createElement('div');
          row.className = `term-line term-${line.stream}`;

          const time = document.createElement('span');
          time.className = 'term-time';
          time.textContent = T.formatClock(line.at);

          const tag = document.createElement('span');
          tag.className = 'term-tag';
          tag.textContent = T.streamLabel(line.stream);

          const text = document.createElement('span');
          text.className = 'term-text';
          text.textContent = line.text;

          row.append(time, tag, text);
          listEl.appendChild(row);
          renderedId = line.id;
        }
        if (stick) listEl.scrollTop = listEl.scrollHeight;
      },
      reset() {
        listEl.replaceChildren();
        renderedId = 0;
      },
    };
  }

  const api = { createRain, createView, FONT_SIZE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.JarvisTerminalUI = api;
})();
