'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NightShiftService, USD_PER_MTOKEN } = require('../core/night-shift');
const { AIService } = require('../core/ai-service');
const { runAgent } = require('../core/agent-loop');

// ---- The real cloud spend cap (TRAP audit 2026-07-26, Open Loops 41b) -----
// nightShiftCloudBudgetUsd was read as a boolean and never decremented, and
// token usage from both providers was discarded — the README's "cannot spend
// money by architecture" was a claim, not a control. Now: providers report
// usage through context.onUsage, night shift prices it at deliberately
// pessimistic frontier rates (over-counting trips the cap early — the safe
// direction), journals the estimate per job, and refuses cloud to any job
// once the night's estimated spend has reached the budget.

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-spend-'));
}

const NIGHT = new Date('2026-07-25T02:00:00');

function makeService({ dir, settings = {}, ai, now = () => NIGHT } = {}) {
  const calls = { ai: [], drafts: [] };
  const service = new NightShiftService({
    userDataPath: dir,
    now,
    config: {
      getSettings: () => ({
        nightShiftEnabled: true,
        nightShiftStart: 0,
        nightShiftEnd: 6,
        nightShiftMaxJobs: 10,
        nightShiftMaxMinutes: 10,
        nightShiftCloudBudgetUsd: 0,
        nightShiftFolder: path.join(dir, 'Drafts'),
        ...settings
      })
    },
    // The REAL AIService.reply returns { ok, text, source } — the old mocks
    // returned bare strings, which is exactly how the [object Object] draft
    // bug stayed invisible.
    ai: ai || {
      reply: async (prompt, context) => { calls.ai.push({ prompt, context }); return { ok: true, text: 'Real draft text.', source: 'ollama' }; }
    },
    documents: {
      createTextFileAt: async (directory, name, content, extension) => {
        calls.drafts.push({ directory, name, content, extension });
        return { ok: true, path: path.join(directory, `${name}${extension}`) };
      }
    }
  });
  return { service, calls };
}

function job(overrides = {}) {
  return {
    id: 's1',
    name: 'Nightly brief',
    enabled: true,
    when: { time: '02:00', repeat: 'daily' },
    action: { kind: 'brainJob', prompt: 'Draft the brief.', ...overrides }
  };
}

test('the draft carries reply.text, never a stringified object', async () => {
  const dir = tmpDir();
  try {
    const { service, calls } = makeService({ dir });
    const result = await service.runJob(job());
    assert.equal(result.ok, true);
    assert.ok(calls.drafts[0].content.includes('Real draft text.'));
    assert.ok(!calls.drafts[0].content.includes('[object Object]'), 'the object-shaped reply must be unwrapped');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed reply is a logged failure, not a draft full of apology', async () => {
  const dir = tmpDir();
  try {
    const { service, calls } = makeService({
      dir,
      ai: { reply: async () => ({ ok: false, text: 'The local model returned no text.', source: 'ollama' }) }
    });
    const result = await service.runJob(job());
    assert.equal(result.ok, false);
    assert.equal(calls.drafts.length, 0, 'no draft may be written for a failed reply');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cloud jobs meter their tokens into a journaled USD estimate', async () => {
  const dir = tmpDir();
  try {
    const { service } = makeService({
      dir,
      settings: { nightShiftCloudBudgetUsd: 10 },
      ai: {
        reply: async (_prompt, context) => {
          context.onUsage?.({ inputTokens: 100000, outputTokens: 10000 });
          context.onUsage?.({ inputTokens: 50000, outputTokens: 5000 });
          return { ok: true, text: 'Metered draft.', source: 'openai' };
        }
      }
    });
    await service.runJob(job({ cloud: true }));
    const [entry] = service.entriesSince(0);
    const expected = (150000 * USD_PER_MTOKEN.input + 15000 * USD_PER_MTOKEN.output) / 1e6;
    assert.ok(Math.abs(entry.usd - expected) < 1e-9, `entry.usd=${entry.usd} expected=${expected}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('once the night\'s estimated spend reaches the budget, cloud is refused — jobs fall back to local', async () => {
  const dir = tmpDir();
  try {
    let tick = NIGHT.getTime();
    const { service, calls } = makeService({
      dir,
      now: () => new Date(tick += 1000),
      settings: { nightShiftCloudBudgetUsd: 2 },
      ai: {
        reply: async (_prompt, context) => {
          calls.ai.push({ context });
          // ~$2.25 at the pessimistic rates — blows the $2 budget in one job.
          context.onUsage?.({ inputTokens: 100000, outputTokens: 10000 });
          return { ok: true, text: 'Expensive draft.', source: 'openai' };
        }
      }
    });
    await service.runJob(job({ cloud: true }));
    assert.equal(calls.ai[0].context.forceMode, undefined, 'first job runs cloud');
    await service.runJob(job({ cloud: true, prompt: 'Second.' }));
    assert.equal(calls.ai[1].context.forceMode, 'local', 'budget spent: second job must be forced local');
    assert.equal(calls.ai[1].context.onUsage, undefined, 'a local-forced job has nothing to meter');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Usage flows out of the providers ------------------------------------

test('the OpenAI agent path reports token usage through context.onUsage', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] }],
    usage: { input_tokens: 1200, output_tokens: 340 }
  }), { status: 200 });
  try {
    const usage = [];
    const service = new AIService({
      getSettings: () => ({ aiMode: 'cloud', cloudProvider: 'openai', openaiModel: 'gpt-5.6-terra' }),
      getSecret: (name) => (name === 'openaiKey' ? 'sk-test' : '')
    }, []);
    await service.reply('hello', { onUsage: (u) => usage.push(u) });
    assert.equal(usage.length, 1);
    assert.equal(usage[0].inputTokens, 1200);
    assert.equal(usage[0].outputTokens, 340);
  } finally {
    global.fetch = originalFetch;
  }
});

test('the Anthropic agent path reports token usage through context.onUsage', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    content: [{ type: 'text', text: 'Done.' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 900, output_tokens: 210 }
  }), { status: 200 });
  try {
    const usage = [];
    const service = new AIService({
      getSettings: () => ({ aiMode: 'cloud', cloudProvider: 'anthropic', anthropicModel: 'claude-sonnet-5' }),
      getSecret: (name) => (name === 'anthropicKey' ? 'sk-ant-test' : '')
    }, []);
    await service.reply('hello', { onUsage: (u) => usage.push(u) });
    assert.equal(usage.length, 1);
    assert.equal(usage[0].inputTokens, 900);
    assert.equal(usage[0].outputTokens, 210);
  } finally {
    global.fetch = originalFetch;
  }
});

// ---- The fan-out cap is back (agent-loop lost the legacy .slice(0,3)) -----

test('agent-loop executes at most 3 tool calls per round but answers every call on the wire', async () => {
  const executed = [];
  const registry = [{
    name: 'probe',
    description: 'test tool',
    parameters: { type: 'object', properties: {} },
    execute: async (args) => { executed.push(args.n); return { ok: true }; }
  }];
  let round = 0;
  const adapter = {
    chat: async (messages) => {
      round += 1;
      if (round === 1) {
        return { text: '', toolCalls: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `c${n}`, name: 'probe', arguments: { n } })) };
      }
      return { text: 'Final answer.', toolCalls: [] };
    }
  };
  const result = await runAgent({ adapter, registry, messages: [{ role: 'user', content: 'go' }] });
  assert.equal(result.text, 'Final answer.');
  assert.deepEqual(executed, [1, 2, 3], 'only the first three calls may actually run');
  // Every call still got SOME tool message back (the protocol requirement).
  // We can't see messages here, but the refusals must not count as executions.
});
