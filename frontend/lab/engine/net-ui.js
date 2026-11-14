// @ts-check
// The engine page's "The network on this phone": one button that measures the network (net-bench.js), the result as
// text to read and copy, and the last runs kept in this browser. Its numbers also go where the editor's timings go
// (the owner's own storage, when that setting is on: th/workshop/timings.js), so a run need not be copied by hand.
import { netBench } from './net-bench.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const KEY = 'th.net.bench', TIMINGS = 'th.editor.timings', WAYS = ['read in place', '16 outputs', '1 pixel x 32', '2x2 block', '2x2 block x 4 outputs'];
/** @typedef {import('./net-bench.js').NetRun} NetRun */
const past = () => { try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return /** @type {NetRun[]} */ (Array.isArray(a) ? a : []); } catch { return []; } };
const ms = (/** @type {number | null | undefined} */ v) => (v == null ? '-' : v >= 100 ? String(Math.round(v)) : v.toFixed(1));
const apart = (/** @type {import('./net-bench.js').Apart | null} */ a) => (a ? `${a.mean} / ${a.p999} / ${a.max}` : '-');

/** A run as text: what is read on the page and pasted back. @param {NetRun} r */
export function text(r) {
  const g = r.gpu, lines = [`Thunderhead network test · ${new Date(r.at).toISOString().slice(0, 16).replace('T', ' ')} UTC · build ${r.build} · took ${Math.round(r.took / 1000)} s`];
  lines.push(`GPU: ${[g.vendor, g.architecture, g.device, g.description].filter(Boolean).join(' · ') || 'not named'} · half floats ${g.f16 ? 'yes' : 'no'} (the network runs in ${r.kind})`);
  lines.push(`One window (${r.side} x ${r.side}, ${r.mp} MP), each time the least of ${r.reps}:`);
  const per = (/** @type {number | null} */ v) => (v == null ? '' : `   ${ms(v / r.mp)} ms a megapixel`);
  lines.push(`  as exported           ${ms(r.whole.exported).padStart(7)} ms${per(r.whole.exported)}   (again at the end: ${ms(r.whole.after)} ms)`);
  lines.push(`  by the fastest ways   ${ms(r.whole.chosen).padStart(7)} ms${per(r.whole.chosen)}${r.whole.chosen ? `   ${Math.round((100 * r.whole.chosen) / r.whole.exported)} % of exported` : ''}`);
  if (r.whole.full != null) lines.push(`  in full floats        ${ms(r.whole.full).padStart(7)} ms${per(r.whole.full)}`);
  lines.push(`Each pass, ms: as exported | ${WAYS.join(' | ')}   (* the way tried in the whole window; in brackets, how far from the exported pass's result)`);
  lines.push(`   cut ${ms(r.cut)}`);
  r.ms.forEach((own, j) => {
    const ways = (r.tried[j] || []).map((t, k) => (t.ms === -1 ? '' : t.ms === -2 ? 'did not compile' : `${ms(t.ms)}${r.way[j] === k + 1 ? '*' : ''} (${t.rms === -1 ? 'wrong' : t.rms}${t.odd ? `, ${t.odd[0]} not finite in both, ${t.odd[1]} in one` : ''})`));
    lines.push(`  ${String(j + 1).padStart(2)} ${r.names[j].padEnd(12)} ${ms(own).padStart(7)}${ways.some(Boolean) ? ` | ${ways.map((w) => w || '-').join(' | ')}` : ''}`);
  });
  for (const [j, row] of r.tried.entries()) for (const [k, t] of row.entries()) if (t.ms === -2) lines.push(`  pass ${j + 1}, ${WAYS[k]}, did not compile: ${t.why}`);
  lines.push('The picture against full floats, in levels of 255 (mean / 999th of 1000 / largest):');
  lines.push(`  as exported           ${apart(r.picture.exported)}`);
  lines.push(`  by the fastest ways   ${apart(r.picture.chosen)}`);
  lines.push(`  the two against each other   ${apart(r.picture.between)}`);
  lines.push(`Verdict: ${r.verdict}${r.kept.some(Boolean) ? ` (${r.kept.join('')})` : ''}`);
  for (const d of r.dropped) lines.push(`  left out: ${d}`);
  if (r.cpu) {
    lines.push(`The CPU on the heavy pass's work (${r.cpu.cores} cores), in thousand million multiply-adds a second:`);
    for (const build of ['conv', 'conv-fused']) { const rows = r.cpu.rows.filter((x) => x.build === build); if (rows.length) lines.push(`  ${(build === 'conv' ? 'multiply and add' : 'fused').padEnd(17)} ${rows.map((x) => `${x.cores} core${x.cores === 1 ? '' : 's'} ${x.gmacs}`).join(' · ')}`); }
    for (const n of r.cpu.notes) lines.push(`  ${n}`);
    const heavy = r.gmac.map((gm, j) => ({ gm, j })).sort((a, b) => b.gm - a.gm)[0], t = r.tried[heavy.j] || [], best = Math.min(...t.filter((x) => x.ms >= 0).map((x) => x.ms), Infinity);
    if (heavy.gm > 0) lines.push(`  the GPU on that pass (${r.names[heavy.j]}, ${heavy.gm} thousand million): ${(heavy.gm / (r.ms[heavy.j] / 1000)).toFixed(1)} as exported${Number.isFinite(best) ? `, ${(heavy.gm / (best / 1000)).toFixed(1)} by the fastest of its other ways` : ''}`);
  }
  if (r.both) {
    const b = r.both, sum = (/** @type {{ cpu: number, gpu: number }} */ p) => (p.cpu + p.gpu).toFixed(1), row = (/** @type {typeof b.pairs[number]} */ p) => `${p.cores} cores ${p.cpu} + GPU ${p.gpu} = ${sum(p)}`;
    lines.push(`The CPU and the GPU at once (the GPU alone on its heavy pass: ${b.alone}; the CPU's build: ${b.build === 'conv' ? 'multiply and add' : b.build ? 'fused' : 'none'}):`);
    for (const p of b.pairs) lines.push(`  ${row(p)}   ${b.alone > 0 ? `${((p.cpu + p.gpu) / b.alone).toFixed(2)} times the GPU alone` : ''}`);
    if (b.held.length) lines.push(`  kept up with ${b.held[0].cores} cores: ${b.held.map(sum).join(' · ')}`);
    for (const n of b.notes) lines.push(`  ${n}`);
  }
  return lines.join('\n');
}

/** The CPU and the GPU at once, as numbers (hundredths of a thousand million multiply-adds a second): the GPU alone, the best of the two together and on how many cores, and the last of that kept up. @param {NetRun} r */
const two = (r) => {
  const b = r.both, h = (/** @type {number} */ v) => Math.round(100 * v);
  if (!b || !b.pairs.length) return {};
  const best = b.pairs.reduce((a, p) => (p.cpu + p.gpu > a.cpu + a.gpu ? p : a)), last = b.held.at(-1);
  return { gpu1: h(b.alone), tog: h(best.cpu + best.gpu), togn: best.cores, ...(last ? { togl: h(last.cpu + last.gpu) } : {}) };
};

/** The run's numbers as one of the editor's timings (th/workshop/timings-core.js passes on the fields it knows). @param {NetRun} r */
export function numbers(r) {
  const cpu = (/** @type {string} */ build, /** @type {boolean} */ all) => { const rows = (r.cpu?.rows || []).filter((x) => x.build === build); return Math.round(100 * ((all ? rows.at(-1) : rows[0])?.gmacs || 0)); };
  const row = (/** @type {string} */ name, /** @type {number[]} */ list) => Object.fromEntries(list.map((v, j) => [`${name}${j + 1}`, Math.round(v)]));   // (op0 is the cut, as in an export's timings)
  return { at: r.at, kind: 'tune', ms: r.took, px: Math.round(r.mp * 1e6), op0: Math.round(r.cut), ...row('op', r.ms), ...row('alt', r.tried.map((t) => t[0]?.ms ?? -1)), ...row('wid', r.tried.map((t) => t[1]?.ms ?? -1)), ...row('one', r.tried.map((t) => t[2]?.ms ?? -1)), ...row('blk', r.tried.map((t) => t[3]?.ms ?? -1)), ...row('nar', r.tried.map((t) => t[4]?.ms ?? -1)),
    whole: Math.round(r.whole.exported), chosen: Math.round(r.whole.chosen ?? -1), floats: Math.round(r.whole.full ?? -1), after: Math.round(r.whole.after), ways: Number(r.kept.join('')) || 0,
    apart: Math.round(1000 * (r.picture.exported?.p999 ?? -0.001)), apartc: Math.round(1000 * (r.picture.chosen?.p999 ?? -0.001)), cpu1: cpu('conv', false), cpun: cpu('conv', true), fuse1: cpu('conv-fused', false), fusen: cpu('conv-fused', true), threads: r.cpu?.cores || 0, ...two(r) };
}

const out = $('nout'), go = /** @type {HTMLButtonElement} */ ($('nrun')), copy = /** @type {HTMLButtonElement} */ ($('ncopy'));
let last = past()[0] || null;
if (out && go && copy) {
  if (last) { out.textContent = `The last run on this phone:\n${text(last)}`; copy.disabled = false; }
  go.addEventListener('click', async () => {
    go.disabled = true; copy.disabled = true;
    const say = (/** @type {string} */ s) => { $('nnow').textContent = s; };
    try {
      const q = new URLSearchParams(location.search), r = await netBench({ say, side: Number(q.get('side')) || undefined, reps: Number(q.get('reps')) || undefined, cpu: q.has('cpums') ? { ms: Number(q.get('cpums')) } : true, both: q.has('cpums') ? { ms: 2 * Number(q.get('cpums')), held: 2 } : true });
      try { r.build = String((await import('/config.js')).CONFIG.commit).slice(0, 7); } catch { /* a local run */ }
      last = r; out.textContent = text(r); /** @type {any} */ (window).__net = r;
      try { localStorage.setItem(KEY, JSON.stringify([r, ...past()].slice(0, 6))); const all = JSON.parse(localStorage.getItem(TIMINGS) || '[]'); all.push(numbers(r)); localStorage.setItem(TIMINGS, JSON.stringify(all.slice(-120))); } catch { /* a private window: nothing is kept */ }
      say('Done. The ways it found faster and as true are kept for the editor on this phone. Copy the result and paste it where it is wanted.');
    } catch (err) { console.error(err); say(`Stopped: ${/** @type {any} */ (err)?.message || err}`); }
    go.disabled = false; copy.disabled = !last;
  });
  copy.addEventListener('click', async () => {
    const t = `${last ? text(last) : ''}\n${JSON.stringify(last)}`;
    try { await navigator.clipboard.writeText(t); $('nnow').textContent = 'Copied.'; } catch { const r = document.createRange(); r.selectNodeContents(out); getSelection()?.removeAllRanges(); getSelection()?.addRange(r); $('nnow').textContent = 'Select and copy the text above.'; }
  });
  document.documentElement.dataset.net = 'ready';
}
