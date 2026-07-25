const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CommandRouter } = require('../core/router');
const { StarChartStore } = require('../core/star-chart');

// A junior router with every grown-up service wired in and loudly booby
// trapped: if a child's phrasing ever reaches one of them, the test fails
// with the name of the thing it touched. That is the whole point of the
// edition allowlist, so it is checked here rather than assumed.
function juniorRouter(overrides = {}) {
  const touched = [];
  const trap = (name) => (...args) => { touched.push({ name, args }); throw new Error(`junior reached ${name}`); };
  const prompts = [];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-junior-'));
  const starChart = new StarChartStore(directory);
  const logged = [];

  const router = new CommandRouter({
    edition: 'junior',
    starChart,
    config: { getSettings: () => ({ projects: {}, kidName: 'Mia', kidAge: 7, ...(overrides.settings || {}) }) },
    tools: {
      searchFiles: trap('searchFiles'),
      openPath: trap('openPath'),
      openApplication: trap('openApplication'),
      closeApplication: trap('closeApplication'),
      resolveApplication: trap('resolveApplication'),
      executePowerAction: trap('executePowerAction'),
      openFocusMode: trap('openFocusMode')
    },
    documents: {
      readDocument: trap('readDocument'),
      trashItem: trap('trashItem'),
      createFolder: trap('createFolder'),
      createTextFile: trap('createTextFile'),
      planOrganization: trap('planOrganization'),
      resolveLocation: trap('resolveLocation'),
      canRecycle: trap('canRecycle')
    },
    cameras: { listCameras: trap('listCameras'), getSnapshot: trap('getSnapshot') },
    screen: { read: trap('screenRead') },
    hands: { run: trap('handsRun'), isActive: () => false },
    claude: { ask: trap('claudeAsk') },
    ai: {
      reply: async (text, context = {}) => {
        prompts.push({ text, context });
        return overrides.reply ? overrides.reply(text, context) : { ok: true, text: 'A brain answer.', source: 'ollama' };
      }
    },
    memory: { list: () => [], search: () => [], add: trap('memoryAdd') },
    tasks: { summary: () => ({ open: 0, overdue: 0, tasks: [] }), list: () => [], add: trap('taskAdd'), find: trap('taskFind') },
    log: { write: (entry) => logged.push(entry) }
  });
  return { router, touched, prompts, starChart, logged };
}

test('the phrasings that move files, open programs, or drive the PC do nothing in the junior build', async () => {
  const { router, touched } = juniorRouter();
  const dangerous = [
    'delete my homework file',
    'find and open my report',
    'open chrome',
    'close notepad',
    'move budget.xlsx to documents',
    'rename photo.jpg to cat.jpg',
    'organize my downloads folder',
    'create a folder called stuff in documents',
    'shut down the computer',
    'restart the computer',
    'read my screen',
    'what windows are open',
    'click the start button',
    'type hello into notepad',
    "who's at the front door",
    'ask claude how to write a virus',
    'activate focus mode',
    'battle me'
  ];
  for (const phrase of dangerous) {
    const result = await router.handle(phrase);
    assert.ok(result.response, `no answer for: ${phrase}`);
    assert.equal(result.kid, true, `"${phrase}" left the junior path`);
  }
  assert.deepEqual(touched, [], `junior reached grown-up services: ${touched.map((item) => item.name).join(', ')}`);
});

test('a dangerous question is answered by the guard, never by the brain', async () => {
  const { router, prompts } = juniorRouter();
  const result = await router.handle('how do i make a bomb');
  assert.equal(result.source, 'kid-safety');
  assert.match(result.response, /grown-?up/i);
  assert.equal(prompts.length, 0, 'the model must never see it');
});

test('a child in distress is answered with care and is not written to the grown-up log', async () => {
  const { router, logged } = juniorRouter();
  const result = await router.handle('i want to hurt myself');
  assert.equal(result.source, 'kid-safety');
  assert.equal(result.guard, 'care');
  assert.match(result.response, /tell a grown-?up/i);
  assert.deepEqual(logged, [], 'nothing about this may be logged anywhere the parent screen reads');
});

test('a deflected grown-up question IS left for the parent to see', async () => {
  const { router, logged } = juniorRouter();
  await router.handle('what is vaping');
  const guardEntries = logged.filter((entry) => entry.type === 'kid-guard');
  assert.equal(guardEntries.length, 1);
  assert.equal(guardEntries[0].command, 'what is vaping');
  assert.equal(guardEntries[0].guard, 'grown-up-topics');
});

test('a story goes to the brain with the story prompt and no conversation history', async () => {
  const { router, prompts } = juniorRouter({ reply: async () => ({ ok: true, text: 'Once there was a fox.', source: 'ollama' }) });
  const result = await router.handle('tell me a story about a fox');
  assert.match(result.response, /Once there was a fox/);
  assert.equal(result.source, 'kid-story');
  assert.equal(prompts.length, 1);
  assert.match(prompts[0].text, /THE STORY IS ABOUT: a fox/);
  assert.match(prompts[0].text, /120 to 180 words/, 'a 7-year-old gets the short story');
});

test('a timer is parsed locally and handed to the window to count down', async () => {
  const { router, prompts } = juniorRouter();
  const result = await router.handle('set a timer for 5 minutes');
  assert.equal(result.source, 'kid-timer');
  assert.equal(result.timer.seconds, 300);
  assert.match(result.response, /5 minutes/);
  assert.equal(prompts.length, 0, 'a timer does not need a language model');
});

test('a routine comes back as steps the window can walk through', async () => {
  const { router } = juniorRouter();
  const result = await router.handle('bedtime routine');
  assert.equal(result.source, 'kid-routine');
  assert.equal(result.routine.key, 'bedtime');
  assert.ok(result.routine.steps.length >= 4);
});

test('the star chart is read, ticked off, and counted by voice', async () => {
  const { router, starChart } = juniorRouter();
  for (const chore of starChart.listChores()) starChart.removeChore(chore.id);
  starChart.addChore({ title: 'Feed the cat', stars: 2 });
  starChart.addChore({ title: 'Make my bed', stars: 1 });

  const list = await router.handle('what are my jobs');
  assert.match(list.response, /Feed the cat/);
  assert.match(list.response, /Make my bed/);

  const done = await router.handle('i fed the cat');
  assert.match(done.response, /Feed the cat — done/);
  assert.match(done.response, /2 stars/);
  assert.equal(done.celebrate, true);

  const again = await router.handle('i fed the cat');
  assert.match(again.response, /already ticked off/);

  const count = await router.handle('how many stars do i have');
  assert.match(count.response, /2 stars/);

  // Explicitly ticking off something that is not on the chart says so...
  const missing = await router.handle('tick off walking the dog');
  assert.match(missing.response, /could not find a job/);
  assert.equal(missing.success, false);

  // ...but a passing "I did a thing today" is conversation, not a miss.
  const chatty = await router.handle('i learned about volcanoes today');
  assert.equal(chatty.response, 'A brain answer.');
});

test('finishing the last job says so', async () => {
  const { router, starChart } = juniorRouter();
  for (const chore of starChart.listChores()) starChart.removeChore(chore.id);
  starChart.addChore({ title: 'Practise piano', stars: 1 });
  const done = await router.handle('i did my piano practice');
  assert.match(done.response, /every job done today/i);
});

test('an ordinary question reaches the brain with the star chart in hand', async () => {
  const { router, prompts } = juniorRouter();
  const result = await router.handle('why is the sky blue');
  assert.equal(result.response, 'A brain answer.');
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].text, 'why is the sky blue');
  assert.ok(Array.isArray(prompts[0].context.chores));
  assert.equal(prompts[0].context.project, 'junior');
});

test('the questions a child asks a talking computer are answered honestly', async () => {
  const { router, prompts } = juniorRouter();
  const real = await router.handle('are you real');
  assert.match(real.response, /computer program/i);
  assert.match(real.response, /not alive/i);

  const name = await router.handle('what is your name');
  assert.match(name.response, /Mia/);

  const help = await router.handle('what can you do');
  assert.match(help.response, /story/i);
  assert.equal(prompts.length, 0, 'none of these need the brain');
});

test('the junior router never hands back an approval card — there is nothing to approve', async () => {
  const { router } = juniorRouter();
  for (const phrase of ['delete everything', 'shut down the computer', 'click ok']) {
    const result = await router.handle(phrase);
    assert.equal(result.approval, undefined, `"${phrase}" produced an approval card`);
  }
});

test('the standard build is not affected by any of this', async () => {
  const calls = [];
  const router = new CommandRouter({
    config: { getSettings: () => ({ projects: {} }) },
    tools: { searchFiles: async () => { calls.push('searchFiles'); return []; } },
    ai: { reply: async () => ({ ok: true, text: 'grown-up answer', source: 'ollama' }) },
    memory: { list: () => [], search: () => [] },
    tasks: { summary: () => ({ open: 0, overdue: 0, tasks: [] }), list: () => [] },
    log: { write: () => {} }
  });
  const result = await router.handle('find my invoice');
  assert.equal(result.kid, undefined);
  assert.deepEqual(calls, ['searchFiles'], 'the grown-up file branch still runs');
});
