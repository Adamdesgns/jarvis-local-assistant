# THE BROWSER stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An embedded, walled-off browser module per `docs/superpowers/specs/2026-07-25-browser-stage1-design.md`.

**Architecture:** `<webview>` tag inside a normal JARVIS module (never WebContentsView — it would paint over approval cards). All enforcement in the main process via pure `core/browser-guard.js` policy consulted at `will-attach-webview`, the partition's permission/download handlers, and the guests' window-open handlers. Renderer chrome (tabs/address bar) driven by pure `src/browser-tabs.js` state.

**Tech Stack:** Electron 43, node:test, no new dependencies.

## Global Constraints

- Web pages are strangers: partition `persist:jarvis-browser`; permissions deny-all; downloads blocked; http/https only; new windows become tabs, never OS windows; tab cap 5.
- `webviewTag: true` on the MAIN window only; every attach passes through the guard.
- No inline `style=""` (CSP). Accent via `JarvisTerminal.accentFor(orbColor)` — never a new colorway mapper.
- Branch `browser-stage1`; commit per task; no merge/push without Adam's word.

---

### Task 1: Pure tab state + address normalization

**Files:** Create `src/browser-tabs.js`; Test `test/browser-tabs.test.js`.

**Interfaces — Produces:**
- `normalizeAddress(text) -> { url } | null` — full http/https URLs pass through; bare domains (`wlox.com`, `www.x.co/path`) get `https://`; anything else → DuckDuckGo search url `https://duckduckgo.com/?q=<encoded>`; empty/whitespace → null; `file:`/`javascript:`/other schemes → treated as search text, never a URL.
- `createTabList({ max = 5 })` with `open(url) -> tab|null` (null at cap), `close(id) -> nextActiveId|null`, `activate(id)`, `update(id, patch)` (title/url/loading), `active()`, `list()`, ids stable strings.

- [ ] Failing tests: URL passthrough, https default, search fallback (spaces, `what is a webview`), scheme refusal (`file:///c:/x`, `javascript:alert(1)` become searches), empty → null; cap 5 (6th open → null), closing the active tab activates its neighbor, closing the last tab → empty list, update patches title/loading.
- [ ] Implement; `node --test test/browser-tabs.test.js` green; commit.

### Task 2: Pure guard policy

**Files:** Create `core/browser-guard.js`; Test `test/browser-guard.test.js`.

**Interfaces — Produces:**
- `BROWSER_PARTITION = 'persist:jarvis-browser'`
- `sanitizeWebviewParams(params) -> params` — deletes `preload`/`preloadURL`, forces `partition = BROWSER_PARTITION`, `nodeIntegration:false`, `nodeIntegrationInSubFrames:false`, `webSecurity:true`, `allowpopups` removed, `contextIsolation:true`.
- `isNavigationAllowed(url) -> boolean` — http:/https: (+ `about:blank`) only.
- `decidePermission() -> false` (always; the test asserts it takes no argument that can change the answer).
- `shouldBlockDownload() -> true` (always).

- [ ] Failing tests: a hostile params object (preload set, partition 'persist:main', nodeIntegration true, allowpopups) comes out fully sanitized; scheme table; deny/block invariants.
- [ ] Implement; green; commit.

### Task 3: Main-process wiring + preload

**Files:** Modify `main.js` (window webPreferences ~line 167; new wiring block near the defense IPC), `preload.js`.

**Interfaces — Produces (renderer-visible):** `window.jarvis.onBrowserOpenTab(cb)` ← `browser:open-tab {url}`; `window.jarvis.onBrowserNotice(cb)` ← `browser:notice {message}` (download blocked / permission denied toasts).

- [ ] Add `webviewTag: true` to the main window `webPreferences` with a comment pointing at the guard.
- [ ] Wire, all through `require('./core/browser-guard')`:
  - `mainWindow.webContents.on('will-attach-webview', (e, webPreferences, params) => { sanitize both; })` — sanitizer applied to `params` AND `webPreferences` (preload rides on webPreferences).
  - `mainWindow.webContents.on('did-attach-webview', (e, guest) => { guest.setWindowOpenHandler(({url}) => { if (isNavigationAllowed(url)) sendEverywhere('browser:open-tab', { url }); return { action: 'deny' }; }); guest.on('will-navigate', (event, url) => { if (!isNavigationAllowed(url)) { event.preventDefault(); sendEverywhere('browser:notice', { message: 'That address is not a web page, so I left it alone.' }); } }); })`
  - `session.fromPartition(BROWSER_PARTITION)`: `setPermissionRequestHandler((wc, kind, cb) => { cb(decidePermission()); sendEverywhere('browser:notice', { message: `The page asked for ${kind} — refused, as designed.` }); })` and `.on('will-download', (event, item) => { event.preventDefault(); sendEverywhere('browser:notice', { message: 'Downloads are switched off in JARVIS\'s browser for now.' }); })` — registered once at app start.
- [ ] `npm test` green (no behavior change measurable in node, but nothing may break); commit.

### Task 4: Module markup, defaults, CSS

**Files:** Modify `src/index.html` (module article after the cameras article; script tag `browser-tabs.js` + `browser-ui.js` after `defense-ui.js`), `core/defaults.js` (`hiddenModules` + `'browser'`; `moduleLayout.browser = { x: 22, y: 8, w: 56, h: 72 }`), `src/styles.css` (+ command-center recolor line if needed).

Markup inside `data-module="browser"`:

```html
<article class="module hidden-module" data-module="browser">
  <header class="module-header drag-handle"><div><span>The web</span><h2>Browser</h2></div><div class="module-actions"><button data-collapse>−</button><button data-hide>×</button></div></header>
  <div class="module-content browser-content">
    <div id="browser-tabs" class="browser-tabs"><button id="browser-new-tab" type="button" title="New tab">＋</button></div>
    <form id="browser-address-form" class="browser-address">
      <button type="button" id="browser-back" title="Back">‹</button>
      <button type="button" id="browser-forward" title="Forward">›</button>
      <button type="button" id="browser-reload" title="Reload">⟳</button>
      <input id="browser-address" placeholder="Search or type an address" autocomplete="off">
    </form>
    <div id="browser-pages" class="browser-pages"><p class="browser-empty">Open a tab to start surfing.</p></div>
  </div>
  <i class="resize-handle"></i>
</article>
```

- [ ] CSS: `.browser-content` column flex; tab strip pills with accent underline on the active tab (accent set as a CSS custom property `--browser-accent` from JS); `.browser-pages { flex:1; position:relative; }`; `.browser-pages webview { position:absolute; inset:0; }` with `[data-active="false"] { visibility:hidden; }`; loading shimmer on the active tab pill. No inline styles.
- [ ] `npm test` green (settings-tabs/module tests untouched); commit.

### Task 5: browser-ui.js — chrome + webview lifecycle

**Files:** Create `src/browser-ui.js`.

**Consumes:** Task 1 state (`createTabList`, `normalizeAddress`), Task 3 events, `JarvisTerminal.accentFor`.

Behavior (IIFE, `window.JarvisBrowser = { openTab }`):
- One `<webview>` per tab, created with `partition` attribute (belt to the guard's suspenders), `data-active` toggled on activate; `src` from navigation only.
- Events per webview: `page-title-updated` → `tabs.update(id,{title})`; `did-navigate`/`did-navigate-in-page` → update url + address bar when active; `did-start-loading`/`did-stop-loading` → loading pill + back/forward enabled state via `canGoBack()/canGoForward()`.
- Address submit → `normalizeAddress` → navigate active tab (or open first tab); new-tab button → `open('https://duckduckgo.com')`; cap-hit → toast.
- `onBrowserOpenTab` → `openTab(url)`; `onBrowserNotice` → `showToast(message)` (renderer global, typeof-guarded).
- Accent: read `state.settings.orbColor`? No — browser-ui stays decoupled: `document.body` gets `--browser-accent` set from `JarvisTerminal.accentFor(window.jarvisHologram?.palette)` on module open and on `onOrbPrefs`.

- [ ] Implement; `npm test` green; commit.

### Task 6: Rig + screenshots

**Files:** Create `test/rigs/browser.html` — real tokens/styles/browser-tabs.js/browser-ui.js, stub `window.jarvis` bridge, and a `<webview>` stand-in: rig registers `customElements.define('web-view'…)`? No — simpler: rig sets `window.JarvisBrowserRig = true` and browser-ui creates `data-rig-frame` divs instead of webviews when the flag is set (explicit, 3 lines, honest about what a rig can prove).
- [ ] Click-prove: open 3 tabs, switch, close, address→navigate updates bar, cap toast at 6th. Headless Electron capture (extend `scratchpad/capture-defense.js` pattern into `capture-browser.js`), send shots to Adam.
- [ ] Commit.

### Task 7: Close-out

- [ ] Full `npm test` green; CHANGELOG Unreleased entry; tick roadmap NEXT box (repo + note vault); commit. NO merge/push without Adam's word.

## Self-review

Spec coverage: wall (T2/T3), chrome/tabs/address (T1/T4/T5), skin accent (T5), module plumbing (T4), rig + honest live-test limit (T6), out-of-scope list respected — no history/favicons/voice. Type check: `createTabList`/`normalizeAddress`/`BROWSER_PARTITION` names consistent across T1–T5.
