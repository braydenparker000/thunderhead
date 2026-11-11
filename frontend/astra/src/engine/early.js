// Early fragments. Mediabunny closes a video fragment only when the next key
// frame arrives, so nothing of a GOP reached the browser until all of it had
// been read: with Matroska clusters of up to five megabytes, a start or a far
// seek waited for a second cluster before the first picture.
//
// Here a fragment is cut every half second instead. A cut is made at a frame
// that is shown after every frame before it (so each fragment's frames are a
// run in showing order, which is what the writer's decode times assume), by
// handing the writer that frame as if it were a key frame; when the fragment
// comes out, its first frame is written back as the ordinary frame it is, so
// the browser never starts decoding there. The result is what chunked CMAF
// streams are: fragments that need not begin with a key frame.

const EVERY = 0.5; // seconds between cuts
const NOT_SYNC = 0x00010000, DEPENDS = 0x03000000, ON_OTHERS = 0x01000000;

export class EarlyCuts {
  constructor() {
    this.forced = []; // one entry for each fragment begun, true where the cut was made here
    this.high = -Infinity; // the latest time shown so far
    this.cut = -Infinity; // where the fragment being filled began
    this.started = false;
  }

  /** The packet to hand the writer: itself, or a copy marked as a key frame where a fragment is cut. */
  mark(packet) {
    let out = packet;
    if (packet.type === 'key') { this.forced.push(false); this.cut = packet.timestamp; }
    else if (this.started && packet.timestamp > this.high && packet.timestamp - this.cut >= EVERY) {
      out = packet.clone({type: 'key'});
      this.forced.push(true);
      this.cut = packet.timestamp;
    }
    this.started = true;
    this.high = Math.max(this.high, packet.timestamp);
    return out;
  }

  /** Writes a finished fragment's first frame back as an ordinary frame when its cut was made here. `moof` is changed in place. */
  settle(moof) {
    if (this.forced.shift()) demote(moof);
    return moof;
  }
}

/** Marks the first sample of each track run in a `moof` box as not a sync sample, in place. */
export function demote(moof) {
  const view = new DataView(moof.buffer, moof.byteOffset, moof.byteLength);
  const ordinary = at => view.setUint32(at, (view.getUint32(at) & ~DEPENDS) | ON_OTHERS | NOT_SYNC);
  const walk = (at, end) => {
    while (at + 8 <= end) {
      const size = view.getUint32(at), type = view.getUint32(at + 4);
      if (size < 8) return;
      if (type === 0x6d6f6f66 || type === 0x74726166) walk(at + 8, at + size); // moof, traf
      else if (type === 0x7472756e) { // trun: flags, sample count, [data offset], [first sample flags], then each sample
        const flags = view.getUint32(at + 8) & 0xffffff, first = at + 16 + (flags & 1 ? 4 : 0);
        if (flags & 4) ordinary(first);
        else if (flags & 0x400) ordinary(first + (flags & 0x100 ? 4 : 0) + (flags & 0x200 ? 4 : 0));
      }
      at += size;
    }
  };
  walk(0, moof.byteLength);
  return moof;
}

/** True when a `moof` box's first sample is a sync sample (for tests). */
export function startsWithKey(moof) {
  const view = new DataView(moof.buffer, moof.byteOffset, moof.byteLength);
  let found = null;
  const walk = (at, end) => {
    while (at + 8 <= end && found === null) {
      const size = view.getUint32(at), type = view.getUint32(at + 4);
      if (size < 8) return;
      if (type === 0x6d6f6f66 || type === 0x74726166) walk(at + 8, at + size);
      else if (type === 0x7472756e) {
        const flags = view.getUint32(at + 8) & 0xffffff, first = at + 16 + (flags & 1 ? 4 : 0);
        if (flags & 4) found = !(view.getUint32(first) & NOT_SYNC);
        else if (flags & 0x400) found = !(view.getUint32(first + (flags & 0x100 ? 4 : 0) + (flags & 0x200 ? 4 : 0)) & NOT_SYNC);
      }
      at += size;
    }
  };
  walk(0, moof.byteLength);
  return found;
}
