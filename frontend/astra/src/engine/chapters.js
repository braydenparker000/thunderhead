// A film's chapters, read from the file: Matroska's Chapters element and an
// MP4's Nero chapter list (`chpl`, which ffmpeg and most taggers write). Every
// size and count comes from the file, so each is held to what its element has
// room for: a few hundred chapters at most, titles cut at 200 characters.
// Times are seconds on the file's own clock; the player shifts them as it
// shifts everything else for files that start after zero.

import {children, uint} from './mkv.js';

export const MAX_CHAPTERS = 500;
const TITLE = 200;
const ID = {
  EditionEntry: 0x45b9, EditionFlagHidden: 0x45bd, EditionFlagDefault: 0x45db, EditionFlagOrdered: 0x45dd,
  ChapterAtom: 0xb6, ChapterTimeStart: 0x91, ChapterTimeEnd: 0x92, ChapterFlagHidden: 0x98, ChapterFlagEnabled: 0x4598,
  ChapterDisplay: 0x80, ChapString: 0x85,
};
const decoder = new TextDecoder();
const text = bytes => decoder.decode(bytes).replace(/\0+$/, '').trim().slice(0, TITLE);

/**
 * The chapters of a Matroska Chapters element's body: the default edition's (else the first one shown), leaving out
 * hidden and ordered editions (an ordered edition plays parts of the file in another order, which Astra does not
 * follow) and hidden or disabled chapters. Nested chapters are left out: the top level is what a seek bar shows.
 */
export function mkvChapters(bytes) {
  const editions = [];
  for (const e of children(bytes, 0, bytes.length)) {
    if (e.id !== ID.EditionEntry) continue;
    const edition = {hidden: false, default: false, ordered: false, atoms: []};
    for (const f of children(bytes, e.dataStart, e.dataEnd)) {
      if (f.id === ID.EditionFlagHidden) edition.hidden = uint(bytes, f.dataStart, f.dataEnd) === 1;
      else if (f.id === ID.EditionFlagDefault) edition.default = uint(bytes, f.dataStart, f.dataEnd) === 1;
      else if (f.id === ID.EditionFlagOrdered) edition.ordered = uint(bytes, f.dataStart, f.dataEnd) === 1;
      else if (f.id === ID.ChapterAtom && edition.atoms.length < MAX_CHAPTERS) edition.atoms.push(f);
    }
    editions.push(edition);
  }
  const shown = editions.filter(e => !e.hidden && !e.ordered);
  const edition = shown.find(e => e.default) || shown[0];
  if (!edition) return [];
  const list = [];
  for (const atom of edition.atoms) {
    let start = null, end = null, hidden = false, enabled = true, title = '';
    for (const f of children(bytes, atom.dataStart, atom.dataEnd)) {
      if (f.id === ID.ChapterTimeStart) start = uint(bytes, f.dataStart, f.dataEnd) / 1e9;
      else if (f.id === ID.ChapterTimeEnd) end = uint(bytes, f.dataStart, f.dataEnd) / 1e9;
      else if (f.id === ID.ChapterFlagHidden) hidden = uint(bytes, f.dataStart, f.dataEnd) === 1;
      else if (f.id === ID.ChapterFlagEnabled) enabled = uint(bytes, f.dataStart, f.dataEnd) !== 0;
      else if (f.id === ID.ChapterDisplay && !title) {
        for (const g of children(bytes, f.dataStart, f.dataEnd)) if (g.id === ID.ChapString) { title = text(bytes.subarray(g.dataStart, g.dataEnd)); break; }
      }
    }
    if (start != null && !hidden && enabled) list.push({start, end, title});
  }
  return list;
}

/** The chapters in an MP4's `chpl` box (in moov/udta), from the movie box's bytes. */
export function mp4Chapters(moov) {
  const chpl = find(moov, ['moov', 'udta', 'chpl']);
  if (!chpl) return [];
  // A full box (version, flags), four more bytes in version 1, a one-byte count, then per chapter: its start in
  // 100 ns units (8 bytes), a title length (1 byte) and the title.
  let p = chpl.start + 4 + (moov[chpl.start] === 1 ? 4 : 0);
  const count = moov[p++] ?? 0, list = [];
  for (let i = 0; i < count && p + 9 <= chpl.end; i++) {
    const start = (u32(moov, p) * 2 ** 32 + u32(moov, p + 4)) / 1e7, length = moov[p + 8];
    p += 9;
    if (p + length > chpl.end) break;
    list.push({start, end: null, title: text(moov.subarray(p, p + length))});
    p += length;
  }
  return list;
}

/**
 * Chapters ready to offer: in order, each ending where it says or where the next begins (the last at the film's
 * end), shifted by `shift` seconds, and without any that start at or after the end. [] when there are none.
 */
export function finishChapters(list, duration = null, shift = 0) {
  const sorted = (list || []).filter(c => Number.isFinite(c.start) && c.start >= 0).sort((a, b) => a.start - b.start).slice(0, MAX_CHAPTERS);
  const out = [];
  sorted.forEach((c, i) => {
    const next = sorted[i + 1]?.start ?? (duration > 0 ? duration : null);
    let end = Number.isFinite(c.end) && c.end > c.start ? c.end : next;
    if (end == null) end = c.start;
    const start = Math.max(0, c.start - shift);
    end = Math.max(start, end - shift);
    if (duration > 0 && start >= duration - shift) return;
    out.push({start: round(start), end: round(duration > 0 ? Math.min(end, duration - shift) : end), title: c.title || `Chapter ${out.length + 1}`});
  });
  return out;
}

const round = s => Math.round(s * 1000) / 1000;
const u32 = (b, p) => (b[p] << 24 | b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3]) >>> 0;

/** The box at a path of types (each the first of its type inside the one before). */
function find(bytes, path) {
  let start = 0, end = bytes.length, box = null;
  for (const type of path) {
    box = null;
    for (let p = start; p + 8 <= end;) {
      const size = u32(bytes, p), name = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
      if (size < 8 || p + size > end) return null;
      if (name === type) { box = {start: p + 8, end: p + size}; break; }
      p += size;
    }
    if (!box) return null;
    start = box.start; end = box.end;
  }
  return box;
}
