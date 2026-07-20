const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SKIP_DIRECTORIES = new Set([
  '.git', '.svn', 'node_modules', 'AppData', '$Recycle.Bin',
  'System Volume Information', 'Windows', 'ProgramData', '.venv'
]);
const SEARCH_FILLER = new Set(['the', 'a', 'an', 'my', 'file', 'folder', 'document', 'please', 'for', 'me', 'called', 'named']);
const EXTERNAL_OPEN_TIMEOUT_MS = 8000;

// Processes JARVIS will never close, no matter what alias or casing a
// request arrives in. explorer.exe IS the Windows shell (taskbar, Start
// menu, desktop) — killing it takes the owner's whole desktop down, not
// just a window. "Close File Explorer" is handled as a special case
// (#closeExplorerWindows) that closes folder *windows* via COM, never the
// process itself. JARVIS's own process name is added at call time in
// closeApplication, since it depends on how JARVIS is currently running
// (packaged exe vs. `electron .` in dev vs. under `node --test`).
const SYSTEM_PROCESS_DENYLIST = new Set([
  'explorer', 'csrss', 'winlogon', 'services', 'lsass', 'smss', 'wininit', 'svchost', 'system', 'registry'
]);

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

// Pure normalisation: lowercase, trimmed, ".exe" suffix stripped. Used to
// compare a resolved application's command (e.g. "explorer.exe") against
// the denylist and against JARVIS's own executable name, so "Explorer",
// "explorer.exe", and "EXPLORER" all resolve to the same "explorer".
function normalizeProcessName(value) {
  return String(value || '').trim().toLowerCase().replace(/\.exe$/, '');
}

// Pure denylist decision, independent of I/O, so it can be unit tested
// directly. `selfProcessName` is JARVIS's own current executable name
// (also normalised here) — passing it in keeps this function pure instead
// of reaching for `process.execPath` itself.
function isProtectedProcess(name, selfProcessName) {
  const normalized = normalizeProcessName(name);
  if (!normalized) return false;
  if (SYSTEM_PROCESS_DENYLIST.has(normalized)) return true;
  if (selfProcessName && normalized === normalizeProcessName(selfProcessName)) return true;
  return false;
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
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
  constructor({ config, shell, app, emit, launchProcess }) {
    this.config = config;
    this.shell = shell;
    this.app = app;
    this.emit = emit || (() => {});
    this.launchProcess = launchProcess || spawn;
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

  // Closes an approved application gracefully — never a force-kill. The app
  // name is only ever used as data to look up a canonical entry in the
  // approved applications registry (same resolveApplication used by
  // openApplication); it is never interpolated into a command string that
  // gets evaluated by a shell. System/shell processes are refused outright,
  // except explorer.exe, which gets the special window-closing path so the
  // shell itself is never touched. See #gracefulClose and
  // #closeExplorerWindows for the two mechanisms.
  async closeApplication(name) {
    const application = this.resolveApplication(name);
    if (!application) {
      return { ok: false, message: `I don't have an approved app matching "${name}" to close.` };
    }

    const processName = normalizeProcessName(application.command);
    const selfProcessName = normalizeProcessName(path.basename(process.execPath));

    if (isProtectedProcess(processName, selfProcessName)) {
      if (processName === 'explorer') return this.#closeExplorerWindows();
      return {
        ok: false,
        message: `I won't close ${application.canonical}, sir. It's a core Windows process — or me — and force-quitting it could take down your desktop, or take me down with it. Refusing this one on principle.`
      };
    }

    if (process.platform !== 'win32') {
      return { ok: false, message: `${application.canonical} is configured for Windows and will close on your Alienware.` };
    }

    return this.#gracefulClose(application.canonical, `${processName}.exe`);
  }

  // Graceful close only: taskkill /IM without /F asks Windows to send the
  // normal close request (WM_CLOSE) to the app's window(s), the same
  // mechanism as clicking the X or calling CloseMainWindow() — the app gets
  // a chance to prompt "save changes?" before it exits. We never add /F.
  // If the app refuses to close (taskkill reports it "can only be
  // terminated forcefully"), that is reported honestly and left alone —
  // JARVIS does not escalate to a force kill.
  #gracefulClose(canonicalName, imageName) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        finish({ ok: false, message: `${canonicalName} didn't confirm closing in time. It may be waiting on a prompt of its own.` });
      }, EXTERNAL_OPEN_TIMEOUT_MS);
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      let child;
      try {
        child = this.launchProcess('taskkill.exe', ['/IM', imageName], { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
      } catch (error) {
        finish({ ok: false, message: `I couldn't close ${canonicalName}: ${error.message}` });
        return;
      }
      let output = '';
      child.stdout?.on('data', (chunk) => { output += chunk; });
      child.stderr?.on('data', (chunk) => { output += chunk; });
      child.once('error', (error) => finish({ ok: false, message: `I couldn't close ${canonicalName}: ${error.message}` }));
      child.once('close', (code) => {
        const text = output.toLowerCase();
        if (code === 0) {
          finish({ ok: true, message: `Closed ${canonicalName}.` });
        } else if (text.includes('forcefully')) {
          finish({ ok: false, message: `${canonicalName} didn't close gracefully — forcing it risks losing unsaved work, so I won't. Please save and close it yourself, sir.` });
        } else if (text.includes('not found') || text.includes('no running instance')) {
          finish({ ok: false, message: `${canonicalName} doesn't appear to be running.` });
        } else {
          finish({ ok: false, message: `I couldn't close ${canonicalName} gracefully.${output.trim() ? ` ${output.trim()}` : ''}` });
        }
      });
    });
  }

  // "Close File Explorer" must close the file-browser *windows*, never the
  // explorer.exe process — that process is the Windows shell (taskbar,
  // Start menu, desktop icons). This uses the Shell.Application COM object
  // to enumerate open windows and calls .Quit() on each Explorer-hosted one
  // individually — the documented way to close a folder window without
  // touching the shell process that hosts it. The PowerShell script below
  // is a fixed constant with no interpolated data of any kind (per the
  // house rule against model/user-built shell strings) — it takes no
  // arguments and enumerates purely by asking Windows what is open.
  #closeExplorerWindows() {
    const script = 'try { $shell = New-Object -ComObject Shell.Application; $closed = 0; '
      + 'foreach ($w in @($shell.Windows())) { try { if ($w.FullName -and ($w.FullName -match "explorer\\.exe$")) { $w.Quit(); $closed++ } } catch {} }; '
      + 'Write-Output ("CLOSED:" + $closed) } catch { Write-Output "CLOSED:ERROR" }';
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        finish({ ok: false, message: `File Explorer didn't confirm closing in time. Your desktop and taskbar are untouched.` });
      }, EXTERNAL_OPEN_TIMEOUT_MS);
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      let child;
      try {
        child = this.launchProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
      } catch (error) {
        finish({ ok: false, message: `I couldn't close File Explorer windows: ${error.message}` });
        return;
      }
      let output = '';
      child.stdout?.on('data', (chunk) => { output += chunk; });
      child.stderr?.on('data', (chunk) => { output += chunk; });
      child.once('error', (error) => finish({ ok: false, message: `I couldn't close File Explorer windows: ${error.message}` }));
      child.once('close', () => {
        const match = output.match(/CLOSED:(\d+|ERROR)/);
        if (!match || match[1] === 'ERROR') {
          finish({ ok: false, message: `I couldn't close the File Explorer windows cleanly. Your desktop and taskbar are untouched — I never touch the explorer.exe process itself.` });
          return;
        }
        const count = Number(match[1]);
        finish({
          ok: true,
          message: count > 0
            ? `Closed ${count} File Explorer window${count === 1 ? '' : 's'}. Your taskbar and desktop are untouched.`
            : `No File Explorer windows were open to close.`
        });
      });
    });
  }

  async openPath(targetPath) {
    if (!targetPath) return { ok: false, message: 'That folder has not been assigned yet.' };
    try {
      if (!fs.existsSync(targetPath)) return { ok: false, message: `I can't find ${targetPath}. Update it in Settings.` };
      const stats = fs.statSync(targetPath);
      this.#launchPath(targetPath, stats);
      this.#recordRecentFile(targetPath);
      return { ok: true, message: `Opening ${path.basename(targetPath) || targetPath}.`, path: targetPath };
    } catch (error) {
      return { ok: false, message: `I couldn't open that location: ${error.message}` };
    }
  }

  #launchPath(targetPath, stats) {
    const isDirectory = stats.isDirectory();
    if (process.platform === 'win32' && isDirectory) {
      console.info(`[JARVIS] Opening Explorer for path: ${targetPath}`);
      try {
        const child = this.launchProcess('explorer.exe', [targetPath], {
          detached: true,
          stdio: 'ignore',
          shell: false,
          windowsHide: false
        });
        child.once('error', (error) => {
          console.error(`[JARVIS] Explorer launch failed for ${targetPath}: ${error.message}`);
        });
        child.unref();
        console.info(`[JARVIS] Explorer launch dispatched for path: ${targetPath}`);
      } catch (error) {
        console.error(`[JARVIS] Explorer launch threw for ${targetPath}: ${error.message}`);
        throw error;
      }
      return;
    }

    console.info(`[JARVIS] Opening path via Electron shell: ${targetPath}`);
    withTimeout(this.shell.openPath(targetPath), EXTERNAL_OPEN_TIMEOUT_MS, 'shell.openPath')
      .then((error) => {
        if (error) console.error(`[JARVIS] shell.openPath returned an error for ${targetPath}: ${error}`);
        else console.info(`[JARVIS] shell.openPath completed for ${targetPath}`);
      })
      .catch((error) => {
        console.error(`[JARVIS] shell.openPath failed for ${targetPath}: ${error.message}`);
      });
  }

  #recordRecentFile(targetPath) {
    try {
      if (!fs.statSync(targetPath).isFile()) return;
      const recent = (this.config.getSettings().recentFiles || [])
        .filter((item) => item.path !== targetPath)
        .slice(0, 9);
      recent.unshift({ name: path.basename(targetPath), path: targetPath, openedAt: new Date().toISOString() });
      this.config.updateSettings({ recentFiles: recent });
    } catch {}
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

module.exports = { ToolService, normalizeProcessName, isProtectedProcess, SYSTEM_PROCESS_DENYLIST };
