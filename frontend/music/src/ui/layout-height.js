// The height Music lays out at, from the window's height as it changes (MUSIC.md §5.10).
// At /music the page asks the keyboard not to resize it (interactive-widget=resizes-visual), so the
// window keeps its height. Opened from home's ring it sits in home's frame (position:fixed, inset:0)
// and home asks for resizes-content: every step of home's viewport reaches Music as a resize. Here:
// - while a text field has focus, the keyboard's height counts, but a step above the full height
//   (a 731 → 759 → 424 opening) is not taken: one relayout per keyboard change;
// - when the field lets go, the full height comes back at once and the keyboard's steps down while it
//   closes are not taken (CLOSE_MS at most): the next screen never lays out squeezed;
// - with no field, the window's height is the full height (a real resize, a turn of the phone).
export const CLOSE_MS = 1000;

export class LayoutHeight {
  constructor(h, w) {
    this.full = h;
    this.w = w;
    this.h = h;
    this.closingUntil = 0;
  }

  /** The height to lay out at for this window size; field: a text field has focus; now: ms. */
  next(innerH, innerW, field, now) {
    if (innerW !== this.w) {
      // Turned or resized across: nothing earlier holds.
      this.w = innerW;
      this.closingUntil = 0;
      if (!field) this.full = innerH;
      return (this.h = innerH);
    }
    if (field) return (this.h = Math.min(innerH, this.full));
    if (now < this.closingUntil && innerH < this.full) return (this.h = this.full);
    this.closingUntil = 0;
    this.full = innerH;
    return (this.h = innerH);
  }

  /** The field let go: the full height at once while the keyboard closes. */
  leave(now) {
    this.closingUntil = now + CLOSE_MS;
    return (this.h = this.full);
  }
}
