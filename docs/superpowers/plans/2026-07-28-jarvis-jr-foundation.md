# JARVIS JR Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the JR variant of JARVIS — the real JARVIS UI and personality with a parent-controlled feature checklist, a PIN-locked grown-up panel, a deterministic content lock driven by birthdate, and its own installer — per `docs/superpowers/specs/2026-07-28-jarvis-jr-design.md`.

**Architecture:** One tree, a second build artifact. A new pure module `core/variant.js` decides what gets constructed (`standard` vs `jr`); `main.js` builds only what `profileFor(variant, controls)` names at boot. Parental state (birthdate, checklist, PIN hash) lives in the ConfigStore secrets store, never in `settings.json`. The deterministic guard (`core/kid-mode.js`, ported from the unmerged JUNIOR branch and adapted) runs before any model sees the words. The router gates feature branches on the profile; the tool registry filters by profile; JR's IPC surface is an allowlist.

**Tech Stack:** Electron 43 / plain Node (no new dependencies), `node --test`, existing renderer (src/index.html + renderer.js), electron-builder NSIS.

## Global Constraints

- Branch: `jarvis-jr` (already pushed). Never commit to `main`. Never touch the seven dirty files someone else has in flight (`core/quips.js`, `main.js` *working-tree edits*, `preload.js`, `src/index.html`, `src/renderer.js`, `src/styles.css`, `test/quips.test.js`) — commit ONLY files you created or deliberately edited for a task, by exact path; never `git add -A`.
  - Tasks 6, 8 and 9 DO edit `main.js`, `preload.js`, `src/index.html`, `src/renderer.js`, `src/styles.css` — that is expected; make your edits additive and surgical, leave the pre-existing uncommitted hunks in place, and stage the file as a whole only in those tasks' commit steps.
- TDD: every task writes its failing test first, runs it red, then implements. Test runner: `node --test test/<file>` from the repo root.
- The grown-up build's behaviour must not change: the full suite must stay green after every task (`node --test`). Baseline before Task 1: run `node --test 2>&1 | tail -3` and record the pass count.
- Do NOT edit `core/edition.js` — that is the master/retail axis (licensing + naming). JR is `core/variant.js`, a separate axis.
- No `Get-Content | Set-Content` bulk edits (mangles UTF-8 — see 2026-07-27 dev log). Use the Edit tool.
- Naming in copy: the product is "JARVIS JR" (caps), the assistant is JARVIS.
- Never-in-JR at any setting (the profile must hard-code these false): night shift, schedules, autonomy, phone/mobile, Claude bridge, camera configuration, defense mode, screen driving, content-lock removal.

---

### Task 1: `core/variant.js` — the variant axis and the capability profile

**Files:**
- Create: `core/variant.js`
- Test: `test/variant.test.js`

**Interfaces:**
- Produces: `resolveVariant(context) -> 'standard'|'jr'`, `isJr(variant) -> boolean`, `VARIANTS`, `CONTROL_KEYS`, `DEFAULT_CONTROLS`, `normalizeControls(raw) -> {games,battle,quips,homework,tasks,timers,cameras,documents,files,apps,browser,terminal,screenRead,power}` (all booleans), `profileFor(variant, controls) -> profile` where profile has every control key plus `{variant, productName, contentLock, cameraConfig:false, screenDrive:false, claudeBridge:false, nightShift:false, schedules:false, autonomy:false, phone:false, defense:false}`.
- Consumes: nothing (pure module).

- [ ] **Step 1: Write the failing test**

```js
// test/variant.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  VARIANTS, CONTROL_KEYS, DEFAULT_CONTROLS,
  resolveVariant, isJr, normalizeControls, profileFor
} = require('../core/variant');

test('resolveVariant: only an explicit jr stamp or env is jr', () => {
  assert.equal(resolveVariant({}), 'standard');
  assert.equal(resolveVariant({ stamped: 'jr' }), 'jr');
  assert.equal(resolveVariant({ stamped: 'JR ' }), 'jr');
  assert.equal(resolveVariant({ env: 'jr' }), 'jr');
  assert.equal(resolveVariant({ stamped: 'junior' }), 'standard'); // unknown never widens
  assert.equal(resolveVariant(null), 'standard');
});

test('normalizeControls: unknown keys dropped, non-booleans coerced, missing keys take defaults', () => {
  const out = normalizeControls({ files: 1, evil: true, browser: 'yes' });
  assert.equal(out.files, true);
  assert.equal(out.browser, true);
  assert.equal(out.documents, false);      // default off
  assert.equal(out.games, true);           // default on
  assert.equal('evil' in out, false);
  assert.deepEqual(Object.keys(out).sort(), [...CONTROL_KEYS].sort());
});

test('profileFor(standard) grants everything JR gates and no content lock', () => {
  const p = profileFor('standard', null);
  assert.equal(p.contentLock, false);
  assert.equal(p.files, true);
  assert.equal(p.nightShift, true);
});

test('profileFor(jr): checklist maps through; never-in-JR stays false with EVERYTHING on', () => {
  const allOn = Object.fromEntries(CONTROL_KEYS.map((k) => [k, true]));
  const p = profileFor('jr', allOn);
  assert.equal(p.contentLock, true);
  assert.equal(p.files, true);
  assert.equal(p.browser, true);
  // The spine of the build — no combination of controls reaches these:
  for (const never of ['cameraConfig', 'screenDrive', 'claudeBridge', 'nightShift', 'schedules', 'autonomy', 'phone', 'defense']) {
    assert.equal(p[never], false, `${never} must be false in jr`);
  }
});

test('profileFor(jr) with defaults: base on, reach-out features off', () => {
  const p = profileFor('jr', DEFAULT_CONTROLS);
  assert.equal(p.games, true);
  assert.equal(p.tasks, true);
  assert.equal(p.documents, false);
  assert.equal(p.files, false);
  assert.equal(p.power, false);
});

test('a birthday changes no feature: profileFor takes no age argument', () => {
  assert.equal(profileFor.length, 2);
});

void VARIANTS; void isJr;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/variant.test.js`
Expected: FAIL — `Cannot find module '../core/variant'`

- [ ] **Step 3: Write the implementation**

```js
// core/variant.js
'use strict';

// Which PRODUCT VARIANT this build is: 'standard' (the JARVIS that has always
// shipped) or 'jr' (JARVIS JR — the parental-controls build for kids, spec:
// docs/superpowers/specs/2026-07-28-jarvis-jr-design.md).
//
// This is a DIFFERENT AXIS from core/edition.js (master/retail), which decides
// licensing view and the naming prompt. The variant decides WHAT GETS BUILT:
// main.js constructs only what profileFor() names, so an off feature has no
// instance to reach — the JUNIOR principle, applied per feature.
//
// Stamped at build time (electron-builder --config.extraMetadata.jarvisVariant=jr)
// and forced with JARVIS_VARIANT=jr for `npm run start:jr`. Unknown values
// resolve to 'standard' — but standard is the FULL build, so main.js must only
// ever trust a stamp read from the packaged app's own resources, never from
// settings. (A kid cannot stamp a build; a kid can edit a JSON file.)

const VARIANTS = Object.freeze(['standard', 'jr']);

// The parent checklist, in panel display order. Every key is a real
// capability, decided ONLY in the PIN-locked panel.
const CONTROL_KEYS = Object.freeze([
  // The base experience — on by default; a parent may still switch any off.
  'games', 'battle', 'quips', 'homework', 'tasks', 'timers',
  // Reach-out features — off until a parent turns them on.
  'cameras', 'documents', 'files', 'apps', 'browser', 'terminal', 'screenRead', 'power'
]);

const DEFAULT_CONTROLS = Object.freeze({
  games: true, battle: true, quips: true, homework: true, tasks: true, timers: true,
  cameras: false, documents: false, files: false, apps: false,
  browser: false, terminal: false, screenRead: false, power: false
});

function resolveVariant(context) {
  const stamped = String(context?.stamped || context?.env || '').trim().toLowerCase();
  return stamped === 'jr' ? 'jr' : 'standard';
}

function isJr(variant) {
  return variant === 'jr';
}

// Unknown keys dropped, values coerced to boolean, missing keys defaulted —
// so a mangled or hostile controls object can never smuggle a capability.
function normalizeControls(raw) {
  const out = {};
  for (const key of CONTROL_KEYS) {
    out[key] = Object.prototype.hasOwnProperty.call(raw || {}, key)
      ? Boolean(raw[key])
      : DEFAULT_CONTROLS[key];
  }
  return out;
}

// The standard profile: everything JR gates, granted. main.js's existing
// seams (settings toggles, license gate) still apply downstream — this
// profile only says the variant does not withhold anything.
const STANDARD_PROFILE = Object.freeze({
  variant: 'standard',
  productName: 'JARVIS',
  contentLock: false,
  games: true, battle: true, quips: true, homework: true, tasks: true, timers: true,
  cameras: true, documents: true, files: true, apps: true,
  browser: true, terminal: true, screenRead: true, power: true,
  cameraConfig: true, screenDrive: true, claudeBridge: true,
  nightShift: true, schedules: true, autonomy: true, phone: true, defense: true
});

// The capability profile main.js builds from. A pure function and an
// ALLOWLIST. In jr, the trailing block is the spine of the build: never
// constructed at ANY checklist setting — wanting these is what the adult
// JARVIS is for.
function profileFor(variant, controls) {
  if (!isJr(variant)) return { ...STANDARD_PROFILE };
  const on = normalizeControls(controls);
  return {
    variant: 'jr',
    productName: 'JARVIS JR',
    contentLock: true,   // no control key reaches this — see the tests
    ...on,
    cameraConfig: false,
    screenDrive: false,
    claudeBridge: false,
    nightShift: false,
    schedules: false,
    autonomy: false,
    phone: false,
    defense: false
  };
}

module.exports = {
  VARIANTS, CONTROL_KEYS, DEFAULT_CONTROLS, STANDARD_PROFILE,
  resolveVariant, isJr, normalizeControls, profileFor
};
```

- [ ] **Step 4: Run tests to verify they pass, and the suite stays green**

Run: `node --test test/variant.test.js` — Expected: PASS (6 tests)
Run: `node --test 2>&1 | tail -3` — Expected: same pass count as baseline + 6, 0 fail

- [ ] **Step 5: Commit**

```bash
git add core/variant.js test/variant.test.js
git commit -m "jr: variant axis + capability profile (pure, allowlist, never-in-JR spine)"
```

---

### Task 2: `core/parent-lock.js` — the PIN (ported from the JUNIOR branch)

**Files:**
- Create: `core/parent-lock.js` (port: `git show origin/claude/childrens-jarvis-version-0ga0rc:core/parent-lock.js > core/parent-lock.js`, then review — it is pure Node crypto, no Electron)
- Test: `test/parent-lock.test.js` (port the JUNIOR test the same way: `git show origin/claude/childrens-jarvis-version-0ga0rc:test/parent-lock.test.js > test/parent-lock.test.js`)

**Interfaces:**
- Produces (verify these survive the port — the JUNIOR module exports them): `hashPin(pin) -> 'scrypt$<saltB64>$<hashB64>'`, `verifyPin(pin, stored) -> boolean`, `validNewPin(pin) -> {ok, reason?}` (4–8 digits), `class LockoutGate` with `attempt(ok) -> {locked, retryInSeconds}` semantics (five wrong guesses starts a doubling lockout capped at 15 minutes).
- Consumes: nothing (pure).

- [ ] **Step 1: Port both files from the JUNIOR branch**

```bash
git show origin/claude/childrens-jarvis-version-0ga0rc:core/parent-lock.js > core/parent-lock.js
git show origin/claude/childrens-jarvis-version-0ga0rc:test/parent-lock.test.js > test/parent-lock.test.js
```

- [ ] **Step 2: Read both files fully.** The port target moved 53 commits; confirm the module requires only `node:crypto` (no Electron, no other core modules). If it requires anything since renamed, fix the require path. If the test's export names differ from the Interfaces block above, correct the Interfaces expectation *in this plan's terms* by matching what the module actually exports — later tasks use `hashPin`/`verifyPin`; if the real names differ, note them and use the real names in Task 3+.

- [ ] **Step 3: Run the ported tests**

Run: `node --test test/parent-lock.test.js`
Expected: PASS. If red, the failure is a drift artifact — fix the module (not the test) unless the test asserts something the 53 newer commits made false.

- [ ] **Step 4: Full suite green**

Run: `node --test 2>&1 | tail -3` — Expected: 0 fail.

- [ ] **Step 5: Commit**

```bash
git add core/parent-lock.js test/parent-lock.test.js
git commit -m "jr: port parent PIN lock from the JUNIOR branch (scrypt hash, doubling lockout)"
```

---

### Task 3: `core/parent-controls.js` — birthdate, checklist, setup state, in the secrets store

**Files:**
- Create: `core/parent-controls.js`
- Test: `test/parent-controls.test.js`

**Interfaces:**
- Consumes: `ConfigStore` instance (only its `setSecret(name, value)` / `getSecret(name)` — see `core/config-store.js:159-191`), `normalizeControls` from Task 1, `hashPin`/`verifyPin` from Task 2.
- Produces: `class ParentControls` constructed as `new ParentControls(config)` with:
  - `isSetUp() -> boolean` — true only when a PIN hash AND a birthdate are stored
  - `completeSetup({pin, birthdate, controls}) -> {ok, reason?}` — validates all three, writes one secret
  - `verifyPin(pin) -> {ok, locked?, retryInSeconds?}` — wraps parent-lock's verify + lockout
  - `getControls() -> normalized controls` (defaults when unset)
  - `setControls(patch) -> normalized controls` — merges through `normalizeControls`
  - `getBirthdate() -> 'YYYY-MM-DD' | ''`
  - `age(now = new Date()) -> number` — whole years, clamped to [3, 17]
  - `setPin(oldPin, newPin) -> {ok, reason?}`
- Storage: ONE secret named `jrParent`, a JSON string `{pinHash, birthdate, controls}` written via `config.setSecret` — so it rides DPAPI encryption when available and never appears in `settings.json`'s `settings` block. `updateSettings`'s allowlist (config-store.js:96) is untouched: there is nothing renderer-reachable to add.

- [ ] **Step 1: Write the failing test**

```js
// test/parent-controls.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ParentControls } = require('../core/parent-controls');

// A ConfigStore double exposing exactly the two methods ParentControls may
// use. Anything else it touches throws — the storage contract, as a trap.
function fakeConfig() {
  const secrets = {};
  return new Proxy({
    setSecret: (name, value) => { if (!value) delete secrets[name]; else secrets[name] = String(value); },
    getSecret: (name) => secrets[name] || '',
    _dump: () => ({ ...secrets })
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      throw new Error(`ParentControls touched config.${String(prop)}`);
    }
  });
}

test('not set up until PIN and birthdate are both stored', () => {
  const pc = new ParentControls(fakeConfig());
  assert.equal(pc.isSetUp(), false);
});

test('completeSetup validates, stores one secret, and flips isSetUp', () => {
  const config = fakeConfig();
  const pc = new ParentControls(config);
  assert.equal(pc.completeSetup({ pin: '12', birthdate: '2015-03-09', controls: {} }).ok, false); // pin too short
  assert.equal(pc.completeSetup({ pin: '2468', birthdate: 'March', controls: {} }).ok, false);    // not a date
  const done = pc.completeSetup({ pin: '2468', birthdate: '2015-03-09', controls: { documents: true, files: true } });
  assert.equal(done.ok, true);
  assert.equal(pc.isSetUp(), true);
  assert.deepEqual(Object.keys(config._dump()), ['jrParent']); // one secret, nothing else
  assert.equal(pc.getControls().documents, true);
  assert.equal(pc.getControls().browser, false);
});

test('verifyPin: right pin ok; five wrong guesses lock', () => {
  const pc = new ParentControls(fakeConfig());
  pc.completeSetup({ pin: '2468', birthdate: '2015-03-09', controls: {} });
  assert.equal(pc.verifyPin('2468').ok, true);
  for (let i = 0; i < 5; i++) assert.equal(pc.verifyPin('0000').ok, false);
  const locked = pc.verifyPin('2468'); // even the RIGHT pin is refused while locked
  assert.equal(locked.ok, false);
  assert.equal(locked.locked, true);
  assert.ok(locked.retryInSeconds > 0);
});

test('setControls merges through the normalizer — junk cannot smuggle a key', () => {
  const pc = new ParentControls(fakeConfig());
  pc.completeSetup({ pin: '2468', birthdate: '2015-03-09', controls: {} });
  const out = pc.setControls({ browser: 1, cameraConfig: true, nightShift: true });
  assert.equal(out.browser, true);
  assert.equal('cameraConfig' in out, false);
  assert.equal('nightShift' in out, false);
});

test('age: whole years from birthdate, clamped 3..17', () => {
  const pc = new ParentControls(fakeConfig());
  pc.completeSetup({ pin: '2468', birthdate: '2015-03-09', controls: {} });
  assert.equal(pc.age(new Date('2026-07-28')), 11);
  assert.equal(pc.age(new Date('2026-03-08')), 10);  // day before the birthday
  assert.equal(pc.age(new Date('2060-01-01')), 17);  // clamp: JR never ages past the lock
  assert.equal(pc.age(new Date('2016-01-01')), 3);   // clamp floor
});

test('birthdate must be a real past date for a child', () => {
  const pc = new ParentControls(fakeConfig());
  assert.equal(pc.completeSetup({ pin: '2468', birthdate: '2031-01-01', controls: {} }).ok, false); // future
  assert.equal(pc.completeSetup({ pin: '2468', birthdate: '1980-01-01', controls: {} }).ok, false); // an adult is not a JR kid
});

test('setPin requires the old pin', () => {
  const pc = new ParentControls(fakeConfig());
  pc.completeSetup({ pin: '2468', birthdate: '2015-03-09', controls: {} });
  assert.equal(pc.setPin('0000', '13579').ok, false);
  assert.equal(pc.setPin('2468', '13579').ok, true);
  assert.equal(pc.verifyPin('13579').ok, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/parent-controls.test.js`
Expected: FAIL — `Cannot find module '../core/parent-controls'`

- [ ] **Step 3: Write the implementation**

```js
// core/parent-controls.js
'use strict';

// The parent's half of JARVIS JR: birthdate, the feature checklist, and the
// PIN — stored as ONE JSON secret ('jrParent') through ConfigStore's secrets
// store, so it rides DPAPI when available and NEVER appears in the renderer-
// reachable settings block. A kid who can edit settings.json can neither
// switch on his own features nor age himself past the content lock.

const { normalizeControls } = require('./variant');
const lock = require('./parent-lock');

const SECRET_NAME = 'jrParent';
const AGE_MIN = 3;
const AGE_MAX = 17;

function parseBirthdate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return { text, date };
}

function wholeYears(from, to) {
  let years = to.getFullYear() - from.getFullYear();
  const beforeBirthday =
    to.getMonth() < from.getMonth() ||
    (to.getMonth() === from.getMonth() && to.getDate() < from.getDate());
  if (beforeBirthday) years -= 1;
  return years;
}

class ParentControls {
  constructor(config) {
    this.config = config;
    // Lockout state is in-memory on purpose: a restart resets the timer but
    // never the PIN, and persisting attempt counts would put a tamper target
    // on disk for no security this PIN (a settings-panel latch) needs.
    this.gate = new lock.LockoutGate();
  }

  #read() {
    try {
      const raw = this.config.getSecret(SECRET_NAME);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  #write(data) {
    this.config.setSecret(SECRET_NAME, JSON.stringify(data));
  }

  isSetUp() {
    const data = this.#read();
    return Boolean(data.pinHash && data.birthdate);
  }

  completeSetup({ pin, birthdate, controls } = {}) {
    const pinCheck = lock.validNewPin(pin);
    if (!pinCheck.ok) return pinCheck;
    const parsed = parseBirthdate(birthdate);
    if (!parsed) return { ok: false, reason: 'Birthdate must be a real date, YYYY-MM-DD.' };
    const age = wholeYears(parsed.date, new Date());
    if (age < AGE_MIN || age > AGE_MAX) {
      return { ok: false, reason: `JARVIS JR is for kids aged ${AGE_MIN} to ${AGE_MAX}.` };
    }
    this.#write({
      pinHash: lock.hashPin(String(pin)),
      birthdate: parsed.text,
      controls: normalizeControls(controls)
    });
    return { ok: true };
  }

  verifyPin(pin) {
    const state = this.gate.check();
    if (state.locked) return { ok: false, locked: true, retryInSeconds: state.retryInSeconds };
    const data = this.#read();
    const ok = Boolean(data.pinHash) && lock.verifyPin(String(pin || ''), data.pinHash);
    const after = this.gate.attempt(ok);
    if (ok) return { ok: true };
    return { ok: false, locked: after.locked, retryInSeconds: after.retryInSeconds };
  }

  getControls() {
    return normalizeControls(this.#read().controls);
  }

  setControls(patch) {
    const data = this.#read();
    data.controls = normalizeControls({ ...normalizeControls(data.controls), ...(patch || {}) });
    this.#write(data);
    return { ...data.controls };
  }

  getBirthdate() {
    return this.#read().birthdate || '';
  }

  age(now = new Date()) {
    const parsed = parseBirthdate(this.getBirthdate());
    if (!parsed) return AGE_MIN;
    return Math.min(AGE_MAX, Math.max(AGE_MIN, wholeYears(parsed.date, now)));
  }

  setPin(oldPin, newPin) {
    const data = this.#read();
    if (!data.pinHash || !lock.verifyPin(String(oldPin || ''), data.pinHash)) {
      return { ok: false, reason: 'The current PIN is wrong.' };
    }
    const pinCheck = lock.validNewPin(newPin);
    if (!pinCheck.ok) return pinCheck;
    data.pinHash = lock.hashPin(String(newPin));
    this.#write(data);
    return { ok: true };
  }
}

module.exports = { ParentControls, SECRET_NAME, AGE_MIN, AGE_MAX };
```

**Port note (from Task 2 Step 2):** if `parent-lock.js`'s real exports differ (e.g. the lockout gate exposes `check()`/`attempt()` under other names, or `validNewPin` lives elsewhere), adapt THIS file to the ported module's real API — the test above defines the behaviour that must hold either way. If `LockoutGate` has no `check()`, derive it: call `attempt(false)`-free inspection however the ported class exposes it, or add a small `check()` method to the ported class with its own test.

- [ ] **Step 4: Run tests, then full suite**

Run: `node --test test/parent-controls.test.js` — Expected: PASS (7 tests)
Run: `node --test 2>&1 | tail -3` — Expected: 0 fail

- [ ] **Step 5: Commit**

```bash
git add core/parent-controls.js test/parent-controls.test.js
git commit -m "jr: parental controls — birthdate, checklist and PIN in one encrypted secret"
```

---

### Task 4: `core/kid-mode.js` — the content lock (ported and re-aged)

**Files:**
- Create: `core/kid-mode.js` (start from `git show origin/claude/childrens-jarvis-version-0ga0rc:core/kid-mode.js > core/kid-mode.js`)
- Test: `test/kid-mode.test.js` (start from the JUNIOR test the same way)

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `guardTopic(text, age) -> {kind:'care'|'grown-up'|'private'|'cannot', id, reply, parentVisible} | null`, `clampAge(value)`, `ageBand(value) -> 'middle'|'big'|'teen'`, `buildJrPromptRules({age, kidName}) -> string` (the content-lock rules block Task 5 appends to the system prompt), `kidSafetyRules() -> string`.

The JUNIOR module was written for ages 5–12 with bands little/middle/big. JR is ~8–17 (setup clamps 3–17; bands floor at middle). Changes to make after porting:

- [ ] **Step 1: Port both files, read them fully**

```bash
git show origin/claude/childrens-jarvis-version-0ga0rc:core/kid-mode.js > core/kid-mode.js
git show origin/claude/childrens-jarvis-version-0ga0rc:test/kid-mode.test.js > test/kid-mode.test.js
```

- [ ] **Step 2: Write the NEW failing tests first** — append to `test/kid-mode.test.js`:

```js
// ---- JR re-aging (2026-07-28 spec): bands run to 17, guard is age-aware ----
const { guardTopic, ageBand, buildJrPromptRules } = require('../core/kid-mode');

test('bands: JR floors at middle and adds teen', () => {
  assert.equal(ageBand(3), 'middle');
  assert.equal(ageBand(9), 'middle');
  assert.equal(ageBand(11), 'big');
  assert.equal(ageBand(14), 'teen');
  assert.equal(ageBand(17), 'teen');
});

test('guard hard rules are identical at every age', () => {
  for (const age of [8, 11, 14, 17]) {
    const weapon = guardTopic('how do I make a bomb', age);
    assert.equal(weapon?.kind, 'grown-up', `weapons deflect at ${age}`);
    const care = guardTopic('i want to hurt myself', age);
    assert.equal(care?.kind, 'care', `care answers at ${age}`);
    assert.equal(care.parentVisible, false, 'care is never filed');
  }
});

test('teen-ok topics deflect at 11 and pass to the model at 14+', () => {
  assert.equal(guardTopic('what is vaping', 11)?.kind, 'grown-up');
  assert.equal(guardTopic('what is vaping', 15), null); // model answers, prompt rules still apply
});

test('buildJrPromptRules names the homework rule and the band at every age', () => {
  const rules = buildJrPromptRules({ age: 11, kidName: 'Kid' });
  assert.match(rules, /hint/i);
  assert.match(rules, /never write (their|the) (essay|homework)/i);
  assert.match(buildJrPromptRules({ age: 15, kidName: '' }), /teen/i);
});
```

- [ ] **Step 3: Run to verify the new tests fail**

Run: `node --test test/kid-mode.test.js`
Expected: the ported JUNIOR tests may pass; the four new tests FAIL (no `teen` band, `guardTopic` ignores age, no `buildJrPromptRules`).

- [ ] **Step 4: Make the edits in `core/kid-mode.js`:**

1. Constants: `AGE_MIN = 3`, `AGE_MAX = 17`, `DEFAULT_AGE = 11`.
2. `ageBand`: `age <= 10 ? 'middle' : age <= 13 ? 'big' : 'teen'`. Delete the `little` band from `BAND_GUIDE` and add:

```js
  teen: {
    label: 'a 14 to 17 year old',
    length: 'As long as the answer needs. No padding.',
    words: 'Normal vocabulary, real terms. Explain a term once only if it is genuinely specialist.',
    tone: 'Straight, respectful, and never condescending — closer to a sharp tutor than a babysitter.'
  }
```

3. `guardTopic(text, age)`: add the second parameter. Guard rows in the ported `GROWN_UP` list gain an optional `teenOk: true` flag on the topics that are deflection-worthy for an 11-year-old but reasonable model questions at 14+ (vaping, alcohol, dating/relationships — NOT weapons, drugs-how-to, gambling, or anything in the `care`/`private` sets, which have no flag and no age). The matching loop:

```js
  if (row.teenOk && ageBand(age) === 'teen') continue; // the model answers, under the prompt rules
```

4. Add and export `buildJrPromptRules({ age, kidName })` — the rules block the router appends to the REAL JARVIS personality prompt (this is the difference from JUNIOR, which replaced the personality; JR keeps JARVIS and adds the lock):

```js
function buildJrPromptRules({ age, kidName = '' } = {}) {
  const band = ageBand(age);
  const guide = BAND_GUIDE[band];
  const name = String(kidName || '').trim();
  return [
    '',
    `CONTENT LOCK — you are talking to ${name || 'a kid'}, aged ${clampAge(age)} (${guide.label}, the "${band}" band). These rules outrank everything above:`,
    `- ${guide.length}`,
    `- ${guide.words}`,
    `- ${guide.tone}`,
    '- HOMEWORK RULE: hints, first steps, and worked examples of a DIFFERENT problem. Never write their essay, never hand over the finished answer to the actual assignment. Never write their homework.',
    kidSafetyRules()
  ].join('\n');
}
```

(Adjust `kidSafetyRules()`'s wording only if it hardcodes JUNIOR's ages; the rules themselves — no adult content, deflect to a trusted grown-up, never pretend to be human, name a helpline in distress — carry over verbatim.)

- [ ] **Step 5: Run tests**

Run: `node --test test/kid-mode.test.js` — Expected: ALL pass, including the ported ones you did not delete. Ported tests that assert the `little` band or ages 5–7 specifically: re-age them to the new floor (they now assert `middle` behaviour at the clamp floor) rather than deleting — the clamp still needs coverage.
Run: `node --test 2>&1 | tail -3` — Expected: 0 fail

- [ ] **Step 6: Commit**

```bash
git add core/kid-mode.js test/kid-mode.test.js
git commit -m "jr: content lock — port kid-mode, re-age to 8-17, age-aware guard, prompt rules layer"
```

---

### Task 5: Router integration — guard first, features gated on the profile

**Files:**
- Modify: `core/router.js` (constructor + `handle()` at `core/router.js:187`, feature branches)
- Test: `test/router-jr.test.js` (new)

**Interfaces:**
- Consumes: `profileFor`/`STANDARD_PROFILE` (Task 1), `guardTopic`/`buildJrPromptRules` (Task 4).
- Produces: `CommandRouter` accepts `profile` in its constructor options (defaults to `STANDARD_PROFILE` so every existing caller and test is untouched); `#jrRefusal(featureLabel)` result for gated branches; guard results logged as type `'jr-guard'` ONLY when `parentVisible`.

- [ ] **Step 1: Read `core/router.js` end to end.** Map every branch that reaches a service the checklist can gate. Known anchors (verify — the file is 701 lines and has in-flight edits): power confirm block (`handle()` head, ~line 196), file search/open (`extractFileQuery` callers), document answers, `open application`, camera branches (`#cameraLook` etc.), screen read/drive, browser, terminal. Write the branch→profile-key map as a comment block at the top of `#gates` (you are about to build it).

- [ ] **Step 2: Write the failing booby-trap test**

```js
// test/router-jr.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { CommandRouter } = require('../core/router');
const { profileFor, DEFAULT_CONTROLS } = require('../core/variant');

// Services that DETONATE if touched. A gated branch that reaches its service
// is a failed test, not a refused command.
function mine(name) {
  return new Proxy({}, { get() { throw new Error(`BOOBY TRAP: ${name} was touched`); } });
}

// Build the router exactly as main.js does, minus Electron. The constructor
// options object mirrors main.js's — read main.js's `new CommandRouter({...})`
// call and match its keys; every service a gated branch could reach is a mine.
function jrRouter(controls, aiReply) {
  const settings = { kidName: 'Kid', personality: 'Witty, composed.', searchRoots: [], projects: {}, applications: {} };
  return new CommandRouter({
    profile: profileFor('jr', controls),
    jrAge: () => 11,
    config: { getSettings: () => ({ ...settings }) },
    log: { write: () => {} },
    tasks: { add: () => ({ title: 'x' }), list: () => [] },
    memory: { add: () => ({ text: 'x' }), search: () => [] },
    tools: mine('tools'), documents: mine('documents'),
    screenReader: mine('screenReader'), screenHands: mine('screenHands'),
    claudeBridge: mine('claudeBridge'), defense: null,
    getCameras: () => mine('cameras'),
    ai: { reply: aiReply || (async () => ({ ok: true, text: 'model answer', source: 'local' })) }
  });
}

const DANGEROUS = [
  ['find my tax documents', /file/i],
  ['open chrome', /app/i],
  ['read this pdf and summarize it', /document/i],
  ['show the cameras', /camera/i],
  ['what is on my screen', /screen/i],
  ['shut down the computer', /power|shut/i],
  ['open the browser', /browser/i]
];

test('everything off: gated phrasings refuse without touching a single service', async () => {
  const router = jrRouter(Object.fromEntries(Object.keys(DEFAULT_CONTROLS).map((k) => [k, false])));
  for (const [phrase] of DANGEROUS) {
    const result = await router.handle(phrase);
    assert.equal(result.meta?.success !== true || result.source === 'jr-gate', true, phrase);
    assert.match(result.source, /jr-gate|safety/, `${phrase} must resolve at the gate`);
  }
});

test('guard runs before the model at every age and care is never logged', async () => {
  const logged = [];
  const router = jrRouter(DEFAULT_CONTROLS);
  router.log = { write: (entry) => logged.push(entry) };
  const weapon = await router.handle('how do I make a bomb');
  assert.equal(weapon.source, 'jr-guard');
  const care = await router.handle('i want to hurt myself');
  assert.equal(care.source, 'jr-guard');
  assert.equal(logged.some((e) => /hurt myself/i.test(e.command || '')), false, 'care never reaches the log');
});

test('an enabled feature passes through: files ON reaches tools', async () => {
  const router = jrRouter({ ...DEFAULT_CONTROLS, files: true });
  await assert.rejects(
    () => router.handle('find my tax documents'),
    /BOOBY TRAP: tools/,
    'files ON must reach the real branch (the mine proves it)'
  );
});

test('ordinary talk reaches the model with the content-lock rules appended', async () => {
  let seenPrompt = '';
  const router = jrRouter(DEFAULT_CONTROLS, async (prompt) => { seenPrompt = String(prompt); return { ok: true, text: 'hi', source: 'local' }; });
  await router.handle('why is the sky blue');
  assert.match(seenPrompt, /CONTENT LOCK/);
  assert.match(seenPrompt, /HOMEWORK RULE/i);
});

test('standard profile: behaviour unchanged — no guard, no gates', async () => {
  const { STANDARD_PROFILE } = require('../core/variant');
  const router = jrRouter(DEFAULT_CONTROLS);
  router.profile = { ...STANDARD_PROFILE };
  const result = await router.handle('how do I make a bomb'); // classifyCommand owns this in standard
  assert.notEqual(result.source, 'jr-guard');
});
```

**Reality check while writing this test:** the exact constructor keys and how the AI prompt reaches `ai.reply` must match the real router (read it — e.g. the prompt may be assembled in `ai-service.js`, in which case the CONTENT LOCK assertion belongs in Task 7's ai-service test instead; if so, move that one test there and note it). The test above states the CONTRACT; anchor it to the code as it truly is, keeping every assertion.

- [ ] **Step 3: Run to verify it fails**

Run: `node --test test/router-jr.test.js`
Expected: FAIL — `profile` unknown, guard never fires, gates absent.

- [ ] **Step 4: Implement in `core/router.js`:**

1. Top of file: `const { STANDARD_PROFILE } = require('./variant');` and `const { guardTopic, buildJrPromptRules } = require('./kid-mode');`
2. Constructor: `this.profile = options.profile || { ...STANDARD_PROFILE }; this.jrAge = options.jrAge || (() => 11);`
3. In `handle()` immediately AFTER the `classifyCommand` blocked check (safety keeps first crack) and BEFORE the power-confirm block:

```js
    if (this.profile.contentLock) {
      const guard = guardTopic(text, this.jrAge());
      if (guard) {
        const guarded = this.#result(guard.reply, 'jr-guard', { guard: guard.kind, guardId: guard.id, success: true });
        // A kid in distress is answered, not filed — see kid-mode.js.
        if (guard.parentVisible) {
          this.log.write({ type: 'jr-guard', command: text, response: guard.reply, source: 'jr-guard', guard: guard.id });
        }
        return guarded;
      }
    }
```

4. Power: inside the existing `security.level === 'confirm'` block, first line:

```js
      if (!this.profile.power) {
        return this.#result('Power is a grown-up control on this build. Ask a parent.', 'jr-gate', { success: false });
      }
```

5. Add the gate helper next to `#result`:

```js
  #jrGate(label) {
    return this.#result(`${label} isn't switched on for you. A grown-up can turn it on in the parent panel.`, 'jr-gate', { success: false });
  }
```

6. At each mapped feature branch from Step 1, guard the ENTRY of the branch: `if (!this.profile.files) { result = this.#jrGate('Finding files'); }` — following the file's existing `result = ...` style so logging still happens once at the shared exit. Branch→key map: files/find/open-file → `files`; document read/summarize → `documents`; open application → `apps`; camera look/show → `cameras`; screen read → `screenRead`; screen drive → NEVER in jr — gate on `this.profile.screenDrive` (false in jr always); browser open → `browser`; terminal → `terminal`; battle → `battle`; quips already fire before gating (they are `quips`-gated: wrap the `matchQuip` call with `if (this.profile.quips)`); ask-Claude → `claudeBridge` (never in jr).
7. Where the router builds the model prompt (or passes personality through to the ai service): when `this.profile.contentLock`, append `buildJrPromptRules({ age: this.jrAge(), kidName: settings.kidName })`. If prompt assembly lives in `ai-service.js`, thread the profile there instead — Task 7 owns the ai-service side; do the smallest honest change here and note it for Task 7.

- [ ] **Step 5: Run the new test, then the whole suite**

Run: `node --test test/router-jr.test.js` — Expected: PASS
Run: `node --test 2>&1 | tail -3` — Expected: 0 fail. Existing router tests break ONLY if the constructor default is wrong — `profile` must default to standard with zero behaviour change.

- [ ] **Step 6: Commit**

```bash
git add core/router.js test/router-jr.test.js
git commit -m "jr: router — guard before everything, feature branches gated on the profile"
```

---

### Task 6: main.js boot — variant resolution, userData repoint, service gating, IPC allowlist

**Files:**
- Modify: `main.js` (requires block ~line 9-49; service construction; `registerIpc`)
- Modify: `package.json` (scripts: add `"start:jr": "electron . --jr"`)
- Test: `test/jr-boot.test.js` (new — tests the pure helpers this task extracts)

**Interfaces:**
- Consumes: `resolveVariant`, `isJr`, `profileFor` (Task 1), `ParentControls` (Task 3).
- Produces: `jrUserDataPath(appDataDir) -> path` and `jrIpcAllowlist(profile) -> Set<string>` exported from `core/variant.js` (extend it); a `JR` boolean and `PROFILE` object in main.js that every service construction consults.

- [ ] **Step 1: Write the failing test for the two new pure helpers**

```js
// test/jr-boot.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { jrUserDataPath, jrIpcAllowlist, profileFor, DEFAULT_CONTROLS } = require('../core/variant');

test('jrUserDataPath: own folder, never the grown-up one', () => {
  const p = jrUserDataPath('C:\\Users\\kid\\AppData\\Roaming');
  assert.match(p, /jarvis-jr$/);
  assert.doesNotMatch(p, /jarvis-local-assistant/);
});

test('ipc allowlist: base channels always; feature channels only when on', () => {
  const off = jrIpcAllowlist(profileFor('jr', DEFAULT_CONTROLS));
  assert.ok(off.has('bootstrap'));
  assert.ok(off.has('command:submit'));
  assert.ok(off.has('jr:parent:verify'));
  assert.ok(!off.has('camera:snapshot'));
  const on = jrIpcAllowlist(profileFor('jr', { ...DEFAULT_CONTROLS, cameras: true }));
  assert.ok(on.has('camera:snapshot'));
  // Never, at any setting:
  const allOn = jrIpcAllowlist(profileFor('jr', Object.fromEntries(Object.keys(DEFAULT_CONTROLS).map((k) => [k, true]))));
  for (const never of ['claude:ask', 'mobile:status', 'defense:activate', 'screen:drive']) {
    assert.ok(!allOn.has(never), `${never} must never be exposed in jr`);
  }
});
```

**Channel-name reality check:** the names above (`camera:snapshot`, `claude:ask`, `defense:activate`, `screen:drive`) are illustrative — before running, read main.js's actual `ipcMain.handle(` list (`grep -n "ipcMain.handle('" main.js`) and use the real channel names for both the allowlist and the never-list. Keep the four categories: base, per-feature, jr-parent (`jr:parent:*`, `jr:setup:*`), never.

- [ ] **Step 2: Run to verify it fails** — `node --test test/jr-boot.test.js` → FAIL (helpers missing).

- [ ] **Step 3: Extend `core/variant.js`** with the two helpers (path join via `node:path`; the allowlist built from a literal base set + per-feature sets keyed by profile flags — write every real channel name from your Step 1 grep into the sets, grouped and commented). Run the test green.

- [ ] **Step 4: Wire main.js.** All edits additive, before the existing service construction:

1. Requires: `const { resolveVariant, isJr, profileFor, jrUserDataPath, jrIpcAllowlist } = require('./core/variant');` and `const { ParentControls } = require('./core/parent-controls');`
2. Immediately after the existing edition resolution (main.js reads the stamp near the top — follow the same pattern the `--junior`-style flags use):

```js
const VARIANT = resolveVariant({
  stamped: app.isPackaged ? require('./package.json').jarvisVariant : '',
  env: process.argv.includes('--jr') ? 'jr' : process.env.JARVIS_VARIANT
});
const JR = isJr(VARIANT);
// JR's data NEVER touches the grown-up folder — dev mode included. This is
// the fix for the JUNIOR dev-mode leak found 2026-07-28. Must run before
// ANY service reads app.getPath('userData').
if (JR) app.setPath('userData', jrUserDataPath(app.getPath('appData')));
```

3. After ConfigStore construction: `const parentControls = JR ? new ParentControls(config) : null;` and `const PROFILE = profileFor(VARIANT, parentControls ? parentControls.getControls() : null);`
4. Service construction — for each service the profile can gate, wrap with the flag, constructing `null` when off. The list to wrap and the flags (verify each against the requires block at main.js:9-49): `Go2RtcManager`/`CameraService` → `PROFILE.cameras`; `ScreenReader` → `PROFILE.screenRead`; `ScreenHands`/`ScreenDriver` → `PROFILE.screenDrive`; `ClaudeBridge` → `PROFILE.claudeBridge`; `NightShiftService` → `PROFILE.nightShift`; `ScheduleStore`/`ScheduleService` → `PROFILE.schedules`; `AutonomyService`/`FolderWatchService` → `PROFILE.autonomy`; `MobileServer`/`MobileAuth` → `PROFILE.phone`; `DefenseService` → `PROFILE.defense`; `DocumentService` → `PROFILE.documents`; `ToolService` stays (tasks/timers need it) but its file surface is router-gated (Task 5) and tool-filtered (Task 7). Downstream uses already null-check most of these (they did for JUNIOR); run the app to find any that don't and guard them.
5. Router construction: pass `profile: PROFILE, jrAge: () => (parentControls ? parentControls.age() : 11)`.
6. IPC allowlist — port JUNIOR's wrap verbatim in shape (main.js had it at line 501-520 on that branch):

```js
if (JR) {
  const ALLOWED = jrIpcAllowlist(PROFILE);
  const realHandle = ipcMain.handle.bind(ipcMain);
  const realOn = ipcMain.on.bind(ipcMain);
  ipcMain.handle = (channel, listener) => realHandle(channel, ALLOWED.has(channel)
    ? listener
    : async () => { throw new Error(`${channel} is not part of JARVIS JR.`); });
  ipcMain.on = (channel, listener) => realOn(channel, ALLOWED.has(channel) ? listener : () => {});
}
```

7. New JR IPC channels (register unconditionally; the allowlist admits them only in jr, and each handler returns `{ok:false}` when `!JR`):

```js
ipcMain.handle('jr:status', () => ({ jr: JR, setUp: JR ? parentControls.isSetUp() : true, profile: PROFILE }));
ipcMain.handle('jr:setup:complete', (_e, payload) => JR ? parentControls.completeSetup(payload || {}) : { ok: false });
ipcMain.handle('jr:parent:verify', (_e, payload) => JR ? parentControls.verifyPin(payload?.pin) : { ok: false });
ipcMain.handle('jr:parent:controls', (_e, payload) => {
  if (!JR) return { ok: false };
  const gate = parentControls.verifyPin(payload?.pin);
  if (!gate.ok) return gate;
  const controls = payload?.patch ? parentControls.setControls(payload.patch) : parentControls.getControls();
  return { ok: true, controls, relaunchNeeded: Boolean(payload?.patch) };
});
ipcMain.handle('jr:parent:pin', (_e, payload) => JR ? parentControls.setPin(payload?.oldPin, payload?.newPin) : { ok: false });
```

Every `jr:parent:*` mutation demands the PIN in the same call — the renderer never holds an unlocked session token. Checklist changes take effect at next launch (`relaunchNeeded: true`; the renderer says so) — an off feature was never constructed, so there is nothing to hot-disable.
8. `package.json` scripts: add `"start:jr": "electron . --jr"`.

- [ ] **Step 5: Run everything, then boot both variants**

Run: `node --test 2>&1 | tail -3` — Expected: 0 fail.
Run: `npm run start` — grown-up JARVIS boots exactly as before (spot-check: orb, a command, settings open).
Run: `npm run start:jr` — boots, creates `%APPDATA%\jarvis-jr\` (verify the folder exists and `%APPDATA%\jarvis-local-assistant\settings.json` mtime did NOT change). The window is the normal UI for now — the setup gate is Task 8's renderer work.

- [ ] **Step 6: Commit**

```bash
git add core/variant.js main.js package.json test/jr-boot.test.js
git commit -m "jr: boot — variant stamp, own userData (dev included), gated construction, IPC allowlist"
```

---

### Task 7: Tool filtering + the content-lock prompt in the AI service

**Files:**
- Modify: `core/tool-registry.js` (tag rows), `core/ai-service.js` (filter + prompt layer)
- Test: `test/jr-tools.test.js` (new)

**Interfaces:**
- Consumes: profile (Task 1), `buildJrPromptRules` (Task 4).
- Produces: each registry row gains `feature: '<control key>' | null` (null = core, always allowed); `filterRegistryForProfile(registry, profile)` exported from `core/tool-registry.js`; `AIService` accepts `profile` and applies both the filter and the prompt rules on every turn.

- [ ] **Step 1: Write the failing test**

```js
// test/jr-tools.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildToolRegistry, filterRegistryForProfile } = require('../core/tool-registry');
const { profileFor, DEFAULT_CONTROLS, STANDARD_PROFILE } = require('../core/variant');

function registry() {
  return buildToolRegistry({
    tools: {}, tasks: {}, memory: {}, config: {}, documents: {},
    getCameras: () => null, getAi: () => null
  });
}

test('every tool row declares its feature (null means core on purpose)', () => {
  for (const tool of registry()) {
    assert.ok('feature' in tool, `${tool.name} must declare feature`);
  }
});

test('jr defaults: file/document/app/camera tools are gone; core survives', () => {
  const names = filterRegistryForProfile(registry(), profileFor('jr', DEFAULT_CONTROLS)).map((t) => t.name);
  assert.ok(names.includes('add_task'));
  assert.ok(names.includes('get_current_datetime'));
  for (const gated of ['search_files', 'read_file', 'open_application', 'look_at_camera']) {
    assert.ok(!names.includes(gated), `${gated} must be filtered`);
  }
});

test('flipping a control on restores exactly its tools', () => {
  const names = filterRegistryForProfile(registry(), profileFor('jr', { ...DEFAULT_CONTROLS, files: true })).map((t) => t.name);
  assert.ok(names.includes('search_files'));
  assert.ok(!names.includes('read_file'), 'read_file is documents, not files');
});

test('a tool added without a feature tag is DENIED in jr — off by default, on purpose', () => {
  const withStranger = [...registry(), { name: 'new_powerful_thing', parameters: {}, execute: async () => ({}) }];
  const names = filterRegistryForProfile(withStranger, profileFor('jr', DEFAULT_CONTROLS)).map((t) => t.name);
  assert.ok(!names.includes('new_powerful_thing'));
});

test('standard profile filters nothing', () => {
  assert.equal(filterRegistryForProfile(registry(), STANDARD_PROFILE).length, registry().length);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test test/jr-tools.test.js` → FAIL.

- [ ] **Step 3: Implement.** In `core/tool-registry.js` tag every row: `add_task`/`list_open_tasks` → `feature: 'tasks'`; `remember_note`/`search_memory`/`get_current_datetime` → `feature: null` (core — comment WHY on each: memory and the clock reach nothing outside the app); `search_files` → `'files'`; `read_file` → `'documents'`; `open_application` → `'apps'`; `look_at_camera` → `'cameras'`. Then:

```js
// jr's fourth gate at the model layer: a tool the checklist has not switched
// on is not in the belt. `feature: null` is an EXPLICIT declaration that a
// tool reaches nothing outside the app; a row that never declared anything
// is denied in jr — a powerful tool added next year stays off for kids until
// somebody marks it, on purpose.
function filterRegistryForProfile(registry, profile) {
  if (!profile || profile.contentLock !== true) return registry;
  return registry.filter((tool) =>
    Object.prototype.hasOwnProperty.call(tool, 'feature') &&
    (tool.feature === null || profile[tool.feature] === true));
}
```

Export it. In `core/ai-service.js`: constructor stores `this.profile = options.profile || null`; where the registry is consulted for tool specs, pass it through `filterRegistryForProfile(registry, this.profile)`; where the system prompt is assembled from `settings.personality`, append `buildJrPromptRules({ age: this.jrAge(), kidName: settings.kidName })` when `this.profile?.contentLock` (thread `jrAge` in from main.js exactly as the router got it in Task 6 Step 4.5). If Task 5 found prompt assembly lives here, this is where the router-jr CONTENT LOCK test moves to — either way exactly one place appends the rules.

- [ ] **Step 4: Run tests** — `node --test test/jr-tools.test.js` then full suite. Expected: all green; `test/agent-loop.test.js` is the likely breakage if the filter signature is threaded wrong — its mocks must not need changes if the default profile is null/standard.

- [ ] **Step 5: Commit**

```bash
git add core/tool-registry.js core/ai-service.js test/jr-tools.test.js
git commit -m "jr: tool belt filtered by the checklist; content-lock rules ride every model turn"
```

---

### Task 8: Renderer — parent setup gate, PIN sheet, parent panel

**Files:**
- Create: `src/jr-parent-ui.js`, append styles to `src/styles.css` (one clearly-marked `/* ---- JARVIS JR ---- */` section at the end)
- Modify: `src/index.html` (overlay markup before `</body>`), `src/renderer.js` (boot hook), `preload.js` (expose the five `jr:*` channels)
- Test: manual verification protocol below (renderer; the logic it calls is already unit-tested in Tasks 3/6)

**Interfaces:**
- Consumes: `jr:status`, `jr:setup:complete`, `jr:parent:verify`, `jr:parent:controls`, `jr:parent:pin` via preload.
- Produces: `window.JrParentUI.init(bootstrapStatus)` called once from renderer boot; a `jr-setup` overlay (blocking, first run) and a `jr-parent` overlay (PIN-gated) in the existing overlay style of the app.

- [ ] **Step 1: preload.js** — add to the exposed API, following the file's existing pattern exactly:

```js
  jrStatus: () => ipcRenderer.invoke('jr:status'),
  jrSetupComplete: (payload) => ipcRenderer.invoke('jr:setup:complete', payload),
  jrParentVerify: (pin) => ipcRenderer.invoke('jr:parent:verify', { pin }),
  jrParentControls: (pin, patch) => ipcRenderer.invoke('jr:parent:controls', { pin, patch }),
  jrParentPin: (oldPin, newPin) => ipcRenderer.invoke('jr:parent:pin', { oldPin, newPin }),
```

- [ ] **Step 2: index.html** — before `</body>`, dark-UI overlays (reuse the app's existing overlay/sheet classes — read how the settings dialog is structured and match it):

```html
    <!-- JARVIS JR: parent setup (blocking, first run) + parent panel -->
    <div id="jr-setup" class="jr-overlay" hidden>
      <div class="jr-sheet">
        <h2>PARENT SETUP</h2>
        <p class="jr-note">JARVIS JR doesn't start until a parent sets it up. Kids: go get one.</p>
        <label>Kid's name <input id="jr-setup-name" maxlength="24"></label>
        <label>Birthdate <input id="jr-setup-birthdate" type="date"></label>
        <label>Create a PIN (4–8 numbers) <input id="jr-setup-pin" type="password" inputmode="numeric" maxlength="8"></label>
        <div id="jr-setup-controls" class="jr-checklist"></div>
        <p class="jr-note">Everything OFF stays not-built — not hidden, not disabled. Change it any time behind the PIN; changes apply at next launch.</p>
        <button id="jr-setup-go">START JARVIS JR</button>
        <p id="jr-setup-error" class="jr-error" hidden></p>
      </div>
    </div>
    <div id="jr-parent" class="jr-overlay" hidden>
      <div class="jr-sheet">
        <h2>PARENT PANEL</h2>
        <label>PIN <input id="jr-parent-pin" type="password" inputmode="numeric" maxlength="8"></label>
        <div id="jr-parent-body" hidden>
          <div id="jr-parent-controls" class="jr-checklist"></div>
          <p class="jr-note" id="jr-parent-relaunch" hidden>Saved. Changes apply the next time JARVIS JR starts.</p>
          <details><summary>Change PIN</summary>
            <label>New PIN <input id="jr-new-pin" type="password" inputmode="numeric" maxlength="8"></label>
            <button id="jr-pin-save">Save PIN</button>
          </details>
        </div>
        <p id="jr-parent-error" class="jr-error" hidden></p>
        <button id="jr-parent-close">Close</button>
      </div>
    </div>
```

- [ ] **Step 3: `src/jr-parent-ui.js`** — plain script (no modules; match renderer.js's style). Responsibilities, each a small function: `init(status)` (if `status.jr && !status.setUp` show `#jr-setup` and refuse to hide it until setup succeeds; if `status.jr` add a "PARENT" button into the top bar next to the existing settings control and hide the settings control — read renderer.js for how the settings button is wired and mirror it); `renderChecklist(container, controls, labels)` — one row per `CONTROL_KEYS` entry with the spec's display copy (write out all 14 labels verbatim in a `LABELS` map: `games: 'Games'`, `battle: 'Battle mode'`, `quips: 'Jokes & quips'`, `homework: 'Homework hints'`, `tasks: 'Tasks'`, `timers: 'Timers'`, `cameras: 'Cameras (view only)'`, `documents: 'Documents — read & summarize'`, `files: 'File search (their own folder)'`, `apps: 'Open apps (parent allowlist)'`, `browser: 'The browser'`, `terminal: 'The terminal'`, `screenRead: 'Screen reading'`, `power: 'Power (restart/shutdown)'`); setup submit → `jrSetupComplete({pin, birthdate, controls, kidName})` then reload the window on ok (main.js already persisted; a reload re-runs bootstrap with the profile — but note the profile was computed at boot, so setup completion is the ONE flow where main must recompute: have `jr:setup:complete`'s handler in main.js rebuild `PROFILE` from the fresh controls and relaunch via `app.relaunch(); app.exit(0)` — add that to the Task 6 handler now, it is two lines); parent open → PIN verify → load controls → checkbox toggles batched into one `jrParentControls(pin, patch)` on Save.
- Also in this step: `kidName` — persist it via the ordinary settings path if `profileName`/`kidName` is already an allowed settings key; if not, store it inside the `jrParent` secret (extend `completeSetup` in Task 3's module with a `kidName` field — it is parent-written data anyway; add one line to that test).

- [ ] **Step 4: `src/renderer.js` boot hook** — where the renderer awaits `bootstrap` (find the existing call), add:

```js
  const jrStatus = await window.jarvis.jrStatus?.().catch(() => null);
  if (jrStatus?.jr && window.JrParentUI) window.JrParentUI.init(jrStatus);
```

And in `index.html`, the script tag for `jr-parent-ui.js` before `renderer.js`.

- [ ] **Step 5: Manual verification protocol** (renderer work; run it, don't claim it):

1. Delete `%APPDATA%\jarvis-jr\` for a cold start. `npm run start:jr`.
2. Setup overlay blocks everything. Try submitting: 2-digit PIN → inline error; future birthdate → inline error.
3. Complete setup (PIN 2468, birthdate giving age 11, documents+files ON). App relaunches into the normal dark UI.
4. PARENT button → wrong PIN five times → lockout message with a countdown; right PIN during lockout also refused.
5. Right PIN after lockout expires → checklist shows saved state; flip browser ON → relaunch note appears; relaunch; verify `jr:status` profile now has browser true (DevTools: `await window.jarvis.jrStatus()`).
6. `npm run start` (grown-up): no PARENT button, no overlays, settings untouched.
7. Screenshot the setup sheet and the parent panel for Adam.

- [ ] **Step 6: Commit**

```bash
git add src/jr-parent-ui.js src/index.html src/renderer.js src/styles.css preload.js main.js
git commit -m "jr: renderer — blocking parent setup, PIN sheet, checklist panel in the dark UI"
```

---

### Task 9: Module cards follow the profile

**Files:**
- Modify: `src/renderer.js` (module visibility), `main.js` (bootstrap payload)
- Test: extend `test/jr-boot.test.js`

**Interfaces:**
- Consumes: `PROFILE` via the `bootstrap`/`jr:status` payload.
- Produces: `moduleAllowedInProfile(moduleName, profile) -> boolean` exported from `core/variant.js` (pure, testable); the renderer consults it before showing any module card, on top of the existing `hiddenModules` mechanism (profile dominates: a module the profile denies cannot be re-shown from the layout UI).

- [ ] **Step 1: Failing test** — append to `test/jr-boot.test.js`:

```js
test('module cards follow the profile', () => {
  const { moduleAllowedInProfile } = require('../core/variant');
  const off = profileFor('jr', DEFAULT_CONTROLS);
  assert.equal(moduleAllowedInProfile('tasks', off), true);
  assert.equal(moduleAllowedInProfile('cameras', off), false);
  assert.equal(moduleAllowedInProfile('file-explorer', off), false);
  assert.equal(moduleAllowedInProfile('night-shift', off), false);   // never in jr
  assert.equal(moduleAllowedInProfile('terminal', off), false);
  const filesOn = profileFor('jr', { ...DEFAULT_CONTROLS, files: true, cameras: true });
  assert.equal(moduleAllowedInProfile('file-explorer', filesOn), true);
  assert.equal(moduleAllowedInProfile('cameras', filesOn), true);
  assert.equal(moduleAllowedInProfile('anything', STANDARD_PROFILE), true);
});
```

- [ ] **Step 2: Run red**, then implement in `core/variant.js` — a literal map from the module names in `src/index.html` (`tasks, file-explorer, night-shift, performance, memory, projects, activity, terminal, quick-commands, document-viewer, cameras, browser`) to profile keys (`performance/memory/projects/activity/quick-commands` → allowed when their nearest feature is: `performance` → true (harmless stats), `memory` → true, `projects` → `files`, `activity` → true, `quick-commands` → `timers`, `document-viewer` → `documents`, `file-explorer` → `files`, `night-shift` → `nightShift`, `terminal` → `terminal`, `cameras` → `cameras`, `browser` → `browser`, `tasks` → `tasks`); unknown module in a contentLock profile → false (deny by default).

- [ ] **Step 3: Renderer** — in `src/renderer.js`, at the point module visibility is computed from `hiddenModules` (find it), intersect with the profile: a module with `moduleAllowedInProfile(name, profile) === false` is force-hidden and removed from any "show module" picker list. Load the map via the shared-module trick the codebase already uses (orb-engine.js's dual export — `core/variant.js` gets the same `typeof module`/`window` footer, and index.html loads it with a script tag before renderer.js).

- [ ] **Step 4: Verify** — full suite green; `npm run start:jr` with defaults shows tasks/activity/quick-commands only; flip files+cameras on, relaunch, their cards appear. Grown-up start unchanged.

- [ ] **Step 5: Commit**

```bash
git add core/variant.js src/renderer.js src/index.html main.js test/jr-boot.test.js
git commit -m "jr: module cards follow the profile — deny-by-default under the content lock"
```

---

### Task 10: The JR installer

**Files:**
- Create: `electron-builder.jr.json`
- Modify: `package.json` (add `"dist:jr"` script)
- Test: extend `test/installer-version.test.js` pattern with `test/jr-installer.test.js` (config sanity, no build required)

- [ ] **Step 1: Failing test**

```js
// test/jr-installer.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const config = require('../electron-builder.jr.json');
const pkg = require('../package.json');

test('jr installer: own identity, jr stamp, never the grown-up appId', () => {
  assert.equal(config.appId, 'com.adam.jarvis.jr');
  assert.equal(config.productName, 'JARVIS JR');
  assert.equal(config.extraMetadata.jarvisVariant, 'jr');
  assert.match(config.nsis.artifactName || config.win.artifactName, /JARVIS-JR-Setup/);
  assert.equal(pkg.scripts['dist:jr'], 'electron-builder --win nsis --config electron-builder.jr.json');
});
```

- [ ] **Step 2: Run red, then write `electron-builder.jr.json`** — copy the `build` block shape from `package.json` (lines 32-69), overriding: `appId: "com.adam.jarvis.jr"`, `productName: "JARVIS JR"`, `extraMetadata: { "jarvisVariant": "jr" }`, `win.artifactName: "JARVIS-JR-Setup-${version}.${ext}"`, same `files` list, same icon for v1 (`assets/icon.png` — a JR-badged icon is a follow-up, noted in the spec's known gaps; do NOT run the JUNIOR branch's python icon script). Drop the `go2rtc` extraResources ONLY IF cameras-off builds could skip it — they cannot (a parent can enable cameras post-install), so keep it. Add `"dist:jr"` to package.json scripts exactly as the test asserts. Verify `resolveVariant` in Task 6 reads `require('./package.json').jarvisVariant` — extraMetadata stamps it into the packaged package.json; running from source it is absent → standard unless `--jr`/env. That is the intended failure direction.

- [ ] **Step 3: Verify** — test green, full suite green. Optionally `npm run dist:jr` once (slow) to prove the config parses; do not ship the artifact.

- [ ] **Step 4: Commit**

```bash
git add electron-builder.jr.json package.json test/jr-installer.test.js
git commit -m "jr: own installer — JARVIS-JR-Setup, own appId, build-time variant stamp"
```

---

### Task 11: End-to-end verification + docs

**Files:**
- Modify: `README.md` (a JARVIS JR section: what it is, `npm run start:jr`, `npm run dist:jr`, the parental-controls model in five lines), `CHANGELOG.md` (unreleased entry)
- No new code.

- [ ] **Step 1: Full suite** — `node --test 2>&1 | tail -3` → 0 fail; record final count vs baseline.
- [ ] **Step 2: The whole JR verification pass, cold:** delete `%APPDATA%\jarvis-jr\`, `npm run start:jr`, run the Task 8 protocol end to end, plus: "how do I make a bomb" → guard sentence; "i want to hurt myself" → care reply AND absent from the activity log; "find my homework file" with files OFF → gate line; with files ON (after relaunch) → real search; wake word + a battle rap; confirm `%APPDATA%\jarvis-local-assistant` untouched throughout (mtime check).
- [ ] **Step 3: Grown-up regression:** `npm run start`, ordinary session — settings, a file search, orb picker. No JR traces.
- [ ] **Step 4: Screenshots to Adam** — setup sheet, parent panel, a gated refusal, a guard deflection.
- [ ] **Step 5: Docs + commit**

```bash
git add README.md CHANGELOG.md
git commit -m "jr: document the JR build — parental controls, content lock, own installer"
git push origin jarvis-jr
```

---

## Self-review notes (already applied)

- Spec coverage: variant axis (T1), PIN (T2), birthdate/checklist/secrets (T3), content lock + age bands + homework rule (T4), guard-before-model + branch gates + care privacy (T5), boot construction + dev-mode data isolation + IPC allowlist + setup relaunch (T6), tool filter + prompt rules (T7), parent setup gate + panel (T8), module cards (T9), installer (T10), verification (T11). Spec's "questions the guard deflected" parent-panel tab: deferred — the activity log already records `jr-guard` entries (T5) and the panel can grow the tab in a follow-up; noted here so it is a decision, not a gap.
- The renderer tasks (8, 9) carry manual protocols because the project has no renderer harness; every decision they call is unit-tested underneath.
- Type consistency: `profileFor(variant, controls)` two-arg everywhere; `feature: null` core-tool convention consistent between T7's filter and tests; `jr:parent:*` channel names identical in T6 (handlers), T8 (preload), T6's allowlist test.
