'use strict';

// The STOP window: shows the current step in plain English and offers one
// action. The click is the only input this window will ever send.
document.getElementById('stop').addEventListener('click', () => {
  window.driveStop.stop();
});

window.driveStop.onStep(({ text }) => {
  document.getElementById('step').textContent = String(text || '…');
});

// Escape works here too — same effect as the button.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
    window.driveStop.stop();
  }
});
