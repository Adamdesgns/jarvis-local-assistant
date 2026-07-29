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
  var pendingBlinkAccount = '';  // Blink account awaiting its emailed PIN
  var pendingRing = null;        // {email, password} held between Ring's 2FA round-trip

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
    resetCameraForms();
  }

  // ---- Parent panel: cameras (accounts are managed ONLY here — see the
  // design spec's "The grown-up panel") ---------------------------------

  function resetCameraForms() {
    $('jr-cameras-list').innerHTML = '';
    $('jr-cam-rtsp-name').value = '';
    $('jr-cam-rtsp-url').value = '';
    $('jr-cam-blink-email').value = '';
    $('jr-cam-blink-password').value = '';
    $('jr-cam-blink-pin').value = '';
    $('jr-cam-blink-pin-row').hidden = true;
    pendingBlinkAccount = '';
    $('jr-cam-ring-email').value = '';
    $('jr-cam-ring-password').value = '';
    $('jr-cam-ring-code').value = '';
    $('jr-cam-ring-code-row').hidden = true;
    pendingRing = null;
    $('jr-cam-nest-project').value = '';
    $('jr-cam-nest-client-id').value = '';
    $('jr-cam-nest-client-secret').value = '';
    showError($('jr-cam-status'), '');
  }

  // Whether the account form shows at all depends on the "Cameras" checklist
  // item, not on anything in this file: jr:parent:cameras refuses every
  // mutating action with `cameras` off (main.js — CameraService is never
  // constructed unless PROFILE.cameras is true), so there is nothing useful
  // for the form to do until a parent turns that on, saves, and relaunches.
  // The list itself still works either way (see loadCameraAccounts).
  function updateCamerasVisibility(controls) {
    var camerasOn = Boolean(controls && controls.cameras);
    $('jr-cameras-add').hidden = !camerasOn;
    showError($('jr-cameras-off-note'), camerasOn ? '' :
      'Turn on Cameras above, save, and relaunch JARVIS JR to add or remove accounts here.');
  }

  function renderCameraAccounts(accounts) {
    var list = $('jr-cameras-list');
    list.innerHTML = '';
    if (!accounts || !accounts.length) {
      var none = document.createElement('p');
      none.className = 'jr-camera-none';
      none.textContent = 'No camera accounts yet.';
      list.appendChild(none);
      return;
    }
    accounts.forEach(function (account) {
      var row = document.createElement('div');
      row.className = 'jr-camera-row';
      row.innerHTML = '<div><b></b><span></span></div><button type="button" class="jr-camera-remove">Remove</button>';
      row.querySelector('b').textContent = account.name || account.brand;
      row.querySelector('span').textContent = account.brand;
      var removeButton = row.querySelector('.jr-camera-remove');
      var confirmTimer = null;
      removeButton.addEventListener('click', function () {
        if (!removeButton.classList.contains('confirming')) {
          removeButton.classList.add('confirming');
          removeButton.textContent = 'Tap again';
          confirmTimer = setTimeout(function () {
            removeButton.classList.remove('confirming');
            removeButton.textContent = 'Remove';
            confirmTimer = null;
          }, 4000);
          return;
        }
        if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; }
        removeCameraAccount(account.id);
      });
      list.appendChild(row);
    });
  }

  function loadCameraAccounts() {
    if (!verifiedPin) return;
    window.jarvis.jrParentCameras(verifiedPin, 'list').then(function (result) {
      renderCameraAccounts(result && result.ok ? result.accounts : []);
    }).catch(function () {
      renderCameraAccounts([]);
    });
  }

  function removeCameraAccount(accountId) {
    if (!verifiedPin) return;
    window.jarvis.jrParentCameras(verifiedPin, 'remove-account', accountId).then(function (result) {
      if (!result || !result.ok) {
        showError($('jr-cam-status'), (result && result.message) || 'Could not remove that account.');
        return;
      }
      loadCameraAccounts();
    }).catch(function () {
      showError($('jr-cam-status'), 'Could not reach JARVIS JR. Try again.');
    });
  }

  function bindCameraEvents() {
    document.querySelectorAll('#jr-cameras [data-jr-cam-brand]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('#jr-cameras [data-jr-cam-brand]').forEach(function (other) {
          other.classList.toggle('active', other === tab);
        });
        ['rtsp', 'blink', 'ring', 'nest'].forEach(function (brand) {
          $('jr-cam-pane-' + brand).hidden = brand !== tab.dataset.jrCamBrand;
        });
        showError($('jr-cam-status'), '');
      });
    });

    $('jr-cam-rtsp-add').addEventListener('click', function () {
      if (!verifiedPin) return;
      var name = $('jr-cam-rtsp-name').value.trim() || 'My cameras';
      var url = $('jr-cam-rtsp-url').value.trim();
      showError($('jr-cam-status'), '');
      window.jarvis.jrParentCameras(verifiedPin, 'add-rtsp', { name: name, cameras: [{ name: name, url: url }] })
        .then(function (result) {
          if (!result || !result.ok) { showError($('jr-cam-status'), (result && result.message) || 'Could not add that camera.'); return; }
          $('jr-cam-rtsp-name').value = '';
          $('jr-cam-rtsp-url').value = '';
          loadCameraAccounts();
        }).catch(function () { showError($('jr-cam-status'), 'Could not reach JARVIS JR. Try again.'); });
    });

    $('jr-cam-blink-signin').addEventListener('click', function () {
      if (!verifiedPin) return;
      showError($('jr-cam-status'), '');
      var payload = { email: $('jr-cam-blink-email').value, password: $('jr-cam-blink-password').value };
      window.jarvis.jrParentCameras(verifiedPin, 'add-blink', payload).then(function (result) {
        $('jr-cam-blink-password').value = '';
        if (!result || !result.ok) { showError($('jr-cam-status'), (result && result.message) || 'Blink sign-in failed.'); return; }
        if (result.needsPin) {
          pendingBlinkAccount = result.accountId;
          $('jr-cam-blink-pin-row').hidden = false;
          showError($('jr-cam-status'), result.message || 'Blink emailed a PIN. Enter it below to finish.');
          return;
        }
        $('jr-cam-blink-email').value = '';
        loadCameraAccounts();
      }).catch(function () { showError($('jr-cam-status'), 'Could not reach JARVIS JR. Try again.'); });
    });

    $('jr-cam-blink-verify').addEventListener('click', function () {
      if (!verifiedPin || !pendingBlinkAccount) return;
      window.jarvis.jrParentCameras(verifiedPin, 'blink-pin', { accountId: pendingBlinkAccount, pin: $('jr-cam-blink-pin').value })
        .then(function (result) {
          showError($('jr-cam-status'), (result && result.message) || '');
          if (result && result.ok) {
            pendingBlinkAccount = '';
            $('jr-cam-blink-pin').value = '';
            $('jr-cam-blink-pin-row').hidden = true;
            loadCameraAccounts();
          }
        }).catch(function () { showError($('jr-cam-status'), 'Could not reach JARVIS JR. Try again.'); });
    });

    function ringSignIn(code) {
      if (!verifiedPin) return;
      showError($('jr-cam-status'), '');
      var base = pendingRing || { email: $('jr-cam-ring-email').value, password: $('jr-cam-ring-password').value };
      var payload = { email: base.email, password: base.password, code: code };
      window.jarvis.jrParentCameras(verifiedPin, 'add-ring', payload).then(function (result) {
        if (!result || !result.ok) {
          showError($('jr-cam-status'), (result && result.message) || 'Ring sign-in failed.');
          pendingRing = null;
          $('jr-cam-ring-password').value = '';
          $('jr-cam-ring-code-row').hidden = true;
          return;
        }
        if (result.needs2fa) {
          pendingRing = base;
          $('jr-cam-ring-code-row').hidden = false;
          showError($('jr-cam-status'), result.message || 'Enter the code Ring sent you.');
          return;
        }
        pendingRing = null;
        $('jr-cam-ring-password').value = '';
        $('jr-cam-ring-code').value = '';
        $('jr-cam-ring-code-row').hidden = true;
        loadCameraAccounts();
      }).catch(function () { showError($('jr-cam-status'), 'Could not reach JARVIS JR. Try again.'); });
    }
    $('jr-cam-ring-signin').addEventListener('click', function () { ringSignIn(''); });
    $('jr-cam-ring-verify').addEventListener('click', function () { ringSignIn($('jr-cam-ring-code').value); });

    $('jr-cam-nest-signin').addEventListener('click', function () {
      if (!verifiedPin) return;
      showError($('jr-cam-status'), 'Opening Google sign-in in your browser… approve JARVIS there, then come back.');
      window.jarvis.jrParentCameras(verifiedPin, 'add-nest', {
        projectId: $('jr-cam-nest-project').value,
        clientId: $('jr-cam-nest-client-id').value,
        clientSecret: $('jr-cam-nest-client-secret').value
      }).then(function (result) {
        showError($('jr-cam-status'), (result && result.message) || '');
        if (result && result.ok) {
          $('jr-cam-nest-client-secret').value = '';
          loadCameraAccounts();
        }
      }).catch(function () { showError($('jr-cam-status'), 'Could not reach JARVIS JR. Try again.'); });
    });
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
        updateCamerasVisibility(controlsResult.controls);
        loadCameraAccounts();
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
      updateCamerasVisibility(result.controls);
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
    bindCameraEvents();
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
