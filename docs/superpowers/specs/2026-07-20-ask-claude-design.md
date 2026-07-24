# Ask Claude — design

**Date:** 2026-07-20
**Branch:** `ask-claude`
**Status:** approved in conversation, not yet implemented

## What it is

Adam says **"JARVIS, ask Claude <question>"**. JARVIS passes the question to Claude
Code running on the same PC, reads the answer back aloud, shows it on screen, and
saves the exchange to a text file.

Follow-up questions keep the thread: "ask Claude, what about the battery" continues
the previous conversation rather than starting over.

## What it is not

- **Not a second brain.** This does not replace or fall back to Ollama. Ollama is a
  local model; Claude is a separate service reached over the network. If the network
  or the Claude login is unavailable, "ask Claude" fails with a plain spoken message
  and the rest of JARVIS is unaffected.
- **Not able to change anything.** Claude answers only. It cannot edit files, write
  files, or run commands. This is enforced by CLI flags, not by prompting.
- **Not automatic.** JARVIS never hands off to Claude on his own. Only the explicit
  "ask Claude" phrase triggers it. (Auto-handoff-when-stuck was discussed and
  deliberately deferred.)

## Trigger and routing

Detection lives in `CommandRouter.handle` (`core/router.js:89`), matched **before**
the AI fallback so the question is never answered by the local brain first.

Pattern: `/^(?:jarvis[,\s]*)?ask\s+claude\b[,:]?\s*/i`

The matched prefix is stripped; the remainder is the question. An empty remainder
("ask Claude") gets a spoken prompt asking what he wants to ask, and nothing is sent.

Because the phone talks to the desktop through this same router, "ask Claude" works
from the phone with no extra work. It is worth confirming during testing rather than
assuming.

## The bridge

New module: `core/claude-bridge.js`. One job — run the Claude CLI and return text.

Invocation, via `child_process.spawn` with an **argv array and `shell: false`**:

```
claude -p <question>
  --output-format json
  --disallowedTools Edit,Write,NotebookEdit,Bash,WebFetch
  [--resume <sessionId>]
```

Notes on each decision:

- **argv array, never a shell string.** The question is Adam's own free text and must
  never be interpolated into a command line. This keeps the project's "never run
  model-generated shell" rule intact.
- **`--disallowedTools`** is the answers-only guarantee. Edit/Write/NotebookEdit stop
  file changes; Bash stops command execution; WebFetch is included so a malicious or
  mistaken answer cannot pull remote content into the reply.
- **`--output-format json`** so the reply and the `session_id` come back as structured
  data rather than being scraped from prose.
- **`--resume <sessionId>`** provides the memory Adam asked for.

Working directory: the JARVIS project root, so Claude has useful context if asked
about JARVIS itself. Read-only, per the flags above.

Timeout: 120 seconds. On timeout the child is killed and JARVIS says the request took
too long.

## Memory

The `session_id` returned in the JSON is stored in config (`claudeBridge.sessionId`)
and passed as `--resume` on the next question. It survives app restarts, so a thread
started this morning can be continued tonight.

Reset paths:
- Adam says "ask Claude, new conversation" (or "start over") — clears the stored id.
- A resume that fails because the session no longer exists retries once without
  `--resume` rather than surfacing an error.

## Saved chats

Every exchange appends to `<userData>/claude-chats/YYYY-MM-DD.md`:

```
## 14:32 — Adam
why won't my truck start

## 14:32 — Claude
...answer text...
```

Plain Markdown, one file per day, so it is searchable by JARVIS's own file tools and
readable without the app. Write failures are logged but never block the spoken answer.

## Settings

New toggle in Settings, **off by default**, consistent with Mobile and Schedule.

The settings panel states plainly that questions sent this way leave the PC and go to
Anthropic, and that billing follows whatever the Claude Code login uses — a Claude
subscription includes it; an API key bills per question. Adam should confirm which he
is on before relying on it.

When the toggle is off, "ask Claude" is refused with a spoken explanation of how to
turn it on.

## Errors, spoken plainly

| Cause | What JARVIS says |
|---|---|
| Toggle off | "Ask Claude is switched off. You can turn it on in Settings." |
| CLI missing | "I can't find Claude on this PC." |
| Not logged in / auth failure | "Claude isn't signed in on this PC." |
| Network down | "I couldn't reach Claude — looks like the connection is down." |
| Timeout | "Claude took too long to answer." |

Every failure is written to the Activity log with the underlying error text.

## Unattended and scheduled runs

Refused, matching the existing `unattendedSafe` treatment in `core/tool-registry.js`.
A scheduled task must not be able to spend money or send Adam's data off the PC while
he is asleep. Only a live, owner-issued request reaches the bridge.

## Testing

Standard suite (`npm test`) plus:

1. Router detection — the phrase matches, the prefix is stripped, "ask Claudia" and
   similar near-misses do not match.
2. Empty question is refused without spawning anything.
3. Argument construction — assert the exact argv, including every entry in
   `--disallowedTools`.
4. **Mutation-test the disallowedTools guard.** Delete the flag and confirm a test
   fails. The handoff notes a prior guard that would have passed its tests even if
   removed entirely; do not repeat that.
5. Session id is captured, persisted, and passed as `--resume`; a stale id falls back
   to a fresh session.
6. Transcript is appended in the expected format; a write failure still returns the
   answer.
7. Each error path returns its spoken message and logs the cause.
8. Unattended context is refused.

Renderer changes are additionally checked with the headless boot capture
(`JARVIS_CAPTURE_PATH=<path.png> npm start`), since `npm test` does not load
`src/renderer.js`.

## Deferred, deliberately

- Auto-handoff when the local brain is stuck.
- Letting Claude make changes (file edits, code fixes) with an approval card.
- Streaming the answer as it is generated rather than speaking it when complete.
