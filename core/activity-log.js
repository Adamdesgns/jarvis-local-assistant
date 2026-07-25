const fs = require('node:fs');
const path = require('node:path');

class ActivityLog {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'activity.jsonl');
  }

  write(event) {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.appendFileSync(this.filePath, `${JSON.stringify({
        timestamp: new Date().toISOString(),
        ...event
      })}\n`, 'utf8');
    } catch {
      // Logging must never prevent the assistant from responding.
    }
  }

  recent(limit = 20) {
    try {
      return fs.readFileSync(this.filePath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(-limit)
        .reverse()
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }

  // Newest entries of one kind. The junior build's grown-up screen uses this
  // to show the questions it handed back to a parent, without wading through
  // every ordinary line.
  recentOfType(type, limit = 20) {
    try {
      return fs.readFileSync(this.filePath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => { try { return JSON.parse(line); } catch { return null; } })
        .filter((entry) => entry && entry.type === type)
        .slice(-limit)
        .reverse();
    } catch {
      return [];
    }
  }
}

module.exports = { ActivityLog };
