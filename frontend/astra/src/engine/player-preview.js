// Seek previews for AstraPlayer (player.js): previewAt(time, {signal}) → an ImageBitmap of the key frame at or
// just before `time` (at most PREVIEW.width wide), or null. Mixed into AstraPlayer's prototype, so `this` is the
// player; addPreviews() also closes them with each film (reset).
//
// Only a film Astra unpacks ('remux') has them: its index is in memory, so finding the key frame costs no
// network, and the range reader's side requests (side-read.js) fetch exactly that frame without touching the
// downloads playback reads from. Each preview costs one key frame (tens to hundreds of kB), counted in the
// film's data; none with the data saver on or while the host is unreachable. One decoder and one small cache
// of pictures per film (preview.js); both closed when the film closes.

import * as MB from '../../vendor/mediabunny.js';
import {PreviewCache, previewsOff, PREVIEW} from './preview.js';
import {FrameDecoder} from './preview-decode.js';
import {mkvPlaces, mkvKeyFrame, bounded, findMoov, mp4Samples, TooLarge} from './preview-frames.js';

export const previewMethods = {
  /** Why there are no previews for this film now ('' when there may be): see previewsOff. */
  previewsOff() {
    const source = this.probed?.source, video = this.info?.video?.[0];
    if (!video?.decoderConfig || typeof source?.sideRead !== 'function') return 'none';
    return previewsOff({mode: this.mode, saver: this.dataSaver, state: source.state, closed: source.closed});
  },

  /** The picture's shape (width / height) as shown, for the box that waits for a preview. */
  previewAspect() {
    const v = this.info?.video?.[0];
    return v?.width > 0 && v?.height > 0 ? v.width / v.height : 16 / 9;
  },

  async previewAt(time, {signal} = {}) {
    if (!Number.isFinite(time) || this.previewsOff()) return null;
    const previews = this.previews ??= this.makePreviews();
    return previews ? previews.at(time, signal) : null;
  },

  /** The film's cache and decoder, set up on the first request: null when this film's key frames cannot be found. */
  makePreviews() {
    const source = this.probed.source, info = this.info, video = info.video[0], load = this.load_;
    const width = Math.min(PREVIEW.width, video.width || PREVIEW.width), height = Math.max(2, Math.round(width / this.previewAspect() / 2) * 2);
    let decoder = null; // made on the first fetch: isConfigSupported is asked once
    const decode = async (data, signal) => {
      decoder ??= FrameDecoder.create(video.decoderConfig, {width, height});
      const d = await decoder;
      if (!d) return null;
      if (this.load_ !== load || signal.aborted) return null;
      this.previewDecoder = d;
      return d.decode(data, signal);
    };
    const side = signal => bounded((s, e) => this.previewsOff() ? Promise.reject(new TooLarge()) : source.sideRead(s, e, {signal}));
    const offset = this.session?.offset || 0;
    const places = mkvPlaces(info.layout, offset);
    let cache = null;
    if (places) {
      cache = new PreviewCache({locate: places.locate, load: async ({cue}, signal) => {
        const data = await mkvKeyFrame(places, cue, side(signal));
        return data ? decode(data, signal) : null;
      }});
    } else if (/mp4|quicktime|mov/i.test(info.container || '') && video.ref) {
      cache = this.mp4Previews(source, video, offset, side, decode);
    }
    this.record('preview', cache ? (places ? 'cues' : 'mp4') : 'none');
    return cache;
  },

  /**
   * MP4: Mediabunny names the key frame from its sample table in memory (metadataOnly reads nothing); its place
   * comes from the movie box, looked at in the reader's cache or fetched once with a side request.
   */
  mp4Previews(source, video, offset, side, decode) {
    const cutoff = 4 << 20; // a movie box larger than this is not fetched for previews
    const sink = new MB.EncodedPacketSink(video.ref);
    let table = null;
    const samples = () => table ??= (async () => {
      const get = (s, e) => source.peek(s, e) || source.sideRead(s, e);
      const at = await findMoov(pos => get(pos, Math.min(source.size, pos + 16)), source.size);
      if (!at || at.end - at.start > cutoff) return null;
      return mp4Samples(await get(at.start, Math.min(source.size, at.end)), video.id);
    })().catch(() => { table = null; return null; });
    return new PreviewCache({
      locate: async time => {
        const packet = await sink.getKeyPacket(Math.max(0, time + offset), {metadataOnly: true});
        return packet && {key: packet.timestamp - offset, packet};
      },
      load: async ({packet}, signal) => {
        const where = (await samples())?.sampleAt(packet.sequenceNumber);
        if (!where || where.size !== packet.byteLength || where.size > PREVIEW.maxFrame || signal.aborted) return null;
        return decode(await side(signal)(where.offset, where.offset + where.size), signal);
      },
    });
  },

  /** The film closed (or another load began): no decoder, no picture is left. */
  closePreviews() {
    this.previews?.close(); this.previews = null;
    this.previewDecoder?.close(); this.previewDecoder = null;
  },
};

/** Puts the previews on the player's prototype; each reset (a new film, a close) closes them. */
export function addPreviews(proto) {
  Object.assign(proto, previewMethods);
  const reset = proto.reset;
  proto.reset = function () { this.closePreviews(); return reset.call(this); };
}
