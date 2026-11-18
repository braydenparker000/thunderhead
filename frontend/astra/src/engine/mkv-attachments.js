// The fonts attached to a Matroska file, for libass (subtitles/libass.js): a
// styled (ASS/SSA) track names fonts the film carries as attachments. Only
// where the Attachments element sits is learned while the file is described
// (mkv.js); its files are read here when a styled track is chosen, beside
// playback (sideReader), so other attachments larger than a window (cover
// pictures) and the film around them are never downloaded. Bounded: fonts
// only, at most MAX_FILES of them and MAX_BYTES in all, every size checked
// against the element that holds it.

import {MKV_ID as ID, header, string} from './mkv.js';

export const MAX_FONT_BYTES = 40 << 20, MAX_FONT_FILES = 60;
const FONT_TYPES = new Set(['application/x-truetype-font', 'application/vnd.ms-opentype', 'application/x-font-ttf', 'application/x-font-otf', 'application/font-sfnt', 'application/font-woff', 'application/x-font-woff']);
const FONT_NAME = /\.(ttf|otf|ttc|woff2?)$/i;

const WINDOW = 1 << 20, MARGIN = 4 << 10;

/**
 * Reads for readFonts() beside playback (player-libass.js): what the reader holds already, else requests of their own
 * (side reads: never a download playback reads from), each of a window of the element (1 MiB, so the headers and the
 * small fonts that follow come with it) or of a larger font's data and the next header. Read through the reader's
 * downloads, an 8 MB font began one that read on past it into the film playback was reading already, and 2 MB of the
 * film came twice (scripts/astra/real.mjs, 2026-11-18).
 */
export function sideReader(source) {
  let held = null; // the last answer: {start, bytes}
  return async (start, end, upTo = source.size) => {
    const here = source.peek(start, end);
    if (here) return here;
    if (held && start >= held.start && end <= held.start + held.bytes.length) return held.bytes.subarray(start - held.start, end - held.start);
    held = {start, bytes: await source.sideRead(start, Math.max(end, Math.min(upTo, Math.max(start + WINDOW, end + MARGIN))))};
    return held.bytes.subarray(0, end - start);
  };
}

/** Whether an attachment is a font, by its media type or its file name. */
export const isFont = (name = '', type = '') => FONT_TYPES.has(type.toLowerCase()) || /^font\//i.test(type) || FONT_NAME.test(name);

/**
 * Reads the font attachments of the Attachments element at `at`.
 * @param {(start: number, end: number, upTo?: number) => Promise<Uint8Array>} read  bytes [start, end) of the file (`upTo`: the element's end, the furthest worth reading on to)
 * @param {number} size  the file's size
 * @param {number} at    where the Attachments element starts (layout.attachments)
 * @returns {Promise<Array<{name: string, type: string, data: Uint8Array}>>}  [] when there is none or the element is not there
 */
export async function readFonts(read, size, at, {maxBytes = MAX_FONT_BYTES, maxFiles = MAX_FONT_FILES} = {}) {
  const fonts = [];
  if (!(at >= 0) || !(size > at)) return fonts;
  let end = size;
  const headAt = async pos => {
    const h = header(await read(pos, Math.min(end, pos + 16), end), 0);
    return h && h.size != null ? {...h, dataStart: pos + h.dataStart, dataEnd: pos + h.dataStart + h.size} : null;
  };
  const top = await headAt(at);
  if (!top || top.id !== ID.Attachments) return fonts;
  end = Math.min(size, top.dataEnd);
  let total = 0;
  // A damaged file can claim endless tiny files: the walk stops after a fair number.
  for (let pos = top.dataStart, guard = 0; pos < end && guard < 4 * maxFiles && fonts.length < maxFiles; guard++) {
    const file = await headAt(pos);
    if (!file || file.dataEnd > end) break;
    pos = file.dataEnd;
    if (file.id !== ID.AttachedFile) continue;
    let name = '', type = '', data = null;
    for (let c = file.dataStart, n = 0; c < file.dataEnd && n < 16; n++) {
      const f = await headAt(c);
      if (!f || f.dataEnd > file.dataEnd) break;
      c = f.dataEnd;
      if ((f.id === ID.FileName || f.id === ID.FileMediaType) && f.size <= 1024) {
        const text = string(await read(f.dataStart, f.dataEnd, end), 0, f.size);
        if (f.id === ID.FileName) name = text; else type = text;
      } else if (f.id === ID.FileData) { data = f; if (name && type) break; } // what follows (its id) would cost a request
    }
    if (!data?.size || !isFont(name, type) || total + data.size > maxBytes) continue;
    total += data.size;
    fonts.push({name, type, data: (await read(data.dataStart, data.dataEnd, end)).slice()});
  }
  return fonts;
}
