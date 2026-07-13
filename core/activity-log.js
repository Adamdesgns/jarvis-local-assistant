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
}

module.exports = { ActivityLog };
