// Ink and Lamp's folder (frontend/look/) as published, and its size limits. The folder is published
// as look/<tag>/, the tag a hash of every file in it, so a file never changes under the same name:
// the service worker keeps look/ for good (sw.js, like vendor/), and a release that changes any file
// in it names a new folder. ui/theme.js names the folder in one place (`const LOOK = '/look/';`), which
// is the only line rewritten; everything else in the look names its files by relative paths.
// The daily pictures (look/pictures/{ink,lamp}/NN-name.<first 8 hex of the SHA-256 of its bytes>.webp,
// listed by plates.json) are the exception: each names its own bytes, so they are published unmoved at
// /look/pictures/ and left out of the tag, and a change elsewhere never fetches them again.
// stage.mjs publishes it so (stageLook), serve.mjs serves it so for the tests (lookTag, themeJs).
// The look's sheet, look.css, is a list of @imports in the source (each part its own file, under 300
// lines); published, it is one file (joinSheets): each import replaced by its sheet, in order, every
// relative url() rewritten to resolve from look.css, and the joined sheets left out, so the phone asks
// once and the size limits count each rule once. serve.mjs serves the sources as they are.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, posix, relative } from 'node:path';

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

const IMPORT = /@import\s+(?:url\(\s*(["']?)([^"')]+)\1\s*\)|(["'])([^"']+)\3)\s*([^;]*);/g;
const URL_REF = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;

/** The sheet at `path` (relative to `dir`, posix) with its @imports replaced by their sheets, in order,
 * and every relative url() in them naming its file from `from` (look.css's folder). Throws on an import
 * with a media or layer condition, or a sheet that imports itself. @param {string} dir @param {string} path
 * @param {Set<string>} used the sheets joined @returns {Promise<string>} */
async function joined(dir, path, used, from, seen = new Set()) {
  if (seen.has(path)) throw new Error(`look/${path} imports itself`);
  const here = posix.dirname(path);
  const css = await readFile(join(dir, path), 'utf8');
  /** A part of this sheet, its relative url()s named from look.css's folder. @param {string} part */
  const rebased = (part) => part.replace(URL_REF, (all, q, ref) => (/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(ref) ? all : `url(${q}${posix.relative(from, posix.join(here, ref))}${q})`));
  const parts = [];
  let at = 0;
  for (const m of css.matchAll(IMPORT)) {
    const ref = m[2] ?? m[4];
    if (m[5].trim()) throw new Error(`look/${path}: @import "${ref}" ${m[5].trim()} cannot be joined`);
    const sheet = posix.join(here, ref);
    used.add(sheet);
    parts.push(rebased(css.slice(at, m.index)), await joined(dir, sheet, used, from, new Set([...seen, path])));
    at = m.index + m[0].length;
  }
  return parts.join('') + rebased(css.slice(at));
}

/** Joins the staged look's look.css into one file and removes the sheets it took in. @param {string} dir */
export async function joinSheets(dir) {
  if (!existsSync(join(dir, 'look.css'))) return;
  const used = new Set();
  const css = await joined(dir, 'look.css', used, '.');
  await writeFile(join(dir, 'look.css'), css);
  for (const p of used) await rm(join(dir, p));
}

/** Moves the staged look/ to look/<tag>/, but for its pictures, its sheet joined (joinSheets), and names
 * it in the staged ui/theme.js. @param {string} out */
export async function stageLook(out) {
  await joinSheets(join(out, 'look'));
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
  // (2026-11-20) Ink and Lamp, the default since that day and loaded only while it is the look; the owner:
  // "That's fine because it should get cached after one load anyways". Each limit is what was measured,
  // with no room.
  return [
    // (2026-11-24) +459 measured (128,577 → 129,036): the code block's plate, head and Copy button.
    ['look CSS bytes', sum(/\.css$/), 129_036],
    ['look JS bytes', sum(/\.js$/), 77_563],
    ['look font bytes', sum(/\.woff2$/), 129_576],
    ['look kit bytes', sum(/^kit\//), 204_168],
    ['look emblem bytes', sum(/^emblems\.svg$/), 6_160],
    // The ring's pointing hand, as ink, and the island's reels and tape (look/art/).
    ['look art bytes', sum(/^art\//), 21_667],
    // The daily pictures (look/pictures/; their sources: docs/design/LOOK-PICTURES.md) and their list.
    ['look picture bytes', sum(/^pictures\//), 7_693_106],
    ['look list bytes', sum(/^plates\.json$/), 16_479],
  ];
}
