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
    fs.mkdirSync(dir, { recursive: true });
    const transcriptPath = path.join(dir, 'transcript.txt');
    const notesPath = path.join(dir, 'notes.md');
    const prepPath = path.join(dir, 'prep-sheet.md');

    return {
      dir,
      // Appended on arrival rather than buffered: a crash mid-call should cost
      // the last sentence, not the meeting.
      appendSegment(text) {
        fs.appendFileSync(transcriptPath, `${text}\n`, 'utf8');
      },
      writePrepSheet(text) {
        fs.writeFileSync(prepPath, `${CONSENT_LINE}\n${text}\n`, 'utf8');
      },
      // Rewritten whole each refresh — the rolling summary supersedes itself,
      // and appending would leave the reader to work out which version is current.
      writeNotes(text) {
        fs.writeFileSync(notesPath, `${CONSENT_LINE}\n${text}\n`, 'utf8');
      }
    };
  }
}

module.exports = { MeetingStore, CONSENT_LINE, folderName };
