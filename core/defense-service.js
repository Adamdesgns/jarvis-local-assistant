'use strict';

// DefenseService: the main-process owner of the defense-mode posture.
// Every network call in defense mode goes through THIS file, and every fetch
// is preceded by assertAllowedUrl — api.weather.gov and the feeds the user
// saved are the entire universe. The mode watches and tells; nothing in this
// file arms, dials, locks, or spends.

const { pickTriggerAlert, buildBannerLabel, createEntryGate, parseRss, buildSituationReadPrompt } = require('./defense-mode');
const { isPro } = require('./license-gate');
const { isWithinWindow } = require('./autonomy-rules');

const NWS_HOST = 'api.weather.gov';
// NWS policy asks every client to identify itself.
const USER_AGENT = 'JARVIS-local-assistant (github.com/Adamdesgns/jarvis-local-assistant)';
const WAVE_OFF_MS = 15000;
const POLL_MS = 120000;
const REFRESH_MS = 180000;
const MAX_HEADLINES = 12;

function assertAllowedUrl(url, feeds = []) {
  let parsed = null;
  try { parsed = new URL(String(url)); } catch { /* falls through to the block below */ }
  if (parsed && parsed.hostname === NWS_HOST) return;
  if (parsed && feeds.includes(String(url))) return;
  throw new Error(`Blocked: defense mode may only reach ${NWS_HOST} and the feeds saved in Settings. Refused ${url}`);
}

class DefenseService {
  constructor({ config, ai, cameras, emit, log, fetchImpl = fetch, timers = { setTimeout, clearTimeout, setInterval, clearInterval }, now = () => new Date() }) {
    this.config = config;
    this.ai = ai;
    this.cameras = cameras || null;
    this.emit = emit;
    this.log = log;
    this.fetchImpl = fetchImpl;
    this.timers = timers;
    this.now = now;
    this.gate = createEntryGate({ timeoutMs: WAVE_OFF_MS });
    this.active = false;
    this.seenAlertIds = new Set();
    this.pollTimer = null;
    this.refreshTimer = null;
    this.waveOffTimer = null;
  }

  status() {
    return { active: this.active, pending: !this.active && !this.gate.entered() && this.waveOffTimer !== null };
  }

  #defenseSettings() {
    return this.config.getSettings().defense || {};
  }

  async #fetch(url) {
    assertAllowedUrl(url, this.#defenseSettings().rssFeeds || []);
    return this.fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: '*/*' } });
  }

  async listCountyZones(stateCode) {
    try {
      const state = String(stateCode || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
      const response = await this.#fetch(`https://${NWS_HOST}/zones?area=${state}&type=county`);
      if (!response.ok) throw new Error(`the weather service answered ${response.status}`);
      const data = await response.json();
      const zones = (data.features || [])
        .map((feature) => ({ id: feature?.properties?.id || '', name: feature?.properties?.name || '' }))
        .filter((zone) => zone.id && zone.name);
      return { ok: true, zones };
    } catch (error) {
      return { ok: false, message: `Could not fetch the county list: ${error.message}` };
    }
  }

  async #fetchActiveAlerts() {
    const zone = this.#defenseSettings().countyZone;
    if (!zone) return [];
    try {
      const response = await this.#fetch(`https://${NWS_HOST}/alerts/active/zone/${encodeURIComponent(zone)}`);
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data.features) ? data.features : [];
    } catch {
      return [];
    }
  }

  async #fetchHeadlines() {
    const feeds = this.#defenseSettings().rssFeeds || [];
    const settled = await Promise.allSettled(feeds.map(async (url) => {
      const response = await this.#fetch(url);
      if (!response.ok) return [];
      return parseRss(await response.text());
    }));
    const headlines = [];
    for (const item of settled) {
      if (item.status === 'fulfilled') headlines.push(...item.value);
    }
    return headlines.slice(0, MAX_HEADLINES);
  }

  async #situation() {
    const [features, headlines] = await Promise.all([this.#fetchActiveAlerts(), this.#fetchHeadlines()]);
    return { alert: pickTriggerAlert(features), headlines };
  }

  // The single seam every entry goes through — manual (router/IPC) and
  // automatic (gate expiry) alike. The Pro check lives here because defense
  // mode is the camera module's posture and cameras are Pro.
  async requestEnter(reason) {
    if (!isPro(this.config.getSettings().license)) {
      return { ok: false, message: 'Defense mode rides with the cameras, which are a JARVIS Pro feature.' };
    }
    if (this.active) return { ok: false, message: 'Defense mode is already up, sir.' };
    await this.#enter(reason);
    return { ok: true, message: 'Defense mode. All cameras coming up.' };
  }

  async #enter(reason) {
    const { alert, headlines } = await this.#situation();
    // The read is best-effort: a storm with the brain offline must still
    // show the cameras. Composed ONCE per entry — refreshes never re-speak.
    let read = '';
    try {
      const reply = await this.ai.reply(buildSituationReadPrompt(reason, alert, headlines), { unattended: false });
      if (reply && reply.ok !== false && reply.text) read = reply.text;
    } catch { /* the board opens anyway */ }
    this.active = true;
    this.#clearWaveOffTimer();
    this.refreshTimer = this.timers.setInterval(() => this.#refresh(), REFRESH_MS);
    this.emit('defense:enter', { banner: buildBannerLabel(reason, this.now()), reason, alert, headlines, read });
    this.log.write({ type: 'defense', command: 'defense-enter', response: buildBannerLabel(reason, this.now()), source: 'defense' });
  }

  async #refresh() {
    if (!this.active) return;
    const { alert, headlines } = await this.#situation();
    this.emit('defense:update', { alert, headlines });
  }

  exit() {
    // One verb covers both states: a pending proposal is waved off, a live
    // posture comes down. Exit is never gated.
    if (this.waveOff()) return;
    if (!this.active) return;
    this.active = false;
    if (this.refreshTimer !== null) { this.timers.clearInterval(this.refreshTimer); this.refreshTimer = null; }
    this.gate.reset();
    this.emit('defense:exit', {});
    this.log.write({ type: 'defense', command: 'defense-exit', response: 'Stood down.', source: 'defense' });
  }

  waveOff() {
    if (!this.gate.waveOff()) return false;
    this.#clearWaveOffTimer();
    this.emit('defense:pending-cancelled', {});
    return true;
  }

  #clearWaveOffTimer() {
    if (this.waveOffTimer !== null) { this.timers.clearTimeout(this.waveOffTimer); this.waveOffTimer = null; }
  }

  // Every automatic entry announces itself and can be waved off — the rail.
  #proposeAuto(reason, spoken) {
    if (this.active) return false;
    if (!isPro(this.config.getSettings().license)) return false;
    const proposed = this.gate.propose(reason, this.now().getTime());
    if (!proposed) return false;
    this.waveOffTimer = this.timers.setTimeout(async () => {
      const expired = this.gate.expire(this.now().getTime() + WAVE_OFF_MS);
      if (expired?.enter) await this.#enter(expired.reason);
    }, WAVE_OFF_MS);
    this.emit('defense:pending', { reason, seconds: WAVE_OFF_MS / 1000, spoken });
    return true;
  }

  async pollOnce() {
    const defense = this.#defenseSettings();
    if (defense.autoWeather !== true || !defense.countyZone) return;
    const features = await this.#fetchActiveAlerts();
    const alert = pickTriggerAlert(features.filter((item) => !this.seenAlertIds.has(item?.properties?.id)));
    if (!alert) return;
    this.seenAlertIds.add(alert.properties.id);
    const reason = { kind: 'weather', event: alert.properties.event, area: defense.countyName || '' };
    this.#proposeAuto(reason, `${alert.properties.event}${defense.countyName ? ` for ${defense.countyName}` : ''}. Entering defense mode in fifteen seconds — say stand down to wave off.`);
  }

  async handleCameraAlert(alert) {
    const settings = this.config.getSettings();
    if ((settings.defense || {}).autoCamera !== true) return;
    if (!alert || alert.kind !== 'motion') return;
    if (!isWithinWindow(this.now(), settings.autonomyNightStart, settings.autonomyNightEnd)) return;
    if (!this.cameras) return;
    let systems = [];
    try { systems = await this.cameras.listSystems(); } catch { return; }
    if (!systems.some((system) => system.armed === true)) return;
    const reason = { kind: 'camera', cameraName: alert.name || 'a camera' };
    this.#proposeAuto(reason, `Motion at ${reason.cameraName} while armed. Entering defense mode in fifteen seconds — say stand down to wave off.`);
  }

  start() {
    if (this.pollTimer !== null) return;
    this.pollTimer = this.timers.setInterval(() => { this.pollOnce(); }, POLL_MS);
  }

  stop() {
    if (this.pollTimer !== null) { this.timers.clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.refreshTimer !== null) { this.timers.clearInterval(this.refreshTimer); this.refreshTimer = null; }
    this.#clearWaveOffTimer();
  }
}

module.exports = { DefenseService, assertAllowedUrl };
