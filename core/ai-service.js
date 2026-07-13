class AIService {
  constructor(config) {
    this.config = config;
  }

  prompt(settings, context = {}) {
    const memories = (context.memories || []).map((item) => `- ${item.text}`).join('\n') || '- None';
    const tasks = (context.tasks || []).map((item) => `- ${item.title} [${item.project}]`).join('\n') || '- None';
    return [
      `You are ${settings.assistantName || 'JARVIS'}, ${settings.profileName || 'the user'}'s desktop assistant.`,
      settings.personality,
      'Keep spoken answers concise. Help with organization, files, tasks, reminders, and desktop assistance.',
      'Never claim that a computer action happened unless a local tool result confirms it.',
      `Relevant memory:\n${memories}`,
      `Open tasks:\n${tasks}`
    ].join('\n');
  }

  async cloudReply(text, context = {}) {
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
          instructions: this.prompt(settings, context),
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
      return { ok: true, source: 'openai', text: String(output).trim() };
    } finally {
      clearTimeout(timeout);
    }
  }

  async localReply(text, context = {}) {
    const settings = this.config.getSettings();
    const baseUrl = 'http://127.0.0.1:11434';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
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
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: String(selected.name || selected.model), stream: false,
          messages: [
            { role: 'system', content: this.prompt(settings, context) },
            { role: 'user', content: text }
          ],
          options: { temperature: 0.35, num_ctx: 4096 }
        }),
        signal: controller.signal
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || `Local model returned ${response.status}.`);
      const output = payload?.message?.content?.trim();
      if (!output) throw new Error('The local model returned no text.');
      return { ok: true, source: 'ollama', text: output };
    } finally {
      clearTimeout(timeout);
    }
  }

  async testCloud() {
    try {
      const result = await this.cloudReply('Reply with exactly: Cloud Brain connected.');
      return { ok: true, message: result.text, model: this.config.getSettings().openaiModel };
    } catch (error) {
      return { ok: false, message: error.name === 'AbortError' ? 'OpenAI connection timed out.' : error.message };
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
    if (mode === 'auto' && this.config.getSecret('openaiKey')) {
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
      return { ok: false, source: 'local-core', text: `I could not reach the local Ollama model. ${error.name === 'AbortError' ? 'The request timed out.' : error.message}`, detail: error.message };
    }
  }
}

module.exports = { AIService };
