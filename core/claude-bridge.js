const fs = require('node:fs');
const path = require('node:path');
const { spawn: nodeSpawn } = require('node:child_process');

// Tools Claude is forbidden from using when JARVIS asks it a question.
//
// This list IS the answers-only guarantee Adam approved: Claude explains, it
// never changes the PC. Edit/Write/NotebookEdit/MultiEdit stop file changes,
// Bash/BashOutput/KillShell stop command execution, WebFetch stops remote
// content being pulled into a spoken answer, and Task/Agent stop a subagent
// being spawned that would otherwise inherit none of these restrictions.
//
// Caveat worth remembering: this is a denylist against a tool set that belongs
// to another program. If Claude Code ever ships a new writing tool under a new
// name, this list will not know about it. Revisit on CLI upgrades.
const ANSWERS_ONLY_TOOLS = [
  'Edit',
  'Write',
  'NotebookEdit',
  'MultiEdit',
  'Bash',
  'BashOutput',
  'KillShell',
  'WebFetch',
  'Task',
  'Agent',
  'SlashCommand'
];

const DEFAULT_TIMEOUT_MS = 120000;

function buildArgs({ question, sessionId } = {}) {
  const args = ['-p', String(question ?? ''), '--output-format', 'json', '--disallowedTools', ANSWERS_ONLY_TOOLS.join(',')];
  if (sessionId) args.push('--resume', sessionId);
  return args;
}

// Locate the real claude executable. The npm shims (claude.cmd/claude.ps1)
// deliberately are not used: running those needs a shell, and Adam's question
// is free text that must never touch a command line.
function resolveClaudeCli({ override, env = process.env, exists = fs.existsSync } = {}) {
  const candidates = [];
  if (override) candidates.push(override);
  if (env.APPDATA) {
    candidates.push(path.join(env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'));
  }
  if (env.HOME) {
    candidates.push(path.join(env.HOME, '.local', 'bin', 'claude'));
    candidates.push(path.join(env.HOME, '.npm-global', 'bin', 'claude'));
  }
  for (const dir of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude'));
  }
  return candidates.find((candidate) => {
    try {
      return exists(candidate);
    } catch {
      return false;
    }
  }) || null;
}

function isStaleSession(text) {
  return /no conversation found|session .{0,80}not found|invalid session/i.test(text);
}

function describeFailure(text) {
  if (/invalid api key|please run \/login|not (?:logged|signed) in|authentication_error|unauthorized/i.test(text)) {
    return "Claude isn't signed in on this PC. Open Claude and sign in, then try again.";
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|failed, reason/i.test(text)) {
    return "I couldn't reach Claude — looks like the connection is down.";
  }
  if (/rate.?limit|429|usage limit/i.test(text)) {
    return 'Claude is rate limited right now. Try again in a few minutes.';
  }
  return 'Claude ran into a problem answering that.';
}

// A day-per-file Markdown log of everything asked and answered, written where
// Adam can search it with JARVIS's own file tools.
function createTranscript(userDataPath, { fsp = fs.promises } = {}) {
  const folder = path.join(userDataPath, 'claude-chats');
  return {
    folder,
    async append({ question, answer, at = new Date() }) {
      await fsp.mkdir(folder, { recursive: true });
      const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
      const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
      const block = `\n## ${clock} — Adam\n\n${question}\n\n## ${clock} — Claude\n\n${answer}\n`;
      await fsp.appendFile(path.join(folder, `${day}.md`), block, 'utf8');
    }
  };
}

class ClaudeBridge {
  constructor({ config, spawn = nodeSpawn, transcript = null, resolveCli, timeoutMs = DEFAULT_TIMEOUT_MS, log = null } = {}) {
    this.config = config;
    this.spawn = spawn;
    this.transcript = transcript;
    this.timeoutMs = timeoutMs;
    this.log = log;
    this.resolveCli = resolveCli || (() => resolveClaudeCli({ override: config?.getSettings?.().claudeCliPath }));
  }

  newConversation() {
    this.config.updateSettings({ claudeBridgeSessionId: '' });
  }

  async ask(question) {
    const cli = this.resolveCli();
    if (!cli) return { ok: false, text: "I can't find Claude on this PC." };

    const sessionId = this.config.getSettings().claudeBridgeSessionId || '';
    let run = await this.#run(cli, buildArgs({ question, sessionId }));

    // A session id from a previous day may no longer exist. Start over once
    // rather than making Adam deal with an error he can't act on.
    if (!run.ok && sessionId && isStaleSession(run.stderr)) {
      this.newConversation();
      run = await this.#run(cli, buildArgs({ question }));
    }

    if (!run.ok) {
      const text = run.timedOut ? 'Claude took too long to answer.' : describeFailure(run.stderr || run.stdout);
      this.log?.write?.({ type: 'claude-bridge', level: 'error', detail: run.stderr || run.errorMessage || 'timeout' });
      return { ok: false, text };
    }

    const parsed = this.#parse(run.stdout);
    if (!parsed) {
      this.log?.write?.({ type: 'claude-bridge', level: 'error', detail: 'unreadable CLI output' });
      return { ok: false, text: 'Claude answered in a format I could not read.' };
    }

    if (parsed.sessionId) this.config.updateSettings({ claudeBridgeSessionId: parsed.sessionId });

    // A transcript failure must never cost Adam the answer he asked for.
    try {
      await this.transcript?.append({ question, answer: parsed.text });
    } catch (error) {
      this.log?.write?.({ type: 'claude-bridge', level: 'error', detail: `transcript: ${error.message}` });
    }

    return { ok: true, text: parsed.text };
  }

  #parse(stdout) {
    try {
      const payload = JSON.parse(stdout);
      const text = payload.result ?? payload.text ?? '';
      if (!text) return null;
      return { text: String(text).trim(), sessionId: payload.session_id || '' };
    } catch {
      return null;
    }
  }

  #run(cli, args) {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };

      // shell:false is the whole point — argv entries are passed to the
      // executable verbatim, so nothing in the question is ever parsed.
      const child = this.spawn(cli, args, { shell: false, windowsHide: true });
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch { /* already gone */ }
        finish({ ok: false, timedOut: true, stdout, stderr });
      }, this.timeoutMs);

      child.stdout?.on('data', (chunk) => { stdout += chunk; });
      child.stderr?.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (error) => finish({ ok: false, stdout, stderr, errorMessage: error.message }));
      child.on('close', (code) => finish({ ok: code === 0, code, stdout, stderr }));
    });
  }
}

module.exports = { ClaudeBridge, buildArgs, resolveClaudeCli, createTranscript, ANSWERS_ONLY_TOOLS };
