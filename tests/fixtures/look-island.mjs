// Music in the island for the look's browser tests: opened and shrunk into the capsule with an invented
// song playing, and the island's springs at rest.
/** @param {import('playwright').Page} page */
export const settle = (page) => page.evaluate(() => import('/th/island/island.js').then((m) => m.whenResting()));
/** Music opened and shrunk into the island, an invented song playing at 0:07 of 0:59; `art`: with a
 * picture of its own (a square drawn here, as a data: address). @param {import('playwright').Page} page @param {{ art?: boolean }} [o] */
export async function island(page, { art = false } = {}) {
  await page.evaluate(() => new Promise((resolve) => { document.addEventListener('th:app-ready', resolve, { once: true }); import('/th/island/island.js').then((m) => m.openApp('music')); }));
  await settle(page);
  await page.evaluate(() => import('/th/island/island.js').then((m) => m.collapse('test')));
  await settle(page);
  await page.evaluate((withArt) => {
    const p = document.querySelector('iframe[data-app=music]').contentWindow.__cp.player, a = p.audio;
    const c = Object.assign(document.createElement('canvas'), { width: 144, height: 144 }), g = c.getContext('2d');
    g.fillStyle = '#2b6cb0'; g.fillRect(0, 0, 144, 144); g.fillStyle = '#f6ad55'; g.fillRect(36, 36, 72, 72);
    p.queue = [{ id: 'one', title: 'An invented tone', artist: 'An invented band', ...(withArt ? { art: { url: c.toDataURL('image/png') } } : {}) }]; p.index = 0;
    Object.defineProperty(a, 'paused', { get: () => false, configurable: true });
    Object.defineProperty(a, 'duration', { value: 59, configurable: true });
    Object.defineProperty(a, 'currentTime', { value: 7, configurable: true, writable: true });
  }, art);
  await page.waitForSelector('.th-island.playing');
  await page.waitForFunction(() => document.querySelector('.th-island .title').textContent === 'An invented tone');
  if (art) await page.waitForSelector('.th-island .art.has-art');
  await settle(page);
}
