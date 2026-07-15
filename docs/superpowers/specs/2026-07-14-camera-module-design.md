# Multi-Brand Camera Module — Design

Date: 2026-07-14
Status: Approved by Adam (conversation, 2026-07-14)
Target: JARVIS V2, first release after 0.11.2

## Goal

A "Cameras" floating module that shows live view and snapshots from the household's
security cameras, raises motion/doorbell alerts (with optional AI scene descriptions),
and can arm/disarm supported systems behind JARVIS approval cards.

Supported at v1:

- **Blink** (cloud, unofficial REST protocol)
- **Ring** (cloud, `ring-client-api`)
- **Nest** (cloud, official Google Smart Device Management API; labeled "Advanced setup" —
  each user pays Google a one-time $5 Device Access fee and completes OAuth)
- **Generic RTSP/ONVIF** (local cameras: Reolink, Amcrest, Hikvision, Tapo, Wyze-with-RTSP, etc.)

Deferred to v1.1: recorded clip browser, two-way talk.

## Product context

- The app is moving from free giveaway to **paid product** (Adam's decision, 2026-07-14).
  Licensing/purchase flow is a **separate project**; this module ships ungated.
- All third-party components must be license-compatible with commercial distribution.
  `ring-client-api` (MIT), `onvif` (MIT), go2rtc (MIT) — all acceptable.

## Architecture (Approach A: pure Node + go2rtc)

All camera code runs in the Electron main process under `core/camera/`:

```
core/camera/
  camera-service.js      Orchestrator: accounts, camera registry, alert routing,
                         snapshot cache/rate limits, vision hookup, IPC surface
  go2rtc-manager.js      Supervises bundled go2rtc.exe (spawn, config, watchdog,
                         restart-once-then-red-diagnostic, like local-voice-service)
  drivers/
    driver-interface.js  Base class + contract documentation
    blink-driver.js      Hand-rolled REST client for the documented unofficial protocol
    ring-driver.js       ring-client-api: push events, WebRTC live view, arm/disarm
    nest-driver.js       Google SDM REST + OAuth; optional Pub/Sub event subscription
    rtsp-driver.js       Manual camera entry + ONVIF discovery (onvif npm package)
```

### Driver contract

Every driver implements exactly:

| Method | Purpose |
|---|---|
| `connect(credentials)` | Authenticate; may request a 2FA code via callback |
| `listCameras()` | Return `[{id, name, brand, capabilities}]` |
| `getSnapshot(cameraId)` | Return JPEG buffer (fresh or driver-cached) |
| `getStreamSource(cameraId)` | Return a go2rtc-ingestible source string, or `null` (snapshot-only) |
| `setArmed(systemId, state)` | Arm/disarm, or throw `NotSupported` |
| `events` | EventEmitter: `motion`, `doorbell`, `status` |

The renderer/grid never sees brand-specific code. A future Python-backed driver
(Approach B escape hatch) implements the same contract.

### Video path

- go2rtc.exe (~15 MB, MIT) bundled in `resources/go2rtc/`, spawned bound to
  `127.0.0.1` on a random free port with a generated access token.
- Drivers register stream sources with go2rtc-manager; renderer plays WebRTC.
- Streams are on-demand: start when a tile opens live view, stop when it closes.
- Blink live view is time-capped by Amazon (~5 min): tile shows a countdown and
  falls back to snapshot mode when the session ends.

### Credentials

New `cameraAccounts` section in the config store. Every secret (passwords, tokens,
refresh tokens) encrypted with Electron `safeStorage`, never plain text. 2FA flows
(Blink email PIN, Ring 2FA code, Nest OAuth browser redirect) run through Settings UI.

### Sensitive actions

- Arm/disarm requires the standard approval card (`core/security.js`).
- Viewing/snapshots need no approval but every access is written to the activity log.
- Model output is never treated as permission: AI can *suggest* arming, only the
  approval card authorizes it (existing product rule).

## Alerts and AI vision

Event flow: driver emits `motion`/`doorbell` → camera-service fetches a snapshot →
if AI descriptions are enabled AND a vision-capable Ollama model is installed, the
frame goes through the existing `ai-service` vision path → notification (+ optional
voice announcement) with the description; otherwise the notification is generic with
the snapshot attached. All alerts land in the activity timeline.

- Ring: real-time push (ring-client-api).
- Blink: poll every ~30 s while an account is connected.
- Nest: events require a Google Pub/Sub subscription (part of the Advanced wizard);
  if the user skips it, Nest shows no alerts (graceful degradation, stated in UI).

On-demand: "who's at the front door?" → router matches camera by name →
fresh snapshot → vision model → answer.

Privacy rules:

- Camera frames go to Cloud Brain (OpenAI) **only** if a dedicated
  "allow cloud analysis of camera images" toggle is on. Default off.
- Vision model preset offered during camera setup (~4–6 GB download, optional).

Battery protection (Blink): automatic snapshot refresh max once per camera per
10 minutes; manual refresh always allowed and logged.

## UI

- New `<article class="module hidden-module" data-module="cameras">` in the module
  system: draggable/resizable grid of camera tiles like existing modules.
- Tile: latest snapshot, camera name, brand badge, freshness timestamp; click for
  live view (if supported); manual refresh button; arm/disarm control on system tiles.
- Settings → Cameras: add/remove accounts per brand, 2FA prompts, Nest "Advanced
  setup" wizard with explicit $5-fee warning, AI description + cloud-analysis toggles.
- Diagnostics → Cameras tab: green/red per account (signed in, reachable, streaming
  helper running, vision model present), Copy Report button (secrets omitted).

## Error handling

- Per-account status chip: Connected / Reconnecting / Signed out / API changed.
- Cloud drivers retry with exponential backoff; hard auth failure prompts re-login.
- go2rtc watchdog: restart once, then red diagnostic (voice-engine pattern).
- Unofficial-API risk (Blink, and Ring's library): failures must surface as a visible
  "Blink connection lost — check for JARVIS updates" state, never silent.

## Testing

- Unit tests with mocked/recorded API responses per driver (Blink client especially).
- Driver-contract conformance suite run against all four drivers.
- Standard verification: `npm test`, `node --check` on entry files, `npm audit --omit=dev`.
- Manual (Adam, end of project): real Blink cameras; Ring/Nest on real or borrowed
  accounts before selling; installer test on a clean machine.

## Build order (each step leaves the app shippable)

1. Driver interface + go2rtc-manager + Cameras module UI + **RTSP/ONVIF driver**
   (proves the full video path with no cloud auth).
2. **Blink** driver (snapshots, arm/disarm, motion polling, 2FA login UI).
3. **Ring** driver + the alerts/notification pipeline.
4. **AI descriptions** (on-demand + smart alerts).
5. **Nest** driver + Advanced wizard + optional Pub/Sub alerts.

## Out of scope

- Licensing/paywall (separate project; module ships ungated).
- Clip browser, two-way talk (v1.1).
- Continuous AI monitoring of live video (event/on-demand frames only).
- Bundling any Ollama vision model in the installer (offered as optional download).

## Known risks

- Blink/Ring APIs are unofficial; Amazon can break them. Mitigation: visible failure
  states, in-app update check already exists, driver contract allows swapping
  implementations.
- Nest onboarding friction is high by Google's design; "Advanced" labeling and the
  wizard manage expectations.
- go2rtc adds ~15 MB to the installer and one more supervised process.
- Vision quality depends on the user's GPU/model choice; alerts degrade to generic
  text + snapshot without a vision model.
