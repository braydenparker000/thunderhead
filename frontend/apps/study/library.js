// @ts-check
// Study's start (STUDY.md §5.1, §3, §6): "Study" with Add a book and the search field; Continue,
// the last three books opened with their page and a thin line of how far; All books as covers
// (drawn from the first page on this phone, else the title on Study's green spine) with what each
// is waiting for; the empty shelf; and the search across every ready book, grouped by book.
import { lineFor } from '/th/copy.js';
import { failure } from '/th/flow.js';
import { confirmSheet, el, toast } from '/th/ui.js';
import * as data from './data.js';
import { back as goBack, go } from './nav.js';
import { readLocal } from './pdf.js';
import { partsOf, refuse, sendParts, titleFor } from './upload.js';
import { continueRow, pageName, progress, shelfOrder, snippetParts, stateLine } from './words.js';

/** @typedef {import('../../../shared/contract/library.ts').Book} Book */

const icon = (/** @type {string} */ name) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `/ui/icons.svg#${name}`);
  svg.append(use);
  return svg;
};
const uuidv7 = () => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  const t = Date.now();
  for (let i = 0; i < 6; i++) b[i] = (t / 2 ** (8 * (5 - i))) & 0xff;
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** Files picked in this visit, by book, so Resume needs no second pick. @type {Map<string, File>} */
const files = new Map();
/** Upload progress by book, 0–1. @type {Map<string, number>} */
const sending = new Map();
/** @type {Book[]} */
let shelf = [];
/** @type {(() => void) | null} */
let redraw = null;

/** @param {HTMLElement} main */
export async function libraryScreen(main) {
  const pick = el('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: '' });
  const add = el('button', { type: 'button', class: 'add' }, [icon('plus'), 'Add a book']);
  const input = el('input', { type: 'search', placeholder: 'Search your books', 'aria-label': 'Search your books', enterkeyhint: 'search' });
  const find = el('form', { class: 'find', role: 'search' }, [icon('magnifying-glass'), input]);
  const body = el('div');
  const lib = el('div', { class: 'lib' }, [
    el('a', { class: 'back', href: '/', text: '‹ Home' }),
    el('div', { class: 'libhead' }, [el('h1', { text: 'Study' }), add]),
    find,
    body,
    pick,
  ]);
  main.replaceChildren(lib);
  add.addEventListener('click', () => pick.click());
  pick.addEventListener('change', () => {
    const f = pick.files?.[0];
    pick.value = '';
    if (f) addBook(f);
  });
  find.addEventListener('submit', (e) => {
    e.preventDefault();
    if (input.value.trim().length >= 2) go(`?q=${encodeURIComponent(input.value.trim())}`);
  });
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let typing;
  input.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      if (input.value.trim().length >= 2) go(`?q=${encodeURIComponent(input.value.trim())}`);
    }, 250);
  });
  redraw = () => draw(body);
  shelf = (await data.local.get('books')) ?? shelf;
  draw(body);
  await refresh();
  // While a book is being added or read, its line moves on its own.
  const timer = setInterval(() => {
    if (!document.hidden && shelf.some((b) => !['ready', 'failed', 'duplicate'].includes(b.state))) refresh();
  }, 30_000);
  // Gone once another place replaces this screen.
  const stop = new MutationObserver(() => {
    if (!lib.isConnected) {
      clearInterval(timer);
      stop.disconnect();
    }
  });
  stop.observe(main, { childList: true });
}

async function refresh() {
  try {
    shelf = await data.books();
    await data.local.set('books', shelf);
  } catch (e) {
    if (!shelf.length) toast(lineFor(failure(e)));
  }
  redraw?.();
}

/** @param {HTMLElement} body */
async function draw(body) {
  if (!shelf.length) {
    const add = el('button', { type: 'button', class: 'add' }, [icon('plus'), 'Add a book']);
    add.addEventListener('click', () => /** @type {HTMLElement} */ (document.querySelector('.libhead .add'))?.click());
    body.replaceChildren(
      el('div', { class: 'empty' }, [icon('book-open-text'), el('p', { text: 'Your books will live here. Add a PDF to start.' }), add]),
    );
    return;
  }
  const covers = new Map(await Promise.all(shelf.map(async (b) => /** @type {[string, string | undefined]} */ ([b.id, await data.cover(b.id)]))));
  const parts = [];
  const cont = continueRow(shelf);
  // The printed page numbers the reader saw (pdf.js reads them from the file).
  /** @type {Map<string, (string | null)[]>} */
  const labels = new Map(await Promise.all(cont.map(async (b) => /** @type {[string, (string | null)[]]} */ ([b.id, (await data.local.get(`labels:${b.id}`)) ?? []]))));
  const placeOf = (/** @type {Book} */ b) => (b.position ? pageName(b.position.pdf_page, labels.get(b.id)?.[b.position.pdf_page - 1]) : '');
  if (cont.length) {
    parts.push(el('h2', { class: 'sec', text: 'Continue' }));
    parts.push(
      el(
        'div',
        { class: 'cont' },
        cont.map((b) => {
          const row = el('button', { type: 'button', class: 'crow' }, [
            coverOf(b, covers.get(b.id), true),
            el('span', { class: 'ct' }, [
              el('b', { text: b.title }),
              el('small', { text: placeOf(b) }),
              el('span', { class: 'bar' }, [el('i', { style: `width:${Math.round(progress(b) * 100)}%` })]),
            ]),
          ]);
          row.addEventListener('click', () => go(`?book=${b.id}`));
          return row;
        }),
      ),
    );
  }
  parts.push(el('h2', { class: 'sec', text: 'All books' }));
  parts.push(el('div', { class: 'shelf' }, shelfOrder(shelf).map((b) => bookTile(b, covers.get(b.id)))));
  body.replaceChildren(...parts);
}

/** @param {Book} b @param {string | undefined} img @param {boolean} [small] the Continue row's */
function coverOf(b, img, small = false) {
  const c = el('span', { class: img ? 'cover' : 'cover plain', 'aria-hidden': 'true' });
  if (img) c.append(el('img', { src: img, alt: '' }));
  else if (small) c.append(icon('book-open-text'));
  else c.append(el('b', { text: b.title }), el('em', { text: b.author ?? '' }));
  const sent = sending.get(b.id);
  if (b.state === 'uploading' && sent !== undefined) {
    const r = 21;
    const len = 2 * Math.PI * r;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 50 50');
    for (const [cls, off] of [['track', 0], ['done', len * (1 - sent)]]) {
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('class', String(cls));
      circle.setAttribute('cx', '25');
      circle.setAttribute('cy', '25');
      circle.setAttribute('r', String(r));
      circle.setAttribute('stroke-dasharray', String(len));
      circle.setAttribute('stroke-dashoffset', String(off));
      svg.append(circle);
    }
    c.append(el('span', { class: 'ring' }, [svg, el('span', { text: `${Math.floor(sent * 100)}%` })]));
  }
  return c;
}

/** @param {Book} b @param {string | undefined} img */
function bookTile(b, img) {
  const line = b.state === 'ready' ? (b.position ? pageName(b.position.pdf_page, null) : '') : stateLine(b);
  // A plain cover already carries the title; a drawn one gets it underneath.
  const kids = img ? [coverOf(b, img), el('span', { class: 'bt', text: b.title })] : [coverOf(b, img)];
  const acts = el('span', { class: 'acts' });
  if (b.state === 'uploading' && !sending.has(b.id)) {
    kids.push(el('span', { class: 'bs study', text: 'Stopped while adding' }));
    acts.append(action('Resume', () => resume(b)));
  } else if (b.state === 'failed') {
    kids.push(el('span', { class: 'bs', text: line }));
    acts.append(
      action('Details', () => confirmSheet({ title: "Couldn't read this book.", body: b.state_reason ?? '', action: 'Try again', keep: 'Close', danger: false }).then((yes) => {
          if (yes) tryAgain(b);
        })),
      action('Try again', () => tryAgain(b)),
    );
  } else if (b.state === 'duplicate') {
    kids.push(el('span', { class: 'bs', text: line }));
    if (b.duplicate_of) acts.append(action('Open the other copy', () => go(`?book=${b.duplicate_of}`)));
  } else if (line) kids.push(el('span', { class: b.state === 'ready' ? 'bs' : 'bs study', text: line }));
  if (acts.childNodes.length) kids.push(acts);
  const tile = el('div', { class: 'book' }, kids);
  const opens = !['uploading', 'duplicate'].includes(b.state);
  if (opens) {
    tile.setAttribute('role', 'button');
    tile.setAttribute('tabindex', '0');
    tile.setAttribute('aria-label', `${b.title}${line ? `, ${line}` : ''}`);
    const open = (/** @type {Event} */ e) => {
      if (!(/** @type {HTMLElement} */ (e.target).closest('.acts'))) go(`?book=${b.id}`);
    };
    tile.addEventListener('click', open);
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') open(e);
    });
  }
  return tile;
}

/** @param {string} text @param {() => void} fn */
function action(text, fn) {
  const b = el('button', { type: 'button', class: 'link', text });
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    fn();
  });
  return b;
}

/** @param {Book} b */
async function tryAgain(b) {
  try {
    await data.retry(b.id);
    toast('It will be read again tonight.');
  } catch (e) {
    toast(lineFor(failure(e)));
  }
  refresh();
}

/** A picked file: refused, or read here for its title and cover, created, and sent. @param {File} f */
async function addBook(f) {
  const no = refuse(f);
  if (no) return toast(no);
  const meta = await readLocal(f);
  if (!meta) return toast("That file isn't a readable PDF.");
  const id = uuidv7();
  try {
    const r = await data.create({ id, title: titleFor(meta.title, f.name), author: meta.author?.trim().slice(0, 200) || null, bytes: f.size });
    if (meta.cover) await data.saveCover(id, meta.cover);
    await data.local.set(`upload:${id}`, { name: f.name, size: f.size, part_bytes: r.upload.part_bytes });
    files.set(id, f);
    shelf = [r.book, ...shelf.filter((b) => b.id !== id)];
    await send(r.book, f, r.upload.part_bytes, []);
  } catch (e) {
    toast(lineFor(failure(e)));
    refresh();
  }
}

/** @param {Book} b @param {File} f @param {number} partBytes @param {number[]} have */
async function send(b, f, partBytes, have) {
  sending.set(b.id, 0);
  redraw?.();
  let last = 0;
  try {
    await sendParts({
      file: f,
      bookId: b.id,
      partBytes,
      have,
      onProgress: (x) => {
        sending.set(b.id, x);
        // The ring moves at most every 200 ms.
        if (Date.now() - last > 200) {
          last = Date.now();
          redraw?.();
        }
      },
    });
    await data.complete(b.id);
    await data.local.del(`upload:${b.id}`);
    files.delete(b.id);
    toast('Added. It will be read tonight.');
  } catch (e) {
    toast(`The upload stopped. ${lineFor(failure(e))} Tap Resume to go on.`);
  } finally {
    sending.delete(b.id);
    refresh();
  }
}

/** Sends what is missing: the file picked in this visit, else the same file picked again. @param {Book} b */
async function resume(b) {
  /** @type {{ name: string, size: number, part_bytes: number } | undefined} */
  const rec = await data.local.get(`upload:${b.id}`);
  const partBytes = rec?.part_bytes ?? 50 * 1024 * 1024;
  const known = files.get(b.id);
  if (known) return send(b, known, partBytes, b.parts ?? []);
  const pick = el('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: '' });
  document.body.append(pick);
  pick.addEventListener('change', () => {
    const f = pick.files?.[0];
    pick.remove();
    if (!f) return;
    if (f.size !== b.bytes) return toast("That's a different file. Pick the same PDF to go on.");
    files.set(b.id, f);
    send(b, f, partBytes, b.parts ?? []);
  });
  toast(`Pick ${rec?.name ?? 'the same PDF'} again to go on (${(b.parts ?? []).length} of ${partsOf(b.bytes, partBytes)} parts sent).`);
  pick.click();
}

// --- search (STUDY.md §6) -------------------------------------------------------------------

/** @param {HTMLElement} main @param {string} q @param {string | null} inBook search one book only */
export async function searchScreen(main, q, inBook) {
  /** @type {Book[]} */
  const known = (await data.local.get('books')) ?? [];
  const where = inBook ? (known.find((b) => b.id === inBook)?.title ?? 'this book') : null;
  const label = where ? `Search in ${where}` : 'Search your books';
  const input = el('input', { type: 'search', value: q, placeholder: label, 'aria-label': label, enterkeyhint: 'search' });
  const find = el('form', { class: 'find', role: 'search' }, [icon('magnifying-glass'), input]);
  const out = el('div');
  const back = el('button', { type: 'button', class: 'back', text: where ? '‹ Back to the book' : '‹ Study' });
  main.replaceChildren(el('div', { class: 'lib' }, [back, find, out]));
  back.addEventListener('click', goBack);
  input.focus({ preventScroll: true });
  input.setSelectionRange(q.length, q.length);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let typing;
  let asked = 0;
  const run = async (/** @type {string} */ text) => {
    const n = ++asked;
    const t = text.trim();
    if (t.length < 2) return out.replaceChildren();
    try {
      const r = await data.search(t, inBook, null);
      if (n !== asked) return;
      showHits(out, t, r, known);
    } catch (e) {
      if (n === asked) out.replaceChildren(el('p', { class: 'note', text: lineFor(failure(e)) }));
    }
  };
  input.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      history.replaceState(null, '', `/study/?q=${encodeURIComponent(input.value.trim())}${inBook ? `&in=${inBook}` : ''}`);
      run(input.value);
    }, 250);
  });
  find.addEventListener('submit', (e) => {
    e.preventDefault();
    run(input.value);
  });
  run(q);
}

/** @param {HTMLElement} out @param {string} q @param {import('../../../shared/contract/library.ts').LibrarySearchResponse} r @param {Book[]} books */
function showHits(out, q, r, books) {
  const title = new Map(books.map((b) => [b.id, b.title]));
  /** @type {Map<string, typeof r.items>} */
  const by = new Map();
  for (const h of r.items) by.set(h.book_id, [...(by.get(h.book_id) ?? []), h]);
  const kids = [];
  if (!r.items.length) kids.push(el('p', { class: 'note', text: `Nothing found in your books for “${q}”.` }));
  const groups = el('div', { class: 'hits' });
  for (const [bookId, hits] of by) {
    const list = el('div');
    const show = (/** @type {number} */ k) =>
      list.replaceChildren(
        ...hits.slice(0, k).map((h) => {
          const p = el('p');
          for (const part of snippetParts(h.snippet)) p.append(part.mark ? el('mark', { text: part.text }) : part.text);
          const hit = el('button', { type: 'button', class: 'hit' }, [p, el('small', { text: pageName(h.pdf_page, h.page_label) })]);
          hit.addEventListener('click', () => go(`?book=${bookId}&p=${h.pdf_page}`));
          return hit;
        }),
      );
    show(5);
    const group = el('section', { class: 'hgroup' }, [el('h2', { text: title.get(bookId) ?? 'A book' }), list]);
    if (hits.length > 5) {
      const all = el('button', { type: 'button', class: 'link', text: `Show all ${hits.length}` });
      all.addEventListener('click', () => {
        show(hits.length);
        all.remove();
      });
      group.append(all);
    }
    groups.append(group);
  }
  kids.push(groups);
  if (r.not_ready)
    kids.push(
      el('p', {
        class: 'note',
        text: r.not_ready === 1 ? "1 book is still being read and isn't searchable yet." : `${r.not_ready} books are still being read and aren't searchable yet.`,
      }),
    );
  out.replaceChildren(...kids);
}
