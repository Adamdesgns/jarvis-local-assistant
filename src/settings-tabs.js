// Settings-dialog tab definitions + the two pure rules the DOM applies.
// Dual export like skins.js / orb-engine.js: node:test requires it; the
// browser loads it as a classic <script> and reads window.SettingsTabs.
(function () {
  const TABS = [
    { id: 'general', label: 'GENERAL' },
    { id: 'brains', label: 'BRAINS' },
    { id: 'cameras', label: 'CAMERAS' },
    { id: 'automation', label: 'AUTOMATION' },
    { id: 'abilities', label: 'ABILITIES' },
    { id: 'phone', label: 'PHONE' },
    { id: 'system', label: 'SYSTEM' }
  ];

  function normalizeTab(id) {
    return TABS.some((tab) => tab.id === id) ? id : TABS[0].id;
  }

  // An untagged section belongs to the first tab, so nothing can ever vanish
  // from every tab just because its data-tab attribute is missing.
  function sectionHidden(sectionTab, activeTab) {
    return normalizeTab(sectionTab) !== normalizeTab(activeTab);
  }

  const api = { TABS, normalizeTab, sectionHidden };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SettingsTabs = api;
})();
