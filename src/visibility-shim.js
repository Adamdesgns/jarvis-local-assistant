// document.hidden is a corpse in this app: main.js disables Chromium's
// occlusion tracker (the July 20 speech fix), which pins it to false in every
// window forever. Every orb skin pauses on exactly that signal, so hidden
// windows kept rendering at full framerate — ~45% GPU at "idle" (found
// 2026-08-13, the copy-engine hunt).
//
// The fix has two halves. core/window-visibility.js pushes the window's real
// visibility from the main process, and this shim overlays document.hidden /
// document.visibilityState with that flag and fires a genuine
// visibilitychange event when the answer changes. The skins' existing pause
// logic then just works again, untouched.
//
// Loaded as the first script in index.html and widget.html; safe to require
// from node for tests.
function createVisibilityShim(doc, { EventCtor } = {}) {
  const MakeEvent = EventCtor || (typeof Event !== 'undefined' ? Event : null);
  // The native getters keep answering through the shim: a document Chromium
  // itself considers hidden must stay hidden whatever the window flag says.
  const proto = Object.getPrototypeOf(doc);
  const nativeHidden = Object.getOwnPropertyDescriptor(proto, 'hidden');
  const nativeState = Object.getOwnPropertyDescriptor(proto, 'visibilityState');
  const readNativeHidden = nativeHidden && nativeHidden.get
    ? () => nativeHidden.get.call(doc)
    : () => false;
  const readNativeState = nativeState && nativeState.get
    ? () => nativeState.get.call(doc)
    : () => 'visible';

  let windowVisible = true;

  Object.defineProperty(doc, 'hidden', {
    configurable: true,
    get: () => readNativeHidden() || !windowVisible
  });
  Object.defineProperty(doc, 'visibilityState', {
    configurable: true,
    get: () => (!windowVisible ? 'hidden' : readNativeState())
  });

  return {
    setWindowVisible(visible) {
      const next = Boolean(visible);
      if (next === windowVisible) return;
      windowVisible = next;
      if (MakeEvent) doc.dispatchEvent(new MakeEvent('visibilitychange'));
    }
  };
}

// In a window: install immediately, before any orb script loads.
if (typeof window !== 'undefined' && window.jarvis && window.jarvis.onWindowVisibility) {
  const shim = createVisibilityShim(document);
  window.jarvis.onWindowVisibility((visible) => shim.setWindowVisible(visible));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createVisibilityShim };
}
