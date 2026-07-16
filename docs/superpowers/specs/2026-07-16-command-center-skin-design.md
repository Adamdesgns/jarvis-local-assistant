# Command Center Skin — Design Spec

_Date: 2026-07-16 · Status: approved by Adam · Branch: `command-center-skin`
(off `autonomy-engine`)_

## Summary
Add a **switchable skin** to JARVIS. The current amber, floating-modules UI
becomes **"Classic Amber"**; a new **"Command Center Blue"** skin brings Adam's
prototype (`JARVISCOMMANDCENTER.html`) to life — a cyan, movie-JARVIS
command-center dashboard — wired to the app's **real** data, not the
prototype's simulated numbers. The user picks the skin in Settings; the choice
is saved and applied without a restart. Classic remains the default.

Adam's directives that shape this build:
- **Switchable** (Classic ↔ Command Center), chosen in Settings.
- **Use our real panels** — real telemetry, tasks, projects, activity, cameras.
- **Cameras = a glanceable panel**; **Documents = an overlay** from the dock
  ("Mix").
- **Keep the real minimize-to-orb effect** — the Command Center's ORB/MINIMIZE
  triggers the existing floating-orb window (`window.jarvis.showWidget()`), not
  the prototype's fake fullscreen orb.
- **Weather + Network panels are deferred to the next project.**

## Non-goals (this slice)
- Weather panel, Network panel (next project — the columns leave room for them).
- Any change to safety: commands still route through `classifyCommand` +
  approval cards. Skins are purely cosmetic/presentational.
- Rebuilding the amber UI. Classic stays exactly as it is today.
- A general third-party skin format. Two built-in skins only (YAGNI).

## Architecture — shared state, two view layers

The core problem: two structurally different UIs (amber canvas sphere + floating
modules vs. cyan CSS sphere + fixed grid) must show the **same live data** and
respond to the **same state**, with only one visible at a time.

**Approach: both layouts live in the DOM; a `data-skin` attribute on `<body>`
shows one and hides the other. Each skin is a self-contained view module that
subscribes to the same data/IPC and paints its own elements.**

```
                 window.jarvis (preload IPC)  ── bootstrap + onXxx events
                              │
                   ┌──────────┴───────────┐
        renderer.js (Classic view)   command-center.js (new, CC view)
        paints #classic-root         paints #cc-root
                              │
                   both read the same state / events
```

- **`renderer.js` stays the Classic view.** Its DOM (the amber UI) is wrapped in
  a `#classic-root` container. Minimal changes to it.
- **New `src/command-center.js`** owns the Command Center DOM (`#cc-root`),
  mirroring how `src/cameras-ui.js` is a self-contained module. It subscribes to
  the same `window.jarvis.onXxx` events and reads the same `bootstrap`, and
  renders into its own elements. Because the hidden skin's DOM is
  `display:none`, its CSS animations are automatically paused by the browser —
  no wasted work.
- **New `src/skins.js`** owns skin state: reads the saved skin, applies it
  (`document.body.dataset.skin = 'classic' | 'command-center'`), pauses/resumes
  the amber canvas sphere, and exposes `applySkin(name)` for the Settings
  toggle. It is a tiny, unit-testable module for the *decision* logic
  (see Testing).
- **Shared state entry point.** `setCoreState()` in `renderer.js` remains the
  single UI-state entry point; it additionally calls the Command Center's
  `setJarvisState()` so both spheres/labels stay in sync. Command execution,
  voice, search, and vision continue to be driven from `renderer.js`; the
  Command Center's command bar and dock call the **same** functions
  (`executeCommand`, the voice push-to-talk handler, `describeScreen`, etc.)
  rather than duplicating them. Where a function paints a Classic-only element
  (e.g. `setResponse` writes `#jarvis-response`), it also writes the Command
  Center's equivalent when that element exists.

This keeps the two skins decoupled at the view layer while sharing one source of
truth, and avoids a risky ground-up rewrite of `renderer.js`.

## State → color mapping
The prototype's power move is a single `--state` CSS variable that recolors the
whole Command Center. We map JARVIS's real states (from `setCoreState`) onto the
prototype's states/colors:

| JARVIS state (`setCoreState`) | Command Center state | Color |
|---|---|---|
| `ready` | STANDBY | `#58d8ff` |
| `listening` | LISTENING | `#8bf7ff` |
| `processing` | THINKING | `#ffd36a` |
| `speaking` | SPEAKING | `#7affc7` |
| `exploding` (file search) | WORKING | `#ff9d57` |
| `error` | ERROR | `#ff705e` |
| (boot failure / Ollama offline banner) | OFFLINE | `#6f7c82` |

`command-center.js` implements `setJarvisState(jarvisState)` doing this mapping,
setting `--state`, the state label, message, and the core's `className`. A pure
helper `mapState(jarvisState) -> {ccState, color, message}` is unit-tested.

## Panels — real data binding (the "Mix")

Command Center columns, each bound to real app data:

**Left column**
- **Performance** — the three ring meters (CPU / RAM / GPU) + core temp +
  uptime, fed by the same telemetry `renderTelemetry` uses
  (`window.jarvis.telemetry()` / bootstrap.telemetry). The meter `--value` is a
  degrees value derived from the percentage.
- **Projects** — the real project workspaces from `settings.projects`; clicking
  a project runs the same action the Classic projects module uses (activate
  project / open its folder).
- **Tasks** — real tasks from `window.jarvis.tasks.list()` +
  `onTasksChanged`; checkboxes call `window.jarvis.tasks.update`.

**Right column**
- **Activity** — real activity log (`window.jarvis.recentActivity` +
  refresh after commands), same data as the Classic Activity module.
- **Cameras (glanceable panel)** — compact camera tiles/status from the existing
  camera bootstrap (`window.jarvis.cameras.list()` + `onCamerasAlert` +
  `onCamerasChanged`), and the autonomy **"someone's here"** card
  (`onAutonomyEvent`) surfaces here as well as via the existing floating card.
  Full camera management stays in the existing cameras module, reachable as an
  overlay; the panel is for glanceable status and alerts.
- _(Weather + Network intentionally omitted — next project. Column layout leaves
  slots for them.)_

**Center** — CSS-ring sphere, `NEURAL INTERFACE / CORE 01` heading, state label
+ message, the command bar, and the dock.

**Overlays (float over either skin, unchanged)** — Settings dialog, approval
cards. **Documents** opens as an overlay from the dock (reusing the existing
document-viewer module surface).

## Command bar, dock, and modes
- **Command bar** — `EXECUTE` and Enter call the same `executeCommand(text)` as
  Classic; the response renders into the Command Center's status/response area
  too.
- **Dock** — VOICE → the existing push-to-talk handler; SEARCH → file search
  entry; VISION → `describeScreen` (and shows the red "screen vision active"
  banner, matching the existing on-screen viewing indicator); NOTE → note
  creation; **MINIMIZE → `window.jarvis.showWidget()` (the real minimize-to-orb
  floating window).**
- **Modes** — COMMAND (full dashboard) and FOCUS (dim panels, grow the sphere)
  are Command-Center-local CSS states. **ORB → the real minimize-to-orb**
  (`window.jarvis.showWidget()`), *not* the prototype's in-page fullscreen orb
  screen. This preserves the existing floating-orb behavior Adam wants kept.

## Settings
- New setting **`skin: 'classic'`** (default). Whitelisted in
  `core/config-store.js`; added to `core/defaults.js`. A primitive string, so no
  deep-merge needed; old saves fall back to `'classic'`.
- Settings UI: a new **APPEARANCE / SKIN** control in the BEHAVIOR area — a
  select with `CLASSIC AMBER` / `COMMAND CENTER BLUE`. Changing it calls
  `applySkin(...)` immediately (live preview) and saves on Save.

## CSS isolation
The prototype's CSS is scoped under `#cc-root` (its selectors prefixed) so it
cannot collide with the Classic styles. Classic styles are unaffected. Both
roots share the app window; only `[data-skin]` decides which is shown.

## Files
- **New:** `src/command-center.js` (CC view module), `src/skins.js` (skin
  decision logic), `test/skins.test.js` (unit tests).
- **New CSS:** Command Center styles appended to `src/styles.css`, scoped under
  `#cc-root` (or a new `src/command-center.css` linked from `index.html` — TBD
  in plan; scoping is the requirement).
- **Modified:** `src/index.html` (wrap Classic UI in `#classic-root`; add
  `#cc-root` markup; add the skin select; link the new scripts),
  `src/renderer.js` (wrap-root, call `setJarvisState` from `setCoreState`, apply
  skin on boot, mirror `setResponse` to CC), `core/defaults.js`,
  `core/config-store.js`.

## Testing
- **Unit (`node:test`, mirroring existing tests):**
  - `mapState(jarvisState)` returns the right CC state + color for every real
    state, and a safe OFFLINE/ERROR fallback for unknown input.
  - Skin setting: default is `'classic'`; old saves merge to `'classic'`;
    whitelist accepts `skin`.
  - `applySkin` decision logic: given a skin name, it resolves to the correct
    `data-skin` value and whether the canvas sphere should pause (pure function;
    DOM effects thin and manually verified).
- **Manual / verification (real app):** boot with each skin, screenshot both;
  confirm the skin switch in Settings flips the whole UI and persists; confirm
  real telemetry/tasks/projects/activity/cameras appear in the Command Center;
  confirm MINIMIZE/ORB triggers the real floating orb; confirm state colors
  change as JARVIS listens/thinks/speaks; confirm approval cards + Settings still
  work over the Command Center.
- `npm test` green after every change.

## Rollout / safety
- All work on `command-center-skin` (off `autonomy-engine`), easy to revert.
- Default skin stays Classic, so nothing changes for existing users until they
  opt in.
- No push to GitHub (Adam's standing rule).
