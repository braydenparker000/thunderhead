// @ts-check
// Settings › Privacy and data › the editor's reports, as this phone has them (th/report/journal.js): how many are
// kept, how many wait to be sent, when they last went, and a key to send them now (th/report/send.js, as the
// background worker does). The switch above it (privacy.editor_timings) is told to the recorder as it changes: the
// background worker cannot read it itself.
import { group } from './components.js';
import { el } from '/th/ui.js';
import { infoRow } from './catalog.js';
import { prefOn } from '/th/pref.js';
import { allow, stats } from '/th/report/journal.js';

const KEY = 'privacy.editor_timings';
document.addEventListener('th:setting', (e) => { const d = /** @type {CustomEvent} */ (e).detail; if (d?.key === KEY) void allow(d.value !== false && d.value !== 'false'); });

/** When, in words. @param {number} at */
const ago = (at) => { const m = Math.round((Date.now() - at) / 60_000); return !at ? 'never' : m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

/** The group: a read-only line of what is kept and sent, with its Send now key. */
export function reportsGroup() {
  const line = infoRow('This phone', 'Counting…'), detail = /** @type {HTMLElement} */ (line.querySelector('.row-detail'));
  const show = async () => {
    const s = await stats(), off = !prefOn(KEY, true);
    detail.textContent = `${s.kept} kept · ${s.waiting} waiting · last sent ${ago(s.sent)}${s.fails ? ` · ${s.fails} not kept` : ''}${off ? ' · sending is off' : ''}`;
  };
  void allow(prefOn(KEY, true)); void show();
  const send = el('button', { type: 'button', class: 'btn quiet inline sbtn', text: 'Send now', 'aria-label': 'Send the editor reports now' });
  send.addEventListener('click', async () => {
    detail.textContent = 'Sending…';
    let r = /** @type {{ sent: number, files: number, why?: string }} */ ({ sent: 0, files: 0, why: 'not sent' });
    try { await import('/th/report/fields.js'); await import('/th/report/send.js'); r = await /** @type {any} */ (globalThis).thReportSend(); } catch { /* r says not sent */ }
    await show();
    if (r.why && r.why !== 'nothing new') detail.textContent += ` · ${r.why}`;
  });
  send.dataset.reports = 'send'; line.dataset.reports = 'line'; line.append(send);
  return group('Editor reports', [line]);
}
