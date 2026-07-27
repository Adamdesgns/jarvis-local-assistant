// Settings-dialog tab definitions + the two pure rules the DOM applies.
// Dual export like skins.js / orb-engine.js: node:test requires it; the
// browser loads it as a classic <script> and reads window.SettingsTabs.
(function () {
  // The FULL tab list. kidsOnly/adultOnly decide which strip a tab appears
  // on (tabsFor below); normalizeTab still recognises every id, so a
  // section tagged for the other edition's tab stays hidden instead of
  // falling through to GENERAL.
  const TABS = [
    { id: 'general', label: 'GENERAL' },
    { id: 'brains', label: 'BRAINS' },
    { id: 'parents', label: 'PARENTS', kidsOnly: true },
    { id: 'cameras', label: 'CAMERAS', adultOnly: true },
    { id: 'automation', label: 'AUTOMATION', adultOnly: true },
    { id: 'abilities', label: 'ABILITIES' },
    { id: 'phone', label: 'PHONE', adultOnly: true },
    { id: 'pro', label: 'FEATURES', adultOnly: true },
    { id: 'system', label: 'SYSTEM' }
  ];

  // Which tabs the strip shows. Adult builds: everything but PARENTS.
  // JARVIS Jr.: the clamped subsystems' tabs (cameras, automation, phone,
  // pro) disappear and PARENTS appears between BRAINS and ABILITIES.
  function tabsFor(context) {
    const kids = Boolean(context && context.kids);
    return TABS.filter((tab) => (kids ? !tab.adultOnly : !tab.kidsOnly));
  }

  function normalizeTab(id) {
    return TABS.some((tab) => tab.id === id) ? id : TABS[0].id;
  }

  // An untagged section belongs to the first tab, so nothing can ever vanish
  // from every tab just because its data-tab attribute is missing.
  function sectionHidden(sectionTab, activeTab) {
    return normalizeTab(sectionTab) !== normalizeTab(activeTab);
  }

  const api = { TABS, tabsFor, normalizeTab, sectionHidden };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SettingsTabs = api;
})();
