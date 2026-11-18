// The next episode made ready before Next is tapped. While an episode plays and the next one exists, once the
// next-episode card is due (or the outro is two minutes off), the next episode's streams are quietly collected
// as the player's episode switch collects them (playing.js switchEpisode). Only when the very rule that switch
// uses would continue on its own (a stream of the release group playing now) is that stream's address asked of
// the owner's server with mode 'ahead' (addons/debrid.js: never adds anything to TorBox), and only when that
// gives a direct address is the file described through the engine's probe (its header and index: the film is
// then remembered, film-memory.js), then closed: not one byte of picture or sound past what describing needs.
// The add-on's own link is never opened before a tap (following it can make the add-on add the film to TorBox).
// Nothing plays and nothing is chosen that the owner's earlier pick of a release would not choose. A tap on Next
// within ten minutes takes the collected list; the address (kept 45 minutes) and the description come from memory.
//
// None of it happens with Settings › Playback › "Get ready ahead" off or the data saver on; closing the player,
// another source, or leaving the episode ends it.

import {resolveStream} from '../addons/debrid.js';
import {aheadSetting, saverNow} from './ready.js';
import {aired} from './content.js';

export const KEEP = 10 * 60e3; // what was collected is used for this long
const BEFORE_OUTRO = 120; // seconds before a known outro's start

/** Whether to get the next episode ready at `time` of `duration` (pure): the card is due, or a known outro is near. */
export function nextDueSoon(time, duration, {cardDue = false, segments = []} = {}) {
  if (cardDue) return true;
  if (!(duration > 120) || !Number.isFinite(duration)) return false;
  const outro = segments.find(s => (s.type === 'outro' || s.type === 'credits') && duration - s.end < 30);
  return !!outro && time >= outro.start - BEFORE_OUTRO;
}

export class NextReady {
  /** @param {object} app @param {{probe?: Function, resolve?: Function, saver?: () => boolean, now?: () => number}} [options] */
  constructor(app, {probe = null, resolve = resolveStream, saver = () => saverNow(), now = () => Date.now()} = {}) {
    Object.assign(this, {app, probeFn: probe, resolve, saver, now});
    this.job = null;
    this.spent = 0; // bytes preparing has cost on this visit (said in the stream info's log, and in tests)
  }

  /** The switch is on and the data saver off. */
  allowed() { return aheadSetting(this.app.settings) && !this.saver(); }

  /** A progress report from the player (every ten seconds, playing.js). */
  check(time, duration) {
    const player = this.app.player, p = this.app.playing;
    if (!p?.next || this.job?.video === p.next.id) return;
    const markers = player?.markers;
    if (nextDueSoon(time, duration, {cardDue: !!markers?.nextDue?.(time, duration), segments: markers?.segments || []})) this.prepare();
  }

  /** Collects the next episode's streams and, for a same-release stream, describes its file. Resolves the job, or null. */
  async prepare() {
    const app = this.app, p = app.playing, group = app.player?.stream?.bingeGroup;
    if (!p?.next || !p.meta || !aired(p.next) || !this.allowed() || this.job?.video === p.next.id) return null;
    this.stop();
    const job = this.job = {video: p.next.id, group: group || null, at: this.now(), all: null, abort: new AbortController(), bytes: 0, described: false};
    const live = () => this.job === job && !job.abort.signal.aborted;
    try {
      const streams = new app.screenTypes.streams(app, p.meta, p.next, {headless: true});
      const all = await streams.collect().catch(() => []);
      if (!live()) return null;
      // Exactly switchEpisode's rule: the release group playing now, else nothing is prepared (the sources panel waits).
      const same = group && all.find(s => s.stream.bingeGroup === group);
      if (!same) return null; // tried: not asked again for this episode
      job.all = all;
      const answer = await this.resolve(same.stream, {mode: 'ahead', signal: job.abort.signal});
      if (!live() || !answer?.url || answer.via === 'addon') return job; // described at the tap, once it may be played
      const probe = this.probeFn || (await import('../engine/probe.js')).probe;
      let source = null;
      try {
        const probed = await probe(answer.url, {signal: job.abort.signal, onSource: s => { source = s; }});
        probed.input?.dispose?.(); probed.source?.close?.();
        job.described = !!probed.readable;
      } finally {
        source?.close?.();
        job.bytes = source?.bytesFetched || 0;
        this.spent += job.bytes;
      }
      return job;
    } catch { return live() ? job : null; }
  }

  /** What Next may use for this episode: the streams collected for it within ten minutes, with the same release group playing; else null. */
  take(video, group) {
    const job = this.job;
    this.job = null;
    job?.abort.abort();
    if (!job || job.video !== video?.id || !job.all || job.group !== (group || null) || this.now() - job.at > KEEP) return null;
    return job.all;
  }

  /** Ends any preparation (the player closed, another source, the episode left). */
  stop() { this.job?.abort.abort(); this.job = null; }
}
