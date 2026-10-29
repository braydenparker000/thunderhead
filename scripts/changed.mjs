// Picks the staged files that differ from what is live, so deploy.sh uploads only those.
// Reads the $web listing (name, Content-MD5, content type) that deploy.sh saved, compares each
// staged file's MD5 and content type, and links the changed ones into .deploy/changed/ with the
// same paths. A file with no MD5 on the live side (large uploads) counts as changed.
// Usage: node scripts/changed.mjs <listing.json> <staged dir> <changed dir>
import { createHash } from 'node:crypto';
import { link, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { CONTENT_TYPES } from './site-config.mjs';

/** @param {{ name: string, md5?: string | null, type?: string | null }[]} live
 *  @param {{ path: string, md5: string, type: string }[]} staged */
export function changedFiles(live, staged) {
  const byName = new Map(live.map((b) => [b.name, b]));
  return staged.filter((f) => {
    const b = byName.get(f.path);
    return !b || !b.md5 || b.md5 !== f.md5 || b.type !== f.type;
  });
}

async function main([listing, from, to]) {
  if (!listing || !from || !to) throw new Error('usage: changed.mjs <listing.json> <staged dir> <changed dir>');
  const live = JSON.parse(await readFile(listing, 'utf8')).map((b) => ({ name: b.n, md5: b.m, type: b.t }));
  const staged = [];
  for (const e of await readdir(from, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const full = join(e.parentPath, e.name);
    const path = relative(from, full).replaceAll('\\', '/');
    const md5 = createHash('md5').update(await readFile(full)).digest('base64');
    staged.push({ path, md5, type: CONTENT_TYPES[extname(path)], full });
  }
  const changed = changedFiles(live, staged);
  await rm(to, { recursive: true, force: true });
  for (const f of changed) {
    await mkdir(dirname(join(to, f.path)), { recursive: true });
    await link(f.full, join(to, f.path));
  }
  await writeFile(`${to}.txt`, changed.map((f) => f.path).join('\n') + (changed.length ? '\n' : ''));
  console.log(`changed: ${changed.length} of ${staged.length} files`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));
