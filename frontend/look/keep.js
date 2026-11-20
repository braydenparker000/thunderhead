// @ts-check
// Keeps the whole look on the phone after one load (the owner, 2026-11-20: "it should get cached after
// one load"). The service worker keeps every /look/ file it serves for good (sw.js, as vendor/), but a
// typeface, a key's picture or a day's picture is only asked for once a page shows it. So, through the
// worker, in idle time:
//   1. every file the look's sheets name, every file of it this page loaded, and the emblems; then
//      <html data-look-kept>;
//   2. every daily picture plates.json names (both sets), one at a time, never while the page is
//      hidden and not at all while the phone saves data;
//   3. th-vendor cleared of every older published folder (/look/<other hash>/) and every picture the
//      list no longer names; then <html data-look-plates-kept>.
// Each is done once per published folder (its name changes with plates.json, which lives in it).

const KEPT = 'th.look.kept', PLATES = 'th.look.plates', CACHE = 'th-vendor', PICTURES = '/look/pictures/';
const root = document.documentElement;

/** The look's own files to keep; null while a sheet is not yet read. @param {string} base @returns {string[] | null} */
function named(base) {
  // the sheets and scripts this page loaded from the look, and the emblems
  const urls = new Set([`${base}look.css`, `${base}look.js`, `${base}emblems.svg`]);
  for (const e of performance.getEntriesByType('resource')) urls.add(new URL(e.name).pathname);
  let whole = false;
  /** @param {CSSStyleSheet} sheet */
  const walk = (sheet) => {
    for (const rule of sheet.cssRules) {
      if (rule instanceof CSSImportRule) {
        if (!rule.styleSheet) throw new Error('not yet');
        walk(rule.styleSheet);
      }
      for (const [, u] of rule.cssText.matchAll(/url\("?([^")]+)"?\)/g)) urls.add(new URL(u, sheet.href || location.href).pathname);
    }
  };
  try {
    for (const sheet of document.styleSheets) if (sheet.href && new URL(sheet.href).pathname === `${base}look.css`) { walk(sheet); whole = true; }
  } catch { return null; }
  return whole ? [...urls].filter((u) => u.startsWith(base)) : null;
}

/** Every picture plates.json names, by its published address ([] when there is no list). Any string
 * in it that ends in a picture's name counts, as `ink/01-name.1a2b3c4d.webp` or `/look/pictures/…`.
 * @param {string} base */
async function plates(base) {
  const res = await fetch(`${base}plates.json`).catch(() => null);
  if (!res?.ok) return [];
  const out = new Set();
  /** @param {unknown} v */
  const walk = (v) => {
    if (typeof v === 'string' && /\.(webp|avif|jpg|png)$/.test(v)) out.add(PICTURES + v.replace(/^\/?(look\/)?(pictures\/)?/, ''));
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  walk(await res.json().catch(() => null));
  return [...out];
}

const idle = () => new Promise((r) => requestIdleCallback(r, { timeout: 4000 }));
const shown = () => new Promise((r) => {
  if (!document.hidden) return r(undefined);
  document.addEventListener('visibilitychange', function wait() {
    if (document.hidden) return;
    document.removeEventListener('visibilitychange', wait);
    r(undefined);
  });
});
/** @param {string} key */
const read = (key) => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
/** @param {string} key @param {string} v */
const write = (key, v) => { try { localStorage.setItem(key, v); } catch {} };

/** Clears th-vendor of older folders and of pictures the list no longer names. @param {string} base @param {string[]} list */
async function prune(base, list) {
  const cache = await caches.open(CACHE), named = new Set(list);
  for (const req of await cache.keys()) {
    const p = new URL(req.url).pathname;
    if ((/^\/look\/[0-9a-f]{10}\//.test(p) && !p.startsWith(base)) || (p.startsWith(PICTURES) && !named.has(p))) await cache.delete(req);
  }
}

/** @param {string} base */
async function run(base) {
  if (read(KEPT) !== base) {
    await idle();
    const list = named(base);
    if (!list) return;
    const all = await Promise.all(list.map((u) => fetch(u).then((r) => r.ok, () => false)));
    if (!all.every(Boolean)) return;
    write(KEPT, base);
  }
  root.dataset.lookKept = '';
  if (read(PLATES) === base) { root.dataset.lookPlatesKept = ''; return; }
  const pictures = await plates(base);
  // @ts-ignore (navigator.connection: Chromium's Network Information)
  const saving = Boolean(navigator.connection?.saveData);
  if (!saving)
    for (const u of pictures) {
      await shown();
      await idle();
      if (!(await fetch(u).then((r) => r.ok, () => false))) return;
    }
  await prune(base, pictures);
  if (saving) return;
  write(PLATES, base);
  root.dataset.lookPlatesKept = '';
}

/** Keeps the look once the worker controls the page. @param {string} base */
export function keep(base) {
  const sw = navigator.serviceWorker;
  if (!sw || !('caches' in window)) return;
  const go = () => { run(base).catch(() => {}); };
  if (sw.controller) go();
  else sw.addEventListener('controllerchange', go, { once: true });
}
