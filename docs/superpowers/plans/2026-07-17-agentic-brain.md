# Agentic Brain (Sub-project 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every brain (Ollama, OpenAI, Anthropic) one provider-agnostic multi-step agent loop plus a read-file tool, so JARVIS can chain actions ("find the invoice, read the total, add a task") on whichever model the user runs.

**Architecture:** A pure `runAgent()` loop drives tool use; each provider supplies a thin adapter with pure normalize/format helpers (unit-tested against fixtures) plus one HTTP round-trip. `AIService.reply()` picks the provider and runs the loop. Destructive actions stay out of the registry.

**Tech Stack:** Node `node:test`, Electron main-process services, existing `fetch`. No new dependencies.

## Global Constraints

- Parity: local and API run the SAME loop and SAME tools; only model ability differs.
- Safety unchanged: the agent may only call registry tools (all read/append-only); destructive actions stay gated behind `classifyCommand` + approval cards.
- Step cap: at most 8 tool-executing rounds, then one final tool-free answer. Halt on a repeated `tool+args` signature.
- `read_file` must refuse any path outside the approved roots (`DocumentService.isAllowed`).
- `AIService.reply` keeps its return shape: `{ ok, source, text, usedTools, detail }`.
- Pure translation logic (normalize/format) must be unit-testable with no network.
- Run `npm test` after every change; green before each commit. Branch `agentic-brain` only. No push to GitHub.
- Code style: CommonJS, 2-space indent, single quotes.

---

### Task 1: The agent loop (`core/agent-loop.js`)

**Files:**
- Create: `core/agent-loop.js`
- Test: `test/agent-loop.test.js`

**Interfaces:**
- Consumes: `executeToolCall(registry, call)` and `toolSpecs(registry)` from `core/tool-registry.js`.
- Produces: `runAgent({ adapter, registry, messages, maxSteps=8, onStep }) -> Promise<{ text, usedTools, steps }>`. `adapter` is `{ chat(messages, tools, opts) -> { text, toolCalls: [{ id?, name, arguments }] } }`. `arguments` is an object. Appends assistant/tool turns to `messages` (caller may inspect).

- [ ] **Step 1: Write the failing tests**

Create `test/agent-loop.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../core/agent-loop'`.

- [ ] **Step 3: Implement**

Create `core/agent-loop.js`:

```js
const { toolSpecs, executeToolCall } = require('./tool-registry');

// Provider-agnostic multi-step tool loop. The adapter does one round-trip and
// returns { text, toolCalls }; all control flow (cap, repeat guard, tool
// execution, forcing a final answer) lives here so every brain behaves alike.
async function runAgent({ adapter, registry, messages, maxSteps = 8, onStep }) {
  const specs = toolSpecs(registry);
  const seen = new Set();
  const usedTools = [];
  let steps = 0;

  // First turn: tools available.
  let turn = await adapter.chat(messages, specs, { stream: false });

  while (Array.isArray(turn.toolCalls) && turn.toolCalls.length && steps < maxSteps) {
    // Repeat guard: if every proposed call was already made, stop and answer.
    const fresh = turn.toolCalls.filter((call) => !seen.has(`${call.name}:${JSON.stringify(call.arguments || {})}`));
    if (!fresh.length) break;

    messages.push({ role: 'assistant', content: turn.text || '', toolCalls: turn.toolCalls });
    for (const call of fresh) {
      const signature = `${call.name}:${JSON.stringify(call.arguments || {})}`;
      seen.add(signature);
      const outcome = await executeToolCall(registry, { function: { name: call.name, arguments: call.arguments || {} } });
      usedTools.push(call.name);
      messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify(outcome) });
      if (typeof onStep === 'function') onStep({ index: steps, tool: call.name, args: call.arguments || {}, result: outcome });
    }
    steps += 1;
    // Next turn: keep tools until the cap; the final call is tool-free to force text.
    turn = await adapter.chat(messages, steps < maxSteps ? specs : [], { stream: true });
  }

  return { text: String(turn.text || '').trim(), usedTools, steps };
}

module.exports = { runAgent };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/agent-loop.js test/agent-loop.test.js
git commit -m "feat(brain): provider-agnostic multi-step agent loop (unit-tested)"
```

---

### Task 2: `read_file` tool

**Files:**
- Modify: `core/tool-registry.js` (add tool; add `documents` to deps)
- Modify: `main.js` (pass `documents` into `buildToolRegistry`)
- Test: `test/agent-loop.test.js` (append a registry test) — or `test/core.test.js`; use `test/agent-loop.test.js`.

**Interfaces:**
- Consumes: `DocumentService.readDocument(path, maxChars)` → `{ text, truncated, name }`, which throws for paths outside approved roots.
- Produces: registry tool `read_file` with `{ path: string }`, returning `{ ok, text, truncated, name }` or `{ ok:false, error }`.

- [ ] **Step 1: Write the failing test**

Append to `test/agent-loop.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `read_file tool exists` assertion fails (tool undefined).

- [ ] **Step 3: Implement**

In `core/tool-registry.js`, change the signature and add the tool. Update the destructure:

```js
function buildToolRegistry({ tools, tasks, memory, config, documents }) {
```

Add this tool object to the `registry` array (after `search_files`):

```js
    {
      name: 'read_file',
      description: 'Read the text contents of a file inside the approved folders (use a path from search_files). Reads PDF, Word, Excel, CSV, text, and code.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Full path to the file, from search_files' } },
        required: ['path']
      },
      execute: async (args) => {
        if (!documents || typeof documents.readDocument !== 'function') return { ok: false, error: 'Reading files is unavailable.' };
        try {
          const doc = await documents.readDocument(String(args.path || ''), 8000);
          return { ok: true, name: doc.name, text: doc.text, truncated: doc.truncated };
        } catch (error) {
          return { ok: false, error: error.message };
        }
      }
    },
```

In `main.js`, find `buildToolRegistry({ tools, tasks, memory, config })` and add `documents`:

```js
  ai = new AIService(config, buildToolRegistry({ tools, tasks, memory, config, documents }));
```

(`documents` is constructed just above this line in `app.whenReady`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/tool-registry.js main.js test/agent-loop.test.js
git commit -m "feat(brain): read_file tool (approved-folder text extraction) via the document engine"
```

---

### Task 3: Provider translation helpers (`core/brain-adapters.js`)

**Files:**
- Create: `core/brain-adapters.js`
- Test: `test/brain-adapters.test.js`

**Interfaces:**
- Produces pure functions (no network):
  - `normalizeOllama(message) -> { text, toolCalls }`
  - `normalizeOpenAI(message) -> { text, toolCalls }`
  - `normalizeAnthropic(content, stopReason) -> { text, toolCalls }`
  - `anthropicTools(specs) -> [{ name, description, input_schema }]`
- `toolCalls` entries are `{ id?, name, arguments(object) }`. Translating the internal `{role, content, toolCalls, toolCallId, name}` message list to each provider's wire format is done inline inside each adapter in Task 4 (kept next to that provider's HTTP call), not as a separate helper here.

- [ ] **Step 1: Write the failing tests**

Create `test/brain-adapters.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../core/brain-adapters'`.

- [ ] **Step 3: Implement**

Create `core/brain-adapters.js`:

```js
// Pure translation between the internal agent-loop shapes and each provider's
// tool-use wire format. No network here — HTTP lives in ai-service.js.

function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return {}; } }
  return {};
}

function normalizeOllama(message = {}) {
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.map((call) => ({ id: call.id, name: call.function?.name, arguments: parseArgs(call.function?.arguments) }))
    : [];
  return { text: String(message.content || ''), toolCalls };
}

function normalizeOpenAI(message = {}) {
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.map((call) => ({ id: call.id, name: call.function?.name, arguments: parseArgs(call.function?.arguments) }))
    : [];
  return { text: String(message.content || ''), toolCalls };
}

function normalizeAnthropic(content = [], stopReason) {
  const blocks = Array.isArray(content) ? content : [];
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const toolCalls = stopReason === 'tool_use'
    ? blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, arguments: b.input || {} }))
    : [];
  return { text, toolCalls };
}

function anthropicTools(specs = []) {
  return specs.map((spec) => ({
    name: spec.function.name,
    description: spec.function.description,
    input_schema: spec.function.parameters
  }));
}

module.exports = { normalizeOllama, normalizeOpenAI, normalizeAnthropic, anthropicTools, parseArgs };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/brain-adapters.js test/brain-adapters.test.js
git commit -m "feat(brain): pure provider translation helpers (ollama/openai/anthropic tool formats)"
```

---

### Task 4: Wire adapters into `AIService.reply` via `runAgent`

**Files:**
- Modify: `core/ai-service.js`

**Interfaces:**
- Consumes: `runAgent` (Task 1), `normalizeOllama/OpenAI/Anthropic`, `anthropicTools` (Task 3), `toolSpecs` (registry).
- Produces: `reply()` runs the agent loop for whichever provider is selected; returns `{ ok, source, text, usedTools, detail }`; passes `context.onStep` through.

- [ ] **Step 1: Add adapter builders and rewire `reply` (no unit test — network path; covered by manual test + the pure loop/adapters already tested)**

At the top of `core/ai-service.js` add:

```js
const { runAgent } = require('./agent-loop');
const { normalizeOllama, normalizeOpenAI, normalizeAnthropic, anthropicTools } = require('./brain-adapters');
```

Add three adapter builders as methods on `AIService`. Each returns `{ chat(messages, specs, opts) }`. Ollama reuses the existing streaming `chat` internals; OpenAI uses `/v1/chat/completions` with tools; Anthropic uses `/v1/messages` with tools. Each converts the internal message list to its wire format inline (system message first; `toolCallId`/`name` on tool turns), calls the endpoint, and returns the matching `normalize*` result. Stream only the final (tool-free) turn's text via `opts.stream && context.onChunk`.

Then make `reply()` build the initial `messages` (`[{role:'system',...}, ...history, {role:'user', content:text}]`) and, based on `aiMode`/provider, call `runAgent({ adapter, registry: this.registry, messages, onStep: context.onStep })`. Keep the existing mode/fallback logic (cloud → local on failure). Record the final exchange with `#remember`. If `this.registry` is null (no tools wired), fall back to a single tool-free call so document/grounded paths are unaffected.

_(The full adapter code is written during implementation against the live endpoints; the risky logic — loop control and format translation — is already unit-tested in Tasks 1 and 3. Keep each adapter's HTTP body faithful to the current `localReply`/`anthropicReply`/`openaiReply` request shapes, adding only the `tools` field and the tool-turn/result messages.)_

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: PASS (existing suites unaffected; loop + adapters covered).

- [ ] **Step 3: Verify the app still boots**

PowerShell: `$env:JARVIS_CAPTURE_PATH="$env:TEMP\brain-boot.png"; npm start; $env:JARVIS_CAPTURE_PATH=$null` → PNG written, no boot error.

- [ ] **Step 4: Commit**

```bash
git add core/ai-service.js
git commit -m "feat(brain): reply() runs the agent loop across ollama, openai, and anthropic"
```

---

### Task 5: Stream step events to the UI

**Files:**
- Modify: `core/router.js` (forward `onStep`)
- Modify: `preload.js` (`onAgentStep` bridge)
- Modify: `src/renderer.js` (basic live status), `main.js` (`sendEverywhere('agent:step', ...)` wiring if the router needs an emit)

**Interfaces:**
- Consumes: `context.onStep` from `runAgent`.
- Produces: `agent:step` events `{ index, tool, summary }` on the renderer; a basic status line ("Reading invoice.pdf…").

- [ ] **Step 1: Forward onStep from the router**

In `core/router.js` where `this.ai.reply(text, { ... onChunk, onReset ... })` is called (~line 378), add an `onStep` that emits via the router's stream/emit. Reuse the existing `stream` object the router already builds for `onChunk`/`onReset`; add `onStep: (s) => stream.onStep?.(s)` and have the main-process stream wiring call `sendEverywhere('agent:step', { index: s.index, tool: s.tool, summary: summarizeStep(s) })`. `summarizeStep` maps a tool name + args to a short human phrase (e.g. `read_file` + path → `Reading <basename>…`).

- [ ] **Step 2: Preload bridge**

In `preload.js` add: `onAgentStep: (callback) => on('agent:step', callback),`

- [ ] **Step 3: Renderer status**

In `src/renderer.js`, subscribe: `window.jarvis.onAgentStep((s) => pushTimeline(s.summary));` (reuse the existing `pushTimeline` action strip). If `command-center.js` has an equivalent status area, mirror it there.

- [ ] **Step 4: Run tests + boot check**

Run: `npm test` (PASS). Boot check as in Task 4.

- [ ] **Step 5: Commit**

```bash
git add core/router.js preload.js src/renderer.js main.js
git commit -m "feat(brain): stream each agent step to the UI as a live status line"
```

---

### Task 6: Changelog + verification

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Changelog entry** (mirror the existing Unreleased format):

```markdown
### Added — Agentic brain (multi-step tools on every model)
- JARVIS can now take several steps from one request — search, read a file, then act — on the local brain AND the cloud brain (previously the cloud brain had no tools at all).
- New: it can read a file's contents (approved folders only), not just find it.
- Each step shows as a live status line. Destructive actions still only happen through approval cards.
```

- [ ] **Step 2: Full verification**

Run: `npm test` (all green). Manual on Adam's cloud (OpenAI) brain: a request like "find my newest PDF in Downloads, tell me what it's about, and add a task to review it" runs search → read → add_task and reports truthfully; confirm the step status appears; confirm nothing destructive can be triggered.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for the agentic brain"
```

---

## Manual verification for Adam (real cloud brain)
1. Ask a multi-step question ("find my compressor invoice, tell me the total, add a task to pay it Friday").
2. Watch the step status: Searching… → Reading… → Adding task…
3. Confirm the answer is truthful and the task actually appears.
4. Confirm a destructive ask ("delete that file") still shows the approval card, not silent action.
5. Switch to the local brain (Ollama) and confirm the same request does the same thing (slower, smaller model).
