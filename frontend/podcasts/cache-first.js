// Podcasts never waits on the network to show what it has (podcasts/sw.js): the page and its files
// are answered from the cache `name` at once, and fetched behind to refresh it (the next open has the
// new copy); with nothing cached yet, the network answers and fills it. `key` is the cached copy the
// request stands for (a page load at any query, the page).
/** @param {string} name @param {{ waitUntil(p: Promise<unknown>): void }} event @param {Request | string} req @param {Request | string} [key] */
export function cacheFirst(name, event, req, key = req) {
  const network = fetch(req).then(async r => {if (r.ok) await (await caches.open(name)).put(key, r.clone());return r;});
  event.waitUntil(network.catch(() => {}));
  return caches.open(name).then(cache => cache.match(key)).then(hit => hit || network);
}
