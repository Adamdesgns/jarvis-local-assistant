// Diagnostic: print the SHAPE of Blink's homescreen response. READ-ONLY.
//
//   npx electron scripts/blink-homescreen-probe.js
//
// Exists because the Blink session is DPAPI-encrypted and can only be decrypted
// by this Windows user inside Electron. Prints structure only — ids, names,
// serials, kinds, array membership. Never tokens.
//
// ⚠️ HARD RULE, learned the expensive way: NEVER construct ConfigStore here.
// Its constructor persists on load, and running that against the live file
// while JARVIS is open raced the app's own atomic rename and wiped Adam's saved
// Blink login (2026-08-04). This reads the JSON directly and decrypts by hand;
// the only fetch is Blink's refresh + homescreen, and nothing touches disk.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// safeStorage on Windows is Chromium's OSCrypt: a per-profile key in "Local
// State", itself DPAPI-wrapped. A different userData means a different key and
// nothing decrypts, so this must run as the same profile as JARVIS — set before
// the app is ready or it does not take. Read-only remains the rule above.
app.setPath('userData', path.join(app.getPath('appData'), 'jarvis-local-assistant'));

app.whenReady().then(async () => {
  const { BlinkClient } = require(path.join(__dirname, '..', 'core', 'camera', 'blink-client'));
  const file = path.join(app.getPath('appData'), 'jarvis-local-assistant', 'settings.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const settings = saved.settings || {};
  const secrets = saved.secrets || {};

  const readSecret = (name) => {
    const entry = secrets[name];
    if (!entry) return '';
    if (entry.encrypted) return safeStorage.decryptString(Buffer.from(entry.value, 'base64'));
    return entry.value || '';
  };

  const accounts = (settings.cameraAccounts || []).filter((account) => account.brand === 'blink');
  console.log(`blink accounts: ${accounts.length}`);

  for (const account of accounts) {
    let stored;
    try {
      stored = JSON.parse(readSecret(`cameraAccount:${account.id}`) || '{}');
    } catch (error) {
      console.log(`  account ${account.id}: secret unreadable (${error.message})`);
      continue;
    }
    console.log(`\n=== account ${account.id} (blink accountId=${stored.accountId}, tier=${stored.tier})`);
    // NEVER refresh from here. Refreshing rotates the refresh token, and the
    // running app still holds the old one — its next renewal would fail and
    // sign Adam out. Use the current access token or say why we cannot.
    if (!stored.token) { console.log('  no access token stored'); continue; }
    if (stored.expiresAt && Date.now() > stored.expiresAt - 60000) {
      console.log('  access token expired; open a camera in JARVIS to renew it, then rerun.');
      continue;
    }

    const client = new BlinkClient({});
    const session = { token: stored.token, accountId: stored.accountId, tier: stored.tier };
    const home = await client.homescreen(session);
    console.log('  top-level keys:', Object.keys(home).join(', '));
    for (const field of ['networks', 'sync_modules', 'cameras', 'owls', 'doorbells', 'chimes']) {
      const list = home[field];
      if (!Array.isArray(list)) continue;
      console.log(`  ${field}: ${list.length}`);
      for (const item of list) {
        console.log(`    id=${item.id} name=${JSON.stringify(item.name)} serial=${item.serial || '(none)'} type=${item.type || item.model || ''} network=${item.network_id ?? ''}`);
      }
    }
  }
  app.quit();
}).catch((error) => {
  console.error('probe failed:', error);
  app.quit();
});
