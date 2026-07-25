const test = require('node:test');
const assert = require('node:assert/strict');
const { DefenseService, assertAllowedUrl } = require('../core/defense-service');

const FEED_URL = 'https://www.wlox.com/rss';
const FEED_XML = `<rss><channel>
  <item><title>Tornado confirmed near Gulfport</title><link>https://www.wlox.com/a</link></item>
  <item><title>Shelters open across Harrison County</title><link>https://www.wlox.com/b</link></item>
</channel></rss>`;

function tornadoFeature(id = 'urn:alert:tornado-1') {
  return {
    properties: {
      id,
      event: 'Tornado Warning',
      headline: 'Tornado Warning until 10 PM for Harrison County',
      instruction: 'Take shelter now in a basement or interior room.',
      areaDesc: 'Harrison, MS'
    }
  };
}

function makeHarness({ settings = {}, features = [], aiFails = false } = {}) {
  const emitted = [];
  const timeouts = [];
  const intervals = [];
  const fetched = [];
  const base = {
    license: { status: 'active' },
    autonomyNightStart: 21,
    autonomyNightEnd: 7,
    defense: { countyZone: 'MSC047', countyName: 'Harrison County', countyState: 'MS', autoWeather: true, autoCamera: true, rssFeeds: [FEED_URL] }
  };
  const merged = { ...base, ...settings, defense: { ...base.defense, ...(settings.defense || {}) } };
  const service = new DefenseService({
    config: { getSettings: () => merged },
    ai: {
      reply: async (prompt) => {
        if (aiFails) throw new Error('brain offline');
        return { ok: true, text: `READ: ${prompt.includes('Tornado') ? 'tornado situation' : 'quiet night'}` };
      }
    },
    cameras: { listSystems: async () => [{ key: 'ring:1', armed: true, canArm: true }] },
    emit: (channel, payload) => emitted.push({ channel, payload }),
    log: { write: () => {} },
    fetchImpl: async (url) => {
      fetched.push(String(url));
      if (String(url).includes('alerts/active')) return { ok: true, json: async () => ({ features }) };
      if (String(url).includes('/zones')) return { ok: true, json: async () => ({ features: [{ properties: { id: 'MSC047', name: 'Harrison' } }] }) };
      if (String(url) === FEED_URL) return { ok: true, text: async () => FEED_XML };
      throw new Error(`unexpected fetch ${url}`);
    },
    timers: {
      setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; },
      clearTimeout: () => {},
      setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
      clearInterval: () => {}
    },
    now: () => new Date(2026, 6, 25, 22, 0) // 10 PM — inside the 21→7 night window
  });
  return { service, emitted, timeouts, intervals, fetched };
}

// --- The network rail ---

test('assertAllowedUrl allows the NWS and saved feeds, blocks everything else', () => {
  assertAllowedUrl('https://api.weather.gov/alerts/active/zone/MSC047', [FEED_URL]);
  assertAllowedUrl(FEED_URL, [FEED_URL]);
  assert.throws(() => assertAllowedUrl('https://evil.example.com/x', [FEED_URL]), /Blocked/);
  assert.throws(() => assertAllowedUrl('https://api.weather.gov.evil.com/x', [FEED_URL]), /Blocked/);
  assert.throws(() => assertAllowedUrl('not a url', [FEED_URL]), /Blocked/);
  assert.throws(() => assertAllowedUrl('https://www.wlox.com/other-page', [FEED_URL]), /Blocked/);
});

// --- Pro gate ---

test('requestEnter refuses without Pro and never touches the network', async () => {
  const { service, emitted, fetched } = makeHarness({ settings: { license: { status: 'none' } } });
  const result = await service.requestEnter({ kind: 'manual' });
  assert.equal(result.ok, false);
  assert.match(result.message, /Pro/);
  assert.equal(fetched.length, 0);
  assert.equal(emitted.length, 0);
});

// --- Manual entry ---

test('a manual enter fetches the situation, composes the read, and emits defense:enter', async () => {
  const { service, emitted } = makeHarness({ features: [tornadoFeature()] });
  const result = await service.requestEnter({ kind: 'manual' });
  assert.equal(result.ok, true);
  const enter = emitted.find((e) => e.channel === 'defense:enter');
  assert.ok(enter, 'defense:enter emitted');
  assert.match(enter.payload.banner, /DEFENSE MODE · MANUAL TRIGGER · 22:00/);
  assert.equal(enter.payload.alert.properties.event, 'Tornado Warning');
  assert.equal(enter.payload.headlines.length, 2);
  assert.match(enter.payload.read, /tornado situation/);
  assert.equal(service.status().active, true);
});

test('a dead brain never blocks the board — enter proceeds with an empty read', async () => {
  const { service, emitted } = makeHarness({ features: [tornadoFeature()], aiFails: true });
  const result = await service.requestEnter({ kind: 'manual' });
  assert.equal(result.ok, true);
  const enter = emitted.find((e) => e.channel === 'defense:enter');
  assert.equal(enter.payload.read, '');
});

test('entering twice is refused politely, not re-emitted', async () => {
  const { service, emitted } = makeHarness();
  await service.requestEnter({ kind: 'manual' });
  const again = await service.requestEnter({ kind: 'manual' });
  assert.equal(again.ok, false);
  assert.match(again.message, /already/i);
  assert.equal(emitted.filter((e) => e.channel === 'defense:enter').length, 1);
});

// --- NWS poller + auto entry ---

test('a new warning proposes entry once, announces, and enters when the window lapses', async () => {
  const { service, emitted, timeouts } = makeHarness({ features: [tornadoFeature()] });
  await service.pollOnce();
  const pending = emitted.find((e) => e.channel === 'defense:pending');
  assert.ok(pending, 'defense:pending emitted');
  assert.match(pending.payload.spoken, /stand down/i);
  assert.equal(pending.payload.seconds, 15);
  await service.pollOnce(); // same alert id — must not propose again
  assert.equal(emitted.filter((e) => e.channel === 'defense:pending').length, 1);
  // The 15s wave-off timer fires with nobody objecting:
  const waveOffTimer = timeouts.find((t) => t.ms === 15000);
  await waveOffTimer.fn();
  const enter = emitted.find((e) => e.channel === 'defense:enter');
  assert.ok(enter, 'entered after the window lapsed');
  assert.match(enter.payload.banner, /TORNADO WARNING, HARRISON COUNTY/);
});

test('a wave-off cancels the pending entry', async () => {
  const { service, emitted, timeouts } = makeHarness({ features: [tornadoFeature()] });
  await service.pollOnce();
  assert.equal(service.waveOff(), true);
  assert.ok(emitted.find((e) => e.channel === 'defense:pending-cancelled'));
  const waveOffTimer = timeouts.find((t) => t.ms === 15000);
  await waveOffTimer.fn();
  assert.equal(emitted.find((e) => e.channel === 'defense:enter'), undefined);
});

test('the poller respects the autoWeather toggle and a missing county', async () => {
  const off = makeHarness({ settings: { defense: { autoWeather: false } }, features: [tornadoFeature()] });
  await off.service.pollOnce();
  assert.equal(off.fetched.length, 0);
  const noZone = makeHarness({ settings: { defense: { countyZone: '' } }, features: [tornadoFeature()] });
  await noZone.service.pollOnce();
  assert.equal(noZone.fetched.length, 0);
});

test('watches never propose entry', async () => {
  const { service, emitted } = makeHarness({ features: [{ properties: { id: 'w1', event: 'Tornado Watch' } }] });
  await service.pollOnce();
  assert.equal(emitted.length, 0);
});

// --- Camera auto entry ---

test('camera alert + armed + night proposes entry', async () => {
  const { service, emitted } = makeHarness();
  await service.handleCameraAlert({ kind: 'motion', name: 'Front Door' });
  const pending = emitted.find((e) => e.channel === 'defense:pending');
  assert.ok(pending);
  assert.equal(pending.payload.reason.kind, 'camera');
  assert.equal(pending.payload.reason.cameraName, 'Front Door');
});

test('the camera trigger respects its toggle, disarmed systems, and daytime', async () => {
  const toggleOff = makeHarness({ settings: { defense: { autoCamera: false } } });
  await toggleOff.service.handleCameraAlert({ kind: 'motion', name: 'Front Door' });
  assert.equal(toggleOff.emitted.length, 0);

  const disarmed = makeHarness();
  disarmed.service.cameras.listSystems = async () => [{ key: 'ring:1', armed: false }];
  await disarmed.service.handleCameraAlert({ kind: 'motion', name: 'Front Door' });
  assert.equal(disarmed.emitted.length, 0);

  const daytime = makeHarness();
  daytime.service.now = () => new Date(2026, 6, 25, 14, 0);
  await daytime.service.handleCameraAlert({ kind: 'motion', name: 'Front Door' });
  assert.equal(daytime.emitted.length, 0);
});

// --- While entered: refresh + exit ---

test('while entered, the refresh interval emits defense:update with fresh headlines', async () => {
  const { service, emitted, intervals } = makeHarness({ features: [tornadoFeature()] });
  await service.requestEnter({ kind: 'manual' });
  const refresh = intervals.find((i) => i.ms === 180000);
  assert.ok(refresh, 'refresh interval registered');
  await refresh.fn();
  const update = emitted.find((e) => e.channel === 'defense:update');
  assert.ok(update);
  assert.equal(update.payload.headlines.length, 2);
  assert.equal(emitted.filter((e) => e.channel === 'defense:enter').length, 1, 'the read is never re-spoken');
});

test('exit emits defense:exit and a fresh entry works afterwards', async () => {
  const { service, emitted } = makeHarness();
  await service.requestEnter({ kind: 'manual' });
  service.exit();
  assert.ok(emitted.find((e) => e.channel === 'defense:exit'));
  assert.equal(service.status().active, false);
  const again = await service.requestEnter({ kind: 'manual' });
  assert.equal(again.ok, true);
});

test('exit while a proposal is pending wave-offs instead', async () => {
  const { service, emitted } = makeHarness({ features: [tornadoFeature()] });
  await service.pollOnce();
  service.exit();
  assert.ok(emitted.find((e) => e.channel === 'defense:pending-cancelled'));
  assert.equal(emitted.find((e) => e.channel === 'defense:exit'), undefined, 'no exit event when never entered');
});

// --- Settings merge: an old settings.json must gain the defense defaults ---

test('mergeSettings fills defense defaults for pre-defense settings files and keeps saved keys', () => {
  const { mergeSettings } = require('../core/config-store');
  const { DEFAULT_SETTINGS } = require('../core/defaults');
  const old = mergeSettings(DEFAULT_SETTINGS, { profileName: 'Adam' });
  assert.deepEqual(old.defense, { countyZone: '', countyName: '', countyState: '', autoWeather: false, autoCamera: false, rssFeeds: [] });
  const partial = mergeSettings(DEFAULT_SETTINGS, { defense: { countyZone: 'MSC047' } });
  assert.equal(partial.defense.countyZone, 'MSC047');
  assert.equal(partial.defense.autoWeather, false, 'sibling defaults survive a partial save');
});

// --- Zones lookup ---

test('listCountyZones asks the NWS for the state and maps id/name', async () => {
  const { service, fetched } = makeHarness();
  const result = await service.listCountyZones('MS');
  assert.equal(result.ok, true);
  assert.deepEqual(result.zones, [{ id: 'MSC047', name: 'Harrison' }]);
  assert.match(fetched[0], /zones\?area=MS&type=county/);
});
