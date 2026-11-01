// A note about a song, checked (MUSIC.md §10.5, API.md §11.21): every field against its fixed
// vocabulary (shared/contract/music.ts), every confidence in range, one for each thing said and
// none for a field left empty, and a song the mind doesn't know (`known: false`) held to what its
// tags imply (no confidence over `unknown_conf_max`). A batch is checked whole: one bad note, a
// track twice or an id the catalog doesn't hold refuses it, each problem named by its path, so
// nothing half-written ever needs undoing. Kept notes are rounded to two places, keys in
// vocabulary order, so the same note sent again is the same text and writes no row.
import {
  ISO_639_1,
  MUSIC_NOTE_LIMITS as L,
  MUSIC_MOODS,
  MUSIC_OCCASIONS,
  MUSIC_THEMES,
  type MusicNote,
} from '../../../../shared/contract/music.ts';
import { SONG_ID } from './shapes';

export type Issue = { path: string; issue: string };

const LANGS = new Set(ISO_639_1);
const FIELDS = new Set(['id', 'known', 'moods', 'occasions', 'themes', 'language', 'era', 'energy', 'conf']);
const CONF_KEYS = ['themes', 'language', 'era', 'energy'] as const;
/** Issues named in one refusal, at most. */
const SHOWN = 50;

const round = (n: number) => Math.round(n * 100) / 100;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** The present decade: the newest a note may name. */
export const eraMax = (now = Date.now()) => Math.floor(new Date(now).getUTCFullYear() / 10) * 10;

/** A map of vocabulary words to confidences, checked, in vocabulary order. */
function weights(
  v: unknown,
  path: string,
  vocab: readonly string[],
  max: number,
  cap: number,
  out: Issue[],
): Record<string, number> {
  const kept: Record<string, number> = {};
  if (!isObj(v)) {
    out.push({ path, issue: 'an object of word: confidence' });
    return kept;
  }
  const keys = Object.keys(v);
  if (keys.length > max) out.push({ path, issue: `at most ${max}` });
  for (const k of keys) {
    const w = v[k];
    if (!vocab.includes(k)) out.push({ path: `${path}.${k}`, issue: `not one of ${vocab.join(', ')}` });
    else if (!isNum(w) || w < L.conf_min || w > cap)
      out.push({ path: `${path}.${k}`, issue: `${L.conf_min} to ${cap}` });
  }
  for (const k of vocab) if (isNum(v[k])) kept[k] = round(v[k] as number);
  return kept;
}

/** One note checked; `at` is its place in the batch. The note as kept, or null with its issues. */
export function checkNote(raw: unknown, at: number, out: Issue[], now = Date.now()): MusicNote | null {
  const p = `items.${at}`;
  const before = out.length;
  if (!isObj(raw)) {
    out.push({ path: p, issue: 'a note object' });
    return null;
  }
  for (const k of Object.keys(raw)) if (!FIELDS.has(k)) out.push({ path: `${p}.${k}`, issue: 'not a note field' });
  const id = raw.id;
  if (typeof id !== 'string' || !SONG_ID.test(id)) out.push({ path: `${p}.id`, issue: 'a track id' });
  if (typeof raw.known !== 'boolean') out.push({ path: `${p}.known`, issue: 'true or false' });
  const cap = raw.known === false ? L.unknown_conf_max : 1;
  const moods = weights(raw.moods ?? {}, `${p}.moods`, MUSIC_MOODS, L.moods, cap, out);
  const occasions = weights(raw.occasions ?? {}, `${p}.occasions`, MUSIC_OCCASIONS, L.occasions, cap, out);

  const themes = raw.themes ?? [];
  if (!Array.isArray(themes) || themes.length > L.themes || new Set(themes).size !== themes.length)
    out.push({ path: `${p}.themes`, issue: `at most ${L.themes} different themes` });
  else
    themes.forEach((t, i) => {
      if (!(MUSIC_THEMES as readonly unknown[]).includes(t))
        out.push({ path: `${p}.themes.${i}`, issue: `not one of ${MUSIC_THEMES.join(', ')}` });
    });
  const language = raw.language ?? null;
  if (language !== null && !(typeof language === 'string' && LANGS.has(language)))
    out.push({ path: `${p}.language`, issue: 'an ISO 639-1 code (en, es, …) or null' });
  const era = raw.era ?? null;
  const top = eraMax(now);
  if (era !== null && !(isNum(era) && Number.isInteger(era) && era % 10 === 0 && era >= L.era_min && era <= top))
    out.push({ path: `${p}.era`, issue: `a decade from ${L.era_min} to ${top}, or null` });
  const energy = raw.energy ?? null;
  if (energy !== null && !(isNum(energy) && energy >= 0 && energy <= 1))
    out.push({ path: `${p}.energy`, issue: '0 to 1, or null' });

  // A confidence for each thing said, none for what was left empty.
  const conf = raw.conf ?? {};
  const said = {
    themes: Array.isArray(themes) && themes.length > 0,
    language: language !== null,
    era: era !== null,
    energy: energy !== null,
  };
  const keptConf: MusicNote['conf'] = {};
  if (!isObj(conf)) out.push({ path: `${p}.conf`, issue: 'an object' });
  else {
    for (const k of Object.keys(conf))
      if (!(CONF_KEYS as readonly string[]).includes(k)) out.push({ path: `${p}.conf.${k}`, issue: 'not a field' });
    for (const k of CONF_KEYS) {
      const c = conf[k];
      if (said[k] && c === undefined) out.push({ path: `${p}.conf.${k}`, issue: `needed: ${k} is set` });
      else if (!said[k] && c !== undefined) out.push({ path: `${p}.conf.${k}`, issue: `${k} is empty` });
      else if (c !== undefined && (!isNum(c) || c < L.conf_min || c > cap))
        out.push({ path: `${p}.conf.${k}`, issue: `${L.conf_min} to ${cap}` });
      else if (isNum(c)) keptConf[k] = round(c);
    }
  }
  if (out.length > before) return null;
  return {
    id: id as string,
    known: raw.known as boolean,
    moods,
    occasions,
    themes: MUSIC_THEMES.filter((t) => (themes as unknown[]).includes(t)),
    language: language as string | null,
    era: era as number | null,
    energy: energy === null ? null : round(energy as number),
    conf: keptConf,
  };
}

/** A whole batch: the notes as kept, or the issues (at most 50) that refuse it. `inCatalog` says
 * whether the catalog holds an id. */
export function checkNotes(
  items: unknown,
  inCatalog: (id: string) => boolean,
  now = Date.now(),
): { notes: MusicNote[] } | { issues: Issue[] } {
  if (!Array.isArray(items) || items.length < 1 || items.length > L.batch)
    return { issues: [{ path: 'items', issue: `1 to ${L.batch} notes` }] };
  const issues: Issue[] = [];
  const notes: MusicNote[] = [];
  const seen = new Set<string>();
  items.forEach((raw, i) => {
    const n = checkNote(raw, i, issues, now);
    if (!n) return;
    if (seen.has(n.id)) issues.push({ path: `items.${i}.id`, issue: 'this track is in the batch twice' });
    else if (!inCatalog(n.id)) issues.push({ path: `items.${i}.id`, issue: 'not in the catalog' });
    seen.add(n.id);
    notes.push(n);
  });
  return issues.length ? { issues: issues.slice(0, SHOWN) } : { notes };
}

/** A kept note's stored text: everything but the id and `known`, which are columns. */
export function noteJson(n: MusicNote): string {
  return JSON.stringify({
    moods: n.moods,
    occasions: n.occasions,
    themes: n.themes,
    language: n.language,
    era: n.era,
    energy: n.energy,
    conf: n.conf,
  });
}
