// @ts-check
// One photo full-bleed (PHOTOS.md §3.1): its preview edge to edge on black, the day, the camera and
// its film simulation; hold it (or tap More) for Pick, Reject, a rating of 1 to 5 and Delete (to
// Recently deleted, 30 days). One day whole; Recently deleted with Restore. A photo the daily Drive
// pass found gets its preview made here the first time it is opened.
import { confirmSheet, el, toast } from '/th/ui.js';
import * as data from './data.js';
import { previewFromDrive } from './import.js';
import { back, go } from './nav.js';
import { dayName, icon, thumb } from './shelf.js';

const HOLD_MS = 450;
const sense = (/** @type {string} */ type, /** @type {string} */ id, /** @type {Record<string, unknown> | null} */ d = null) =>
  import('/th/senses/send.js').then((m) => m.sense(type, `photo:${id}`, d)).catch(() => {});

/** @param {HTMLElement} box @param {string} id */
export async function photoScreen(box, id) {
  const img = el('img', { class: 'full', alt: 'The photo' });
  const info = el('div', { class: 'info' });
  const marks = el('div', { class: 'marks', 'aria-live': 'polite' });
  const close = el('button', { type: 'button', class: 'vback', 'aria-label': 'Back to the shelf' }, [icon('caret-left')]);
  const moreBtn = el('button', { type: 'button', class: 'vmore', 'aria-label': 'Rate, flag or delete' }, [icon('star')]);
  const view = el('div', { class: 'view', role: 'dialog', 'aria-label': 'Photo' }, [img, el('div', { class: 'vtop' }, [close, info, moreBtn]), marks]);
  box.replaceChildren(view);
  close.addEventListener('click', back);
  /** @type {data.PhotoItem} */
  let p;
  try {
    p = await data.photo(id);
  } catch {
    info.textContent = 'This photo is not on this phone yet.';
    return;
  }
  const show = (/** @type {data.PhotoItem} */ q) => {
    p = q;
    info.replaceChildren(el('b', { text: dayName(q.day) }), el('span', { text: [q.camera, q.film].filter(Boolean).join(' · ') }));
    marks.replaceChildren(
      ...(q.flag === 'pick' ? [el('span', { class: 'mark', text: 'Picked' })] : q.flag === 'reject' ? [el('span', { class: 'mark', text: 'Rejected' })] : []),
      ...(q.rating ? [el('span', { class: 'mark', text: '★'.repeat(q.rating) })] : []),
    );
  };
  show(p);
  const sheet = () => actions(view, p, show);
  moreBtn.addEventListener('click', sheet);
  hold(img, sheet);
  try {
    const blob = p.preview ? await data.previewOf(id) : ((await data.thumbOf(id)) ?? null);
    if (blob) img.src = URL.createObjectURL(blob);
    if (!p.preview && navigator.onLine !== false) {
      const made = await previewFromDrive(p);
      if (made) img.src = URL.createObjectURL(await data.previewOf(id));
    }
  } catch {
    if (!img.src) view.append(el('p', { class: 'vnote', text: 'The preview is not on this phone yet.' }));
  }
}

/** A long press on the photo: what a tap on More does. @param {HTMLElement} target @param {() => void} fn */
function hold(target, fn) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let t = null;
  const stop = () => t && clearTimeout(t);
  target.addEventListener('pointerdown', () => {
    stop();
    t = setTimeout(fn, HOLD_MS);
  });
  for (const e of ['pointerup', 'pointercancel', 'pointerleave']) target.addEventListener(e, stop);
  target.addEventListener('contextmenu', (e) => e.preventDefault());
}

/** The sheet: Pick, Reject, a rating, Delete. @param {HTMLElement} host @param {data.PhotoItem} p @param {(p: data.PhotoItem) => void} show */
function actions(host, p, show) {
  if (host.querySelector('.psheet')) return;
  const dim = el('div', { class: 'pdim' });
  const shut = () => { dim.remove(); sheet.remove(); };
  dim.addEventListener('click', shut);
  const set = async (/** @type {{ rating?: number, flag?: string | null }} */ body) => {
    try {
      const q = await data.patch(p.id, body);
      show(q);
      sense('photo.rate', p.id, { rating: q.rating, flag: q.flag ?? 'none' });
      shut();
    } catch {
      toast('That did not save. Try again.');
    }
  };
  const flag = (/** @type {'pick'|'reject'} */ f, /** @type {string} */ label, /** @type {string} */ ic) => {
    const b = el('button', { type: 'button', class: `pact${p.flag === f ? ' on' : ''}`, 'aria-pressed': String(p.flag === f) }, [icon(ic), el('span', { text: label })]);
    b.addEventListener('click', () => set({ flag: p.flag === f ? null : f }));
    return b;
  };
  const stars = el('div', { class: 'stars', role: 'group', 'aria-label': 'Rating' });
  for (let n = 1; n <= 5; n++) {
    const s = el('button', { type: 'button', class: `star${n <= p.rating ? ' on' : ''}`, 'aria-label': `${n} star${n === 1 ? '' : 's'}`, 'aria-pressed': String(n === p.rating) }, [icon(n <= p.rating ? 'star-fill' : 'star')]);
    s.addEventListener('click', () => set({ rating: n === p.rating ? 0 : n }));
    stars.append(s);
  }
  const del = el('button', { type: 'button', class: 'pact danger' }, [icon('trash'), el('span', { text: 'Delete' })]);
  del.addEventListener('click', async () => {
    shut();
    const ok = await confirmSheet({ title: 'Delete this photo?', body: 'It stays in Recently deleted for 30 days, then goes, with its original moved to your Drive’s trash.', action: 'Delete' });
    if (!ok) return;
    try {
      await data.remove(p.id);
      sense('photo.delete', p.id);
      toast('Moved to Recently deleted.');
      back();
    } catch {
      toast('That did not delete. Try again.');
    }
  });
  const sheet = el('div', { class: 'psheet', role: 'dialog', 'aria-label': 'This photo' }, [
    el('div', { class: 'prow' }, [flag('pick', 'Pick', 'flag'), flag('reject', 'Reject', 'prohibit')]),
    stars,
    del,
  ]);
  host.append(dim, sheet);
  /** @type {HTMLElement | null} */ (sheet.querySelector('button'))?.focus();
}

/** One day whole. @param {HTMLElement} box @param {string} day */
export async function dayScreen(box, day) {
  const grid = el('div', { class: 'grid', 'aria-busy': 'true' });
  const top = el('button', { type: 'button', class: 'back', text: '‹ Photos' });
  top.addEventListener('click', back);
  box.replaceChildren(el('div', { class: 'shelf' }, [top, el('h1', { text: dayName(day) }), grid]));
  try {
    const s = await data.day(day);
    grid.append(...(s.days[0]?.photos ?? []).map(thumb));
    if (!s.days.length) grid.append(el('p', { class: 'empty', text: 'Nothing on this day any more.' }));
  } catch {
    grid.append(el('p', { class: 'empty', text: 'This day did not load.' }));
  }
  grid.removeAttribute('aria-busy');
}

/** Recently deleted: each with Restore; gone for good 30 days after its delete. @param {HTMLElement} box */
export async function deletedScreen(box) {
  const list = el('div', { class: 'gone', 'aria-busy': 'true' });
  const top = el('button', { type: 'button', class: 'back', text: '‹ Photos' });
  top.addEventListener('click', () => go('', { replace: true }));
  box.replaceChildren(el('div', { class: 'shelf' }, [top, el('h1', { text: 'Recently deleted' }), el('p', { class: 'lead', text: 'Deleted photos stay here 30 days, then go for good.' }), list]));
  try {
    const items = await data.deleted();
    for (const p of items) {
      const restore = el('button', { type: 'button', class: 'btn soft', text: 'Restore' });
      restore.addEventListener('click', async () => {
        await data.restore(p.id);
        row.remove();
        toast(`Back on the shelf: ${dayName(p.day)}.`);
      });
      const left = Math.max(1, 30 - Math.floor((Date.now() - (p.deleted_at ?? Date.now())) / 86_400_000));
      const row = el('div', { class: 'grow', 'data-id': p.id }, [thumb(p), el('div', { class: 'acopy' }, [el('b', { text: dayName(p.day) }), el('span', { text: `${left} day${left === 1 ? '' : 's'} left` })]), restore]);
      list.append(row);
    }
    if (!items.length) list.append(el('p', { class: 'empty', text: 'Nothing deleted.' }));
  } catch {
    list.append(el('p', { class: 'empty', text: 'Recently deleted did not load.' }));
  }
  list.removeAttribute('aria-busy');
}
