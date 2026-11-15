// Plays a file Astra has unpacked itself. Video packets are re-wrapped as
// fragmented MP4 untouched, so the phone's hardware decoder does the work.
// Audio goes into its own SourceBuffer, either re-wrapped ('direct') or
// decoded and re-encoded to Opus ('rebuilt') when the browser cannot decode
// it. Changing audio track refills only that buffer.
//
// Fragments carry absolute timestamps, so after a seek outside the buffered
// range a new pipeline simply starts at the nearest key frame.

import * as MB from '../../vendor/mediabunny.js';
import {mediaSourceClass} from './capabilities.js';
import {AppendQueue, bufferedAt, bufferedAhead, bufferedEnd} from './mse.js';
import {audioMime, videoMime} from './plan.js';
import {mixable} from './downmix.js';
import {fragmentWriter, stereoSample} from './fragments.js';
import {EarlyCuts} from './early.js';
import {loadDecoders} from './audio-decoders.js';
import {StallWatch} from './stall-watch.js';

// Read-ahead limits (seconds; tests shorten them). Picture and sound read to the same place, `apart` at most, so one
// download serves both: kept apart, on a high-bitrate film, the gap outgrew the reader's cache.
export const TUNING = {ahead: 40, apart: 3, maxQueued: 24 << 20};
const OPUS = 'audio/mp4; codecs="opus"';
// Reading and re-wrapping run on the page's own thread: after this many
// milliseconds the reader lets a tap or a frame through.
const SLICE_MS = 8;
const pageTurn = () => globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0));

export {loadDecoders};

export class RemuxSession extends EventTarget {
  /**
   * @param {HTMLVideoElement} video
   * @param {{info: object, video: object|null, audio: {track: object, delivery: string}|null, source?: object, early?: boolean}} plan
   */
  constructor(video, plan) {
    super();
    this.video = video;
    this.info = plan.info;
    this.videoTrack = plan.video;
    this.audio = plan.audio;
    this.source = plan.source || null; // the range reader, told when playback jumps
    this.early = plan.early !== false; // half-second video fragments (early.js); off for a second try after a decode error
    this.queues = {};
    this.ended = {video: !plan.video, audio: !plan.audio};
    this.destroyed = false;
    this.seekTimer = 0;
    this.stats = {appended: 0, restarts: 0};
    this.from = 0;
    this.readAt = {video: 0, audio: 0};
    this.sliceStart = 0;
    this.chain = Promise.resolve(); // restarts and audio changes, one at a time
    this.tickets = {};
    this.offset = 0; // the file's first timestamp; media time = file time - offset
    this.onSeeking = () => this.seeking();
    this.wakers = new Set();
    this.onProgress = () => { for (const w of this.wakers) w(); };
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, {detail})); }

  async start(startTime = 0) {
    const MediaSourceClass = mediaSourceClass();
    if (!MediaSourceClass) throw Error('This browser has no Media Source Extensions.');
    // The audio decoder downloads while the media source opens and the first video is read (pumpAudio waits for it).
    if (this.audio?.delivery === 'rebuilt') loadDecoders(this.audio.track.codec).catch(() => {});
    this.ms = new MediaSourceClass();
    this.url = URL.createObjectURL(this.ms);
    if ('disableRemotePlayback' in this.video) this.video.disableRemotePlayback = true; // required by ManagedMediaSource
    // Until the media source opens; destroy() ends the wait (and lets go of the address) if that comes first.
    this.opening = new AbortController();
    const signal = this.opening.signal;
    await new Promise((resolve, reject) => {
      const closed = () => reject(Object.assign(new Error('Playback was closed.'), {kind: 'closed'}));
      if (this.destroyed) return closed();
      this.ms.addEventListener('sourceopen', resolve, {once: true, signal});
      this.video.addEventListener('error', () => reject(this.video.error), {once: true, signal});
      signal.addEventListener('abort', closed, {once: true});
      this.video.src = this.url;
    }).finally(() => { this.opening.abort(); URL.revokeObjectURL(this.url); });
    // Transport streams (and some recordings) start well after zero; play
    // them from 0:00 by shifting the media rather than leaving a gap.
    const firsts = await Promise.all([this.videoTrack?.ref, this.audio?.track.ref].filter(Boolean).map(t => t.getFirstTimestamp?.().catch(() => 0) ?? 0));
    const first = firsts.length ? Math.min(...firsts) : 0;
    this.offset = first > 0.05 ? first : 0;
    if (this.info.duration > 0) this.ms.duration = Math.max(0.1, this.info.duration - this.offset);
    const fatal = error => this.fail(error);
    if (this.videoTrack) this.queues.video = new AppendQueue(this.ms.addSourceBuffer(videoMime(this.videoTrack)), this.video, fatal);
    if (this.audio) this.queues.audio = new AppendQueue(this.ms.addSourceBuffer(this.audio.delivery === 'rebuilt' ? OPUS : audioMime(this.audio.track)), this.video, fatal);
    if (this.offset) for (const q of Object.values(this.queues)) q.buffer.timestampOffset = -this.offset;
    this.video.addEventListener('seeking', this.onSeeking);
    for (const type of ['timeupdate', 'seeking', 'playing']) this.video.addEventListener(type, this.onProgress);
    if (startTime > 0) this.video.currentTime = startTime;
    this.watch = new StallWatch(this);
    this.run(startTime);
  }

  /** Starts fresh pipelines for every track, reading from `time`; `from` is where the playhead is (no later than `time`). */
  run(time, from = time) {
    this.from = Math.min(from, time);
    this.readAt = {video: time, audio: time};
    if (this.queues.video) this.pumpVideo(this.queues.video.generation, time + this.offset).catch(e => this.fail(e));
    if (this.queues.audio) this.pumpAudio(this.queues.audio.generation, time + this.offset).catch(e => this.fail(e));
  }

  seeking() {
    // Nothing to do when the running pipelines have brought this place (and it is still buffered), or will reach it
    // shortly. Media still buffered from before a far seek back is not enough: the pipelines are elsewhere, and would
    // not follow on from it; nor is a place they passed whose media has since been let go.
    const t = this.video.currentTime, d = this.ms?.duration || Infinity;
    const covered = ([k, q]) => t >= this.from - 0.5 && t <= this.readAt[k] + 5 && (t >= this.readAt[k] - 1 || bufferedAt(q.buffer, t, 0.5, d));
    if (Object.entries(this.queues).every(covered)) return;
    clearTimeout(this.seekTimer);
    this.seekTimer = setTimeout(() => this.jumpTo(this.video.currentTime), 150); // scrubbing settles first
  }

  /** Restarts the pipelines for a playhead at `t`: at `t`, or where the media already buffered around `t` ends. */
  jumpTo(t) {
    const d = this.ms?.duration || Infinity, queues = Object.values(this.queues);
    const held = queues.length && queues.every(q => bufferedAt(q.buffer, t, 0.5, d));
    this.restartAt(t, held ? Math.min(...queues.map(q => bufferedEnd(q.buffer, t))) : t);
  }

  /** Fresh pipelines reading from `at` for a playhead at `time`; restarts and audio changes run in turn, the latest of each kind. */
  restartAt(time, at = time) {
    return this.serial('restart', async () => {
      this.stats.restarts++;
      this.source?.jumped?.();
      await Promise.all(Object.values(this.queues).map(q => q.restart()));
      if (this.destroyed) return;
      // Media buffered beyond where reading starts belongs to an earlier place: it would only take the buffer's room.
      await Promise.all(Object.values(this.queues).map(q => q.dropAfter(at + 1)));
      if (this.destroyed) return;
      for (const k of Object.keys(this.queues)) this.ended[k] = false;
      this.run(at, time);
    });
  }

  /** Runs `fn` after every restart or audio change before it, unless a newer one of the same `kind` was asked for meanwhile. */
  serial(kind, fn, ticket = this.tickets[kind] = (this.tickets[kind] || 0) + 1) {
    const run = this.chain.then(() => this.destroyed || ticket !== this.tickets[kind] ? null : fn());
    this.chain = run.catch(e => this.fail(e));
    return run;
  }

  /** Switches to another audio track: only the audio buffer is refilled. */
  async setAudio(choice) {
    if (this.destroyed || !this.queues.audio) return;
    const ticket = this.tickets.audio = (this.tickets.audio || 0) + 1; // a track chosen later wins, even while this one's decoder downloads
    if (choice.delivery === 'rebuilt') { this.emit('status', 'Loading the audio decoder…'); await loadDecoders(choice.track.codec); }
    return this.serial('audio', async () => {
      const mime = choice.delivery === 'rebuilt' ? OPUS : audioMime(choice.track);
      const was = this.audio.delivery === 'rebuilt' ? OPUS : audioMime(this.audio.track);
      this.audio = choice;
      this.ended.audio = false;
      const generation = await this.queues.audio.reset({mime: mime !== was ? mime : null});
      if (this.destroyed) return;
      if (this.offset) this.queues.audio.buffer.timestampOffset = -this.offset;
      this.flushAudio = generation; // see room()
      this.pumpAudio(generation, Math.max(0, this.video.currentTime - 0.3) + this.offset).catch(e => this.fail(e));
    }, ticket);
  }

  /** Waits while the pipeline is far enough ahead of the playhead. */
  async room(kind, timestamp, generation) {
    const queue = this.queues[kind];
    const current = () => !this.destroyed && queue.generation === generation;
    this.readAt[kind] = timestamp - this.offset;
    if (this.wakers.size) this.onProgress(); // the other pipeline may be waiting for this one to catch up
    // Chrome keeps playing audio it decoded from the old track until a seek
    // flushes it; seek in place once the new track covers the playhead.
    if (kind === 'audio' && this.flushAudio === generation && bufferedAt(queue.buffer, this.video.currentTime, 0.3, this.ms.duration)) {
      this.flushAudio = null;
      this.video.currentTime = this.video.currentTime;
    }
    if (performance.now() - this.sliceStart > SLICE_MS) {
      await pageTurn();
      this.sliceStart = performance.now();
    }
    // Limit how far reading runs ahead of the playhead (not what happens to be buffered there, which may be left
    // from before a seek back), and how much waits to be appended.
    // Neither reads more than `apart` past the other while it still reads: quick-to-read sound would pull the download
    // far past the picture, and the picture's blocks out of the reader's cache.
    const other = kind === 'video' ? 'audio' : 'video';
    const apart = () => this.queues[other] && !this.ended[other] && this.readAt[kind] - this.readAt[other] > TUNING.apart;
    while (current() && (this.readAt[kind] - this.video.currentTime > TUNING.ahead || apart() || queue.pending() > TUNING.maxQueued)) {
      await new Promise(resolve => {
        const done = () => { clearTimeout(timer); this.wakers.delete(done); resolve(); };
        const timer = setTimeout(done, 1000);
        this.wakers.add(done);
      });
    }
    return current();
  }

  output(kind, generation, early = null) { return fragmentWriter(this.queues[kind], this.stats, kind, generation, early); }

  async pumpVideo(generation, from) {
    const track = this.videoTrack.ref;
    const sink = new MB.EncodedPacketSink(track);
    const start = await sink.getKeyPacket(from, {verifyKeyPackets: true}) ?? await sink.getFirstPacket();
    if (this.queues.video.generation !== generation) return;
    if (!start) { this.ended.video = true; return this.finish(); }
    const early = this.early ? new EarlyCuts() : null; // fragments every half second, not only at key frames
    const output = this.output('video', generation, early);
    const source = new MB.EncodedVideoPacketSource(track.codec);
    output.addVideoTrack(source);
    await output.start();
    let first = true;
    for await (const packet of inOrder(sink, start)) {
      if (!await this.room('video', packet.timestamp, generation)) { await output.cancel(); return; }
      await source.add(early ? early.mark(packet) : packet, first ? {decoderConfig: this.videoTrack.decoderConfig} : undefined);
      first = false;
    }
    await output.finalize();
    if (this.queues.video.generation === generation) { this.ended.video = true; this.finish(); }
  }

  async pumpAudio(generation, from) {
    const choice = this.audio, track = choice.track.ref;
    const output = this.output('audio', generation);
    if (choice.delivery === 'rebuilt') {
      await loadDecoders(track.codec);
      if (this.audio !== choice || this.queues.audio.generation !== generation) return;
      const sink = new MB.AudioSampleSink(track);
      // Mixed to stereo here, a sample at a time (downmix.js); only sound that also needs resampling goes through Mediabunny's transform.
      const own = mixable(track.sampleRate);
      const source = new MB.AudioSampleSource({codec: 'opus', bitrate: 192000, ...(own ? {} : {transform: {numberOfChannels: 2, sampleRate: 48000}})});
      output.addAudioTrack(source);
      await output.start();
      for await (const sample of sink.samples(from)) {
        if (this.audio !== choice || !await this.room('audio', sample.timestamp, generation)) { sample.close(); await output.cancel(); return; }
        // An MP4's first sample can start a few milliseconds before zero, which the writer refuses.
        if (sample.timestamp >= 0) {
          const mixed = own ? stereoSample(sample) : sample;
          await source.add(mixed);
          if (own) mixed.close();
        }
        sample.close();
      }
    } else {
      const sink = new MB.EncodedPacketSink(track);
      const start = await sink.getPacket(from) ?? await sink.getFirstPacket();
      if (!start) { this.ended.audio = true; return this.finish(); }
      const source = new MB.EncodedAudioPacketSource(track.codec);
      output.addAudioTrack(source);
      await output.start();
      let first = true;
      for await (const packet of inOrder(sink, start)) {
        if (this.audio !== choice || !await this.room('audio', packet.timestamp, generation)) { await output.cancel(); return; }
        if (packet.timestamp < 0) continue;
        await source.add(packet, first ? {decoderConfig: choice.track.decoderConfig} : undefined);
        first = false;
      }
    }
    await output.finalize();
    if (this.queues.audio.generation !== generation || this.audio !== choice) return;
    if (this.flushAudio === generation) { await this.queues.audio.idle(); this.room('audio', this.video.currentTime, generation); }
    this.ended.audio = true;
    this.finish();
  }

  async finish() {
    if (!this.ended.video || !this.ended.audio || this.ms.readyState !== 'open') return;
    await Promise.all(Object.values(this.queues).map(q => q.idle()));
    if (this.ended.video && this.ended.audio && this.ms.readyState === 'open' && !Object.values(this.queues).some(q => q.buffer.updating)) {
      try { this.ms.endOfStream(); } catch {}
    }
  }

  fail(error) {
    if (this.destroyed) return;
    if (error?.name === 'InputDisposedError' || error?.kind === 'closed') return;
    this.emit('error', error);
  }

  /** Buffer health for the diagnostics panel. */
  health() {
    const t = this.video.currentTime;
    return Object.fromEntries(Object.entries(this.queues).map(([k, q]) => [k, {ahead: +bufferedAhead(q.buffer, t).toFixed(1), queued: q.pending()}]));
  }

  destroy() {
    this.destroyed = true;
    this.opening?.abort(); // a media source still opening: its wait ends, its address is let go
    this.watch?.stop();
    clearTimeout(this.seekTimer);
    this.video.removeEventListener('seeking', this.onSeeking);
    for (const type of ['timeupdate', 'seeking', 'playing']) this.video.removeEventListener(type, this.onProgress);
    for (const q of Object.values(this.queues)) q.generation++;
    this.onProgress();
  }
}

// A track's packets from `start`, each read when asked for. Mediabunny's packets() reads ahead as many as were taken
// in the last second: after a burst that filled 40 seconds, as much again (150 MB on a 30 Mbit/s film).
async function* inOrder(sink, start) {
  for (let packet = start; packet; packet = await sink.getNextPacket(packet)) yield packet;
}
