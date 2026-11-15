// Skip times for the episode playing, from two places, merged by kind:
//  - found on this phone by sound (engine/intro-finder.js): what was found
//    before shows at once; the engine hands the finder decoded sound through
//    engine.setSoundTap while it wants some. Settings › Playback "Find intros
//    by sound" (on unless turned off).
//  - looked up for anime on AniSkip (addons/skip-times.js), only when the
//    owner turned "Look up anime skip times" on (off by default).
// A looked-up segment wins over one found by sound of the same kind, and a
// recap only ever comes from the lookup. Movies get neither. The player's
// Skip button (player/markers.js) offers them; nothing skips by itself.
// The finder, its store and the lookup load with the first episode, not with
// the app (playing.js, which makes this, loads at start).

const parts = () => Promise.all([import('../engine/intro-finder.js'), import('./intro-store.js'), import('../addons/skip-times.js')])
  .then(([f, s, l]) => ({Finder: f.IntroFinder, store: s.introStore(), lookup: l.lookupSkipTimes}));

/** The segments shown: by kind, looked-up over found-by-sound; recaps from the lookup only. */
export function mergeSkipSegments(sound = [], lookup = []) {
  const out = new Map();
  for (const s of sound || []) if (s.type !== 'recap' && s.end > s.start) out.set(s.type, {type: s.type, start: s.start, end: s.end});
  for (const s of lookup || []) if (s.end > s.start) out.set(s.type, {type: s.type, start: s.start, end: s.end});
  return [...out.values()].sort((a, b) => a.start - b.start);
}

export class SkipTimes {
  /**
   * @param {object} player  the PlayerScreen
   * @param {{settings: () => object, store?: object, Finder?: Function, lookup?: Function}} o  store, Finder and lookup may be passed for tests
   */
  constructor(player, {settings, store, Finder, lookup}) {
    Object.assign(this, {player, settings});
    this.given = {store, Finder, lookup};
    this.ep = null;
    player.engine.addEventListener('ready', () => this.ready());
    // The episode played to its end: the finder keeps what it learned now, not at the next episode.
    player.video.addEventListener('ended', () => this.finish());
  }

  /** {Finder, store, lookup}: those given, the rest loaded once. */
  parts() { return (this.loading ??= parts().catch(() => ({})).then(got => { const g = this.given; return {Finder: g.Finder || got.Finder, store: g.store || got.store, lookup: g.lookup || got.lookup}; })); }
  get findOn() { return this.settings()?.findIntros !== false; }
  get lookupOn() { return this.settings()?.skipLookup === true; }

  /**
   * An episode starts (before its stream loads), or a movie (null): what was
   * found for it before is shown at once. The same episode again (another
   * source) keeps its finder and segments.
   * @param {{series: {type, id}, video: string, season?: number, episode?: number} | null} ep
   */
  episode(ep) {
    if (ep && this.ep && this.ep.video === ep.video && this.ep.series.id === ep.series.id) return;
    this.stop();
    if (!ep?.video || !ep.series?.id) return;
    const cur = this.ep = {...ep, sound: [], lookup: [], finder: null, looked: false, abort: new AbortController()};
    if (this.findOn) this.parts().then(({store}) => store?.known(ep.series, ep.video)).then(segs => { if (segs?.length && this.ep === cur && !cur.sound.length) this.found(cur, segs); }, () => {});
  }

  /** The engine is ready (each load: a new episode, another source, a retry): the finder and the lookup start once the length is known. */
  async ready() {
    const cur = this.ep, v = this.player.video;
    if (!cur) return;
    const d = v.duration;
    if (!(d > 0 && Number.isFinite(d))) { v.addEventListener('durationchange', () => { if (this.ep === cur && this.player.engine.mode !== 'unsupported') this.ready(); }, {once: true}); return; }
    const {Finder, store, lookup} = await this.parts();
    if (this.ep !== cur) return;
    if (this.findOn && Finder) {
      cur.finder ??= new Finder({store, series: cur.series, video: cur.video, duration: d, onSegments: segs => this.found(cur, segs)});
      const e = this.player.engine, f = cur.finder;
      if (typeof e.setSoundTap === 'function') e.setSoundTap({wants: (t, s) => f.wants(t, s), feed: (ch, rate, t) => f.feed(ch, rate, t)});
    }
    if (this.lookupOn && lookup && !cur.looked) {
      cur.looked = true;
      lookup({type: cur.series.type, id: cur.series.id, season: cur.season, episode: cur.episode, duration: d}, {signal: cur.abort.signal})
        .then(segs => { if (segs?.length && this.ep === cur) { cur.lookup = segs; this.show(cur); } }, () => {});
    }
  }

  found(cur, segs) { if (this.ep !== cur) return; cur.sound = segs || []; this.show(cur); }
  show(cur) { if (this.ep === cur && this.player.isOpen) this.player.setSegments(mergeSkipSegments(cur.sound, cur.lookup)); }

  /** The finder stops (keeping what it learned) and the engine stops handing it sound; the episode stays known for a source change. */
  finish() {
    const cur = this.ep;
    if (!cur?.finder) return;
    cur.finder.close();
    cur.finder = null;
    this.untap();
  }

  untap() { const e = this.player.engine; if (typeof e.setSoundTap === 'function') e.setSoundTap(null); }

  /** The episode is left: another episode, a movie, or the player closed. */
  stop() {
    const cur = this.ep;
    if (!cur) return;
    this.ep = null;
    cur.abort.abort();
    if (cur.finder) { cur.finder.close(); cur.finder = null; }
    this.untap();
  }
}
