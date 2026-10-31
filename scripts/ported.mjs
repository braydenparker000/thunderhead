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
  // The owner's yes (2026-10-31, the audit's fix list): the pages are titled by their app's name, not the
  // old project's ("Claude Player", "· Jarvis").
  'media/index.html': { adjustments: ['paths', 'improvement'], edits: [['href="/media/mymedia.css', 'href="/mymedia/mymedia.css'], ['src="/media/app.js', 'src="/mymedia/app.js'], ['<title>My Media</title>', '<title>My Media · Jarvis</title>']] },
  'music/index.html': { adjustments: ['improvement'], edits: [['<title>Music</title>', '<title>Claude Player</title>']] },
  'guitar/index.html': { adjustments: ['improvement'], edits: [['<title>Guitar</title>', '<title>Guitar · Jarvis</title>']] },
  'podcasts/index.html': { adjustments: ['improvement'], edits: [['<title>Podcasts</title>', '<title>Podcasts · Jarvis</title>']] },
  // The same list: when the page's Drive settings can't be read, it says so in words instead of showing
  // the JSON parser's message.
  'media/app.js': {
    adjustments: ['improvement'],
    edits: [["    if (!response.ok) throw Error(\"My Media isn't set up on this site yet.\");\n    const config = await response.json().catch(() => { throw Error(\"My Media's settings couldn't be read.\"); });\n", '    const config = await response.json();\n']],
  },
  // The reporter only reports on its own live site; its site is now this one.
  // Data moves (MIGRATION.md §2.5): signed in, every ported page reports its errors to the new Worker's inbox with
  // the owner's session (th/ported/session.js), addresses cut to their host; signed out, to the old one as before.
  // P9 (the owner's yes, decisions 2026-10-30): signed in, the page's opening is one sense event.
  'assets/error-report.js': {
    adjustments: ['api-address', 'data-move', 'improvement'],
    edits: [
      ["const SITE = 'https://thunderhead.z13.web.core.windows.net';", "const SITE = 'https://missionarytube.z13.web.core.windows.net';"],
      ["import {API_ORIGIN} from './config.js';\nimport {CONFIG} from '/config.js';\n", "import {API_ORIGIN} from './config.js';\n"],
      ["const app = script?.dataset.app || location.pathname.split('/')[1] || 'home';\n// Data moves (MIGRATION.md §2.5): signed in, a page reports to the new Worker's inbox with the owner's session (a top-level page only); signed out, as before.\nlet session = null;\nimport('/th/ported/session.js').then(m => m.sessionToken()).then(t => { session = t; }, () => {});\n// What the owner uses (P9, EVALS.md M-16, M-18): this app opening, signed in, is one event (th/senses/send.js).\nif (location.origin === SITE) import('/th/senses/send.js').then(m => m.sense(`${app}.open`)).catch(() => {});\n// The new inbox's shape (API.md §11.16): a code and a message, with where in this site's code it came from instead of a\n// stack; an address in the message keeps only its host (add-on and stream addresses are secrets, ASTRA.md §5.2).\nconst where = stack => stack.split(location.origin + '/')[1]?.match(/^[^\\s()]+:\\d+:\\d+/)?.[0];\nconst bare = text => text.replace(/\\bhttps?:\\/\\/([^/\\s?#]+)\\S*/g, '$1/…');\nconst item = r => ({source: 'client', code: `${r.app}.${r.kind}`, route: r.path, message: (where(r.stack) ? `${bare(r.message)} @ /${where(r.stack)}` : bare(r.message)).slice(0, 300), build: 0, at: r.at});\n", "const app = script?.dataset.app || location.pathname.split('/')[1] || 'home';\n"],
      ["    if (session && CONFIG.api) fetch(CONFIG.api + '/v1/ops/errors', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + session}, body: JSON.stringify({items: reports.map(item)}), keepalive: true, credentials: 'omit', mode: 'cors'}).catch(() => {});\n    else fetch(ENDPOINT, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({reports}), keepalive: true, credentials: 'omit', mode: 'cors'}).catch(() => {});\n", "    fetch(ENDPOINT, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({reports}), keepalive: true, credentials: 'omit', mode: 'cors'}).catch(() => {});\n"],
    ],
  },
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
  // Playback that holds on (the owner's report, 2026-10-31: it breaks, and headset skips work half the time, never
  // with the screen off): a deck that makes way for a skip or a reload plays on, silent, until the new one sounds
  // (Android keeps the media session only while an element plays); a Stop action, no 10-second jumps for the
  // headset, and the lock screen says paused while nothing has sounded for 12 s.
  'music/src/player/player.js': {
    adjustments: ['improvement'],
    edits: [
      ["import {StreamGuard} from './stream-guard.js';\nimport {djOrder, DJ_AHEAD, SHUFFLE_DJ} from '/th/music/dj.js';", "import {StreamGuard} from './stream-guard.js';"],
      ["  ensureOrder() {\n    const n = this.queue.length;\n    // DJ (th/music/dj.js): DJ_AHEAD songs are planned at a time; near their end, plan again.\n    const djDue = this.shuffle === SHUFFLE_DJ && (this.order?.indexOf(this.index) ?? 0) >= DJ_AHEAD - 5;\n    if (!djDue && this.order?.length === n && this.orderShuffle === this.shuffle && this.orderQueueMode === this.queueMode) return;\n    let order = [...Array(n).keys()];\n    // queue_no_shuffle: the Queue always plays in order.\n    if (this.songsShuffled && !(this.queueMode && this.ctx.pref?.('queue_no_shuffle'))) {\n      order = this.shuffle === SHUFFLE_DJ ? djOrder(this.queue, this.index) : shuffleOrder(this.queue, +(this.ctx.pref?.('shuffle_random_factor') ?? 0.5));", "  ensureOrder() {\n    const n = this.queue.length;\n    if (this.order?.length === n && this.orderShuffle === this.shuffle && this.orderQueueMode === this.queueMode) return;\n    let order = [...Array(n).keys()];\n    // queue_no_shuffle: the Queue always plays in order.\n    if (this.songsShuffled && !(this.queueMode && this.ctx.pref?.('queue_no_shuffle'))) {\n      order = shuffleOrder(this.queue, +(this.ctx.pref?.('shuffle_random_factor') ?? 0.5));"],
      ["// the two cross-fade exactly; a slower one does not leave the old track heard meanwhile.\nconst MANUAL_WAIT_MS = 500;\n// A deck that makes way (a skip, a reload) before the deck taking over has sounded plays on, silent,\n// until that one sounds, at most this long (ms): Android keeps a page's media session, and with it the\n// lock screen and the headset's buttons, only while one of its elements plays.\nconst HOLD_MS = 12000;\n", "// the two cross-fade exactly; a slower one does not leave the old track playing meanwhile.\nconst MANUAL_WAIT_MS = 500;\n"],
      ["      el.addEventListener('playing', () => { el._heard = true; if (el === this.audio) this.releaseHeld(); });\n", "      el.addEventListener('playing', () => { el._heard = true; });\n"],
      ["        if ((el === this.audio || this.splicing?.el === el || this.held?.el === el) && !el.ended) this.systemPaused();\n", "        if ((el === this.audio || this.splicing?.el === el) && !el.ended) this.systemPaused();\n"],
      ["          // start (its stream not on the phone yet) does not leave the old one heard meanwhile; it plays on,\n          // silent, until the new one sounds (holdSilent).\n          const outMs = auto ? fadeMs : Math.max(DECLICK_MS, Math.min(fadeMs, oldLeft)), onTime = auto || oldLeft < fadeMs;\n          this.fader.ramp(old, 0, outMs, () => {\n            if (old === this.audio || this.holdSilent(old)) return;\n", "          // start (its stream not on the phone yet) does not leave the old one playing meanwhile.\n          const outMs = auto ? fadeMs : Math.max(DECLICK_MS, Math.min(fadeMs, oldLeft)), onTime = auto || oldLeft < fadeMs;\n          this.fader.ramp(old, 0, outMs, () => {\n            if (old === this.audio) return;\n"],
      ["        // A deck held for the track before (holdSilent) plays on until this one sounds: the track loads on the other.\n        if (this.held && this.held.el !== this.audio) this.unload(this.audio);\n        // A pause's fade-out still running: that deck fades out quickly and the track loads on the other one.\n        else if (!this.audio.paused && this.decks.length > 1) {\n", "        // A pause's fade-out still running: that deck fades out quickly and the track loads on the other one.\n        if (!this.audio.paused && this.decks.length > 1) {\n"],
      ["    if (this.splicing?.el === el) this.cancelSplice();\n    if (this.held?.el === el) { clearTimeout(this.held.timer); this.held = null; }\n", "    if (this.splicing?.el === el) this.cancelSplice();\n"],
      ["  /** Lets a deck go: one still sounding (a pause's fade-out) fades out over 32 ms first (playing, it may wait silent: holdSilent). */\n  retire(el) {\n    if (el.paused) { this.unload(el); return; }\n    this.fader.ramp(el, 0, DECLICK_MS * 4, () => { if (el !== this.audio && !this.holdSilent(el)) this.unload(el); }, {curve: 'smooth'});\n  }\n\n  /**\n   * A deck that made way while playing, before the deck now playing has sounded (a skip to a song\n   * the network is slow to start, a reload): it plays on silent until that one sounds (releaseHeld),\n   * HOLD_MS at most, then pauses with its source kept. Returns whether it is held.\n   */\n  holdSilent(el) {\n    if (el === this.audio || this.state !== STATE_PLAYING || this.audio._heard || el.paused || el.ended || el.error) return false;\n    if (this.held && this.held.el !== el) this.releaseHeld();\n    clearTimeout(this.held?.timer);\n    this.fader.set(el, 0);\n    const held = this.held = {el, timer: setTimeout(() => {\n      if (this.held !== held) return;\n      this.held = null;\n      if (el !== this.audio) this.halt(el);\n    }, HOLD_MS)};\n    return true;\n  }\n\n  /** The playing deck sounds: a deck held for it lets go. */\n  releaseHeld() {\n    const h = this.held;\n    if (!h) return;\n    this.held = null;\n    clearTimeout(h.timer);\n    if (h.el === this.audio) return;\n    this.unload(h.el);\n    this.fader.set(h.el, 1);\n", "  /** Lets a deck go: one still sounding (a pause's fade-out) fades out over 32 ms first. */\n  retire(el) {\n    if (el.paused) { this.unload(el); return; }\n    this.fader.ramp(el, 0, DECLICK_MS * 4, () => { if (el !== this.audio) this.unload(el); }, {curve: 'smooth'});\n"],
      ["    el.src = url;\n    // (Not heard yet: its 'loadstart' comes later.)\n    el._heard = false;\n", "    el.src = url;\n"],
      ["    let el = this.audio;\n    const t = this.track, token = this.loadToken;\n", "    const el = this.audio, t = this.track, token = this.loadToken;\n"],
      ["    // A stuck deck that still plays waits silent (holdSilent) while the track reloads on the idle deck.\n    const idle = this.state === STATE_PLAYING && !el.paused && !el.error && this.decks.find(d => d !== el && d.paused && !this.fader.pending.has(d));\n    if (idle) {\n      this.unload(idle);\n      this.audio = idle;\n      this.fader.set(idle, 0);\n      this.ctx.dsp?.setReplayGain?.(idle, replayGainOf(this.ctx, t));\n      this.assign(idle, url);\n      if (!this.holdSilent(el)) this.unload(el);\n      el = idle;\n    } else this.assign(el, url);\n", "    this.assign(el, url);\n"],
      ["      // Stop (MUSIC.md §5.7): paused where it is and both decks let go (the track waits on one, loading nothing).\n      stop: () => { if (!this.track) return; const at = this.positionMs(); this.pause(); this.pendingSeek = at; this.load(this.index, false); },\n      // Not set for Music (MUSIC.md §5.7): on some headsets and phones they take the place of next and previous.\n      seekforward: null, seekbackward: null,\n", "      seekforward: () => this.seek(this.positionMs() + 10000), seekbackward: () => this.seek(this.positionMs() - 10000),\n"],
      ["    // The state says what is heard: playing with nothing sounding for HOLD_MS (a stall, a song the network is\n    // slow to start), it reads paused until the sound returns.\n    let quiet = 0, since = 0;\n    const sounding = () => !this.isMedia(this.track) || (!this.audio.paused && this.audio.readyState >= 3);\n    const state = () => {\n      clearTimeout(quiet);\n      const playing = this.state === STATE_PLAYING;\n      if (!playing || sounding()) since = 0;\n      else since ||= performance.now();\n      const left = since ? since + HOLD_MS - performance.now() : 0;\n      ms.playbackState = playing && (!since || left > 0) ? 'playing' : 'paused';\n      if (left > 0) quiet = setTimeout(state, left);\n    };\n    this.ctx.bus.subscribe('bus_player', (msg, src, d) => {\n      const t = this.track;\n      if (msg === 'msg_player_track_changed' && !d?.meta) state();\n", "    this.ctx.bus.subscribe('bus_player', (msg) => {\n      const t = this.track;\n"],
      ["        state();\n", "        ms.playbackState = this.state === STATE_PLAYING ? 'playing' : 'paused';\n"],
      ["      el.addEventListener('playing', () => { if (el === this.audio) { state(); position(); } });\n      el.addEventListener('waiting', () => { if (el === this.audio) state(); });\n", "      el.addEventListener('playing', () => { if (el === this.audio) position(); });\n"],
    ],
  },
  // The same report: the stream guard asks its file past the head kept on the phone (which the service worker
  // answers even offline), and after 6 failed reloads with the network up it pauses and says so instead of
  // trying for ever.
  'music/src/player/stream-guard.js': {
    adjustments: ['improvement'],
    edits: [
      ["//   its file answers is skipped (\"Failed to play\"), at most SKIP_RUN in a row;\n// - online, after GIVE_UP failed tries the player pauses and says so; Play tries again.\n", "//   its file answers is skipped (\"Failed to play\"), at most SKIP_RUN in a row.\n"],
      ["// Failed tries in a row, the network up, before the player pauses (\"Lost the connection\").\nconst GIVE_UP = 6;\n// How far ahead an offline copy is looked for.\nconst AHEAD = 16;\n\n/**\n * Whether a remote file answers ('gone' for 404 / 410), without downloading it. Asked at byte `from`:\n * past the song's head kept on the phone, which the service worker would answer even offline.\n */\nexport async function probeFile(url, from = 0) {\n  if (!/^https?:/.test(url || '')) return 'local';\n  try {\n    const r = await fetch(url, {headers: {Range: `bytes=${from}-${from + 1}`}, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'});\n", "// How far ahead an offline copy is looked for.\nconst AHEAD = 16;\n\n/** Whether a remote file answers ('gone' for 404 / 410), without downloading it. */\nexport async function probeFile(url) {\n  if (!/^https?:/.test(url || '')) return 'local';\n  try {\n    const r = await fetch(url, {headers: {Range: 'bytes=0-1'}, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'});\n"],
      ["    }\n    // Online and failing again and again: the player stops trying and says so (Play tries again).\n    if (this.attempts >= GIVE_UP && !copy) { this.giveUp(); return; }\n", "    }\n"],
      ["      const answer = await this.probe(t.src, p.ctx.audioHeads?.kept?.get(t.src)?.head ?? 0);\n", "      const answer = await this.probe(t.src);\n"],
      ["    p.skipTrack();\n  }\n\n  /** The stream keeps failing with the network up: the player pauses with a toast, and Play reloads the track where it was. */\n  giveUp() {\n    const p = this.p;\n    this.counts.gaveUp = (this.counts.gaveUp ?? 0) + 1;\n    this.note('gave_up', {after: this.attempts, atMs: Math.round(this.pos * 1000)});\n    this.attempts = 0;\n    p.pause();\n    this.pending = true;\n    p.ctx.bus.post('bus_gui', 'cmd_gui_show_toast', p, {title: 'Lost the connection', line2: 'Tap play to try again'});\n", "    p.skipTrack();\n"],
    ],
  },
  // The same report: a fade on the elements' volume (before the audio engine joins) steps on a timer while the page
  // is hidden (no animation frames then) and always ends at its level, so a skip with the screen off is heard.
  'music/src/player/fades.js': {
    adjustments: ['improvement'],
    edits: [
      ["      clearTimeout(entry.timer);\n      entry.cancel?.();\n", "      clearTimeout(entry.timer);\n"],
      ["    const from = el.volume, t0 = performance.now();\n    const step = now => {\n      const k = Math.min(1, Math.max(0, now - t0) / Math.max(1, ms));\n      el.volume = Math.max(0, Math.min(1, from + (to - from) * k));\n      return k < 1;\n    };\n    // A hidden page gets no frames: a timer steps the fade then.\n    const off = this.ctx.onFrame?.(step), tick = setInterval(() => { if (globalThis.document?.hidden) step(performance.now()); }, 25);\n    entry.cancel = () => { off?.(); clearInterval(tick); };\n    // At its end the fade's level is set, however few steps it took.\n    entry.timer = setTimeout(() => { if (this.pending.get(el) === entry) el.volume = Math.max(0, Math.min(1, to)); finish(); }, ms);\n", "    const from = el.volume;\n    let t0 = null;\n    entry.cancel = this.ctx.onFrame?.(now => {\n      t0 ??= now;\n      const k = Math.min(1, (now - t0) / Math.max(1, ms));\n      el.volume = Math.max(0, Math.min(1, from + (to - from) * k));\n      return k < 1;\n    });\n    entry.timer = setTimeout(finish, ms);\n"],
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
