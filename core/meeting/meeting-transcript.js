// The running record of one meeting, in memory. Deliberately not a store: this
// holds text and hands out windows of it. Writing to disk is meeting-store's
// job, and keeping the two apart is what lets every prompt-shaping decision
// here be unit-tested without touching the filesystem.
class MeetingTranscript {
  constructor() {
    this.segments = [];
  }

  get segmentCount() { return this.segments.length; }

  get isEmpty() { return this.segments.length === 0; }

  // Blank segments happen: whisper returns '' for a cough that cleared the VAD
  // gate. Storing them would pad the prompt with empty lines for no reason.
  append(text) {
    const clean = typeof text === 'string' ? text.trim() : '';
    if (!clean) return false;
    this.segments.push(clean);
    return true;
  }

  fullText() { return this.segments.join('\n'); }

  // The tail of the conversation, under maxChars, cut on segment boundaries so
  // a prompt never opens mid-sentence. If the newest segment alone busts the
  // budget it is still returned whole — an over-long prompt is recoverable, an
  // empty one silently answers from nothing.
  recentText(maxChars) {
    if (this.segments.length === 0) return '';
    const kept = [];
    let used = 0;
    for (let i = this.segments.length - 1; i >= 0; i -= 1) {
      const seg = this.segments[i];
      const cost = seg.length + (kept.length ? 1 : 0);
      if (used + cost > maxChars && kept.length) break;
      kept.unshift(seg);
      used += cost;
    }
    return kept.join('\n');
  }
}

module.exports = { MeetingTranscript };
