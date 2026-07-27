// Writes build/edition — the file electron-builder packs into resourcesPath
// and core/edition.js reads at startup. Run by the dist scripts, never by
// hand. Only 'master', 'retail' and 'kids' are accepted: a typo here must
// fail the BUILD loudly, because at runtime an unrecognised stamp silently
// means retail (fail-closed), and a master or kids build that quietly came
// out retail would look like a licensing bug — or worse, a kids build with
// the parent gates missing — instead of a build bug.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const edition = String(process.argv[2] || '').trim().toLowerCase();
if (edition !== 'master' && edition !== 'retail' && edition !== 'kids') {
  console.error(`stamp-edition: expected 'master', 'retail' or 'kids', got '${process.argv[2]}'`);
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'build'), { recursive: true });
writeFileSync(join(root, 'build', 'edition'), edition, 'utf8');
console.log(`stamped: ${edition}`);
