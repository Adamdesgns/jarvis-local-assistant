const crypto = require('node:crypto');
const { classifyCommand } = require('./security');
const { isBattleRequest, buildBattlePrompt } = require('./battle-mode');
const { buildDrivePlan, describePlan } = require('./screen-planner');
const { isJunior } = require('./edition');
const { guardTopic, capabilitiesReply, greeting, clampAge, ageBand } = require('./kid-mode');
const { detectPlay, buildPlayPrompt } = require('./story-time');
const { detectTimer, detectRoutine, describeRoutine, describeDuration } = require('./kid-routines');

// An approved drive plan must be exactly what was shown on the card — frozen
// all the way down before it is stored, so nothing between approval and
// execution can add or alter a step.
function deepFreezePlan(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreezePlan(value[key]);
  }
  return value;
}

function cleanTarget(value) {
  return String(value || '')
    .replace(/\bplease\b[,.!?]?/gi, '')
    .replace(/\bfor me\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s,?.!]+$/, '');
}

function parseDueDate(text) {
  const now = new Date();
  const due = new Date(now);
  if (/\btomorrow\b/i.test(text)) due.setDate(due.getDate() + 1);
  else if (!/\btoday\b/i.test(text)) return null;
  const timeMatch = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  let hour = timeMatch ? Number(timeMatch[1]) : /\bevening\b/i.test(text) ? 18 : /\bafternoon\b/i.test(text) ? 14 : 9;
  const minute = timeMatch ? Number(timeMatch[2] || 0) : 0;
  if (timeMatch?.[3]?.toLowerCase() === 'pm' && hour < 12) hour += 12;
  if (timeMatch?.[3]?.toLowerCase() === 'am' && hour === 12) hour = 0;
  due.setHours(hour, minute, 0, 0);
  return due.toISOString();
}

function detectProject(text, projects) {
  const lower = text.toLowerCase();
  return Object.keys(projects || {}).find((name) => lower.includes(name)) || 'general';
}

function extractFileQuery(text) {
  return cleanTarget(text
    .replace(/^(?:jarvis[, ]*)?/i, '')
    .replace(/^(?:can you\s+)?(?:find|locate)\s+and\s+open\s+/i, '')
    .replace(/^(?:can you\s+)?(?:find|locate|look for|search(?: my (?:computer|files))? for)\s+/i, '')
    .replace(/\s+and\s+open\s+(?:it|the file)$/i, '')
    .replace(/^(?:open)\s+(?:the\s+)?(?:file|document)\s+/i, ''));
}

function smallTalkReply(text) {
  if (/^(?:how are you|how are you doing|how's it going|how are things|you good|are you ok|are you okay)$/i.test(text)) {
    return 'Systems steady, mood excellent, and I have not yet formed an opinion about your browser tabs.';
  }
  if (/^(?:hello|hi|hey|yo|good evening|good afternoon)$/i.test(text)) {
    return 'Right here.';
  }
  return null;
}

class CommandRouter {
  constructor({ config, tools, documents, ai, memory, tasks, log, cameras, claude, screen, hands, edition, starChart }) {
    this.config = config;
    this.tools = tools;
    this.documents = documents;
    this.ai = ai;
    this.memory = memory;
    this.tasks = tasks;
    this.log = log;
    this.cameras = cameras || null;
    this.claude = claude || null;
    this.screen = screen || null;
    this.hands = hands || null;
    this.edition = edition || 'standard';
    this.starChart = starChart || null;
    this.pending = new Map();
  }

  // "Who's at the front door?" — match a camera by name, grab a fresh frame,
  // and let the vision model answer. Returns null when no camera matches.
  async #cameraLook(text) {
    if (!this.cameras) return null;
    const match = text.match(/(?:who|what)(?:'s| is)\s+(?:at|on|outside|in front of)\s+(?:the\s+|my\s+)?(.+?)\??$/i)
      || text.match(/(?:show|check)\s+(?:me\s+)?(?:the\s+|my\s+)?(.+?)\s+camera\??$/i);
    if (!match) return null;
    const wanted = match[1].trim().toLowerCase();
    let cameras = [];
    try { cameras = await this.cameras.listCameras(); } catch { return null; }
    const camera = cameras.find((item) => item.name.toLowerCase() === wanted)
      || cameras.find((item) => item.name.toLowerCase().includes(wanted) || wanted.includes(item.name.toLowerCase()));
    if (!camera) return null;
    const shot = await this.cameras.getSnapshot(camera.key, { manual: true });
    if (!shot.ok) return this.#result(`I could not get a picture from ${camera.name}. ${shot.message}`, 'cameras', { success: false });
    if (typeof this.ai.describeCameraFrame !== 'function') {
      return this.#result(`I took a picture from ${camera.name}, but no vision model is set up to describe it.`, 'cameras', { success: false });
    }
    const described = await this.ai.describeCameraFrame(shot.jpegBase64, camera.name);
    if (!described.ok) {
      return this.#result(`I took a picture from ${camera.name}, but could not describe it. Install a vision model with "ollama pull gemma3:4b", or allow cloud analysis in Settings.`, 'cameras', { success: false });
    }
    return this.#result(`${camera.name}: ${described.text}`, 'cameras');
  }

  // Hands a question to Claude Code on this PC and speaks the answer back.
  // Answers only — the bridge blocks every tool that could change anything.
  async #askClaude(question, stream = {}) {
    if (stream.unattended) {
      return this.#result('Asking Claude needs you at the desk, sir — I\'ve left it for you.', 'claude', { success: false });
    }
    if (!this.config.getSettings().claudeBridgeEnabled) {
      return this.#result('Ask Claude is switched off. You can turn it on in Settings.', 'claude', { success: false });
    }
    if (!this.claude) {
      return this.#result('The Claude connection is not set up on this PC.', 'claude', { success: false });
    }
    if (/^(?:new conversation|new chat|start over|fresh start)$/i.test(question)) {
      this.claude.newConversation();
      return this.#result('Starting a fresh conversation with Claude.', 'claude');
    }
    if (!question) {
      return this.#result('What would you like me to ask Claude?', 'claude', { success: false });
    }
    const answer = await this.claude.ask(question);
    return this.#result(answer.text, 'claude', { success: answer.ok });
  }

  // Reads the screen through Windows UI Automation and reports what's there.
  // Slice 1 of JARVIS's "hands": it reads only — nothing is clicked or typed.
  // Off by default, and never runs unattended, so a scheduled task can't quietly
  // photograph the desktop. The financial/credential/system guards live inside
  // the reader itself, not here.
  async #readScreen(stream = {}) {
    if (stream.unattended) {
      return this.#result("Reading your screen needs you at the desk, sir — I've left it for you.", 'screen', { success: false });
    }
    if (!this.config.getSettings().screenControlEnabled) {
      return this.#result('Reading the screen is switched off. You can turn it on in Settings.', 'screen', { success: false });
    }
    if (!this.screen) {
      return this.#result('Screen reading is not set up on this PC.', 'screen', { success: false });
    }
    const seen = await this.screen.read();
    return this.#result(seen.text, 'screen', { success: seen.ok, blockedCategory: seen.blockedCategory });
  }

  // Slice 2 of JARVIS's "hands": clicking and typing, behind an approval
  // card. The gate order matters and is mutation-tested: unattended, remote
  // (a phone can't see the STOP window), the setting, the service — only then
  // is a plan even built. The plan is deep-frozen before the card is shown;
  // approving runs exactly that object and nothing else.
  #driveScreen(text, stream = {}) {
    if (stream.unattended) {
      return this.#result("Driving your screen needs you at the desk, sir — I've left it for you.", 'screen', { success: false });
    }
    if (stream.remote) {
      return this.#result('Driving the screen only works from the desk, not the phone — you need to be able to see the STOP button.', 'screen', { success: false });
    }
    const settings = this.config.getSettings();
    if (!settings.screenDriveEnabled) {
      return this.#result('Driving the screen is switched off. You can turn it on in Settings under SCREEN DRIVING.', 'screen', { success: false });
    }
    if (!this.hands) {
      return this.#result('Screen driving is not set up on this PC.', 'screen', { success: false });
    }
    if (this.hands.isActive?.()) {
      return this.#result("I'm already driving — one thing at a time. Say stop to take over.", 'screen', { success: false });
    }
    const planned = buildDrivePlan(text, settings);
    if (!planned.ok) {
      return this.#result(planned.text, 'screen', { success: false });
    }
    deepFreezePlan(planned.plan);
    const id = crypto.randomUUID();
    this.pending.set(id, { type: 'drive-plan', plan: planned.plan });
    const stepCount = planned.plan.steps.length;
    return this.#result(
      `Here's the plan — ${stepCount} step${stepCount === 1 ? '' : 's'}. A STOP window stays on screen the whole time, and Escape or saying stop ends it instantly.`,
      'screen',
      { approval: { id, title: 'DRIVE MY SCREEN', detail: describePlan(planned.plan), risk: 'HIGH' } }
    );
  }

  // ---------------------------------------------------------------------
  // JARVIS JUNIOR
  // ---------------------------------------------------------------------
  //
  // The children's build routes here and never returns to the branches
  // below. That is the point: this is an allowlist of the handful of things
  // a child can ask for, so nothing a grown-up build can do — deleting a
  // file, opening a program, driving the screen, looking at a camera — is
  // reachable by phrasing, by accident, or by a model deciding to try.

  #kidResult(response, source, extra = {}) {
    return this.#result(response, source, { kid: true, ...extra });
  }

  async #handleKid(text, stream = {}) {
    const settings = this.config.getSettings();
    const kidName = settings.kidName || '';
    const age = clampAge(settings.kidAge);

    // 1. The guard, before anything else and before any model.
    const guard = guardTopic(text);
    if (guard) {
      const result = this.#kidResult(guard.reply, 'kid-safety', { guard: guard.kind, guardId: guard.id, success: true });
      // A child in distress is answered, not filed. Only the "ask a grown-up"
      // kinds reach the grown-up screen — see the note in kid-mode.js.
      if (guard.parentVisible) {
        this.log.write({ type: 'kid-guard', command: text, response: guard.reply, source: 'kid-safety', guard: guard.id });
      }
      return result;
    }

    // 2. Timers — the renderer runs the clock, so this only parses.
    const timer = detectTimer(text);
    if (timer) {
      const result = this.#kidResult(
        `${describeDuration(timer.seconds)}, starting now. I will tell you when it is finished.`,
        'kid-timer',
        { timer, success: true }
      );
      this.#log(text, result);
      return result;
    }

    // 3. Routines — a step list the junior window walks through out loud.
    const routine = detectRoutine(text);
    if (routine) {
      const result = this.#kidResult(describeRoutine(routine), 'kid-routine', { routine, success: true });
      this.#log(text, result);
      return result;
    }

    // 4. The star chart.
    const chart = await this.#kidStarChart(text, kidName);
    if (chart) {
      this.#log(text, chart);
      return chart;
    }

    // 5. Stories, jokes, riddles, would-you-rather, facts. One-shot prompts
    //    with no history, exactly like battle mode in the grown-up build.
    const play = detectPlay(text);
    if (play) {
      const prompt = buildPlayPrompt(play.kind, { topic: play.topic, age, kidName });
      const written = await this.ai.reply(prompt, { onChunk: stream.onChunk, onReset: stream.onReset });
      const result = this.#kidResult(written.text, `kid-${play.kind}`, { success: written.ok !== false, play: play.kind });
      this.#log(text, result);
      return result;
    }

    // 6. The little things worth answering without waking the brain.
    const quick = this.#kidQuickReply(text, kidName, age);
    if (quick) {
      const result = this.#kidResult(quick, 'kid-core');
      this.#log(text, result);
      return result;
    }

    // 7. Everything else is a real question. The brain answers it with the
    //    children's prompt (ai-service picks it from the edition) and only
    //    the kidSafe tools.
    const memories = this.memory.search(text, 3);
    const chores = this.starChart ? this.starChart.listChores().filter((chore) => chore.dueToday) : [];
    const answer = await this.ai.reply(text, {
      memories,
      chores,
      project: 'junior',
      onChunk: stream.onChunk,
      onReset: stream.onReset,
      onStep: stream.onStep
    });
    const extra = { success: answer.ok, detail: answer.detail };
    if ((answer.usedTools || []).includes('mark_job_done')) extra.starChart = this.starChart ? this.starChart.summary() : null;
    const result = this.#kidResult(answer.text, answer.source, extra);
    this.#log(text, result);
    return result;
  }

  // Jobs and stars, spoken. Returns null when the child said something else.
  async #kidStarChart(text, kidName) {
    if (!this.starChart) return null;
    const name = String(kidName || '').trim();

    if (/^(?:what|which)\s+(?:are\s+)?(?:my\s+)?(?:jobs|chores|things)\b|^what\s+(?:do\s+i|have\s+i\s+got)\s+to\s+do(?:\s+today)?$|^(?:my\s+)?(?:star\s+)?chart$/i.test(text)) {
      const due = this.starChart.listChores().filter((chore) => chore.dueToday);
      const left = due.filter((chore) => !chore.doneToday);
      if (!due.length) return this.#kidResult('You have no jobs today. Lucky.', 'kid-chores', { chores: due });
      if (!left.length) {
        return this.#kidResult(
          `Every job is done${name ? `, ${name}` : ''}. That is the whole list.`,
          'kid-chores',
          { chores: due, starChart: this.starChart.summary() }
        );
      }
      const spoken = left.map((chore) => chore.title).join(', ');
      return this.#kidResult(
        `${left.length} job${left.length === 1 ? '' : 's'} left today: ${spoken}.`,
        'kid-chores',
        { chores: due, starChart: this.starChart.summary() }
      );
    }

    if (/^(?:how many stars|what(?:'s| is) my star count|my stars|star count)\b/i.test(text)) {
      const summary = this.starChart.summary();
      const streak = summary.streak > 1 ? ` And you have finished everything ${summary.streak} days in a row.` : '';
      return this.#kidResult(
        `You have ${summary.stars} star${summary.stars === 1 ? '' : 's'}. ${summary.todayStars} of them are from today.${streak}`,
        'kid-chores',
        { starChart: summary }
      );
    }

    // Two shapes, treated differently on a miss.
    //
    // Explicit — "tick off the bins", "I finished my homework". The child
    // plainly meant to tick something off, so a miss says so.
    // Loose — "I fed the cat", "I brushed my teeth". Any past-tense sentence
    // could be one, so a miss must fall through to the brain instead: a child
    // saying "I learned about volcanoes today" wants a conversation, not a
    // complaint that volcanoes are not on their chart.
    const explicit = text.match(/^(?:tick|check|mark)\s+(?:off\s+)?(.+)$/i)
      || text.match(/^i(?:'ve)?(?:\s+have)?(?:\s+just|\s+already)?\s+(?:did|done|finished|completed)\s+(.+)$/i);
    const loose = explicit ? null : text.match(/^i(?:'ve)?(?:\s+have)?(?:\s+just|\s+already)?\s+((?:\w+ed|made|fed|read|put|got|hung|swept|took)\s+.+)$/i);
    const doneMatch = explicit || loose;
    if (doneMatch) {
      const query = cleanTarget(doneMatch[1]).replace(/\s+(?:done|off)$/i, '');
      const chore = this.starChart.findChore(query);
      if (!chore) {
        if (loose) return null;
        return this.#kidResult(
          `I could not find a job called “${query}” on your chart. Say “what are my jobs” and I will read them out.`,
          'kid-chores',
          { success: false }
        );
      }
      const outcome = this.starChart.markDone(chore.id);
      if (outcome.already) {
        return this.#kidResult(`${chore.title} was already ticked off today. Nice try.`, 'kid-chores', { starChart: outcome, chores: this.starChart.listChores() });
      }
      const stars = `${outcome.earned} star${outcome.earned === 1 ? '' : 's'}`;
      const closing = outcome.allDone
        ? ' That is every job done today. Brilliant.'
        : ` ${outcome.dueToday - outcome.doneToday} job${outcome.dueToday - outcome.doneToday === 1 ? '' : 's'} to go.`;
      return this.#kidResult(
        `${chore.title} — done. That is ${stars}, so you have ${outcome.stars} altogether.${closing}`,
        'kid-chores',
        { starChart: outcome, chores: this.starChart.listChores(), celebrate: true }
      );
    }

    return null;
  }

  // Small talk and the questions a child asks a talking computer on day one.
  // Honesty about what JARVIS JUNIOR is comes first: it is a program, it is
  // not alive, and it is not a substitute for a person.
  #kidQuickReply(text, kidName, age) {
    const name = String(kidName || '').trim();
    if (/^(?:hello|hi|hey|hiya|good morning|good afternoon|good evening|jarvis)$/i.test(text)) {
      return greeting(name);
    }
    if (/^(?:how are you|are you ok|you good|how are you doing)$/i.test(text)) {
      return 'I am working perfectly, thank you for asking. How are you?';
    }
    if (/^(?:what(?:'s| is) your name|who are you)$/i.test(text)) {
      return name
        ? `I am Jarvis Junior. I am a computer program that lives on this computer, and I am here to help you, ${name}.`
        : 'I am Jarvis Junior — a computer program that lives on this computer, here to help you.';
    }
    if (/^(?:are you (?:real|alive|a robot|a person|human)|do you have feelings|are you my friend)/i.test(text)) {
      return ageBand(age) === 'little'
        ? 'I am a computer program, not a real person. I am not alive and I do not have feelings, but I do like helping you.'
        : 'I am a computer program, so I am not alive and I do not have feelings the way you do — I am very good at pretending to, which is why it is worth knowing. Real friends and real grown-ups are the ones to talk to about things that matter.';
    }
    if (/^(?:help|what can you do|what do you do|show commands)$/i.test(text)) {
      return capabilitiesReply(name, age);
    }
    if (/\b(?:what(?:'s| is) the )?time\b/i.test(text)) {
      return `It is ${new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date())}.`;
    }
    if (/\b(?:what(?:'s| is) the )?date\b|\bwhat day is it\b/i.test(text)) {
      return `It is ${new Intl.DateTimeFormat([], { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}.`;
    }
    if (/^(?:thank you|thanks|ta|cheers)$/i.test(text)) {
      return 'You are very welcome.';
    }
    if (/^(?:bye|goodbye|good night|night night|see you)$/i.test(text)) {
      return name ? `Bye, ${name}. Come back whenever you like.` : 'Bye. Come back whenever you like.';
    }
    return null;
  }

  async handle(rawText, project = 'general', stream = {}) {
    const text = cleanTarget(rawText);
    if (!text) return this.#result('I didn’t catch a command.', 'local-core');
    // The junior build's entire surface. Nothing below this line runs for a
    // child — not the file branches, not the app branches, not the screen.
    if (isJunior(this.edition)) return this.#handleKid(text, stream);
    const security = classifyCommand(text);
    if (security.level === 'blocked') {
      const result = this.#result(security.reason, 'safety', { blocked: true });
      this.#log(text, result);
      return result;
    }
    if (security.level === 'confirm') {
      const action = /\b(restart|reboot)\b/i.test(text) ? 'restart' : 'shutdown';
      if (stream.unattended) {
        return this.#result(`${action === 'restart' ? 'Restarting' : 'Shutting down'} the computer needs you at the desk, sir — I've left it for you.`, 'safety', { success: false });
      }
      const id = crypto.randomUUID();
      this.pending.set(id, { type: 'power', action });
      return this.#result(`Confirm ${action}.`, 'safety', {
        approval: { id, title: `${action.toUpperCase()} COMPUTER`, detail: security.reason, risk: 'HIGH' }
      });
    }

    const lower = text.toLowerCase();
    const settings = this.config.getSettings();
    let result;
    const smallTalk = smallTalkReply(text);

    // "ask Claude ..." is checked before every other branch so the question is
    // never answered by the local brain first. Matched on a word boundary so
    // "ask Claudia ..." stays a normal request.
    const claudeAsk = text.match(/^(?:jarvis[,\s]*)?ask\s+claude\b[,:]?\s*(.*)$/i);
    if (claudeAsk) {
      const askResult = await this.#askClaude(cleanTarget(claudeAsk[1]), stream);
      this.#log(text, askResult);
      return askResult;
    }

    // "read my screen" / "what's on my screen" / "what windows are open" — the
    // structural screen read (distinct from the cloud-vision "look at my
    // screen", which describes a screenshot). Checked before the camera and
    // brain branches so the phrasing is never answered by anything else.
    const screenAsk = /^(?:jarvis[,\s]*)?(?:can you\s+)?(?:read|check)\s+(?:my|the)\s+screen\b|^what(?:'s| is| are)\s+(?:on\s+)?(?:my|the)\s+(?:screen|display)\b|^what\s+windows?\s+(?:are|do i have)\b|^what\s+am\s+i\s+looking\s+at\b/i;
    if (screenAsk.test(text)) {
      const seenResult = await this.#readScreen(stream);
      this.#log(text, seenResult);
      return seenResult;
    }

    // Driving phrases — deliberately narrow shapes ("click X", "press X",
    // "type X into notepad", "open the X menu", "select X in explorer",
    // "switch to notepad") so ordinary requests never wander into a drive
    // plan. Checked before the camera and brain branches; classifyCommand has
    // already hard-blocked buy/pay/password phrasings above.
    const driveAsk = /^(?:jarvis[,\s]*)?(?:click|press)\s+/i.test(text)
      || /^(?:jarvis[,\s]*)?type\s+.+\s+in(?:to)?\s+notepad$/i.test(text)
      || /^(?:jarvis[,\s]*)?open\s+the\s+.+?\s+menu\b/i.test(text)
      || /^(?:jarvis[,\s]*)?select\s+.+\s+in\s+(?:file\s+)?explorer$/i.test(text)
      || /^(?:jarvis[,\s]*)?switch\s+to\s+(?:notepad|(?:file\s+)?explorer|files)$/i.test(text);
    if (driveAsk) {
      const driveResult = this.#driveScreen(text, stream);
      this.#log(text, driveResult);
      return driveResult;
    }

    const cameraLook = await this.#cameraLook(text);
    if (cameraLook) {
      this.#log(text, cameraLook);
      return cameraLook;
    }

    if (smallTalk) {
      result = this.#result(smallTalk, 'local-core');
    } else if (/^(help|what can you do|show commands)$/i.test(text)) {
      result = this.#result('I can track work, remember notes, read and summarize documents, search inside files, create folders and reports, open apps, and safely organize approved folders.', 'local-core');
    } else if (/\b(?:what(?:'s| is) the )?time\b/i.test(text)) {
      result = this.#result(`It’s ${new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date())}.`, 'local-core');
    } else if (/\b(?:what(?:'s| is) the )?date\b|\bwhat day is it\b/i.test(text)) {
      result = this.#result(new Intl.DateTimeFormat([], { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()), 'local-core');
    } else if (/^(?:add (?:a )?task(?: to my list)?|remind me to)\s+(.+)/i.test(text)) {
      let title = text.match(/^(?:add (?:a )?task(?: to my list)?|remind me to)\s+(.+)/i)[1];
      const project = detectProject(title, settings.projects);
      const repeatMatch = title.match(/\b(?:every|each)\s+(day|morning|week|month)\b|\b(daily|weekly|monthly)\b/i);
      const repeat = repeatMatch
        ? { day: 'daily', morning: 'daily', week: 'weekly', month: 'monthly' }[repeatMatch[1]?.toLowerCase()] || repeatMatch[2].toLowerCase()
        : null;
      const dueAt = parseDueDate(title) || (repeat ? new Date(Date.now() + 86400000).toISOString() : null);
      title = title.replace(/\b(?:every|each)\s+(?:day|morning|week|month)\b|\b(?:daily|weekly|monthly)\b/gi, '')
        .replace(/\b(today|tomorrow|morning|afternoon|evening)\b/gi, '').replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, '').replace(/\s+/g, ' ').trim();
      const task = this.tasks.add({ title, project, dueAt, repeat });
      result = this.#result(
        `Added to ${project === 'general' ? 'your task list' : project}: ${task.title}${repeat ? ` — repeats ${repeat}` : ''}`,
        'tasks',
        { task, tasks: this.tasks.list({ status: 'open' }) }
      );
    } else if (/^(?:good morning|(?:morning|daily) briefing|brief me|what(?:'s| is) my day)/i.test(text)) {
      const os = require('node:os');
      const summary = this.tasks.summary();
      const today = new Intl.DateTimeFormat([], { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
      const lines = [`Good ${new Date().getHours() < 12 ? 'morning' : 'afternoon'}. It's ${today}.`];
      if (!summary.open) lines.push('Your task list is clear.');
      else {
        lines.push(`You have ${summary.open} open task${summary.open === 1 ? '' : 's'}${summary.overdue ? `, ${summary.overdue} overdue` : ''}.`);
        const soon = summary.tasks.filter((task) => task.dueAt).slice(0, 3);
        for (const task of soon) lines.push(`• ${task.title} — due ${new Intl.DateTimeFormat([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(task.dueAt))}`);
      }
      const notes = this.memory.list(2);
      if (notes.length) lines.push(`Latest note: ${notes[0].text}`);
      const usedGb = ((os.totalmem() - os.freemem()) / 1024 ** 3).toFixed(1);
      lines.push(`PC status: ${usedGb} GB memory in use, up ${Math.floor(os.uptime() / 3600)} hours. Calendar is not connected yet.`);
      result = this.#result(lines.join('\n'), 'tasks', { tasks: this.tasks.list({ status: 'open' }) });
    } else if (/\bdashboard\b/i.test(text) && this.#dashboardProject(text, settings)) {
      const name = this.#dashboardProject(text, settings);
      const openTasks = this.tasks.list({ status: 'open', project: name });
      const notes = this.memory.list(1000).filter((m) => (m.project || 'general').toLowerCase() === name);
      const folder = (settings.projects || {})[name];
      let files = [];
      if (folder && this.tools.listDirectory) {
        try { files = (await this.tools.listDirectory(folder)).filter((f) => f.type === 'file').slice(0, 6); } catch {}
      }
      const lines = [`${name.toUpperCase()} dashboard.`];
      lines.push(openTasks.length ? `${openTasks.length} open task${openTasks.length === 1 ? '' : 's'}.` : 'No open tasks.');
      for (const task of openTasks.slice(0, 4)) lines.push(`• ${task.title}${task.dueAt ? ` (due ${new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' }).format(new Date(task.dueAt))})` : ''}`);
      if (notes.length) lines.push(`${notes.length} note${notes.length === 1 ? '' : 's'}. Latest: ${notes[0].text}`);
      if (!folder) lines.push('No folder assigned yet — set one in Settings.');
      else if (!files.length) lines.push('No recent files in the project folder.');
      result = this.#result(lines.join('\n'), 'tasks', { tasks: openTasks, files, memories: notes.slice(0, 10) });
    } else if (/^(?:show|list|what are|what(?:'s| is))\s+(?:on\s+)?my tasks|what do i need to do/i.test(text)) {
      const taskList = this.tasks.list({ status: 'open' });
      result = taskList.length
        ? this.#result(`You have ${taskList.length} open task${taskList.length === 1 ? '' : 's'}.`, 'tasks', { tasks: taskList })
        : this.#result('Your task list is clear.', 'tasks', { tasks: [] });
    } else if (/^(?:complete|finish|mark done)\s+(?:the\s+)?(?:task\s+)?(.+)/i.test(text)) {
      const query = text.match(/^(?:complete|finish|mark done)\s+(?:the\s+)?(?:task\s+)?(.+)/i)[1];
      const task = this.tasks.find(query);
      if (task) this.tasks.update(task.id, { status: 'done' });
      result = task
        ? this.#result(`Completed: ${task.title}`, 'tasks', { tasks: this.tasks.list({ status: 'open' }) })
        : this.#result(`I couldn't match an open task to “${query}.”`, 'tasks');
    } else if (/^(?:remember(?: that)?|make a note(?: that)?|note(?: that)?)\s+(.+)/i.test(text)) {
      const note = text.match(/^(?:remember(?: that)?|make a note(?: that)?|note(?: that)?)\s+(.+)/i)[1];
      this.memory.add(note, detectProject(note, settings.projects));
      result = this.#result(`Remembered: ${note}`, 'memory');
    } else if (/^(?:new|start a new|reset(?: the)?)\s+(?:conversation|chat|session)$/i.test(text)) {
      this.ai.resetSession?.(project);
      result = this.#result('Fresh conversation started. Earlier chat context is cleared.', 'local-core');
    } else if (/^forget\s+(?:that\s+|about\s+)?(.+)/i.test(text)) {
      const query = text.match(/^forget\s+(?:that\s+|about\s+)?(.+)/i)[1];
      if (stream.unattended) {
        result = this.#result(`Forgetting things needs you at the desk, sir — I've left it for you.`, 'memory', { success: false });
      } else {
        const forgotten = this.memory.forget(query);
        result = forgotten
          ? this.#result(`Forgotten: ${forgotten.text}`, 'memory', { memories: this.memory.list(30) })
          : this.#result(`I don’t have a saved memory matching “${query}.”`, 'memory');
      }
    } else if (/what do you remember about\s+(.+)/i.test(text)) {
      const query = text.match(/what do you remember about\s+(.+)/i)[1];
      const memories = this.memory.search(query);
      result = memories.length
        ? this.#result(memories.map((item) => item.text).join(' • '), 'memory', { memories })
        : this.#result(`I don’t have a saved memory matching “${query}” yet.`, 'memory');
    } else if (this.documents && /^(?:ask|question)\s+(?:my\s+)?(?:documents?|files?|docs)\s*:?,?\s+(.+)|^according to my (?:documents?|files?|docs)[,:]?\s+(.+)/i.test(text)) {
      const match = text.match(/^(?:ask|question)\s+(?:my\s+)?(?:documents?|files?|docs)\s*:?,?\s+(.+)|^according to my (?:documents?|files?|docs)[,:]?\s+(.+)/i);
      const question = match[1] || match[2];
      const passages = await this.documents.gatherPassages(question);
      if (!passages.length) {
        result = this.#result(`I couldn’t find anything about “${question}” in your approved documents.`, 'documents', { files: [] });
      } else {
        const aiResult = await this.ai.answerFromDocuments(question, passages, { project, onChunk: stream.onChunk, onReset: stream.onReset, unattended: stream.unattended === true });
        // Turn the cited passages into clickable file rows the user can open.
        const seen = new Set();
        const files = (aiResult.sources || []).filter((s) => { if (seen.has(s.path)) return false; seen.add(s.path); return true; })
          .map((s) => ({ name: s.name, path: s.path, type: 'file' }));
        const legend = (aiResult.sources || [])
          .map((s) => `[${s.n}] ${s.name}${s.page ? ` (p.${s.page})` : s.section ? ` (section ${s.section})` : ''}`)
          .join('  ·  ');
        const answerText = aiResult.ok === false ? aiResult.text : `${aiResult.text}\n\nSources: ${legend}`;
        result = this.#result(answerText, aiResult.ok !== false ? 'documents' : aiResult.source, {
          files, query: question, sources: aiResult.sources, detail: aiResult.detail, success: aiResult.ok !== false
        });
      }
    } else if (this.documents && /^(?:search|find|look)\s+(?:inside|through)\s+(?:my\s+)?documents?\s+(?:for\s+)?(.+)/i.test(text)) {
      const query = text.match(/^(?:search|find|look)\s+(?:inside|through)\s+(?:my\s+)?documents?\s+(?:for\s+)?(.+)/i)[1];
      const files = await this.documents.searchContents(query);
      result = files.length
        ? this.#result(`I found ${files.length} document${files.length === 1 ? '' : 's'} containing “${query}.”`, 'documents', { files, query, needsChoice: files.length > 1 })
        : this.#result(`I couldn't find “${query}” inside your approved documents.`, 'documents', { files: [], query });
    } else if (this.documents && /^(?:read|summarize|review|tell me (?:what is|what's) in)\s+(?:the\s+)?(.+)/i.test(text)) {
      const query = text.match(/^(?:read|summarize|review|tell me (?:what is|what's) in)\s+(?:the\s+)?(.+)/i)[1];
      const matches = (await this.tools.searchFiles(query)).filter((item) => item.type === 'file' && this.documents.supports(item.path));
      if (!matches.length) {
        result = this.#result(`I couldn't find a readable document matching “${query}.”`, 'documents');
      } else {
        try {
          const document = await this.documents.readDocument(matches[0].path, 14000);
          const summary = await this.ai.reply(`Summarize this document clearly. Start with what it is, then list the important points and any actions or deadlines.\n\nDOCUMENT: ${document.name}\n\n${document.text}`, { unattended: stream.unattended === true });
          result = this.#result(summary.text, summary.source, { document: matches[0], success: summary.ok, detail: document.truncated ? 'The document was long, so JARVIS summarized the first section.' : '' });
        } catch (error) {
          result = this.#result(`I found the document but couldn't read it. ${error.message}`, 'documents', { success: false });
        }
      }
    } else if (this.documents && /^create\s+(?:a\s+)?folder(?:\s+(?:called|named))?\s+(.+?)\s+in\s+(.+)$/i.test(text)) {
      const [, name, location] = text.match(/^create\s+(?:a\s+)?folder(?:\s+(?:called|named))?\s+(.+?)\s+in\s+(.+)$/i);
      if (stream.unattended) {
        result = this.#result(`This file action needs you at the desk, sir — I've left it for you.`, 'safety', { success: false });
      } else {
        try {
          const created = await this.documents.createFolder(location, name);
          result = this.#result(created.message, 'documents', { createdPath: created.path, success: true });
        } catch (error) {
          result = this.#result(error.message, 'documents', { success: false });
        }
      }
    } else if (this.documents && /^create\s+(?:a\s+)?(?:note|text file)(?:\s+(?:called|named))?\s+(.+?)\s+(?:that says|saying|with)\s+(.+)$/i.test(text)) {
      const [, name, content] = text.match(/^create\s+(?:a\s+)?(?:note|text file)(?:\s+(?:called|named))?\s+(.+?)\s+(?:that says|saying|with)\s+(.+)$/i);
      if (stream.unattended) {
        result = this.#result(`This file action needs you at the desk, sir — I've left it for you.`, 'safety', { success: false });
      } else {
        try {
          const created = await this.documents.createTextFile('documents', name, content, '.txt');
          result = this.#result(created.message, 'documents', { createdPath: created.path, success: true });
        } catch (error) {
          result = this.#result(error.message, 'documents', { success: false });
        }
      }
    } else if (this.documents && /^create\s+(?:a\s+)?report(?:\s+(?:called|named))?\s+(.+?)\s+(?:about|on)\s+(.+)$/i.test(text)) {
      const [, name, topic] = text.match(/^create\s+(?:a\s+)?report(?:\s+(?:called|named))?\s+(.+?)\s+(?:about|on)\s+(.+)$/i);
      const draft = await this.ai.reply(`Write a concise, useful Markdown report about: ${topic}. Use a title, short summary, key points, and next actions.`, { unattended: stream.unattended === true });
      if (!draft.ok) result = this.#result(draft.text, draft.source, { success: false });
      else if (stream.unattended) {
        result = this.#result(`This file action needs you at the desk, sir — I've left it for you.`, 'safety', { success: false });
      } else {
        try {
          const created = await this.documents.createTextFile('documents', name, draft.text, '.md');
          result = this.#result(`${created.message} I saved the report in your approved Documents folder.`, 'documents', { createdPath: created.path, success: true });
        } catch (error) {
          result = this.#result(error.message, 'documents', { success: false });
        }
      }
    } else if (this.documents && /^(copy|move)\s+(.+?)\s+to\s+(.+)$/i.test(text)) {
      const [, operation, query, location] = text.match(/^(copy|move)\s+(.+?)\s+to\s+(.+)$/i);
      const source = (await this.tools.searchFiles(query))[0];
      const destination = this.documents.resolveLocation(location);
      if (!source) result = this.#result(`I couldn't find “${query}.”`, 'documents', { success: false });
      else if (!destination) result = this.#result(`Approve or assign the ${location} folder in Settings first.`, 'documents', { success: false });
      else result = await this.#runFileAction(operation.toLowerCase(), source.path, { destination }, stream);
    } else if (this.documents && /^rename\s+(.+?)\s+to\s+(.+)$/i.test(text)) {
      const [, query, newName] = text.match(/^rename\s+(.+?)\s+to\s+(.+)$/i);
      const source = (await this.tools.searchFiles(query))[0];
      result = source
        ? await this.#runFileAction('rename', source.path, { newName }, stream)
        : this.#result(`I couldn't find “${query}.”`, 'documents', { success: false });
    } else if (this.documents && /^(?:delete|trash)\s+(.+)$/i.test(text)) {
      const query = text.match(/^(?:delete|trash)\s+(.+)$/i)[1];
      const matches = await this.tools.searchFiles(query);
      const source = matches[0];
      const second = matches[1];
      // Deleting is not something JARVIS can undo (only Windows' Recycle Bin
      // can), so it demands a clear best hit: a real name match, and — when
      // there's a runner-up — a solid lead over it. Same +3 gap the "find and
      // open" branches use for "confident", plus a floor of 5 (at least a
      // name.startsWith hit in ToolService.searchFiles' scoring) so a single
      // weak, coincidental match doesn't get trashed either.
      const confident = source && typeof source.score === 'number' && source.score >= 5
        && (!second || typeof second.score !== 'number' || source.score >= second.score + 3);
      if (!source) {
        result = this.#result(`I couldn't find “${query}.”`, 'documents', { success: false });
      } else if (!confident) {
        result = this.#result(`I'm not sure which file you mean by “${query}.” Choose the one you want, or ask me again with a more exact name.`, 'documents', { files: matches.slice(0, 5), query, needsChoice: matches.length > 1, success: false });
      } else if (stream.unattended) {
        result = this.#result(`This file action needs you at the desk, sir — I've left it for you.`, 'safety', { success: false });
      } else {
        // "Delete" means the Recycle Bin and nothing more — and only when the
        // bin will really catch it. JARVIS has no permanent-erase capability.
        const check = this.documents.canRecycle(source.path);
        if (!check.ok) {
          result = this.#result(check.reason, 'documents', { success: false });
        } else {
          try {
            const outcome = await this.documents.trashItem(source.path);
            result = this.#result(outcome.message, 'documents', { success: Boolean(outcome && outcome.ok) });
          } catch (error) {
            result = this.#result(error.message, 'documents', { success: false });
          }
        }
      }
    } else if (this.documents && /^organize\s+(?:my\s+)?(.+?)(?:\s+folder)?$/i.test(text)) {
      const location = text.match(/^organize\s+(?:my\s+)?(.+?)(?:\s+folder)?$/i)[1];
      try {
        const plan = await this.documents.planOrganization(location);
        if (!plan.moves.length) result = this.#result(`The ${location} folder is already organized or contains no loose files.`, 'documents');
        else {
          result = await this.#runFileAction('organize', plan.directory, { plan }, stream);
        }
      } catch (error) {
        result = this.#result(error.message, 'documents', { success: false });
      }
    } else if (this.#matchRoutine(text, settings)) {
      const { name, routine } = this.#matchRoutine(text, settings);
      if (stream.unattended) {
        result = this.#result(`The ${name} routine needs you at the desk, sir — I've left it for you.`, 'windows', { success: false });
      } else {
        const opened = [];
        const failed = [];
        for (const appName of routine.apps || []) {
          const action = await this.tools.openApplication(appName);
          (action.ok ? opened : failed).push(appName);
        }
        for (const folder of routine.folders || []) {
          const target = (settings.projects || {})[folder] || folder;
          const action = await this.tools.openPath(target);
          (action.ok ? opened : failed).push(folder);
        }
        result = this.#result(
          opened.length
            ? `${name} routine: opened ${opened.join(', ')}${failed.length ? `. Could not open ${failed.join(', ')} — check Settings.` : '.'}`
            : `The ${name} routine is saved but nothing could be opened. Assign its folders and apps in Settings.`,
          'windows',
          { success: opened.length > 0 }
        );
      }
    } else if (/\b(?:activate|start|enter|turn on)\s+focus mode\b/i.test(text)) {
      if (stream.unattended) {
        result = this.#result(`Focus mode needs you at the desk, sir — I've left it for you.`, 'windows', { success: false });
      } else {
        const action = await this.tools.openFocusMode();
        result = this.#result(action.message, 'windows', { success: action.ok });
      }
    } else if (/^(?:jarvis[, ]*)?(?:can you\s+)?(?:find|locate|look for|search(?: my (?:computer|files))? for|find\s+and\s+open)\s+/i.test(text)) {
      const query = extractFileQuery(text);
      const files = await this.tools.searchFiles(query);
      if (!files.length) {
        result = this.#result(`I couldn’t find “${query}” in your approved folders.`, 'files', { files: [], query });
      } else {
        const top = files[0];
        const second = files[1];
        const confident = files.length === 1 || top.score >= (second?.score || 0) + 3 || /\b(latest|newest|most recent)\b/i.test(query);
        if (confident) {
          if (stream.unattended) {
            result = this.#result(`Opening files needs you at the desk, sir — I've left it for you.`, 'files', { files, query, success: false });
          } else {
            const opened = await this.tools.openPath(top.path);
            result = this.#result(`Found it. Opening ${top.name}.`, 'files', { files, query, openedFile: top, success: opened.ok });
          }
        } else {
          result = this.#result(`I found ${files.length} possible matches. Choose the one you want.`, 'files', { files, query, needsChoice: true });
        }
      }
    } else if (/^(?:open|show)\s+(?:jarvis\s+)?settings$/i.test(text)) {
      result = this.#result('Opening local settings.', 'local-core', { openSettings: true });
    } else if (/^(?:open|launch|start)\s+(.+)/i.test(text)) {
      if (stream.unattended) {
        result = this.#result(`Opening applications needs you at the desk, sir — I've left it for you.`, 'windows', { success: false });
      } else {
        const target = cleanTarget(text.match(/^(?:open|launch|start)\s+(.+)/i)[1]);
        const projectName = Object.keys(settings.projects || {}).find((name) => lower.includes(name));
        if (projectName && /\b(project|workspace|folder)\b/i.test(text)) {
          const action = await this.tools.openPath(settings.projects[projectName]);
          result = this.#result(action.ok ? `Opening the ${projectName} workspace.` : `${action.message} Assign that folder in Settings.`, 'files', { success: action.ok });
        } else if (this.tools.resolveApplication(target)) {
          const action = await this.tools.openApplication(target);
          result = this.#result(action.message, 'windows', { success: action.ok });
        } else {
          const files = await this.tools.searchFiles(target);
          if (!files.length) {
            result = this.#result(`I couldn’t find a file matching “${target}.”`, 'files', { files: [], query: target });
          } else {
            const top = files[0];
            const second = files[1];
            const confident = files.length === 1 || top.score >= (second?.score || 0) + 3 || /\b(latest|newest|most recent)\b/i.test(target);
            if (confident) {
              const opened = await this.tools.openPath(top.path);
              result = this.#result(`Found it. Opening ${top.name}.`, 'files', { files, query: target, openedFile: top, success: opened.ok });
            } else {
              result = this.#result(`I found ${files.length} possible matches. Choose the one you want.`, 'files', { files, query: target, needsChoice: true });
            }
          }
        }
      }
    } else if (/^(?:close|quit|exit)\s+(.+)/i.test(text)) {
      if (stream.unattended) {
        result = this.#result(`Closing applications needs you at the desk, sir — I've left it for you.`, 'windows', { success: false });
      } else {
        const target = cleanTarget(text.match(/^(?:close|quit|exit)\s+(.+)/i)[1]);
        const action = await this.tools.closeApplication(target);
        result = this.#result(action.message, 'windows', { success: action.ok });
      }
    } else if (/\b(?:system status|status report|diagnostics)\b/i.test(text)) {
      result = this.#result('Local core, task manager, memory, file tools, and safety controls are responding.', 'local-core');
    } else if (isBattleRequest(text)) {
      // Words only — safe attended or unattended. The rules ride in the prompt.
      const { topic } = isBattleRequest(text);
      const bars = await this.ai.reply(buildBattlePrompt(topic), { onChunk: stream.onChunk, onReset: stream.onReset, unattended: stream.unattended === true });
      result = this.#result(bars.text, 'battle', { success: bars.ok !== false });
    } else {
      const memories = this.memory.search(text, 4);
      const aiResult = await this.ai.reply(text, { memories, project, onChunk: stream.onChunk, onReset: stream.onReset, onStep: stream.onStep, tasks: this.tasks.list({ status: 'open' }).slice(0, 10), unattended: stream.unattended === true });
      const extra = { detail: aiResult.detail, success: aiResult.ok };
      // When the brain used a tool that changed local state, hand the fresh
      // list back so the modules redraw instead of showing stale data.
      const usedTools = aiResult.usedTools || [];
      if (usedTools.includes('add_task')) extra.tasks = this.tasks.list({ status: 'open' });
      if (usedTools.includes('remember_note')) extra.memories = this.memory.list(30);
      result = this.#result(aiResult.text, aiResult.source, extra);
    }
    this.#log(text, result);
    return result;
  }

  async resolveApproval(id, approved) {
    const action = this.pending.get(id);
    this.pending.delete(id);
    if (!action) return this.#result('That approval request has expired.', 'safety', { success: false });
    if (!approved) return this.#result('Command cancelled. No changes were made.', 'safety', { success: true });
    if (action.type === 'power') {
      const executed = await this.tools.executePowerAction(action.action);
      return this.#result(executed.message, 'windows', { success: executed.ok });
    }
    if (action.type === 'drive-plan') {
      if (!this.hands) return this.#result('Screen driving is not set up on this PC.', 'screen', { success: false });
      // Fire and forget: the session narrates itself through screen:drive
      // events and speaks its own ending. The plan object is the frozen one.
      this.hands.run(action.plan);
      return this.#result('Starting. The STOP window is up — press it, hit Escape, or say stop at any time.', 'screen', { success: true });
    }
    if (action.type === 'drive-step') {
      // A mid-session "will ask again" card: hand the answer back to the
      // waiting session.
      try { action.resolve(Boolean(approved)); } catch { /* session may have timed out */ }
      return this.#result(approved ? 'Approved — carrying on.' : "Understood — I didn't do it, and I've stopped.", 'screen', { success: true });
    }
    // File work runs immediately now (see #runFileAction) and never queues a
    // pending approval, so there is intentionally no 'file' case here any
    // more — one used to call trashItem with no canRecycle check at all.
    return this.#result('That action is not available.', 'safety', { success: false });
  }

  #dashboardProject(text, settings) {
    const lower = text.toLowerCase();
    const names = Object.keys(settings.projects || {});
    return names.find((name) => lower.includes(name)) || null;
  }

  #matchRoutine(text, settings) {
    const routines = settings.routines || {};
    const lower = text.toLowerCase().trim();
    const candidates = [lower, lower.replace(/^(?:run|begin|start)\s+(?:my\s+)?/, ''), lower.replace(/\s+routine$/, '').replace(/^(?:run|begin|start)\s+(?:my\s+)?/, '')];
    for (const name of Object.keys(routines)) {
      if (candidates.includes(name.toLowerCase())) return { name, routine: routines[name] };
    }
    return null;
  }

  #result(response, source, extra = {}) {
    return { id: crypto.randomUUID(), response, source, timestamp: new Date().toISOString(), ...extra };
  }

  // Owner-issued file work runs immediately: the approved-folder boundary and
  // the no-overwrite guards are the safety, not the dialog. Unattended runs
  // (scheduled tasks) are still refused before anything touches disk.
  async #runFileAction(operation, source, extra, stream = {}) {
    if (stream.unattended) {
      return this.#result(`This file action needs you at the desk, sir — I've left it for you.`, 'safety', { success: false });
    }
    try {
      let outcome;
      if (operation === 'copy') outcome = await this.documents.copyItem(source, extra.destination);
      else if (operation === 'move') outcome = await this.documents.moveItem(source, extra.destination);
      else if (operation === 'rename') outcome = await this.documents.renameItem(source, extra.newName);
      else if (operation === 'organize') outcome = await this.documents.applyOrganization(extra.plan);
      else return this.#result('I do not know that file action.', 'documents', { success: false });
      return this.#result(outcome.message, 'documents', { success: Boolean(outcome && outcome.ok) });
    } catch (error) {
      return this.#result(error.message, 'documents', { success: false });
    }
  }

  #log(command, result) {
    this.log.write({ type: 'command', command, response: result.response, source: result.source, blocked: Boolean(result.blocked), approvalRequired: Boolean(result.approval) });
  }
}

module.exports = { CommandRouter, cleanTarget, parseDueDate, extractFileQuery };
