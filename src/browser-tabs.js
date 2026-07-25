'use strict';

// THE BROWSER, stage 1 — pure chrome logic. No DOM, no Electron: the address
// rules and the tab-list state machine live here so they can be node-tested,
// exactly like terminal-log.js. browser-ui.js owns the DOM and the webviews.
(() => {
  // One address box, three outcomes: a real web URL passes, a bare domain gets
  // https, everything else — including every non-web scheme — is a SEARCH.
  // file:, javascript: and friends must never come out of here as URLs;
  // the main-process guard is the wall, this is the polite front gate.
  function normalizeAddress(text) {
    const cleaned = String(text || '').trim();
    if (!cleaned) return null;
    if (/^https?:\/\//i.test(cleaned)) return { url: cleaned };
    // A bare domain: no spaces, no scheme, at least one dot before any slash.
    const beforeSlash = cleaned.split('/')[0];
    if (!/\s/.test(cleaned) && !/^[a-z][a-z0-9+.-]*:/i.test(cleaned) && /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i.test(beforeSlash)) {
      return { url: `https://${cleaned}` };
    }
    return { url: `https://duckduckgo.com/?q=${encodeURIComponent(cleaned)}` };
  }

  function createTabList({ max = 5 } = {}) {
    const tabs = [];
    let activeId = null;
    let counter = 0;
    const find = (id) => tabs.find((tab) => tab.id === id) || null;
    return {
      open(url) {
        if (tabs.length >= max) return null;
        counter += 1;
        const tab = { id: `tab-${counter}`, url: String(url || ''), title: '', loading: false };
        tabs.push(tab);
        activeId = tab.id;
        return tab;
      },
      close(id) {
        const index = tabs.findIndex((tab) => tab.id === id);
        if (index === -1) return activeId;
        tabs.splice(index, 1);
        if (activeId === id) {
          // The neighbor to the right takes over; at the end, the new last.
          const next = tabs[index] || tabs[index - 1] || null;
          activeId = next ? next.id : null;
        }
        return activeId;
      },
      activate(id) {
        if (find(id)) activeId = id;
      },
      update(id, patch = {}) {
        const tab = find(id);
        if (!tab) return;
        if (patch.title !== undefined) tab.title = patch.title;
        if (patch.url !== undefined) tab.url = patch.url;
        if (patch.loading !== undefined) tab.loading = Boolean(patch.loading);
      },
      active: () => find(activeId),
      list: () => tabs.slice()
    };
  }

  const api = { normalizeAddress, createTabList };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.JarvisBrowserTabs = api;
})();
