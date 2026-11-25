// @ts-check
// "Picks to add" in Settings › Music, under "What I know about your music" (MUSIC.md §19.6–19.7): the
// picks still new (GET /v1/music/picks, at most 10), each by its line with a Play button. Play plays
// that album's 30-second preview (th/music/preview.js, shared with a pick in a reply: one plays at a
// time, a second tap stops it, leaving the page stops it, and nothing ever plays without a tap).
import { api, signedIn } from '/th/client.js';
import { stopPreview, togglePreview } from '/th/music/preview.js';
import { el } from '/th/ui.js';

/** @typedef {import('../../../shared/contract/know.ts').Pick} Pick */
/** @typedef {import('../../../shared/contract/know.ts').PicksResponse} PicksResponse */

const playLabel = (/** @type {Pick} */ p) => `Play a preview of ${p.album} by ${p.artist}`;

/** @returns {{ box: HTMLElement, stop: () => void }} */
export function picksBlock() {
  const list = el('div', { 'data-picks': '', 'aria-busy': 'true' }, [el('p', { class: 'sempty', text: 'Reading…' })]);
  const box = el('div', { id: 'music-picks' }, [el('p', { class: 'shelp', text: 'Picks to add:' }), list]);
  // Only a preview this page started: one started in a reply plays on.
  const stop = () => stopPreview(box);

  /** @param {Pick} p @param {HTMLElement} btn @param {HTMLElement} say */
  const toggle = (p, btn, say) =>
    togglePreview(p.id, box, (on, line) => {
      btn.textContent = on ? 'Stop' : 'Play';
      btn.setAttribute('aria-label', on ? `Stop the preview of ${p.album}` : playLabel(p));
      say.textContent = line;
    });

  /** @param {Pick} p */
  const row = (p) => {
    const say = el('div', { class: 'st2', 'aria-live': 'polite' });
    const btn = el('button', { type: 'button', class: 'btn quiet inline sbtn', 'aria-label': playLabel(p), text: 'Play' });
    btn.addEventListener('click', () => toggle(p, btn, say));
    return el('div', { class: 'row srow', 'data-pick': p.id }, [
      el('div', { class: 'row-copy stext' }, [el('div', { class: 'st1', text: p.line }), say]),
      btn,
    ]);
  };

  const load = async () => {
    stop();
    if (navigator.onLine === false) {
      list.replaceChildren(el('p', { class: 'sempty', text: 'You’re offline. This shows once you’re back.' }));
      list.removeAttribute('aria-busy');
      return;
    }
    try {
      /** @type {PicksResponse} */
      const r = await signedIn((t) => api.call('/v1/music/picks?state=new&limit=10', { token: t }));
      const items = r.items.slice(0, 10);
      list.replaceChildren(...(items.length ? items.map(row) : [el('p', { class: 'sempty', text: 'No picks yet.' })]));
    } catch {
      list.replaceChildren(el('p', { class: 'sempty', text: 'I couldn’t read this just now.' }));
    }
    list.removeAttribute('aria-busy');
  };
  window.addEventListener('online', load, { once: true });
  load();
  return { box, stop };
}
