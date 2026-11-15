// One WebCodecs decoder for a film's seek previews (player-preview.js): one key frame in, flush, one picture out,
// made small (createImageBitmap) and the frame closed at once. It is reset between requests and closed with the
// film. Hardware decoders are preferred where the phone has one for the codec (HEVC on many phones); the
// configuration is checked first, so a codec this browser cannot decode gives no previews rather than an error.

export class FrameDecoder {
  /** A decoder for `config` (a track's decoderConfig), or null when WebCodecs cannot decode it here. */
  static async create(config, {width, height}, Decoder = globalThis.VideoDecoder) {
    if (!config?.codec || typeof Decoder !== 'function') return null;
    const wanted = {...config, optimizeForLatency: true};
    try { if (!(await Decoder.isConfigSupported(wanted)).supported) return null; } catch { return null; }
    return new FrameDecoder(wanted, {width, height}, Decoder);
  }

  constructor(config, size, Decoder) {
    Object.assign(this, {config, size, Decoder, decoder: null, waiting: null});
  }

  open() {
    if (this.decoder && this.decoder.state !== 'closed') return this.decoder;
    // A frame goes to the request waiting for it, else is closed; a failure rejects that request's flush().
    this.decoder = new this.Decoder({output: frame => (this.waiting ? this.waiting(frame) : frame.close()), error: () => {}});
    return this.decoder;
  }

  /** The key frame `data` as an ImageBitmap `size` large; rejects when `signal` ends it or the decoder fails. */
  async decode(data, signal) {
    if (signal?.aborted) throw new DOMException('Ended.', 'AbortError');
    const d = this.open();
    if (d.state === 'configured') d.reset(); // whatever the last request left behind
    d.configure(this.config);
    let got = null;
    this.waiting = frame => { got?.close(); got = frame; };
    const stop = () => { try { d.reset(); } catch {} }; // the flush below rejects
    signal?.addEventListener('abort', stop, {once: true});
    try {
      d.decode(new EncodedVideoChunk({type: 'key', timestamp: 0, data}));
      await d.flush();
      if (!got) throw Error('The decoder gave no picture.');
      if (signal?.aborted) throw new DOMException('Ended.', 'AbortError');
      return await createImageBitmap(got, {resizeWidth: this.size.width, resizeHeight: this.size.height, resizeQuality: 'medium'});
    } finally {
      signal?.removeEventListener('abort', stop);
      this.waiting = null;
      got?.close();
    }
  }

  close() {
    this.waiting = null;
    try { if (this.decoder && this.decoder.state !== 'closed') this.decoder.close(); } catch {}
    this.decoder = null;
  }
}
