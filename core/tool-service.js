const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SKIP_DIRECTORIES = new Set([
  '.git', '.svn', 'node_modules', 'AppData', '$Recycle.Bin',
  'System Volume Information', 'Windows', 'ProgramData', '.venv'
]);
const SEARCH_FILLER = new Set(['the', 'a', 'an', 'my', 'file', 'folder', 'document', 'please', 'for', 'me', 'called', 'named']);

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function fileInfo(fullPath, entry, stats) {
  return {
    name: entry.name,
    path: fullPath,
    type: entry.isDirectory() ? 'folder' : 'file',
    extension: entry.isDirectory() ? '' : path.extname(entry.name).slice(1).toLowerCase(),
    size: stats?.size || 0,
    modifiedAt: stats?.mtime?.toISOString?.() || null
  };
}

class ToolService {
  constructor({ config, shell, app, emit }) {
    this.config = config;
    this.shell = shell;
    this.app = app;
    this.emit = emit || (() => {});
  }

  setEmitter(emit) {
    this.emit = emit || (() => {});
  }

  resolveApplication(name) {
    const query = normalize(name).replace(/^(the|my)\s+/, '');
    const applications = this.config.getSettings().applications;
    for (const [canonical, details] of Object.entries(applications)) {
      const candidates = [canonical, ...(details.aliases || [])].map(normalize);
      if (candidates.includes(query) || candidates.some((item) => query.includes(item))) {
        return { canonical, ...details };
      }
    }
    return null;
  }

  async openApplication(name) {
    const application = this.resolveApplication(name);
    if (!application) return { ok: false, message: `I don't have an approved launcher for “${name}” yet.` };
    if (process.platform !== 'win32') {
      return { ok: false, message: `${application.canonical} is configured for Windows and will launch on your Alienware.` };
    }
    try {
      const commandArgs = ['/d', '/s', '/c', 'start', '""', application.command, ...(application.args || [])];
      const child = spawn(process.env.ComSpec || 'cmd.exe', commandArgs, {
        detached: true, stdio: 'ignore', shell: false, windowsHide: false
      });
      child.unref();
      return { ok: true, message: `Opening ${application.canonical}.` };
    } catch (error) {
      return { ok: false, message: `I couldn't open ${application.canonical}: ${error.message}` };
    }
  }

  async openPath(targetPath) {
    if (!targetPath) return { ok: false, message: 'That folder has not been assigned yet.' };
    try {
      if (!fs.existsSync(targetPath)) return { ok: false, message: `I can't find ${targetPath}. Update it in Settings.` };
      const error = await this.shell.openPath(targetPath);
      if (error) return { ok: false, message: error };
      return { ok: true, message: `Opening ${path.basename(targetPath) || targetPath}.`, path: targetPath };
    } catch (error) {
      return { ok: false, message: `I couldn't open that location: ${error.message}` };
    }
  }

  async openFocusMode() {
    const apps = this.config.getSettings().focusApps || [];
    const results = [];
    for (const name of apps) results.push(await this.openApplication(name));
    const opened = results.filter((item) => item.ok).length;
    return {
      ok: opened > 0,
      message: opened > 0
        ? `Focus mode is active. I opened ${opened} approved application${opened === 1 ? '' : 's'}.`
        : 'Focus mode is configured, but none of its Windows applications could be opened.'
    };
  }

  async listDirectory(directory) {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    const items = await Promise.all(entries
      .filter((entry) => !SKIP_DIRECTORIES.has(entry.name))
      .slice(0, 400)
      .map(async (entry) => {
        const fullPath = path.join(directory, entry.name);
        let stats;
        try { stats = await fs.promises.stat(fullPath); } catch {
          // Windows junctions such as Documents\My Music deny access and can
          // never be opened; showing them only produces dead folders.
          return null;
        }
        return fileInfo(fullPath, entry, stats);
      }));
    return items.filter(Boolean).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async searchFiles(query, maxResults = 60) {
    const raw = normalize(query);
    const wantsLatest = /\b(latest|newest|most recent)\b/.test(raw);
    const cleaned = raw.replace(/\b(latest|newest|most recent)\b/g, '').trim();
    const terms = cleaned.split(/[^a-z0-9]+/).filter((term) => term && !SEARCH_FILLER.has(term));
    const settings = this.config.getSettings();
    const roots = settings.searchRoots || [];
    const projectTerms = new Set(Object.keys(settings.projects || {}).flatMap((name) => name.split(/[^a-z0-9]+/).filter(Boolean)));
    const contentTerms = terms.filter((term) => !projectTerms.has(term));
    const results = [];
    const deadline = Date.now() + 15000;
    let scannedFolders = 0;
    let scannedItems = 0;

    const scoreEntry = (entryName, fullPath) => {
      const name = normalize(entryName);
      const haystack = normalize(fullPath);
      let score = 0;
      let contentNameMatches = 0;
      for (const term of terms) {
        if (name === term) { score += 8; if (contentTerms.includes(term)) contentNameMatches += 1; }
        else if (name.startsWith(term)) { score += 5; if (contentTerms.includes(term)) contentNameMatches += 1; }
        else if (name.includes(term)) { score += 3; if (contentTerms.includes(term)) contentNameMatches += 1; }
        else if (haystack.includes(term)) score += 1;
      }
      if (cleaned && name.includes(cleaned)) score += 8;
      if (contentTerms.length && contentNameMatches === 0) return { score: 0, contentNameMatches: 0 };
      return { score, contentNameMatches };
    };

    const walk = async (directory, depth = 0) => {
      if (Date.now() > deadline || depth > 10) return;
      let entries;
      try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); }
      catch { return; }
      scannedFolders += 1;
      if (scannedFolders % 4 === 0) {
        this.emit('files:progress', {
          directory, scannedFolders, scannedItems, matches: results.length
        });
      }

      for (const entry of entries) {
        if (Date.now() > deadline) return;
        if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
        scannedItems += 1;
        const fullPath = path.join(directory, entry.name);
        const match = scoreEntry(entry.name, fullPath);
        if (match.score > 0) {
          let stats;
          try { stats = await fs.promises.stat(fullPath); } catch {}
          results.push({ ...fileInfo(fullPath, entry, stats), score: match.score, contentNameMatches: match.contentNameMatches });
          results.sort((a, b) => b.score - a.score || new Date(b.modifiedAt || 0) - new Date(a.modifiedAt || 0));
          if (results.length > maxResults * 3) results.length = maxResults * 2;
          this.emit('files:match', { file: results[0], matches: results.length });
        }
        if (entry.isDirectory()) await walk(fullPath, depth + 1);
      }
    };

    this.emit('files:start', { query, roots });
    for (const root of roots) {
      if (Date.now() > deadline) break;
      await walk(root);
    }

    results.sort((a, b) => {
      if (wantsLatest && a.modifiedAt && b.modifiedAt) {
        const dateDifference = new Date(b.modifiedAt) - new Date(a.modifiedAt);
        if (Math.abs(dateDifference) > 1000) return dateDifference;
      }
      return b.score - a.score || new Date(b.modifiedAt || 0) - new Date(a.modifiedAt || 0);
    });
    const finalResults = results.slice(0, maxResults);
    this.emit('files:complete', { query, files: finalResults, scannedFolders, scannedItems });
    return finalResults;
  }

  async executePowerAction(action) {
    if (process.platform !== 'win32') return { ok: false, message: 'Power controls are enabled only in the Windows build.' };
    const args = action === 'restart' ? ['/r', '/t', '30'] : ['/s', '/t', '30'];
    try {
      const child = spawn('shutdown.exe', args, { detached: true, stdio: 'ignore', shell: false });
      child.unref();
      return { ok: true, message: `${action === 'restart' ? 'Restart' : 'Shutdown'} scheduled in 30 seconds.` };
    } catch (error) {
      return { ok: false, message: `Power command failed: ${error.message}` };
    }
  }
}

module.exports = { ToolService };
