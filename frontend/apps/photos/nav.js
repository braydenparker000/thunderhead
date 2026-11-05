// @ts-check
// Photos' places (the storage website has no rewrites, so they are queries on /photos/): the shelf
// (no query), `?day=` one day, `?photo=` the full view, `?edit=` its editor, `?deleted=1` Recently deleted. Each is a
// history entry, so Android's back closes the sheet, then the view, then Photos (GESTURES.md). The editor is
// cross-origin isolated and the other places are not (sw.js: the picker's frame cannot load isolated), so going
// between them is a new document; an editor opened before the service worker took control reloads once when it does.

/** @type {() => void} */
let render = () => {};
let here = location.search;
const FROM = 'th.photos.from';
const editor = (/** @type {string} */ q) => new URLSearchParams(q).has('edit');
if (sessionStorage.getItem(FROM) !== null) {
  sessionStorage.removeItem(FROM);
  history.replaceState({ photos: true }, '', location.href); // so back() steps back to the place it came from
}
if (editor(location.search) && !globalThis.crossOriginIsolated && navigator.serviceWorker && !sessionStorage.getItem(`${FROM}.reloaded`)) {
  navigator.serviceWorker.getRegistration().then((reg) => {
    if (!reg) return; // no worker on this phone yet: the engine runs on one thread
    const reload = () => { sessionStorage.setItem(`${FROM}.reloaded`, '1'); location.reload(); };
    if (navigator.serviceWorker.controller) reload();
    else navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
  });
}

/** main.js: what draws the place in the address. @param {() => void} fn */
export function onPlace(fn) {
  render = fn;
  addEventListener('popstate', () => {
    if (location.search === here) return;
    here = location.search;
    render();
  });
}

/** @param {string} query @param {{ replace?: boolean }} [o] */
export function go(query, o = {}) {
  const url = `/photos/${query}`;
  if (navigator.serviceWorker?.controller && editor(query) !== Boolean(globalThis.crossOriginIsolated)) {
    if (!o.replace) sessionStorage.setItem(FROM, '1');
    if (o.replace) location.replace(url);
    else location.assign(url);
    return;
  }
  if (o.replace) history.replaceState(null, '', url);
  else history.pushState({ photos: true }, '', url);
  here = location.search;
  render();
}

/** Back inside Photos when it came from there, else to the shelf. */
export function back() {
  if (history.state?.photos) history.back();
  else go('', { replace: true });
}
