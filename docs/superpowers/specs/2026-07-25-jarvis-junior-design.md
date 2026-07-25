# JARVIS JUNIOR — the children's build

**Date:** 2026-07-25
**Status:** built (v1)

## What it is

A second installer, built from this same repo, for children aged 5–12.
`JARVIS-JUNIOR-Setup-<version>.exe` installs alongside the grown-up JARVIS:
different app id, different name, different icon, different `%APPDATA%`
folder. A family PC can have both, and they never touch each other's data.

It is not a mode inside JARVIS. A child's build that can be switched back into
the grown-up one is a child's build with a lock on it, and locks get picked.

## What it does

- **Talks.** Hold the big button (or the space bar) and speak, or type.
  Answers are spoken back in a voice the parent picks.
- **Answers questions** at the child's reading level, with a homework rule:
  hints and first steps, never the finished answer, never their essay.
- **Tells stories** — original ones, on any subject they name, that end safe.
  Also jokes, riddles, would-you-rather, and true facts.
- **Runs timers and routines** — morning, bedtime, two-minute toothbrush,
  homework, tidy-up race, and a calming-down breathing routine.
- **Keeps a star chart** — jobs a parent sets, stars the child earns by
  saying "I fed the cat", a streak for finished days, and stars a parent can
  trade in for a real-world reward.

## What it cannot do

Every ability that reaches out of the app is *never constructed* in this
build — not hidden behind a setting, not disabled by a flag the app could
flip back. `main.js` returns before building any of it:

| Absent in junior | Why |
| --- | --- |
| File search, reading, moving, deleting | A child does not need the disk, and a mistake there is not undoable |
| Opening and closing programs | Same |
| Screen reading and screen driving | The strongest ability in the app |
| Cameras | Live video of the house, in a child's hands |
| Phone pairing, schedules, night shift, folder watching, autonomy | Background actuation with nobody watching |
| Power controls, Claude bridge, start-with-Windows | Grown-up conveniences |

Three independent gates enforce it, each an allowlist:

1. **`core/edition.js`** — the capability profile. `main.js` builds only what
   the profile names, so the services above have no instances to reach.
2. **`CommandRouter.handle()`** — junior text goes to `#handleKid()` and
   never returns to the grown-up branches. Not a denylist of dangerous
   phrasings: a separate, complete list of what a child *can* ask for.
3. **`filterRegistryForEdition()`** — the model's tool belt keeps only tools
   marked `kidSafe: true`. A powerful tool added to the registry next year is
   denied to children until somebody marks it otherwise, on purpose.

`registerIpc()` adds a fourth, smaller one: the junior window's IPC channels
are an allowlist too, so an IPC added later to the grown-up build is refused
in the junior one by default.

`test/router-junior.test.js` wires a junior router to booby-trapped services
that throw if touched, then fires eighteen dangerous phrasings at it. Nothing
is touched.

## The safety guard

`core/kid-mode.js` `guardTopic()` runs **before any model sees the words**,
so the answer to "how do I make a bomb" is a fixed sentence in the source
tree, not a sample from a 4-billion-parameter model on a home PC. Four kinds,
handled differently:

| Kind | Example | Answer | On the parent's screen? |
| --- | --- | --- | --- |
| `care` | "I want to hurt myself", "my dad hits me" | Warmth, believe them, point at a trusted grown-up, name a helpline | **No** |
| `grown-up` | vaping, sex, how to make a weapon | Kind deflection to a parent or teacher | Yes |
| `private` | "can I give my address to my friend online" | The safety rule, plainly | Yes |
| `cannot` | "buy me a game", "delete everything" | What it genuinely cannot do | Yes |

### Why distress is not reported to the parent

The `care` kind is answered and deliberately **not** written to the log the
grown-up screen reads. A child who is unsafe *at home* must be able to say so
without the family computer reporting it to the family. The advice names
adults outside the house — a teacher, a school counsellor, a relative — for
the same reason.

This is a real trade-off, and the parent panel says so in plain words rather
than leaving them to discover it. Parents who want to know everything their
child typed still have the activity log; what they do not get is a
convenient list that turns a child's worst moment into a notification.

Everything else the guard catches *is* listed, because "your 9-year-old asked
what vaping is" is a conversation a parent should get to have.

The prompt (`buildKidPrompt`) carries the same rules into the model on every
turn for the ordinary questions the guard lets through — belt and braces.

## Age

One setting, 5–12, set by the parent. It scales three things: sentence
length, vocabulary, and story length (120–180 words at 5, up to 500 at 12).
It does **not** scale safety — the hard rules are identical at every age.

`clampAge()` clamps in `mergeSettings`, so a hand-edited `settings.json`
cannot age a five-year-old into answers written for a teenager.

## The grown-up lock

A 4–8 digit PIN, stored as a salted scrypt hash in the encrypted secrets
store (never in `settings.json`, so `settings:save` cannot overwrite it).
Five wrong guesses starts a lockout that doubles, capped at fifteen minutes.

It is guarding a settings panel from a curious nine-year-old, not a disk from
an attacker, and the code says so.

## Files

    core/edition.js         which build this is; the capability profile
    core/kid-mode.js        the guard, the prompt, the age bands
    core/story-time.js      stories, jokes, riddles, facts
    core/star-chart.js      jobs, stars, streaks (own JSON file)
    core/kid-routines.js    timers and routines
    core/parent-lock.js     PIN hashing and the lockout gate
    src/junior/             the child's window (own HTML, CSS, JS)
    electron-builder.junior.json
    scripts/make-junior-icon.py

Touched: `main.js` (edition-aware boot), `core/router.js` (the junior path),
`core/ai-service.js` (junior prompt + tool filter), `core/tool-registry.js`
(`kidSafe` flags, three star-chart tools), `core/config-store.js`,
`core/defaults.js`, `core/activity-log.js` (`recentOfType`), `preload.js`.

The grown-up build's behaviour is unchanged; `test/router-junior.test.js`
ends with a test that says so.

## Known gaps (v1)

- No wake word in the junior window: children press the button. The wake
  word service is running, so this is a renderer change when wanted.
- No update check in the junior build — it has no UI to show the notice.
  A parent updates by installing the newer junior setup.
- One child per installation. A second child means a second install, or a
  profiles feature later.
- The junior build has its own `%APPDATA%` folder, so a cloud API key saved
  in grown-up JARVIS is *not* inherited. With Ollama installed, the local
  brain works with no key at all — which is the intended path for children.
