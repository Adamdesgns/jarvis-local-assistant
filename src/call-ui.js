// The dad-side call surface: presence, dialing, ringing, and the live call.
// WebRTC does the heavy lifting; this file's job is honest state on screen
// and cleaning up EVERY track on the way out — the camera light going off
// when the call ends is a feature people actually check.
(async () => {
  // On the JR build this file stands down entirely — the kid's call surface
  // is src/jr-call-ui.js (Call Dad on the stage, big ring, auto-answer). Two
  // listeners on the same call events would double-answer a single ring.
  try {
    const jr = await window.jarvis?.jrStatus?.();
    if (jr?.jr) return;
  } catch {}
  const panel = document.getElementById('jr-panel');
  const presenceDot = document.getElementById('jr-presence');
  const presenceLabel = document.getElementById('jr-presence-label');
  const callButton = document.getElementById('jr-call-button');
  const overlay = document.getElementById('call-overlay');
  const ring = document.getElementById('call-ring');
  const ringLabel = document.getElementById('call-ring-label');
  const stage = document.getElementById('call-stage');
  const remoteVideo = document.getElementById('call-remote');
  const localVideo = document.getElementById('call-local');
  const timerLabel = document.getElementById('call-timer');
  const statusLine = document.getElementById('call-status-line');
  if (!panel || !window.jarvis?.call) return;

  let pc = null;              // RTCPeerConnection
  let localStream = null;
  let currentCallId = null;
  let pendingOffer = null;    // {callId, sdp} while ringing-in
  let timerHandle = null;
  let startedAt = 0;
  let ringOsc = null;

  // ---- presence -------------------------------------------------------
  async function refreshPresence() {
    const status = await window.jarvis.call.status();
    if (!status.paired) { panel.hidden = true; return; }
    panel.hidden = false;
    callButton.textContent = `📞 CALL ${status.peerName.toUpperCase()}`;
    const ping = await window.jarvis.call.ping();
    const online = ping.ok;
    presenceDot.classList.toggle('online', online);
    presenceLabel.textContent = online ? `${status.peerName} is online` : `${status.peerName} is offline`;
    callButton.disabled = !online;
  }
  setInterval(refreshPresence, 20000);
  refreshPresence();

  // ---- ring sound: two-tone via WebAudio, no asset needed ---------------
  function startRingSound() {
    if (ringOsc) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; gain.gain.value = 0.06;
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

  // ---- webrtc -----------------------------------------------------------
  async function buildPeer() {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    pc = new RTCPeerConnection({ iceServers: [] });   // Tailscale is the network; no STUN
    for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
    pc.ontrack = (event) => { remoteVideo.srcObject = event.streams[0]; };
    pc.onicecandidate = (event) => {
      if (event.candidate && currentCallId) window.jarvis.call.ice(currentCallId, event.candidate.toJSON());
    };
    pc.onconnectionstatechange = () => {
      if (!pc) return;
      if (pc.connectionState === 'connected') showLive();
      if (pc.connectionState === 'failed') endCall('dropped');
    };
  }

  function teardown() {
    stopRingSound();
    if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
    if (pc) { try { pc.close(); } catch {} pc = null; }
    if (localStream) { for (const track of localStream.getTracks()) track.stop(); localStream = null; }
    remoteVideo.srcObject = null; localVideo.srcObject = null;
    overlay.hidden = true; ring.hidden = true; stage.hidden = true;
    timerLabel.textContent = '0:00';
    currentCallId = null; pendingOffer = null;
  }

  function showLive() {
    ring.hidden = true; stage.hidden = false; overlay.hidden = false;
    statusLine.textContent = '';
    stopRingSound();
    if (!timerHandle) {
      startedAt = Date.now();
      timerHandle = setInterval(() => {
        const s = Math.floor((Date.now() - startedAt) / 1000);
        timerLabel.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      }, 1000);
    }
  }

  async function dial() {
    if (pc) return;
    overlay.hidden = false; ring.hidden = true; stage.hidden = true;
    statusLine.textContent = 'Calling…';
    try {
      await buildPeer();
    } catch {
      statusLine.textContent = 'No camera or microphone on this PC — plug one in and try again.';
      setTimeout(() => { if (!pc) overlay.hidden = true; }, 3000);
      return;
    }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const result = await window.jarvis.call.dial(offer.sdp);
    if (!result.ok) {
      statusLine.textContent = result.reason;
      teardown();
      overlay.hidden = false;
      setTimeout(() => { if (!pc) overlay.hidden = true; }, 3000);
      return;
    }
    currentCallId = result.callId;
  }

  async function answerCall() {
    if (!pendingOffer) return;
    const { callId, sdp } = pendingOffer;
    currentCallId = callId;
    stopRingSound();
    try {
      await buildPeer();
    } catch {
      await window.jarvis.call.hangup(callId, 'no-media');
      teardown(); return;
    }
    await pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await window.jarvis.call.answer(callId, answer.sdp);
  }

  function endCall(reason) {
    if (currentCallId) window.jarvis.call.hangup(currentCallId, reason || 'hangup');
    teardown();
  }

  // ---- buttons -------------------------------------------------------------
  callButton.addEventListener('click', dial);
  document.getElementById('call-answer').addEventListener('click', answerCall);
  document.getElementById('call-decline').addEventListener('click', () => {
    if (pendingOffer) window.jarvis.call.hangup(pendingOffer.callId, 'declined');
    teardown();
  });
  document.getElementById('call-end').addEventListener('click', () => endCall('hangup'));
  document.getElementById('call-mute').addEventListener('click', (event) => {
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
      const status = await window.jarvis.call.status();
      ringLabel.textContent = `${status.peerName || 'JR'} is calling`;
      overlay.hidden = false; ring.hidden = false; stage.hidden = true;
      statusLine.textContent = '';
      startRingSound();
    }
    if (event.type === 'answered' && pc) {
      await pc.setRemoteDescription({ type: 'answer', sdp: event.sdp });
    }
    if (event.type === 'ice' && pc && event.candidate) {
      try { await pc.addIceCandidate(event.candidate); } catch {}
    }
    if (event.type === 'ended' || event.type === 'missed') teardown();
    if (event.type === 'ring-timeout') {
      teardown();
      statusLine.textContent = 'No answer.';
      overlay.hidden = false;
      setTimeout(() => { if (!pc) overlay.hidden = true; }, 2500);
    }
    if (event.type === 'paired') refreshPresence();
  });
})();
