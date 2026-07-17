const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOllama, normalizeOpenAI, normalizeAnthropic, anthropicTools } = require('../core/brain-adapters');

test('normalizeOllama: pulls text and tool calls (arguments already objects)', () => {
  const out = normalizeOllama({ content: 'hi', tool_calls: [{ function: { name: 'search_files', arguments: { query: 'invoice' } } }] });
  assert.equal(out.text, 'hi');
  assert.deepEqual(out.toolCalls, [{ id: undefined, name: 'search_files', arguments: { query: 'invoice' } }]);
  assert.deepEqual(normalizeOllama({ content: 'done' }).toolCalls, []);
});

test('normalizeOpenAI: parses tool_calls with string arguments into objects', () => {
  const out = normalizeOpenAI({ content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"/x/i.pdf"}' } }] });
  assert.equal(out.toolCalls[0].name, 'read_file');
  assert.deepEqual(out.toolCalls[0].arguments, { path: '/x/i.pdf' });
  assert.equal(out.toolCalls[0].id, 'call_1');
  assert.equal(normalizeOpenAI({ content: 'answer', tool_calls: [] }).text, 'answer');
});

test('normalizeAnthropic: splits text blocks from tool_use blocks', () => {
  const out = normalizeAnthropic([
    { type: 'text', text: 'Let me check.' },
    { type: 'tool_use', id: 'tu_1', name: 'search_files', input: { query: 'invoice' } }
  ], 'tool_use');
  assert.equal(out.text, 'Let me check.');
  assert.deepEqual(out.toolCalls, [{ id: 'tu_1', name: 'search_files', arguments: { query: 'invoice' } }]);
  assert.deepEqual(normalizeAnthropic([{ type: 'text', text: 'final' }], 'end_turn').toolCalls, []);
});

test('anthropicTools: renames parameters to input_schema', () => {
  const specs = [{ type: 'function', function: { name: 'read_file', description: 'read', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }];
  assert.deepEqual(anthropicTools(specs), [{ name: 'read_file', description: 'read', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }]);
});
