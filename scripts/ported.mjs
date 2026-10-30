// Writes frontend/ported.json, the record of the as-is port (MIGRATION.md §5.1): for every ported
// file its hash, the old file's hash and the exact edits made to it, each folder's outside hosts
// and page CSPs. tests/ported.test.mjs checks the committed files against it, without the old repo.
// Usage: node scripts/ported.mjs <old repo checkout> <old repo commit>
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** New folder → old folder, the files outside it that the folder loads, and every edit made. */
export const PORT = {
  music: { from: 'frontend/claude-player/', assets: ['assets/error-report.js', 'assets/config.js'] },
  guitar: { from: 'frontend/guitar/', assets: ['assets/config.js', 'assets/error-report.js', 'assets/file-save.js', 'assets/shell.css'] },
  podcasts: { from: 'frontend/podcasts/', assets: ['assets/config.js', 'assets/error-report.js', 'assets/premium.css', 'assets/shell.css'] },
  astra: { from: 'frontend/astra/', assets: ['assets/config.js', 'assets/error-report.js', 'assets/libmedia/'] },
  media: { from: 'frontend/mymedia/', assets: ['assets/config.js', 'assets/error-report.js', 'assets/pip-diagnostics.js', 'assets/ui.js', 'drawercast/drive-api.js'] },
};
/** Files outside the app folders, copied from the same path in the old repo. */
export const SHARED = ['assets/', 'drawercast/drive-api.js'];
/** Each edit as [new text, old text], with its kind. Nothing else may differ from the old bytes. */
export const EDITS = {
  'media/index.html': { adjustments: ['paths'], edits: [['href="/media/mymedia.css', 'href="/mymedia/mymedia.css'], ['src="/media/app.js', 'src="/mymedia/app.js']] },
  // The reporter only reports on its own live site; its site is now this one.
  'assets/error-report.js': { adjustments: ['api-address'], edits: [["const SITE = 'https://thunderhead.z13.web.core.windows.net';", "const SITE = 'https://missionarytube.z13.web.core.windows.net';"]] },
  // P6 data move (MIGRATION.md §7 step 5, SECURITY.md §4.4 rule 4): the new Worker with the owner's session, the old
  // one while it can't answer.
  'guitar/sources.js': {
    adjustments: ['data-move'],
    edits: [
      ["import { API_ORIGIN } from '/assets/config.js';\nimport { CONFIG } from '/config.js';\nimport { sessionToken } from '/th/ported/session.js';\n", "import { API_ORIGIN } from '/assets/config.js';\n"],
      ["// P6 data move (MIGRATION.md \u00a77 step 5): the new Worker with the owner's session on this site; the old one while it can't answer.\nasync function viaNew(path, signal) {\n  const token = await sessionToken();\n  if (!token || !CONFIG.api) return null;\n  try {\n    const r = await fetch(CONFIG.api + '/v1/guitar/' + path, { signal, cache: 'no-store', headers: { Authorization: 'Bearer ' + token } });\n    return [401, 403, 503].includes(r.status) ? null : r;\n  } catch (e) { if (signal?.aborted) throw e; return null; }\n}\n\nasync function request(path, { signal, timeout = 25000, as = 'json' } = {}) {", "async function request(path, { signal, timeout = 25000, as = 'json' } = {}) {"],
      ["    const r = (await viaNew(path, controller.signal)) ?? await fetch(BASE + path, { signal: controller.signal, cache: 'no-store' });", "    const r = await fetch(BASE + path, { signal: controller.signal, cache: 'no-store' });"],
      ["      try { const e = (await r.json()).error; message = typeof e === 'string' ? e : e?.details?.reason ?? ''; } catch {}", "      try { message = (await r.json()).error; } catch {}"],
      ["    const r = (await viaNew(`sounds/${instrument}/${note}.mp3`)) ?? await fetch(url);", "    const r = await fetch(url);"],
    ],
  },
  // P5 improvement the owner agreed to (decisions 2026-10-30, ROADMAP P10): a chip to /music/#pl=<id> opens
  // that playlist, so a playlist the Thunderhead made opens where the owner lands.
  'music/src/app.js': {
    adjustments: ['improvement'],
    edits: [
      ["import './view/seekbar.js';\nimport {installDj, installDjMode} from '/th/music/dj.js';", "import './view/seekbar.js';"],
      ["  const [model] = await Promise.all([loadModel(new URL('../model/reference.json.gz', import.meta.url)), loadFonts()]);\n  installDjMode(model);", "  const [model] = await Promise.all([loadModel(new URL('../model/reference.json.gz', import.meta.url)), loadFonts()]);"],
      ["  const player = new Player(ctx);\n  installDj(ctx, player);\n  new DSP(ctx);", "  const player = new Player(ctx);\n  new DSP(ctx);"],
      ["  // The Thunderhead's \"Open in Music\" for a playlist (#pl=<id>, MUSIC.md \u00a710.2): that playlist's tracks.\n  const pl = /^#pl=([a-z0-9]{6,24})$/.exec(location.hash)?.[1];\n  if (pl && ctx.playlists?.get(pl)) {\n    history.replaceState(null, '', location.pathname + location.search);\n    ctx.bus.post('bus_gui', 'cmd_nav_to_playlist', null, {playlist: ctx.playlists.get(pl)});\n  }\n  // A library that arrives later (R2 index refresh) fills an empty player.", "  // A library that arrives later (R2 index refresh) fills an empty player."],
    ],
  },
  // The anime pick the owner asked for (decisions 2026-10-30): a link opens a title's Details; a size limit on Streams.
  'astra/src/main.js': {
    adjustments: ['improvement'],
    edits: [
      ["  window.astra = app;\n  app.start();\n  // A title from the Thunderhead's chat (?find= or ?open=, /th/astra/open.js): its Details, never Streams or the player.\n  if (/[?&](find|open)=/.test(location.search)) import('/th/astra/open.js').then(m => m.openFromLink(app)).catch(() => {});", "  window.astra = app;\n  app.start();"],
    ],
  },
  'astra/src/screens/streams.js': {
    adjustments: ['improvement'],
    edits: [
      ["/** The Thunderhead's size limit (?max_mb=, /th/astra/open.js): a stream whose known size is larger is hidden. */\nconst overLimit = (s, mb) => { const m = mb && /^([\\d.]+) (GB|MB)$/.exec(sizeFrom(s)); return !!m && Number(m[1]) * (m[2] === 'GB' ? 1000 : 1) > mb; };\n\nexport class StreamsScreen {", "export class StreamsScreen {"],
      ["    if (sec.shows !== shows || sec.limit !== (this.app.maxMb || 0)) {\n      sec.shows = shows;\n      sec.limit = this.app.maxMb || 0;\n      sec.body.replaceChildren(...(g.error ? [this.failedRow(g)]\n        : g.streams === null ? [skeletonStream(), skeletonStream()]\n        : g.streams.map((s, i) => [s, i]).filter(([s]) => !overLimit(s, this.app.maxMb)).map(([s, i]) => this.card(g, s, i))));", "    if (sec.shows !== shows) {\n      sec.shows = shows;\n      sec.body.replaceChildren(...(g.error ? [this.failedRow(g)]\n        : g.streams === null ? [skeletonStream(), skeletonStream()]\n        : g.streams.map((s, i) => this.card(g, s, i))));"],
      ["    const signature = [this.filter, this.loading, this.app.maxMb || 0, ...listed.map(g => g.addon.url + (g.error ? '!' : ''))].join('|');", "    const signature = [this.filter, this.loading, ...listed.map(g => g.addon.url + (g.error ? '!' : ''))].join('|');"],
      ["    const limit = this.app.maxMb ? h('button', {class: 'chip', type: 'button', 'aria-pressed': 'true', 'aria-label': `Under ${this.app.maxMb} MB, tap to show all sizes`, onclick: () => { this.app.maxMb = 0; this.render(); }}, `Under ${this.app.maxMb} MB \u2715`) : null;\n    this.chips.replaceChildren(this.refreshChip(), ...(limit ? [limit] : []), chip('all', 'All'), ...listed.map(g => chip(g.addon.url, g.addon.name, !!g.error)));", "    this.chips.replaceChildren(this.refreshChip(), chip('all', 'All'), ...listed.map(g => chip(g.addon.url, g.addon.name, !!g.error)));"],
    ],
  },
  // Guitar tips per section the owner asked for (decisions 2026-10-30): a section's label opens its tips.
  'guitar/reader.js': {
    adjustments: ['improvement'],
    edits: [
      ["import { filename, createDownload, nativeSaveMode, saveToDevice, triggerDownload, withDeadline } from './runtime.js';\nimport { attachTips } from '/th/guitar/teacher.js';", "import { filename, createDownload, nativeSaveMode, saveToDevice, triggerDownload, withDeadline } from './runtime.js';"],
      ["        if (section) { const label = el('span.rd-section', {}, section); label.style.left = bar.x + 'px'; node.append(label); attachTips(label, bar.index, () => this.timeline, openSheet); }", "        if (section) { const label = el('span.rd-section', {}, section); label.style.left = bar.x + 'px'; node.append(label); }"],
    ],
  },
  // Better song search the owner asked for (decisions 2026-10-30): every hit kept, ranked, typos forgiven.
  'music/src/list/sources.js': {
    adjustments: ['improvement'],
    edits: [
      ["import {listKeyOf, categoryKey, KEEP_LIST, KEEP_TRACK} from '../library/list-memory.js';\nimport {smartSongs} from '/th/music/search.js';", "import {listKeyOf, categoryKey, KEEP_LIST, KEEP_TRACK} from '../library/list-memory.js';"],
      ["      // Better search (th/music/search.js): every hit kept, typos and accents forgiven, best first.\n      case 'songs': return smartSongs(pool, q, byKey(narrow(kind, pool, trackText), line1), line1, titlesOnly);", "      case 'songs': return byKey(narrow(kind, pool, trackText), line1);"],
    ],
  },
  // The DJ shuffle the owner asked for (decisions 2026-10-30): a sixth shuffle mode planned by th/music/dj.js.
  'music/src/player/player.js': {
    adjustments: ['improvement'],
    edits: [
      ["import {StreamGuard} from './stream-guard.js';\nimport {djOrder, DJ_AHEAD, SHUFFLE_DJ} from '/th/music/dj.js';", "import {StreamGuard} from './stream-guard.js';"],
      ["  ensureOrder() {\n    const n = this.queue.length;\n    // DJ (th/music/dj.js): DJ_AHEAD songs are planned at a time; near their end, plan again.\n    const djDue = this.shuffle === SHUFFLE_DJ && (this.order?.indexOf(this.index) ?? 0) >= DJ_AHEAD - 5;\n    if (!djDue && this.order?.length === n && this.orderShuffle === this.shuffle && this.orderQueueMode === this.queueMode) return;\n    let order = [...Array(n).keys()];\n    // queue_no_shuffle: the Queue always plays in order.\n    if (this.songsShuffled && !(this.queueMode && this.ctx.pref?.('queue_no_shuffle'))) {\n      order = this.shuffle === SHUFFLE_DJ ? djOrder(this.queue, this.index) : shuffleOrder(this.queue, +(this.ctx.pref?.('shuffle_random_factor') ?? 0.5));", "  ensureOrder() {\n    const n = this.queue.length;\n    if (this.order?.length === n && this.orderShuffle === this.shuffle && this.orderQueueMode === this.queueMode) return;\n    let order = [...Array(n).keys()];\n    // queue_no_shuffle: the Queue always plays in order.\n    if (this.songsShuffled && !(this.queueMode && this.ctx.pref?.('queue_no_shuffle'))) {\n      order = shuffleOrder(this.queue, +(this.ctx.pref?.('shuffle_random_factor') ?? 0.5));"],
    ],
  },
  // P8 data move (MIGRATION.md §7 step 5, SECURITY.md §4.4 rule 4): the Podcasts worker answers the app's
  // requests to the old Worker from the new one (th/podcasts/bridge.js), the old one while the new one can't.
  'podcasts/sw.js': {
    adjustments: ['data-move'],
    edits: [
      ["// P8 data move (MIGRATION.md \u00a77 step 5): the app's requests to the old Worker are answered from the new Worker, the old one while it can't.\nimport {podcastsBridge} from '/th/podcasts/bridge.js';\npodcastsBridge.use('https://jarvis-hub-api.braydenparker999.workers.dev');\nconst SHELL = 'jarvis-podcast-shell-v6';", "const SHELL = 'jarvis-podcast-shell-v6';"],
      ["  const req = event.request, url = new URL(req.url);\n  if (podcastsBridge.handles(url)) { event.respondWith(podcastsBridge.answer(req, event)); return; }\n", "  const req = event.request, url = new URL(req.url);\n"],
    ],
  },
  // P5 data move (MIGRATION.md §7 step 5, SECURITY.md §4.4 rule 4): the player's worker answers its library
  // requests from the new Worker (th/music/bridge.js), the old one while the new one can't.
  'music/sw.js': {
    adjustments: ['data-move', 'improvement'],
    edits: [
      ["  // The DJ shuffle's planner and the better search (th/music/dj.js, search.js) are part of the app, offline too.\n  if (!url.pathname.startsWith(new URL('./', self.registration.scope).pathname) && !/^\\/th\\/music\\/(dj|search)\\.js$/.test(url.pathname)) return;", "  if (!url.pathname.startsWith(new URL('./', self.registration.scope).pathname)) return;"],
      ["// P5 data move (MIGRATION.md \u00a77 step 5): the library's requests are answered from the new Worker, the old one while it can't.\nimportScripts('/th/music/bridge.js');\nself.thMusicBridge.use('https://jarvis-hub-api.braydenparker999.workers.dev');\nconst net = (req, e) => self.thMusicBridge.handles(new URL(req.url)) ? self.thMusicBridge.answer(req, e) : fetch(req);\nconst CACHE = 'claude-player-v1';", "const CACHE = 'claude-player-v1';"],
      ["async function fromHead(req, h, a, b, e) {", "async function fromHead(req, h, a, b) {"],
      ["heads.delete(url); return net(req, e); }", "heads.delete(url); return fetch(req); }"],
      ["return c ? fromHead(req, ...c, e) : net(req, e); }));", "return c ? fromHead(req, ...c) : fetch(req); }));"],
      ["if (c) { e.respondWith(fromHead(req, ...c, e)); return; }\n  }\n  if (self.thMusicBridge.handles(url)) { e.respondWith(self.thMusicBridge.answer(req, e)); return; }", "if (c) { e.respondWith(fromHead(req, ...c)); return; }\n  }"],
    ],
  },
};

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const HOST_URL = /https?:\/\/[^\s"'()<>`\\]+/g;
export function hostsIn(text) {
  const hosts = new Set();
  for (const [url] of text.matchAll(HOST_URL)) {
    const m = /^https?:\/\/([A-Za-z0-9*][A-Za-z0-9.*-]*(?::[0-9*]+)?)/.exec(url);
    if (m) hosts.add(m[1].toLowerCase());
  }
  return hosts;
}
export const cspOf = html => /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? null;
export const TEXT = /\.(html|css|js|json|webmanifest|txt|md)$/;

export async function filesUnder(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    out.push(...(e.isDirectory() ? await filesUnder(p) : [p]));
  }
  return out.sort();
}

/** Reverse the recorded edits: the result must be the old file, byte for byte. */
export function undo(text, edits) {
  let out = text;
  for (const [now, before] of edits) {
    if (!out.includes(now)) throw new Error(`edit not found: ${now}`);
    out = out.split(now).join(before);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [oldRepo, oldCommit] = process.argv.slice(2);
  if (!oldRepo || !/^[0-9a-f]{40}$/.test(oldCommit ?? '')) throw new Error('usage: node scripts/ported.mjs <old repo> <40-hex commit>');
  const site = fileURLToPath(new URL('../frontend/', import.meta.url));
  const old = path => execFileSync('git', ['-C', oldRepo, 'show', `${oldCommit}:${path}`], { maxBuffer: 64 << 20 });
  const record = async (rel, oldPath) => {
    const bytes = await readFile(join(site, rel));
    const before = old(oldPath);
    const e = EDITS[rel] ?? { adjustments: [], edits: [] };
    if (e.edits.length) {
      if (undo(bytes.toString('utf8'), e.edits) !== before.toString('utf8')) throw new Error(`${rel}: differs from the old file beyond its recorded edits`);
    } else if (sha(bytes) !== sha(before)) throw new Error(`${rel}: differs from the old file and has no recorded edits`);
    return { sha256: sha(bytes), old_sha256: sha(before), adjustments: e.adjustments, ...(e.edits.length ? { edits: e.edits } : {}) };
  };
  const folders = {};
  for (const [name, { from, assets }] of Object.entries(PORT)) {
    const files = {}, hosts = new Set(), csp = {};
    for (const f of await filesUnder(join(site, name))) {
      const rel = relative(site, f);
      files[rel] = await record(rel, from + rel.slice(name.length + 1));
      if (TEXT.test(rel)) {
        const text = await readFile(f, 'utf8');
        for (const h of hostsIn(text)) hosts.add(h);
        if (rel.endsWith('.html')) csp[rel] = cspOf(text);
      }
    }
    folders[name] = { from, files, assets, hosts: [...hosts].sort(), csp };
  }
  const shared = {}, sharedHosts = new Set();
  for (const s of SHARED) {
    const list = s.endsWith('/') ? await filesUnder(join(site, s)) : [join(site, s)];
    for (const f of list) {
      const rel = relative(site, f);
      shared[rel] = await record(rel, 'frontend/' + rel);
      if (TEXT.test(rel)) for (const h of hostsIn(await readFile(f, 'utf8'))) sharedHosts.add(h);
    }
  }
  const out = { v: 1, old_repo: 'braydenparker000/Missionarytube-', old_repo_commit: oldCommit, folders, shared, shared_hosts: [...sharedHosts].sort() };
  await writeFile(join(site, 'ported.json'), JSON.stringify(out, null, 1) + '\n');
  const n = Object.values(folders).reduce((a, f) => a + Object.keys(f.files).length, 0) + Object.keys(shared).length;
  console.log(`ported.json: ${n} files from ${oldCommit.slice(0, 12)}`);
}
