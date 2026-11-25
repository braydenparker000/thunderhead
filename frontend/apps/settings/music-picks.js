// @ts-check
// "Picks to add" in Settings › Music, under "What I know about your music" (MUSIC.md §19.6–19.7): the
// picks still new (GET /v1/music/picks, at most 10), each by its line with a Play button. Play asks the
// Worker for that album's 30-second preview (GET /v1/music/picks/:id/preview: the Worker fetches it from
// Apple, so the phone only ever talks to the Worker) and plays it from a blob (the shell's CSP allows
// `media-src blob:` and nothing else). One plays at a time, a second tap stops it, leaving the page
// stops it, and nothing ever plays without a tap.
import { api, signedIn } from '/th/client.js';
import { el } from '/th/ui.js';

/** @typedef {import('../../../shared/contract/know.ts').Pick} Pick */
/** @typedef {import('../../../shared/contract/know.ts').PicksResponse} PicksResponse */

const LINES = {
  loading: 'Loading the preview…',
  playing: 'Playing 30 seconds.',
  none: 'No preview for this one.',
  offline: 'You’re offline. Previews play once you’re back.',
  error: 'I couldn’t play this just now.',
};
const playLabel = (/** @type {Pick} */ p) => `Play a preview of ${p.album} by ${p.artist}`;

/** @returns {{ box: HTMLElement, stop: () => void }} */
export function picksBlock() {
  const list = el('div', { 'data-picks': '', 'aria-busy': 'true' }, [el('p', { class: 'sempty', text: 'Reading…' })]);
  const box = el('div', { id: 'music-picks' }, [el('p', { class: 'shelp', text: 'Picks to add:' }), list]);
  /** @type {{ id: string, p: Pick, btn: HTMLElement, say: HTMLElement, audio: HTMLAudioElement | null, url: string } | null} */
  let now = null;

  const stop = () => {
    const c = now;
    if (!c) return;
    now = null;
    removeEventListener('pagehide', stop);
    if (c.audio) {
      c.audio.pause();
      c.audio.removeAttribute('src');
    }
    if (c.url) URL.revokeObjectURL(c.url);
    c.btn.textContent = 'Play';
    c.btn.setAttribute('aria-label', playLabel(c.p));
    c.say.textContent = '';
  };

  /** @param {Pick} p @param {HTMLElement} btn @param {HTMLElement} say */
  const toggle = async (p, btn, say) => {
    const same = now?.id === p.id;
    stop();
    if (same) return;
    if (navigator.onLine === false) {
      say.textContent = LINES.offline;
      return;
    }
    const c = { id: p.id, p, btn, say, audio: /** @type {HTMLAudioElement | null} */ (null), url: '' };
    now = c;
    addEventListener('pagehide', stop);
    btn.textContent = 'Stop';
    btn.setAttribute('aria-label', `Stop the preview of ${p.album}`);
    say.textContent = LINES.loading;
    try {
      const blob = await signedIn((t) => api.download(`/v1/music/picks/${encodeURIComponent(p.id)}/preview`, t));
      if (now !== c) return;
      c.url = URL.createObjectURL(blob);
      c.audio = new Audio(c.url);
      c.audio.addEventListener('ended', () => now === c && stop());
      // The page left without its cleanup (a tap before it finished opening): stop with it.
      c.audio.addEventListener('timeupdate', () => now === c && !box.isConnected && stop());
      await c.audio.play();
      if (now === c) say.textContent = LINES.playing;
    } catch (e) {
      if (now !== c) return;
      stop();
      const status = /** @type {any} */ (e)?.status;
      say.textContent = status === 404 ? LINES.none : navigator.onLine === false ? LINES.offline : LINES.error;
    }
  };

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
