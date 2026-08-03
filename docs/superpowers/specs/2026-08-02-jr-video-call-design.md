# JARVIS ↔ JARVIS JR: Video Calls + Remote Control ("FaceTime the kid, drive his PC")

**Date:** 2026-08-02
**Status:** Approved by Adam (chat, 2026-08-02) — two phases, native, no third-party apps
**Ships in:** both builds — JARVIS (`main`) and JARVIS JR (`jarvis-jr-work` via the `apps/jarvis-jr-build` worktree)

## What this is

A private line between Adam's PC (JARVIS) and the kids' PC (JARVIS JR) over
the two machines' existing Tailscale connection, carrying two features that
share one pairing, one trust model, and one "JR" panel in JARVIS:

- **Phase 1 — Video calls.** FaceTime-style two-way video + audio.
- **Phase 2 — Remote control.** Junior's screen live inside a JARVIS window,
  with Adam's mouse and keyboard driving the kid's PC. Native — RustDesk is
  NOT part of the product (see Break-glass fallback).

Adam works out of town, so everything must work across the internet —
Tailscale is already installed on both PCs and is the only network path this
feature will ever use.

- **Calls go both directions.** JR has a big **📞 Call Dad** button; JARVIS
  has a **Call JR** button. Either side can ring the other at any time.
- **Auto-answer on JR only.** When Dad calls and nobody clicks Answer within
  20 seconds, the call connects by itself (camera + mic on). When the kid
  calls Dad, JARVIS rings until answered or the caller gives up — never
  auto-answers.
- **Control goes one direction only.** Only JARVIS can start a control
  session on JR. There is no code path for JR to view or drive Dad's PC.
- **No cloud, no accounts, no cost.** Video, audio, and control all flow
  PC-to-PC over Tailscale using WebRTC, the tech already built into
  Electron's Chromium. Zero new runtime dependencies.

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Network path | Tailscale only (both PCs already have it) |
| Call direction | Both ways, kid can call anytime |
| Missed-call behavior on JR | Auto-answer after ~20 s ring |
| Missed-call behavior on JARVIS | Ring only, never auto-answer |
| Transport | WebRTC over Tailscale (MJPEG tiles and paid services rejected) |
| UI home on JARVIS side | Cameras area |
| Remote control | Native inside JARVIS (Phase 2), not a RustDesk launcher — Adam: "if we can have our own native viewer and controller why would we use rustdesk" |
| RustDesk | Break-glass spare on Adam's PC only, outside the product |

## Architecture

One code tree, two builds. Shared core plus two thin UI skins:

```
core/call/
  call-signal-server.js   HTTP + SSE signaling server, Tailscale-bound
  call-auth.js            pairing codes + peer secret (mobile-auth.js mold)
  call-session.js         call state machine (idle/ringing/connecting/live/ended)
  control-session.js      Phase 2: control state machine + input relay (JR side)
src/
  call-ui.js              dad-side UI: JR panel — Call + Control (JARVIS build)
  call-ui-jr.js           kid-side UI: Call Dad, ring screen, control banner (JR build)
```

### Signaling server (`call-signal-server.js`)

Clone of the `mobile-server.js` pattern:

- Binds **only** to the Tailscale interface (`pickBindAddress`, 100.64.0.0/10)
  plus loopback; refuses to start without Tailscale and says why.
- Fixed default port **27184** (mobile server owns 27183), overridable in
  settings.
- Endpoints (all require the peer secret header; wrong secret = 403,
  constant-time compare):
  - `GET  /call/ping` — presence check; returns `{name, state}`
  - `POST /call/offer` — incoming call or control request: WebRTC offer SDP
    + `{kind: 'call' | 'control'}`
  - `POST /call/answer` — callee's answer SDP
  - `POST /call/ice` — trickle ICE candidates (both directions)
  - `POST /call/hangup` — end/decline (calls and control sessions alike)
  - `GET  /call/events` — SSE stream the renderer listens on

WebRTC is configured with **no STUN/TURN servers** — Tailscale IPs are
directly reachable, so host candidates connect. Nothing ever dials out to a
third party.

### Pairing (`call-auth.js`)

One-time, done by Adam on both machines (mobile-auth.js mold):

1. JARVIS Settings → CALLS → **Pair with JR** shows a 6-digit code
   (single-use, 2-minute TTL).
2. On the kids' PC, JR Settings (behind the existing parent PIN) → CALLS:
   enter Dad's Tailscale hostname/IP + the code.
3. JR claims the code over the signaling port; both sides store
   `{peerHost, peerName, sharedSecret, role}` in config. The secret
   authenticates every signaling request from then on.
4. The pairing records **who is the parent side** (`role: 'parent'` on
   JARVIS, `role: 'kid'` on JR). Control offers are only honored when they
   come from the parent side of the pairing — enforced on JR, not trusted
   from the wire.

Exactly **one** trusted peer per app. Unpaired = the server answers nothing
but the pairing claim. Re-pairing replaces the old peer.

## Phase 1 — Video calls

### Call flow (state machine in `call-session.js`)

```
caller: idle → ringing(out) → connecting → live → ended
callee: idle → ringing(in)  → connecting → live → ended
```

- Caller POSTs the offer; callee's app rings (sound + UI).
- Answer click — or JR's 20-second auto-answer timer — POSTs the answer SDP;
  ICE trickles both ways; WebRTC connects; video/audio live.
- Ring timeout for the **caller** is 45 s: JR's auto-answer (20 s) fires well
  inside it; a call *to Dad* that nobody answers gives up at 45 s and JR
  shows "Dad's busy — try again in a bit."
- `hangup` from either side, or ICE disconnection lasting > 8 s after
  automatic reconnection attempts, ends the call cleanly.
- One session at a time across both features: an offer arriving while a call
  or control session is live gets a `busy` response.

### Auto-answer (JR build only)

- Flag `callAutoAnswer`, **default ON in the JR build, absent in JARVIS** —
  the dad-side UI never arms the timer, so JARVIS physically has no
  auto-answer path.
- Toggle lives in JR's parent-PIN settings (CALLS tab), so only a parent can
  change it. Hot-applies like the rest of JR's settings.
- When it fires, JR shows "Auto-answered — Dad's calling" so the kid always
  knows the camera is on.

### Camera sharing with existing JR features

The RPS game and the 20-second lens-nap rule already manage the webcam. A
call takes priority: starting a call ends any running game capture, and the
lens-nap timer is suspended while a call is live. On hangup the normal idle
rules resume. `getUserMedia` is requested per-call and every track is stopped
on hangup — the camera light never stays on after a call.

### Call UI

**JARVIS (dad side)** — the JR panel in the cameras area
(`cameras-ui.js` neighborhood):
- **Call JR** button with live presence: green "JR is online" / gray
  "JR is offline" (from `/call/ping`, polled every ~20 s, plus a fresh check
  on click).
- Incoming call: ring sound + Answer / Decline overlay.
- In-call window: their video large, own preview small in a corner, mute and
  hang-up buttons, call timer.

**JARVIS JR (kid side)** — matching JR's big-friendly style:
- **📞 Call Dad** button on the main screen, always visible; shows
  "Dad's PC is asleep" state when presence fails.
- Incoming call: full-screen takeover, big Answer button, visible
  auto-answer countdown ("Answering in 15…").
- In-call: Dad's video full-screen, own preview small, one big red hang-up
  button. Mute exists but small — hang-up is the primary control.

## Phase 2 — Remote control

Junior's screen inside a JARVIS window, driven by Adam's mouse and keyboard.
Built after Phase 1 ships, on the same paired line.

### How it works

- **Screen out:** JARVIS sends an offer with `kind: 'control'`. JR captures
  its full screen with Electron's `desktopCapturer` and streams it over the
  same WebRTC machinery a call uses (video track, no mic by default). JR
  **auto-accepts control offers from the paired parent** — no Answer click,
  that's the point — but only for `role: 'parent'` (see Pairing).
- **Input in:** a WebRTC **data channel** carries Adam's input as JSON events
  (`{type: move/click/drag/scroll/key, …}` with normalized 0–1 coordinates,
  scaled to JR's real resolution on arrival). JR replays them through the
  existing **screen-driver PowerShell helper** (`core/screen-driver.js` +
  `drive-screen.ps1`), extended with a raw pointer/keyboard mode alongside
  its current UI-Automation commands. Same process model: helper child per
  session, killable from outside, nothing user-typed ever on a command line.
- **The viewer** is a JARVIS window: JR's screen scaled to fit, click-through
  input capture, a status strip (connection quality, session timer), and one
  **End Control** button.
- **Transparency for the kid:** while a session is live, JR shows a
  persistent, unmissable banner — "👀 Dad is viewing/controlling this PC" —
  plus a chime at session start and end. No silent mode, deliberately: the
  auto-answer call already covers "check in quietly"; control is for helping,
  and the banner keeps it honest.
- One session at a time: control and calls share the busy gate. Ending
  control tears down the capture, the data channel, and the driver child;
  a dropped connection (> 8 s) does the same automatically on JR's side so
  input can never replay into a dead session.

### Honest limits (why RustDesk stays in the drawer)

Native control is an app driving another app's machine. It works only while
JR is running and the kid's Windows session is logged in and unlocked. It
cannot see or click the Windows login screen, cannot answer UAC admin
prompts (Windows shows those on a protected desktop no normal app can
touch), and a reboot ends the session until JR relaunches. These are
platform walls, not bugs — documented in the UI copy ("JR isn't running on
their PC") rather than worked around.

### Break-glass fallback (outside the product)

`rustdesk.exe` stays installed on Adam's PC only, as a manual spare for the
day the kid's PC needs fixing at the login screen or JR itself is wedged.
It is not launched by, bundled with, or mentioned inside JARVIS. (Setup was
started in the "Remote PC access setup" session on 2026-08-02 and is still
waiting on the kid-side install — finish or drop it there, independent of
this spec.)

## Error handling

| Failure | Behavior |
|---|---|
| Tailscale not running | Call service doesn't start; UI says exactly that (mobile-server precedent) |
| Peer offline / unreachable | Button shows offline state; a click re-checks once and reports plainly |
| Wrong/expired pairing code | Claim rejected; lockout after repeated failures (mobile-auth mold) |
| Call/control drop mid-session | Automatic ICE restart attempts for 8 s, then clean teardown with "Connection dropped" |
| Second offer while busy | `busy` — caller sees "Line busy" |
| Control offer from non-parent role | Rejected on JR before any capture starts |
| Port already taken | Start fails with the port named in the reason string |
| Camera/mic denied or missing | Call fails before ringing the peer, with a plain-English reason |
| Kid's session locked / JR not running | Control button reports it plainly; no session starts |

## Testing

Same style as the existing suite (798 green on `main`, 976+ on JR):

- `test/call-auth.test.js` — pairing TTL, single-use, lockout, secret
  compare, parent/kid role stamping
- `test/call-session.test.js` — full state machine: ring, answer, decline,
  timeout, busy, hangup, drop-reconnect-fail; **auto-answer timer fires at
  20 s in JR mode and never exists in JARVIS mode**
- `test/call-signal-server.test.js` — bind refusal without Tailscale, 403 on
  bad secret, endpoint round-trip (mobile-server test mold)
- `test/control-session.test.js` — Phase 2: parent-only acceptance,
  auto-accept for parent, busy gate shared with calls, input-event
  scaling/validation, teardown kills the driver child, drop auto-teardown
- WebRTC itself is Chromium's and is not unit-tested; the media path is
  proven by the live tests.

**Live proof (Adam):**
- Phase 1: pair the two PCs, call JR from JARVIS (click Answer), call again
  and let auto-answer fire, call Dad from JR, hang up from each side once.
- Phase 2: open Control from JARVIS, watch the banner appear on JR, move the
  mouse, type a line, close a window, End Control, confirm the banner drops
  and JR's camera/screen indicators go quiet.
- Screenshot the first successful call and the first control session for
  build-in-public.

## Shipping

1. Phase 1 lands on a branch off `main`, merges to `main` (Adam's word to
   push), then `main` → `jarvis-jr-work` in the `apps/jarvis-jr-build`
   worktree (the established JR flow), rebuild `dist:jr`, release on
   `Adamdesgns/jarvis-jr`. New installers on both PCs; pair once.
2. Phase 2 repeats the same loop after Phase 1 is live-proven between the
   real PCs.

## Out of scope (deliberate)

- Group calls, more than one paired peer, mobile-app calls, text chat, call
  recording, screen sharing *during a call*, file transfer, clipboard sync,
  kid-side control of Dad's PC, any silent/invisible control mode, service-
  level control (login screen / UAC / reboot survival — that's the
  break-glass spare's job, outside the product). One dad, one kid, one line.
