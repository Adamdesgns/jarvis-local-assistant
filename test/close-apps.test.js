const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { ToolService, normalizeProcessName, isProtectedProcess, SYSTEM_PROCESS_DENYLIST } = require('../core/tool-service');

// ---- Pure logic: normalizeProcessName + isProtectedProcess -----------------
// These are the two functions the spec calls out as "pure logic" that must
// be tested hard, independent of any spawning/COM/I-O.

test('normalizeProcessName lowercases, trims, and strips a trailing .exe', () => {
  assert.equal(normalizeProcessName('Explorer'), 'explorer');
  assert.equal(normalizeProcessName('explorer.exe'), 'explorer');
  assert.equal(normalizeProcessName('EXPLORER'), 'explorer');
  assert.equal(normalizeProcessName('  Chrome.EXE  '), 'chrome');
  assert.equal(normalizeProcessName(''), '');
  assert.equal(normalizeProcessName(null), '');
  assert.equal(normalizeProcessName(undefined), '');
});

test('isProtectedProcess refuses the explorer.exe shell process itself', () => {
  assert.equal(isProtectedProcess('explorer', 'jarvis.exe'), true);
  assert.equal(isProtectedProcess('Explorer', 'jarvis.exe'), true);
  assert.equal(isProtectedProcess('EXPLORER.EXE', 'jarvis.exe'), true);
  assert.equal(isProtectedProcess('explorer.exe', 'jarvis.exe'), true);
});

test('isProtectedProcess refuses every system process on the denylist', () => {
  for (const name of SYSTEM_PROCESS_DENYLIST) {
    assert.equal(isProtectedProcess(name, 'jarvis.exe'), true, `${name} should be protected`);
    assert.equal(isProtectedProcess(name.toUpperCase(), 'jarvis.exe'), true, `${name.toUpperCase()} should be protected`);
    assert.equal(isProtectedProcess(`${name}.exe`, 'jarvis.exe'), true, `${name}.exe should be protected`);
  }
  // Sanity: the denylist actually contains the processes the spec requires.
  for (const required of ['explorer', 'csrss', 'winlogon', 'services', 'lsass', 'smss', 'wininit', 'svchost', 'system', 'registry']) {
    assert.ok(SYSTEM_PROCESS_DENYLIST.has(required), `denylist must include ${required}`);
  }
});

test('isProtectedProcess refuses JARVIS\'s own process, whatever it is currently running as', () => {
  assert.equal(isProtectedProcess('jarvis', 'jarvis.exe'), true);
  assert.equal(isProtectedProcess('JARVIS.EXE', 'jarvis.exe'), true);
  assert.equal(isProtectedProcess('electron', 'electron.exe'), true, 'dev mode runs under electron.exe');
  assert.equal(isProtectedProcess('node', 'node.exe'), true, 'test runs under node.exe');
});

test('isProtectedProcess allows a normal application', () => {
  assert.equal(isProtectedProcess('chrome', 'jarvis.exe'), false);
  assert.equal(isProtectedProcess('notepad.exe', 'jarvis.exe'), false);
  assert.equal(isProtectedProcess('code.cmd'.replace(/\.cmd$/, ''), 'jarvis.exe'), false);
});

test('isProtectedProcess is false for empty/garbage input', () => {
  assert.equal(isProtectedProcess('', 'jarvis.exe'), false);
  assert.equal(isProtectedProcess(null, 'jarvis.exe'), false);
});

// ---- resolveApplication case-insensitivity / .exe handling -----------------
// Same registry entry ("Explorer", "explorer.exe", "EXPLORER") must resolve
// to the same canonical application regardless of how the request is
// phrased — this is what lets closeApplication key off application.command
// reliably.

function appsConfig(applications) {
  return { getSettings: () => ({ applications }) };
}

test('resolveApplication resolves "Explorer", "explorer.exe", and "EXPLORER" to the same canonical entry', () => {
  const svc = new ToolService({
    config: appsConfig({ explorer: { command: 'explorer.exe', aliases: ['files', 'file explorer'] } }),
    shell: null,
    app: null
  });
  for (const query of ['Explorer', 'explorer.exe', 'EXPLORER', 'file explorer', 'Files']) {
    const resolved = svc.resolveApplication(query);
    assert.ok(resolved, `expected "${query}" to resolve`);
    assert.equal(resolved.canonical, 'explorer');
    assert.equal(resolved.command, 'explorer.exe');
  }
});

// ---- closeApplication: end-to-end behaviour with a fake launchProcess -----
// A minimal fake child process: an EventEmitter with .stdout/.stderr
// sub-emitters, mirroring the shape node's child_process.spawn returns and
// matching the style used elsewhere in test/core.test.js.

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.unref = () => {};
  return child;
}

function serviceWithLaunch(applications, launchImpl) {
  const launches = [];
  const svc = new ToolService({
    config: appsConfig(applications),
    shell: null,
    app: null,
    launchProcess: (command, args, options) => {
      const child = fakeChild();
      launches.push({ command, args, options, child });
      // Let the caller decide when/how to resolve; default: succeed at once.
      queueMicrotask(() => launchImpl(child, launches[launches.length - 1]));
      return child;
    }
  });
  return { svc, launches };
}

test('closeApplication refuses to close explorer.exe via taskkill — it always routes to the window-closing path', async () => {
  const { svc, launches } = serviceWithLaunch(
    { explorer: { command: 'explorer.exe', aliases: ['files', 'file explorer'] } },
    (child) => { child.stdout.emit('data', 'CLOSED:0'); child.emit('close', 0); }
  );
  const result = await svc.closeApplication('file explorer');
  assert.equal(result.ok, true);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].command, 'powershell.exe', 'must use the COM window-closing path, never taskkill');
  assert.ok(!launches.some((l) => l.command === 'taskkill.exe'), 'taskkill must never be invoked against explorer.exe');
  assert.match(result.message, /no file explorer windows/i);
});

test('closeApplication("explorer") reports how many windows closed and reassures about the taskbar/desktop', async () => {
  const { svc, launches } = serviceWithLaunch(
    { explorer: { command: 'explorer.exe', aliases: [] } },
    (child) => { child.stdout.emit('data', 'CLOSED:2'); child.emit('close', 0); }
  );
  const result = await svc.closeApplication('explorer');
  assert.equal(result.ok, true);
  assert.match(result.message, /closed 2 file explorer windows/i);
  assert.match(result.message, /taskbar and desktop are untouched/i);
  assert.equal(launches[0].args.includes('-Command'), true);
  // The script argument must be a fixed constant with no interpolated app
  // name or other request-derived data — grep it for the literal request.
  const script = launches[0].args[launches[0].args.indexOf('-Command') + 1];
  assert.ok(!script.includes('explorer"'), 'script must not have the request string spliced in');
  assert.match(script, /Shell\.Application/);
  assert.match(script, /\.Quit\(\)/);
});

test('closeApplication refuses every system process on the denylist without spawning anything', async () => {
  for (const name of SYSTEM_PROCESS_DENYLIST) {
    if (name === 'explorer') continue; // explorer has its own dedicated test above
    const { svc, launches } = serviceWithLaunch(
      { [name]: { command: `${name}.exe`, aliases: [] } },
      () => {}
    );
    const result = await svc.closeApplication(name);
    assert.equal(result.ok, false);
    assert.equal(launches.length, 0, `${name} must never be spawned against`);
    assert.match(result.message, /won't close|refusing/i);
  }
});

test('closeApplication refuses to close JARVIS\'s own process (here, node.exe, since tests run under node)', async () => {
  const selfName = path.basename(process.execPath).replace(/\.exe$/i, '');
  const { svc, launches } = serviceWithLaunch(
    { [selfName]: { command: `${selfName}.exe`, aliases: ['myself'] } },
    () => {}
  );
  const result = await svc.closeApplication('myself');
  assert.equal(result.ok, false);
  assert.equal(launches.length, 0, 'JARVIS must never spawn a kill command against its own process');
  assert.match(result.message, /won't close|refusing/i);
});

test('closeApplication gracefully closes a normal app via taskkill without /F', async () => {
  const { svc, launches } = serviceWithLaunch(
    { notepad: { command: 'notepad.exe', aliases: [] } },
    (child) => { child.emit('close', 0); }
  );
  const result = await svc.closeApplication('notepad');
  assert.equal(result.ok, true);
  assert.match(result.message, /closed notepad/i);
  assert.equal(launches[0].command, 'taskkill.exe');
  assert.deepEqual(launches[0].args, ['/IM', 'notepad.exe']);
  assert.ok(!launches[0].args.includes('/F'), 'must never pass /F — that is a force kill');
});

test('closeApplication reports honestly (does not escalate to /F) when taskkill says the app can only be terminated forcefully', async () => {
  const { svc, launches } = serviceWithLaunch(
    { stubborn: { command: 'stubborn.exe', aliases: [] } },
    (child) => {
      child.stderr.emit('data', 'ERROR: The process "stubborn.exe" with PID 123 could not be terminated.\nReason: This process can only be terminated forcefully (with /F option).\n');
      child.emit('close', 1);
    }
  );
  const result = await svc.closeApplication('stubborn');
  assert.equal(result.ok, false);
  assert.match(result.message, /didn't close gracefully/i);
  assert.match(result.message, /won't/i);
  assert.equal(launches.length, 1, 'must not retry with a second, forceful call');
});

test('closeApplication reports when the target app is not running', async () => {
  const { svc } = serviceWithLaunch(
    { notepad: { command: 'notepad.exe', aliases: [] } },
    (child) => {
      child.stderr.emit('data', 'ERROR: The process "notepad.exe" not found.');
      child.emit('close', 128);
    }
  );
  const result = await svc.closeApplication('notepad');
  assert.equal(result.ok, false);
  assert.match(result.message, /doesn't appear to be running/i);
});

test('closeApplication reports an unknown app instead of guessing a process name', async () => {
  const svc = new ToolService({ config: appsConfig({}), shell: null, app: null });
  const result = await svc.closeApplication('some made up thing');
  assert.equal(result.ok, false);
  assert.match(result.message, /don't have an approved app/i);
});
