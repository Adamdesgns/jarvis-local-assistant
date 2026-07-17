# Agentic Brain — Sub-project 1 Design Spec

_Date: 2026-07-17 · Status: approved by Adam · Parent:
`2026-07-17-advanced-brain-roadmap.md`_

## Summary
Replace JARVIS's two separate, weak reasoning paths (local's tiny 2-round tool
loop; cloud's no-tools-at-all) with **one provider-agnostic agent loop** that
lets any brain — Ollama, OpenAI, Anthropic — take multiple steps: plan → call a
tool → read the result → decide the next step → repeat → answer. Adds the
read-only tools that make multi-step useful (read a file, read/summarize a
document). Emits a step event per action for a live "thinking" display. The
safety gate is unchanged: destructive actions stay out of the agent's reach.

Parity is the point: local and API run the *same* loop and the *same* tools, so
they can do the same things; only the model's raw ability differs.

## Non-goals (this sub-project)
- No destructive tools and no agent-raised approval cards (a noted future step).
- No web access (sub-project 2, opt-in).
- No polished thinking UI beyond a basic live status line (sub-project 3).
- No new provider; OpenAI + Anthropic + Ollama only.

## Architecture

### `core/agent-loop.js` (new, pure — the heart)
A single async loop, unit-testable against a fake adapter. No Electron, no HTTP.

```
runAgent({ adapter, registry, messages, maxSteps = 8, onStep }) -> { text, usedTools, steps }
```
- Calls `adapter.chat(messages, toolSpecs(registry), { stream })` which returns a
  normalized `{ text, toolCalls: [{ id?, name, arguments }] }`.
- If `toolCalls` is empty → done; return the text.
- Otherwise append the assistant turn, execute each call via the existing
  `executeToolCall(registry, ...)`, append each `{ role: 'tool', ... }` result,
  emit `onStep({ index, tool, args, result })`, and loop.
- **Guards:**
  - Stop after `maxSteps` tool-executing rounds; then make one final call with
    **no tools** to force a text answer (mirrors today's behaviour).
  - **Repeat guard:** if the same `tool + JSON(args)` signature recurs, stop and
    force the final answer — prevents runaway loops and runaway API bills.
  - Unknown tool name → the executor already returns `{ ok:false, error }`; the
    model sees it and recovers.
- Returns `usedTools` (every tool name called, in order) so the router keeps its
  existing state-refresh behaviour (`add_task` → redraw tasks, etc.).

### Provider adapters (in `core/ai-service.js`)
Each provider implements one method returning the normalized shape:
`ollamaTurn`, `openaiTurn`, `anthropicTurn` → `{ text, toolCalls }`.
- **Ollama:** the current streaming NDJSON `chat()` logic, generalized — passes
  `tools` and parses `message.tool_calls`. Streams final-answer text via
  `onChunk`.
- **OpenAI:** `/v1/responses` with `tools`; parse `function_call` items into
  `toolCalls`, feed tool outputs back as `function_call_output` items.
- **Anthropic:** `/v1/messages` with `tools`; parse `tool_use` content blocks;
  feed results back as `tool_result` blocks.
- Adapters own only translation + one HTTP round-trip. All control flow lives in
  `runAgent`, so the three brains cannot drift apart.

### Normalized message shape (internal)
`{ role: 'system'|'user'|'assistant'|'tool', content, toolCalls?, toolCallId? }`.
`runAgent` maintains this list; adapters translate to/from provider wire format.
Conversation continuity (the rolling 12-message `#history`) still records only
the final user⇄assistant exchange, not the intermediate tool chatter.

### `reply()` becomes the front door
`AIService.reply(text, context)` builds the initial messages (system prompt +
history + user), picks the provider (existing `aiMode` / `cloudProvider` logic,
unchanged), and runs `runAgent` with that provider's adapter. Same return shape
as today (`{ ok, source, text, usedTools, detail }`) plus the loop emits
`onStep`. `answerFromDocuments` stays a single grounded call (no tools).

## New tools (`core/tool-registry.js`)
Keep the 7 existing tools; add read-only powers:
- **`read_file`** — read the text of a file inside the approved folders (path
  from a prior `search_files`). Reuses the document engine's text extraction
  (PDF / Word / Excel / text / code), truncated to a safe length. Enforces the
  approved-folder boundary in the main process — the agent can never read
  outside allowed roots.
- **`read_document`** — extract + concisely summarize a document by path (reuse
  `DocumentService`). For "what does this say / what's the total" questions.

Both are read-only. This is what turns *"find my compressor invoice, tell me the
total, and add a task to pay it Friday"* into: `search_files` → `read_document`
→ `add_task` → answer.

## Streaming & UI hook
- **Final-answer text** streams via the existing `onChunk` (intermediate
  tool-deciding turns are suppressed, as today, with `onReset` before the final
  turn).
- **Step events**: `runAgent` calls `context.onStep`; the router forwards them;
  a new `preload.js` `onAgentStep` bridge delivers `{ index, tool, summary }` to
  the renderer, which shows a basic live status ("Reading invoice.pdf…") in both
  skins. Full styling is sub-project 3.

## Safety (unchanged, restated)
- The agent may only call tools in the registry — all read/append-only.
- Destructive actions (delete / send / spend / power) are **not** tools and stay
  gated behind `classifyCommand` + approval cards. If a request implies one, the
  agent surfaces the exact command for the approval card, as today.
- Per-tool timeout (`withTimeout`) and the step cap bound cost and runtime.

## Testing
- **`test/agent-loop.test.js` (pure):** with a scripted fake adapter — executes
  tools in order; stops at `maxSteps` and forces a tool-free final answer; halts
  on a repeated call; returns `usedTools`; passes an unknown-tool error back to
  the model; never invents a tool. No network.
- **Adapter parse tests:** feed each provider a representative raw response
  fixture; assert it normalizes text + tool calls correctly, and formats tool
  results back correctly.
- **Tool tests:** `read_file` / `read_document` return text and **refuse paths
  outside the approved roots**.
- `npm test` green after every change. Manual: on Adam's cloud (OpenAI) brain,
  the invoice-style multi-step request runs end to end and reports truthfully.

## Files
- **New:** `core/agent-loop.js`, `test/agent-loop.test.js`.
- **Modified:** `core/ai-service.js` (adapters + `reply` runs `runAgent`),
  `core/tool-registry.js` (`read_file`, `read_document`), `core/router.js`
  (forward `onStep`), `preload.js` (`onAgentStep`), `src/renderer.js` (basic
  step status), and `src/command-center.js` if the status shows in that skin.

## Rollout
- Branch off `main` (e.g. `agentic-brain`), easy to revert.
- Local brain keeps working; cloud brain gains tools. No push to GitHub.
