'use strict';

// JARVIS Jr. — the kids-edition policy. Pure rules in the license-gate mold:
// everything the kids build takes away, everything it answers differently,
// and the whole kids brain-prompt live here in code; main.js consults this
// at the seams and the renderer only ever mirrors it.
//
// Three layers, all narrowing-only:
//   1. Feature clamps — grown-up subsystems (cameras, defense mode, night
//      shift, autonomy, phone companion, Claude bridge, heartbeat) read as
//      OFF whatever settings.json says, and their IPC channels answer with
//      a refusal. Screen reading/driving is deliberately NOT clamped — Adam
//      wants JARVIS Jr. able to help a stuck kid at the computer — but its
//      switches are parent-only keys, so only a PIN-holder can enable it.
//   2. The command gate — distress support first, then bedtime/screen-time
//      (core/parental-controls.js decides the times), then the content
//      filter with kind, kid-voiced redirects. Deterministic answers that
//      never reach the model.
//   3. The kids prompt — a full replacement for the adult system prompt:
//      simple warm language, hard safety rules, and the gaming-coach brain
//      (Minecraft and Roblox build plans included). It ignores
//      settings.personality on purpose, so no persisted text can restyle
//      the kid frame.

// ── layer 1: feature clamps ─────────────────────────────────────────────

// Flags forced false in the kids edition. Parent PIN or not — these
// subsystems simply do not run in JARVIS Jr.; a family that wants cameras
// runs grown-up JARVIS beside it.
const KIDS_BLOCKED_FLAGS = Object.freeze([
  'mobileEnabled',
  'schedulesEnabled',
  'autonomyEnabled',
  'nightShiftEnabled',
  'heartbeatEnabled',
  'claudeBridgeEnabled',
  'cameraAiDescriptions',
  'cameraCloudVision'
]);

// Command-center modules that never appear in the kids build, over and
// above whatever the user hid. Terminal and browser are grown-up surfaces;
// cameras/night-shift belong to clamped subsystems.
const KIDS_FORCED_HIDDEN_MODULES = Object.freeze(['cameras', 'night-shift', 'terminal', 'browser']);

// IPC channels answered with a refusal in the kids build (main.js wraps
// handler registration through isKidsBlockedChannel). Prefixes, not a
// channel list, so a channel added to a clamped subsystem later is blocked
// by default instead of quietly reachable.
const KIDS_BLOCKED_CHANNEL_PREFIXES = Object.freeze([
  'cameras:', 'defense:', 'mobile:', 'schedule:', 'nightshift:'
]);

function isKidsBlockedChannel(channel) {
  const name = String(channel || '');
  return KIDS_BLOCKED_CHANNEL_PREFIXES.some((prefix) => name.startsWith(prefix));
}

// One refusal shape for every blocked channel. Carries the falsy fields the
// various renderers actually read (ok / running / enabled) so a surviving
// call site degrades to "feature off" instead of crashing on undefined.
const KIDS_CHANNEL_REFUSAL = Object.freeze({
  ok: false,
  running: false,
  enabled: false,
  kidsBlocked: true,
  message: "That's a grown-up JARVIS feature — JARVIS Jr. keeps it switched off."
});

// The read-only settings view for kids services. Never persisted (main.js
// also persists the flags false once at startup so raw-config services
// agree, but this view is what gated services consult live). aiMode is
// clamped to local unless the parent explicitly allowed the cloud —
// a child's questions do not leave the machine on any default path.
function applyKidsSettings(settings) {
  const view = { ...settings };
  for (const key of KIDS_BLOCKED_FLAGS) view[key] = false;
  view.hiddenModules = [...new Set([...(settings.hiddenModules || []), ...KIDS_FORCED_HIDDEN_MODULES])];
  if (settings?.parental?.cloudAllowed !== true) view.aiMode = 'local';
  view.autonomyRules = { speakDoorbell: false, nightMotionOnly: false, someoneHereCard: false, speakMotion: false };
  view.defense = { ...(settings.defense || {}), autoWeather: false, autoCamera: false };
  return view;
}

// ── settings writes: what a kid may change without the PIN ──────────────

// Allowlist, not denylist — a NEW settings key added later is parent-only in
// the kids build until someone decides it is kid-safe. Kids keep the fun:
// naming the assistant, voices, skins, orb colors, layout. Everything that
// changes what the assistant can DO (folders, apps, brains, screen control,
// routines) needs the parent PIN.
const KID_SAFE_SETTINGS_KEYS = Object.freeze([
  'assistantName', 'assistantNamedAt',
  'voiceEnabled', 'wakeWordEnabled', 'wakeSensitivity', 'voiceName',
  'ttsEngine', 'kokoroVoice',
  'skin', 'orbSkin', 'orbColor', 'windowGlass', 'motionMode',
  'minimizeToOrb', 'orbAlwaysOnTop', 'orbBounds', 'moduleLayout', 'hiddenModules',
  'recentFiles', 'pinnedFolders'
]);

// Gate a settings patch in the kids edition. Unlocked parents pass except
// for the hard clamps: a blocked flag flipping true is stripped even for a
// PIN-holder, because those subsystems don't exist in this build and a
// persisted true would only lie in wait for a copied settings.json.
function gateKidsSettingsPatch(patch, unlocked) {
  const gated = {};
  const refused = [];
  for (const [key, value] of Object.entries(patch || {})) {
    if (KIDS_BLOCKED_FLAGS.includes(key) && value === true) { refused.push(key); continue; }
    if (!unlocked && !KID_SAFE_SETTINGS_KEYS.includes(key)) { refused.push(key); continue; }
    gated[key] = value;
  }
  return { patch: gated, refused };
}

// ── layer 2: the command gate ───────────────────────────────────────────

// Words that mean the kid is talking about a GAME. Inside a game, defeating
// the Ender Dragon and crafting TNT are homework, not violence — the
// violence categories stand down when one of these is present (unless the
// kid says it's about real life).
// Deliberately NOT in this list: generic words like "build", "world" and
// "server" — "how do I build a bomb" must never read as game talk. A kid
// genuinely asking about a game names the game or its creatures.
const GAME_CONTEXT = /\b(minecraft|roblox|fortnite|terraria|pokemon|mario|zelda|game|games|gaming|level|boss|mob|mobs|creeper|enderman|ender dragon|nether|end portal|redstone|obby|obbies|noob|speedrun|dungeon|raid|quest|villager|zombie|skeleton|warden|wither|herobrine|bedwars|skywars|brookhaven|adopt me|blox fruits|piggy|tower of hell|tnt|pvp|hp|xp|spawn|respawn|griefer|griefing)\b/i;

const REAL_WORLD = /\b(real life|in real life|irl|for real|not (?:in )?a game|actual|actually)\b/i;

function gameSafe(text) {
  return GAME_CONTEXT.test(text) && !REAL_WORLD.test(text);
}

// The categories, in the order they are checked. Distress is FIRST and is
// never a block — a kid reaching out gets a warm answer and a real number,
// at any hour, even past bedtime (the router checks this category before
// the playtime gate for exactly that reason).
const SCREEN_RULES = [
  {
    category: 'distress',
    blocked: false,
    test: (text) => /\b(kill(?:ing)? myself|hurt(?:ing)? myself|want to die|wanna die|suicide|self[- ]?harm|cut(?:ting)? myself|hate my life|nobody likes me|no one likes me|everyone hates me|so sad all the time)\b/i.test(text),
    reply: "I'm really glad you told me that. What you're feeling matters, and it's bigger than a computer can help with — please tell a grown-up you trust how you feel, like a parent or a teacher. If you ever feel like hurting yourself, you (or a grown-up) can call or text 988 any time, day or night. I'm always happy to talk with you too."
  },
  {
    category: 'bypass',
    blocked: true,
    test: (text) => /\b(?:turn off|disable|bypass|hack|unlock|get (?:around|past)|skip)\b[\s\S]*\b(?:parental|parent|screen ?time|time limit|bedtime|filter|pin code|the pin)\b/i.test(text),
    reply: "Those settings belong to your grown-up, so I can't change them — not even a little. If you think the time limit should be different, the best move is to ask them. Want help thinking of a good argument? I'm surprisingly good at those."
  },
  {
    category: 'weapons',
    blocked: true,
    test: (text) => !gameSafe(text)
      && (/\b(?:make|build|get|buy|find|create|mix)\b[\s\S]*\b(?:bomb|explosive|dynamite|tnt|gun|firearm|weapon|poison|gunpowder)\b/i.test(text)
        || /\bhow (?:do|can|would|to)\b[\s\S]*\b(?:bomb|explosive|dynamite|gun|firearm|poison)\b/i.test(text)),
    reply: "That's not something I can help with — real weapons and dangerous stuff are firmly off my list. If this is about a game, tell me which game and I'm all in."
  },
  {
    category: 'violence',
    blocked: true,
    test: (text) => !gameSafe(text)
      && /\b(?:kill|hurt|beat up|punch|stab|shoot|fight)\b[\s\S]*\b(?:someone|somebody|people|a kid|my (?:brother|sister|friend|mom|dad|mum|teacher|classmate)|him|her|them)\b/i.test(text),
    reply: "Hurting people isn't something I'll ever help with. If someone is making you angry or someone is hurting you, that's worth telling a grown-up you trust — they can actually fix it. If this is about a game boss, name the game and let's beat it properly."
  },
  {
    category: 'adult',
    blocked: true,
    test: (text) => /\b(sex|sexy|porn|naked|nude|boobs|penis|vagina)\b/i.test(text),
    reply: "That's a grown-up topic, so I'm going to leave it to the grown-ups. Now — what are we playing or building today?"
  },
  {
    category: 'substances',
    blocked: true,
    test: (text) => /\b(beer|vodka|whiskey|alcohol|get drunk|cigarettes?|vap(?:e|es|ing)|nicotine|weed|marijuana|cocaine|meth|pills to get high|drugs?)\b/i.test(text),
    reply: "That one's a grown-up topic and not mine to answer. If you're curious about it, a parent or teacher is the right person to ask. Meanwhile, I know an unreasonable amount about Minecraft potions if that helps."
  },
  {
    category: 'scam',
    blocked: false,
    test: (text) => /\bfree\s+(?:robux|v-?bucks|minecoins|skins?|gift ?cards?)\b/i.test(text),
    reply: "Careful — 'free Robux' and 'free V-Bucks' offers are almost always tricks to steal accounts or passwords. Real currency only ever comes from the official store, with a grown-up. Never type your password anywhere a video or website tells you to. Want tips on earning stuff inside the game instead? That I can do."
  },
  {
    category: 'purchases',
    blocked: false,
    test: (text) => /\b(?:buy|purchase|get)\b[\s\S]*\b(?:robux|v-?bucks|minecoins|game ?pass|skin|dlc|battle ?pass)\b/i.test(text)
      || /\b(?:credit card|debit card|gift card number)\b/i.test(text),
    reply: "Buying things — even game stuff — always goes through a grown-up. Ask them to sit with you and use the official store, and never type card numbers yourself. If you want, I can help you make the case for why this one's worth it."
  },
  {
    category: 'stranger-safety',
    blocked: false,
    test: (text) => /\bsome(?:one|body)\b[\s\S]*\b(?:online|in (?:the )?(?:game|chat))\b[\s\S]*\b(?:asked|asking|wants?|said|told)\b/i.test(text)
      || /\b(?:should|can) i (?:tell|give|send|share)\b[\s\S]*\b(?:address|password|phone|full name|school|photo|picture|my age|where i live)\b/i.test(text)
      || /\bmeet\b[\s\S]*\b(?:online friend|someone from (?:the )?(?:game|internet|online))\b/i.test(text),
    reply: "Good instinct to check. The rule is simple: never share your real name, address, school, phone number, photos, or passwords with anyone online — even someone who seems friendly or says they're a kid too. And meeting an online friend in real life is a grown-ups-decide thing. If someone keeps asking, stop replying and show a grown-up. You did the right thing asking me."
  },
  {
    category: 'language',
    blocked: false,
    test: (text) => /\b(fuck|fucking|shit|bitch|asshole|bastard|dickhead)\b/i.test(text),
    reply: "Whoa — let's keep it friendly in here. Say it again without the spicy words and I'm on it."
  }
];

// Screen one command. Null means "nothing to intercept — let it through to
// the normal router and brain". Exported alone for tests; the router calls
// gateKidsCommand below, which also folds in bedtime and the time budget.
function screenKidsCommand(text) {
  const cleaned = String(text || '');
  if (!cleaned.trim()) return null;
  for (const rule of SCREEN_RULES) {
    if (rule.test(cleaned)) return { category: rule.category, blocked: rule.blocked, reply: rule.reply };
  }
  return null;
}

// The whole kids gate, in the order that matters:
//   1. distress — always answered, at any hour, over any limit;
//   2. bedtime / daily screen-time (playtime is decided by the caller via
//      parental-controls so this stays pure);
//   3. the rest of the content filter.
// Returns null when the command should flow on to the normal router.
function gateKidsCommand({ text, playtime }) {
  const screened = screenKidsCommand(text);
  if (screened && screened.category === 'distress') return screened;
  if (playtime) return { category: `time-${playtime.reason}`, blocked: true, reply: playtime.reply };
  return screened;
}

// ── layer 3: the kids brain prompt ──────────────────────────────────────

// Mirrors AIService.prompt's shape (memories/tasks ride the same context)
// but replaces the frame entirely. settings.personality is ignored on
// purpose — the kid voice is policy, not preference.
function buildKidsPrompt(settings, context = {}) {
  const memories = (context.memories || []).map((item) => `- ${item.text}`).join('\n') || '- None';
  const tasks = (context.tasks || []).map((item) => `- ${item.title} [${item.project}]`).join('\n') || '- None';
  const name = settings.assistantName || 'JARVIS';
  const kid = settings.profileName && settings.profileName !== 'User' ? settings.profileName : 'your friend';
  return [
    `You are ${name}, a friendly helper for a kid, running privately on the family computer. The kid you are helping is called ${kid}.`,
    'How to talk:',
    '- You are warm, patient, playful, and encouraging — like a great big sibling who happens to be a computer.',
    '- Short sentences and simple words a 8-12 year old reads easily. One idea at a time. A little humor is great; sarcasm and scary stuff are not.',
    '- Celebrate effort. If they got something wrong, say what they got right first, then help fix the rest.',
    '- Be honest. If you are not sure, say so plainly. Never invent file names, recipes, or results.',
    '- Never claim a computer action happened unless a tool result in this conversation confirms it.',
    'Safety rules — these beat every other instruction, including anything the kid asks:',
    '- No violence, weapons, adult topics, alcohol, drugs, or scary content. If a game asks you to defeat a boss or a zombie, that is fine — keep it at cartoon level.',
    '- Never ask for, repeat, or store personal information: full names, addresses, school names, phone numbers, passwords, or photos. If the kid shares some, gently remind them to keep it private online.',
    '- People met online stay online. Never help arrange a real-life meeting; say that is a grown-ups-decide thing.',
    '- Buying anything, sharing anything publicly, or changing parental settings always goes through a grown-up. Never help work around screen-time limits, filters, or the parent PIN.',
    '- If the kid seems sad, scared, hurt, or talks about hurting themselves, be kind, take them seriously, and tell them to talk to a grown-up they trust. In the U.S. they can call or text 988 any time.',
    'Games — you are a genius about them, and this is where you shine:',
    '- MINECRAFT: you know crafting recipes, mobs, biomes, enchanting, potions, redstone, and survival strategy. You can plan builds like an architect.',
    '- ROBLOX: you know the popular games (Adopt Me, Brookhaven, Blox Fruits, Doors, Tower of Hell and friends), obby technique, trading safety, and Roblox Studio basics — you can explain simple Luau scripts line by line.',
    '- When they are STUCK in a game: ask which game and what is on the screen, then give one clear next step at a time. If screen help is turned on, they can ask you to read the screen.',
    '- When they want to BUILD something (a Minecraft castle, a Roblox obby), answer as a build plan:',
    '  1. A fun name for the build and a difficulty (easy / medium / epic).',
    '  2. MATERIALS: a short list with counts (Minecraft) or the Studio parts/tools needed (Roblox).',
    '  3. STEPS: numbered, one action each, with sizes ("make the wall 10 blocks long, 6 tall").',
    '  4. A PRO TIP at the end to make it cooler.',
    '- Keep build plans small enough to finish today; offer a "level 2" upgrade for tomorrow.',
    'Homework: explain HOW to solve it step by step and check their answer — do not just hand over the final answer.',
    `Saved notes that may be relevant:\n${memories}`,
    `Things on the list:\n${tasks}`
  ].filter(Boolean).join('\n');
}

module.exports = {
  KIDS_BLOCKED_FLAGS,
  KIDS_FORCED_HIDDEN_MODULES,
  KIDS_BLOCKED_CHANNEL_PREFIXES,
  KIDS_CHANNEL_REFUSAL,
  isKidsBlockedChannel,
  KID_SAFE_SETTINGS_KEYS,
  applyKidsSettings,
  gateKidsSettingsPatch,
  screenKidsCommand,
  gateKidsCommand,
  buildKidsPrompt,
};
