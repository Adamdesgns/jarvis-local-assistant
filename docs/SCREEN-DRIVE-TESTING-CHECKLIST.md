# Screen driving — manual testing checklist (v0.17.0)

The automated tests (`node --test`) prove the guard logic, the protocol, and
every stop path against fakes. This checklist is the part only a human at the
real machine can do. Work top to bottom; each item says what to do and what
MUST happen. If anything behaves differently, stop and note it — don't keep
testing around a failure.

Setup once: Settings → SCREEN DRIVING (BETA) → on. Have Notepad and a File
Explorer window open. Leave the setting OFF when you're done testing.

## A. The happy path

- [ ] **A1 — Type into Notepad.** Say: *"type hello world into notepad"*.
      Expect: a plan card listing 3 steps → approve → chime, orb goes HANDS ON
      SCREEN, STOP window appears top-right → Notepad comes forward and the
      text appears → chime, "Done.", STOP window gone.
- [ ] **A2 — Open a menu.** With Notepad focused, say: *"open the File menu"*.
      Expect: plan card → approve → the File menu visibly opens.
- [ ] **A3 — Risky step asks again.** Say: *"open the File menu and click
      Save"*. Expect: the plan card marks step 3 "will ask again first";
      mid-job a second card appears before Save is pressed; nothing happens
      until you answer.
- [ ] **A4 — Select in Explorer.** Say: *"select ‹some file you can see› in
      explorer"*. Expect: Explorer comes forward, that item highlights.

## B. Every stop, every time

- [ ] **B1 — STOP window button.** Start A1 again, press STOP mid-job.
      Expect: instant end, "Stopped. Hands off.", helper gone.
- [ ] **B2 — Escape.** Start a job, hit Escape mid-job. Same expectation.
- [ ] **B3 — Say "stop".** Start a job, say *"stop"*. Same expectation.
- [ ] **B4 — Ignore an approval card.** Trigger A3, answer nothing for 60
      seconds. Expect: it gives up on its own, nothing was pressed.
- [ ] **B5 — Decline the plan.** Trigger any plan, press deny. Expect:
      "Command cancelled", nothing at all happens.

## C. The walls (deliberately try to break it)

- [ ] **C1 — Wrong app.** Focus a browser and say *"click Back"* → approve.
      Expect: refusal — the browser is not an app he may drive.
- [ ] **C2 — Financial title.** Open any window with a bank name in the title
      (even a Notepad file named `chase bank.txt` works). Focus it, ask for a
      click. Expect: session ends with the off-limits message.
- [ ] **C3 — UAC.** Start a job, and while it runs trigger a UAC prompt
      (e.g. launch an installer). Expect: the job ends with "A Windows
      permission prompt appeared…" and NOTHING interacts with the prompt.
- [ ] **C4 — Focus steal.** Start A1 and click a different window the moment
      the plan starts. Expect: "Another window took over mid-step, so I
      stopped" (or a clean not-found stop) — never typing into the wrong app.
- [ ] **C5 — Lock the PC.** Start a job and immediately Win+L. Expect: on
      unlock, the job is over ("The desktop locked, so I stopped").
- [ ] **C6 — Phone refusal.** From JARVIS Mobile, send *"click Save"*.
      Expect: "Driving the screen only works from the desk, not the phone."
- [ ] **C7 — Ambiguity.** Arrange two files with the same visible name (or two
      controls labeled Save on screen) and ask for a click. Expect: "I found
      more than one thing by that name, so I stopped."
- [ ] **C8 — Password field.** Focus any sign-in form and say *"type test
      into notepad"* — then focus the sign-in window during the job. Expect:
      refusal (sign-in window / password field), never a keystroke into it.

## D. Housekeeping checks

- [ ] **D1 — Latency feel.** Note roughly how long A1 takes end to end. The
      helper starts once per job (~1s); each step should feel ≤1–2s. If a step
      regularly hangs ~10s, that's the watchdog — report it.
- [ ] **D2 — Log accounting.** After A1, open the Activity feed. Expect
      screen-drive entries for session start, each step, session end — and the
      typed text appearing ONLY as a fingerprint (hash) + length.
- [ ] **D3 — Setting really gates.** Turn SCREEN DRIVING off, say *"click
      Save"*. Expect: pointer to Settings, no plan card.
- [ ] **D4 — Update check.** Confirm version reads 0.17.0 in Settings.

## Known limits (v1, by design — not bugs)

- Explorer/Notepad only; Chrome deliberately excluded until the dedicated
  clean-profile design ships.
- Ending a rename with Enter isn't supported (no synthetic keys at all); menu
  and button paths only.
- Some apps expose no accessibility names; JARVIS stops and says so.
- Guaranteed OS-level out, always: **Ctrl+Alt+Del**.
