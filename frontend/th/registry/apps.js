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
