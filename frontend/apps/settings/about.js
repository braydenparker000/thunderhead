// @ts-check
// Settings › About and diagnostics (MENU-AND-SETTINGS.md §6.8): read-only. The release this phone
// runs (config.js) and the Worker's version (GET /v1/health); today's rows against the free plan's
// budget (GET /v1/ops/meter); and the last Frames readout, when the feel lab left one on this phone
// (localStorage `th.lab.frames`). Nothing here changes anything.
import { api, configured, signedIn } from '/th/client.js';
import { lineFor } from '/th/copy.js';
import { failure } from '/th/flow.js';
import { el } from '/th/ui.js';
import { CONFIG } from '/config.js';
import { group } from './components.js';
import { infoRow } from './catalog.js';

const n = (/** @type {number} */ v) => v.toLocaleString('en');

/** The Frames readout as one line, or null when there is none. @returns {string | null} */
function frames() {
  try {
    const r = JSON.parse(localStorage.getItem('th.lab.frames') || 'null');
    if (!r || typeof r.frames !== 'number') return null;
    return [`${r.frames} frames`, `${r.framesOver16_7 ?? 0} over 16.7 ms`, `p95 ${r.p95Ms ?? '—'} ms`, `longest ${r.longestMs ?? '—'} ms`].join(' · ');
  } catch {
    return null;
  }
}

/** @param {HTMLElement} row @param {string} detail @param {string} [value] */
const fill = (row, detail, value) => {
  const d = row.querySelector('.row-detail');
  if (d) d.textContent = detail;
  const v = row.querySelector('.row-value');
  if (v && value !== undefined) v.textContent = value;
};

/** @param {HTMLElement} body */
export async function page(body) {
  const commit = String(CONFIG.commit);
  const release = infoRow('Release', `Build ${CONFIG.build}${CONFIG.preview ? ` · preview of ${CONFIG.preview}` : ''}`, commit === 'dev' ? 'dev' : commit.slice(0, 7));
  release.id = 'about-release';
  const worker = infoRow('Worker', 'The version answering this phone.', '…');
  worker.id = 'about-worker';
  const rows = infoRow('Rows today', "Your Worker's database use since 00:00 UTC.", '…');
  rows.id = 'about-rows';
  const readout = frames();
  const lab = infoRow('Last Frames readout', readout ?? 'None on this phone. Open home with ?feel, then hold or swipe to record one.');
  lab.id = 'about-frames';
  const line = el('p', { class: 'line', role: 'status' });
  body.append(
    el('p', { class: 'slead', text: 'What this phone and your Worker are running. Nothing here changes anything.' }),
    group('Versions', [release, worker]),
    group('Diagnostics', [rows, lab]),
    line,
  );
  if (!configured) {
    fill(worker, 'No Worker is set up for this site.', '—');
    fill(rows, 'No Worker is set up for this site.', '—');
    return;
  }
  const [health, meter] = await Promise.allSettled([
    api.health(),
    signedIn((t) => api.call('/v1/ops/meter?days=1', { token: t })),
  ]);
  if (health.status === 'fulfilled') {
    const v = health.value.version ?? {};
    const id = String(v.id ?? '').slice(0, 8);
    fill(worker, v.tag && id ? `Version ${id}.` : 'The version answering this phone.', v.tag || id || '—');
  } else fill(worker, 'The version answering this phone.', '—');
  if (meter.status === 'fulfilled') {
    const t = meter.value.today;
    fill(rows, `${n(t.rows_read)} read (${t.read_pct} %) · ${n(t.rows_written)} written (${t.written_pct} %) of the free plan's day.`, `${t.pct} %`);
  } else fill(rows, "Your Worker's database use since 00:00 UTC.", '—');
  const failed = [health, meter].find((r) => r.status === 'rejected');
  if (failed?.status === 'rejected') line.textContent = lineFor(failure(failed.reason));
}
