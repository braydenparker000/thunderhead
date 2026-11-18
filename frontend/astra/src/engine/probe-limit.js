// Describing a film's tracks is bounded (probe.js). A few codecs are described from their first packet (DTS's codec
// string, VP9's and AV1's setup, an H.264 or HEVC track whose header carries none), which Mediabunny finds by reading
// clusters whole from the film's start until one holds a block of that track: a track whose first packet lies far in
// read everything before it. A film whose DTS track begins a minute in sat 35.8 s in "Reading what is inside…" and
// read 23 MB before anything was planned (5.4 Mbit/s, 110 ms a request; scripts/astra/real.mjs, 2026-11-18); on the
// owner's phone one film spent 91 s and 21 MB there. The film's first cluster is read freely (a start from 0:00 reads
// it anyway, and nearly every first packet is in it); past it, describing gets LIMIT.ms from its first read there and
// LIMIT.bytes of what is not here yet, for all its tracks at once, since one read of Mediabunny's serves every track
// looking. Then the reads it still waits for are let go (a download begun for them alone stops), what it asks later
// is refused, and each track not described by then is left as an unread one: no codec string, no decoder setup.
// The plan is made from what is known (DTS is then converted, as where the browser takes none as it is), and the
// converter is given the setup the track's header holds (heard()).

import {SourceError} from './source-stream.js';

export const LIMIT = {ms: 3000, bytes: 2 << 20};

/**
 * Wraps the reads Mediabunny makes while the tracks are described (between start() and end()). `free()` is where the
 * part read freely ends (the first cluster's end; 0 when not known).
 */
export function describeLimit(source, free = () => 0) {
  let on = false, over = false, spent = 0, timer = 0;
  const waiting = new Set(); // {start, end, reject}
  const refused = () => new SourceError('limit', 'Describing this film took too long.');
  const stop = () => {
    clearTimeout(timer);
    if (!on || over) return;
    over = true;
    const list = [...waiting];
    waiting.clear();
    for (const w of list) w.reject(refused());
    source.letGo(list.map(w => [w.start, w.end]), free());
  };
  return {
    get over() { return over; },
    wrap: read => (start, end) => {
      if (!on) return read(start, end);
      if (over) return Promise.reject(refused());
      const from = Math.max(start, free());
      if (from < end) {
        const fresh = end - Math.min(end, source.cachedUntil(from));
        if (fresh > 0 && !timer) timer = setTimeout(stop, LIMIT.ms);
        if ((spent += fresh) > LIMIT.bytes) { stop(); return Promise.reject(refused()); }
      }
      return new Promise((resolve, reject) => {
        const w = {start, end, reject};
        waiting.add(w);
        read(start, end).then(v => { if (waiting.delete(w)) resolve(v); }, e => { if (waiting.delete(w)) reject(e); });
      });
    },
    start() { on = true; over = false; spent = 0; },
    end() { clearTimeout(timer); timer = 0; on = false; },
  };
}

/**
 * Mediabunny keeps the refused first-packet read as the track's answer, which the converter and its sample reader ask
 * for again (getDecoderConfig, getPreRollDuration): a DTS track describing gave up on is answered with what its header
 * holds, which is all the decoder needs (Mediabunny's own codec string for DTS is "dtsc" when its frame is unknown).
 */
export function heard(track) {
  const backing = track?._backing;
  if (track?.codec !== 'dts' || typeof backing?.getDecoderConfig !== 'function') return;
  const config = {codec: 'dtsc', numberOfChannels: track.numberOfChannels, sampleRate: track.sampleRate};
  backing.getDecoderConfig = async () => config;
}
