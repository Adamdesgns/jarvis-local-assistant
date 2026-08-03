const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ConfigStore } = require('../core/config-store');

// The settings drift guard. Twice now a renderer-side setting was added
// without adding its key to ConfigStore.updateSettings' allowlist, so the
// value applied live and then silently vanished on save (claudeBridge* the
// first time; orbSkin/orbColor/windowGlass/nightShift*/heartbeat*/defense the
// second — Adam's orb soul and Defense county reset on every save). These
// tests read the actual patch the settings dialog sends out of renderer.js,
// so a new setting that is not persisted — or has no sample here — fails CI
// instead of failing Adam.

// One type-correct, non-default sample per key the settings form sends.
// A new key in renderer.js without a sample here fails the completeness test.
const SAMPLES = {
  profileName: 'Drift Guard',
  assistantName: 'Kori Test',
  aiMode: 'cloud',
  openaiModel: 'gpt-test',
  anthropicModel: 'claude-test',
  cloudProvider: 'anthropic',
  ollamaModel: 'test:1b',
  voiceEnabled: false,
  wakeWordEnabled: false,
  cameraAiDescriptions: false,
  cameraCloudVision: true,
  minimizeToOrb: false,
  orbAlwaysOnTop: false,
  startWithWindows: true,
  motionMode: 'calm',
  skin: 'command-center',
  orbSkin: 'plasma',
  orbColor: 'obsidian',
  windowGlass: 'ghost',
  nightShiftEnabled: true,
  heartbeatEnabled: true,
  nightShiftCloudBudgetUsd: 3,
  voiceName: 'Test Voice',
  ttsEngine: 'system',
  kokoroVoice: 'am_michael',
  autonomyEnabled: true,
  autonomyRules: { speakDoorbell: true, nightMotionOnly: true, someoneHereCard: true, speakMotion: true },
  autonomyNightStart: 20,
  autonomyNightEnd: 8,
  mobileEnabled: true,
  mobilePort: 27999,
  mobilePublicUrl: 'https://example.test',
  callEnabled: true,
  callAutoAnswer: false,
  claudeBridgeEnabled: true,
  screenControlEnabled: true,
  screenDriveEnabled: true,
  schedulesEnabled: true,
  defense: { countyZone: 'MSZ018', countyName: 'Testville', countyState: 'MS', autoWeather: true, autoCamera: true, rssFeeds: ['https://example.test/feed'] },
  projects: { 'drift-guard': 'C:\\drift' },
  searchRoots: ['C:\\drift-guard']
};

// Keys the renderer sends that the store may legitimately answer with a
// different value than what was sent. Keep this list empty unless a merge
// rule genuinely owns the key (none do today).
const REWRITTEN_BY_MERGE = new Set();

function rendererPatchKeys() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const start = source.indexOf('const patch = {');
  assert.notStrictEqual(start, -1, 'saveSettings patch literal not found in renderer.js — update this test');
  // Walk to the matching closing brace so nested objects stay inside.
  let depth = 0;
  let end = start;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) { end = i; break; }
  }
  const block = source.slice(start, end);
  const keys = [];
  for (const line of block.split('\n')) {
    const match = /^ {4}(\w+):/.exec(line); // top-level keys only — nested ones sit deeper
    if (match) keys.push(match[1]);
  }
  assert.ok(keys.length >= 30, `expected the settings patch to have 30+ keys, parsed ${keys.length} — parsing broke?`);
  return keys;
}

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-settings-test-'));
  return new ConfigStore(dir, null);
}

test('every key the settings dialog sends has a sample here', () => {
  for (const key of rendererPatchKeys()) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(SAMPLES, key),
      `renderer.js saveSettings now sends "${key}" but settings-persistence.test.js has no sample for it — add one so persistence is proven`
    );
  }
});

test('every key the settings dialog sends actually persists', () => {
  const store = makeStore();
  for (const key of rendererPatchKeys()) {
    if (REWRITTEN_BY_MERGE.has(key)) continue;
    store.updateSettings({ [key]: SAMPLES[key] });
    if (key === 'projects') {
      // mergeSettings folds default project names in alongside saved ones.
      assert.strictEqual(store.getSettings().projects['drift-guard'], 'C:\\drift',
        'projects entry vanished through updateSettings');
      continue;
    }
    assert.deepStrictEqual(
      store.getSettings()[key],
      SAMPLES[key],
      `"${key}" was sent to updateSettings and came back different — is it missing from the allowlist in core/config-store.js?`
    );
  }
});

test('persisted settings survive a reload from disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-settings-test-'));
  const first = new ConfigStore(dir, null);
  first.updateSettings(SAMPLES);
  const second = new ConfigStore(dir, null);
  const reloaded = second.getSettings();
  for (const [key, value] of Object.entries(SAMPLES)) {
    if (key === 'projects') {
      // mergeSettings folds default project names in alongside saved ones.
      assert.strictEqual(reloaded.projects['drift-guard'], 'C:\\drift', 'projects entry lost across reload');
      continue;
    }
    assert.deepStrictEqual(reloaded[key], value, `"${key}" did not survive an app restart`);
  }
});

test('license can never be written through the settings patch', () => {
  const store = makeStore();
  store.updateSettings({ license: { status: 'active' } });
  assert.strictEqual(store.getSettings().license.status, 'none', 'settings:save must never touch license state');
});
