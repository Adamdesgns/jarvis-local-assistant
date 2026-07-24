// Orb skin registry + pure state/palette helpers. Dual export like skins.js:
// node:test requires it via module.exports; the browser loads it as a classic
// <script> and reads window.OrbEngine (a shared instance skins register into).
(function () {
  const PALETTES = ['gold', 'obsidian'];

  // App states (renderer setCoreState) → the three moods every skin renders.
  const MOOD_MAP = {
    ready: { mood: 'idle', dim: false },
    listening: { mood: 'listening', dim: false },
    speaking: { mood: 'listening', dim: false },
    processing: { mood: 'thinking', dim: false },
    exploding: { mood: 'thinking', dim: false },
    error: { mood: 'idle', dim: true },
    offline: { mood: 'idle', dim: true }
  };

  class OrbEngine {
    constructor() {
      this.skins = new Map();
    }

    register(name, skin) {
      this.skins.set(name, { name, label: skin.label || name, create: skin.create });
    }

    list() {
      return [...this.skins.values()];
    }

    resolve(name) {
      if (this.skins.has(name)) return this.skins.get(name);
      return this.list()[0] || null;
    }

    mapStateToMood(state) {
      return MOOD_MAP[state] || { mood: 'idle', dim: false };
    }

    normalizePalette(name) {
      return PALETTES.includes(name) ? name : 'gold';
    }
  }

  const api = { OrbEngine, PALETTES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.OrbEngine = new OrbEngine();
})();
