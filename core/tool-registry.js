/* Safe, documented tools the local model may call. Destructive or
   approval-gated actions (delete, move, power, organize) are deliberately
   absent: those run only through the deterministic router with approval
   cards, never on the model's own initiative. */

function buildToolRegistry({ tools, tasks, memory, config }) {
  const registry = [
    {
      name: 'add_task',
      description: 'Add a task or reminder to the local task list.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'What needs to be done' },
          repeat: { type: 'string', enum: ['daily', 'weekly', 'monthly'], description: 'Optional repeat cadence' }
        },
        required: ['title']
      },
      execute: async (args) => {
        const task = tasks.add({ title: String(args.title || '').slice(0, 200), repeat: args.repeat || null });
        return { ok: true, task: { title: task.title, repeat: task.repeat } };
      }
    },
    {
      name: 'list_open_tasks',
      description: 'List the currently open tasks.',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({
        ok: true,
        tasks: tasks.list({ status: 'open' }).slice(0, 10).map((task) => ({ title: task.title, project: task.project, dueAt: task.dueAt }))
      })
    },
    {
      name: 'remember_note',
      description: 'Save a short note to local memory.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: 'The note to remember' } },
        required: ['text']
      },
      execute: async (args) => ({ ok: true, saved: memory.add(String(args.text || '').slice(0, 500)).text })
    },
    {
      name: 'search_memory',
      description: 'Search saved local notes and memories.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query']
      },
      execute: async (args) => ({ ok: true, matches: memory.search(String(args.query || ''), 5).map((item) => item.text) })
    },
    {
      name: 'search_files',
      description: 'Search the approved folders for files by name or content keywords. Returns names and paths only.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query']
      },
      execute: async (args) => {
        const files = await tools.searchFiles(String(args.query || ''));
        return { ok: true, files: files.slice(0, 8).map((file) => ({ name: file.name, path: file.path })) };
      }
    },
    {
      name: 'open_application',
      description: 'Open one of the approved Windows applications (explorer, chrome, vs code, terminal, calculator, notepad, claude).',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Application name from the approved list' } },
        required: ['name']
      },
      execute: async (args) => tools.openApplication(String(args.name || ''))
    },
    {
      name: 'get_current_datetime',
      description: 'Get the current local date and time.',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ ok: true, now: new Date().toString() })
    }
  ];
  void config;
  return registry;
}

function toolSpecs(registry) {
  return registry.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters }
  }));
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

async function executeToolCall(registry, call) {
  const name = call?.function?.name;
  const tool = registry.find((item) => item.name === name);
  if (!tool) return { ok: false, error: `Unknown tool: ${name}` };
  let args = call.function?.arguments;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { args = {}; }
  }
  try {
    return await withTimeout(tool.execute(args || {}), tool.timeoutMs || 20000, `Tool ${name}`);
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = { buildToolRegistry, toolSpecs, executeToolCall, withTimeout };
