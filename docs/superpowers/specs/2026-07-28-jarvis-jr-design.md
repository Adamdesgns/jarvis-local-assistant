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
real orb engine, the real personality — with every ability the parent has
not switched on **never constructed at boot**, using the same four allowlist gates the baby build
proved out.

One sentence to keep the whole thing honest: *JR looks exactly like
JARVIS, is built exactly like JUNIOR, and the parent decides how much
JARVIS it is.*

## What it is

A second installer from this repo: `JARVIS-JR-Setup-<version>.exe`.
Own app id, own name, own icon, own `%APPDATA%` folder — installs alongside
grown-up JARVIS on a family PC and they never share data.

**Features are the parent's call, not the calendar's** (Adam, 2026-07-28:
"parental controls only, no age lock on features. Let the parent decide
the features"). An age-staged unlock ladder was designed and rejected the
same day — it would have made an 11-year-old wait three years for file
search his parent wants him to have today. What survives of the
grows-with-you idea: JR still grows into the full JARVIS, but **at the
pace the parent widens the checklist**, not on birthdays.

The **birthdate** still exists and setup requires it — but it drives only
the **content lock**: how JARVIS talks (voice bands) and what he deflects
("a lock so kids can't look up or ask JARVIS to do things that are not
appropriate for their age"). Age never touches the feature list.

## Parental controls — the feature checklist

One checklist in the PIN-locked panel. Every row is a real capability,
off until a parent turns it on, effective at next launch:

| Feature | Default |
| --- | --- |
| Games, battle mode, quips, homework hints, tasks, timers | **On** — the base experience |
| Cameras (view only; accounts added by the parent) | Off until cameras exist |
| Documents — read and summarize PDFs and papers | Off |
| File search + file open, clamped to the kid's own user folder | Off |
| Opening apps, from a parent-edited allowlist | Off |
| The browser | Off |
| The real terminal | Off |
| Screen reading | Off |
| Power (restart/shutdown by voice) | Off |

Adam's own first move: documents + file search ON for his 11-year-old.

**Not on the checklist at any setting** — these never exist in JR and
arrive only by graduating to the adult build: night shift, schedules,
autonomy rules, phone pairing, Claude bridge, camera configuration,
defense mode, screen *driving*, and turning the content lock off.

Mechanically the capability profile is a **pure function**:
`profileFor(edition, controls)` — still an allowlist, computed in one
place, and testable at every combination that matters.

## The content lock

The thing JR is *for*, and the reason setup demands a birthdate:

- **`guardTopic()` runs before any model sees the words** — deterministic,
  no sampling. Its hard rules (weapons, self-harm handled with care,
  privacy, the honest "I cannot") are identical at every age.
- **Age tunes the deflection line, not the protection.** What an 11-year-old
  and a 16-year-old get deflected on differs in the `grown-up` band only;
  the guard's answer style follows the voice bands.
- The same rules ride into the model's system prompt for everything the
  guard lets through — belt and braces, as in the JUNIOR design.
- The lock applies to every enabled feature: the browser (when on) and
  document answers pass through the same guard, so widening the checklist
  never widens what's age-appropriate.

## Setup is the parent's job

First run opens a **parent setup, not the kid's desk** ("Parents should
have to set this up"): create the PIN, enter the kid's name and birthdate,
walk the checklist, optionally add cameras and a cloud key. The kid-facing
app does not start until this is done — there is no unconfigured state
where a kid uses JR without a birthdate and a lock.

## What the kid sees

The **real command center**: `src/index.html`, the dark UI, the skins, the
full orb engine with all eight souls and the picker. Wake word, hold-to-talk,
and typed commands all work exactly as in grown-up JARVIS.

Modules present **with the default checklist** (a parent's toggles add
their cards; anything off has no card and no code behind it):

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

## What it cannot do — never constructed beyond the checklist

Everything the parent has not switched on does not exist in the running
app — the JUNIOR principle, applied per feature. `main.js` builds only
what `profileFor(edition, controls)` names **at boot**; a change to the
checklist takes effect at next launch, never by flipping a live flag. An
off feature is not hidden or disabled — it was never built.

And the off-the-checklist list again, because it is the spine of the
build: night shift, schedules, autonomy, phone pairing, Claude bridge,
camera configuration, defense mode, screen driving, and removing the
content lock are never constructed in JR at any setting. Wanting those is
what the adult JARVIS is for.

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
voice), **features** (the checklist — the only place capabilities are
decided), cameras (the only place accounts are managed), questions (what
the guard deflected), PIN, about. A parent may also set a cloud key here;
without one, JR runs the local brain — the intended path.

The checklist and the birthdate are stored in the secrets store alongside
the PIN hash — not in `settings.json` — so a kid who can edit a JSON file
can neither switch on his own features nor age himself past the content
lock.

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
- **Checklist tests:** `profileFor()` with everything off, everything on,
  and each feature alone; a birthday changes no feature; switching a
  feature off removes it at next boot; a hand-edited `settings.json` can
  neither enable a feature nor change the birthdate (both live in the
  secrets store); with the whole checklist on, the profile still lacks
  every never-in-JR item — the content lock has no off switch, as a test.
- The grown-up build's behaviour is unchanged, and a test says so.

## Known gaps (v1)

- One kid per install; siblings mean two installs or a later profiles
  feature. (At 9 and 11, two installs on two accounts is probably the
  truth anyway.)
- No update check UI in JR; a parent installs the newer setup.
- Battle mode and open questions still need a brain; with no model
  installed, games, quips, timers, tasks and cameras all still work.
