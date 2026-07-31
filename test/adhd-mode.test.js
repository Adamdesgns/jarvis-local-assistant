'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  detectAdhdOn, detectAdhdOff, detectStepNav, splitSteps, stepLine, restLine, STYLE_RULES
} = require('../core/adhd-mode');

test('the toggle turns on for the acronym and the plain synonyms', () => {
  for (const on of ['adhd mode', 'ADHD', 'jarvis adhd mode', 'turn on adhd mode', 'one step at a time', 'step by step', 'simple steps', 'a.d.h.d. mode']) {
    assert.equal(detectAdhdOn(on), true, on);
  }
  for (const notOn of ['what is adhd', 'i have adhd and it is hard', 'adhd is a thing', '']) {
    assert.equal(detectAdhdOn(notOn), false, notOn || '(empty)');
  }
});

test('the toggle turns off, and off never reads as on', () => {
  for (const off of ['normal mode', 'regular mode', 'normal', 'adhd off', 'all at once', 'jarvis normal mode']) {
    assert.equal(detectAdhdOff(off), true, off);
    assert.equal(detectAdhdOn(off), false, `${off} must not also read as ON`);
  }
  assert.equal(detectAdhdOff('that is normal'), false);
});

test('step navigation maps kid words to intents, and STOP beats NEXT', () => {
  for (const s of ['next', 'done', 'okay', 'got it', 'ready', 'keep going', "what's next", 'next step']) {
    assert.equal(detectStepNav(s), 'next', s);
  }
  for (const s of ['again', 'repeat', 'say that again', 'what was that', 'huh']) {
    assert.equal(detectStepNav(s), 'repeat', s);
  }
  for (const s of ['stop', 'nevermind', "i'm done", "we're done", 'all done', "that's enough"]) {
    assert.equal(detectStepNav(s), 'stop', s);
  }
  for (const s of ['all of them', 'the rest', 'read the rest', 'just tell me', 'everything']) {
    assert.equal(detectStepNav(s), 'rest', s);
  }
  assert.equal(detectStepNav('what is a creeper'), null, 'a real question mid-walk is not navigation');
  assert.equal(detectStepNav(''), null);
});

test('splitSteps pulls a numbered list and ignores prose', () => {
  const listy = 'Here is how:\n1. Open the crafting table.\n2. Put three wool in a row.\n3. Put three planks under it.';
  assert.deepEqual(splitSteps(listy), [
    'Open the crafting table.',
    'Put three wool in a row.',
    'Put three planks under it.'
  ]);
  assert.deepEqual(splitSteps('A creeper is a green mob that explodes.'), [], 'a one-sentence fact is not a walk');
  assert.deepEqual(splitSteps('1. Only one step here.'), [], 'a single step is not a walk');
  // Tolerant of "Step N:" and ")" markers.
  assert.equal(splitSteps('Step 1: dig down\nStep 2) place the block').length, 2);
});

test('stepLine numbers every step and names the first and last', () => {
  const steps = ['a', 'b', 'c'];
  assert.match(stepLine(steps, 0), /^Step 1 of 3\. a$/);
  assert.match(stepLine(steps, 1), /^Step 2 of 3\. b$/);
  assert.match(stepLine(steps, 2), /^Last step, number 3\. c$/);
});

test('restLine reads out what is left', () => {
  const steps = ['a', 'b', 'c'];
  assert.match(restLine(steps, 1), /2\. b.*3\. c/);
  assert.match(restLine(steps, 2), /^Here it is: c$/);
});

test('the style rules shape format, never persona', () => {
  assert.match(STYLE_RULES, /numbered list/i);
  assert.match(STYLE_RULES, /one action per step/i);
  // It must NOT try to change who JARVIS is — that would fight the JR content
  // lock's "stay JARVIS" rule and the standard persona.
  assert.doesNotMatch(STYLE_RULES, /personality|cheerful|friendly|persona/i);
});
