// Rebuilt sound (remux-audio.js: Dolby Digital, DD+, DTS, TrueHD, Vorbis, PCM) decoded from the packets Astra's own
// Matroska reader hands out (mkv-packets.js), so it starts as soon as its first blocks have arrived, like the picture,
// instead of after Mediabunny's demuxer has read a whole cluster (up to 5 MB or 5 s).
//
// Mediabunny 1.66 does not export its decoder registry, and the decoder packages export only their register
// functions, so the decoder classes cannot be built from outside as they are. What it does offer is its
// AudioSampleSink, whose samples() asks two methods of its own for the decoder (_createDecoder: the registered
// custom decoder, WebCodecs for Vorbis, its own PCM reader) and for the packets (_createPacketSink). A sink here
// keeps the first and answers the second with Astra's reader: the same decoder, the same pre-roll (the track's
// pre-roll duration back from the start, to a key packet: a TrueHD major sync), the same dropping of what comes
// before the start and the same timestamps as Mediabunny's own sink, read once, block by block.
//
// The one difference is where Astra's reader already differs (mkv-sink.js getPacket): sound whose start is within
// two frames of a cluster's first frame starts at that frame, not at the end of the cluster before (which only
// reading that cluster would find); a codec whose every frame stands alone then also starts there rather than one
// pre-roll before it (AC-3: 256 samples), so its first few milliseconds may differ slightly, as passed-through sound
// does. TrueHD still goes back to its major sync. If these private methods are gone (another Mediabunny), or the
// reader does not read this track, null is returned and Mediabunny's own sink is used.

import * as MB from '../../vendor/mediabunny.js';

const proto = MB.AudioSampleSink?.prototype;
/** True when the vendored Mediabunny has the two methods this relies on. */
export const usable = !!proto && ['_createDecoder', '_createPacketSink', '_getPreRollDuration', 'samples'].every(k => typeof proto[k] === 'function');

export const SOUND = {own: true}; // off: rebuilt sound is always read by Mediabunny (tests compare the two)

/** A sample sink for `track` (a Mediabunny InputAudioTrack) reading `packets` (a mkv-sink.js TrackSink), or null. */
export function ownSampleSink(track, packets) {
  if (!SOUND.own || !usable || !packets || !(track instanceof MB.InputAudioTrack)) return null;
  return new OwnSampleSink(track, new PacketsFrom(packets, track.codec));
}

class OwnSampleSink extends MB.AudioSampleSink {
  constructor(track, packets) { super(track); this.own = packets; }
  _createPacketSink() { return this.own; }
}

/** What Mediabunny's samples() asks of an EncodedPacketSink (getPacket, getKeyPacket, getFirstKeyPacket, packets), from Astra's reader. */
export class PacketsFrom {
  constructor(sink, codec) {
    this.sink = sink;
    this.alone = codec !== 'truehd'; // every packet is a key packet: the pre-roll start is found like the start itself
    this.stats = {packets: 0};
  }

  getPacket(time) { return this.sink.getPacket(time); }

  getKeyPacket(time, options) { return this.alone ? this.sink.getPacket(time) : this.sink.getKeyPacket(time, options); }

  async getFirstKeyPacket() {
    let p = await this.sink.getFirstPacket();
    for (let guard = 0; p && p.type !== 'key' && guard < 4096; guard++) p = await this.sink.getNextPacket(p);
    return p?.type === 'key' ? p : null;
  }

  getNextPacket(packet) { return this.sink.getNextPacket(packet); }

  /** Packets from `start` on, each read when asked for (Mediabunny's own reads ahead as many as were taken in the last second). */
  async *packets(start) {
    for (let p = start ?? await this.getFirstKeyPacket(); p; p = await this.sink.getNextPacket(p)) { this.stats.packets++; yield p; }
  }
}
