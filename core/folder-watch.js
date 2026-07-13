const fs = require('node:fs');
const path = require('node:path');

function matchesPattern(fileName, pattern) {
  const clean = String(pattern || '*').trim().toLowerCase();
  if (!clean || clean === '*') return true;
  const name = String(fileName || '').toLowerCase();
  if (clean.startsWith('*.')) return name.endsWith(clean.slice(1));
  return name.includes(clean.replace(/\*/g, ''));
}

class FolderWatchService {
  constructor({ config, notify, emit }) {
    this.config = config;
    this.notify = notify || (() => {});
    this.emit = emit || (() => {});
    this.watchers = new Map();
    this.lastEvent = new Map();
  }

  start() {
    this.stop();
    for (const entry of this.config.getSettings().watchedFolders || []) {
      try {
        if (!fs.existsSync(entry.path)) continue;
        const watcher = fs.watch(entry.path, (_type, fileName) => this.#onChange(entry, fileName));
        watcher.on('error', () => this.watchers.delete(entry.path));
        this.watchers.set(entry.path, watcher);
      } catch {}
    }
    return this.watchers.size;
  }

  stop() {
    for (const watcher of this.watchers.values()) {
      try { watcher.close(); } catch {}
    }
    this.watchers.clear();
  }

  #onChange(entry, fileName) {
    if (fileName && !matchesPattern(fileName, entry.pattern)) return;
    // One notification per folder per 5 seconds; saves and copies fire
    // several raw events for the same real change.
    const now = Date.now();
    if (now - (this.lastEvent.get(entry.path) || 0) < 5000) return;
    this.lastEvent.set(entry.path, now);
    const folderName = path.basename(entry.path) || entry.path;
    const body = fileName ? `${fileName} changed in ${folderName}` : `Something changed in ${folderName}`;
    this.notify('JARVIS · FOLDER WATCH', body);
    this.emit('watch:event', { folder: entry.path, file: fileName || '', at: new Date().toISOString() });
  }
}

module.exports = { FolderWatchService, matchesPattern };
