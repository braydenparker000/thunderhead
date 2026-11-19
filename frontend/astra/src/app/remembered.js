// The stream a progress entry remembers (owner ruling 2026-11-19), so a Continue Watching card plays the same
// file again without the stream list: the add-on's link, what the link says of the file (addons/link-facts.js),
// the release group, the add-on's name and the card's own label. Pure, and shared by the store's sanitiser
// (store.js progressEntry: every read, a backup, another phone's entry through sync) and the play path.
// A finished entry keeps only the release group (Next Up continues it). These are secrets at rest on the phone,
// as the add-on list is: never logged, shown or sent anywhere but the owner's own server, as a tap sends them.

import {linkFacts} from '../addons/link-facts.js';
import {withoutHash} from '../addons/stream-text.js';

export const LINK_MAX = 4096;
const HEX40 = /^[0-9a-f]{40}$/;
const isObject = v => v != null && typeof v === 'object' && !Array.isArray(v);
/** One line of text, capped; null when empty. */
const line = (v, max) => typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null;
const httpsLink = v => {
  if (typeof v !== 'string' || v.length > LINK_MAX) return null;
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password ? v : null; } catch { return null; }
};
const DAMAGED = Symbol('damaged');
/** A field that is absent (null) or right; anything else marks the whole remembered stream damaged. */
const field = (v, ok) => v == null ? null : ok(v) ? v : DAMAGED;

/**
 * The remembered stream as the store keeps it, or null (nothing remembered, or damaged: dropped, the entry stays).
 * @param {unknown} v @param {boolean} [finished] a finished entry keeps only {group}
 * @returns {{link?: string, hash?: string, fileIdx?: number, file?: string, size?: number, group?: string, addon?: string, label?: string} | null}
 */
export function rememberedStream(v, finished = false) {
  if (!isObject(v)) return null;
  const group = line(v.group, 200);
  if (finished) return group ? {group} : null;
  const link = httpsLink(v.link);
  const hash = field(v.hash, h => typeof h === 'string' && HEX40.test(h));
  const fileIdx = field(v.fileIdx, n => Number.isSafeInteger(n) && n >= 0 && n < 1e6);
  const size = field(v.size, n => Number.isSafeInteger(n) && n > 0);
  if (!link || [hash, fileIdx, size].includes(DAMAGED)) return null;
  const out = {link, hash, fileIdx, file: line(v.file, 255), size, group, addon: line(v.addon, 100), label: line(v.label, 200)};
  for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
  return out;
}

/** What to remember of a source the owner tapped ({addonUrl, stream}), with its add-on's name; null for a link that is not https. */
export function rememberSource(source, addonName = '') {
  const s = source?.stream;
  if (!httpsLink(s?.url)) return null;
  const facts = linkFacts(s.url, s);
  return rememberedStream({link: s.url, hash: facts.hash, fileIdx: facts.fileIndex, file: facts.fileName, size: facts.fileSize,
    group: s.bingeGroup || null, addon: addonName, label: withoutHash(s.name)});
}

/** The remembered stream as a source the player and addons/debrid.js take (the link's facts read again from it). */
export function rememberedSource(r) {
  const stream = {url: r.link, name: r.label || r.addon || '', title: '', filename: r.file || '', size: r.size ?? null, bingeGroup: r.group || null,
    torrent: r.hash ? {infoHash: r.hash, fileIdx: r.fileIdx ?? null} : null, headers: {}, subtitles: []};
  return {id: 'remembered', addonUrl: '', label: r.label || r.addon || 'The stream you were watching', detail: '', stream, remembered: r};
}

/**
 * The same stream in a collected list ({stream, addonUrl}[]), or null: the same torrent and file, else the same link,
 * else the same release group and file name. `skipHash`: the server said that torrent is not on TorBox, so a stream
 * of it would fail the same way. Never another stream than the one the owner watched.
 */
export function sameStream(r, sources, {skipHash = false} = {}) {
  if (!r || !Array.isArray(sources)) return null;
  const facts = sources.map(s => ({s, f: linkFacts(s.stream?.url, s.stream)}));
  const fileOk = f => r.fileIdx == null || f.fileIndex == null || f.fileIndex === r.fileIdx;
  const byHash = r.hash && facts.find(({f}) => f.hash === r.hash && fileOk(f) && (r.file == null || f.fileName == null || f.fileName === r.file));
  if (byHash) return skipHash ? null : byHash.s;
  const byLink = facts.find(({s}) => s.stream?.url === r.link);
  if (byLink) return skipHash && r.hash && byLink.f.hash === r.hash ? null : byLink.s;
  const byGroup = r.group && r.file && facts.find(({s, f}) => s.stream?.bingeGroup === r.group && f.fileName === r.file && !(skipHash && r.hash && f.hash === r.hash));
  return byGroup ? byGroup.s : null;
}
