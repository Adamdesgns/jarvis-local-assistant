// Pure sizing/positioning math for the floating orb window. The orb window is
// transparent + frameless, which Windows cannot edge-resize, so resizing is
// done programmatically (scroll wheel) and moving by pointer-drag — both
// computed here so the logic is unit-testable.
//
// Growth has two phases: (1) resize the window from ORB_MIN up to the screen
// size, then (2) once it fills the screen, enter a fullscreen "zoom" where the
// orb keeps swelling under scroll control until the glowing core nearly leaves
// the screen — then it detonates.
const ORB_MIN = 90;
const ORB_STEP = 7;       // px per scroll tick — half the old 14 (50% slower)
const ORB_DEFAULT = 132;
const ORB_MAX = 360;      // fallback cap when no screen size is supplied
const ZOOM_STEP = 0.14;   // zoom factor per scroll tick during the fullscreen swell
const ZOOM_MAX = 4;       // orb at ~4x screen ⇒ the white core fills/exceeds it

function nextOrbSize(current, direction, screenMax = ORB_MAX) {
  const size = Number.isFinite(current) ? current : ORB_DEFAULT;
  const max = Number.isFinite(screenMax) ? screenMax : ORB_MAX;
  return Math.max(ORB_MIN, Math.min(max, size + (direction > 0 ? ORB_STEP : -ORB_STEP)));
}

// Grow/shrink around the orb's centre so it doesn't drift while resizing.
function resizeAroundCenter(bounds, direction, screenMax = ORB_MAX) {
  const size = nextOrbSize(bounds.size, direction, screenMax);
  const delta = size - bounds.size;
  if (!delta) return { ...bounds };
  return { x: bounds.x - delta / 2, y: bounds.y - delta / 2, size };
}

// Keep the orb fully visible inside a display's work area (handles monitors
// being unplugged or resolutions changing between sessions).
function clampToWorkArea(bounds, workArea) {
  const cap = Math.min(workArea.width, workArea.height);
  const size = Math.max(ORB_MIN, Math.min(cap, bounds.size || ORB_DEFAULT));
  const maxX = workArea.x + workArea.width - size;
  const maxY = workArea.y + workArea.height - size;
  return {
    x: Math.max(workArea.x, Math.min(maxX, bounds.x)),
    y: Math.max(workArea.y, Math.min(maxY, bounds.y)),
    size
  };
}

// Window-resize phase. Growing at the screen-sized max hands off to the zoom
// phase; shrinking past the minimum vanishes; everything else is a plain resize.
function resizeOutcome(bounds, direction, screenMax = ORB_MAX) {
  const max = Number.isFinite(screenMax) ? screenMax : ORB_MAX;
  if (direction > 0 && bounds.size >= max) return { type: 'zoom-enter' };
  if (direction < 0 && bounds.size <= ORB_MIN) return { type: 'vanish' };
  return { type: 'resize', bounds: resizeAroundCenter(bounds, direction, max) };
}

// Fullscreen swell phase. Keeps zooming under full scroll control; one tick from
// the top detonates; scrolling back to 1x exits to normal window sizing.
function zoomOutcome(zoom, direction) {
  if (direction > 0 && zoom + ZOOM_STEP >= ZOOM_MAX) return { type: 'explode' };
  if (direction < 0 && zoom <= 1) return { type: 'exit' };
  const next = Math.max(1, Math.min(ZOOM_MAX, zoom + (direction > 0 ? ZOOM_STEP : -ZOOM_STEP)));
  return { type: 'zoom', zoom: next };
}

// The orb's home: tucked into the bottom-right corner of a work area.
function defaultOrbBounds(workArea) {
  return {
    x: workArea.x + workArea.width - ORB_DEFAULT - 28,
    y: workArea.y + workArea.height - ORB_DEFAULT - 38,
    size: ORB_DEFAULT
  };
}

module.exports = {
  ORB_MIN, ORB_MAX, ORB_STEP, ORB_DEFAULT, ZOOM_STEP, ZOOM_MAX,
  nextOrbSize, resizeAroundCenter, clampToWorkArea, resizeOutcome, zoomOutcome, defaultOrbBounds
};
