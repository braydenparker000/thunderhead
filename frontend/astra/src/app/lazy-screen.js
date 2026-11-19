// Tabs whose screen loads on its first visit (Search, Settings), so their modules stay out of
// start-up. main.js names them with lazyTab(); the tab's view shows the page's title at once, drawn
// exactly as the screen draws it, and the screen fills the view when its module lands (the title is
// replaced by the same title: nothing flashes). Until then, calls on the screen wait for it.

import {h} from '../ui/dom.js';

/** A tab screen loaded later: `load()` resolves to its class; `title` is shown meanwhile, inside `wrap`
 * (the classes of the elements the screen puts its title in, outermost first). */
export const lazyTab = (load, title, wrap = []) => ({lazy: load, title, wrap});

/** The tab's screen: made at once, or a stand-in that loads it (app.screens[id] becomes the real one). */
export function screenFor(app, id) {
  const Type = app.screenTypes[id], view = app.views[id];
  if (!Type.lazy) return new Type(app, view);
  const title = h('h1', {class: 'page-title'}, Type.title);
  view.append(Type.wrap.reduceRight((inner, cls) => h('div', {class: cls}, inner), title));
  let real = null;
  const ready = Type.lazy().then(Screen => {
    view.replaceChildren();
    real = new Screen(app, view);
    if (app.screens[id] === stand) app.screens[id] = real;
    return real;
  }, error => {
    // Not loaded (offline before it was ever saved): the next visit asks again.
    if (app.screens[id] === stand) delete app.screens[id];
    throw error;
  });
  ready.catch(() => {});
  // Anything asked of the screen before it exists is done once it does, in order.
  const stand = new Proxy({}, {get: (_, key) => {
    if (real) { const v = real[key]; return typeof v === 'function' ? v.bind(real) : v; }
    if (key === 'then') return undefined;
    return (...args) => { ready.then(r => r[key]?.(...args), () => {}); };
  }});
  return stand;
}
