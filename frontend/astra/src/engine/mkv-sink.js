// One track's sink on Astra's own Matroska reader (mkv-packets.js): what the
// re-wrapping pipelines use of Mediabunny's EncodedPacketSink, with the same
// answers (getFirstPacket, getNextPacket, getKeyPacket, getPacket,
// getFirstTimestamp), each packet a real MB.EncodedPacket.

export class TrackSink {
  constructor(reader, track, ref) { this.reader = reader; this.track = track; this.ref = ref; }
  get info() { return this.reader.tracks.get(this.track); }
  ticks(time) { const v = time * this.reader.factor, r = Math.round(v); return (Math.abs(v / r - 1) < 10 * Number.EPSILON ? r : v) + this.info.delay; }

  getFirstPacket() { return this.from(this.reader.layout.firstCluster, -1); }
  async getFirstTimestamp() { return (await this.getFirstPacket())?.timestamp ?? 0; }

  async getNextPacket(packet) {
    const at = this.reader.where.get(packet);
    if (!at) throw Error('Packet was not read by this reader.');
    const f = await this.reader.frame(at.cluster, this.track, at.index + 1);
    return f ? f.packet : this.from(await this.reader.next(at.cluster), -1);
  }

  /** The first frame from cluster `pos` on whose index is above `index`. */
  async from(pos, index) {
    for (; pos != null; index = -1) {
      const c = this.reader.cluster(pos, 0, this.track), f = await this.reader.frame(c, this.track, index + 1);
      if (f) return f.packet;
      pos = await this.reader.next(c);
    }
    return null;
  }

  /** The last packet shown at or before `time` (the sound's starting place). */
  async getPacket(time) {
    const video = this.info.kind === 'video', at = this.ticks(time);
    const f = await this.reader.find(this.track, at, () => true, f => f.ticks > at && (!video || f.key), false, !video);
    return f?.packet || null;
  }

  /** The key frame at or before `time`; with verifyKeyPackets, one whose bitstream says it is one (as Mediabunny checks). */
  async getKeyPacket(time, {verifyKeyPackets = false} = {}) {
    let at = this.ticks(time);
    for (let guard = 0; guard < 64; guard++) {
      const f = await this.reader.find(this.track, at, f => f.key, f => f.key && f.ticks > at, this.info.own);
      if (!f) return null;
      if (!verifyKeyPackets || await this.ref.determinePacketType(f.packet) !== 'delta') return f.packet;
      at = f.ticks - 1;
    }
    return null;
  }
}
