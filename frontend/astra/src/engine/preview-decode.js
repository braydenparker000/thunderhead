// One WebCodecs decoder for a film's seek previews (player-preview.js): one key frame in, flush, one picture out,
// made small (createImageBitmap) and the frame closed at once. It is reset between requests and closed with the
// film. Hardware decoders are preferred where the phone has one for the codec (HEVC on many phones); the
// configuration is checked first, so a codec this browser cannot decode gives no previews rather than an error.
// The decoder runs in a worker of its own (preview-worker.js, WorkerDecoder below): turning a decoded 1080p frame
// into a picture held the page's thread 13 ms here and 75 ms with the CPU slowed six times, once per preview, so
// a drag stuttered. Where no worker can start, the same work is done on the page (FrameDecoder).

const ended = () => new DOMException('Ended.', 'AbortError');

/** Starts the film's preview decoder: in a worker where one starts, else on the page; null when the codec cannot be decoded. */
export async function previewDecoder(config, size, {worker = WorkerDecoder.start, page = FrameDecoder.create} = {}) {
  if (!config?.codec) return null;
  const off = await worker(config, size);
  return off !== undefined ? off : page(config, size);
}

export class WorkerDecoder {
  /** The decoder in a worker: null when the codec cannot be decoded there, undefined when no worker started. */
  static async start(config, {width, height}, make = () => new Worker(new URL('./preview-worker.js', import.meta.url), {type: 'module'})) {
    let worker;
    try { worker = make(); } catch { return undefined; }
    const ok = await new Promise(resolve => {
      const timer = setTimeout(() => resolve(undefined), 5000);
      worker.onmessage = ({data}) => { if (data?.type === 'config') { clearTimeout(timer); resolve(data.ok); } };
      worker.onerror = () => { clearTimeout(timer); resolve(undefined); };
      worker.postMessage({type: 'config', config: {...config, optimizeForLatency: true}, width, height});
    });
    if (ok !== true) { worker.terminate(); return ok === false ? null : undefined; }
    return new WorkerDecoder(worker);
  }

  constructor(worker) {
    Object.assign(this, {worker, next: 1, pending: new Map(), turn: Promise.resolve(), broken: false});
    worker.onmessage = ({data}) => {
      const p = this.pending.get(data?.id);
      if (!p) { data?.bitmap?.close(); return; } // an answer no one waits for any more
      this.pending.delete(data.id);
      if (data.bitmap) p.resolve(data.bitmap); else p.reject(Error(data.error || 'No picture.'));
    };
    worker.onerror = () => { this.broken = true; this.fail('The preview worker stopped.'); };
  }

  fail(why) { for (const p of this.pending.values()) p.reject(Error(why)); this.pending.clear(); }

  /** The key frame `data` as a small ImageBitmap; one request at a time, in order; `signal` ends one. */
  decode(data, signal) {
    const run = async () => {
      if (signal?.aborted) throw ended();
      if (this.broken) throw Error('The preview worker stopped.');
      const id = this.next++, answer = new Promise((resolve, reject) => this.pending.set(id, {resolve, reject}));
      const stop = () => this.worker.postMessage({type: 'stop'});
      signal?.addEventListener('abort', stop, {once: true});
      const bytes = data.slice(); // its own buffer, handed over rather than copied again
      this.worker.postMessage({type: 'decode', id, data: bytes}, [bytes.buffer]);
      try {
        const bitmap = await answer;
        if (signal?.aborted) { bitmap.close(); throw ended(); }
        return bitmap;
      } finally { signal?.removeEventListener('abort', stop); }
    };
    const out = this.turn.then(run, run);
    this.turn = out.catch(() => {});
    return out;
  }

  close() { this.broken = true; this.fail('Closed.'); this.worker.terminate(); }
}

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
    if (signal?.aborted) throw ended();
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
      if (signal?.aborted) throw ended();
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
