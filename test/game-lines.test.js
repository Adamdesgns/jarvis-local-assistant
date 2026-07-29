'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { OCCASIONS, gameLine, LINES } = require('../core/game-lines');

test('every occasion has at least 3 lines in every band', () => {
  for (const occasion of OCCASIONS) {
    for (const band of ['middle', 'big', 'teen']) {
      assert.ok((LINES[occasion]?.[band] || []).length >= 3, `${occasion}/${band}`);
    }
  }
});

test('gameLine returns a string from the right band', () => {
  const line = gameLine('kidWins', { age: 11, rng: () => 0 });
  assert.equal(line, LINES.kidWins.big[0]);
  assert.equal(typeof gameLine('jarvisWins', { age: 15 }), 'string');
});

test('no line is unkind: never about the kid losing being the kid\'s fault', () => {
  // The cheap enforceable slice of "never unkind": banned words anywhere.
  const banned = /\b(stupid|dumb|idiot|loser|pathetic|baby|cry)\b/i;
  for (const occasion of OCCASIONS) {
    for (const band of Object.keys(LINES[occasion])) {
      for (const line of LINES[occasion][band]) {
        assert.doesNotMatch(line, banned, `${occasion}/${band}: "${line}"`);
      }
    }
  }
});

test('unknown occasion throws — a typo is a bug, not a silent blank', () => {
  assert.throws(() => gameLine('victoryLap', { age: 11 }));
});
