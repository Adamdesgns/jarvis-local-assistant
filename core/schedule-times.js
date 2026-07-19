'use strict';

// Pure date-math helpers for scheduled tasks. No Electron/fs imports —
// this module must stay pure and side-effect free.

const MAX_DAYS_AHEAD = 8;

function matchesRepeat(date, repeat, weekday) {
  const day = date.getDay();
  switch (repeat) {
    case 'daily':
      return true;
    case 'weekdays':
      return day >= 1 && day <= 5;
    case 'weekly':
      return day === weekday;
    case 'once':
      return true;
    default:
      return false;
  }
}

function nextRunAt(item, from) {
  if (!item || !item.enabled) return null;
  const { when } = item;
  if (!when) return null;
  const { time, repeat, weekday } = when;
  if (repeat === 'once' && item.lastRunAt) return null;

  const knownRepeat = repeat === 'daily' || repeat === 'weekdays' || repeat === 'weekly' || repeat === 'once';
  if (!knownRepeat) return null;

  const [hourStr, minStr] = String(time).split(':');
  const hour = Number(hourStr);
  const minute = Number(minStr);

  const candidate = new Date(from.getTime());
  candidate.setHours(hour, minute, 0, 0);

  for (let i = 0; i < MAX_DAYS_AHEAD; i++) {
    if (candidate.getTime() > from.getTime() && matchesRepeat(candidate, repeat, weekday)) {
      return candidate;
    }
    candidate.setDate(candidate.getDate() + 1);
  }

  return null;
}

function dueSince(item, from, now) {
  const n = nextRunAt(item, from);
  return !!n && n <= now;
}

// Returns { at, items } for the earliest occurrence among enabled items —
// `items` holds every item whose next occurrence lands at exactly that same
// instant (a tie, e.g. two items both set for 7:00 AM), in input order. Null
// when nothing is due.
function pickNext(items, from) {
  let bestAt = null;
  let bestItems = [];
  for (const item of items) {
    if (!item || !item.enabled) continue;
    const at = nextRunAt(item, from);
    if (!at) continue;
    if (!bestAt || at.getTime() < bestAt.getTime()) {
      bestAt = at;
      bestItems = [item];
    } else if (at.getTime() === bestAt.getTime()) {
      bestItems.push(item);
    }
  }
  if (!bestAt) return null;
  return { at: bestAt, items: bestItems };
}

module.exports = { nextRunAt, dueSince, pickNext };
