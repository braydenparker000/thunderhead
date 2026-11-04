// @ts-check
// Study's page (STUDY.md §5.1). The storage website has no rewrites, so its places are queries on
// /study/: the library (no query), `?q=` a search, `?book=<id>&p=<pdf_page>` the reader, `?verse=`
// a verse (`<code>/<ch>[/<v>[-<v>]]`). The page
// number is the only position in the address. Each place is a history
// entry, so Android's back closes a sheet, then the reader, then Study (GESTURES.md). Signed out,
// it goes to sign-in and comes back; a framed copy does nothing (SECURITY.md §4.3).
import { configured, toSignin } from '/th/client.js';
import { onSignedOut, store } from '/th/session.js';
import { el } from '/th/ui.js';
import { go, onPlace } from './nav.js';

const main = /** @type {HTMLElement} */ (document.querySelector('#study'));
/** @type {(() => void) | null} what the place on screen must do as it goes (the reader saves its page) */
let leave = null;
let drawn = 0;

// Each place draws into its own box, so one still loading when the owner has moved on (a module,
// a book) draws into a box no longer on screen; a reader that opens late is closed at once.
async function render() {
  leave?.();
  leave = null;
  const n = ++drawn;
  const box = el('div');
  main.replaceChildren(box);
  const q = new URLSearchParams(location.search);
  const bookId = q.get('book');
  if (bookId) {
    const p = Number(q.get('p')) || 0;
    const done = await (await import('./reader.js')).openReader(box, bookId, p > 0 ? p : null, Number(q.get('b')) || null);
    if (n === drawn) leave = done;
    else done();
  } else if (q.has('verse')) (await import('./verse.js')).verseScreen(box, q.get('verse') ?? '');
  else if (q.has('q')) (await import('./library.js')).searchScreen(box, q.get('q') ?? '', q.get('in'));
  else {
    // The library draws its heading at once, then its books: the card goes under the heading.
    const shown = (await import('./library.js')).libraryScreen(box);
    nextCard(box);
    await shown;
  }
}

// The mind's "where you left off, and what next" (`study/next`, study.mark_next): one card under
// the library's heading, its why behind a tap and Dismiss; Open goes to its page
// (th/ported/arrangement.js sends the senses).
/** @param {HTMLElement} box */
function nextCard(box) {
  import('/th/ported/arrangement.js')
    .then((m) =>
      m.mount(
        'study',
        'next',
        (a) => ({
          label: 'Where you left off',
          title: String(a.payload.next),
          detail: `Left off: ${a.payload.left_off}`,
          action: 'Open',
          go: () => go(`?book=${encodeURIComponent(String(a.payload.book).replace(/^book:/, ''))}${a.payload.page ? `&p=${a.payload.page}` : ''}`),
        }),
        (card) => box.querySelector('.libhead')?.after(card),
      ),
    )
    .catch(() => {});
}

if (window.top === window.self) {
  if (!configured) {
    main.replaceChildren(
      el('div', { class: 'lib' }, [
        el('a', { class: 'back', href: '/', text: '‹ Home' }),
        el('div', { class: 'empty' }, [el('p', { text: 'Study comes with sign-in.' })]),
      ]),
    );
  } else if (!(await store.read())) toSignin();
  else {
    onSignedOut(() => location.replace('/signin/'));
    onPlace(render);
    render();
    // What the owner uses (P9): Study opening is one sense event.
    import('/th/senses/send.js').then((m) => m.sense('study.open')).catch(() => {});
  }
}
