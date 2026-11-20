// Ink and Lamp's folder (frontend/look/) as published, and its size limits. The folder is published
// as look/<tag>/, the tag a hash of every file in it, so a file never changes under the same name:
// the service worker keeps look/ for good (sw.js, like vendor/), and a release that changes any file
// in it names a new folder. ui/theme.js names the folder in one place (`const LOOK = '/look/';`), which
// is the only line rewritten; everything else in the look names its files by relative paths.
// The daily pictures (look/pictures/{ink,lamp}/NN-name.<first 8 hex of the SHA-256 of its bytes>.webp,
// listed by plates.json) are the exception: each names its own bytes, so they are published unmoved at
// /look/pictures/ and left out of the tag, and a change elsewhere never fetches them again.
// stage.mjs publishes it so (stageLook), serve.mjs serves it so for the tests (lookTag, themeJs).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

/** A published look path: look/<tag>/… */
export const TAGGED = /^look\/[0-9a-f]{10}\//;
/** The daily pictures' folder inside look/, published as it is. */
export const PICTURES = 'pictures';

/** The tag of the look folder at `dir`: the first 10 hex of a SHA-256 over every file's path and bytes,
 * the daily pictures aside. */
export function lookTag(dir) {
  const hash = createHash('sha256');
  const paths = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).replaceAll('\\', '/')).filter((p) => !p.startsWith(`${PICTURES}/`)).sort();
  for (const p of paths) hash.update(`${p}\0`).update(readFileSync(join(dir, p))).update('\0');
  return hash.digest('hex').slice(0, 10);
}

/** ui/theme.js naming the published look folder. */
export function themeJs(source, tag) {
  const next = source.replace(/^(\s*)const LOOK = '\/look\/';$/m, `$1const LOOK = '/look/${tag}/';`);
  if (next === source) throw new Error("ui/theme.js has no \"const LOOK = '/look/';\" line");
  return next;
}

/** Moves the staged look/ to look/<tag>/, but for its pictures, and names it in the staged ui/theme.js.
 * @param {string} out */
export async function stageLook(out) {
  const tag = lookTag(join(out, 'look'));
  await rename(join(out, 'look'), join(out, `look-${tag}`));
  await mkdir(join(out, 'look'));
  if (existsSync(join(out, `look-${tag}`, PICTURES))) await rename(join(out, `look-${tag}`, PICTURES), join(out, 'look', PICTURES));
  await rename(join(out, `look-${tag}`), join(out, 'look', tag));
  const theme = join(out, 'ui/theme.js');
  await writeFile(theme, themeJs(await readFile(theme, 'utf8'), tag));
}

/** The look's size limits, each as measured. @param {{ path: string, size: number }[]} list */
export function lookBudgets(list) {
  const sum = (re) => list.filter((f) => f.path.startsWith('look/') && re.test(f.path.replace(TAGGED, '').replace(/^look\//, ''))).reduce((n, f) => n + f.size, 0);
  // (2026-11-20) Ink and Lamp, off unless chosen and loaded only then; the owner: "That's fine because it
  // should get cached after one load anyways". Each limit is what was measured, with no room.
  return [
    ['look CSS bytes', sum(/\.css$/), 18_493],
    ['look JS bytes', sum(/\.js$/), 10_179],
    ['look font bytes', sum(/\.woff2$/), 129_576],
    ['look kit bytes', sum(/^kit\//), 204_168],
    ['look emblem bytes', sum(/^emblems\.svg$/), 6_160],
    // The daily pictures (look/pictures/): none yet.
    ['look picture bytes', sum(/^pictures\//), 0],
  ];
}
