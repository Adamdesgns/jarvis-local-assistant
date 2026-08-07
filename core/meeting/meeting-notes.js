// The rolling summary shown in the panel. This is the only component that
// calls the model on a timer, so it is also the only place that can quietly
// run up a bill or hammer the API — hence the two guards: an interval, and a
// transcript-length check so an idle stretch of silence costs nothing.
//
// `now` is injected so the interval is testable without waiting two minutes.

const MAX_TRANSCRIPT_CHARS = 6000;

class MeetingNotes {
  constructor({ ai, transcript, intervalMs = 120000, now = Date.now }) {
    this.ai = ai;
    this.transcript = transcript;
    this.intervalMs = intervalMs;
    this.now = now;
    this.latest = '';
    this.lastError = null;
    this.lastRunAt = now();
    this.lastSegmentCount = 0;
  }

  async maybeRefresh() {
    if (this.transcript.isEmpty) return false;
    if (this.transcript.segmentCount === this.lastSegmentCount) return false;
    if (this.now() - this.lastRunAt < this.intervalMs) return false;

    this.lastRunAt = this.now();
    this.lastSegmentCount = this.transcript.segmentCount;

    const prompt = [
      'You are keeping live notes on a call that is still happening.',
      '',
      'Rewrite the notes below to take account of what has been said since.',
      'Keep it to three short sections and nothing else:',
      'COVERED — what has been discussed.',
      'COMMITTED — anything I said I would do.',
      'OPEN — questions asked that have not been answered yet.',
      '',
      'Notes so far:',
      this.latest || '(nothing yet)',
      '',
      'Transcript:',
      this.transcript.recentText(MAX_TRANSCRIPT_CHARS)
    ].join('\n');

    try {
      const result = await this.ai.cloudReply(prompt, { skipHistory: true });
      if (result && result.ok !== false && result.text) {
        this.latest = String(result.text).trim();
        this.lastError = null;
      }
    } catch (error) {
      // Deliberately swallowed. The spec's rule is that nothing takes down the
      // meeting: transcription continues, the previous notes stay on screen,
      // and the panel shows this string.
      this.lastError = error.message || String(error);
    }
    return true;
  }
}

module.exports = { MeetingNotes, MAX_TRANSCRIPT_CHARS };
