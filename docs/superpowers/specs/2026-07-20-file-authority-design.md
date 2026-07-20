# File Authority — Design

**Date:** 2026-07-20 · **Branch:** `file-authority` (off `main` @ 0.14.0)
**Status:** Approved in conversation, pending spec review

## Context

Adam's rule, in his words: *"fully control my pc except for the ability to
delete. He can move them just not delete."* Refined in conversation:

- **JARVIS never acts on his own.** He only does these things when Adam tells
  him to, or as a step inside a job Adam handed him. The unattended/scheduled
  lockdown built on 2026-07-19 stays exactly as it is.
- **Moves stop asking permission.** Move, copy, rename and organize currently
  raise an approval card every time. For an owner-issued command that is
  friction, not safety — the boundary checks are what keep it safe, not the
  dialog.
- **Delete means the Recycle Bin, and only when the bin will really catch it.**
  Adam asked directly whether JARVIS can still bin things. He can: the Recycle
  Bin is a move, not a destruction. But Windows silently *permanently* erases
  instead of binning in several cases, so JARVIS must check first and refuse
  when the bin won't save the file.
- **The phone gets the same authority as the desk.** Adam chose this
  explicitly. Today the phone can't touch files at all — it answers "run that
  at the desktop." After this it can move, rename and organize like the
  desktop, over his private tailnet, on a paired device he can revoke.

## What changes

| Command | Today | After |
|---|---|---|
| move / copy / rename / organize (owner) | approval card, then acts | acts immediately |
| move / copy / rename / organize (phone) | refused — "run it at the desktop" | acts immediately |
| delete / trash / remove (owner) | approval card → Recycle Bin | Recycle Bin immediately, **if bin-backed** |
| delete on a USB stick / network drive / oversized file | binned or silently erased | **refused, with the reason** |
| permanent erase (`fs.unlink`/`rm`) | never existed | still never exists |
| anything unattended/scheduled | refused | **refused — unchanged** |

## Architecture

### 1. The approval card retires for file work

`CommandRouter#fileApproval` (`core/router.js:459`) currently queues a pending
action and returns `{ approval: {...} }` for all five operations. Attended
callers instead execute immediately through the same `DocumentService` methods
`resolveApproval` calls today (`copyItem`, `moveItem`, `renameItem`,
`applyOrganization`, `trashItem`) and get a plain success/failure reply.

The pending/approval machinery **stays** — power actions (shutdown/restart)
still use it, and `resolveApproval` remains for that. Only the file branches
stop queuing.

The unattended branch inside `#fileApproval` is untouched: `stream.unattended`
still returns "this needs you at the desk" before anything is queued or run.

### 2. Recycle-Bin safety check (new)

New `DocumentService.canRecycle(target)` → `{ ok: true }` or
`{ ok: false, reason }`, called before every trash. It refuses when:

- **UNC / network path** (`\\server\share\…`) — no Recycle Bin exists.
- **The volume has no `$Recycle.Bin` folder at its root** — the reliable
  Windows test for "this drive bins things." Fixed NTFS volumes have it;
  most USB sticks and mapped drives don't.
- **A single file larger than `RECYCLE_MAX_BYTES` (2 GB)** — Windows
  permanently deletes items that exceed the bin's per-drive quota. Directories
  skip the size test (recursively sizing a tree is too slow for an interactive
  command); the volume test still applies to them.

On refusal JARVIS says what's wrong and hands it back — e.g. *"That's on a
drive with no Recycle Bin, sir. I'd have to erase it for good, so I'd rather
you did that one yourself."*

Deletion continues to run through Electron's `shell.trashItem` only. There is
no `fs.unlink`/`fs.rm` path for user-facing deletion anywhere, and none is
added. (`moveItem`'s cross-volume fallback removes the *original* after a
verified copy — that is the internal implementation of a move, not a delete,
and it cannot be aimed at an arbitrary target.)

### 3. Organize stops silently overwriting

`applyOrganization` (`core/document-service.js:324`) renames each file into its
category folder with **no collision guard** — unlike `copyItem`/`moveItem`/
`renameItem`, which all refuse to clobber. Today the approval card gives Adam a
last look; once organize runs approval-free, a same-named file in the target
folder would be destroyed silently. Fix: dedupe the destination name the way
uploads already do (`Name 2.ext`), never overwrite. This is a real data-loss
bug being closed, not a new feature.

### 4. The phone executes file work

`core/mobile-server.js#chat` (~line 119) currently detects `result.approval`,
auto-denies it, and replies "Run that one at the desktop, sir." With file
operations no longer producing approvals, that path naturally stops firing for
them and the phone receives the real result. The auto-deny stays for what still
raises approvals — power actions — so the phone can never restart the PC.

### 5. Wording JARVIS uses

`core/ai-service.js:75` currently tells the model: *"Deleting … deliberately
outside your tools. If asked, say the direct command (like "delete <file>") so
JARVIS can show its approval card."* That becomes stale twice over. New line
must say: file moves happen directly on request; deletion means the Recycle Bin
and is refused when the bin can't hold it; permanent erasure is not available
at all. `test/core.test.js:519` asserts on `/approval card/` and must be
re-pointed at the surviving power-action language.

## What does not change

- Approved-folder boundaries (`isAllowed`) on every operation, source and
  destination.
- Copy/move/rename still refuse to overwrite an existing file.
- Power actions (shutdown/restart) still require an approval card, desktop only.
- The unattended read-only guard, the `unattendedSafe` tool allowlist, and every
  test protecting them.
- No permanent-delete capability, ever.

## Testing

- `canRecycle`: UNC path refused; a volume root without `$Recycle.Bin` refused;
  an oversized file refused; a normal file on a bin-backed volume allowed;
  directories skip the size test but not the volume test.
- Router, attended: move/copy/rename/organize return a success result and
  actually call the DocumentService method, with `pending.size === 0` (no
  approval queued). Delete on a bin-backed path trashes immediately; delete on
  a refused path does **not** call `trashItem`.
- Router, unattended: all five still refused, `pending.size === 0` — the
  existing `test/router-unattended.test.js` assertions must keep passing
  unchanged.
- `applyOrganization`: a pre-existing same-named file in the destination
  survives; the incoming file lands beside it renamed.
- Power actions still queue an approval (regression guard).
- Mobile: a file command from the phone executes and returns the real result; a
  power command from the phone is still auto-declined.
- Full suite green (baseline 217). Then by hand: tell JARVIS to organize a test
  folder and watch it happen with no dialog; ask him to delete something on a
  USB stick and read the refusal.

## Not in scope

Typing/clicking control of the PC (its own project, needs a "JARVIS is driving"
indicator, an instant stop, and an action log); webcam and phone-camera vision
(the next sub-project); emptying the Recycle Bin (never).
