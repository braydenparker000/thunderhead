// The writer side of a re-wrapped film (remux.js): Mediabunny's fragmented MP4
// output, each init segment and fragment handed to one SourceBuffer's queue.

import * as MB from '../../vendor/mediabunny.js';
import {toStereo} from './downmix.js';

/** An output whose fragments go to `queue` for `generation`; video fragments may be cut early (early.js). */
export function fragmentWriter(queue, stats, kind, generation, early = null) {
  let head = [], moof = null, at = null; // at: where the fragment begins, in the file's time
  const send = bytes => { stats.appended += bytes.byteLength; queue.append(bytes, generation, at); };
  const format = new MB.Mp4OutputFormat({
    // Video: every key frame, real or early (early.js), begins a fragment. Sound: a quarter of a second, as the sound
    // worker writes it: the film cannot play at a new place before the sound's first fragment is in, and with 1 s ones
    // a far seek on a 25 Mbit/s film with its AAC track took 4.5 s instead of 3.5 (page six times slower, 20 Mbit/s).
    fastStart: 'fragmented', minimumFragmentDuration: kind === 'audio' ? 0.25 : 0,
    onFtyp: data => { head.push(data.slice()); },
    onMoov: data => { head.push(data.slice()); send(concat(head)); head = []; },
    onMoof: (data, position, timestamp) => { moof = data.slice(); at = timestamp; early?.settle(moof); sized(output, moof); },
    // The two boxes go to the buffer one after the other, as they are: joined, each fragment was copied once more
    // (3 MB a second of a 25 Mbit/s film). The writer's `data` is its own array, not one it writes into again.
    onMdat: data => { send(moof); send(data); moof = null; },
  });
  const output = new MB.Output({format, target: new MB.NullTarget()});
  return output;
}

/**
 * Mediabunny collects each box it hands over in an array that starts at 1 KiB and doubles, copied each time: a 1.7 MB
 * fragment of picture left about 4 MB of arrays behind it (2 MiB of them kept until appended). The fragment's sample
 * sizes are in the moof that comes first, so the array for its mdat is made at its size, once. Where the writer is not
 * as expected (another Mediabunny), nothing changes. Measured 2026-11-19 (scripts/astra/memory.mjs, two runs each): the
 * JS arrays at their peak, the burst after the first picture, 95 and 158 MB on a 25 Mbit/s film instead of 176 and 199,
 * and the page's share of memory at its median 175 MB instead of 185 (an earlier try, 2026-11-18, read the whole
 * renderer through Playwright, whose copy of every download hid it).
 */
function sized(output, moof) {
  const writer = output._muxer?.writer;
  if (!writer || typeof writer.startTrackingWrites !== 'function') return;
  if (!writer.sizedStart) {
    const start = writer.startTrackingWrites;
    writer.sizedStart = function () { start.call(this); if (this.nextSize > this.trackedWrites?.byteLength) this.trackedWrites = new Uint8Array(this.nextSize); this.nextSize = 0; };
    writer.startTrackingWrites = writer.sizedStart;
  }
  const size = sampleBytes(moof);
  writer.nextSize = size ? size + 16 : 0; // and the mdat's own header (8 bytes, 16 when large)
}

/** The bytes of every sample a `moof` box describes (0 when a run gives no sizes of its own). */
export function sampleBytes(moof) {
  const view = new DataView(moof.buffer, moof.byteOffset, moof.byteLength);
  let total = 0, plain = true;
  const walk = (at, end) => {
    while (at + 8 <= end) {
      const size = view.getUint32(at), type = view.getUint32(at + 4);
      if (size < 8) return;
      if (type === 0x6d6f6f66 || type === 0x74726166) walk(at + 8, at + size); // moof, traf
      else if (type === 0x7472756e) { // trun: flags, sample count, [data offset], [first sample flags], then each sample
        const flags = view.getUint32(at + 8) & 0xffffff, count = view.getUint32(at + 12);
        if (!(flags & 0x200)) { plain = false; return; }
        const each = 4 * ((flags & 0x100 ? 1 : 0) + 1 + (flags & 0x400 ? 1 : 0) + (flags & 0x800 ? 1 : 0));
        let p = at + 16 + (flags & 1 ? 4 : 0) + (flags & 4 ? 4 : 0) + (flags & 0x100 ? 4 : 0);
        for (let i = 0; i < count && p + 4 <= at + size; i++, p += each) total += view.getUint32(p);
      }
      at += size;
    }
  };
  walk(0, moof.byteLength);
  return plain ? total : 0;
}


/** One decoded sample as stereo at the same rate, its centre channel (if any) multiplied by `centre`. */
export function stereoSample(sample, centre = 1) {
  const all = new Float32Array(sample.allocationSize({planeIndex: 0, format: 'f32'}) / 4);
  sample.copyTo(all, {planeIndex: 0, format: 'f32'});
  return new MB.AudioSample({data: toStereo(all, sample.numberOfChannels, centre), format: 'f32', numberOfChannels: 2, sampleRate: sample.sampleRate, timestamp: sample.timestamp});
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.byteLength; }
  return out;
}
