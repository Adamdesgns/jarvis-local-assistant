const { CameraDriver } = require('../driver-interface');
const { createRingApi } = require('../ring-session');

// Ring cloud cameras and doorbells. Auth happens at add-time (email/password
// + 2FA code produce a refresh token); this driver requires that token and
// keeps it fresh — Ring rotates it on every connection.
class RingDriver extends CameraDriver {
  constructor(options) {
    super(options);
    this.apiFactory = options.apiFactory || createRingApi;
    this.api = null;
    this.cameras = [];
    this.locations = [];
    this.subscriptions = [];
    this.sdpSessions = new Map(); // cameraId -> session
  }

  get brand() { return 'ring'; }

  async connect() {
    if (!this.secrets.refreshToken) {
      this.setState('error', 'Ring needs you to sign in again from the ＋ ADD screen.');
      return;
    }
    try {
      this.api = this.apiFactory({
        refreshToken: this.secrets.refreshToken,
        onTokenUpdate: (newToken) => {
          this.secrets = { ...this.secrets, refreshToken: newToken };
          this.persistSecrets(this.secrets);
        }
      });
      this.cameras = await this.api.getCameras();
      this.locations = await this.api.getLocations();
      for (const camera of this.cameras) {
        const forward = (kind) => () => this.emit(kind, { cameraId: String(camera.id), name: camera.name });
        if (camera.onMotionDetected?.subscribe) this.subscriptions.push(camera.onMotionDetected.subscribe(forward('motion')));
        if (camera.onDoorbellPressed?.subscribe) this.subscriptions.push(camera.onDoorbellPressed.subscribe(forward('doorbell')));
      }
      this.setState('connected');
    } catch (error) {
      this.setState('error', `Ring connection failed: ${error.message}`);
    }
  }

  async disconnect() {
    for (const subscription of this.subscriptions) { try { subscription.unsubscribe(); } catch {} }
    this.subscriptions = [];
    for (const [, session] of this.sdpSessions) { try { session.end(); } catch {} }
    this.sdpSessions.clear();
    try { this.api?.disconnect(); } catch {}
    this.api = null;
    this.setState('disconnected');
  }

  #camera(cameraId) {
    return this.cameras.find((camera) => String(camera.id) === String(cameraId));
  }

  async listCameras() {
    if (this.state !== 'connected') return [];
    return this.cameras.map((camera) => ({
      id: String(camera.id),
      name: camera.name,
      brand: 'ring',
      canStream: true,
      canArm: false,
      kind: camera.isDoorbot ? 'doorbell' : 'camera'
    }));
  }

  async listSystems() {
    if (this.state !== 'connected') return [];
    const systems = [];
    for (const location of this.locations) {
      let armed = false;
      try { armed = (await location.getLocationMode())?.mode !== 'disarmed'; } catch {}
      systems.push({
        id: String(location.id),
        name: location.name,
        armed,
        canArm: location.supportsLocationModeSwitching !== false
      });
    }
    return systems;
  }

  async getSnapshot(cameraId) {
    const camera = this.#camera(cameraId);
    if (!camera) throw new Error('That Ring camera was not found on the account.');
    return camera.getSnapshot();
  }

  // Ring live view: the renderer's WebRTC offer goes straight to Ring's
  // cloud session — no local streaming helper involved.
  async createSdpSession(cameraId, offerSdp) {
    const camera = this.#camera(cameraId);
    if (!camera) throw new Error('That Ring camera was not found on the account.');
    const existing = this.sdpSessions.get(String(cameraId));
    if (existing) { try { existing.end(); } catch {} }
    const session = camera.createSimpleWebRtcSession();
    const answerSdp = await session.start(offerSdp);
    this.sdpSessions.set(String(cameraId), session);
    return {
      answerSdp,
      close: () => {
        try { session.end(); } catch {}
        this.sdpSessions.delete(String(cameraId));
      }
    };
  }

  closeSdpSession(cameraId) {
    const session = this.sdpSessions.get(String(cameraId));
    if (session) { try { session.end(); } catch {} this.sdpSessions.delete(String(cameraId)); }
  }

  async setArmed(locationId, armed) {
    const location = this.locations.find((item) => String(item.id) === String(locationId));
    if (!location) throw new Error('That Ring location was not found.');
    await location.setLocationMode(armed ? 'away' : 'disarmed');
  }
}

module.exports = { RingDriver };
