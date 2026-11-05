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
import { FONTS, needed, present } from './fonts.mjs';
import { APP_ROUTES, CONTENT_TYPES, configJs, precacheJson, precached, swJs, withApi } from './site-config.mjs';

const sha = process.argv[2] ?? '';
if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`not a full commit sha: "${sha}"`);

const repo = fileURLToPath(new URL('../', import.meta.url));
const out = join(repo, '.deploy/site');
// The face fetched at build (scripts/fonts.mjs: its licence keeps it out of this public repository).
// A wrong file never ships; a missing one only where it is required (the deploy sets TH_FONTS).
for (const f of FONTS) {
  if (!(await needed(f))) continue;
  const state = await present(f);
  if (state === 'wrong' || (state === 'missing' && process.env.TH_FONTS === 'required')) throw new Error(`${f.file} is ${state}: run node scripts/fonts.mjs`);
  if (state === 'missing') console.warn(`${f.file} is missing (node scripts/fonts.mjs); staging on the fallback face`);
}
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
// A preview build (.github/workflows/preview.yml) names its branch, shown on the pages' label.
await writeFile(join(out, 'config.js'), configJs({ api, build, commit: sha, repo_url: repoUrl, preview: process.env.TH_PREVIEW ?? '' }));
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
  // Task A: measured 72,232 bytes (+133 over the prior limit), including whenResting().
  // (2026-11-02) +204 measured (72,436): motion.js's lift and fade springs for the ring's discs.
  // (2026-11-02) +54 measured (72,490): contract.js's `permit` card class ("You said to ask").
  // (2026-11-02, senses) +8 measured (72,498): contract.js's `habit` fact kind.
  // (2026-11-02) +1,808 measured (74,306): contract.js's verbs, batch 1 (17 more, each with its side
  // and whether it is an app's intent).
  // (2026-11-03, @muse) +104 measured (74,410): api.js's `say` sends the `mention` marker.
  // (2026-11-03, provenance) +11 measured (74,421): contract.js's memory reasons `outside_rule`,
  // `outside_supersede` and `outside_confirm` in place of `session_tainted` and `no_inferred_sensitive`
  // (MEMORY.md §6 M11).
  // (2026-11-03, schedules) +7 measured (74,428): contract.js's `plan` change kind.
  // (2026-11-03, watches) +208 measured (74,636): contract.js's `watch.set` and `watch.cancel` verbs
  // and the `watch` and `prediction` change kinds.
  // (2026-11-04, what lands) +301 measured (74,937): contract.js's `oddsWords` (a card's odds in
  // words) and the cards' odds limits.
  // (2026-11-04, show) +188 measured (75,125): contract.js's `island.show` and `island.clear` verbs.
  // (2026-11-04, settings depth) +577 measured (75,702): motion.js's `buzz()` (Haptics off / full) and
  // Reduced motion on or off from the owner's setting.
  // (2026-11-04, verbs batch 2) +987 measured (76,689): contract.js's seven new verbs, the apps'
  // arrangement kinds and senses, and the law-8 topics.
  // (2026-11-04, the apps' arrangements) +116 measured (76,689 → 76,805): guitar.start_practice in th/contract.js.
  // (2026-11-04, routines) +65 measured (76,805 → 76,870): th/contract.js's `routine` card class and
  // change kind.
  // (2026-11-04, verbs batch 3) +299 measured (76,870 → 77,169): th/contract.js's three new verbs.
  // (2026-11-04, settings second) +1,205 measured (77,169 → 78,374): th/copy.js's `mindName()` (the
  // mind's name wherever the copy says "the mind") and `keepShell()` (the name and the owner's hours
  // kept from home's read of the settings, for the copy and ui/theme.js's Auto).
  // (2026-11-04, Photos) +27 measured (78,374 → 78,401): th/contract.js's Photos built and its change
  // kind, th/session.js forgetting the shelf kept offline at sign-out.
  ['shell th JS bytes', sum(/^th\/[^/]+\.js$/), 78_401],
  // Replies render rich text (th/chat/rich.js, 2026-10-30), which took over the menu's prose.js;
  // then follow-ups, the time over a turn, folded long replies and the tap for a reply's actions;
  // then (2026-10-30) sending a message's files and drawing a message's attachments.
  // (2026-10-31) + the reply blocks (th/chat/blocks.js), which were the Board reader's: the
  // Briefing's budget fell by more when the Board was cut.
  // (2026-10-31, the look round) + words that fade up, the sent message's lift, the mic's memo and
  // keeping a message sent while today failed to load; the fonts fell by 105 KB the same day.
  // (2026-10-31, later) + the status chip, the mind's lines as cards and the catch-up line after
  // quiet, in place of the voice line (HOME.md §2).
  // (2026-11-01) + off the record: its conversation shown in place of today's, its outbox, no cache.
  // (2026-11-02, night chat) 97,000 → 107,500: the working card (th/chat/working.js, 7,100 bytes;
  // its logic in model.js) and a reply's choice, less the reply slot's thinking words and Stop:
  // measured 107,441 bytes, 10,560 over main's 96,881.
  // (2026-11-02, senses) +430 measured (107,871): each home line's ledger row on its card and a
  // chip's app (for `line.seen` and `reply.open_chip`), and the Memory page's Habits group.
  // (2026-11-03, @muse) +792 measured (108,663): an "@muse" marked and sent from the outbox, its
  // hint and length check (index.js), never waited on as the mind's (model.js), and Muse's done
  // line drawn as plain words (view.js).
  // (2026-11-03, provenance) +304 measured (108,967): the Memory registry's "Learned from outside"
  // shelf and its `whose` ("From outside" for an outside fact taken for the owner's words).
  // (2026-11-03, schedules) +2,726 measured (111,693): a plan's line on home with its Undo (today's
  // plans from the ledger, read so a failure never holds the chat; their cards, the undo call and
  // its words, and their cache).
  // (2026-11-04) +77 measured (111,770): the chat listens for offline before its first sync.
  // (2026-11-04, show) +3,826 measured (115,596): "How I got this" under a reply (th/chat/using.js,
  // the chips moved out of working.js and shared with the fold; a file, a day and a search chip)
  // and the island line's two executors (registry/verbs.js).
  // (2026-11-04, settings depth) +579 measured (116,175): registry/apps.js's `ringApps()`, the ring in
  // the owner's order with Photos last.
  // (2026-11-04, verbs batch 2) +251 measured (116,426): registry/surfaces.js keeps the apps'
  // arrangement kinds off home.
  // (2026-11-04, settings second) +73 measured (116,426 → 116,499): the chat keeps the shell's
  // settings from its read and says the mind's name when Stop can't reach it.
  ['chat JS bytes', sum(/^th\/(chat|registry)\/.*\.js$/), 116_499],
  // A reply's actions and Find in today, loaded on the first tap or pull.
  ['reply tools JS bytes', sum(/^th\/reply\/.*\.js$/), 12_000],
  // The phone's own commands (th/commands, loaded once the chat starts) and dictation (th/dictate:
  // the mic's wiring with the chat, the recorder on the first press of the mic), 2026-10-31.
  // (2026-11-01) + "off the record" and "back on the record".
  ['commands and dictation JS bytes', sum(/^th\/(commands|dictate)\/.*\.js$/), 21_000],
  // Apps as layers inside home and the island (th/island, loaded when Music or Podcasts opens), 2026-11-01;
  // 24 KB with the sleep timer on it and room for Guitar's.
  // Task C: +8,120 measured bytes (22,958 → 31,078) for one capsule, readiness and retained frames.
  // Podcasts' way home (2026-11-02): +1,778 measured bytes (31,078 → 32,856) for touch swipes and in-app home links.
  // The capsule's details (2026-11-02): +7,411 measured bytes (32,856 → 40,267) for the shared artwork, its
  // off-thread decode and fallback, long titles, the pulse, the times, glyph and Podcasts' skip controls.
  // The mind's line (2026-11-04): +1,681 measured bytes (41,309 → 42,990), line.js and its place in the capsule.
  // (2026-11-04, settings depth): +155 measured bytes (42,990 → 43,145), Island off declines the layer.
  ['island JS bytes', sum(/^th\/island\/.*\.js$/), 43_145],
  // Off the record (th/record, 2026-11-01): starting and ending one, home's view of it, its marker.
  ['off the record JS bytes', sum(/^th\/record\/.*\.js$/), 4_500],
  // The + sheet (2026-10-30): pickers, the bar's tray, the voice memo strip, Remind me, uploads
  // and attachments in the conversation, loaded when the sheet opens or a message has files.
  // (2026-11-01) + Off the record in the sheet.
  // (2026-11-04, show) +56 measured (36,256): show.js's `save`, shared with a reply's file chip.
  ['attach JS bytes', sum(/^th\/attach\/.*\.js$/), 36_256],
  // What's new after an update (th/news, loaded after the first paint), 2026-11-01.
  ['news JS bytes', sum(/^th\/news\/.*\.js$/), 6_000],
  // The menu's conversations and search, loaded when the menu first opens.
  // (2026-10-31) + a held card's Continue, Rename and Pin (actions.js), Settings by name in search.
  // (2026-11-01) + Delete with its sheet and Now's hold, the off-the-record tag, Recently deleted by name.
  // (2026-11-03, @muse) 65,000 → 70,205 measured (+6,071 over main's 64,134): the Tasks group and
  // its sheet (tasks.js, 5,640) and their place in the menu (menu.js, +431).
  // (2026-11-04, verbs batch 2) +111 measured (70,316): a row's topic (thread.file) before its summary.
  ['menu JS bytes', sum(/^th\/convos\/.*\.js$/), 70_316],
  // The Briefing page, loaded after the first paint.
  // + skeletons, pull to refresh and the owner's arrangement of the tiles (2026-10-30).
  // (2026-11-02) 20,000 → 24,000: + Due and its sheet (due.js, loaded on tap), Holidays, the day's
  // line, tomorrow on the weather tile and the night line: 19,199 → 23,588 bytes.
  // (2026-11-03) 24,000 → 25,028: + the Today tile from the owner's calendars (page.js), measured
  // 23,588 → 25,028 bytes.
  // (2026-11-04, the report card) 25,028 → 28,700: + the night's report tile, its lines and Undo
  // (report.js, 3,600 bytes), measured.
  // (2026-11-04, settings depth) 28,700 → 28,722 measured: the hold's tap back follows Haptics.
  ['briefing JS bytes', sum(/^th\/briefing\/.*\.js$/), 28_722],
  // (2026-10-31) + the menu as a page with day cards, the ring's layers, the docked card, the pinned
  // line and time chip, the Briefing's hero and the 44 px hit areas.
  // (2026-11-02, T1a) 68,000 → 76,000: every motion and type value now goes through a token
  // (`var(--fs-small)/var(--lh-body)` in place of `13px/1.4`), which costs 6,929 bytes raw and
  // 1,253 bytes gzipped against 5f7cdd9. The site is served uncompressed (ARCHITECTURE.md §5, the
  // brotli proposal); when compressed uploads land, this budget moves to compressed bytes.
  ['settings CSS bytes', sum(/^apps\/settings\/.*\.css$/), 11_484], // Task B: never exceed the measured pre-redesign CSS.
  // (2026-11-02, night chat) 76,000 → 77,400: the working card and the line under the ask bar, less
  // the thinking words' shimmer (chat.css 12,025 → 14,807, +2,782 over main's 74,591): measured
  // 77,373 bytes.
  // (2026-11-02, shell feel) → 79,237 measured: the menu's and Settings' opaque fill and frost layers,
  // the ring's face, lift and name layers (+1,864 bytes net of comments trimmed in home.css).
  // (2026-11-03, schedules) +16 measured (79,253): a plan line's Undo shares Retry's look (chat.css).
  // (2026-11-04, the report card) +970 measured (80,223): the report tile's head, lines and Undo (home.css).
  // (2026-11-04, show) +882 measured (81,105): "How I got this" under a reply (chat.css).
  // (2026-11-04, settings depth) +2,658 measured (81,105 → 83,763): tokens.css follows the owner's
  // appearance (accent, glass, corners, ring size, reduced motion), compact turns, the mic off, the bar.
  ['home CSS bytes', sum(/^(apps\/home|ui)\/.*\.css$/), 83_763],
  // Styles home loads just after its first paint (th/reply/tools.css, th/attach/attach.css).
  // (2026-11-02) + the island capsule's details: +1,003 measured bytes of th/island/island.css (4,816 → 5,819).
  // (2026-11-04) + the mind's line in the capsule: +470 measured bytes of island.css (21,003 → 21,473).
  // (2026-11-04) + the apps' arrangement card, th/ported/arrangement.css (loaded by the apps, not home): +2,991 measured (21,485 → 24,476).
  ['later CSS bytes', sum(/^th\/.*\.css$/), 24_476],
  // One face since 2026-10-31: Switzer, variable 100–900 (43.2 KB, the official file, never subset:
  // its licence forbids changing it; Quicksand was 28.2 KB, Fraunces and Inter 133 KB).
  ['shell font bytes', list.filter(f => shellFile(f) && /\.woff2$/.test(f.path)).reduce((n, f) => n + f.size, 0), 48_000],
  ['precache bytes', list.filter((f) => precached(f.path)).reduce((n, f) => n + f.size, 0), 3_000_000],
  // (2026-11-04, Photos) 30,000 → 30,722 measured: star, star-fill, flag and prohibit for rating and culling.
  // (2026-11-04, Photos' editor) +2,000 measured (32,722): sun, triangle, magic-wand and circle-half.
  // (2026-11-05, Photos: the shelf's stacks and culling, then Looks) 36,043 measured: heart, heart-fill, swatches.
  ['icon sprite bytes', sum(/^ui\/icons\.svg$/), 36_043],
  // (2026-11-04, Photos' editor) the RAW engine as built (engine/photos/build.json): LightCraft's
  // decoders with JPEG XL for DNG, measured 2,242,867 bytes raw (595 KB brotli). A rebuild changes it.
  // (2026-11-05, Photos colour) setMatrix for a fitted camera matrix: 2,246,192 measured (596 KB brotli).
  ['photos engine wasm bytes', sum(/^photos\/engine\/.*\.wasm$/), 2_246_192],
];
const over = budgets.filter(([, value, limit]) => value > limit);
for (const [name, value, limit] of budgets) console.log(`${name}: ${value} (limit ${limit})`);
if (over.length) throw new Error(`over budget: ${over.map(([n]) => n).join(', ')}`);
console.log(`staged ${list.length} files for ${sha}`);
