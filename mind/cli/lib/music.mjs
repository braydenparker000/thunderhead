// `th music …` (RUNTIME.md §5.3, §4.7, §12.1; MUSIC.md §10.5): what the mind knows of the owner's
// songs, and the questions it answers from it.
//
//   page [--limit 200]                 the next songs with no note (GET /v1/music/tracks?untagged=1):
//                                      their tags, each with a short handle `n`, saved for `note`,
//                                      and whether `more` follow
//   note [--file <path>]               one batch of notes (≤ 200) from JSON on stdin or a file:
//                                      `[{n|id, known, moods, occasions, themes, language, era,
//                                      energy, conf}]` or `{items: […]}`, checked here against the
//                                      contract's vocabularies first, then PUT /v1/music/notes
//   find [--mood m]… [--occasion o] [--energy low|mid|high|0-1] [--like-history] [--limit 30]
//                                      songs by feeling, or weighted by the owner's plays of the artist
//   like <id> [--mood m]… [--limit 20] songs like one (the closest by notes and tags)
//   now [--id]                         the song playing now, or last played, with its note (with
//                                      --id, its id alone: no tags, so no outside text)
//   week [--days 7]                    what the owner has been into: plays, top songs, artists,
//                                      moods and genres
//   taste [--limit 10] · similar <artist id> [--limit 20] · find --like-history   the owner's
//                                      listening history (lib/taste.mjs): counts, ids, canonical names
//   facts · credits · unmatched · picks · pick decline|order   what is known of the music beyond
//                                      the files, and albums to add (lib/know.mjs)
//
// A handle `n` saves the long track ids in a night's tagging; it means the song of that number in
// the last `th music page` of this session. Track ids, titles and notes stay between th and the
// Worker; nothing here is written anywhere else. Songs' tags are the owner's own things and mark no
// session (owner, 2026-11-22); a night session that ran `page` still may not use the web
// (mind/hooks/lib/rules.mjs).
import {readFileSync} from 'node:fs';
import {parseArgs} from './args.mjs';
import {CONTRACT} from './contract.mjs';
import {request} from './http.mjs';
import {invalid, out} from './io.mjs';
import {getState, setState} from './state.mjs';
import {similar, taste} from './taste.mjs';
import {KNOW_SUBS} from './know.mjs';
import {Faults, sent} from './forgive.mjs';
import {repairNote} from './music-repair.mjs';

const M = CONTRACT.music;
const L = M.limits;
const SONG_ID = /^r2_(?:[A-Za-z0-9_-]{10,200}|native_[a-f0-9]{64})$/;
const DAY_MS = 86_400_000;
const USAGE = 'usage: th music page | note [--file <path>] | find --mood <m> [--occasion <o>] [--energy <e>] [--limit <n>] | like <id> | now [--id] | week | taste | similar <artist id> | facts <id|-> | credits <id|-> | unmatched | picks | pick decline|order <id>';

/** A track's tags without the empty ones (fewer tokens for the mind to read). */
const lean = t => Object.fromEntries(Object.entries(t).filter(([, v]) => v !== '' && v !== 0 && v !== null && v !== undefined));
const intFlag = (v, name, lo, hi, fallback) => {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw invalid(`--${name} must be ${lo}-${hi}`);
  return n;
};
const words = v => (Array.isArray(v) ? v : v === undefined ? [] : [v]).flatMap(x => String(x).split(',')).map(s => s.trim()).filter(Boolean);

async function page(argv) {
  const {flags, rest} = parseArgs(argv);
  if (rest.length) throw invalid('usage: th music page [--limit 200]');
  const limit = intFlag(flags.limit, 'limit', 1, L.batch, L.batch);
  const {data} = await request('GET', '/v1/music/tracks', {query: {untagged: 1, limit}});
  const items = data.items ?? [];
  setState('music_page', {ids: items.map(t => t.id)});
  out({more: !!data.more, items: items.map(({id: _, ...t}, i) => ({n: i + 1, ...lean(t)}))});
}

/** One note checked against the contract (the Worker checks it all again); a list of problems.
 * With `f` (lib/forgive.mjs), each also goes there with what was sent, for the one refusal. */
export function checkNote(raw, i, f) {
  const p = `items.${i}`;
  const bad = [];
  const b = (path, rule, value) => { bad.push(`${path}: ${rule}`); f?.add(path, rule, value === NONE ? '' : sent(value)); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { b(p, 'a note object', raw); return bad; }
  if (typeof raw.id !== 'string' || !SONG_ID.test(raw.id)) b(`${p}.id`, 'a track id', raw.id);
  if (typeof raw.known !== 'boolean') b(`${p}.known`, 'true or false', raw.known);
  const cap = raw.known === false ? L.unknown_conf_max : 1;
  const conf = c => typeof c === 'number' && c >= L.conf_min && c <= cap;
  for (const [field, vocab, max] of [['moods', M.moods, L.moods], ['occasions', M.occasions, L.occasions]]) {
    const v = raw[field] ?? {};
    if (!v || typeof v !== 'object' || Array.isArray(v)) { b(`${p}.${field}`, 'an object of word: confidence', v); continue; }
    const n = Object.keys(v).length;
    if (n > max) b(`${p}.${field}`, `at most ${max}`, `yours has ${n}`);
    for (const [k, c] of Object.entries(v)) {
      if (!vocab.includes(k)) b(`${p}.${field}.${k}`, `not one of ${vocab.join(', ')}`, NONE);
      else if (!conf(c)) b(`${p}.${field}.${k}`, `${L.conf_min} to ${cap}`, c);
    }
  }
  const themes = raw.themes ?? [];
  if (!Array.isArray(themes) || themes.length > L.themes || themes.some(t => !M.themes.includes(t)) || new Set(themes).size !== themes.length)
    b(`${p}.themes`, `at most ${L.themes} of ${M.themes.join(', ')}`, themes);
  const language = raw.language ?? null;
  if (language !== null && !M.languages.includes(language)) b(`${p}.language`, 'an ISO 639-1 code, or null', language);
  const era = raw.era ?? null;
  const top = Math.floor(new Date().getUTCFullYear() / 10) * 10;
  if (era !== null && !(Number.isInteger(era) && era % 10 === 0 && era >= L.era_min && era <= top)) b(`${p}.era`, 'a decade (1990), or null', era);
  const energy = raw.energy ?? null;
  if (energy !== null && !(typeof energy === 'number' && energy >= 0 && energy <= 1)) b(`${p}.energy`, '0 to 1, or null', energy);
  const said = {themes: Array.isArray(themes) && themes.length > 0, language: language !== null, era: era !== null, energy: energy !== null};
  const c = raw.conf ?? {};
  for (const k of Object.keys(said)) {
    if (said[k] && c[k] === undefined) b(`${p}.conf.${k}`, `needed, ${k} is set`, NONE);
    else if (!said[k] && c[k] !== undefined) b(`${p}.conf.${k}`, `${k} is empty`, c[k]);
    else if (c[k] !== undefined && !conf(c[k])) b(`${p}.conf.${k}`, `${L.conf_min} to ${cap}`, c[k]);
  }
  return bad;
}
const NONE = Symbol('none');

async function note(argv) {
  const {flags, rest} = parseArgs(argv);
  if (rest.length) throw invalid('usage: th music note [--file <path>] (JSON on stdin otherwise)');
  let parsed;
  try { parsed = JSON.parse(readFileSync(flags.file ? String(flags.file) : 0, 'utf8')); } catch (e) { throw invalid(`the notes are not JSON: ${e.message}`); }
  const list = Array.isArray(parsed) ? parsed : parsed?.items;
  if (!Array.isArray(list) || !list.length || list.length > L.batch) throw invalid(`a batch holds 1-${L.batch} notes; ${Array.isArray(list) ? `yours has ${list.length}` : 'no list sent'}`);
  const ids = getState('music_page')?.ids ?? [];
  const f = new Faults();
  // The obvious slips set right first (lib/music-repair.mjs), then every remaining fault in one refusal.
  const items = list.map((raw, i) => {
    if (!raw || typeof raw !== 'object' || raw.n === undefined) return repairNote(raw, i, f.repaired);
    const {n, ...rest} = raw;
    const id = Number.isInteger(n) ? ids[n - 1] : undefined;
    if (!id) f.add(`items.${i}.n`, `a song number from the last th music page (1 to ${ids.length})`, sent(n));
    return repairNote({id, ...rest}, i, f.repaired);
  });
  // A missing handle is named once (above), not again as a bad id.
  items.forEach((note, i) => checkNote(note?.id === undefined && list[i]?.n !== undefined ? {...note, id: 'r2_handle_none'} : note, i, f));
  f.done('th music note: [{n|id, known, moods, occasions, themes, language, era, energy, conf}] on stdin');
  const {data} = await request('PUT', '/v1/music/notes', {body: {items}});
  out(f.with(data));
}

function feeling(flags) {
  const moods = words([].concat(flags.mood ?? [], flags.moods ?? []));
  for (const m of moods) if (!M.moods.includes(m)) throw invalid(`--mood ${m}: one of ${M.moods.join(', ')}`);
  if (moods.length > L.find_moods) throw invalid(`at most ${L.find_moods} moods`);
  const occasion = flags.occasion === undefined ? undefined : String(flags.occasion);
  if (occasion !== undefined && !M.occasions.includes(occasion)) throw invalid(`--occasion: one of ${M.occasions.join(', ')}`);
  const energy = flags.energy === undefined ? undefined : String(flags.energy);
  if (energy !== undefined && !['low', 'mid', 'high'].includes(energy) && !(Number(energy) >= 0 && Number(energy) <= 1))
    throw invalid('--energy: low, mid, high or 0 to 1');
  return {moods: moods.join(',') || undefined, occasion, energy};
}

/** The Worker's answer with each song's empty tags left out. */
const found = data => ({...data, items: (data.items ?? []).map(lean)});

async function find(argv) {
  const {flags, rest} = parseArgs(argv, {repeat: ['mood'], bool: ['like-history']});
  if (rest.length) throw invalid('usage: th music find --mood <m> [--mood <m>] [--occasion <o>] [--energy low|mid|high] [--like-history] [--limit 30]');
  const f = feeling(flags);
  const history = flags['like-history'] ? 1 : undefined;
  if (!f.moods && !f.occasion && f.energy === undefined && !history) throw invalid('ask for a --mood, an --occasion, an --energy or --like-history');
  const limit = intFlag(flags.limit, 'limit', 1, L.find_max, L.find_default);
  out(found((await request('GET', '/v1/music/find', {query: {...f, history, limit}})).data));
}

async function like(argv) {
  const {flags, rest} = parseArgs(argv, {repeat: ['mood']});
  const id = String(rest[0] ?? '').replace(/^music:/, '');
  if (rest.length !== 1 || !SONG_ID.test(id)) throw invalid('usage: th music like <track id> [--mood <m>] [--limit 20]');
  const f = feeling(flags);
  const limit = intFlag(flags.limit, 'limit', 1, L.find_max, 20);
  out(found((await request('GET', '/v1/music/find', {query: {like: id, moods: f.moods, occasion: f.occasion, energy: f.energy, limit}})).data));
}

const sense = async (name, params) => (await request('POST', '/v1/senses/query', {body: {name, params}})).data.rows ?? [];
const idOf = ref => (typeof ref === 'string' && ref.startsWith('music:') ? ref.slice(6) : null);

/** The tracks and notes of some ids, by id. */
async function notesOf(ids) {
  if (!ids.length) return new Map();
  const {data} = await request('GET', '/v1/music/notes', {query: {ids: ids.join(',')}});
  return new Map((data.items ?? []).map(t => [t.id, t]));
}

async function now(argv) {
  const {flags, rest} = parseArgs(argv, {bool: ['id']});
  if (rest.length) throw invalid('usage: th music now [--id]');
  const [play] = await sense('last_event', {type: 'music.play'});
  const id = idOf(play?.ref);
  if (!id) return out(flags.id ? {playing: false, at: null, id: null} : {playing: false, at: null, track: null, note: null});
  const [skip] = await sense('last_event', {type: 'music.skip'});
  const [finish] = await sense('last_event', {type: 'music.finish'});
  const left = [skip, finish].some(e => e && e.ref === play.ref && e.at >= play.at);
  const ago_min = Math.round((Date.now() - play.at) / 60_000);
  // --id: the song's id alone, from the senses only: no tag route is called, so a night session
  // keeps the web, and "never play this again" writes its rule from the id (RUNTIME.md §4.7). Without the song's length, "playing" means not skipped or finished since it started.
  if (flags.id) return out({playing: !left, at: play.at, ago_min, id});
  const t = (await notesOf([id])).get(id);
  const playing = !!t && !left && play.at + (t.dur || 0) * 1000 > Date.now();
  const {note: n = null, ...track} = t ?? {id};
  out({playing, at: play.at, ago_min, track: lean(track), note: n});
}

async function week(argv) {
  const {flags, rest} = parseArgs(argv);
  if (rest.length) throw invalid('usage: th music week [--days 7]');
  const days = intFlag(flags.days, 'days', 1, 90, 7);
  const at = Date.now();
  const day = ms => new Date(ms).toISOString().slice(0, 10);
  const counts = await sense('counts_by_day', {from: day(at - days * DAY_MS), to: day(at)});
  const total = type => counts.filter(r => r.type === type).reduce((n, r) => n + r.n, 0);
  const top = (await sense('top_refs', {type: 'music.play', days, limit: 30})).flatMap(r => (idOf(r.ref) ? [{id: idOf(r.ref), n: r.n}] : []));
  const known = await notesOf(top.map(r => r.id));
  const tally = key => {
    const by = {};
    for (const r of top) for (const [k, w] of key(known.get(r.id) ?? {})) by[k] = (by[k] ?? 0) + w * r.n;
    return Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, w]) => [k, Math.round(w * 10) / 10]);
  };
  out({
    days,
    plays: total('music.play'),
    finishes: total('music.finish'),
    skips: total('music.skip'),
    top: top.slice(0, 10).map(r => ({...lean({id: r.id, title: known.get(r.id)?.title, artist: known.get(r.id)?.artist}), n: r.n})),
    artists: tally(t => (t.artist ? [[t.artist, 1]] : [])),
    genres: tally(t => (t.genre ? [[t.genre, 1]] : [])),
    moods: tally(t => Object.entries(t.note?.moods ?? {})),
    noted: top.filter(r => known.get(r.id)?.note).length,
    of: top.length,
  });
}

// The owner's listening history (lib/taste.mjs): their top artists and years, and artists like one.
const SUBS = {page, note, find, like, now, week, taste, similar, ...KNOW_SUBS};

/** @param {string[]} argv */
export async function music(argv) {
  const [sub, ...rest] = argv;
  const run = SUBS[sub];
  if (!run) throw invalid(USAGE);
  return run(rest);
}
