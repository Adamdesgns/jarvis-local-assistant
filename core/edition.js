'use strict';

// Which JARVIS this build is.
//
// 'standard' is the desktop assistant that has always shipped. 'junior' is
// JARVIS JUNIOR — the children's edition, built from this same repo into its
// own installer. The edition is stamped into package.json at build time
// (electron-builder --config.extraMetadata.jarvisEdition=junior) and can be
// forced with JARVIS_EDITION for `npm run start:junior`.
//
// Everything here is pure and synchronous so main.js, the router, the brain,
// and the tests all read the same answer from the same place. The junior
// profile is an ALLOWLIST: a capability a kid build gets must be named here.
// A new ability added to the app later is therefore off for children by
// default, which is the correct direction to fail.

const EDITIONS = ['standard', 'junior'];
const DEFAULT_EDITION = 'standard';

const PROFILES = {
  standard: {
    edition: 'standard',
    productName: 'JARVIS',
    tagline: 'Private local assistant',
    ui: ['src', 'index.html'],
    // Abilities the standard desktop assistant has always had.
    files: true,
    documents: true,
    applications: true,
    power: true,
    cameras: true,
    screenRead: true,
    screenDrive: true,
    claudeBridge: true,
    nightShift: true,
    schedules: true,
    phone: true,
    // Children's abilities: absent from the grown-up build.
    kidBrain: false,
    storyTime: false,
    starChart: false,
    kidRoutines: false,
    parentLock: false
  },
  junior: {
    edition: 'junior',
    productName: 'JARVIS JUNIOR',
    tagline: 'A friendly helper of your very own',
    ui: ['src', 'junior', 'index.html'],
    // Everything that reaches out of the app — files, other programs, the
    // screen, the cameras, the power button, the phone bridge — is off. Not
    // hidden: never constructed. A child cannot reach what does not exist.
    files: false,
    documents: false,
    applications: false,
    power: false,
    cameras: false,
    screenRead: false,
    screenDrive: false,
    claudeBridge: false,
    nightShift: false,
    schedules: false,
    phone: false,
    // What the junior build is for.
    kidBrain: true,
    storyTime: true,
    starChart: true,
    kidRoutines: true,
    parentLock: true
  }
};

for (const profile of Object.values(PROFILES)) Object.freeze(profile);

function resolveEdition(raw) {
  const wanted = String(raw || '').trim().toLowerCase();
  return EDITIONS.includes(wanted) ? wanted : DEFAULT_EDITION;
}

// The edition this process is running as. `stamp` is the packaged
// package.json (main.js passes require('./package.json')); the environment
// variable wins so a developer can run either edition from one checkout.
function currentEdition({ env = process.env, stamp = null } = {}) {
  if (env && env.JARVIS_EDITION) return resolveEdition(env.JARVIS_EDITION);
  return resolveEdition(stamp && stamp.jarvisEdition);
}

function profileFor(edition) {
  return PROFILES[resolveEdition(edition)];
}

function isJunior(edition) {
  return resolveEdition(edition) === 'junior';
}

// One question, asked the same way everywhere: may this edition do X?
function can(edition, capability) {
  return profileFor(edition)[capability] === true;
}

// The model's tool belt, filtered for the edition. Mirrors the unattendedSafe
// pattern in ai-service: junior keeps only tools explicitly marked
// kidSafe: true in tool-registry.js, so a powerful tool added later is denied
// to children until somebody deliberately marks it otherwise.
function filterRegistryForEdition(registry, edition) {
  const list = Array.isArray(registry) ? registry : [];
  if (!isJunior(edition)) return list;
  return list.filter((tool) => tool && tool.kidSafe === true);
}

module.exports = {
  EDITIONS,
  DEFAULT_EDITION,
  PROFILES,
  resolveEdition,
  currentEdition,
  profileFor,
  isJunior,
  can,
  filterRegistryForEdition
};
