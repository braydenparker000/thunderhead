// @ts-check
// Photos' places (the storage website has no rewrites, so they are queries on /photos/): the shelf
// (no query), `?day=` one day, `?photo=` the full view, `?deleted=1` Recently deleted. Each is a
// history entry, so Android's back closes the sheet, then the view, then Photos (GESTURES.md).

/** @type {() => void} */
let render = () => {};
let here = location.search;

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
