// @ts-check
// The reader (STUDY.md §5): the book's pages in one continuous column, read from this phone's copy
// (downloaded through the Worker the first time, with its progress; copies.js). At most five pages are
// drawn at once (the one in view and two either side), each at the screen's pixel ratio (at most
// 2) with its text layer, so selection and screen readers work. The top bar and the page pill hide
// after 3 s without a touch and come back on a tap; the pill opens "Go to page". The place is
// saved on this phone 2 s after the page settles, and to the Worker at most every 30 s and as the
// page goes away; another device's newer place is used when it is newer by more than a minute.
// Night shows pages inverted and warm, unless the book is set to its original colours.
import { lineFor } from '/th/copy.js';
import { failure } from '/th/flow.js';
import { el, toast } from '/th/ui.js';
import * as data from './data.js';
import { back, go } from './nav.js';
import * as copies from './copies.js';
import { fromBlob, OPTIONS, pdfjs } from './pdf.js';
import { goTo, pageDetail, pageName } from './words.js';

/** @typedef {import('../../../shared/contract/library.ts').Book} Book */

const ALIVE = 2;
const LOCAL_MS = 2_000;
const SERVER_MS = 30_000;
const HIDE_MS = 3_000;
const WAKE_IDLE_MS = 10 * 60_000;

/**
 * @param {HTMLElement} main @param {string} bookId @param {number | null} askedPage @param {number | null} block
 * @returns {Promise<() => void>} what to do as the reader goes
 */
export async function openReader(main, bookId, askedPage, block) {
  const pages = el('div', { class: 'pages' });
  const reader = el('div', { class: 'reader' }, [pages]);
  const title = el('h1', { text: '' });
  const backBtn = iconButton('arrow-left', 'Back to Study');
  const findBtn = iconButton('magnifying-glass', 'Search in this book');
  const menuBtn = iconButton('dots-three', 'Book menu');
  const top = el('header', { class: 'rtop' }, [backBtn, title, findBtn, menuBtn]);
  const pill = el('button', { type: 'button', class: 'pill', 'aria-label': 'Go to page', text: '…' });
  main.replaceChildren(reader, top, pill);
  backBtn.addEventListener('click', back);

  /** @type {Book} */
  let book;
  try {
    book = await data.book(bookId);
  } catch (e) {
    // Offline, a kept book still opens, from what this phone knows of it.
    /** @type {Book[]} */
    const known = (await data.local.get('books').catch(() => null)) ?? [];
    const had = known.find((b) => b.id === bookId);
    if (!had || !(await copies.kept(had))) {
      toast(lineFor(failure(e)));
      go('', { replace: true });
      return () => {};
    }
    book = had;
  }
  title.textContent = book.title;
  document.title = `${book.title} · Study`;
  findBtn.addEventListener('click', () => go(`?q=&in=${bookId}`));
  const orig = () => {
    try {
      return localStorage.getItem(`th.p.study.orig.${bookId}`) === '1';
    } catch {
      return false;
    }
  };
  reader.classList.toggle('orig', orig());

  // --- the bytes ----------------------------------------------------------------------------
  const lib = await pdfjs();
  /** @type {HTMLElement | null} */
  let errBox = null;
  const showError = (/** @type {string} */ text, /** @type {(() => void) | null} */ again) => {
    errBox?.remove();
    errBox = el('div', { class: 'rerr', role: 'status' }, [el('p', { text })]);
    if (again) {
      const b = el('button', { type: 'button', class: 'btn soft', text: 'Try again' });
      b.addEventListener('click', () => {
        errBox?.remove();
        errBox = null;
        again();
      });
      errBox.append(b);
    }
    pages.append(errBox);
  };
  /** @type {Blob | null} */
  let file = await copies.kept(book);
  if (!file) {
    const line = el('p', { text: 'Getting your book…' });
    const status = el('div', { class: 'rerr', role: 'status' }, [line]);
    pages.append(status);
    try {
      file = await copies.keep(book, (f) => {
        line.textContent = `Getting your book… ${Math.floor(f * 100)}%`;
      });
    } catch (e) {
      status.remove();
      const why = /** @type {any} */ (e)?.why;
      if (why === 'space') showError("Not enough space on this phone (it needs twice the book's size).", null);
      else if (why === 'gone') showError("This book isn't in your library any more.", null);
      else showError("Can't reach your library. Books you've opened before are kept on this phone.", () => go(`?book=${bookId}`, { replace: true }));
      return () => {};
    }
    status.remove();
  }
  const task = lib.getDocument({ ...OPTIONS, range: fromBlob(lib, file) });
  /** @type {any} */
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    const pw = /** @type {any} */ (e)?.name === 'PasswordException';
    showError(pw ? 'This PDF is password-protected.' : "This file isn't a readable PDF.", null);
    return () => task.destroy();
  }
  const total = doc.numPages;
  /** @type {(string | null)[]} */
  const labels = ((await doc.getPageLabels().catch(() => null)) ?? []).slice(0, total);
  while (labels.length < total) labels.push(null);
  if (labels.every((l, i) => l === String(i + 1))) labels.fill(null);
  data.local.set(`labels:${bookId}`, labels).catch(() => {});

  // --- the column of pages ------------------------------------------------------------------
  const first = await doc.getPage(1);
  const base = first.getViewport({ scale: 1 });
  const ratio = base.height / base.width;
  /** @type {HTMLElement[]} */
  const pgs = [];
  for (let n = 1; n <= total; n++) {
    const pg = el('div', { class: 'pg', 'data-n': String(n), role: 'img', 'aria-label': pageName(n, labels[n - 1]) });
    pg.style.aspectRatio = `1 / ${ratio}`;
    pgs.push(pg);
  }
  pages.replaceChildren(...pgs);
  const widthOf = () => Math.min(pages.clientWidth - (innerWidth >= 700 ? 32 : 0), 860);
  const size = () => {
    const w = widthOf();
    for (const pg of pgs) pg.style.width = `${w}px`;
  };
  size();

  /** @type {Map<number, { task: any, canvas: HTMLCanvasElement, text: HTMLElement }>} */
  const drawn = new Map();
  /** @param {number} n */
  async function draw(n) {
    if (drawn.has(n)) return;
    const pg = pgs[n - 1];
    const canvas = el('canvas');
    const text = el('div', { class: 'textLayer' });
    const slot = { task: null, canvas, text };
    drawn.set(n, slot);
    try {
      const page = await doc.getPage(n);
      const own = page.getViewport({ scale: 1 });
      if (Math.abs(own.height / own.width - ratio) > 0.01) pg.style.aspectRatio = `1 / ${own.height / own.width}`;
      const scale = pg.clientWidth / own.width;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale });
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      pg.style.setProperty('--total-scale-factor', String(scale));
      pg.style.setProperty('--scale-round-x', '1px');
      pg.style.setProperty('--scale-round-y', '1px');
      pg.replaceChildren(canvas, text);
      const rendering = page.render({ canvas, viewport: page.getViewport({ scale: scale * dpr }) });
      slot.task = rendering;
      await rendering.promise;
      if (drawn.get(n) !== slot) return;
      await new lib.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport }).render();
    } catch {
      // A page cancelled as it scrolled away, or a range that failed (its error is shown).
    }
  }
  /** @param {number} n */
  function release(n) {
    const slot = drawn.get(n);
    if (!slot) return;
    slot.task?.cancel?.();
    slot.canvas.width = 0;
    slot.canvas.height = 0;
    pgs[n - 1].replaceChildren();
    drawn.delete(n);
  }

  // --- where the owner is -------------------------------------------------------------------
  let current = 1;
  const pageAt = () => {
    const mid = reader.scrollTop + reader.clientHeight / 2;
    let lo = 0;
    let hi = pgs.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (pgs[m].offsetTop <= mid) lo = m;
      else hi = m - 1;
    }
    return lo + 1;
  };
  const fracOf = (/** @type {number} */ n) => {
    const pg = pgs[n - 1];
    return Math.min(1, Math.max(0, (reader.scrollTop - pg.offsetTop + 64) / pg.offsetHeight));
  };
  const keep = () => {
    for (const n of [...drawn.keys()]) if (Math.abs(n - current) > ALIVE) release(n);
    for (let n = Math.max(1, current - ALIVE); n <= Math.min(total, current + ALIVE); n++) draw(n);
  };
  const showPage = () => {
    pill.textContent = pageName(current, labels[current - 1]);
  };

  let sentAt = 0;
  let sentPage = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let settle;
  const place = () => ({ pdf_page: current, scroll_frac: Math.round(fracOf(current) * 1000) / 1000, at: Date.now() });
  const saveServer = (/** @type {boolean} */ keepalive) => {
    if (current === sentPage && !keepalive) return;
    sentAt = Date.now();
    sentPage = current;
    data.putPosition(bookId, place(), keepalive).catch(() => {});
  };
  const onMove = () => {
    const n = pageAt();
    if (n !== current) {
      current = n;
      showPage();
      keep();
    }
    clearTimeout(settle);
    settle = setTimeout(() => {
      data.saveLocalPlace(bookId, place()).catch(() => {});
      if (Date.now() - sentAt >= SERVER_MS) saveServer(false);
    }, LOCAL_MS);
  };
  let ticking = false;
  reader.addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        onMove();
      });
    },
    { passive: true },
  );

  // Where to start: the page asked for, else the newer of this phone's place and the Worker's.
  const mine = await data.localPlace(bookId).catch(() => undefined);
  let start = { pdf_page: 1, scroll_frac: 0 };
  if (askedPage) start = { pdf_page: Math.min(total, askedPage), scroll_frac: 0 };
  else if (book.position && (!mine || book.position.at - mine.at > 60_000)) {
    start = book.position;
    if (mine) toast(`Picked up where you left off on another device, ${pageName(book.position.pdf_page, labels[book.position.pdf_page - 1])}.`);
  } else if (mine) start = mine;
  const jump = (/** @type {number} */ n, frac = 0) => {
    const pg = pgs[Math.min(total, Math.max(1, n)) - 1];
    reader.scrollTop = pg.offsetTop - 64 + frac * pg.offsetHeight;
    onMove();
  };
  current = Math.min(total, Math.max(1, start.pdf_page));
  showPage();
  jump(current, start.scroll_frac);
  keep();
  if (askedPage && block) {
    // A citation's block (STUDY.md §5.2): a soft wash over the page that fades (step 5 places it
    // on the block itself from the page's text).
    pgs[current - 1].classList.add('wash');
    pgs[current - 1].style.setProperty('--wash-h', '100%');
  }

  // --- bars, wake lock, sheets --------------------------------------------------------------
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let hideTimer;
  const bars = (/** @type {boolean} */ on) => {
    top.classList.toggle('away', !on);
    pill.classList.toggle('away', !on);
    clearTimeout(hideTimer);
    if (on) hideTimer = setTimeout(() => bars(false), HIDE_MS);
  };
  bars(true);
  reader.addEventListener('click', (e) => {
    if (!(/** @type {HTMLElement} */ (e.target).closest('.rerr'))) bars(top.classList.contains('away'));
  });

  /** @type {any} */
  let wake = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let idle;
  const touch = async () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      wake?.release?.().catch(() => {});
      wake = null;
    }, WAKE_IDLE_MS);
    if (!wake && document.visibilityState === 'visible')
      wake = await /** @type {any} */ (navigator).wakeLock?.request('screen').catch(() => null);
  };
  touch();
  for (const t of ['pointerdown', 'scroll']) reader.addEventListener(t, touch, { passive: true });

  const onHide = () => {
    if (document.visibilityState === 'hidden') {
      data.saveLocalPlace(bookId, place()).catch(() => {});
      saveServer(true);
    } else touch();
  };
  document.addEventListener('visibilitychange', onHide);
  addEventListener('resize', size);

  pill.addEventListener('click', () => goToSheet(labels, total, (n) => jump(n)));
  menuBtn.addEventListener('click', () =>
    bookMenu(book, current, labels, total, {
      goTo: () => goToSheet(labels, total, (n) => jump(n)),
      colours: () => {
        const on = !reader.classList.contains('orig');
        reader.classList.toggle('orig', on);
        try {
          if (on) localStorage.setItem(`th.p.study.orig.${bookId}`, '1');
          else localStorage.removeItem(`th.p.study.orig.${bookId}`);
        } catch {}
      },
      renamed: (b) => {
        book = b;
        title.textContent = b.title;
      },
      removed: async () => {
        await copies.remove(bookId);
        toast('Removed from this phone. It opens again from your library.');
        back();
      },
    }),
  );

  return () => {
    clearTimeout(settle);
    clearTimeout(hideTimer);
    clearTimeout(idle);
    data.saveLocalPlace(bookId, place()).catch(() => {});
    saveServer(false);
    document.removeEventListener('visibilitychange', onHide);
    removeEventListener('resize', size);
    wake?.release?.().catch(() => {});
    task.destroy();
    document.title = 'Study';
  };
}

/** @param {string} name @param {string} label */
function iconButton(name, label) {
  const b = el('button', { type: 'button', class: 'ib', 'aria-label': label });
  b.innerHTML = `<svg class="i" aria-hidden="true"><use href="/ui/icons.svg#${name}"/></svg>`;
  return b;
}

/** A bottom sheet with a body and its own buttons; resolves when closed. @param {string} titleText
 * @param {(sheet: HTMLElement, close: () => void) => void} fill */
function sheet(titleText, fill) {
  const before = /** @type {HTMLElement | null} */ (document.activeElement);
  const dim = el('div', { class: 'cdim' });
  const box = el('div', { class: 'csheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': titleText }, [el('h2', { text: titleText })]);
  document.body.append(dim, box);
  requestAnimationFrame(() => {
    dim.classList.add('on');
    box.classList.add('on');
  });
  history.pushState({ sheet: true }, '', location.href);
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    removeEventListener('popstate', onPop);
    dim.remove();
    box.remove();
    before?.focus?.({ preventScroll: true });
    if (history.state?.sheet) history.back();
  };
  const onPop = () => {
    if (!open) return;
    open = false;
    dim.remove();
    box.remove();
  };
  // Android's back closes the sheet, not the reader.
  addEventListener('popstate', onPop, { once: true });
  dim.addEventListener('click', close);
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  fill(box, close);
}

/** "Go to page": a printed number ("212", "xiv") or "pdf 230".
 * @param {(string | null)[]} labels @param {number} total @param {(n: number) => void} to */
function goToSheet(labels, total, to) {
  sheet('Go to page', (box, close) => {
    const input = el('input', { id: 'goto', inputmode: 'text', autocomplete: 'off', enterkeyhint: 'go', placeholder: labels.some(Boolean) ? 'A page number, or “pdf 230”' : `1 to ${total}` });
    const more = el('p', { class: 'more' });
    const form = el('form', {}, [el('div', { class: 'fld' }, [input]), more, el('button', { type: 'submit', class: 'btn', text: 'Go' })]);
    box.append(form);
    input.focus({ preventScroll: true });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const hits = goTo(input.value, labels);
      if (!hits.length) {
        more.textContent = `No page “${input.value.trim()}” in this book.`;
        return;
      }
      close();
      to(hits[0]);
      if (hits.length > 1) toast(`Also printed as ${input.value.trim()}: ${hits.slice(1).map((n) => `PDF p. ${n}`).join(', ')}.`);
    });
  });
}

/**
 * @param {Book} book @param {number} current @param {(string | null)[]} labels @param {number} total
 * @param {{ goTo: () => void, colours: () => void, renamed: (b: Book) => void, removed: () => void }} on
 */
function bookMenu(book, current, labels, total, on) {
  const dim = el('div', { class: 'mdim' });
  const menu = el('div', { class: 'menu', role: 'menu' });
  const item = (/** @type {string} */ text, /** @type {() => void} */ fn, /** @type {string} */ note = '') => {
    const b = el('button', { type: 'button', role: 'menuitem' }, [text]);
    if (note) b.append(el('small', { text: note }));
    b.addEventListener('click', () => {
      done();
      fn();
    });
    menu.append(b);
  };
  const done = () => {
    dim.remove();
    menu.remove();
  };
  dim.addEventListener('click', done);
  item('Go to page', on.goTo);
  if (document.documentElement.dataset.theme === 'dark')
    item('Original page colours', on.colours, document.querySelector('.reader.orig') ? 'On' : 'Off');
  item('Edit title and author', () => editSheet(book, on.renamed));
  item('Remove from this phone', on.removed, 'Stays in your library');
  item('Details', () =>
    sheet('Details', (box, close) => {
      const facts = el('dl', { class: 'facts' });
      const row = (/** @type {string} */ k, /** @type {string} */ v) => facts.append(el('dt', { text: k }), el('dd', { text: v }));
      row('Title', book.title);
      if (book.author) row('Author', book.author);
      row('Here', pageDetail(current, labels[current - 1], total));
      row('Size', `${(book.bytes / 1024 / 1024).toFixed(1)} MB`);
      row('Added', new Date(book.added_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }));
      row('Search', book.state === 'ready' ? 'Searchable' : 'Not yet: it is still being read');
      const ok = el('button', { type: 'button', class: 'btn soft', text: 'Close' });
      ok.addEventListener('click', close);
      box.append(facts, ok);
    }),
  );
  document.body.append(dim, menu);
}

/** @param {Book} book @param {(b: Book) => void} renamed */
function editSheet(book, renamed) {
  sheet('Edit title and author', (box, close) => {
    const t = el('input', { id: 'bt', value: book.title, maxlength: '300', autocomplete: 'off' });
    const a = el('input', { id: 'ba', value: book.author ?? '', maxlength: '200', autocomplete: 'off' });
    const line = el('p', { class: 'line', role: 'status' });
    const save = el('button', { type: 'submit', class: 'btn', text: 'Save' });
    const form = el('form', {}, [
      el('div', { class: 'fld' }, [el('label', { for: 'bt', text: 'Title' }), t]),
      el('div', { class: 'fld' }, [el('label', { for: 'ba', text: 'Author' }), a]),
      line,
      save,
    ]);
    box.append(form);
    t.focus({ preventScroll: true });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!t.value.trim()) {
        line.textContent = 'A book needs a title.';
        return;
      }
      save.disabled = true;
      try {
        renamed(await data.edit(book.id, { title: t.value.trim(), author: a.value.trim() || null }));
        close();
      } catch (err) {
        line.textContent = lineFor(failure(err));
        save.disabled = false;
      }
    });
  });
}
