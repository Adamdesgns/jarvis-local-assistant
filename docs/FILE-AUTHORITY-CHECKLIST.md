# File Authority — Manual Testing Checklist

For Adam. Written July 20, 2026, before the file authority feature's first release.

**What changed:** JARVIS used to stop and show an approval card before it would move,
copy, rename, organize, or delete anything. Now moving, copying, renaming, and
organizing inside your approved folders happen the moment you ask — no dialog, no
confirmation. "Delete" no longer shows a card either: it goes straight to the Windows
Recycle Bin, which means you can always get it back, and JARVIS will refuse (and tell
you why) if the Recycle Bin can't actually hold the item. JARVIS still cannot
permanently erase a file — that's not something it will ever do.

This is the part that could not be tested without real files sitting in your real
folders. Do the sections in order. Each numbered step is one thing to say or do. If a
step fails, stop and copy the exact words JARVIS showed — that tells us which layer
broke.

---

## Before you start

- Have at least two approved folders set up in Settings (for example, Downloads and
  Documents), so there's somewhere for "move" and "organize" to work with.
- Have a couple of ordinary files (PDFs, images, whatever you have handy) sitting
  loose in your Downloads folder.
- Section 6 needs a USB stick. If you don't have one handy, skip that section — it is
  the one exception to "everything works immediately," and it's fine to confirm it
  later.

---

## Section 1 — Organize Downloads and watch it happen with no dialog

1. Make sure at least two ordinary files are loose in your Downloads folder (not
   already sorted into subfolders).
2. Say or type to JARVIS: **"Organize my Downloads folder."**
   - Expected: JARVIS just does it. No approval card, no "are you sure" — it tells you
     directly how many files it organized (something like "Organized 2 files into
     labeled folders.").
3. Open Downloads in File Explorer.
   - Expected: the loose files are gone from the top level and now sit inside labeled
     subfolders (by file type/category).

---

## Section 2 — Move a named file to another approved folder

1. Pick a file you can name exactly (for example, a PDF sitting in Downloads).
2. Say: **"Move [filename] to Documents"** (or whichever second approved folder you
   set up).
   - Expected: JARVIS confirms it moved immediately — no dialog.
3. Check the Documents folder.
   - Expected: the file is there. Check Downloads — it's gone from there.

---

## Section 3 — Rename a file

1. Pick a file in one of your approved folders.
2. Say: **"Rename [filename] to [new name]."**
   - Expected: JARVIS confirms the rename immediately — no dialog.
3. Check the folder.
   - Expected: the file now shows the new name, and the old name is gone.

---

## Section 4 — Organize when a name is already taken (both files survive)

This confirms JARVIS never overwrites a file by accident while organizing.

1. Look in Downloads' organized subfolders (from Section 1) and note a file's name and
   which category folder it landed in — for example, `Invoice.pdf` inside a
   "Documents" category folder.
2. Put a **different** file, loose, into your Downloads folder, but name it exactly
   the same — `Invoice.pdf` — so it will land in that same category folder.
3. Say: **"Organize my Downloads folder."**
   - Expected: JARVIS organizes it immediately, no dialog.
4. Open that category folder.
   - Expected: you now see **both** files. The original `Invoice.pdf` is untouched
     (same file, same contents as before). The new one was renamed on arrival —
     something like `Invoice 2.pdf`. Neither file was overwritten or lost.

---

## Section 5 — Delete something and confirm it's in the Recycle Bin, restorable

1. Pick a file in Downloads you don't mind deleting for this test.
2. Say: **"Delete [filename]."**
   - Expected: JARVIS confirms immediately — no approval card — something like "Moved
     [filename] to the Recycle Bin."
3. Open the Windows Recycle Bin (desktop icon or search for it in the Start menu).
   - Expected: the file is sitting there.
4. Right-click it and choose **Restore**.
   - Expected: the file goes back to exactly where it was in Downloads.

---

## Section 6 — Copy a file to a USB stick, then try to delete the copy (should refuse)

This confirms JARVIS won't delete something it can't actually put in a Recycle Bin.
(Skip this section if you don't have a USB stick handy.)

1. Plug in a USB stick.
2. Copy any file from an approved folder onto the USB stick (drag it over in File
   Explorer, or ask JARVIS to copy it there if your USB drive is an approved
   location).
3. Say to JARVIS: **"Delete [filename]"** — pointing at the copy now sitting on the
   USB stick.
   - Expected: JARVIS **refuses** and explains why in plain language (something like
     the drive having no Recycle Bin, so deleting it would erase it for good, and that
     it would rather you did that one yourself). The file must still be on the USB
     stick afterward — check that it's still there.

---

## Section 7 — Ask JARVIS to delete something from your phone

This confirms the phone app gets the exact same safety behavior as the desktop — no
special-casing, no silent difference.

1. Open the JARVIS app on your phone (paired and connected as usual).
2. In the phone chat, type or say: **"Delete [filename]"** for an ordinary file in an
   approved folder (like Section 5).
   - Expected: same as the desktop — no confirmation dialog, and JARVIS tells you
     directly that it moved the file to the Recycle Bin. It should **not** tell you to
     go do this "at the desktop" — file actions from the phone go through for real
     now.
3. Check the Recycle Bin on your PC.
   - Expected: the file is there, same as if you'd asked from the desktop.

---

## Section 8 — Confirm a scheduled task still refuses file work

Scheduled (unattended) tasks run with nobody watching, so they are never allowed to
touch files — this hasn't changed and shouldn't.

1. In Settings → SCHEDULE, create an ASK task (see the scheduled-tasks checklist if
   you need a refresher) with the question: **"Delete the oldest file in my
   Downloads folder."**
2. Set it to run in 2 minutes, or use RUN NOW if available.
3. Wait for it to fire (or trigger it).
   - Expected: JARVIS does **not** delete anything. It reports back that this kind of
     action needs you at the desk and that it left it for you. Check the file is
     still exactly where it was.

---

## If something goes wrong

- **JARVIS still shows an approval card for a move/copy/rename/organize/delete:**
  Copy the exact wording of the card and tell me — that means the old behavior is
  still active somewhere.
- **A file went missing instead of being renamed on collision (Section 4):** This
  would be serious — stop testing immediately, copy exactly what you see in both
  folders, and tell me right away.
- **Delete on the USB stick actually deleted the file instead of refusing (Section
  6):** Stop testing, note the exact file and drive letter, and tell me — do not
  repeat the test on a drive you care about.
- **The phone behaves differently than the desktop (Section 7):** Copy the exact
  reply text JARVIS gave on the phone.
- **The scheduled task deleted the file (Section 8):** Stop testing schedule-driven
  actions and tell me immediately, along with the exact question text you used.

In all cases, copy the exact words JARVIS shows. If there is no error message, tell
me: what you asked for, which section you were on, and what actually happened instead
of the expected result.

---

## What I already checked (you do not need to)

- All automated tests pass, including new tests for the Recycle Bin safety check
  (network drives, volumes with no Recycle Bin, files too large for the bin),
  the organize-collision rename, moves/copies/renames/organize executing without an
  approval card, delete refusing outside approved folders, unattended (scheduled)
  runs still refusing every file action, and the phone chat path returning the real
  file-action outcome instead of a desktop redirect.
- The system prompt JARVIS's brain reads was updated to match: it now describes file
  work as happening directly, and delete as Recycle-Bin-only with no permanent erase
  capability.
