// The shell's face that may not live in this repository. Switzer (owner, 2026-10-31) is free under
// Indian Type Foundry's Free Font License (FFL 2.0), which lets us self-host it for our own site
// but not distribute it "through … repository" or "publicly accessible servers", and this
// repository is public. So the file is never committed: this script gets the official file from
// Fontshare, checks it is byte for byte the one pinned here (an unmodified official version, as the
// licence requires), and writes it where the site serves it, frontend/ui/fonts/ (gitignored).
// The deploy runs it before stage.mjs, which then refuses to publish without it (TH_FONTS=required);
// the checks run it too. Without it, tests still run on the fallback face.
// Usage: node scripts/fonts.mjs            fetch what is missing or wrong
//        node scripts/fonts.mjs --check    exit 1 if anything is missing or wrong (no network)
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));

/** Each face: where the site serves it, the Fontshare CSS that names the official file, its SHA-256. */
export const FONTS = [
  {
    file: 'frontend/ui/fonts/Switzer.woff2',
    css: 'https://api.fontshare.com/v2/css?f[]=switzer@1&display=swap',
    // Switzer-Variable.woff2 (weights 100–900) from the official Switzer_Complete download, 43,220 bytes.
    sha256: 'd1bf801ffb1a6096def70a7c532255722ad87d948b13a8a586e342f7091f8ee4',
  },
];

const sha = (/** @type {Uint8Array} */ b) => createHash('sha256').update(b).digest('hex');

/** Whether frontend/ui/fonts.css uses the face (a rollback to an older release may not, and then
 * neither fetches nor needs it). @param {(typeof FONTS)[number]} f */
export async function needed(f) {
  const css = await readFile(join(repo, 'frontend/ui/fonts.css'), 'utf8').catch(() => '');
  return css.includes(`fonts/${f.file.split('/').pop()}`);
}

/** Whether the face is on disk and is the pinned file. @param {(typeof FONTS)[number]} f */
export async function present(f) {
  const bytes = await readFile(join(repo, f.file)).catch(() => null);
  return bytes ? (sha(bytes) === f.sha256 ? 'ok' : 'wrong') : 'missing';
}

/** Gets one face from Fontshare and writes it if it is the pinned file. @param {(typeof FONTS)[number]} f */
async function fetchFont(f) {
  const css = await (await fetch(f.css, { signal: AbortSignal.timeout(20_000) })).text();
  const url = /url\('(\/\/cdn\.fontshare\.com\/[^']+\.woff2)'\)/.exec(css)?.[1];
  if (!url) throw new Error(`${f.file}: Fontshare's CSS names no woff2`);
  const res = await fetch(`https:${url}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${f.file}: Fontshare answered ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (sha(bytes) !== f.sha256) throw new Error(`${f.file}: Fontshare's file changed (sha256 ${sha(bytes)}); check it, then pin the new one in scripts/fonts.mjs`);
  await mkdir(dirname(join(repo, f.file)), { recursive: true });
  await writeFile(join(repo, f.file), bytes);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  let bad = 0;
  for (const f of FONTS) {
    if (!(await needed(f))) { console.log(`${f.file}: not used by this release`); continue; }
    const state = await present(f);
    if (state === 'ok') { console.log(`${f.file}: ok`); continue; }
    if (check) { console.error(`${f.file}: ${state} (run node scripts/fonts.mjs)`); bad++; continue; }
    await fetchFont(f);
    console.log(`${f.file}: fetched from Fontshare, sha256 checked`);
  }
  if (bad) process.exit(1);
}
