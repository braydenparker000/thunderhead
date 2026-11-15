// The bytes Astra's range reader holds (http-source.js), and the reads waiting for them. A block is 1 MiB of
// the file. A whole one sits in the LRU cache (`blocks`); one still arriving, or one a download broke off in,
// is a record {index, bytes, from, filled}: bytes [from, filled) of the block, in an array of the block's own
// length that a download only ever writes past `filled`, so a view of what has arrived stays valid. A read is
// answered as soon as its bytes have arrived, from whichever of these holds them. The film's remembered ranges
// (film-memory.js) are records too, whose bytes begin at byte `skew` of the block.

export const BLOCK = 1 << 20;
const PARTS = 6; // unfinished blocks kept (one per download that broke off, or that began inside a block)

/** The first byte of [start, end) that is not here yet (end when all of it is). */
export function missing(source, start, end) {
  let at = start;
  while (at < end) {
    const i = Math.floor(at / BLOCK), off = at - i * BLOCK;
    if (source.blocks.has(i)) { at = (i + 1) * BLOCK; continue; }
    const rec = covering(source, i, off);
    if (!rec) return at;
    at = i * BLOCK + rec.filled;
  }
  return Math.min(at, end);
}

/** A record of block i that holds byte `off` of it. */
function covering(source, i, off) {
  for (const rec of source.filling) if (rec.index === i && rec.from <= off && off < rec.filled) return rec;
  const part = source.partials.get(i);
  if (part && part.from <= off && off < part.filled) return part;
  for (const kept of source.kept || []) if (kept.index === i && kept.from <= off && off < kept.filled) return kept;
  return null;
}

/** Bytes [start, end), all of which are here: a view when one array holds them, else a copy. */
export function assemble(source, start, end) {
  const pieces = [];
  for (let at = start; at < end;) {
    const i = Math.floor(at / BLOCK), off = at - i * BLOCK;
    const whole = source.blocks.get(i), rec = whole ? null : covering(source, i, off);
    const bytes = whole || rec.bytes, stop = whole ? whole.length : rec.filled, skew = rec?.skew || 0;
    const n = Math.min(stop - off, end - at);
    pieces.push(bytes.subarray(off - skew, off - skew + n)); at += n;
  }
  if (pieces.length === 1) return pieces[0];
  const out = new Uint8Array(end - start);
  let offset = 0;
  for (const p of pieces) { out.set(p, offset); offset += p.length; }
  return out;
}

/** Keeps what arrived of a block a download did not finish, so the next asks only for the rest. */
export function keepPart(source, rec) {
  if (source.closed || !(rec.filled > rec.from) || source.blocks.has(rec.index)) return;
  const old = source.partials.get(rec.index);
  // A record that ends where the kept one starts or later is worth less than one that starts the block.
  if (old && old !== rec && old.from === 0 && rec.from > 0 && old.filled >= rec.from) return;
  source.partials.delete(rec.index);
  source.partials.set(rec.index, rec);
  while (source.partials.size > PARTS) source.partials.delete(source.partials.keys().next().value);
}

/** The kept part a download starting at byte `at` of block i continues (it begins at or before, and reaches it). */
export function takePart(source, i, at) {
  const part = source.partials.get(i), off = at - i * BLOCK;
  if (!part || part.from > off || part.filled < off) return null;
  source.partials.delete(i);
  return part;
}

/** Answers every waiting read whose bytes have all arrived. */
export function arrived(source) {
  for (const w of [...source.waiters]) {
    if (missing(source, w.start, w.end) < w.end) continue;
    source.waiters.delete(w);
    w.resolve(assemble(source, w.start, w.end));
  }
}

/** The byte a waiting read needs next. */
export const need = (source, w) => missing(source, w.start, w.end);
