// Emergency only (OPERATIONS.md §3.3): copied over sw.js when a broken worker keeps serving a bad
// shell. It takes over at once, deletes every th-* cache, unregisters itself and reloads the open
// pages from the network. Afterwards the real sw.js goes back with the fix.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('th-')) await caches.delete(name);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});
