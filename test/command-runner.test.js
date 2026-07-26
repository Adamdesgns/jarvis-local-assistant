'use strict';

// THE TERMINAL, stage 2 — the runner.
//
// Follows core/tool-service.js's safe-spawn precedent: an argv array and
// shell:false, so Node never hands the string to a shell of its own. The user's
// command IS shell text by definition, so the boundary is command-guard's tier
// plus the cwd confinement tested here — not argv escaping.
//
// The runner re-checks the tier itself rather than trusting its caller. Defence
// in depth: the renderer is expected to classify first, but a renderer bug must
// not become a way to run `format c:`.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { createCommandRunner } = require('../core/command-runner.js');

// A fake child process good enough to drive the runner's plumbing.
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = function kill(signal) { child.killed = true; child.killSignal = signal; return true; };
  return child;
}

const APPROVED = path.resolve('C:/Users/steam/Projects');

function harness(overrides = {}) {
  const calls = [];
  const children = [];
  const spawnFn = (file, args, options) => {
    calls.push({ file, args, options });
    const child = fakeChild();
    children.push(child);
    return child;
  };
  const runner = createCommandRunner({
    spawnFn,
    comspec: 'C:/Windows/System32/cmd.exe',
    isAllowed: (target) => {
      const resolved = path.resolve(target);
      return resolved === APPROVED || resolved.startsWith(APPROVED + path.sep);
    },
    ...overrides,
  });
  return { runner, calls, children };
}

// Resolve the next tick so listeners are attached before we emit.
const tick = () => new Promise((r) => setImmediate(r));

// ---------------------------------------------------------------------------
// the spawn contract
// ---------------------------------------------------------------------------

test('spawns the comspec with an argv array and shell:false', async () => {
  const { runner, calls, children } = harness();
  const promise = runner.run({ command: 'dir', cwd: APPROVED });
  await tick();
  children[0].emit('close', 0);
  await promise;

  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'C:/Windows/System32/cmd.exe');
  assert.ok(Array.isArray(calls[0].args), 'args must be an array, never a joined string');
  assert.equal(calls[0].options.shell, false, 'shell:false — Node must not add a shell of its own');
  assert.equal(calls[0].options.windowsHide, true);
});

test('passes /d so a hijacked AutoRun registry key cannot inject a command', async () => {
  // HKCU\Software\Microsoft\Command Processor\AutoRun runs before every cmd /c.
  // Without /d, that key would execute ahead of the user's command.
  const { runner, calls, children } = harness();
  const promise = runner.run({ command: 'dir', cwd: APPROVED });
  await tick();
  children[0].emit('close', 0);
  await promise;

  assert.ok(calls[0].args.includes('/d'), 'argv must contain /d to skip AutoRun');
  assert.equal(calls[0].args[calls[0].args.length - 1], 'dir', 'the command is the final argv element');
});

test('runs inside the requested approved directory', async () => {
  const inside = path.join(APPROVED, 'apps');
  const { runner, calls, children } = harness();
  const promise = runner.run({ command: 'dir', cwd: inside });
  await tick();
  children[0].emit('close', 0);
  await promise;

  assert.equal(path.resolve(calls[0].options.cwd), path.resolve(inside));
});

// ---------------------------------------------------------------------------
// the boundary — refusals that never reach spawn
// ---------------------------------------------------------------------------

test('a denied command never reaches spawn, even if the caller asks for it', async () => {
  const { runner, calls } = harness();
  const result = await runner.run({ command: 'format c:', cwd: APPROVED });

  assert.equal(result.refused, true);
  assert.equal(result.tier, 'deny');
  assert.equal(calls.length, 0, 'spawn must not be called for a denied command');
});

test('a cwd outside the approved roots is refused', async () => {
  const { runner, calls } = harness();
  const result = await runner.run({ command: 'dir', cwd: 'C:/Windows/System32' });

  assert.equal(result.refused, true);
  assert.match(result.reason, /approved/i);
  assert.equal(calls.length, 0);
});

test('a cwd escaping an approved root by traversal is refused', async () => {
  const { runner, calls } = harness();
  const result = await runner.run({ command: 'dir', cwd: path.join(APPROVED, '..', '..', 'Windows') });

  assert.equal(result.refused, true);
  assert.equal(calls.length, 0);
});

test('an empty command is refused without spawning', async () => {
  const { runner, calls } = harness();
  const result = await runner.run({ command: '   ', cwd: APPROVED });

  assert.equal(result.refused, true);
  assert.equal(calls.length, 0);
});

test('an approve-tier command still runs — the card is the renderer\'s job, not the runner\'s', async () => {
  // The runner enforces deny. Holding approve-tier commands for a confirm card
  // happens upstream; by the time run() is called the human has already said yes.
  const { runner, calls, children } = harness();
  const promise = runner.run({ command: 'npm install', cwd: APPROVED });
  await tick();
  children[0].emit('close', 0);
  const result = await promise;

  assert.equal(result.refused, undefined);
  assert.equal(calls.length, 1);
  assert.equal(result.tier, 'approve');
});

// ---------------------------------------------------------------------------
// output handling
// ---------------------------------------------------------------------------

test('captures stdout and stderr and the exit code', async () => {
  const { runner, children } = harness();
  const promise = runner.run({ command: 'dir', cwd: APPROVED });
  await tick();
  children[0].stdout.emit('data', Buffer.from('line one\n'));
  children[0].stderr.emit('data', Buffer.from('a warning\n'));
  children[0].emit('close', 3);
  const result = await promise;

  assert.equal(result.stdout, 'line one\n');
  assert.equal(result.stderr, 'a warning\n');
  assert.equal(result.code, 3);
  assert.equal(result.timedOut, false);
});

test('caps runaway output and flags it as truncated', async () => {
  const { runner, children } = harness();
  const promise = runner.run({ command: 'dir', cwd: APPROVED, maxBytes: 32 });
  await tick();
  children[0].stdout.emit('data', Buffer.from('x'.repeat(500)));
  children[0].emit('close', 0);
  const result = await promise;

  assert.equal(result.truncated, true);
  assert.ok(result.stdout.length <= 32, `expected <=32 bytes, got ${result.stdout.length}`);
});

test('a spawn failure resolves with the error instead of throwing', async () => {
  const { runner, children } = harness();
  const promise = runner.run({ command: 'dir', cwd: APPROVED });
  await tick();
  children[0].emit('error', new Error('ENOENT'));
  const result = await promise;

  assert.equal(result.failed, true);
  assert.match(result.stderr, /ENOENT/);
});

// ---------------------------------------------------------------------------
// hung processes
// ---------------------------------------------------------------------------

test('kills a process that outruns its timeout and reports it', async () => {
  const { runner, children } = harness();
  const promise = runner.run({ command: 'dir', cwd: APPROVED, timeoutMs: 10 });
  await tick();
  // Never emit close — this is the hung case.
  const result = await promise;

  assert.equal(result.timedOut, true);
  assert.equal(children[0].killed, true, 'the child must actually be killed, not just reported');
  assert.match(result.reason, /timed out|too long/i);
});

test('a process that finishes in time is not killed', async () => {
  const { runner, children } = harness();
  const promise = runner.run({ command: 'dir', cwd: APPROVED, timeoutMs: 5000 });
  await tick();
  children[0].emit('close', 0);
  const result = await promise;

  assert.equal(result.timedOut, false);
  assert.equal(children[0].killed, false);
});

test('there is a default timeout — a caller cannot hang forever by omitting one', async () => {
  const { runner } = harness();
  assert.ok(runner.defaultTimeoutMs > 0);
  assert.ok(runner.defaultTimeoutMs <= 120000, 'default timeout should be minutes at most');
});

// ---------------------------------------------------------------------------
// the hard rail: the AI never gets arbitrary shell
// ---------------------------------------------------------------------------

test('HARD RAIL: the runner is not registered as an AI tool', () => {
  // docs/ROADMAP.md: "user-typed ... user-driven only; the AI still never gets
  // arbitrary shell". The moment a run_command tool appears in the registry the
  // model can call it, so this test fails if one is ever added.
  const buildToolRegistry = require('../core/tool-registry.js');
  const registry = typeof buildToolRegistry === 'function'
    ? buildToolRegistry({})
    : (buildToolRegistry.buildToolRegistry ? buildToolRegistry.buildToolRegistry({}) : []);
  const names = (Array.isArray(registry) ? registry : []).map((tool) => String(tool.name || ''));

  for (const forbidden of ['run_command', 'run_shell', 'shell', 'terminal_run', 'execute_command']) {
    assert.ok(!names.includes(forbidden),
      `Tool "${forbidden}" must not exist: the terminal runner is user-driven only. ` +
      'If you are intentionally giving the model shell access, that is a product decision ' +
      'that needs Adam, not a test to delete.');
  }
});
