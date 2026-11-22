// `th music note`'s repairs (lib/forgive.mjs): what has one obvious meaning is set right before the
// note is checked, and each repair is listed for the answer's `repaired`. A confidence or energy
// outside its range is clamped to it and rounded to two places (the step the Worker keeps); a year
// becomes its decade (within era_min and the present decade); a language name maps to its ISO
// 639-1 code, or null when it maps to none; a confidence for a field left empty is dropped;
// repeated themes are dropped; spaces around words are trimmed. Nothing else is guessed.
import {CONTRACT} from './contract.mjs';

const M = CONTRACT.music;
const L = M.limits;
const round = n => Math.round(n * 100) / 100;

/** Language names (English, in English; "Spanish", "Español") to their ISO 639-1 codes. */
const NAMES = (() => {
  const map = new Map();
  let en;
  try { en = new Intl.DisplayNames(['en'], {type: 'language'}); } catch { return map; }
  for (const code of M.languages) {
    for (const names of [en, (() => { try { return new Intl.DisplayNames([code], {type: 'language'}); } catch { return null; } })()]) {
      const name = names?.of(code);
      if (name && name.toLowerCase() !== code) map.set(name.toLowerCase(), code);
    }
  }
  return map;
})();

/** A language as sent, as its code: the code itself (any case), a name, or null. */
export function languageCode(value) {
  const v = String(value).trim().toLowerCase();
  if (M.languages.includes(v)) return v;
  return NAMES.get(v) ?? null;
}

const isNum = v => typeof v === 'number' && Number.isFinite(v);

/** A number in range at the kept step, with a repair line when it changed. */
function fit(v, lo, hi, path, fixes) {
  const n = round(Math.min(hi, Math.max(lo, v)));
  if (n !== v) fixes.push(`${path}: ${v} → ${n} (${lo} to ${hi}, two places)`);
  return n;
}

/** One note with its obvious slips set right; `fixes` gets a line for each. The note's other
 * faults are left for the check to name. */
export function repairNote(raw, i, fixes, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const p = `items.${i}`;
  const note = {...raw};
  const cap = note.known === false ? L.unknown_conf_max : 1;
  for (const field of ['moods', 'occasions']) {
    const v = note[field];
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const out = {};
    for (const [key, c] of Object.entries(v)) {
      const k = key.trim();
      if (k !== key) fixes.push(`${p}.${field}: trimmed the spaces around ${JSON.stringify(k)}`);
      out[k] = isNum(c) ? fit(c, L.conf_min, cap, `${p}.${field}.${k}`, fixes) : c;
    }
    note[field] = out;
  }
  if (Array.isArray(note.themes)) {
    const trimmed = note.themes.map(t => (typeof t === 'string' ? t.trim() : t));
    const unique = [...new Set(trimmed)];
    if (unique.length < trimmed.length) fixes.push(`${p}.themes: dropped ${trimmed.length - unique.length} repeated theme(s)`);
    note.themes = unique;
  }
  if (typeof note.language === 'string') {
    const code = languageCode(note.language);
    if (code !== note.language) fixes.push(`${p}.language: ${JSON.stringify(note.language.slice(0, 24))} → ${code === null ? 'null (no ISO 639-1 code for it)' : code}`);
    note.language = code;
  }
  if (typeof note.era === 'string' && /^\s*\d{4}s?\s*$/.test(note.era)) note.era = Number.parseInt(note.era, 10);
  if (isNum(note.era)) {
    const top = Math.floor(new Date(now).getUTCFullYear() / 10) * 10;
    const decade = Math.min(top, Math.max(L.era_min, Math.floor(note.era / 10) * 10));
    if (decade !== note.era) fixes.push(`${p}.era: ${note.era} → ${decade} (a decade, ${L.era_min} to ${top})`);
    note.era = decade;
  }
  if (isNum(note.energy)) note.energy = fit(note.energy, 0, 1, `${p}.energy`, fixes);
  if (note.conf && typeof note.conf === 'object' && !Array.isArray(note.conf)) {
    const conf = {...note.conf};
    const said = {themes: Array.isArray(note.themes) && note.themes.length > 0, language: (note.language ?? null) !== null,
      era: (note.era ?? null) !== null, energy: (note.energy ?? null) !== null};
    for (const k of Object.keys(said)) {
      if (conf[k] === undefined) continue;
      if (!said[k]) { delete conf[k]; fixes.push(`${p}.conf.${k}: dropped (${k} is empty)`); }
      else if (isNum(conf[k])) conf[k] = fit(conf[k], L.conf_min, cap, `${p}.conf.${k}`, fixes);
    }
    note.conf = conf;
  }
  return note;
}
