// "Start over": a film opened at its saved place more than a minute in says
// where it resumed, for 7 s in the notice across the top (not over the
// picture's middle), with a button back to the start. Only a resume offers
// it: not a place the owner chose, a source switch or "Try again".

import {clock} from '../ui/dom.js';

export const RESUME_OFFER_AFTER = 60;

export class Resume {
  constructor(p) {
    this.p = p;
    this.offer = 0;
    p.video.addEventListener('playing', () => this.firstFrame());
    p.addEventListener('source', () => { this.offer = 0; }); // another source, from where the film was
    p.engine.addEventListener('error', () => { this.offer = 0; }); // "Try again" goes back where it was: no offer
  }

  /** open(): a new film or episode, perhaps at its saved place. */
  opened(o) { this.offer = o.stream && o.startTime > RESUME_OFFER_AFTER ? o.startTime : 0; }

  firstFrame() {
    const p = this.p, at = this.offer;
    this.offer = 0;
    if (!at || !p.isOpen) return;
    p.loader.notice(`Resumed at ${clock(at)}`, {label: 'Start over', run: () => { p.video.currentTime = 0; p.updateTime(); p.showControls(); }});
  }

  close() { this.offer = 0; }
}
