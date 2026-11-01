// The two files the listening pass keeps in the private bucket (DATA.md §7.1), with no I/O here.
//
// `music/neighbours.v1.bin`, the last neighbours job's answer: 'THN1', n and k (uint32 LE), 4 bytes
// of zero, then the n audio hashes in the spec's order (32 bytes each, sorted), then n × k uint16:
// row i is hash i's nearest hashes, nearest first, 0xFFFF for none.
//
// `music/pack.v1.bin`, the phone's one file (MUSIC.md §9.1): 'THA1', the header's length (uint32 LE)
// and the header as JSON (`sections` names each section's [offset, bytes]; every section starts on
// a 4-byte boundary, so the phone reads each as a typed array view), then the sections, one entry
// per analysed track in catalog order: `ids` (the track ids joined by "\n"), `bpm` (uint16, bpm×10,
// 0 unknown), `camelot` (uint8: 1A=1, 1B=2 … 12B=24, 0 unknown), `energy`, `valence`, `arousal`,
// `vocals` (uint8, 0–250 = 0–1, 255 unknown), `moods` (uint8 × 16 a track, in the header's order),
// `emb` (int8 × 32, each track scaled by its own largest value: cosine needs no scale), `nbr`
// (uint16 × k, the nearest tracks as indexes into this file, 0xFFFF none). About 2.8 MB at 12,000.
import { ANALYZER, LISTEN_LIMITS as L, MOODS } from '../../../../shared/contract/listen.ts';
import { PACK_BYTES } from './listen-check';

export const NEIGHBOURS_KEY = 'music/neighbours.v1.bin';
export const PACK_KEY = 'music/pack.v1.bin';
const NONE16 = 0xffff;

const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const bytesOf = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => Number.parseInt(x, 16));

export interface Neighbours {
  n: number;
  k: number;
  /** Hex hashes in the file's order, and each one's place. */
  order: string[];
  at: Map<string, number>;
  nbr: Uint16Array;
}

/** The stored neighbours file from the spec's order and the job's checked answer. */
export function neighboursFile(order: Uint8Array, nbr: Uint8Array, n: number, k: number): Uint8Array {
  const out = new Uint8Array(16 + n * 32 + n * k * 2);
  out.set([0x54, 0x48, 0x4e, 0x31]);
  const v = new DataView(out.buffer);
  v.setUint32(4, n, true);
  v.setUint32(8, k, true);
  out.set(order.subarray(0, n * 32), 16);
  out.set(nbr.subarray(0, n * k * 2), 16 + n * 32);
  return out;
}

export function readNeighbours(b: Uint8Array): Neighbours | null {
  if (b.length < 16 || b[0] !== 0x54 || b[1] !== 0x48 || b[2] !== 0x4e || b[3] !== 0x31) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.length);
  const n = v.getUint32(4, true);
  const k = v.getUint32(8, true);
  if (b.length !== 16 + n * 32 + n * k * 2) return null;
  const order: string[] = [];
  for (let i = 0; i < n; i++) order.push(hexOf(b.subarray(16 + i * 32, 48 + i * 32)));
  const copy = b.slice(16 + n * 32);
  return { n, k, order, at: new Map(order.map((h, i) => [h, i])), nbr: new Uint16Array(copy.buffer, 0, n * k) };
}

/** The spec of a neighbours job: hashes in order (raw bytes) and their int8 embeddings. */
export function neighboursSpec(rows: { sha256: string; pack: Uint8Array }[]): { order: Uint8Array; emb: Uint8Array } {
  const order = new Uint8Array(rows.length * 32);
  const emb = new Uint8Array(rows.length * L.dim);
  for (const [i, r] of rows.entries()) {
    order.set(bytesOf(r.sha256), i * 32);
    emb.set(r.pack.subarray(24, 24 + L.dim), i * L.dim);
  }
  return { order, emb };
}

const align = (n: number) => (n + 3) & ~3;

/** The phone file from the tracks with an analysis (catalog order) and the last neighbours. */
export function buildPack(
  rows: { id: string; sha256: string; pack: Uint8Array }[],
  nb: Neighbours | null,
  meta: { built_at: number; neighbours_at: number | null },
): Uint8Array {
  const t = rows.length;
  const k = L.k;
  const ids = new TextEncoder().encode(rows.map((r) => r.id).join('\n'));
  const sizes: [string, number][] = [
    ['ids', ids.length],
    ['bpm', t * 2],
    ['camelot', t],
    ['energy', t],
    ['valence', t],
    ['arousal', t],
    ['vocals', t],
    ['moods', t * MOODS.length],
    ['emb', t * L.dim],
    ['nbr', t * k * 2],
  ];
  // The header's length depends on the offsets it names: lay out once with a generous guess, then
  // again with the real length (offsets only grow by the second pass's few digits).
  let head = 0;
  let header = '';
  let sections: Record<string, [number, number]> = {};
  for (let pass = 0; pass < 3; pass++) {
    let at = align(8 + head);
    sections = {};
    for (const [name, size] of sizes) {
      sections[name] = [at, size];
      at = align(at + size);
    }
    header = JSON.stringify({
      v: 1,
      tracks: t,
      k,
      dim: L.dim,
      scale: 250,
      moods: MOODS,
      analyzer: ANALYZER.version,
      built_at: meta.built_at,
      neighbours_at: meta.neighbours_at,
      sections,
    });
    const len = new TextEncoder().encode(header).length;
    if (len === head) break;
    head = len;
  }
  const end = Math.max(...Object.values(sections).map(([o, s]) => o + s));
  const out = new Uint8Array(align(end));
  out.set([0x54, 0x48, 0x41, 0x31]);
  const view = new DataView(out.buffer);
  view.setUint32(4, head, true);
  out.set(new TextEncoder().encode(header), 8);
  out.set(ids, sections.ids[0]);
  const at = (name: string) => sections[name][0];
  const first = new Map<string, number>();
  for (const [i, r] of rows.entries()) if (!first.has(r.sha256)) first.set(r.sha256, i);
  for (const [i, r] of rows.entries()) {
    const p = r.pack.length === PACK_BYTES ? r.pack : new Uint8Array(PACK_BYTES);
    view.setUint16(at('bpm') + i * 2, p[0] | (p[1] << 8), true);
    out[at('camelot') + i] = p[2];
    out[at('energy') + i] = p[3];
    out[at('valence') + i] = p[4];
    out[at('arousal') + i] = p[5];
    out[at('vocals') + i] = p[6];
    out.set(p.subarray(8, 8 + MOODS.length), at('moods') + i * MOODS.length);
    out.set(p.subarray(24, 24 + L.dim), at('emb') + i * L.dim);
    // Nearest first; a neighbour no longer in the catalog is skipped, the row ends in 0xFFFF.
    const row = nb?.at.get(r.sha256);
    let j = 0;
    if (nb && row !== undefined && t < NONE16)
      for (let q = 0; q < nb.k && j < k; q++) {
        const x = nb.nbr[row * nb.k + q];
        const to = x === NONE16 ? undefined : first.get(nb.order[x]);
        if (to !== undefined && to !== i) view.setUint16(at('nbr') + (i * k + j++) * 2, to, true);
      }
    for (; j < k; j++) view.setUint16(at('nbr') + (i * k + j) * 2, NONE16, true);
  }
  return out;
}

/** A pack's header (tests and tools). */
export function packHeader(
  b: Uint8Array,
): { tracks: number; sections: Record<string, [number, number]> } & Record<string, unknown> {
  const len = new DataView(b.buffer, b.byteOffset, b.length).getUint32(4, true);
  return JSON.parse(new TextDecoder().decode(b.subarray(8, 8 + len)));
}
