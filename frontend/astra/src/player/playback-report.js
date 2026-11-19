// The playback report: one plain text, safe to paste into a chat, copied from the player's Stream info while a film
// plays, from its error card, and from the lab (docs/product/apps/ASTRA.md §5.2 rule 3). It says where the time went
// between the film's load and its first picture (the engine's `timing` entries), the route and why, the tracks, this
// phone's decoders, how the address was found (the resolver's via and each step's time, from addons/debrid.js), the
// server group, the link's speed and the stalls so far, then the engine's log, where an entry of a kind this module
// does not know is printed as a plain line rather than dropped. It never holds an address, a hash, a key, a token or
// a file name: none is put in, and scrubSecrets() takes out any that a log line carried. scrubSecrets(),
// serverGroup() and deviceLine() live here so the player need not load the lab (lab/scrub.js passes them on).

import {deviceReport, surroundWords} from '../engine/capabilities.js';

/** How an address was found (addons/debrid.js answerFor), loaded only when asked: the player and the lab must not
 * depend on the Worker's helper to start (the app has it loaded already; the lab may not have it at all). */
const answerFor = async (...a) => { try { return (await import('../addons/debrid.js')).answerFor(...a); } catch { return null; } };

const ADDRESS = /\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s/?#@"'<>()[\]]*@)?([^\s/?#@"'<>()[\]:]*)(?::\d+)?[^\s"'<>()[\]]*/gi;
const QUERY = /([?&;](?:token|apikey|api_key|key|access_token|password|pass|secret)=)[^&\s#"'<>]*/gi;
const RUN = /[A-Za-z0-9_-]{32,}/g;
const FILE = /[^\s/\\"'<>|:*?]+\.(?:mkv|mp4|m4v|avi|webm|mov|ts|m2ts|mts|wmv|flv|mpg|mpeg|vob|iso|ogv|3gp|srt|ass|ssa|vtt|sub|idx|ttf|otf)\b/gi;

/**
 * `text` with every address, key, hash and file name taken out: every address becomes its host and "/…" (or
 * "[address]" with `hosts: false`), a key, token or password named in a query becomes ***, any run of 32 or more hex
 * or base64url characters (a hash, a key, a token, an encoded add-on setting) becomes ***, a video, subtitle or font
 * file's name becomes [file], and each of the `known` strings (the addresses and names the caller held) is removed
 * wherever it appears, plain or percent-encoded. @param {string} text @param {{known?: string[], hosts?: boolean}} [o]
 */
export function scrubSecrets(text, {known = [], hosts = true} = {}) {
  let out = String(text ?? '');
  for (const k of known) {
    if (typeof k !== 'string' || k.length < 4) continue;
    for (const form of new Set([k, encodeURIComponent(k), encodeURI(k)])) out = out.split(form).join('[removed]');
  }
  out = out.replace(QUERY, '$1***');
  out = out.replace(ADDRESS, (_m, host) => (hosts && host ? `${host}/…` : '[address]'));
  out = out.replace(RUN, '***');
  return out.replace(FILE, '[file]');
}

/**
 * The TorBox server group a file's host names: the label before "tb-cdn" (nexus-1.latm.tb-cdn.example → latm), and
 * nothing else of the host; '' for a host that is not TorBox's.
 */
export function serverGroup(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return ''; }
  const labels = host.split('.'), at = labels.indexOf('tb-cdn');
  return at > 0 && /^[a-z0-9-]{1,20}$/.test(labels[at - 1]) ? labels[at - 1] : '';
}

/** The browser and system in two words each, from the user agent: "Chrome 131, Android 14". */
export function deviceLine(ua = globalThis.navigator?.userAgent || '') {
  const first = list => list.map(r => r.exec(ua)).find(Boolean);
  const browser = first([/(Edg|SamsungBrowser|Firefox)\/(\d+)/, /(Chrome)\/(\d+)/, /(Version)\/(\d+)/]);
  const system = first([/Android [\d.]+/, /iPhone OS [\d_]+/, /Windows NT [\d.]+/, /Mac OS X [\d_]+/, /Linux/]);
  return [browser && `${browser[1] === 'Version' ? 'Safari' : browser[1]} ${browser[2]}`, system && system[0].replace(/_/g, '.')].filter(Boolean).join(', ');
}

const MODE = {remux: 'Astra unpacks it', native: 'the browser plays it as it is', software: 'Astra’s software decoder', hls: 'HLS stream', dash: 'DASH stream', unsupported: 'it cannot play here'};
const VIA = {torbox: 'from TorBox directly', follow: 'where the add-on’s link leads, found by your server', addon: 'the add-on’s own link', none: 'none: not on TorBox yet'};
const STEP = {open: 'opened', index: 'index read', plan: 'way chosen', fragment: 'first fragment', picture: 'first picture'};
const ms = n => `${Math.round(n)} ms`;
const kib = n => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MiB` : `${Math.round(n / 1024)} KiB`);
const clock = s => { if (!(s >= 0)) return '?'; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? `${h}:${String(m).padStart(2, '0')}` : m) + ':' + String(x).padStart(2, '0'); };

/** A log entry's detail on one line: words as they are, objects as `name value` pairs. */
export function plain(detail) {
  if (detail == null) return '';
  if (typeof detail !== 'object') return String(detail);
  if (Array.isArray(detail)) return detail.map(plain).join(', ');
  return Object.entries(detail).map(([k, v]) => `${k} ${v && typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ');
}

/** The current film's part of the engine's log: from its last `open` (each load begins there). */
export function thisLoad(log = []) {
  let at = -1;
  log.forEach((e, i) => { if (e.kind === 'timing' && e.detail?.step === 'open') at = i; });
  const entries = at >= 0 ? log.slice(at) : log;
  const first = entries.find(e => e.kind === 'timing' && e.detail?.step !== 'track');
  return {entries, start: first ? first.t - (first.detail.ms || 0) : entries[0]?.t ?? 0};
}

/** "Where the time went": each step's time since the load, the gap since the one before, and what it cost. */
export function timeLines(entries, start) {
  let before = 0;
  return entries.filter(e => e.kind === 'timing').map(({t, detail: d}) => {
    const since = d.step === 'track' ? t - start : d.ms;
    const what = d.step === 'track' ? `track ${d.track ?? '?'}${d.type ? ` (${d.type})` : ''} read in ${ms(d.ms || 0)}` : STEP[d.step] || String(d.step);
    const line = `    ${what}: ${ms(since)} (+${ms(Math.max(0, since - before))})${d.bytes ? `, ${kib(d.bytes)} in ${d.requests || 0} ${d.requests === 1 ? 'request' : 'requests'}` : ''}`;
    before = Math.max(before, since);
    return line;
  });
}

/** The resolver's answer: how the address was found, each step and its time, and the server's own. */
export function resolverLines(answer) {
  if (!answer) return ['Address: as given (not asked of your server)'];
  return [`Address: ${VIA[answer.via] || answer.via}${answer.reason ? `: ${answer.reason}` : ''}`,
    ...(Number.isFinite(answer.total) ? [`    your server’s own time: ${ms(answer.total)}`] : []),
    ...(answer.steps || []).map(s => `    ${s.step} ${s.ok ? '✓' : '✗'} ${ms(+s.ms || 0)}${s.note ? `: ${s.note}` : ''}`)];
}

/** The tracks: the picture, each sound (the one playing marked), the subtitles. */
function trackLines(e) {
  const v = e.info?.video?.[0];
  const audio = typeof e.audioOptions === 'function' ? e.audioOptions() : [];
  const subs = typeof e.subtitleOptions === 'function' ? e.subtitleOptions() : [];
  const sub = subs.find(s => s.selected);
  return ['Tracks:',
    `    picture: ${v ? [v.label || v.codec, v.width && `${v.width}×${v.height}`, v.hdr && 'HDR'].filter(Boolean).join(' ') : 'not read'}`,
    ...audio.map(a => `    sound: ${a.label}${a.selected ? ' (playing)' : ''}${a.delivery === 'rebuilt' ? ', converted on this phone' : ''}${a.supported ? '' : `, not playable here${a.reason ? `: ${a.reason}` : ''}`}`),
    `    subtitles: ${sub ? `${sub.label} (shown)` : 'off'}, ${subs.length} in all`];
}

/** The engine's log since the load, each entry one plain line; kinds summarised above are left out. */
function logLines(entries, start) {
  const shown = entries.filter(e => e.kind !== 'timing').slice(-60);
  return shown.length ? ['Log (seconds since the load):', ...shown.map(e => `    +${((e.t - start) / 1000).toFixed(1)} ${e.kind}: ${plain(e.detail)}`.slice(0, 240))] : [];
}

/** This phone's decoders, in a few lines. */
const deviceLines = device => (device ? ['This phone:', `    decodes ${Object.entries(device.mse).map(([k, v]) => `${k} ${v ? 'yes' : 'no'}`).join(', ')}`,
  `    ${surroundWords(device)}`, `    Opus encoder ${device.opusEncoder ? 'yes' : 'no'}, WebCodecs ${device.webCodecs ? 'yes' : 'no'}`] : []);
const heading = ua => `Astra playback report, ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC${deviceLine(ua) ? `, ${deviceLine(ua)}` : ''}`;

/**
 * The report for what `engine` (AstraPlayer) plays now. `answer` is how the address was found (debrid.js answerFor,
 * looked up by the address itself when not given); `known` the addresses and names the caller holds, taken out
 * wherever they appear; `opened` false when the film never reached the engine (not on TorBox, no stream): then only
 * how the address was asked for and this phone. Resolves the text.
 */
export async function playbackReport(engine, {answer, known = [], ua, opened = true} = {}) {
  const e = engine, url = typeof e.url === 'string' ? e.url : '';
  const device = await deviceReport().catch(() => null);
  if (!opened) return scrubSecrets([heading(ua), 'The film was not opened.', ...resolverLines(answer ?? null), ...deviceLines(device)].join('\n'), {known: known.filter(Boolean), hosts: false});
  const {entries, start} = thisLoad(e.log || []);
  const used = typeof e.dataUsed === 'function' ? (() => { try { return e.dataUsed(); } catch { return null; } })() : null;
  const rate = e.session?.rebuffer?.link?.rate?.() || 0;
  const stalls = entries.filter(x => x.kind === 'stall'), held = entries.filter(x => x.kind === 'rebuffer');
  const q = e.video?.getVideoPlaybackQuality?.(), group = serverGroup(url);
  const text = [
    heading(ua),
    `How it plays: ${e.mode ? `${e.mode} (${MODE[e.mode] || e.mode})` : 'not decided yet'}${e.plan?.reason ? `: ${e.plan.reason}` : ''}`,
    ...(e.plan?.notes || []).map(n => `    ${n}`),
    'Where the time went (since the film’s load):', ...timeLines(entries, start),
    ...resolverLines(answer === undefined ? await answerFor(url) : answer),
    `Server: ${group ? `TorBox group ${group}` : 'not one of TorBox’s file servers'}`,
    `Speed: ${rate ? `${(rate * 8 / 1e6).toFixed(1)} Mbit/s while downloading` : 'not measured yet'}${used ? `, ${(used / 1e6).toFixed(1)} MB downloaded so far` : ''}`,
    `Stalls so far: ${stalls.length}${stalls.length ? ` (at ${stalls.slice(-5).map(s => clock(s.detail?.at)).join(', ')})` : ''}; waits for a slow link: ${held.length}`,
    `Now: ${clock(e.video?.currentTime)}${e.video?.videoWidth ? `, ${e.video.videoWidth}×${e.video.videoHeight}` : ''}${q ? `, ${q.totalVideoFrames} frames shown, ${q.droppedVideoFrames} dropped` : ''}${e.video?.error ? `, error ${e.video.error.code}` : ''}`,
    ...(e.info ? trackLines(e) : ['Tracks: not read']),
    ...deviceLines(device),
    ...logLines(entries, start),
  ].join('\n');
  return scrubSecrets(text, {known: [url, ...known].filter(Boolean), hosts: false});
}

/** Copies the report; resolves whether it was copied. */
export async function copyPlaybackReport(engine, options = {}) {
  try { await navigator.clipboard.writeText(await playbackReport(engine, options)); return true; } catch { return false; }
}

/** What the player knows that must never show: the stream's address, its file's name, its torrent. */
export const streamSecrets = stream => [stream?.url, stream?.filename, stream?.behaviorHints?.filename, stream?.infoHash].filter(s => typeof s === 'string');

/** The player's own copy (Stream info, the error card): the film playing, or how it was asked for when it never opened. */
export async function copyFromPlayer(p) {
  const opened = !!p.stream?.url;
  return copyPlaybackReport(p.engine, {opened, answer: opened ? undefined : await answerFor(), known: streamSecrets(p.stream)});
}
