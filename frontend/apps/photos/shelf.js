// @ts-check
// The shelf (PHOTOS.md §3.1): days newest first, like the Briefing's, each with up to four
// thumbnails and a count; a day opens whole; pull down (or Import) to pick photos, each on the shelf
// at once with its upload's progress. Thumbnails come from this phone (IndexedDB) or are made from
// the Worker's preview once; offline, the kept shelf is shown with a plain line. From Drive opens
// Google's picker (pick.js) for files already in Drive, each on the shelf at once with its name until
// its preview comes (from-drive.js). A long press starts choosing photos to paste a copied edit onto
// or to export (select.js).
import { el, toast } from '/th/ui.js';
import * as data from './data.js';
import { importFiles } from './import.js';
import { go } from './nav.js';
import { makeThumb } from './preview.js';
import { chooser } from './select.js';

const NO_KEY = 'Importing from Drive needs a picker key for your Worker first (SETUP.md, Photos).';
const NOT_LINKED = 'Connect Google Drive in Settings › Photos to import from it.';
/** Imports in progress: kept across the shelf's redraws (a finished one goes with the next). */
const arriving = el('div', { class: 'arriving' });
/** @type {Promise<import('../../../shared/contract/photos.ts').DriveStatus> | null} */
let status = null;
const driveStatus = () => (status ??= data.driveStatus().catch((e) => { status = null; throw e; }));
// A preview made for a photo picked in Drive: its placeholder tile takes the thumbnail.
document.addEventListener('photos:thumb', async (e) => {
  const id = String(/** @type {CustomEvent} */ (e).detail);
  const blob = await data.thumbOf(id);
  for (const box of document.querySelectorAll(`.tile.blank[data-id="${CSS.escape(id)}"]`)) {
    if (!blob) { box.replaceChildren(); continue; }
    box.classList.remove('blank');
    box.replaceChildren(el('img', { class: 'thumb', alt: '', decoding: 'async', src: URL.createObjectURL(blob) }));
  }
});

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
    else {
      box.classList.add('blank');
      if (data.coming.has(p.id)) box.append(el('span', { class: 'tname', text: p.name }), el('span', { class: 'tnote', text: 'Preview coming' }));
    }
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
  const drive = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', class: 'add alt', disabled: '', text: 'From Drive' }));
  const dnote = el('p', { class: 'dnote', hidden: '' });
  const pull = el('div', { class: 'pull', 'aria-hidden': 'true', text: 'Pull to import' });
  const line = el('p', { class: 'line', role: 'status' });
  for (const done of arriving.querySelectorAll('.arrival.in')) done.remove();
  const days = el('div', { class: 'days', 'aria-busy': 'true' });
  const more = el('button', { type: 'button', class: 'more', hidden: '', text: 'Earlier days' });
  const bin = el('button', { type: 'button', class: 'linkish', text: 'Recently deleted' });
  bin.addEventListener('click', () => go('?deleted=1'));
  const head = el('div', { class: 'head' }, [el('h1', { text: 'Photos' }), el('div', { class: 'adds' }, [drive, add])]);
  const shelf = el('div', { class: 'shelf' }, [
    pull,
    el('a', { class: 'back', href: '/', text: '‹ Home' }),
    head,
    dnote,
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
  fromDrive(drive, dnote);

  let next = /** @type {string | null} */ (null);
  const load = async (/** @type {string | null} */ before) => {
    try {
      const s = await data.shelf(before);
      days.append(...s.days.map((d) => dayRow(d, pick.wire)));
      next = s.next;
      more.hidden = !next;
      if (s.offline) line.textContent = 'Offline: this is the shelf as this phone last saw it.';
      if (!before && !s.days.length)
        days.append(el('p', { class: 'empty', text: 'No photos yet. Pull down or tap Import to add some from this phone, or From Drive for ones in your Drive.' }));
    } catch {
      line.textContent = 'The shelf did not load. Pull down to try again.';
    }
    days.removeAttribute('aria-busy');
  };
  more.addEventListener('click', () => next && load(next));
  await load(null);
}

/** The From Drive button: on with a picker key and Drive linked, else off with why. On tap (never
 * before), Google's picker; the photos picked go on the shelf. @param {HTMLButtonElement} b @param {HTMLElement} note */
function fromDrive(b, note) {
  driveStatus().then((s) => {
    const off = !s.picker_key ? NO_KEY : !s.connected ? NOT_LINKED : '';
    b.disabled = Boolean(off);
    note.textContent = off;
    note.hidden = !off;
  }, () => {});
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const [s, t, m] = await Promise.all([driveStatus(), data.uploadToken(), import('./pick.js')]);
      const docs = await m.pickFromDrive({ key: s.picker_key, app: s.picker_app, token: t.access_token, folder: t.folder_id });
      const { files, skipped, over } = m.sortPicked(docs);
      const left = [skipped && `${skipped} skipped: only RAF, DNG, JPEG and HEIC files import`, over && `${over} over 100: pick them next time`].filter(Boolean);
      if (left.length) toast(`${left.join('. ')}.`);
      if (files.length) (await import('./from-drive.js')).importPicked(files, driveRow());
    } catch (e) {
      toast(/** @type {{ code?: string }} */ (e)?.code === 'picker' ? 'Google’s picker did not load. Try again.' : (await import('./import.js')).why(e));
    } finally {
      b.disabled = false;
    }
  });
}

/** The row a pick from Drive shows while its photos go on the shelf. */
function driveRow() {
  const bar = el('span', { class: 'bar' });
  const note = el('span', { class: 'anote', text: 'Going on the shelf' });
  const row = el('div', { class: 'arrival fromdrive' }, [el('span', { class: 'thumb dicon' }, [icon('image')]), el('div', { class: 'acopy' }, [el('b', { text: 'From Drive' }), note, el('span', { class: 'track' }, [bar])])]);
  arriving.prepend(row);
  return {
    note: (/** @type {string} */ t) => { note.textContent = t; },
    progress: (/** @type {number} */ n, /** @type {number} */ total) => { bar.style.width = `${Math.round((100 * n) / Math.max(1, total))}%`; },
    end: (/** @type {string} */ t, /** @type {boolean} */ failed = false) => {
      note.textContent = t;
      row.classList.add(failed ? 'failed' : 'in');
      if (!failed) toast(t);
    },
  };
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
