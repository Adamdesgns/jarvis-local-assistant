const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const {
  buildServiceEnv,
  shouldRestartVoice,
  buildDiagnosticReport,
} = require('../core/local-voice-service');

// The buyer-named wake word. The wake MATCHER lives in scripts/local_voice.py
// (Python owns the hot path); these tests pin the JS half of the contract and
// bridge to the Python half via --selftest when a voice venv exists.

// ── the env contract ────────────────────────────────────────────────────

test('buildServiceEnv carries all four variables', () => {
  const env = buildServiceEnv({
    localVoiceModel: 'base.en',
    wakeWordEnabled: true,
    assistantName: 'Max',
    wakeSensitivity: 0.7,
  });
  assert.deepEqual(env, {
    JARVIS_WHISPER_MODEL: 'base.en',
    JARVIS_WAKE_ENABLED: '1',
    JARVIS_ASSISTANT_NAME: 'Max',
    JARVIS_WAKE_SENSITIVITY: '0.7',
  });
});

test('buildServiceEnv defaults match today\'s behavior exactly', () => {
  // Master-parity: an empty settings object must produce the values the
  // engine effectively had before this feature (name JARVIS, threshold 0.55).
  const env = buildServiceEnv({});
  assert.equal(env.JARVIS_WHISPER_MODEL, 'small.en');
  assert.equal(env.JARVIS_WAKE_ENABLED, '1');
  assert.equal(env.JARVIS_ASSISTANT_NAME, 'JARVIS');
  assert.equal(env.JARVIS_WAKE_SENSITIVITY, '0.55');
});

test('buildServiceEnv never emits an empty name', () => {
  assert.equal(buildServiceEnv({ assistantName: '   ' }).JARVIS_ASSISTANT_NAME, 'JARVIS');
});

test('wake off is the string zero, matching the python check', () => {
  assert.equal(buildServiceEnv({ wakeWordEnabled: false }).JARVIS_WAKE_ENABLED, '0');
});

// ── restart matrix ──────────────────────────────────────────────────────

test('renaming him restarts the voice service — the wake MODE depends on it', () => {
  assert.equal(shouldRestartVoice({ assistantName: 'JARVIS' }, { assistantName: 'Max' }), true);
});

test('each spawn-time setting restarts; unrelated settings do not', () => {
  assert.equal(shouldRestartVoice({ wakeWordEnabled: true }, { wakeWordEnabled: false }), true);
  assert.equal(shouldRestartVoice({ localVoiceModel: 'small.en' }, { localVoiceModel: 'base.en' }), true);
  assert.equal(shouldRestartVoice({ wakeSensitivity: 0.55 }, { wakeSensitivity: 0.7 }), true);
  const same = { wakeWordEnabled: true, localVoiceModel: 'small.en', assistantName: 'Kori', wakeSensitivity: 0.55 };
  assert.equal(shouldRestartVoice(same, { ...same, orbColor: 'obsidian' }), false);
});

// ── report copy ─────────────────────────────────────────────────────────

test('the diagnostic report speaks the chosen name, not the product', () => {
  const report = buildDiagnosticReport({ wakeReady: true, wakeMode: 'transcribe' }, { assistantName: 'Max' });
  assert.match(report, /Say Hey Max/);
  assert.match(report, /listening by transcription/);
  assert.ok(!report.includes('Jarvis'), 'no hardcoded product name in the report');
});

// ── drift guards over the python source ─────────────────────────────────
// node:test cannot import python, but it can pin the load-bearing lines.

const pySource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'local_voice.py'), 'utf8');

test('the old jarvis-only score filter is gone from local_voice.py', () => {
  // That filter silently zeroed any wake model whose key lacked "jarvis" —
  // with it, shipping a custom model would look like a broken microphone.
  assert.ok(!pySource.includes('"jarvis" in key.lower()'), 'the jarvis substring score filter must stay dead');
});

test('local_voice.py honours the env contract and the selftest seam', () => {
  for (const marker of ['JARVIS_ASSISTANT_NAME', 'JARVIS_WAKE_SENSITIVITY', 'JARVIS_WAKE_WHISPER_MODEL', '--selftest', 'skeleton-port-begin']) {
    assert.ok(pySource.includes(marker), `local_voice.py must contain ${marker}`);
  }
});

test('no hardcoded HEY JARVIS label survives in the voice service', () => {
  const jsSource = fs.readFileSync(path.join(__dirname, '..', 'core', 'local-voice-service.js'), 'utf8');
  assert.ok(!jsSource.includes("'HEY JARVIS'"), 'the wake label must come from settings');
});

// ── the python selftest bridge ──────────────────────────────────────────
// Runs the REAL python matcher against the same fixture. Skips (never fails)
// when no voice venv exists, so CI without python stays green.

test('python wake matcher agrees with the shared fixture', (t) => {
  const candidates = [
    process.env.JARVIS_TEST_VENV,
    path.join(os.homedir(), 'AppData', 'Roaming', 'jarvis-local-assistant', 'voice', '.venv', 'Scripts', 'python.exe'),
  ].filter(Boolean);
  const python = candidates.find((p) => fs.existsSync(p));
  if (!python) {
    t.skip('no local voice venv on this machine');
    return;
  }
  const fixture = path.join(__dirname, 'fixtures', 'wake-phrases.json');
  const script = path.join(__dirname, '..', 'scripts', 'local_voice.py');
  const result = spawnSync(python, [script, '--selftest', fixture], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, `selftest failed:\n${result.stdout}\n${result.stderr}`);
  const line = String(result.stdout).split('\n').find((l) => l.includes('"selftest"'));
  const parsed = JSON.parse(line);
  assert.equal(parsed.failed, 0, JSON.stringify(parsed.failures, null, 2));
  assert.ok(parsed.passed >= 20, 'the fixture should keep at least its current breadth');
});

// ── JS twin stays in lockstep ───────────────────────────────────────────
// The wake rule is position-anchored (python-only), but the SKELETONS must
// agree between the two ports. nameHeardIn is the JS surface over the same
// skeleton fold — every fixture case the python matcher wakes on must also
// be heard by the JS matcher (the reverse is not true: JS matches anywhere).

test('every python-wakeable fixture case is heard by the JS skeleton matcher', () => {
  const { nameHeardIn } = require('../core/onboarding');
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wake-phrases.json'), 'utf8'));
  for (const item of cases.filter((c) => c.expectWake)) {
    assert.equal(
      nameHeardIn(item.transcript, item.name),
      true,
      `JS skeleton fold drifted from python: "${item.transcript}" / ${item.name}`,
    );
  }
});
