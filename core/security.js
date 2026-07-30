const HIGH_RISK_PATTERNS = [
  /\bformat\b/i,
  /\buninstall\b/i,
  /\bsend\s+(?:the\s+)?(?:email|message|payment)\b/i,
  /\b(?:buy|purchase|pay)\b/i,
  /\bpasswords?\b/i,
  /\bbypass\b/i
];

// "turn off the computer" is the same intent as "shut down" and belongs here,
// not in JR's content guard. It used to classify as `safe`, which left JR's
// kid-mode `no-such-power` row as the only thing catching that phrasing — so a
// parent who switched the `power` control ON still got a flat "I cannot do
// that", while "shut down the computer" honoured the toggle and offered the
// confirm. One intent, two answers. The classifier owns the whole intent now,
// so core/router.js's power branch (and its profile.power check in JR) sees
// every phrasing of it. Narrow on purpose: the object is required, so "turn off
// the lights" and "turn off the music" stay safe and untouched.
const SHUTDOWN_PATTERN = /\b(?:shut\s*down|restart|reboot|(?:turn|power)\s+off\s+(?:(?:the|my|this|our)\s+)?(?:computer|pc|machine|laptop|desktop))\b/i;

function classifyCommand(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return { level: 'safe', reason: '' };
  if (SHUTDOWN_PATTERN.test(normalized)) {
    return { level: 'confirm', reason: 'This changes the computer power state.' };
  }
  if (HIGH_RISK_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      level: 'blocked',
      reason: 'That request could delete data, expose secrets, send something, or spend money. No matching high-risk tool is enabled.'
    };
  }
  return { level: 'safe', reason: '' };
}

module.exports = { classifyCommand };
