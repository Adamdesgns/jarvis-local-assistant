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
}

module.exports = { MemoryStore };
