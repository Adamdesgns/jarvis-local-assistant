const crypto = require('node:crypto');
const { classifyCommand } = require('./security');

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
  constructor({ config, tools, documents, ai, memory, tasks, log, cameras }) {
    this.config = config;
    this.tools = tools;
    this.documents = documents;
    this.ai = ai;
    this.memory = memory;
    this.tasks = tasks;
    this.log = log;
    this.cameras = cameras || null;
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

  async handle(rawText, project = 'general', stream = {}) {
    const text = cleanTarget(rawText);
    if (!text) return this.#result('I didn’t catch a command.', 'local-core');
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
    } else if (/\b(?:system status|status report|diagnostics)\b/i.test(text)) {
      result = this.#result('Local core, task manager, memory, file tools, and safety controls are responding.', 'local-core');
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
