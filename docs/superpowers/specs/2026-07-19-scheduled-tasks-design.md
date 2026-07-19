# JARVIS Scheduled Tasks — Plan

## Context

Adam wants JARVIS to do things on a timer — autonomy slice 3, flagged as "next"
in both the autonomy roadmap and the Advanced Brain roadmap. It pairs with the
agent brain finished today: a schedule can fire a real multi-step request, not
just a reminder.

Agreed in conversation:

- **Four uses, one mechanism** — speak a reminder, run a real request, check a
  camera, give a daily briefing. The last three are all "run this prompt through
  the agent brain"; only the wording differs.
- **No polling.** Adam explicitly rejected a once-a-minute tick. One timer aimed
  at the next due item, re-armed on fire / on schedule edit / on system resume.
- **Catch-up stays but stays tiny** — one comparison at startup ("was anything
  due while JARVIS was closed?"). His laptop stays on, so it will rarely fire.
- **Read-only hands overnight** — unattended runs never delete, send, or spend.

## Assessment of JARVIS_DASHBOARD.pdf — nothing needed for this build

The PDF describes a **different product**: a cloud-hosted Next.js/PostgreSQL
business dashboard for running a SaaS company (Buffer social posting, Meta Ads,
RevenueCat subscriptions, support tickets, MRR/ROAS), with a third-party
"Hermes Agent" brain and paid voice (Deepgram/ElevenLabs).

Most of it doesn't transfer, and several parts actively conflict with JARVIS's
rules: paid cloud voice vs. free-local-first, cloud deployment + Postgres vs.
local-only-no-server, and a Next.js rewrite would discard the Electron app. The
document is also thin — 23 pages, ~10k characters, mostly outline; chapters
13–17 are headings with little content.

What it *does* confirm: JARVIS already has the parts worth having — AI command
center (agent brain), wake word + voice, a dark dashboard skin (Command
Center), and now scheduled tasks. The PDF lists "generate daily briefings" and
"schedule tasks automatically" as headline capabilities, which independently
supports making **daily briefing a first-class preset** rather than a prompt
Adam has to retype. That is the single change this review makes to the design.

**One idea worth parking (separate future project, not this one):** MCP
connector support — letting JARVIS's agent call external MCP servers. That is
the PDF's one genuinely new architectural idea and a real forward-looking
capability, but it is a large project of its own.

## Design

### The schedule item

```js
{
  id, name,
  when: { time: '07:00', repeat: 'once'|'daily'|'weekdays'|'weekly', weekday: 0-6|null },
  action: { kind: 'speak', text }  |  { kind: 'ask', prompt }  |  { kind: 'briefing' },
  enabled: true,
  lastRunAt: null,   // ISO string — drives catch-up and prevents double-fires
  lastResult: null   // { at, ok, text } for the Settings list + activity log
}
```

`briefing` is `ask` with a built-in prompt (open tasks, overdue items, anything
the cameras saw overnight) so Adam gets it from a dropdown, not by typing.

### Firing, without polling

`core/schedule-times.js` (pure, unit-tested) owns all date math:

- `nextRunAt(item, from)` → Date | null
- `dueSince(item, from, now)` → boolean (catch-up check)
- `pickNext(items, from)` → `{ item, at }` for the soonest enabled item

`core/schedule-service.js` holds exactly one `setTimeout`, aimed at
`pickNext(...)`. On fire: run the item, stamp `lastRunAt`, re-arm. Re-arm also
on add/edit/delete/enable and on Electron `powerMonitor`'s `resume` (long
timers drift across sleep). At startup, one `dueSince` pass runs anything
missed while closed, announced as "this was due at 7am".

`powerMonitor` is not currently imported anywhere (`main.js` electron
destructure needs it) and there is no existing single-timer precedent in the
repo — `main.js:819` polls `checkTaskReminders` every 30s. That poll is **not**
in scope here, but this design would eventually let it be retired, leaving the
app with fewer timers than it has today.

### Running an item

- `speak` → `sendEverywhere('autonomy:event', { speak: text })`. This channel
  already reaches the ear end-to-end: `main.js:59` → `preload.js:62` →
  `src/renderer.js:1290-1293` → `speak()` at `src/renderer.js:222`. No new IPC.
- `ask` / `briefing` → `router.handle(prompt, 'general', {})`, same entry point
  the phone and the desktop use, then speak + card + activity-log the result.
- Every run writes `activityLog.write({ type: 'schedule', command: name,
  response, source: 'schedule' })` — matching the convention at
  `core/autonomy-service.js:27-32`.

### Safety

- Master switch `schedulesEnabled`, **off by default**.
- Unattended runs get a **read-only tool set**: the registry filtered to
  non-destructive tools. Anything sensitive is refused with a line in the
  result telling Adam it needs him at the desk. Reuses the existing gating
  philosophy in `core/security.js` / `core/router.js` — no new approval surface.
- Quiet hours reuse `isWithinWindow` + `autonomyNightStart/End` from
  `core/autonomy-rules.js:7` — a 2am job runs silently and reports on screen.

### The camera tool (new)

A `look_at_camera` registry entry so "check the front door" works from a
schedule. It composes exactly what `CommandRouter#cameraLook`
(`core/router.js:70-91`) already does: `cameras.listCameras()` → match by name
→ `cameras.getSnapshot(key, { manual: true })` → `ai.describeCameraFrame(...)`.

**Known obstacle:** `buildToolRegistry` (`core/tool-registry.js:6`) receives
`{ tools, tasks, memory, config, documents }` and is called at `main.js:756`,
but `cameras` is constructed later at `main.js:765`. Fix by passing a lazy
getter (`getCameras: () => cameras`) rather than reordering construction —
smaller blast radius.

## Files

| File | Change |
|---|---|
| `core/schedule-times.js` | **new** — pure date math (nextRunAt/dueSince/pickNext) |
| `core/schedule-store.js` | **new** — CRUD + persistence, modeled on `core/task-store.js:39` but with ConfigStore's atomic tmp+rename (`core/config-store.js:54`) |
| `core/schedule-service.js` | **new** — the single timer, run dispatch, catch-up, resume re-arm |
| `core/tool-registry.js` | add `look_at_camera`; accept `getCameras`, `ai` |
| `core/defaults.js` | `schedulesEnabled: false` |
| `core/config-store.js` | add `schedulesEnabled` to the `allowed` whitelist (line 70-80) — **omitting this silently drops the setting**, exactly the bug that bit the mobile build |
| `main.js` | import `powerMonitor`; construct + start the service; IPC `schedule:list/add/update/remove/runNow`; pass `getCameras` to the registry |
| `preload.js` | expose `schedule.*` |
| `src/index.html`, `src/renderer.js` | Settings → **SCHEDULE** section: list, add form, per-item toggle, delete, "run now", last-result line |
| `test/schedule-times.test.js`, `test/schedule-store.test.js`, `test/schedule-service.test.js` | **new** |

## Task breakdown (TDD, subagent-driven, branch `scheduled-tasks`)

1. Settings default + config-store whitelist (+ test)
2. `schedule-times.js` — pure date math (+ tests: each repeat kind, catch-up,
   disabled items, empty list, DST-ish boundary)
3. `schedule-store.js` — CRUD + atomic persistence (+ tests)
4. `schedule-service.js` — timer arm/re-arm/fire/catch-up with injected clock
   and fake timers (+ tests; no real waiting)
5. `look_at_camera` tool + `getCameras` wiring (+ test with fake camera/ai)
6. `main.js`/`preload.js` wiring: IPC, powerMonitor resume, startup catch-up
7. Settings SCHEDULE UI
8. `docs/MOBILE-TESTING-CHECKLIST.md`-style manual checklist + version bump

## Verification

- `npm test` green after every task (current baseline: 110).
- Timer logic tested with an injected clock — no test waits on wall time.
- End-to-end by hand: create a "speak" item two minutes out, watch it fire and
  hear it; create an `ask` item ("what's in my newest Downloads PDF") and
  confirm the agent runs and reports; toggle the master switch off and confirm
  nothing fires; close JARVIS, let a time pass, reopen and confirm the one
  catch-up run announces itself as late.
- Confirm idle behavior: with one item scheduled for tomorrow morning, JARVIS
  sets a single timer and does nothing until then.

## Not in scope

Blink/Nest camera testing; retiring the existing 30s `checkTaskReminders` poll;
MCP connector support; scheduling from the phone (the mobile app talks to the
same brain, so a spoken "remind me every weekday at 7" would work through the
agent tool once that exists, but no mobile UI is planned here).
