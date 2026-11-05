// @ts-check
// Where an export goes (PHOTOS.md, Export). Where the browser has a save dialog (desktop Chromium), it
// opens at the tap, while the tap still counts, so it is asked before the photos render; the files are
// written where it says. Where it has none (Chrome on Android, an installed app), each file is a download
// to Downloads, one at a time with a short gap, since a second download started at once can be dropped;
// for more than three where the share sheet takes files, the sheet offers it instead. The share sheet
// needs a fresh tap too: when the render outlived the first one, the sheet asks for another.
import * as data from '../data.js';
import { exportsFolder, upload } from '../drive.js';

const GAP_MS = 500;
const w = /** @type {any} */ (globalThis);
/** True where this browser has a save dialog: the destination is then called Files, else Download. */
export const canPick = () => typeof w.showSaveFilePicker === 'function';
const wait = (/** @type {number} */ ms) => new Promise((ok) => setTimeout(ok, ms));
const notAllowed = (/** @type {any} */ e) => e?.name === 'NotAllowedError' || e?.name === 'SecurityError';

/** At the tap: where the files go (a file for one, a folder for several), or null for downloads.
 * @param {string[]} names @returns {Promise<null | { files?: any[], dir?: any }>} */
export async function pickTarget(names) {
  if (!canPick()) return null;
  if (names.length === 1) return { files: [await w.showSaveFilePicker({ suggestedName: names[0], types: [{ description: 'Photo', accept: { [names[0].endsWith('.heic') ? 'image/heic' : 'image/jpeg']: [names[0].slice(names[0].lastIndexOf('.'))] } }] })] };
  return typeof w.showDirectoryPicker === 'function' ? { dir: await w.showDirectoryPicker({ mode: 'readwrite' }) } : null;
}

/** Delivers `files` and says what happened (the toast). `ask` shows choices in the sheet and resolves with the one tapped.
 * @param {File[]} files @param {string} to @param {null | { files?: any[], dir?: any }} target
 * @param {(title: string, choices: { id: string, label: string }[]) => Promise<string>} ask @returns {Promise<string>} */
export async function deliver(files, to, target, ask) {
  const n = files.length, many = n > 1 ? `${n} photos` : '';
  const share = async () => {
    try { await navigator.share({ files }); } catch (e) {
      if (!notAllowed(e)) throw e;
      await ask(n > 1 ? `${many} ready` : 'Ready', [{ id: 'share', label: 'Share' }]);
      await navigator.share({ files });
    }
    return many ? `${many} exported.` : 'Exported.';
  };
  if (to === 'share' && navigator.canShare?.({ files })) return share();
  if (to === 'drive') {
    const t = await data.uploadToken();
    const folder = (await data.store.get('exports-folder').catch(() => null)) ?? (await exportsFolder(t.access_token, t.folder_id));
    data.store.set('exports-folder', folder).catch(() => {});
    for (const f of files) await upload({ file: f, name: f.name, token: async () => ({ access_token: (await data.uploadToken()).access_token, folder_id: folder }) });
    return 'In Drive, in Thunderhead Exports.';
  }
  if (target) {
    for (const [i, f] of files.entries()) {
      const h = target.files?.[i] ?? (await target.dir.getFileHandle(f.name, { create: true }));
      const out = await h.createWritable();
      await out.write(f);
      await out.close();
    }
    return many ? `Saved ${many}.` : 'Saved.';
  }
  if (n > 3 && navigator.canShare?.({ files }) && (await ask(`${many} ready`, [{ id: 'share', label: 'Share' }, { id: 'download', label: 'Download' }])) === 'share') return share();
  for (const [i, f] of files.entries()) {
    if (i) await wait(GAP_MS);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  }
  return many ? `Saved ${many} to Downloads.` : 'Saved to Downloads.';
}
