'use strict';

const crypto = require('node:crypto');
const guard = require('./screen-guard');

// screen-drive-session — the referee for slice 2 of JARVIS's hands. A session
// is one approved plan being executed, step by step, with the guard re-run
// immediately before every action. The plan is frozen at approval: nothing in
// this file appends a step, and nothing read off the screen ever becomes an
// instruction — on-screen text is only compared against what a step already
// expected (PC-CONTROL-RESEARCH §Deny outright).
//
// Every stop path — voice "stop"/Escape, the STOP window's button, the STOP
// window dying, a watchdog firing, a guard refusal — converges on abort(),
// which is idempotent and always runs the same teardown: kill the helper,
// close the STOP window, tell the UI, write the log, say why in plain words.

const DEFAULT_TIMERS = Object.freeze({
  stepMs: 10000, // one action stalling
  sessionMs: 120000, // the whole session overstaying
  approvalMs: 60000 // Adam not answering an approval card
});

// Reasons that end a session, mapped to what JARVIS says out loud. Every
// terminal state gets a clean plain-English sentence, never a retry loop.
const END_MESSAGES = {
  done: 'Done.',
  'user-interrupt': 'Stopped. Hands off.',
  'stop-button': 'Stopped. Hands off.',
  'stop-window-lost': 'My stop button disappeared, so I stopped everything to be safe.',
  'session-timeout': 'That was taking too long, so I stopped.',
  'step-timeout': 'A step stalled, so I stopped.',
  'approval-timeout': "You didn't answer, so I stopped without doing it.",
  declined: "Understood — I didn't do it, and I've stopped.",
  elevated: "A Windows permission prompt appeared — I've stopped and left the machine to you.",
  'desktop-locked': 'The desktop locked, so I stopped.',
  'focus-stolen': 'Another window took over mid-step, so I stopped.',
  'stale-element': 'The screen changed under me, so I stopped rather than guess.',
  'not-found': "I couldn't find what I was told to press, so I stopped — tell me more precisely.",
  ambiguous: 'I found more than one thing by that name, so I stopped rather than guess.',
  'not-invokable': "That control doesn't accept a press the safe way, so I stopped.",
  'guard-refused': 'That window is off-limits, so I stopped.',
  'not-allowlisted': "That app isn't one I'm allowed to drive, so I stopped.",
  'driver-failed': 'My driving helper hit a problem, so I stopped.',
  error: 'Something went wrong, so I stopped.'
};

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// What a typed value looks like in the log: its fingerprint and its size,
// never the value. Hashed here, before any log object is built, so no code
// path below can accidentally write the plaintext.
function describeText(text) {
  const value = String(text || '');
  if (!value) return null;
  return {
    textSha256: crypto.createHash('sha256').update(value, 'utf8').digest('hex'),
    textLength: value.length
  };
}

function describeStep(step, index, total) {
  const name = step?.target?.name || step?.target?.automationId || step?.target?.app || '';
  const verbs = { invoke: `Press "${name}"`, setValue: `Type into "${name}"`, focusWindow: `Switch to ${name}`, wait: 'Wait a moment' };
  return `Step ${index + 1} of ${total}: ${verbs[step?.action] || step?.action || 'step'}`;
}

class ScreenHands {
  constructor({
    driverFactory = null,
    getSettings = () => ({}),
    log = null,
    onEvent = null,
    requestApproval = null,
    stopWindow = null,
    timers = {},
    now = () => Date.now()
  } = {}) {
    this.driverFactory = driverFactory;
    this.getSettings = getSettings;
    this.log = log;
    this.onEvent = typeof onEvent === 'function' ? onEvent : null;
    this.requestApproval = typeof requestApproval === 'function' ? requestApproval : null;
    this.stopWindow = stopWindow || null;
    this.timers = { ...DEFAULT_TIMERS, ...timers };
    this.now = now;
    this.active = null;
    this.sessionCounter = 0;
  }

  isActive() {
    return Boolean(this.active);
  }

  // The one door every stop path walks through. Safe to call twice, safe to
  // call when nothing is running.
  abortActive(reason = 'user-interrupt') {
    const session = this.active;
    if (!session || session.endedReason) return false;
    session.endedReason = reason;
    for (const wake of session.wakers.splice(0)) wake();
    try { session.driver?.stop?.(); } catch { /* teardown must not throw */ }
    return true;
  }

  // Execute an approved, frozen plan. Resolves when the session is over —
  // callers who want to answer immediately should not await it.
  async run(plan) {
    if (this.active) {
      return { ok: false, reason: 'busy', text: "I'm already driving — one thing at a time. Say stop to take over." };
    }
    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    if (!steps.length) {
      return { ok: false, reason: 'empty-plan', text: "That plan has no steps, so there's nothing for me to do." };
    }
    deepFreeze(plan);

    const session = {
      id: `drive-${++this.sessionCounter}-${this.now()}`,
      plan,
      driver: null,
      endedReason: null,
      wakers: [],
      startedAt: this.now(),
      completedSteps: 0
    };
    this.active = session;

    try {
      session.driver = this.driverFactory ? this.driverFactory() : null;
      if (!session.driver) return this.#end(session, 'driver-failed');
      if (typeof session.driver.start === 'function') {
        const started = await session.driver.start();
        if (started && started.ok === false) return this.#end(session, 'driver-failed');
      }

      this.#openStopWindow(session);
      this.#emit({ type: 'started', session: session.id, title: plan.title || 'Driving your screen', total: steps.length });
      this.#log(session, { command: plan.utterance || plan.title || 'drive', response: `session started — ${steps.length} step${steps.length === 1 ? '' : 's'}`, step: -1 });

      const sessionTimer = setTimeout(() => this.abortActive('session-timeout'), this.timers.sessionMs);
      try {
        for (let index = 0; index < steps.length; index += 1) {
          if (session.endedReason) return this.#end(session);
          const outcome = await this.#runStep(session, steps[index], index, steps.length);
          if (outcome !== 'ok') return this.#end(session, session.endedReason || outcome);
          session.completedSteps += 1;
        }
      } finally {
        clearTimeout(sessionTimer);
      }
      return this.#end(session, session.endedReason || 'done');
    } catch (error) {
      this.#log(session, { level: 'error', response: `session error: ${error?.message || error}`, step: -1 });
      return this.#end(session, session.endedReason || 'error');
    }
  }

  async #runStep(session, step, index, total) {
    const label = describeStep(step, index, total);
    this.#updateStopWindow(label);
    this.#emit({ type: 'step', session: session.id, index, total, text: label });

    // 1. Fresh snapshot — never act on a stale picture of the screen.
    const snap = await this.#await(session, session.driver.snapshot(), 'driver-failed');
    if (session.endedReason) return session.endedReason;
    if (!snap || snap.ok === false || !snap.foreground) return this.#refuse(session, step, index, snap?.error || 'driver-failed');
    const fg = snap.foreground;

    // 2. The window guard, immediately before every action. A financial,
    // credential, system or elevated window ends the session on the spot —
    // this is the check that catches a bank tab appearing mid-session.
    const verdict = guard.classifyWindow(fg);
    if (!verdict.allowed) {
      const reason = verdict.category === 'elevated' ? 'elevated' : 'guard-refused';
      this.#log(session, { step: index, response: `refused: ${verdict.category} window in focus`, guard: verdict.category });
      return this.#refuse(session, step, index, reason);
    }

    // 3. The allowlist — exact match, v1-clamped.
    const settings = this.getSettings() || {};
    if (!guard.isDriveAllowed(fg.processName, settings.screenControlAllowlist)) {
      this.#log(session, { step: index, response: `refused: ${fg.processName || 'unknown app'} not allowlisted`, guard: 'allowlist' });
      return this.#refuse(session, step, index, 'not-allowlisted');
    }

    // focusWindow needs no element; its target app is still allowlist-checked.
    if (step.action === 'focusWindow') {
      if (!guard.isDriveAllowed(step?.target?.app, settings.screenControlAllowlist)) {
        return this.#refuse(session, step, index, 'not-allowlisted');
      }
      return this.#perform(session, step, index, session.driver.focusWindow(step.target), null);
    }
    if (step.action === 'wait') {
      await this.#await(session, new Promise((r) => setTimeout(r, Math.min(2000, Number(step.ms) || 500))), 'error');
      return session.endedReason ? session.endedReason : 'ok';
    }

    // 4. Resolve the target fresh — durable properties in, exactly one match
    // out. Zero means the screen doesn't have it; two means we'd be guessing.
    const resolved = await this.#await(session, session.driver.resolve(step.target), 'driver-failed');
    if (session.endedReason) return session.endedReason;
    if (!resolved || resolved.ok === false) return this.#refuse(session, step, index, resolved?.error || 'driver-failed');
    const matches = Array.isArray(resolved.matches) ? resolved.matches : [];
    if (matches.length === 0) return this.#refuse(session, step, index, 'not-found');
    if (matches.length > 1) return this.#refuse(session, step, index, 'ambiguous');
    const element = matches[0];

    // 5. Tier the step with the real element in hand (password fields reveal
    // themselves only here). Deny ends the session; approve waits for Adam.
    const tier = guard.classifyStep({ ...step, element });
    if (tier.tier === 'deny') {
      this.#log(session, { step: index, response: `refused: ${tier.reason}`, guard: 'step-deny' });
      return this.#refuse(session, step, index, 'guard-refused');
    }
    if (tier.tier === 'approve') {
      const approved = await this.#askApproval(session, step, index, tier.reason);
      if (session.endedReason) return session.endedReason;
      if (approved === 'timeout') return this.#refuse(session, step, index, 'approval-timeout');
      if (!approved) return this.#refuse(session, step, index, 'declined');
    }

    // 6. Act — the helper re-verifies pid/element identity atomically.
    const expect = { pid: fg.pid, processName: fg.processName, name: element.name, controlType: element.control || element.controlType, ref: element.ref };
    const action = step.action === 'setValue'
      ? session.driver.setValue(element.ref, step.text, expect)
      : session.driver.invoke(element.ref, expect);
    return this.#perform(session, step, index, action, element);
  }

  async #perform(session, step, index, actionPromise, element) {
    const result = await this.#await(session, actionPromise, 'driver-failed', this.timers.stepMs);
    if (session.endedReason) return session.endedReason;
    if (!result || result.ok === false) return this.#refuse(session, step, index, result?.error || 'driver-failed');
    this.#log(session, {
      step: index,
      response: 'ok',
      action: step.action,
      target: {
        process: result.processName || undefined,
        pid: result.pid || undefined,
        title: result.windowTitle || undefined,
        element: element?.name || step?.target?.name || step?.target?.app || '',
        control: element?.control || element?.controlType || ''
      },
      guard: 'passed',
      durationMs: result.durationMs,
      ...(step.action === 'setValue' ? describeText(step.text) : null)
    });
    return 'ok';
  }

  // Wait for a driver promise, but wake immediately on abort and enforce a
  // per-step watchdog. A wedged helper call can never outlast the timer or
  // block the stop button — abort() kills the child out from under it.
  #await(session, promise, timeoutReason, timeoutMs = this.timers.stepMs) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
      const timer = setTimeout(() => {
        if (!session.endedReason) session.endedReason = timeoutMs === this.timers.stepMs ? 'step-timeout' : timeoutReason;
        try { session.driver?.stop?.(); } catch { /* already down */ }
        finish(null);
      }, timeoutMs);
      session.wakers.push(() => finish(null));
      Promise.resolve(promise).then(finish, () => finish({ ok: false, error: timeoutReason }));
    });
  }

  async #askApproval(session, step, index, reason) {
    if (!this.requestApproval) return false;
    const name = step?.target?.name || step?.action;
    this.#emit({ type: 'awaiting-approval', session: session.id, index, text: `Waiting for your OK: ${name}` });
    this.#updateStopWindow(`Waiting for your OK: "${name}"`);
    const answer = this.requestApproval({
      id: `${session.id}-step-${index}`,
      title: 'JARVIS WANTS TO PRESS',
      detail: `${describeStep(step, index, session.plan.steps.length)}. ${reason}`,
      risk: 'HIGH'
    });
    const timed = await this.#await(session, answer, 'approval-timeout', this.timers.approvalMs);
    if (timed === null && !session.endedReason) return 'timeout';
    return Boolean(timed);
  }

  #refuse(session, step, index, reason) {
    if (!session.endedReason) session.endedReason = reason;
    return session.endedReason;
  }

  #end(session, reason = null) {
    if (session.finished) return session.summary;
    session.finished = true;
    const finalReason = reason || session.endedReason || 'error';
    session.endedReason = finalReason;
    const ok = finalReason === 'done';
    const text = END_MESSAGES[finalReason] || END_MESSAGES.error;
    try { session.driver?.stop?.(); } catch { /* already down */ }
    this.#closeStopWindow();
    this.#log(session, {
      step: -1,
      response: `session ended: ${finalReason} after ${session.completedSteps}/${session.plan.steps.length} steps`,
      durationMs: this.now() - session.startedAt
    });
    this.#emit({ type: 'ended', session: session.id, ok, reason: finalReason, completed: session.completedSteps, total: session.plan.steps.length, text });
    this.active = null;
    session.summary = { ok, reason: finalReason, completed: session.completedSteps, text };
    return session.summary;
  }

  #openStopWindow(session) {
    try { this.stopWindow?.open?.(() => this.abortActive('stop-button'), () => this.abortActive('stop-window-lost')); } catch {
      // If the STOP window cannot even open, there is no visible kill switch —
      // fail closed rather than drive without one.
      this.abortActive('stop-window-lost');
    }
  }

  #updateStopWindow(text) {
    try { this.stopWindow?.update?.(text); } catch { /* indicator failure never breaks a step */ }
  }

  #closeStopWindow() {
    try { this.stopWindow?.close?.(); } catch { /* already gone */ }
  }

  #emit(payload) {
    try { this.onEvent?.(payload); } catch { /* UI failure never breaks the session */ }
  }

  #log(session, entry) {
    try {
      this.log?.write?.({ type: 'screen-drive', source: 'screen', session: session.id, ...entry });
    } catch { /* logging failure never breaks the session */ }
  }
}

module.exports = { ScreenHands, DEFAULT_TIMERS, END_MESSAGES, describeText };
