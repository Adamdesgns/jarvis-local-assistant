const orb = document.getElementById('orb');
const label = document.getElementById('orb-label');

function setState(payload = {}) {
  const state = payload.state || 'ready';
  // Keep any pop-* animation classes alive through state changes.
  const pops = [...orb.classList].filter((name) => name.startsWith('pop-'));
  orb.className = ['orb', state === 'exploding' ? 'searching' : state, ...pops].join(' ');
  label.textContent = state === 'exploding' ? 'SEARCHING' : state.toUpperCase();
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
window.jarvis.onWakeDetected(() => setState({ state: 'listening' }));
window.jarvis.onUIState(setState);
window.jarvis.onFileStart(() => setState({ state: 'exploding' }));
window.jarvis.onFileComplete(() => setTimeout(() => setState({ state: 'ready' }), 1200));
