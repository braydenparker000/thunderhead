// @ts-check
// A pick's 30-second preview (MUSIC.md §19.7), for every place that offers one: Settings › Music's
// "Picks to add" (apps/settings/music-picks.js) and a pick in a reply (th/chat/pick.js). Play asks the
// Worker for that album's preview (GET /v1/music/picks/:id/preview: the Worker fetches it from Apple,
// so the phone only ever talks to the Worker) and plays it from a blob (the shell's CSP allows
// `media-src blob:` and nothing else). One plays at a time on the page, wherever it was asked for; a
// second tap stops it; leaving the page, or its button leaving the screen, stops it; and nothing ever
// plays without a tap.
import { api, signedIn } from '/th/client.js';

export const LINES = {
  loading: 'Loading the preview…',
  playing: 'Playing 30 seconds.',
  none: 'No preview for this one.',
  offline: 'You’re offline. Previews play once you’re back.',
  error: 'I couldn’t play this just now.',
};

/**
 * What the place that asked shows: `on` while the preview loads or plays (its button says Stop), and
 * the line under it ('' for none).
 * @typedef {(on: boolean, line: string) => void} Show
 */

/** @type {{ id: string, host: Node, show: Show, audio: HTMLAudioElement | null, url: string } | null} */
let now = null;

/** Stops the preview playing: any, or only the one asked for from `host`. @param {Node} [host] */
export function stopPreview(host) {
  const c = now;
  if (!c || (host && c.host !== host)) return;
  now = null;
  removeEventListener('pagehide', onHide);
  if (c.audio) {
    c.audio.pause();
    c.audio.removeAttribute('src');
  }
  if (c.url) URL.revokeObjectURL(c.url);
  c.show(false, '');
}
const onHide = () => stopPreview();

/** Whether the pick `id` is the one asked for from `host` (playing or loading). @param {string} id @param {Node} host */
export const previewing = (id, host) => now?.id === id && now.host === host;

/**
 * A tap on a pick's Play: plays its preview, or stops it when it is the one playing from `host`.
 * `host` is what stands on the screen for it: when it is no longer there, the preview stops.
 * @param {string} id the pick's MusicBrainz id @param {Node} host @param {Show} show
 */
export async function togglePreview(id, host, show) {
  const same = previewing(id, host);
  stopPreview();
  if (same) return;
  if (navigator.onLine === false) {
    show(false, LINES.offline);
    return;
  }
  const c = { id, host, show, audio: /** @type {HTMLAudioElement | null} */ (null), url: '' };
  now = c;
  addEventListener('pagehide', onHide);
  show(true, LINES.loading);
  try {
    const blob = await signedIn((t) => api.download(`/v1/music/picks/${encodeURIComponent(id)}/preview`, t));
    if (now !== c) return;
    c.url = URL.createObjectURL(blob);
    c.audio = new Audio(c.url);
    c.audio.addEventListener('ended', () => now === c && stopPreview());
    // Its place left the screen without its cleanup (a page closed, a reply drawn again): stop with it.
    c.audio.addEventListener('timeupdate', () => now === c && !host.isConnected && stopPreview());
    await c.audio.play();
    if (now === c) show(true, LINES.playing);
  } catch (e) {
    if (now !== c) return;
    stopPreview();
    const status = /** @type {any} */ (e)?.status;
    show(false, status === 404 ? LINES.none : navigator.onLine === false ? LINES.offline : LINES.error);
  }
}
