// Styled subtitles (ASS/SSA) drawn by libass, for AstraPlayer (player.js).
// Mixed into AstraPlayer's prototype, so `this` is the player.
//
// The chosen track's parsed cues go to the renderer as for any track (they show
// until libass draws, and for good if it cannot start); then the renderer is
// asked for a libass layer (subtitles/renderer.js useLibass) with the script's
// header and, for a film's own track, the fonts attached to the film
// (mkv-attachments.js, read once per film when a styled track is first
// chosen, once the first picture is up and beside playback: an 8 MB font read
// as the film started shared the link with its first cluster). The film's blocks of every styled track are kept as the scanner
// reads them, so a layer started later (a track chosen at minute 20) gets those
// already read, and each new one as it comes. Off, another track, the delay
// and closing reach libass through the renderer (setCues, setDelay, destroy).

import {readFonts, sideReader} from './mkv-attachments.js';

/** The text of a subtitle file when it is ASS/SSA (libass can draw it), else null. */
export function assScript(text, name = '') {
  const body = String(text ?? '').replace(/^﻿/, '');
  if (/^\s*\[Script Info\]/i.test(body)) return body;
  return /\.(ass|ssa)(?:[?#].*)?$/i.test(String(name)) && /^\s*\[V4\+? Styles\]/im.test(body) && /^\s*Dialogue\s*:/im.test(body) ? body : null;
}

export const libassMethods = {
  /** Raw blocks of a film's styled track, as the scanner reads them (file time; shifted as the cues are). */
  receiveBlocks(trackId, blocks) {
    const shift = this.session?.offset || 0;
    const list = shift ? blocks.map(b => ({...b, start: b.start - shift})) : blocks;
    this.assBlocks ??= new Map();
    if (!this.assBlocks.has(trackId)) this.assBlocks.set(trackId, []);
    this.assBlocks.get(trackId).push(...list);
    if (trackId === this.selectedSubtitle && this.styleShown === trackId) this.subtitles.libass?.addBlocks(list);
  },

  /** After setCues() for the chosen track (null: none): a styled one is handed to libass as well. */
  styleSubtitle(track) {
    const ticket = this.styleTicket = (this.styleTicket || 0) + 1, load = this.load_;
    this.styleShown = null;
    if (!track) return;
    if (track.kind === 'external') {
      if (track.assText) { this.styleShown = track.id; this.subtitles.useLibass({header: track.assText}); }
      return;
    }
    const info = track.kind === 'embedded' && !track.image && (this.info?.subtitles || []).find(s => s.id === track.id && s.format === 'ass');
    if (!info) return;
    this.filmFonts().then(fonts => {
      if (ticket !== this.styleTicket || load !== this.load_ || this.selectedSubtitle !== track.id) return;
      this.styleShown = track.id;
      const libass = this.subtitles.useLibass({header: info.header, fonts});
      libass.addBlocks(this.assBlocks?.get(track.id) || []);
    });
  },

  /** The film's attached fonts, read once per film once its first picture is up ([] when it has none or they cannot be read). */
  filmFonts() {
    const at = this.info?.layout?.attachments, source = this.probed?.source, video = this.video;
    if (at == null || !source || source.closed) return Promise.resolve([]);
    const shown = this.started || video.readyState >= 2 ? Promise.resolve() : new Promise(r => video.addEventListener('loadeddata', r, {once: true}));
    return this.fontsRead ??= shown.then(() => source.closed ? [] : readFonts(sideReader(source), source.size, at)).then(fonts => {
      this.record('fonts', fonts.map(f => `${f.name} (${f.data.byteLength} bytes)`));
      return fonts;
    }, error => { this.record('fonts', `not read: ${error?.message || error}`); return []; });
  },

  /** Forgets the film's styled blocks and fonts (each load, close). */
  forgetStyles() { this.assBlocks = null; this.fontsRead = null; this.styleShown = null; this.styleTicket = (this.styleTicket || 0) + 1; },
};
