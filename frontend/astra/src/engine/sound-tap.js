// The sound tap: decoded sound handed to a listener while the film is read
// (Skip intro's IntroFinder, through app/skip.js and engine.setSoundTap).
//
// Only in remux mode, where Astra reads the sound itself. A track the engine
// converts ('rebuilt': Dolby Digital, DTS, TrueHD) is decoded anyway: its
// samples are handed over as they pass (samples()). A track passed through
// as it is ('direct': AAC, Opus, FLAC, MP3) is not decoded by the page, so its
// packets are also given to a WebCodecs AudioDecoder of the tap's own
// (packet()), and only while the listener wants that stretch. Mediabunny 1.66
// has no public way to decode packets handed to it, and a second sample sink
// on the track would read and unpack the file twice; a hand-made decoder skips
// the encoder's priming and preroll, which the listener does not mind (it
// copes with gaps and with chunks out of order).
//
// It is fed when the sound is READ (up to the read-ahead past the playhead),
// not when it is heard; each stretch once per read, and again if a seek reads
// it again. Times are media times: file time less the session's offset, the
// clock video.currentTime runs on. Nothing here may delay or break playback:
// the decoder works off the page's thread, packets wait for it in a bounded
// backlog (dropped past it) rather than holding up the reading, and any error in the listener or the decoder ends the
// tapping for that film (with a line in the engine's log).

// Packets handed to the decoder at a time; the rest wait here (reading comes in bursts of up to the read-ahead,
// 40 s), up to MAX_BACKLOG seconds of sound, past which packets are not tapped.
const MAX_QUEUE = 16, MAX_BACKLOG = 60;

export class TapFeed {
  /**
   * @param {{wants: (mediaTime: number, seconds: number) => boolean, feed: (channels: Float32Array[], sampleRate: number, mediaTime: number) => void}} tap
   * @param {(line: string) => void} log
   */
  constructor(tap, log = () => {}) {
    this.tap = tap;
    this.log = log;
    this.dead = false;
    this.load = null; // the load it ended for; a later film taps afresh
    this.decoder = null;
    this.key = null; // the pipeline the decoder serves (track and generation)
    this.backlog = []; // chunks waiting for the decoder
    this.waiting = 0; // seconds of sound in the backlog
    this.stats = {ms: 0, chunks: 0, seconds: 0, dropped: 0};
  }

  /** The feed for a film (load id); one that ended for an earlier film starts again. */
  forLoad(load) {
    if (this.dead && this.load !== load) { this.dead = false; this.log('tapping again for a new film'); }
    this.load = load;
    return this;
  }

  /** Ends the tapping for this film: the decoder is closed and nothing is fed until the next film. */
  end(why) {
    if (this.dead) return;
    this.dead = true;
    this.closeDecoder();
    this.log(`tapping ended: ${String(why?.message || why).slice(0, 120)}`);
  }

  /** Whether the listener wants [t, t + seconds); false (and ended) if it throws. */
  wants(t, seconds) {
    if (this.dead) return false;
    try { return !!this.tap.wants(t, seconds); } catch (error) { this.end(error); return false; }
  }

  /** Hands one stretch of planar sound to the listener. */
  give(channels, rate, t) {
    if (this.dead) return;
    const start = performance.now();
    try { this.tap.feed(channels, rate, t); } catch (error) { this.end(error); }
    this.count(start, channels[0]?.length / rate);
  }

  count(start, seconds) { this.stats.ms += performance.now() - start; this.stats.chunks++; this.stats.seconds += seconds || 0; }

  /** A decoded Mediabunny AudioSample of a rebuilt track (file time), handed over before it is mixed to stereo. */
  samples(sample, offset) {
    if (this.dead || !sample?.numberOfFrames) return;
    const t = sample.timestamp - offset;
    if (!this.wants(t, sample.duration)) return;
    const start = performance.now();
    try {
      const channels = [];
      for (let i = 0; i < sample.numberOfChannels; i++) {
        const plane = new Float32Array(sample.numberOfFrames);
        sample.copyTo(plane, {planeIndex: i, format: 'f32-planar'});
        channels.push(plane);
      }
      this.stats.ms += performance.now() - start;
      this.give(channels, sample.sampleRate, t);
    } catch (error) { this.end(error); }
  }

  /**
   * One packet of a direct track (Mediabunny EncodedPacket, file time), decoded here while wanted.
   * `key` names the pipeline: a new one (a seek, another track) gets a fresh decoder.
   */
  packet(packet, track, offset, key) {
    if (this.dead || typeof AudioDecoder !== 'function') return;
    const t = packet.timestamp - offset;
    if (!this.wants(t, packet.duration)) return;
    const start = performance.now();
    try {
      if (this.key !== key || !this.decoder || this.decoder.state === 'closed') this.openDecoder(track, offset, key);
      if (this.waiting >= MAX_BACKLOG) { this.stats.dropped++; return; }
      this.waiting += packet.duration || 0;
      this.backlog.push(new EncodedAudioChunk({type: 'key', timestamp: Math.round(packet.timestamp * 1e6), duration: Math.round(packet.duration * 1e6), data: packet.data}));
      this.drain();
    } catch (error) { this.end(error); } finally { this.stats.ms += performance.now() - start; }
  }

  /** Hands waiting chunks to the decoder while it has room (again each time it takes one). */
  drain() {
    const decoder = this.decoder;
    try {
      while (!this.dead && decoder && decoder.state === 'configured' && decoder.decodeQueueSize < MAX_QUEUE && this.backlog.length) {
        const chunk = this.backlog.shift();
        this.waiting = Math.max(0, this.waiting - chunk.duration / 1e6);
        decoder.decode(chunk);
      }
    } catch (error) { this.end(error); }
  }

  openDecoder(track, offset, key) {
    this.closeDecoder();
    if (!track.decoderConfig) throw Error('no decoder configuration for this sound');
    this.key = key;
    const decoder = this.decoder = new AudioDecoder({
      output: data => this.decoded(data, offset, decoder),
      error: error => { if (this.decoder === decoder) this.end(error); },
    });
    decoder.addEventListener?.('dequeue', () => { if (this.decoder === decoder) this.drain(); });
    decoder.configure(track.decoderConfig);
  }

  decoded(data, offset, decoder) {
    try {
      if (this.dead || this.decoder !== decoder) return;
      const start = performance.now(), channels = [];
      for (let i = 0; i < data.numberOfChannels; i++) {
        const plane = new Float32Array(data.numberOfFrames);
        data.copyTo(plane, {planeIndex: i, format: 'f32-planar'});
        channels.push(plane);
      }
      this.stats.ms += performance.now() - start;
      this.give(channels, data.sampleRate, data.timestamp / 1e6 - offset);
    } catch (error) { this.end(error); } finally { data.close(); }
    this.drain(); // where the browser has no 'dequeue' event
  }

  closeDecoder() {
    const decoder = this.decoder;
    this.decoder = null; this.key = null; this.backlog = []; this.waiting = 0;
    try { if (decoder && decoder.state !== 'closed') decoder.close(); } catch {}
  }

  close() { this.closeDecoder(); this.dead = true; }
}
