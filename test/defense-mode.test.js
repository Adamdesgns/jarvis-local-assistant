const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isDefenseRequest,
  isStandDown,
  pickTriggerAlert,
  buildBannerLabel,
  createEntryGate,
  parseRss
} = require('../core/defense-mode');

test('isDefenseRequest recognizes defense phrasings', () => {
  assert.deepEqual(isDefenseRequest('defense mode'), {});
  assert.deepEqual(isDefenseRequest('Defense mode.'), {});
  assert.deepEqual(isDefenseRequest('jarvis, defense mode'), {});
  assert.deepEqual(isDefenseRequest('enter defense mode'), {});
  assert.deepEqual(isDefenseRequest('go into defense mode'), {});
  assert.deepEqual(isDefenseRequest('defence mode'), {});
  assert.deepEqual(isDefenseRequest('activate defense mode'), {});
});

test('isDefenseRequest leaves ordinary sentences alone', () => {
  assert.equal(isDefenseRequest('what is defense mode'), null);
  assert.equal(isDefenseRequest('add defense mode to my tasks'), null);
  assert.equal(isDefenseRequest('read about missile defense'), null);
  assert.equal(isDefenseRequest('is defense mode on'), null);
  assert.equal(isDefenseRequest('turn off defense mode notifications later'), null);
});

test('isStandDown recognizes the exit phrasings', () => {
  assert.deepEqual(isStandDown('stand down'), {});
  assert.deepEqual(isStandDown('Stand down.'), {});
  assert.deepEqual(isStandDown('jarvis, stand down'), {});
  assert.deepEqual(isStandDown('exit defense mode'), {});
  assert.deepEqual(isStandDown('leave defense mode'), {});
  assert.deepEqual(isStandDown('all clear'), {});
});

test('isStandDown leaves ordinary sentences alone', () => {
  assert.equal(isStandDown('stand down from the ladder'), null);
  assert.equal(isStandDown('is the all clear given yet'), null);
  assert.equal(isStandDown('when should I stand down the crew'), null);
});

// --- Warning-tier alert filter ---

function feature(event, extra = {}) {
  return { properties: { event, id: `test-${event}`, areaDesc: 'Harrison, MS', ...extra } };
}

test('pickTriggerAlert takes the first warning-tier alert only', () => {
  const picked = pickTriggerAlert([
    feature('Tornado Watch'),
    feature('Special Weather Statement'),
    feature('Tornado Warning'),
    feature('Hurricane Warning')
  ]);
  assert.equal(picked.properties.event, 'Tornado Warning');
});

test('pickTriggerAlert covers the whole warning tier', () => {
  for (const event of ['Tornado Warning', 'Hurricane Warning', 'Severe Thunderstorm Warning', 'Flash Flood Warning', 'Extreme Wind Warning']) {
    assert.equal(pickTriggerAlert([feature(event)]).properties.event, event);
  }
});

test('pickTriggerAlert refuses watches, advisories, and empty skies', () => {
  assert.equal(pickTriggerAlert([feature('Tornado Watch'), feature('Wind Advisory'), feature('Flood Watch')]), null);
  assert.equal(pickTriggerAlert([]), null);
  assert.equal(pickTriggerAlert(undefined), null);
});

// --- Banner label ---

const nineFortyThree = new Date(2026, 6, 25, 21, 43);

test('buildBannerLabel formats the manual trigger', () => {
  assert.equal(buildBannerLabel({ kind: 'manual' }, nineFortyThree), 'DEFENSE MODE · MANUAL TRIGGER · 21:43');
});

test('buildBannerLabel formats a weather trigger with event and area', () => {
  assert.equal(
    buildBannerLabel({ kind: 'weather', event: 'Tornado Warning', area: 'Harrison County' }, nineFortyThree),
    'DEFENSE MODE · TORNADO WARNING, HARRISON COUNTY · 21:43'
  );
});

test('buildBannerLabel formats a camera trigger', () => {
  assert.equal(
    buildBannerLabel({ kind: 'camera', cameraName: 'Front Door' }, nineFortyThree),
    'DEFENSE MODE · MOTION AT FRONT DOOR · 21:43'
  );
});

// --- RSS parser ---

const WLOX_STYLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>WLOX Local News</title>
  <item>
    <title><![CDATA[Tornado confirmed near Gulfport, crews assessing damage]]></title>
    <link>https://www.wlox.com/2026/07/25/tornado-gulfport/</link>
    <pubDate>Fri, 25 Jul 2026 21:10:00 GMT</pubDate>
  </item>
  <item>
    <title>Shelters open across Harrison County</title>
    <link>https://www.wlox.com/2026/07/25/shelters-open/</link>
  </item>
</channel></rss>`;

test('parseRss pulls titles, links, and dates from a real-shape feed', () => {
  const items = parseRss(WLOX_STYLE_FEED);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    title: 'Tornado confirmed near Gulfport, crews assessing damage',
    link: 'https://www.wlox.com/2026/07/25/tornado-gulfport/',
    date: 'Fri, 25 Jul 2026 21:10:00 GMT'
  });
  assert.deepEqual(items[1], { title: 'Shelters open across Harrison County', link: 'https://www.wlox.com/2026/07/25/shelters-open/', date: '' });
});

test('parseRss caps the item count', () => {
  const many = `<rss><channel>${'<item><title>headline</title></item>'.repeat(25)}</channel></rss>`;
  assert.equal(parseRss(many).length, 10);
  assert.equal(parseRss(many, 3).length, 3);
});

test('parseRss survives garbage, atom-less empties, and non-strings', () => {
  assert.deepEqual(parseRss('not xml at all {'), []);
  assert.deepEqual(parseRss('<rss><channel><title>empty</title></channel></rss>'), []);
  assert.deepEqual(parseRss(null), []);
  assert.deepEqual(parseRss(12), []);
});

test('parseRss skips items with no usable title', () => {
  const feed = '<rss><channel><item><link>https://x.test/a</link></item><item><title>real one</title></item></channel></rss>';
  const items = parseRss(feed);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'real one');
});

// --- Entry gate: every automatic entry announces itself and can be waved off ---

test('the gate proposes, waits the full window, then enters', () => {
  const gate = createEntryGate({ timeoutMs: 15000 });
  const reason = { kind: 'weather', event: 'Tornado Warning' };
  const proposed = gate.propose(reason, 1000);
  assert.deepEqual(proposed, { pending: true, expiresAt: 16000 });
  assert.equal(gate.expire(15999), null); // still inside the wave-off window
  assert.deepEqual(gate.expire(16000), { enter: true, reason });
  assert.equal(gate.entered(), true);
});

test('a wave-off cancels the pending entry for good', () => {
  const gate = createEntryGate({ timeoutMs: 15000 });
  gate.propose({ kind: 'camera', cameraName: 'Front Door' }, 1000);
  assert.equal(gate.waveOff(), true);
  assert.equal(gate.expire(99999), null);
  assert.equal(gate.entered(), false);
});

test('waveOff with nothing pending reports false', () => {
  const gate = createEntryGate({ timeoutMs: 15000 });
  assert.equal(gate.waveOff(), false);
});

test('a second propose while one is pending or entered is refused', () => {
  const gate = createEntryGate({ timeoutMs: 15000 });
  assert.equal(gate.propose({ kind: 'manual' }, 1000).pending, true);
  assert.equal(gate.propose({ kind: 'manual' }, 2000), null);
  gate.expire(16000);
  assert.equal(gate.propose({ kind: 'manual' }, 20000), null); // already entered
});

test('reset returns the gate to idle', () => {
  const gate = createEntryGate({ timeoutMs: 15000 });
  gate.propose({ kind: 'manual' }, 1000);
  gate.expire(16000);
  gate.reset();
  assert.equal(gate.entered(), false);
  assert.equal(gate.propose({ kind: 'manual' }, 20000).pending, true);
});

test('buildBannerLabel pads early hours and survives a bare reason', () => {
  assert.equal(buildBannerLabel({ kind: 'manual' }, new Date(2026, 6, 25, 7, 5)), 'DEFENSE MODE · MANUAL TRIGGER · 07:05');
  assert.equal(buildBannerLabel({ kind: 'weather', event: 'Flash Flood Warning' }, nineFortyThree), 'DEFENSE MODE · FLASH FLOOD WARNING · 21:43');
});
