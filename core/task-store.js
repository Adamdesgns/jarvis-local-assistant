const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class TaskStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'tasks.json');
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

  add(input) {
    const task = {
      id: crypto.randomUUID(),
      title: String(input.title || '').trim(),
      project: String(input.project || 'general').toLowerCase(),
      priority: input.priority || 'normal',
      dueAt: input.dueAt || null,
      status: 'open',
      notified: false,
      createdAt: new Date().toISOString(),
      completedAt: null
    };
    if (!task.title) throw new Error('A task needs a title.');
    this.items.unshift(task);
    this.#persist();
    return task;
  }

  list(filters = {}) {
    return this.items
      .filter((task) => !filters.status || task.status === filters.status)
      .filter((task) => !filters.project || task.project === filters.project)
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
        if (a.dueAt && b.dueAt) return new Date(a.dueAt) - new Date(b.dueAt);
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
  }

  update(id, patch) {
    const task = this.items.find((item) => item.id === id);
    if (!task) return null;
    for (const key of ['title', 'project', 'priority', 'dueAt', 'status', 'notified']) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) task[key] = patch[key];
    }
    if (patch.status === 'done') task.completedAt = new Date().toISOString();
    if (patch.status === 'open') task.completedAt = null;
    this.#persist();
    return task;
  }

  remove(id) {
    const before = this.items.length;
    this.items = this.items.filter((item) => item.id !== id);
    if (this.items.length !== before) this.#persist();
    return this.items.length !== before;
  }

  find(query) {
    const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    return this.items
      .filter((task) => task.status === 'open')
      .map((task) => ({
        task,
        score: terms.reduce((score, term) => score + (task.title.toLowerCase().includes(term) ? 1 : 0), 0)
      }))
      .sort((a, b) => b.score - a.score)[0]?.task || null;
  }

  dueForNotification(now = new Date()) {
    return this.items.filter((task) =>
      task.status === 'open' && task.dueAt && !task.notified && new Date(task.dueAt) <= now
    );
  }

  summary() {
    const open = this.items.filter((task) => task.status === 'open');
    const overdue = open.filter((task) => task.dueAt && new Date(task.dueAt) < new Date());
    return { open: open.length, overdue: overdue.length, tasks: this.list({ status: 'open' }).slice(0, 8) };
  }
}

module.exports = { TaskStore };
