// Realign a WebRTC answer's media sections to the order of the offer.
//
// Ring's live view was dead on real hardware with:
//   "Failed to set remote answer sdp: The order of m-lines in answer doesn't
//    match order in offer. Rejecting answer."
// JARVIS offers datachannel -> video -> audio (cameras-ui.js); Ring's cloud
// answers with those same sections in its own order. WebRTC pairs m-lines by
// POSITION, not by name, so Chromium rejects the entire answer.
//
// The fix moves the ANSWER, never the offer: the offer's order is what the Nest
// path (which requires the datachannel first) and go2rtc already negotiate
// happily, so touching it would risk two working cameras to fix one.
//
// Dual export like orb-voice.js — node:test requires it, the browser loads it
// as a classic <script> and reads window.SdpAlign. Pure string work; nothing
// here touches a DOM or an RTCPeerConnection.
(function () {
  const MID = 'a=mid:';

  // Session part first, then one entry per m= section, each kept whole so a
  // section's attribute lines travel with it.
  function split(lines) {
    const session = [];
    const sections = [];
    for (const line of lines) {
      if (line.startsWith('m=')) sections.push([line]);
      else if (sections.length) sections[sections.length - 1].push(line);
      else session.push(line);
    }
    return { session, sections };
  }

  const kind = (section) => section[0].slice(2).split(' ')[0];
  const mid = (section) => {
    const line = section.find((entry) => entry.startsWith(MID));
    return line ? line.slice(MID.length).trim() : '';
  };

  function alignAnswerToOffer(offerSdp, answerSdp) {
    if (typeof offerSdp !== 'string' || typeof answerSdp !== 'string') return answerSdp;
    if (!answerSdp) return answerSdp;

    const offer = split(offerSdp.split(/\r?\n/));
    const answer = split(answerSdp.split(/\r?\n/));
    // Same sections in a different order is the only case reordering can fix.
    // A different count means a missing m-line, a genuinely different problem
    // whose Chromium error is clearer than anything this could produce.
    if (!answer.sections.length || answer.sections.length !== offer.sections.length) return answerSdp;

    const remaining = [...answer.sections];
    const ordered = [];
    for (const wanted of offer.sections) {
      const wantedMid = mid(wanted);
      // Prefer the mid — it is what the two sides actually agreed to name the
      // section. Media type is the fallback for answers that omit mids.
      let index = wantedMid ? remaining.findIndex((section) => mid(section) === wantedMid) : -1;
      if (index === -1) index = remaining.findIndex((section) => kind(section) === kind(wanted));
      if (index === -1) return answerSdp;
      ordered.push(remaining.splice(index, 1)[0]);
    }

    // The BUNDLE group lists mids in m-line order, so it has to follow.
    const mids = ordered.map(mid).filter(Boolean);
    const session = answer.session.map((line) => (line.startsWith('a=group:BUNDLE') && mids.length
      ? `a=group:BUNDLE ${mids.join(' ')}`
      : line));

    const eol = answerSdp.includes('\r\n') ? '\r\n' : '\n';
    return [...session, ...ordered.flat()].join(eol);
  }

  const api = { alignAnswerToOffer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SdpAlign = api;
})();
