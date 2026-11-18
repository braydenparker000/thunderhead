// How libmedia reads a film (software.js): a custom loader over Astra's range reader, with the few fixes of the
// file's own bytes libmedia needs. In a Matroska film the fonts attached are Void and zeros to it (mkv-hide.js):
// libmedia reads an Attachments element whole and steps over any other by reading through it, so an 8 MB font was
// 8 MB downloaded before the first picture (an HEVC 10-bit film at 5.4 Mbit/s: 14.0 s to the first picture, 2.2 s
// without the font).

import {hideElements} from './mkv-hide.js';

const IO_END = -1048576; // libmedia's end-of-stream for custom loaders
const READ_CHUNK = 1 << 20;
// libmedia asked for 1 MiB at a time and had nothing until all of it had come (1.5 s at 5.4 Mbit/s, eight seconds of
// a 1.3 Mbit/s film): it is given what is here already, and at least this much, as it arrives.
const FIRST = 64 << 10;

// libmedia matches an AVI's codec tag by exact case; files also carry these in lower case.
const AVI_TAGS = new Set(['XVID', 'DIVX', 'DX50', 'DIV3', 'DIV4', 'MP43', 'MP42', 'MJPG', 'WMV1', 'WMV2', 'WMV3', 'FMP4', 'H264']);
/** Writes a video stream's codec tags in the case libmedia knows, in the bytes of an AVI's header. */
export function fixAviTags(bytes) {
  const tag = at => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  const upper = at => { const t = tag(at).toUpperCase(); if (t !== tag(at) && AVI_TAGS.has(t)) for (let i = 0; i < 4; i++) bytes[at + i] = t.charCodeAt(i); };
  for (let i = 0; i + 64 < bytes.length && i < 65536; i++) {
    if (tag(i) !== 'strh' || tag(i + 8) !== 'vids') continue;
    upper(i + 12); // fccHandler
    for (let k = i + 16; k < i + 200 && k + 28 < bytes.length; k++) if (tag(k) === 'strf') { upper(k + 24); break; } // biCompression
  }
  return bytes;
}

/** How far into a Matroska file its track list is looked for (it is at the start unless the file was written oddly). */
const MKV_HEAD = 4 << 20;
/** Names MPEG Layer I and II sound as Layer III in the bytes of a Matroska file's track list ("A_MPEG/L2" to
 * "A_MPEG/L3": the same length). libmedia opens its MP3 build only for a track it reads as Layer III, and that
 * build decodes all three layers, each frame saying which it is. A name split across two reads is missed, and
 * the film then plays without sound, as it did. */
export function fixMkvLayers(bytes) {
  const NAME = [0x41, 0x5f, 0x4d, 0x50, 0x45, 0x47, 0x2f, 0x4c]; // "A_MPEG/L"
  for (let i = bytes.indexOf(0x41); i >= 0 && i + 8 < bytes.length; i = bytes.indexOf(0x41, i + 1)) {
    if (NAME.every((c, k) => bytes[i + k] === c) && (bytes[i + 8] === 0x31 || bytes[i + 8] === 0x32)) bytes[i + 8] = 0x33;
  }
  return bytes;
}

/** A libmedia reader over Astra's HttpSource. */
export function sourceLoader(AVPlayer, source, ext = '') {
  const plain = (s, e) => source.read(s, e), read = ext === 'mkv' ? hideElements(plain, source.size, {fill: true}) : plain;
  return new class extends AVPlayer.IOLoader.CustomIOLoader {
    constructor() { super(); this.pos = 0; this.stopped = false; }
    get ext() { return ext; }
    get name() { return 'Astra'; }
    get flags() { return 1; } // seekable
    async open() { this.stopped = false; return 0; }
    async read(buffer) {
      if (this.stopped || this.pos >= source.size) return IO_END;
      const most = Math.min(buffer.length, source.size - this.pos, READ_CHUNK);
      const n = read.zeros?.(this.pos) ? most : Math.min(most, Math.max(FIRST, source.cachedUntil(this.pos) - this.pos));
      const bytes = await read(this.pos, this.pos + n);
      buffer.set(ext === 'avi' && this.pos < 65536 ? fixAviTags(bytes.slice()) : ext === 'mkv' && this.pos < MKV_HEAD ? fixMkvLayers(bytes.slice()) : bytes);
      this.pos += bytes.length;
      return bytes.length;
    }
    async seek(pos) { const p = Number(pos); if (!Number.isSafeInteger(p) || p < 0) return -1; this.pos = p; return 0; }
    async size() { return BigInt(source.size); }
    async stop() { this.stopped = true; }
  }();
}
