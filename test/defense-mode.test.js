const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isDefenseRequest,
  isStandDown
} = require('../core/defense-mode');

test('isDefenseRequest recognizes defense phrasings', () => {
  assert.deepEqual(isDefenseRequest('defense mode'), {});
  assert.deepEqual(isDefenseRequest('Defense mode.'), {});
  assert.deepEqual(isDefenseRequest('jarvis, defense mode'), {});
  assert.deepEqual(isDefenseRequest('enter defense mode'), {});
  assert.deepEqual(isDefenseRequest('go into defense mode'), {});
  assert.deepEqual(isDefenseRequest('defence mode'), {});
  assert.deepEqual(isDefenseRequest('activate defense mode'), {});
});

test('isDefenseRequest leaves ordinary sentences alone', () => {
  assert.equal(isDefenseRequest('what is defense mode'), null);
  assert.equal(isDefenseRequest('add defense mode to my tasks'), null);
  assert.equal(isDefenseRequest('read about missile defense'), null);
  assert.equal(isDefenseRequest('is defense mode on'), null);
  assert.equal(isDefenseRequest('turn off defense mode notifications later'), null);
});

test('isStandDown recognizes the exit phrasings', () => {
  assert.deepEqual(isStandDown('stand down'), {});
  assert.deepEqual(isStandDown('Stand down.'), {});
  assert.deepEqual(isStandDown('jarvis, stand down'), {});
  assert.deepEqual(isStandDown('exit defense mode'), {});
  assert.deepEqual(isStandDown('leave defense mode'), {});
  assert.deepEqual(isStandDown('all clear'), {});
});

test('isStandDown leaves ordinary sentences alone', () => {
  assert.equal(isStandDown('stand down from the ladder'), null);
  assert.equal(isStandDown('is the all clear given yet'), null);
  assert.equal(isStandDown('when should I stand down the crew'), null);
});
