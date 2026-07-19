# OpenAI Agent Brain → /v1/responses Migration

**Date:** 2026-07-18 · **Branch:** `openai-responses` (off `mobile-companion`)
**Status:** Approved by Adam ("We need the real fix. Make it happen")

## Problem

OpenAI's gpt-5.6 models (`luna`, `terra`) now run with reasoning enabled by
default, and `/v1/chat/completions` rejects **function tools + reasoning**
outright:

> Function tools with reasoning_effort are not supported for gpt-5.6-terra in
> /v1/chat/completions. To use function tools, use /v1/responses or set
> reasoning_effort to 'none'.

Both of Adam's models fail identically. Setting `reasoning_effort: 'none'`
would lobotomize the models; the real fix is the endpoint OpenAI names:
`/v1/responses`, which runs tools *and* reasoning together. JARVIS's
single-shot `openaiReply` already uses `/v1/responses` (no tools) — this
migrates the **agent** path.

## Design

The agent loop (`core/agent-loop.js`) stays untouched — it is provider-
agnostic and speaks `{role, content, toolCalls, toolCallId}` messages. All
translation lives in a new pure class in `core/brain-adapters.js`:

```
class OpenAIResponsesSession {
  buildRequest(messages, specs, { model })  → request body for /v1/responses
  absorb(payload)                            → { text, toolCalls }  (+ stores raw items)
}
```

- **Request shape:** `{ model, instructions, input, tools?, max_output_tokens:
  900, store: false, include: ['reasoning.encrypted_content'] }`.
  - `instructions` ← the system message.
  - `input` ← ordered walk of the remaining messages: user/assistant text →
    `{role, content}`; assistant-with-toolCalls → the **raw output items**
    (reasoning + function_call + message) captured from the response that
    produced it; tool results → `{type:'function_call_output', call_id,
    output}`.
  - `tools` ← flat `{type:'function', name, description, parameters}` (the
    Responses API does NOT nest under `function` like chat/completions).
    Omitted when the loop forces a tool-free final answer.
- **Reasoning replay:** with `store: false` (privacy — nothing retained on
  OpenAI's servers), reasoning models require their reasoning items back on
  the next turn. `include: ['reasoning.encrypted_content']` makes those items
  replayable; `absorb()` stores each response's raw output items per round,
  and `buildRequest()` splices round *i*'s items in place of the *i*-th
  assistant-with-toolCalls message. Fallback (no stored round — defensive):
  synthesize `function_call` items from the message's toolCalls.
- **Response normalize:** text = all `message`→`output_text` parts joined;
  toolCalls = `function_call` items → `{id: call_id, name, arguments:
  parseArgs(arguments)}`.
- **`core/ai-service.js`:** `#openaiAgent` creates one session per request;
  `#openaiChat(settings, apiKey, session, messages, specs)` becomes a thin
  fetch: `session.buildRequest` → POST `/v1/responses` (120 s timeout —
  reasoning models think longer) → `session.absorb`. The
  `max_completion_tokens`/`max_tokens` retry dance dies with the old endpoint.

## Unchanged

Ollama and Anthropic agent paths; grounded doc Q&A; `testCloud`; the
single-shot `openaiReply`; agent-step streaming; mobile server (it calls
`router.handle` → same fixed brain).

## Testing

- `test/brain-adapters.test.js`: session request shape (first turn + tool
  round-trip incl. reasoning replay and `function_call_output` pairing),
  normalize, flat tools, fallback synthesis.
- `test/brain-openai.test.js`: rewritten — mocked fetch asserts the
  `/v1/responses` endpoint, `max_output_tokens`, `store:false`, and a full
  two-round tool flow through the public `reply()`.
- Full `npm test` green; live verification is Adam's multi-step cloud test.
