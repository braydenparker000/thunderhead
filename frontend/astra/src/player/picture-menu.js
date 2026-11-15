// The Picture section at the top of the stream-info menu: the upscale (Standard,
// or Anime4K for drawn animation), sharpening and smoother banding (enhance/picture.js draws the film through its filter on
// a canvas in the player's picture layer, inside the zoomed stage, so a pinch
// moves it with the video). All are prefs, put back on every film; a film
// the filter cannot take (a host that does not let the page read it, HDR on a
// device that cannot draw it at half-float precision) simply shows the plain
// picture, and the section says why. HDR films are tone-mapped (tonemap.js).
//
// Why the stream-info menu: it is where the film's picture is described
// (size, HDR, frames dropped), it already opens as a menu a thumb reaches
// from the bar, and the bar itself is full; the aspect button stays one tap.
//
// When the filter steps itself down or switches itself off because the phone
// falls behind, a notice says so once, in plain words.

import {h} from '../ui/dom.js';
import {Picture, HDR} from '../enhance/picture.js';
import {savePrefs} from './prefs.js';

export const SHARPEN = [[0, 'Off'], [0.35, 'Low'], [0.65, 'Medium'], [1, 'High']];
export const UPSCALE = [['standard', 'Standard'], ['anime', 'Animation (Anime4K)']];
// Reasons that only mean "not for this film": shown in the section, never as a notice.
const quiet = r => r === HDR.reason || /host|Nothing is loaded|address/.test(r);

export class PictureControl {
  constructor(p) {
    this.p = p;
    this.picture = null;
    this.told = new Set(); // notices already shown for this film
    // Before the filter's own loadstart handler (registered later, on first use): the last film's HDR must not refuse this one.
    p.video.addEventListener('loadstart', () => { if (this.picture) this.picture.hdr = false; this.told.clear(); });
    p.engine.addEventListener('ready', () => this.apply());
  }

  get wanted() { const s = this.p.prefs; return {sharpen: Math.min(1, Math.max(0, +s.sharpen || 0)), deband: !!s.deband, upscale: s.upscale === 'anime' ? 'anime' : 'standard'}; }
  static on(w) { return w.sharpen > 0 || w.deband || w.upscale === 'anime'; }
  get hdr() { return !!this.p.engine.info?.video?.[0]?.hdr; }

  apply() {
    const w = this.wanted;
    if (!this.picture && !PictureControl.on(w)) return;
    this.make();
    this.picture.hdr = this.hdr;
    this.picture.set(w);
  }

  make() {
    if (this.picture) return;
    const pic = this.picture = new Picture(this.p.video, this.p.pictureLayer, {onReport: r => this.reported(r)});
    // The filter steps down quietly (Anime4K to Standard, de-band off, then a smaller output): say so once, then it can go on.
    const step = pic.stepDown.bind(pic);
    pic.stepDown = () => {
      const before = pic.level, anime = !pic.fallback;
      step();
      if (pic.on && anime && pic.fallback === 'slow') this.tell('Animation upscaling switched to Standard to keep the film smooth.');
      else if (pic.on && pic.level > before) this.tell('Sharpening turned itself down to keep the film smooth.');
      this.refresh();
    };
  }

  reported(reason) {
    if (!quiet(reason)) this.tell(/fast enough/.test(reason) ? 'The sharper picture turned itself off to keep the film smooth.' : 'The sharper picture turned itself off. The plain picture shows.');
    this.refresh();
  }

  tell(text) { if (this.told.has(text)) return; this.told.add(text); this.p.notice(text); }
  refresh() { if (this.p.menus.modalName === 'info') this.p.menus.renderModal(); }

  change(patch) {
    const p = this.p;
    Object.assign(p.prefs, patch); savePrefs(p.prefs);
    if (p.ready) this.apply();
    p.menus.renderModal();
  }

  /** What the section says under its chips: why it is off, or how it is doing. */
  status() {
    const s = this.picture?.state(), w = this.wanted;
    if (!PictureControl.on(w)) return '';
    if (!this.p.ready) return 'Starts with the film.';
    if (s?.reason === HDR.reason) return 'This phone cannot draw HDR films through the filter, so the plain picture shows.';
    if (s?.reason) return /host/.test(s.reason) ? 'This film comes from a host that does not let Astra draw its picture, so the plain picture shows.' : /fast enough/.test(s.reason) ? 'Turned itself off: this phone could not keep up with this film.' : s.reason;
    if (s?.on && s.fallback === 'slow') return s.level > 0 ? 'Standard upscaling, turned down a little, to keep the film smooth.' : 'Standard upscaling for now: Animation could not keep the film smooth.';
    if (s?.on && s.fallback === 'device') return 'This phone cannot run Animation upscaling, so Standard is used.';
    if (s?.on && s.level > 0) return 'Turned down a little to keep the film smooth.';
    if (s?.on && w.upscale === 'anime' && s.drawn === 'standard') return 'This film is already about as big as the screen, so Animation upscaling has nothing to add.';
    return '';
  }

  body() {
    const w = this.wanted, status = this.status();
    const chip = (label, on, onclick, extra = {}) => h('button', {class: 'ap-chip' + (on ? ' on' : ''), type: 'button', 'aria-pressed': String(on), onclick, ...extra}, label);
    const group = (title, ...children) => h('div', {class: 'ap-pb-group'}, h('span', {class: 'ap-label'}, title), ...children);
    return h('div', {class: 'ap-picture'}, h('div', {class: 'ap-pb'},
      group('Upscaling', h('div', {class: 'ap-chips'}, ...UPSCALE.map(([v, label]) => chip(label, v === w.upscale, () => this.change({upscale: v}), {'aria-label': `Upscaling ${label}`}))),
        h('p', {class: 'ap-pb-note'}, 'Animation suits drawn films and series, and uses more battery.')),
      group('Sharpen', h('div', {class: 'ap-chips'}, ...SHARPEN.map(([v, label]) => chip(label, v === w.sharpen, () => this.change({sharpen: v}), {'aria-label': v ? `Sharpen ${label}` : 'Sharpen off'})))),
      group('Smooth banding', h('div', {class: 'ap-chips'}, chip(w.deband ? 'On' : 'Off', w.deband, () => this.change({deband: !w.deband}), {role: 'switch', 'aria-pressed': null, 'aria-checked': String(w.deband), 'aria-label': 'Smooth banding'})),
        h('p', {class: 'ap-pb-note'}, 'Softens stripes in skies and shadows.'))),
      status ? h('p', {class: 'ap-pb-note ap-picture-status'}, status) : null);
  }

  /** The player closed: the canvas goes, and comes back with the next film. */
  close() { this.picture?.stop(); }
}
