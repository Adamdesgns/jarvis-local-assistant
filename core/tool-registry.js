/* Safe, documented tools the local model may call. Destructive or
   approval-gated actions (delete, move, power, organize) are deliberately
   absent: those run only through the deterministic router with approval
   cards, never on the model's own initiative. */

function buildToolRegistry({ tools, tasks, memory, config, documents, getCameras, getAi }) {
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
      name: 'read_file',
      description: 'Read the text contents of a file inside the approved folders (use a path from search_files). Reads PDF, Word, Excel, CSV, text, and code.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Full path to the file, from search_files' } },
        required: ['path']
      },
      execute: async (args) => {
        if (!documents || typeof documents.readDocument !== 'function') return { ok: false, error: 'Reading files is unavailable.' };
        try {
          const doc = await documents.readDocument(String(args.path || ''), 8000);
          return { ok: true, name: doc.name, text: doc.text, truncated: doc.truncated };
        } catch (error) {
          return { ok: false, error: error.message };
        }
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
    },
    {
      name: 'look_at_camera',
      description: 'Take a fresh snapshot from a named security camera and describe what is visible in it.',
      parameters: {
        type: 'object',
        properties: { camera: { type: 'string', description: 'Camera name, e.g. "front door"' } },
        required: ['camera']
      },
      // Composes exactly what CommandRouter#cameraLook does: match by name
      // (case-insensitive), grab a fresh manual snapshot, then let the vision
      // model describe it. Every step degrades to a friendly { ok: false }.
      execute: async (args) => {
        const camerasService = typeof getCameras === 'function' ? getCameras() : null;
        if (!camerasService) return { ok: false, message: 'No cameras are configured.' };
        const wanted = String(args.camera || '').trim().toLowerCase();
        let list = [];
        try { list = (await camerasService.listCameras()) || []; } catch { list = []; }
        const camera = list.find((item) => item.name.toLowerCase() === wanted)
          || list.find((item) => item.name.toLowerCase().includes(wanted) || wanted.includes(item.name.toLowerCase()));
        if (!camera) return { ok: false, message: `No camera matching "${args.camera}" was found.` };
        const shot = await camerasService.getSnapshot(camera.key, { manual: true });
        if (!shot.ok) return { ok: false, message: `Could not get a picture from ${camera.name}.${shot.message ? ` ${shot.message}` : ''}` };
        const aiService = typeof getAi === 'function' ? getAi() : null;
        if (!aiService || typeof aiService.describeCameraFrame !== 'function') {
          return { ok: false, message: `Took a picture from ${camera.name}, but no vision model is set up to describe it.` };
        }
        const described = await aiService.describeCameraFrame(shot.jpegBase64, camera.name);
        if (!described.ok) {
          return { ok: false, message: `Took a picture from ${camera.name}, but could not describe it.` };
        }
        return { ok: true, camera: camera.name, description: described.text };
      }
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
