// @ts-check
// The two ways in for looks that need no learning (PHOTOS.md, Looks): .xmp presets, one or many, from
// Files or from Drive (Google's picker, the same as the shelf's, showing .xmp files), each read on this
// phone and only its recipe values kept; and a camera recipe's text pasted in, with a credit line. A
// preset already here (the same name and settings) is not added twice.
import { el, toast } from '/th/ui.js';
import * as data from '../data.js';
import { icon } from '../shelf.js';
import { addLooks } from './looks-store.js';
import { recipeOfText } from './recipe-text.js';
import { presetOfXmp, XMP_MAX_BYTES } from './xmp-import.js';

/** @typedef {import('./looks-store.js').Look} Look */
/** @typedef {import('./looks-store.js').NewLook} NewLook */
const plural = (/** @type {number} */ n, /** @type {string} */ w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const sameAs = (/** @type {NewLook} */ a, /** @type {Look} */ b) => a.name === b.name && JSON.stringify(a.recipe) === JSON.stringify(b.recipe);

/** A sheet over the editor with a title, a body and a close. @param {HTMLElement} host @param {string} title */
export function sheet(host, title) {
  host.querySelector('.lsheet')?.remove();
  host.querySelector('.ldim')?.remove();
  const dim = el('div', { class: 'xdim ldim' });
  const body = el('div', { class: 'xsheet lsheet', role: 'dialog', 'aria-label': title }, [el('h2', { text: title })]);
  const close = () => { dim.remove(); body.remove(); };
  dim.addEventListener('click', close);
  host.append(dim, body);
  return { body, close };
}

/** Presets' texts to new looks, and what was skipped. @param {{ name: string, text: string }[]} files @param {Look[]} have */
export function presetsOf(files, have) {
  /** @type {NewLook[]} */
  const fresh = [];
  let skipped = 0, refused = 0, again = 0;
  for (const f of files) {
    const p = presetOfXmp(f.text, f.name);
    if (!p) { refused++; continue; }
    const l = { name: p.name, source: /** @type {const} */ ('xmp'), tag: p.tag, panels: p.panels, recipe: p.recipe };
    if (have.some((h) => h.source === 'xmp' && sameAs(l, h)) || fresh.some((x) => x.name === l.name && JSON.stringify(x.recipe) === JSON.stringify(l.recipe))) { again++; continue; }
    skipped += p.skipped;
    fresh.push(l);
  }
  return { fresh, skipped, refused, again };
}

/** Import .xmp: Files or Drive. @param {HTMLElement} host @param {Look[]} have @param {() => void} done */
export function importSheet(host, have, done) {
  const s = sheet(host, 'Import .xmp presets');
  const input = /** @type {HTMLInputElement} */ (el('input', { type: 'file', accept: '.xmp,application/rdf+xml,text/xml', multiple: '', hidden: '', class: 'lfile' }));
  const files = el('button', { type: 'button', class: 'eauto' }, [icon('download-simple'), el('span', { text: 'From Files' })]);
  const drive = el('button', { type: 'button', class: 'seg' }, [el('span', { text: 'From Drive' })]);
  const line = el('p', { class: 'eline', 'aria-live': 'polite', text: 'One or many preset files. Only the numbers are kept: a preset you downloaded stays yours to use under its own terms.' });
  /** @param {{ name: string, text: string }[]} read */
  const take = async (read) => {
    const { fresh, skipped, refused, again } = presetsOf(read, have);
    if (!fresh.length) { line.textContent = again ? 'Those are here already.' : 'No preset in those files has a setting this editor knows.'; return; }
    line.textContent = `Adding ${plural(fresh.length, 'look')}…`;
    try { await addLooks(fresh); } catch (e) { line.textContent = /** @type {any} */ (e)?.status === 409 ? 'Looks keep 500 at most: delete some first.' : 'That did not save. Try again.'; return; }
    s.close();
    done();
    toast([`Imported ${plural(fresh.length, 'look')}`, skipped ? `${plural(skipped, 'setting')} skipped (not in this editor)` : '', again ? `${again} already here` : '', refused ? `${refused} not a preset` : ''].filter(Boolean).join(', ') + '.');
  };
  files.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const list = [...(input.files ?? [])].filter((f) => f.size <= XMP_MAX_BYTES);
    take(await Promise.all(list.map(async (f) => ({ name: f.name, text: await f.text() }))));
  });
  drive.addEventListener('click', async () => {
    try {
      const [st, t, pick, d] = await Promise.all([data.driveStatus(), data.uploadToken(), import('../pick.js'), import('../drive.js')]);
      if (!st.picker_key || !st.connected) { line.textContent = 'Drive is not linked here yet: link it from the shelf.'; return; }
      const docs = (await pick.pickFromDrive({ key: st.picker_key, app: st.picker_app, token: t.access_token, folder: t.folder_id, title: 'Choose .xmp presets', query: '.xmp' })).filter((f) => /\.xmp$/i.test(f.name)).slice(0, 100);
      line.textContent = `Reading ${plural(docs.length, 'file')}…`;
      take(await Promise.all(docs.map(async (f) => { const b = await d.fetchOriginal(t.access_token, f.id); return { name: f.name, text: b.size > XMP_MAX_BYTES ? '' : await b.text() }; })));
    } catch { line.textContent = 'Drive did not answer. Try again, or use Files.'; }
  });
  s.body.append(line, el('div', { class: 'erow' }, [files, drive]), input);
}

/** Paste a recipe: its text, a name, and where it came from. @param {HTMLElement} host @param {Look[]} _have @param {() => void} done */
export function recipeSheet(host, _have, done) {
  const s = sheet(host, 'Paste a recipe');
  const text = /** @type {HTMLTextAreaElement} */ (el('textarea', { class: 'ltext', rows: '6', 'aria-label': 'The recipe', placeholder: 'Film Simulation: …\nHighlight: …\nShadow: …\nWhite Balance: …' }));
  const name = /** @type {HTMLInputElement} */ (el('input', { class: 'vname', type: 'text', maxlength: '60', 'aria-label': 'Look name', placeholder: 'A name for this look' }));
  const from = /** @type {HTMLInputElement} */ (el('input', { class: 'vname', type: 'text', maxlength: '120', 'aria-label': 'From', placeholder: 'From (a page title, optional)' }));
  const line = el('p', { class: 'eline lread', 'aria-live': 'polite', text: 'Paste the block of lines as the recipe gives it.' });
  const go = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', class: 'eauto xgo', disabled: '' }, [icon('plus'), el('span', { text: 'Save in Recipes' })]));
  const read = () => {
    const r = recipeOfText(text.value);
    go.disabled = !r;
    if (!r) { line.textContent = text.value.trim() ? 'No line here is a setting this editor reads.' : 'Paste the block of lines as the recipe gives it.'; return null; }
    if (!name.value.trim() && r.film) name.placeholder = `${r.film} recipe`;
    line.textContent = `Reads ${plural(r.used.length, 'setting')}${r.skipped ? `, ${plural(r.skipped, 'line')} skipped` : ''}.${r.film ? ` ${r.film} is kept as a name: applied without the simulation for now.` : ''}`;
    return r;
  };
  text.addEventListener('input', read);
  go.addEventListener('click', async () => {
    const r = read();
    if (!r) return;
    const n = (name.value.trim() || (r.film ? `${r.film} recipe` : 'Pasted recipe')).slice(0, 60);
    try { await addLooks([{ name: n, source: 'recipe', panels: r.panels, recipe: r.recipe, film: r.film, credit: from.value.trim().slice(0, 120) || null }]); } catch (e) { line.textContent = /** @type {any} */ (e)?.status === 409 ? 'Looks keep 500 at most: delete some first.' : 'That did not save. Try again.'; return; }
    s.close();
    done();
    toast(`Kept “${n}” in Recipes.`);
  });
  s.body.append(text, line, name, from, go);
  text.focus();
}
