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
