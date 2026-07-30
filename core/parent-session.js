'use strict';

// The parent's unlocked window. Lives in the MAIN process and nowhere else:
// the renderer can ask whether it is open (jr:parent:session) and can close it
// (jr:parent:lock), but the only thing that OPENS it is a PIN that verified
// against the stored hash through ParentControls' throttled PinGate. There is
// no token, no cookie, nothing a kid's devtools-less renderer could forge — a
// forged "I am unlocked" message has nothing to forge.
//
// Two caps, both deliberate. The idle cap is the ordinary one: ten quiet
// minutes and the settings dialog goes cold, so a parent who walks away
// mid-edit doesn't leave the whole app open. The ceiling is the one that
// matters for the kid: it is NOT refreshable, so no amount of activity keeps
// the door open past an hour. In-memory on purpose, exactly like PinGate — a
// restart closes it, which is the safe direction.

const IDLE_MS = 10 * 60 * 1000;
const CEILING_MS = 60 * 60 * 1000;

class ParentSession {
  constructor({ now = () => Date.now(), idleMs = IDLE_MS, ceilingMs = CEILING_MS } = {}) {
    this.now = now;
    this.idleMs = idleMs;
    this.ceilingMs = ceilingMs;
    this.openedAt = null;
    this.lastTouch = null;
  }

  unlock() {
    const t = this.now();
    this.openedAt = t;
    this.lastTouch = t;
  }

  lock() {
    this.openedAt = null;
    this.lastTouch = null;
  }

  // Read-only. Never refreshes the idle clock — the renderer polls this for
  // its countdown, and a countdown that resets itself by being watched is a
  // session with no idle cap at all.
  status() {
    if (this.openedAt === null) return { unlocked: false, expiresInSeconds: 0 };
    const t = this.now();
    const idleLeft = this.idleMs - (t - this.lastTouch);
    const ceilingLeft = this.ceilingMs - (t - this.openedAt);
    const left = Math.min(idleLeft, ceilingLeft);
    if (left <= 0) { this.lock(); return { unlocked: false, expiresInSeconds: 0 }; }
    return { unlocked: true, expiresInSeconds: Math.ceil(left / 1000) };
  }

  // The IPC gate's question: "may this call through, and if so, the parent is
  // still here." Expiry is evaluated here, on every admin call, which is what
  // makes an expired session re-block with no timer to fire and no state to
  // sweep.
  admit() {
    if (!this.status().unlocked) return false;
    this.lastTouch = this.now();
    return true;
  }
}

module.exports = { ParentSession, IDLE_MS, CEILING_MS };
