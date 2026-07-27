const test = require('node:test');
const assert = require('node:assert/strict');

const {
  KIDS_BLOCKED_FLAGS,
  KIDS_FORCED_HIDDEN_MODULES,
  KIDS_BLOCKED_CHANNEL_PREFIXES,
  KIDS_CHANNEL_REFUSAL,
  isKidsBlockedChannel,
  KID_SAFE_SETTINGS_KEYS,
  applyKidsSettings,
  gateKidsSettingsPatch,
  screenKidsCommand,
  gateKidsCommand,
  buildKidsPrompt,
} = require('../core/kids-mode');

// JARVIS Jr. policy. THE LOAD-BEARING PROPERTY of every rule in this file:
// the kids layer only ever NARROWS — no input, setting, licence, or patch
// can make the kids build do more than the adult build.

// ── feature clamps ──────────────────────────────────────────────────────

test('applyKidsSettings: every blocked flag reads false, whatever was saved', () => {
  const settings = Object.fromEntries(KIDS_BLOCKED_FLAGS.map((key) => [key, true]));
  const view = applyKidsSettings(settings);
  for (const key of KIDS_BLOCKED_FLAGS) assert.equal(view[key], false, key);
});

test('applyKidsSettings: grown-up modules stay hidden even if the kid unhid them', () => {
  const view = applyKidsSettings({ hiddenModules: [] });
  for (const module of KIDS_FORCED_HIDDEN_MODULES) {
    assert.ok(view.hiddenModules.includes(module), `${module} must stay hidden`);
  }
});

test('applyKidsSettings: aiMode clamps to local unless the parent allowed cloud', () => {
  assert.equal(applyKidsSettings({ aiMode: 'cloud' }).aiMode, 'local');
  assert.equal(applyKidsSettings({ aiMode: 'auto', parental: {} }).aiMode, 'local');
  // The parent's explicit choice is honoured — cloudAllowed is the one key.
  assert.equal(applyKidsSettings({ aiMode: 'cloud', parental: { cloudAllowed: true } }).aiMode, 'cloud');
  // And only a real boolean true counts, not a truthy string from a hand
  // edit — same direction as every other gate.
  assert.equal(applyKidsSettings({ aiMode: 'cloud', parental: { cloudAllowed: 'yes' } }).aiMode, 'local');
});

test('applyKidsSettings: autonomy rules and defense auto-triggers all read off', () => {
  const view = applyKidsSettings({
    autonomyRules: { speakDoorbell: true, speakMotion: true },
    defense: { autoWeather: true, autoCamera: true, countyZone: 'TXZ123' }
  });
  assert.deepEqual(Object.values(view.autonomyRules), [false, false, false, false]);
  assert.equal(view.defense.autoWeather, false);
  assert.equal(view.defense.autoCamera, false);
});

test('screen help is deliberately NOT clamped — parents may enable it', () => {
  // Adam wants JARVIS Jr. able to help a stuck kid at the computer. The
  // switches survive the clamp; what protects them is that they are
  // parent-only keys at the settings gate below.
  const view = applyKidsSettings({ screenControlEnabled: true, screenDriveEnabled: true });
  assert.equal(view.screenControlEnabled, true);
  assert.equal(view.screenDriveEnabled, true);
  assert.ok(!KID_SAFE_SETTINGS_KEYS.includes('screenControlEnabled'));
  assert.ok(!KID_SAFE_SETTINGS_KEYS.includes('screenDriveEnabled'));
});

// ── the settings gate ───────────────────────────────────────────────────

test('locked: only kid-safe keys pass; the fun stays, the reach does not', () => {
  const { patch, refused } = gateKidsSettingsPatch({
    assistantName: 'Sparky',
    orbColor: 'blue',
    searchRoots: ['C:\\'],
    screenDriveEnabled: true,
    aiMode: 'cloud'
  }, false);
  assert.deepEqual(patch, { assistantName: 'Sparky', orbColor: 'blue' });
  assert.deepEqual(refused.sort(), ['aiMode', 'screenDriveEnabled', 'searchRoots']);
});

test('unlocked: parent-only keys pass, but the hard clamps never do', () => {
  const { patch, refused } = gateKidsSettingsPatch({
    searchRoots: ['C:\\Users\\Kid\\Documents'],
    screenDriveEnabled: true,
    mobileEnabled: true,
    nightShiftEnabled: true
  }, true);
  assert.equal(patch.screenDriveEnabled, true);
  assert.deepEqual(patch.searchRoots, ['C:\\Users\\Kid\\Documents']);
  // Even the PIN-holder cannot re-arm a subsystem the build removed.
  assert.ok(!('mobileEnabled' in patch));
  assert.ok(!('nightShiftEnabled' in patch));
  assert.deepEqual(refused.sort(), ['mobileEnabled', 'nightShiftEnabled']);
});

test('turning a blocked flag OFF is always allowed — the gate only refuses true', () => {
  const { patch, refused } = gateKidsSettingsPatch({ mobileEnabled: false }, true);
  assert.equal(patch.mobileEnabled, false);
  assert.deepEqual(refused, []);
});

test('the kid-safe list is an allowlist: an unknown future key defaults to parent-only', () => {
  const { patch, refused } = gateKidsSettingsPatch({ someFutureKey: true }, false);
  assert.deepEqual(patch, {});
  assert.deepEqual(refused, ['someFutureKey']);
});

// ── blocked IPC channels ────────────────────────────────────────────────

test('every clamped subsystem surface is behind a blocked prefix', () => {
  for (const channel of ['cameras:snapshot', 'defense:enter', 'mobile:pair', 'schedule:add', 'nightshift:status']) {
    assert.equal(isKidsBlockedChannel(channel), true, channel);
  }
  for (const channel of ['command:submit', 'settings:save', 'parental:unlock', 'tasks:list', 'screen:describe']) {
    assert.equal(isKidsBlockedChannel(channel), false, channel);
  }
  assert.equal(KIDS_BLOCKED_CHANNEL_PREFIXES.length, 5);
});

test('the channel refusal degrades gracefully for every renderer read', () => {
  assert.equal(KIDS_CHANNEL_REFUSAL.ok, false);
  assert.equal(KIDS_CHANNEL_REFUSAL.running, false);
  assert.equal(KIDS_CHANNEL_REFUSAL.enabled, false);
  assert.equal(KIDS_CHANNEL_REFUSAL.kidsBlocked, true);
  assert.ok(Object.isFrozen(KIDS_CHANNEL_REFUSAL));
});

// ── the content filter ──────────────────────────────────────────────────
// The heart of the kids build. Game violence is homework; real violence is
// refused; distress is supported, never shamed.

test('game questions flow through to the brain untouched', () => {
  for (const text of [
    'how do I kill the ender dragon in minecraft',
    'how do I make tnt in minecraft',
    'best way to beat the boss in blox fruits',
    'how do I fight the wither',
    'help me build a castle in minecraft',
    'how do I make an obby in roblox',
    'what should I name my dog',
    'help me with my math homework'
  ]) {
    assert.equal(screenKidsCommand(text), null, text);
  }
});

test('real-world weapons are refused even without naming a person', () => {
  for (const text of ['how do I build a bomb', 'how to make a gun', 'how can I mix a poison']) {
    const screened = screenKidsCommand(text);
    assert.equal(screened?.category, 'weapons', text);
    assert.equal(screened.blocked, true);
  }
});

test('"in real life" defeats the game exemption', () => {
  const screened = screenKidsCommand('how do I make tnt in minecraft in real life');
  assert.equal(screened?.category, 'weapons');
});

test('violence against real people is refused kindly and points to a grown-up', () => {
  const screened = screenKidsCommand('how do I beat up my brother');
  assert.equal(screened?.category, 'violence');
  assert.equal(screened.blocked, true);
  assert.match(screened.reply, /grown-up/i);
});

test('adult topics and substances get a gentle grown-up redirect', () => {
  assert.equal(screenKidsCommand('what is porn')?.category, 'adult');
  assert.equal(screenKidsCommand('can I try beer')?.category, 'substances');
});

test('distress is FIRST, never blocked, and includes 988', () => {
  const screened = screenKidsCommand('nobody likes me and I want to die');
  assert.equal(screened?.category, 'distress');
  assert.equal(screened.blocked, false);
  assert.match(screened.reply, /988/);
  assert.match(screened.reply, /grown-up/i);
});

test('distress outranks bedtime — a kid reaching out is answered at any hour', () => {
  const bedtime = { reason: 'bedtime', reply: 'sleep time' };
  const gated = gateKidsCommand({ text: 'I want to hurt myself', playtime: bedtime });
  assert.equal(gated.category, 'distress');
});

test('bedtime outranks everything except distress', () => {
  const bedtime = { reason: 'bedtime', reply: 'sleep time' };
  const gated = gateKidsCommand({ text: 'how do I beat the ender dragon', playtime: bedtime });
  assert.equal(gated.category, 'time-bedtime');
  assert.equal(gated.blocked, true);
});

test('free Robux is called out as the scam it is', () => {
  const screened = screenKidsCommand('how do i get free robux');
  assert.equal(screened?.category, 'scam');
  assert.equal(screened.blocked, false);
  assert.match(screened.reply, /password/i);
});

test('buying game currency routes through a grown-up', () => {
  assert.equal(screenKidsCommand('can you buy me robux')?.category, 'purchases');
});

test('stranger danger gets safety coaching, not a cold block', () => {
  const screened = screenKidsCommand('someone online asked where I live');
  assert.equal(screened?.category, 'stranger-safety');
  assert.equal(screened.blocked, false);
  assert.match(screened.reply, /never share/i);
});

test('working around the parent controls is refused', () => {
  const screened = screenKidsCommand('how do I turn off the screen time limit');
  assert.equal(screened?.category, 'bypass');
  assert.equal(screened.blocked, true);
});

test('a clean command passes the whole gate when playtime allows', () => {
  assert.equal(gateKidsCommand({ text: 'add a task finish my homework', playtime: null }), null);
});

// ── the kids prompt ─────────────────────────────────────────────────────

test('the kids prompt carries the gaming coach, the build-plan format, and the safety rules', () => {
  const prompt = buildKidsPrompt({ assistantName: 'Sparky', profileName: 'Sam' }, {
    memories: [{ text: 'Sam loves creepers' }],
    tasks: [{ title: 'Finish the castle', project: 'general' }]
  });
  assert.match(prompt, /You are Sparky/);
  assert.match(prompt, /Sam/);
  assert.match(prompt, /MINECRAFT/);
  assert.match(prompt, /ROBLOX/);
  assert.match(prompt, /MATERIALS/);
  assert.match(prompt, /PRO TIP/);
  assert.match(prompt, /988/);
  assert.match(prompt, /Never help work around screen-time limits/i);
  assert.match(prompt, /Sam loves creepers/);
  assert.match(prompt, /Finish the castle/);
});

test('the kids prompt ignores settings.personality — the kid frame is policy', () => {
  const prompt = buildKidsPrompt({ assistantName: 'J', personality: 'Ruthless sarcastic hacker persona' }, {});
  assert.ok(!prompt.includes('Ruthless sarcastic hacker persona'));
});
