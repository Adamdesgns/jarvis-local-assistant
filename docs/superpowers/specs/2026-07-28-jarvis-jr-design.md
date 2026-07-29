# JARVIS JR — the build that grows up

**Date:** 2026-07-28
**Status:** designed, not built
**Supersedes in spirit:** the unmerged JARVIS JUNIOR branch
(`claude/childrens-jarvis-version-0ga0rc`), which Adam reviewed live on
2026-07-28 and rejected for this age group — "that's a JARVIS for babies."
That build is parked, unmerged, as a possible ages-3–5 edition someday. Its
*plumbing* survives here; its look and voice do not.

## The verdict that shaped this design

Adam's kids are 9 and 11. They do not want a purple friend with a face.
They want **the actual JARVIS** — the dark command center, the real orb,
the composed British AI with the dry wit. So JARVIS JR is not a separate
children's app that imitates JARVIS. It is the real JARVIS renderer, the
real orb engine, the real personality — with every ability above the
kid's approved rung **never constructed at boot**, using the same four allowlist gates the baby build
proved out.

One sentence to keep the whole thing honest: *JR looks exactly like
JARVIS, is built exactly like JUNIOR, and grows up into JARVIS.*

## What it is

A second installer from this repo: `JARVIS-JR-Setup-<version>.exe`.
Own app id, own name, own icon, own `%APPDATA%` folder — installs alongside
grown-up JARVIS on a family PC and they never share data.

**JR is not a fixed edition — it grows with the kid** (Adam, 2026-07-28:
the pet-assistant idea, folded in: "JARVIS can grow and unlock features as
you get older. Bonus we already have the adult version."). The parent sets
a **birthdate** behind the PIN — not an age slider — and JARVIS ages with
the child automatically. Features unlock in stages from 10 to 18, and the
top of the ladder is the adult JARVIS that already exists.

## The growth ladder

| Age | Becomes eligible |
| --- | --- |
| **10** (start) | Orb, personality, tasks, timers, quick commands, games, battle mode, quips, cameras (parent-added, view only), homework hints |
| **12** | Documents — JARVIS reads and summarizes PDFs and papers for school |
| **14** | File search in *their own* user folder; opening parent-allowlisted apps |
| **16** | The browser, the real terminal, screen reading |
| **18** | Full JARVIS. Guard off, PIN retired. Already built. |

**Age makes a feature eligible; the parent's approval makes it active**
(Adam, 2026-07-28: "parents can approve before they age into it as well").
Every stage is approval-gated in the grown-up panel:

- **Pre-approved** (the intended path): the parent approves the upcoming
  stage any time in advance, and on birthday morning it unlocks with full
  ceremony — *"Happy birthday. You're twelve now — I've unlocked the
  document room. Try 'summarize this PDF.'"*
- **Not yet approved:** the birthday greeting still happens, and JARVIS
  says the new abilities are waiting for a grown-up's yes in the panel.
  Nothing activates on the calendar alone.
- **Early grant:** a parent may approve a stage before the age — a mature
  15-year-old can have the browser. **Hold back:** a parent may decline or
  revoke a stage regardless of age. Age sets the default; parents outrank
  the calendar, both directions.

**The tech tree is visible.** A "Growing up" screen in the kid-facing app
shows what is unlocked, what comes next, and at what age — the same pull
as a video-game unlock tree, and it costs nothing to render honestly.

**What never unlocks by birthday:** the deterministic safety guard runs
until the 18 stage is active, camera *configuration* stays parental at
every stage, and voice rules follow age bands as before. Age never scales
safety inside the ladder — the hard rules are identical at 10 and at 17.

Mechanically the capability profile stops being a constant and becomes a
**pure function**: `profileFor(edition, age, approvals)` — still an
allowlist, computed in one place, clamped, and testable at every rung.

## What the kid sees

The **real command center**: `src/index.html`, the dark UI, the skins, the
full orb engine with all eight souls and the picker. Wake word, hold-to-talk,
and typed commands all work exactly as in grown-up JARVIS.

Modules present **at the first rung** (higher rungs add their cards as
they unlock; everything else has no card and no code behind it):

| Module | Notes |
| --- | --- |
| Tasks | The kid's own list, in their own data folder |
| Timers / quick commands | As in the grown-up build |
| Activity log | Their own history |
| **Cameras** | *Live view only* — see below |
| **Games** | Tic tac toe and rock-paper-scissors vs the orb — see below |

Personality: the real JARVIS system prompt — witty, composed, loyal, lightly
sarcastic — layered with the `big`-band voice rules and the homework rule
(hints and first steps, never the finished answer, never their essay).
Battle mode stays: its hard rules are already PG-13 with no slurs and no
punching at protected traits, which is exactly the rail a 12-year-old needs.
The quips stay too — the 911 house line, the believers' hotline, the
self-destruct gag — they were half the reason to want JARVIS in the first
place.

## Cameras — the one ability that reaches out of the app

Adam's call, 2026-07-28: *"kid should be able to see his own house.
parents will have to add them."*

- Camera **accounts are configured only inside the PIN-locked grown-up
  panel**. The kid-facing app has no add/edit/remove camera surface at all.
- The kid gets **live tiles and "show the cameras"** — view only.
- Never constructed in JR: autonomy rules (doorbell speak, night motion,
  someone-here cards), defense mode, cloud vision, clip management. The
  camera module in JR is a window, not a watchtower.
- The IPC allowlist admits only the view channels; config channels exist
  solely behind the parent gate.

## Games

All decisions from the 2026-07-28 brainstorm carry over unchanged — only
the orb they run on got an upgrade (the real engine instead of the blob):

- **Two games, done properly:** tic tac toe and rock-paper-scissors.
- **Moves are taps, not speech.** "Play tic tac toe" starts a game by
  voice; the board is tapped, and rock/paper/scissors are three buttons.
  A mis-transcribed move would read as a broken game; taps always work.
- **Difficulty is the kid's pick** — Easy / Normal / Hard before each game.
- **Tic tac toe** is one minimax engine with a single dial: the probability
  JARVIS plays the best move instead of a random legal one (Easy ~25%,
  Normal ~70%, Hard 100%). One algorithm, three feels, fully testable
  headless.
- **Rock paper scissors:** Normal is honestly random. Hard reads the kid's
  *previous* throws only — a test enforces that the current throw is
  structurally unreadable. Easy cheats in the kid's favour, and the code
  says so in a comment.
- **The RPS moment:** kid taps a throw → the orb bounces the countdown —
  rock… paper… scissors… SHOOT — and on SHOOT morphs into JARVIS's throw.
  No timing pressure.
- **The orb morph** rides the real orb engine. Rock = low-frequency lumpy
  polar shape; paper = superellipse; scissors = two blade spikes plus a
  pivot dot, with a drawn-glyph fallback if the polar version reads as a
  lumpy crab on screen — screenshot before calling it done.
- **Trash talk is written, not generated.** A table of age-banded lines in
  the source (`game-lines.js`), same shape as `quips.js`. Instant, never
  strange, and the games work with **no model installed at all**.
- **Scores** (wins, losses, best streak) live in their own `games.json`.
  No star chart in JR at all — that was the baby build's economy and this
  age group is past it.

New modules, matching JUNIOR's granularity:

    core/games.js        both engines, pure; detectGame() narrow patterns
    core/game-lines.js   the written chatter, keyed by occasion and band
    core/game-scores.js  wins/losses/streaks, own JSON file

The router parses ("play tic tac toe" → open the board), the renderer
plays, and the engine answers moves over two JR-allowlisted IPC channels.
Games never reach the model, so there is no new `kidSafe` tool surface.

## What it cannot do — never constructed above the rung

At any given rung, everything above it does not exist in the running app —
the JUNIOR principle, applied per stage. `main.js` builds only what
`profileFor(edition, age, approvals)` names **at boot**; an unlock takes
effect on the next launch (or a relaunch prompt after birthday approval),
never by flipping a live flag. A rung the parent has not approved is not
hidden or disabled — it was never built.

Below the 18 rung, these are never constructed regardless of age or
approval: power controls, phone pairing, night shift, schedules, autonomy,
Claude bridge, camera configuration, defense mode. They are not on the
ladder; they arrive only with full JARVIS.

The four gates, straight from the JUNIOR design:

1. **`core/edition.js`** grows a third profile, `jr` — an allowlist. New
   abilities added to JARVIS later are off for JR until someone flips
   them on purpose.
2. **`CommandRouter`** routes JR to its own branch: quips → battle mode →
   games → timers → tasks → cameras-view → guard → model. It never
   reaches the grown-up branches.
3. **`filterRegistryForEdition()`** keeps only `kidSafe: true` tools.
4. **The IPC allowlist** in `registerIpc()` — JR's channel set includes
   the camera view and game channels and nothing that configures anything.

And ahead of all four: **`guardTopic()` runs before any model sees the
words.** The deterministic guard, its four kinds (`care` / `grown-up` /
`private` / `cannot`), and the deliberate privacy stance — a child in
distress is answered and *not* reported to the parent panel — carry over
from the JUNIOR design verbatim. That reasoning was right; only the paint
was wrong.

## The grown-up panel

Same PIN mechanics as JUNIOR (salted scrypt in the secrets store, doubling
lockout), restyled to match the dark UI. Tabs: child (name, **birthdate**,
voice), **growing up** (the ladder: approve upcoming stages, grant early,
hold back or revoke — the only place unlocks are decided), cameras (the
only place accounts are managed), questions (what the guard deflected),
PIN, about. A parent may also set a cloud key here; without one, JR runs
the local brain — the intended path.

Approvals are stored in the secrets store alongside the PIN hash — not in
`settings.json` — so a kid who can edit a JSON file cannot approve their
own rung. The birthdate lives there too, for the same reason.

## Build & dev isolation

- `electron-builder.jr.json`, own appId, product name JARVIS JR.
- **Fix the dev-mode data-leak found 2026-07-28:** running the JUNIOR
  branch with `npm run start:junior` writes to the *grown-up*
  `%APPDATA%\jarvis-local-assistant` because dev mode never re-points
  `userData`. In JR, `main.js` calls `app.setPath('userData', …-jr)`
  whenever the edition is not standard, so a dev launch can never touch
  the real assistant's data.

## Base branch reality

JR builds on a fresh branch off **current main** (`jarvis-jr`). The JUNIOR
branch is 53 commits behind main and is NOT merged or rebased; the modules
JR reuses from it (`kid-mode.js` guard, `parent-lock.js`, the `edition.js`
pattern, the IPC-wrap idea) are ported onto the new branch and re-tested
against today's main. The baby build's renderer (`src/junior/`), star
chart, kid routines and story-time voice are left where they are.

## Tests, red first

- Hard tic tac toe never loses across 500 randomized games; Easy loses
  often enough to prove it's beatable; all eight win lines.
- RPS judging table complete both ways; Hard cannot see the current throw.
- Every chatter occasion has a line at every band; none unkind.
- The booby-trap test, JR edition: dangerous phrasings fired at a JR
  router wired to throwing services — files, screen, power, phone stay
  untouched; camera *config* throws while camera *view* answers.
- Guard tests carry over verbatim from the JUNIOR suite.
- **Ladder tests:** `profileFor()` at every rung × approved/unapproved;
  an unapproved birthday changes nothing; a revoke takes a capability
  away at next boot; a hand-edited `settings.json` cannot grant a rung
  (approvals live in the secrets store); the 18 rung equals the standard
  profile exactly, field for field — the "already built" claim, as a test.
- The grown-up build's behaviour is unchanged, and a test says so.

## Known gaps (v1)

- One kid per install; siblings mean two installs or a later profiles
  feature. (At 9 and 11, two installs on two accounts is probably the
  truth anyway.)
- No update check UI in JR; a parent installs the newer setup.
- Battle mode and open questions still need a brain; with no model
  installed, games, quips, timers, tasks and cameras all still work.
