'use strict';

// JARVIS JR — renderer side of the parent-lock surface: the blocking setup
// sheet a kid cannot dismiss, the PIN-gated parent panel, and the checklist
// that decides what got BUILT (not just hidden — see core/variant.js).
//
// Plain script, no modules, same style as renderer.js: window.JrParentUI is
// the only thing this file adds to global scope. init(status) is called
// exactly once from renderer.js's boot, and ONLY when jr:status answered
// { jr: true } — see the boot hook. On the standard build this file loads
// but nothing in it ever runs, so every element it owns stays hidden/inert.

(function () {
  // The parent checklist, display copy. Order and keys mirror CONTROL_KEYS in
  // core/variant.js exactly — that file is the source of truth. This is a
  // manual mirror, not a shared import: preload.js runs sandboxed (see
  // main.js webPreferences: { sandbox: true }), so it cannot require project
  // modules the way an un-sandboxed preload could, and nothing exposes the
  // raw key list over IPC today. If core/variant.js's CONTROL_KEYS ever
  // changes, this map must be updated by hand — flagged here on purpose so a
  // future edit to variant.js is the trigger to come fix it.
  var LABELS = {
    games: 'Games',
    battle: 'Battle mode',
    quips: 'Jokes & quips',
    homework: 'Homework hints',
    tasks: 'Tasks',
    timers: 'Timers',
    cameras: 'Cameras (view only)',
    documents: 'Documents — read & summarize',
    files: 'File search (their own folder)',
    apps: 'Open apps (parent allowlist)',
    browser: 'The browser',
    terminal: 'The terminal',
    screenRead: 'Screen reading',
    power: 'Power (restart/shutdown)'
  };

  function $(id) { return document.getElementById(id); }

  // Keeps the dark UI visible but unreachable behind a blocking sheet —
  // minimal and reversible: one body class for the dim, `inert` on both skin
  // roots so a click/tab can't reach anything underneath either overlay.
  function setBlocked(blocked) {
    document.body.classList.toggle('jr-locked', Boolean(blocked));
    ['classic-root', 'cc-root'].forEach(function (id) {
      var root = $(id);
      if (root) root.inert = Boolean(blocked);
    });
  }

  function showError(el, message) {
    if (!el) return;
    if (!message) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = message;
  }

  function readChecklist(container) {
    var out = {};
    container.querySelectorAll('input[type="checkbox"][data-jr-key]').forEach(function (input) {
      out[input.dataset.jrKey] = input.checked;
    });
    return out;
  }

  function renderChecklist(container, controls) {
    container.innerHTML = '';
    Object.keys(LABELS).forEach(function (key) {
      var row = document.createElement('label');
      row.className = 'toggle-row';
      row.innerHTML = '<span><b></b></span><input type="checkbox" data-jr-key="' + key + '"><i></i>';
      row.querySelector('b').textContent = LABELS[key];
      row.querySelector('input').checked = Boolean(controls && controls[key]);
      container.appendChild(row);
    });
  }

  // ---- Setup sheet (blocking, first run) -----------------------------

  function showSetupOverlay(profile) {
    var overlay = $('jr-setup');
    if (!overlay) return;
    renderChecklist($('jr-setup-controls'), profile);
    overlay.hidden = false;
    setBlocked(true);
    $('jr-setup-name').focus();
  }

  function submitSetup() {
    var errorEl = $('jr-setup-error');
    var button = $('jr-setup-go');
    showError(errorEl, '');
    var payload = {
      kidName: $('jr-setup-name').value.trim(),
      birthdate: $('jr-setup-birthdate').value,
      pin: $('jr-setup-pin').value,
      controls: readChecklist($('jr-setup-controls'))
    };
    button.disabled = true;
    window.jarvis.jrSetupComplete(payload).then(function (result) {
      if (!result || !result.ok) {
        showError(errorEl, (result && result.reason) || 'Something went wrong. Try again.');
        button.disabled = false;
        return;
      }
      // main.js relaunches the whole process on success (PROFILE was built
      // once at boot from an empty checklist — a fresh process is the only
      // clean way to pick up the real one). Nothing else to do here but say
      // so before the window disappears.
      button.disabled = true;
      button.textContent = 'RESTARTING…';
      errorEl.hidden = false;
      errorEl.className = 'jr-note';
      errorEl.textContent = 'All set — JARVIS JR is restarting…';
    }).catch(function () {
      showError(errorEl, 'Could not reach JARVIS JR. Try again.');
      button.disabled = false;
    });
  }

  // ---- Parent panel (PIN-gated) --------------------------------------

  var verifiedPin = null;   // held only while the panel is open, in memory
  var lockoutTimer = null;

  function resetParentPanel() {
    verifiedPin = null;
    if (lockoutTimer) { clearInterval(lockoutTimer); lockoutTimer = null; }
    $('jr-parent-pin').value = '';
    $('jr-parent-pin').disabled = false;
    $('jr-parent-unlock').disabled = false;
    $('jr-parent-body').hidden = true;
    $('jr-parent-relaunch').hidden = true;
    $('jr-new-pin').value = '';
    showError($('jr-parent-error'), '');
    showError($('jr-pin-note'), '');
  }

  function openParentPanel() {
    resetParentPanel();
    $('jr-parent').hidden = false;
    setBlocked(true);
    $('jr-parent-pin').focus();
  }

  function closeParentPanel() {
    $('jr-parent').hidden = true;
    resetParentPanel();
    setBlocked(false);
  }

  function startLockoutCountdown(seconds) {
    var remaining = Math.max(1, Math.ceil(seconds));
    var pinInput = $('jr-parent-pin');
    var unlockButton = $('jr-parent-unlock');
    pinInput.disabled = true;
    unlockButton.disabled = true;
    function tick() {
      if (remaining <= 0) {
        clearInterval(lockoutTimer);
        lockoutTimer = null;
        pinInput.disabled = false;
        unlockButton.disabled = false;
        showError($('jr-parent-error'), '');
        return;
      }
      showError($('jr-parent-error'), 'Too many tries. Try again in ' + remaining + 's.');
      remaining -= 1;
    }
    if (lockoutTimer) clearInterval(lockoutTimer);
    tick();
    lockoutTimer = setInterval(tick, 1000);
  }

  function unlockParentPanel() {
    var pin = $('jr-parent-pin').value;
    showError($('jr-parent-error'), '');
    window.jarvis.jrParentVerify(pin).then(function (result) {
      if (!result || !result.ok) {
        if (result && result.locked) {
          startLockoutCountdown(result.retryInSeconds || 30);
        } else {
          showError($('jr-parent-error'), 'Wrong PIN.');
        }
        return;
      }
      verifiedPin = pin;
      // getControls(): jr:parent:controls with no patch just reads the
      // current checklist — same PIN-gated call the Save button uses.
      return window.jarvis.jrParentControls(pin).then(function (controlsResult) {
        if (!controlsResult || !controlsResult.ok) {
          showError($('jr-parent-error'), 'Could not load the checklist. Try again.');
          return;
        }
        renderChecklist($('jr-parent-controls'), controlsResult.controls);
        $('jr-parent-body').hidden = false;
      });
    }).catch(function () {
      showError($('jr-parent-error'), 'Could not reach JARVIS JR. Try again.');
    });
  }

  function saveParentControls() {
    if (!verifiedPin) return;
    var patch = readChecklist($('jr-parent-controls'));
    $('jr-parent-relaunch').hidden = true;
    window.jarvis.jrParentControls(verifiedPin, patch).then(function (result) {
      if (!result || !result.ok) {
        showError($('jr-parent-error'), 'Could not save changes. Try again.');
        return;
      }
      renderChecklist($('jr-parent-controls'), result.controls);
      if (result.relaunchNeeded) $('jr-parent-relaunch').hidden = false;
    }).catch(function () {
      showError($('jr-parent-error'), 'Could not save changes. Try again.');
    });
  }

  function saveNewPin() {
    if (!verifiedPin) return;
    var newPin = $('jr-new-pin').value;
    var noteEl = $('jr-pin-note');
    showError(noteEl, '');
    window.jarvis.jrParentPin(verifiedPin, newPin).then(function (result) {
      if (!result || !result.ok) {
        noteEl.className = 'jr-error';
        showError(noteEl, (result && result.reason) || 'Could not change the PIN.');
        return;
      }
      verifiedPin = newPin;
      $('jr-new-pin').value = '';
      noteEl.className = 'jr-note';
      showError(noteEl, 'PIN changed.');
    }).catch(function () {
      noteEl.className = 'jr-error';
      showError(noteEl, 'Could not reach JARVIS JR. Try again.');
    });
  }

  // ---- Top bar: PARENT button replaces Settings in JR ------------------

  function installParentButton() {
    ['settings-button', 'cc-settings'].forEach(function (id) {
      var el = $(id);
      if (el) el.hidden = true;
    });
    ['jr-parent-button', 'jr-parent-button-cc'].forEach(function (id) {
      var el = $(id);
      if (el) {
        el.hidden = false;
        el.addEventListener('click', openParentPanel);
      }
    });
  }

  function bindEvents() {
    $('jr-setup-go').addEventListener('click', submitSetup);
    $('jr-setup-pin').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') submitSetup();
    });

    $('jr-parent-unlock').addEventListener('click', unlockParentPanel);
    $('jr-parent-pin').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') unlockParentPanel();
    });
    $('jr-parent-save-controls').addEventListener('click', saveParentControls);
    $('jr-pin-save').addEventListener('click', saveNewPin);
    $('jr-parent-close').addEventListener('click', closeParentPanel);
  }

  function init(status) {
    if (!status || !status.jr) return; // standard build: nothing in this file ever runs
    bindEvents();
    if (!status.setUp) {
      showSetupOverlay(status.profile);
      return; // refuse to hide until jr:setup:complete succeeds (and relaunches)
    }
    installParentButton();
  }

  window.JrParentUI = { init: init };
})();
