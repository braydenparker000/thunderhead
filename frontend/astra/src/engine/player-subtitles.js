// The subtitle side of AstraPlayer (player.js): the file's own tracks, read
// from the shared cache as playback downloads it; add-on and viewer files,
// downloaded when chosen; the choice of what shows. Mixed into AstraPlayer's
// prototype, so `this` is the player.
//
// Text tracks are small, so every one is read as the film plays and is ready
// the moment it is chosen. Picture tracks (PGS, VobSub) are decoded only while
// chosen: a film's worth of pictures is many megabytes and a lot of work.

import {MkvSubtitleScanner, Mp4SubtitleScanner} from './embedded-subtitles.js';
import {downloadSubtitle, decodeSubtitleBytes} from '../addons/subtitles.js';
import {parseSubtitleFile} from '../subtitles/parse.js';
import {languageName} from './languages.js';
import {assScript, libassMethods} from './player-libass.js';
import {secondMethods} from './player-second.js';

const NOT_READ = {
  size: 'This file is too large to be subtitles.', type: 'This is not a subtitle file.', binary: 'This is not a subtitle file.',
  address: 'This is not a web address.', empty: 'This file has no subtitles Astra can read.',
};

export const subtitleMethods = {
  ...libassMethods, // styled tracks drawn by libass (player-libass.js)
  ...secondMethods, // the second track (player-second.js)

  /** Lists the file's own subtitle tracks and starts reading its text tracks from the shared cache. */
  startScanner() {
    const {plan, info, probed} = this;
    if (this.scanner || !info) return;
    if (!this.textTracks.some(t => t.kind === 'embedded')) for (const o of plan.subtitleOptions || []) {
      this.textTracks.push({id: o.track.id, label: o.label, language: o.track.language, kind: 'embedded', supported: o.supported, reason: o.reason, forced: o.track.forced, image: !!o.track.image});
    }
    if (!(plan.subtitleOptions || []).some(o => o.supported) || !probed?.source) return;
    const onCues = (trackId, cues) => this.receiveCues(trackId, cues);
    const texts = (info.subtitles || []).filter(s => !s.image);
    this.scanner = info.layout ? new MkvSubtitleScanner(probed.source, info.layout, texts, onCues, () => this.subtitles.refresh())
      : info.subtitles?.some(s => s.samples) ? new Mp4SubtitleScanner(probed.source, info.subtitles, onCues) : null;
    if (this.scanner) this.scanner.onBlocks = (trackId, blocks) => this.receiveBlocks(trackId, blocks); // styled tracks, for libass
    this.scanner?.start();
    const chosen = this.textTracks.find(t => t.id === this.selectedSubtitle);
    if (chosen?.image) this.readPictures(chosen.id);
  },

  /** Decodes the chosen picture track (null: none); the pictures of one no longer chosen are let go. */
  readPictures(id) {
    if (this.pictureScanner?.trackId === id && !this.pictureScanner.stopped) return;
    if (this.pictureScanner) { this.pictureScanner.stop(); this.cues.delete(this.pictureScanner.trackId); this.pictureScanner = null; }
    const track = id && this.info?.layout && (this.info.subtitles || []).find(s => s.id === id && s.image);
    if (!track || !this.probed?.source || this.probed.source.closed) return;
    const scanner = new MkvSubtitleScanner(this.probed.source, this.info.layout, [track], (trackId, cues) => this.receiveCues(trackId, cues), () => this.subtitles.refresh());
    scanner.trackId = id;
    this.pictureScanner = scanner;
    scanner.start();
  },

  stopScanners() {
    this.scanner?.stop(); this.scanner = null;
    this.pictureScanner?.stop(); this.pictureScanner = null;
  },

  receiveCues(trackId, cues) {
    // Embedded cues are in file time; a remux session that starts the file at 0:00 shifts them too.
    const shift = this.session?.offset || 0;
    if (shift && /^(mkv|mp4):/.test(trackId)) for (const c of cues) { c.start -= shift; c.end -= shift; }
    if (!this.cues.has(trackId)) this.cues.set(trackId, []);
    this.cues.get(trackId).push(...cues);
    if (trackId === this.selectedSubtitle) this.subtitles.addCues(cues);
    this.secondCues(trackId, cues);
  },

  /** Subtitle choices: built-in first, then exact matches, then the rest in arrival order. */
  subtitleOptions() {
    const rank = t => t.kind === 'embedded' ? 0 : t.kind === 'stream' ? 1 : t.exact ? 2 : 3;
    return this.textTracks.map((t, i) => ({t, i})).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
      .map(({t}) => ({id: t.id, label: t.label, language: t.language, kind: t.kind, supported: t.supported, reason: t.reason, forced: t.forced, source: t.source || '', exact: !!t.exact, name: t.name || '', loading: !!t.loading, image: !!t.image, selected: t.id === this.selectedSubtitle}));
  },

  /** Shows a subtitle track, or none with null. */
  selectSubtitle(id) {
    const track = id == null ? null : this.textTracks.find(t => t.id === id);
    if (id != null && (!track || !track.supported)) return;
    this.selectedSubtitle = track ? track.id : null;
    if (track && track.id === this.secondSubtitle) this.dropSecond(); // one track is not shown twice
    if (this.hls) this.hls.subtitleTrack = track?.kind === 'stream' ? track.index : -1;
    if (this.dash) {
      this.dash.enableText?.(track?.kind === 'stream');
      if (track?.kind === 'stream') this.dash.setTextTrack?.(track.index);
    }
    if (track?.kind === 'stream') queueMicrotask(() => this.pullTextTrackCues());
    this.readPictures(track?.kind === 'embedded' && track.image ? track.id : null);
    this.subtitles.setCues(track ? this.cues.get(track.id) || [] : []);
    this.styleSubtitle(track); // ASS/SSA: libass too (player-libass.js)
    if (track?.kind === 'external' && !track.loaded) this.loadTrack(track);
    this.record('subtitle', track?.label ?? 'off');
    this.emit('tracks');
  },

  /** Downloads and reads an add-on's subtitle file the first time it is chosen (ends with the load; 20 s at most). */
  loadTrack(track) {
    if (track.loaded || track.loading) return track.loading;
    const signal = this.abort?.signal;
    track.loading = (async () => {
      try {
        const bytes = await downloadSubtitle(track.url, {signal, timeout: 20000});
        const text = decodeSubtitleBytes(bytes, track.language), cues = parseSubtitleFile(text, track.format || track.url);
        if (!cues.length) throw Object.assign(Error('empty'), {kind: 'empty'});
        track.loaded = true;
        track.assText = assScript(text, track.format || track.url);
        if (!this.textTracks.includes(track)) return;
        this.receiveCues(track.id, cues);
        if (this.selectedSubtitle === track.id && track.assText) this.styleSubtitle(track);
      } catch (e) {
        if (signal?.aborted || !this.textTracks.includes(track)) return; // another film, or closed: nothing to say
        track.supported = false;
        track.reason = NOT_READ[e?.kind] || (e?.kind === 'http' ? String(e.message) : e?.name === 'TimeoutError' ? 'The subtitle server did not answer.' : 'Could not be downloaded.');
        if (this.selectedSubtitle === track.id) { this.selectedSubtitle = null; this.subtitles.setCues([]); }
        if (this.secondSubtitle === track.id) this.dropSecond();
        this.record('subtitle-error', e?.kind || e?.name || 'failed');
      } finally {
        track.loading = null;
        if (this.textTracks.includes(track)) this.emit('tracks');
      }
    })();
    return track.loading;
  },

  /**
   * Adds a subtitle file (from an add-on, the stream or the viewer). It is
   * listed at once and downloaded when chosen. Returns its id (null for a duplicate).
   */
  addSubtitleTrack({url = null, text = null, label = '', language = '', format = '', source = '', exact = false, name = ''}, {silent = false} = {}) {
    if (url && this.textTracks.some(t => t.url === url)) return null;
    this.externalCount = (this.externalCount || 0) + 1;
    const id = 'ext:' + this.externalCount;
    const track = {id, label: label || languageName(language) || 'Subtitles', language, kind: 'external', supported: true, url, format, source, exact, name, loaded: text != null, assText: text != null ? assScript(text, format || url || '') : null};
    this.textTracks.push(track);
    if (text != null) this.receiveCues(id, parseSubtitleFile(text, format || url || ''));
    if (!silent) this.emit('tracks');
    return id;
  },

  /** Adds many at once (one 'tracks' event). `load` drops a list meant for an earlier file. */
  addSubtitleTracks(list, load = this.load_) {
    if (load !== this.load_ || !list?.length) return [];
    const ids = list.map(s => this.addSubtitleTrack(s, {silent: true})).filter(Boolean);
    this.emit('tracks');
    return ids;
  },
};
