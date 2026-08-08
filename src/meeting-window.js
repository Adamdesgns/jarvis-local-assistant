const notesEl = document.getElementById('notes');
const warnEl = document.getElementById('warning');
const answerEl = document.getElementById('answer');
const questionEl = document.getElementById('question');

// `meeting-error` (mic/VAD never came up) arrives over its own event, not as
// a field on the pushed state, and a start failure looks — on the state
// alone — identical to a meeting where nobody has spoken yet. This latch is
// what keeps that message on screen across the `meeting:state` pushes that
// keep arriving after it, until a meeting actually goes active again.
let meetingError = '';
// Last state seen, so a `meeting-error` event (which carries no state of its
// own) can be layered on top of it without blanking notes/warning/etc.
let lastState = {};

// The state pushed on `meeting:state` is `{ active, dir, notes, notesError,
// storeError, segments, warning }` — there is no single `error` field on it.
// `notesError` (the model is failing, recording is fine, keep talking) and
// `storeError` (the transcript has stopped hitting disk, this needs
// attention now) are two different emergencies and must stay on separate
// lines rather than collapse into one message the user has to parse.
function render(state) {
  lastState = state || {};
  notesEl.textContent = lastState.notes || 'Listening — notes appear after the first refresh.';

  if (lastState.active) meetingError = '';

  const lines = [];
  if (lastState.storeError) lines.push(`Not saving to disk: ${lastState.storeError}`);
  if (lastState.notesError) lines.push(`Notes paused: ${lastState.notesError}`);
  if (lastState.warning) lines.push(lastState.warning);
  if (meetingError) lines.push(meetingError);
  warnEl.textContent = lines.join('\n');
}

window.jarvis.onMeetingState(render);

// Surfaced separately: without this, a meeting that failed to get a
// microphone or VAD going looks exactly like a quiet meeting, which is the
// failure mode meeting mode exists to avoid on a live call. Re-renders the
// last known state so this doesn't blank out notes/warning already on screen.
window.jarvis.onMeetingError((payload) => {
  meetingError = `Meeting error: ${(payload && payload.message) || 'could not start.'}`;
  render(lastState);
});

questionEl.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter') return;
  const question = questionEl.value.trim();
  if (!question) return;
  questionEl.value = '';
  answerEl.textContent = 'Thinking…';
  try {
    const reply = await window.jarvis.askMeeting(question);
    answerEl.textContent = (reply && reply.text) || 'No answer.';
  } catch (error) {
    answerEl.textContent = `Could not answer: ${error.message}`;
  }
});

window.jarvis.meetingState().then(render);
