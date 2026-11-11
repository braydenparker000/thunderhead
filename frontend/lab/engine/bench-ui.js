// @ts-check
// The test bench's part of the engine page: its buttons, the result as text to copy, and the last runs kept in
// this browser so a run can be read against the one before (bench.js does the measuring).
import { NEAR, judge, phone, pictures, timings } from './bench.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const out = $('bout'), KEY = 'th.bench', buttons = /** @type {HTMLButtonElement[]} */ (['ball', 'bcheck'].map($)), file = /** @type {HTMLInputElement} */ ($('bfile'));
/** @typedef {{ v: number, at: number, build: string, phone?: any, gpu?: string, shots?: Record<string, any>, verdict?: Record<string, any>, timings?: Record<string, number | string> }} Run */
const past = () => { try { return /** @type {Run[]} */ (JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return []; } };
const keep = (/** @type {Run} */ r) => { try { localStorage.setItem(KEY, JSON.stringify([r, ...past().filter((p) => p.at !== r.at)].slice(0, 8))); } catch { /* a private window: nothing is kept */ } };
/** @type {Run} */
let run = { v: 1, at: 0, build: 'dev' };
const say = (/** @type {string} */ s) => { $('bnow').textContent = s; };

/** The run as text: what is pasted back. `before` is the run before it, for the "was" beside each time. @param {Run} r @param {Run | undefined} before */
export function text(r, before) {
  const p = r.phone, lines = [`Thunderhead engine test · ${new Date(r.at).toISOString().slice(0, 16).replace('T', ' ')} UTC · build ${r.build}`];
  if (p) lines.push(`Phone: ${[p.android, p.browser, `${p.cores} cores`, `${p.memory_gb} GB`, p.screen, `isolated ${p.isolated ? 'yes' : 'no'}`, `storage kept ${p.storage_kept ? 'yes' : 'no'}`].filter(Boolean).join(' · ')}`);
  if (r.gpu) lines.push(`GPU: ${r.gpu}`);
  if (r.shots && r.verdict) {
    lines.push(`Pictures, this GPU against the reference (the same within ${NEAR.db} dB and ${NEAR.grid}):`);
    for (const [name, s] of Object.entries(r.shots)) {
      const v = r.verdict[name], db = s.psnr === undefined ? '' : `${s.psnr.toFixed(2)} dB · green ${s.green.toFixed(2)} · colour ${s.colour.toFixed(2)} · `;
      lines.push(`  ${name.padEnd(10)} ${db}${v.same ? 'SAME' : 'DIFFERENT'}${v.why ? ` (${v.why})` : ` (off by ${v.db ?? 0} dB, ${v.grid})`}`);
    }
  }
  if (r.timings) {
    lines.push('Timings:');
    for (const [k, v] of Object.entries(r.timings)) { const was = before?.timings?.[k]; lines.push(`  ${k.padEnd(24)} ${v}${typeof v === 'number' && typeof was === 'number' && was !== v ? `   (was ${was})` : ''}`); }
  }
  return lines.join('\n');
}
const show = () => { const before = past().find((p) => p.at !== run.at); out.textContent = text(run, before); /** @type {HTMLButtonElement} */ ($('bcopy')).disabled = !run.at; /** @type {any} */ (window).__bench = run; };
const begin = async () => {
  if (!run.at) { run = { v: 1, at: Date.now(), build: 'dev' }; try { run.build = String((await import('/config.js')).CONFIG.commit).slice(0, 7); } catch { /* a local run */ } run.phone = await phone(); }
  for (const b of buttons) b.disabled = true; file.disabled = true;
};
const end = (/** @type {unknown} */ err) => { for (const b of buttons) b.disabled = false; file.disabled = false; say(err ? `Stopped: ${/** @type {any} */ (err)?.message || err}` : 'Done. Copy the result and paste it where it is wanted.'); if (!err) keep(run); show(); };

async function check() {
  say('Developing the known photo on this phone…');
  const [got, ref] = await Promise.all([pictures(), fetch('/lab/engine/bench-ref.json').then((r) => r.json())]);
  run.gpu = got.gpu; run.shots = got.shots; run.verdict = judge(got.shots, ref.shots);
  show();
}
async function time(/** @type {ArrayBuffer} */ buf) {
  $('bview').hidden = false;
  run.timings = await timings(buf, { exportToo: /** @type {HTMLInputElement} */ ($('bexport')).checked, canvas: /** @type {HTMLCanvasElement} */ ($('bview')), readback: new URLSearchParams(location.search).has('readback'), say });
  show();
}
/** The newest RAF in the editor's Library on this phone, if there is one (app/store.js keeps them). */
async function fromLibrary() {
  try {
    if (!(await indexedDB.databases()).some((d) => d.name === 'th-editor')) return null;
    const db = /** @type {IDBDatabase} */ (await new Promise((res, rej) => { const r = indexedDB.open('th-editor'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
    const all = /** @type {{ id: string, taken: number }[]} */ (await new Promise((res, rej) => { const q = db.transaction('photos').objectStore('photos').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }));
    db.close();
    const newest = all.sort((a, b) => b.taken - a.taken)[0];
    if (!newest) return null;
    return await (await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('raw')).getFileHandle(`${newest.id}.raf`)).getFile()).arrayBuffer();
  } catch { return null; }
}

$('bcheck').addEventListener('click', async () => { await begin(); try { await check(); end(null); } catch (e) { console.error(e); end(e); } });
$('ball').addEventListener('click', async () => {
  await begin();
  try {
    await check();
    const buf = await fromLibrary();
    if (!buf) { end(null); say('The pictures are checked. There is no photo in the Library to time: open a RAF with "Time a RAF".'); return; }
    await time(buf); end(null);
  } catch (e) { console.error(e); end(e); }
});
file.addEventListener('change', async () => {
  const f = file.files?.[0];
  if (!f) return;
  await begin();
  try { await time(await f.arrayBuffer()); end(null); } catch (e) { console.error(e); end(e); }
  file.value = '';
});
$('bcopy').addEventListener('click', async () => {
  // the squares' means go along only for a picture that differs: they say where
  const lean = { ...run, shots: Object.fromEntries(Object.entries(run.shots || {}).map(([k, s]) => [k, run.verdict?.[k]?.same ? { ...s, grid: undefined } : s])) };
  const t = `${out.textContent}\n${JSON.stringify(lean)}`;
  try { await navigator.clipboard.writeText(t); say('Copied.'); } catch { const r = document.createRange(); r.selectNodeContents(out); getSelection()?.removeAllRanges(); getSelection()?.addRange(r); say('Select and copy the text above.'); }
});
const last = past()[0];
if (last) { out.textContent = `The last run on this phone:\n${text(last, past()[1])}`; }
document.documentElement.dataset.bench = 'ready';   // the buttons answer from here on (the page may reload once first, to run threads)
