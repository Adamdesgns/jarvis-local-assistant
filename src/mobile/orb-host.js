// Mobile orb host — self-contained. Creates the orb inside #orb-stage, keeps
// its mood in sync by observing the page's existing signals (#agent-status
// visibility = thinking, mic button's .recording = listening), follows the
// desktop's skin/color via /api/orb-prefs, and owns the tap-to-open picker
// sheet. mobile.js needs no changes beyond the script include.
(function () {
  const SKIN_KEY = 'jarvis-orb-skin';
  const COLOR_KEY = 'jarvis-orb-color';
  let host = null;

  class MobileOrbHost {
    constructor(stage) {
      this.stage = stage;
      this.state = 'ready';
      this.skin = 'original';
      this.color = 'gold';
      this.canvas = null;
      this.instance = null;
      this.desktop = { orbSkin: 'original', orbColor: 'gold' };
    }

    apply({ skin, color }) {
      const engine = window.OrbEngine;
      if (!engine) return;
      if (color !== undefined) this.color = engine.normalizePalette(color);
      const resolved = engine.resolve(skin === undefined ? this.skin : skin);
      if (resolved && (!this.instance || resolved.name !== this.skin)) {
        if (this.instance && this.instance.destroy) this.instance.destroy();
        const fresh = document.createElement('canvas');
        fresh.className = 'orb-canvas';
        fresh.setAttribute('aria-label', 'JARVIS orb');
        if (this.canvas) this.canvas.replaceWith(fresh);
        else this.stage.prepend(fresh);
        this.canvas = fresh;
        this.skin = resolved.name;
        this.instance = resolved.create(fresh);
      }
      if (!this.instance) return;
      if (this.instance.setPalette) this.instance.setPalette(this.color);
      this.instance.setState(this.state);
    }

    setState(state) {
      if (state === this.state) return;
      this.state = state;
      if (this.instance) this.instance.setState(state);
    }
  }

  function chosen() {
    return {
      skin: localStorage.getItem(SKIN_KEY) || host.desktop.orbSkin,
      color: localStorage.getItem(COLOR_KEY) || host.desktop.orbColor
    };
  }

  async function loadDesktopPrefs() {
    const key = localStorage.getItem('jarvis-mobile-key');
    if (!key) return;
    try {
      const res = await fetch('/api/orb-prefs', { headers: { Authorization: `Bearer ${key}` } });
      if (!res.ok) return;
      const prefs = await res.json();
      host.desktop = { orbSkin: prefs.orbSkin || 'original', orbColor: prefs.orbColor || 'gold' };
      const pick = chosen();
      host.apply({ skin: pick.skin, color: pick.color });
    } catch {
      // Offline is fine — the orb just keeps its current look.
    }
  }

  // --- picker sheet (built here so index.html stays lean) ---
  function buildSheet() {
    const sheet = document.createElement('div');
    sheet.id = 'orb-sheet';
    sheet.className = 'orb-sheet';
    sheet.hidden = true;
    const card = document.createElement('div');
    card.className = 'card stack orb-sheet-card';

    const title = document.createElement('p');
    title.className = 'text-dim';
    title.textContent = 'Choose your JARVIS';
    card.append(title);

    const skinRow = document.createElement('div');
    skinRow.className = 'chip-row';
    for (const skin of (window.OrbEngine ? window.OrbEngine.list() : [])) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.skin = skin.name;
      chip.textContent = skin.label;
      chip.addEventListener('click', () => {
        localStorage.setItem(SKIN_KEY, skin.name);
        host.apply({ skin: skin.name });
        highlight();
      });
      skinRow.append(chip);
    }
    card.append(skinRow);

    const colorRow = document.createElement('div');
    colorRow.className = 'chip-row';
    for (const color of ['gold', 'obsidian']) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.color = color;
      chip.textContent = color === 'gold' ? 'Gold' : 'Obsidian';
      chip.addEventListener('click', () => {
        localStorage.setItem(COLOR_KEY, color);
        host.apply({ color });
        highlight();
      });
      colorRow.append(chip);
    }
    card.append(colorRow);

    const match = document.createElement('button');
    match.type = 'button';
    match.className = 'btn btn-secondary btn-block';
    match.textContent = 'Match the desktop';
    match.addEventListener('click', () => {
      localStorage.removeItem(SKIN_KEY);
      localStorage.removeItem(COLOR_KEY);
      host.apply({ skin: host.desktop.orbSkin, color: host.desktop.orbColor });
      highlight();
    });
    card.append(match);

    sheet.append(card);
    sheet.addEventListener('click', (event) => { if (event.target === sheet) sheet.hidden = true; });
    document.body.append(sheet);

    function highlight() {
      const pick = chosen();
      sheet.querySelectorAll('[data-skin]').forEach((chip) => chip.classList.toggle('active', chip.dataset.skin === pick.skin));
      sheet.querySelectorAll('[data-color]').forEach((chip) => chip.classList.toggle('active', chip.dataset.color === pick.color));
    }
    sheet.show = () => { highlight(); sheet.hidden = false; };
    return sheet;
  }

  window.addEventListener('DOMContentLoaded', () => {
    const stage = document.getElementById('orb-stage');
    if (!stage || !window.OrbEngine) return;
    host = new MobileOrbHost(stage);
    const pick = chosen();
    host.apply({ skin: pick.skin, color: pick.color });
    loadDesktopPrefs();

    const sheet = buildSheet();
    stage.addEventListener('click', () => sheet.show());

    // Mood sync from the page's own signals — no chat-code changes needed.
    const status = document.getElementById('agent-status');
    if (status) {
      new MutationObserver(() => {
        host.setState(status.hidden ? 'ready' : 'processing');
      }).observe(status, { attributes: true, attributeFilter: ['hidden'] });
    }
    const mic = document.getElementById('mic-btn');
    if (mic) {
      new MutationObserver(() => {
        if (mic.classList.contains('recording')) host.setState('listening');
        else if (status && status.hidden) host.setState('ready');
      }).observe(mic, { attributes: true, attributeFilter: ['class'] });
    }
    // Re-check desktop prefs whenever pairing completes (body leaves 'pairing').
    new MutationObserver(() => {
      if (!document.body.classList.contains('pairing')) loadDesktopPrefs();
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  });
})();
