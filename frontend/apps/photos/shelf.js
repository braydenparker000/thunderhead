// @ts-check
// The shelf (PHOTOS.md §3.1): days newest first, like the Briefing's, each with up to four
// thumbnails and a count; a day opens whole; pull down (or Import) to pick photos, each on the shelf
// at once with its upload's progress. Thumbnails come from this phone (IndexedDB) or are made from
// the Worker's preview once; offline, the kept shelf is shown with a plain line. A long press starts
// choosing photos to paste a copied edit onto or to export (select.js).
import { el, toast } from '/th/ui.js';
import * as data from './data.js';
import { importFiles } from './import.js';
import { go } from './nav.js';
import { makeThumb } from './preview.js';
import { chooser } from './select.js';

const ACCEPT = '.raf,.RAF,.dng,.DNG,.jpg,.jpeg,.heic,.heif,image/jpeg,image/heic,image/heif';
const icon = (/** @type {string} */ n) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'i');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<use href="/ui/icons.svg#${n}"/>`;
  return s;
};
export { icon };

/** "Friday 30 October" (and the year when it is not this one). @param {string} day */
export function dayName(day) {
  const d = new Date(`${day}T12:00:00Z`);
  const year = d.getUTCFullYear() !== new Date().getFullYear();
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
}
const count = (/** @type {number} */ n) => `${n} photo${n === 1 ? '' : 's'}`;

/** A thumbnail: this phone's, or made once from the Worker's preview. @param {data.PhotoItem} p */
export function thumb(p) {
  const box = el('button', { type: 'button', class: `tile${p.flag === 'reject' ? ' rejected' : ''}`, 'aria-label': `Photo, ${dayName(p.day)}`, 'data-id': p.id });
  box.addEventListener('click', () => go(`?photo=${p.id}`));
  (async () => {
    let blob = await data.thumbOf(p.id);
    if (!blob && p.preview) {
      blob = await makeThumb(await data.previewOf(p.id));
      data.keepThumb(p.id, blob);
    }
    if (blob) box.append(el('img', { class: 'thumb', alt: '', decoding: 'async', src: URL.createObjectURL(blob) }));
    else box.classList.add('blank');
  })().catch(() => box.classList.add('blank'));
  return box;
}

/** @param {{ day: string, count: number, photos: data.PhotoItem[] }} d @param {(t: HTMLElement, p: data.PhotoItem) => HTMLElement} wire */
const dayRow = (d, wire) => {
  const head = el('button', { type: 'button', class: 'dayhead', 'data-day': d.day }, [
    el('span', { class: 'dname', text: dayName(d.day) }),
    el('span', { class: 'dcount', text: count(d.count) }),
  ]);
  head.addEventListener('click', () => go(`?day=${d.day}`));
  return el('section', { class: 'day' }, [head, el('div', { class: 'tiles' }, d.photos.map((p) => wire(thumb(p), p)))]);
};

/** The shelf's screen. @param {HTMLElement} box */
export async function shelfScreen(box) {
  const picker = /** @type {HTMLInputElement} */ (el('input', { type: 'file', multiple: '', accept: ACCEPT, hidden: '' }));
  const add = el('button', { type: 'button', class: 'add', 'aria-label': 'Import photos' }, [icon('plus'), el('span', { text: 'Import' })]);
  const pull = el('div', { class: 'pull', 'aria-hidden': 'true', text: 'Pull to import' });
  const line = el('p', { class: 'line', role: 'status' });
  const arriving = el('div', { class: 'arriving' });
  const days = el('div', { class: 'days', 'aria-busy': 'true' });
  const more = el('button', { type: 'button', class: 'more', hidden: '', text: 'Earlier days' });
  const bin = el('button', { type: 'button', class: 'linkish', text: 'Recently deleted' });
  bin.addEventListener('click', () => go('?deleted=1'));
  const head = el('div', { class: 'head' }, [el('h1', { text: 'Photos' }), add]);
  const shelf = el('div', { class: 'shelf' }, [
    pull,
    el('a', { class: 'back', href: '/', text: '‹ Home' }),
    head,
    line,
    arriving,
    days,
    more,
    bin,
    picker,
  ]);
  box.replaceChildren(shelf);
  const pick = chooser(box, head);
  add.addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => {
    const files = [...(picker.files ?? [])];
    picker.value = '';
    if (files.length) importFiles(files, (a) => arrival(arriving, a));
  });
  pullToImport(shelf, pull, () => picker.click());

  let next = /** @type {string | null} */ (null);
  const load = async (/** @type {string | null} */ before) => {
    try {
      const s = await data.shelf(before);
      days.append(...s.days.map((d) => dayRow(d, pick.wire)));
      next = s.next;
      more.hidden = !next;
      if (s.offline) line.textContent = 'Offline: this is the shelf as this phone last saw it.';
      if (!before && !s.days.length)
        days.append(el('p', { class: 'empty', text: 'No photos yet. Pull down or tap Import to add some from this phone.' }));
    } catch {
      line.textContent = 'The shelf did not load. Pull down to try again.';
    }
    days.removeAttribute('aria-busy');
  };
  more.addEventListener('click', () => next && load(next));
  await load(null);
}

/** One photo arriving: its thumbnail at once, a bar while it uploads, on the shelf once in.
 * @param {HTMLElement} host @param {import('./import.js').Arrival} a */
function arrival(host, a) {
  const bar = el('span', { class: 'bar' });
  const img = el('img', { class: 'thumb', alt: '' });
  if (a.thumb) img.src = URL.createObjectURL(a.thumb);
  const note = el('span', { class: 'anote', text: 'Uploading to Drive' });
  const row = el('div', { class: 'arrival', 'data-id': a.id }, [img, el('div', { class: 'acopy' }, [el('b', { text: a.name }), note, el('span', { class: 'track' }, [bar])])]);
  host.prepend(row);
  return {
    progress: (/** @type {number} */ sent, /** @type {number} */ total) => {
      bar.style.width = `${Math.round((100 * sent) / Math.max(1, total))}%`;
    },
    done: (/** @type {data.PhotoItem} */ p) => {
      note.textContent = 'In Drive';
      row.classList.add('in');
      row.dataset.id = p.id;
      toast(`On the shelf: ${dayName(p.day)}.`);
      document.dispatchEvent(new CustomEvent('photos:changed'));
    },
    failed: (/** @type {string} */ why) => {
      note.textContent = why;
      row.classList.add('failed');
    },
  };
}

/** Pull down from the top of the shelf to import. @param {HTMLElement} scroller @param {HTMLElement} hint @param {() => void} pick */
function pullToImport(scroller, hint, pick) {
  let y0 = -1, dy = 0;
  scroller.addEventListener('touchstart', (e) => { y0 = scroller.scrollTop <= 0 ? e.touches[0].clientY : -1; dy = 0; }, { passive: true });
  scroller.addEventListener('touchmove', (e) => {
    if (y0 < 0) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    hint.style.setProperty('--pull', String(Math.min(1, dy / 80)));
    hint.textContent = dy > 80 ? 'Let go to import' : 'Pull to import';
  }, { passive: true });
  scroller.addEventListener('touchend', () => {
    hint.style.setProperty('--pull', '0');
    if (y0 >= 0 && dy > 80) pick();
    y0 = -1;
  });
}
