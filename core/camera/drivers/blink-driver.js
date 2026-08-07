const { CameraDriver } = require('../driver-interface');
const { BlinkClient, REFRESH_MARGIN_MS } = require('../blink-client');
const { BlinkLiveStream, tlsConnect } = require('../blink-livestream');

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
    // Injectable so live view is testable without a real TLS socket.
    this.LiveStream = options.LiveStream || BlinkLiveStream;
    this.connectLiveStream = options.connectLiveStream || tlsConnect;
    this.liveStreams = new Map();
  }

  get brand() { return 'blink'; }

  // Blink rejects hardware ids that aren't UUIDs. Accounts linked before the
  // OAuth switch stored theirs as uniqueId.
  #hardwareId() {
    const id = this.secrets.hardwareId || this.secrets.uniqueId || '';
    return String(id).toUpperCase();
  }

  #store(session) {
    this.secrets = { ...this.secrets, ...session, hardwareId: this.#hardwareId() };
    delete this.secrets.verificationRequired;
    this.persistSecrets(this.secrets);
  }

  // Access tokens are short-lived, so every authenticated call goes through
  // here and renews silently rather than making Adam sign in again.
  async #session() {
    const { token, refreshToken, expiresAt, accountId, tier } = this.secrets;
    const stale = !token || (expiresAt && Date.now() > expiresAt - REFRESH_MARGIN_MS);
    if (stale && refreshToken) {
      this.#store(await this.client.refreshSession({ refreshToken, hardwareId: this.#hardwareId() }));
      const renewed = this.secrets;
      return { token: renewed.token, accountId: renewed.accountId, tier: renewed.tier };
    }
    return { token, accountId, tier };
  }

  // The interactive sign-in happens once, in camera-service, before this driver
  // exists. From here on the stored refresh token is the whole story: there is
  // no password to fall back on, so a dead token means signing in again.
  async connect() {
    try {
      if (!this.secrets.refreshToken) {
        this.setState('error', 'Blink needs signing in again — open Settings → CAMERAS → BLINK.');
        return;
      }
      this.#store(await this.client.refreshSession({
        refreshToken: this.secrets.refreshToken,
        hardwareId: this.#hardwareId()
      }));
      await this.#homescreen(true);
      this.setState('connected');
    } catch (error) {
      this.setState('error', `Blink sign-in failed: ${error.message}`);
    }
  }

  async #homescreen(force = false) {
    if (!force && this.homescreenCache && Date.now() - this.homescreenAt < HOMESCREEN_CACHE_MS) {
      return this.homescreenCache;
    }
    this.homescreenCache = await this.client.homescreen(await this.#session());
    this.homescreenAt = Date.now();
    return this.homescreenCache;
  }

  // Blink's homescreen lists some devices TWICE — a Mini shows up in `cameras`
  // AND in `owls`, a doorbell in `cameras` AND `doorbells`, each with its own id
  // in its own id space. Taken at face value that showed Adam 8 tiles for 4
  // cameras. De-duplicating on `id` cannot work (the two entries have different
  // ids); the serial is the physical device, so that is the key.
  //
  // When a device appears twice, the specific kind wins: the thumbnail and
  // liveview endpoints for owls and doorbells differ from the generic camera
  // ones, and the specific pair is the one Blink's own app uses for that device.
  #allCameras(home) {
    const tag = (list, kind) => (list || []).map((camera) => ({ ...camera, kind }));
    // Listing order is preserved so a de-duplication fix cannot quietly
    // rearrange a camera grid someone is used to.
    const all = [
      ...tag(home.cameras, 'camera'),
      ...tag(home.owls, 'owl'),
      ...tag(home.doorbells, 'doorbell')
    ];
    // No serial (older firmware, or a shape Blink changes later) means we cannot
    // prove two entries are the same device, so each is kept — hiding a real
    // camera would be worse than showing a duplicate.
    const identity = (camera) => (camera.serial ? `serial:${camera.serial}` : `${camera.kind}:${camera.id}`);
    const rank = { owl: 0, doorbell: 1, camera: 2 };
    const winners = new Map();
    for (const camera of all) {
      const key = identity(camera);
      const held = winners.get(key);
      if (!held || rank[camera.kind] < rank[held.kind]) winners.set(key, camera);
    }
    const emitted = new Set();
    return all.filter((camera) => {
      const key = identity(camera);
      if (emitted.has(key) || winners.get(key) !== camera) return false;
      emitted.add(key);
      return true;
    });
  }

  async listCameras() {
    if (this.state !== 'connected') return [];
    const home = await this.#homescreen();
    return this.#allCameras(home).map((camera) => ({
      id: String(camera.id),
      name: camera.name,
      brand: 'blink',
      canStream: true,
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
      await this.client.requestThumbnail(await this.#session(), camera.network_id, camera.id, camera.kind);
      await new Promise((resolve) => setTimeout(resolve, this.freshWaitMs));
      const fresh = await this.#homescreen(true);
      const updated = this.#allCameras(fresh).find((item) => String(item.id) === String(cameraId));
      if (updated?.thumbnail) thumbnail = updated.thumbnail;
    } catch {
      // Busy or rate-limited — the last known picture is still useful.
    }
    if (!thumbnail) throw new Error('Blink has no picture for this camera yet.');
    return this.client.getImage(await this.#session(), thumbnail);
  }

  // Blink live view is MPEG-TS over Amazon's own protocol, not RTSP, so it
  // cannot go through go2rtc or WebRTC like the other brands. The camera service
  // hands these chunks to the renderer, which plays them via MediaSource.
  async startLiveStream(cameraId, { onVideo, onEnd } = {}) {
    const home = await this.#homescreen();
    const camera = this.#allCameras(home).find((item) => String(item.id) === String(cameraId));
    if (!camera) throw new Error('That Blink camera was not found on the account.');
    const session = await this.#session();
    const view = await this.client.liveView(session, camera.network_id, camera.id, camera.kind);

    const stream = new this.LiveStream({
      connect: this.connectLiveStream,
      // Blink authenticates the stream socket with the camera's own serial.
      serial: camera.serial,
      server: view.server,
      commandId: view.commandId,
      pollingInterval: view.pollingInterval,
      commands: {
        status: (id) => this.client.commandStatus(session, camera.network_id, id),
        done: (id) => this.client.commandDone(session, camera.network_id, id)
      },
      onVideo,
      onEnd
    });
    await stream.start();
    this.liveStreams.set(String(cameraId), stream);
    return stream;
  }

  stopLiveStream(cameraId) {
    const stream = this.liveStreams.get(String(cameraId));
    if (!stream) return;
    this.liveStreams.delete(String(cameraId));
    stream.stop();
  }

  async disconnect() {
    for (const [, stream] of this.liveStreams) { try { stream.stop(); } catch { /* already gone */ } }
    this.liveStreams.clear();
    if (typeof super.disconnect === 'function') await super.disconnect();
  }

  async setArmed(networkId, armed) {
    await this.client.setArmed(await this.#session(), networkId, armed);
    await this.#homescreen(true);
  }
}

module.exports = { BlinkDriver };
