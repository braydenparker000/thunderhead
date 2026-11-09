#!/usr/bin/env node
// Whether a branch changes only test pages (frontend/lab/<page>/ and the engine builds they load,
// engine/), so Test can run the lab checks instead of every suite (docs/engineering/TESTING.md §1, "Lab
// changes"; owner, 2026-11-09). Prints `all`, or `lab` and then the test files to run: the static
// site checks (which read every page, labs included) and each changed page's own tests
// (tests/<page>-lab*.test.mjs, a test naming /lab/<page>/). Any other path, a deleted file, or any
// doubt is `all`.
// Usage: node scripts/lab-scope.mjs <base>   (e.g. origin/main; compared from the merge base)
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** Always run for a lab change: the static checks every page must pass (outside hosts, CSP, imports, credentials). */
export const ALWAYS = ['tests/site.test.mjs'];
/** engine/<folder> builds a lab page's files. */
const ENGINE_PAGE = /** @type {Record<string, string>} */ ({ 'lightcraft-web': 'lightcraft', raw: 'engine' });

/** The lab pages a list of changed paths touches, or null when any path is outside the labs.
 * @param {string[]} paths @returns {Set<string> | null} */
export function labPages(paths) {
  const pages = new Set();
  for (const p of paths) {
    const lab = /^frontend\/lab\/([^/]+)\/./.exec(p)?.[1], engine = /^engine\/([^/]+)\//.exec(p)?.[1];
    if (lab) pages.add(lab);
    else if (engine && ENGINE_PAGE[engine]) pages.add(ENGINE_PAGE[engine]);
    else return null;
  }
  return paths.length ? pages : null;
}

/** The tests for those pages: ALWAYS, and every test file that names /lab/<page>/ in its source.
 * @param {Set<string>} pages @param {Record<string, string>} sources file → text */
export function labTests(pages, sources) {
  const own = Object.entries(sources).filter(([, text]) => [...pages].some((p) => text.includes(`/lab/${p}/`))).map(([f]) => f);
  return [...new Set([...ALWAYS, ...own])].sort();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let out = 'all';
  try {
    const base = process.argv[2] || 'origin/main';
    const git = (/** @type {string[]} */ ...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
    const lines = git('diff', '--name-status', `${git('merge-base', base, 'HEAD')}..HEAD`).split('\n').filter(Boolean);
    // a deleted or renamed file could be one another page loads: run everything
    const pages = lines.every((l) => /^[AM]\t/.test(l)) ? labPages(lines.map((l) => l.slice(2))) : null;
    if (pages) {
      const files = readdirSync(`${ROOT}tests`).filter((f) => f.endsWith('.test.mjs')).map((f) => `tests/${f}`);
      out = `lab ${labTests(pages, Object.fromEntries(files.filter((f) => !ALWAYS.includes(f)).map((f) => [f, readFileSync(`${ROOT}${f}`, 'utf8')]))).join(' ')}`;
    }
  } catch (err) { console.error(`lab-scope: ${err}`); }
  console.log(out);
}
