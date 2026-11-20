// @ts-check
// Keeps the whole look on the phone after one load (the owner, 2026-11-20: "it should get cached after
// one load"). The service worker keeps every /look/ file it serves for good (sw.js, as vendor/), but
// a typeface or a key's picture is only asked for once a page shows it; so, once per published look
// and when the phone is idle, this asks through the worker for every file the look's sheets name,
// every file of it this page loaded, and the emblems, so the next visit with no signal still shows
// the look whole. The daily pictures (pictures/) are left to be kept as each day shows its own.
// <html data-look-kept> says it is done.

const KEPT = 'th.look.kept';

/** The look's files to keep, by their published addresses; null while a sheet is not yet read.
 * @param {string} base @returns {string[] | null} */
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
  return whole ? [...urls].filter((u) => u.startsWith(base) && !u.startsWith(`${base}pictures/`)) : null;
}

/** Asks for every file once the worker controls the page. @param {string} base */
export function keep(base) {
  const sw = navigator.serviceWorker;
  if (!sw) return;
  let kept = '';
  try { kept = localStorage.getItem(KEPT) || ''; } catch {}
  if (kept === base) { document.documentElement.dataset.lookKept = ''; return; }
  const go = () => requestIdleCallback(async () => {
    const list = named(base);
    if (!list) return;
    const all = await Promise.all(list.map((u) => fetch(u).then((r) => r.ok, () => false)));
    if (all.every(Boolean)) {
      try { localStorage.setItem(KEPT, base); } catch {}
      document.documentElement.dataset.lookKept = '';
    }
  }, { timeout: 4000 });
  if (sw.controller) go();
  else sw.addEventListener('controllerchange', go, { once: true });
}
