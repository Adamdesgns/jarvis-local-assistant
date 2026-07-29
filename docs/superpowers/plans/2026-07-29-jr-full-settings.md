I have everything I need. I don't have Write access (read-only planning agent), so here is the plan in full as my response.

---

# JARVIS JR — Full Settings Behind the PIN

**Goal:** Correct the product mistake. JR becomes the real JARVIS with limitations added for kids, not a stripped-down app. The parent gets the actual settings dialog behind the PIN; the kid gets the content lock, a 17-item reach checklist, and a cosmetic-only settings panel.

**Architecture (the one sentence that drives every task):** `PROFILE` stops meaning "what got built" and comes to mean **only "what the kid can reach."** JR constructs exactly what the standard build constructs; the parent's PIN opens a *main-process*, self-expiring session that widens the IPC allowlist at **call time** instead of registration time.

**Tech stack:** unchanged — Electron 43, plain Node, `node --test`, no new dependencies.

---

## Design decisions (the eight questions, answered)

| # | Decision | Why |
|---|---|---|
| 1 | **Parent unlock** = new pure `core/parent-session.js`. `unlock()` only from a successful `jr:parent:verify` (same throttled `PinGate`). `admit()` = "is it open, and refresh the idle clock." Idle cap 10 min, absolute ceiling 60 min (not refreshable). Revoked by explicit `jr:parent:lock` (renderer fires on settings-dialog close), by expiry, and by app exit. The IPC wrap becomes a **call-time** gate: kid channels short-circuit *before* the session is consulted (so kid traffic never keeps a parent session alive); everything else calls `admit()` on every invocation. An in-flight handler admitted before expiry **runs to completion** — the check is at the entry of each IPC call, not a cancellation mechanism. Honest and safe: the worst case is one settings write finishing. | Renderer can never claim it. Re-asked per call, so expiry re-blocks with no extra machinery. |
| 2 | **Never-block shrinks to `contentLock: true` and nothing else.** The six split three ways: `claudeBridge`, `screenDrive` — plus `defense`, which the owner's list missed but which has the same kid-facing router branch — become **new `CONTROL_KEYS` entries (14 → 17, all defaulting off)**. `nightShift`, `schedules`, `autonomy`, `phone` become **ordinary settings** the parent flips in the real tabs; the JR profile grants them `true` (the *variant* withholds nothing) and their services gate at the same `settings.*Enabled` seam the standard build already uses. `cameraConfig` is **deleted** — grep proves it is a dead flag, read nowhere but its own definition and two tests. | The owner's own test applies cleanly: a checklist key must correspond to something the kid can *reach*. `core/router.js` has a `#jrGate` branch for claudeBridge (L313), screenDrive (L347) and defense (L823) — those are kid reach. It has none for nightShift/schedules/autonomy/phone. 17 items, not 20, and every one of them earns its row. |
| 3 | **Nothing needs a relaunch any more.** Because construction stops being profile-gated, the only boot-frozen thing left is `PROFILE` itself, and it is hot-appliable in ~8 lines: recompute it, recompute the kid allowlist `Set`, reassign `router.profile` and `ai.profile` (both public fields, both read at call time — verified), broadcast `jr:profile` so the renderer re-runs `renderModuleVisibility()`. `app.relaunch()` disappears from both `jr:setup:complete` and `jr:parent:controls`. The settings-side hot-apply (`syncMobileServer`, `scheduleService.start`, `folderWatch.start`, `setupNightShift`) already exists in `settings:save` and now simply works in JR too. | Removes a whole UX concept and the `#jr-parent-relaunch` note rather than adding one. Lower risk than it sounds: three assignments to public fields plus one `Set` rebuild. |
| 4 | **One new `JARVIS JR` tab** in the real dialog: kid name, birthdate + computed age, the 17-item checklist, PIN change, session countdown, "Lock now." Visible only in JR and only while unlocked. | Scattering the checklist across seven tabs makes it unauditable, and the parent's mental model is "the JR settings," singular. |
| 5 | **Reuse the real dialog, filtered.** Split the appearance controls out of the `general` section into a new `<section data-tab="looks">`, add a `LOOKS` tab (standard gets it too — a genuine improvement), and give the kid a tab set of exactly `[looks]`. `sectionHidden` gains **deny-by-default under a restricted tab set** so a future untagged section cannot fall through into the kid's dialog. `JR_SETTINGS_ALLOW` stays the belt: even a hand-crafted `settings:save` from a locked JR renderer still only writes cosmetics. | Two mechanisms already exist (`sectionHidden`, `JR_SETTINGS_ALLOW`); a separate surface would be a third thing to keep in sync. |
| 6 | **`src/jr-parent-ui.js` keeps the first-run `#jr-setup` overlay and the PIN sheet; loses everything else.** ~489 → ~180 lines. Deleted: the checklist renderer (moves to the JR tab), all four camera account forms, the module-level `verifiedPin` (there is no PIN to hold any more — main owns the session). On PIN success it calls `openSettings('jr')`. The `LABELS` hand-mirror dies: `CONTROL_LABELS` moves into `core/variant.js`, which `src/index.html` already loads as a classic script. | Kills the ROLLUP-11 sync hazard outright rather than testing around it. |
| 7 | **`jr:parent:cameras` is deleted** — handler, `JR_IPC` entry, `preload.jrParentCameras`, and ~200 lines of forms. The real cameras tab and the real `cameras:add-*` channels are reachable while unlocked; `cameraRefusal()` (the Pro gate) still applies because those handlers keep it. | The multiplexer existed only because the real channels were unreachable. |
| 8 | See Task-by-task; new security pins are listed in Task 5. | |

---

## Global Constraints

- Branch `jarvis-jr-work`. Never commit to `main`. Stage by exact path; never `git add -A`.
- TDD per task: failing test first, run it red, implement, run green, then the **full suite** (`node --test`, ~80s). Baseline before Task 1: `node --test 2>&1 | tail -3` — record the count (expected 922).
- **The grown-up build's behaviour must not change.** Every new gate is `JR &&`-scoped or defaulted to the permissive path.
- `main.js` cannot be `require`d under `node:test` (it pulls in Electron). Main-process work is pinned by (a) pure helpers extracted into `core/`, and (b) source-text assertions, the pattern `test/ipc-contract.test.js` and the ROLLUP-11 test already use. **Do not fake it as behavioural coverage** — each such task carries a manual verification protocol that must actually be run.
- No `Get-Content | Set-Content` bulk edits (mangles UTF-8). Use the Edit tool.
- Naming in copy: product is "JARVIS JR" (caps).
- **The content lock has no off switch, in any task.** `contentLock: true` sits *after* the controls spread in `profileFor`, and no settings key anywhere maps to it.
- **The parent session must never widen the router, the tool registry, or the module cards.** It widens IPC and `settings:save` filtering, full stop. If a task finds itself threading a session into `core/router.js` or `core/ai-service.js`, stop — that is the design going wrong.

---

## Risks and owner calls

1. **`defense` was not on the owner's list of six, but it behaves like `claudeBridge`/`screenDrive`.** I made it a 17th checklist key. If the owner would rather defense mode simply be on whenever the parent enables it in settings (no kid gate), drop it from `CONTROL_KEYS` and grant it `true` like `phone` — one line in Task 1.
2. **`nightShift` granted `true` makes the night-shift module card visible to the kid** via `MODULE_PROFILE_KEY`. Overnight document summaries are exactly the content the lock exists for. **Mitigation in the plan:** re-key `'night-shift'` to `'documents'`, so the card follows the kid's document permission rather than the parent's night-shift setting. Flagging because it is a behaviour change the owner should agree with.
3. **JR now constructs every service at boot** (go2rtc manager, mobile auth, schedule store, defense…). Slightly more memory and a larger constructed surface. The kid's reach is still the IPC allowlist plus the router, both unchanged. This is the literal meaning of "an exact copy."
4. **`core/router.js` L667 and L676 branch on the *truthiness of `this.documents`*, not on `profile.documents`.** Once documents is always constructed, those branches silently change behaviour and the booby-trap proxies in `test/router-jr.test.js` will detonate. Task 5 changes both to `this.profile.documents && this.documents`, preserving today's semantics exactly. **This is the single most likely place to break something.**
5. **`openSettings()` in kid mode would call admin IPC** (`mobile:status`, `schedule:list`, `defense:zones`) and throw. Handled in Task 3, but it is the reason "just show the dialog" is not a one-liner.
6. **Idle cap 10 min / ceiling 60 min** are my recommendation, not a requirement. Both are constructor options and one constant edit away.
7. **PIN lockout is in-memory** (existing `PinGate` behaviour, unchanged): a restart resets the attempt counter. Unchanged from today, noted so it is not mistaken for a regression introduced here.

---

### Task 1: The new model — kid-reach profile, parent session, gate helpers (all pure)

**Files:**
- Modify: `core/variant.js`
- Create: `core/parent-session.js`
- Modify: `core/parent-controls.js` (add `setProfile`)
- Test: `test/variant.test.js` (modify), `test/jr-boot.test.js` (modify), `test/parent-session.test.js` (create), `test/jr-unlock.test.js` (create), `test/parent-controls.test.js` (extend)

**Interfaces:**
- Produces: `CONTROL_KEYS` (17), `CONTROL_LABELS`, `DEFAULT_CONTROLS` (17), `profileFor(variant, controls)` whose jr branch is `{variant, productName, ...normalizeControls(controls), contentLock: true, nightShift: true, schedules: true, autonomy: true, phone: true}`; `jrChannelAllowed(channel, kidAllowlist, admitParent) -> boolean`; `jrSettingsPatch(patch, {jr, unlocked}) -> object`; `FEATURE_IPC.defense`, `FEATURE_IPC.screenDrive`; `JR_IPC` without `jr:parent:cameras`/`jr:parent:controls`/`jr:parent:pin`; `MODULE_PROFILE_KEY['night-shift'] = 'documents'`; `cameraConfig` removed from both profiles.
- Produces: `new ParentSession({now, idleMs, ceilingMs})` -> `unlock()`, `lock()`, `admit() -> boolean`, `status() -> {unlocked, expiresInSeconds}`. `IDLE_MS`, `CEILING_MS` exported.
- Produces: `ParentControls#setProfile({kidName, birthdate}) -> {ok} | {ok:false, reason}`.
- Consumes: nothing. Every export is pure or clock-injected.

- [ ] **Step 1: Write the failing tests**

```js
// test/parent-session.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ParentSession, IDLE_MS, CEILING_MS } = require('../core/parent-session');

function fakeClock(start = 1000000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('locked by default; only unlock() opens it', () => {
  const clock = fakeClock();
  const s = new ParentSession({ now: clock.now });
  assert.equal(s.status().unlocked, false);
  assert.equal(s.admit(), false);
  s.unlock();
  assert.equal(s.status().unlocked, true);
  assert.equal(s.admit(), true);
});

test('idle cap: ten quiet minutes closes it, and it never revives on its own', () => {
  const clock = fakeClock();
  const s = new ParentSession({ now: clock.now });
  s.unlock();
  clock.advance(IDLE_MS - 1000);
  assert.equal(s.admit(), true, 'still inside the idle window');
  clock.advance(IDLE_MS + 1);
  assert.equal(s.admit(), false, 'idle cap expired');
  clock.advance(1000);
  assert.equal(s.admit(), false, 'an expired session stays expired');
});

test('admit() is the heartbeat; status() is only a read', () => {
  const clock = fakeClock();
  const s = new ParentSession({ now: clock.now });
  s.unlock();
  for (let i = 0; i < 5; i += 1) {
    clock.advance(IDLE_MS - 1000);
    assert.equal(s.admit(), true, `refresh ${i}`);
  }
  clock.advance(IDLE_MS - 1000);
  s.status(); s.status(); s.status();
  clock.advance(2000);
  assert.equal(s.admit(), false, 'status() must not keep a session alive');
});

test('absolute ceiling: an hour of steady use still ends the session', () => {
  const clock = fakeClock();
  const s = new ParentSession({ now: clock.now });
  s.unlock();
  let admitted = true;
  for (let elapsed = 0; elapsed < CEILING_MS + IDLE_MS; elapsed += 60000) {
    clock.advance(60000);
    admitted = s.admit();
  }
  assert.equal(admitted, false, 'the ceiling is not refreshable');
});

test('lock() is immediate and needs no PIN — narrowing is always safe', () => {
  const clock = fakeClock();
  const s = new ParentSession({ now: clock.now });
  s.unlock();
  s.lock();
  assert.equal(s.admit(), false);
});

test('status() reports seconds left so the UI can warn before it drops', () => {
  const clock = fakeClock();
  const s = new ParentSession({ now: clock.now });
  assert.equal(s.status().expiresInSeconds, 0);
  s.unlock();
  clock.advance(60000);
  const left = s.status().expiresInSeconds;
  assert.ok(left > 0 && left <= IDLE_MS / 1000, `unexpected ${left}`);
});
```

```js
// test/jr-unlock.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  jrIpcAllowlist, profileFor, DEFAULT_CONTROLS,
  jrChannelAllowed, jrSettingsPatch, JR_IPC
} = require('../core/variant');

const KID = jrIpcAllowlist(profileFor('jr', DEFAULT_CONTROLS));

test('a kid channel is admitted WITHOUT ever asking the parent session', () => {
  let asked = 0;
  const admit = () => { asked += 1; return false; };
  assert.equal(jrChannelAllowed('command:submit', KID, admit), true);
  assert.equal(jrChannelAllowed('settings:save', KID, admit), true);
  assert.equal(jrChannelAllowed('jr:parent:session', KID, admit), true);
  // The thunk IS the idle-timer heartbeat. Kid traffic must never touch it,
  // or a child playing tic-tac-toe keeps a parent session open all afternoon.
  assert.equal(asked, 0);
});

test('an admin channel needs the session, and asks it exactly once per call', () => {
  let asked = 0;
  const locked = () => { asked += 1; return false; };
  assert.equal(jrChannelAllowed('cameras:add-blink', KID, locked), false);
  assert.equal(asked, 1);
  for (const channel of ['cameras:add-blink', 'mobile:pair', 'anthropic:save-key',
                         'schedule:add', 'backup:export', 'transcript:reveal',
                         'jr:parent:controls', 'jr:parent:pin']) {
    assert.equal(jrChannelAllowed(channel, KID, () => true), true, channel);
    assert.equal(jrChannelAllowed(channel, KID, () => false), false, channel);
  }
});

test('an expired session re-blocks: the gate re-asks on every single call', () => {
  let open = true;
  const admit = () => open;
  assert.equal(jrChannelAllowed('schedule:add', KID, admit), true);
  open = false;
  assert.equal(jrChannelAllowed('schedule:add', KID, admit), false);
});

test('the checklist and the PIN are ADMIN channels; the way in stays kid-reachable', () => {
  assert.ok(!KID.has('jr:parent:controls'), 'a kid must not be able to edit his own checklist');
  assert.ok(!KID.has('jr:parent:pin'));
  for (const channel of ['jr:status', 'jr:setup:complete', 'jr:parent:verify',
                         'jr:parent:lock', 'jr:parent:session']) {
    assert.ok(KID.has(channel), `${channel} must be reachable before any unlock exists`);
  }
  assert.ok(!JR_IPC.includes('jr:parent:cameras'), 'the camera multiplexer is gone');
});

test('settings:save is cosmetic-only for the kid and unfiltered for the parent', () => {
  const patch = { orbSkin: 'nebula', searchRoots: ['C:\\anywhere'], aiMode: 'cloud', nightShiftEnabled: true };
  assert.deepEqual(jrSettingsPatch(patch, { jr: true, unlocked: false }), { orbSkin: 'nebula' });
  assert.deepEqual(jrSettingsPatch(patch, { jr: true, unlocked: true }), patch);
  assert.deepEqual(jrSettingsPatch(patch, { jr: false, unlocked: false }), patch);
  assert.deepEqual(jrSettingsPatch(undefined, { jr: true, unlocked: false }), {});
});
```

Replace the two never-block tests in `test/variant.test.js` (lines 36-46 and 61-73) with:

```js
test('profileFor(jr): the never-block is now exactly one thing — the content lock', () => {
  const allOn = Object.fromEntries(CONTROL_KEYS.map((k) => [k, true]));
  const p = profileFor('jr', allOn);
  assert.equal(p.contentLock, true);
  for (const key of ['files', 'browser', 'terminal', 'cameras',
                     'claudeBridge', 'screenDrive', 'defense',
                     'nightShift', 'schedules', 'autonomy', 'phone']) {
    assert.equal(p[key], true, `${key} must be parent-enablable in jr`);
  }
  assert.equal('cameraConfig' in p, false, 'the dead cameraConfig flag is gone');
  assert.equal('cameraConfig' in STANDARD_PROFILE, false);
});

test('the content lock still has no off switch and cannot ride in on a controls object', () => {
  const p = profileFor('jr', { contentLock: false, games: false, defense: true });
  assert.equal(p.contentLock, true);
});

test('the three new keys are kid-reach checklist keys, defaulting OFF', () => {
  for (const key of ['claudeBridge', 'screenDrive', 'defense']) {
    assert.ok(CONTROL_KEYS.includes(key), `${key} must be a checklist key`);
    assert.equal(DEFAULT_CONTROLS[key], false, `${key} must default off`);
    assert.equal(profileFor('jr', DEFAULT_CONTROLS)[key], false);
  }
  // The grown-up-only four are NOT kid checklist keys — they are settings.
  for (const key of ['nightShift', 'schedules', 'autonomy', 'phone']) {
    assert.ok(!CONTROL_KEYS.includes(key), `${key} is a parent SETTING, not a checklist key`);
  }
  assert.equal(CONTROL_KEYS.length, 17);
});

test('CONTROL_LABELS is the single source of display copy and covers every key', () => {
  assert.deepEqual(Object.keys(CONTROL_LABELS).sort(), [...CONTROL_KEYS].sort());
  for (const key of CONTROL_KEYS) assert.ok(String(CONTROL_LABELS[key]).trim().length > 0, key);
});
```

Add `CONTROL_LABELS, STANDARD_PROFILE` to that file's require list.

In `test/jr-boot.test.js`: drop `jr:parent:controls`/`jr:parent:pin` from the base-channel assertion (lines 38-39); in the cameras test replace the `jr:parent:cameras` assertions with `assert.ok(!on.has('jr:parent:cameras'))`; from the never-list (line 90) remove `defense:status`, `defense:enter`, `screen:drive-stop` (now feature-gated) and add `defense:zones`. Then add:

```js
test('the new feature sets follow their new checklist keys', () => {
  const off = jrIpcAllowlist(profileFor('jr', DEFAULT_CONTROLS));
  for (const c of ['defense:status', 'defense:enter', 'defense:exit', 'defense:wave-off', 'screen:drive-stop']) {
    assert.ok(!off.has(c), `${c} must be absent with the key off`);
  }
  const defenceOn = jrIpcAllowlist(profileFor('jr', { ...DEFAULT_CONTROLS, defense: true }));
  assert.ok(defenceOn.has('defense:status'));
  assert.ok(defenceOn.has('defense:wave-off'));
  // County-zone configuration is settings work, not kid work.
  assert.ok(!defenceOn.has('defense:zones'));
  const driveOn = jrIpcAllowlist(profileFor('jr', { ...DEFAULT_CONTROLS, screenDrive: true }));
  assert.ok(driveOn.has('screen:drive-stop'));
});

test('the night-shift card follows the kid documents key, not the parent night-shift setting', () => {
  const off = profileFor('jr', DEFAULT_CONTROLS);
  assert.equal(moduleAllowedInProfile('night-shift', off), false);
  const docsOn = profileFor('jr', { ...DEFAULT_CONTROLS, documents: true });
  assert.equal(moduleAllowedInProfile('night-shift', docsOn), true);
});
```

Delete the ROLLUP-11 `LABELS` regex test entirely — Task 1's `CONTROL_LABELS` test replaces it and the hand-mirror it guarded no longer exists.

In `test/parent-controls.test.js` add:

```js
test('setProfile: renames the kid and re-dates him, refusing a bad date', () => {
  const pc = freshControls();                       // reuse this file's existing helper
  pc.completeSetup({ pin: '1234', birthdate: '2016-05-04', controls: {}, kidName: 'Sam' });
  assert.equal(pc.setProfile({ kidName: '  Samantha  ' }).ok, true);
  assert.equal(pc.getKidName(), 'Samantha');
  assert.equal(pc.setProfile({ birthdate: '2015-02-30' }).ok, false);
  assert.equal(pc.getBirthdate(), '2016-05-04', 'a refused date must not land');
  assert.equal(pc.setProfile({ birthdate: '1970-01-01' }).ok, false, 'outside the age range');
  assert.equal(pc.setProfile({ birthdate: '2015-06-01' }).ok, true);
  assert.equal(pc.getBirthdate(), '2015-06-01');
  // setProfile must never be a route to the PIN or the checklist.
  const before = pc.getControls();
  pc.setProfile({ kidName: 'X', controls: { terminal: true }, pinHash: 'nope' });
  assert.deepEqual(pc.getControls(), before);
  assert.equal(pc.verifyPin('1234').ok, true);
});
```

- [ ] **Step 2: Run red**

```
node --test test/parent-session.test.js test/jr-unlock.test.js test/variant.test.js test/parent-controls.test.js
```
Expected: `Cannot find module '../core/parent-session'` plus assertion failures on `CONTROL_LABELS`, `jrChannelAllowed`, `jrSettingsPatch`, `setProfile`.

- [ ] **Step 3: Implement**

`core/parent-session.js` (new, ~55 lines with comments):

```js
'use strict';

// The parent's unlocked window. Lives in the MAIN process and nowhere else:
// the renderer can ask whether it is open (jr:parent:session) and can close it
// (jr:parent:lock), but the only thing that OPENS it is a PIN that verified
// against the stored hash through ParentControls' throttled PinGate. There is
// no token, no cookie, nothing a kid's devtools-less renderer could forge — a
// forged "I am unlocked" message has nothing to forge.
//
// Two caps, both deliberate. The idle cap is the ordinary one: ten quiet
// minutes and the settings dialog goes cold, so a parent who walks away
// mid-edit doesn't leave the whole app open. The ceiling is the one that
// matters for the kid: it is NOT refreshable, so no amount of activity keeps
// the door open past an hour. In-memory on purpose, exactly like PinGate — a
// restart closes it, which is the safe direction.

const IDLE_MS = 10 * 60 * 1000;
const CEILING_MS = 60 * 60 * 1000;

class ParentSession {
  constructor({ now = () => Date.now(), idleMs = IDLE_MS, ceilingMs = CEILING_MS } = {}) {
    this.now = now;
    this.idleMs = idleMs;
    this.ceilingMs = ceilingMs;
    this.openedAt = null;
    this.lastTouch = null;
  }

  unlock() {
    const t = this.now();
    this.openedAt = t;
    this.lastTouch = t;
  }

  lock() {
    this.openedAt = null;
    this.lastTouch = null;
  }

  // Read-only. Never refreshes the idle clock — the renderer polls this for
  // its countdown, and a countdown that resets itself by being watched is a
  // session with no idle cap at all.
  status() {
    if (this.openedAt === null) return { unlocked: false, expiresInSeconds: 0 };
    const t = this.now();
    const idleLeft = this.idleMs - (t - this.lastTouch);
    const ceilingLeft = this.ceilingMs - (t - this.openedAt);
    const left = Math.min(idleLeft, ceilingLeft);
    if (left <= 0) { this.lock(); return { unlocked: false, expiresInSeconds: 0 }; }
    return { unlocked: true, expiresInSeconds: Math.ceil(left / 1000) };
  }

  // The IPC gate's question: "may this call through, and if so, the parent is
  // still here." Expiry is evaluated here, on every admin call, which is what
  // makes an expired session re-block with no timer to fire and no state to
  // sweep.
  admit() {
    if (!this.status().unlocked) return false;
    this.lastTouch = this.now();
    return true;
  }
}

module.exports = { ParentSession, IDLE_MS, CEILING_MS };
```

`core/variant.js`:
- `CONTROL_KEYS`: append a third group — `'claudeBridge', 'screenDrive', 'defense'` — with a comment saying these are the grown-up-power features a parent may hand down, all default off.
- Add `CONTROL_LABELS` immediately after `CONTROL_KEYS` (move the copy from `src/jr-parent-ui.js`'s `LABELS` verbatim, plus `claudeBridge: 'Ask Claude (cloud AI — costs money)'`, `screenDrive: 'Let JARVIS click and type on the PC'`, `defense: 'Defense mode'`). Comment that this is now the single source of truth and the renderer reads it off `window.JrVariant`, so the old hand-mirror is gone.
- `DEFAULT_CONTROLS`: add the three, all `false`.
- `STANDARD_PROFILE`: add the three `true`, remove `cameraConfig`.
- `profileFor`'s jr branch: replace the eight-line never-block with `contentLock: true` plus `nightShift: true, schedules: true, autonomy: true, phone: true` and a comment explaining the split (kid reach vs. what the variant withholds — which is now nothing but the content lock).
- `FEATURE_IPC`: add `defense: ['defense:status','defense:enter','defense:exit','defense:wave-off']` and `screenDrive: ['screen:drive-stop']`. Note in the comment that `defense:zones` stays out — county configuration is settings work.
- `JR_IPC`: `['jr:status','jr:setup:complete','jr:parent:verify','jr:parent:lock','jr:parent:session']`. Comment why `jr:parent:controls`/`jr:parent:pin` moved out: they are now admin-only, reachable only through an unlocked session, so a kid cannot even reach the handler.
- Rewrite the "NEVER admitted" comment block as **"Not in the KID surface — reachable only while the parent session is unlocked"**, and delete the `defense:*` / `screen:drive-stop` / `cameras:*` / `mobile:*` / `schedule:*` / `nightshift:status` justifications that no longer apply as *never*.
- `MODULE_PROFILE_KEY`: `'night-shift': 'documents'` with the comment from Risk 2.
- Add the two gate helpers:

```js
// The JR IPC gate, as a pure decision. Kid channels short-circuit BEFORE the
// session is consulted — admitParent() is the idle-timer heartbeat, and a kid
// playing tic-tac-toe must not keep a parent's settings session alive. Called
// per invocation (not per registration), which is the whole reason an expired
// unlock re-blocks without any timer to fire.
function jrChannelAllowed(channel, kidAllowlist, admitParent) {
  if (kidAllowlist && kidAllowlist.has(channel)) return true;
  return typeof admitParent === 'function' ? Boolean(admitParent()) : Boolean(admitParent);
}

// settings:save's own gate. A locked JR renderer writes cosmetics and nothing
// else, exactly as before; an unlocked one is a parent at the real settings
// dialog, so the patch goes through untouched and ConfigStore's own allowlist
// (core/config-store.js) is the only filter left, same as the standard build.
function jrSettingsPatch(patch, { jr, unlocked } = {}) {
  if (!jr || unlocked) return patch || {};
  return filterJrSettingsPatch(patch || {});
}
```

Export `CONTROL_LABELS`, `jrChannelAllowed`, `jrSettingsPatch`, `JR_IPC`, `FEATURE_IPC` from the `api` object.

`core/parent-controls.js` — add after `setControls`:

```js
  // Kid name and birthdate, editable from the JARVIS JR settings tab. NOT a
  // route to the PIN or the checklist: it reads the secret, changes at most
  // those two fields, and writes it back. A rejected birthdate leaves the
  // stored one untouched rather than half-applying.
  setProfile({ kidName, birthdate } = {}) {
    const data = this.#read();
    if (birthdate !== undefined) {
      const parsed = parseBirthdate(birthdate);
      if (!parsed) return { ok: false, reason: 'Birthdate must be a real date, YYYY-MM-DD.' };
      const age = wholeYears(parsed.date, new Date());
      if (age < AGE_MIN || age > AGE_MAX) {
        return { ok: false, reason: `JARVIS JR is for kids aged ${AGE_MIN} to ${AGE_MAX}.` };
      }
      data.birthdate = parsed.text;
    }
    if (kidName !== undefined) data.kidName = normalizeKidName(kidName);
    this.#write(data);
    return { ok: true, kidName: data.kidName || '', birthdate: data.birthdate || '' };
  }
```

- [ ] **Step 4: Green, then the full suite**

```
node --test test/parent-session.test.js test/jr-unlock.test.js test/variant.test.js test/jr-boot.test.js test/parent-controls.test.js
node --test 2>&1 | tail -5
```
Expected breakage elsewhere: `test/router-jr.test.js` may shift because `profileFor('jr')` now grants `nightShift/schedules/autonomy/phone`. Read each failure — a router branch that newly *passes* is a Task 5 concern; do not paper over it here.

- [ ] **Step 5: Commit**

```bash
git add core/variant.js core/parent-session.js core/parent-controls.js \
        test/variant.test.js test/jr-boot.test.js test/parent-session.test.js \
        test/jr-unlock.test.js test/parent-controls.test.js
git commit -m "jr: profile means kid reach only; parent session + call-time IPC gate (pure)"
```

---

### Task 2: main.js — build the whole app, gate at call time, hot-apply the profile

**Files:**
- Modify: `main.js`, `preload.js`
- Test: `test/jr-boot.test.js` (source-text wiring section), `test/ipc-contract.test.js` (must stay green unchanged)

**Interfaces:**
- Produces: `jr:parent:lock`, `jr:parent:session` handlers; `jr:profile` broadcast; `parentSession` module-level; `applyProfile()`.
- Removes: `jr:parent:cameras` handler; every `PROFILE.<flag> ? new Service(...) : null`; both `app.relaunch(); app.exit(0)` calls.
- Consumes: `ParentSession`, `jrChannelAllowed`, `jrSettingsPatch`, `jrIpcAllowlist`.

- [ ] **Step 1: Write the failing tests** — append to `test/jr-boot.test.js`:

```js
// main.js pulls in electron, so it cannot be required under node:test. These
// read it as text — the same seam test/ipc-contract.test.js checks — and pin
// the wiring facts that would otherwise be invisible until a manual run.
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

test('main.js: JR constructs the whole app — no service is profile-gated any more', () => {
  for (const flag of ['autonomy', 'documents', 'cameras', 'claudeBridge', 'screenRead',
                      'screenDrive', 'defense', 'schedules', 'nightShift', 'phone']) {
    assert.ok(!new RegExp(`PROFILE\\.${flag}\\s*\\?`).test(MAIN),
      `PROFILE.${flag} must no longer decide construction — the parent owns that now`);
  }
  assert.ok(!/if \(PROFILE\.cameras\)/.test(MAIN), 'the camera construction block must be unconditional');
});

test('main.js: the IPC gate is consulted per call, through the pure helper', () => {
  assert.ok(/jrChannelAllowed\(/.test(MAIN), 'the wrap must use the tested pure gate');
  assert.ok(/parentSession\.admit\(\)/.test(MAIN), 'the gate must be handed the session heartbeat');
  assert.ok(!/const ALLOWED = jrIpcAllowlist\(PROFILE\);/.test(MAIN),
    'the static boot-time allowlist Set is gone — it cannot be widened at runtime');
});

test('main.js: only a verified PIN opens the session; lock and status exist', () => {
  assert.ok(/parentSession\.unlock\(\)/.test(MAIN));
  assert.ok(/ipcMain\.handle\('jr:parent:lock'/.test(MAIN));
  assert.ok(/ipcMain\.handle\('jr:parent:session'/.test(MAIN));
  // Exactly one unlock call site, and it must be inside jr:parent:verify.
  assert.equal((MAIN.match(/parentSession\.unlock\(\)/g) || []).length, 1);
  const verify = MAIN.slice(MAIN.indexOf("ipcMain.handle('jr:parent:verify'"));
  assert.ok(verify.slice(0, 500).includes('parentSession.unlock()'));
});

test('main.js: settings:save is filtered by the session, not by the variant alone', () => {
  assert.ok(/jrSettingsPatch\(/.test(MAIN));
  assert.ok(!/JR \? filterJrSettingsPatch\(/.test(MAIN), 'the old unconditional JR filter is gone');
});

test('main.js: the camera multiplexer and the relaunch dance are both gone', () => {
  assert.ok(!/jr:parent:cameras/.test(MAIN));
  assert.ok(!/jrParentCameras/.test(PRELOAD));
  assert.ok(!/app\.relaunch\(\)/.test(MAIN), 'a checklist change hot-applies now');
  assert.ok(/function applyProfile\(/.test(MAIN));
  assert.ok(/router\.profile = PROFILE/.test(MAIN));
  assert.ok(/ai\.profile = PROFILE/.test(MAIN));
});

test('preload.js: the parent surface is lock/session/profile-events, no PIN plumbing', () => {
  assert.ok(/jrParentLock:/.test(PRELOAD));
  assert.ok(/jrParentSession:/.test(PRELOAD));
  assert.ok(/onJrProfile:/.test(PRELOAD));
});
```

- [ ] **Step 2: Run red** — `node --test test/jr-boot.test.js`. Expected: six failures, all on the source-text assertions.

- [ ] **Step 3: Implement `main.js`**

1. Import `ParentSession` from `./core/parent-session`; add `jrChannelAllowed, jrSettingsPatch` to the `./core/variant` destructure. Add `let parentSession;` and `let KID_IPC = null;` beside the other module-level `let`s (~L100).
2. In `app.whenReady`, after `parentControls = ...`, add `parentSession = JR ? new ParentSession() : null;`.
3. Replace the IPC wrap block (L1456-1477) with:

```js
  if (JR) {
    // The kid's surface, recomputed by applyProfile() whenever the checklist
    // changes. Everything NOT in it is admin: reachable only while the parent
    // session is open, checked at INVOCATION time (not registration time, the
    // way this used to work) so that when the session expires the very next
    // call is refused with no timer to fire and no handler to swap out. A call
    // already admitted runs to completion — the gate is a door, not a leash.
    KID_IPC = jrIpcAllowlist(PROFILE);
    const gate = (channel) => jrChannelAllowed(channel, KID_IPC, () => parentSession.admit());
    const realHandle = ipcMain.handle.bind(ipcMain);
    const realOn = ipcMain.on.bind(ipcMain);
    ipcMain.handle = (channel, listener) => realHandle(channel, async (event, ...args) => {
      if (!gate(channel)) throw new Error(`${channel} needs a grown-up. Ask a parent to unlock Settings.`);
      return listener(event, ...args);
    });
    ipcMain.on = (channel, listener) => realOn(channel, (event, ...args) => {
      if (!gate(channel)) return;
      listener(event, ...args);
    });
    Menu.setApplicationMenu(null);
  }
```

4. Add, next to the other top-level functions:

```js
// The checklist changed. PROFILE used to be frozen at boot, which is why every
// change relaunched the app; now nothing is CONSTRUCTED from it, so rebuilding
// it in place is enough. Three live consumers hold it, all of which read it
// per call: the IPC gate's kid set, the router's feature branches, and the AI
// service's tool-registry filter. The renderer gets it pushed so module cards
// follow immediately.
function applyProfile() {
  PROFILE = profileFor(VARIANT, parentControls ? parentControls.getControls() : null);
  if (JR) KID_IPC = jrIpcAllowlist(PROFILE);
  if (router) router.profile = PROFILE;
  if (ai) ai.profile = PROFILE;
  sendEverywhere('jr:profile', PROFILE);
  return PROFILE;
}
```

5. Rewrite the four `jr:*` handlers (L615-638):

```js
  ipcMain.handle('jr:status', () => ({
    jr: JR,
    setUp: JR ? parentControls.isSetUp() : true,
    profile: PROFILE,
    session: JR ? parentSession.status() : { unlocked: true, expiresInSeconds: 0 }
  }));
  ipcMain.handle('jr:setup:complete', (_e, payload) => {
    if (!JR) return { ok: false };
    const result = parentControls.completeSetup(payload || {});
    if (result.ok) applyProfile();   // no relaunch: nothing is built from PROFILE
    return result;
  });
  ipcMain.handle('jr:parent:verify', (_e, payload) => {
    if (!JR) return { ok: false };
    const result = parentControls.verifyPin(payload?.pin);
    // The ONE place the session ever opens. Same throttled PinGate as before,
    // so a wrong PIN still counts toward the lockout.
    if (result.ok) parentSession.unlock();
    return result.ok ? { ok: true, session: parentSession.status() } : result;
  });
  ipcMain.handle('jr:parent:lock', () => { if (JR) parentSession.lock(); return { ok: true }; });
  ipcMain.handle('jr:parent:session', () => (JR ? parentSession.status() : { unlocked: true, expiresInSeconds: 0 }));
  // Admin-only (not in JR_IPC): the wrap above already refused this call
  // unless the session is open. The explicit re-check is belt and braces —
  // this handler must never be one refactor away from being kid-reachable.
  ipcMain.handle('jr:parent:controls', (_e, payload) => {
    if (!JR || !parentSession.status().unlocked) return { ok: false, expired: true };
    if (payload?.patch) parentControls.setControls(payload.patch);
    if (payload?.profile) {
      const saved = parentControls.setProfile(payload.profile);
      if (!saved.ok) return saved;
    }
    const controls = parentControls.getControls();
    if (payload?.patch) applyProfile();
    return {
      ok: true, controls,
      kidName: parentControls.getKidName(),
      birthdate: parentControls.getBirthdate(),
      age: parentControls.age()
    };
  });
  ipcMain.handle('jr:parent:pin', (_e, payload) => (
    JR && parentSession.status().unlocked
      ? parentControls.setPin(payload?.oldPin, payload?.newPin)
      : { ok: false, expired: true }
  ));
```

6. `settings:save` (L940): replace the `incomingPatch` line with
   `const incomingPatch = jrSettingsPatch(patch, { jr: JR, unlocked: Boolean(parentSession && parentSession.status().unlocked) });`
   (`status()`, not `admit()` — `settings:save` is a kid channel, so it must not act as a heartbeat.)
7. Delete the whole `jr:parent:cameras` handler (L1195-1235) and its comment block.
8. Un-gate construction. Each of these loses its `PROFILE.x ?` / `: null`: `autonomy` (L1492), `documents` (L1506), the `if (PROFILE.cameras) { … } else { go2rtc = null; cameras = null; }` wrapper (L1517-1559 — keep the body, drop the conditional and the else), `claudeBridge` (L1560), `screenReader` (L1569), `hands` (L1578), `defense` (L1623) plus its `if (defense)`, `scheduleStore`/`nightShift`/`scheduleService` (L1633-1635), `folderWatch` (L1659), `mobileAuth`/`mobileServer` (L1684-1685). Drop the `.filter((check) => check.name !== 'night-shift-failures' || nightShift)` on the heartbeat checks. Leave every downstream `if (autonomy)` / `if (defense)` null-check in place — they are now always true and cost nothing. Replace each removed comment with one line: *"Constructed exactly as the standard build does. In JR, what the KID can reach is PROFILE (IPC allowlist + router); what EXISTS is the parent's business."*
9. `preload.js`: delete `jrParentCameras`; add
   `jrParentLock: () => ipcRenderer.invoke('jr:parent:lock'),`
   `jrParentSession: () => ipcRenderer.invoke('jr:parent:session'),`
   `onJrProfile: (callback) => on('jr:profile', callback),`
   and extend `jrParentControls` to `(patch, profile) => ipcRenderer.invoke('jr:parent:controls', { patch, profile })` — **no PIN argument any more**.

- [ ] **Step 4: Green, then the full suite**

```
node --test test/jr-boot.test.js test/ipc-contract.test.js
node --test 2>&1 | tail -5
```

- [ ] **Step 5: Manual verification (run it, do not claim it)**

`npm run start:jr` on a fresh JR userData:
1. Setup sheet appears; complete it → **the app comes up without restarting**.
2. Kid state: DevTools shortcut dead, no menu, Parent button present, Settings hidden.
3. Parent button → wrong PIN 5× → lockout countdown. Right PIN → settings dialog opens.
4. In the dialog, add an RTSP camera → succeeds (this is `cameras:add-rtsp`, admin, previously unreachable).
5. Close the dialog, reopen without the PIN → refused.
6. Unlock, then leave it 11 minutes untouched → next save throws and the UI asks for the PIN again.
7. `npm start` (standard) → byte-identical behaviour: menu, DevTools, full settings, no PIN.

- [ ] **Step 6: Commit**

```bash
git add main.js preload.js test/jr-boot.test.js
git commit -m "jr: build the whole app; PIN opens a self-expiring main-process session at the IPC gate"
```

---

### Task 3: The settings dialog — LOOKS tab, JARVIS JR tab, kid filtering

**Files:**
- Modify: `src/settings-tabs.js`, `src/index.html`, `src/renderer.js`
- Test: `test/settings-tabs.test.js`

**Interfaces:**
- Produces: `TABS` (10, with `looks` after `general` and `jr` last), `KID_TABS` (`[{id:'looks'}]`), `tabsFor({jr, unlocked}) -> {tabs, restricted}`, `normalizeTab(id, tabs = TABS)`, `sectionHidden(sectionTab, activeTab, {tabs, restricted})`.
- Consumes: `window.JrVariant.CONTROL_KEYS` / `CONTROL_LABELS`, `window.jarvis.jrParentControls`, `jrParentPin`, `jrParentLock`, `jrParentSession`.

- [ ] **Step 1: Failing tests** — rewrite `test/settings-tabs.test.js`'s first test and append:

```js
const { TABS, KID_TABS, normalizeTab, sectionHidden, tabsFor } = require('../src/settings-tabs');

test('TABS: ten tabs, unique ids, GENERAL first, LOOKS and JARVIS JR present', () => {
  assert.equal(TABS.length, 10);
  assert.equal(TABS[0].id, 'general');
  for (const id of ['looks', 'cameras', 'pro', 'jr']) {
    assert.ok(TABS.some((tab) => tab.id === id), `the ${id} tab must exist`);
  }
  const ids = TABS.map((tab) => tab.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const tab of TABS) {
    assert.ok(tab.id && typeof tab.id === 'string');
    assert.ok(tab.label && typeof tab.label === 'string');
  }
});

test('tabsFor: the grown-up build never sees the JARVIS JR tab', () => {
  const { tabs, restricted } = tabsFor({ jr: false });
  assert.equal(restricted, false);
  assert.ok(!tabs.some((tab) => tab.id === 'jr'));
  assert.equal(tabs.length, TABS.length - 1);
});

test('tabsFor: an unlocked JR parent gets the real, complete dialog', () => {
  const { tabs, restricted } = tabsFor({ jr: true, unlocked: true });
  assert.equal(restricted, false);
  assert.deepEqual(tabs.map((t) => t.id), TABS.map((t) => t.id));
});

test('tabsFor: a JR kid gets exactly one tab, and it is cosmetic', () => {
  const { tabs, restricted } = tabsFor({ jr: true, unlocked: false });
  assert.equal(restricted, true);
  assert.deepEqual(tabs.map((t) => t.id), ['looks']);
  assert.deepEqual(KID_TABS.map((t) => t.id), ['looks']);
});

test('a restricted tab set is DENY-BY-DEFAULT — an untagged section never leaks in', () => {
  const kid = tabsFor({ jr: true, unlocked: false });
  assert.equal(sectionHidden('looks', 'looks', kid), false);
  for (const tab of ['brains', 'cameras', 'automation', 'abilities', 'phone', 'system', 'jr', 'general']) {
    assert.equal(sectionHidden(tab, 'looks', kid), true, `${tab} must be hidden from the kid`);
  }
  // The forgiving fallback that keeps an untagged section visible under
  // GENERAL must NOT apply under a restricted set.
  assert.equal(sectionHidden(undefined, 'looks', kid), true);
  // Unrestricted behaviour is unchanged.
  assert.equal(sectionHidden(undefined, 'general'), false);
  assert.equal(sectionHidden('brains', 'general'), true);
});

test('normalizeTab honours the tab set it is given', () => {
  assert.equal(normalizeTab('cameras'), 'cameras');
  assert.equal(normalizeTab('cameras', KID_TABS), 'looks');
  assert.equal(normalizeTab(undefined, KID_TABS), 'looks');
});
```

- [ ] **Step 2: Run red** — `node --test test/settings-tabs.test.js`.

- [ ] **Step 3: Implement**

`src/settings-tabs.js`:
```js
  const TABS = [
    { id: 'general', label: 'GENERAL' },
    { id: 'looks', label: 'LOOKS' },
    { id: 'brains', label: 'BRAINS' },
    { id: 'cameras', label: 'CAMERAS' },
    { id: 'automation', label: 'AUTOMATION' },
    { id: 'abilities', label: 'ABILITIES' },
    { id: 'phone', label: 'PHONE' },
    { id: 'pro', label: 'FEATURES' },
    { id: 'system', label: 'SYSTEM' },
    { id: 'jr', label: 'JARVIS JR' }
  ];

  // The JR kid's whole settings dialog: how it looks, nothing else. Matches
  // core/variant.js's JR_SETTINGS_ALLOW, which is the main-process belt behind
  // this braces — a hand-crafted settings:save from a locked JR renderer still
  // only writes cosmetics.
  const KID_TABS = TABS.filter((tab) => tab.id === 'looks');

  function tabsFor({ jr = false, unlocked = false } = {}) {
    if (!jr) return { tabs: TABS.filter((tab) => tab.id !== 'jr'), restricted: false };
    if (unlocked) return { tabs: TABS, restricted: false };
    return { tabs: KID_TABS, restricted: true };
  }

  function normalizeTab(id, tabs = TABS) {
    return tabs.some((tab) => tab.id === id) ? id : tabs[0].id;
  }

  // Under the FULL set the old forgiving rule holds: an untagged section shows
  // under the first tab, so nothing can vanish from every tab by accident.
  // Under a RESTRICTED set (the kid's) that fallback is a hole — a section
  // someone forgets to tag would land in the kid's dialog — so restricted sets
  // are deny-by-default, the same JUNIOR principle moduleAllowedInProfile runs on.
  function sectionHidden(sectionTab, activeTab, { tabs = TABS, restricted = false } = {}) {
    if (restricted && !tabs.some((tab) => tab.id === sectionTab)) return true;
    return normalizeTab(sectionTab, tabs) !== normalizeTab(activeTab, tabs);
  }
```
Export `KID_TABS` and `tabsFor`.

`src/index.html`:
- Split the `data-tab="general"` BEHAVIOR section (L417-437): keep `setting-profile-name`, `setting-assistant-name`, `setting-voice`, `setting-wake`, `setting-top`, `setting-startup` in `general`; move `setting-orb` (minimize to orb), `setting-motion`, `setting-skin`, `setting-orb-skin`, `setting-orb-color`, `setting-glass` into a **new** `<section data-tab="looks"><h3>LOOKS</h3>…</section>` placed straight after. Leave every id untouched.
- Add the JR section before `</div>` of `.settings-grid`:
```html
          <section class="wide-setting" data-tab="jr">
            <h3>JARVIS JR</h3>
            <p class="jr-note" id="jr-tab-session"></p>
            <label>KID'S NAME<input id="jr-tab-name" maxlength="24" autocomplete="off"></label>
            <label>BIRTHDATE<input id="jr-tab-birthdate" type="date"></label>
            <p class="jr-note" id="jr-tab-age"></p>
            <h4>WHAT <span id="jr-tab-kid-label">YOUR KID</span> CAN REACH</h4>
            <div id="jr-tab-controls" class="jr-checklist"></div>
            <p class="jr-note">Changes apply immediately. Turning something off takes it away from the kid — it does not uninstall it.</p>
            <button type="button" id="jr-tab-save">SAVE JARVIS JR SETTINGS</button>
            <h4>PARENT PIN</h4>
            <label>NEW PIN (4–8 numbers)<input id="jr-tab-new-pin" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></label>
            <button type="button" id="jr-tab-pin-save" class="outline-action">CHANGE PIN</button>
            <button type="button" id="jr-tab-lock" class="outline-action">LOCK PARENT SETTINGS NOW</button>
            <p id="jr-tab-status" class="jr-note" hidden></p>
          </section>
```

`src/renderer.js`:
- Add `state.jrSession = { unlocked: false, expiresInSeconds: 0 };` and a helper:
```js
// The three modes the settings dialog has: the grown-up build, a JR parent who
// has entered the PIN, and a JR kid. Only the parent may touch admin IPC — a
// kid calling mobile:status/schedule:list/defense:zones gets a throw from the
// main-process gate, which would blow up openSettings() halfway through.
function settingsAudience() {
  const jr = state.profile?.variant === 'jr';
  return { jr, unlocked: !jr || Boolean(state.jrSession?.unlocked) };
}
```
- `initSettingsTabs()` and `selectSettingsTab(id)` take the `tabsFor(settingsAudience())` result and thread it into `normalizeTab`/`sectionHidden`. `initSettingsTabs()` must be re-runnable (it already uses `replaceChildren`) — call it at the top of `openSettings()` so a PIN unlock re-renders the strip.
- In `openSettings(tab)`: after `initSettingsTabs()`, wrap the admin-only refreshers — `refreshMobileSection()`, `refreshScheduleList()`, `populateDefenseSettings()`, `updateScheduleFormVisibility()`, `renderSearchRoots()`, `applyUpdateInfo(...)` — in `if (settingsAudience().unlocked) { … }`. Add `if (settingsAudience().jr && settingsAudience().unlocked) await loadJrTab();`.
- In `saveSettings(event)`: if `!settingsAudience().unlocked`, build a **cosmetic-only patch** (`skin, orbSkin, orbColor, windowGlass, motionMode, minimizeToOrb, voiceName, voiceEnabled, wakeWordEnabled, ttsEngine, kokoroVoice`) instead of the full one — the kid's dialog must not silently drop half of what it appears to save. On a rejected save (`expired`), close the dialog and re-show the PIN sheet.
- Add the JR-tab wiring: `loadJrTab()` calls `window.jarvis.jrParentControls()` (no args = read), renders the checklist from `window.JrVariant.CONTROL_KEYS` + `CONTROL_LABELS`, fills name/birthdate/age; `#jr-tab-save` sends `{patch, profile:{kidName, birthdate}}`; `#jr-tab-pin-save` calls `jrParentPin`; `#jr-tab-lock` calls `jrParentLock()` then closes the dialog. A 1 Hz `jrParentSession()` poll while the dialog is open updates `#jr-tab-session` and closes the dialog on expiry.
- `window.jarvis.onJrProfile((profile) => { state.profile = profile; renderModuleVisibility(); });` in `bindEvents`.
- `$('camera-add-toggle')` (L2271): `openSettings(settingsAudience().unlocked ? 'cameras' : 'looks')`, and hide the button entirely for a locked JR kid.

- [ ] **Step 4: Green + full suite** — `node --test test/settings-tabs.test.js` then `node --test 2>&1 | tail -5`.

- [ ] **Step 5: Manual** — standard build: LOOKS tab exists, appearance controls moved and still save, no JARVIS JR tab. JR unlocked: 10 tabs, JR tab loads name/age/17 checkboxes, flipping `terminal` on makes the terminal card appear **without a restart**. JR locked: one LOOKS tab, saving a skin persists, no other section visible in the DOM inspector-free eyeball test.

- [ ] **Step 6: Commit**

```bash
git add src/settings-tabs.js src/index.html src/renderer.js test/settings-tabs.test.js
git commit -m "jr: real settings dialog — LOOKS tab, JARVIS JR tab, cosmetic-only for the kid"
```

---

### Task 4: `src/jr-parent-ui.js` — keep the setup gate, replace the panel with a PIN sheet

**Files:**
- Modify: `src/jr-parent-ui.js`, `src/index.html`, `src/renderer.js`, `src/styles.css` (delete dead camera-form rules)
- Test: `test/jr-boot.test.js`

- [ ] **Step 1: Failing tests** — append to `test/jr-boot.test.js`:

```js
const PARENT_UI = fs.readFileSync(path.join(__dirname, '..', 'src', 'jr-parent-ui.js'), 'utf8');

test('jr-parent-ui: the renderer never holds a PIN or a checklist any more', () => {
  assert.ok(!/verifiedPin/.test(PARENT_UI), 'the PIN is verified once and forgotten — main owns the session');
  assert.ok(!/var LABELS/.test(PARENT_UI), 'labels live in core/variant.js CONTROL_LABELS now');
  assert.ok(!/jrParentCameras|jr-cam-/.test(PARENT_UI), 'camera account forms are gone with the multiplexer');
  assert.ok(!/renderChecklist/.test(PARENT_UI), 'the checklist lives in the JARVIS JR settings tab');
});

test('jr-parent-ui: it still owns the blocking first-run setup, and opens the REAL dialog', () => {
  assert.ok(/jr-setup/.test(PARENT_UI), 'the first-run gate stays here');
  assert.ok(/openSettings\(/.test(PARENT_UI), 'a verified PIN opens the real settings dialog');
});

test('index.html: the bespoke parent panel markup is gone, the setup sheet is not', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  assert.ok(html.includes('id="jr-setup"'));
  assert.ok(!html.includes('id="jr-cameras"'), 'the panel camera forms are deleted');
  assert.ok(!html.includes('id="jr-parent-controls"'), 'the panel checklist is deleted');
  assert.ok(html.includes('id="jr-pin-sheet"'), 'the small PIN sheet replaces the panel');
});
```

- [ ] **Step 2: Run red** — `node --test test/jr-boot.test.js`.

- [ ] **Step 3: Implement**

- `src/index.html`: replace the whole `<div id="jr-parent">…</div>` block (L657 to its close) with a small sheet:
```html
    <div id="jr-pin-sheet" class="jr-overlay" hidden>
      <div class="jr-sheet">
        <h2>PARENT SETTINGS</h2>
        <p class="jr-note">Enter the parent PIN to open JARVIS's full settings.</p>
        <label>PIN <input id="jr-pin-input" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></label>
        <button type="button" id="jr-pin-unlock">UNLOCK</button>
        <button type="button" id="jr-pin-cancel" class="outline-action">CANCEL</button>
        <p id="jr-pin-error" class="jr-error" hidden></p>
      </div>
    </div>
```
  Also drop the `jr-note` in `#jr-setup` that promises "changes apply at next launch" — they apply immediately now.
- `src/jr-parent-ui.js`: keep `$`, `setBlocked`, `showError`, the setup-sheet half (`showSetupOverlay`, `submitSetup` — remove the "RESTARTING…" copy, it just closes now), `startLockoutCountdown`, and:
```js
  function openPinSheet() { … focus … }
  function unlockAndOpenSettings() {
    var pin = $('jr-pin-input').value;
    window.jarvis.jrParentVerify(pin).then(function (result) {
      $('jr-pin-input').value = '';           // the PIN is never kept, here or anywhere
      if (!result || !result.ok) {
        if (result && result.locked) startLockoutCountdown(result.retryInSeconds || 30);
        else showError($('jr-pin-error'), 'Wrong PIN.');
        return;
      }
      closePinSheet();
      // The session now lives in the main process. The renderer only learns
      // that it exists — it holds nothing it could replay.
      window.jrSettingsUnlocked(result.session);   // set by renderer.js
    });
  }
```
  `installParentButton()` keeps hiding `#settings-button`/`#cc-settings` **only when JR** and wires `#jr-parent-button`/`#jr-parent-button-cc` to `openPinSheet`. **New:** it also un-hides a kid-facing ⚙ that calls `openSettings('looks')` — reuse `#settings-button`/`#cc-settings` themselves (retitle to "Looks") rather than adding elements, so the kid keeps his cosmetic panel with no PIN, exactly as the owner asked.
  `showSetupOverlay` renders its initial checklist from `window.JrVariant.CONTROL_KEYS`/`CONTROL_LABELS`.
- `src/renderer.js`: define `window.jrSettingsUnlocked = (session) => { state.jrSession = session; openSettings('jr'); };` and, on `#settings-modal`'s `close` event, `if (state.profile?.variant === 'jr' && state.jrSession.unlocked) { window.jarvis.jrParentLock(); state.jrSession = { unlocked: false, expiresInSeconds: 0 }; }`. Also set `state.jrSession = jrStatus.session` at boot.
- `src/styles.css`: delete `.jr-camera-*`, `.jr-cameras-list`, `#jr-cam-*` rules; keep `.jr-overlay`, `.jr-sheet`, `.jr-checklist`, `.jr-note`, `.jr-error`.

- [ ] **Step 4: Green + full suite.**

- [ ] **Step 5: Manual** — JR: ⚙ opens the LOOKS-only dialog with no PIN; 🔒 Parent opens the PIN sheet; a correct PIN opens the full dialog on the JARVIS JR tab; closing it and reopening ⚙ shows LOOKS only again (the session was revoked on close). Standard: `#jr-pin-sheet` never appears, ⚙ behaves exactly as before.

- [ ] **Step 6: Commit**

```bash
git add src/jr-parent-ui.js src/index.html src/renderer.js src/styles.css test/jr-boot.test.js
git commit -m "jr: PIN sheet opens the real settings; bespoke parent panel and camera forms deleted"
```

---

### Task 5: Pin the security properties, fix the documents regression, verify end to end

**Files:**
- Modify: `core/router.js` (two expressions), `test/router-jr.test.js`, `test/jr-tools.test.js`
- Modify: `docs/superpowers/specs/2026-07-28-jarvis-jr-design.md`, `CHANGELOG.md`

- [ ] **Step 1: Failing tests** — append to `test/router-jr.test.js`:

```js
const fs = require('node:fs');
const path = require('node:path');

// THE INVARIANT THIS WHOLE REFACTOR RESTS ON. The parent session widens the
// IPC surface and settings:save. It must NOT widen what the KID can ask for in
// words — a parent standing at an unlocked settings dialog while the kid types
// "open a terminal" into the command bar is the exact scenario. The router is
// handed a profile and nothing else; if it ever learns what a session is, this
// test is the alarm.
test('the parent session cannot reach the router: no session concept exists in core/', () => {
  for (const file of ['router.js', 'ai-service.js', 'tool-registry.js', 'kid-mode.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'core', file), 'utf8');
    assert.ok(!/parentSession|ParentSession|unlocked/.test(source),
      `core/${file} must know nothing about the parent unlock`);
  }
});

test('the three new keys gate their router branches, and default off', async () => {
  const router = jrRouter(DEFAULT_CONTROLS);
  for (const [phrase, label] of [
    ['ask claude what a black hole is', /claude/i],
    ['take over the screen and click the button for me', /screen|driv/i],
    ['go into defense mode', /defense/i]
  ]) {
    const result = await router.handle(phrase);
    assert.match(result.source, /jr-gate|safety/, `${phrase} must refuse (${label})`);
  }
});

test('documents-off never touches the documents service, even though it now exists', async () => {
  // Before this refactor `documents` was null in JR when the key was off, and
  // the router leaned on that truthiness. It is always constructed now, so the
  // gate must read the PROFILE. mine('documents') detonates if it does not.
  const router = jrRouter({ ...DEFAULT_CONTROLS, files: true, documents: false });
  const result = await router.handle('run my homework routine');
  assert.match(result.source, /jr-gate|safety|local|ai/);
});
```

Append to `test/jr-tools.test.js`:

```js
test('the tool belt is the kid checklist, unlock or no unlock — there is no session input', () => {
  const kid = profileFor('jr', DEFAULT_CONTROLS);
  const registry = buildToolRegistry(stubDeps());     // this file's existing helper
  const filtered = filterRegistryForProfile(registry, kid);
  assert.ok(!filtered.some((tool) => tool.feature === 'files'));
  assert.equal(filterRegistryForProfile.length, 2, 'filtering takes a registry and a profile, nothing else');
});
```

- [ ] **Step 2: Run red** — `node --test test/router-jr.test.js test/jr-tools.test.js`. The documents test should detonate on the booby trap; that is the regression from Risk 4 proving itself.

- [ ] **Step 3: Implement** — `core/router.js`, two expressions only:
- L667: `(hasFolders && this.profile.files && this.profile.contentLock && this.profile.documents && this.documents)`
- L676: `else if (this.profile.contentLock && hasFolders && this.profile.files && !this.profile.documents)`

Update the surrounding comment: *"`this.documents` is always constructed now (JR builds what the standard build builds); the gate reads `profile.documents`, which is the kid's permission, not the service's existence."*

- [ ] **Step 4: Green, then the full suite twice** — once normally, once with `node --test 2>&1 | grep -E "^not ok"` to be sure nothing is being swallowed. Confirm the count is ≥ the recorded baseline.

- [ ] **Step 5: End-to-end verification protocol** (run all of it on a fresh JR userData; this is the task's real deliverable)

| # | Check | Expect |
|---|---|---|
| 1 | Fresh `npm run start:jr` | Blocking setup sheet, 17 checkboxes, no restart on completion |
| 2 | Kid asks "open the terminal" (terminal off) | JR gate refusal, no terminal |
| 3 | Kid asks something the content lock catches | Deflection, unchanged from today |
| 4 | Kid ⚙ | LOOKS only; skin change persists across restart |
| 5 | Kid tries `window.jarvis.jrParentControls({terminal:true})` from the command bar — *there is no console; do this by temporarily adding a button in a scratch build, then revert* | Refused: admin channel, session locked |
| 6 | Parent PIN → cameras tab → add RTSP, remove it | Works |
| 7 | Parent PIN → BRAINS → save an Anthropic key | Works |
| 8 | Parent PIN → AUTOMATION → night shift on, schedules on | Persists; no relaunch prompt |
| 9 | Parent PIN → PHONE → pair a device | Works |
| 10 | Parent PIN → JARVIS JR → terminal on, save | Terminal card appears immediately; kid can now use it |
| 11 | Parent PIN → JARVIS JR → change PIN → close → reopen with the new PIN | Works; old PIN refused |
| 12 | Unlock, wait 11 min, click Save | Rejected, PIN sheet returns |
| 13 | Unlock, close dialog, immediately reopen ⚙ | LOOKS only |
| 14 | Throughout: Ctrl+Shift+I, F12, menu bar | Nothing, in every state including unlocked |
| 15 | `npm start` (standard) | Identical to pre-refactor, LOOKS tab aside |

- [ ] **Step 6: Docs + commit**

Update `docs/superpowers/specs/2026-07-28-jarvis-jr-design.md`: replace "The grown-up panel" and the never-in-JR list with the new model — *the parent gets the real settings dialog behind a self-expiring PIN session; the kid gets the content lock, a 17-item reach checklist he cannot open, and a cosmetic-only LOOKS panel; the only thing with no off switch is the content lock.* Add a CHANGELOG entry.

```bash
git add core/router.js test/router-jr.test.js test/jr-tools.test.js \
        docs/superpowers/specs/2026-07-28-jarvis-jr-design.md CHANGELOG.md
git commit -m "jr: pin kid reach against the parent unlock; documents gate reads the profile, not the service"
```

---

## Critical files for implementation

- `C:\Users\steam\Projects\apps\jarvis-jr-build\core\variant.js`
- `C:\Users\steam\Projects\apps\jarvis-jr-build\main.js`
- `C:\Users\steam\Projects\apps\jarvis-jr-build\src\renderer.js`
- `C:\Users\steam\Projects\apps\jarvis-jr-build\src\jr-parent-ui.js`
- `C:\Users\steam\Projects\apps\jarvis-jr-build\src\settings-tabs.js`

Five tasks. Tasks 1 and 5 are pure-module work with real automated coverage; Task 2 is the one with irreducible manual verification (main.js cannot be loaded under `node --test`); Tasks 3 and 4 are renderer work kept separate only because Task 3 has a genuine automated test cycle and Task 4 is mostly deletion.