const { CameraDriver } = require('../driver-interface');
const { BlinkClient } = require('../blink-client');

const HOMESCREEN_CACHE_MS = 30000;

// Blink (Amazon) cloud cameras. Unofficial API: every failure surfaces as a
// visible status, and snapshots are rate-limited upstream (camera-service)
// because each fresh picture wakes a battery-powered camera.
class BlinkDriver extends CameraDriver {
  constructor(options) {
    super(options);
    this.client = (options.clientFactory || (() => new BlinkClient({})))();
    this.snapshotCooldownMs = 600000; // 10 minutes between automatic refreshes
    this.freshWaitMs = 3000; // wait for the camera to take the new picture
    this.homescreenCache = null;
    this.homescreenAt = 0;
  }

  get brand() { return 'blink'; }

  #session() {
    const { token, accountId, clientId, tier } = this.secrets;
    return { token, accountId, clientId, tier };
  }

  async connect() {
    try {
      if (this.secrets.token) {
        try {
          await this.#homescreen(true);
          this.setState('connected');
          return;
        } catch {
          // Stored session expired — fall through to a fresh sign-in.
        }
      }
      const session = await this.client.login({
        email: this.secrets.email,
        password: this.secrets.password,
        uniqueId: this.secrets.uniqueId
      });
      this.secrets = { ...this.secrets, ...session };
      delete this.secrets.verificationRequired;
      this.persistSecrets(this.secrets);
      if (session.verificationRequired) {
        this.setState('verify', 'Enter the PIN Blink emailed you.');
        return;
      }
      await this.#homescreen(true);
      this.setState('connected');
    } catch (error) {
      this.setState('error', `Blink sign-in failed: ${error.message}`);
    }
  }

  async submitPin(pin) {
    try {
      const result = await this.client.verifyPin(this.#session(), pin);
      if (!result.ok) {
        this.setState('verify', result.message || 'That PIN was not accepted. Check the newest email from Blink.');
        return { ok: false, message: this.message };
      }
      await this.#homescreen(true);
      this.setState('connected');
      return { ok: true, message: 'Blink is connected.' };
    } catch (error) {
      this.setState('verify', `The PIN could not be checked: ${error.message}`);
      return { ok: false, message: this.message };
    }
  }

  async #homescreen(force = false) {
    if (!force && this.homescreenCache && Date.now() - this.homescreenAt < HOMESCREEN_CACHE_MS) {
      return this.homescreenCache;
    }
    this.homescreenCache = await this.client.homescreen(this.#session());
    this.homescreenAt = Date.now();
    return this.homescreenCache;
  }

  #allCameras(home) {
    const tag = (list, kind) => (list || []).map((camera) => ({ ...camera, kind }));
    return [
      ...tag(home.cameras, 'camera'),
      ...tag(home.owls, 'owl'),
      ...tag(home.doorbells, 'doorbell')
    ];
  }

  async listCameras() {
    if (this.state !== 'connected') return [];
    const home = await this.#homescreen();
    return this.#allCameras(home).map((camera) => ({
      id: String(camera.id),
      name: camera.name,
      brand: 'blink',
      canStream: false,
      canArm: false,
      networkId: camera.network_id,
      kind: camera.kind
    }));
  }

  async listSystems() {
    if (this.state !== 'connected') return [];
    const home = await this.#homescreen();
    return (home.networks || []).map((network) => ({
      id: network.id, name: network.name, armed: Boolean(network.armed), canArm: true
    }));
  }

  async getSnapshot(cameraId) {
    const home = await this.#homescreen();
    const camera = this.#allCameras(home).find((item) => String(item.id) === String(cameraId));
    if (!camera) throw new Error('That Blink camera was not found on the account.');
    let thumbnail = camera.thumbnail;
    try {
      await this.client.requestThumbnail(this.#session(), camera.network_id, camera.id, camera.kind);
      await new Promise((resolve) => setTimeout(resolve, this.freshWaitMs));
      const fresh = await this.#homescreen(true);
      const updated = this.#allCameras(fresh).find((item) => String(item.id) === String(cameraId));
      if (updated?.thumbnail) thumbnail = updated.thumbnail;
    } catch {
      // Busy or rate-limited — the last known picture is still useful.
    }
    if (!thumbnail) throw new Error('Blink has no picture for this camera yet.');
    return this.client.getImage(this.#session(), thumbnail);
  }

  async setArmed(networkId, armed) {
    await this.client.setArmed(this.#session(), networkId, armed);
    await this.#homescreen(true);
  }
}

module.exports = { BlinkDriver };
