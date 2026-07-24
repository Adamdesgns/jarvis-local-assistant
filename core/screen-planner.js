'use strict';

const guard = require('./screen-guard');

// screen-planner — turns a spoken sentence into a structured, validated plan
// for the driving session. Deterministic templates only in v1: the sentence
// either matches a shape we understand completely, or driving doesn't happen.
// No model output and nothing read off the screen ever becomes a step — the
// plan exists in full before the approval card is shown, and the session
// executes it frozen.
//
// Every step is `{ action, target: { app, name?, automationId?, controlType }, text? }`.
// `controlType` may list several acceptable kinds ("Button,MenuItem") — the
// helper still demands exactly ONE on-screen match or the session stops.

// Control-type groups: where a spoken name is allowed to live.
const CLICKABLE = 'Button,MenuItem,ListItem,TabItem,Hyperlink,SplitButton,CheckBox,TreeItem';
const EDIT_AREA = 'Edit,Document';

function cleanPhrase(value) {
  return String(value || '')
    .replace(/^(?:jarvis[,\s]*)?/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/[.!?]+$/, '');
}

function appFromWord(word) {
  const name = String(word || '').toLowerCase();
  if (/^(?:file\s+)?explorer$/.test(name) || name === 'files') return 'explorer';
  if (name === 'notepad') return 'notepad';
  return null;
}

// The templates. Each returns { title, steps } or null.
const TEMPLATES = [
  // "type hello world into notepad"
  {
    pattern: /^type\s+(.+?)\s+in(?:to)?\s+notepad$/i,
    build: (match) => ({
      title: `Type into Notepad`,
      steps: [
        { action: 'focusWindow', target: { app: 'notepad', name: 'Notepad' } },
        { action: 'wait', ms: 400 },
        { action: 'setValue', target: { app: 'notepad', controlType: EDIT_AREA, name: '' }, text: match[1] }
      ]
    })
  },
  // "switch to notepad" / "switch to file explorer"
  {
    pattern: /^switch\s+to\s+(notepad|(?:file\s+)?explorer|files)$/i,
    build: (match) => {
      const app = appFromWord(match[1]);
      if (!app) return null;
      return {
        title: `Switch to ${app === 'explorer' ? 'File Explorer' : 'Notepad'}`,
        steps: [{ action: 'focusWindow', target: { app, name: app } }]
      };
    }
  },
  // "open the file menu and click save" — two presses, one plan
  {
    pattern: /^open\s+the\s+(.+?)\s+menu\s+and\s+(?:click|press|choose|select)\s+(.+)$/i,
    build: (match) => ({
      title: `Open ${match[1]} menu, press ${match[2]}`,
      steps: [
        { action: 'invoke', target: { app: '', name: match[1], controlType: 'MenuItem,Button' } },
        { action: 'wait', ms: 400 },
        { action: 'invoke', target: { app: '', name: match[2], controlType: 'MenuItem' } }
      ]
    })
  },
  // "open the file menu"
  {
    pattern: /^open\s+the\s+(.+?)\s+menu$/i,
    build: (match) => ({
      title: `Open the ${match[1]} menu`,
      steps: [{ action: 'invoke', target: { app: '', name: match[1], controlType: 'MenuItem,Button' } }]
    })
  },
  // "select budget.xlsx in explorer"
  {
    pattern: /^select\s+(.+?)\s+in\s+(?:file\s+)?explorer$/i,
    build: (match) => ({
      title: `Select ${match[1]} in File Explorer`,
      steps: [
        { action: 'focusWindow', target: { app: 'explorer', name: 'explorer' } },
        { action: 'wait', ms: 400 },
        { action: 'invoke', target: { app: 'explorer', name: match[1], controlType: 'ListItem,TreeItem' } }
      ]
    })
  },
  // "click save" / "press the save button" — acts on whatever allowed window
  // is in focus; the session's snapshot guard decides if that window is fair.
  // Real control labels are short: anything long or rambling is not a button
  // name, and matching it would turn a stray sentence into a plan.
  {
    pattern: /^(?:click|press)\s+(?:on\s+)?(?:the\s+)?(.+?)(?:\s+button)?$/i,
    build: (match) => {
      const name = match[1];
      if (name.length > 40 || name.split(/\s+/).length > 4 || /\b(?:and|then|somehow)\b/i.test(name)) return null;
      return {
        title: `Press "${name}"`,
        steps: [{ action: 'invoke', target: { app: '', name, controlType: CLICKABLE } }]
      };
    }
  }
];

const VALID_ACTIONS = new Set(['focusWindow', 'invoke', 'setValue', 'wait']);

// Structural validation — every plan passes through here whatever produced
// it, so a future LLM-assisted planner inherits the same wall.
function validatePlan(plan, settings = {}) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.steps) || !plan.steps.length) {
    return { ok: false, problem: 'empty' };
  }
  if (plan.steps.length > 8) return { ok: false, problem: 'too-long' };
  for (const step of plan.steps) {
    if (!step || typeof step !== 'object' || !VALID_ACTIONS.has(step.action)) {
      return { ok: false, problem: 'bad-action' };
    }
    if (step.action === 'wait') continue;
    const target = step.target;
    if (!target || typeof target !== 'object') return { ok: false, problem: 'bad-target' };
    if (step.action !== 'focusWindow' && !target.name && !target.automationId && !target.controlType) {
      return { ok: false, problem: 'bad-target' };
    }
    // A step that names an app must name one driving is allowed to touch.
    if (target.app && !guard.isDriveAllowed(target.app, settings.screenControlAllowlist)) {
      return { ok: false, problem: 'app-not-allowed', app: target.app };
    }
    if (step.action === 'setValue' && typeof step.text !== 'string') return { ok: false, problem: 'bad-target' };
    // A step the guard would refuse outright fails the whole plan now, at
    // plan time, rather than mid-session.
    if (guard.classifyStep(step).tier === 'deny') return { ok: false, problem: 'denied-step', name: target.name };
  }
  return { ok: true };
}

// Mark which steps will pause for their own card, for honest plan-card text.
function describePlan(plan) {
  return plan.steps.map((step, index) => {
    const name = step?.target?.name || step?.target?.app || '';
    const verbs = {
      focusWindow: `Switch to ${name}`,
      invoke: `Press "${name}"`,
      setValue: `Type into the text area`,
      wait: 'Wait a moment'
    };
    const line = `${index + 1}. ${verbs[step.action] || step.action}`;
    return guard.classifyStep(step).tier === 'approve' ? `${line} — will ask again first` : line;
  }).join('\n');
}

// The front door: sentence in, validated plan (or a refusal with a reason
// JARVIS can speak) out.
function buildDrivePlan(text, settings = {}) {
  const phrase = cleanPhrase(text);
  if (!phrase) return { ok: false, text: "I didn't catch what you want me to do on screen." };
  for (const template of TEMPLATES) {
    const match = phrase.match(template.pattern);
    if (!match) continue;
    const built = template.build(match);
    if (!built) continue;
    const plan = { title: built.title, utterance: phrase, steps: built.steps };
    const valid = validatePlan(plan, settings);
    if (!valid.ok) {
      if (valid.problem === 'app-not-allowed') {
        return { ok: false, text: `${valid.app} isn't an app I'm allowed to drive — right now it's File Explorer and Notepad only.` };
      }
      if (valid.problem === 'denied-step') {
        return { ok: false, text: `"${valid.name}" is something I won't press — it destroys things permanently.` };
      }
      return { ok: false, text: "I couldn't turn that into a plan I trust, so I left it alone." };
    }
    return { ok: true, plan };
  }
  return { ok: false, text: "I don't know how to do that on screen yet. I can press named buttons, open menus, select files in Explorer, and type into Notepad." };
}

module.exports = { buildDrivePlan, validatePlan, describePlan };
