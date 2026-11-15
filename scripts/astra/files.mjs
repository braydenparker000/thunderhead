// Astra's release as the site serves it, for scripts/stage.mjs and the tests: every file under the
// staged astra/ folder with a short hash of its bytes, and the release's name, a hash of that list.
// The name changes exactly when a byte Astra serves changes (a commit elsewhere in the site leaves
// it alone), and it needs no Git history. Astra's service worker (frontend/astra/sw.js) reads the
// name from /release.json and the list from /astra/files.json, copies a file it already has when
// its hash is the same, and checks the hash of every file it fetches.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

/** The worker computes the same: SHA-256, hex, first 16 characters. */
export const fileHash = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

/** Files the worker never saves: itself and this list. */
const LEFT_OUT = new Set(['sw.js', 'files.json']);

/** `dir` is the astra/ folder: `{tree, files: {path: hash}}`, paths relative to it, sorted. */
export async function astraFiles(dir) {
  const paths = [];
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true }))
    if (e.isFile()) paths.push(relative(dir, join(e.parentPath, e.name)).replaceAll('\\', '/'));
  const files = {};
  for (const path of paths.filter((p) => !LEFT_OUT.has(p)).sort()) files[path] = fileHash(await readFile(join(dir, path)));
  const tree = createHash('sha256').update(Object.entries(files).map(([p, h]) => `${h} ${p}\n`).join('')).digest('hex').slice(0, 40);
  return { tree, files };
}
