// The newest migration number of each Durable Object class, read from the migration files
// (DATA.md §9), for the deploy's smoke check: deep health must report this schema as applied
// and expected before a deploy counts as live, so an object still running the old code can't
// pass it. `backend/tests/migrations/schema.test.ts` checks this against the real lists.
//   node scripts/schema-version.mjs core|auth|music|senses|library  prints the number
//   node scripts/schema-version.mjs --ready < deep    prints `ready`, or why deep health isn't
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../backend/src/', import.meta.url));

/** The highest `version: N` in the given migration sources. @param {string[]} texts */
export function latestOf(texts) {
  let max = 0;
  for (const t of texts) for (const [, n] of t.matchAll(/\bversion:\s*(\d+)\b/g)) max = Math.max(max, Number(n));
  return max;
}

/** @param {'core' | 'auth' | 'music' | 'senses' | 'library'} cls */
export function files(cls) {
  if (cls === 'auth') return [`${SRC}objects/auth.migrations.ts`];
  if (cls === 'music') return [`${SRC}objects/music.ts`];
  if (cls === 'senses') return [`${SRC}objects/senses.ts`];
  if (cls === 'library') return [`${SRC}objects/library.ts`];
  const areas = readdirSync(`${SRC}areas`, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => `${SRC}areas/${d.name}/migrations.ts`)
    .filter((f) => {
      try {
        readFileSync(f);
        return true;
      } catch {
        return false;
      }
    });
  return [`${SRC}objects/core.migrations.ts`, ...areas];
}

/** Whether a deep health body shows every object running this commit's code (it expects the
 * newest step) on a schema at least that new (a rollback runs older code on a newer schema, which
 * expand-only migrations allow); the reason when not.
 * @param {any} body @param {Record<string, number>} want */
export function ready(body, want) {
  const why = [];
  if (body?.ok !== true) why.push('ok is not true');
  for (const [cls, n] of Object.entries(want)) {
    const o = body?.objects?.[cls];
    if (o?.expected !== n || !(typeof o?.schema === 'number' && o.schema >= n))
      why.push(`${cls} schema ${o?.schema}/${o?.expected}, want >=${n}/${n}`);
  }
  return why.length ? why.join('; ') : null;
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--ready') {
  // Reads a deep health body on stdin; prints `ready`, or why not.
  let text = '';
  process.stdin.on('data', (d) => (text += d)).on('end', () => {
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {}
    const want = Object.fromEntries(['core', 'auth', 'music', 'senses', 'library'].map((c) => [c, latestOf(files(c).map((f) => readFileSync(f, 'utf8')))]));
    process.stdout.write(ready(body, want) ?? 'ready');
  });
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cls = process.argv[2];
  if (!['core', 'auth', 'music', 'senses', 'library'].includes(cls)) {
    console.error('usage: node scripts/schema-version.mjs core|auth|music|senses|library');
    process.exit(2);
  }
  console.log(latestOf(files(cls).map((f) => readFileSync(f, 'utf8'))));
}
