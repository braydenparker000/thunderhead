// Copies frontend/ to .deploy/site/, writes config.js, the build into sw.js, precache.json and
// the API host into the pages' CSP (site-config.mjs; WORKER_URL from the repository variable,
// empty until the Worker exists),
// writes .deploy/release.json for the commit (deploy.sh uploads it last), and fails if the
// site breaks a size budget.
// Usage: WORKER_URL=… node scripts/stage.mjs <commit-sha>
import { execFileSync } from 'node:child_process';
import { cp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ROUTES, CONTENT_TYPES, configJs, precacheJson, precached, swJs, withApi } from './site-config.mjs';

const sha = process.argv[2] ?? '';
if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`not a full commit sha: "${sha}"`);

const repo = fileURLToPath(new URL('../', import.meta.url));
const out = join(repo, '.deploy/site');
await rm(join(repo, '.deploy'), { recursive: true, force: true });
await cp(join(repo, 'frontend'), out, { recursive: true });
// The storage website has no SPA fallback, so each app route gets a real copy of the shell
// (all asset paths are root-absolute, so the copy works from any folder).
// Astra has its own page (frontend/astra/), so it is not stubbed; an existing page is never overwritten.
for (const route of APP_ROUTES) {
  const stub = join(out, route, 'index.html');
  if (!(await stat(stub).catch(() => null))) await cp(join(out, 'index.html'), stub);
}

const api = process.env.WORKER_URL ?? '';
let build = 0;
try { build = Number(execFileSync('git', ['rev-list', '--count', sha], { cwd: repo, encoding: 'utf8' }).trim()) || 0; } catch {}
const repoUrl = process.env.GITHUB_REPOSITORY ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}` : '';
await writeFile(join(out, 'config.js'), configJs({ api, build, commit: sha, repo_url: repoUrl }));
await writeFile(join(out, 'sw.js'), swJs(await readFile(join(out, 'sw.js'), 'utf8'), build));

// My Media's Drive settings come from the DRIVE_CONFIG_JSON secret (owner ruling 2026-10-28); without
// it the page says the Drive key is not configured, as the unchanged app does.
const drive = process.env.DRIVE_CONFIG_JSON?.trim();
if (drive) {
  let parsed;
  try { parsed = JSON.parse(drive); } catch { throw new Error('DRIVE_CONFIG_JSON is not valid JSON'); }
  if (typeof parsed?.apiKey !== 'string' || typeof parsed?.folderId !== 'string') throw new Error('DRIVE_CONFIG_JSON needs apiKey and folderId');
  await writeFile(join(out, 'assets/drive-config.json'), JSON.stringify(parsed));
}
console.log(`Drive config: ${drive ? 'written' : 'not set'}`);

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
for (const f of list.filter(f => f.path.endsWith('.html'))) {
  const p = join(out, f.path);
  const html = await readFile(p, 'utf8');
  const next = withApi(html, api, f.path);
  if (next !== html) { await writeFile(p, next); f.size = Buffer.byteLength(next); }
}
// The service worker's list, written last so it holds the final sizes (after the CSP edit).
const manifest = precacheJson(build, list);
await writeFile(join(out, 'precache.json'), manifest);
list.push({ path: 'precache.json', size: Buffer.byteLength(manifest) });
const kinds = [...new Set(list.map(f => extname(f.path)))].sort();
const unknown = list.filter(f => !CONTENT_TYPES[extname(f.path)]).map(f => f.path);
if (unknown.length) throw new Error(`no content type for: ${unknown.join(', ')} (add it to CONTENT_TYPES in site-config.mjs)`);
// deploy.sh uploads one kind at a time with this exact type, pages last.
await writeFile(join(repo, '.deploy/types.txt'), kinds.sort((a, b) => (a === '.html') - (b === '.html')).map(k => `${k.slice(1)}\t${CONTENT_TYPES[k]}`).join('\n') + '\n');
console.log(`API: ${api || 'none yet (sign-in stays off)'}, build ${build}`);
const total = list.reduce((n, f) => n + f.size, 0);
const sum = re => list.filter(f => re.test(f.path)).reduce((n, f) => n + f.size, 0);

// The ported apps (P1b) are recorded and checked by size in ported.json instead; their own fonts
// and engines don't count against the shell's budgets (PERFORMANCE.md §2).
const ported = JSON.parse(await readFile(join(out, 'ported.json'), 'utf8'));
const portedRoots = [...Object.keys(ported.folders), 'assets', 'drawercast'];
const shellFile = f => !portedRoots.some(r => f.path.startsWith(r + '/'));
const budgets = [
  ['files', list.length, 2000],
  ['total bytes', total, 40_000_000],
  ['home JS bytes', sum(/^(apps\/home|ui)\/.*\.js$/), 120_000],
  // th/ modules the shell loads at boot, and the conversation it loads after the first paint.
  ['shell th JS bytes', sum(/^th\/[^/]+\.js$/), 64_000],
  // Replies render rich text (th/chat/rich.js, 2026-10-30), which took over the menu's prose.js;
  // then follow-ups, the time over a turn, folded long replies and the tap for a reply's actions;
  // then (2026-10-30) sending a message's files and drawing a message's attachments.
  // (2026-10-31) + the reply blocks (th/chat/blocks.js), which were the Board reader's: the
  // Briefing's budget fell by more when the Board was cut.
  ['chat JS bytes', sum(/^th\/(chat|registry)\/.*\.js$/), 85_000],
  // A reply's actions and Find in today, loaded on the first tap or pull.
  ['reply tools JS bytes', sum(/^th\/reply\/.*\.js$/), 12_000],
  // The + sheet (2026-10-30): pickers, the bar's tray, the voice memo strip, Remind me, uploads
  // and attachments in the conversation, loaded when the sheet opens or a message has files.
  ['attach JS bytes', sum(/^th\/attach\/.*\.js$/), 36_000],
  // The menu's conversations and search, loaded when the menu first opens.
  ['menu JS bytes', sum(/^th\/convos\/.*\.js$/), 56_000],
  // The Briefing page, loaded after the first paint.
  // + skeletons, pull to refresh and the owner's arrangement of the tiles (2026-10-30).
  ['briefing JS bytes', sum(/^th\/briefing\/.*\.js$/), 20_000],
  ['home CSS bytes', sum(/^(apps\/home|ui)\/.*\.css$/), 60_000],
  // Styles home loads just after its first paint (th/reply/tools.css, th/attach/attach.css).
  ['later CSS bytes', sum(/^th\/.*\.css$/), 20_000],
  // One face since 2026-10-31: Quicksand, variable 300–700, Latin (28.2 KB; Fraunces and Inter were 133 KB).
  ['shell font bytes', list.filter(f => shellFile(f) && /\.woff2$/.test(f.path)).reduce((n, f) => n + f.size, 0), 40_000],
  ['precache bytes', list.filter((f) => precached(f.path)).reduce((n, f) => n + f.size, 0), 3_000_000],
  ['icon sprite bytes', sum(/^ui\/icons\.svg$/), 30_000],
];
const over = budgets.filter(([, value, limit]) => value > limit);
for (const [name, value, limit] of budgets) console.log(`${name}: ${value} (limit ${limit})`);
if (over.length) throw new Error(`over budget: ${over.map(([n]) => n).join(', ')}`);
console.log(`staged ${list.length} files for ${sha}`);
