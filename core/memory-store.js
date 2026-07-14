const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class MemoryStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'memory.json');
    this.items = this.#load();
  }

  #load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  #persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.items, null, 2), 'utf8');
  }

  add(text, project = 'general') {
    const item = {
      id: crypto.randomUUID(),
      text: String(text).trim(),
      project,
      createdAt: new Date().toISOString()
    };
    this.items.unshift(item);
    this.items = this.items.slice(0, 1000);
    this.#persist();
    return item;
  }

  search(query, limit = 6) {
    const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    return this.items
      .map((item) => ({
        ...item,
        score: terms.reduce((score, term) => score + (item.text.toLowerCase().includes(term) ? 1 : 0), 0)
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  list(limit = 8) {
    return this.items.slice(0, limit);
  }

  update(id, text) {
    const item = this.items.find((entry) => entry.id === id);
    if (!item || !String(text || '').trim()) return null;
    item.text = String(text).trim();
    this.#persist();
    return item;
  }

  remove(id) {
    const before = this.items.length;
    this.items = this.items.filter((entry) => entry.id !== id);
    if (this.items.length !== before) this.#persist();
    return this.items.length !== before;
  }

  // Merge imported memories, skipping exact-text duplicates.
  importMemories(items = []) {
    let added = 0;
    const existing = new Set(this.items.map((item) => item.text));
    for (const item of items) {
      const text = String(item?.text || '').trim();
      if (!text || existing.has(text)) continue;
      this.items.push({
        id: crypto.randomUUID(),
        text,
        project: item.project || 'general',
        createdAt: item.createdAt || new Date().toISOString()
      });
      existing.add(text);
      added += 1;
    }
    if (added) { this.items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); this.#persist(); }
    return added;
  }

  forget(query) {
    const match = this.search(query, 1)[0];
    if (!match) return null;
    this.remove(match.id);
    return match;
  }
}

module.exports = { MemoryStore };
