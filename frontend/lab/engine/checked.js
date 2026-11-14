// @ts-check
// The picture check, made by itself. bench.js `pictures` develops a made-up photo whose every colour is known on
// this phone's own graphics chip, every way the editor does (the network among them, in the half floats no test
// machine can run), and `judge` holds each result against the reference GPU's numbers. That was a button on the
// engine test page that the owner had to find, press and paste from. Now the editor makes it once for each
// release, a while after its Library shows, keeps the verdict, and notes it with the timings (a few numbers,
// about the made-up photo and nothing else): a driver that makes a slightly wrong picture is known of without
// the owner testing anything. The button makes the same check and keeps it the same way.
import { BUILD } from './build.js';
import { judge, pictures } from './bench.js';

const KEY = 'th.pictures.checked', TIMINGS = 'th.editor.timings';
/** What a check came to: which release made it, on which chip, how many of its pictures are the reference's, the
 * names of those that are not, and the furthest any is off (dB, and a square's mean of 1).
 * @typedef {{ build: string, at: number, ms: number, gpu: string, shots: number, same: number, different: string[], db: number, grid: number, net: number, netNoisy: number }} Checked */

/** The last check kept on this phone, or null. @returns {Checked | null} */
export const last = () => { try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); return c && typeof c.build === 'string' && Array.isArray(c.different) ? c : null; } catch { return null; } };

/** A check's verdict in a few numbers. @param {Record<string, import('./bench.js').Shot>} shots @param {ReturnType<typeof judge>} verdict */
export function summed(shots, verdict) {
  const names = Object.keys(shots), different = names.filter((n) => !verdict[n]?.same);
  const worst = (/** @type {'db' | 'grid'} */ k) => Math.max(0, ...names.map((n) => Number(/** @type {any} */ (verdict[n])?.[k]) || 0));
  return { shots: names.length, same: names.length - different.length, different, db: worst('db'), grid: worst('grid'), net: shots.network?.psnr ?? 0, netNoisy: shots.networkNoisy?.psnr ?? 0 };
}
/** The check as one of the editor's timings (th/workshop/timings-core.js passes on the fields it knows): how many
 * pictures, how many the same, which are not (a bit each, in the order they are made), the furthest off in
 * hundredths of a dB and ten-thousandths of a square, and how true the network was to the scene, clean and noisy
 * (hundredths of a dB). @param {Checked} c @param {string[]} names the pictures in the order they are made */
export const numbers = (c, names) => ({ at: c.at, kind: 'check', ms: Math.round(c.ms), shots: c.shots, same: c.same, diff: names.reduce((bits, n, i) => bits | (c.different.includes(n) ? 1 << i : 0), 0),
  offdb: Math.round(100 * c.db), offgrid: Math.round(1e4 * c.grid), netdb: Math.round(100 * c.net), netndb: Math.round(100 * c.netNoisy) });
/** The verdict in a sentence. @param {Checked | null} c */
export const line = (c) => (!c ? 'The pictures have not been checked on this phone yet.'
  : `Checked on this phone, build ${c.build}: ${c.same === c.shots ? `all ${c.shots} pictures are the reference's` : `${c.different.join(', ')} ${c.different.length === 1 ? 'is' : 'are'} not the reference's (off by ${c.db} dB and ${c.grid})`}.`);

/** Makes the check now, keeps its verdict and notes it with the timings. */
export async function check() {
  const began = performance.now(), [got, ref] = await Promise.all([pictures(), fetch(new URL('./bench-ref.json', import.meta.url)).then((r) => r.json())]);
  const verdict = judge(got.shots, ref.shots), checked = /** @type {Checked} */ ({ build: BUILD, at: Date.now(), ms: Math.round(performance.now() - began), gpu: got.gpu, ...summed(got.shots, verdict) });
  try {
    localStorage.setItem(KEY, JSON.stringify(checked));
    const all = JSON.parse(localStorage.getItem(TIMINGS) || '[]'); all.push(numbers(checked, Object.keys(got.shots))); localStorage.setItem(TIMINGS, JSON.stringify(all.slice(-120)));
  } catch { /* a private window: nothing is kept */ }
  return { ...got, verdict, checked };
}
/** Makes the check if this release has not made one on this phone (never in a browser a test drives, unless
 * `force`). Gives what it came to, or null where there was nothing to do. @param {{ force?: boolean }} [o] */
export async function onceForBuild(o = {}) {
  if (!o.force && (navigator.webdriver || last()?.build === BUILD)) return null;
  return (await check()).checked;
}
