// @ts-check
// The original straight to the owner's Google Drive (PHOTOS.md §3.1): a resumable upload the phone
// runs itself with the short-lived token the Worker mints, so the bytes never pass through the
// Worker; where the browser can, background.js hands the same session to it to upload with Photos closed. Chunks of 8 MiB with their progress; a dropped connection asks Drive how far it got and
// goes on from there, with the session kept on the phone, so even a reload resumes it.

export const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
export const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const CHUNK = 8 * 1024 * 1024;
const FOLDER = 'application/vnd.google-apps.folder';
/** Where exports go in Drive: beside the app's folder (shared/contract/photos.ts DRIVE_EXPORTS). */
export const EXPORTS_FOLDER = 'Thunderhead Exports';

/** @param {number} ms */
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** A new upload session for this file in the app's folder; its address. The address alone is
 * the credential for the bytes (no token goes with a PUT to it; Drive keeps it about a week), so a
 * background upload (background.js) needs no token that could run out. @param {string} token
 * @param {Blob} file @param {string} name @param {string} folder */
export async function open(token, file, name, folder) {
  const res = await fetch(`${DRIVE_UPLOAD}?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': file.type || 'application/octet-stream',
      'X-Upload-Content-Length': String(file.size),
    },
    body: JSON.stringify({ name, parents: [folder] }),
  });
  const at = res.headers.get('Location');
  if (!res.ok || !at) throw Object.assign(new Error('drive'), { status: res.status });
  return at;
}

/** One PUT to the session: a chunk (with progress) or, with no bytes, "how far did you get".
 * @param {string} session @param {Blob} file @param {number} start @param {boolean} ask
 * @param {(sent: number) => void} onSent
 * @returns {Promise<{ status: number, range: string | null, body: any }>} */
function put(session, file, start, ask, onSent) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', session);
    const end = Math.min(file.size, start + CHUNK);
    x.setRequestHeader('Content-Range', ask ? `bytes */${file.size}` : `bytes ${start}-${end - 1}/${file.size}`);
    x.upload.onprogress = (e) => onSent(start + e.loaded);
    x.onerror = x.ontimeout = () => reject(Object.assign(new Error('network'), { status: 0 }));
    x.onload = () => {
      let body = null;
      try {
        body = JSON.parse(x.responseText);
      } catch {}
      resolve({ status: x.status, range: x.getResponseHeader('Range'), body });
    };
    x.send(ask ? null : file.slice(start, end));
  });
}

/** Where Drive's session stands after a 308: the next byte it wants. @param {string | null} range */
const nextByte = (range) => {
  const m = /bytes=0-(\d+)/.exec(range ?? '');
  return m ? Number(m[1]) + 1 : 0;
};

/**
 * Uploads `file` to the folder and returns its Drive id. `token()` gives a live upload token (the
 * Worker's), `session` a session kept from before, `keep(session)` keeps a new one.
 * @param {{ file: Blob, name: string, token: () => Promise<{ access_token: string, folder_id: string }>,
 *   session?: string | null, keep?: (session: string) => void, onProgress?: (sent: number, total: number) => void }} o
 * @returns {Promise<string>}
 */
export async function upload(o) {
  const progress = o.onProgress ?? (() => {});
  let session = o.session ?? null;
  let start = 0;
  let ask = Boolean(session);
  for (let tries = 0; tries < 6; ) {
    try {
      if (!session) {
        const t = await o.token();
        session = await open(t.access_token, o.file, o.name, t.folder_id);
        o.keep?.(session);
        ask = false;
        start = 0;
      }
      const r = await put(session, o.file, start, ask, (sent) => progress(sent, o.file.size));
      ask = false;
      if ((r.status === 200 || r.status === 201) && r.body?.id) {
        progress(o.file.size, o.file.size);
        return String(r.body.id);
      }
      if (r.status === 308) {
        start = nextByte(r.range);
        progress(start, o.file.size);
        continue;
      }
      // A session Drive has forgotten (a week old, or cancelled): start a new one.
      if (r.status === 404 || r.status === 410) {
        session = null;
        tries++;
        continue;
      }
      throw Object.assign(new Error('drive'), { status: r.status });
    } catch (e) {
      const status = /** @type {{ status?: number }} */ (e).status ?? 0;
      if (status && status < 500 && status !== 429) throw e;
      // A dropped connection or a busy Drive: ask how far it got, after a short wait.
      tries++;
      ask = Boolean(session);
      await pause(Math.min(8000, 500 * 2 ** tries));
    }
  }
  throw Object.assign(new Error('drive'), { status: 0 });
}

/** Where a kept session stands (background.js, after a background upload): Drive's file id once
 * all of it arrived, else the next byte Drive wants (0 for a session Drive has forgotten).
 * @param {string} session @param {number} size @returns {Promise<{ id: string | null, next: number }>} */
export async function ask(session, size) {
  const res = await fetch(session, { method: 'PUT', headers: { 'Content-Range': `bytes */${size}` } });
  if (res.status === 200 || res.status === 201) {
    const id = (await res.json().catch(() => null))?.id;
    if (id) return { id: String(id), next: size };
  }
  if (res.status === 308) return { id: null, next: nextByte(res.headers.get('Range')) };
  if (res.status >= 500 || res.status === 429) throw Object.assign(new Error('drive'), { status: res.status });
  return { id: null, next: 0 };
}

/** The address of an original's bytes in Drive (the editor's engine streams it). @param {string} id */
export const mediaUrl = (id) => `${DRIVE_FILES}/${encodeURIComponent(id)}?alt=media`;

/** Bytes of an original in Drive (a byte range, or all of it), for a photo found by the daily
 * pass that has no preview yet. @param {string} token @param {string} id @param {[number, number]} [range] */
export async function fetchOriginal(token, id, range) {
  const res = await fetch(mediaUrl(id), {
    headers: { Authorization: `Bearer ${token}`, ...(range ? { Range: `bytes=${range[0]}-${range[1] - 1}` } : {}) },
  });
  if (!res.ok) throw Object.assign(new Error('drive'), { status: res.status });
  return res.blob();
}

/** A small file of the app's own, by its exact name (the editor's backup of an edit, lab/editor/app/backup.js):
 * its Drive id, or null. The app sees only files it made, so the name alone finds it. @param {string} token @param {string} name */
export async function findByName(token, name) {
  const q = `name = '${name.replace(/['\\]/g, '')}' and trashed = false`;
  const res = await fetch(`${DRIVE_FILES}?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1&orderBy=modifiedTime desc`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw Object.assign(new Error('drive'), { status: res.status });
  return /** @type {string | null} */ ((await res.json()).files?.[0]?.id ?? null);
}
/** New bytes for a file already in Drive (the same id, the same name). @param {string} token @param {string} id @param {Blob} blob */
export async function replace(token, id, blob) {
  const res = await fetch(`${DRIVE_UPLOAD}/${encodeURIComponent(id)}?uploadType=media&fields=id`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
  if (!res.ok) throw Object.assign(new Error('drive'), { status: res.status });
}

/** The "Thunderhead Exports" folder beside the app's folder (the same parent), made on first use;
 * exports go there by the same resumable upload as originals. @param {string} token @param {string} folder */
export async function exportsFolder(token, folder) {
  const auth = { Authorization: `Bearer ${token}` };
  const get = async (/** @type {string} */ url, /** @type {RequestInit} */ o = {}) => {
    const res = await fetch(url, { ...o, headers: { ...auth, ...(o.headers ?? {}) } });
    if (!res.ok) throw Object.assign(new Error('drive'), { status: res.status });
    return res.json();
  };
  const parent = (await get(`${DRIVE_FILES}/${encodeURIComponent(folder)}?fields=parents`)).parents?.[0] ?? 'root';
  const q = `name = '${EXPORTS_FOLDER}' and mimeType = '${FOLDER}' and '${parent}' in parents and trashed = false`;
  const found = await get(`${DRIVE_FILES}?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`);
  if (found.files?.[0]?.id) return String(found.files[0].id);
  const made = await get(`${DRIVE_FILES}?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ name: EXPORTS_FOLDER, mimeType: FOLDER, parents: [parent] }) });
  return String(made.id);
}
