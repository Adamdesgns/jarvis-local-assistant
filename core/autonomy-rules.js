// Pure autonomy policy: which announcements an alert produces and whether a
// sensitive (Act-tier) step may run unattended. No Electron imports.
const TIERS = { ANNOUNCE: 'announce', PREPARE: 'prepare', ACT: 'act' };

// Hour-of-day window that may cross midnight (21 → 7 means 9 PM–7 AM).
// Start is inclusive, end exclusive; start === end means "always".
function isWithinWindow(now, startHour, endHour) {
  const hour = now.getHours();
  const start = Number(startHour);
  const end = Number(endHour);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

function motionAllowed(settings, kind, now) {
  if (kind !== 'motion') return true; // the doorbell is never silenced
  if (!(settings.autonomyRules || {}).nightMotionOnly) return true;
  return isWithinWindow(now, settings.autonomyNightStart, settings.autonomyNightEnd);
}

// The camera service asks this before showing a Windows notification.
function shouldNotify(settings, event, now) {
  if (settings.autonomyEnabled !== true) return true;
  return motionAllowed(settings, event.kind, now);
}

function evaluateAlert(settings, event, now) {
  if (settings.autonomyEnabled !== true) return [];
  const rules = settings.autonomyRules || {};
  const actions = [];
  if (event.kind === 'doorbell' && rules.speakDoorbell) {
    actions.push({ rule: 'speakDoorbell', tier: TIERS.ANNOUNCE, speak: event.body });
  }
  if (event.kind === 'doorbell' && rules.someoneHereCard) {
    actions.push({
      rule: 'someoneHereCard',
      tier: TIERS.PREPARE,
      card: { title: "SOMEONE'S HERE", body: event.body, jpegBase64: event.jpegBase64 || '' }
    });
  }
  if (event.kind === 'motion' && rules.speakMotion && motionAllowed(settings, event.kind, now)) {
    actions.push({ rule: 'speakMotion', tier: TIERS.ANNOUNCE, speak: event.body });
  }
  return actions;
}

// Act-tier gate decision, mirroring the router's classifyCommand semantics.
// No Act rule ships in slice 1; this exists so slice 3 cannot get it wrong.
function decideAct(classification) {
  if (classification === 'safe') return { allowed: true };
  if (classification === 'confirm') return { allowed: false, requiresApproval: true };
  return { allowed: false, log: true };
}

module.exports = { TIERS, isWithinWindow, evaluateAlert, shouldNotify, decideAct };
