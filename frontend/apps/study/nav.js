// @ts-check
// Moving between Study's places (main.js draws them): each is a history entry on /study/. A sheet
// pushes an entry of its own on the same address so Android's back closes it; going back to the
// same address draws nothing again.

/** @type {() => void} */
let render = () => {};
/** The place drawn, as its query. */
let here = location.search;
/** Places this visit went to inside Study, so a Back button can go back instead of out. */
let depth = 0;

/** main.js: what draws the place in the address. @param {() => void} fn */
export function onPlace(fn) {
  render = fn;
  addEventListener('popstate', () => {
    if (location.search === here) return;
    here = location.search;
    depth = Math.max(0, depth - 1);
    render();
  });
}

/** Goes to a place: '' the library, `?q=…` a search, `?book=…&p=12` the reader.
 * @param {string} query @param {{ replace?: boolean }} [o] */
export function go(query, o = {}) {
  const url = `/study/${query}`;
  if (o.replace) history.replaceState(null, '', url);
  else {
    history.pushState(null, '', url);
    depth++;
  }
  here = location.search;
  render();
}

/** Back to where the owner came from inside Study, else to the library. */
export const back = () => (depth > 0 ? history.back() : go('', { replace: true }));
