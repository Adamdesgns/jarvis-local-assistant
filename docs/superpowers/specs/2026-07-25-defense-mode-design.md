# Defense Mode — design (2026-07-25)

Adam's vision (roadmap, 2026-07-24): a *posture*, not a panel. Something is wrong, so
JARVIS drops the normal desk and turns the whole window into a situation board.
Approved scope for this build: **phases 1–3**. Phase 4 (live video) waits for the
Browser module.

## What it is

When defense mode fires, the window becomes a situation board:

- **Banner (top):** red-toned strip naming the trigger and the time —
  `DEFENSE MODE · MANUAL TRIGGER · 21:43` or
  `DEFENSE MODE · TORNADO WARNING, HARRISON COUNTY · 21:43` — with `ESC TO EXIT`
  always visible.
- **Camera wall:** the REAL camera grid DOM node is moved into the defense layout
  (and moved back on exit). One set of streams, no duplicates, no second window.
  Every camera goes live on entry via the existing per-tile live path.
- **Situation rail (side column):** the active NWS alert text plus RSS headlines,
  newest first, refreshed every few minutes while the posture is active.

Exit is always one key: **Esc** — plus saying "stand down" or clicking the exit
control on the banner. Everything returns exactly as it was (modules, layout,
camera live states as the user had them).

## Triggers

1. **Manual (phase 1).** "JARVIS, defense mode" — matched in `core/defense-mode.js`
   and intercepted in `core/router.js` exactly like battle mode — plus a control in
   the top bar. Typed, spoken, or clicked.
2. **NWS auto (phase 2, opt-in, default OFF).** Main-process poller checks
   `api.weather.gov` active alerts for the configured county zone every ~2 minutes.
   A new alert at the **warning** tier (Tornado Warning, Hurricane Warning, Severe
   Thunderstorm Warning, Flash Flood Warning, Extreme Wind Warning) — never watches —
   triggers the announce-and-wave-off flow.
3. **Camera auto (phase 2, opt-in, default OFF).** A `cameras:alert` event while a
   camera system is **armed** and the local time is within night hours triggers the
   same flow.

**Announce-and-wave-off (every automatic entry):** JARVIS speaks the reason and shows
a 15-second card — "Entering defense mode — say stand down to wave off." Wave-off
(voice, click, or Esc) cancels; silence enters. No silent takeovers, ever.

## News + the spoken read (phase 3)

On entry the main process fetches the configured RSS feeds (titles + links + dates
only; tiny built-in parser, no new dependency) and the full NWS alert text. JARVIS
composes a short spoken read — what fired, what the alert says to do, what the
headlines say — through the existing brain selection (local Ollama by default, cloud
only if a key is already set) and speaks it once. Headlines refresh on an interval
while active; the read is NOT re-spoken on refresh.

If no RSS feeds are configured, the rail shows the alert text alone. If there is no
active alert (manual entry on a quiet night), the rail says so honestly.

## Settings

A **DEFENSE section inside the existing Settings → CAMERAS tab** (no ninth tab):

- **County picker:** state → county list fetched live from the NWS API
  (`api.weather.gov/zones?area={ST}&type=county`), stored as the zone code (UGC).
- **Auto-trigger toggles:** "Enter on severe weather warnings" and "Enter on camera
  alert while armed at night" — both default OFF.
- **RSS feeds:** user-managed URL list, seeded empty, with WLOX / Sun Herald shown
  as greyed example text (not pre-added).

## Hard rails (welded in, each with a test)

- **Watches and tells, never acts.** No calls, no emergency dialing, no arm/disarm,
  no locks/unlocks. Defense mode has zero new abilities — it displays and speaks.
- **Network only to configured sources:** `api.weather.gov` plus the saved RSS URLs.
  All fetching lives in one service file with an allowlist check.
- **Unattended runs can never enter.** The router's existing `unattended` flag
  refuses defense-mode entry (night shift, schedules).
- **Every automatic entry announces itself and can be waved off.**
- **Pro gate:** cameras are Pro, so defense mode rides the existing camera license
  gate — it is the camera module's posture.

## Architecture

| Unit | Where | Purpose |
|---|---|---|
| `core/defense-mode.js` | main (pure) | Trigger matcher (`isDefenseRequest` / `isStandDown`), warning-tier alert filter, wave-off state machine, RSS parser, banner label + spoken-read prompt builders. Pure logic, unit-tested. |
| `core/defense-service.js` | main | NWS poller, zone/county lookup, RSS fetching (allowlist enforced), entry/exit orchestration, pushes `defense:*` events to the renderer. |
| Router intercept | `core/router.js` | Routes "defense mode" / "stand down" to the service; refuses when `unattended`. |
| `src/defense-ui.js` | renderer | The posture: banner, camera-grid reparenting, situation rail, Esc handling, all-cameras-live on entry, full restore on exit. |
| Settings additions | `src/index.html` + existing settings code | DEFENSE section in the CAMERAS tab. |

## Testing

- Unit tests for every pure function in `core/defense-mode.js` (matchers, filter,
  state machine, parser, builders) plus rail tests (unattended refusal, allowlist).
- Screenshot rig `test/rigs/defense.html` kept in the repo (terminal lesson):
  proves the posture layout, banner text, and restore-on-exit.
- Honest limit: a real NWS alert and a real camera going live cannot be tested by
  Claude; the rig and unit tests prove the plumbing, the first storm test is Adam's.

## Phases

1. Posture + manual trigger + camera wall + banner + Esc exit (provable in the rig).
2. County setting + NWS poller + both auto-triggers + announce/wave-off.
3. RSS feeds + situation rail content + the spoken read.
