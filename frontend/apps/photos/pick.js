// @ts-check
// Google's picker (PHOTOS.md §3.1, SECURITY.md §4.1): the one third-party script, loaded on tap
// only, in Photos only, from apis.google.com; the picker runs in a docs.google.com frame. It opens
// with the Drive token the phone already gets for uploads (scope drive.file) and the public picker
// key, in the app's folder, and lets the owner go anywhere in their Drive; each file picked becomes
// visible to this app, nothing else does. Google's own <style> is refused (style-src 'self'):
// photos.css styles its dialog to fill the phone instead.

export const API_JS = 'https://apis.google.com/js/api.js';
/** Files one pick hands over at most (shared/contract/photos.ts PHOTO_LIMITS.pick_max). */
export const PICK_MAX = 100;
const KINDS = /\.(raf|dng|jpe?g|heic)$/i;

/** @typedef {{ id: string, name: string }} Picked */

/** @type {Promise<any> | null} */
let loading = null;
/** `google.picker`, once: Google's loader script, then its picker module. */
function load() {
  loading ??= new Promise((resolve, reject) => {
    const fail = () => {
      loading = null;
      s.remove();
      reject(Object.assign(new Error('picker'), { code: 'picker' }));
    };
    const s = document.createElement('script');
    s.src = API_JS;
    s.async = true;
    s.onerror = fail;
    s.onload = () => {
      const w = /** @type {any} */ (window);
      w.gapi.load('picker', { callback: () => resolve(w.google.picker), onerror: fail, timeout: 15_000, ontimeout: fail });
    };
    document.head.append(s);
  });
  return loading;
}

/**
 * Opens the picker; resolves with what the owner picked (none when they close it).
 * @param {{ key: string, app: string, token: string, folder: string, title?: string, query?: string }} o
 * @returns {Promise<Picked[]>}
 */
export async function pickFromDrive(o) {
  const p = await load();
  return new Promise((resolve) => {
    // A query (".xmp" for the Looks panel's presets) narrows each view to the files it matches.
    const view = (/** @type {string} */ parent) => { const v = new p.DocsView(p.ViewId.DOCS).setIncludeFolders(true).setParent(parent); return o.query ? v.setQuery(o.query) : v; };
    const b = new p.PickerBuilder()
      .setDeveloperKey(o.key)
      .setOAuthToken(o.token)
      .setOrigin(location.origin)
      .enableFeature(p.Feature.MULTISELECT_ENABLED)
      .setMaxItems(PICK_MAX)
      .setTitle(o.title ?? 'Choose photos to import')
      // The app's folder first; My Drive next, to go anywhere in it.
      .addView(view(o.folder))
      .addView(view('root'))
      .setSize(Math.max(320, innerWidth - 16), Math.max(320, innerHeight - 16))
      .setCallback((/** @type {any} */ d) => {
        const act = d[p.Response.ACTION];
        if (act === p.Action.PICKED) resolve((d[p.Response.DOCUMENTS] ?? []).map((/** @type {any} */ f) => ({ id: String(f[p.Document.ID]), name: String(f[p.Document.NAME] ?? '') })));
        else if (act === p.Action.CANCEL) resolve([]);
      });
    // The Cloud project's number lets the picker grant this app the files picked (drive.file).
    if (o.app) b.setAppId(o.app);
    b.build().setVisible(true);
  });
}

/** The picked files that are photos (RAF, DNG, JPEG, HEIC), at most 100, and how many were not.
 * @param {Picked[]} docs */
export function sortPicked(docs) {
  const photos = docs.filter((d) => KINDS.test(d.name) && /^[A-Za-z0-9_-]{1,160}$/.test(d.id));
  return { files: photos.slice(0, PICK_MAX), skipped: docs.length - photos.length, over: Math.max(0, photos.length - PICK_MAX) };
}
