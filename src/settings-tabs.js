// Settings-dialog tab definitions + the pure rules the DOM applies.
// Dual export like skins.js / orb-engine.js: node:test requires it; the
// browser loads it as a classic <script> and reads window.SettingsTabs.
(function () {
  const TABS = [
    { id: 'general', label: 'GENERAL' },
    { id: 'looks', label: 'LOOKS' },
    { id: 'brains', label: 'BRAINS' },
    { id: 'cameras', label: 'CAMERAS' },
    { id: 'automation', label: 'AUTOMATION' },
    { id: 'abilities', label: 'ABILITIES' },
    { id: 'phone', label: 'PHONE' },
    { id: 'calls', label: 'CALLS' },
    { id: 'pro', label: 'FEATURES' },
    { id: 'system', label: 'SYSTEM' },
    { id: 'jr', label: 'JARVIS JR' }
  ];

  // The JR kid's whole settings dialog: how it looks, nothing else. Matches
  // core/variant.js's JR_SETTINGS_ALLOW, which is the main-process belt
  // behind this braces — a hand-crafted settings:save from a locked JR
  // renderer still only writes cosmetics.
  const KID_TABS = TABS.filter((tab) => tab.id === 'looks');

  // The three audiences the dialog has: the grown-up build (everything but
  // the JR tab), a JR parent who entered the PIN (everything), and a JR kid
  // (LOOKS only, restricted).
  function tabsFor({ jr = false, unlocked = false } = {}) {
    if (!jr) return { tabs: TABS.filter((tab) => tab.id !== 'jr'), restricted: false };
    if (unlocked) return { tabs: TABS, restricted: false };
    return { tabs: KID_TABS, restricted: true };
  }

  function normalizeTab(id, tabs = TABS) {
    return tabs.some((tab) => tab.id === id) ? id : tabs[0].id;
  }

  // Under the FULL set the old forgiving rule holds: an untagged section
  // shows under the first tab, so nothing can vanish from every tab by
  // accident. Under a RESTRICTED set (the kid's) that fallback is a hole —
  // a section someone forgets to tag would land in the kid's dialog — so
  // restricted sets are deny-by-default, the same JUNIOR principle
  // moduleAllowedInProfile runs on.
  function sectionHidden(sectionTab, activeTab, { tabs = TABS, restricted = false } = {}) {
    if (restricted && !tabs.some((tab) => tab.id === sectionTab)) return true;
    return normalizeTab(sectionTab, tabs) !== normalizeTab(activeTab, tabs);
  }

  const api = { TABS, KID_TABS, tabsFor, normalizeTab, sectionHidden };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SettingsTabs = api;
})();
