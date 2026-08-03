// JARVIS JR — the kid's side of FAMILY CALLS. One big CALL DAD button on the
// stage, a full-screen ring with the honest auto-answer countdown, and a call
// screen with one big red hang-up. Drives the SAME overlay DOM as the
// grown-up call-ui.js — that file stands down on the JR build (its first
// lines check jrStatus), so exactly one listener ever handles a call event.
//
// The camera rule: the RPS game owns the webcam through JrHandCamera, a
// singleton bound to its own <video>. A call never touches that module —
// it folds the whole game first (JrRpsVoice.teardown() releases every
// track), takes its own getUserMedia, and stops every track on hangup. The
// next "rock paper scissors" chant re-arms the game lens by itself.
(async () => {
  let jr = null;
  try { jr = await window.jarvis?.jrStatus?.(); } catch {}
  if (!jr?.jr || !window.jarvis?.call) return;

  const $ = (id) => document.getElementById(id);
  const callDad = $('jr-call-dad');
  const overlay = $('call-overlay');
  const ring = $('call-ring');
  const ringLabel = $('call-ring-label');
  const countdown = $('call-countdown');
  const autoBanner = $('call-auto-banner');
  const stage = $('call-stage');
  const remoteVideo = $('call-remote');
  const localVideo = $('call-local');
  const timerLabel = $('call-timer');
  const statusLine = $('call-status-line');
  if (!callDad || !overlay) return;

  overlay.classList.add('jr-call');       // kid-sized buttons and text

  let pc = null;
  let localStream = null;
  let currentCallId = null;
  let pendingOffer = null;                // {callId, sdp} while ringing-in
  let timerHandle = null;
  let countdownHandle = null;
  let startedAt = 0;
  let ringOsc = null;

  // ---- presence: the button only exists while Dad's line does --------------
  // call:status throws for the kid whenever the parent switched the calls
  // control off (the IPC gate refuses the channel) — that throw IS the
  // feature flag here, no profile plumbing needed.
  async function refreshPresence() {
    let status = null;
    try { status = await window.jarvis.call.status(); } catch { callDad.hidden = true; return; }
    if (!status.paired) { callDad.hidden = true; return; }
    callDad.hidden = false;
    let online = false;
    try { online = (await window.jarvis.call.ping()).ok; } catch {}
    callDad.classList.toggle('online', online);
    callDad.disabled = !online;
  }
  setInterval(refreshPresence, 20000);
  window.jarvis.onJrProfile?.(() => refreshPresence());
  refreshPresence();

  // ---- ring sound (WebAudio two-tone, no asset) -----------------------------
  function startRingSound() {
    if (ringOsc) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; gain.gain.value = 0.07;
    osc.start();
    const wobble = setInterval(() => { osc.frequency.value = osc.frequency.value === 880 ? 660 : 880; }, 700);
    ringOsc = { ctx, osc, wobble };
  }
  function stopRingSound() {
    if (!ringOsc) return;
    clearInterval(ringOsc.wobble);
    try { ringOsc.osc.stop(); ringOsc.ctx.close(); } catch {}
    ringOsc = null;
  }

  // ---- webrtc ----------------------------------------------------------------
  async function buildPeer() {
    // Fold the game before taking the lens — teardown() stops the hand
    // camera's tracks, kills its worker, and hides the pill.
    try { window.JrRpsVoice?.teardown?.(); } catch {}
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    pc = new RTCPeerConnection({ iceServers: [] });   // Tailscale IS the network
    for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
    pc.ontrack = (event) => { remoteVideo.srcObject = event.streams[0]; };
    pc.onicecandidate = (event) => {
      if (event.candidate && currentCallId) window.jarvis.call.ice(currentCallId, event.candidate.toJSON()).catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (!pc) return;
      if (pc.connectionState === 'connected') showLive();
      if (pc.connectionState === 'failed') endCall('dropped');
    };
  }

  function clearCountdown() {
    if (countdownHandle) { clearInterval(countdownHandle); countdownHandle = null; }
    countdown.hidden = true; countdown.textContent = '';
  }

  function teardown() {
    stopRingSound();
    clearCountdown();
    if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
    if (pc) { try { pc.close(); } catch {} pc = null; }
    if (localStream) { for (const track of localStream.getTracks()) track.stop(); localStream = null; }
    remoteVideo.srcObject = null; localVideo.srcObject = null;
    overlay.hidden = true; ring.hidden = true; stage.hidden = true;
    autoBanner.hidden = true;
    timerLabel.textContent = '0:00';
    currentCallId = null; pendingOffer = null;
  }

  function showLive() {
    ring.hidden = true; stage.hidden = false; overlay.hidden = false;
    statusLine.textContent = '';
    stopRingSound();
    clearCountdown();
    if (!timerHandle) {
      startedAt = Date.now();
      timerHandle = setInterval(() => {
        const s = Math.floor((Date.now() - startedAt) / 1000);
        timerLabel.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      }, 1000);
    }
  }

  async function dialDad() {
    if (pc) return;
    overlay.hidden = false; ring.hidden = true; stage.hidden = true;
    statusLine.textContent = 'Calling Dad…';
    try {
      await buildPeer();
    } catch {
      statusLine.textContent = "The camera isn't working right now. Ask a grown-up to check it.";
      setTimeout(() => { if (!pc) overlay.hidden = true; }, 3500);
      return;
    }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    let result = { ok: false, reason: "Couldn't reach Dad's PC." };
    try { result = await window.jarvis.call.dial(offer.sdp); } catch {}
    if (!result.ok) {
      teardown();
      overlay.hidden = false;
      statusLine.textContent = result.reason === 'busy' ? "Dad's line is busy." : "Dad's PC isn't answering right now. Try again in a bit.";
      setTimeout(() => { if (!pc) overlay.hidden = true; }, 3500);
      return;
    }
    currentCallId = result.callId;
  }

  async function answerCall({ auto = false } = {}) {
    if (!pendingOffer || pc) return;
    const { callId, sdp } = pendingOffer;
    currentCallId = callId;
    stopRingSound();
    clearCountdown();
    if (auto) autoBanner.hidden = false;   // the kid always knows the camera turned on
    try {
      await buildPeer();
    } catch {
      try { await window.jarvis.call.hangup(callId, 'no-media'); } catch {}
      teardown(); return;
    }
    await pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    try { await window.jarvis.call.answer(callId, answer.sdp); } catch { endCall('dropped'); }
  }

  function endCall(reason) {
    if (currentCallId) window.jarvis.call.hangup(currentCallId, reason || 'hangup').catch(() => {});
    teardown();
  }

  // ---- buttons ----------------------------------------------------------------
  callDad.addEventListener('click', dialDad);
  $('call-answer').addEventListener('click', () => answerCall());
  $('call-decline').addEventListener('click', () => {
    if (pendingOffer) window.jarvis.call.hangup(pendingOffer.callId, 'declined').catch(() => {});
    teardown();
  });
  $('call-end').addEventListener('click', () => endCall('hangup'));
  $('call-mute').addEventListener('click', (event) => {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    event.target.textContent = track.enabled ? 'MUTE' : 'UNMUTE';
  });

  // ---- events from main -----------------------------------------------------
  window.jarvis.call.onEvent(async (event) => {
    if (event.type === 'incoming') {
      pendingOffer = { callId: event.callId, sdp: event.sdp };
      ringLabel.textContent = '📞 DAD IS CALLING';
      overlay.hidden = false; ring.hidden = false; stage.hidden = true;
      statusLine.textContent = '';
      startRingSound();
      if (event.autoAnswerAt) {
        countdown.hidden = false;
        const tick = () => {
          const left = Math.max(0, Math.ceil((event.autoAnswerAt - Date.now()) / 1000));
          countdown.textContent = `Answering by itself in ${left}…`;
        };
        tick();
        countdownHandle = setInterval(tick, 500);
      }
    }
    if (event.type === 'auto-answer') answerCall({ auto: true });
    if (event.type === 'answered' && pc) {
      await pc.setRemoteDescription({ type: 'answer', sdp: event.sdp });
    }
    if (event.type === 'ice' && pc && event.candidate) {
      try { await pc.addIceCandidate(event.candidate); } catch {}
    }
    if (event.type === 'ended' || event.type === 'missed') teardown();
    if (event.type === 'ring-timeout') {
      teardown();
      overlay.hidden = false;
      statusLine.textContent = "Dad's busy — try again in a bit.";
      setTimeout(() => { if (!pc) overlay.hidden = true; }, 3000);
    }
    if (event.type === 'paired' || event.type === 'server-status') refreshPresence();
  });
})();
