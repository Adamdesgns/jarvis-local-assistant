---
name: vault
description: Reads and writes the markdown vault — capture a thought, search every note, check the stats, close the day.
triggers:
  - vault
  - close the day
  - close my day
---

# Vault

The memory's front door. If it's not in the vault, it didn't happen.

- `vault capture <thought>` — writes the thought to `vault/raw/` as markdown
- `vault search <query>` — searches every note, raw, wiki, and outputs
- `vault stats` — how many notes, where, and how linked
- `vault recent` — the newest notes
- `close the day` — appends a Reflection to today's daily note: what got
  done, what's still open, so tomorrow starts queued
