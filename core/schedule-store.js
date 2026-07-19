const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const REPEAT_KINDS = ['daily', 'weekdays', 'weekly', 'once'];
const ACTION_KINDS = {
  speak: 'text',
  ask: 'prompt',
  briefing: null
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateWhen(when) {
  if (!when || typeof when !== 'object') throw new Error('A schedule needs a "when".');
  if (!TIME_RE.test(when.time)) throw new Error('The schedule time must be in HH:MM (24-hour) format.');
  if (!REPEAT_KINDS.includes(when.repeat)) throw new Error(`The repeat must be one of: ${REPEAT_KINDS.join(', ')}.`);
  if (when.repeat === 'weekly') {
    if (!Number.isInteger(when.weekday) || when.weekday < 0 || when.weekday > 6) {
      throw new Error('A weekly schedule needs a weekday from 0 (Sunday) to 6 (Saturday).');
    }
  }
}

function validateAction(action) {
  if (!action || typeof action !== 'object') throw new Error('A schedule needs an "action".');
  if (!Object.prototype.hasOwnProperty.call(ACTION_KINDS, action.kind)) {
    throw new Error(`The action kind must be one of: ${Object.keys(ACTION_KINDS).join(', ')}.`);
  }
  const requiredField = ACTION_KINDS[action.kind];
  if (requiredField && !String(action[requiredField] || '').trim()) {
    throw new Error(`The "${action.kind}" action needs a "${requiredField}".`);
  }
}

class ScheduleStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'schedules.json');
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
    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.items, null, 2), 'utf8');
    fs.renameSync(temp, this.filePath);
  }

  list() {
    return clone(this.items);
  }

  add(input = {}) {
    const name = String(input.name || '').trim().slice(0, 80);
    if (!name) throw new Error('A schedule needs a name.');
    validateWhen(input.when);
    validateAction(input.action);

    const item = {
      id: crypto.randomUUID(),
      name,
      when: clone(input.when),
      action: clone(input.action),
      enabled: true,
      lastRunAt: null,
      lastResult: null
    };
    this.items.push(item);
    this.#persist();
    return clone(item);
  }

  update(id, patch = {}) {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) return null;

    const next = clone(item);
    if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
      const name = String(patch.name || '').trim().slice(0, 80);
      if (!name) throw new Error('A schedule needs a name.');
      next.name = name;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'when')) {
      next.when = { ...next.when, ...patch.when };
      validateWhen(next.when);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'action')) {
      next.action = { ...next.action, ...patch.action };
      validateAction(next.action);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) {
      next.enabled = Boolean(patch.enabled);
    }

    Object.assign(item, next);
    this.#persist();
    return clone(item);
  }

  remove(id) {
    const before = this.items.length;
    this.items = this.items.filter((entry) => entry.id !== id);
    if (this.items.length !== before) this.#persist();
    return this.items.length !== before;
  }

  markRun(id, { at, ok, text } = {}) {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) return null;
    item.lastRunAt = at;
    item.lastResult = { at, ok, text };
    this.#persist();
    return clone(item);
  }
}

module.exports = { ScheduleStore };
