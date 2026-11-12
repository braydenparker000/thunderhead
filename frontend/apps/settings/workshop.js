// @ts-check
// Settings › Files for the workshop (API.md §11.27): the owner sends a file of any kind to the agent
// that builds Thunderhead with them (a RAW to test the editor on, another app's export to compare
// with). It goes to the owner's own private storage in pieces of 8 MiB, each with its SHA-256, so a
// weak line loses one piece at most and the same file picked again goes on from where it stopped
// (workshop-send.js). Below: what is there, each with Remove, and the room taken.
import { api, signedIn } from '/th/client.js';
import { confirmSheet, el, toast } from '/th/ui.js';
import { sha256 } from '/th/attach/upload.js';
import { uuidv7 } from '/th/chat/model.js';
import { group } from './components.js';
import { known, refuse, sendFile, sizeOf } from './workshop-send.js';

/** @typedef {import('../../../shared/contract/workshop.ts').WorkshopFile} WorkshopFile */
/** @typedef {import('../../../shared/contract/workshop.ts').WorkshopListResponse} WorkshopList */

/** One piece through XMLHttpRequest, for its upload progress.
 * @param {File} file @returns {Parameters<typeof sendFile>[0]['put']} */
const putFor = (file) => (id, n, bytes, sha, onSent) =>
  signedIn(
    (token) =>
      new Promise((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open('PUT', `${api.base}/v1/workshop/${id}/parts/${n}?bytes=${file.size}`);
        x.setRequestHeader('Authorization', `Bearer ${token}`);
        x.setRequestHeader('TH-Client', api.client);
        x.setRequestHeader('Content-Type', 'application/octet-stream');
        x.setRequestHeader('TH-File-Name', encodeURIComponent(file.name.normalize('NFC').trim()));
        x.setRequestHeader('TH-Sha256', sha);
        x.upload.onprogress = (e) => onSent(e.loaded);
        x.onerror = x.ontimeout = () => reject(Object.assign(new Error('network'), { status: 0 }));
        x.onload = () => {
          let data = null;
          try {
            data = JSON.parse(x.responseText);
          } catch {}
          if (x.status >= 200 && x.status < 300 && data) resolve(data);
          else reject(Object.assign(new Error(data?.error?.code ?? `HTTP ${x.status}`), { status: x.status, code: data?.error?.code ?? 'unavailable' }));
        };
        x.send(bytes);
      }),
  );

const day = (/** @type {number} */ ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** @param {HTMLElement} body */
export async function page(body) {
  const input = /** @type {HTMLInputElement} */ (el('input', { type: 'file', multiple: '', hidden: '', id: 'workshop-file' }));
  const pick = el('button', { type: 'button', class: 'btn', id: 'workshop-pick', text: 'Choose files' });
  const line = el('p', { class: 'shelp', role: 'status', 'aria-live': 'polite', id: 'workshop-line' });
  const bar = /** @type {HTMLProgressElement} */ (el('progress', { max: '1', value: '0', hidden: '', id: 'workshop-bar', 'aria-label': 'Sending' }));
  const files = el('div', { id: 'workshop-files' });
  const room = el('p', { class: 'shelp', id: 'workshop-room' });
  /** @type {WorkshopList} */
  let now = { items: [], bytes: 0, limit: 0, part_bytes: 8 * 1024 * 1024 };
  let busy = false;

  /** @param {WorkshopFile} f */
  const row = (f) => {
    const whole = f.have.length === f.parts;
    const said = whole ? `${sizeOf(f.bytes)} · sent ${day(f.at)}` : `${f.have.length} of ${f.parts} pieces in. Choose the same file again to finish it.`;
    const remove = el('button', { type: 'button', class: 'btn quiet inline sbtn', text: 'Remove', 'aria-label': `Remove ${f.name}` });
    remove.addEventListener('click', async () => {
      const ok = await confirmSheet({ title: 'Remove this file?', body: `${f.name} leaves your storage. The copy on your phone stays.`, action: 'Remove' });
      if (!ok) return;
      await signedIn((t) => api.call(`/v1/workshop/${f.id}`, { method: 'DELETE', token: t })).catch(() => toast('That did not remove. Try again.'));
      await load();
    });
    return el('div', { class: 'row', 'data-info': '', 'data-file': f.id }, [
      el('div', { class: 'row-copy' }, [el('span', { class: 'row-title', text: f.name }), el('span', { class: 'row-detail', text: said })]),
      remove,
    ]);
  };
  const load = async () => {
    try {
      now = await signedIn((t) => api.call('/v1/workshop', { token: t }));
    } catch {
      files.replaceChildren(el('p', { class: 'sempty', text: 'The list did not load. Try again in a moment.' }));
      return false;
    }
    files.replaceChildren(now.items.length ? group('In the workshop', now.items.map(row)) : el('p', { class: 'sempty', text: 'Nothing sent yet.' }));
    room.textContent = now.items.length ? `${sizeOf(now.bytes)} of ${sizeOf(now.limit)} used. Files stay until you remove them.` : '';
    return true;
  };

  /** @param {File[]} picked */
  const take = async (picked) => {
    if (busy) return;
    busy = true;
    pick.setAttribute('disabled', '');
    // The screen stays on while a file goes: a phone that sleeps stops sending.
    const awake = await /** @type {any} */ (navigator).wakeLock?.request('screen').catch(() => null);
    const said = [];
    for (const [i, file] of picked.entries()) {
      const no = refuse(file);
      if (no) { said.push(`${file.name}: ${no}`); continue; }
      if (!(await load())) { said.push(`${file.name}: not sent. Your storage did not answer.`); continue; }
      const old = known(now.items, file);
      if (old && old.have.length === old.parts) { said.push(`${file.name}: already there.`); continue; }
      if (!old && now.bytes + file.size > now.limit) { said.push(`${file.name}: no room. Remove a file first.`); continue; }
      const count = picked.length > 1 ? ` (${i + 1} of ${picked.length})` : '';
      bar.hidden = false;
      try {
        await sendFile({
          file, id: old?.id ?? uuidv7(), partBytes: now.part_bytes, have: old?.have ?? [], put: putFor(file), hash: sha256,
          onProgress: (p) => { bar.value = p; line.textContent = `Sending ${file.name}${count}: ${Math.floor(p * 100)} %`; },
        });
        said.push(`${file.name}: sent.`);
      } catch {
        said.push(`${file.name}: stopped part way. Choose it again to go on from there.`);
      }
    }
    await awake?.release().catch(() => undefined);
    bar.hidden = true;
    line.textContent = said.join(' ');
    busy = false;
    pick.removeAttribute('disabled');
    input.value = '';
    await load();
  };
  pick.addEventListener('click', () => input.click());
  input.addEventListener('change', () => input.files?.length && take([...input.files]));

  body.append(
    el('p', { class: 'slead', text: 'Send a file of any kind to the agent that builds Thunderhead with you: a RAW from your camera, a photo another app made. It goes to your own private storage and nowhere else.' }),
    el('p', { class: 'shelp', text: 'A file goes in small pieces, so a weak signal loses little and the same file chosen again goes on from where it stopped. Sending uses as much data as the file is big. Keep this page open until it says sent.' }),
    el('div', { class: 'sform' }, [pick, input]),
    bar,
    line,
    files,
    room,
  );
  await load();
}
