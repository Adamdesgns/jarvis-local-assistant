const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STREAMS,
  normalizeStream,
  streamLabel,
  formatClock,
  createLog,
  accentFor,
  looksLikeShell,
} = require('../src/terminal-log');

test('STREAMS: every stream has an id and a short uppercase label', () => {
  assert.ok(STREAMS.length >= 5);
  const ids = STREAMS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'stream ids must be unique');
  for (const s of STREAMS) {
    assert.ok(s.id && typeof s.id === 'string');
    assert.ok(s.label && s.label === s.label.toUpperCase());
    assert.ok(s.label.length <= 8, 'labels sit in a narrow gutter, keep them short');
  }
});

test('normalizeStream: known ids pass through, anything else becomes system', () => {
  assert.equal(normalizeStream('jarvis'), 'jarvis');
  assert.equal(normalizeStream('you'), 'you');
  assert.equal(normalizeStream('night'), 'night');
  assert.equal(normalizeStream('nonsense'), 'system');
  assert.equal(normalizeStream(undefined), 'system');
  assert.equal(normalizeStream(''), 'system');
});

test('streamLabel: returns the gutter label, falling back to SYS', () => {
  assert.equal(streamLabel('jarvis'), 'JARVIS');
  assert.equal(streamLabel('you'), 'YOU');
  assert.equal(streamLabel('whatever'), 'SYS');
});

test('formatClock: fixed-width 24-hour time, zero padded', () => {
  assert.equal(formatClock(new Date(2026, 6, 24, 9, 7, 4)), '09:07:04');
  assert.equal(formatClock(new Date(2026, 6, 24, 23, 59, 59)), '23:59:59');
  assert.equal(formatClock(new Date(2026, 6, 24, 0, 0, 0)), '00:00:00');
});

test('createLog: keeps lines in order, newest last, with incrementing ids', () => {
  const log = createLog();
  log.push('you', 'good morning');
  log.push('jarvis', 'Good morning. Three tasks due.');
  const lines = log.lines();
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, 'good morning');
  assert.equal(lines[1].text, 'Good morning. Three tasks due.');
  assert.ok(lines[1].id > lines[0].id, 'ids must increase so the view can key on them');
});

test('createLog: caps at the limit by dropping the OLDEST lines', () => {
  const log = createLog(3);
  for (const n of [1, 2, 3, 4, 5]) log.push('system', `line ${n}`);
  const lines = log.lines();
  assert.equal(lines.length, 3);
  assert.deepEqual(
    lines.map((l) => l.text),
    ['line 3', 'line 4', 'line 5'],
  );
});

test('createLog: an unknown stream is stored as system rather than thrown away', () => {
  const log = createLog();
  log.push('bogus', 'still worth showing');
  assert.equal(log.lines()[0].stream, 'system');
});

test('createLog: blank text is ignored so the console does not fill with empty rows', () => {
  const log = createLog();
  log.push('jarvis', '   ');
  log.push('jarvis', '');
  log.push('jarvis', null);
  assert.equal(log.lines().length, 0);
});

test('createLog: multi-line text becomes one entry per line', () => {
  const log = createLog();
  log.push('jarvis', 'first\nsecond\n\nthird');
  assert.deepEqual(
    log.lines().map((l) => l.text),
    ['first', 'second', 'third'],
  );
});

test('createLog: lines() returns a copy, so callers cannot mutate history', () => {
  const log = createLog();
  log.push('you', 'hello');
  log.lines().push({ text: 'injected' });
  assert.equal(log.lines().length, 1);
});

test('createLog: clear empties it but keeps ids climbing', () => {
  const log = createLog();
  log.push('you', 'one');
  const firstId = log.lines()[0].id;
  log.clear();
  assert.equal(log.lines().length, 0);
  log.push('you', 'two');
  assert.ok(log.lines()[0].id > firstId, 'ids must not restart or the view will reuse keys');
});

test('accentFor: the console wears the chosen orb colour, defaulting to JARVIS gold', () => {
  assert.equal(accentFor('gold'), '#ffb21f');
  assert.equal(accentFor('obsidian'), '#61efb2');
  assert.equal(accentFor(undefined), '#ffb21f');
  assert.equal(accentFor('chartreuse'), '#ffb21f');
});

// shellHint() is gone with stage 1 — it existed only to say "raw commands
// arrive in stage 2", and they have. looksLikeShell() is the same decision
// without the apology, and it now picks a pipeline instead of refusing one.
test('looksLikeShell: bare commands route to the shell', () => {
  assert.equal(looksLikeShell('dir'), true);
  assert.equal(looksLikeShell('npm install'), true);
  assert.equal(looksLikeShell('git status'), true);
  assert.equal(looksLikeShell('  IPCONFIG /all '), true, 'case and padding must not sneak past');
});

test('looksLikeShell: plain English is never mistaken for a shell command', () => {
  assert.equal(looksLikeShell('what is my day like'), false);
  assert.equal(looksLikeShell('find my compressor manual'), false);
  assert.equal(looksLikeShell(''), false);
  // Deliberately NOT flagged: these are ordinary English that JARVIS handles.
  assert.equal(looksLikeShell('type hello world into notepad'), false);
  assert.equal(looksLikeShell('copy that file to the desktop'), false);
  assert.equal(looksLikeShell('move the invoices into one folder'), false);
  assert.equal(looksLikeShell('echo that back to me'), false);
});
