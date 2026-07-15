# Camera Module Phase 4 (AI Vision) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI descriptions of camera frames — smart alert bodies ("Front Door: a courier is holding a package") and on-demand "who's at the front door?" via voice/text and a per-tile DESCRIBE button. Local Ollama vision first; cloud only behind an explicit off-by-default toggle.

**Architecture:** `ai-service` gains `describeCameraFrame(jpegBase64, subject)`: try the local Ollama vision model (`/api/chat`, `images: [base64]`, non-streaming); if unavailable and `cameraCloudVision` is enabled with a saved key, fall back to the (extended) `describeImage`. `CameraService.describeFrame` (hook from Phase 3) is assigned in main.js. The router learns a "who's at the <camera>" intent. Spec: `docs/superpowers/specs/2026-07-14-camera-module-design.md`.

## Global Constraints

- Same as prior phases. Camera frames NEVER go to a cloud API unless `cameraCloudVision === true` (default false) AND a key exists.
- Alert flows must not block on vision: a 25 s timeout, failures degrade to the generic alert body.

## Tasks

1. **ai-service extension** — `describeImage` gains `context.mimeType` (default `image/png`) and `context.subject` (replaces the screenshot framing line). New `describeCameraFrame(jpegBase64, subject)`: local Ollama chat with `settings.cameraVisionModel` (default `gemma3:4b`), 25 s timeout, → `{ok, text, source: 'ollama-vision'}`; on failure, cloud fallback only if `settings.cameraCloudVision` and `hasCloudKey()`; else `{ok: false}`. Tests with injected fetch are impractical here (ai-service uses global fetch heavily already; existing tests mock at service boundaries) — cover via a small pure prompt-builder test plus manual checklist.
2. **defaults/allowlist** — `cameraAiDescriptions: true`, `cameraCloudVision: false`, `cameraVisionModel: 'gemma3:4b'` (+ updateSettings allowlist). Test: defaults exist post-merge.
3. **Wiring** — main.js assigns `cameras.describeFrame` (checks `cameraAiDescriptions`, calls `ai.describeCameraFrame`, returns text or null); IPC `cameras:describe` (manual snapshot + describe, always allowed); preload `describe(key)`.
4. **Router intent** — `CommandRouter` gains optional `cameras` dep; pattern `who('s| is)/what('s| is) (at|on) the <name>` matches camera names from `listCameras()`; snapshot → describe → spoken answer; graceful "no camera called X". Tests with fake cameras service.
5. **UI** — tile gains 🔎 DESCRIBE button (stamp shows the description); Settings BEHAVIOR section gains two toggle rows (`setting-camera-ai`, `setting-camera-cloud`) saved as `cameraAiDescriptions`/`cameraCloudVision`.
6. **Verification** — full suite, syntax checks, audit (critical gate), capture boot. Manual: install a vision model (`ollama pull gemma3:4b`), DESCRIBE a tile, ask "who's at the front door".
