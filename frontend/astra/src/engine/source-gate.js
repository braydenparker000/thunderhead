// At most three connections to a film at once, for Astra's range reader (http-source.js). A TorBox link allows
// four; one is kept in hand. Every request the reader makes to the film takes a slot here before it is sent
// and gives it back when its answer is over: read to its last byte, cancelled, failed or ended. One broken off
// keeps its slot a moment longer (TIMING.closing), while its connection closes, so a download restarted after
// a seek or a network change never stands beside the one it replaces. Requests that find every slot taken
// wait in a queue: playback's own downloads first, then side reads (the film's end, the subtitle hash, a
// block's first part), then seek previews, last; and a download that has to wait ends a preview's request
// to take its slot, since a preview is only a picture and is asked for again by the next move of the finger.

import {SourceError, TIMING} from './source-stream.js';

export const CONNECTIONS = 3;
const RANK = {play: 0, side: 1, preview: 2};

export class Gate {
  constructor(max = CONNECTIONS) {
    this.max = max;
    this.held = new Set(); // {kind, drop, freed}
    this.waiting = []; // by rank, then by arrival: {rank, kind, drop, resolve, reject, done}
    this.peak = 0; // the most slots ever held at once
  }

  /** A slot at once, when one is free and nothing waits ahead of this kind; else null. */
  grab(kind, drop) {
    const rank = RANK[kind] ?? RANK.side;
    if (this.held.size >= this.max || this.waiting.some(w => w.rank <= rank)) return null;
    return this.hold({kind, drop});
  }

  /** Resolves a slot once one is free; rejects with the signal's reason if it ends first. `drop()` ends a preview's request. */
  take(kind, signal, drop) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const w = {rank: RANK[kind] ?? RANK.side, kind, drop, resolve, reject};
      const stop = () => { const i = this.waiting.indexOf(w); if (i >= 0) { this.waiting.splice(i, 1); reject(signal.reason); } };
      w.done = () => signal?.removeEventListener('abort', stop);
      signal?.addEventListener('abort', stop, {once: true});
      let i = this.waiting.length;
      while (i > 0 && this.waiting[i - 1].rank > w.rank) i--;
      this.waiting.splice(i, 0, w);
      this.pump();
      if (w.rank === RANK.play && this.waiting.includes(w)) {
        const preview = [...this.held].find(s => s.kind === 'preview' && !s.freed && !s.dropped);
        if (preview) { preview.dropped = true; preview.drop?.(); }
      }
    });
  }

  /** Hands free slots to the first in the queue. */
  pump() {
    while (this.held.size < this.max && this.waiting.length) {
      const w = this.waiting.shift();
      w.done();
      w.resolve(this.hold(w));
    }
  }

  hold({kind, drop}) {
    const slot = {kind, drop, freed: false};
    this.held.add(slot);
    this.peak = Math.max(this.peak, this.held.size);
    return slot;
  }

  /** The slot's answer is over: free now, or `later` ms on while a broken-off connection closes. Once only. */
  free(slot, later = 0) {
    if (slot.freed) return;
    slot.freed = true;
    const go = () => { this.held.delete(slot); this.pump(); };
    if (later > 0) setTimeout(go, later); else go();
  }

  /** The film closed: whatever waits is refused. */
  close() {
    for (const w of this.waiting.splice(0)) { w.done(); w.reject(new SourceError('closed', 'The file was closed.')); }
  }
}

/**
 * One request of the reader's through its gate: `go(signal)` sends it once a slot is free (playback's `kind`
 * 'play', 'side' or 'preview'). Resolves an answer shaped like a Response ({status, ok, url, headers, body}),
 * whose body gives the slot back when it has been read to its end (or to its Content-Length), cancelled or
 * broken off; one without a body gives it back at once.
 */
export function gated(source, kind, signal, go) {
  const gate = source.gate ??= new Gate();
  const own = new AbortController(); // ends a preview's request when playback needs its slot
  const drop = () => own.abort(new SourceError('busy', 'Playback needed the connection.'));
  // A free slot is taken at once, so a request that need not wait is sent exactly when it was before the gate.
  const slot = signal?.aborted ? null : gate.grab(kind, drop);
  return slot ? send(gate, slot, signal, own, go) : gate.take(kind, signal, drop).then(slot => send(gate, slot, signal, own, go));
}

function send(gate, slot, signal, own, go) {
  const both = signal ? AbortSignal.any([signal, own.signal]) : own.signal;
  let got = 0, expect = 0;
  const free = (closing = false) => { both.removeEventListener('abort', broken); gate.free(slot, closing ? TIMING.closing : 0); };
  const broken = () => free(!(expect && got >= expect));
  both.addEventListener('abort', broken, {once: true});
  let sent;
  try { sent = Promise.resolve(go(both)); } catch (error) { sent = Promise.reject(error); }
  return sent.then(response => {
    if (!response.body) { free(); return response; }
    expect = Number(response.headers.get('content-length')) || 0;
    const reader = response.body.getReader();
    const body = new ReadableStream({
      async pull(controller) {
        let piece;
        try { piece = await reader.read(); } catch (error) { free(true); controller.error(own.signal.aborted ? own.signal.reason : error); return; }
        if (piece.done) { free(); controller.close(); return; }
        got += piece.value.length;
        controller.enqueue(piece.value);
        if (expect && got >= expect) free(); // all of it is here: the connection is free again
      },
      cancel(reason) { broken(); return reader.cancel(reason); },
    }, {highWaterMark: 0});
    return {status: response.status, ok: response.ok, url: response.url, headers: response.headers, body};
  }, error => { free(true); throw own.signal.aborted ? own.signal.reason : error; });
}
