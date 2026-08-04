const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// The brain cells: a folder of skills, each one a single SKILL.md with a
// name, a description, and the spoken triggers that summon it. The loader
// reads only the frontmatter at boot — a skill's body is pulled in only when
// the moment needs it. Small single-purpose skills beat one giant prompt.

function parseSkillFile(text) {
  const match = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  const skill = { triggers: [] };
  let listKey = null;
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    const item = line.match(/^\s+-\s+(.+)$/);
    if (item && listKey) {
      skill[listKey].push(item[1].trim());
      continue;
    }
    const pair = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if (!pair) continue;
    const [, key, value] = pair;
    if (value === '') {
      listKey = key;
      skill[key] = [];
    } else {
      listKey = null;
      skill[key] = value.trim();
    }
  }
  if (!skill.name || !skill.triggers.length) return null;
  skill.body = match[2].trim();
  return skill;
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/^jarvis[,\s]+/, '')
    .replace(/[\s,?.!]+$/, '')
    .replace(/['’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set(('the a an and or but of to in on at for with from by is are was were be been ' +
  'it its this that these those i you he she we they my your our me him her them do does did done have has ' +
  'had will would can could should about into over under up down out not no yes so if then than as just get ' +
  'got make made need want go going day today tomorrow week time new task tasks note notes').split(' '));

function topTerms(texts, limit = 5) {
  const counts = new Map();
  for (const text of texts) {
    // Wikilinks count as strong signal: the note's author already decided
    // the target is a topic, not a stray word.
    for (const link of String(text).matchAll(/\[\[([^\[\]|#]+)(?:[#|][^\[\]]*)?\]\]/g)) {
      const term = link[1].trim().toLowerCase();
      if (term) counts.set(term, (counts.get(term) || 0) + 3);
    }
    for (const word of String(text).toLowerCase().replace(/\[\[[^\]]*\]\]/g, ' ').split(/[^a-z0-9']+/)) {
      if (word.length < 4 || STOPWORDS.has(word)) continue;
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

class SkillService {
  constructor({ skillsDir, vault, tasks, memory, getSchedules, log }) {
    this.skillsDir = skillsDir;
    this.vault = vault;
    this.tasks = tasks;
    this.memory = memory;
    this.getSchedules = getSchedules || (() => null);
    this.log = log || null;
    this.skills = this.#load();
  }

  #load() {
    const skills = new Map();
    let folders = [];
    try {
      folders = fs.readdirSync(this.skillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    } catch {
      return skills;
    }
    for (const folder of folders) {
      const filePath = path.join(this.skillsDir, folder.name, 'SKILL.md');
      try {
        const parsed = parseSkillFile(fs.readFileSync(filePath, 'utf8'));
        if (!parsed) continue;
        // Frontmatter stays resident; the body is re-read on demand.
        const { body, ...meta } = parsed;
        skills.set(meta.name, { ...meta, path: filePath });
      } catch { /* an unreadable skill is simply not offered */ }
    }
    return skills;
  }

  list() {
    return [...this.skills.values()].map(({ name, description, triggers }) => ({ name, description, triggers }));
  }

  readBody(name) {
    const skill = this.skills.get(name);
    if (!skill) return '';
    try {
      return parseSkillFile(fs.readFileSync(skill.path, 'utf8'))?.body || '';
    } catch {
      return '';
    }
  }

  // Longest trigger wins, so "plan today" is never swallowed by a shorter
  // trigger's prefix. A trigger matches whole ("vault") or as a prefix
  // followed by a space ("vault capture buy milk" → args "capture buy milk").
  match(text) {
    const cleaned = normalize(text);
    if (!cleaned) return null;
    const candidates = [];
    for (const skill of this.skills.values()) {
      for (const trigger of skill.triggers) {
        const wanted = normalize(trigger);
        if (cleaned === wanted) candidates.push({ name: skill.name, trigger: wanted, args: '' });
        else if (cleaned.startsWith(`${wanted} `)) {
          candidates.push({ name: skill.name, trigger: wanted, args: cleaned.slice(wanted.length + 1).trim() });
        }
      }
    }
    return candidates.sort((a, b) => b.trigger.length - a.trigger.length)[0] || null;
  }

  async run(matched) {
    const runners = {
      metrics: () => this.#metrics(),
      inbox: () => this.#inbox(),
      trends: () => this.#trends(),
      plan: () => this.#plan(),
      vault: () => this.#vault(matched)
    };
    const runner = runners[matched.name];
    if (!runner) return { text: `I know the ${matched.name} skill, but it has no runner on this PC.`, success: false };
    try {
      return await runner();
    } catch (error) {
      return { text: `The ${matched.name} skill hit a snag: ${error.message}`, success: false };
    }
  }

  #doneToday() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return this.tasks.list({ status: 'done' }).filter((task) => task.completedAt && new Date(task.completedAt) >= start);
  }

  #metrics() {
    const summary = this.tasks.summary();
    const doneToday = this.#doneToday().length;
    const memories = this.memory.list(1000).length;
    const stats = this.vault.stats();
    const uptimeHours = Math.floor(os.uptime() / 3600);
    const usedGb = ((os.totalmem() - os.freemem()) / 1024 ** 3).toFixed(1);
    const lines = [
      `Metrics pull. ${summary.open} open task${summary.open === 1 ? '' : 's'}${summary.overdue ? `, ${summary.overdue} overdue` : ''}, ${doneToday} completed today.`,
      `The vault holds ${stats.total} note${stats.total === 1 ? '' : 's'} — ${stats.raw} raw, ${stats.wiki} wiki, ${stats.outputs} shipped — with ${stats.links} link${stats.links === 1 ? '' : 's'}.`,
      `${memories} quick ${memories === 1 ? 'memory' : 'memories'} saved. Up ${uptimeHours} hour${uptimeHours === 1 ? '' : 's'}, ${usedGb} GB memory in use.`
    ];
    const report = [
      `# Metrics Pull`,
      '',
      `| Metric | Value |`,
      `| --- | --- |`,
      `| Open tasks | ${summary.open} |`,
      `| Overdue tasks | ${summary.overdue} |`,
      `| Completed today | ${doneToday} |`,
      `| Vault notes (raw/wiki/outputs) | ${stats.raw} / ${stats.wiki} / ${stats.outputs} |`,
      `| Wikilinks | ${stats.links} |`,
      `| Quick memories | ${memories} |`,
      `| Uptime (h) | ${uptimeHours} |`,
      `| Memory in use (GB) | ${usedGb} |`
    ].join('\n');
    const saved = this.vault.writeOutput('metrics-pull', report);
    return { text: `${lines.join(' ')} Report saved to the vault.`, extra: { vaultNote: saved.name } };
  }

  #inbox() {
    const fmt = (iso) => new Intl.DateTimeFormat([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
    const open = this.tasks.list({ status: 'open' });
    const now = new Date();
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    const overdue = open.filter((task) => task.dueAt && new Date(task.dueAt) < now);
    const dueToday = open.filter((task) => task.dueAt && new Date(task.dueAt) >= now && new Date(task.dueAt) <= endOfDay);
    const spoken = [];
    const logLines = [];
    if (overdue.length) {
      spoken.push(`${overdue.length} overdue: ${overdue.slice(0, 3).map((task) => task.title).join(', ')}.`);
      for (const task of overdue) logLines.push(`- [ ] OVERDUE — ${task.title} (due ${fmt(task.dueAt)})`);
    }
    if (dueToday.length) {
      spoken.push(`Due today: ${dueToday.slice(0, 3).map((task) => task.title).join(', ')}.`);
      for (const task of dueToday) logLines.push(`- [ ] ${task.title} (due ${fmt(task.dueAt)})`);
    }
    if (!overdue.length && !dueToday.length) {
      spoken.push(open.length ? `Nothing due today. ${open.length} open task${open.length === 1 ? '' : 's'} on the list.` : 'The inbox is clear.');
    }
    const schedules = (this.getSchedules()?.list?.() || []).filter((item) => item.enabled);
    if (schedules.length) {
      const times = schedules.map((item) => `${item.name} at ${item.when.time}`).slice(0, 4);
      spoken.push(`Scheduled: ${times.join(', ')}.`);
      for (const item of schedules) logLines.push(`- ${item.when.time} — ${item.name}`);
    }
    const notes = this.memory.list(2);
    if (notes.length) {
      spoken.push(`Latest note: ${notes[0].text}`);
      logLines.push(`- Latest note: ${notes[0].text}`);
    }
    this.vault.appendDaily('Inbox Brief', logLines.length ? logLines.join('\n') : 'Inbox clear.');
    return { text: `Inbox brief. ${spoken.join(' ')} Logged to today's daily note.` };
  }

  #trends() {
    const weekAgo = Date.now() - 7 * 86400000;
    const texts = this.vault.recent(100)
      .filter((note) => note.folder === 'raw' && note.mtime >= weekAgo)
      .map((note) => this.vault.readNote(note.name)?.content || '');
    for (const task of this.tasks.list({ status: 'open' })) texts.push(task.title);
    const terms = topTerms(texts, 5);
    if (!terms.length) {
      return { text: 'Trend scan: not enough recent captures to spot a trend yet. Keep feeding the vault.' };
    }
    const spokenList = terms.map(({ term, count }) => `${term} (${count})`).join(', ');
    const report = [
      '# Trend Scan',
      '',
      'What kept coming up across the last 7 days of captures and open tasks:',
      '',
      ...terms.map(({ term, count }) => `- **${term}** — ${count} mention${count === 1 ? '' : 's'}`)
    ].join('\n');
    const saved = this.vault.writeOutput('trend-scan', report);
    return { text: `Trend scan. What's moving this week: ${spokenList}. Report saved to the vault.`, extra: { vaultNote: saved.name } };
  }

  #plan() {
    const open = this.tasks.list({ status: 'open' });
    const now = new Date();
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    // Overdue first, then due today, then newest — the order a chief of
    // staff would read them out.
    const overdue = open.filter((task) => task.dueAt && new Date(task.dueAt) < now);
    const dueToday = open.filter((task) => task.dueAt && new Date(task.dueAt) >= now && new Date(task.dueAt) <= endOfDay);
    const rest = open.filter((task) => !overdue.includes(task) && !dueToday.includes(task));
    const top = [...overdue, ...dueToday, ...rest].slice(0, 3);
    if (!top.length) {
      return { text: 'Plan for today: the task list is clear. Capture something to the vault, or enjoy it.' };
    }
    this.vault.appendDaily('Plan', top.map((task, index) => `- [ ] ${index + 1}. ${task.title}`).join('\n'));
    const spoken = top.map((task, index) => `${index + 1}: ${task.title}`).join('. ');
    return { text: `Today's top ${top.length}. ${spoken}. Written to the daily note.` };
  }

  #vault(matched) {
    if (/^close (?:the|my) day$/.test(matched.trigger)) {
      const done = this.#doneToday();
      const summary = this.tasks.summary();
      const lines = [
        done.length ? `Completed today:\n${done.map((task) => `- [x] ${task.title}`).join('\n')}` : 'Nothing marked done today.',
        `Still open: ${summary.open}${summary.overdue ? ` (${summary.overdue} overdue)` : ''}.`
      ];
      this.vault.appendDaily('Reflection', lines.join('\n\n'));
      return {
        text: `Day closed. ${done.length ? `${done.length} task${done.length === 1 ? '' : 's'} done` : 'Nothing checked off'}, ${summary.open} still open for tomorrow. Reflection logged.`
      };
    }
    const args = matched.args;
    const capture = args.match(/^capture\s+(.+)$/i);
    if (capture) {
      const saved = this.vault.capture(capture[1], { source: 'voice' });
      return { text: `Captured to the vault as ${saved.name}.`, extra: { vaultNote: saved.name } };
    }
    const searchFor = args.match(/^(?:search|find)\s+(?:for\s+)?(.+)$/i);
    if (searchFor) {
      const hits = this.vault.search(searchFor[1], 5);
      if (!hits.length) return { text: `Nothing in the vault matches “${searchFor[1]}” yet.` };
      return {
        text: `${hits.length} note${hits.length === 1  ? '' : 's'} match: ${hits.map((hit) => hit.name).join(', ')}.`,
        extra: { vaultHits: hits.map(({ name, folder, snippet }) => ({ name, folder, snippet })) }
      };
    }
    if (/^recent$/i.test(args)) {
      const notes = this.vault.recent(5);
      if (!notes.length) return { text: 'The vault is empty. Say "vault capture" followed by a thought to start it.' };
      return { text: `Newest in the vault: ${notes.map((note) => note.name).join(', ')}.` };
    }
    const stats = this.vault.stats();
    return {
      text: `The vault holds ${stats.total} note${stats.total === 1 ? '' : 's'} — ${stats.raw} raw, ${stats.wiki} wiki, ${stats.outputs} shipped — with ${stats.links} link${stats.links === 1 ? '' : 's'}. Say "vault capture", "vault search", or "vault recent".`
    };
  }
}

module.exports = { SkillService, parseSkillFile, topTerms };
