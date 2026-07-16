# Command Center Skin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a switchable "Command Center Blue" skin alongside the existing "Classic Amber" UI, wired to JARVIS's real data, chosen in Settings.

**Architecture:** Both layouts live in the DOM under `#classic-root` and `#cc-root`; `body[data-skin]` shows one. A pure `src/skins.js` holds skin/state decision logic (dual CommonJS+window export, unit-tested). A new browser-only `src/command-center.js` paints the Command Center from the same `window.jarvis` data/events `renderer.js` uses. `setCoreState()` stays the single state entry point and also drives the Command Center's colors.

**Tech Stack:** Electron renderer (classic `<script>` files), Node `node:test`, no new deps.

## Global Constraints

- Default skin is `'classic'`; nothing changes for users until they opt in.
- Skins are cosmetic only — commands still route through `classifyCommand` + approval cards. No new powers.
- Command Center ORB/MINIMIZE must call the real `window.jarvis.showWidget()` (floating orb), never the prototype's in-page fullscreen orb.
- Weather and Network panels are OUT of scope (next project); leave column slots.
- All Command Center CSS scoped under `#cc-root` — must not alter Classic styles.
- Pure logic in `src/skins.js` uses the dual-export guard so `node:test` can require it and the browser can load it via `<script>`.
- Run `npm test` after every change; green before each commit.
- Branch `command-center-skin` only. Do NOT push to GitHub.
- Source of truth for markup/behavior: the committed prototype (added in Task 3). State→color map from the spec.

---

### Task 1: `skin` setting (defaults + persistence)

**Files:**
- Modify: `core/defaults.js` (after `autonomyNightEnd`)
- Modify: `core/config-store.js` (whitelist ~line 76)
- Test: `test/skins.test.js` (new)

**Interfaces:**
- Produces settings key `skin: 'classic'` read by `skins.js`/renderer.

- [ ] **Step 1: Write the failing test**

Create `test/skins.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeSettings } = require('../core/config-store');
const { DEFAULT_SETTINGS } = require('../core/defaults');

test('skin setting: defaults to classic and old saves keep a valid skin', () => {
  assert.equal(DEFAULT_SETTINGS.skin, 'classic');
  const old = mergeSettings(DEFAULT_SETTINGS, { settingsVersion: 6 });
  assert.equal(old.skin, 'classic');
  const kept = mergeSettings(DEFAULT_SETTINGS, { settingsVersion: 6, skin: 'command-center' });
  assert.equal(kept.skin, 'command-center');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `DEFAULT_SETTINGS.skin` is `undefined`.

- [ ] **Step 3: Implement**

In `core/defaults.js`, after the `autonomyNightEnd: 7,` line add:

```js
  skin: 'classic',
```

In `core/config-store.js` `updateSettings` `allowed` array, append `'skin'`:

```js
      'autonomyEnabled', 'autonomyRules', 'autonomyNightStart', 'autonomyNightEnd',
      'skin'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/defaults.js core/config-store.js test/skins.test.js
git commit -m "feat(skins): add skin setting (default classic)"
```

---

### Task 2: Pure skin/state helpers (`src/skins.js`)

**Files:**
- Create: `src/skins.js`
- Test: `test/skins.test.js` (append)

**Interfaces:**
- Produces `window.JarvisSkins` / `module.exports`:
  - `SKINS = ['classic', 'command-center']`
  - `resolveSkin(name) -> { dataSkin, pauseCanvas }` — `dataSkin` is a valid skin string (falls back to `'classic'`); `pauseCanvas` is `true` when the amber canvas sphere should stop (i.e. skin is `'command-center'`).
  - `mapState(jarvisState) -> { ccState, color, message }` — maps a `setCoreState` state to the Command Center state name, `--state` color, and status message. Unknown → OFFLINE.

- [ ] **Step 1: Write the failing tests**

Append to `test/skins.test.js`:

```js
const { SKINS, resolveSkin, mapState } = require('../src/skins');

test('resolveSkin: valid names pass through, unknown falls back to classic', () => {
  assert.deepEqual(SKINS, ['classic', 'command-center']);
  assert.deepEqual(resolveSkin('command-center'), { dataSkin: 'command-center', pauseCanvas: true });
  assert.deepEqual(resolveSkin('classic'), { dataSkin: 'classic', pauseCanvas: false });
  assert.deepEqual(resolveSkin('nonsense'), { dataSkin: 'classic', pauseCanvas: false });
  assert.deepEqual(resolveSkin(undefined), { dataSkin: 'classic', pauseCanvas: false });
});

test('mapState: every real state maps to a command-center state, colour and message', () => {
  assert.equal(mapState('ready').ccState, 'STANDBY');
  assert.equal(mapState('ready').color, '#58d8ff');
  assert.equal(mapState('listening').ccState, 'LISTENING');
  assert.equal(mapState('processing').ccState, 'THINKING');
  assert.equal(mapState('speaking').ccState, 'SPEAKING');
  assert.equal(mapState('exploding').ccState, 'WORKING');
  assert.equal(mapState('error').ccState, 'ERROR');
  assert.equal(mapState('offline').ccState, 'OFFLINE');
  // Unknown states fail safe to OFFLINE, never throw.
  assert.equal(mapState('who-knows').ccState, 'OFFLINE');
  for (const s of ['ready', 'listening', 'processing', 'speaking', 'exploding', 'error', 'offline', 'x']) {
    const m = mapState(s);
    assert.match(m.color, /^#[0-9a-f]{6}$/i);
    assert.ok(typeof m.message === 'string' && m.message.length);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/skins'`.

- [ ] **Step 3: Implement**

Create `src/skins.js`:

```js
// Pure skin + state helpers. Dual export: node:test requires it via
// module.exports; the browser loads it as a classic <script> and reads
// window.JarvisSkins. No DOM access at load — safe to require in tests.
(function () {
  const SKINS = ['classic', 'command-center'];

  function resolveSkin(name) {
    const dataSkin = SKINS.includes(name) ? name : 'classic';
    return { dataSkin, pauseCanvas: dataSkin === 'command-center' };
  }

  // Maps a setCoreState() state to the Command Center state, --state colour,
  // and status line. Mirrors the prototype's STATES table.
  const STATE_MAP = {
    ready:      { ccState: 'STANDBY',   color: '#58d8ff', message: 'All systems ready' },
    listening:  { ccState: 'LISTENING', color: '#8bf7ff', message: 'Listening for your command' },
    processing: { ccState: 'THINKING',  color: '#ffd36a', message: 'Analyzing request' },
    speaking:   { ccState: 'SPEAKING',  color: '#7affc7', message: 'Response channel active' },
    exploding:  { ccState: 'WORKING',   color: '#ff9d57', message: 'Searching your computer' },
    error:      { ccState: 'ERROR',     color: '#ff705e', message: 'Action requires attention' },
    offline:    { ccState: 'OFFLINE',   color: '#6f7c82', message: 'Local services unavailable' }
  };

  function mapState(jarvisState) {
    return STATE_MAP[jarvisState] || STATE_MAP.offline;
  }

  const api = { SKINS, resolveSkin, mapState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.JarvisSkins = api;
})();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/skins.js test/skins.test.js
git commit -m "feat(skins): pure skin resolver + state-to-colour map (unit-tested)"
```

---

### Task 3: Command Center markup + scoped CSS shell

**Files:**
- Create: `docs/prototypes/command-center.html` (commit the uploaded prototype verbatim as the version-controlled source of truth)
- Create: `src/command-center.css` (prototype styles, every selector scoped under `#cc-root`)
- Modify: `src/index.html` (wrap the existing `<main>…</main>` Classic UI in `<div id="classic-root">…</div>`; add the `#cc-root` markup after it; link `command-center.css`, `skins.js`, `command-center.js`)

**Interfaces:**
- Produces: `#cc-root` containing the Command Center DOM with stable element ids prefixed `cc-` (e.g. `cc-core`, `cc-state`, `cc-state-message`, `cc-command-form`, `cc-command-input`, `cc-activity`, `cc-tasks`, `cc-projects`, `cc-perf-cpu/ram/gpu`, `cc-cameras`, `cc-clock`, `cc-date`, dock buttons `data-cc-action="voice|search|vision|note|minimize"`, mode buttons `data-cc-mode="command|focus|orb"`). These ids are consumed by Task 5–7.

- [ ] **Step 1: Commit the prototype as the source of truth**

Copy the uploaded prototype file to `docs/prototypes/command-center.html` verbatim (from `C:\Users\steam\.claude\uploads\...\6b742965-JARVISCOMMANDCENTER.html`). This is the reference the remaining steps transform.

- [ ] **Step 2: Scope the CSS**

Create `src/command-center.css` from the prototype's `<style>` block, transformed:
- Prefix every selector with `#cc-root ` (e.g. `.panel` → `#cc-root .panel`, `.topbar` → `#cc-root .topbar`). Replace the prototype's `#app` with `#cc-root`.
- Move the prototype's `:root{--ink…}` custom properties onto `#cc-root{…}` so they don't leak into Classic.
- Keep the `@keyframes` global (names are unique: `spin`, `reverseSpin`, `wobble`, `pulse`, `blink`, `wave`) — rename any that could collide with Classic (`spin` exists in Classic `styles.css`; rename the CC one to `cc-spin` and update references). Audit Classic keyframe names first and rename CC collisions with a `cc-` prefix.
- The hidden skin is `display:none` via `body[data-skin="classic"] #cc-root { display:none }` and `body[data-skin="command-center"] #classic-root { display:none }` — add these two rules.

- [ ] **Step 3: Add the markup and script/style links to `index.html`**

- Wrap the existing Classic `<main class="app">…</main>` (and its sibling orb/dialog markup that belongs to Classic) in `<div id="classic-root">…</div>`.
- After `#classic-root`, add `<div id="cc-root">…</div>` containing the prototype's `<main id="app">…</main>` body (rename `id="app"` to nothing/`class` as needed since `#cc-root` is the scope root), with ids prefixed `cc-` per the Interfaces list. Remove the prototype's own `<style>`/`<script>` (they become `command-center.css` and `command-center.js`).
- In `<head>`/before `</body>`, add `<link rel="stylesheet" href="command-center.css">` and `<script src="skins.js"></script>` (before `renderer.js`) and `<script src="command-center.js"></script>` (after `renderer.js`).

- [ ] **Step 4: Verify Classic is untouched**

Run: `npm test` (Expected: PASS — no logic changed).
Boot check (Classic still default): PowerShell `$env:JARVIS_CAPTURE_PATH="$env:TEMP\cc-t3.png"; npm start; $env:JARVIS_CAPTURE_PATH=$null` and open the PNG — the amber UI must look exactly as before (skin defaults to classic, `#cc-root` hidden).

- [ ] **Step 5: Commit**

```bash
git add docs/prototypes/command-center.html src/command-center.css src/index.html
git commit -m "feat(skins): scoped Command Center markup + CSS shell (hidden by default)"
```

---

### Task 4: Skin switch (Settings control + apply/persist)

**Files:**
- Modify: `src/index.html` (skin `<select>` in the BEHAVIOR settings section)
- Modify: `src/renderer.js` (`applySkin`; call on boot; `openSettings` populate; `saveSettings` patch; live-change handler)

**Interfaces:**
- Consumes: `window.JarvisSkins.resolveSkin` (Task 2), `skin` setting (Task 1), `window.jarvisHologram` (canvas sphere).
- Produces: `applySkin(name)` sets `document.body.dataset.skin`, pauses/resumes the canvas sphere, and (Task 5) calls `initCommandCenter()` once.

- [ ] **Step 1: Add the skin select to Settings**

In `src/index.html` BEHAVIOR section (after ANIMATION MODE), add:

```html
            <label>SKIN<select id="setting-skin"><option value="classic">CLASSIC AMBER</option><option value="command-center">COMMAND CENTER BLUE</option></select></label>
```

- [ ] **Step 2: Implement `applySkin` and wiring in `renderer.js`**

Add near the top-level UI helpers:

```js
let commandCenterReady = false;
function applySkin(name) {
  const { dataSkin, pauseCanvas } = window.JarvisSkins.resolveSkin(name);
  document.body.dataset.skin = dataSkin;
  // Pause the amber canvas sphere when it's not visible; resume when it is.
  window.jarvisHologram?.setPaused?.(pauseCanvas);
  if (dataSkin === 'command-center') {
    if (!commandCenterReady && window.JarvisCommandCenter) { window.JarvisCommandCenter.init(); commandCenterReady = true; }
    window.JarvisCommandCenter?.activate?.();
  }
}
```

In `initialize()` after `state.settings = bootstrap.settings;` (and after `bindEvents()`), apply the saved skin:

```js
  applySkin(state.settings.skin || 'classic');
```

In `openSettings()` (with the other field population):

```js
  $('setting-skin').value = state.settings.skin || 'classic';
```

In `saveSettings()` patch object add:

```js
    skin: $('setting-skin').value,
```

And make the change live immediately — in `bindEvents()` add:

```js
  $('setting-skin').addEventListener('change', (e) => applySkin(e.target.value));
```

- [ ] **Step 3: Add a canvas pause hook to the hologram (if absent)**

If `src/hologram.js` has no `setPaused`, add a minimal one to the `JarvisHologram` class:

```js
    setPaused(paused) {
      this._paused = Boolean(paused);
      if (!this._paused && !this._running) { this._running = true; requestAnimationFrame((t) => this.draw(t)); }
    }
```

and at the top of `draw(time)`: `if (this._paused) { this._running = false; return; }` (guard the existing rAF loop). Keep the TEMP FPS readout intact.

- [ ] **Step 4: Verify the switch**

Run: `npm test` (Expected: PASS).
Boot, open Settings, switch SKIN to COMMAND CENTER BLUE: the screen flips to the blue dashboard (static content for now); switch back to CLASSIC: amber returns. Confirm via two screenshots (drive with the browser tools or manual). Confirm the setting persists across a restart.

- [ ] **Step 5: Commit**

```bash
git add src/index.html src/renderer.js src/hologram.js
git commit -m "feat(skins): Settings skin switch — apply, persist, pause canvas when hidden"
```

---

### Task 5: Command Center view — real data + state colours

**Files:**
- Create/replace: `src/command-center.js` (the CC view module)
- Modify: `src/renderer.js` (`setCoreState` also drives `setJarvisState`; `setResponse` mirrors to CC)

**Interfaces:**
- Consumes: `window.jarvis` bootstrap + `onXxx` events; `window.JarvisSkins.mapState`.
- Produces: `window.JarvisCommandCenter = { init, activate, setJarvisState, setResponse }`.

- [ ] **Step 1: Implement the view module**

Create `src/command-center.js` (browser-only; guards so it no-ops if `#cc-root` is absent). It:
- `init()` — populates the clock (reuse a local `updateClock`), builds the waveform bars, and subscribes to `window.jarvis.onTasksChanged`, `onCamerasAlert`, `onCamerasChanged`, `onAutonomyEvent`, and a telemetry poll (or reuse the values `renderTelemetry` receives — simplest: `command-center.js` runs its own `setInterval(async ()=>renderPerf(await window.jarvis.telemetry()), 4000)` only while active).
- `activate()` — pulls fresh data once (`tasks.list()`, `recentActivity()`, `cameras.list()`, settings.projects) and paints all panels.
- `renderPerf(data)`, `renderTasks(list)`, `renderProjects(projects)`, `renderActivity(items)` — paint the CC panels from real data (meter `--value` = `deg = pct * 3.6`).
- `setJarvisState(jarvisState)` — `const {ccState,color,message}=window.JarvisSkins.mapState(jarvisState)`; set `#cc-root` `--state`, `#cc-state` text, `#cc-state-message`, core `className`, waveform active toggle.
- `setResponse(text)` — write the CC status/response line.

- [ ] **Step 2: Bridge state + response from renderer**

In `renderer.js` `setCoreState(coreState, kicker)`, after the existing hologram call add:

```js
  window.JarvisCommandCenter?.setJarvisState?.(coreState);
```

In `renderer.js` `setResponse(message)`, after writing `#jarvis-response` add:

```js
  window.JarvisCommandCenter?.setResponse?.(message);
```

- [ ] **Step 3: Verify**

Run: `npm test` (Expected: PASS — no unit-tested logic changed; `mapState` already covered).
Boot, switch to Command Center: Performance shows real CPU/RAM/GPU, Tasks/Projects/Activity show real entries. Type a command and watch the sphere colour shift ready→thinking→speaking→ready. Screenshot to confirm.

- [ ] **Step 4: Commit**

```bash
git add src/command-center.js src/renderer.js
git commit -m "feat(skins): Command Center bound to real telemetry, tasks, projects, activity + live state colours"
```

---

### Task 6: Command bar, dock, modes (real actions + minimize-to-orb)

**Files:**
- Modify: `src/command-center.js` (wire command form, dock, modes)
- Modify: `src/renderer.js` (expose the shared action entry points if not already global: `executeCommand`, the voice push-to-talk trigger, `describeScreen`, note creation)

**Interfaces:**
- Consumes: shared actions from `renderer.js`; `window.jarvis.showWidget`.

- [ ] **Step 1: Wire the command bar + dock + modes**

In `src/command-center.js`:
- `#cc-command-form` submit → `event.preventDefault(); window.executeCommand($('cc-command-input').value)` (expose `executeCommand` on `window` from renderer.js if not already).
- Dock `data-cc-action`: `voice` → the same push-to-talk entry the mic button uses; `search` → focus/submit a file-search (reuse `executeCommand` with the typed text, or the search entry point); `vision` → `window.describeScreen(...)` and toggle the CC red vision banner; `note` → note creation entry; **`minimize` → `window.jarvis.showWidget()`**.
- Modes `data-cc-mode`: `command` → remove focus/…; `focus` → toggle `#cc-root.focus`; **`orb` → `window.jarvis.showWidget()`** (real minimize-to-orb, NOT the prototype's `.orb-screen`). Remove/omit the prototype's `orb-screen` element and `showMode('orb')` in-page path.

- [ ] **Step 2: Expose shared actions from renderer.js**

Ensure `executeCommand`, `describeScreen`, and the voice/note handlers are reachable from `command-center.js` (they are top-level functions in the classic script scope; if not already global, assign `window.executeCommand = executeCommand`, etc., near the end of `renderer.js`).

- [ ] **Step 3: Verify**

Run: `npm test` (Expected: PASS).
Boot in Command Center: type + EXECUTE runs a real command and logs to Activity; VISION shows the banner and describes the screen; **MINIMIZE and ORB both drop to the real floating orb**; FOCUS dims panels and grows the sphere; restoring from the orb returns to Command Center. Screenshot each.

- [ ] **Step 4: Commit**

```bash
git add src/command-center.js src/renderer.js
git commit -m "feat(skins): Command Center command bar, dock, and modes wired to real actions + minimize-to-orb"
```

---

### Task 7: Cameras panel + Documents overlay

**Files:**
- Modify: `src/command-center.js` (Cameras panel + Documents overlay trigger)

**Interfaces:**
- Consumes: `window.jarvis.cameras.*`, `onCamerasAlert`, `onCamerasChanged`, `onAutonomyEvent`; the existing document-viewer surface.

- [ ] **Step 1: Cameras panel (glanceable)**

In `src/command-center.js`, render a compact camera list in `#cc-cameras` from `window.jarvis.cameras.list()`; update tiles on `onCamerasAlert` (stamp the alert text + snapshot) and refresh on `onCamerasChanged`. Surface the autonomy **"someone's here"** payload from `onAutonomyEvent` here (in addition to the existing floating card, which already works over any skin). Clicking the panel opens the full cameras module surface as an overlay.

- [ ] **Step 2: Documents overlay**

Wire a dock/panel affordance to open the existing document-viewer as an overlay above `#cc-root` (reuse the Classic document-viewer element or its render path; it already floats).

- [ ] **Step 3: Verify**

Run: `npm test` (Expected: PASS).
Boot in Command Center with a camera configured (or simulate an `onCamerasAlert`): the Cameras panel shows status and stamps an alert; the autonomy card appears; Documents opens as an overlay. Screenshot.

- [ ] **Step 4: Commit**

```bash
git add src/command-center.js
git commit -m "feat(skins): Command Center cameras panel + documents overlay"
```

---

### Task 8: Verification pass + changelog

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Full verification**

Run: `npm test` (Expected: PASS — all suites).
Boot both skins; screenshot Classic and Command Center; switch in Settings and confirm it flips live and persists across restart; confirm real data in every CC panel; confirm minimize-to-orb; confirm approval card + Settings render over the Command Center.

- [ ] **Step 2: Changelog entry**

Add to `CHANGELOG.md` (mirror the existing format) under the Unreleased section:

```markdown
### Added — Command Center skin (switchable)
- New SKIN setting: switch between Classic Amber and a cyan Command Center dashboard, saved and applied without a restart. Classic stays the default.
- The Command Center shows real data — CPU/RAM/GPU, projects, tasks, activity, and a glanceable cameras panel — and its colour tracks JARVIS's state (listening, thinking, speaking, working).
- Command bar, dock, FOCUS mode, and minimize-to-orb all use the real app actions. Weather and Network panels are coming next.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for the Command Center skin"
```

---

## Manual verification for Adam (real Windows)
1. Settings → SKIN → COMMAND CENTER BLUE: the whole app turns into the blue dashboard; your real CPU/tasks/projects/activity are in the panels.
2. Talk to JARVIS: the sphere and panels shift colour as it listens/thinks/speaks.
3. Dock MINIMIZE (and ORB mode) drop to your usual floating orb; restoring returns to the Command Center.
4. Switch SKIN back to CLASSIC AMBER: your original UI returns. The choice sticks across a restart.
5. Cameras panel shows status and the "someone's here" alerts; Documents opens over the top.
