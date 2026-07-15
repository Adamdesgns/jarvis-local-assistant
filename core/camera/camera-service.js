const crypto = require('node:crypto');
const { RtspDriver } = require('./drivers/rtsp-driver');

function streamName(key) { return `cam_${key.replace(/[^a-zA-Z0-9]+/g, '_')}`; }

// Orchestrates accounts, drivers, snapshots, and live view sessions.
// Brand code stays in drivers; secrets stay in config secrets storage.
class CameraService {
  constructor({ config, emit, log, go2rtc, driverClasses }) {
    this.config = config;
    this.emit = emit || (() => {});
    this.log = log || { write: () => {} };
    this.go2rtc = go2rtc;
    this.driverClasses = driverClasses || { rtsp: RtspDriver };
    this.drivers = new Map(); // accountId -> driver
    this.lastAutoSnapshot = new Map(); // camera key -> timestamp
    this.liveViews = new Set(); // stream names
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
    this.drivers.set(account.id, driver);
    try { await driver.connect(); }
    catch (error) { driver.setState('error', `Could not connect: ${error.message}`); }
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
      const source = await driver.getStreamSource(cameraId);
      if (!source) return { ok: false, message: 'This camera does not support live view — snapshots only.' };
      const started = await this.go2rtc.start();
      if (!started.ok) return { ok: false, message: started.message };
      const name = streamName(key);
      await this.go2rtc.setStream(name, source);
      this.liveViews.add(name);
      this.log.write({ type: 'camera', command: 'live view', response: `Opened live view for camera ${key}.`, source: 'cameras' });
      return { ok: true, whepUrl: this.go2rtc.whepUrl(name) };
    } catch (error) {
      return { ok: false, message: `Could not start live view: ${error.message}` };
    }
  }

  async closeLiveView(key) {
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
    for (const name of this.liveViews) { try { await this.go2rtc.removeStream(name); } catch {} }
    this.liveViews.clear();
    await this.go2rtc.stop();
  }
}

module.exports = { CameraService, streamName };
