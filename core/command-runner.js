'use strict';

// THE TERMINAL, stage 2 — running a user-typed command.
//
// Follows core/tool-service.js's precedent: spawn the comspec with an argv
// array and shell:false, so Node never interpolates a shell of its own. The
// user's text is shell script by definition, so the real boundary is
// command-guard's tier plus the cwd confinement below — not argv escaping.
//
// HARD RAIL (docs/ROADMAP.md): this is user-driven only. Nothing here is
// registered as a model-callable tool, and test/command-runner.test.js fails if
// one is ever added. The model asks JARVIS in English; only the human types
// commands.
//
// The runner re-classifies rather than trusting its caller. The renderer is
// expected to classify first and hold approve-tier commands for a confirm card,
// but a renderer bug must not become a route to `format c:`.

const { spawn } = require('node:child_process');
const path = require('node:path');

const { classifyCommand } = require('../src/command-guard.js');

// Long enough for `npm install` on a cold cache, short enough that a hung
// process gives the console back the same evening.
const DEFAULT_TIMEOUT_MS = 90000;

// Console output is for reading, not archiving. A runaway loop must not grow
// the renderer's log until the window dies.
const DEFAULT_MAX_BYTES = 256 * 1024;

function refuse(tier, reason, command) {
  return {
    refused: true,
    tier,
    reason,
    command,
    stdout: '',
    stderr: '',
    code: null,
    timedOut: false,
    truncated: false,
  };
}

function createCommandRunner({
  spawnFn = spawn,
  comspec = process.env.ComSpec || 'cmd.exe',
  isAllowed = () => false,
  defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
  defaultMaxBytes = DEFAULT_MAX_BYTES,
} = {}) {

  function run({ command, cwd, timeoutMs, maxBytes, approved } = {}) {
    const text = String(command || '').trim();
    const verdict = classifyCommand(text);

    if (!text) {
      return Promise.resolve(refuse('free', 'There was no command to run.', text));
    }
    // Deny has no card, and no amount of confirmation opens it.
    if (verdict.tier === 'deny') {
      return Promise.resolve(refuse('deny', verdict.reason, text));
    }
    // The confirm card is structural, not conventional: an approve-tier command
    // arriving without an explicit yes is refused here, so a renderer that
    // forgets to ask cannot become a silent `npm install`.
    if (verdict.tier === 'approve' && approved !== true) {
      return Promise.resolve({
        ...refuse('approve', verdict.reason, text),
        needsApproval: true,
      });
    }

    // cwd confinement. Ties to documentService.approvedRoots() in the real app,
    // injected here so the boundary is testable without a live config.
    let workingDir;
    try {
      workingDir = path.resolve(cwd || '');
    } catch {
      workingDir = '';
    }
    if (!workingDir || !isAllowed(workingDir)) {
      return Promise.resolve(refuse(
        verdict.tier,
        `I can only run commands inside your approved folders, and "${cwd}" is not one of them.`,
        text,
      ));
    }

    const cap = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : defaultMaxBytes;
    const limit = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : defaultTimeoutMs;

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let truncated = false;
      let settled = false;
      let timer = null;

      // /d skips the AutoRun registry key (HKCU\Software\Microsoft\Command
      // Processor\AutoRun), which would otherwise execute ahead of the user's
      // command. /s normalises quote handling. The command is the last element.
      const args = ['/d', '/s', '/c', text];

      let child;
      try {
        child = spawnFn(comspec, args, {
          cwd: workingDir,
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        return resolve({
          ...refuse(verdict.tier, `That command could not be started: ${error.message}`, text),
          refused: undefined,
          failed: true,
          stderr: String(error.message || error),
        });
      }

      const finish = (extra) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve({
          command: text,
          tier: verdict.tier,
          cwd: workingDir,
          stdout,
          stderr,
          truncated,
          timedOut: false,
          code: null,
          reason: '',
          ...extra,
        });
      };

      const collect = (chunk, which) => {
        const piece = chunk == null ? '' : String(chunk);
        const current = which === 'out' ? stdout : stderr;
        const room = cap - current.length;
        if (room <= 0) { truncated = true; return; }
        const slice = piece.length > room ? piece.slice(0, room) : piece;
        if (slice.length < piece.length) truncated = true;
        if (which === 'out') stdout += slice; else stderr += slice;
      };

      if (child.stdout && child.stdout.on) child.stdout.on('data', (c) => collect(c, 'out'));
      if (child.stderr && child.stderr.on) child.stderr.on('data', (c) => collect(c, 'err'));

      child.on('error', (error) => {
        finish({ failed: true, stderr: `${stderr}${error && error.message ? error.message : String(error)}` });
      });

      child.on('close', (code) => {
        finish({ code: typeof code === 'number' ? code : null });
      });

      timer = setTimeout(() => {
        // Kill first, then report. A hung process that is merely reported is
        // still holding the console.
        try { child.kill(); } catch { /* already gone */ }
        const spent = limit >= 1000 ? `${Math.round(limit / 1000)}s` : `${limit}ms`;
        finish({
          timedOut: true,
          reason: `That command took too long — over ${spent} — so I stopped it.`,
        });
      }, limit);
      if (timer && typeof timer.unref === 'function') timer.unref();
    });
  }

  return {
    run,
    defaultTimeoutMs,
    defaultMaxBytes,
  };
}

module.exports = {
  createCommandRunner,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_BYTES,
};
