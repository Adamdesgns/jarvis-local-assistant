// The pure half of "he comes alive": JARVIS's own voice drives the orb and
// captions his words below the sphere while he speaks. Dual export like
// settings-tabs.js — node:test requires it; the browser loads it as a classic
// <script> and reads window.OrbVoice. The renderer owns the WebAudio wiring;
// nothing in here touches a DOM or an AudioContext.
(function () {
  // Byte time-domain samples (0..255, 128 = silence) -> orb audio level.
  // Same curve as the microphone path in renderer.js (RMS * 9, clamped), so
  // the orb moves to his voice exactly the way it moves to yours.
  function levelFromSamples(samples) {
    if (!samples || !samples.length) return 0;
    let total = 0;
    for (const sample of samples) {
      const value = (sample - 128) / 128;
      total += value * value;
    }
    return Math.min(1, Math.sqrt(total / samples.length) * 9);
  }

  // Playback progress (0..1) -> the words spoken so far, never cutting a
  // word in half. Proportional reveal: Kokoro hands us a finished WAV, not
  // word timings, and evenly-paced words track his cadence closely enough
  // to read as live captions.
  function captionSlice(text, progress) {
    const spoken = String(text || '');
    if (!spoken) return '';
    const clamped = Math.max(0, Math.min(1, Number(progress) || 0));
    if (clamped >= 1) return spoken;
    const words = spoken.split(/\s+/).filter(Boolean);
    const shown = Math.floor(words.length * clamped);
    if (!shown) return '';
    // Re-walk the original string so multiple spaces survive intact.
    let count = 0;
    const match = spoken.match(new RegExp(`^(?:\\s*\\S+){${shown}}`));
    count = match ? match[0].length : spoken.length;
    return spoken.slice(0, count);
  }

  // speechSynthesis onboundary charIndex -> text through the end of the word
  // being spoken. The system-voice fallback gets real word timings for free.
  function boundarySlice(text, charIndex) {
    const spoken = String(text || '');
    if (!spoken) return '';
    const index = Math.max(0, Math.min(spoken.length, Number(charIndex) || 0));
    const nextBreak = spoken.indexOf(' ', index);
    return nextBreak === -1 ? spoken : spoken.slice(0, nextBreak);
  }

  const api = { levelFromSamples, captionSlice, boundarySlice };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.OrbVoice = api;
})();
