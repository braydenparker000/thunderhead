// A second subtitle track, for language learning, for AstraPlayer (player.js).
// Mixed into AstraPlayer's prototype, so `this` is the player.
//
// The player hands over the element for it (setSecondLayer); the second track
// is drawn there by a SubtitleRenderer of its own: smaller (SCALE of the first's
// size, in the first's colours and box), at the top of the picture unless a
// line places itself, with the first's delay. Only text tracks: never libass
// (an ASS track shows as plain text), never picture subtitles, never an HLS or
// DASH stream's own track (their players load the cues of one track only), and
// never the track the first shows. Its cues come from the same store as the
// first's (receiveCues), so an embedded track fills in as the film is read and
// an add-on's file is downloaded when chosen, as for the first.

import {SubtitleRenderer} from '../subtitles/renderer.js';

export const SECOND_SCALE = 0.7;

/** Cues moved to the top of the picture: those at the bottom go to the top of the same column; placed ones stay. */
export const atTop = cues => cues.map(c => c.pos || c.image || (c.align || 2) > 3 ? c : {...c, align: (c.align || 2) + 6});

export const secondMethods = {
  setSecondLayer(el) {
    if (this.secondLayer === el) return;
    this.second?.destroy(); this.second = null;
    this.secondLayer = el || null;
    const id = this.secondSubtitle;
    this.secondSubtitle = null;
    if (id) this.selectSecondSubtitle(id);
  },

  /** Whether a track can be the second: '' if so, else why not. */
  secondRefusal(track) {
    if (!track) return 'There is no such track.';
    if (!track.supported) return track.reason || 'This track cannot be shown.';
    if (track.image) return 'Picture subtitles cannot be the second track.';
    if (track.kind === 'stream') return 'A stream\'s own subtitles cannot be the second track.';
    if (track.id === this.selectedSubtitle) return 'This track is already the first subtitle.';
    return '';
  },

  /** Shows a second track (null: none). Returns false when that track cannot be the second. */
  selectSecondSubtitle(id) {
    const track = id == null ? null : this.textTracks.find(t => t.id === id);
    if (id != null && this.secondRefusal(track)) return false;
    this.secondSubtitle = track ? track.id : null;
    if (track && !this.second && this.secondLayer) {
      this.second = new SubtitleRenderer(this.secondLayer, this.video);
      this.followFirst();
    }
    this.second?.setCues(track ? atTop(this.cues.get(track.id) || []) : []);
    if (track?.kind === 'external' && !track.loaded) this.loadTrack(track);
    this.record('second subtitle', track?.label ?? 'off');
    this.emit('tracks');
    return true;
  },

  /** Cues arriving for a track (player-subtitles.js receiveCues): the second's go to its renderer. */
  secondCues(trackId, cues) { if (trackId === this.secondSubtitle) this.second?.addCues(atTop(cues)); },

  /** The second stops showing (its track became the first, or could not be read); 'tracks' is the caller's to send. */
  dropSecond() { this.secondSubtitle = null; this.second?.setCues([]); },

  /**
   * The second renderer takes the first's style (smaller) and delay, now and at each change. The menus change
   * the first renderer only (engine.subtitles.setStyle / setDelay), so its two setters tell the second too.
   */
  followFirst() {
    const first = this.subtitles, second = this.second;
    if (!first.followers) {
      first.followers = new Set();
      for (const name of ['setStyle', 'setDelay']) {
        const own = first[name].bind(first);
        first[name] = (...args) => { const out = own(...args); for (const f of first.followers) f(); return out; };
      }
    }
    first.followers.clear();
    const sync = () => {
      if (this.second !== second) return;
      second.setStyle({...first.style, size: first.style.size * SECOND_SCALE});
      second.setDelay(first.delay);
    };
    first.followers.add(sync);
    sync();
  },

  /** Each load and close: no subtitle shows, the second's renderer is let go, the film's styled blocks and fonts are forgotten. */
  clearSubtitles() {
    this.subtitles.clear();
    this.second?.destroy(); this.second = null; this.secondSubtitle = null;
    this.forgetStyles();
  },

  destroySubtitles() {
    this.second?.destroy(); this.second = null;
    this.subtitles.destroy();
  },
};
