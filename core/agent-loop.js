const { toolSpecs, executeToolCall } = require('./tool-registry');

// Provider-agnostic multi-step tool loop. The adapter does one round-trip and
// returns { text, toolCalls }; all control flow (cap, repeat guard, tool
// execution, forcing a final answer) lives here so every brain behaves alike.
async function runAgent({ adapter, registry, messages, maxSteps = 8, onStep }) {
  const specs = toolSpecs(registry || []);
  const seen = new Set();
  const usedTools = [];
  let steps = 0;

  // First turn: tools available.
  let turn = await adapter.chat(messages, specs, { stream: false });

  while (Array.isArray(turn.toolCalls) && turn.toolCalls.length && steps < maxSteps) {
    // Repeat guard: if every proposed call was already made, stop looping and
    // force a final tool-free answer instead of returning the empty tool turn.
    const fresh = turn.toolCalls.filter((call) => !seen.has(`${call.name}:${JSON.stringify(call.arguments || {})}`));
    if (!fresh.length) { turn = await adapter.chat(messages, [], { stream: true }); break; }

    // Respond to EVERY call in the turn (OpenAI/Anthropic require a result for
    // each), but EXECUTE at most three per round — the fan-out cap the legacy
    // single-shot path always had. Calls past the cap get an honest refusal
    // result instead of silence, so the model can re-issue what still matters
    // next round while a runaway turn can't fan out into unbounded work.
    messages.push({ role: 'assistant', content: turn.text || '', toolCalls: turn.toolCalls });
    for (const [index, call] of turn.toolCalls.entries()) {
      seen.add(`${call.name}:${JSON.stringify(call.arguments || {})}`);
      const outcome = index < 3
        ? await executeToolCall(registry, { function: { name: call.name, arguments: call.arguments || {} } })
        : { ok: false, error: 'Fan-out cap: only the first 3 tool calls in a round run. Re-issue this call next round if it still matters.' };
      if (index < 3) usedTools.push(call.name);
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
