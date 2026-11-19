// Invented phone data for the Astra sync tests (tests/astra-sync*.test.mjs): add-ons, titles, progress entries and
// library entries shaped as Astra's store keeps them, and the two sides of a merge as app/sync.js builds them.
import { readCopy } from '../../frontend/astra/src/app/sync-read.js';

export const T = 1_763_600_000_000, MIN = 60_000, H = 3_600_000;
export const addon = (n) => ({ url: `https://addon${n}.example/c/invented-${n}/manifest.json`, enabled: true, name: `Add-on ${n}` });
export const meta = (id, type = 'movie') => ({ id, type, name: `Invented ${id}` });
export const film = (id, updated, time = 600) => ({ type: 'movie', id, videoId: id, season: null, episode: null, time, duration: 6000, updated, completed: false, meta: meta(id) });
export const episode = (id, s, e, updated, time = 300) => ({ type: 'series', id, videoId: `${id}:${s}:${e}`, season: s, episode: e, time, duration: 2400, updated, completed: false, meta: meta(id, 'series') });
export const pkey = (x) => `${x.type}:${x.id}|${x.videoId}`;
export const prog = (...xs) => Object.fromEntries(xs.map((x) => [pkey(x), x]));
export const lib = (id, added, type = 'movie') => ({ [`${type}:${id}`]: { ...meta(id, type), added } });
/** A side as sync.js builds it: each key with its stamp, value and tombstones. */
export const side = (values, at = {}, gone = {}) => Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { at: at[k] ?? T, value, gone: gone[k] ?? {} }]));
export const server = (values, at, gone) => readCopy({ astra: 'sync/1', keys: side(values, at, gone) }).keys;

