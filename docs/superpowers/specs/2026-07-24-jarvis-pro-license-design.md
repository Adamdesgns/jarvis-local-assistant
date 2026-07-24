# JARVIS Pro — License-Key Unlock (design)

Date: 2026-07-24 · Status: implemented alongside this spec · Version: 0.18.0

## Product decisions (made with Adam)

- **$29, one-time**, no subscription. Sold via **Lemon Squeezy** (merchant of
  record; handles tax and emails the buyer a license key automatically).
- **Free forever:** voice/wake word, tasks, briefings, file search, documents
  and Q&A, local + BYO-key cloud brains, Ask Claude.
- **Pro:** cameras, phone companion, scheduled tasks, autonomy, screen
  reading, "look at my screen," screen driving, night shift.
- **Code stays public** in this repo. The gate makes the product honest for
  honest people; it is deliberately not DRM. A hand-edited settings.json can
  forge `active` — accepted, commented in code so nobody "fixes" it into an
  arms race later.
- **Privacy first:** the three license calls (activate / validate /
  deactivate) fire only on their Settings buttons. No startup check, no
  timers. Once activated, JARVIS is licensed offline forever; network
  failure never downgrades anything.

## Architecture

- Gate on persisted `settings.license.status === 'active'`, never on the key.
  The key is stored via `ConfigStore.setSecret('licenseKey', …)` (safeStorage,
  like the API keys) and only needed for the validate/deactivate buttons.
- `settings.license` is **not** in the `updateSettings` allowlist. The only
  write path is the new `ConfigStore.setLicenseState()`, called by the
  main-process `LicenseService`. A forged renderer patch is ignored (tested).
- `core/license-gate.js` — pure policy, screen-guard style, frozen
  `PRO_FEATURES`. Exports `isPro`, `gateSettingsPatch` (strips unlicensed
  false→true Pro enables from a settings patch and reports them),
  `applyLicenseToSettings` (read-only settings view with Pro flags forced
  false), `featureAllowed`.
- `core/license-service.js` — Lemon Squeezy License API client
  (form-encoded POST, no API secret needed, injectable fetch, 12 s
  AbortController timeout). `validate()` downgrades only on an explicit
  "not valid" answer; offline changes nothing anywhere.
- Enforcement seams in main.js:
  - `settings:save` runs `gateSettingsPatch` first (the choke point) and
    broadcasts `license:pro-refused` for the UI toast.
  - `gatedConfig = { getSettings: licensedSettings }` is what
    AutonomyService, ScheduleService, NightShiftService, CommandRouter, and
    ScreenHands receive — Pro flags read false to them until licensed, with
    zero edits to those modules.
  - `cameras.init()` is skipped unlicensed (accounts stay saved but
    dormant); the four `cameras:add-*` IPC handlers refuse politely.
  - `screen:describe` refuses unlicensed before the cloud-key check.
  - The gated view **never blanks `cameraAccounts`** — CameraService
    read-modify-writes that array and would clobber saved accounts (tested).
- Migration v7→v8 flips nothing: saved Pro flags stay in settings.json, the
  seams refuse until licensed, the PRO tab shows a banner, and activation
  lights everything up without reconfiguring (also re-runs cameras.init,
  syncMobileServer, and scheduleService.start so no restart is needed).

## UI

Settings → PRO tab: status light, Free-vs-Pro table, license key field,
ACTIVATE (live status line, mirrors SAVE KEY & TEST), CHECK LICENSE,
DEACTIVATE THIS PC (frees the seat), BUY JARVIS PRO · $29 (opens
`proBuyUrl` from package.json in the browser; empty until the store is
live). Gated toggles wear a `.pro-badge`, dimmed while unlicensed.

## Store setup (operational, with Adam)

Lemon Squeezy store (account exists, not yet live): product "JARVIS Pro,"
$29 one-time, license keys ON, activation limit 3, no expiry. Test-mode key
first for end-to-end verification, then Adam personally completes
payout/tax/identity and flips the store live. Buy URL lands in
`package.json` → `proBuyUrl`.

## Tests

`test/license-gate.test.js`, `test/license-service.test.js`, plus updates to
`test/settings-tabs.test.js` and `test/core.test.js`. Mutation-style
throughout: removing a feature from PRO_FEATURES, adding `license` to the
allowlist, or deleting the fetch timeout each fails a named test. 506 pass.
