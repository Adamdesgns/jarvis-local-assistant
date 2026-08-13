# Pop-out camera windows

**Date:** 2026-08-04
**Status:** approved by Adam, implementing
**Goal, in his words:** *"I want the camera modules to separate and become moveable so if we wanted we could see JARVIS and have all our cameras on different screens. this will need to flow with a multi monitor setup well."*

## Why

Cameras today are cards inside one draggable panel in the main JARVIS window. On a
multi-monitor desk that is the wrong shape: you cannot watch the front door on the
second screen while JARVIS holds the first. Each camera needs to be able to leave
the grid and live wherever it is useful.

Decided with Adam: **one window per camera**, not a single "camera wall" window.
A wall is one click tidier; per-camera is what actually puts cameras on different
screens, and windows can still be parked side by side to make a wall by hand.

## What it does

1. Each camera card gains a pop-out control beside its refresh and zoom buttons.
2. Clicking it opens **that camera in its own OS window**, draggable to any
   monitor, resizable, with live view and snapshot working exactly as in the grid.
3. Closing the window returns the camera to the grid.
4. Each camera remembers **its own** size and position, and reopens there on the
   next launch, so a monitor arrangement survives a restart.
5. If the monitor a window lived on is gone, it opens on the nearest remaining
   screen rather than offscreen.

## Look

Frameless, matching the app (the orb window is the precedent). A slim top bar
carries the camera name and a close button and is the drag handle
(`-webkit-app-region: drag`); the window is resizable from its edges.

Adam accepted the frameless trade knowingly: a standard title bar would bring
Windows snap gestures for free, but `Win+Shift+←/→` moves a frameless window
between monitors anyway, so little is lost.

Not always-on-top. A camera wall that covers other work is worse than one you
raise deliberately. (A per-window pin is a plausible later addition; not built.)

## The one-viewer rule — the constraint that shapes this

A camera supports **exactly one live viewer at a time**. This is not a UI choice,
it falls out of the transport built earlier today:

- Blink: `blink-stream-server.js` mints one token per view and answers **409** to a
  second reader, deliberately, so a second viewer cannot silently steal the stream.
- Ring/Nest: `camera-service.sdpViews` holds one session per camera key.

So a popped-out camera must not also stream in the grid. While a window is open,
the grid card shows **"playing in its own window"** instead of a player. Closing
the window hands the stream back.

## Architecture

**`core/camera-window-bounds.js`** (new, pure, tested)
Rectangle placement math. `core/orb-bounds.js` already does this for the orb but
only for squares (it works in `size`), so this is the rectangular sibling rather
than a rewrite of a tested module:

- `defaultCameraBounds(workArea)` — a sensible first position, offset per window
  so several pop-outs do not stack exactly on top of each other.
- `clampRectToWorkArea(rect, workArea)` — keep a window fully on a screen.
- `restoreBounds(saved, displays)` — pick the display the saved position belongs
  to, fall back to the nearest one when that monitor is gone, then clamp.

**`main.js`**
`cameraWindows: Map<cameraKey, BrowserWindow>`; `openCameraWindow(key, name)`,
`closeCameraWindow(key)`. Bounds persist on move/resize, debounced 400 ms, in the
orb's mold. Listens for `screen` `display-removed` and re-clamps any window left
offscreen. Windows use the existing `preload.js`, sandboxed, `contextIsolation`.

**`src/camera-window.html` / `camera-window.js`**
One camera, reusing the same player paths as the grid (`sdp-align.js` +
`mpegts.js`) so live view behaves identically and there is one implementation of
the WebRTC and MPEG-TS logic, not two.

**Settings**
`cameraWindows: {}` in `core/defaults.js` — `{ [cameraKey]: {x,y,w,h} }` — plus
`cameraWindows` added to the `core/config-store.js` allowlist, which the
settings-persistence test enforces. Also records which cameras were open, so they
reopen on launch.

**IPC**
`cameras:popout` / `cameras:popin`, and `cameras:window-closed` pushed to the main
window so the grid card can take its stream back.

## Testing

- `core/camera-window-bounds.js` gets full unit coverage: clamping on every edge,
  restore onto the right display, fallback when a display disappears, cascade
  offsets, and garbage input.
- The settings allowlist and defaults are covered by the existing persistence
  test once `cameraWindows` is added.
- Window creation, dragging and the real multi-monitor behaviour need Electron and
  a second physical monitor, so they are **Adam-verified, not automated**. Stated
  plainly rather than pretended otherwise.

## Out of scope

Per-window always-on-top, a saved multi-monitor "layout" concept beyond
remembering each window's own spot, and any change to how streams are fetched.
