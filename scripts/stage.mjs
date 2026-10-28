// Copies frontend/ to .deploy/site/, writes .deploy/release.json for the commit (deploy.sh
// uploads it last), and fails if the site breaks a size budget.
// Usage: node scripts/stage.mjs <commit-sha>
import { cp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = process.argv[2] ?? '';
if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`not a full commit sha: "${sha}"`);

const repo = fileURLToPath(new URL('../', import.meta.url));
const out = join(repo, '.deploy/site');
await rm(join(repo, '.deploy'), { recursive: true, force: true });
await cp(join(repo, 'frontend'), out, { recursive: true });
await writeFile(join(repo, '.deploy/release.json'), JSON.stringify({ commit: sha, staged_at: new Date().toISOString() }) + '\n');

async function files(dir) {
  const all = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) all.push(...await files(p)); else all.push({ path: p.slice(out.length + 1), size: (await stat(p)).size });
  }
  return all;
}
const list = await files(out);
const total = list.reduce((n, f) => n + f.size, 0);
const sum = re => list.filter(f => re.test(f.path)).reduce((n, f) => n + f.size, 0);

const budgets = [
  ['files', list.length, 2000],
  ['total bytes', total, 25_000_000],
  ['home JS bytes', sum(/^(apps\/home|ui)\/.*\.js$/), 120_000],
  ['home CSS bytes', sum(/^(apps\/home|ui)\/.*\.css$/), 60_000],
  ['font bytes', sum(/\.woff2$/), 130_000],
];
const over = budgets.filter(([, value, limit]) => value > limit);
for (const [name, value, limit] of budgets) console.log(`${name}: ${value} (limit ${limit})`);
if (over.length) throw new Error(`over budget: ${over.map(([n]) => n).join(', ')}`);
console.log(`staged ${list.length} files for ${sha}`);
