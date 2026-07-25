# THE BROWSER, stage 1: surf inside JARVIS — design (2026-07-25)

Approved by Adam 2026-07-25 ("Approved", after the plan pitch). Roadmap NEXT item.
Stage 1 is surfing only: no page-reading (stage 2), no AI driving (stage 3).

## What it is

A **Browser module** — a normal JARVIS module (drag, resize, hide) like the
Terminal: tab strip, address bar, back/forward/reload, and the page itself,
chrome styled to the active skin and orb accent. Electron IS Chrome; this is
wiring, not a browser build.

## The wall (the real work)

Web pages are strangers in the house. Enforcement lives in the MAIN process —
renderer code can never weaken it:

- **`<webview>` tag, not WebContentsView.** A WebContentsView composites above
  the entire DOM, so it would cover approval cards, the settings modal, and the
  defense board — overlays are safety UI here. The webview element lives IN the
  DOM: overlays paint over it, the module layout engine drags/resizes it for
  free. `webviewTag: true` is enabled for the main window only.
- **`will-attach-webview` enforcer (main.js):** every webview attach gets its
  params rewritten — preload deleted, `nodeIntegration` off, `partition` forced
  to the browser partition, `webSecurity` on. A webview the renderer didn't
  expect is refused outright. Policy is pure code in `core/browser-guard.js`,
  unit-tested.
- **Isolated session:** partition `persist:jarvis-browser`. Cookies and cache
  live there (so logins survive a restart, like a real browser) and NOWHERE
  near JARVIS's session, settings, keys, or files.
- **Permissions: deny by default.** The partition's permission handler refuses
  everything — camera, mic, geolocation, notifications, MIDI, HID, all of it.
  Stage 1 has no allow list and no prompt; refusals show a quiet toast.
- **Downloads: blocked.** `will-download` cancels and toasts honestly
  ("Downloads are switched off in JARVIS's browser for now."). No silent files.
- **Navigation: http/https only.** `file:`, `about:`(except blank), `chrome:`,
  `javascript:` etc. are refused at the guard. New-window requests
  (`target=_blank`, `window.open`) become new tabs — never new OS windows —
  and are refused past the tab cap.

## The chrome

- **Tabs:** up to 5. Tab strip above the address bar; each tab shows the page
  title (or host) and a close ×. One webview per tab; background tabs keep
  their webview alive (state preserved), display toggled.
- **Address bar:** one input. `normalizeAddress(text)` (pure): full URLs pass,
  bare domains get `https://`, anything else becomes a DuckDuckGo search.
  Enter navigates the active tab. The bar always shows the tab's current URL,
  updated on navigation.
- **Controls:** back / forward / reload, enabled-state driven by the webview's
  own canGoBack/canGoForward. Loading state shown in the module header (same
  visual language as the camera tiles' connecting state).
- **Skin/accent:** chrome uses the existing tokens; the active-tab underline
  and loading tint use the orb accent via `JarvisTerminal.accentFor(orbColor)`
  — the one existing colorway→hex mapper (do not invent a new one).
- **Module plumbing:** `data-module="browser"` article, default hidden, a
  `moduleLayout` default (centered, roomy), Modules-drawer entry. No new
  Settings section in stage 1. No new voice routes in stage 1 ("open browser"
  via the existing app-open path still opens Chrome; unchanged).

## Units

| Unit | Where | Purpose |
|---|---|---|
| `core/browser-guard.js` | main (pure) | `sanitizeWebviewParams(params)`, `isNavigationAllowed(url)`, `decidePermission(kind)` → always deny, `shouldBlockDownload()` → always true. Unit-tested; the rails live here. |
| main.js wiring | main | `webviewTag: true` on the main window; `will-attach-webview` → guard; partition session: permission handler, `will-download`, `setWindowOpenHandler` → deny (renderer opens tabs itself from the webview's `new-window`-equivalent events). |
| `src/browser-tabs.js` | renderer (pure) | Tab-list state machine (open/close/activate/cap 5, title/url updates) + `normalizeAddress`. Node-tested like `terminal-log.js`. |
| `src/browser-ui.js` | renderer | DOM: tab strip, address bar, controls, webview lifecycle + event wiring (`did-navigate`, `page-title-updated`, `did-start/stop-loading`), accent application. |
| Markup/CSS | `src/index.html`, `src/styles.css` | The module article + browser chrome styles (plus command-center recolor pass). |

## Testing

- Unit: `test/browser-guard.test.js` (params always sanitized, schemes, deny-all
  permissions, downloads blocked), `test/browser-tabs.test.js` (cap, close/
  activate transitions, address normalization incl. search fallback and scheme
  refusals).
- Rig: `test/rigs/browser.html` — chrome UI with a stub webview element,
  click-proven (tabs open/close/switch, address bar updates), screenshot pass.
- Honest limit: a REAL webview only runs inside Electron with `webviewTag` on —
  the rig fakes it. Full live check (page loads, downloads refused, permission
  denied toast) happens in the running app; listed for Adam's hands-on pass.

## Out of scope (stage 1)

History/bookmarks UI, favicons, find-in-page, zoom, downloads (blocked, not
managed), page reading (stage 2), AI navigation (stage 3), Defense phase 4
wiring — the module just needs to EXIST for that later work.
