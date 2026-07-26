// THE TERMINAL, stage 2 — the console's own decision logic.
//
// renderer.js does the DOM; this module does the thinking, so the thinking can
// be tested in plain Node. Same mould as terminal-log.js and command-guard.js.
//
// NOTHING HERE IS A SECURITY CONTROL. The tier comes from command-guard.js in
// the main process, the runner re-classifies and refuses an unapproved
// approve-tier command on its own, and it re-checks cwd against the approved
// roots. This module decides what the console *shows* and where it *thinks* it
// is — if it were wrong about either, the worst case is a confusing console,
// not a command that shouldn't have run.
//
// Dual export like terminal-log.js / command-guard.js: node:test requires it,
// the browser loads it as a classic <script> and reads window.JarvisTerminalSession.
(function () {
  'use strict';

  // Resolved lazily so load order can't bite: in the browser terminal-log.js
  // is a separate <script> tag, and capturing window.JarvisTerminal at IIFE
  // time would freeze in whatever happened to exist first.
  function log() {
    if (typeof window !== 'undefined' && window.JarvisTerminal) return window.JarvisTerminal;
    return require('./terminal-log');
  }

  // Shell or English? terminal-log.js owns the word list — there must be
  // exactly one, or the console and the stage-1 hint drift apart.
  function looksLikeShell(text) {
    return log().looksLikeShell(text);
  }

  // ── cwd tracking ──────────────────────────────────────────────────────
  // Every run() spawns a fresh process, so a child's `cd` dies with it. The
  // console has to remember where it is. Windows-flavoured on purpose: this
  // app is Windows-only and path.win32 isn't available in the renderer.

  function normalize(input) {
    const text = String(input || '').replace(/\//g, '\\');

    // Keep the root intact while the segments get folded — \\server\share and
    // C: behave differently and neither survives a naive split.
    let prefix = '';
    let rest = text;
    const unc = /^\\\\[^\\]+\\[^\\]+/.exec(text);
    const drive = /^([a-z]:)/i.exec(text);
    if (unc) {
      prefix = unc[0];
      rest = text.slice(prefix.length);
    } else if (drive) {
      prefix = drive[1].toUpperCase();
      rest = text.slice(drive[0].length);
    }

    const parts = [];
    for (const segment of rest.split('\\')) {
      if (!segment || segment === '.') continue;
      // Popping an empty stack is how "cd .." at the root stays at the root
      // instead of walking off the top into nonsense.
      if (segment === '..') { parts.pop(); continue; }
      parts.push(segment);
    }
    return parts.length ? `${prefix}\\${parts.join('\\')}` : `${prefix}\\`;
  }

  function isAbsolute(text) {
    return /^[a-z]:/i.test(text) || text.startsWith('\\\\');
  }

  // Returns the directory the console should move to, or null when the command
  // isn't a cd at all. Never throws — a malformed cd should land the user back
  // where they were, not break the console.
  function resolveCd(cwd, command) {
    const match = /^cd(?:\s+(.*))?$/i.exec(String(command || '').trim());
    if (!match) return null;

    let arg = String(match[1] || '').trim();
    // cmd's drive-switch flag. Without this, `cd /d D:\Work` reads "/d" as a
    // folder name and the console quietly ends up in the wrong place.
    arg = arg.replace(/^\/d\b\s*/i, '').trim();
    if (!arg) return cwd || '';

    const quoted = /^"(.*)"$/.exec(arg) || /^'(.*)'$/.exec(arg);
    if (quoted) arg = quoted[1];
    arg = arg.replace(/\//g, '\\');
    if (!arg) return cwd || '';

    if (isAbsolute(arg)) return normalize(arg);
    return normalize(`${cwd || ''}\\${arg}`);
  }

  // ── output ────────────────────────────────────────────────────────────

  const TRUNCATED = 'Output was capped — there was more than the console will hold.';
  const STOPPED = 'Still running after the time limit, so I stopped it.';
  const SILENT = '(no output)';

  // Turns a runner result into console lines. The log splits on newlines
  // itself, so multi-line stdout arrives as one row per line and scrolls the
  // way a console should.
  function formatRun(result) {
    if (!result) return [];
    if (result.refused) {
      return [{ stream: 'system', text: result.reason || 'Refused.' }];
    }

    const lines = [];
    if (result.stdout) lines.push({ stream: 'shell', text: result.stdout });
    if (result.stderr) lines.push({ stream: 'shell', text: result.stderr });
    if (result.truncated) lines.push({ stream: 'system', text: TRUNCATED });

    if (result.timedOut) {
      // Deliberately not also reporting an exit code: a killed process didn't
      // exit, and saying it did would be a lie the user can act on.
      lines.push({ stream: 'system', text: STOPPED });
    } else if (result.code) {
      lines.push({ stream: 'system', text: `Exit code ${result.code}.` });
    }

    // A console that prints nothing at all reads as broken, so say so.
    if (!lines.length) lines.push({ stream: 'system', text: SILENT });
    return lines;
  }

  // ── the confirm card ──────────────────────────────────────────────────

  // The card must show the command verbatim. Paraphrasing what is about to run
  // is how a confirmation stops being a confirmation.
  function cardFor(classification) {
    const command = String(classification?.command || '').trim();
    const reason = String(classification?.reason || '').trim();
    return {
      title: 'RUN THIS COMMAND?',
      detail: reason ? `${command}\n\n${reason}` : command,
    };
  }

  // ── the submit sequence ───────────────────────────────────────────────
  //
  // classify → (card, if it needs one) → run → show. Dependencies are injected
  // so this can be driven in plain Node: `classify`/`run` are the IPC edge and
  // `confirm`/`emit` are the DOM edge.
  //
  // Worth being clear about what this is and isn't. The main process refuses an
  // approve-tier command that arrives without approved:true, and refuses a
  // denied one no matter what — so this sequence is the console being honest,
  // not the thing standing between the user and `format c:`.
  function createConsoleRunner({ classify, run, confirm, emit, cwd = '' } = {}) {
    let current = cwd;
    let busy = false;

    async function submit(text) {
      const command = String(text || '').trim();
      if (!command) return;
      // One command at a time. Without this, hitting enter twice during a
      // confirm card leaves two cards racing for one answer.
      if (busy) {
        emit('system', 'Still working on the last one.');
        return;
      }
      busy = true;
      try {
        emit('you', command);

        let verdict;
        try {
          verdict = await classify(command);
        } catch (error) {
          // Unclassified means unrun. Failing open here would make an IPC
          // hiccup the way around the tiers.
          emit('system', `I couldn't check that command, so I haven't run it. ${error?.message || error}`);
          return;
        }

        const tier = verdict?.tier || 'approve';

        if (tier === 'deny') {
          emit('system', verdict?.reason || 'That one is refused.');
          return;
        }

        let approved = false;
        if (tier === 'approve') {
          approved = await confirm(cardFor({ ...verdict, command }));
          if (!approved) {
            emit('system', 'Cancelled — nothing ran.');
            return;
          }
        }

        // `cd` can't persist in a child process, so the console proposes the
        // directory and the main process decides whether it's allowed. Its
        // answer comes back in result.cwd.
        const proposed = resolveCd(current, command);
        const target = proposed === null ? current : proposed;

        let result;
        try {
          result = await run(command, target, approved);
        } catch (error) {
          emit('system', `That command couldn't be run. ${error?.message || error}`);
          return;
        }

        for (const line of formatRun(result)) emit(line.stream, line.text);

        if (result && typeof result.cwd === 'string' && result.cwd) {
          const moved = result.cwd !== current;
          current = result.cwd;
          if (moved) emit('system', current);
        }
      } finally {
        busy = false;
      }
    }

    return {
      submit,
      cwd: () => current,
      setCwd: (dir) => { if (typeof dir === 'string' && dir) current = dir; },
      isBusy: () => busy,
    };
  }

  // ── the confirm card's handshake ──────────────────────────────────────
  //
  // A <dialog> fires 'close' SYNCHRONOUSLY from .close(), so the dismiss
  // handler lands in the middle of the click handler trying to answer the card.
  // Whoever claims the card first owns the answer, and there is exactly one
  // claim — which is what stops a CONFIRM being overwritten by the close event
  // it just triggered.
  //
  // It lives here rather than in renderer.js so that ordering is testable in
  // plain Node. It is bookkeeping, not a control: the main process refuses an
  // unapproved approve-tier command regardless of what this says.
  function createCardGate() {
    let pending = null;

    return {
      // Opens a card. Resolves true (confirmed), false (cancelled or dismissed).
      ask() {
        return new Promise((resolve) => { pending = resolve; });
      },
      // Take ownership of the open card, or null if there isn't one — which is
      // how the router's own cards fall through to the IPC path untouched.
      // The caller MUST resolve what it takes.
      claim() {
        const resolve = pending;
        pending = null;
        return resolve || null;
      },
      // The card went away without being answered. Dismissing means no.
      dismiss() {
        const resolve = pending;
        pending = null;
        if (resolve) resolve(false);
      },
      isPending() { return Boolean(pending); },
    };
  }

  const api = {
    looksLikeShell,
    normalize,
    resolveCd,
    formatRun,
    cardFor,
    createConsoleRunner,
    createCardGate,
    TRUNCATED,
    STOPPED,
    SILENT,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.JarvisTerminalSession = api;
})();
