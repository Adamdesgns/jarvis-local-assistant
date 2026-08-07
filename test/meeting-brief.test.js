const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBrief, buildPrepPrompt, buildAnswerSystem } = require('../core/meeting/meeting-brief');

// The brief is the whole reason this coaching beats a generic chatbot, and it
// is a file Adam maintains by hand — so it will be half-finished, mis-headed,
// or empty at some point. None of those may throw: meeting mode still has to
// start and record. The warnings exist so the panel can say what is missing
// instead of quietly giving generic advice.

const GOOD = `# Business
I build custom JARVIS voice assistants for small businesses.

# Pricing
Setup from $2,500. Monthly support $200.

# Objections
"Too expensive" - point at the labour it replaces.
"We already have Alexa" - Alexa is not local and not private.
`;

test('brief: pulls each heading into a section', () => {
  const brief = parseBrief(GOOD);
  assert.ok(brief.ok);
  assert.match(brief.sections.business, /custom JARVIS voice assistants/);
  assert.match(brief.sections.pricing, /\$2,500/);
  assert.match(brief.sections.objections, /already have Alexa/);
});

test('brief: an empty file is not ok but does not throw', () => {
  const brief = parseBrief('');
  assert.equal(brief.ok, false);
  assert.ok(brief.warnings.length > 0);
});

test('brief: text with no headings is kept as the business section', () => {
  const brief = parseBrief('I sell voice assistants.');
  assert.ok(brief.ok, 'a plain paragraph is still usable');
  assert.match(brief.sections.business, /I sell voice assistants/);
});

test('brief: warns about the sections coaching actually needs', () => {
  const brief = parseBrief('# Business\nI sell things.');
  assert.ok(brief.warnings.some((w) => /pricing/i.test(w)));
  assert.ok(brief.warnings.some((w) => /objections/i.test(w)));
});

test('brief: prep prompt carries the brief and the prospect', () => {
  const prompt = buildPrepPrompt(parseBrief(GOOD), 'Dave at Lucedale Auto');
  assert.match(prompt, /Dave at Lucedale Auto/);
  assert.match(prompt, /\$2,500/, 'pricing reaches the model');
  assert.match(prompt, /open/i, 'asks for an opening');
});

test('brief: prep prompt survives an unknown prospect', () => {
  const prompt = buildPrepPrompt(parseBrief(GOOD), '');
  assert.ok(prompt.length > 0);
  assert.doesNotMatch(prompt, /undefined|null/);
});

test('brief: answer system prompt forbids inventing pricing', () => {
  const sys = buildAnswerSystem(parseBrief(GOOD));
  assert.match(sys, /\$2,500/);
  assert.match(sys, /do not invent/i);
});
