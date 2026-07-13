const HIGH_RISK_PATTERNS = [
  /\bformat\b/i,
  /\buninstall\b/i,
  /\bsend\s+(?:the\s+)?(?:email|message|payment)\b/i,
  /\b(?:buy|purchase|pay)\b/i,
  /\bpasswords?\b/i,
  /\bbypass\b/i
];

const SHUTDOWN_PATTERN = /\b(shut\s*down|restart|reboot)\b/i;

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
