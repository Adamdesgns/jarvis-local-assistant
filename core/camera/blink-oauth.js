const crypto = require('crypto');
const { BlinkClient } = require('./blink-client');

// Blink sign-in, done in a real browser window.
//
// Blink's password POST cannot be scripted at all — Cloudflare answers 406 to
// any code that tries (see blink-client.js). So JARVIS opens Blink's own
// sign-in page in a Chromium window, watches for the redirect that carries the
// authorization code, and trades that code for tokens itself. Adam's Blink
// password is typed into Blink's page and never passes through JARVIS.
//
// `openWindow` is injected so this is testable without Electron. It receives
// { url, onRedirect } and must call onRedirect(url) for every navigation the
// window attempts, returning a handle with close() and an onClosed hook.
async function runBlinkSignIn({ openWindow, hardwareId, client, timeoutMs = 300000 }) {
  const blink = client || new BlinkClient({});
  const id = hardwareId || crypto.randomUUID().toUpperCase();
  const { url, verifier } = blink.authorizeRequest({ hardwareId: id });

  let settled = false;
  const code = await new Promise((resolve, reject) => {
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { handle?.close?.(); } catch { /* already gone */ }
      fn(value);
    };
    const timer = setTimeout(
      () => finish(reject, new Error('Blink sign-in timed out after 5 minutes. Try again.')),
      timeoutMs
    );
    const handle = openWindow({
      url,
      // Every navigation the window attempts, including the custom-scheme
      // redirect Chromium itself cannot load.
      onRedirect: (target) => {
        const found = BlinkClient.codeFromRedirect(target);
        if (found) finish(resolve, found);
      },
      onClosed: () => finish(reject, new Error('Blink sign-in was cancelled.'))
    });
  });

  return {
    hardwareId: id,
    session: await blink.session(await blink.exchangeCode({ code, verifier, hardwareId: id }))
  };
}

module.exports = { runBlinkSignIn };
