// The settings registry (FEEL.md "Settings"). A row is data:
//   {id, area, title, detail, kind: 'switch' | 'choice' | 'steps' | 'colour' | 'action', options,
//    default, where: 'astra' | 'device' | 'player', apply(value, app)}
// `options`: for a choice, [[value, label], …]; for steps, {min, max, step, unit}; none otherwise.
// `where`: 'astra' is app.settings (it travels in a backup and between phones), 'device' is this
// phone's own (the store's 'device' key, kept by a restore), 'player' is the player's prefs
// (player/prefs.js). Each area's rows live in settings/<area>.js and call define() when loaded.
// Screens read app.setting(id); app.saveSetting(id, value) saves, then runs the row's apply.

import {loadPrefs, savePrefs} from '../player/prefs.js';

const KINDS = ['switch', 'choice', 'steps', 'colour', 'action'];
const WHERE = ['astra', 'device', 'player'];
const all = new Map();

/** Adds rows (an area's file calls this once). An id defined twice is a mistake and throws. */
export function define(list) {
  for (const row of list) {
    if (!row?.id || !row.area || !row.title) throw Error('a settings row needs an id, an area and a title');
    if (all.has(row.id)) throw Error(`settings row ${row.id} is defined twice`);
    if (!KINDS.includes(row.kind)) throw Error(`settings row ${row.id}: unknown kind ${row.kind}`);
    if (row.kind !== 'action' && !WHERE.includes(row.where)) throw Error(`settings row ${row.id}: unknown where ${row.where}`);
    if (row.kind !== 'action' && !valid(row, row.default)) throw Error(`settings row ${row.id}: its default is not one of its values`);
    all.set(row.id, Object.freeze({detail: '', options: null, apply: null, ...row}));
  }
}

/** The rows of an area, in the order they were defined. */
export const rows = area => [...all.values()].filter(r => r.area === area);
/** One row by id (undefined when there is none). */
export const row = id => all.get(id);

const fold = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/**
 * Rows matching a search: every word of `query` is found in the row's title, detail, area or the
 * labels of its options. Title matches come first.
 */
export function find(query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const text = r => fold([r.title, r.detail, r.area, ...(Array.isArray(r.options) ? r.options.map(o => o[1]) : [])].join(' '));
  return [...all.values()].filter(r => words.every(w => text(r).includes(w)))
    .sort((a, b) => Number(words.every(w => fold(b.title).includes(w))) - Number(words.every(w => fold(a.title).includes(w))));
}

/** Whether `value` is one this row can hold. */
export function valid(r, value) {
  switch (r.kind) {
    case 'switch': return typeof value === 'boolean';
    case 'choice': return (r.options || []).some(([v]) => v === value);
    case 'steps': { const o = r.options || {}; return typeof value === 'number' && Number.isFinite(value) && value >= (o.min ?? -Infinity) && value <= (o.max ?? Infinity); }
    case 'colour': return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
    default: return false;
  }
}

function stored(app, r) {
  if (r.where === 'astra') return app.settings?.[r.id];
  if (r.where === 'device') return app.store?.get('device', {})?.[r.id];
  return loadPrefs()[r.id];
}

/** The row's value now: what was saved when it is one the row can hold, else its default. */
export function readSetting(app, id) {
  const r = all.get(id);
  if (!r) throw Error(`no settings row ${id}`);
  if (r.kind === 'action') return undefined;
  const v = stored(app, r);
  return valid(r, v) ? v : r.default;
}

/** Saves a row's value where it lives, then applies it. A value the row cannot hold is refused. */
export function writeSetting(app, id, value) {
  const r = all.get(id);
  if (!r) throw Error(`no settings row ${id}`);
  if (!valid(r, value)) throw Error(`settings row ${id} cannot hold ${JSON.stringify(value)}`);
  if (r.where === 'astra') app.saveSettings({[id]: value});
  else if (r.where === 'device') {
    const device = app.store.get('device', {});
    app.store.set('device', {...(device && typeof device === 'object' && !Array.isArray(device) ? device : {}), [id]: value});
  } else {
    const prefs = loadPrefs();
    prefs[id] = value;
    savePrefs(prefs);
    if (app.player?.prefs) app.player.prefs[id] = value;
  }
  r.apply?.(value, app);
  return value;
}

/** Runs every row's apply with its value now (at start, and when another window changed them). */
export function applyAll(app) {
  for (const r of all.values()) if (r.apply && r.kind !== 'action') r.apply(readSetting(app, r.id), app);
}
