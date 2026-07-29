const test = require('node:test');
const assert = require('node:assert/strict');

const {
  looksLikeShell,
  resolveCd,
  formatRun,
  cardFor,
  createConsoleRunner,
  createCardGate,
} = require('../src/terminal-session');

// A console wired to fakes. Nothing is mocked that matters — the thing under
// test IS the sequencing, so the fakes are just the IPC edge and the DOM edge.
function harness({ tier = 'free', reason = 'because', result = {}, answer = true } = {}) {
  const calls = { classify: [], run: [], confirm: [] };
  const emitted = [];
  const runner = createConsoleRunner({
    cwd: 'C:\\Projects',
    classify: async (command) => {
      calls.classify.push(command);
      return { tier, reason, command };
    },
    run: async (command, cwd, approved) => {
      calls.run.push({ command, cwd, approved });
      return { stdout: 'ok', stderr: '', code: 0, cwd, ...result };
    },
    confirm: async (card) => {
      calls.confirm.push(card);
      return answer;
    },
    emit: (stream, text) => emitted.push({ stream, text }),
  });
  return { runner, calls, emitted };
}

// ── looksLikeShell ──────────────────────────────────────────────────────
// Stage 1 refused these words with shellHint(). Stage 2 runs them. The list
// itself is terminal-log.js's and stays deliberately narrow — this is only
// about the console picking the right pipeline.

test('looksLikeShell: unmistakable shell verbs route to the command pipeline', () => {
  assert.equal(looksLikeShell('dir'), true);
  assert.equal(looksLikeShell('git status'), true);
  assert.equal(looksLikeShell('npm install'), true);
  assert.equal(looksLikeShell('NODE script.js'), true, 'case must not matter');
});

test('looksLikeShell: ambiguous English stays with JARVIS, not the shell', () => {
  // The whole point of the narrow list: these are things JARVIS genuinely does.
  assert.equal(looksLikeShell('type hello into notepad'), false);
  assert.equal(looksLikeShell('move the invoices to the desktop'), false);
  assert.equal(looksLikeShell('what is the weather'), false);
  assert.equal(looksLikeShell(''), false);
});

test('looksLikeShell: admin binaries reach the guard, not the assistant', () => {
  // Caught in the rig: these are exactly what command-guard's deny tier was
  // written for, and every one of them was sailing past it. The first word is
  // not something anyone says in English, so the console was handing
  // "vssadmin delete shadows" to the router as though it were conversation and
  // the honest refusal never appeared.
  assert.equal(looksLikeShell('diskpart'), true);
  assert.equal(looksLikeShell('vssadmin delete shadows'), true);
  assert.equal(looksLikeShell('reg delete HKCU\\Software\\X'), true);
  assert.equal(looksLikeShell('runas /user:Administrator cmd'), true);
  assert.equal(looksLikeShell('regedit'), true);
});

test('looksLikeShell: command shapes no English sentence has', () => {
  // "format" and "shutdown" ARE ordinary English, so they are not shell words.
  // These two shapes are not — no one asks an assistant to "format c:".
  assert.equal(looksLikeShell('format c:'), true);
  assert.equal(looksLikeShell('shutdown /s /t 0'), true);
});

test('looksLikeShell: English that merely resembles a command still goes to JARVIS', () => {
  // The regression risk in the fix above. Stealing these would break the
  // assistant to gain a refusal nobody needed.
  assert.equal(looksLikeShell('format this document nicely'), false);
  assert.equal(looksLikeShell('shutdown the computer at ten'), false);
  assert.equal(looksLikeShell('net me a coffee'), false);
});

// ── resolveCd ───────────────────────────────────────────────────────────
// Each run() spawns a fresh process, so `cd` cannot persist in the child —
// the console has to track the directory itself. The main process re-checks
// the result against approved roots, so this is convenience, not a control.

test('resolveCd: returns null for anything that is not a cd', () => {
  assert.equal(resolveCd('C:\\Projects', 'dir'), null);
  assert.equal(resolveCd('C:\\Projects', 'cdx'), null);
  assert.equal(resolveCd('C:\\Projects', ''), null);
});

test('resolveCd: a bare cd stays put', () => {
  assert.equal(resolveCd('C:\\Projects', 'cd'), 'C:\\Projects');
});

test('resolveCd: relative names append to the current directory', () => {
  assert.equal(resolveCd('C:\\Projects', 'cd apps'), 'C:\\Projects\\apps');
  assert.equal(resolveCd('C:\\Projects\\apps', 'cd ..'), 'C:\\Projects');
});

test('resolveCd: climbing past the drive root stops at the root', () => {
  assert.equal(resolveCd('C:\\', 'cd ..'), 'C:\\');
  assert.equal(resolveCd('C:\\Projects', 'cd ..\\..\\..'), 'C:\\');
});

test('resolveCd: absolute paths replace the current directory', () => {
  assert.equal(resolveCd('C:\\Projects', 'cd D:\\Work'), 'D:\\Work');
});

test('resolveCd: cmd\'s /d drive-switch flag is not treated as a folder name', () => {
  assert.equal(resolveCd('C:\\Projects', 'cd /d D:\\Work'), 'D:\\Work');
});

test('resolveCd: quoted paths with spaces survive', () => {
  assert.equal(resolveCd('C:\\Projects', 'cd "my folder"'), 'C:\\Projects\\my folder');
});

test('resolveCd: forward slashes are accepted and normalised', () => {
  assert.equal(resolveCd('C:\\Projects', 'cd apps/jarvis'), 'C:\\Projects\\apps\\jarvis');
});

// ── formatRun ───────────────────────────────────────────────────────────

test('formatRun: a refusal shows its reason and nothing else', () => {
  const lines = formatRun({ refused: true, tier: 'deny', reason: 'Nope.', stdout: '', stderr: '' });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'Nope.');
});

test('formatRun: stdout and stderr are carried on the shell stream', () => {
  const lines = formatRun({ stdout: 'hello', stderr: 'oops', code: 0 });
  assert.deepEqual(lines.map((l) => l.stream), ['shell', 'shell']);
  assert.deepEqual(lines.map((l) => l.text), ['hello', 'oops']);
});

test('formatRun: a silent success still says something', () => {
  // A console that prints nothing at all reads as broken.
  const lines = formatRun({ stdout: '', stderr: '', code: 0 });
  assert.equal(lines.length, 1);
  assert.match(lines[0].text, /no output/i);
});

test('formatRun: a non-zero exit is reported', () => {
  const lines = formatRun({ stdout: '', stderr: '', code: 1 });
  assert.ok(lines.some((l) => /exit code 1/i.test(l.text)));
});

test('formatRun: a killed command says it was stopped, not that it exited', () => {
  const lines = formatRun({ stdout: 'partial', stderr: '', code: null, timedOut: true });
  assert.ok(lines.some((l) => /stopped/i.test(l.text)));
  assert.ok(!lines.some((l) => /exit code/i.test(l.text)));
});

test('formatRun: truncation is disclosed rather than silently swallowed', () => {
  const lines = formatRun({ stdout: 'lots', stderr: '', code: 0, truncated: true });
  assert.ok(lines.some((l) => /capp?ed|truncat/i.test(l.text)));
});

// ── cardFor ─────────────────────────────────────────────────────────────

test('cardFor: the card shows the exact command that will run', () => {
  const card = cardFor({ tier: 'approve', command: 'npm install left-pad', reason: 'It can change things.' });
  assert.match(card.detail, /npm install left-pad/);
  assert.match(card.detail, /It can change things\./);
  assert.ok(card.title.length > 0);
});

// ── createConsoleRunner ─────────────────────────────────────────────────
// The submit sequence. The main process enforces the tiers on its own — these
// tests are about the console never *asking* for something it shouldn't, and
// never running something behind the user's back.

test('a free command runs immediately, with no card', async () => {
  const { runner, calls } = harness({ tier: 'free' });
  await runner.submit('dir');
  assert.equal(calls.confirm.length, 0, 'a read-only command must not nag');
  assert.deepEqual(calls.run, [{ command: 'dir', cwd: 'C:\\Projects', approved: false }]);
});

test('an approve command shows the card and only then runs, marked approved', async () => {
  const { runner, calls } = harness({ tier: 'approve', answer: true });
  await runner.submit('npm install');
  assert.equal(calls.confirm.length, 1);
  assert.match(calls.confirm[0].detail, /npm install/);
  assert.equal(calls.run.length, 1);
  assert.equal(calls.run[0].approved, true);
});

test('cancelling the card runs nothing at all', async () => {
  const { runner, calls, emitted } = harness({ tier: 'approve', answer: false });
  await runner.submit('npm install');
  assert.equal(calls.confirm.length, 1);
  assert.equal(calls.run.length, 0, 'saying no must not reach the runner');
  assert.ok(emitted.some((l) => /cancel/i.test(l.text)));
});

test('a denied command gets no card and never reaches the runner', async () => {
  const { runner, calls, emitted } = harness({ tier: 'deny', reason: 'Not that one.' });
  await runner.submit('format c:');
  assert.equal(calls.confirm.length, 0, 'deny has no card — offering one implies a yes exists');
  assert.equal(calls.run.length, 0);
  assert.ok(emitted.some((l) => /Not that one\./.test(l.text)));
});

test('the typed command is echoed before anything happens', async () => {
  const { runner, emitted } = harness({ tier: 'free' });
  await runner.submit('dir');
  assert.equal(emitted[0].stream, 'you');
  assert.equal(emitted[0].text, 'dir');
});

test('blank input does nothing', async () => {
  const { runner, calls, emitted } = harness();
  await runner.submit('   ');
  assert.equal(calls.classify.length, 0);
  assert.equal(calls.run.length, 0);
  assert.equal(emitted.length, 0);
});

test('cd offers the resolved directory to the main process', async () => {
  const { runner, calls } = harness({ tier: 'free', result: { cwd: 'C:\\Projects\\apps' } });
  await runner.submit('cd apps');
  assert.equal(calls.run[0].cwd, 'C:\\Projects\\apps');
});

test('the console follows the directory the main process actually used', async () => {
  // main.js falls back to the first approved root when the requested cwd is
  // not allowed, so its answer is the truth and the console must not assume
  // its own guess won.
  const { runner } = harness({ tier: 'free', result: { cwd: 'C:\\Approved' } });
  await runner.submit('cd nowhere');
  assert.equal(runner.cwd(), 'C:\\Approved');
});

test('a failed classify runs nothing and says so', async () => {
  const emitted = [];
  const runs = [];
  const runner = createConsoleRunner({
    cwd: 'C:\\Projects',
    classify: async () => { throw new Error('ipc down'); },
    run: async (...args) => { runs.push(args); return {}; },
    confirm: async () => true,
    emit: (stream, text) => emitted.push({ stream, text }),
  });
  await runner.submit('dir');
  assert.equal(runs.length, 0, 'an unclassified command must never run');
  assert.ok(emitted.some((l) => /couldn.t|could not|failed/i.test(l.text)));
});

test('command output reaches the console', async () => {
  const { runner, emitted } = harness({ tier: 'free', result: { stdout: 'Volume in drive C' } });
  await runner.submit('dir');
  assert.ok(emitted.some((l) => l.stream === 'shell' && /Volume in drive C/.test(l.text)));
});

// ── createCardGate ──────────────────────────────────────────────────────
// Who owns the answer to an open confirm card. This exists because a <dialog>
// fires 'close' SYNCHRONOUSLY from .close(), so the dismiss handler runs in the
// middle of the click handler that is trying to answer it. Getting that order
// wrong turns every CONFIRM into a silent cancel, and no test of the console
// runner would ever see it — the card is the DOM's half of the handshake.

test('dismissing a card without answering means no', async () => {
  const gate = createCardGate();
  const promise = gate.ask();
  gate.dismiss();
  assert.equal(await promise, false);
});

test('claiming a card before it closes wins the race against the dismiss handler', async () => {
  const gate = createCardGate();
  const promise = gate.ask();
  // Exactly the real sequence: claim, then close (which fires dismiss), then
  // answer. If dismiss could still see the card, this would resolve false.
  const claimed = gate.claim();
  gate.dismiss();
  claimed(true);
  assert.equal(await promise, true);
});

test('a dismissal arriving after an answer cannot overturn it', async () => {
  const gate = createCardGate();
  const promise = gate.ask();
  const claimed = gate.claim();
  claimed(true);
  gate.dismiss();
  assert.equal(await promise, true);
});

test('with no card open, a stray dismissal does nothing', () => {
  const gate = createCardGate();
  assert.equal(gate.isPending(), false);
  assert.doesNotThrow(() => gate.dismiss());
  assert.equal(gate.claim(), null, 'nothing to claim means the router path must run');
});

test('a card is pending only until it is claimed', async () => {
  const gate = createCardGate();
  const promise = gate.ask();
  assert.equal(gate.isPending(), true);
  const claimed = gate.claim();
  assert.equal(gate.isPending(), false);
  claimed(false);
  await promise;
});
