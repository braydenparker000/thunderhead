// @ts-check
// Settings › Photos (PHOTOS.md §3.6): Google Drive first (Connect, or the folder by name and
// Disconnect; a plain line when Google took the access back), then the catalogue's preview size and
// what stays on the phone (recent originals come with editing: shown, not yet chosen), and
// Recently deleted. Connect leaves for Google's consent and comes back to /photos/.
import { api, signedIn } from '/th/client.js';
import { confirmSheet, el, toast } from '/th/ui.js';
import { renderGroup } from './catalog.js';

/** @param {HTMLElement} box */
async function drive(box) {
  /** @type {import('../../../shared/contract/photos.ts').DriveStatus} */
  let s;
  try {
    s = await signedIn((t) => api.call('/v1/photos/drive', { token: t }));
  } catch {
    box.replaceChildren(el('p', { class: 'sempty', text: 'Google Drive’s state did not load. Try again in a moment.' }));
    return;
  }
  const said = s.connected
    ? `Connected. Originals go to “${s.folder_name}” in your Drive.`
    : s.revoked
      ? 'Google took back this app’s access to your Drive. Connect again to keep importing.'
      : !s.configured
        ? 'Connecting needs a Google client for your Worker first (SETUP.md, Photos).'
        : 'Not connected. Originals go to your own Drive, into one folder this app makes and nothing else.';
  const b = el('button', { type: 'button', class: s.connected ? 'btn soft' : 'btn', text: s.connected ? 'Disconnect Google Drive' : 'Connect Google Drive' });
  if (!s.connected && !s.configured) b.setAttribute('disabled', '');
  b.addEventListener('click', async () => {
    if (s.connected) {
      const ok = await confirmSheet({ title: 'Disconnect Google Drive?', body: 'Your photos stay in your Drive and on the shelf. Importing waits until you connect again.', action: 'Disconnect' });
      if (!ok) return;
      await signedIn((t) => api.call('/v1/photos/drive', { method: 'DELETE', token: t })).catch(() => toast('That did not disconnect. Try again.'));
      return drive(box);
    }
    try {
      const { url } = await signedIn((t) => api.call('/v1/photos/drive/connect', { method: 'POST', token: t }));
      location.assign(url);
    } catch {
      toast('Google Drive did not start connecting. Try again.');
    }
  });
  box.replaceChildren(el('h2', { class: 'group-title', text: 'Google Drive' }), el('p', { class: 'slead', text: said }), b);
}

/** @param {HTMLElement} body */
export async function page(body) {
  const box = el('div', { class: 'sphotos' });
  const bin = el('a', { class: 'btn soft', href: '/photos/?deleted=1', text: 'Recently deleted' });
  const out = await renderGroup(body, 'photos', { before: [box], after: [el('h2', { class: 'group-title', text: 'Deleted photos' }), bin] });
  // Keeping recent originals on the phone comes with editing (P1c): shown, not yet chosen.
  const later = /** @type {HTMLButtonElement | null} */ (body.querySelector('button[data-v="recent"]'));
  if (later) {
    later.disabled = true;
    later.title = 'Comes with editing';
  }
  await drive(box);
  return out;
}
