const test = require('node:test');
const assert = require('node:assert/strict');
const { LicenseService, cleanLicenseKey } = require('../core/license-service');

// In-memory stand-in for ConfigStore: just the four methods the service uses.
function fakeConfig({ license, secret } = {}) {
  const store = {
    settings: { license: license || { status: 'none' } },
    secrets: { licenseKey: secret || '' },
    getSettings() { return JSON.parse(JSON.stringify(this.settings)); },
    setLicenseState(state) { this.settings.license = { ...state }; },
    setSecret(name, value) { if (value) this.secrets[name] = value; else delete this.secrets[name]; },
    getSecret(name) { return this.secrets[name] || ''; }
  };
  return store;
}

function jsonResponse(payload) {
  return { ok: true, json: async () => payload };
}

const ACTIVATED = {
  activated: true,
  error: null,
  license_key: { status: 'active' },
  instance: { id: 'inst-123' },
  meta: { product_name: 'JARVIS Pro', customer_name: 'Adam' }
};

test('cleanLicenseKey strips whitespace and stray quotes from email copy-paste', () => {
  assert.equal(cleanLicenseKey('  abc-123  '), 'abc-123');
  assert.equal(cleanLicenseKey('"abc-123"'), 'abc-123');
  assert.equal(cleanLicenseKey('\'abc-123\' '), 'abc-123');
  assert.equal(cleanLicenseKey(''), '');
  assert.equal(cleanLicenseKey(null), '');
});

test('activate success stores the key and an active license state', async () => {
  const config = fakeConfig();
  let sentBody = '';
  const service = new LicenseService({
    config,
    instanceName: 'Test PC',
    fetchImpl: async (_url, options) => { sentBody = options.body; return jsonResponse(ACTIVATED); }
  });
  const result = await service.activate(' "key-1" ');
  assert.equal(result.ok, true);
  assert.match(result.message, /Adam/);
  assert.equal(config.getSecret('licenseKey'), 'key-1', 'the trimmed key must be stored');
  assert.match(sentBody, /license_key=key-1/, 'the trimmed key must be what goes to Lemon Squeezy');
  assert.match(sentBody, /instance_name=Test\+PC/);
  const state = config.getSettings().license;
  assert.equal(state.status, 'active');
  assert.equal(state.instanceId, 'inst-123');
  assert.equal(state.productName, 'JARVIS Pro');
});

test('activate with an invalid key stores nothing', async () => {
  const config = fakeConfig();
  const service = new LicenseService({
    config,
    fetchImpl: async () => jsonResponse({ activated: false, error: 'license_key not found' })
  });
  const result = await service.activate('bad-key');
  assert.equal(result.ok, false);
  assert.equal(config.getSecret('licenseKey'), '');
  assert.equal(config.getSettings().license.status, 'none');
});

test('activate at the PC limit explains how to free a seat', async () => {
  const service = new LicenseService({
    config: fakeConfig(),
    fetchImpl: async () => jsonResponse({ activated: false, error: 'This license key has reached the activation limit.' })
  });
  const result = await service.activate('key-1');
  assert.equal(result.ok, false);
  assert.match(result.message, /DEACTIVATE/i);
});

test('activate network failure is honest and stores nothing', async () => {
  const config = fakeConfig();
  const service = new LicenseService({ config, fetchImpl: async () => { throw new Error('offline'); } });
  const result = await service.activate('key-1');
  assert.equal(result.ok, false);
  assert.equal(result.offline, true);
  assert.equal(config.getSecret('licenseKey'), '');
});

// Mutation guard: if someone removes the AbortController timeout, this fetch
// never settles and the test times out instead of passing.
test('a hanging fetch is cut off by the timeout', async () => {
  const config = fakeConfig();
  const service = new LicenseService({
    config,
    timeoutMs: 20,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    })
  });
  const result = await service.activate('key-1');
  assert.equal(result.offline, true);
  assert.equal(config.getSecret('licenseKey'), '');
});

test('validate never bricks offline: network failure leaves the license active', async () => {
  const config = fakeConfig({ license: { status: 'active', instanceId: 'inst-123' }, secret: 'key-1' });
  const service = new LicenseService({ config, fetchImpl: async () => { throw new Error('no internet'); } });
  const result = await service.validate();
  assert.equal(result.ok, false);
  assert.equal(result.offline, true);
  assert.equal(config.getSettings().license.status, 'active', 'offline must NEVER downgrade a license');
});

test('validate downgrades only on an explicit not-valid answer', async () => {
  const config = fakeConfig({ license: { status: 'active', instanceId: 'inst-123' }, secret: 'key-1' });
  const service = new LicenseService({
    config,
    fetchImpl: async () => jsonResponse({ valid: false, error: 'This license key is disabled.', license_key: { status: 'disabled' } })
  });
  const result = await service.validate();
  assert.equal(result.ok, false);
  assert.equal(config.getSettings().license.status, 'disabled');
});

test('validate confirms a good key and stamps lastValidatedAt', async () => {
  const config = fakeConfig({ license: { status: 'active', instanceId: 'inst-123', lastValidatedAt: '' }, secret: 'key-1' });
  const service = new LicenseService({ config, fetchImpl: async () => jsonResponse({ valid: true, license_key: { status: 'active' } }) });
  const result = await service.validate();
  assert.equal(result.ok, true);
  assert.equal(config.getSettings().license.status, 'active');
  assert.ok(config.getSettings().license.lastValidatedAt);
});

test('deactivate success clears the key and frees the seat', async () => {
  const config = fakeConfig({ license: { status: 'active', instanceId: 'inst-123' }, secret: 'key-1' });
  const service = new LicenseService({ config, fetchImpl: async () => jsonResponse({ deactivated: true }) });
  const result = await service.deactivate();
  assert.equal(result.ok, true);
  assert.equal(config.getSecret('licenseKey'), '');
  assert.equal(config.getSettings().license.status, 'none');
});

test('deactivate network failure keeps the license — no silently stranded seat', async () => {
  const config = fakeConfig({ license: { status: 'active', instanceId: 'inst-123' }, secret: 'key-1' });
  const service = new LicenseService({ config, fetchImpl: async () => { throw new Error('offline'); } });
  const result = await service.deactivate();
  assert.equal(result.ok, false);
  assert.equal(result.offline, true);
  assert.equal(config.getSecret('licenseKey'), 'key-1');
  assert.equal(config.getSettings().license.status, 'active');
});

// The privacy promise in executable form: constructing the service must make
// no network call. A fetchImpl that throws synchronously proves it.
test('construction never touches the network — no startup call, no timers', () => {
  const service = new LicenseService({
    config: fakeConfig(),
    fetchImpl: () => { throw new Error('the service called fetch without a button press'); }
  });
  assert.ok(service, 'constructing with a throwing fetch must be safe');
});
