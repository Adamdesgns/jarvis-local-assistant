const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// A drift guard over the real renderer source, in the mould of the settings
// persistence guard. createCardGate's ordering is unit-tested in
// terminal-session.test.js, but the ORDER OF THE TWO CALLS lives in
// renderer.js, and nothing else can see it get reversed.
//
// Why it matters: <dialog>.close() fires its 'close' event synchronously, and
// that handler calls cardGate().dismiss(). Close before claim and every CONFIRM
// on THE TERMINAL's card silently becomes a cancel — the command never runs,
// no error appears, and the console just says "Cancelled". Passing tests would
// not notice, because the console runner is on the other side of the promise.

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

function resolveApprovalBody() {
  const start = source.indexOf('async function resolveApproval(');
  assert.notEqual(start, -1, 'resolveApproval must exist in renderer.js');
  // Far enough to cover the function without depending on brace matching.
  return source.slice(start, start + 1200);
}

test('resolveApproval claims the card before closing the dialog', () => {
  const body = resolveApprovalBody();
  const claim = body.indexOf('.claim()');
  const close = body.indexOf(".close()");

  assert.notEqual(claim, -1, 'resolveApproval must claim the card gate');
  assert.notEqual(close, -1, 'resolveApproval must close the modal');
  assert.ok(
    claim < close,
    'cardGate().claim() must come BEFORE approval-modal.close() — close() fires '
    + "the dialog's 'close' handler synchronously, which dismisses an unclaimed "
    + 'card and turns CONFIRM into a silent cancel.',
  );
});

test('the dialog dismiss handlers cover both Esc events', () => {
  // The other half: without these, dismissing the card with Esc leaves the
  // console runner awaiting a promise that never settles, and it refuses every
  // later command with "Still working on the last one."
  //
  // Both events, because Esc fires 'cancel' then 'close' and 'close' is queued
  // on the user-interaction task source — which a non-compositing page does not
  // pump. dismiss() is idempotent, so listening twice costs nothing.
  for (const event of ['cancel', 'close']) {
    assert.ok(
      new RegExp(`addEventListener\\('${event}',\\s*\\(\\)\\s*=>\\s*cardGate\\(\\)\\.dismiss\\(\\)\\)`).test(source),
      `the approval modal needs a '${event}' handler that dismisses the gate`,
    );
  }
});

test('the console never asks the main process to run without classifying first', () => {
  // The main process refuses an unapproved approve-tier command on its own, so
  // this is belt-and-braces: it proves the renderer has exactly one route into
  // the runner, and it goes through createConsoleRunner.
  const calls = source.match(/runTerminalCommand\(/g) || [];
  assert.equal(calls.length, 1, 'runTerminalCommand must be called from exactly one place');
  assert.match(
    source,
    /run:\s*\(command,\s*cwd,\s*approved\)\s*=>\s*window\.jarvis\.runTerminalCommand\(/,
    'the only caller must be the console runner it is injected into',
  );
});
