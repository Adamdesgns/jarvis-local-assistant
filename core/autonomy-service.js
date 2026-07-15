const { evaluateAlert, shouldNotify } = require('./autonomy-rules');

// Background coordinator: receives triggers (camera alerts in slice 1),
// applies the enabled rules, and pushes announce/prepare actions to the UI.
// It never executes state-changing actions itself — Act-tier work must route
// through the router's approval flow (see decideAct in autonomy-rules).
class AutonomyService {
  constructor({ config, emit, log, now }) {
    this.config = config;
    this.emit = emit || (() => {});
    this.log = log || { write: () => {} };
    this.now = now || (() => new Date());
  }

  // The camera service consults this before raising a Windows notification.
  // Fails open: a bug here must never hide a real alert.
  notifyGate(alert) {
    try { return shouldNotify(this.config.getSettings(), alert, this.now()); }
    catch { return true; }
  }

  handleCameraAlert(alert) {
    try {
      const actions = evaluateAlert(this.config.getSettings(), alert, this.now());
      for (const action of actions) {
        this.emit('autonomy:event', action);
        this.log.write({
          type: 'autonomy',
          command: action.rule,
          response: action.speak || action.card?.body || alert.body || '',
          source: 'autonomy'
        });
      }
      return actions;
    } catch {
      return [];
    }
  }
}

module.exports = { AutonomyService };
