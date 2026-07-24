'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn: nodeSpawn } = require('node:child_process');
const guard = require('./screen-guard');

// screen-reader — slice 1 of JARVIS's "hands": it READS the screen and reports
// what is there. It clicks nothing and types nothing. It runs a fixed PowerShell
// helper (read-screen.ps1) that walks the Windows UI Automation tree and prints
// JSON; this module spawns it the same way the Claude bridge spawns claude.exe —
// an argv array with shell:false — so nothing the user says can reach a command
// line. The helper takes no free-text argument at all.
//
// Everything the helper reports is run through screen-guard before a word of it
// is spoken or logged: a financial, sign-in, system or elevated window is
// refused outright, and password fields are stripped.

const DEFAULT_TIMEOUT_MS = 20000;

// -File runs a script by path with no command string to parse. -NoProfile keeps
// a user's PowerShell profile from changing behaviour; -NonInteractive means it
// can never sit waiting at a prompt. The script path is the only thing that
// varies and it is set by main, never by the user.
function buildArgs(scriptPath) {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', String(scriptPath)];
}

// Find powershell.exe without guessing. Windows PowerShell 5.1 ships in every
// Windows install at the System32 path; fall back to the name on PATH.
function resolvePowershell({ override, env = process.env, exists = fs.existsSync } = {}) {
  const candidates = [];
  if (override) candidates.push(override);
  const root = env.SystemRoot || env.windir || 'C:\\Windows';
  candidates.push(path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
  for (const dir of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(dir, 'powershell.exe'));
  }
  const found = candidates.find((candidate) => {
    try { return exists(candidate); } catch { return false; }
  });
  // Last resort: the bare name, which spawn resolves via PATH. Better to try
  // than to claim PowerShell is missing on a machine that clearly has it.
  return found || 'powershell.exe';
}

function describeFailure(text) {
  if (/is not recognized|cannot find path|no such file/i.test(text)) {
    return "I couldn't find the screen-reading helper on this PC.";
  }
  if (/access is denied|unauthorized/i.test(text)) {
    return "Windows wouldn't let me read the screen just now.";
  }
  return 'I ran into a problem reading the screen.';
}

class ScreenReader {
  constructor({ scriptPath, powershellPath, spawn = nodeSpawn, timeoutMs = DEFAULT_TIMEOUT_MS, log = null, onViewing = null } = {}) {
    this.scriptPath = scriptPath;
    this.spawn = spawn;
    this.timeoutMs = timeoutMs;
    this.log = log;
    // Called with true when a read starts and false when it ends, so the app
    // can show the same on-screen "viewing your screen" indicator the cloud
    // vision feature uses. A read is a privacy event even though it changes
    // nothing.
    this.onViewing = typeof onViewing === 'function' ? onViewing : null;
    this.resolvePs = () => resolvePowershell({ override: powershellPath });
  }

  async read() {
    const ps = this.resolvePs();
    if (!ps) return { ok: false, text: "I can't find PowerShell on this PC, so I can't read the screen." };

    this.#viewing(true);
    try {
      return await this.#readInner(ps);
    } finally {
      this.#viewing(false);
    }
  }

  #viewing(active) {
    try { this.onViewing?.(active); } catch { /* an indicator failure must never break a read */ }
  }

  async #readInner(ps) {
    const run = await this.#run(ps, buildArgs(this.scriptPath));
    if (!run.ok) {
      const text = run.timedOut ? 'Reading the screen took too long, so I stopped.' : describeFailure(run.stderr || run.stdout || '');
      this.log?.write?.({ type: 'screen-read', level: 'error', response: run.stderr || run.errorMessage || 'timeout', source: 'screen' });
      return { ok: false, text };
    }

    const data = this.#parse(run.stdout);
    if (!data) {
      this.log?.write?.({ type: 'screen-read', level: 'error', response: 'unreadable helper output', source: 'screen' });
      return { ok: false, text: "I looked at the screen but couldn't make sense of what came back." };
    }
    return this.#summarize(data);
  }

  #parse(stdout) {
    try {
      const payload = JSON.parse(String(stdout).trim());
      if (!payload || typeof payload !== 'object') return null;
      return payload;
    } catch {
      return null;
    }
  }

  // Turn the raw tree into one or two plain sentences suitable for speaking.
  // The guard runs here, on the foreground window, before anything is described.
  #summarize(data) {
    const fg = data.foreground;
    if (!fg || !(fg.title || fg.processName)) {
      return { ok: true, text: "I couldn't tell which window is in focus right now." };
    }

    const verdict = guard.classifyWindow(fg);
    if (!verdict.allowed) {
      // Report the category, never the contents or even the title of a denied
      // window. This is deliberately the same refusal reads and clicks share.
      this.log?.write?.({ type: 'screen-read', response: `refused: ${verdict.category} window in focus`, source: 'screen' });
      return {
        ok: true,
        blockedCategory: verdict.category,
        text: `${cap(verdict.label)} window is in focus, so I won't read what's in it. ${verdict.reason} Switch to an ordinary window and ask me again.`
      };
    }

    const app = friendlyApp(fg.processName);
    const title = cleanTitle(fg.title);
    const elements = guard.redactElements(fg.elements || []);
    const buttons = elements.filter((e) => /button|menuitem|tab|link|hyperlink/i.test(e.control) && e.name).map((e) => e.name);
    const inputs = elements.filter((e) => /edit|combobox|checkbox|radio/i.test(e.control));
    const hasPassword = elements.some((e) => e.isPassword);

    const lines = [];
    lines.push(title ? `You're looking at ${app} — ${title}.` : `You're looking at ${app}.`);

    if (elements.length) {
      const parts = [];
      if (buttons.length) parts.push(`${buttons.length} thing${buttons.length === 1 ? '' : 's'} I could point at, like ${listFew(buttons, 4)}`);
      if (inputs.length) parts.push(`${inputs.length} input field${inputs.length === 1 ? '' : 's'}`);
      if (parts.length) lines.push(`I can see ${joinAnd(parts)}.`);
      if (hasPassword) lines.push("There's a password field here, which I leave alone.");
    } else {
      lines.push("I couldn't read any named controls in it — some apps don't expose them.");
    }

    const others = summarizeOthers(data.otherWindows);
    if (others) lines.push(others);

    this.log?.write?.({ type: 'screen-read', command: 'read screen', response: `${app}${title ? ` — ${title}` : ''}`, source: 'screen' });
    return { ok: true, text: lines.join(' '), foregroundApp: app };
  }

  #run(cli, args) {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      // shell:false is the point — argv entries reach powershell.exe verbatim,
      // so there is no command line for anything to be injected into.
      const child = this.spawn(cli, args, { shell: false, windowsHide: true });
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* already gone */ }
        finish({ ok: false, timedOut: true, stdout, stderr });
      }, this.timeoutMs);
      child.stdout?.on('data', (chunk) => { stdout += chunk; });
      child.stderr?.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (error) => finish({ ok: false, stdout, stderr, errorMessage: error.message }));
      child.on('close', (code) => finish({ ok: code === 0, code, stdout, stderr }));
    });
  }
}

// Windows describes a denied window with a leading article already baked into
// the label ("a financial"), so a sentence starts with a capital of it.
function cap(text) {
  const s = String(text || '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'That';
}

function friendlyApp(processName) {
  const name = String(processName || '').toLowerCase().replace(/\.exe$/, '');
  const known = {
    explorer: 'File Explorer',
    chrome: 'Chrome',
    msedge: 'Edge',
    firefox: 'Firefox',
    notepad: 'Notepad',
    code: 'VS Code',
    winword: 'Word',
    excel: 'Excel',
    powerpnt: 'PowerPoint',
    wt: 'Windows Terminal'
  };
  return known[name] || (name ? name : 'a window');
}

function cleanTitle(title) {
  return String(title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function listFew(items, max) {
  const few = items.slice(0, max).map((s) => `"${s}"`);
  return joinAnd(few);
}

function joinAnd(items) {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// Count the other open windows, hiding the titles of any that the guard would
// deny so a bank tab in the background is never named.
function summarizeOthers(otherWindows) {
  const list = Array.isArray(otherWindows) ? otherWindows : [];
  if (!list.length) return '';
  const visible = list.filter((w) => guard.classifyWindow(w).allowed);
  const names = visible.map((w) => cleanTitle(w.title) || friendlyApp(w.processName)).filter(Boolean);
  const hidden = list.length - visible.length;
  if (!names.length && hidden) return `You also have ${hidden} other window${hidden === 1 ? '' : 's'} open that I keep private.`;
  if (!names.length) return '';
  const shown = names.slice(0, 3);
  let text = `Also open: ${joinAnd(shown)}`;
  const more = names.length - shown.length;
  if (more) text += `, and ${more} more`;
  text += '.';
  return text;
}

module.exports = { ScreenReader, buildArgs, resolvePowershell };
