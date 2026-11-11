// @ts-check
// The editor's backup, run on Photos' page (`/photos/?backup`): this is the one page that may reach the owner's
// Drive (SECURITY.md §4.1) and the editor's own page reaches nothing outside the site, so its Library's "Back up
// to Drive" comes here. The photos kept by the editor on this phone are read (lab/editor/app/store.js), the
// originals not yet in Drive go through Photos' own import and each changed edit goes as one small file
// (lab/editor/app/backup.js); it says how it went and goes back to the editor.
import { el } from '/th/ui.js';

const EDITOR = '/lab/editor/';

/** @param {HTMLElement} box */
export async function backupScreen(box) {
  const line = el('p', { class: 'empty', text: 'Backing up to your Drive…' });
  box.append(el('div', { class: 'shelf' }, [el('a', { class: 'back', href: EDITOR, text: '‹ Back to the editor' }), line]));
  const say = (/** @type {string} */ t) => { line.textContent = t; };
  try {
    const [store, backup] = await Promise.all([import('../../lab/editor/app/store.js'), import('../../lab/editor/app/backup.js')]);
    await store.init();
    const r = await backup.run(say);
    say(backup.said(r));
    // all of it went: back to where the owner was; anything that did not stays on screen to be read
    if (!r.failed && !r.why) setTimeout(() => location.replace(EDITOR), 1500);
  } catch (e) {
    say(navigator.onLine === false ? 'Offline. Try again when you are back online.' : `The backup did not run (${/** @type {any} */ (e)?.message || e}).`);
  }
}
