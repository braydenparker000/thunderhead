// @ts-check
// An export's finished bands, kept on this phone while it is being made, so an export that stops (the phone took
// the tab back, the GPU gave up) carries on from where it stopped: the next export of the same photo with the same
// edit, by the same method and build, reads the bands that were made and makes only the rest (engine/export.js
// `How.keep`). They are in the browser's private file system (OPFS) under `export/<key>/`, a file a band named by
// its first row, 16-bit, as the engine read it back; a 40 megapixel photo's are about 320 MB while it is being
// made. One export's at a time: a new one clears every other, a finished or given-up one clears its own, and the
// Library clears what was left behind three days ago. Where the file system will not have it (a private
// window, no room), nothing is kept and the export is made whole, as before.
const ROOT = 'export';
const dir = async (/** @type {string} */ name, create = false) => (await (await navigator.storage.getDirectory()).getDirectoryHandle(ROOT, { create: true })).getDirectoryHandle(name, { create });

/** A short name for what an export is made from: any change to it is another export. @param {unknown} what */
export async function keyOf(what) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(what))));
  return Array.from(h.subarray(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Every export's kept bands but `but`'s, removed; with `age`, only those none of whose bands was written in the
 * last `age` ms (the Library clears what was left behind days ago). @param {string} [but] @param {number} [age] */
export async function sweep(but = '', age = 0) {
  try {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(ROOT, { create: true });
    for await (const [name, d] of /** @type {any} */ (root).entries()) {
      if (name === but) continue;
      let newest = 0;
      if (age) for await (const h of d.values()) newest = Math.max(newest, (await h.getFile()).lastModified);
      if (!age || Date.now() - newest > age) await root.removeEntry(name, { recursive: true }).catch(() => {});
    }
  } catch { /* no file system here: nothing was kept */ }
}

/** How many rows of the export named `key` are kept. @param {string} key */
export async function rowsKept(key) {
  try {
    let rows = 0;
    for await (const [name, h] of /** @type {any} */ (await dir(key)).entries()) { const m = /^\d+-(\d+)-(\d+)$/.exec(name); if (m && (await h.getFile()).size === +m[1] * +m[2] * 8) rows += +m[1]; }
    return rows;
  } catch { return 0; }
}

/** The kept bands of the export named `key`, every other export's cleared: `get` a band if it was made (its first
 * row, how many rows, how wide), `put` one that has been, `clear` them all. A band that cannot be read or written
 * is one that was not kept. @param {string} key
 * @returns {Promise<import('../../engine/export.js').Keep>} */
export async function keep(key) {
  await sweep(key);
  const d = await dir(key, true).catch(() => null), name = (/** @type {number} */ y, /** @type {number} */ n, /** @type {number} */ w) => `${y}-${n}-${w}`;
  return {
    get: async (y, n, w) => {
      try { const f = await (await /** @type {FileSystemDirectoryHandle} */ (d).getFileHandle(name(y, n, w))).getFile(); return f.size === n * w * 8 ? new Uint16Array(await f.arrayBuffer()) : null; } catch { return null; }
    },
    put: async (y, n, w, band) => {
      try {
        const out = await (await /** @type {FileSystemDirectoryHandle} */ (d).getFileHandle(name(y, n, w), { create: true })).createWritable();
        await out.write(/** @type {any} */ (band)); await out.close();
      } catch { await d?.removeEntry(name(y, n, w)).catch(() => {}); }   // half a band is no band
    },
    clear: () => sweep(),
  };
}
