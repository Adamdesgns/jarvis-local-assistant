const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOllama, normalizeOpenAI, normalizeAnthropic, anthropicTools, OpenAIResponsesSession } = require('../core/brain-adapters');

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

const SPECS = [{ type: 'function', function: { name: 'read_file', description: 'read', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }];

test('responses session: first request carries instructions, input, flat tools, stateless flags', () => {
  const session = new OpenAIResponsesSession();
  const body = session.buildRequest(
    [{ role: 'system', content: 'You are JARVIS.' }, { role: 'user', content: 'read my pdf' }],
    SPECS, { model: 'gpt-5.6-terra' }
  );
  assert.equal(body.model, 'gpt-5.6-terra');
  assert.equal(body.instructions, 'You are JARVIS.');
  assert.deepEqual(body.input, [{ role: 'user', content: 'read my pdf' }]);
  // Responses API tools are FLAT — no nested `function` wrapper.
  assert.deepEqual(body.tools, [{ type: 'function', name: 'read_file', description: 'read', parameters: SPECS[0].function.parameters }]);
  assert.equal(body.store, false);
  assert.deepEqual(body.include, ['reasoning.encrypted_content']);
  assert.equal(typeof body.max_output_tokens, 'number');
  // Tool-free final turn omits tools entirely.
  assert.equal('tools' in session.buildRequest([{ role: 'user', content: 'hi' }], [], { model: 'm' }), false);
});

test('responses session: absorb() normalizes function calls + text and replays raw items next turn', () => {
  const session = new OpenAIResponsesSession();
  const messages = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'read my pdf' }];
  session.buildRequest(messages, SPECS, { model: 'm' });
  const reasoningItem = { type: 'reasoning', id: 'rs_1', encrypted_content: 'opaque…' };
  const callItem = { type: 'function_call', id: 'fc_1', call_id: 'call_9', name: 'read_file', arguments: '{"path":"/x/i.pdf"}' };
  const turn = session.absorb({ output: [reasoningItem, callItem] });
  assert.equal(turn.text, '');
  assert.deepEqual(turn.toolCalls, [{ id: 'call_9', name: 'read_file', arguments: { path: '/x/i.pdf' } }]);

  // The agent loop appends the assistant turn + tool result, then calls again.
  messages.push({ role: 'assistant', content: '', toolCalls: turn.toolCalls });
  messages.push({ role: 'tool', toolCallId: 'call_9', name: 'read_file', content: '{"ok":true,"text":"an invoice"}' });
  const body2 = session.buildRequest(messages, SPECS, { model: 'm' });
  assert.deepEqual(body2.input, [
    { role: 'user', content: 'read my pdf' },
    reasoningItem,                                   // reasoning replayed verbatim (required with store:false)
    callItem,                                        // the model's own call replayed
    { type: 'function_call_output', call_id: 'call_9', output: '{"ok":true,"text":"an invoice"}' }
  ]);

  // Final text turn.
  const final = session.absorb({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'It is an invoice.' }] }] });
  assert.equal(final.text, 'It is an invoice.');
  assert.deepEqual(final.toolCalls, []);
});

test('responses session: without a stored round it synthesizes function_call items from toolCalls', () => {
  const session = new OpenAIResponsesSession();
  const body = session.buildRequest([
    { role: 'user', content: 'go' },
    { role: 'assistant', content: 'checking', toolCalls: [{ id: 'call_2', name: 'add_task', arguments: { title: 'x' } }] },
    { role: 'tool', toolCallId: 'call_2', name: 'add_task', content: '{"ok":true}' }
  ], [], { model: 'm' });
  assert.deepEqual(body.input, [
    { role: 'user', content: 'go' },
    { role: 'assistant', content: 'checking' },
    { type: 'function_call', call_id: 'call_2', name: 'add_task', arguments: '{"title":"x"}' },
    { type: 'function_call_output', call_id: 'call_2', output: '{"ok":true}' }
  ]);
});
