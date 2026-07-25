// THE TERMINAL, stage 1 — the console's brain.
//
// Stage 1 is a JARVIS console, not a shell: it shows what JARVIS is doing
// (your commands, his replies, agent steps, activity, the night shift) and
// anything you type goes down the same pipeline as the command bar. Raw
// Windows commands are stage 2 — see docs/ROADMAP.md.
//
// Dual export like skins.js / glass.js / settings-tabs.js: node:test requires
// it, the browser loads it as a classic <script> and reads window.JarvisTerminal.
(function () {
  const STREAMS = [
    { id: 'you', label: 'YOU' },
    { id: 'jarvis', label: 'JARVIS' },
    { id: 'agent', label: 'AGENT' },
    { id: 'activity', label: 'LOG' },
    { id: 'night', label: 'NIGHT' },
    { id: 'system', label: 'SYS' },
  ];

  const DEFAULT_LIMIT = 300;

  function normalizeStream(id) {
    return STREAMS.some((s) => s.id === id) ? id : 'system';
  }

  function streamLabel(id) {
    const found = STREAMS.find((s) => s.id === id);
    return found ? found.label : 'SYS';
  }

  const pad = (n) => String(n).padStart(2, '0');

  function formatClock(date) {
    const d = date instanceof Date ? date : new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  // A capped, append-only log. Ids never restart — the view keys rows on them,
  // and reused ids would make it recycle the wrong DOM node after a clear.
  function createLog(limit = DEFAULT_LIMIT) {
    const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_LIMIT;
    let entries = [];
    let nextId = 1;

    function push(stream, text, at) {
      const raw = text == null ? '' : String(text);
      // One entry per line: a multi-line reply should scroll like a console,
      // not arrive as one unreadable block.
      const parts = raw.split('\n').map((s) => s.trim()).filter(Boolean);
      const when = at instanceof Date ? at : new Date();
      const kind = normalizeStream(stream);
      for (const part of parts) {
        entries.push({ id: nextId++, at: when, stream: kind, text: part });
      }
      if (entries.length > cap) entries = entries.slice(entries.length - cap);
      return entries.length;
    }

    return {
      push,
      lines: () => entries.slice(),
      clear: () => { entries = []; },
      size: () => entries.length,
    };
  }

  // The console wears whichever colourway the orb is wearing. Both values are
  // real tokens from tokens.css — don't invent a third here.
  function accentFor(orbColor) {
    return orbColor === 'obsidian' ? '#61efb2' : '#ffb21f';
  }

  // Words that are unmistakably shell and never ordinary English. Anything
  // ambiguous (type, copy, move, echo, del, ping) is deliberately absent —
  // "type hello into notepad" and "move the invoices" are things JARVIS
  // genuinely does, and stealing them would break the assistant.
  const SHELL_WORDS = new Set([
    'dir', 'ls', 'cls', 'clear', 'cd', 'pwd', 'ipconfig', 'whoami', 'netstat',
    'systeminfo', 'tasklist', 'taskkill', 'npm', 'npx', 'git', 'node', 'python',
    'pip', 'powershell', 'pwsh', 'cmd', 'winget', 'chmod', 'sudo', 'curl', 'wget',
  ]);

  const SHELL_MESSAGE =
    'Raw commands arrive in stage 2. For now, ask me in plain English and I\'ll do it properly.';

  function shellHint(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return null;
    const first = trimmed.split(/\s+/)[0].toLowerCase();
    return SHELL_WORDS.has(first) ? SHELL_MESSAGE : null;
  }

  const api = {
    STREAMS,
    DEFAULT_LIMIT,
    normalizeStream,
    streamLabel,
    formatClock,
    createLog,
    accentFor,
    shellHint,
    SHELL_MESSAGE,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.JarvisTerminal = api;
})();
