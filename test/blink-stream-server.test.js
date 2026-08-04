const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { BlinkStreamServer, PATH_PREFIX } = require('../core/camera/blink-stream-server');

// The last hop for Blink live view: MPEG-TS from the main process to the
// renderer's <video>. Real sockets on 127.0.0.1 with port 0, same mold as the
// call signal server's tests.

function get(url, { onChunk } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => {
        chunks.push(chunk);
        onChunk?.(chunk, request, response);
      });
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks)
      }));
    });
    request.on('error', reject);
  });
}

const head = (url) => new Promise((resolve, reject) => {
  const request = http.get(url, (response) => {
    resolve({ status: response.statusCode, headers: response.headers });
    response.resume();
  });
  request.on('error', reject);
});

const tsPacket = (fill) => Buffer.concat([Buffer.from([0x47]), Buffer.alloc(187, fill)]);
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

async function withServer(run, options) {
  const server = await new BlinkStreamServer(options).start();
  try { await run(server); } finally { await server.stop(); }
}

test('stream server: binds to localhost only, never the LAN', async () => {
  await withServer(async (server) => {
    assert.ok(server.port > 0, 'took an OS-assigned port');
    const address = server.server.address();
    assert.equal(address.address, '127.0.0.1');
    const handle = server.register({});
    assert.match(handle.url, /^http:\/\/127\.0\.0\.1:\d+\/blink\/[0-9a-f]{48}\.ts$/);
  });
});

test('stream server: streams pushed chunks to the viewer as MPEG-TS', async () => {
  await withServer(async (server) => {
    const handle = server.register({});
    const seen = [];
    const request = get(handle.url, {
      onChunk: (chunk) => {
        seen.push(chunk);
        if (seen.length === 2) handle.close();
      }
    });
    await settle();
    handle.push(tsPacket(1));
    handle.push(tsPacket(2));
    const response = await request;
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'video/mp2t');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.body.length, 376);
    assert.equal(response.body[0], 0x47);
    assert.equal(response.body[188], 0x47);
  });
});

// Without a token any local program could read a camera by guessing a URL.
test('stream server: an unknown or guessed token gets nothing', async () => {
  await withServer(async (server) => {
    const base = `http://127.0.0.1:${server.port}`;
    assert.equal((await head(`${base}${PATH_PREFIX}deadbeef.ts`)).status, 404);
    assert.equal((await head(`${base}${PATH_PREFIX}garage.ts`)).status, 404, 'no friendly names to guess');
    assert.equal((await head(`${base}/`)).status, 404);
    assert.equal((await head(`${base}/etc/passwd`)).status, 404);
    const handle = server.register({});
    assert.equal((await head(handle.url.replace('.ts', ''))).status, 404, 'exact path or nothing');
  });
});

test('stream server: tokens are unguessable and never repeat', async () => {
  await withServer(async (server) => {
    const tokens = new Set();
    for (let i = 0; i < 25; i += 1) tokens.add(server.register({}).token);
    assert.equal(tokens.size, 25, 'every live view gets its own token');
    for (const token of tokens) assert.ok(token.length >= 32, 'long enough not to brute-force');
  });
});

test('stream server: a closed token stops working immediately', async () => {
  await withServer(async (server) => {
    const handle = server.register({});
    handle.close();
    assert.equal((await head(handle.url)).status, 404, 'a finished view cannot be replayed');
  });
});

// A closed window must not leave a battery camera awake.
test('stream server: the viewer hanging up stops the Blink stream', async () => {
  await withServer(async (server) => {
    let stopped = 0;
    const handle = server.register({ onStop: () => { stopped += 1; } });
    await new Promise((resolve, reject) => {
      const request = http.get(handle.url, (response) => {
        response.on('data', () => request.destroy());
        response.on('error', () => {});
        resolve();
      });
      request.on('error', () => {});
      setTimeout(() => handle.push(tsPacket(3)), 20);
      setTimeout(resolve, 200);
    });
    await settle();
    assert.equal(stopped, 1, 'told the camera service to end the live view');
  });
});

test('stream server: closing from our side does not report a viewer hang-up', async () => {
  await withServer(async (server) => {
    let stopped = 0;
    const handle = server.register({ onStop: () => { stopped += 1; } });
    const request = get(handle.url);
    await settle();
    handle.push(tsPacket(4));
    handle.close();
    await request;
    await settle();
    assert.equal(stopped, 0, 'we ended it deliberately; that is not a disconnect');
  });
});

test('stream server: a second viewer is refused rather than stealing the stream', async () => {
  await withServer(async (server) => {
    const handle = server.register({});
    const first = get(handle.url);
    await settle();
    assert.equal((await head(handle.url)).status, 409);
    handle.push(tsPacket(5));
    handle.close();
    const response = await first;
    assert.equal(response.body.length, 188, 'the original viewer kept every byte');
  });
});

// Live video: a moment nobody was watching is worthless, and buffering it would
// only ever play back the past.
test('stream server: chunks pushed before anyone is watching are dropped, not queued', async () => {
  await withServer(async (server) => {
    const handle = server.register({});
    handle.push(tsPacket(6));
    handle.push(tsPacket(7));
    const request = get(handle.url);
    await settle();
    handle.push(tsPacket(8));
    handle.close();
    const response = await request;
    assert.equal(response.body.length, 188, 'only what arrived while watching');
    assert.equal(response.body[1], 8);
  });
});

test('stream server: pushing after close is harmless', async () => {
  await withServer(async (server) => {
    const handle = server.register({});
    handle.close();
    assert.doesNotThrow(() => handle.push(tsPacket(9)));
  });
});

test('stream server: stopping tears down every open view', async () => {
  const server = await new BlinkStreamServer().start();
  const a = server.register({});
  const b = server.register({});
  const port = server.port;
  await server.stop();
  assert.equal(server.sessions.size, 0);
  await assert.rejects(() => head(`http://127.0.0.1:${port}${PATH_PREFIX}${a.token}.ts`), /ECONNREFUSED/);
  assert.doesNotThrow(() => b.push(tsPacket(1)), 'late pushes after shutdown stay quiet');
});

test('stream server: starting twice keeps the same port', async () => {
  await withServer(async (server) => {
    const port = server.port;
    await server.start();
    assert.equal(server.port, port, 'no second listener');
  });
});
