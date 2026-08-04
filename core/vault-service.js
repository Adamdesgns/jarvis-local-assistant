const fs = require('node:fs');
const path = require('node:path');

// The vault is JARVIS's long-form memory: plain markdown files in one folder,
// readable by a human or by Obsidian, with no database in between.
//   vault/raw/      — everything captured (voice notes, daily logs)
//   vault/wiki/     — distilled knowledge, one topic per note
//   vault/outputs/  — everything JARVIS ships (reports, plans, pulls)
// Notes may link to each other with [[wikilinks]]; graph() reads them back.
const FOLDERS = ['raw', 'wiki', 'outputs'];
const MAX_NOTE_BYTES = 512 * 1024;

function slugify(value, fallback = 'note') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || fallback;
}

function dateStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function extractWikilinks(text) {
  const links = [];
  const pattern = /\[\[([^\[\]|#]+)(?:[#|][^\[\]]*)?\]\]/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const target = match[1].trim();
    if (target) links.push(target);
  }
  return links;
}

class VaultService {
  constructor(userDataPath) {
    this.root = path.join(userDataPath, 'vault');
  }

  #ensure(folder) {
    const dir = folder ? path.join(this.root, folder) : this.root;
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // Every filename the vault writes is built from slugified parts, so a title
  // like "../../evil" can never climb out of the vault folder. This resolves
  // and double-checks anyway — belt and braces around the disk boundary.
  #resolveInside(...parts) {
    const target = path.resolve(this.root, ...parts);
    if (target !== this.root && !target.startsWith(this.root + path.sep)) {
      throw new Error('That path is outside the vault.');
    }
    return target;
  }

  // raw/YYYY-MM-DD-slug.md — a numbered suffix keeps same-day same-title
  // captures from overwriting each other.
  #freshFile(dir, baseName) {
    let name = `${baseName}.md`;
    let counter = 2;
    while (fs.existsSync(path.join(dir, name))) {
      name = `${baseName}-${counter}.md`;
      counter += 1;
    }
    return path.join(dir, name);
  }

  capture(text, { title, tags = [], source = 'voice' } = {}) {
    const body = String(text || '').trim();
    if (!body) throw new Error('There is nothing to capture.');
    const dir = this.#ensure('raw');
    const stamp = dateStamp();
    const filePath = this.#freshFile(dir, `${stamp}-${slugify(title || body.slice(0, 48))}`);
    const front = [
      '---',
      `created: ${new Date().toISOString()}`,
      `source: ${slugify(source, 'unknown')}`,
      tags.length ? `tags: [${tags.map((tag) => slugify(tag, '')).filter(Boolean).join(', ')}]` : null,
      '---',
      ''
    ].filter((line) => line !== null);
    fs.writeFileSync(this.#resolveInside(filePath), `${front.join('\n')}${body}\n`, 'utf8');
    return { path: filePath, name: path.basename(filePath, '.md') };
  }

  dailyNotePath(date = new Date()) {
    return path.join(this.#ensure(path.join('raw', 'daily')), `${dateStamp(date)}.md`);
  }

  // The day's running log: "Inbox Brief", "Plan", "Reflection" all land as
  // sections of one note, appended in the order they happened.
  appendDaily(section, content, date = new Date()) {
    const filePath = this.#resolveInside(this.dailyNotePath(date));
    const heading = String(section || 'Log').trim();
    const body = String(content || '').trim();
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, `# ${dateStamp(date)}\n`, 'utf8');
    }
    fs.appendFileSync(filePath, `\n## ${heading}\n\n${body}\n`, 'utf8');
    return { path: filePath, name: path.basename(filePath, '.md') };
  }

  // Wiki notes are distilled knowledge — writing one again means the
  // distillation improved, so the same title overwrites in place.
  writeWiki(title, content) {
    const dir = this.#ensure('wiki');
    const filePath = this.#resolveInside(path.join(dir, `${slugify(title)}.md`));
    fs.writeFileSync(filePath, `${String(content || '').trim()}\n`, 'utf8');
    return { path: filePath, name: path.basename(filePath, '.md') };
  }

  writeOutput(name, content) {
    const dir = this.#ensure('outputs');
    const filePath = this.#freshFile(dir, `${dateStamp()}-${slugify(name, 'report')}`);
    fs.writeFileSync(this.#resolveInside(filePath), `${String(content || '').trim()}\n`, 'utf8');
    return { path: filePath, name: path.basename(filePath, '.md') };
  }

  #walk() {
    const notes = [];
    for (const folder of FOLDERS) {
      const dir = path.join(this.root, folder);
      if (!fs.existsSync(dir)) continue;
      const stack = [dir];
      while (stack.length) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) stack.push(full);
          else if (entry.isFile() && entry.name.endsWith('.md')) {
            notes.push({
              path: full,
              name: path.basename(entry.name, '.md'),
              folder,
              mtime: fs.statSync(full).mtimeMs
            });
          }
        }
      }
    }
    return notes;
  }

  #read(filePath) {
    try {
      const size = fs.statSync(filePath).size;
      if (size > MAX_NOTE_BYTES) return '';
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      return '';
    }
  }

  search(query, limit = 6) {
    const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const results = [];
    for (const note of this.#walk()) {
      const content = this.#read(note.path);
      const haystack = `${note.name}\n${content}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      if (!score) continue;
      const line = content.split('\n').find((row) => terms.some((term) => row.toLowerCase().includes(term)));
      results.push({ ...note, score, snippet: (line || '').trim().slice(0, 140) });
    }
    return results.sort((a, b) => b.score - a.score || b.mtime - a.mtime).slice(0, limit);
  }

  recent(limit = 8) {
    return this.#walk().sort((a, b) => b.mtime - a.mtime).slice(0, limit);
  }

  readNote(name) {
    const wanted = String(name || '').toLowerCase();
    const note = this.#walk().find((item) => item.name.toLowerCase() === wanted);
    if (!note) return null;
    return { ...note, content: this.#read(note.path) };
  }

  // The link graph: every [[wikilink]] is an edge from the note that wrote it
  // to the note it names. Notes linked often are the vault's center of gravity.
  graph() {
    const notes = this.#walk();
    const links = [];
    const inbound = new Map();
    for (const note of notes) {
      for (const target of extractWikilinks(this.#read(note.path))) {
        links.push({ from: note.name, to: target });
        inbound.set(target, (inbound.get(target) || 0) + 1);
      }
    }
    const mostLinked = [...inbound.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    return { notes: notes.length, links, mostLinked };
  }

  stats() {
    const notes = this.#walk();
    const byFolder = { raw: 0, wiki: 0, outputs: 0 };
    for (const note of notes) byFolder[note.folder] += 1;
    return { ...byFolder, total: notes.length, links: this.graph().links.length };
  }
}

module.exports = { VaultService, slugify, extractWikilinks, dateStamp };
