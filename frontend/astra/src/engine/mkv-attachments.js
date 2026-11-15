// The fonts attached to a Matroska file, for libass (subtitles/libass.js): a
// styled (ASS/SSA) track names fonts the film carries as attachments. Only
// where the Attachments element sits is learned while the file is described
// (mkv.js); its files are read here when a styled track is chosen, through the
// range reader, a header at a time, so other attachments (cover pictures) and
// the film around them are never downloaded. Bounded: fonts only, at most
// MAX_FILES of them and MAX_BYTES in all, every size checked against the
// element that holds it.

import {MKV_ID as ID, header, string} from './mkv.js';

export const MAX_FONT_BYTES = 40 << 20, MAX_FONT_FILES = 60;
const FONT_TYPES = new Set(['application/x-truetype-font', 'application/vnd.ms-opentype', 'application/x-font-ttf', 'application/x-font-otf', 'application/font-sfnt', 'application/font-woff', 'application/x-font-woff']);
const FONT_NAME = /\.(ttf|otf|ttc|woff2?)$/i;

/** Whether an attachment is a font, by its media type or its file name. */
export const isFont = (name = '', type = '') => FONT_TYPES.has(type.toLowerCase()) || /^font\//i.test(type) || FONT_NAME.test(name);

/**
 * Reads the font attachments of the Attachments element at `at`.
 * @param {(start: number, end: number) => Promise<Uint8Array>} read  bytes [start, end) of the file
 * @param {number} size  the file's size
 * @param {number} at    where the Attachments element starts (layout.attachments)
 * @returns {Promise<Array<{name: string, type: string, data: Uint8Array}>>}  [] when there is none or the element is not there
 */
export async function readFonts(read, size, at, {maxBytes = MAX_FONT_BYTES, maxFiles = MAX_FONT_FILES} = {}) {
  const fonts = [];
  if (!(at >= 0) || !(size > at)) return fonts;
  const headAt = async pos => {
    const h = header(await read(pos, Math.min(size, pos + 16)), 0);
    return h && h.size != null ? {...h, dataStart: pos + h.dataStart, dataEnd: pos + h.dataStart + h.size} : null;
  };
  const top = await headAt(at);
  if (!top || top.id !== ID.Attachments) return fonts;
  const end = Math.min(size, top.dataEnd);
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
        const text = string(await read(f.dataStart, f.dataEnd), 0, f.size);
        if (f.id === ID.FileName) name = text; else type = text;
      } else if (f.id === ID.FileData) data = f;
    }
    if (!data?.size || !isFont(name, type) || total + data.size > maxBytes) continue;
    total += data.size;
    fonts.push({name, type, data: (await read(data.dataStart, data.dataEnd)).slice()});
  }
  return fonts;
}
