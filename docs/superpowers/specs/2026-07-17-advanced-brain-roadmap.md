# Advanced Brain — Roadmap / Vision Map

_Date: 2026-07-17 · Status: approved program (decomposition only; each
sub-project gets its own spec → plan → build)_

## Goal
Make JARVIS "the most advanced AI possible" — both **smarter** (best reasoning
available) and a **doer** (multi-step actions), with **full parity between the
local and API brains**. Adam runs API (Claude/OpenAI) because of a GPU
bottleneck, but local (Ollama) and API must be able to do the *same things* when
this is done — the only difference is the underlying model's raw ability.

## The one principle that governs all of it
**One provider-agnostic agent loop; both brains plug into it.** There is a single
multi-step loop (plan → call a tool → read the result → decide → repeat →
answer). Each provider — Ollama, OpenAI, Anthropic — supplies only a thin
**adapter** that translates one round-trip to/from its tool-use format. Because
there is literally one loop and one tool registry, local and API get identical
capabilities by construction. The **safety gate is unchanged**: destructive
actions (delete / send / spend / power) stay out of the agent's tools and only
happen through the existing approval cards.

## Where the brain is today (the gap this closes)
- The **cloud brain has no tools at all** — in cloud mode JARVIS can only talk,
  never act. (Adam runs cloud-only, so today his JARVIS cannot take actions.)
- The **local brain** has a tiny tool loop: a hard 2-round / 3-call cap and just
  7 read/append-only tools. It can *find* a file but cannot *read* one.

## Sub-projects (each its own spec → plan → build)

### 1. Agentic loop + core read tools  ← building first
The foundation and the biggest single leap. A unified multi-step tool loop that
works on Ollama, OpenAI, and Anthropic alike, raising the 2-round cap to ~8
steps with a repeat/loop guard. Adds the read powers that make multi-step
useful: read a file's contents, read/summarize a document, richer task/note
lookups. Emits a step event per action so the UI can later show the work.
Destructive actions stay out. **Why first:** it turns the cloud brain from a
chatbot into an assistant that does things, and establishes the loop everything
else builds on. Own spec: `2026-07-17-agentic-brain-design.md`.

### 2. Richer tools
Grow the read-only toolset once the loop exists: deeper file/document tools,
system/status info, current date/time details, and — opt-in, privacy-flagged —
web lookups. Each tool is small and independently testable.

### 3. "Thinking" UI
Stream the plan and each step live ("Searching files… Reading invoice.pdf…
Adding task…") in both skins, so the multi-step work is visible and trustworthy.
Sub-project 1 already emits the events; this makes them shine.

### 4. Local-brain parity polish
Tune the loop for the smaller local model (prompting, step budget, model
guidance) so free/local users get the same behaviours within qwen3:8b's ceiling.

## Related / future (noted, not in this program's first pass)
- **Scheduled tasks** (Adam wants this next) — run routines or an agent task on a
  timer / cron-like schedule. This is autonomy slice 3 from the autonomy
  roadmap; it pairs naturally with the agent loop (a schedule can trigger an
  agent run). Its own spec when we get there.
- **Agent-raised approval cards** — let the agent itself propose a destructive
  step mid-task that raises an approval card (instead of only telling the user
  the command). A great capability, deferred to keep sub-project 1 safe and
  shippable.

## Recommended order & why
**1 → 3 → 2 → 4.** 1 delivers the multi-step doer on the strong cloud brain
(the headline win). 3 makes that work visible and impressive with little extra
code. 2 deepens what the agent can do. 4 lifts the free local experience. Then
scheduled tasks as its own project.

## What already exists to reuse
- The brain entry point `AIService.reply` and its return shape
  (`{ ok, source, text, usedTools }`) — `core/ai-service.js`.
- The tool registry + safe executor — `core/tool-registry.js`
  (`buildToolRegistry`, `toolSpecs`, `executeToolCall`, `withTimeout`).
- The document engine for read/summarize — `core/document-service.js`.
- The streaming hooks the router already passes (`onChunk`, `onReset`) and the
  `usedTools`-driven UI refresh — `core/router.js:378-385`.
- The safety gate + approval cards — `core/security.js`, `core/router.js`.
