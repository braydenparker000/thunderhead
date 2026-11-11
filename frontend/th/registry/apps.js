// @ts-check
// The app registry (EXTENDING.md rule 3): every app the shell can open, from the contract's APPS
// (folder, name, phase) plus how the shell draws it (colour and icon, AGENTS.md design
// essentials). The ring, reply chips and deep links all derive from it, so a new app is one entry
// in the contract and one here.
import { APPS, BUILT_PHASES } from '../contract.js';

/** @typedef {import('../contract.js').AppId} AppId */
/** @typedef {{ id: AppId, name: string, path: string, phase: string, color: string, icon: string, built: boolean }} AppEntry */

/** @type {Record<AppId, { color: string, icon: string }>} */
const LOOK = {
  music: { color: '#2f7df6', icon: 'music-notes-simple' },
  guitar: { color: '#e08a1e', icon: 'guitar' },
  podcasts: { color: '#e0457b', icon: 'microphone' },
  astra: { color: '#8b5cf6', icon: 'monitor-play' },
  media: { color: '#14a39a', icon: 'youtube-logo' },
  study: { color: '#2e9e5b', icon: 'book-bookmark' },
  // Cyan, between Study's green and Music's blue round the ring; white on it is 3.68:1 (owner, 2026-10-31).
  photos: { color: '#0891b2', icon: 'aperture' },
};

/** The ring, clockwise from the top. @type {readonly AppId[]} */
export const RING = Object.freeze(['music', 'guitar', 'podcasts', 'astra', 'media', 'study', 'photos']);

/** The ring as the owner arranged it (Settings → Ring and gestures, `gestures.ring_apps`): their apps
 * in their order, then Photos in the seventh place, kept for it; a list the catalogue would refuse
 * (an unknown app, one twice, Photos) is the default, as Settings shows it. @param {unknown} order */
export function ringApps(order) {
  const ok = Array.isArray(order) && order.every((id, i) => id !== 'photos' && order.indexOf(id) === i && appFor(String(id)));
  return [...(ok ? order : RING.slice(0, 6)), 'photos'].map((id) => /** @type {AppEntry} */ (appFor(id)));
}

/** @type {readonly AppEntry[]} */
export const apps = Object.freeze(
  RING.map((id) => {
    /** @type {{ path: string, name: string, phase: string, deferred?: string }} */
    const app = APPS[id];
    return { id, ...app, ...LOOK[id], built: BUILT_PHASES.includes(/** @type {any} */ (app.phase)) && !app.deferred };
  }),
);

/** @param {string} id @returns {AppEntry | null} */
export const appFor = (id) => apps.find((a) => a.id === id) ?? null;

/** Where the new editor lives (docs/design/EDITOR.md): Photos, since the owner's word of 2026-11-11. */
export const EDITOR_PATH = '/lab/editor/';
/** Where opening a place really lands. Photos' front page is the new editor's Library: the ring, a
 * chip, a tile and the mind's `app.open` all go there. The shelf before is kept at `/photos/` for a
 * link into it (`?photo=`, `?edit=`, `?day=`) and comes back as Photos' front page while Settings →
 * Photos → Editor is Classic. Every other place lands where it says. @param {string} path */
export function landing(path) {
  if (path !== '/photos/') return path;
  try {
    if (localStorage.getItem('th.s.photos.editor') === 'classic') return path;
  } catch {}
  return EDITOR_PATH;
}

const PATH = /^\/[A-Za-z0-9._~!$&'()*+,;=:@/?#%-]*$/;

/** A place the shell may open: a shipped app's folder or a path inside it, resolved the way the
 * browser will resolve it (so "/music/%2e%2e/" is outside Music), else null. The Worker checks a
 * chip the same way (conversation/ops.ts chipPath). @param {string} id @param {string} path */
export function deepLink(id, path) {
  const a = appFor(id);
  if (!a?.built || typeof path !== 'string' || !PATH.test(path) || path.includes('..') || /%2f|%5c/i.test(path)) return null;
  let u;
  try {
    u = new URL(path, 'file:///'); // a base with no host: "//host/…" gets one and is refused
  } catch {
    return null;
  }
  return u.host === '' && u.pathname.startsWith(a.path) ? `${u.pathname}${u.search}${u.hash}` : null;
}
