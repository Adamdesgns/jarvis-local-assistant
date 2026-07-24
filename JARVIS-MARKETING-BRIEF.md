# JARVIS — Marketing Brief

A source-of-truth brief for any chat/writer producing marketing for JARVIS
(landing pages, ads, social posts, store copy, email). Everything here is
grounded in the real product. **Stay inside the "Honest claims" guardrails in
§8 — the target audience is privacy-savvy and will punish hype.**

---

## 1. One-liner / elevator pitch
**JARVIS is a private, JARVIS-style AI assistant that runs entirely on your own
Windows PC** — voice, files, tasks, and reasoning, with no account, no
subscription, and no data leaving your machine unless you explicitly choose it.

Longer: *Say "Hey Jarvis" and get a cinematic desktop assistant that manages
your tasks, finds and reads your files, answers questions about your own
documents, and talks with you — all processed locally. Optional cloud AI is
available only if you add your own key. Your data lives in one folder you
control.*

## 2. Category & positioning
A **local-first desktop AI assistant** for Windows. It sits between:
- Cloud voice assistants (Alexa / Google) — but **private and offline-capable**.
- Subscription AI copilots (Copilot / ChatGPT desktop) — but **no subscription,
  no account, and your files never get uploaded**.

**Positioning statement:** *For privacy-conscious Windows users who want a
capable AI assistant without Big Tech surveillance or monthly fees, JARVIS is a
local-first desktop assistant that keeps your voice, files, and data on your own
machine — unlike cloud assistants that require an account and send your data
away.*

## 3. Target audiences (in priority order)
1. **Privacy-first power users** — people who actively avoid cloud/telemetry and
   want AI that runs on their own hardware.
2. **Makers, tradespeople & hobbyists** — workshop/DIY/engineering types who want
   quick hands-free help finding files, reading manuals/specs, and tracking
   recurring tasks (e.g. "remind me to drain the compressor every morning").
3. **Small-business & solo operators** — want local help with documents,
   invoices, project notes, and reminders without another SaaS bill.
4. **Tinkerers & self-hosters** — enjoy local LLMs (Ollama), open tools, and
   owning their stack. Natural early adopters and word-of-mouth engine.

## 4. Core value propositions (lead with these)
1. **Private by architecture, not policy.** Voice recognition, wake word, and the
   default brain run on-device. No account, no telemetry. Your data sits in one
   folder you can back up or delete.
2. **No subscription.** Free local mode is the default. Optional cloud brains use
   *your own* prepaid API key, encrypted locally and removable anytime.
3. **It actually does things.** Tasks with reminders, a morning briefing, file
   search across folders you approve, reads & summarizes your documents, and
   answers questions about them with citations to the exact page.
4. **Safe by design.** It sends nothing, spends nothing, and runs no shell
   commands on its own; deletions go to the Recycle Bin and always ask first.
5. **It feels amazing.** A cinematic amber "holographic" interface and a floating
   orb — the sci-fi assistant feeling, on a real, useful tool.

## 5. Feature list (translate features → benefits in copy)
- **"Hey Jarvis" wake word + push-to-talk** — hands-free, 100% on-device.
- **Local speech recognition** (faster-whisper) + spoken replies in Windows voices.
- **Local brain via Ollama** (default) — open-ended conversation, no cloud needed.
- **Optional cloud brains** — Claude (Anthropic) or OpenAI with your own key;
  encrypted with Windows secure storage; removable.
- **Tasks & reminders** — priorities, due dates, repeats; desktop notifications.
- **Morning briefing** — tasks due, overdue items, latest note, PC status.
- **Searchable memory & saved routines** (e.g. a "Start work" routine).
- **File search across folders you approve — nowhere else.**
- **Reads & summarizes** PDF, Word, Excel, CSV, and text.
- **Ask your documents** — answers only from your files, cited to the page.
- **Built-in explorer** — pinned folders, recent files, folder watching, safe
  organizing.
- **"Look at my screen"** — describes your screen via the cloud brain, always
  behind a red on-screen "viewing" indicator.
- **Backup & restore** — export/import your data; API keys are never exported.
- **All data in one folder** you can back up, export, or delete.

## 6. Differentiators (the "why us")
- **Runs on your PC, not the cloud** — the headline difference.
- **No account, no subscription, no telemetry.**
- **You own the data** — one local folder, fully portable.
- **Your choice of brain** — free local, or bring-your-own-key cloud. Never a
  bundled subscription; a ChatGPT subscription is *not* required (and wouldn't
  even apply — cloud mode uses pay-as-you-go API credits).
- **Cinematic experience** — an emotional hook competitors don't offer.

## 7. Brand voice & aesthetic
- **Voice:** confident, warm, plainspoken, a little cinematic. Respects the
  reader's intelligence and their privacy. Not hypey, not corporate.
- **Aesthetic:** dark UI, **amber/gold holographic** glow, sci-fi-console feel.
  Lean into the "your own JARVIS" fantasy — grounded in a genuinely useful tool.
- **Tagline candidates** (test these):
  - "Your own JARVIS. On your PC. Not in the cloud."
  - "Say 'Hey Jarvis.' Everything stays on your machine."
  - "A private AI assistant that answers to you — and no one else."
  - "The assistant that doesn't phone home."

## 8. Honest claims — GUARDRAILS (do not cross)
Marketing must stay truthful; this audience checks. **Do NOT claim:**
- ❌ "Fully autonomous / does everything for you." It asks before anything
  sensitive; today it's assistive, not self-driving. Say "assistant," not "agent
  that runs your life."
- ❌ "100% offline for everything." The **default** experience is local; the
  *optional* cloud brain and "look at my screen" require your own API key and do
  send that specific data to the provider you chose. Be precise: *local by
  default; cloud only if you opt in with your own key.*
- ❌ "Works out of the box with zero setup." Local conversation needs **Ollama**
  installed; answer quality depends on the model and the user's hardware.
- ❌ Hiding the unsigned-app reality. It's an unsigned free app, so **Windows
  SmartScreen shows an "unknown publisher" warning** — frame this transparently
  ("free and unsigned; verify the SHA-256 we publish"), don't pretend it's absent.
- ❌ "Single-word 'Jarvis' wake word." The wake phrase is **"Hey Jarvis."**
- ❌ Claiming the **camera module** is available. It's built but **still in
  testing (Ring/Blink/Nest/RTSP) and not yet released** — at most tease it as
  "coming," never as a shipping feature, until it's validated.
- ❌ Financial/legal/medical authority. It is **not a licensed advisor**.
- ❌ Cross-platform. **Windows only** right now.

## 9. Proof / trust points to include
- Local processing; **no telemetry, no account**.
- **MIT-licensed**, data in `%APPDATA%\jarvis-local-assistant`, easy uninstall.
- **SHA-256 checksum published** with each release (verifiable download).
- Transparent about being unsigned — a trust signal to this audience, not a hide.

## 10. Product status & pricing (context for positioning)
- Current build: **v0.11.2**. Distributed as a single **`JARVIS-FREE-SETUP.exe`**.
- **Free today.** Direction is shifting toward a **paid product** (licensing/
  purchase flow is a *future* project — nothing is gated yet). **Local-first
  remains the default experience.** Don't announce pricing/paywalls yet; keep
  messaging on "free, private, yours." If teasing the future, "free to start."
- Requirements to state plainly: **Windows**; optional **Python 3.12** for local
  voice (installer can fetch it); optional **Ollama** for local conversation.

## 11. Suggested angles & channels
- **Privacy angle** (primary): "AI that doesn't upload your life." Reddit
  (r/privacy, r/LocalLLaMA, r/selfhosted), Hacker News, privacy newsletters.
- **Maker/DIY angle:** hands-free help in the workshop/office; YouTube demos of
  "Hey Jarvis, find my compressor manual" → reads the spec aloud.
- **Aesthetic angle:** short screen-capture clips of the amber sphere reacting to
  voice — strong for TikTok/Shorts/X.
- **"Own your AI" angle:** bring-your-own-key, no subscription; appeals to
  local-LLM crowd.
- Lead-in demo script idea: wake word → ask a document a question → get a
  page-cited answer → all with a "nothing left your PC" caption.

## 12. Elevator variants (ready to adapt)
- **Tweet:** "Meet JARVIS: a private AI assistant that runs on *your* Windows PC.
  Voice, files, tasks, and document Q&A — no account, no subscription, no data
  leaving your machine. Say 'Hey Jarvis.'"
- **App-store style:** "A private, local AI assistant for Windows. Hands-free
  voice, smart file search, document Q&A with citations, tasks & reminders — all
  processed on your own PC. Free, no account, your data stays yours."
- **One sentence:** "It's your own JARVIS — a cinematic AI assistant that lives on
  your PC instead of in the cloud."
