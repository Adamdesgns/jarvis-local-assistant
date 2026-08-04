---
name: trends
description: Scans the last week of vault captures and open tasks for what keeps coming up — the topics that are moving.
triggers:
  - trend scan
  - scan trends
  - what's moving
  - whats moving
  - what's trending
  - whats trending
---

# Trend Scan

Reads the last seven days of raw captures plus every open task title,
counts the words and [[wikilinks]] that keep recurring, and names the
topics with momentum. The scan is spoken out loud and written to
`vault/outputs/` so this week's signal can be compared with last week's.
