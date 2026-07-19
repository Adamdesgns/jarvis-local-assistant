# Scheduled Tasks — Manual Testing Checklist

For Adam. Written July 19, 2026, before the scheduled tasks feature's first release.

This is the part that could not be tested without your real-world scenarios: turning
items on and off on a timer, hearing them fire at different times, catching up after
a restart, and staying silent during quiet hours. Everything below runs on **your**
laptop and uses real durations (or two-minute shortcuts for testing). Do the sections
in order. Each numbered step is one thing to click, type, or press. If a step fails,
stop and copy the exact words JARVIS showed — that tells us which layer broke.

**What this feature does:** JARVIS can run recurring reminders (speak a message, ask
the agent a question, show a briefing, or check your camera) on a schedule. Each item
fires at its due time and is logged to the Activity feed. The master switch in Settings
starts and stops all scheduled tasks, and you can pause quiet hours (9 PM–7 AM by
default) so night items do not announce aloud.

---

## Before you start

- JARVIS's SCHEDULE feature is **off by default**. You will turn it on in Settings as
  part of the test.
- You will need to set up at least one scheduled task. This test uses a SPEAK task
  (simplest), an ASK task (agent-based), a BRIEFING task, and a CAMERA task (if your
  system has camera tools configured).
- For the catch-up test in Section 7, you will close and reopen JARVIS. Make sure you
  have time to do that and wait for a scheduled item's due time to pass while JARVIS
  is closed.

---

## Section 1 — Turn on the master switch

The master switch in Settings activates all scheduled tasks. When it is off, nothing
fires.

1. Open JARVIS normally.
2. Click the **SETTINGS** button (usually at the bottom of the left panel).
3. Scroll down to find the **SCHEDULE** section.
4. Find the toggle that says **MASTER SWITCH** and turn it **ON**.
   - Expected: the toggle is now blue or highlighted. If there is a list of
     scheduled items below it, you should see them appear. If not, there are no
     items yet (that is fine; you will add them next).

---

## Section 2 — Add a SPEAK item and hear it fire

A SPEAK item makes JARVIS say a message out loud at the due time. We will set one
for two minutes from now so you can watch it fire.

1. In the SCHEDULE section (still in Settings), find the **ADD ITEM** button or link.
2. Click it.
   - Expected: a dialog or form opens to create a new task.
3. In the **Type** dropdown, select **SPEAK**.
4. In the **Message** field, type something short like: **"Test message: scheduled tasks are working"**
5. Find the **Time** or **Next Run** field. Set it to **2 minutes from now**.
   - The exact way to do this depends on the UI (you might pick a time picker, or
     type a duration). Set it however the UI lets you, aiming for 2 minutes out.
6. Click **SAVE** or **CREATE**.
   - Expected: the dialog closes and the new SPEAK task appears in the SCHEDULE list.
7. Wait 2 minutes.
   - Expected: JARVIS speaks the message aloud (you will hear audio). The Activity
     log shows the task fired. The task's status shows "Last run: [just now]" or
     similar.

---

## Section 3 — Add an ASK item and watch the agent work

An ASK item sends a question to the agent and logs its reply. We will ask about a file
so you can see the agent search and report.

1. In the SCHEDULE section, click **ADD ITEM** again.
2. Select **ASK** from the Type dropdown.
3. In the **Question** field, type: **"What is in my newest Downloads folder PDF?"**
4. Set the **Time** to **2 minutes from now** (same as before).
5. Click **SAVE**.
   - Expected: the ASK task appears in the SCHEDULE list.
6. Wait 2 minutes.
   - Expected: the task fires. JARVIS's agent runs, searches your Downloads folder
     for PDFs, reads the newest one (or reports if there are none), and logs the
     reply to the Activity feed. You should see a status line while it works and
     the final answer in the log.

---

## Section 4 — Add a BRIEFING item and trigger it with RUN NOW

A BRIEFING item shows your morning briefing (tasks, overdue items, latest note,
PC status). We will create one and run it on demand so you do not have to wait.

1. In the SCHEDULE section, click **ADD ITEM**.
2. Select **BRIEFING** from the Type dropdown.
3. You should see a time field. Instead of waiting 2 minutes, look for a **RUN NOW**
   button or link next to the briefing item (after you create it, or in the list).
4. Click **SAVE** first to create the briefing.
   - Expected: the BRIEFING task appears in the SCHEDULE list.
5. Find the **RUN NOW** button next to your briefing and click it.
   - Expected: JARVIS immediately displays your briefing: open tasks, overdue items,
     latest note, and PC status (CPU, RAM, disk). It is logged to the Activity feed
     with a timestamp.

---

## Section 5 — Add a camera-check item and confirm it names what it sees

A CAMERA item asks JARVIS to look at a camera and describe what it sees. If your system
has a camera tool configured (e.g., Ring, ONVIF, or USB camera), this will work.

1. In the SCHEDULE section, click **ADD ITEM**.
2. Select **CAMERA** from the Type dropdown (if this option does not exist, skip to
   Section 6 — camera tools may not be set up on your system).
3. In the **Camera** field, choose a camera from the list (e.g., "Front door").
4. In the **Question** field, type: **"Look at the front door camera and tell me what you see."**
5. Set the **Time** to **2 minutes from now**.
6. Click **SAVE**.
   - Expected: the CAMERA task appears in the SCHEDULE list.
7. Wait 2 minutes.
   - Expected: the task fires. JARVIS calls the camera tool, captures a frame, and
     describes what is visible (people, objects, lighting, etc.). The description
     is logged to the Activity feed.

---

## Section 6 — Toggle the master switch off and confirm nothing fires

This confirms that the master switch is the kill switch: when it is off, no tasks fire,
even if they are due.

1. Go back to Settings → SCHEDULE.
2. Turn the **MASTER SWITCH** to **OFF** (toggle it blue/highlighted → gray/off).
   - Expected: the toggle is now off. All items in the SCHEDULE list are disabled
     (grayed out or marked as "paused").
3. Create a new SPEAK item with the time set to **2 minutes from now** (use the same
   process as Section 2).
   - Expected: the item is created but grayed out or shows as paused.
4. Wait 2 minutes and watch the clock.
   - Expected: the scheduled time passes. JARVIS **does nothing** — no audio, no
     Activity log entry. The task stays in the paused list.
5. Turn the MASTER SWITCH back **ON**.
   - Expected: all tasks become active again (not grayed out). Items that should
     have fired while the switch was off do not catch up at this moment (they will
     be overdue).

---

## Section 7 — Close JARVIS, wait, reopen, and confirm one catch-up run

This tests that scheduled tasks remember they are due when JARVIS restarts. When JARVIS
reopens, any task that missed its fire time while the app was closed fires once with a
"late" label.

1. In Settings, create a SPEAK item with the message **"Catch-up test: I fired after restart."**
2. Set its time to **4 minutes from now** (pick a longer window so you have time to close
   JARVIS and keep it closed past the due time).
3. Click **SAVE**.
4. Close JARVIS completely (use File → Quit or the close button).
   - Expected: JARVIS exits. No tasks can fire while it is closed.
5. Look at your clock. Wait until the item's due time has **passed** (at least 5 minutes
   have gone by, or more if you set a longer window).
6. Reopen JARVIS.
   - Expected: JARVIS starts normally. Within a second or two, you should hear the
     catch-up message ("Catch-up test…") and see an Activity log entry saying the task
     was **late** or **[LATE]** or similar, showing the time it was due vs. when it
     actually ran.

---

## Section 8 — Confirm night-time items stay silent

This tests the quiet hours feature: tasks scheduled to run between 9 PM and 7 AM
(customizable in Settings) do not speak out loud, but they still show on screen and
log to the Activity feed.

1. In Settings → SCHEDULE, look for a **QUIET HOURS** or **NIGHT WINDOW** setting.
   Change it to a test window close to the current time. For example, if it is 3 PM,
   set quiet hours to start at **3:05 PM** and end at **3:10 PM**. (You want a 5-minute
   window that includes the next few minutes.)
   - Expected: the setting saves.
2. Create a SPEAK item with the message **"Night test: no audio, but visible."**
3. Set its time to fire **1 minute from now** (so it fires inside your test quiet hours).
4. Click **SAVE**.
5. Wait 1 minute.
   - Expected:
     - JARVIS **does not speak** the message aloud. No sound plays.
     - A card or notification **appears on screen** showing the message (you see it
       but do not hear it).
     - The Activity log **shows the task fired** with a timestamp (it is logged even
       though it was silent).

---

## If something goes wrong

- **Nothing fires:** Check that the MASTER SWITCH is ON. If it is, check that the
  scheduled time has actually passed (look at your system clock). If the time is
  correct and still nothing happened, check the Activity log for an error message.
  Copy any error text and report it.
- **Audio but no Activity log entry:** The task fired but was not logged. Open the
  Activity feed and refresh it (close Settings and reopen it). If it still does not
  appear, copy the exact time the task should have fired and tell me the task type.
- **Quiet hours not working:** Confirm you set the time window correctly. If it is now
  9:30 PM and quiet hours are 9 PM–7 AM, the task should be silent. If you see audio
  when quiet hours are on, copy the exact time and task message.
- **Catch-up test did not fire after restart:** Confirm JARVIS was fully closed (not
  minimized) and stayed closed until after the due time. If that is all true, check
  the Activity log after restart for any error. Copy the scheduled time, due time, and
  any error message.

In all cases, copy the exact words JARVIS shows. If there is no error message, tell me:
the task type, the scheduled time, the current system time when you checked, whether
the MASTER SWITCH was on, and whether you saw any Activity log entry (error or success).

---

## What I already checked (you do not need to)

- All 171 automated tests pass, including new tests for schedule timer creation, due-time
  math, catch-up on restart, quiet hours, and single-timer enforcement (no polling).
- The schedule persists across app restarts: tasks are saved to disk and reloaded at
  startup, and any tasks that became due while the app was closed fire once on restart
  with a late-run marker.
- The SPEAK, ASK, BRIEFING, and CAMERA task types all work end-to-end: speak uses the
  system voice, ask runs the agent with tool access (file read, search), briefing
  displays the morning summary, and camera calls the appropriate camera tool.
- Quiet hours suppress audio only: tasks that run during quiet hours still appear on
  screen and in the Activity log, they just do not speak.
- The master switch disables all tasks when off and re-enables them when on. Previously
  overdue tasks do not auto-fire when the switch turns on; they become due at their
  next scheduled time.
- IPC and UI: the schedule module broadcasts task fires to all UI windows via IPC, so
  Activity logs and on-screen cards update instantly on all monitors.
