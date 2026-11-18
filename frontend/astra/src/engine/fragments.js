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
    onMoof: (data, position, timestamp) => { moof = data.slice(); at = timestamp; early?.settle(moof); },
    // The two boxes go to the buffer one after the other, as they are: joined, each fragment was copied once more
    // (3 MB a second of a 25 Mbit/s film). The writer's `data` is its own array, not one it writes into again.
    onMdat: data => { send(moof); send(data); moof = null; },
  });
  return new MB.Output({format, target: new MB.NullTarget()});
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
