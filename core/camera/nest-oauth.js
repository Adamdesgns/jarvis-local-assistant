const http = require('node:http');
const nestClient = require('./nest-client');
const { freePort } = require('./go2rtc-manager');

// One-shot loopback OAuth: open Google's consent page in the system browser,
// catch the redirect on 127.0.0.1, trade the code for tokens, shut down.
async function runOauthFlow({ projectId, clientId, clientSecret, openExternal, timeoutMs = 120000 }) {
  const port = await freePort();
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const codePromise = new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, redirectUri);
      if (url.pathname !== '/callback') { response.writeHead(404); response.end(); return; }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(code
        ? '<h2 style="font-family:sans-serif">JARVIS is connected to Nest. You can close this tab.</h2>'
        : '<h2 style="font-family:sans-serif">Google sign-in did not finish. Go back to JARVIS and try again.</h2>');
      server.close();
      clearTimeout(timer);
      if (code) resolve(code);
      else reject(new Error(error || 'Google sign-in was cancelled.'));
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Google sign-in timed out after 2 minutes. Try again.'));
    }, timeoutMs);
    server.listen(port, '127.0.0.1');
  });

  await openExternal(nestClient.authUrl({ projectId, clientId, redirectUri }));
  const code = await codePromise;
  return nestClient.exchangeCode({ clientId, clientSecret, code, redirectUri });
}

module.exports = { runOauthFlow };
