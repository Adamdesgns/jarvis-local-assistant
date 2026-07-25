const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BROWSER_PARTITION,
  sanitizeWebviewParams,
  isNavigationAllowed,
  decidePermission,
  shouldBlockDownload
} = require('../core/browser-guard');

test('a hostile webview attach comes out fully sanitized', () => {
  const hostile = {
    preload: 'C:/evil/steal-keys.js',
    preloadURL: 'file:///evil.js',
    partition: 'persist:main', // trying to share JARVIS's own session
    nodeIntegration: true,
    nodeIntegrationInSubFrames: true,
    webSecurity: false,
    allowpopups: true,
    contextIsolation: false,
    src: 'https://example.com'
  };
  const clean = sanitizeWebviewParams(hostile);
  assert.equal(clean.preload, undefined);
  assert.equal(clean.preloadURL, undefined);
  assert.equal(clean.partition, BROWSER_PARTITION);
  assert.equal(clean.nodeIntegration, false);
  assert.equal(clean.nodeIntegrationInSubFrames, false);
  assert.equal(clean.webSecurity, true);
  assert.equal(clean.allowpopups, undefined);
  assert.equal(clean.contextIsolation, true);
  assert.equal(clean.src, 'https://example.com', 'src is not the guard\'s business');
});

test('sanitize mutates the given object (Electron passes params by reference)', () => {
  const params = { preload: 'x', partition: 'wrong' };
  const result = sanitizeWebviewParams(params);
  assert.equal(result, params);
  assert.equal(params.preload, undefined);
  assert.equal(params.partition, BROWSER_PARTITION);
});

test('the partition is the dedicated stranger session', () => {
  assert.equal(BROWSER_PARTITION, 'persist:jarvis-browser');
});

test('navigation: web only, about:blank tolerated, everything else refused', () => {
  assert.equal(isNavigationAllowed('https://www.wlox.com'), true);
  assert.equal(isNavigationAllowed('http://example.com/a?b=c'), true);
  assert.equal(isNavigationAllowed('about:blank'), true);
  assert.equal(isNavigationAllowed('file:///C:/Users/steam'), false);
  assert.equal(isNavigationAllowed('javascript:alert(1)'), false);
  assert.equal(isNavigationAllowed('chrome://gpu'), false);
  assert.equal(isNavigationAllowed('about:config'), false);
  assert.equal(isNavigationAllowed('data:text/html,<script>x</script>'), false);
  assert.equal(isNavigationAllowed('not a url'), false);
  assert.equal(isNavigationAllowed(''), false);
});

test('permissions are refused unconditionally — no argument can change the answer', () => {
  assert.equal(decidePermission(), false);
  assert.equal(decidePermission('media'), false);
  assert.equal(decidePermission('geolocation'), false);
  assert.equal(decidePermission('please', { reallyNice: true }), false);
});

test('downloads are blocked unconditionally', () => {
  assert.equal(shouldBlockDownload(), true);
  assert.equal(shouldBlockDownload('setup.exe'), true);
});
