const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const AdmZip = require('adm-zip');
const { XMLParser } = require('fast-xml-parser');

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.json', '.csv', '.log', '.js', '.ts', '.html', '.css', '.xml', '.yaml', '.yml']);
const DOCUMENT_EXTENSIONS = new Set([...TEXT_EXTENSIONS, '.pdf', '.docx', '.xlsx']);
const SKIP_DIRECTORIES = new Set(['.git', '.svn', 'node_modules', 'AppData', '$Recycle.Bin', 'System Volume Information', 'Windows', 'ProgramData', '.venv']);

const RESERVED_DEVICE_NAME = /^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)/i;

// Windows permanently erases items the Recycle Bin can't hold, so JARVIS
// refuses those rather than destroying something he was asked to "delete".
// Windows actually sizes the bin at roughly 5% of the volume, not a flat
// number — on anything smaller than a ~10 GB partition the real quota is
// under 2 GB, so a flat 2 GB cap here would wave through files the bin
// cannot really hold. 512 MB is a conservative floor that stays safe on
// small volumes too.
const RECYCLE_MAX_BYTES = 512 * 1024 * 1024;

function cleanName(value, fallback = 'Untitled') {
  // Slice BEFORE trim: trimming first can leave a trailing space re-exposed
  // by the subsequent slice (e.g. "...aaa   bbb" truncated mid-run of spaces).
  const name = String(value || fallback).replace(/[<>:"/\\|?*\x00-\x1F]/g, '').slice(0, 120).trim();
  if (!name || /^\.+$/.test(name) || RESERVED_DEVICE_NAME.test(name)) return fallback;
  return name;
}

// iOS Safari's Photo Library picker hands over a bare GUID instead of a real
// filename (e.g. "9F4B5160-A908-4DEA-8D5F-76EFFBB43118.png"). JARVIS's file
// search matches on name, so a file like that is functionally invisible the
// moment it lands — nothing the owner would ever say ("the picture I sent")
// matches a GUID. This is a small pure function so the "is this name
// meaningless?" decision is directly testable without touching the
// filesystem; callers only ever get a smart replacement name for input this
// returns true for — a genuinely meaningful name (e.g. "invoice-march") must
// never be touched.
const GUID_RE = /^\{?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}?$/i;

function isMeaninglessName(base) {
  const trimmed = String(base === undefined || base === null ? '' : base).trim();
  if (!trimmed) return true;
  if (GUID_RE.test(trimmed)) return true;
  const stripped = trimmed.replace(/[\s\-_{}]/g, '');
  if (!stripped) return true;
  // "all hex digits" (which also covers "no letters at all", since decimal
  // digits are a subset of hex digits) catches a GUID with no dashes, a
  // content hash, or a bare numeric timestamp — none of which a person would
  // ever say aloud to find the file again.
  return /^[0-9a-f]+$/i.test(stripped);
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.heic', '.heif', '.gif', '.webp', '.bmp', '.tiff', '.tif']);

function pad2(number) { return String(number).padStart(2, '0'); }

// A findable, dated, speakable fallback name for arriving files whose given
// name is meaningless (see isMeaninglessName above) — e.g. "Phone photo
// 2026-07-20 12-16". This is a *fallback* for meaningless input, never a
// substitute for cleanName/the dedupe loop/the approved-folder guard.
function smartUploadName(extension, now = new Date()) {
  const stamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}-${pad2(now.getMinutes())}`;
  const prefix = IMAGE_EXTENSIONS.has(String(extension || '').toLowerCase()) ? 'Phone photo' : 'Phone file';
  return `${prefix} ${stamp}`;
}

function arrayOf(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function xmlText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'object') return String(value);
  if (value['#text'] !== undefined) return String(value['#text']);
  if (value.t !== undefined) return xmlText(value.t);
  if (value.r !== undefined) return arrayOf(value.r).map((item) => xmlText(item.t)).join('');
  return '';
}

function readXlsx(filePath) {
  const zip = new AdmZip(filePath);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });
  const sharedEntry = zip.getEntry('xl/sharedStrings.xml');
  const shared = sharedEntry
    ? arrayOf(parser.parse(sharedEntry.getData().toString('utf8'))?.sst?.si).map(xmlText)
    : [];
  const sheets = zip.getEntries().filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.entryName));
  return sheets.map((entry, index) => {
    const parsed = parser.parse(entry.getData().toString('utf8'))?.worksheet;
    const rows = arrayOf(parsed?.sheetData?.row).map((row) => arrayOf(row.c).map((cell) => {
      if (cell?.['@_t'] === 's') return shared[Number(cell.v)] || '';
      if (cell?.['@_t'] === 'inlineStr') return xmlText(cell.is);
      return xmlText(cell?.v);
    }).join(','));
    return `SHEET ${index + 1}\n${rows.join('\n')}`;
  }).join('\n\n');
}

class DocumentService {
  constructor({ config, shell, emit }) {
    this.config = config;
    this.shell = shell;
    this.emit = emit || (() => {});
  }

  approvedRoots() {
    const settings = this.config.getSettings();
    return [...new Set([...(settings.searchRoots || []), ...Object.values(settings.projects || {}).filter(Boolean)])]
      .filter((root) => root && fs.existsSync(root));
  }

  isAllowed(target) {
    let resolved;
    try { resolved = path.resolve(target); } catch { return false; }
    return this.approvedRoots().some((root) => {
      const base = path.resolve(root);
      return resolved === base || resolved.startsWith(`${base}${path.sep}`);
    });
  }

  resolveLocation(label = '') {
    const query = String(label).trim().toLowerCase().replace(/^(?:my|the)\s+/, '');
    const settings = this.config.getSettings();
    const project = Object.entries(settings.projects || {}).find(([name, value]) => value && query.includes(name));
    if (project) return project[1];
    const roots = this.approvedRoots();
    const named = roots.find((root) => path.basename(root).toLowerCase() === query || query.includes(path.basename(root).toLowerCase()));
    if (named) return named;
    const homeCandidate = ['documents', 'desktop', 'downloads'].includes(query) ? path.join(os.homedir(), query[0].toUpperCase() + query.slice(1)) : '';
    if (homeCandidate && this.isAllowed(homeCandidate)) return homeCandidate;
    return query ? '' : (roots[0] || '');
  }

  supports(filePath) {
    return DOCUMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
  }

  async readDocument(filePath, maxCharacters = 50000) {
    if (!this.isAllowed(filePath)) throw new Error('That document is outside your approved folders.');
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) throw new Error('That path is not a document.');
    if (stats.size > 25 * 1024 * 1024) throw new Error('That document is larger than the current 25 MB reading limit.');
    const extension = path.extname(filePath).toLowerCase();
    let text = '';
    if (TEXT_EXTENSIONS.has(extension)) {
      text = await fs.promises.readFile(filePath, 'utf8');
    } else if (extension === '.pdf') {
      const result = await pdfParse(await fs.promises.readFile(filePath));
      text = result.text || '';
    } else if (extension === '.docx') {
      const result = await mammoth.extractRawText({ path: filePath });
      text = result.value || '';
    } else if (extension === '.xlsx') {
      text = readXlsx(filePath);
    } else {
      throw new Error('JARVIS can currently read PDF, Word DOCX, Excel XLSX, CSV, text, Markdown, JSON and common code files.');
    }
    const normalized = String(text).replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').trim();
    return {
      name: path.basename(filePath), path: filePath, extension: extension.slice(1),
      size: stats.size, modifiedAt: stats.mtime.toISOString(),
      text: normalized.slice(0, maxCharacters), truncated: normalized.length > maxCharacters
    };
  }

  // Break a document into cited passages: real page numbers for PDFs, and
  // numbered sections for everything else, so answers can point back to a spot.
  async readPassages(filePath, maxChars = 120000) {
    if (!this.isAllowed(filePath)) throw new Error('That document is outside your approved folders.');
    const extension = path.extname(filePath).toLowerCase();
    const name = path.basename(filePath);
    if (extension === '.pdf') {
      const pages = [];
      await pdfParse(await fs.promises.readFile(filePath), {
        pagerender: (pageData) => pageData.getTextContent().then((content) => {
          const text = content.items.map((item) => item.str).join(' ').replace(/\s+/g, ' ').trim();
          pages.push(text);
          return text;
        })
      });
      return { name, path: filePath, passages: pages.map((text, index) => ({ page: index + 1, text })).filter((p) => p.text) };
    }
    const document = await this.readDocument(filePath, maxChars);
    const chunkSize = 1500;
    const passages = [];
    for (let i = 0, section = 1; i < document.text.length; i += chunkSize, section += 1) {
      const text = document.text.slice(i, i + chunkSize).trim();
      if (text) passages.push({ page: null, section, text });
    }
    return { name, path: filePath, passages };
  }

  // Retrieve the passages most relevant to a question across approved documents.
  async gatherPassages(query, { maxFiles = 4, maxPassages = 6 } = {}) {
    const terms = String(query).toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 1);
    if (!terms.length) return [];
    const files = await this.searchContents(query, maxFiles);
    const passages = [];
    for (const file of files) {
      let doc;
      try { doc = await this.readPassages(file.path); } catch { continue; }
      for (const passage of doc.passages) {
        const lower = passage.text.toLowerCase();
        const score = terms.reduce((total, term) => total + (lower.split(term).length - 1), 0);
        if (score > 0) {
          passages.push({
            name: doc.name, path: doc.path, page: passage.page, section: passage.section,
            score, text: passage.text.slice(0, 700)
          });
        }
      }
    }
    passages.sort((a, b) => b.score - a.score);
    return passages.slice(0, maxPassages);
  }

  async searchContents(query, maxResults = 25) {
    const terms = String(query).toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 1);
    if (!terms.length) return [];
    const results = [];
    const deadline = Date.now() + 30000;
    let checked = 0;

    const walk = async (directory, depth = 0) => {
      if (Date.now() > deadline || depth > 8 || checked >= 160) return;
      let entries;
      try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (Date.now() > deadline || checked >= 160) return;
        if (entry.isDirectory()) {
          if (!SKIP_DIRECTORIES.has(entry.name)) await walk(path.join(directory, entry.name), depth + 1);
          continue;
        }
        const filePath = path.join(directory, entry.name);
        if (!this.supports(filePath)) continue;
        checked += 1;
        if (checked % 5 === 0) this.emit('files:progress', { directory, scannedFolders: 0, scannedItems: checked, matches: results.length });
        try {
          const document = await this.readDocument(filePath, 120000);
          const lower = document.text.toLowerCase();
          const matches = terms.reduce((total, term) => total + (lower.split(term).length - 1), 0);
          if (!matches) continue;
          const firstIndex = Math.min(...terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0));
          const start = Math.max(0, firstIndex - 100);
          results.push({
            name: document.name, path: filePath, extension: document.extension,
            modifiedAt: document.modifiedAt, score: matches,
            snippet: document.text.slice(start, start + 320).replace(/\s+/g, ' ')
          });
          results.sort((a, b) => b.score - a.score || new Date(b.modifiedAt) - new Date(a.modifiedAt));
          if (results.length > maxResults * 2) results.length = maxResults;
        } catch {}
      }
    };

    this.emit('files:start', { query: `inside documents: ${query}`, roots: this.approvedRoots() });
    for (const root of this.approvedRoots()) await walk(root);
    const finalResults = results.slice(0, maxResults);
    this.emit('files:complete', { query, files: finalResults, scannedFolders: 0, scannedItems: checked });
    return finalResults;
  }

  async createFolder(location, name) {
    const parent = this.resolveLocation(location);
    if (!parent || !this.isAllowed(parent)) throw new Error('Choose or approve that destination folder in Settings first.');
    const target = path.join(parent, cleanName(name, 'New Folder'));
    await fs.promises.mkdir(target, { recursive: false });
    return { ok: true, path: target, message: `Created folder ${path.basename(target)}.` };
  }

  async createTextFile(location, name, content, extension = '.txt') {
    const directory = this.resolveLocation(location);
    if (!directory || !this.isAllowed(directory)) throw new Error('Choose or approve that destination folder in Settings first.');
    const safeExtension = extension.startsWith('.') ? extension : `.${extension}`;
    const base = cleanName(name, 'JARVIS Note').replace(/\.[^.]+$/, '');
    let target = path.join(directory, `${base}${safeExtension}`);
    let count = 2;
    while (fs.existsSync(target)) target = path.join(directory, `${base} ${count++}${safeExtension}`);
    await fs.promises.writeFile(target, String(content || ''), { encoding: 'utf8', flag: 'wx' });
    return { ok: true, path: target, message: `Created ${path.basename(target)}.` };
  }

  // `directory` here must already be a resolved, absolute destination — NOT
  // a voice-command label. resolveLocation() is a fuzzy matcher built for
  // spoken phrases like "my documents"; it substring-matches project names
  // and root basenames against the whole string, so feeding it an
  // already-validated path (e.g. from the phone's file picker) can silently
  // rewrite "…\Documents\Invoices" down to "…\Documents". Callers that hold
  // a label, not a path, must resolve it themselves before calling this.
  async createBinaryFile(directory, name, buffer, now = new Date()) {
    if (!directory || !this.isAllowed(directory)) throw new Error('Choose or approve that destination folder in Settings first.');
    const cleaned = cleanName(name, 'Upload');
    const extension = path.extname(cleaned);
    const base = cleaned.replace(/\.[^.]+$/, '');
    // A meaningless name (bare GUID, all-hex, etc. — see isMeaninglessName)
    // gets a findable, dated fallback instead. This runs on the ALREADY
    // sanitized/traversal-stripped `base` from cleanName above, and every
    // guard below (dedupe loop, direct-child-of-directory check, wx write)
    // still applies unchanged to whichever base name wins — this is a name
    // choice, not a bypass of any of them.
    const finalBase = isMeaninglessName(base) ? smartUploadName(extension, now) : base;
    let target = path.join(directory, `${finalBase}${extension}`);
    let count = 2;
    while (fs.existsSync(target)) target = path.join(directory, `${finalBase} ${count++}${extension}`);
    // Belt-and-braces: whatever produced `target`, it must still be a direct
    // child of the approved directory before we ever touch disk.
    if (path.resolve(path.dirname(target)) !== path.resolve(directory)) throw new Error('That destination is invalid.');
    await fs.promises.writeFile(target, buffer, { flag: 'wx' });
    return { ok: true, path: target, message: `Created ${path.basename(target)}.` };
  }

  async copyItem(source, destinationDirectory) {
    if (!this.isAllowed(source) || !this.isAllowed(destinationDirectory)) throw new Error('Both locations must be approved in Settings.');
    const target = path.join(destinationDirectory, path.basename(source));
    if (fs.existsSync(target)) throw new Error(`${path.basename(target)} already exists at the destination.`);
    await fs.promises.cp(source, target, { recursive: true, errorOnExist: true });
    return { ok: true, path: target, message: `Copied ${path.basename(source)}.` };
  }

  async moveItem(source, destinationDirectory) {
    if (!this.isAllowed(source) || !this.isAllowed(destinationDirectory)) throw new Error('Both locations must be approved in Settings.');
    const target = path.join(destinationDirectory, path.basename(source));
    if (fs.existsSync(target)) throw new Error(`${path.basename(target)} already exists at the destination.`);
    try {
      await fs.promises.rename(source, target);
    } catch (error) {
      if (error.code !== 'EXDEV') throw error;
      await fs.promises.cp(source, target, { recursive: true, errorOnExist: true });
      await fs.promises.rm(source, { recursive: true });
    }
    return { ok: true, path: target, message: `Moved ${path.basename(source)}.` };
  }

  async renameItem(source, newName) {
    if (!this.isAllowed(source)) throw new Error('That item is outside your approved folders.');
    const extension = path.extname(source);
    const requested = cleanName(newName, path.basename(source));
    const finalName = path.extname(requested) || !extension ? requested : `${requested}${extension}`;
    const target = path.join(path.dirname(source), finalName);
    if (fs.existsSync(target)) throw new Error(`${finalName} already exists.`);
    await fs.promises.rename(source, target);
    return { ok: true, path: target, message: `Renamed it to ${finalName}.` };
  }

  // Is this item one the Recycle Bin will actually catch? Windows silently
  // erases for good on network shares, on volumes without a bin (most USB
  // sticks), and for items over the bin's quota. JARVIS refuses those.
  canRecycle(target) {
    const resolved = path.resolve(target);
    // Checked ahead of isAllowed(): approvedRoots() probes each root with
    // fs.existsSync, which for an unreachable UNC path can block for seconds
    // before returning false — slow, and it would surface the wrong reason
    // ("outside approved folders" instead of "network drive").
    if (resolved.startsWith('\\\\')) {
      return { ok: false, reason: "That's on a network drive, which has no Recycle Bin — I'd have to erase it for good. I'd rather you did that one yourself, sir." };
    }
    if (!this.isAllowed(target)) return { ok: false, reason: 'That item is outside your approved folders.' };
    const root = path.parse(resolved).root;
    if (!root || !fs.existsSync(path.join(root, '$Recycle.Bin'))) {
      return { ok: false, reason: "That drive has no Recycle Bin, so deleting would erase it for good. I'd rather you did that one yourself, sir." };
    }
    let stats;
    try { stats = fs.statSync(resolved); } catch { return { ok: false, reason: "I couldn't find that item." }; }
    if (!stats.isFile()) {
      return { ok: false, reason: "Delete only covers files, sir — a folder over the Recycle Bin's quota is exactly what Windows erases for good. I'd rather you moved or cleared that one yourself." };
    }
    if (stats.size > RECYCLE_MAX_BYTES) {
      return { ok: false, reason: "That file may be too large for this drive's Recycle Bin quota — Windows sizes the bin at roughly 5% of the volume, so a file this size could get erased for good instead of recycled. I'd rather you did that one yourself, sir." };
    }
    return { ok: true };
  }

  async trashItem(target) {
    if (!this.isAllowed(target)) throw new Error('That item is outside your approved folders.');
    await this.shell.trashItem(target);
    return { ok: true, message: `Moved ${path.basename(target)} to the Recycle Bin.` };
  }

  async planOrganization(location) {
    const directory = this.resolveLocation(location);
    if (!directory || !this.isAllowed(directory)) throw new Error('Add that folder to approved search locations first.');
    const categories = {
      Images: new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']),
      Documents: new Set(['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv', '.txt', '.md']),
      Archives: new Set(['.zip', '.7z', '.rar', '.tar', '.gz']),
      Installers: new Set(['.exe', '.msi']),
      Media: new Set(['.mp4', '.mov', '.avi', '.mp3', '.wav', '.m4a'])
    };
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    const moves = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      const category = Object.entries(categories).find(([, extensions]) => extensions.has(extension))?.[0] || 'Other Files';
      const source = path.join(directory, entry.name);
      const destination = path.join(directory, category);
      if (!fs.existsSync(path.join(destination, entry.name))) moves.push({ source, destination, category });
    }
    return { directory, moves };
  }

  async applyOrganization(plan) {
    let moved = 0;
    for (const item of plan.moves || []) {
      if (!this.isAllowed(item.source) || !this.isAllowed(item.destination)) continue;
      await fs.promises.mkdir(item.destination, { recursive: true });
      // Organizing runs without an approval card now, so a name collision must
      // never destroy the file already sitting there.
      const extension = path.extname(item.source);
      const base = path.basename(item.source, extension);
      let target = path.join(item.destination, path.basename(item.source));
      let count = 2;
      while (fs.existsSync(target)) target = path.join(item.destination, `${base} ${count++}${extension}`);
      await fs.promises.rename(item.source, target);
      moved += 1;
    }
    return { ok: true, message: `Organized ${moved} file${moved === 1 ? '' : 's'} into labeled folders.` };
  }
}

module.exports = { DocumentService, cleanName, DOCUMENT_EXTENSIONS, isMeaninglessName, smartUploadName };
