// Settings → CALLS: turning the line on, and the one-time pairing dance.
// Both halves live here — show-a-code (this PC is the parent side) and
// type-the-code (this PC pairs to the one showing it). Self-contained IIFE
// in the cameras-ui.js mold: owns its DOM ids, wires itself, needs nothing
// from renderer.js beyond the checkbox living in the settings save list.
(() => {
  const pairStart = document.getElementById('call-pair-start');
  const pairCode = document.getElementById('call-pair-code');
  const claimHost = document.getElementById('call-claim-host');
  const claimCode = document.getElementById('call-claim-code');
  const claimGo = document.getElementById('call-claim-go');
  const unpair = document.getElementById('call-unpair');
  const status = document.getElementById('call-settings-status');
  if (!pairStart || !window.jarvis?.call) return;

  async function refresh() {
    const s = await window.jarvis.call.status();
    if (!s.server.running) status.textContent = s.server.reason || 'Calls are off.';
    else if (s.paired) status.textContent = `Paired with ${s.peerName}. Line is up on ${s.server.address}.`;
    else status.textContent = `Line is up on ${s.server.address}, waiting to be paired.`;
  }

  pairStart.addEventListener('click', async () => {
    const result = await window.jarvis.call.pairStart();
    pairCode.textContent = result.ok
      ? `Code ${result.code} — type it on the other PC within 2 minutes. This PC is ${result.address}.`
      : result.reason;
  });

  claimGo.addEventListener('click', async () => {
    status.textContent = 'Pairing…';
    const result = await window.jarvis.call.pairClaim(claimHost.value, claimCode.value);
    status.textContent = result.ok ? `Paired with ${result.peerName}.` : result.reason;
    if (result.ok) { claimHost.value = ''; claimCode.value = ''; }
  });

  unpair.addEventListener('click', async () => {
    await window.jarvis.call.unpair();
    pairCode.textContent = '';
    refresh();
  });

  window.jarvis.call.onEvent((event) => {
    if (event.type === 'paired' || event.type === 'server-status') refresh();
  });
  refresh();
})();
