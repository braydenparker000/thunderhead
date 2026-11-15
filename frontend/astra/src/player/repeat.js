// A–B repeat, from the Playback menu: the first tap marks A where the film
// is, the second marks B, then playback goes back to A each time it reaches
// B until "Stop repeating". A seek by the owner outside the part ends it, and
// a new film clears it. A and B show on the seek bar (marks.js).

import {clock} from '../ui/dom.js';
import {repeatRange, outsideRange} from './rules.js';

export class Repeat {
  constructor(p) {
    this.p = p;
    this.a = null; // A, while B is awaited
    this.range = null; // {start, end} while repeating
    this.looping = false; // our own jump back, not the owner's seek
    const v = p.video;
    v.addEventListener('timeupdate', () => { if (this.range && !v.seeking && v.currentTime >= this.range.end) this.back(); });
    v.addEventListener('ended', () => { if (this.range) { this.back(); v.play().catch(() => {}); } });
    v.addEventListener('seeking', () => {
      if (this.looping) { this.looping = false; return; }
      if (outsideRange(v.currentTime, this.range)) { this.clear(); this.p.flash('Repeat ended'); }
    });
  }

  back() { this.looping = true; this.p.video.currentTime = this.range.start; }

  /** What the menu's button says. */
  get label() { return this.range ? 'Stop repeating' : this.a != null ? 'Set end (B)' : 'Set start (A)'; }
  get status() {
    if (this.range) return `Repeating ${clock(this.range.start)} – ${clock(this.range.end)}`;
    return this.a != null ? `From ${clock(this.a)}: tap again where it should end` : 'Plays one part over and over';
  }

  press() {
    const p = this.p, t = p.video.currentTime;
    if (this.range) { this.clear(); p.flash('Repeat off'); }
    else if (this.a == null) { this.a = t; p.flash('A ' + clock(t)); }
    else {
      const range = repeatRange(this.a, t);
      if (!range) { p.flash('The part must be at least a second long'); return; }
      this.range = range; this.a = null;
      p.flash(`Repeating ${clock(range.start)} – ${clock(range.end)}`);
      if (t > range.end || t < range.start) this.back();
    }
    p.extras.marks.render();
  }

  clear() {
    if (this.a == null && !this.range) return;
    this.a = null; this.range = null; this.looping = false;
    this.p.extras?.marks.render();
  }
}
