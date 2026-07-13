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

function pathLabel(target) {
  return String(target || '').split(/[\\/]/).filter(Boolean).pop() || 'FOLDER';
}

class CommandRouter {
  constructor({ config, tools, documents, ai, memory, tasks, log }) {
    this.config = config;
    this.tools = tools;
    this.documents = documents;
    this.ai = ai;
    this.memory = memory;
    this.tasks = tasks;
    this.log = log;
    this.pending = new Map();
  }

  async handle(rawText) {
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
      const id = crypto.randomUUID();
      this.pending.set(id, { type: 'power', action });
      return this.#result(`Confirm ${action}.`, 'safety', {
        approval: { id, title: `${action.toUpperCase()} COMPUTER`, detail: security.reason, risk: 'HIGH' }
      });
    }

    const lower = text.toLowerCase();
    const settings = this.config.getSettings();
    let result;

    if (/^(help|what can you do|show commands)$/i.test(text)) {
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
    } else if (/what do you remember about\s+(.+)/i.test(text)) {
      const query = text.match(/what do you remember about\s+(.+)/i)[1];
      const memories = this.memory.search(query);
      result = memories.length
        ? this.#result(memories.map((item) => item.text).join(' • '), 'memory', { memories })
        : this.#result(`I don’t have a saved memory matching “${query}” yet.`, 'memory');
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
          const summary = await this.ai.reply(`Summarize this document clearly. Start with what it is, then list the important points and any actions or deadlines.\n\nDOCUMENT: ${document.name}\n\n${document.text}`);
          result = this.#result(summary.text, summary.source, { document: matches[0], success: summary.ok, detail: document.truncated ? 'The document was long, so JARVIS summarized the first section.' : '' });
        } catch (error) {
          result = this.#result(`I found the document but couldn't read it. ${error.message}`, 'documents', { success: false });
        }
      }
    } else if (this.documents && /^create\s+(?:a\s+)?folder(?:\s+(?:called|named))?\s+(.+?)\s+in\s+(.+)$/i.test(text)) {
      const [, name, location] = text.match(/^create\s+(?:a\s+)?folder(?:\s+(?:called|named))?\s+(.+?)\s+in\s+(.+)$/i);
      try {
        const created = await this.documents.createFolder(location, name);
        result = this.#result(created.message, 'documents', { createdPath: created.path, success: true });
      } catch (error) {
        result = this.#result(error.message, 'documents', { success: false });
      }
    } else if (this.documents && /^create\s+(?:a\s+)?(?:note|text file)(?:\s+(?:called|named))?\s+(.+?)\s+(?:that says|saying|with)\s+(.+)$/i.test(text)) {
      const [, name, content] = text.match(/^create\s+(?:a\s+)?(?:note|text file)(?:\s+(?:called|named))?\s+(.+?)\s+(?:that says|saying|with)\s+(.+)$/i);
      try {
        const created = await this.documents.createTextFile('documents', name, content, '.txt');
        result = this.#result(created.message, 'documents', { createdPath: created.path, success: true });
      } catch (error) {
        result = this.#result(error.message, 'documents', { success: false });
      }
    } else if (this.documents && /^create\s+(?:a\s+)?report(?:\s+(?:called|named))?\s+(.+?)\s+(?:about|on)\s+(.+)$/i.test(text)) {
      const [, name, topic] = text.match(/^create\s+(?:a\s+)?report(?:\s+(?:called|named))?\s+(.+?)\s+(?:about|on)\s+(.+)$/i);
      const draft = await this.ai.reply(`Write a concise, useful Markdown report about: ${topic}. Use a title, short summary, key points, and next actions.`);
      if (!draft.ok) result = this.#result(draft.text, draft.source, { success: false });
      else {
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
      else result = this.#fileApproval(operation.toLowerCase(), source.path, { destination }, `${operation.toUpperCase()} ${source.name}`, `${operation} ${source.path} to ${destination}`);
    } else if (this.documents && /^rename\s+(.+?)\s+to\s+(.+)$/i.test(text)) {
      const [, query, newName] = text.match(/^rename\s+(.+?)\s+to\s+(.+)$/i);
      const source = (await this.tools.searchFiles(query))[0];
      result = source
        ? this.#fileApproval('rename', source.path, { newName }, `RENAME ${source.name}`, `Rename ${source.path} to ${newName}`)
        : this.#result(`I couldn't find “${query}.”`, 'documents', { success: false });
    } else if (this.documents && /^(?:delete|trash|remove)\s+(.+)$/i.test(text)) {
      const query = text.match(/^(?:delete|trash|remove)\s+(.+)$/i)[1];
      const source = (await this.tools.searchFiles(query))[0];
      result = source
        ? this.#fileApproval('trash', source.path, {}, `MOVE ${source.name} TO RECYCLE BIN`, `This can be restored later from the Windows Recycle Bin.\n${source.path}`)
        : this.#result(`I couldn't find “${query}.”`, 'documents', { success: false });
    } else if (this.documents && /^organize\s+(?:my\s+)?(.+?)(?:\s+folder)?$/i.test(text)) {
      const location = text.match(/^organize\s+(?:my\s+)?(.+?)(?:\s+folder)?$/i)[1];
      try {
        const plan = await this.documents.planOrganization(location);
        if (!plan.moves.length) result = this.#result(`The ${location} folder is already organized or contains no loose files.`, 'documents');
        else {
          const groups = [...new Set(plan.moves.map((item) => item.category))].join(', ');
          result = this.#fileApproval('organize', plan.directory, { plan }, `ORGANIZE ${pathLabel(plan.directory)}`, `Move ${plan.moves.length} loose files into: ${groups}. Nothing will be deleted.`);
        }
      } catch (error) {
        result = this.#result(error.message, 'documents', { success: false });
      }
    } else if (/\b(?:activate|start|enter|turn on)\s+focus mode\b/i.test(text)) {
      const action = await this.tools.openFocusMode();
      result = this.#result(action.message, 'windows', { success: action.ok });
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
          const opened = await this.tools.openPath(top.path);
          result = this.#result(`Found it. Opening ${top.name}.`, 'files', { files, query, openedFile: top, success: opened.ok });
        } else {
          result = this.#result(`I found ${files.length} possible matches. Choose the one you want.`, 'files', { files, query, needsChoice: true });
        }
      }
    } else if (/^(?:open|show)\s+(?:jarvis\s+)?settings$/i.test(text)) {
      result = this.#result('Opening local settings.', 'local-core', { openSettings: true });
    } else if (/^(?:open|launch|start)\s+(.+)/i.test(text)) {
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
    } else if (/\b(?:system status|status report|diagnostics)\b/i.test(text)) {
      result = this.#result('Local core, task manager, memory, file tools, and safety controls are responding.', 'local-core');
    } else {
      const memories = this.memory.search(text, 4);
      const aiResult = await this.ai.reply(text, { memories, tasks: this.tasks.list({ status: 'open' }).slice(0, 10) });
      result = this.#result(aiResult.text, aiResult.source, { detail: aiResult.detail, success: aiResult.ok });
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
    if (action.type === 'file' && this.documents) {
      try {
        let executed;
        if (action.operation === 'copy') executed = await this.documents.copyItem(action.source, action.destination);
        if (action.operation === 'move') executed = await this.documents.moveItem(action.source, action.destination);
        if (action.operation === 'rename') executed = await this.documents.renameItem(action.source, action.newName);
        if (action.operation === 'trash') executed = await this.documents.trashItem(action.source);
        if (action.operation === 'organize') executed = await this.documents.applyOrganization(action.plan);
        return this.#result(executed?.message || 'File action completed.', 'documents', { success: Boolean(executed?.ok) });
      } catch (error) {
        return this.#result(`The file action did not complete. ${error.message}`, 'documents', { success: false });
      }
    }
    return this.#result('That action is not available.', 'safety', { success: false });
  }

  #result(response, source, extra = {}) {
    return { id: crypto.randomUUID(), response, source, timestamp: new Date().toISOString(), ...extra };
  }

  #fileApproval(operation, source, extra, title, detail) {
    const id = crypto.randomUUID();
    this.pending.set(id, { type: 'file', operation, source, ...extra });
    return this.#result('Review the file action before I continue.', 'safety', {
      approval: { id, title, detail, risk: operation === 'trash' ? 'HIGH' : 'REVIEW' }
    });
  }

  #log(command, result) {
    this.log.write({ type: 'command', command, response: result.response, source: result.source, blocked: Boolean(result.blocked), approvalRequired: Boolean(result.approval) });
  }
}

module.exports = { CommandRouter, cleanTarget, parseDueDate, extractFileQuery };
