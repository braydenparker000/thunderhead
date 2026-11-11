// @ts-check
// Photos' page (PHOTOS.md §3.1): the shelf, one day, one photo full-bleed, its editor, Recently deleted, by the
// query (nav.js). Back from Google's consent, `?drive=` says how it went in a plain line. Signed
// out, it goes to sign-in and comes back; a framed copy does nothing (SECURITY.md §4.3).
import { configured, toSignin } from '/th/client.js';
import { onSignedOut, store } from '/th/session.js';
import { el, toast } from '/th/ui.js';
import { onPlace } from './nav.js';

const main = /** @type {HTMLElement} */ (document.querySelector('#photos'));
const DRIVE = {
  connected: 'Google Drive is connected. Pull down on the shelf to import.',
  declined: 'Google Drive was not connected: the consent was declined.',
  failed: 'Google Drive did not connect. Try again from Settings › Photos.',
};
let drawn = 0;

async function render() {
  const n = ++drawn;
  const box = el('div');
  main.replaceChildren(box);
  const q = new URLSearchParams(location.search);
  const photo = q.get('photo');
  const edit = q.get('edit');
  main.querySelector('.editor')?.dispatchEvent(new Event('photos:leave'));
  const day = q.get('day');
  if (edit && /^[0-9a-f-]{36}$/.test(edit)) await (await import('./edit/editor.js')).editScreen(box, edit);
  else if (photo && /^[0-9a-f-]{36}$/.test(photo)) await (await import('./view.js')).photoScreen(box, photo);
  else if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) await (await import('./view.js')).dayScreen(box, day);
  else if (q.has('deleted')) await (await import('./view.js')).deletedScreen(box);
  else if (q.has('backup')) await (await import('./backup-screen.js')).backupScreen(box);
  else await (await import('./shelf.js')).shelfScreen(box);
  if (n !== drawn) box.remove();
}

if (window.top === window.self) {
  if (!configured) {
    main.replaceChildren(
      el('div', { class: 'shelf' }, [el('a', { class: 'back', href: '/', text: '‹ Home' }), el('p', { class: 'empty', text: 'Photos comes with sign-in.' })]),
    );
  } else if (!(await store.read())) toSignin();
  else {
    onSignedOut(() => location.replace('/signin/'));
    const q = new URLSearchParams(location.search);
    const drive = q.get('drive');
    if (drive) {
      history.replaceState(null, '', '/photos/');
      toast(DRIVE[/** @type {keyof typeof DRIVE} */ (drive)] ?? DRIVE.failed);
    }
    onPlace(render);
    // A photo changed on the shelf (an import done): the shelf draws again when it is on screen.
    document.addEventListener('photos:changed', () => {
      if (!location.search) render();
    });
    render();
  }
}
