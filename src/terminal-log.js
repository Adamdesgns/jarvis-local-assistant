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
    // Stage 2: raw output from a command the user ran themselves. Its own
    // stream so console output never reads as something JARVIS said.
    { id: 'shell', label: 'SH' },
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

    // Windows admin binaries. Nobody says these in English, and every one of
    // them is on command-guard's deny list — so without them here the console
    // hands "vssadmin delete shadows" to the assistant as conversation and the
    // refusal the guard exists to give never appears.
    'diskpart', 'bcdedit', 'fsutil', 'vssadmin', 'wbadmin', 'regedit', 'reg',
    'schtasks', 'icacls', 'takeown', 'wevtutil', 'netsh', 'msconfig',
    'certutil', 'mshta', 'rundll32', 'regsvr32', 'runas', 'sc',
  ]);

  // Deliberately NOT shell words: 'format', 'shutdown', 'net'. "format this
  // document", "shutdown the computer at ten" and "net me a coffee" are things
  // a person says to an assistant. These shapes are not — they carry a drive
  // letter or a switch that ordinary English never does.
  const COMMAND_SHAPES = [
    /^format\s+[a-z]:/i,
    /^shutdown\s+[-/]/i,
    /^net\s+(?:user|localgroup|stop|start|share)\b/i,
  ];

  // The one place that decides "is this shell or is this English". Stage 1
  // used it to refuse; stage 2 uses it to pick a pipeline. Same narrow list
  // either way — widening it steals words the assistant needs.
  function looksLikeShell(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return false;
    const first = trimmed.split(/\s+/)[0].toLowerCase();
    if (SHELL_WORDS.has(first)) return true;
    return COMMAND_SHAPES.some((shape) => shape.test(trimmed));
  }

  const api = {
    STREAMS,
    DEFAULT_LIMIT,
    normalizeStream,
    streamLabel,
    formatClock,
    createLog,
    accentFor,
    looksLikeShell,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.JarvisTerminal = api;
})();
