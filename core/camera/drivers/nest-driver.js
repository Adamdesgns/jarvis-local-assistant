const { CameraDriver } = require('../driver-interface');
const nestClient = require('../nest-client');

// Nest cameras via Google's official SDM API. Live-view-first: Nest offers
// no on-demand snapshots, and motion alerts need a Pub/Sub setup we do not
// require in v1 — the UI says both plainly.
class NestDriver extends CameraDriver {
  constructor(options) {
    super(options);
    this.client = options.client || nestClient;
    this.devices = [];
  }

  get brand() { return 'nest'; }

  #session() {
    return { accessToken: this.secrets.accessToken };
  }

  async #freshSession() {
    if (!this.secrets.accessToken || Date.now() > (this.secrets.expiresAt || 0) - 60000) {
      const token = await this.client.refreshAccessToken({
        clientId: this.secrets.clientId,
        clientSecret: this.secrets.clientSecret,
        refreshToken: this.secrets.refreshToken
      });
      this.secrets = { ...this.secrets, ...token };
      this.persistSecrets(this.secrets);
    }
    return this.#session();
  }

  async connect() {
    try {
      const session = await this.#freshSession();
      this.devices = await this.client.listDevices(session, this.secrets.projectId);
      this.setState('connected');
    } catch (error) {
      this.setState('error', `Nest connection failed: ${error.message}`);
    }
  }

  #device(cameraId) {
    return this.devices.find((device) => device.id === String(cameraId));
  }

  async listCameras() {
    if (this.state !== 'connected') return [];
    return this.devices.map((device) => ({
      id: device.id,
      name: device.name,
      brand: 'nest',
      canStream: true,
      canArm: false,
      kind: 'camera',
      liveOnly: true
    }));
  }

  async createSdpSession(cameraId, offerSdp) {
    const device = this.#device(cameraId);
    if (!device) throw new Error('That Nest camera was not found on the account.');
    if (!device.protocols.includes('WEB_RTC')) throw new Error('This Nest camera only supports RTSP streaming.');
    const session = await this.#freshSession();
    const stream = await this.client.generateWebRtcStream(session, this.secrets.projectId, cameraId, offerSdp);
    return { answerSdp: stream.answerSdp, close: () => {} };
  }

  // RTSP-only (older wired) Nest cameras route through go2rtc instead.
  async getStreamSource(cameraId) {
    const device = this.#device(cameraId);
    if (!device || device.protocols.includes('WEB_RTC')) return null;
    const session = await this.#freshSession();
    const stream = await this.client.generateRtspStream(session, this.secrets.projectId, cameraId);
    return stream.rtspUrl || null;
  }
}

module.exports = { NestDriver };
