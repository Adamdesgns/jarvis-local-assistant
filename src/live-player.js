// Playing a camera's live view into a <video>, independent of where that video
// element lives.
//
// Extracted when cameras gained pop-out windows (spec:
// 2026-08-04-camera-windows-design): the grid tile and the pop-out window both
// need this, and two copies of WebRTC negotiation would drift — the Ring m-line
// bug fixed earlier the same day would have had to be fixed twice.
//
// Three transports, decided by the main process in openLiveView:
//   sdp-bridge — Ring/Nest: our offer goes to the cloud, its answer comes back
//   whep       — local RTSP through go2rtc
//   mpegts     — Blink: its own protocol, already MPEG-TS, played via MediaSource
//
// Dual export like orb-voice.js. Nothing here reads the DOM beyond the <video>
// it is handed, and it never touches tile chrome — the caller owns its own UI.
(function () {
  const REDIRECT_TIMEOUT_MS = 2000;

  async function playWebrtc({ video, camera, live }) {
    const peer = new RTCPeerConnection();
    try {
      // Nest's WebRTC endpoint requires a data channel in the offer. It is NOT
      // harmless elsewhere: Ring never answers a datachannel section, and an
      // offered m-line the answer does not account for makes Chromium reject the
      // whole answer. So it is offered only where it is needed.
      if (camera.brand === 'nest') peer.createDataChannel('jarvis');
      peer.addTransceiver('video', { direction: 'recvonly' });
      peer.addTransceiver('audio', { direction: 'recvonly' });
      peer.ontrack = (event) => { video.srcObject = event.streams[0]; };
      await peer.setLocalDescription(await peer.createOffer());
      await new Promise((resolve) => {
        if (peer.iceGatheringState === 'complete') return resolve();
        peer.addEventListener('icegatheringstatechange', () => {
          if (peer.iceGatheringState === 'complete') resolve();
        });
        setTimeout(resolve, REDIRECT_TIMEOUT_MS);
      });

      let answerSdp;
      if (live.mode === 'sdp-bridge') {
        const bridged = await window.jarvis.cameras.liveAnswer(camera.key, peer.localDescription.sdp);
        if (!bridged.ok) throw new Error(bridged.message || 'live view refused');
        answerSdp = bridged.answerSdp;
      } else {
        const response = await fetch(live.whepUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: peer.localDescription.sdp
        });
        if (!response.ok) throw new Error(`helper answered ${response.status}`);
        answerSdp = await response.text();
      }

      // Ring answers with its media sections in its own order, which WebRTC
      // rejects outright (it pairs m-lines by position). An answer that already
      // matches passes through untouched.
      const aligned = window.SdpAlign
        ? window.SdpAlign.alignAnswerToOffer(peer.localDescription.sdp, answerSdp)
        : answerSdp;
      try {
        await peer.setRemoteDescription({ type: 'answer', sdp: aligned });
      } catch (error) {
        // Chromium reports a shuffled answer and a short one with the same
        // sentence, and the difference decides the fix, so carry the shapes
        // rather than needing devtools open to find out.
        const shape = window.SdpAlign
          ? `offer=[${window.SdpAlign.mediaKinds(peer.localDescription.sdp)}] `
            + `answer=[${window.SdpAlign.mediaKinds(aligned)}]`
          : 'sdp-align.js did not load';
        throw new Error(`${error.message} (${shape})`);
      }
      return {
        stop() {
          try { peer.close(); } catch { /* already closed */ }
          video.srcObject = null;
        }
      };
    } catch (error) {
      try { peer.close(); } catch { /* already closed */ }
      throw error;
    }
  }

  // Blink: MPEG-TS on a localhost URL. Chromium cannot play a transport stream
  // natively, which is what mpegts.js is for; no transcoding, no ffmpeg.
  async function playMpegts({ video, live, onError }) {
    if (!window.mpegts?.isSupported()) throw new Error('this build cannot play Blink video');
    const player = window.mpegts.createPlayer(
      { type: 'mpegts', isLive: true, url: live.streamUrl },
      // No workers from a file:// page; latency chasing stops a stalled view
      // from sitting minutes behind real time.
      { enableWorker: false, liveBufferLatencyChasing: true }
    );
    player.on(window.mpegts.Events.ERROR, (type, detail) => onError?.(detail || type));
    player.attachMediaElement(video);
    player.load();
    await player.play();
    return {
      stop() {
        // Destroy detaches too; skipping it leaves the element wired to a dead
        // MediaSource and the next play() on this camera silently does nothing.
        try { player.destroy(); } catch { /* already gone */ }
        video.removeAttribute('src');
      }
    };
  }

  // `live` is the result of window.jarvis.cameras.liveStart(). Returns a handle
  // with stop(); throws with a human-readable message on failure.
  function play({ video, camera, live, onError }) {
    return live.mode === 'mpegts'
      ? playMpegts({ video, live, onError })
      : playWebrtc({ video, camera, live });
  }

  const api = { play };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.LivePlayer = api;
})();
