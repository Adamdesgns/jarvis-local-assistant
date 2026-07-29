# JARVIS JR — code review, 2026-07-29

Review of the `jarvis-jr` branch (96 commits ahead of `main`, head `63d0748`),
covering the JR-only range `532de0e..63d0748` — 41 files, +8,222/−286.

Reviewed against `main` at `23e03f6`. Verdict: **ship it after the four items
below are adjudicated.** Nothing here blocks a merge on safety grounds; the
gating spine is sound and enforced, not merely described.

---

## 1. What was verified, not just read

**The IPC allowlist is genuinely enforced.** `main.js:1461` wraps
`ipcMain.handle`/`ipcMain.on` before `setupIpc()` is *called* at `main.js:1706`
— the 113 registrations live inside a function defined at line 606 but executed
after the wrapper is installed, so every one is covered. The only registration
at module load (`crash:renderer-error`, `main.js:96`) is in `BASE_IPC` anyway.
Deny-by-default, with the never-admitted set left out of every list rather than
subtracted afterwards.

**Window hardening.** `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true` on all three windows, plus `devTools: false` and
`Menu.setApplicationMenu(null)` in JR only. That closes the Ctrl+Shift+I path
that would otherwise hand a kid a Node console and make every other control
decorative.

**The PIN.** scrypt + `timingSafeEqual`, doubling lockout capped at 15 min.
`setPin` routes its old-PIN check through the same throttled `verifyPin` rather
than calling `lock.verifyPin` directly — so it isn't an unthrottled oracle
sitting next to the throttled one. `completeSetup`'s re-entry guard counts
failures toward the same lockout. `jr:parent:controls` re-verifies the PIN in
the same call; the renderer never holds a session token.

**Parent state is out of reach.** Birthdate, checklist, PIN and kid name live in
one encrypted `jrParent` secret, never in `settings.json`. `settings:save` is
filtered through `filterJrSettingsPatch` at `main.js:948` *before* the license
gate or ConfigStore sees it.

**Fails closed where it matters.** `ParentControls.age()` returns `AGE_MIN` on an
unparseable birthdate → the most restrictive band. `guardTopic` with no age
passed lands in `big`, so `teenOk` rows stay deflected.

**The games are honest.** `rpsThrow` structurally cannot cheat — the kid's
current throw is not a parameter, only prior history. Verified `easy` really
does throw the losing hand (`BEATS[favourite]`) and `hard` the winning one
(`LOSES_TO[favourite]`).

**Tests.** 646 on the branch vs 419 on `main` — **227 new tests**. All 19
failures in this Linux container are environmental and reproduce on `main` in
kind: `fast-xml-parser` is declared in `package.json` but not installed here
(this is what fails `router-jr` and `untrusted-content`), plus Windows-only
`taskkill` paths and network calls. **No JR-introduced failures.**

---

## 2. Findings

### F1 — The `power` checklist toggle is inconsistent (real, low severity)

`core/router.js:232` runs the content-lock guard *before* the power-confirm
branch at `:249`. `core/kid-mode.js:240` has a `no-such-power` row matching
`/\bturn\s+off\s+the\s+(?:computer|pc)\b/i`.

Result, measured:

| phrase | outcome |
|---|---|
| `turn off the computer` | guard `cannot/no-such-power` — always |
| `turn off the pc` | guard `cannot/no-such-power` — always |
| `shut down the computer` | falls through, honours the `power` toggle |
| `restart the computer` | falls through, honours the `power` toggle |
| `reboot the pc` | falls through, honours the `power` toggle |

So with `power` **on**, a kid gets "I cannot do that one — I am not allowed to
… change the computer" for one phrasing and a real confirm dialog for another.
The `jr-gate` line at `router.js:251` ("Power is a grown-up control on this
build") is unreachable for the `turn off` phrasings.

This fails *closed*, so it is not a safety hole — but it makes a parent's
toggle look broken and answers the same intent two different ways. Fix: either
drop the `turn off the computer` clause from `no-such-power` and let the power
branch own that intent, or skip that one row when `profile.power` is on.

### F2 — Stale security comment contradicts the code it documents (real)

`core/variant.js:136-143`, inside `BASE_IPC`, still says the `settings:save`
keys "DO widen capability if a kid can reach them … **Not redesigned here;
flagged for review adjudication.**" That was true when written and was closed
later in the same branch: `JR_SETTINGS_ALLOW` / `filterJrSettingsPatch` at
`core/variant.js:247-262`, enforced at `main.js:948`.

Two comments in one file now say opposite things about the same channel. This
codebase deliberately carries its security rationale in comments — a reviewer
who trusts the first one concludes there is an open hole. Fix: rewrite the
`BASE_IPC` note to point at `JR_SETTINGS_ALLOW`.

### F3 — Dangling reference to `task-6-report.md` (real, minor)

Cited twice (`core/variant.js:142` and `:241`) as the authority for which
settings keys are capability-adjacent. The file has never existed in the repo
(`git log --diff-filter=A` finds nothing). Either commit it under
`docs/superpowers/` or inline the list.

### F4 — `#effectiveJrPromptRules` fails open on an explicit `''` (latent)

`core/ai-service.js`:

```js
if (context.jrPromptRules !== undefined) return context.jrPromptRules;
if (this.profile?.contentLock && this.jrPromptRules) return this.jrPromptRules();
```

A caller passing `jrPromptRules: ''` silently drops the content lock, because
`''` is defined. **Not live** — both call sites are correct
(`core/router.js:930` and `main.js:1037` only emit `''` when not JR). But the
sole purpose of this method is to fail closed, and today it does so by
convention rather than structure. Fix: check the profile first, or treat an
empty string under `contentLock` as absent.

### F5 — Dead `'little'` band branch (cleanup)

`core/kid-mode.js:380` tests `ageBand(age) === 'little'`, but `ageBand` only
ever returns `middle`/`big`/`teen`. Already documented as unreachable in
`test/kid-mode.test.js:214-216`, so this is known — just delete it.

### F6 — `game:move` does not validate `board` (no action needed)

The handler passes the renderer's `board` straight into `tttMove`. I probed for
a minimax blow-up: `legalMoves` is hard-coded to indices 0-8, which bounds the
recursion, so an oversized board throws rather than hangs (measured: 9 cells =
174 ms; 10+ throws immediately). Malformed input rejects the promise. Add a
shape check only if you want tidier errors.

---

## 3. Design calls worth keeping

- **Care rows are never logged to the parent** (`kid-mode.js:91,109`;
  `router.js:242`). A child who is unsafe at home must not learn that telling
  the computer reports them. Deliberate, documented, and correct.
- **`easy` is written down as a thrown game.** `TRY_RATE.easy = 0.25`, and the
  README says so plainly. A kid who can never win quits.
- **No hot-enable of checklist items.** Every change takes effect at relaunch,
  because an off→on flip would need a service the process never constructed.

---

## 4. Still outstanding before merge

From the plans' own Task 7 — all manual, none of it code:

1. Cold-start JR and run the verification protocol (easy really loses, hard
   really wins, tallies survive a relaunch, games-off shows the gate line).
2. The scissors eyeball check — "blades or crab?", with the glyph fallback.
3. Screenshots.
4. Delete the two superseded branches once this lands:
   `claude/childrens-jarvis-version-0ga0rc`,
   `claude/childrens-jarvis-parental-controls-gzinu5`.
