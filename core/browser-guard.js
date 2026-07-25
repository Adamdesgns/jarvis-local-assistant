'use strict';

// THE BROWSER's wall, as pure policy. Web pages are strangers in the house:
// main.js consults these rules at every enforcement seam (will-attach-webview,
// the partition's permission and download handlers, the guests' window-open
// and will-navigate hooks). The renderer can never weaken what lives here.
//
// Screen-guard mold: rules in code, tests welded to them, no configuration.

const BROWSER_PARTITION = 'persist:jarvis-browser';

// Electron hands will-attach-webview its params by reference — mutating IS
// the enforcement. Whatever the renderer (or a compromised page) asked for,
// this is what it gets.
function sanitizeWebviewParams(params) {
  delete params.preload;
  delete params.preloadURL;
  delete params.allowpopups;
  params.partition = BROWSER_PARTITION;
  params.nodeIntegration = false;
  params.nodeIntegrationInSubFrames = false;
  params.webSecurity = true;
  params.contextIsolation = true;
  return params;
}

// The browser browses the web. Nothing else is a page.
function isNavigationAllowed(url) {
  const value = String(url || '');
  if (value === 'about:blank') return true;
  return /^https?:\/\//i.test(value);
}

// Stage 1 has no allow list and no prompt: camera, mic, location,
// notifications — every permission request is refused, unconditionally.
function decidePermission() {
  return false;
}

// Stage 1 blocks all downloads. Managed downloads are a later, deliberate
// feature — never a silent file landing on the PC.
function shouldBlockDownload() {
  return true;
}

module.exports = { BROWSER_PARTITION, sanitizeWebviewParams, isNavigationAllowed, decidePermission, shouldBlockDownload };
