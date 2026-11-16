// @ts-check
// The editing copy made again from the photo's full resolution (engine/proxy-hq.js) is kept on the phone for the last
// few photos it was made for, so opening one of them again shows the better copy from its first frame instead of
// making it again (the owner, 2026-11-16: "built once per photo ... saved on the phone"). In the origin's private
// files, folder `copy`, about 35 MB a 40 MP photo; the newest KEEP stay. `V` is the way the copy is made: one made
// another way is never taken. A photo deleted takes its own with it (store.js).

const FOLDER = 'copy', KEEP = 6, V = 1;
const dir = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(FOLDER, { create: true });
/** The file a photo's kept copy is in. @param {string} id */
export const copyName = (id) => `${id}.v${V}`;

/** The photo's kept copy, if there is one of this size (four 16-bit values a pixel, `length` of them), else null. @param {string} id @param {number} length */
export async function loadCopy(id, length) {
  try {
    const f = await (await (await dir()).getFileHandle(copyName(id))).getFile();
    return f.size === length * 2 ? new Uint16Array(await f.arrayBuffer()) : null;
  } catch { return null; }
}
/** Keeps the photo's copy, and lets the oldest go past KEEP. @param {string} id @param {Uint16Array} copy */
export async function saveCopy(id, copy) {
  try {
    const d = await dir(), w = await (await d.getFileHandle(copyName(id), { create: true })).createWritable();
    await w.write(/** @type {any} */ (copy)); await w.close();
    const all = /** @type {[string, number][]} */ ([]);
    for await (const [n, h] of /** @type {any} */ (d).entries()) if (h.kind === 'file') all.push([n, (await h.getFile()).lastModified]);
    all.sort((a, b) => b[1] - a[1]);
    for (const [n] of all.slice(KEEP)) await d.removeEntry(n).catch(() => {});
  } catch { /* a full phone: it is made again next time */ }
}
