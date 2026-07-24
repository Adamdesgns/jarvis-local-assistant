'use strict';

// screen-guard — the guardrails for JARVIS reading (and, later, driving) the
// screen. Every rule here is enforced in code the main process calls, not
// handed to a model as an instruction. A rule the model is merely asked to
// honour is not a control: during a declared code freeze Replit's agent
// deleted a live production database anyway (PC-CONTROL-RESEARCH §Documented
// failures). JARVIS's approved-folder boundary works because it lives in the
// main process. Screen control gets the same treatment — these functions are
// the boundary.
//
// Slice 1 is read-only: nothing here clicks. But the denylists and redaction
// are built and tested now so the clicking slice inherits an already-proven
// boundary rather than bolting one on later.

// Financial surfaces are denied permanently. This is a frozen compile-time
// constant, NOT a setting: no config edit, no Settings toggle, and no voice
// command — including from Adam himself — can turn it off. Decided by Adam on
// 2026-07-21 (PC-CONTROL-RESEARCH §Decisions made). Anthropic reached the same
// conclusion for Claude for Chrome and blocks financial services as a whole
// category. Object.freeze means a typo like FINANCIAL_DENY.push(...) elsewhere
// throws instead of silently widening the hole.
const FINANCIAL_DENY = Object.freeze([
  /robinhood/i,
  /coinbase/i,
  /\bpaypal\b/i,
  /\bvenmo\b/i,
  /\bcash\s*app\b/i,
  /\bbinance\b/i,
  /\bkraken\b/i,
  /\bfidelity\b/i,
  /\bschwab\b/i,
  /\bvanguard\b/i,
  /\be-?trade\b/i,
  /\bwealthfront\b/i,
  /\bchase\b/i,
  /wells\s*fargo/i,
  /bank\s*of\s*america/i,
  /\bciti(?:bank|group)?\b/i,
  /capital\s*one/i,
  /american\s*express/i,
  /\bamex\b/i,
  /\bbank\b/i,
  /\bbrokerage\b/i,
  /\bcrypto\b/i,
  /\bwallet\b/i
]);

// Credential and secret surfaces. Reading these would put passwords, recovery
// codes and the like in a spoken answer or a saved transcript.
const CREDENTIAL_DENY = Object.freeze([
  /credential\s*manager/i,
  /\bsign\s*in\b/i,
  /\blog\s*in\b|\blogin\b/i,
  /\bpassword/i,
  /1password/i,
  /bitwarden/i,
  /lastpass/i,
  /keepass/i,
  /dashlane/i,
  /authenticator/i
]);

// System and administrative surfaces. The design denies driving these; for a
// read we also refuse, so the same window is off-limits whichever slice asks.
const SYSTEM_DENY = Object.freeze([
  /user\s*account\s*control/i,
  /\buac\b/i,
  /windows\s*security/i,
  /registry\s*editor|regedit/i,
  /task\s*manager/i,
  /device\s*manager/i,
  /control\s*panel/i,
  /(?:windows|microsoft)\s*defender/i,
  /smart\s*app\s*control/i,
  /group\s*policy/i
]);

// Integrity levels at or above this are treated as untouchable: Windows blocks
// a normal process from sending input to an elevated window (UIPI), and a UAC
// consent dialog lives on the secure desktop nothing in our session can read.
const ELEVATED_INTEGRITY = new Set(['high', 'system', 'protected']);

function matchesAny(patterns, ...fields) {
  const haystack = fields.filter(Boolean).map(String).join(' ');
  if (!haystack) return false;
  return patterns.some((pattern) => pattern.test(haystack));
}

// Classify a single window by its owning process name and title. Fails closed:
// anything unrecognised that trips a denylist is denied, and an entirely
// unknown window is treated as ordinary (allowed) only when nothing matches.
function classifyWindow(win = {}) {
  const processName = win.processName || win.process || '';
  const title = win.title || win.windowTitle || '';
  const integrity = String(win.integrity || '').toLowerCase();

  if (ELEVATED_INTEGRITY.has(integrity)) {
    return deny('elevated', 'an elevated system', 'Windows blocks input to elevated windows, and I will not read one either.');
  }
  if (matchesAny(FINANCIAL_DENY, processName, title)) {
    return deny('financial', 'a financial', 'Financial windows are off-limits permanently — this cannot be turned off.');
  }
  if (matchesAny(CREDENTIAL_DENY, processName, title)) {
    return deny('credential', 'a sign-in or password', 'I will not read a window that could expose credentials.');
  }
  if (matchesAny(SYSTEM_DENY, processName, title)) {
    return deny('system', 'a system', 'System and administrative windows are off-limits.');
  }
  return { allowed: true, category: 'ok', label: '', reason: '' };
}

function deny(category, label, reason) {
  return { allowed: false, category, label, reason };
}

// Whether an app is on the allowlist of things JARVIS may drive. Reads are
// gated by the denylists above, not by this list; this is here for the
// clicking slice, where an app must be explicitly allowed before any input is
// sent. Matched case-insensitively against the process name with or without a
// trailing .exe.
function isAllowedApp(processName, allowlist = []) {
  const name = String(processName || '').toLowerCase().replace(/\.exe$/, '');
  if (!name) return false;
  return (allowlist || [])
    .map((entry) => String(entry || '').toLowerCase().replace(/\.exe$/, ''))
    .some((entry) => entry && (entry === name || name.includes(entry) || entry.includes(name)));
}

// ---------------------------------------------------------------------------
// Driving (slice 2). Everything below gates the clicking slice specifically.
// ---------------------------------------------------------------------------

// The only apps v1 may ever drive. Frozen compile-time constant like
// FINANCIAL_DENY: the settings allowlist can narrow this but never widen it —
// no config edit, Settings toggle or voice command adds an app. Chrome waits
// for v2 (dedicated clean profile, separate spike per PC-CONTROL-RESEARCH §2).
// Decided by Adam on 2026-07-23.
const V1_DRIVE_APPS = Object.freeze(['explorer', 'notepad']);

function normalizeAppName(name) {
  return String(name || '').toLowerCase().replace(/\.exe$/, '').trim();
}

// The list of apps driving may touch: the intersection of what settings allow
// and what v1 permits. Settings can turn an app off; only shipping code can
// turn one on.
function effectiveDriveAllowlist(settingList = []) {
  const wanted = new Set((settingList || []).map(normalizeAppName).filter(Boolean));
  return V1_DRIVE_APPS.filter((app) => wanted.has(app));
}

// Exact-match allowlist check for driving. isAllowedApp's substring matching
// is fine for read scaffolding but too loose to gate input: 'notepad++' must
// NOT pass as 'notepad', and nothing should ride in on a name that merely
// contains an allowed word.
function isDriveAllowed(processName, settingList = []) {
  const name = normalizeAppName(processName);
  if (!name) return false;
  return effectiveDriveAllowlist(settingList).includes(name);
}

// Element names that end a session outright — no approval card, just refusal.
// Matched against the target element's name immediately before every action.
const STEP_DENY = Object.freeze([
  /permanently/i,
  /empty\s*recycle\s*bin/i,
  /\bformat\b/i,
  /reset\s*this\s*pc/i,
  /shift\s*\+\s*del/i
]);

// Element names that pause for an individual approval card even inside an
// approved plan — anything that writes, sends, ships or destroys.
const STEP_APPROVE = Object.freeze([
  /\b(save|send|submit|delete|remove|download|upload|replace|overwrite|confirm|apply|yes|ok)\b/i,
  /move\s+to/i,
  /don'?t\s+save/i
]);

// Classify one structured plan step into an approval tier. Deterministic and
// run on the structured step only — never on raw model output, never on text
// read off the screen. Called twice per step: once at plan time (so the plan
// card can mark "will ask again") and again immediately before the action with
// the freshly resolved element merged in.
//   free    — run without stopping (navigation, menus, selection, plain typing)
//   approve — pause for an individual approval card
//   deny    — refuse and end the session
function classifyStep(step = {}) {
  const action = String(step.action || '');
  const name = String(step?.target?.name || step?.element?.name || '');
  const isPassword = Boolean(step?.element?.isPassword || step?.target?.isPassword);

  if (isPassword) {
    return { tier: 'deny', reason: 'That is a password field. I will not touch those.' };
  }
  if (STEP_DENY.some((p) => p.test(name))) {
    return { tier: 'deny', reason: `"${name}" permanently destroys things, so I will not press it.` };
  }
  if (step.kind === 'risky' || ((action === 'invoke') && STEP_APPROVE.some((p) => p.test(name)))) {
    return { tier: 'approve', reason: `"${name || action}" changes something, so I will ask before pressing it.` };
  }
  return { tier: 'free', reason: '' };
}

// Strip anything that could leak a secret out of the element list before it is
// summarised, spoken, or written to a transcript. Password fields keep their
// label (so "Password" can be reported as present) but never any value, and no
// element's typed contents are ever carried through. The helper does not emit
// values in the first place; this is the belt to that suspenders.
function redactElements(elements = []) {
  return (Array.isArray(elements) ? elements : []).map((element) => {
    const clean = {
      name: element.isPassword ? '' : String(element.name || '').slice(0, 120),
      control: String(element.control || element.controlType || '').slice(0, 40),
      isPassword: Boolean(element.isPassword),
      enabled: element.enabled !== false
    };
    return clean;
  });
}

module.exports = {
  FINANCIAL_DENY,
  CREDENTIAL_DENY,
  SYSTEM_DENY,
  ELEVATED_INTEGRITY,
  V1_DRIVE_APPS,
  classifyWindow,
  isAllowedApp,
  effectiveDriveAllowlist,
  isDriveAllowed,
  classifyStep,
  redactElements
};
