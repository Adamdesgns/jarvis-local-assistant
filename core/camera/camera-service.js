const crypto = require('node:crypto');
const { RtspDriver } = require('./drivers/rtsp-driver');
const { BlinkDriver } = require('./drivers/blink-driver');
const { RingDriver } = require('./drivers/ring-driver');
const { NestDriver } = require('./drivers/nest-driver');

const ALERT_DEDUPE_MS = 60000;

function streamName(key) { return `cam_${key.replace(/[^a-zA-Z0-9]+/g, '_')}`; }

// Orchestrates accounts, drivers, snapshots, and live view sessions.
// Brand code stays in drivers; secrets stay in config secrets storage.
class CameraService {
  constructor({ config, emit, log, go2rtc, driverClasses, notify, notifyGate }) {
    this.config = config;
    this.emit = emit || (() => {});
    this.log = log || { write: () => {} };
    this.notify = notify || (() => {});
    this.notifyGate = notifyGate || (() => true); // autonomy may veto the Windows notification only
    this.go2rtc = go2rtc;
    this.driverClasses = driverClasses || { rtsp: RtspDriver, blink: BlinkDriver, ring: RingDriver, nest: NestDriver };
    this.drivers = new Map(); // accountId -> driver
    this.lastAutoSnapshot = new Map(); // camera key -> timestamp
    this.liveViews = new Set(); // go2rtc stream names
    this.sdpViews = new Map(); // camera key -> {driver, cameraId, session}
    this.lastAlert = new Map(); // camera key -> timestamp
    this.describeFrame = null; // Phase 4 assigns: async (jpegBase64, context) => text|null
  }

  async init() {
    for (const account of this.config.getSettings().cameraAccounts || []) {
      await this.#instantiate(account);
    }
  }

  #secretKey(accountId) { return `cameraAccount:${accountId}`; }

  #readSecrets(accountId) {
    try { return JSON.parse(this.config.getSecret(this.#secretKey(accountId)) || '{}'); }
    catch { return {}; }
  }

  async #instantiate(account) {
    const DriverClass = this.driverClasses[account.brand];
    if (!DriverClass) return;
    const driver = new DriverClass({
      account,
      secrets: this.#readSecrets(account.id),
      persistSecrets: (secrets) => this.config.setSecret(this.#secretKey(account.id), JSON.stringify(secrets || {}))
    });
    driver.on('status', () => this.emit('cameras:status', this.getStatus()));
    driver.on('motion', (event) => this.#handleAlert(account.id, 'motion', event));
    driver.on('doorbell', (event) => this.#handleAlert(account.id, 'doorbell', event));
    this.drivers.set(account.id, driver);
    try { await driver.connect(); }
    catch (error) { driver.setState('error', `Could not connect: ${error.message}`); }
  }

  async #handleAlert(accountId, kind, event) {
    try {
      const key = `${accountId}:${event.cameraId}`;
      const last = this.lastAlert.get(key) || 0;
      if (Date.now() - last < ALERT_DEDUPE_MS) return;
      this.lastAlert.set(key, Date.now());
      const name = event.name || 'Camera';
      let body = kind === 'doorbell' ? `${name}: someone pressed the doorbell.` : `Motion at ${name}.`;
      const shot = await this.getSnapshot(key, { manual: false });
      if (shot.ok && typeof this.describeFrame === 'function') {
        try {
          const description = await this.describeFrame(shot.jpegBase64, { name, kind });
          if (description) body = `${name}: ${description}`;
        } catch {}
      }
      let showNotification = true;
      try { showNotification = this.notifyGate({ kind, name, body }) !== false; } catch {}
      if (showNotification) this.notify(`JARVIS · ${kind === 'doorbell' ? 'DOORBELL' : 'MOTION'}`, body);
      this.log.write({ type: 'camera-alert', command: `${kind} at ${name}`, response: body, source: 'cameras' });
      this.emit('cameras:alert', { key, kind, name, body, jpegBase64: shot.ok ? shot.jpegBase64 : undefined, at: new Date().toISOString() });
    } catch {}
  }

  listAccounts() {
    return (this.config.getSettings().cameraAccounts || []).map((account) => ({
      ...account,
      status: this.drivers.get(account.id)?.status() || { state: 'disconnected', message: '' }
    }));
  }

  async addRtspAccount({ name, cameras }) {
    const cleanName = String(name || '').trim() || 'My cameras';
    const list = (cameras || [])
      .map((camera) => ({ id: crypto.randomUUID().slice(0, 8), name: String(camera.name || '').trim() || 'Camera', url: String(camera.url || '').trim() }))
      .filter((camera) => /^rtsps?:\/\//i.test(camera.url));
    if (!list.length) return { ok: false, message: 'Add at least one camera with an address that starts with rtsp://' };
    const account = { id: crypto.randomUUID().slice(0, 8), brand: 'rtsp', name: cleanName };
    this.config.setSecret(this.#secretKey(account.id), JSON.stringify({ cameras: list }));
    const accounts = [...(this.config.getSettings().cameraAccounts || []), account];
    this.config.updateSettings({ cameraAccounts: accounts });
    await this.#instantiate(account);
    this.emit('cameras:changed', {});
    this.log.write({ type: 'camera', command: 'add cameras', response: `Added ${list.length} local camera${list.length === 1 ? '' : 's'} to "${cleanName}".`, source: 'cameras' });
    return { ok: true, message: `Added ${list.length} camera${list.length === 1 ? '' : 's'}.` };
  }

  async addBlinkAccount({ email, password }) {
    const cleanEmail = String(email || '').trim();
    const cleanPassword = String(password || '');
    if (!cleanEmail || !cleanPassword) return { ok: false, message: 'Enter your Blink email and password first.' };
    const account = { id: crypto.randomUUID().slice(0, 8), brand: 'blink', name: cleanEmail };
    this.config.setSecret(this.#secretKey(account.id), JSON.stringify({
      email: cleanEmail, password: cleanPassword, uniqueId: crypto.randomUUID()
    }));
    const accounts = [...(this.config.getSettings().cameraAccounts || []), account];
    this.config.updateSettings({ cameraAccounts: accounts });
    await this.#instantiate(account);
    const driver = this.drivers.get(account.id);
    const status = driver?.status() || { state: 'error', message: 'The Blink connection could not start.' };
    if (status.state === 'error') {
      await this.removeAccount(account.id);
      return { ok: false, message: status.message };
    }
    this.emit('cameras:changed', {});
    this.log.write({ type: 'camera', command: 'add blink account', response: `Connected Blink account ${cleanEmail}.`, source: 'cameras' });
    return { ok: true, needsPin: status.state === 'verify', accountId: account.id, message: status.message || 'Blink is connected.' };
  }

  async submitBlinkPin(accountId, pin) {
    const driver = this.drivers.get(accountId);
    if (!driver || typeof driver.submitPin !== 'function') return { ok: false, message: 'That Blink account is no longer set up.' };
    const result = await driver.submitPin(pin);
    if (result.ok) this.emit('cameras:changed', {});
    return result;
  }

  // Ring 2FA happens before the account exists: sign-in either yields a
  // refresh token immediately or asks for the code Ring just sent.
  async addRingAccount({ email, password, code }, loginFn) {
    const login = loginFn || require('./ring-session').ringLogin;
    const cleanEmail = String(email || '').trim();
    if (!cleanEmail || !String(password || '')) return { ok: false, message: 'Enter your Ring email and password first.' };
    try {
      const result = await login({ email: cleanEmail, password: String(password), code });
      if (result.needs2fa) return { ok: true, needs2fa: true, message: result.prompt || 'Enter the code Ring sent you.' };
      const account = { id: crypto.randomUUID().slice(0, 8), brand: 'ring', name: cleanEmail };
      this.config.setSecret(this.#secretKey(account.id), JSON.stringify({ email: cleanEmail, refreshToken: result.refreshToken }));
      const accounts = [...(this.config.getSettings().cameraAccounts || []), account];
      this.config.updateSettings({ cameraAccounts: accounts });
      await this.#instantiate(account);
      const status = this.drivers.get(account.id)?.status();
      if (status?.state === 'error') {
        await this.removeAccount(account.id);
        return { ok: false, message: status.message };
      }
      this.emit('cameras:changed', {});
      this.log.write({ type: 'camera', command: 'add ring account', response: `Connected Ring account ${cleanEmail}.`, source: 'cameras' });
      return { ok: true, message: 'Ring is connected.' };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  }

  // Nest "Advanced setup": user-supplied Device Access project + OAuth
  // client; the browser sign-in runs through a one-shot loopback server.
  async addNestAccount({ projectId, clientId, clientSecret }, { openExternal, oauthFlow } = {}) {
    const project = String(projectId || '').trim();
    const id = String(clientId || '').trim();
    const secret = String(clientSecret || '').trim();
    if (!project || !id || !secret) {
      return { ok: false, message: 'Fill in all three Google values first — project ID, client ID, and client secret.' };
    }
    try {
      const flow = oauthFlow || ((args) => require('./nest-oauth').runOauthFlow({ ...args, openExternal }));
      const token = await flow({ projectId: project, clientId: id, clientSecret: secret });
      const account = { id: crypto.randomUUID().slice(0, 8), brand: 'nest', name: `Nest · ${project.slice(0, 12)}` };
      this.config.setSecret(this.#secretKey(account.id), JSON.stringify({
        projectId: project, clientId: id, clientSecret: secret, ...token
      }));
      const accounts = [...(this.config.getSettings().cameraAccounts || []), account];
      this.config.updateSettings({ cameraAccounts: accounts });
      await this.#instantiate(account);
      const status = this.drivers.get(account.id)?.status();
      if (status?.state === 'error') {
        await this.removeAccount(account.id);
        return { ok: false, message: status.message };
      }
      this.emit('cameras:changed', {});
      this.log.write({ type: 'camera', command: 'add nest account', response: `Connected Nest project ${project}.`, source: 'cameras' });
      return { ok: true, message: 'Nest is connected. Nest cameras are live-view only and do not send motion alerts yet.' };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  }

  async listSystems() {
    const systems = [];
    for (const [accountId, driver] of this.drivers) {
      try {
        for (const system of await driver.listSystems()) {
          systems.push({ ...system, accountId, key: `${accountId}:${system.id}` });
        }
      } catch {}
    }
    return systems;
  }

  async setArmed(systemKey, armed) {
    const [accountId, systemId] = String(systemKey || '').split(':');
    const driver = this.drivers.get(accountId);
    if (!driver) return { ok: false, message: 'That system is no longer set up.' };
    try {
      // Pass the id through as-is. Blink network ids are numeric but Ring
      // location ids are non-numeric strings — Number() would make them NaN
      // and Ring arm/disarm would never find the location.
      await driver.setArmed(systemId, Boolean(armed));
      this.emit('cameras:changed', {});
      this.log.write({ type: 'camera', command: armed ? 'camera arm' : 'camera disarm', response: `${armed ? 'Armed' : 'Disarmed'} system ${systemKey}.`, source: 'cameras' });
      return { ok: true, message: armed ? 'System armed.' : 'System disarmed.' };
    } catch (error) {
      return { ok: false, message: `Could not change arming: ${error.message}` };
    }
  }

  async removeAccount(accountId) {
    const driver = this.drivers.get(accountId);
    if (driver) { try { await driver.disconnect(); } catch {} this.drivers.delete(accountId); }
    this.config.setSecret(this.#secretKey(accountId), '');
    const accounts = (this.config.getSettings().cameraAccounts || []).filter((account) => account.id !== accountId);
    this.config.updateSettings({ cameraAccounts: accounts });
    this.emit('cameras:changed', {});
    return { ok: true };
  }

  async listCameras() {
    const cameras = [];
    for (const [accountId, driver] of this.drivers) {
      try {
        for (const camera of await driver.listCameras()) {
          cameras.push({ ...camera, accountId, key: `${accountId}:${camera.id}` });
        }
      } catch {}
    }
    return cameras;
  }

  async #resolve(key) {
    const [accountId, cameraId] = String(key || '').split(':');
    const driver = this.drivers.get(accountId);
    if (!driver) return {};
    return { driver, accountId, cameraId };
  }

  async getSnapshot(key, { manual = false } = {}) {
    const { driver, cameraId } = await this.#resolve(key);
    if (!driver) return { ok: false, message: 'That camera is no longer set up.' };
    if (!manual && driver.snapshotCooldownMs > 0) {
      const last = this.lastAutoSnapshot.get(key) || 0;
      if (Date.now() - last < driver.snapshotCooldownMs) {
        return { ok: false, message: 'Skipped an automatic refresh to protect the camera battery — a recent picture is shown.' };
      }
    }
    try {
      let jpeg;
      try {
        jpeg = await driver.getSnapshot(cameraId);
      } catch (error) {
        if (error.code !== 'NOT_SUPPORTED') throw error;
        const source = await driver.getStreamSource(cameraId);
        if (!source) return { ok: false, message: 'This camera cannot take pictures.' };
        const started = await this.go2rtc.start();
        if (!started.ok) return { ok: false, message: started.message };
        await this.go2rtc.setStream(streamName(key), source);
        jpeg = await this.go2rtc.snapshot(streamName(key));
      }
      if (!manual) this.lastAutoSnapshot.set(key, Date.now());
      this.log.write({ type: 'camera', command: manual ? 'camera snapshot' : 'camera auto refresh', response: `Took a picture from camera ${key}.`, source: 'cameras' });
      return { ok: true, jpegBase64: jpeg.toString('base64'), takenAt: new Date().toISOString() };
    } catch (error) {
      return { ok: false, message: `Could not get a picture: ${error.message}` };
    }
  }

  async openLiveView(key) {
    const { driver, cameraId } = await this.#resolve(key);
    if (!driver) return { ok: false, message: 'That camera is no longer set up.' };
    try {
      // Drivers with their own WebRTC sessions (Ring) bridge the renderer's
      // offer directly — no local streaming helper involved.
      if (typeof driver.createSdpSession === 'function') {
        this.sdpViews.set(key, { driver, cameraId, session: null });
        this.log.write({ type: 'camera', command: 'live view', response: `Opened live view for camera ${key}.`, source: 'cameras' });
        return { ok: true, mode: 'sdp-bridge', key };
      }
      const source = await driver.getStreamSource(cameraId);
      if (!source) return { ok: false, message: 'This camera does not support live view — snapshots only.' };
      const started = await this.go2rtc.start();
      if (!started.ok) return { ok: false, message: started.message };
      const name = streamName(key);
      await this.go2rtc.setStream(name, source);
      this.liveViews.add(name);
      this.log.write({ type: 'camera', command: 'live view', response: `Opened live view for camera ${key}.`, source: 'cameras' });
      return { ok: true, mode: 'whep', key, whepUrl: this.go2rtc.whepUrl(name) };
    } catch (error) {
      return { ok: false, message: `Could not start live view: ${error.message}` };
    }
  }

  async answerLiveView(key, offerSdp) {
    const view = this.sdpViews.get(key);
    if (!view) return { ok: false, message: 'Start live view first.' };
    try {
      const session = await view.driver.createSdpSession(view.cameraId, offerSdp);
      view.session = session;
      return { ok: true, answerSdp: session.answerSdp };
    } catch (error) {
      this.sdpViews.delete(key);
      return { ok: false, message: `Could not start live view: ${error.message}` };
    }
  }

  async closeLiveView(key) {
    const view = this.sdpViews.get(key);
    if (view) {
      this.sdpViews.delete(key);
      try { view.session?.close(); } catch {}
      return { ok: true };
    }
    const name = streamName(key);
    if (!this.liveViews.has(name)) return { ok: true };
    this.liveViews.delete(name);
    try { await this.go2rtc.removeStream(name); } catch {}
    return { ok: true };
  }

  getStatus() {
    return { helper: this.go2rtc.getStatus(), accounts: this.listAccounts() };
  }

  async shutdown() {
    for (const [, view] of this.sdpViews) { try { view.session?.close(); } catch {} }
    this.sdpViews.clear();
    for (const name of this.liveViews) { try { await this.go2rtc.removeStream(name); } catch {} }
    this.liveViews.clear();
    for (const [, driver] of this.drivers) { try { await driver.disconnect(); } catch {} }
    await this.go2rtc.stop();
  }
}

module.exports = { CameraService, streamName };
