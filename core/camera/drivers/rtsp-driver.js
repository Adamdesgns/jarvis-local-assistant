const { CameraDriver } = require('../driver-interface');

// Generic local-network cameras (Reolink, Amcrest, Hikvision, Tapo, ...).
// The RTSP URLs contain credentials, so the camera list lives in secrets.
class RtspDriver extends CameraDriver {
  get brand() { return 'rtsp'; }

  #cameras() { return Array.isArray(this.secrets.cameras) ? this.secrets.cameras : []; }

  async listCameras() {
    return this.#cameras().map((camera) => ({
      id: camera.id, name: camera.name, brand: 'rtsp', canStream: true, canArm: false
    }));
  }

  async getStreamSource(cameraId) {
    const camera = this.#cameras().find((item) => item.id === cameraId);
    return camera ? camera.url : null;
  }
}

module.exports = { RtspDriver };
