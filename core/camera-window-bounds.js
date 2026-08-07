// Placement math for pop-out camera windows.
//
// core/orb-bounds.js already does this for the orb, but only for squares — it
// works in a single `size`. Camera windows are rectangles, so this is the
// rectangular sibling rather than a rewrite of a module that is already tested
// and shipping.
//
// The multi-monitor rule that matters: a saved position belongs to whichever
// display contains it. Unplug that monitor and the naive restore puts the window
// at coordinates no screen covers any more, i.e. invisible with no way to get it
// back. `restoreBounds` picks the nearest surviving display instead.
const MIN_WIDTH = 240;
const MIN_HEIGHT = 160;
const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 420;
// Each additional pop-out steps down-right so windows do not land exactly on top
// of one another and look like one window.
const CASCADE_STEP = 36;
const CASCADE_WRAP = 6;

const int = (value, fallback) => (Number.isFinite(value) ? Math.round(value) : fallback);

// Keep a window fully inside one display's work area. A window larger than the
// screen is shrunk to fit rather than left with its edges unreachable.
function clampRectToWorkArea(rect, workArea) {
  const width = Math.max(MIN_WIDTH, Math.min(workArea.width, int(rect?.w, DEFAULT_WIDTH)));
  const height = Math.max(MIN_HEIGHT, Math.min(workArea.height, int(rect?.h, DEFAULT_HEIGHT)));
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;
  return {
    x: Math.max(workArea.x, Math.min(maxX, int(rect?.x, workArea.x))),
    y: Math.max(workArea.y, Math.min(maxY, int(rect?.y, workArea.y))),
    w: width,
    h: height
  };
}

// Where the nth pop-out goes when it has never been placed by hand.
function defaultCameraBounds(workArea, index = 0) {
  const step = (index % CASCADE_WRAP) * CASCADE_STEP;
  return clampRectToWorkArea({
    x: workArea.x + 48 + step,
    y: workArea.y + 48 + step,
    w: DEFAULT_WIDTH,
    h: DEFAULT_HEIGHT
  }, workArea);
}

const center = (rect) => ({ x: rect.x + (rect.w || 0) / 2, y: rect.y + (rect.h || 0) / 2 });
const contains = (workArea, point) => point.x >= workArea.x
  && point.x < workArea.x + workArea.width
  && point.y >= workArea.y
  && point.y < workArea.y + workArea.height;

function distanceTo(workArea, point) {
  const dx = Math.max(workArea.x - point.x, 0, point.x - (workArea.x + workArea.width));
  const dy = Math.max(workArea.y - point.y, 0, point.y - (workArea.y + workArea.height));
  return Math.hypot(dx, dy);
}

// Pick the display a saved position belongs to, falling back to the nearest one
// when that monitor is gone, then clamp inside it. `displays` is a list of
// { workArea } — Electron's shape, so main.js can pass screen.getAllDisplays()
// straight through and this stays testable without Electron.
function restoreBounds(saved, displays, index = 0) {
  const areas = (displays || []).map((display) => display.workArea).filter(Boolean);
  if (!areas.length) return { x: 0, y: 0, w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT };
  const valid = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y);
  if (!valid) return defaultCameraBounds(areas[0], index);

  const point = center({ ...saved, w: int(saved.w, DEFAULT_WIDTH), h: int(saved.h, DEFAULT_HEIGHT) });
  const home = areas.find((area) => contains(area, point));
  if (home) return clampRectToWorkArea(saved, home);
  // That monitor is gone. Land on the closest one so the window is reachable
  // instead of stranded at coordinates nothing covers.
  const nearest = areas.reduce(
    (best, area) => (distanceTo(area, point) < distanceTo(best, point) ? area : best),
    areas[0]
  );
  return clampRectToWorkArea(saved, nearest);
}

// True when a window is no longer fully on any screen — the check behind
// re-placing windows after a monitor is unplugged.
function isOffscreen(rect, displays) {
  const areas = (displays || []).map((display) => display.workArea).filter(Boolean);
  return !areas.some((area) => contains(area, center(rect)));
}

module.exports = {
  clampRectToWorkArea,
  defaultCameraBounds,
  restoreBounds,
  isOffscreen,
  MIN_WIDTH,
  MIN_HEIGHT,
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  CASCADE_STEP
};
