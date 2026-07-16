# Autonomy Slice 1 — Engine + Camera Reactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the autonomy spine (trigger → policy tier → announce/prepare/act) wired to camera events, shipping four off-by-default rules: speak-doorbell, night-only motion alerts, "someone's here" card, spoken motion summary.

**Architecture:** A pure rules module (`core/autonomy-rules.js`) decides what an alert produces; a thin background service (`core/autonomy-service.js`) applies it, emits `autonomy:event` to the UI, and logs with `source:'autonomy'`. The camera service gains one optional `notifyGate` hook. No Act-tier rule ships, but the Act gate decision is built and tested now.

**Tech Stack:** Electron main/renderer, Node `node:test` + `node:assert/strict`, no new dependencies.

## Global Constraints

- Every autonomous behavior defaults OFF (master switch `autonomyEnabled: false`, all four rules false).
- The autonomy service must never call `documents.*` or `tools.executePowerAction`; Act-tier decisions must never return `allowed: true` for `confirm` or `blocked` classifications.
- Doorbell notifications are never suppressed by the night gate.
- Default night window: start hour 21 (9 PM), end hour 7 (7 AM).
- `settingsVersion` stays 6 (new keys merge in via defaults; no migration needed).
- Do not change the `cameras:alert` payload or existing camera behavior when autonomy is off.
- Run `npm test` after every change; all tests must pass before each commit.
- Do NOT push to GitHub. Commit on the `autonomy-engine` branch only.
- Code style: CommonJS `require`, 2-space indent, single quotes, plain-English user-facing strings.

---

### Task 1: Pure rules module (`core/autonomy-rules.js`)

**Files:**
- Create: `core/autonomy-rules.js`
- Test: `test/autonomy.test.js` (new file; `npm test` runs `node --test`, which picks up `test/*.test.js` automatically)

**Interfaces:**
- Consumes: nothing (pure module).
- Produces:
  - `TIERS = { ANNOUNCE: 'announce', PREPARE: 'prepare', ACT: 'act' }`
  - `isWithinWindow(now: Date, startHour: number, endHour: number): boolean`
  - `evaluateAlert(settings: object, event: {kind, name, body, jpegBase64?}, now: Date): Array<{rule, tier, speak?, card?}>`
  - `shouldNotify(settings: object, event: {kind}, now: Date): boolean`
  - `decideAct(classification: 'safe'|'confirm'|'blocked'): {allowed: boolean, requiresApproval?: true, log?: true}`

- [ ] **Step 1: Write the failing tests**

Create `test/autonomy.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { TIERS, isWithinWindow, evaluateAlert, shouldNotify, decideAct } = require('../core/autonomy-rules');

function at(hour, minute = 0) {
  return new Date(2026, 6, 15, hour, minute, 0);
}

function settingsWith(overrides = {}, rules = {}) {
  return {
    autonomyEnabled: true,
    autonomyRules: { speakDoorbell: false, nightMotionOnly: false, someoneHereCard: false, speakMotion: false, ...rules },
    autonomyNightStart: 21,
    autonomyNightEnd: 7,
    ...overrides
  };
}

test('autonomy window: handles windows that cross midnight', () => {
  assert.equal(isWithinWindow(at(22), 21, 7), true, '10 PM is night');
  assert.equal(isWithinWindow(at(3), 21, 7), true, '3 AM is night');
  assert.equal(isWithinWindow(at(21), 21, 7), true, 'start hour is inclusive');
  assert.equal(isWithinWindow(at(7), 21, 7), false, 'end hour is exclusive');
  assert.equal(isWithinWindow(at(12), 21, 7), false, 'noon is day');
  // Non-crossing window too.
  assert.equal(isWithinWindow(at(10), 9, 17), true);
  assert.equal(isWithinWindow(at(18), 9, 17), false);
  // start === end means always.
  assert.equal(isWithinWindow(at(4), 8, 8), true);
});

test('autonomy: master switch off produces nothing', () => {
  const settings = settingsWith({ autonomyEnabled: false }, { speakDoorbell: true, speakMotion: true, someoneHereCard: true });
  const actions = evaluateAlert(settings, { kind: 'doorbell', name: 'Front Door', body: 'Front Door: a courier.' }, at(12));
  assert.deepEqual(actions, []);
  assert.equal(shouldNotify(settings, { kind: 'motion' }, at(12)), true, 'gate stays open when autonomy is off');
});

test('autonomy: each rule contributes only when enabled', () => {
  const none = evaluateAlert(settingsWith(), { kind: 'doorbell', name: 'Front Door', body: 'ding' }, at(12));
  assert.deepEqual(none, []);

  const spoken = evaluateAlert(settingsWith({}, { speakDoorbell: true }), { kind: 'doorbell', name: 'Front Door', body: 'Front Door: a courier.' }, at(12));
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].rule, 'speakDoorbell');
  assert.equal(spoken[0].tier, TIERS.ANNOUNCE);
  assert.equal(spoken[0].speak, 'Front Door: a courier.');

  const carded = evaluateAlert(settingsWith({}, { someoneHereCard: true }), { kind: 'doorbell', name: 'Front Door', body: 'ding', jpegBase64: 'abc' }, at(12));
  assert.equal(carded.length, 1);
  assert.equal(carded[0].tier, TIERS.PREPARE);
  assert.deepEqual(carded[0].card, { title: "SOMEONE'S HERE", body: 'ding', jpegBase64: 'abc' });

  const motion = evaluateAlert(settingsWith({}, { speakMotion: true }), { kind: 'motion', name: 'Yard', body: 'Motion at Yard.' }, at(12));
  assert.equal(motion.length, 1);
  assert.equal(motion[0].rule, 'speakMotion');
  assert.equal(motion[0].speak, 'Motion at Yard.');
});

test('autonomy: doorbell rules ignore motion and vice versa', () => {
  const settings = settingsWith({}, { speakDoorbell: true, someoneHereCard: true, speakMotion: true });
  const motionActions = evaluateAlert(settings, { kind: 'motion', name: 'Yard', body: 'Motion at Yard.' }, at(12));
  assert.deepEqual(motionActions.map((a) => a.rule), ['speakMotion'], 'motion never speaks the doorbell rule or raises the card');
  const doorbellActions = evaluateAlert(settings, { kind: 'doorbell', name: 'Front Door', body: 'ding' }, at(12));
  assert.deepEqual(doorbellActions.map((a) => a.rule).sort(), ['someoneHereCard', 'speakDoorbell'], 'doorbell never triggers the motion summary');
});

test('autonomy: night-only rule silences daytime motion but never the doorbell', () => {
  const settings = settingsWith({}, { nightMotionOnly: true, speakMotion: true });
  // Daytime: notification gated AND spoken summary suppressed.
  assert.equal(shouldNotify(settings, { kind: 'motion' }, at(14)), false);
  assert.deepEqual(evaluateAlert(settings, { kind: 'motion', name: 'Yard', body: 'Motion.' }, at(14)), []);
  // Night: both flow.
  assert.equal(shouldNotify(settings, { kind: 'motion' }, at(23)), true);
  assert.equal(evaluateAlert(settings, { kind: 'motion', name: 'Yard', body: 'Motion.' }, at(23)).length, 1);
  // Doorbell is never gated, day or night.
  assert.equal(shouldNotify(settings, { kind: 'doorbell' }, at(14)), true);
  // Rule off: daytime motion notifies as today.
  assert.equal(shouldNotify(settingsWith(), { kind: 'motion' }, at(14)), true);
});

test('autonomy: act tier never self-approves', () => {
  assert.deepEqual(decideAct('safe'), { allowed: true });
  assert.deepEqual(decideAct('confirm'), { allowed: false, requiresApproval: true });
  assert.deepEqual(decideAct('blocked'), { allowed: false, log: true });
  assert.equal(decideAct('anything-unknown').allowed, false, 'unknown classifications are refused');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../core/autonomy-rules'`

- [ ] **Step 3: Write the implementation**

Create `core/autonomy-rules.js`:

```js
// Pure autonomy policy: which announcements an alert produces and whether a
// sensitive (Act-tier) step may run unattended. No Electron imports.
const TIERS = { ANNOUNCE: 'announce', PREPARE: 'prepare', ACT: 'act' };

// Hour-of-day window that may cross midnight (21 → 7 means 9 PM–7 AM).
// Start is inclusive, end exclusive; start === end means "always".
function isWithinWindow(now, startHour, endHour) {
  const hour = now.getHours();
  const start = Number(startHour);
  const end = Number(endHour);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

function motionAllowed(settings, kind, now) {
  if (kind !== 'motion') return true; // the doorbell is never silenced
  if (!(settings.autonomyRules || {}).nightMotionOnly) return true;
  return isWithinWindow(now, settings.autonomyNightStart, settings.autonomyNightEnd);
}

// The camera service asks this before showing a Windows notification.
function shouldNotify(settings, event, now) {
  if (settings.autonomyEnabled !== true) return true;
  return motionAllowed(settings, event.kind, now);
}

function evaluateAlert(settings, event, now) {
  if (settings.autonomyEnabled !== true) return [];
  const rules = settings.autonomyRules || {};
  const actions = [];
  if (event.kind === 'doorbell' && rules.speakDoorbell) {
    actions.push({ rule: 'speakDoorbell', tier: TIERS.ANNOUNCE, speak: event.body });
  }
  if (event.kind === 'doorbell' && rules.someoneHereCard) {
    actions.push({
      rule: 'someoneHereCard',
      tier: TIERS.PREPARE,
      card: { title: "SOMEONE'S HERE", body: event.body, jpegBase64: event.jpegBase64 || '' }
    });
  }
  if (event.kind === 'motion' && rules.speakMotion && motionAllowed(settings, event.kind, now)) {
    actions.push({ rule: 'speakMotion', tier: TIERS.ANNOUNCE, speak: event.body });
  }
  return actions;
}

// Act-tier gate decision, mirroring the router's classifyCommand semantics.
// No Act rule ships in slice 1; this exists so slice 3 cannot get it wrong.
function decideAct(classification) {
  if (classification === 'safe') return { allowed: true };
  if (classification === 'confirm') return { allowed: false, requiresApproval: true };
  return { allowed: false, log: true };
}

module.exports = { TIERS, isWithinWindow, evaluateAlert, shouldNotify, decideAct };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all suites green (66 tests: 60 existing + 6 new).

- [ ] **Step 5: Commit**

```bash
git add core/autonomy-rules.js test/autonomy.test.js
git commit -m "feat(autonomy): pure rules module — tiers, night window, alert evaluation, act gate"
```

---

### Task 2: Settings defaults + persistence

**Files:**
- Modify: `core/defaults.js` (add keys after `cameraVisionModel`, line ~33)
- Modify: `core/config-store.js` (whitelist line ~69-77; deep-merge in `mergeSettings` line ~9-28)
- Test: `test/autonomy.test.js` (append)

**Interfaces:**
- Consumes: existing `DEFAULT_SETTINGS`, `mergeSettings`.
- Produces settings keys later tasks read: `autonomyEnabled: boolean`, `autonomyRules: {speakDoorbell, nightMotionOnly, someoneHereCard, speakMotion}` (all boolean), `autonomyNightStart: number`, `autonomyNightEnd: number`.

- [ ] **Step 1: Write the failing tests**

Append to `test/autonomy.test.js`:

```js
const { mergeSettings } = require('../core/config-store');
const { DEFAULT_SETTINGS } = require('../core/defaults');

test('autonomy settings: everything defaults OFF and old saves merge safely', () => {
  assert.equal(DEFAULT_SETTINGS.autonomyEnabled, false);
  assert.deepEqual(DEFAULT_SETTINGS.autonomyRules, {
    speakDoorbell: false, nightMotionOnly: false, someoneHereCard: false, speakMotion: false
  });
  assert.equal(DEFAULT_SETTINGS.autonomyNightStart, 21);
  assert.equal(DEFAULT_SETTINGS.autonomyNightEnd, 7);

  // An old save with no autonomy keys gets the defaults.
  const old = mergeSettings(DEFAULT_SETTINGS, { settingsVersion: 6 });
  assert.equal(old.autonomyEnabled, false);
  assert.equal(old.autonomyRules.speakDoorbell, false);

  // A partial saved rules object keeps unknown-at-save-time rules at default.
  const partial = mergeSettings(DEFAULT_SETTINGS, { settingsVersion: 6, autonomyRules: { speakDoorbell: true } });
  assert.equal(partial.autonomyRules.speakDoorbell, true);
  assert.equal(partial.autonomyRules.speakMotion, false, 'missing rules fall back to defaults');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `DEFAULT_SETTINGS.autonomyEnabled` is `undefined`.

- [ ] **Step 3: Implement**

In `core/defaults.js`, after the `cameraVisionModel: 'gemma3:4b',` line add:

```js
  autonomyEnabled: false,
  autonomyRules: {
    speakDoorbell: false,
    nightMotionOnly: false,
    someoneHereCard: false,
    speakMotion: false
  },
  autonomyNightStart: 21,
  autonomyNightEnd: 7,
```

In `core/config-store.js` `mergeSettings`, after the `result.routines = ...` line add:

```js
  result.autonomyRules = { ...clone(defaults.autonomyRules || {}), ...((saved || {}).autonomyRules || {}) };
```

In `core/config-store.js` `updateSettings`, extend the `allowed` array — after `'cameraAccounts', 'cameraAiDescriptions', 'cameraCloudVision', 'cameraVisionModel'` add:

```js
      'autonomyEnabled', 'autonomyRules', 'autonomyNightStart', 'autonomyNightEnd'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (67 tests).

- [ ] **Step 5: Commit**

```bash
git add core/defaults.js core/config-store.js test/autonomy.test.js
git commit -m "feat(autonomy): off-by-default settings with deep-merged rule toggles"
```

---

### Task 3: Autonomy service (`core/autonomy-service.js`)

**Files:**
- Create: `core/autonomy-service.js`
- Test: `test/autonomy.test.js` (append)

**Interfaces:**
- Consumes: `evaluateAlert`, `shouldNotify` from `core/autonomy-rules.js`; a config with `getSettings()`; `emit(channel, payload)`; `log.write(entry)`.
- Produces: `class AutonomyService { constructor({config, emit, log, now}), handleCameraAlert(alert): actions[], notifyGate(alert): boolean }`. Emits channel **`autonomy:event`** with a single action `{rule, tier, speak?, card?}` per event. `now` is an injectable clock (`() => new Date()` default) so tests control time.

- [ ] **Step 1: Write the failing tests**

Append to `test/autonomy.test.js`:

```js
const { AutonomyService } = require('../core/autonomy-service');

function fakeAutonomyConfig(settings) {
  return { getSettings: () => JSON.parse(JSON.stringify(settings)) };
}

test('autonomy service: emits autonomy:event and logs with source autonomy', () => {
  const emitted = [];
  const logged = [];
  const service = new AutonomyService({
    config: fakeAutonomyConfig(settingsWith({}, { speakDoorbell: true, someoneHereCard: true })),
    emit: (channel, payload) => emitted.push({ channel, payload }),
    log: { write: (entry) => logged.push(entry) },
    now: () => at(12)
  });
  const actions = service.handleCameraAlert({ kind: 'doorbell', name: 'Front Door', body: 'Front Door: a courier.', jpegBase64: 'abc' });
  assert.equal(actions.length, 2);
  assert.equal(emitted.length, 2);
  assert.ok(emitted.every((e) => e.channel === 'autonomy:event'));
  assert.ok(emitted.some((e) => e.payload.speak === 'Front Door: a courier.'));
  assert.ok(emitted.some((e) => e.payload.card && e.payload.card.jpegBase64 === 'abc'));
  assert.equal(logged.length, 2);
  assert.ok(logged.every((entry) => entry.source === 'autonomy' && entry.type === 'autonomy'));
});

test('autonomy service: silent when the master switch is off', () => {
  const emitted = [];
  const service = new AutonomyService({
    config: fakeAutonomyConfig(settingsWith({ autonomyEnabled: false }, { speakDoorbell: true })),
    emit: (channel, payload) => emitted.push({ channel, payload }),
    log: { write: () => {} },
    now: () => at(12)
  });
  assert.deepEqual(service.handleCameraAlert({ kind: 'doorbell', name: 'Front Door', body: 'ding' }), []);
  assert.equal(emitted.length, 0);
});

test('autonomy service: notifyGate follows the night rule and fails open', () => {
  const service = new AutonomyService({
    config: fakeAutonomyConfig(settingsWith({}, { nightMotionOnly: true })),
    emit: () => {}, log: { write: () => {} },
    now: () => at(14)
  });
  assert.equal(service.notifyGate({ kind: 'motion' }), false, 'daytime motion notification suppressed');
  assert.equal(service.notifyGate({ kind: 'doorbell' }), true);
  // A config that throws must never block notifications.
  const broken = new AutonomyService({ config: { getSettings: () => { throw new Error('boom'); } }, emit: () => {}, log: { write: () => {} } });
  assert.equal(broken.notifyGate({ kind: 'motion' }), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../core/autonomy-service'`

- [ ] **Step 3: Implement**

Create `core/autonomy-service.js`:

```js
const { evaluateAlert, shouldNotify } = require('./autonomy-rules');

// Background coordinator: receives triggers (camera alerts in slice 1),
// applies the enabled rules, and pushes announce/prepare actions to the UI.
// It never executes state-changing actions itself — Act-tier work must route
// through the router's approval flow (see decideAct in autonomy-rules).
class AutonomyService {
  constructor({ config, emit, log, now }) {
    this.config = config;
    this.emit = emit || (() => {});
    this.log = log || { write: () => {} };
    this.now = now || (() => new Date());
  }

  // The camera service consults this before raising a Windows notification.
  // Fails open: a bug here must never hide a real alert.
  notifyGate(alert) {
    try { return shouldNotify(this.config.getSettings(), alert, this.now()); }
    catch { return true; }
  }

  handleCameraAlert(alert) {
    try {
      const actions = evaluateAlert(this.config.getSettings(), alert, this.now());
      for (const action of actions) {
        this.emit('autonomy:event', action);
        this.log.write({
          type: 'autonomy',
          command: action.rule,
          response: action.speak || action.card?.body || alert.body || '',
          source: 'autonomy'
        });
      }
      return actions;
    } catch {
      return [];
    }
  }
}

module.exports = { AutonomyService };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (70 tests).

- [ ] **Step 5: Commit**

```bash
git add core/autonomy-service.js test/autonomy.test.js
git commit -m "feat(autonomy): background service — applies rules, emits autonomy:event, logs as autonomy"
```

---

### Task 4: Camera service `notifyGate` hook

**Files:**
- Modify: `core/camera/camera-service.js` (constructor ~line 14-27; `#handleAlert` ~line 58-77)
- Test: `test/camera.test.js` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `CameraService` constructor accepts optional `notifyGate: ({kind, name, body}) => boolean` (default `() => true`). When it returns `false`, `#handleAlert` skips `this.notify(...)` only — the activity log entry and the `cameras:alert` emission are unchanged.

- [ ] **Step 1: Write the failing test**

Append to `test/camera.test.js` (reuses the file's existing `fakeConfig`, `fakeGo2rtc`, and `RtspDriver` helpers):

```js
test('camera service: notifyGate can silence the notification without touching the alert pipeline', async () => {
  const config = fakeConfig();
  const notified = [];
  const emitted = [];
  const gateCalls = [];
  class NoisyDriver2 extends RtspDriver {
    async connect() { this.setState('connected'); }
  }
  const service = new CameraService({
    config, go2rtc: fakeGo2rtc(),
    emit: (channel, payload) => emitted.push({ channel, payload }),
    log: { write: () => {} },
    notify: (title, body) => notified.push({ title, body }),
    notifyGate: (alert) => { gateCalls.push(alert); return alert.kind !== 'motion'; },
    driverClasses: { rtsp: NoisyDriver2 }
  });
  await service.init();
  await service.addRtspAccount({ name: 'Home', cameras: [{ name: 'Yard', url: 'rtsp://u:p@h/s' }] });
  const [camera] = await service.listCameras();
  const driver = service.drivers.get(camera.accountId);

  driver.emit('motion', { cameraId: camera.id, name: 'Yard' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(notified.length, 0, 'gated motion shows no Windows notification');
  assert.ok(emitted.some((event) => event.channel === 'cameras:alert' && event.payload.kind === 'motion'), 'the alert still reaches the UI');
  assert.equal(gateCalls.length, 1);
  assert.equal(gateCalls[0].kind, 'motion');
  assert.equal(gateCalls[0].name, 'Yard');
});
```

(The existing test `alerts pipeline notifies, logs, dedupes, and emits` already proves the default — no `notifyGate` — keeps today's behavior.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `notified.length` is 1, because the gate is not consulted yet.

- [ ] **Step 3: Implement**

In `core/camera/camera-service.js`:

Constructor — change the destructuring and add the field:

```js
  constructor({ config, emit, log, go2rtc, driverClasses, notify, notifyGate }) {
```

and after `this.notify = notify || (() => {});` add:

```js
    this.notifyGate = notifyGate || (() => true); // autonomy may veto the Windows notification only
```

In `#handleAlert`, replace the line
`this.notify(\`JARVIS · ${kind === 'doorbell' ? 'DOORBELL' : 'MOTION'}\`, body);`
with:

```js
      let showNotification = true;
      try { showNotification = this.notifyGate({ kind, name, body }) !== false; } catch {}
      if (showNotification) this.notify(`JARVIS · ${kind === 'doorbell' ? 'DOORBELL' : 'MOTION'}`, body);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (71 tests).

- [ ] **Step 5: Commit**

```bash
git add core/camera/camera-service.js test/camera.test.js
git commit -m "feat(camera): optional notifyGate hook so autonomy can quiet daytime motion notifications"
```

---

### Task 5: Main-process + preload wiring

**Files:**
- Modify: `main.js` (module-level service variables near the other `let` declarations; `app.whenReady` block, lines ~556-596)
- Modify: `preload.js` (after `onCamerasStatus`, line ~61)

**Interfaces:**
- Consumes: `AutonomyService` (Task 3), camera `notifyGate` (Task 4).
- Produces: renderer-visible bridge `window.jarvis.onAutonomyEvent(callback)` delivering `{rule, tier, speak?, card?}` payloads.

- [ ] **Step 1: Wire the service in `main.js`**

Add `AutonomyService` to the requires at the top of `main.js`, next to the other core requires:

```js
const { AutonomyService } = require('./core/autonomy-service');
```

Add `autonomy` to the module-level service variable declarations (the `let` list that already holds `config`, `log`, `cameras`, `router`, `folderWatch`, …):

```js
let autonomy;
```

In `app.whenReady`, construct it right after `log = new ActivityLog(...)` (it must exist before `CameraService`):

```js
  autonomy = new AutonomyService({ config, emit: sendEverywhere, log });
```

Change the `CameraService` construction so autonomy sees every alert and can gate notifications — replace:

```js
  cameras = new CameraService({
    config, emit: sendEverywhere, log, go2rtc,
    notify: (title, body) => {
      if (Notification.isSupported()) new Notification({ title, body, icon: path.join(__dirname, 'assets', 'icon.png') }).show();
    }
  });
```

with:

```js
  cameras = new CameraService({
    config, log, go2rtc,
    // Autonomy listens where the alert is born: same payload the UI gets.
    emit: (channel, payload) => {
      sendEverywhere(channel, payload);
      if (channel === 'cameras:alert') autonomy.handleCameraAlert(payload);
    },
    notify: (title, body) => {
      if (Notification.isSupported()) new Notification({ title, body, icon: path.join(__dirname, 'assets', 'icon.png') }).show();
    },
    notifyGate: (alert) => autonomy.notifyGate(alert)
  });
```

- [ ] **Step 2: Add the preload bridge**

In `preload.js`, after the `onCamerasStatus` line add:

```js
  onAutonomyEvent: (callback) => on('autonomy:event', callback),
```

- [ ] **Step 3: Run the tests**

Run: `npm test`
Expected: PASS (71 tests — nothing here is unit-covered, but nothing may break).

- [ ] **Step 4: Commit**

```bash
git add main.js preload.js
git commit -m "feat(autonomy): wire the service into camera alerts and expose onAutonomyEvent to the UI"
```

---

### Task 6: Settings UI + "someone's here" card

**Files:**
- Modify: `src/index.html` (AUTONOMY settings section after the BEHAVIOR section ~line 274; card container inside the workspace markup near the response readout)
- Modify: `src/renderer.js` (`openSettings` field population ~line 740-752; `saveSettings` patch ~line 754-777; new `showAutonomyCard` + `onAutonomyEvent` subscription next to the other `window.jarvis.onXxx` subscriptions)
- Modify: `src/styles.css` (append card styles)

**Interfaces:**
- Consumes: `window.jarvis.onAutonomyEvent` (Task 5), settings keys (Task 2), existing `speak()` (renderer line 179 — already respects the SPOKEN REPLIES toggle), existing `$()` helper and `.toggle-row` settings styling.
- Produces: element ids used below — `setting-autonomy`, `setting-autonomy-doorbell`, `setting-autonomy-night`, `setting-autonomy-card`, `setting-autonomy-motion`, `setting-autonomy-night-start`, `setting-autonomy-night-end`, `autonomy-cards`.

- [ ] **Step 1: Add the AUTONOMY settings section**

In `src/index.html`, insert a new `<section>` immediately after the BEHAVIOR section's closing `</section>` (after the ANIMATION MODE label, ~line 274):

```html
          <section>
            <h3>AUTONOMY</h3>
            <label class="toggle-row"><span><b>AUTONOMY MASTER SWITCH</b><small>Off: JARVIS never speaks or acts on his own</small></span><input id="setting-autonomy" type="checkbox"><i></i></label>
            <label class="toggle-row"><span><b>SPEAK THE DOORBELL</b><small>Say who is at the door out loud</small></span><input id="setting-autonomy-doorbell" type="checkbox"><i></i></label>
            <label class="toggle-row"><span><b>"SOMEONE'S HERE" CARD</b><small>Show a doorbell card with the camera picture</small></span><input id="setting-autonomy-card" type="checkbox"><i></i></label>
            <label class="toggle-row"><span><b>SPOKEN MOTION SUMMARY</b><small>Say motion alerts out loud</small></span><input id="setting-autonomy-motion" type="checkbox"><i></i></label>
            <label class="toggle-row"><span><b>NIGHT-ONLY MOTION ALERTS</b><small>Quiet motion pop-ups during the day</small></span><input id="setting-autonomy-night" type="checkbox"><i></i></label>
            <label>NIGHT STARTS<select id="setting-autonomy-night-start"></select></label>
            <label>NIGHT ENDS<select id="setting-autonomy-night-end"></select></label>
            <small>Everything here is off until you turn it on. Autonomy only announces — it never sends, spends, deletes, or runs anything without asking.</small>
          </section>
```

- [ ] **Step 2: Add the card container**

In `src/index.html`, inside the workspace/stage markup directly before the response readout element (search for the element that `setResponse` writes to — the readout near the command input), add:

```html
      <div id="autonomy-cards"></div>
```

- [ ] **Step 3: Wire the renderer**

In `src/renderer.js`:

(a) Add the hour-select filler and card renderer near `pushTimeline` (~line 602):

```js
function fillHourSelect(select) {
  if (select.options.length) return;
  for (let hour = 0; hour < 24; hour += 1) {
    const option = document.createElement('option');
    option.value = String(hour);
    const clock = hour % 12 === 0 ? 12 : hour % 12;
    option.textContent = `${clock} ${hour < 12 ? 'AM' : 'PM'}`;
    select.appendChild(option);
  }
}

function showAutonomyCard(card) {
  const holder = $('autonomy-cards');
  if (!holder) return;
  const item = document.createElement('div');
  item.className = 'autonomy-card';
  const text = document.createElement('div');
  const title = document.createElement('b');
  title.textContent = card.title || 'JARVIS NOTICED';
  const body = document.createElement('span');
  body.textContent = card.body || '';
  text.append(title, body);
  if (card.jpegBase64) {
    const photo = document.createElement('img');
    photo.src = `data:image/jpeg;base64,${card.jpegBase64}`;
    photo.alt = 'Camera picture';
    item.appendChild(photo);
  }
  item.appendChild(text);
  item.addEventListener('click', () => item.remove());
  holder.prepend(item);
  while (holder.children.length > 3) holder.lastChild.remove();
  setTimeout(() => { if (item.parentNode) item.remove(); }, 30000);
}
```

(b) Subscribe next to the other `window.jarvis.onXxx` subscriptions (same block as `onTasksChanged`):

```js
  window.jarvis.onAutonomyEvent((action) => {
    if (action.speak) speak(action.speak);
    if (action.card) showAutonomyCard(action.card);
  });
```

(c) In `openSettings` (after the `$('setting-motion').value = ...` line):

```js
  fillHourSelect($('setting-autonomy-night-start'));
  fillHourSelect($('setting-autonomy-night-end'));
  $('setting-autonomy').checked = state.settings.autonomyEnabled === true;
  const autonomyRules = state.settings.autonomyRules || {};
  $('setting-autonomy-doorbell').checked = autonomyRules.speakDoorbell === true;
  $('setting-autonomy-card').checked = autonomyRules.someoneHereCard === true;
  $('setting-autonomy-motion').checked = autonomyRules.speakMotion === true;
  $('setting-autonomy-night').checked = autonomyRules.nightMotionOnly === true;
  $('setting-autonomy-night-start').value = String(state.settings.autonomyNightStart ?? 21);
  $('setting-autonomy-night-end').value = String(state.settings.autonomyNightEnd ?? 7);
```

(d) In `saveSettings`, add to the `patch` object (after `motionMode`):

```js
    autonomyEnabled: $('setting-autonomy').checked,
    autonomyRules: {
      speakDoorbell: $('setting-autonomy-doorbell').checked,
      nightMotionOnly: $('setting-autonomy-night').checked,
      someoneHereCard: $('setting-autonomy-card').checked,
      speakMotion: $('setting-autonomy-motion').checked
    },
    autonomyNightStart: Number($('setting-autonomy-night-start').value),
    autonomyNightEnd: Number($('setting-autonomy-night-end').value),
```

- [ ] **Step 4: Style the card**

Append to `src/styles.css`:

```css
#autonomy-cards { position:absolute; right:28px; bottom:150px; z-index:24; display:flex; flex-direction:column; gap:8px; width:264px; pointer-events:none; }
.autonomy-card { display:flex; gap:10px; align-items:center; padding:10px; pointer-events:auto; cursor:pointer; background:linear-gradient(145deg,rgba(8,19,25,.96),rgba(2,8,12,.92)); border:1px solid rgba(255,178,31,.38); box-shadow:0 14px 44px rgba(0,0,0,.45),0 0 26px rgba(255,150,0,.09); animation:assemble .45s cubic-bezier(.15,.9,.2,1); }
.autonomy-card img { width:64px; height:48px; object-fit:cover; border:1px solid var(--line); }
.autonomy-card b { display:block; color:var(--amber); font:600 8px/1 var(--tech); letter-spacing:.16em; }
.autonomy-card span { display:block; margin-top:5px; color:#9eb5bb; font-size:10px; line-height:1.35; }
```

(The `assemble` keyframe already exists — it animates `.module.spotlight`.)

- [ ] **Step 5: Run tests + smoke-check the renderer loads**

Run: `npm test`
Expected: PASS (71 tests).

Headless smoke check (writes a screenshot then quits — proves the renderer boots with the new markup and JS):

PowerShell: `$env:JARVIS_CAPTURE_PATH = "$env:TEMP\jarvis-autonomy-smoke.png"; npm start; $env:JARVIS_CAPTURE_PATH = $null`
Expected: a PNG is written and the app exits cleanly with no renderer console errors.

- [ ] **Step 6: Commit**

```bash
git add src/index.html src/renderer.js src/styles.css
git commit -m "feat(autonomy): AUTONOMY settings section, spoken alerts, and someone's-here card"
```

---

### Task 7: Changelog + final verification

**Files:**
- Modify: `CHANGELOG.md` (new entry at the top, matching the file's existing entry format)

- [ ] **Step 1: Add the changelog entry**

Follow the existing format in `CHANGELOG.md` (read the top entry first and mirror its heading style). Content:

```markdown
### Autonomy engine + camera reactions (slice 1)
- New AUTONOMY settings section: master switch plus four rules, all off by default.
- JARVIS can speak the doorbell aloud, speak motion alerts, show a "someone's here" card with the camera picture, and quiet daytime motion pop-ups (night window configurable, default 9 PM–7 AM).
- Autonomy only announces: nothing is sent, spent, deleted, or executed without the usual approval card. Everything it does shows in the Activity log.
```

- [ ] **Step 2: Full verification**

Run: `npm test`
Expected: PASS — 71 tests, 0 fail.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for autonomy slice 1"
```

---

## Manual verification for Adam (after the build — real Windows, real cameras)

1. Open Settings → AUTONOMY: confirm everything is OFF by default and nothing speaks or pops up on camera events beyond today's behavior.
2. Turn on the master switch + SPEAK THE DOORBELL, ring the real Ring doorbell: JARVIS speaks the description, the Activity log shows an `autonomy` entry.
3. Turn on "SOMEONE'S HERE" CARD, ring again: card appears bottom-right with the snapshot, disappears after 30 s or on click.
4. Turn on NIGHT-ONLY MOTION ALERTS during the day, walk past a camera: no Windows pop-up, but the camera tile still updates. Set NIGHT STARTS to the current hour: pop-ups return.
5. Turn the master switch OFF: everything above stops instantly.
