const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NightShiftService } = require('../core/night-shift');
const { ScheduleStore } = require('../core/schedule-store');
const { ScheduleService } = require('../core/schedule-service');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-night-'));
}

// 2 AM — inside the default midnight-to-6am window.
const NIGHT = new Date('2026-07-25T02:00:00');
// 2 PM — well outside it.
const DAY = new Date('2026-07-25T14:00:00');

function makeService({ dir, now = () => NIGHT, settings = {}, ai, documents } = {}) {
  const calls = { ai: [], drafts: [] };
  const service = new NightShiftService({
    userDataPath: dir,
    now,
    config: {
      getSettings: () => ({
        nightShiftEnabled: true,
        nightShiftStart: 0,
        nightShiftEnd: 6,
        nightShiftMaxJobs: 10,
        nightShiftMaxMinutes: 10,
        nightShiftCloudBudgetUsd: 0,
        nightShiftFolder: path.join(dir, 'Drafts'),
        ...settings
      })
    },
    ai: ai || {
      reply: async (prompt, context) => { calls.ai.push({ prompt, context }); return 'Draft body here.'; }
    },
    documents: documents || {
      createTextFileAt: async (directory, name, content, extension) => {
        calls.drafts.push({ directory, name, content, extension });
        return { ok: true, path: path.join(directory, `${name}${extension}`) };
      }
    }
  });
  return { service, calls };
}

function job(overrides = {}) {
  return {
    id: 's1',
    name: 'Daily social draft',
    enabled: true,
    when: { time: '02:00', repeat: 'daily' },
    action: { kind: 'brainJob', prompt: 'Draft a post about the build.', ...overrides }
  };
}

test('runJob: runs the brain unattended on the LOCAL model and saves a dated draft', async () => {
  const dir = tmpDir();
  try {
    const { service, calls } = makeService({ dir });
    const result = await service.runJob(job());
    assert.equal(result.ok, true);
    assert.equal(calls.ai.length, 1);
    assert.equal(calls.ai[0].context.unattended, true);
    assert.equal(calls.ai[0].context.forceMode, 'local');
    assert.equal(calls.drafts.length, 1);
    assert.equal(calls.drafts[0].extension, '.md');
    assert.ok(calls.drafts[0].name.startsWith('2026-07-25'), `draft name is dated: ${calls.drafts[0].name}`);
    assert.ok(calls.drafts[0].content.includes('Draft body here.'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runJob: cloud stays off when the cloud budget is zero, even if the job asks', async () => {
  const dir = tmpDir();
  try {
    const { service, calls } = makeService({ dir });
    await service.runJob(job({ cloud: true }));
    assert.equal(calls.ai[0].context.forceMode, 'local');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runJob: cloud allowed only when the job asks AND the budget is above zero', async () => {
  const dir = tmpDir();
  try {
    const { service, calls } = makeService({ dir, settings: { nightShiftCloudBudgetUsd: 5 } });
    await service.runJob(job({ cloud: true }));
    assert.equal(calls.ai[0].context.forceMode, undefined);
    await service.runJob(job());
    assert.equal(calls.ai[1].context.forceMode, 'local');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runJob: an on-time fire outside the night window is refused without calling the brain', async () => {
  const dir = tmpDir();
  try {
    const { service, calls } = makeService({ dir, now: () => DAY });
    const result = await service.runJob(job());
    assert.equal(result.ok, false);
    assert.match(result.text, /night shift hours/i);
    assert.equal(calls.ai.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runJob: a LATE catch-up run is allowed outside the window (PC was asleep)', async () => {
  const dir = tmpDir();
  try {
    const { service, calls } = makeService({ dir, now: () => DAY });
    const result = await service.runJob(job(), { late: true });
    assert.equal(result.ok, true);
    assert.equal(calls.ai.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runJob: the wall-clock cap turns a hung brain into a logged failure', async () => {
  const dir = tmpDir();
  try {
    const { service } = makeService({
      dir,
      settings: { nightShiftMaxMinutes: 0.001 }, // 60ms cap
      ai: { reply: () => new Promise((resolve) => setTimeout(() => resolve('late'), 500)) }
    });
    const result = await service.runJob(job());
    assert.equal(result.ok, false);
    assert.match(result.text, /too long|timed out/i);
    const entries = service.entriesSince(0);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runJob: the per-night job cap refuses extra jobs', async () => {
  const dir = tmpDir();
  try {
    const { service, calls } = makeService({ dir, settings: { nightShiftMaxJobs: 2 } });
    await service.runJob(job());
    await service.runJob(job({ prompt: 'Second job.' }));
    const third = await service.runJob(job({ prompt: 'Third job.' }));
    assert.equal(third.ok, false);
    assert.match(third.text, /limit|cap/i);
    assert.equal(calls.ai.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runJob: a failing draft write is a logged failure, not a crash', async () => {
  const dir = tmpDir();
  try {
    const { service } = makeService({
      dir,
      documents: { createTextFileAt: async () => { throw new Error('Choose or approve that destination folder in Settings first.'); } }
    });
    const result = await service.runJob(job());
    assert.equal(result.ok, false);
    assert.match(result.text, /approve|destination/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('doneCount counts only successful jobs, across nights', async () => {
  const dir = tmpDir();
  try {
    const { service } = makeService({ dir });
    await service.runJob(job());
    await service.runJob(job({ prompt: 'two' }));
    const bad = makeService({ dir, documents: { createTextFileAt: async () => { throw new Error('nope'); } } });
    await bad.service.runJob(job({ prompt: 'fails' }));
    assert.equal(new NightShiftService({
      userDataPath: dir, now: () => NIGHT,
      config: { getSettings: () => ({}) }, ai: {}, documents: {}
    }).doneCount(), 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('entriesSince returns entries after a timestamp, newest last', async () => {
  const dir = tmpDir();
  try {
    const { service } = makeService({ dir });
    await service.runJob(job());
    const entries = service.entriesSince(new Date('2026-07-25T00:00:00').getTime());
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, 'Daily social draft');
    assert.equal(entries[0].ok, true);
    assert.equal(service.entriesSince(new Date('2026-07-26T00:00:00').getTime()).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runJob refuses outright when the night shift master switch is off', async () => {
  const dir = tmpDir();
  try {
    const { service, calls } = makeService({ dir, settings: { nightShiftEnabled: false } });
    const result = await service.runJob(job());
    assert.equal(result.ok, false);
    assert.match(result.text, /switched off|turned off|disabled/i);
    assert.equal(calls.ai.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pendingReport lists finished jobs since the last morning report, then markReported clears it', async () => {
  const dir = tmpDir();
  try {
    let tick = NIGHT.getTime();
    const { service } = makeService({ dir, now: () => new Date(tick += 1000) });
    await service.runJob(job());
    await service.runJob(job({ prompt: 'two' }));
    assert.equal(service.pendingReport().length, 2);
    service.markReported();
    assert.equal(service.pendingReport().length, 0);
    await service.runJob(job({ prompt: 'three' }));
    const pending = service.pendingReport();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('schedule-store accepts brainJob actions with a prompt and rejects them without', () => {
  const dir = tmpDir();
  try {
    const store = new ScheduleStore(dir);
    const item = store.add({ name: 'Night job', when: { time: '02:00', repeat: 'daily' }, action: { kind: 'brainJob', prompt: 'Do the thing.' } });
    assert.equal(item.action.kind, 'brainJob');
    assert.throws(() => store.add({ name: 'Bad', when: { time: '02:00', repeat: 'daily' }, action: { kind: 'brainJob' } }), /prompt/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('schedule-service routes brainJob actions to the night shift service', async () => {
  const dir = tmpDir();
  try {
    const store = new ScheduleStore(dir);
    const item = store.add({ name: 'Night job', when: { time: '02:00', repeat: 'daily' }, action: { kind: 'brainJob', prompt: 'Do the thing.' } });
    const ran = [];
    const scheduler = new ScheduleService({
      store,
      config: { getSettings: () => ({ schedulesEnabled: true, autonomyNightStart: 21, autonomyNightEnd: 7 }) },
      router: { handle: async () => { throw new Error('router must not run brainJobs'); } },
      nightShift: { runJob: async (jobItem, opts) => { ran.push({ jobItem, opts }); return { ok: true, text: 'Draft saved.' }; } },
      emit: () => {},
      log: { write: () => {} },
      now: () => NIGHT
    });
    const result = await scheduler.runNow(item.id, { late: true });
    assert.equal(result.ok, true);
    assert.match(result.text, /Draft saved/);
    assert.equal(ran.length, 1);
    assert.equal(ran[0].opts.late, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
