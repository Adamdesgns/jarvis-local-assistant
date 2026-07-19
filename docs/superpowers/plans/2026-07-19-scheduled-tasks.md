# JARVIS Scheduled Tasks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** JARVIS fires saved items on a schedule — speak a reminder, run a real agent request, check a camera, or give a daily briefing — driven by a single timer aimed at the next due item, never a poll.

**Architecture:** Pure date math (`core/schedule-times.js`) decides *when*; a store (`core/schedule-store.js`) persists *what*; a service (`core/schedule-service.js`) holds exactly one `setTimeout`, re-armed on fire, on edit, and on system resume. Running an item reuses `router.handle()` (agent path) or the existing `autonomy:event` speak channel — no new IPC and no new brain.

**Tech Stack:** Node built-ins, Electron `powerMonitor`, `node:test`.

## Global Constraints

- Branch `scheduled-tasks`. Commit per task. Do not push unless asked.
- `npm test` green after every task. Baseline **110**.
- Master switch `schedulesEnabled` — **default false**. Nothing arms or fires when off.
- **Exactly one timer.** No `setInterval`, no polling loop, anywhere in this feature.
- Unattended runs are read-only: the agent's `open_application` tool is withheld. Everything else in the registry is read/append-only and stays.
- Quiet hours (`autonomyNightStart` 21 / `autonomyNightEnd` 7) suppress *speech* only — results still reach the screen and the activity log.
- Copy style matches JARVIS ("This was due at 7:00 AM, sir.").
- Timer tests inject fake timers/clock. **No test may wait on wall-clock time.**

## File Map

| File | Responsibility |
|---|---|
| `core/schedule-times.js` (new, pure) | `nextRunAt`, `dueSince`, `pickNext` |
| `core/schedule-store.js` (new) | CRUD + atomic persistence of `schedules.json` |
| `core/schedule-service.js` (new) | The single timer, catch-up, run dispatch |
| `core/tool-registry.js` (mod) | `look_at_camera` tool; accept `getCameras`/`ai` |
| `core/ai-service.js` (mod) | Withhold `open_application` when `context.unattended` |
| `core/router.js` (mod) | Pass `unattended` through to `ai.reply` |
| `core/defaults.js`, `core/config-store.js` (mod) | `schedulesEnabled` default + whitelist |
| `main.js`, `preload.js` (mod) | Construct/start service, `powerMonitor` resume, `schedule:*` IPC |
| `src/index.html`, `src/renderer.js` (mod) | Settings → SCHEDULE section |
| `test/schedule-*.test.js` (new) | Unit tests |
| `docs/SCHEDULE-TESTING-CHECKLIST.md` (new) | Manual end-to-end checklist |

---

### Task 1: Setting default + whitelist

**Files:** Modify `core/defaults.js`, `core/config-store.js`; Test: `test/core.test.js`

**Interfaces:** Produces `settings.schedulesEnabled: boolean` (false), accepted by `updateSettings`.

- [ ] **Step 1: Failing test** — extend the existing config-store round-trip test in `test/core.test.js` (the one added for `mobileEnabled`; find it by searching `mobileEnabled`) with:

```js
  store.updateSettings({ schedulesEnabled: true });
  assert.equal(new ConfigStore(dir).getSettings().schedulesEnabled, true);
```

Also add to the defaults-merge assertions: `assert.equal(mergeSettings(DEFAULT_SETTINGS, {}).schedulesEnabled, false);`

- [ ] **Step 2: Run** `node --test test/core.test.js` — expect FAIL (undefined / dropped by whitelist).
- [ ] **Step 3: Implement** — in `core/defaults.js` `DEFAULT_SETTINGS`, beside `autonomyEnabled`: `schedulesEnabled: false,`. In `core/config-store.js`, add `'schedulesEnabled'` to the `allowed` array in `updateSettings` (~line 70-80). **Both are required** — omitting the whitelist entry silently drops the setting, the exact bug that bit the mobile build.
- [ ] **Step 4: Run** `node --test test/core.test.js`, then full `npm test` — green (111).
- [ ] **Step 5: Commit** — `feat(schedule): schedulesEnabled setting, off by default`

---

### Task 2: `core/schedule-times.js` — the date math (pure)

**Files:** Create `core/schedule-times.js`; Test: `test/schedule-times.test.js`

**Interfaces (consumed by Tasks 3–4):**

```js
nextRunAt(item, from)      // → Date | null  — first occurrence strictly after `from`
dueSince(item, from, now)  // → boolean      — did an occurrence fall in (from, now]?
pickNext(items, from)      // → { item, at: Date } | null — soonest across enabled items
```

Item shape: `{ id, name, when: { time: 'HH:MM', repeat: 'once'|'daily'|'weekdays'|'weekly', weekday: 0-6|null }, enabled, lastRunAt }`. `weekday` is `0`=Sunday. All times are **local**. A `once` item that has already run (`lastRunAt` set) returns `null` forever. A disabled item returns `null`.

- [ ] **Step 1: Failing tests** — `test/schedule-times.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextRunAt, dueSince, pickNext } = require('../core/schedule-times');

const at = (y, m, d, h, min) => new Date(y, m - 1, d, h, min, 0, 0);
const item = (over = {}) => ({ id: 'a', name: 'x', enabled: true, lastRunAt: null, when: { time: '07:00', repeat: 'daily', weekday: null }, ...over });

test('daily: later today, else tomorrow — and advances by calendar day', () => {
  assert.deepEqual(nextRunAt(item(), at(2026, 7, 19, 6, 0)), at(2026, 7, 20 - 1, 7, 0));
  assert.deepEqual(nextRunAt(item(), at(2026, 7, 19, 8, 0)), at(2026, 7, 20, 7, 0));
  // exactly at the time counts as passed — strictly after `from`
  assert.deepEqual(nextRunAt(item(), at(2026, 7, 19, 7, 0)), at(2026, 7, 20, 7, 0));
});

test('weekdays: Friday evening rolls to Monday', () => {
  const fri = at(2026, 7, 17, 8, 0);           // 2026-07-17 is a Friday
  assert.equal(new Date(fri).getDay(), 5);
  assert.deepEqual(nextRunAt(item({ when: { time: '07:00', repeat: 'weekdays', weekday: null } }), fri), at(2026, 7, 20, 7, 0));
});

test('weekly: lands on the chosen weekday', () => {
  const wed = at(2026, 7, 15, 9, 0);           // Wednesday
  const out = nextRunAt(item({ when: { time: '07:00', repeat: 'weekly', weekday: 0 } }), wed);
  assert.equal(out.getDay(), 0);
  assert.deepEqual(out, at(2026, 7, 19, 7, 0));
});

test('once: fires once, then never; disabled never fires', () => {
  const once = item({ when: { time: '07:00', repeat: 'once', weekday: null } });
  assert.deepEqual(nextRunAt(once, at(2026, 7, 19, 6, 0)), at(2026, 7, 19, 7, 0));
  assert.equal(nextRunAt({ ...once, lastRunAt: at(2026, 7, 19, 7, 0).toISOString() }, at(2026, 7, 19, 8, 0)), null);
  assert.equal(nextRunAt(item({ enabled: false }), at(2026, 7, 19, 6, 0)), null);
});

test('dueSince: true only when an occurrence fell in the window', () => {
  const from = at(2026, 7, 19, 6, 0);
  assert.equal(dueSince(item(), from, at(2026, 7, 19, 7, 30)), true);   // 07:00 passed
  assert.equal(dueSince(item(), from, at(2026, 7, 19, 6, 30)), false);  // not yet
  assert.equal(dueSince(item({ enabled: false }), from, at(2026, 7, 19, 9, 0)), false);
});

test('pickNext: soonest enabled item, null when none', () => {
  const early = item({ id: 'early', when: { time: '07:00', repeat: 'daily', weekday: null } });
  const late = item({ id: 'late', when: { time: '09:00', repeat: 'daily', weekday: null } });
  const off = item({ id: 'off', enabled: false, when: { time: '06:00', repeat: 'daily', weekday: null } });
  const out = pickNext([late, early, off], at(2026, 7, 19, 5, 0));
  assert.equal(out.item.id, 'early');
  assert.deepEqual(out.at, at(2026, 7, 19, 7, 0));
  assert.equal(pickNext([], at(2026, 7, 19, 5, 0)), null);
  assert.equal(pickNext([off], at(2026, 7, 19, 5, 0)), null);
});
```

Note the first assertion is deliberately written as `at(2026, 7, 20 - 1, 7, 0)` = July 19 07:00 — same-day when `from` is 06:00.

- [ ] **Step 2: Run** `node --test test/schedule-times.test.js` — FAIL (module not found).
- [ ] **Step 3: Implement** `core/schedule-times.js`. Build candidate dates in **local time** by cloning `from`, setting H/M/s/ms, and stepping whole **calendar days** (`d.setDate(d.getDate() + 1)`) — never by adding 24h in milliseconds, so DST shifts don't drift the wall-clock time. Walk forward at most 8 days looking for the first candidate that is strictly after `from` and whose weekday satisfies the repeat (`daily`: any; `weekdays`: `getDay()` 1–5; `weekly`: `getDay() === weekday`; `once`: any, but `null` if `lastRunAt`). Return `null` for disabled items or unknown repeat kinds. `dueSince(item, from, now)` = `const n = nextRunAt(item, from); return !!n && n <= now;`. `pickNext` maps enabled items through `nextRunAt`, drops nulls, returns the minimum `at` (ties → first in array).
- [ ] **Step 4: Run** the file, then full `npm test` — green (117).
- [ ] **Step 5: Commit** — `feat(schedule): pure date math for next-run, catch-up and next-pick`

---

### Task 3: `core/schedule-store.js` — CRUD + atomic persistence

**Files:** Create `core/schedule-store.js`; Test: `test/schedule-store.test.js`

**Interfaces (consumed by Task 4 + main):**

```js
class ScheduleStore {
  constructor(userDataPath)              // file: <userDataPath>/schedules.json
  list()                                 // → array (copies)
  add(input)                             // → item; throws on bad name/time/repeat
  update(id, patch)                      // → item | null (merges `when`/`action` shallowly)
  remove(id)                             // → boolean
  markRun(id, { at, ok, text })          // → item | null; sets lastRunAt + lastResult
}
```

Item as in Task 2 plus `action`: `{ kind: 'speak', text }` | `{ kind: 'ask', prompt }` | `{ kind: 'briefing' }`, and `lastResult: { at, ok, text } | null`.

- [ ] **Step 1: Failing tests** — `test/schedule-store.test.js`: create in an `fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-sched-'))` dir (mirror how `test/core.test.js` makes temp dirs). Cover: `add` returns an item with an id / `enabled: true` / `lastRunAt: null`; `add` throws on empty name, on bad time (`'25:00'`, `'nope'`), on unknown repeat, and on `weekly` without a `weekday`; `list` reflects adds; `update` merges `when` without dropping untouched keys and returns `null` for a missing id; `remove` returns true then false; `markRun` stamps `lastRunAt`/`lastResult`; and a **reload test** — construct a second `ScheduleStore` on the same dir and assert the items survive.
- [ ] **Step 2: Run** — FAIL (module not found).
- [ ] **Step 3: Implement.** Model on `core/task-store.js:19-56` (constructor loads sync, `#persist()` after each mutation, `crypto.randomUUID()` ids) but persist **atomically** like `core/config-store.js:54-59` — write `<file>.tmp` then `fs.renameSync` — so a crash mid-write can't corrupt the schedule list. Validate: name non-empty (trim, cap 80 chars); `time` matches `/^([01]\d|2[0-3]):[0-5]\d$/`; repeat in the four kinds; `weekly` requires `weekday` 0–6; action kind in the three kinds with its required field present (`speak`→`text`, `ask`→`prompt`).
- [ ] **Step 4: Run** file then full `npm test` — green.
- [ ] **Step 5: Commit** — `feat(schedule): schedule store with validation and atomic writes`

---

### Task 4: `core/schedule-service.js` — one timer, catch-up, dispatch

**Files:** Create `core/schedule-service.js`; Test: `test/schedule-service.test.js`

**Interfaces:**

```js
class ScheduleService {
  constructor({ store, config, router, emit, log, now = () => new Date(),
                setTimer = setTimeout, clearTimer = clearTimeout })
  start()          // catch-up pass, then arm()
  arm()            // clear existing timer; set ONE timer for pickNext(...)
  stop()
  async runNow(id, { late = false } = {})   // → { ok, text }
}
```

`emit(channel, payload)` is `sendEverywhere`. `log` is the ActivityLog. Rules:

- If `config.getSettings().schedulesEnabled !== true`: `start()`/`arm()` do nothing and any existing timer is cleared.
- `arm()` sets **at most one** timer. Delay is `Math.max(0, at - now())`, capped at `2_000_000_000` ms (below the 32-bit `setTimeout` ceiling); if capped, re-arm on fire rather than running the item.
- On fire: run the item, `store.markRun(...)`, then `arm()` again.
- `speak` action → `emit('autonomy:event', { speak: text })`.
- `ask`/`briefing` → `await router.handle(prompt, 'general', { unattended: true })`; briefing prompt is the built-in constant `BRIEFING_PROMPT` (open tasks, overdue items, anything the cameras saw overnight). Speak `result.response`.
- Quiet hours: if `isWithinWindow(now(), settings.autonomyNightStart, settings.autonomyNightEnd)` (import from `core/autonomy-rules.js`), **do not** emit `speak` — still emit the card and write the log.
- Late runs prefix the spoken/card text with `This was due at <h:mm AM/PM>, sir. `.
- Every run: `log.write({ type: 'schedule', command: item.name, response: text, source: 'schedule' })`.
- A throwing action must not kill the timer: catch, record `ok: false` with the error message, still `arm()`.

- [ ] **Step 1: Failing tests** — `test/schedule-service.test.js` with a fake store (plain object implementing `list/markRun`), fake `config.getSettings()`, a fake router recording calls, an `emit` spy, a `log` spy, an injected `now`, and injected `setTimer`/`clearTimer` that capture `(fn, delay)` without scheduling. Cover:
  1. `start()` with the master switch **off** → no timer set, nothing emitted.
  2. `start()` with one daily item → exactly **one** timer set, delay equal to ms until the next occurrence.
  3. Invoking the captured timer callback → the action ran, `markRun` called, and **exactly one** new timer armed (assert the capture list length — this is the "no polling" guarantee).
  4. `speak` action emits `autonomy:event` with the text.
  5. `ask` action calls `router.handle(prompt, 'general', { unattended: true })` and speaks the response.
  6. Quiet hours (now = 02:00, window 21→7): **no** `speak` emitted, but the log is still written.
  7. Catch-up: an item whose time passed since `lastRunAt` runs on `start()` with text beginning `This was due at`.
  8. A router that rejects → `ok: false` recorded, no throw, timer still armed.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** file then full `npm test` — green.
- [ ] **Step 5: Commit** — `feat(schedule): single-timer scheduler with catch-up and quiet hours`

---

### Task 5: Unattended tool policy + `look_at_camera`

**Files:** Modify `core/ai-service.js`, `core/router.js`, `core/tool-registry.js`; Test: `test/tools.test.js` (extend) or new `test/schedule-tools.test.js`

**Interfaces:**
- `router.handle(text, project, { unattended: true })` → forwards `unattended` into `ai.reply(text, { ..., unattended })`.
- `ai.reply` withholds tools named in `UNATTENDED_DENIED = ['open_application']` when `context.unattended === true`; everything else is unchanged.
- New registry entry `look_at_camera({ camera })` → `{ ok, camera, description }`.

- [ ] **Step 1: Failing tests** —
  (a) an `AIService` with a two-tool registry (`read_file`, `open_application`) and a stub adapter that records the specs it was handed: assert `open_application` is absent when `unattended: true` and present when not. Follow the mocked-fetch style already in `test/brain-openai.test.js`.
  (b) `look_at_camera` with fake `getCameras()` (returning `listCameras()` → `[{ key: 'a:1', name: 'Front Door' }]` and `getSnapshot()` → `{ ok: true, jpegBase64: 'x' }`) and fake `ai.describeCameraFrame` → `{ ok: true, text: 'A porch.' }`: assert it matches the camera by name case-insensitively, returns the description, and returns a clear `{ ok: false }` message for an unknown camera name and for a failed snapshot.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** In `core/tool-registry.js`, widen the signature to `buildToolRegistry({ tools, tasks, memory, config, documents, getCameras, ai })` and append the `look_at_camera` entry, composing exactly what `CommandRouter#cameraLook` (`core/router.js:70-91`) does: `getCameras()?.listCameras()` → case-insensitive name match → `getSnapshot(key, { manual: true })` → `ai.describeCameraFrame(jpegBase64, name)`. Guard every step with a friendly `{ ok: false, message }` (no cameras configured, name not found, snapshot failed, no vision model). In `main.js:756`, pass `getCameras: () => cameras` — a **lazy getter**, because `cameras` is constructed later at `main.js:765` — and `ai` cannot be passed to itself, so set `ai.registry`'s camera dependency after construction, or build the registry with a `getAi: () => ai` lazy getter too. Prefer lazy getters for both; do not reorder existing construction.
- [ ] **Step 4: Run** tests then full `npm test` — green.
- [ ] **Step 5: Commit** — `feat(schedule): read-only tools for unattended runs; look_at_camera tool`

---

### Task 6: Wire into `main.js` / `preload.js`

**Files:** Modify `main.js`, `preload.js`

**Interfaces:** `window.jarvis.schedule = { list(), add(input), update(id, patch), remove(id), runNow(id), onChanged(fn) }`.

- [ ] **Step 1: Implement `main.js`** — add `powerMonitor` to the `require('electron')` destructure (**not currently imported anywhere**). Construct after `cameras`/`router` exist:

```js
scheduleStore = new ScheduleStore(app.getPath('userData'));
scheduleService = new ScheduleService({ store: scheduleStore, config, router, emit: sendEverywhere, log });
scheduleService.start();
powerMonitor.on('resume', () => scheduleService.arm());
```

IPC beside the `mobile:` handlers: `schedule:list`, `schedule:add`, `schedule:update`, `schedule:remove`, `schedule:runNow` — each mutating handler calls `scheduleService.arm()` and `sendEverywhere('schedule:changed', scheduleStore.list())` afterwards. In the settings-save diff (where `mobileEnabled` is compared), add: if `previous.schedulesEnabled !== updated.schedulesEnabled` then `scheduleService.start()` (re-arms or stands down). Add `scheduleService?.stop()` beside `mobileServer?.stop()` on quit.
- [ ] **Step 2: Implement `preload.js`** — expose the `schedule` group following the existing pattern (use the file's `on()` helper for `onChanged`).
- [ ] **Step 3: Run** full `npm test` — green. Then a headless boot check: set `JARVIS_CAPTURE_PATH` to a temp png, `npm start`, confirm it writes the png and exits cleanly, delete the png. Fix any boot error before committing.
- [ ] **Step 4: Commit** — `feat(schedule): service lifecycle, resume re-arm and IPC wired into main`

---

### Task 7: Settings → SCHEDULE section

**Files:** Modify `src/index.html`, `src/renderer.js`

- [ ] **Step 1: `src/index.html`** — a `SCHEDULE` section after `AUTONOMY`, matching that section's real markup patterns (`toggle-row` etc. — copy the neighbours, not this sketch): master toggle `setting-schedules`; an add form (name text, time `<input type="time">`, repeat `<select>` once/daily/weekdays/weekly, weekday `<select>` shown only for weekly, action `<select>` speak/ask/briefing, and one text field whose label swaps between "Say this" and "Ask JARVIS this" — hidden entirely for briefing); an `ADD` button; and `<ul id="schedule-list">`.
- [ ] **Step 2: `src/renderer.js`** — bind `schedulesEnabled` in the same read/write places as `mobileEnabled`. Add `refreshScheduleList()` rendering each item as "name — 7:00 AM, weekdays" plus its last result ("ran 7:00 AM — Task added") and three buttons: RUN NOW, an enable/disable toggle, DELETE. Wire the add form (client-side validation mirroring the store's rules so errors appear before the IPC call), subscribe `onChanged`, and call the refresh when Settings opens.
- [ ] **Step 3: Run** full `npm test` — green; headless boot check as in Task 6.
- [ ] **Step 4: Commit** — `feat(schedule): Settings SCHEDULE section`

---

### Task 8: Manual checklist + version bump

**Files:** Create `docs/SCHEDULE-TESTING-CHECKLIST.md`; Modify `package.json`, `CHANGELOG.md`

- [ ] **Step 1: Checklist** — numbered and novice-proof: turn the master switch on; add a **speak** item two minutes out and hear it fire; add an **ask** item ("what's in my newest Downloads PDF") and watch the agent run and report; add a **briefing** item and run it with RUN NOW; check a camera item names what it sees; toggle the master switch off and confirm nothing fires; close JARVIS, let a due time pass, reopen and confirm one catch-up run announced as late; confirm a night-time item stays silent but appears on screen.
- [ ] **Step 2: Version** — `package.json` → `0.13.0`; CHANGELOG entry: "0.13.0 — Scheduled tasks: reminders, agent requests, camera checks and daily briefings on a timer (off by default)."
- [ ] **Step 3: Run** full `npm test` — green.
- [ ] **Step 4: Commit** — `docs(schedule): testing checklist; version 0.13.0`

---

## Self-Review

- **Design coverage:** master switch + default (T1), date math incl. catch-up (T2), persistence (T3), single timer / dispatch / quiet hours / late labelling (T4), read-only unattended policy + camera tool (T5), lifecycle + resume re-arm + IPC (T6), UI (T7), manual proof + version (T8).
- **Consistency:** `nextRunAt/dueSince/pickNext`, `markRun({at,ok,text})`, `{ unattended: true }`, `look_at_camera({ camera })`, `autonomy:event {speak}` are used identically across tasks.
- **No polling:** only Task 4 creates timers, one at a time, and T4 step 1.3 asserts it.
