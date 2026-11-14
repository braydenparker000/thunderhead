// @ts-check
// What the home page passes on of the editor's timings (timings.js), with nothing of the page in it so a node
// test runs it: whether there is anything new and it is time, and the file's words. Known fields only, numbers
// and a few fixed words, so nothing else the editor's storage might hold can ride along.

/** At most this often. */
export const EVERY_MS = 10 * 60_000;   // (six hours until 2026-11-13: a session's timings then reached the workshop a day late; the file is about a kilobyte)
const KINDS = ['open', 'full', 'detail', 'fine', 'save', 'tune', 'check', 'move', 'turn'];   // move: a gesture on the photo, turn: a turn of the dial (lab/editor/app/moved.js; pct: how far the photo was zoomed in); tune: the engine test page's measure of the network (lab/engine/net-ui.js); check: the known photo developed on the phone and held against the reference (lab/engine/checked.js)
const NUMBERS = ['at', 'ms', 'heard', 'decode', 'threads', 'code', 'wasm', 'pool', 'waited', 'age', 'px', 'files', 'bytes', 'gpu', 'read', 'write', 'demosaic', 'noise', 'sharpen', 'warp', 'colour', 'net', 'fell', 'made', 'wait', 'off', 'first', 'kept', 'again', 'held',
  ...['op', 'alt', 'wid', 'one', 'blk', 'nar'].flatMap((k) => Array.from({ length: 16 }, (_, i) => `${k}${i}`)),   // the network's passes timed apart: as the phone runs them (an export: net-tune.js `timed`), and on the engine test page each other way too (-1 none, -2 it did not compile)
  'laid', 'whole', 'chosen', 'floats', 'after', 'ways', 'apart', 'apartc', 'cpu1', 'cpun', 'fuse1', 'fusen', 'gpu1', 'tog', 'togn', 'togl',
  'shots', 'same', 'diff', 'offdb', 'offgrid', 'netdb', 'netndb',
  'frames', 'worst', 'slow', 'busy', 'parts', 'part', 'left', 'pct'];   // move: a pinch, pan or glide (frames drawn, the longest gap, gaps over two frames' time, whether a full-size view was being made); parts, part, left: a full-size view made a part at a time (how many, the longest on the GPU, whether it was left for a touch): lab/editor/app/moved.js, zoom.js   // the picture check: how many pictures, how many the reference's, which are not (a bit each), the furthest off, the network's truth to the scene (lab/engine/checked.js `numbers`)   // that page's whole-window times, the ways kept, how far the pictures are from full floats (thousandths of a level), and the CPU's speed (hundredths of a thousand million multiply-adds a second)
const WORDS = /** @type {Record<string, RegExp>} */ ({ file: /^(raf|jpeg|stack)$/, kinds: /^(JPEG|PNG|TIFF)( (JPEG|PNG|TIFF)){0,7}$/ });

/** The stored list made safe: each entry's known fields only. @param {unknown} stored @returns {Record<string, number | string | boolean>[]} */
export function clean(stored) {
  if (!Array.isArray(stored)) return [];
  const out = [];
  for (const e of stored.slice(-120)) {
    if (!e || typeof e !== 'object' || !KINDS.includes(e.kind) || !Number.isFinite(e.at) || !Number.isFinite(e.ms)) continue;
    /** @type {Record<string, number | string | boolean>} */
    const o = { kind: e.kind };
    for (const k of NUMBERS) if (Number.isFinite(e[k])) o[k] = Math.round(e[k]);
    for (const [k, re] of Object.entries(WORDS)) if (typeof e[k] === 'string' && re.test(e[k])) o[k] = e[k];
    if (typeof e.quick === 'boolean') o.quick = e.quick;
    out.push(o);
  }
  return out;
}

const WAYS = ['classic', 'faster', 'network', 'camera', 'file'];
/** The owner's verdicts from the compare page (lab/editor/compare/), made safe: where on the photo (as fractions),
 * how far in, which two ways were shown and which was picked. Never which photo. @param {unknown} stored
 * @returns {{ at: number, x: number, y: number, zoom: number, a: string, b: string, picked: string }[]} */
export function cleanMarks(stored) {
  if (!Array.isArray(stored)) return [];
  const out = [];
  for (const m of stored.slice(-200)) {
    if (!m || typeof m !== 'object' || ![m.at, m.x, m.y, m.zoom].every(Number.isFinite) || ![m.a, m.b, m.picked].every((w) => WAYS.includes(w))) continue;
    out.push({ at: Math.round(m.at), x: Math.round(m.x * 1e4) / 1e4, y: Math.round(m.y * 1e4) / 1e4, zoom: Math.round(m.zoom * 100) / 100, a: m.a, b: m.b, picked: m.picked });
  }
  return out;
}

/** True when there is a timing newer than the last one sent, and the last send was long enough ago.
 * @param {{ last?: number, when?: number }} sent @param {{ at?: any }[]} list @param {number} now */
export const due = (sent, list, now) => list.length > 0 && Number(list[list.length - 1].at) > (sent.last || 0) && now - (sent.when || 0) >= EVERY_MS;

/** The file: the build and the phone in a few words, then the timings.
 * @param {ReturnType<typeof clean>} list @param {{ build: string, agent: string, cores: number, memory: number }} phone
 * @param {ReturnType<typeof cleanMarks>} [marks] the compare page's verdicts, which ride in the same file */
export const fileOf = (list, phone, marks = []) => JSON.stringify({ v: 1, build: phone.build, agent: phone.agent.slice(0, 200), cores: phone.cores, memory: phone.memory, timings: list, marks });
