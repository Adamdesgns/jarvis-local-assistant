'use strict';

const { spawn: nodeSpawn } = require('node:child_process');
const { buildArgs, resolvePowershell } = require('./screen-reader');

// screen-driver — owns the drive-screen.ps1 helper child for one driving
// session. Spawned exactly like the screen reader (fixed script path, argv
// array, shell:false, windowsHide) and killed at session end; commands and
// text travel as newline-delimited JSON on stdin, so nothing the user says is
// ever part of a command line.
//
// The kill path is the point of the separate process: a wedged UI Automation
// call inside PowerShell cannot block Node from child.kill(), and if the
// child ignores that, taskkill /F ends it from outside.

const DEFAULT_COMMAND_TIMEOUT_MS = 8000;
const KILL_GRACE_MS = 2000;

class ScreenDriver {
  constructor({
    scriptPath,
    powershellPath,
    spawn = nodeSpawn,
    log = null,
    commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
    killGraceMs = KILL_GRACE_MS
  } = {}) {
    this.scriptPath = scriptPath;
    this.spawn = spawn;
    this.log = log;
    this.commandTimeoutMs = commandTimeoutMs;
    this.killGraceMs = killGraceMs;
    this.resolvePs = () => resolvePowershell({ override: powershellPath });
    this.child = null;
    this.pending = new Map();
    this.counter = 0;
    this.buffer = '';
    this.stopped = false;
  }

  // Spawn the helper and prove it is alive with a ping before any session
  // step trusts it.
  async start() {
    if (this.child) return { ok: true };
    const ps = this.resolvePs();
    if (!ps) return { ok: false, error: 'driver-failed' };
    try {
      this.child = this.spawn(ps, buildArgs(this.scriptPath), { shell: false, windowsHide: true });
    } catch (error) {
      this.log?.write?.({ type: 'screen-drive', level: 'error', response: `helper spawn failed: ${error.message}`, source: 'screen' });
      return { ok: false, error: 'driver-failed' };
    }
    this.child.stdout?.setEncoding?.('utf8');
    this.child.stdout?.on('data', (chunk) => this.#onData(chunk));
    this.child.stderr?.setEncoding?.('utf8');
    this.child.stderr?.on('data', (chunk) => {
      this.log?.write?.({ type: 'screen-drive', level: 'error', response: String(chunk).slice(0, 400), source: 'screen' });
    });
    this.child.on('error', () => this.#failAllPending());
    this.child.on('close', () => {
      this.child = null;
      this.#failAllPending();
    });
    const pong = await this.#send({ cmd: 'ping' });
    return pong && pong.ok ? { ok: true } : { ok: false, error: 'driver-failed' };
  }

  snapshot() { return this.#send({ cmd: 'snapshot' }); }
  resolve(target) { return this.#send({ cmd: 'resolve', target }); }
  invoke(ref, expect) { return this.#send({ cmd: 'invoke', ref, expect }); }
  setValue(ref, text, expect) { return this.#send({ cmd: 'setValue', ref, text: String(text ?? ''), expect }); }
  focusWindow(target) { return this.#send({ cmd: 'focusWindow', target }); }

  // Teardown: polite quit on the wire, kill immediately after, taskkill /F if
  // the process is still there when the grace period runs out. Idempotent.
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    const child = this.child;
    this.child = null;
    this.#failAllPending();
    if (!child) return;
    try { child.stdin?.write?.(`${JSON.stringify({ id: 'quit', cmd: 'quit' })}\n`); } catch { /* already gone */ }
    try { child.kill(); } catch { /* already gone */ }
    const pid = child.pid;
    if (pid) {
      const escalation = setTimeout(() => {
        if (child.exitCode === null && !child.killed) {
          try { this.spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { shell: false, windowsHide: true }); } catch { /* nothing left to do */ }
        }
        // A wedged UIA call can survive child.kill(); taskkill from outside is
        // the guarantee the STOP button actually stops.
      }, this.killGraceMs);
      escalation.unref?.();
      child.on?.('close', () => clearTimeout(escalation));
    }
  }

  #send(payload) {
    if (!this.child || this.stopped) return Promise.resolve({ ok: false, error: 'driver-failed' });
    const id = `c${++this.counter}`;
    const line = `${JSON.stringify({ id, ...payload })}\n`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: 'driver-failed' });
      }, this.commandTimeoutMs);
      this.pending.set(id, (response) => {
        clearTimeout(timer);
        resolve(response);
      });
      try {
        this.child.stdin.write(line);
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve({ ok: false, error: 'driver-failed' });
      }
    });
  }

  #onData(chunk) {
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      const settle = this.pending.get(message?.id);
      if (settle) {
        this.pending.delete(message.id);
        settle(message);
      }
    }
  }

  #failAllPending() {
    for (const settle of this.pending.values()) settle({ ok: false, error: 'driver-failed' });
    this.pending.clear();
  }
}

module.exports = { ScreenDriver, DEFAULT_COMMAND_TIMEOUT_MS };
