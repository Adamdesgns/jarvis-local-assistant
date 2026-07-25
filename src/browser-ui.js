// THE BROWSER, stage 1 — the DOM side. Tabs, address bar, and one <webview>
// per tab. The security wall does NOT live here: main.js rewrites every
// webview attach through core/browser-guard.js, the stranger partition
// refuses permissions and downloads, and guests can't open OS windows.
// This file just draws chrome and asks politely.
(() => {
  const { normalizeAddress, createTabList } = window.JarvisBrowserTabs;
  const tabs = createTabList({ max: 5 });
  const strip = document.getElementById('browser-tabs');
  const newTabButton = document.getElementById('browser-new-tab');
  const addressForm = document.getElementById('browser-address-form');
  const addressInput = document.getElementById('browser-address');
  const backButton = document.getElementById('browser-back');
  const forwardButton = document.getElementById('browser-forward');
  const reloadButton = document.getElementById('browser-reload');
  const pages = document.getElementById('browser-pages');
  const emptyNote = document.getElementById('browser-empty');
  const views = new Map(); // tab id -> webview (or rig frame)
  const rigMode = window.JarvisBrowserRig === true; // rigs can't host real webviews
  let silenced = false; // hidden/collapsed module: pages stay alive, so mute them

  function applySilence(view) {
    if (!rigMode && view.dataset.ready === 'true') view.setAudioMuted(silenced);
  }

  // display:none does not pause a webview — a hidden module kept playing
  // audio with no visible UI. The renderer flips this on hide/collapse.
  function setSilenced(on) {
    silenced = Boolean(on);
    for (const view of views.values()) applySilence(view);
  }

  function accentRefresh() {
    const palette = window.jarvisHologram?.palette || 'gold';
    const accent = window.JarvisTerminal?.accentFor?.(palette) || '#ffb21f';
    // CSSOM property set — allowed under the CSP (only style="" markup is not).
    document.body.style.setProperty('--browser-accent', accent);
  }

  function makeView(tab) {
    if (rigMode) {
      const frame = document.createElement('div');
      frame.className = 'browser-rig-frame';
      frame.textContent = tab.url;
      return frame;
    }
    const view = document.createElement('webview');
    // Belt to the guard's suspenders — main.js forces this anyway.
    view.setAttribute('partition', 'persist:jarvis-browser');
    view.setAttribute('src', tab.url);
    // Every webview method throws until dom-ready has fired (crash.log caught
    // canGoBack doing exactly that on openTab) — gate them on this flag.
    view.addEventListener('dom-ready', () => { view.dataset.ready = 'true'; applySilence(view); syncControls(); });
    view.addEventListener('page-title-updated', (event) => { tabs.update(tab.id, { title: event.title }); renderStrip(); });
    view.addEventListener('did-navigate', (event) => { tabs.update(tab.id, { url: event.url }); syncAddress(); });
    view.addEventListener('did-navigate-in-page', (event) => { tabs.update(tab.id, { url: event.url }); syncAddress(); });
    view.addEventListener('did-start-loading', () => { tabs.update(tab.id, { loading: true }); renderStrip(); });
    view.addEventListener('did-stop-loading', () => { tabs.update(tab.id, { loading: false }); renderStrip(); syncControls(); });
    return view;
  }

  function renderStrip() {
    for (const pill of strip.querySelectorAll('.browser-tab')) pill.remove();
    const activeTab = tabs.active();
    for (const tab of tabs.list()) {
      const pill = document.createElement('div');
      pill.className = 'browser-tab';
      if (activeTab && tab.id === activeTab.id) pill.classList.add('active');
      if (tab.loading) pill.classList.add('loading');
      const label = document.createElement('span');
      label.textContent = tab.title || hostOf(tab.url) || 'New tab';
      const close = document.createElement('b');
      close.textContent = '×';
      close.title = 'Close tab';
      close.addEventListener('click', (event) => { event.stopPropagation(); closeTab(tab.id); });
      pill.append(label, close);
      pill.addEventListener('click', () => activateTab(tab.id));
      strip.insertBefore(pill, newTabButton);
    }
    emptyNote.hidden = tabs.list().length > 0;
  }

  function hostOf(url) {
    try { return new URL(url).host; } catch { return ''; }
  }

  function syncAddress() {
    const tab = tabs.active();
    if (tab && document.activeElement !== addressInput) addressInput.value = tab.url;
    if (!tab) addressInput.value = '';
  }

  function readyView(id) {
    const view = views.get(id);
    return view && !rigMode && view.dataset.ready === 'true' ? view : null;
  }

  function syncControls() {
    const view = tabs.active() ? readyView(tabs.active().id) : null;
    backButton.disabled = !(view && view.canGoBack());
    forwardButton.disabled = !(view && view.canGoForward());
  }

  function syncVisibility() {
    const activeTab = tabs.active();
    for (const [id, view] of views) view.setAttribute('data-active', String(Boolean(activeTab && id === activeTab.id)));
  }

  function openTab(url) {
    const tab = tabs.open(url);
    if (!tab) {
      if (typeof showToast === 'function') showToast('Five tabs is the limit for now — close one first.');
      return null;
    }
    const view = makeView(tab);
    views.set(tab.id, view);
    pages.append(view);
    accentRefresh();
    renderStrip(); syncAddress(); syncVisibility(); syncControls();
    return tab;
  }

  function closeTab(id) {
    const view = views.get(id);
    if (view) { view.remove(); views.delete(id); }
    tabs.close(id);
    renderStrip(); syncAddress(); syncVisibility(); syncControls();
  }

  function activateTab(id) {
    tabs.activate(id);
    renderStrip(); syncAddress(); syncVisibility(); syncControls();
  }

  function navigateActive(url) {
    const tab = tabs.active();
    if (!tab) { openTab(url); return; }
    tabs.update(tab.id, { url });
    const view = views.get(tab.id);
    if (view) {
      if (rigMode) view.textContent = url;
      else view.setAttribute('src', url);
    }
    renderStrip(); syncAddress();
  }

  addressForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const normalized = normalizeAddress(addressInput.value);
    if (!normalized) return;
    navigateActive(normalized.url);
    addressInput.blur();
  });
  newTabButton.addEventListener('click', () => openTab('https://duckduckgo.com'));
  backButton.addEventListener('click', () => { const view = readyView(tabs.active()?.id); if (view?.canGoBack()) view.goBack(); });
  forwardButton.addEventListener('click', () => { const view = readyView(tabs.active()?.id); if (view?.canGoForward()) view.goForward(); });
  reloadButton.addEventListener('click', () => { const view = readyView(tabs.active()?.id); if (view) view.reload(); });

  window.jarvis.onBrowserOpenTab?.((payload) => { if (payload?.url) openTab(payload.url); });
  window.jarvis.onBrowserNotice?.((payload) => { if (payload?.message && typeof showToast === 'function') showToast(payload.message, 5000); });
  window.jarvis.onOrbPrefs?.(() => accentRefresh());
  accentRefresh();

  window.JarvisBrowser = { openTab, setSilenced, tabCount: () => tabs.list().length };
})();
