const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SkillService, parseSkillFile, topTerms } = require('../core/skill-service');
const { VaultService } = require('../core/vault-service');
const { CommandRouter } = require('../core/router');

const SKILLS_DIR = path.join(__dirname, '..', 'skills');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-skills-'));
}

function fakeTasks(items = []) {
  return {
    list({ status } = {}) {
      return items.filter((task) => !status || task.status === status);
    },
    summary() {
      const open = items.filter((task) => task.status === 'open');
      const overdue = open.filter((task) => task.dueAt && new Date(task.dueAt) < new Date());
      return { open: open.length, overdue: overdue.length, tasks: open.slice(0, 8) };
    }
  };
}

function fakeMemory(notes = []) {
  return { list: (limit = 8) => notes.slice(0, limit), search: () => [] };
}

function build({ items = [], notes = [], schedules = null } = {}) {
  const dir = tmpDir();
  const vault = new VaultService(dir);
  const skills = new SkillService({
    skillsDir: SKILLS_DIR,
    vault,
    tasks: fakeTasks(items),
    memory: fakeMemory(notes),
    getSchedules: () => schedules
  });
  return { dir, vault, skills };
}

test('parseSkillFile reads frontmatter scalars, trigger lists, and the body', () => {
  const parsed = parseSkillFile('---\nname: demo\ndescription: A demo.\ntriggers:\n  - run demo\n  - demo now\n---\n\n# Demo body\n');
  assert.equal(parsed.name, 'demo');
  assert.equal(parsed.description, 'A demo.');
  assert.deepEqual(parsed.triggers, ['run demo', 'demo now']);
  assert.match(parsed.body, /# Demo body/);
  assert.equal(parseSkillFile('no frontmatter'), null);
  assert.equal(parseSkillFile('---\ndescription: nameless\n---\nbody'), null);
});

test('the shipped skills folder loads the first five brain cells', () => {
  const { dir, skills } = build();
  try {
    const names = skills.list().map((skill) => skill.name).sort();
    assert.deepEqual(names, ['inbox', 'metrics', 'plan', 'trends', 'vault']);
    for (const skill of skills.list()) {
      assert.ok(skill.description, `${skill.name} needs a description`);
      assert.ok(skill.triggers.length, `${skill.name} needs triggers`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a skill body is pulled from disk only when asked for', () => {
  const { dir, skills } = build();
  try {
    for (const meta of skills.skills.values()) assert.equal(meta.body, undefined);
    assert.match(skills.readBody('plan'), /top 3/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('match routes trigger phrases, strips the wake name, and captures args', () => {
  const { dir, skills } = build();
  try {
    assert.equal(skills.match('plan today').name, 'plan');
    assert.equal(skills.match('Jarvis, metrics pull').name, 'metrics');
    const captured = skills.match('vault capture buy milk');
    assert.equal(captured.name, 'vault');
    assert.equal(captured.args, 'capture buy milk');
    // Longest trigger wins: "close the day" is the vault skill's own trigger,
    // not the bare "vault" prefix plus noise.
    assert.equal(skills.match('close the day').trigger, 'close the day');
    assert.equal(skills.match('what is the meaning of life'), null);
    assert.equal(skills.match(''), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('metrics pull speaks the numbers and ships a report to vault/outputs', async () => {
  const { dir, vault, skills } = build({
    items: [
      { title: 'a', status: 'open' },
      { title: 'b', status: 'done', completedAt: new Date().toISOString() }
    ],
    notes: [{ text: 'note' }]
  });
  try {
    const outcome = await skills.run(skills.match('metrics pull'));
    assert.match(outcome.text, /1 open task/);
    assert.match(outcome.text, /1 completed today/);
    assert.equal(vault.stats().outputs, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('plan today picks overdue work first and writes the daily note checklist', async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const { dir, vault, skills } = build({
    items: [
      { title: 'newest idea', status: 'open', createdAt: new Date().toISOString() },
      { title: 'overdue invoice', status: 'open', dueAt: yesterday },
      { title: 'someday maybe', status: 'open' }
    ]
  });
  try {
    const outcome = await skills.run(skills.match('plan today'));
    assert.match(outcome.text, /1: overdue invoice/);
    const daily = fs.readFileSync(vault.dailyNotePath(), 'utf8');
    assert.match(daily, /## Plan/);
    assert.match(daily, /- \[ \] 1\. overdue invoice/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('plan today with a clear list says so instead of inventing work', async () => {
  const { dir, skills } = build();
  try {
    const outcome = await skills.run(skills.match('plan today'));
    assert.match(outcome.text, /clear/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('inbox brief reads overdue, due-today, schedules, and the latest note', async () => {
  const soon = new Date(Date.now() + 60000);
  const { dir, vault, skills } = build({
    items: [
      { title: 'call the bank', status: 'open', dueAt: new Date(Date.now() - 3600000).toISOString() },
      { title: 'record the demo', status: 'open', dueAt: soon.toISOString() }
    ],
    notes: [{ text: 'thumbnail idea locked' }],
    schedules: { list: () => [{ name: 'Morning briefing', enabled: true, when: { time: '08:00' } }, { name: 'Off one', enabled: false, when: { time: '09:00' } }] }
  });
  try {
    const outcome = await skills.run(skills.match('inbox brief'));
    assert.match(outcome.text, /1 overdue: call the bank/);
    assert.match(outcome.text, /Due today: record the demo/);
    assert.match(outcome.text, /Morning briefing at 08:00/);
    assert.match(outcome.text, /thumbnail idea locked/);
    const daily = fs.readFileSync(vault.dailyNotePath(), 'utf8');
    assert.match(daily, /## Inbox Brief/);
    assert.match(daily, /OVERDUE — call the bank/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('trend scan surfaces recurring topics from recent captures and tasks', async () => {
  const { dir, vault, skills } = build({
    items: [{ title: 'edit the thumbnail reveal', status: 'open' }]
  });
  try {
    vault.capture('working on the thumbnail for the [[HUD]] video');
    vault.capture('thumbnail draft two, still about the [[HUD]]');
    const outcome = await skills.run(skills.match('trend scan'));
    assert.match(outcome.text, /thumbnail/);
    assert.match(outcome.text, /hud/);
    assert.equal(vault.stats().outputs, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('trend scan with an empty vault admits there is no trend yet', async () => {
  const { dir, skills } = build();
  try {
    const outcome = await skills.run(skills.match('trend scan'));
    assert.match(outcome.text, /not enough/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('vault verbs: capture writes, search finds, stats counts', async () => {
  const { dir, vault, skills } = build();
  try {
    const captured = await skills.run(skills.match('vault capture the compressor needs draining'));
    assert.match(captured.text, /Captured to the vault/);
    const found = await skills.run(skills.match('vault search compressor'));
    assert.match(found.text, /1 note match/);
    const stats = await skills.run(skills.match('vault stats'));
    assert.match(stats.text, /1 raw/);
    assert.equal(vault.stats().raw, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('close the day logs a reflection with what got done and what is open', async () => {
  const { dir, vault, skills } = build({
    items: [
      { title: 'shipped the edit', status: 'done', completedAt: new Date().toISOString() },
      { title: 'still open', status: 'open' }
    ]
  });
  try {
    const outcome = await skills.run(skills.match('close the day'));
    assert.match(outcome.text, /Day closed/);
    assert.match(outcome.text, /1 task done/);
    const daily = fs.readFileSync(vault.dailyNotePath(), 'utf8');
    assert.match(daily, /## Reflection/);
    assert.match(daily, /- \[x\] shipped the edit/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('topTerms weighs wikilinks heavier and drops stopwords', () => {
  const terms = topTerms(['the [[HUD]] and the thumbnail', 'thumbnail again about the day'], 5);
  const names = terms.map((entry) => entry.term);
  assert.ok(names.includes('hud'));
  assert.ok(names.includes('thumbnail'));
  assert.ok(!names.includes('the'));
  assert.ok(!names.includes('about'));
});

test('router hands skill phrases to skills and everything else to the AI brain', async () => {
  const dir = tmpDir();
  try {
    const vault = new VaultService(dir);
    const skills = new SkillService({ skillsDir: SKILLS_DIR, vault, tasks: fakeTasks(), memory: fakeMemory(), getSchedules: () => null });
    const aiCalls = [];
    const router = new CommandRouter({
      config: { getSettings: () => ({ projects: {}, routines: {} }) },
      tools: {},
      documents: null,
      ai: { reply: async (prompt) => { aiCalls.push(prompt); return { ok: true, text: 'chat answer', source: 'ollama' }; } },
      memory: fakeMemory(),
      tasks: fakeTasks(),
      log: { write: () => {} },
      skills
    });
    const planned = await router.handle('plan today');
    assert.equal(planned.source, 'skills');
    assert.equal(aiCalls.length, 0);
    const chatted = await router.handle('tell me something interesting');
    assert.equal(chatted.response, 'chat answer');
    assert.equal(aiCalls.length, 1);
    const hud = await router.handle('open the hud');
    assert.equal(hud.openHud, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a router with no skills service still reaches the AI fallback', async () => {
  const router = new CommandRouter({
    config: { getSettings: () => ({ projects: {}, routines: {} }) },
    tools: {},
    documents: null,
    ai: { reply: async () => ({ ok: true, text: 'plain answer', source: 'ollama' }) },
    memory: fakeMemory(),
    tasks: fakeTasks(),
    log: { write: () => {} }
  });
  const result = await router.handle('plan today');
  assert.equal(result.response, 'plain answer');
});
