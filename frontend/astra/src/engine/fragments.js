// The writer side of a re-wrapped film (remux.js): Mediabunny's fragmented MP4
// output, each init segment and fragment handed to one SourceBuffer's queue.

import * as MB from '../../vendor/mediabunny.js';
import {toStereo} from './downmix.js';

/** An output whose fragments go to `queue` for `generation`; video fragments may be cut early (early.js). */
export function fragmentWriter(queue, stats, kind, generation, early = null) {
  let head = [], moof = null;
  const send = bytes => { stats.appended += bytes.byteLength; queue.append(bytes, generation); };
  const format = new MB.Mp4OutputFormat({
    fastStart: 'fragmented', minimumFragmentDuration: kind === 'audio' ? 1 : 0, // video: every key frame, real or early (early.js), begins a fragment
    onFtyp: data => { head.push(data.slice()); },
    onMoov: data => { head.push(data.slice()); send(concat(head)); head = []; },
    onMoof: data => { moof = data.slice(); early?.settle(moof); },
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
