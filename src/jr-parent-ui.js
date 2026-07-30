'use strict';

// JARVIS JR — renderer side of the parent gate. Two things only:
//
//   1. The blocking first-run setup sheet a kid cannot dismiss.
//   2. The PIN sheet, whose ONLY job is to open the REAL settings dialog.
//
// It used to own a bespoke parent panel (its own checklist, its own camera
// forms, its own PIN plumbing) — that was the mistake this build corrects.
// JR is the real JARVIS with kid limitations added, so the parent gets the
// real settings dialog: the checklist lives in its JARVIS JR tab, cameras in
// the real cameras tab, everything else where it always was.
//
// The PIN is never held here. A successful jr:parent:verify opens a session
// in the MAIN process (core/parent-session.js); the renderer only learns that
// it is open. Nothing in this file can forge that.
//
// Plain script, no modules, same style as renderer.js: window.JrParentUI is
// the only global. init(status) runs once from renderer.js's boot and only
// when jr:status answered { jr: true } — on the standard build this file
// loads and nothing in it ever runs.

(function () {
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

  // Display copy comes from core/variant.js (CONTROL_KEYS + CONTROL_LABELS),
  // which index.html loads as a classic script before this one — no
  // hand-maintained mirror to drift any more.
  function renderChecklist(container, controls) {
    var keys = (window.JrVariant && window.JrVariant.CONTROL_KEYS) || [];
    var labels = (window.JrVariant && window.JrVariant.CONTROL_LABELS) || {};
    container.innerHTML = '';
    keys.forEach(function (key) {
      var row = document.createElement('label');
      row.className = 'toggle-row';
      row.innerHTML = '<span><b></b></span><input type="checkbox" data-jr-key="' + key + '"><i></i>';
      row.querySelector('b').textContent = labels[key] || key;
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
      // No relaunch any more: nothing is BUILT from the profile, so main.js
      // applies the new checklist in place and pushes it to the renderer.
      $('jr-setup').hidden = true;
      setBlocked(false);
      installParentButton();
      button.disabled = false;
    }).catch(function () {
      showError(errorEl, 'Could not reach JARVIS JR. Try again.');
      button.disabled = false;
    });
  }

  // ---- PIN sheet: the door to the real settings dialog ----------------

  var lockoutTimer = null;

  function resetPinSheet() {
    if (lockoutTimer) { clearInterval(lockoutTimer); lockoutTimer = null; }
    $('jr-parent-pin').value = '';
    $('jr-parent-pin').disabled = false;
    $('jr-parent-unlock').disabled = false;
    showError($('jr-parent-error'), '');
  }

  function openPinSheet() {
    resetPinSheet();
    $('jr-parent').hidden = false;
    setBlocked(true);
    $('jr-parent-pin').focus();
  }

  function closePinSheet() {
    $('jr-parent').hidden = true;
    resetPinSheet();
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

  function unlockParentSettings() {
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
      // The session is open in the main process. Hand the parent the real
      // dialog — renderer.js reads the session state and renders every tab.
      closePinSheet();
      if (window.JrOpenSettings) window.JrOpenSettings('jr', result.session);
    }).catch(function () {
      showError($('jr-parent-error'), 'Could not reach JARVIS JR. Try again.');
    });
  }

  // ---- Top bar: PARENT button sits beside the kid's own gear -----------

  // The kid keeps a settings button — it opens a LOOKS-only dialog (orb,
  // colours, animation), which is theirs to play with. PARENT is the PIN
  // door beside it.
  function installParentButton() {
    ['jr-parent-button', 'jr-parent-button-cc'].forEach(function (id) {
      var el = $(id);
      if (el) {
        el.hidden = false;
        el.addEventListener('click', openPinSheet);
      }
    });
  }

  function bindEvents() {
    $('jr-setup-go').addEventListener('click', submitSetup);
    $('jr-setup-pin').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') submitSetup();
    });
    $('jr-parent-unlock').addEventListener('click', unlockParentSettings);
    $('jr-parent-pin').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') unlockParentSettings();
    });
    $('jr-parent-close').addEventListener('click', closePinSheet);
  }

  function init(status) {
    if (!status || !status.jr) return; // standard build: nothing here ever runs
    bindEvents();
    if (!status.setUp) {
      showSetupOverlay(status.profile);
      return; // refuse to hide until jr:setup:complete succeeds
    }
    installParentButton();
  }

  window.JrParentUI = { init: init };
})();
