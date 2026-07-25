// How see-through the windows are. One setting, three steps, so the orb can
// show through the furniture as much or as little as you want.
// Dual export like skins.js / settings-tabs.js: node:test requires it, the
// browser loads it as a classic <script> and reads window.JarvisGlass.
(function () {
  const GLASS_LEVELS = [
    { id: 'solid', label: 'SOLID · WINDOWS STAY OPAQUE' },
    { id: 'glass', label: 'GLASS · SEE JARVIS THROUGH THEM' },
    { id: 'ghost', label: 'GHOST · BARELY THERE' }
  ];

  function normalizeGlass(id) {
    return GLASS_LEVELS.some((level) => level.id === id) ? id : 'glass';
  }

  const api = { GLASS_LEVELS, normalizeGlass };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.JarvisGlass = api;
})();
