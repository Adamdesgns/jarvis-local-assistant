/* Module layout engine: drag anywhere, resize from 8 directions, keep modules
   inside the workspace, bring-to-front, and place new modules in open space.
   Loaded in the renderer before renderer.js; pure helpers export for tests. */
(function (root) {
  const MIN_W = 18;
  const MIN_H = 22;
  const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

  function clampRect(rect) {
    const w = Math.max(MIN_W, Math.min(100, rect.w));
    const h = Math.max(MIN_H, Math.min(100, rect.h));
    return {
      ...rect,
      w,
      h,
      x: Math.max(0, Math.min(100 - w, rect.x)),
      y: Math.max(0, Math.min(100 - h, rect.y))
    };
  }

  function resizeRect(start, edge, dx, dy) {
    let { x, y, w, h } = start;
    if (edge.includes('e')) w = start.w + dx;
    if (edge.includes('s')) h = start.h + dy;
    if (edge.includes('w')) { w = start.w - dx; x = start.x + dx; }
    if (edge.includes('n')) { h = start.h - dy; y = start.y + dy; }
    if (w < MIN_W) { if (edge.includes('w')) x -= MIN_W - w; w = MIN_W; }
    if (h < MIN_H) { if (edge.includes('n')) y -= MIN_H - h; h = MIN_H; }
    return clampRect({ ...start, x, y, w, h });
  }

  function overlapArea(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  }

  function findOpenSpace(size, occupied) {
    let best = { x: 2, y: 6 };
    let bestOverlap = Infinity;
    for (let y = 2; y <= 100 - size.h; y += 6) {
      for (let x = 2; x <= 100 - size.w; x += 6) {
        const candidate = { x, y, w: size.w, h: size.h };
        const total = occupied.reduce((sum, rect) => sum + overlapArea(candidate, rect), 0);
        if (total < bestOverlap) { bestOverlap = total; best = { x, y }; }
        if (total === 0) return { x, y };
      }
    }
    return best;
  }

  function nextZ(layout) {
    return 1 + Math.max(0, ...Object.values(layout).map((rect) => Number(rect?.z) || 0));
  }

  function createEngine({ layer, layout, apply, save, onFront }) {
    let frame = 0;
    const schedule = (name) => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; apply(name); });
    };

    function bringToFront(name) {
      layout[name].z = nextZ(layout);
      apply(name);
      save();
      if (onFront) onFront(name);
    }

    function track(handle, name, begin) {
      handle.addEventListener('pointerdown', (event) => {
        if (event.target.closest('button, input, select, textarea')) return;
        const bounds = layer.getBoundingClientRect();
        const start = { pointerX: event.clientX, pointerY: event.clientY, ...layout[name] };
        const edge = begin(event);
        if (edge === null) return;
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        const move = (moveEvent) => {
          const dx = (moveEvent.clientX - start.pointerX) / bounds.width * 100;
          const dy = (moveEvent.clientY - start.pointerY) / bounds.height * 100;
          const next = edge
            ? resizeRect(start, edge, dx, dy)
            : clampRect({ ...start, x: start.x + dx, y: start.y + dy });
          Object.assign(layout[name], { x: next.x, y: next.y, w: next.w, h: next.h });
          schedule(name);
        };
        const up = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          save();
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
      });
    }

    function attach(module) {
      const name = module.dataset.module;
      module.addEventListener('pointerdown', () => bringToFront(name), true);
      const header = module.querySelector('.drag-handle');
      if (header) track(header, name, () => '');
      module.querySelector('.resize-handle')?.remove();
      for (const edge of EDGES) {
        const grip = document.createElement('i');
        grip.className = `edge-grip edge-${edge}`;
        module.append(grip);
        track(grip, name, () => edge);
      }
    }

    function place(name, size) {
      const occupied = Object.entries(layout)
        .filter(([key]) => key !== name)
        .map(([, rect]) => rect);
      const spot = findOpenSpace(size, occupied);
      layout[name] = clampRect({ ...size, ...spot, z: nextZ(layout) });
      apply(name);
      save();
    }

    return { attach, place, bringToFront };
  }

  const api = { MIN_W, MIN_H, clampRect, resizeRect, overlapArea, findOpenSpace, nextZ, createEngine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JarvisLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);
