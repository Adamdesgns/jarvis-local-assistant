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
    // each), but the repeat guard above already decided this round is worth running.
    messages.push({ role: 'assistant', content: turn.text || '', toolCalls: turn.toolCalls });
    for (const call of turn.toolCalls) {
      seen.add(`${call.name}:${JSON.stringify(call.arguments || {})}`);
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
