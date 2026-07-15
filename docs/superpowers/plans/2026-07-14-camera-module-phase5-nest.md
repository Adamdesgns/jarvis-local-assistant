# Camera Module Phase 5 (Nest Driver + Advanced Wizard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nest cameras via Google's official Smart Device Management API behind a NEST (ADVANCED) tab: the user supplies their Device Access project ID + OAuth client ID/secret (one-time $5 Google fee, done in Google's console), JARVIS runs the browser OAuth sign-in on a loopback redirect, then lists cameras with WebRTC live view.

**Architecture:** `nest-client.js` (OAuth token exchange/refresh + SDM REST, injected fetch) wrapped by `NestDriver` (sdp-bridge live view via `CameraLiveStream.GenerateWebRtcStream`; RTSP-only devices fall back to go2rtc via `GenerateRtspStream`). OAuth code capture uses a one-shot `http` server on `127.0.0.1:<free port>`; the consent URL opens in the system browser. Spec: `docs/superpowers/specs/2026-07-14-camera-module-design.md`.

## Global Constraints

- Same as prior phases. clientSecret/refreshToken/accessToken only in encrypted secrets.
- No Pub/Sub in v1: Nest cameras produce **no motion alerts**; the UI states this plainly (spec-sanctioned degradation).
- Nest has no snapshot API for live tiles: tiles are live-view-first and say "LIVE VIEW ONLY".
- Nest has no arm/disarm: `listSystems()` returns `[]`.
- Nest WebRTC offers require a data channel: the shared live-view path adds `peer.createDataChannel('jarvis')` before `createOffer` (harmless for Ring/go2rtc; verified by existing tests still passing plus real-device checklist).

## Tasks

1. **nest-client.js** — `authUrl({projectId, clientId, redirectUri})` (partnerconnections consent URL, `scope=sdm.service`, `access_type=offline&prompt=consent`); `exchangeCode({clientId, clientSecret, code, redirectUri})` → `{refreshToken, accessToken, expiresAt}`; `refreshAccessToken({clientId, clientSecret, refreshToken})`; `listDevices(session, projectId)` (filters to devices with the CameraLiveStream trait → `{id, name, protocols}`); `generateWebRtcStream(session, deviceId, offerSdp)` → `{answerSdp, mediaSessionId}`; `generateRtspStream(session, deviceId)` → rtsp URL. Tests: URL shape, token exchange body, device filtering/naming, command payloads (mocked fetch).
2. **nest-driver.js** — secrets `{projectId, clientId, clientSecret, refreshToken, accessToken, expiresAt}`; `connect()` refreshes the access token when missing/expired (persists), lists devices; `listCameras()` → `{brand: 'nest', canStream: true, canArm: false, kind: 'camera', liveOnly: true}`; `createSdpSession` for WEB_RTC devices; `getStreamSource` returns the RTSP URL for RTSP-only devices, else null; `getSnapshot` NotSupported. Tests with fake client.
3. **OAuth loopback + service wiring** — `addNestAccount({projectId, clientId, clientSecret}, {openExternal, oauthFlow})`: free-port one-shot HTTP server (120 s timeout, plain-English success/failure page), consent URL via openExternal, code → exchangeCode → secrets + account + instantiate. IPC `cameras:add-nest`; preload `addNest`. main.js passes `shell.openExternal`. Tests inject a fake oauthFlow.
4. **UI** — `NEST (ADVANCED)` tab: warning copy (one-time $5 Google Device Access fee + console setup), OPEN GOOGLE CONSOLE button (`https://console.nest.google.com/device-access`), three inputs, START GOOGLE SIGN-IN; tile handling for `liveOnly` (no ↻/🔎 buttons, "LIVE VIEW ONLY" placeholder). Data-channel line added to the shared live path.
5. **Verification + roadmap close-out** — full suite, syntax, audit (critical gate), capture boot; update `JARVIS-ROADMAP-AND-CLAUDE-HANDOFF.md` (5.4 done for cameras, paid-product direction note); Adam's real-account checklist.
