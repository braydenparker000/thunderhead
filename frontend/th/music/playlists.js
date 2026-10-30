// @ts-check
// The Music player's playlists, made from the Thunderhead's home (MUSIC.md §10.2). The player keeps
// them in its own IndexedDB `claude-player`, store `state`, key `pl:<id>`, as `{id, name, ids,
// created, modified}` (frontend/music/src/library/playlists.js), and reads them when it opens; a
// chip to `/music/#pl=<id>` opens that one. A playlist made here carries `made_by: 'thunderhead'`;
// its undo removes it only while the owner hasn't changed it (the player moves `modified` on any
// change).

const DB = 'claude-player';

/** The player's database, opened as the player opens it (the same version and stores). @returns {Promise<IDBDatabase>} */
function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      for (const s of ['tracks', 'files', 'art', 'state']) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, s === 'tracks' ? { keyPath: 'id' } : undefined);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** @template T @param {(store: IDBObjectStore) => IDBRequest<T>} fn @param {IDBTransactionMode} mode @returns {Promise<T>} */
async function state(fn, mode) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('state', mode);
      const r = fn(tx.objectStore('state'));
      tx.oncomplete = () => resolve(r.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8).padEnd(6, '0');

/** @param {{ name: string, refs: string[] }} args */
export async function createPlaylist({ name, refs }) {
  const now = Date.now();
  const pl = { id: newId(), name, ids: refs.map((r) => r.slice('music:'.length)), created: now, modified: now, made_by: 'thunderhead' };
  await state((s) => s.put(pl, `pl:${pl.id}`), 'readwrite');
  return {
    ok: /** @type {const} */ (true),
    result: { list_id: pl.id, tracks: pl.ids.length },
    undo: { verb: 'music.delete_playlist', schema: 1, args: { list_id: pl.id } },
  };
}

/** @param {{ list_id: string }} args */
export async function deletePlaylist({ list_id }) {
  /** @type {{ made_by?: string, created: number, modified: number } | undefined} */
  const pl = await state((s) => s.get(`pl:${list_id}`), 'readonly');
  if (!pl) return { ok: /** @type {const} */ (true), result: {} };
  if (pl.made_by !== 'thunderhead' || pl.modified !== pl.created)
    return { ok: /** @type {const} */ (false), error: { code: 'owner_edited', message: 'the owner has changed this playlist' } };
  await state((s) => s.delete(`pl:${list_id}`), 'readwrite');
  return { ok: /** @type {const} */ (true), result: {} };
}
