const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StarChartStore, dayKey, isDueOn, computeStreak, normalizeDays } = require('../core/star-chart');

function freshStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-star-'));
  return new StarChartStore(directory);
}

// A fixed Saturday, so "today" never drifts under the test.
const SATURDAY = new Date(2026, 6, 25, 9, 0, 0);
const FRIDAY = new Date(2026, 6, 24, 9, 0, 0);
const THURSDAY = new Date(2026, 6, 23, 9, 0, 0);

test('a day key is the local calendar day, not UTC', () => {
  // 11pm local on the 25th belongs to the 25th even where UTC has ticked over.
  assert.equal(dayKey(new Date(2026, 6, 25, 23, 30)), '2026-07-25');
  assert.equal(dayKey(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
});

test('an empty day list means every day; all seven named collapses to the same', () => {
  assert.deepEqual(normalizeDays([]), []);
  assert.deepEqual(normalizeDays(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']), []);
  assert.deepEqual(normalizeDays(['MON', 'mon', 'nonsense']), ['mon']);
  assert.equal(isDueOn({ days: [] }, SATURDAY), true);
  assert.equal(isDueOn({ days: ['sat'] }, SATURDAY), true);
  assert.equal(isDueOn({ days: ['mon'] }, SATURDAY), false);
});

test('a new chart starts with jobs on it rather than an empty box', () => {
  const store = freshStore();
  const chores = store.listChores(SATURDAY);
  assert.ok(chores.length >= 4);
  assert.ok(chores.every((chore) => chore.id && chore.title && chore.stars >= 1));
});

test('finishing a job awards its stars once, however many times it is said', () => {
  const store = freshStore();
  const chore = store.addChore({ title: 'Feed the cat', stars: 2 });
  const first = store.markDone(chore.id, SATURDAY);
  assert.equal(first.ok, true);
  assert.equal(first.already, false);
  assert.equal(first.earned, 2);
  assert.equal(first.stars, 2);

  const second = store.markDone(chore.id, SATURDAY);
  assert.equal(second.already, true);
  assert.equal(second.earned, 0);
  assert.equal(second.stars, 2, 'a repeat must not pay twice');
});

test('undo takes the star back', () => {
  const store = freshStore();
  const chore = store.addChore({ title: 'Feed the cat', stars: 3 });
  store.markDone(chore.id, SATURDAY);
  assert.equal(store.summary(SATURDAY).stars, 3);
  assert.equal(store.undoDone(chore.id, SATURDAY).ok, true);
  assert.equal(store.summary(SATURDAY).stars, 0);
  assert.equal(store.undoDone(chore.id, SATURDAY).ok, false, 'undoing twice is not an error, just nothing');
});

test('a spoken job name finds the right job', () => {
  const store = freshStore();
  store.addChore({ title: 'Feed the cat' });
  store.addChore({ title: 'Water the plants' });
  assert.equal(store.findChore('fed the cat').title, 'Feed the cat');
  assert.equal(store.findChore('the plants').title, 'Water the plants');
  assert.equal(store.findChore('washed the car'), null);
  // Single short words are too weak a match to tick a job off by accident.
  assert.equal(store.findChore('the'), null);
});

test('stars survive deleting the job that earned them', () => {
  const store = freshStore();
  const chore = store.addChore({ title: 'Wash up', stars: 4 });
  store.markDone(chore.id, SATURDAY);
  assert.equal(store.removeChore(chore.id), true);
  assert.equal(store.summary(SATURDAY).stars, 4, 'an earned star is not taken away later');
  assert.equal(store.listChores(SATURDAY).some((item) => item.id === chore.id), false);
});

test('stars per job are clamped, and a nameless job is refused', () => {
  const store = freshStore();
  assert.equal(store.addChore({ title: 'Big job', stars: 99 }).stars, 5);
  assert.equal(store.addChore({ title: 'Small job', stars: 0 }).stars, 1);
  assert.equal(store.addChore({ title: 'Odd job', stars: 'lots' }).stars, 1);
  assert.throws(() => store.addChore({ title: '   ' }), /needs a name/);
});

test('today counts only the jobs actually due today', () => {
  const store = freshStore();
  const everyDay = store.addChore({ title: 'Teeth' });
  store.addChore({ title: 'Bins', days: ['mon'] });
  const saturday = store.listChores(SATURDAY);
  assert.equal(saturday.find((chore) => chore.id === everyDay.id).dueToday, true);
  assert.equal(saturday.find((chore) => chore.title === 'Bins').dueToday, false);
  assert.equal(store.summary(SATURDAY).dueToday, saturday.filter((chore) => chore.dueToday).length);
});

test('a streak counts finished days back from today, and today may still be in progress', () => {
  const chores = [{ id: 'a', days: [] }];
  const log = [
    { choreId: 'a', day: dayKey(FRIDAY) },
    { choreId: 'a', day: dayKey(THURSDAY) }
  ];
  // Nothing done yet today: the run of two is intact, not broken.
  assert.equal(computeStreak(chores, log, SATURDAY), 2);
  // Finish today too and it becomes three.
  assert.equal(computeStreak(chores, [...log, { choreId: 'a', day: dayKey(SATURDAY) }], SATURDAY), 3);
});

test('a missed day ends the streak', () => {
  const chores = [{ id: 'a', days: [] }];
  // Thursday done, Friday missed: by Saturday the run is over.
  assert.equal(computeStreak(chores, [{ choreId: 'a', day: dayKey(THURSDAY) }], SATURDAY), 0);
});

test('a day needs EVERY due job, not just one of them', () => {
  const chores = [{ id: 'a', days: [] }, { id: 'b', days: [] }];
  const halfDone = [{ choreId: 'a', day: dayKey(FRIDAY) }];
  assert.equal(computeStreak(chores, halfDone, SATURDAY), 0);
  const allDone = [...halfDone, { choreId: 'b', day: dayKey(FRIDAY) }];
  assert.equal(computeStreak(chores, allDone, SATURDAY), 1);
});

test('a day with no jobs due neither builds nor breaks the streak', () => {
  // Jobs on weekdays only. Saturday and Sunday are blank days.
  const chores = [{ id: 'a', days: ['mon', 'tue', 'wed', 'thu', 'fri'] }];
  const log = [
    { choreId: 'a', day: dayKey(FRIDAY) },
    { choreId: 'a', day: dayKey(THURSDAY) }
  ];
  assert.equal(computeStreak(chores, log, SATURDAY), 2);
});

test('an empty chart has no streak and no stars', () => {
  const store = freshStore();
  for (const chore of store.listChores()) store.removeChore(chore.id);
  const summary = store.summary(SATURDAY);
  assert.equal(summary.stars, 0);
  assert.equal(summary.streak, 0);
  assert.equal(summary.dueToday, 0);
  assert.equal(summary.allDone, false, 'no jobs is not the same as a finished day');
});

test('redeeming stars spends them and refuses to overspend', () => {
  const store = freshStore();
  const chore = store.addChore({ title: 'Big tidy', stars: 5 });
  store.markDone(chore.id, SATURDAY);
  assert.equal(store.summary(SATURDAY).stars, 5);
  const tooMuch = store.redeem({ stars: 9, reward: 'Ice cream' });
  assert.equal(tooMuch.ok, false);
  assert.equal(tooMuch.reason, 'not-enough');
  const ok = store.redeem({ stars: 4, reward: 'Ice cream' });
  assert.equal(ok.ok, true);
  assert.equal(ok.stars, 1);
  assert.equal(store.summary(SATURDAY).earnedAllTime, 5, 'spending does not erase what was earned');
  assert.equal(store.summary(SATURDAY).rewards[0].reward, 'Ice cream');
});

test('the chart is written to disk and reads back the same', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-star-'));
  const store = new StarChartStore(directory);
  const chore = store.addChore({ title: 'Practise piano', stars: 2 });
  store.markDone(chore.id, SATURDAY);

  const reopened = new StarChartStore(directory);
  assert.equal(reopened.summary(SATURDAY).stars, 2);
  assert.equal(reopened.listChores(SATURDAY).some((item) => item.title === 'Practise piano'), true);
});

test('a corrupt chart file degrades to a fresh chart instead of crashing', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-star-'));
  fs.writeFileSync(path.join(directory, 'star-chart.json'), '{not json', 'utf8');
  const store = new StarChartStore(directory);
  assert.ok(store.listChores().length > 0);
  assert.equal(store.summary().stars, 0);
});
