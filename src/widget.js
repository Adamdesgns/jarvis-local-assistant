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

document.body.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
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
// Easter egg: past either size limit the orb pops (explode/vanish), then
// respawns bottom-right — main.js runs the timing, we just play the theatre.
window.jarvis.onWidgetPop?.((kind) => {
  orb.classList.add(kind === 'explode' ? 'pop-explode' : 'pop-vanish');
});
window.jarvis.onWidgetPopReset?.(() => {
  orb.classList.remove('pop-explode', 'pop-vanish');
  orb.classList.add('pop-in');
  setTimeout(() => orb.classList.remove('pop-in'), 600);
});
// Match the orb's colour to the active skin (amber Classic / cyan Command Center).
window.jarvis.onSkin?.((skin) => { document.body.dataset.skin = skin || 'classic'; });
window.jarvis.onWakeDetected(() => setState({ state: 'listening' }));
window.jarvis.onUIState(setState);
window.jarvis.onFileStart(() => setState({ state: 'exploding' }));
window.jarvis.onFileComplete(() => setTimeout(() => setState({ state: 'ready' }), 1200));
