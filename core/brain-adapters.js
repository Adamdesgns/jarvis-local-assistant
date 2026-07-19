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

// Translates the agent loop's provider-agnostic messages to OpenAI's
// /v1/responses wire format and back. gpt-5.6-era models reason by default and
// chat/completions refuses tools+reasoning, so the agent brain lives here now.
// Stateful on purpose: with store:false (nothing kept on OpenAI's servers) the
// model needs its reasoning items replayed each turn, so absorb() remembers
// every round's raw output items and buildRequest() splices them back in.
function openaiResponsesTools(specs = []) {
  return specs.map((spec) => ({
    type: 'function',
    name: spec.function.name,
    description: spec.function.description,
    parameters: spec.function.parameters
  }));
}

class OpenAIResponsesSession {
  constructor() {
    this.rounds = [];   // raw output-item arrays, one per absorbed tool round
  }

  buildRequest(messages, specs, { model } = {}) {
    const instructions = messages.find((m) => m.role === 'system')?.content;
    const input = [];
    let round = 0;
    for (const m of messages) {
      if (m.role === 'system') continue;
      if (m.role === 'tool') {
        input.push({ type: 'function_call_output', call_id: m.toolCallId || `call_${m.name}`, output: String(m.content ?? '') });
      } else if (m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length) {
        const stored = this.rounds[round];
        round += 1;
        if (stored) {
          input.push(...stored);
        } else {
          // Defensive fallback (fresh session replaying old history): rebuild
          // the model's calls from what the loop recorded. No reasoning items
          // to replay in this case — the API accepts plain function_call items.
          if (m.content) input.push({ role: 'assistant', content: m.content });
          for (const c of m.toolCalls) {
            input.push({ type: 'function_call', call_id: c.id || `call_${c.name}`, name: c.name, arguments: JSON.stringify(c.arguments || {}) });
          }
        }
      } else {
        input.push({ role: m.role, content: m.content });
      }
    }
    return {
      model,
      ...(instructions ? { instructions } : {}),
      input,
      ...(specs && specs.length ? { tools: openaiResponsesTools(specs) } : {}),
      max_output_tokens: 900,
      store: false,
      include: ['reasoning.encrypted_content']
    };
  }

  absorb(payload = {}) {
    const items = Array.isArray(payload.output) ? payload.output : [];
    const text = items
      .filter((item) => item.type === 'message')
      .flatMap((item) => item.content || [])
      .filter((part) => part.type === 'output_text')
      .map((part) => part.text)
      .join('').trim();
    const toolCalls = items
      .filter((item) => item.type === 'function_call')
      .map((item) => ({ id: item.call_id, name: item.name, arguments: parseArgs(item.arguments) }));
    if (toolCalls.length) this.rounds.push(items);
    return { text, toolCalls };
  }
}

module.exports = { normalizeOllama, normalizeOpenAI, normalizeAnthropic, anthropicTools, parseArgs, openaiResponsesTools, OpenAIResponsesSession };
