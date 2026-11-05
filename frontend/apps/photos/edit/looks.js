// @ts-check
// Looks (PHOTOS.md, Looks): the editor's last panel. Sections Mine · Imported · Recipes · Camera as its
// chips; a strip of looks, each drawn small through the photo as shot with its crop (cached per photo,
// look and crop); tap one to apply it (an ordinary recipe put, Undo in the toast), then Amount scales
// its change from 0 to 200 %. A long press renames, updates from the current edit, or deletes it. Save
// current edit as a look at the top; Import .xmp in Imported; Paste a recipe in Recipes.
import { el, toast } from '/th/ui.js';
import { named, PANEL_NAMES } from '../copied.js';
import { icon } from '../shelf.js';
import { importSheet, recipeSheet, sheet } from './looks-import.js';
import { lookHash, lookOf, lookOnto } from './looks-apply.js';
import { addLooks, changeLook, dropLook, looks } from './looks-store.js';
import { slider } from './slider.js';
import { withGeometryOf } from './versions.js';

const HOLD_MS = 500;
/** @typedef {import('./tools.js').Ed} Ed */
/** @typedef {import('./looks-store.js').Look} Look */
/** @typedef {import('./fields.js').Recipe} Recipe */
/** @type {Map<string, HTMLCanvasElement>} */
const thumbs = new Map();
/** The look last applied, per photo: its recipe before, and what Amount last set. @type {Map<string, { look: Look, base: Recipe, amount: number, set: string }>} */
const applied = new Map();
let queue = Promise.resolve();
const sense = (/** @type {Look} */ l) => import('/th/senses/send.js').then((m) => m.sense('photo.look', null, { source: l.source, panels: l.panels.length })).catch(() => {});
const EMPTY = { mine: 'None yet: Save as a look keeps the edit as it is now.', xmp: 'None yet: Import .xmp takes preset files from Files or Drive.', recipe: 'None yet: Paste a recipe reads the text of a camera recipe.' };

/** `rec` set on the editor key by key (one save at the end when `done`), so the panel stays as it is. @param {Ed} ed @param {Recipe} rec @param {boolean} done */
function put(ed, rec, done) {
  const now = /** @type {Record<string, unknown>} */ (ed.recipe), to = /** @type {Record<string, unknown>} */ (rec);
  const keys = [...new Set([...Object.keys(now), ...Object.keys(to)])].filter((k) => JSON.stringify(now[k]) !== JSON.stringify(to[k]));
  keys.forEach((k, i) => ed.set(k, to[k], done && i === keys.length - 1));
  // A drag's last move already set it: letting go still saves.
  if (done && !keys.length) { const k = Object.keys(to)[0] ?? 'Exposure2012'; ed.set(k, to[k], true); }
}

/** The Looks panel. @param {Ed} ed @param {string} section mine | xmp | recipe | camera */
export function looksTool(ed, section) {
  const box = el('div', { class: 'ecol lpanel', 'data-section': section });
  const host = () => /** @type {HTMLElement} */ (box.closest('.editor'));
  /** @type {Look[]} */
  let items = [];
  const geo = JSON.stringify(withGeometryOf({}, ed.recipe));
  const seen = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { seen.unobserve(e.target); paint(/** @type {HTMLElement} */ (e.target)); } });
  /** @param {HTMLElement} card */
  const paint = (card) => {
    const l = items.find((x) => x.id === card.dataset.id);
    if (!l) return;
    const key = `${ed.id}:${lookHash(l)}:${geo}`;
    const got = thumbs.get(key);
    if (got) { card.querySelector('.vthumb')?.replaceChildren(got); return; }
    queue = queue.then(() => ed.thumb(lookOnto(withGeometryOf({}, ed.recipe), l, ed.shot))).then((c) => { thumbs.set(key, c); card.querySelector('.vthumb')?.replaceChildren(c); }).catch(() => {});
  };
  const apply = (/** @type {Look} */ l) => {
    const base = ed.recipe;
    put(ed, lookOnto(base, l, ed.shot), true);
    applied.set(ed.id, { look: l, base, amount: 100, set: JSON.stringify(ed.recipe) });
    sense(l);
    const why = l.film ? `: all but the ${l.film} simulation, which the camera's looks bring in a later release` : '';
    toast(`Applied “${l.name}”${why}.`, { label: 'Undo', run: () => { put(ed, base, true); applied.delete(ed.id); draw(); } });
    draw();
  };
  const amount = () => {
    const a = applied.get(ed.id);
    if (!a || a.set !== JSON.stringify(ed.recipe)) { applied.delete(ed.id); return null; }
    const s = slider({ key: 'LookAmount', label: `Amount · ${a.look.name}`, step: 1, unit: '%', up: 'stronger', down: 'lighter', zero: 'the look' }, {
      get: () => a.amount, min: 0, max: 200, def: 100,
      set: (v, done) => { a.amount = v; put(ed, lookOnto(a.base, a.look, ed.shot, v / 100), done); a.set = JSON.stringify(ed.recipe); },
    });
    return s.el;
  };
  /** Rename, update from the current edit, or delete. @param {Look} l */
  const menu = (l) => {
    const s = sheet(host(), l.name);
    const input = el('input', { class: 'vname', type: 'text', maxlength: '60', value: l.name, 'aria-label': 'Look name' });
    const rename = el('button', { type: 'button', class: 'seg', text: 'Rename' });
    rename.addEventListener('click', async () => {
      const name = /** @type {HTMLInputElement} */ (input).value.trim();
      if (!name) return;
      try { await changeLook(l.id, { name }); s.close(); load(); } catch { toast('That did not save. Try again.'); }
    });
    const update = el('button', { type: 'button', class: 'eauto' }, [icon('arrow-clockwise'), el('span', { text: 'Update from current edit' })]);
    update.addEventListener('click', async () => {
      try { await changeLook(l.id, { recipe: lookOf(ed.recipe, l.panels, ed.shot), panels: l.panels }); s.close(); toast(`“${l.name}” now holds this edit’s ${named(l.panels)}.`); load(); } catch { toast('That did not save. Try again.'); }
    });
    const del = el('button', { type: 'button', class: 'seg', 'aria-label': 'Delete' }, [icon('trash'), el('span', { text: 'Delete' })]);
    del.addEventListener('click', async () => {
      try { await dropLook(l.id); } catch { toast('That did not delete. Try again.'); return; }
      s.close();
      load();
      toast(`Deleted “${l.name}”.`, { label: 'Undo', run: () => addLooks([{ ...l }]).then(load, () => toast('That did not come back. Try again.')) });
    });
    s.body.append(el('div', { class: 'erow' }, [input, rename]), el('p', { class: 'eline', text: `Sets ${named(l.panels)}.${l.credit ? ` From ${l.credit}.` : ''}` }), update, del);
  };
  const save = () => {
    const s = sheet(host(), 'Save as a look');
    /** @type {Set<import('../copied.js').Panel>} */
    const on = new Set(PANEL_NAMES.map(([p]) => p).filter((p) => p !== 'crop' && p !== 'optics'));
    const input = el('input', { class: 'vname', type: 'text', maxlength: '60', value: `Look ${items.filter((l) => l.source === 'mine').length + 1}`, 'aria-label': 'Look name' });
    const go = el('button', { type: 'button', class: 'eauto xgo' }, [icon('plus'), el('span', { text: 'Save' })]);
    const rows = PANEL_NAMES.map(([p, label]) => {
      const sw = el('button', { type: 'button', role: 'switch', class: 'crow', 'data-panel': p, 'aria-checked': String(on.has(p)) }, [el('span', { class: 'ccopy' }, [el('b', { text: label })]), el('span', { class: 'cknob', 'aria-hidden': 'true' })]);
      sw.addEventListener('click', () => { if (on.has(p)) on.delete(p); else on.add(p); sw.setAttribute('aria-checked', String(on.has(p))); /** @type {HTMLButtonElement} */ (go).disabled = !on.size; });
      return sw;
    });
    go.addEventListener('click', async () => {
      const name = /** @type {HTMLInputElement} */ (input).value.trim();
      const panels = PANEL_NAMES.map(([p]) => p).filter((p) => on.has(p));
      if (!name || !panels.length) return;
      try { await addLooks([{ name, source: 'mine', panels, recipe: lookOf(ed.recipe, panels, ed.shot) }]); } catch (e) { toast(/** @type {any} */ (e)?.status === 409 ? 'Looks keep 500 at most: delete some first.' : 'That did not save. Try again.'); return; }
      s.close();
      toast(`Kept “${name}” in Mine.`);
      load();
    });
    s.body.append(input, el('p', { class: 'eline', text: 'The panels it sets. White balance is kept as a shift from the photo’s own.' }), el('div', { class: 'crows' }, rows), go);
  };
  const draw = () => {
    const make = el('button', { type: 'button', class: 'seg lsave' }, [icon('plus'), el('span', { text: 'Save as a look' })]);
    make.addEventListener('click', save);
    const head = el('div', { class: 'erow vhead' }, [make]);
    if (section === 'xmp' || section === 'recipe') {
      const b = el('button', { type: 'button', class: 'seg limport' }, [icon(section === 'xmp' ? 'download-simple' : 'file-text'), el('span', { text: section === 'xmp' ? 'Import .xmp' : 'Paste a recipe' })]);
      b.addEventListener('click', () => (section === 'xmp' ? importSheet : recipeSheet)(host(), items, () => load()));
      head.append(b);
    }
    const shown = items.filter((l) => l.source === section);
    const strip = el('div', { class: 'vstrip lstrip', role: 'list' });
    for (const l of shown) {
      const c = el('button', { type: 'button', role: 'listitem', class: 'vcard lcard', 'data-id': l.id, 'data-source': l.source }, [el('span', { class: 'vthumb' }), el('span', { class: 'vlabel', text: l.name }), ...(l.tag || l.film ? [el('span', { class: 'lchip', text: /** @type {string} */ (l.film ?? l.tag) })] : [])]);
      let timer = /** @type {ReturnType<typeof setTimeout> | null} */ (null), held = false;
      c.addEventListener('pointerdown', () => { held = false; timer = setTimeout(() => { held = true; menu(l); }, HOLD_MS); });
      for (const t of ['pointerup', 'pointerleave', 'pointercancel']) c.addEventListener(t, () => { if (timer) clearTimeout(timer); timer = null; });
      c.addEventListener('contextmenu', (e) => e.preventDefault());
      c.addEventListener('click', () => { if (!held) apply(l); });
      strip.append(c);
      seen.observe(c);
    }
    const dial = amount();
    const body = section === 'camera'
      ? el('p', { class: 'eline', text: "The camera's film simulations learn from RAW+JPEG pairs in a later release." })
      : shown.length ? strip : el('p', { class: 'eline', text: EMPTY[/** @type {'mine'} */ (section)] });
    box.replaceChildren(head, ...(dial ? [dial] : []), body);
    box.dataset.count = String(shown.length);
  };
  const load = async () => {
    try { items = await looks(); } catch { box.replaceChildren(el('p', { class: 'eline', text: 'Looks need a connection the first time.' })); return; }
    draw();
  };
  box.replaceChildren(el('p', { class: 'eline', text: 'Looks…' }));
  load();
  return box;
}
