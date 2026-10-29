// Settings → Export (MENU-AND-SETTINGS.md §4.9): "Download everything" asks for the password
// again, then the Worker gathers every table it exports while a bar shows how far it got (the
// page can be left: coming back finds it), and once ready one tap saves the ZIP to this phone.
// The link works for an hour, on this device only. Under it, the last automatic backup.
import { api, signedIn } from '/th/client.js';
import { lineFor } from '/th/copy.js';
import { failure } from '/th/flow.js';
import { el } from '/th/ui.js';
import { withPassword } from './settings.js';

/** The export this phone is waiting for, so leaving and coming back keeps watching it. */
const KEY = 'th.export.id';
const POLL_MS = 1_500;
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const remember = (id) => {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {}
};
const remembered = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

/** "2.3 MB", "640 KB" @param {number} n */
export const size = (n) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1_000))} KB`);
/** "Sunday 03:20", in this phone's clock. @param {number} ms */
export const when = (ms) => {
  const d = new Date(ms);
  return `${WD[d.getDay()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** @param {HTMLElement} body */
export async function exportPage(body) {
  const lead = el('p', { class: 'shelp', text: 'One ZIP with everything I keep about you: our conversations, what I remember, day notes, loose ends, decisions and the ledger of what I did. Sign-in data stays out.' });
  const host = el('div', { class: 'sform xport' });
  const backup = el('p', { class: 'shelp', text: '' });
  body.replaceChildren(lead, host, backup);

  const line = el('p', { class: 'line', role: 'status' });
  const fill = el('span');
  const bar = el('div', { class: 'xbar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'Gathering everything' }, [fill]);
  const start = el('button', { type: 'button', class: 'btn', text: 'Download everything' });

  /** The line under the button: progress in the quiet style, a problem in the error one. */
  const say = (text, problem = false) => {
    line.className = problem ? 'line' : 'shelp xstat';
    line.textContent = text;
  };
  const idle = (text = '') => {
    say(text, true);
    host.replaceChildren(start, line);
  };
  const progress = (p) => {
    fill.style.setProperty('--p', `${p}%`);
    bar.setAttribute('aria-valuenow', String(p));
    say(`Gathering everything… ${p}%`);
    if (!bar.isConnected) host.replaceChildren(bar, line);
  };
  const ready = (/** @type {{ label: string, url: string, bytes: number, expires_at: number }} */ item) => {
    const save = el('button', { type: 'button', class: 'btn', text: `Download (${size(item.bytes)})` });
    const note = el('p', { class: 'shelp', text: 'The link works for an hour, on this phone only.' });
    say('');
    host.replaceChildren(save, note, line);
    save.addEventListener('click', async () => {
      save.disabled = true;
      say('Saving…');
      try {
        const blob = await signedIn((t) => api.download(item.url, t));
        const a = el('a', { href: URL.createObjectURL(blob), download: item.label });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
        say('Saved to this phone.');
      } catch (e) {
        say(/** @type {any} */ (e).status === 404 ? 'That link has expired. Make a new one.' : lineFor(failure(e)), true);
        if (/** @type {any} */ (e).status === 404) {
          remember(null);
          idle(line.textContent);
        }
      } finally {
        save.disabled = false;
      }
    });
  };

  /** Follows an export until it is ready, failed or gone, while the page is open. @param {string} id */
  const watch = async (id) => {
    for (;;) {
      if (!body.isConnected) return;
      /** @type {import('../../../shared/contract/backups.ts').ExportStatus} */
      let s;
      try {
        s = await signedIn((t) => api.call(`/v1/export/${encodeURIComponent(id)}`, { token: t }));
      } catch (e) {
        if (/** @type {any} */ (e).status === 404) {
          remember(null);
          idle();
          return;
        }
        say(lineFor(failure(e)), true);
        await new Promise((r) => setTimeout(r, POLL_MS * 2));
        continue;
      }
      showBackup(s.last_backup);
      if (s.status === 'building') progress(s.progress);
      else if (s.status === 'ready' && s.items[0]) return ready(s.items[0]);
      else {
        remember(null);
        return idle(s.status === 'failed' ? "Couldn't gather everything. Try again." : '');
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  };

  /** @param {{ date: string, finished_at: number } | null} b */
  const showBackup = (b) => {
    backup.textContent = b ? `Last automatic backup: ${when(b.finished_at)} (weekly, private).` : 'Automatic backups run every Sunday at 02:30 (weekly, private).';
  };

  start.addEventListener('click', async () => {
    const r = await withPassword(host, 'Download everything', 'Continue', (t, pw) =>
      api.call('/v1/export', { method: 'POST', token: t, body: { password: pw } }),
    );
    if (!r) return idle();
    remember(r.export_id);
    progress(0);
    watch(r.export_id);
  });

  const id = remembered();
  if (id) {
    progress(0);
    watch(id);
  } else idle();
  try {
    /** @type {{ items: { complete: boolean, finished_at: number | null, date: string }[] }} */
    const list = await signedIn((t) => api.call('/v1/ops/backups?limit=5', { token: t }));
    const last = list.items.find((b) => b.complete && b.finished_at);
    showBackup(last ? { date: last.date, finished_at: /** @type {number} */ (last.finished_at) } : null);
  } catch {
    showBackup(null);
  }
}
