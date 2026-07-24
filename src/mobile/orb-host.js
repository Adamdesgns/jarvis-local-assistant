// Orb home controller — the orb IS the mobile app's front door.
// Tap: talk to JARVIS (tap again to send). Double-tap: open the console
// (chat/cameras/send). Press-and-hold: choose your JARVIS (skin + color).
// Also keeps the orb's mood in sync and follows the desktop's skin choice
// via /api/orb-prefs. Loads before mobile.js; both share the global scope,
// so window.show / window.renderReply are available at interaction time.
(function () {
  const SKIN_KEY = 'jarvis-orb-skin';
  const COLOR_KEY = 'jarvis-orb-color';
  const TAP_WINDOW_MS = 280;
  const HOLD_MS = 600;
  const DEFAULT_HINT = 'Tap to speak  ·  double-tap to open';
  let host = null;
  let voiceActive = false;

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
      // Offline is fine — the orb keeps its current look.
    }
  }

  // --- home status line ---
  function setHint(text, { revertMs = 0 } = {}) {
    const el = document.getElementById('home-status');
    if (!el) return;
    el.textContent = text;
    clearTimeout(setHint._t);
    if (revertMs) setHint._t = setTimeout(() => { el.textContent = DEFAULT_HINT; }, revertMs);
  }

  function showHomeReply(text) {
    const el = document.getElementById('home-reply');
    if (!el || !text) return;
    el.textContent = text.length > 220 ? `${text.slice(0, 220)}…` : text;
    el.hidden = false;
    clearTimeout(showHomeReply._t);
    showHomeReply._t = setTimeout(() => { el.hidden = true; }, 14000);
  }

  // --- tap-to-talk (toggle) ---
  let recorder = null;
  let recChunks = [];

  async function startVoice() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recChunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (ev) => recChunks.push(ev.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recChunks, { type: recorder.mimeType || 'audio/mp4' });
        recorder = null;
        if (blob.size < 1000) { voiceActive = false; host.setState('ready'); setHint(DEFAULT_HINT); return; }
        host.setState('processing');
        setHint('Thinking…');
        try {
          const key = localStorage.getItem('jarvis-mobile-key');
          const res = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': blob.type, Authorization: `Bearer ${key}` }, body: blob });
          if (res.status === 401) { localStorage.removeItem('jarvis-mobile-key'); voiceActive = false; return window.show?.('pairing'); }
          const out = await res.json().catch(() => ({}));
          if (!res.ok || out.error || !out.reply) {
            setHint(out.error || 'JARVIS hit a snag — try again.', { revertMs: 4000 });
          } else {
            if (out.transcript && window.bubble) window.bubble('you', out.transcript);
            if (window.renderReply) window.renderReply(out.reply, true);
            showHomeReply(out.reply);
            setHint(DEFAULT_HINT);
          }
        } catch {
          setHint('JARVIS is unreachable — is the PC awake?', { revertMs: 5000 });
        } finally {
          voiceActive = false;
          host.setState('ready');
        }
      };
      recorder.start();
      voiceActive = true;
      host.setState('listening');
      setHint('Listening… tap again to send');
    } catch {
      setHint('Microphone is blocked. Allow it in phone Settings.', { revertMs: 5000 });
    }
  }

  function toggleVoice() {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    else startVoice();
  }

  // --- picker sheet ---
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

  // --- gestures: tap / double-tap / press-and-hold ---
  function bindGestures(stage, sheet) {
    let tapTimer = null;
    let holdTimer = null;
    let held = false;
    let downAt = null;

    stage.addEventListener('pointerdown', (event) => {
      held = false;
      downAt = { x: event.clientX, y: event.clientY };
      holdTimer = setTimeout(() => { held = true; clearTimeout(tapTimer); tapTimer = null; sheet.show(); }, HOLD_MS);
    });
    stage.addEventListener('pointermove', (event) => {
      if (downAt && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 12) clearTimeout(holdTimer);
    });
    const cancelHold = () => clearTimeout(holdTimer);
    stage.addEventListener('pointercancel', cancelHold);
    stage.addEventListener('pointerleave', cancelHold);
    stage.addEventListener('pointerup', () => {
      clearTimeout(holdTimer);
      if (held) return;
      if (tapTimer) {
        // Second tap inside the window: double-tap → open the console.
        clearTimeout(tapTimer);
        tapTimer = null;
        window.show?.('chat');
        return;
      }
      tapTimer = setTimeout(() => {
        tapTimer = null;
        toggleVoice();
      }, TAP_WINDOW_MS);
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    const stage = document.getElementById('orb-stage');
    if (!stage || !window.OrbEngine) return;
    host = new MobileOrbHost(stage);
    const pick = chosen();
    host.apply({ skin: pick.skin, color: pick.color });
    loadDesktopPrefs();

    const sheet = buildSheet();
    bindGestures(stage, sheet);

    // Mood sync from the console's own signals (ignored mid-voice — the
    // home voice flow drives the orb directly while it owns the mic).
    const status = document.getElementById('agent-status');
    if (status) {
      new MutationObserver(() => {
        if (!voiceActive) host.setState(status.hidden ? 'ready' : 'processing');
      }).observe(status, { attributes: true, attributeFilter: ['hidden'] });
    }
    const mic = document.getElementById('mic-btn');
    if (mic) {
      new MutationObserver(() => {
        if (voiceActive) return;
        if (mic.classList.contains('recording')) host.setState('listening');
        else if (status && status.hidden) host.setState('ready');
      }).observe(mic, { attributes: true, attributeFilter: ['class'] });
    }
    new MutationObserver(() => {
      if (!document.body.classList.contains('pairing')) loadDesktopPrefs();
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  });
})();
