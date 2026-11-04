// @ts-check
// "Listening history" in Settings › Music (MUSIC.md §16.1): pick or drop the exports (Spotify's
// extended streaming history, YouTube Music's watch history from Google Takeout, a Last.fm export;
// zip, json or csv). Each file goes to the Worker with its SHA-256 (PUT /v1/music/history), which
// counts it once, a few minutes later, in the background; the same file again is already counted.
// Below, what was counted: counts only (GET /v1/music/history).
import { api, signedIn } from '/th/client.js';
import { el } from '/th/ui.js';
import { sha256 } from '/th/attach/upload.js';
import { icon } from './components.js';

/** @typedef {import('../../../shared/contract/taste.ts').HistoryStatus} HistoryStatus */
/** @typedef {import('../../../shared/contract/taste.ts').HistoryPut} HistoryPut */

const MAX = 32 * 1024 * 1024;
const NAMES = { spotify: 'Spotify', youtube: 'YouTube Music', lastfm: 'Last.fm' };
const n = (/** @type {number} */ x) => x.toLocaleString('en-GB');
const plural = (/** @type {number} */ x, /** @type {string} */ w) => `${n(x)} ${w}${x === 1 ? '' : 's'}`;

/** What was counted, in words. @param {HistoryStatus} s */
export function countedParts(s) {
  if (!s.files.length) return [el('p', { class: 'sempty', text: 'Nothing counted yet.' })];
  const files = s.files.map((f) =>
    el('div', { class: 'row srow', 'data-info': '', 'data-file': f.sha256.slice(0, 12) }, [
      icon(f.state === 'done' ? 'check' : 'clock'),
      el('div', { class: 'row-copy stext' }, [
        el('div', { class: 'st1', text: NAMES[f.source] ?? f.source }),
        el('div', { class: 'st2', text: f.state === 'done' ? `${plural(f.plays, 'play')}, ${plural(f.minutes, 'minute')}` : 'Counting…' }),
      ]),
    ]),
  );
  const artists = el('p', { class: 'shelp', text: `${plural(s.artists, 'artist')}, ${n(s.resolved)} named by MusicBrainz so far.` });
  return [...files, artists];
}

/** One file to the Worker; a line for the owner. @param {File} file */
export async function send(file) {
  if (file.size > MAX) return `${file.name}: too big (32 MB at most).`;
  const sum = await sha256(file);
  /** @type {HistoryPut} */
  const r = await signedIn(async (token) => {
    const res = await fetch(`${api.base}/v1/music/history`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'TH-Client': api.client, 'TH-File-Name': encodeURIComponent(file.name.slice(0, 120)), 'TH-Sha256': sum },
      body: file,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error('upload'), { status: res.status, data });
    return data;
  });
  return r.state === 'done' ? `${file.name}: already counted.` : `${file.name}: taken. I'll count it in a few minutes.`;
}

/** The block: the lead, the pick button (and the drop), the lines, what was counted. */
export function historyBlock() {
  const input = /** @type {HTMLInputElement} */ (el('input', { type: 'file', accept: '.zip,.json,.csv', multiple: '', hidden: '', id: 'history-file' }));
  const pick = el('button', { type: 'button', class: 'btn quiet inline sbtn', text: 'Add an export' });
  pick.addEventListener('click', () => input.click());
  const line = el('p', { class: 'shelp', role: 'status', 'aria-live': 'polite' });
  const counted = el('div', { class: 'mmeters', 'data-counted': '' });
  const load = async () => {
    try {
      counted.replaceChildren(...countedParts(await signedIn((t) => api.call('/v1/music/history', { token: t }))));
    } catch {
      counted.replaceChildren(el('p', { class: 'sempty', text: "I couldn't read this just now." }));
    }
  };
  /** @param {FileList | File[]} files */
  const take = async (files) => {
    const lines = [];
    for (const f of files) {
      line.textContent = `Sending ${f.name}…`;
      try {
        lines.push(await send(f));
      } catch (e) {
        const status = /** @type {{status?: number}} */ (e).status;
        lines.push(`${f.name}: ${status === 422 ? 'not an export I can read.' : "couldn't send it. Try again."}`);
      }
    }
    line.textContent = lines.join(' ');
    await load();
  };
  input.addEventListener('change', () => input.files?.length && take([...input.files]));
  const box = el('div', { class: 'group mfold', id: 'music-history', 'data-drop': '' }, [
    el('div', { class: 'row srow', 'data-info': '' }, [
      icon('music-notes-simple'),
      el('div', { class: 'row-copy stext' }, [
        el('div', { class: 'st1', text: 'Listening history' }),
        el('div', {
          class: 'st2',
          text: "Spotify's extended streaming history, YouTube Music's watch history from Google Takeout, or a Last.fm export. Zip, json or csv. Only artists, albums, years and plays are kept.",
        }),
      ]),
    ]),
    el('div', { class: 'row srow', 'data-info': '' }, [pick, input]),
    line,
    counted,
  ]);
  box.addEventListener('dragover', (e) => e.preventDefault());
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files.length) take([...e.dataTransfer.files]);
  });
  load();
  return box;
}
