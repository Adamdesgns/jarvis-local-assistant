const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MAX_BYTES = 512 * 1024;
const MAX_STACK_CHARS = 4000;

class CrashLog {
  constructor(userDataPath, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
    this.filePath = path.join(userDataPath, 'crash.log');
    this.maxBytes = maxBytes;
  }

  record(source, cause) {
    try {
      const error = normalizeCause(cause);
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      this.#rotateIfNeeded();
      fs.appendFileSync(this.filePath, `${JSON.stringify({
        timestamp: new Date().toISOString(),
        source,
        name: error.name,
        message: error.message,
        stack: String(error.stack || '').slice(0, MAX_STACK_CHARS)
      })}\n`, 'utf8');
    } catch {
      // The crash logger must never become a second crash.
    }
  }

  tail(limit = 20) {
    try {
      return fs.readFileSync(this.filePath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(-limit)
        .reverse()
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  #rotateIfNeeded() {
    try {
      if (fs.statSync(this.filePath).size >= this.maxBytes) {
        fs.renameSync(this.filePath, `${this.filePath}.1`);
      }
    } catch {
      // No file yet means nothing to rotate.
    }
  }
}

// Errors cross IPC as plain objects, so error-shaped objects keep their fields.
function normalizeCause(cause) {
  if (cause instanceof Error) return cause;
  if (cause && typeof cause === 'object' && (cause.message || cause.stack)) {
    return {
      name: String(cause.name || 'Error'),
      message: String(cause.message || ''),
      stack: String(cause.stack || '')
    };
  }
  return { name: 'Error', message: String(cause), stack: '' };
}

function installProcessHandlers(proc, crashLog) {
  proc.on('uncaughtException', (error) => {
    crashLog.record('main:uncaughtException', error);
  });
  proc.on('unhandledRejection', (reason) => {
    crashLog.record('main:unhandledRejection', reason);
  });
}

module.exports = { CrashLog, installProcessHandlers };
