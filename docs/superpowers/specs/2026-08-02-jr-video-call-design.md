# JARVIS ↔ JARVIS JR Video Calls ("FaceTime the kid")

**Date:** 2026-08-02
**Status:** Approved by Adam (chat, 2026-08-02)
**Ships in:** both builds — JARVIS (`main`) and JARVIS JR (`jarvis-jr-work` via the `apps/jarvis-jr-build` worktree)

## What this is

A private FaceTime-style video call between Adam's PC (JARVIS) and the kids'
PC (JARVIS JR), over the two machines' existing Tailscale connection. Adam
works out of town, so this must work across the internet — Tailscale is
already installed and running on both PCs, and it is the only network path
this feature will ever use.

- **Both directions.** JR has a big **📞 Call Dad** button; JARVIS has a
  **Call JR** button in the cameras area. Either side can ring the other
  at any time.
- **Auto-answer on JR only.** When Dad calls and nobody clicks Answer within
  20 seconds, the call connects by itself (camera + mic on). When the kid
  calls Dad, JARVIS rings until answered or the caller gives up — never
  auto-answers.
- **No cloud, no accounts, no cost.** Video and audio flow PC-to-PC over
  Tailscale using WebRTC, the calling tech already built into Electron's
  Chromium. Zero new runtime dependencies.

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Network path | Tailscale only (both PCs already have it) |
| Call direction | Both ways, kid can call anytime |
| Missed-call behavior on JR | Auto-answer after ~20 s ring |
| Missed-call behavior on JARVIS | Ring only, never auto-answer |
| Transport | WebRTC over Tailscale (approach 1 of 3; MJPEG tiles and paid services rejected) |
| UI home on JARVIS side | Cameras area |

## Architecture

One code tree, two builds. The feature is one shared module plus two thin
UI skins:

```
core/call/
  call-signal-server.js   HTTP + SSE signaling server, Tailscale-bound
  call-auth.js            pairing codes + peer secret (mobile-auth.js mold)
  call-session.js         call state machine (idle/ringing/connecting/live/ended)
src/
  call-ui.js              dad-side UI (JARVIS build)
  call-ui-jr.js           kid-side UI (JR build)
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
  - `POST /call/offer` — incoming call: WebRTC offer SDP
  - `POST /call/answer` — callee's answer SDP
  - `POST /call/ice` — trickle ICE candidates (both directions)
  - `POST /call/hangup` — end/decline
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
   `{peerHost, peerName, sharedSecret}` in config. The secret authenticates
   every signaling request from then on.

Exactly **one** trusted peer per app. Unpaired = the server answers nothing
but the pairing claim. Re-pairing replaces the old peer.

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
- One call at a time: an offer arriving while a call is live gets a `busy`
  response.

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

## UI

**JARVIS (dad side)** — in the cameras area (`cameras-ui.js` neighborhood):
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

## Error handling

| Failure | Behavior |
|---|---|
| Tailscale not running | Call service doesn't start; UI says exactly that (mobile-server precedent) |
| Peer offline / unreachable | Button shows offline state; a click re-checks once and reports plainly |
| Wrong/expired pairing code | Claim rejected; lockout after repeated failures (mobile-auth mold) |
| Call drop mid-chat | Automatic ICE restart attempts for 8 s, then clean hangup with "Call dropped" |
| Second incoming call | `busy` — caller sees "Line busy" |
| Port already taken | Start fails with the port named in the reason string |
| Camera/mic denied or missing | Call fails before ringing the peer, with a plain-English reason |

## Testing

Same style as the existing suite (798 green on `main`, 976+ on JR):

- `test/call-auth.test.js` — pairing TTL, single-use, lockout, secret compare
- `test/call-session.test.js` — full state machine: ring, answer, decline,
  timeout, busy, hangup, drop-reconnect-fail; **auto-answer timer fires at
  20 s in JR mode and never exists in JARVIS mode**
- `test/call-signal-server.test.js` — bind refusal without Tailscale, 403 on
  bad secret, endpoint round-trip (mobile-server test mold)
- WebRTC itself is Chromium's and is not unit-tested; the media path is
  proven by the live test.

**Live proof (Adam):** pair the two PCs, call JR from JARVIS (click Answer),
call again and let auto-answer fire, call Dad from JR, hang up from each
side once. Screenshot the first successful call for build-in-public.

## Shipping

1. Feature lands on a branch off `main`, merges to `main` (Adam's word to push).
2. Merge `main` → `jarvis-jr-work` in the `apps/jarvis-jr-build` worktree
   (the established JR flow), rebuild `dist:jr`, release on the
   `Adamdesgns/jarvis-jr` repo.
3. New JARVIS installer for Adam's PC(s), new JR installer downloaded on the
   kids' PC. Pair once, done.

## Out of scope (deliberate)

- Group calls, more than one paired peer, mobile-app calls, text chat,
  call recording, screen sharing. One dad, one kid, one line.
