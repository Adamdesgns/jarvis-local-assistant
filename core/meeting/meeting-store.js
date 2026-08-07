const fs = require('node:fs');
const path = require('node:path');

// Stamped at the top of every notes file. It travels with the document: the
// notes are the artefact that gets emailed or pasted somewhere months later,
// long after anyone remembers how they were produced.
const CONSENT_LINE =
  '> Transcribed live by JARVIS. This record includes another person\'s speech.\n';

const pad = (n) => String(n).padStart(2, '0');

// Local time, never UTC — "the 2:30 call" has to mean his 2:30. Same reasoning
// as core/transcript.js:26.
function folderName(date, title) {
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`;
  // Anything that is not a letter, digit or dash becomes a dash. This is also
  // the path-traversal guard: '../../etc/passwd' cannot survive it.
  const slug = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${stamp}-${slug || 'meeting'}`;
}

class MeetingStore {
  constructor({ root }) {
    this.root = root;
  }

  open(startedAt, title) {
    const dir = path.join(this.root, folderName(startedAt, title));
    // Deliberately NOT contained: if the meeting folder itself can't be
    // created, there is nowhere to put a transcript, notes, or a prep sheet.
    // Starting a meeting that silently records nothing would be worse than
    // failing loudly right here, before the user starts talking.
    fs.mkdirSync(dir, { recursive: true });
    const transcriptPath = path.join(dir, 'transcript.txt');
    const notesPath = path.join(dir, 'notes.md');
    const prepPath = path.join(dir, 'prep-sheet.md');

    const handle = {
      dir,
      lastError: null,
      // Appended on arrival rather than buffered: a crash mid-call should cost
      // the last sentence, not the meeting.
      //
      // The write itself is guarded for the same reason: the spec's rule is
      // that nothing takes down the meeting. A full disk, a permissions
      // error, or a Windows path-too-long failure here must not throw out of
      // this call and end a session that is still perfectly capable of
      // continuing — but it must not be swallowed silently either, since a
      // transcript that has stopped being written is something the user
      // needs to be told about. So: catch it, log it, and surface it via
      // `lastError` for the caller to report.
      appendSegment(text) {
        try {
          fs.appendFileSync(transcriptPath, `${text}\n`, 'utf8');
          handle.lastError = null;
          return true;
        } catch (error) {
          handle.lastError = error.message || String(error);
          console.error('meeting-store: failed to append transcript segment:', handle.lastError);
          return false;
        }
      },
      writePrepSheet(text) {
        try {
          fs.writeFileSync(prepPath, `${CONSENT_LINE}\n${text}\n`, 'utf8');
          handle.lastError = null;
          return true;
        } catch (error) {
          handle.lastError = error.message || String(error);
          console.error('meeting-store: failed to write prep sheet:', handle.lastError);
          return false;
        }
      },
      // Rewritten whole each refresh — the rolling summary supersedes itself,
      // and appending would leave the reader to work out which version is current.
      writeNotes(text) {
        try {
          fs.writeFileSync(notesPath, `${CONSENT_LINE}\n${text}\n`, 'utf8');
          handle.lastError = null;
          return true;
        } catch (error) {
          handle.lastError = error.message || String(error);
          console.error('meeting-store: failed to write notes:', handle.lastError);
          return false;
        }
      }
    };

    return handle;
  }
}

module.exports = { MeetingStore, CONSENT_LINE, folderName };
