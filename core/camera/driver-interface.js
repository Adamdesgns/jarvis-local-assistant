const { EventEmitter } = require('node:events');

class NotSupportedError extends Error {
  constructor(action) {
    super(`${action} is not supported by this camera brand.`);
    this.code = 'NOT_SUPPORTED';
  }
}

// Contract every camera brand implements. The Cameras UI and camera-service
// only ever talk to this shape — never to brand-specific code.
class CameraDriver extends EventEmitter {
  constructor({ account, secrets, persistSecrets }) {
    super();
    this.account = account || {};
    this.secrets = secrets || {};
    // Drivers call this with the full secrets object whenever tokens rotate,
    // so refreshed sessions survive an app restart.
    this.persistSecrets = persistSecrets || (() => {});
    this.state = 'disconnected';
    this.message = '';
    this.snapshotCooldownMs = 0; // brands with battery cameras override this
  }

  get brand() { return 'generic'; }
  async connect() { this.setState('connected'); }
  async disconnect() { this.setState('disconnected'); }
  async listCameras() { return []; }
  async listSystems() { return []; } // arm-able systems: [{id, name, armed, canArm}]
  async getSnapshot() { throw new NotSupportedError('Snapshots'); }
  async getStreamSource() { return null; }
  async setArmed() { throw new NotSupportedError('Arming'); }

  setState(state, message = '') {
    this.state = state;
    this.message = message;
    this.emit('status', { state, message });
  }

  status() { return { state: this.state, message: this.message }; }
}

module.exports = { CameraDriver, NotSupportedError };
