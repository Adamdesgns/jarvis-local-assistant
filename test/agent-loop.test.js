const test = require('node:test');
const assert = require('node:assert/strict');
const { runAgent } = require('../core/agent-loop');

// A fake registry: two read-only tools that record calls.
function fakeRegistry() {
  const calls = [];
  return {
    calls,
    registry: [
      { name: 'search_files', description: 'find', parameters: { type: 'object', properties: {} },
        execute: async (a) => { calls.push(['search_files', a]); return { ok: true, files: [{ name: 'invoice.pdf', path: '/x/invoice.pdf' }] }; } },
      { name: 'read_file', description: 'read', parameters: { type: 'object', properties: {} },
        execute: async (a) => { calls.push(['read_file', a]); return { ok: true, text: 'Total due: $412.50' }; } }
    ]
  };
}

// A scripted adapter: returns queued turns in order.
function scriptAdapter(turns) {
  let i = 0;
  return { chat: async () => turns[Math.min(i++, turns.length - 1)] };
}

test('agent loop: executes tools in order then returns the final answer', async () => {
  const { registry, calls } = fakeRegistry();
  const adapter = scriptAdapter([
    { text: '', toolCalls: [{ name: 'search_files', arguments: { query: 'invoice' } }] },
    { text: '', toolCalls: [{ name: 'read_file', arguments: { path: '/x/invoice.pdf' } }] },
    { text: 'The invoice total is $412.50.', toolCalls: [] }
  ]);
  const steps = [];
  const result = await runAgent({ adapter, registry, messages: [{ role: 'user', content: 'invoice total?' }], onStep: (s) => steps.push(s) });
  assert.equal(result.text, 'The invoice total is $412.50.');
  assert.deepEqual(result.usedTools, ['search_files', 'read_file']);
  assert.deepEqual(calls.map((c) => c[0]), ['search_files', 'read_file']);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].tool, 'search_files');
});

test('agent loop: stops at the step cap and forces a tool-free final answer', async () => {
  const { registry } = fakeRegistry();
  let withToolsCount = 0;
  const adapter = { chat: async (_m, tools) => { if (tools && tools.length) withToolsCount += 1; return tools && tools.length ? { text: '', toolCalls: [{ name: 'search_files', arguments: { q: withToolsCount } }] } : { text: 'done', toolCalls: [] }; } };
  const result = await runAgent({ adapter, registry, messages: [{ role: 'user', content: 'loop' }], maxSteps: 3 });
  assert.equal(result.text, 'done');
  assert.equal(result.steps, 3, 'ran exactly maxSteps tool rounds');
  assert.equal(withToolsCount, 3, 'the forced final call passed no tools');
});

test('agent loop: halts when the model repeats the same tool call', async () => {
  const { registry, calls } = fakeRegistry();
  const adapter = { chat: async (_m, tools) => (tools && tools.length
    ? { text: '', toolCalls: [{ name: 'search_files', arguments: { query: 'same' } }] }
    : { text: 'stopped repeating', toolCalls: [] }) };
  const result = await runAgent({ adapter, registry, messages: [{ role: 'user', content: 'x' }], maxSteps: 8 });
  assert.equal(result.text, 'stopped repeating');
  assert.equal(calls.length, 1, 'the repeated call ran once, then the loop halted');
});

test('agent loop: an unknown tool comes back as an error the model can see', async () => {
  const { registry } = fakeRegistry();
  const seen = [];
  const adapter = { chat: async (messages, tools) => {
    seen.push(messages[messages.length - 1]);
    return tools && tools.length ? { text: '', toolCalls: [{ name: 'nonexistent', arguments: {} }] } : { text: 'recovered', toolCalls: [] };
  } };
  const result = await runAgent({ adapter, registry, messages: [{ role: 'user', content: 'x' }], maxSteps: 4 });
  assert.equal(result.text, 'recovered');
  const toolMsg = seen.find((m) => m.role === 'tool');
  assert.match(JSON.stringify(toolMsg.content), /Unknown tool/);
});

const { buildToolRegistry, executeToolCall } = require('../core/tool-registry');

test('read_file: returns document text and refuses paths outside approved roots', async () => {
  const reads = [];
  const documents = {
    readDocument: async (p) => {
      if (p.includes('secret')) throw new Error('That document is outside your approved folders.');
      reads.push(p);
      return { name: 'invoice.pdf', text: 'Total due: $412.50', truncated: false };
    }
  };
  const registry = buildToolRegistry({ tools: {}, tasks: {}, memory: {}, config: {}, documents });
  const tool = registry.find((t) => t.name === 'read_file');
  assert.ok(tool, 'read_file tool exists');

  const ok = await executeToolCall(registry, { function: { name: 'read_file', arguments: { path: '/approved/invoice.pdf' } } });
  assert.equal(ok.ok, true);
  assert.match(ok.text, /412\.50/);

  const denied = await executeToolCall(registry, { function: { name: 'read_file', arguments: { path: '/secret/passwords.txt' } } });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /approved folders/);
});
