const orb = document.getElementById('orb');
const label = document.getElementById('orb-label');

function setState(payload = {}) {
  const state = payload.state || 'ready';
  orb.className = `orb ${state === 'exploding' ? 'searching' : state}`;
  label.textContent = state === 'exploding' ? 'SEARCHING' : state.toUpperCase();
}

orb.addEventListener('click', () => window.jarvis.restoreMain());
orb.addEventListener('contextmenu', (event) => { event.preventDefault(); window.jarvis.restoreMain(); });
// Match the orb's colour to the active skin (amber Classic / cyan Command Center).
window.jarvis.onSkin?.((skin) => { document.body.dataset.skin = skin || 'classic'; });
window.jarvis.onWakeDetected(() => setState({ state: 'listening' }));
window.jarvis.onUIState(setState);
window.jarvis.onFileStart(() => setState({ state: 'exploding' }));
window.jarvis.onFileComplete(() => setTimeout(() => setState({ state: 'ready' }), 1200));
