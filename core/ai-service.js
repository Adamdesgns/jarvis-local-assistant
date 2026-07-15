const { toolSpecs, executeToolCall } = require('./tool-registry');

// Folds one parsed NDJSON chunk from Ollama's streaming chat API into an
// accumulator of { content, toolCalls }. Exported for tests.
function accumulateStreamChunk(state, chunk) {
  const message = chunk?.message || {};
  if (typeof message.content === 'string' && message.content) state.content += message.content;
  if (Array.isArray(message.tool_calls)) state.toolCalls.push(...message.tool_calls);
  return state;
}

class AIService {
  constructor(config, registry = null) {
    this.config = config;
    this.registry = registry;
    // Rolling conversation history per project so follow-up questions work.
    this.sessions = new Map();
  }

  #history(project) {
    const key = String(project || 'general').toLowerCase();
    if (!this.sessions.has(key)) this.sessions.set(key, []);
    return this.sessions.get(key);
  }

  #remember(project, userText, assistantText) {
    const history = this.#history(project);
    history.push({ role: 'user', content: userText }, { role: 'assistant', content: assistantText });
    while (history.length > 12) history.shift();
  }

  resetSession(project) {
    this.sessions.delete(String(project || 'general').toLowerCase());
  }

  cancel() {
    this.cancelledByUser = true;
    try { this.activeController?.abort(); } catch {}
    this.activeController = null;
  }

  prompt(settings, context = {}) {
    const memories = (context.memories || []).map((item) => `- ${item.text}`).join('\n') || '- None';
    const tasks = (context.tasks || []).map((item) => `- ${item.title} [${item.project}]`).join('\n') || '- None';
    return [
      `You are ${settings.assistantName || 'JARVIS'}, ${settings.profileName || 'the user'}'s private desktop assistant, running locally on his PC.`,
      settings.personality,
      context.project && context.project !== 'general' ? `He is currently working on the ${context.project} project.` : '',
      'How to think and answer:',
      '- Lead with the answer or outcome in your first sentence. Supporting detail comes after, and only if it changes what he would do next.',
      '- Short, plain, complete sentences that can be understood while working with your hands. No filler, no theatrics, no jargon left unexplained.',
      '- Be honest. If you are unsure or a tool did not confirm something, say so plainly. Never invent file names, numbers, or results.',
      '- Never claim a computer action happened unless a tool result in this conversation confirms it. Report failures as failures, not maybes.',
      '- Prefer checking over guessing: use your tools to look at the real task list, notes, or files before describing them.',
      '- Do what the request implies without asking permission for reversible steps. Ask a question only when genuinely blocked on a choice only he can make.',
      '- Deleting, sending, buying, and power controls are deliberately outside your tools. If asked, say the direct command (like "delete <file>") so JARVIS can show its approval card.',
      '- Match effort to the question: simple question, one-sentence answer.',
      '- Casual greetings and "how are you" are small talk: answer naturally in one short sentence, and do not ask what needs doing unless he asks for help.',
      `Saved notes that may be relevant:\n${memories}`,
      `Open tasks:\n${tasks}`
    ].filter(Boolean).join('\n');
  }

  // Which cloud provider should answer: the user's preference when its key is
  // saved, otherwise whichever key exists. Null means no cloud is configured.
  cloudProvider() {
    const preferred = this.config.getSettings().cloudProvider || 'anthropic';
    const hasAnthropic = Boolean(this.config.getSecret('anthropicKey'));
    const hasOpenAI = Boolean(this.config.getSecret('openaiKey'));
    if (preferred === 'anthropic' && hasAnthropic) return 'anthropic';
    if (preferred === 'openai' && hasOpenAI) return 'openai';
    if (hasAnthropic) return 'anthropic';
    if (hasOpenAI) return 'openai';
    return null;
  }

  hasCloudKey() {
    return this.cloudProvider() !== null;
  }

  async cloudReply(text, context = {}) {
    const provider = this.cloudProvider();
    if (provider === 'anthropic') return this.anthropicReply(text, context);
    if (provider === 'openai') return this.openaiReply(text, context);
    throw new Error('No Cloud Brain key is saved. Add a Claude or OpenAI key in Settings.');
  }

  async openaiReply(text, context = {}) {
    const settings = this.config.getSettings();
    const apiKey = this.config.getSecret('openaiKey');
    if (!apiKey) throw new Error('OpenAI Cloud Brain needs an API key in Settings.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: settings.openaiModel || 'gpt-5-mini',
          instructions: context.systemOverride || this.prompt(settings, context),
          input: text,
          max_output_tokens: 600,
          store: false
        }),
        signal: controller.signal
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || `OpenAI returned ${response.status}.`);
      const output = payload.output_text || (payload.output || [])
        .flatMap((item) => item.content || [])
        .find((item) => item.type === 'output_text')?.text;
      if (!String(output || '').trim()) throw new Error('OpenAI returned no text.');
      this.#remember(context.project, text, String(output).trim());
      return { ok: true, source: 'openai', text: String(output).trim() };
    } finally {
      clearTimeout(timeout);
    }
  }

  async anthropicReply(text, context = {}) {
    const settings = this.config.getSettings();
    const apiKey = this.config.getSecret('anthropicKey');
    if (!apiKey) throw new Error('Claude Cloud Brain needs an API key in Settings.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: settings.anthropicModel || 'claude-sonnet-5',
          max_tokens: 800,
          system: context.systemOverride || this.prompt(settings, context),
          messages: context.systemOverride
            ? [{ role: 'user', content: text }]
            : [...this.#history(context.project), { role: 'user', content: text }]
        }),
        signal: controller.signal
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || `Claude returned ${response.status}.`);
      const output = (payload.content || [])
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('')
        .trim();
      if (!output) throw new Error('Claude returned no text.');
      this.#remember(context.project, text, output);
      return { ok: true, source: 'anthropic', text: output };
    } finally {
      clearTimeout(timeout);
    }
  }

  async localReply(text, context = {}) {
    const settings = this.config.getSettings();
    const baseUrl = 'http://127.0.0.1:11434';
    const controller = new AbortController();
    this.activeController = controller;
    this.cancelledByUser = false;
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const tagsResponse = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
      if (!tagsResponse.ok) throw new Error(`Ollama connection returned ${tagsResponse.status}.`);
      const tags = await tagsResponse.json();
      const installed = tags.models || [];
      const requested = settings.ollamaModel || 'qwen3:8b';
      const selected = installed.find((item) => String(item.name || item.model) === requested)
        || installed.find((item) => !/embed/i.test(String(item.name || item.model || '')))
        || installed[0];
      if (!selected) throw new Error('Ollama is running, but it has no model installed.');
      const model = String(selected.name || selected.model);
      const grounded = Boolean(context.systemOverride);
      const messages = [
        { role: 'system', content: context.systemOverride || this.prompt(settings, context) },
        ...(grounded ? [] : this.#history(context.project)),
        { role: 'user', content: text }
      ];
      const onChunk = typeof context.onChunk === 'function' ? context.onChunk : null;
      const chat = async (withTools) => {
        const response = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model, stream: true, messages,
            ...(withTools && this.registry ? { tools: toolSpecs(this.registry) } : {}),
            options: { temperature: 0.35, num_ctx: 4096 }
          }),
          signal: controller.signal
        });
        if (!response.ok) {
          let detail = '';
          try { detail = (await response.json())?.error; } catch {}
          throw new Error(detail || `Local model returned ${response.status}.`);
        }
        const state = { content: '', toolCalls: [] };
        let buffered = '';
        let insideThink = false;
        const handleLine = (line) => {
          if (!line) return;
          let parsed;
          try { parsed = JSON.parse(line); } catch { return; }
          const before = state.content.length;
          accumulateStreamChunk(state, parsed);
          if (onChunk && state.content.length > before) {
            // Do not stream the model's <think> scratchpad to the screen.
            const addition = state.content.slice(before);
            if (addition.includes('<think>')) insideThink = true;
            if (!insideThink) onChunk(addition);
            if (addition.includes('</think>')) insideThink = false;
          }
        };
        for await (const piece of response.body) {
          buffered += Buffer.from(piece).toString('utf8');
          let index;
          while ((index = buffered.indexOf('\n')) >= 0) {
            handleLine(buffered.slice(0, index).trim());
            buffered = buffered.slice(index + 1);
          }
        }
        // A final chunk without a trailing newline must still count.
        handleLine(buffered.trim());
        return { content: state.content, tool_calls: state.toolCalls };
      };

      // Grounded document answers run once with no tools and no history write.
      let message = await chat(!grounded);
      let usedTools = [];
      for (let round = 0; !grounded && round < 2 && Array.isArray(message.tool_calls) && message.tool_calls.length; round += 1) {
        messages.push({ role: 'assistant', content: message.content || '', tool_calls: message.tool_calls });
        for (const call of message.tool_calls.slice(0, 3)) {
          const outcome = await executeToolCall(this.registry, call);
          usedTools.push(call.function?.name);
          messages.push({ role: 'tool', content: JSON.stringify(outcome) });
        }
        // Partial text from the tool-deciding round is superseded.
        context.onReset?.();
        message = await chat(round === 0);
      }
      const output = String(message.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (!output) throw new Error('The local model returned no text.');
      if (!grounded) this.#remember(context.project, text, output);
      return { ok: true, source: 'ollama', text: output, usedTools };
    } finally {
      clearTimeout(timeout);
    }
  }

  async testCloud(provider) {
    const settings = this.config.getSettings();
    const which = provider || this.cloudProvider();
    try {
      const result = which === 'openai'
        ? await this.openaiReply('Reply with exactly: Cloud Brain connected.')
        : await this.anthropicReply('Reply with exactly: Cloud Brain connected.');
      const model = which === 'openai' ? settings.openaiModel : settings.anthropicModel;
      return { ok: true, message: result.text, model, provider: which };
    } catch (error) {
      return { ok: false, message: error.name === 'AbortError' ? 'The Cloud Brain connection timed out.' : error.message, provider: which };
    }
  }

  // Answer a question using only the supplied document passages, and require
  // the model to cite them by [number]. Sources are labeled with filename and
  // page/section so citations point back to a real spot in a real file.
  async answerFromDocuments(question, passages, context = {}) {
    const settings = this.config.getSettings();
    const cite = (p, i) => `[${i + 1}] ${p.name}${p.page ? `, page ${p.page}` : p.section ? `, section ${p.section}` : ''}`;
    const sourcesBlock = passages.map((p, i) => `${cite(p, i)}\n${p.text}`).join('\n\n');
    const systemOverride = [
      `You are ${settings.assistantName || 'JARVIS'}, answering a question strictly from the document passages below.`,
      'Rules:',
      '- Use only the passages. If they do not contain the answer, say so plainly — do not use outside knowledge.',
      '- Cite every claim with its source number in square brackets, like [1] or [2].',
      '- Keep the answer short and spoken-plain. Lead with the answer.',
      '',
      `PASSAGES:\n${sourcesBlock}`
    ].join('\n');
    const groundedContext = { ...context, systemOverride, onChunk: context.onChunk, onReset: context.onReset };
    const mode = settings.aiMode || 'local';
    let result;
    if (mode !== 'local' && this.hasCloudKey()) {
      try { result = await this.cloudReply(question, groundedContext); }
      catch (cloudError) {
        try { result = await this.localReply(question, groundedContext); }
        catch (localError) { return { ok: false, source: 'local-core', text: `Could not answer from your documents. ${cloudError.message} / ${localError.message}` }; }
      }
    } else {
      try { result = await this.localReply(question, groundedContext); }
      catch (error) { return { ok: false, source: 'local-core', text: `Could not answer from your documents. ${error.message}` }; }
    }
    return { ...result, sources: passages.map((p, i) => ({ n: i + 1, name: p.name, path: p.path, page: p.page, section: p.section })) };
  }

  // Describe a screenshot with a vision-capable cloud model. base64 is raw PNG.
  async describeImage(base64, question, context = {}) {
    const provider = this.cloudProvider();
    const settings = this.config.getSettings();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    const instruction = `${this.prompt(settings, context)}\n\nYou are looking at a screenshot of the user's screen. ${question}`;
    try {
      if (provider === 'anthropic') {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': this.config.getSecret('anthropicKey'), 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: settings.anthropicModel || 'claude-sonnet-5',
            max_tokens: 700,
            messages: [{ role: 'user', content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
              { type: 'text', text: instruction }
            ] }]
          }),
          signal: controller.signal
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error?.message || `Claude returned ${response.status}.`);
        const text = (payload.content || []).filter((i) => i.type === 'text').map((i) => i.text).join('').trim();
        if (!text) throw new Error('Claude returned no description.');
        return { ok: true, source: 'anthropic', text };
      }
      if (provider === 'openai') {
        const response = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.getSecret('openaiKey')}` },
          body: JSON.stringify({
            model: settings.openaiModel || 'gpt-5-mini',
            input: [{ role: 'user', content: [
              { type: 'input_text', text: instruction },
              { type: 'input_image', image_url: `data:image/png;base64,${base64}` }
            ] }],
            max_output_tokens: 700,
            store: false
          }),
          signal: controller.signal
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error?.message || `OpenAI returned ${response.status}.`);
        const text = payload.output_text || (payload.output || []).flatMap((i) => i.content || []).find((i) => i.type === 'output_text')?.text;
        if (!String(text || '').trim()) throw new Error('OpenAI returned no description.');
        return { ok: true, source: 'openai', text: String(text).trim() };
      }
      throw new Error('No Cloud Brain key is saved for vision.');
    } finally {
      clearTimeout(timeout);
    }
  }

  async reply(text, context = {}) {
    const settings = this.config.getSettings();
    const mode = settings.aiMode || 'local';
    if (mode === 'cloud') {
      try { return await this.cloudReply(text, context); }
      catch (error) {
        return { ok: false, source: 'cloud-core', text: `Cloud Brain could not respond. ${error.message}`, detail: error.message };
      }
    }
    if (mode === 'auto' && this.hasCloudKey()) {
      try { return await this.cloudReply(text, context); }
      catch (cloudError) {
        try {
          const local = await this.localReply(text, context);
          return { ...local, detail: `Cloud unavailable; used Ollama. ${cloudError.message}` };
        } catch (localError) {
          return { ok: false, source: 'local-core', text: 'Neither Cloud Brain nor Ollama could respond.', detail: `${cloudError.message} / ${localError.message}` };
        }
      }
    }
    try { return await this.localReply(text, context); }
    catch (error) {
      if (this.cancelledByUser) return { ok: true, source: 'local-core', text: 'Stopped.', cancelled: true };
      return { ok: false, source: 'local-core', text: `I could not reach the local Ollama model. ${error.name === 'AbortError' ? 'The request timed out.' : error.message}`, detail: error.message };
    }
  }
}

module.exports = { AIService, accumulateStreamChunk };
