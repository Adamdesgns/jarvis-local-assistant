// Last-resort safety net: anything that escapes every try/catch in this
// window is reported to the main-process crash log instead of vanishing.
// Guarded like renderer.js: harmless if this file is ever required by tests.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    window.jarvis.reportError({
      source: 'widget',
      message: event.message,
      stack: event.error ? event.error.stack : `${event.filename}:${event.lineno}:${event.colno}`
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    window.jarvis.reportError({
      source: 'widget',
      name: reason && reason.name,
      message: (reason && reason.message) || String(reason),
      stack: reason && reason.stack
    });
  });
}

const orb = document.getElementById('orb');
const label = document.getElementById('orb-label');

// The minimize orb wears the chosen soul: the shared orb engine renders onto a
// canvas inside the button. 'original' — or any skin this window doesn't load —
// resolves to null, and the classic CSS ball stays. body.engine flags which
// mode is active so the CSS can hide the ball under a live canvas.
class WidgetOrbHost {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'ready';
    this.skinName = null;
    this.instance = null;
  }

  // A canvas can only ever hold one context type (2d vs WebGL), so every skin
  // change gets a fresh canvas with the same id/class — same rule as OrbHost.
  freshCanvas() {
    const fresh = this.canvas.cloneNode(false);
    this.canvas.replaceWith(fresh);
    this.canvas = fresh;
  }

  applyPrefs(prefs = {}) {
    const engine = window.OrbEngine;
    const resolved = engine ? engine.resolveExact(prefs.orbSkin) : null;
    if (!resolved) {
      if (this.instance) {
        if (this.instance.destroy) this.instance.destroy();
        this.instance = null;
        this.skinName = null;
        this.freshCanvas(); // drop the retired skin's last frame
      }
      document.body.classList.remove('engine');
      return;
    }
    document.body.classList.add('engine'); // before create, so the canvas has real layout to measure
    if (resolved.name !== this.skinName) {
      if (this.instance && this.instance.destroy) this.instance.destroy();
      this.freshCanvas();
      this.skinName = resolved.name;
      this.instance = resolved.create(this.canvas);
    }
    if (this.instance.setPalette) this.instance.setPalette(engine.normalizePalette(prefs.orbColor));
    this.instance.setState(this.state);
  }

  setState(state) {
    this.state = state || 'ready';
    if (this.instance) this.instance.setState(this.state);
  }
}

const orbHost = new WidgetOrbHost(document.getElementById('orb-canvas'));

function setState(payload = {}) {
  const state = payload.state || 'ready';
  // Keep any pop-* animation classes alive through state changes.
  const pops = [...orb.classList].filter((name) => name.startsWith('pop-'));
  orb.className = ['orb', state === 'exploding' ? 'searching' : state, ...pops].join(' ');
  label.textContent = state === 'exploding' ? 'SEARCHING' : state.toUpperCase();
  orbHost.setState(state); // skins map raw app states to moods themselves
}

// Drag anywhere to move; a press that barely moves counts as a click and opens
// JARVIS. Main process tracks the actual cursor, so we only report the gesture.
const CLICK_SLOP_PX = 5;
let pressed = false;
let moved = false;
let startX = 0;
let startY = 0;
let moveQueued = false;

const inZoom = () => document.body.classList.contains('zoom-mode');

document.body.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  // Mid-swell a click backs out to the normal orb (escape hatch), never drags.
  if (inZoom()) { window.jarvis.widgetZoomAbort(); return; }
  pressed = true;
  moved = false;
  startX = event.screenX;
  startY = event.screenY;
  document.body.setPointerCapture(event.pointerId);
  window.jarvis.widgetDragStart();
});

document.body.addEventListener('pointermove', (event) => {
  if (!pressed) return;
  if (!moved && Math.hypot(event.screenX - startX, event.screenY - startY) < CLICK_SLOP_PX) return;
  moved = true;
  if (moveQueued) return;
  moveQueued = true;
  requestAnimationFrame(() => { moveQueued = false; if (pressed) window.jarvis.widgetDragMove(); });
});

document.body.addEventListener('pointerup', () => {
  if (!pressed) return;
  pressed = false;
  window.jarvis.widgetDragEnd();
  if (!moved) window.jarvis.restoreMain();
});

// Scroll over the orb to resize it.
document.body.addEventListener('wheel', (event) => {
  event.preventDefault();
  window.jarvis.widgetResize(event.deltaY < 0 ? 1 : -1);
}, { passive: false });

orb.addEventListener('contextmenu', (event) => { event.preventDefault(); window.jarvis.restoreMain(); });
// Easter egg. Growth phase 2 is the fullscreen swell: the user scrolls to zoom
// the orb (main.js drives the factor) until the white core nearly leaves the
// screen, then it detonates — flash, shockwave, and vaporizing debris. Vanish
// shrinks to nothing in place. Either way it respawns bottom-right.
function spawnDebris() {
  const box = document.getElementById('debris');
  box.replaceChildren();
  for (let index = 0; index < 30; index += 1) {
    const spark = document.createElement('i');
    spark.style.setProperty('--a', `${Math.round(Math.random() * 360)}deg`);
    spark.style.setProperty('--d', `${Math.round(45 + Math.random() * 65)}vmin`);
    spark.style.setProperty('--s', `${(4 + Math.random() * 10).toFixed(1)}px`);
    spark.style.setProperty('--t', `${(0.55 + Math.random() * 0.45).toFixed(2)}s`);
    box.appendChild(spark);
  }
}

window.jarvis.onWidgetZoom?.((payload) => {
  if (payload && payload.entering) document.body.classList.add('zoom-mode');
  orb.style.setProperty('--zoom', String((payload && payload.zoom) || 1));
});
window.jarvis.onWidgetZoomExit?.(() => {
  document.body.classList.remove('zoom-mode');
  orb.style.removeProperty('--zoom');
});
window.jarvis.onWidgetPop?.((payload) => {
  const kind = payload && payload.kind ? payload.kind : payload;
  if (kind === 'vanish') { orb.classList.add('pop-vanish'); return; }
  // Explode: the user already swelled it to fullscreen — go straight to the blast.
  spawnDebris();
  document.body.classList.add('pop-fx', 'pop-boom');
});
window.jarvis.onWidgetPopReset?.(() => {
  document.body.classList.remove('pop-fx', 'pop-boom', 'zoom-mode');
  orb.classList.remove('pop-vanish');
  orb.style.removeProperty('--zoom');
  document.getElementById('debris').replaceChildren();
  orb.classList.add('pop-in');
  setTimeout(() => orb.classList.remove('pop-in'), 600);
});
// Match the orb's colour to the active skin (amber Classic / cyan Command Center).
window.jarvis.onSkin?.((skin) => { document.body.dataset.skin = skin || 'classic'; });
// Wear the chosen orb soul, now and whenever Settings changes it.
window.jarvis.orbPrefs?.().then((prefs) => orbHost.applyPrefs(prefs || {}));
window.jarvis.onOrbPrefs?.((prefs) => orbHost.applyPrefs(prefs || {}));
window.jarvis.onWakeDetected(() => setState({ state: 'listening' }));
window.jarvis.onUIState(setState);
window.jarvis.onFileStart(() => setState({ state: 'exploding' }));
window.jarvis.onFileComplete(() => setTimeout(() => setState({ state: 'ready' }), 1200));
