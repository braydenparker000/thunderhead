// @ts-check
// Choosing photos (PHOTOS.md, Copy and paste): on the shelf or a whole day, a long press on a photo
// starts choosing (a short buzz where the phone has one), a tap adds or takes away, the bar on top
// counts them and offers Paste (while an edit is copied), Export and Cancel; 20 at most, and the 21st
// tap says so. Paste is one call (POST /v1/photos/paste) and one ledger row, with Undo for all of
// them; Export opens the editor's Export sheet for the chosen photos (edit/batch.js). While an edit
// is copied, a chip says which panels and lets it go.
import { api, signedIn } from '/th/client.js';
import { el, toast } from '/th/ui.js';
import { drop, held, MAX_PHOTOS, named, PANEL_NAMES } from './copied.js';
import * as data from './data.js';

const HOLD_MS = 450;
const SLOP = 10;
const icon = (/** @type {string} */ n) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'i');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<use href="/ui/icons.svg#${n}"/>`;
  return s;
};
const btn = (/** @type {string} */ cls, /** @type {string} */ text, i = '') =>
  /** @type {HTMLButtonElement} */ (el('button', { type: 'button', class: cls }, [...(i ? [icon(i)] : []), el('span', { text })]));
const photos = (/** @type {number} */ n) => (n === 1 ? 'a photo' : `${n} photos`);

/** One screen's choosing. @param {HTMLElement} box the screen (the bar and the sheets go here) @param {HTMLElement} head what the chip follows */
export function chooser(box, head) {
  /** @type {Map<string, data.PhotoItem>} */
  const chosen = new Map();
  /** @type {Map<string, HTMLElement>} */
  const tiles = new Map();
  let on = false;
  const count = el('b', { class: 'selcount', 'aria-live': 'polite' });
  const cancel = btn('selb', 'Cancel'), paste = btn('selb go', 'Paste', 'copy'), out = btn('selb go', 'Export', 'export');
  const bar = el('div', { class: 'selbar', role: 'toolbar', 'aria-label': 'Chosen photos', hidden: '' }, [cancel, count, el('span', { class: 'selacts' }, [paste, out])]);
  const chip = el('div', { class: 'copychip', hidden: '' });
  const done = el('div', { class: 'pasted', role: 'status', hidden: '' });
  head.after(chip, done);
  box.append(bar);

  const draw = () => {
    bar.hidden = !on;
    box.classList.toggle('choosing', on);
    count.textContent = `${chosen.size} chosen`;
    paste.hidden = !held();
    paste.disabled = out.disabled = !chosen.size;
    for (const [id, t] of tiles) {
      t.classList.toggle('chosen', chosen.has(id));
      if (on) t.setAttribute('aria-pressed', String(chosen.has(id))); else t.removeAttribute('aria-pressed');
    }
    const c = held();
    chip.hidden = !c;
    if (c) {
      const x = el('button', { type: 'button', class: 'chipx', 'aria-label': 'Let the copied edit go' }, [icon('x')]);
      x.addEventListener('click', () => { drop(); draw(); });
      chip.replaceChildren(icon('copy'), el('span', { text: `Copied: ${named(c.panels)}. Hold a photo to choose where it goes.` }), x);
    }
  };
  const leave = () => { on = false; chosen.clear(); draw(); };
  const toggle = (/** @type {data.PhotoItem} */ p) => {
    if (chosen.has(p.id)) chosen.delete(p.id);
    else if (!p.drive_id) { toast('Still uploading: it can be exported or pasted to once it is in Drive.'); return; }
    else if (chosen.size >= MAX_PHOTOS) { toast(`Up to ${MAX_PHOTOS} photos at a time.`); return; }
    else chosen.set(p.id, p);
    draw();
  };
  cancel.addEventListener('click', leave);
  paste.addEventListener('click', () => pasteChosen());
  out.addEventListener('click', async () => {
    const list = [...chosen.values()];
    leave();
    const [{ exportSheet }, { batchItems }] = await Promise.all([import('./edit/export.js'), import('./edit/batch.js')]);
    exportSheet(box, batchItems(list));
  });

  async function pasteChosen() {
    const c = held();
    if (!c || !chosen.size) return;
    paste.disabled = true;
    const ids = [...chosen.keys()];
    try {
      /** @type {import('../../../shared/contract/photos.ts').PastePhotosResponse} */
      const r = await signedIn((token) => api.call('/v1/photos/paste', { method: 'POST', token, body: { ids, panels: c.panels, recipe: c.recipe } }));
      for (const it of r.items) {
        data.store.set(`recipe:${it.id}`, it.recipe).catch(() => {});
        data.store.del(`recipe-pending:${it.id}`).catch(() => {});
      }
      const changed = r.items.filter((i) => i.changed);
      import('/th/senses/send.js').then((m) => m.sense('photo.paste', null, { count: ids.length, ...Object.fromEntries(PANEL_NAMES.map(([p]) => [p, c.panels.includes(p)])) })).catch(() => {});
      leave();
      if (!changed.length || !r.ledger_id) { toast(ids.length === 1 ? 'It already has this look.' : 'They already have this look.'); return; }
      pasted(changed, r.ledger_id);
    } catch {
      paste.disabled = false;
      toast(navigator.onLine === false ? 'Offline: paste needs the connection.' : 'That did not paste. Try again.');
    }
  }

  /** The line after a paste, with Undo for all of them. @param {{ id: string, before: any }[]} changed @param {string} ledger */
  function pasted(changed, ledger) {
    const undo = btn('linkish undo', 'Undo');
    done.replaceChildren(el('span', { text: `Pasted to ${photos(changed.length)}.` }), undo);
    done.hidden = false;
    undo.addEventListener('click', async () => {
      undo.disabled = true;
      try {
        await signedIn((token) => api.call(`/v1/ledger/${encodeURIComponent(ledger)}/undo`, { method: 'POST', token, body: {} }));
        for (const it of changed) data.store.set(`recipe:${it.id}`, it.before).catch(() => {});
        done.replaceChildren(el('span', { text: changed.length === 1 ? 'Back as it was.' : 'Back as they were.' }));
      } catch {
        undo.disabled = false;
        toast('That did not undo. Try again.');
      }
    });
  }

  /** A photo's tile, chosen by a long press, then by taps. @param {HTMLElement} tile @param {data.PhotoItem} p */
  const wire = (tile, p) => {
    tiles.set(p.id, tile);
    /** @type {ReturnType<typeof setTimeout> | null} */
    let t = null;
    let x0 = 0, y0 = 0, fired = false;
    const stop = () => { if (t) clearTimeout(t); t = null; };
    tile.addEventListener('pointerdown', (e) => {
      stop();
      fired = false;
      x0 = e.clientX; y0 = e.clientY;
      t = setTimeout(() => {
        t = null;
        fired = true;
        navigator.vibrate?.(12);
        if (!on) { on = true; chosen.clear(); }
        if (!chosen.has(p.id)) toggle(p); else draw();
      }, HOLD_MS);
    });
    tile.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - x0, e.clientY - y0) > SLOP) stop(); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) tile.addEventListener(ev, stop);
    tile.addEventListener('contextmenu', (e) => e.preventDefault());
    // Before the tile's own click (which opens the photo): while choosing, a tap chooses.
    tile.addEventListener('click', (e) => {
      if (!fired && !on) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (fired) fired = false;
      else toggle(p);
    }, { capture: true });
    return tile;
  };
  draw();
  return { wire, leave };
}
