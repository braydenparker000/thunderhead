// @ts-check
// Versions (PHOTOS.md, Versions; /v1/photos/:id/versions): an automatic version when an editing
// session ends (leaving the editor, or ten minutes without a change) and named ones you make, rename
// and delete. The panel is a filmstrip, newest first; tap one to restore, rename or delete it, tap a
// second to compare the two side by side with the photo's current crop. Restore is an ordinary recipe
// put, so the toast's Undo (and the ledger's) puts the recipe before back.
import { api, signedIn } from '/th/client.js';
import { uuidv7 } from '/th/chat/model.js';
import { el, toast } from '/th/ui.js';
import { icon } from '../shelf.js';
import { GEO_KEYS } from './geometry.js';
import { segments } from './slider.js';

const IDLE_MS = 10 * 60 * 1000;
/** @typedef {import('../../../../shared/contract/photos-versions.ts').PhotoVersion} Version */
/** @typedef {import('./tools.js').Ed} Ed */
/** @typedef {import('./fields.js').Recipe} Recipe */

const call = (/** @type {string} */ path, /** @type {Record<string, unknown>} */ o = {}) => signedIn((token) => api.call(path, { ...o, token }));
/** @param {string} id @returns {Promise<Version[]>} */
export const listVersions = async (id) => (await call(`/v1/photos/${id}/versions`)).items;
/** @param {string} id @param {'auto' | 'named'} kind @param {Recipe} recipe @param {string} [name] */
export const addVersion = (id, kind, recipe, name) => call(`/v1/photos/${id}/versions`, { method: 'POST', body: { id: uuidv7(), kind, recipe, ...(name ? { name } : {}) } });

/** The session's automatic version: `touched()` on each change, `end()` when the editor closes.
 * @param {string} id @param {() => Recipe} recipe */
export function session(id, recipe) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let idle = null;
  let dirty = false;
  const end = () => {
    if (idle) clearTimeout(idle);
    idle = null;
    if (!dirty) return;
    dirty = false;
    addVersion(id, 'auto', recipe()).catch(() => { dirty = true; });
  };
  return { touched() { dirty = true; if (idle) clearTimeout(idle); idle = setTimeout(end, IDLE_MS); }, end };
}

/** A recipe shown with another's crop and geometry, so two versions compare like for like. @param {Recipe} r @param {Recipe} like */
export function withGeometryOf(r, like) {
  const out = /** @type {Record<string, unknown>} */ ({ ...r });
  for (const k of GEO_KEYS) {
    const v = /** @type {Record<string, unknown>} */ (like)[k];
    if (v === undefined) delete out[k]; else out[k] = v;
  }
  return /** @type {Recipe} */ (out);
}

const when = (/** @type {number} */ t) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const label = (/** @type {Version} */ v) => v.name ?? `Automatic, ${when(v.created_at)}`;

/** The Versions panel. @param {Ed} ed @param {string} tool all | named | auto */
export function versionsTool(ed, tool) {
  const box = el('div', { class: 'ecol vpanel' });
  /** @type {Version[]} */
  let items = [];
  /** @type {string[]} */
  let chosen = [];
  const load = async () => {
    try { items = await listVersions(ed.id); } catch { box.replaceChildren(el('p', { class: 'eline', text: 'Versions need a connection: kept edits are safe.' })); return; }
    draw();
  };
  const actions = () => {
    const picked = chosen.map((c) => items.find((v) => v.id === c)).filter((v) => v !== undefined);
    if (picked.length === 2) {
      const b = el('button', { type: 'button', class: 'eauto' }, [icon('columns'), el('span', { text: 'Compare' })]);
      b.addEventListener('click', () => ed.compare(picked.map((v) => ({ recipe: v.recipe, label: label(v) }))));
      return [b];
    }
    if (picked.length !== 1) return [];
    const v = picked[0];
    const restore = el('button', { type: 'button', class: 'eauto' }, [icon('arrow-counter-clockwise'), el('span', { text: 'Restore' })]);
    restore.addEventListener('click', () => {
      const before = ed.recipe;
      ed.restore(v.recipe);
      toast(`Restored ${v.name ? `“${v.name}”` : 'that version'}.`, { label: 'Undo', run: () => ed.restore(before) });
    });
    const rename = el('button', { type: 'button', class: 'seg', 'aria-label': 'Rename' }, [icon('pencil-simple')]);
    rename.addEventListener('click', () => nameIt(v.name ?? '', async (name) => {
      await call(`/v1/photos/${ed.id}/versions/${v.id}`, { method: 'PATCH', body: { name } });
      await load();
    }));
    const del = el('button', { type: 'button', class: 'seg', 'aria-label': 'Delete' }, [icon('trash')]);
    del.addEventListener('click', async () => {
      await call(`/v1/photos/${ed.id}/versions/${v.id}`, { method: 'DELETE' }).catch(() => toast('That did not delete. Try again.'));
      chosen = [];
      await load();
    });
    return [restore, rename, del];
  };
  /** @param {string} start @param {(name: string) => Promise<void>} save */
  const nameIt = (start, save) => {
    const input = el('input', { class: 'vname', type: 'text', maxlength: '60', value: start, 'aria-label': 'Version name', placeholder: 'A name for this version' });
    const ok = el('button', { type: 'button', class: 'eauto', text: 'Save' });
    const go = async () => {
      const name = /** @type {HTMLInputElement} */ (input).value.trim();
      if (!name) return;
      try { await save(name); } catch (e) { toast(/** @type {any} */ (e)?.status === 409 ? 'A photo keeps 20 named versions: delete one first.' : 'That did not save. Try again.'); draw(); }
    };
    ok.addEventListener('click', go);
    input.addEventListener('keydown', (e) => { if (/** @type {KeyboardEvent} */ (e).key === 'Enter') go(); });
    box.replaceChildren(el('div', { class: 'erow' }, [input, ok]));
    input.focus();
  };
  const draw = () => {
    const shown = items.filter((v) => tool === 'all' || v.kind === tool);
    const strip = el('div', { class: 'vstrip', role: 'list' });
    for (const v of shown) {
      const c = el('button', { type: 'button', role: 'listitem', class: `vcard${chosen.includes(v.id) ? ' on' : ''}`, 'aria-pressed': String(chosen.includes(v.id)), 'data-kind': v.kind }, [el('span', { class: 'vthumb' }), el('span', { class: 'vlabel', text: label(v) })]);
      c.addEventListener('click', () => { chosen = chosen.includes(v.id) ? chosen.filter((x) => x !== v.id) : [...chosen, v.id].slice(-2); draw(); });
      ed.thumb(withGeometryOf(v.recipe, ed.recipe)).then((t) => c.querySelector('.vthumb')?.replaceChildren(t)).catch(() => {});
      strip.append(c);
    }
    const make = el('button', { type: 'button', class: 'seg vmake' }, [icon('plus'), el('span', { text: 'Create version' })]);
    make.addEventListener('click', () => nameIt(`Version ${items.filter((v) => v.kind === 'named').length + 1}`, async (name) => {
      await addVersion(ed.id, 'named', ed.recipe, name);
      toast(`Kept as “${name}”.`);
      await load();
    }));
    const empty = el('p', { class: 'eline', text: tool === 'auto' ? 'An automatic version is kept each time you finish editing.' : 'None yet: Create version keeps the edit as it is now.' });
    box.replaceChildren(el('div', { class: 'erow vhead' }, [make, ...actions()]), shown.length ? strip : empty);
    box.dataset.count = String(shown.length);
  };
  box.replaceChildren(el('p', { class: 'eline', text: 'Versions…' }));
  load();
  return box;
}

/** Two versions side by side over the photo, each rendered small with the same crop. Tap to close.
 * @param {HTMLElement} stage @param {{ canvas: HTMLCanvasElement, label: string }[]} two */
export function compareView(stage, two) {
  const view = el('div', { class: 'vcompare', role: 'dialog', 'aria-label': 'Two versions side by side' }, two.map((t) => el('figure', {}, [t.canvas, el('figcaption', { text: t.label })])));
  const close = el('button', { type: 'button', class: 'vback vclose', 'aria-label': 'Close the comparison' }, [icon('x')]);
  view.append(close);
  const done = () => view.remove();
  close.addEventListener('click', done);
  view.addEventListener('click', (e) => { if (e.target === view) done(); });
  stage.append(view);
  return view;
}

