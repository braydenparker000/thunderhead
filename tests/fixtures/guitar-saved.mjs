// A guitar tab kept on the test phone as a saved copy (frontend/guitar/sources.js putSaved), so the reader opens it
// without any tab source: signed out or without the new Worker there is none (MIGRATION.md §8), and the old Worker
// is never asked. `key` is the song's key ('g:' + its gprotab path).
export async function keepScore(context, base, key, bytes) {
  const page = await context.newPage();
  await page.goto(`${base}/no-such-page`);
  await page.evaluate(async ([name, data]) => {
    const cache = await caches.open('jarvis-guitar-v1');
    await cache.put(`${location.origin}/guitar/__saved/${encodeURIComponent(name)}`, new Response(new Uint8Array(data), { headers: { 'Content-Type': 'application/octet-stream' } }));
  }, [`${key}|meta`, [...bytes]]);
  await page.close();
}
