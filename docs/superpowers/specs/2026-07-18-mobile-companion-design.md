# JARVIS Mobile Companion — Design

**Date:** 2026-07-18
**Status:** Approved by Adam (conversation), pending spec review
**Approach:** PWA served by the desktop app over Tailscale ("Approach A")

## What this is

A phone-sized JARVIS, served by the desktop app itself. The phone is a
*window* into the JARVIS running on Adam's PC — not a second brain. V1 scope:
**chat and voice**. Cameras, tasks view, and push alerts are explicit
follow-ons that reuse the same plumbing.

## Goals

- Talk to the same JARVIS brain (local Ollama or Cloud, whichever is active)
  from an iPhone, from anywhere.
- Voice in, voice out: press-and-hold mic, faster-whisper transcription on the
  PC, spoken reply on the phone.
- Zero public-internet exposure. Zero app store. Zero new accounts beyond
  Tailscale.
- All existing safety rules enforced where they already live: the Electron
  main process.

## Non-goals (v1)

- No standalone phone brain; PC off ⇒ mobile JARVIS unreachable (by design).
- No wake word on the phone (press-and-hold instead).
- No approval cards on the phone: actions that need confirmation answer
  "that needs a confirmation at the desktop" and stop.
- No camera view, task list, or push notifications yet.
- No Android-specific work (the PWA will likely just work there, but iPhone is
  the target).

## Architecture

```
iPhone (Safari PWA, src/mobile/)
   │  HTTPS?  No — HTTP over the Tailscale private network (see Security)
   │  auth: device key on every request
   ▼
Mobile server (core/mobile-server.js, runs inside Electron main)
   │  serves: static mobile app, POST /api/chat, POST /api/voice,
   │          SSE /api/events (agent steps, reply streaming)
   ▼
Existing router/brain (core/router.js → core/ai-service.js agent loop)
```

- **Transport:** plain Node `http` server + Server-Sent Events. No WebSocket
  dependency; SSE is native `EventSource` on iOS Safari and reconnects itself.
- **Binding:** the server binds **only** to the Tailscale interface address
  (the `100.64.0.0/10` CGNAT range) plus `127.0.0.1` for local testing. If no
  Tailscale interface exists, the server refuses to start and Settings says
  why. It never binds `0.0.0.0`.
- **Port:** default `27183`, configurable in Settings.
- **Off by default.** A new Settings **MOBILE** section holds: enable toggle,
  port, "Pair a phone" button, paired-device list with per-device revoke.

## Components

| Piece | Where | What it does |
|---|---|---|
| `core/mobile-server.js` | new | HTTP server, routes, SSE fan-out. Thin; delegates everything. |
| `core/mobile-auth.js` | new, pure | Pairing-code issue/verify, device-key check, failed-attempt lockout. Fully unit-testable, no I/O. |
| `src/mobile/` | new | The phone app: `index.html`, `mobile.css` (amber Classic language), `mobile.js`, `manifest.webmanifest`, service worker (app-shell cache only), icons. |
| Settings MOBILE section | `src/index.html` + `renderer.js` | Toggle, port, QR pairing dialog, device list/revoke. |
| `main.js` wiring | edit | Construct server when enabled; pass router, config, and a `transcribe(audio)` hook from the existing local voice service. |

## Pairing & security

1. Adam taps **Pair a phone** → desktop generates a one-time 6-digit code +
   QR encoding `http://<tailscale-ip>:<port>/pair#<code>`; code expires in
   2 minutes or on first use.
2. Phone scans QR → mobile page auto-submits the code → server responds with
   a **device key** (32 random bytes, base64url) and a device record
   (name, created date) is stored via `safeStorage` alongside other secrets.
3. Every subsequent request carries `Authorization: Bearer <device key>`.
   Constant-time comparison. 10 consecutive failures from an address ⇒ that
   address is locked out until the server restarts or pairing reopens.
4. Revoking a device deletes its key; its next request returns 401 and the
   phone shows the pairing screen.
5. Transport privacy comes from Tailscale (WireGuard encryption end-to-end);
   the HTTP inside it is not additionally encrypted. This is the standard
   Tailscale pattern and avoids self-signed-cert pain on iOS.
6. The chat endpoint feeds `router.handle()` — identical to typing at the
   desktop. Approved-folder limits, no-shell rule, Recycle-Bin deletes, and
   approval gating all remain enforced in main, which the phone cannot bypass.
   Approval-needed actions return the "needs the desktop" line (checked the
   same way the router already gates them — no new enforcement surface).

## Data flow

**Chat:** phone POSTs `{text}` → server calls `router.handle(text)` → agent
steps stream out over SSE (`agent:step` events, same summaries the desktop
shows) → final reply arrives as an SSE `reply` event → phone renders it.

**Voice:** press-and-hold records via `MediaRecorder` (AAC/mp4 on iOS) →
release POSTs the audio blob to `/api/voice` → PC transcribes with the
existing faster-whisper service → transcript is shown in the thread and fed
through the same chat flow → phone speaks the reply with `speechSynthesis`,
preferring a British male voice (same preference order as the desktop picker).
If no British voice exists on the phone, use the default voice — never fail
the reply over voice choice.

**Mid-stream disconnect:** SSE reconnects automatically; on reconnect the
phone asks `/api/last` for the most recent reply so an answer finished while
driving through a dead zone isn't lost. The server keeps only the last reply
per device in memory — no new persistence.

## Error handling

- Server unreachable (PC asleep, Tailscale off, toggle off): one status line —
  "JARVIS is unreachable — is the PC awake?" — plus a Retry button. No
  infinite spinners; every failure state names itself and offers a way back.
- 401 ⇒ clear stored key, show pairing screen.
- Mic permission denied ⇒ inline explanation with the iOS Settings path;
  typing still works.
- Transcription/brain errors surface the same friendly error text the desktop
  shows (the router already produces these).
- Server start failure (port taken, no Tailscale) ⇒ Settings shows the exact
  reason next to the toggle; the app otherwise runs normally.

## Testing

- **Unit (npm test, node:test):** all of `mobile-auth.js` (code expiry,
  single-use, key verify, lockout); route handlers via injected fakes (no real
  sockets needed for logic); SSE event formatting; voice-endpoint glue with a
  fake transcriber.
- **Manual phone checklist** (`docs/MOBILE-TESTING-CHECKLIST.md`, written
  during implementation): pair via QR, chat on Wi-Fi, chat on cellular
  (Tailscale), voice round-trip, kill Wi-Fi mid-reply and recover, revoke ⇒
  re-pair, toggle off ⇒ unreachable message, Add to Home Screen behavior.
- Existing suite must stay green after every change, per house rules.

## Follow-ons (explicitly out of v1)

Camera glance + doorbell/motion push (needs Web Push plumbing), task list
view, approval cards on the phone, wake word, Android polish, and — if mobile
becomes a headline paid feature — a native App Store app on top of this same
server.

## Build order note

Built on its own branch (`mobile-companion`). The agentic-brain live cloud
test and merge happen first; this branch then starts from the merged main.
