// @ts-check
// Study's page (STUDY.md §5.1). The storage website has no rewrites, so its places are queries on
// /study/: the library (no query), `?q=` a search, `?book=<id>&p=<pdf_page>` the reader. The page
// number is the only position in the address; a signed link never is. Each place is a history
// entry, so Android's back closes a sheet, then the reader, then Study (GESTURES.md). Signed out,
// it goes to sign-in and comes back; a framed copy does nothing (SECURITY.md §4.3).
import { configured, toSignin } from '/th/client.js';
import { onSignedOut, store } from '/th/session.js';
import { el } from '/th/ui.js';
import { onPlace } from './nav.js';

const main = /** @type {HTMLElement} */ (document.querySelector('#study'));
/** @type {(() => void) | null} what the place on screen must do as it goes (the reader saves its page) */
let leave = null;

async function render() {
  leave?.();
  leave = null;
  const q = new URLSearchParams(location.search);
  const bookId = q.get('book');
  if (bookId) {
    const p = Number(q.get('p')) || 0;
    leave = await (await import('./reader.js')).openReader(main, bookId, p > 0 ? p : null, Number(q.get('b')) || null);
  } else if (q.has('q')) (await import('./library.js')).searchScreen(main, q.get('q') ?? '', q.get('in'));
  else (await import('./library.js')).libraryScreen(main);
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
  }
}
