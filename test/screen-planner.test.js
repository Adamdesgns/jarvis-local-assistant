'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDrivePlan, validatePlan, describePlan } = require('../core/screen-planner');

const SETTINGS = { screenControlAllowlist: ['explorer', 'notepad'] };

// ---------------------------------------------------------------------------
// Templates produce schema-valid plans.
// ---------------------------------------------------------------------------

test('"type hello world into notepad" plans a focus + setValue', () => {
  const planned = buildDrivePlan('type hello world into notepad', SETTINGS);
  assert.equal(planned.ok, true);
  const actions = planned.plan.steps.map((s) => s.action);
  assert.deepEqual(actions, ['focusWindow', 'wait', 'setValue']);
  assert.equal(planned.plan.steps[2].text, 'hello world');
  assert.equal(planned.plan.steps[0].target.app, 'notepad');
  assert.equal(validatePlan(planned.plan, SETTINGS).ok, true);
});

test('"click save" plans a single named invoke', () => {
  const planned = buildDrivePlan('Jarvis, click Save', SETTINGS);
  assert.equal(planned.ok, true);
  assert.equal(planned.plan.steps.length, 1);
  assert.equal(planned.plan.steps[0].action, 'invoke');
  assert.equal(planned.plan.steps[0].target.name, 'Save');
});

test('"open the file menu and click save" plans two invokes with a settle wait', () => {
  const planned = buildDrivePlan('open the File menu and click Save', SETTINGS);
  assert.equal(planned.ok, true);
  const actions = planned.plan.steps.map((s) => s.action);
  assert.deepEqual(actions, ['invoke', 'wait', 'invoke']);
  assert.equal(planned.plan.steps[0].target.name, 'File');
  assert.equal(planned.plan.steps[2].target.name, 'Save');
});

test('"select budget.xlsx in explorer" focuses Explorer then selects the item', () => {
  const planned = buildDrivePlan('select budget.xlsx in explorer', SETTINGS);
  assert.equal(planned.ok, true);
  assert.equal(planned.plan.steps[0].target.app, 'explorer');
  assert.equal(planned.plan.steps[2].target.name, 'budget.xlsx');
});

test('"switch to notepad" is a single focusWindow', () => {
  const planned = buildDrivePlan('switch to notepad', SETTINGS);
  assert.equal(planned.ok, true);
  assert.deepEqual(planned.plan.steps.map((s) => s.action), ['focusWindow']);
});

// ---------------------------------------------------------------------------
// Refusals: the planner is the first wall, and it fails closed.
// ---------------------------------------------------------------------------

test('an unrecognized sentence is refused with guidance, never guessed at', () => {
  const planned = buildDrivePlan('do my taxes', SETTINGS);
  assert.equal(planned.ok, false);
  assert.match(planned.text, /press named buttons/i);
});

test('a destructive element name fails the whole plan at plan time', () => {
  const planned = buildDrivePlan('click Empty Recycle Bin', SETTINGS);
  assert.equal(planned.ok, false);
  assert.match(planned.text, /won't press/i);
});

test('typing into an app outside the allowlist is refused at plan time', () => {
  const planned = buildDrivePlan('type hello into notepad', { screenControlAllowlist: ['explorer'] });
  assert.equal(planned.ok, false);
  assert.match(planned.text, /allowed to drive/i);
});

// ---------------------------------------------------------------------------
// validatePlan is the wall any future planner (LLM-assisted) inherits.
// ---------------------------------------------------------------------------

test('validatePlan rejects junk shapes', () => {
  assert.equal(validatePlan(null, SETTINGS).ok, false);
  assert.equal(validatePlan({ steps: [] }, SETTINGS).ok, false);
  assert.equal(validatePlan({ steps: [{ action: 'launchMissiles', target: { name: 'x' } }] }, SETTINGS).ok, false);
  assert.equal(validatePlan({ steps: [{ action: 'invoke' }] }, SETTINGS).ok, false);
  assert.equal(validatePlan({ steps: [{ action: 'setValue', target: { name: 'x', controlType: 'Edit' } }] }, SETTINGS).ok, false, 'setValue without text');
});

test('validatePlan rejects a plan longer than 8 steps', () => {
  const steps = Array.from({ length: 9 }, () => ({ action: 'invoke', target: { name: 'File', controlType: 'MenuItem' } }));
  assert.equal(validatePlan({ steps }, SETTINGS).ok, false);
});

test('validatePlan rejects an app the settings do not allow', () => {
  const plan = { steps: [{ action: 'focusWindow', target: { app: 'chrome', name: 'Chrome' } }] };
  assert.equal(validatePlan(plan, SETTINGS).ok, false);
});

// ---------------------------------------------------------------------------
// The plan card text is honest about what will pause.
// ---------------------------------------------------------------------------

test('describePlan marks risky steps as "will ask again"', () => {
  const planned = buildDrivePlan('open the File menu and click Save', SETTINGS);
  const detail = describePlan(planned.plan);
  assert.match(detail, /1\. Press "File"/);
  assert.match(detail, /3\. Press "Save" — will ask again first/);
  assert.ok(!/1\..*ask again/.test(detail), 'opening a menu does not pause');
});
