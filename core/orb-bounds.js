// Pure sizing/positioning math for the floating orb window. The orb window is
// transparent + frameless, which Windows cannot edge-resize, so resizing is
// done programmatically (scroll wheel) and moving by pointer-drag — both
// computed here so the logic is unit-testable.
const ORB_MIN = 90;
const ORB_MAX = 360;
const ORB_STEP = 14;
const ORB_DEFAULT = 132;

function nextOrbSize(current, direction) {
  const size = Number.isFinite(current) ? current : ORB_DEFAULT;
  return Math.max(ORB_MIN, Math.min(ORB_MAX, size + (direction > 0 ? ORB_STEP : -ORB_STEP)));
}

// Grow/shrink around the orb's centre so it doesn't drift while resizing.
function resizeAroundCenter(bounds, direction) {
  const size = nextOrbSize(bounds.size, direction);
  const delta = size - bounds.size;
  if (!delta) return { ...bounds };
  return { x: bounds.x - delta / 2, y: bounds.y - delta / 2, size };
}

// Keep the orb fully visible inside a display's work area (handles monitors
// being unplugged or resolutions changing between sessions).
function clampToWorkArea(bounds, workArea) {
  const size = Math.max(ORB_MIN, Math.min(ORB_MAX, bounds.size || ORB_DEFAULT));
  const maxX = workArea.x + workArea.width - size;
  const maxY = workArea.y + workArea.height - size;
  return {
    x: Math.max(workArea.x, Math.min(maxX, bounds.x)),
    y: Math.max(workArea.y, Math.min(maxY, bounds.y)),
    size
  };
}

// Easter egg: scrolling past either limit pops the orb — it explodes at max,
// vanishes at min, and (handled by main.js) respawns bottom-right shortly after.
function resizeOutcome(bounds, direction) {
  if (direction > 0 && bounds.size >= ORB_MAX) return { type: 'explode' };
  if (direction < 0 && bounds.size <= ORB_MIN) return { type: 'vanish' };
  return { type: 'resize', bounds: resizeAroundCenter(bounds, direction) };
}

// The orb's home: tucked into the bottom-right corner of a work area.
function defaultOrbBounds(workArea) {
  return {
    x: workArea.x + workArea.width - ORB_DEFAULT - 28,
    y: workArea.y + workArea.height - ORB_DEFAULT - 38,
    size: ORB_DEFAULT
  };
}

module.exports = { ORB_MIN, ORB_MAX, ORB_STEP, ORB_DEFAULT, nextOrbSize, resizeAroundCenter, clampToWorkArea, resizeOutcome, defaultOrbBounds };
