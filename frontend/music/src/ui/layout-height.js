// The height Music lays out at, from the window's height as it changes (MUSIC.md §5.10).
// At /music the page asks the keyboard not to resize it (interactive-widget=resizes-visual), so the
// window keeps its height. Opened from home's ring it sits in home's frame (position:fixed, inset:0)
// and home asks for resizes-content when no app is in front; with Music in front it now asks for
// resizes-visual too (th/island/island.js), so neither window resizes and app.js passes the visual
// viewport's height (ui/viewport-top.js) while a field has focus. The rules below still hold for any
// window that does resize (an older home, a turn of the phone):
// - while a text field has focus, the keyboard's height counts, but a step above the full height
//   (a 731 → 759 → 424 opening) is not taken: one relayout per keyboard change;
// - when the field lets go, the full height comes back at once and the keyboard's steps down while it
//   closes are not taken (CLOSE_MS at most): the next screen never lays out squeezed;
// - a height above the full height while the keyboard closes (home's toolbar for a moment, 731 → 759) is
//   taken only when it lasts: still there TALL_MS after the closing time;
// - with no field, the window's height is the full height (a real resize, a turn of the phone).
export const CLOSE_MS = 1000;
export const TALL_MS = 300;

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
    // (Taken here before, it became the full height: the player opened at 759 where the screen is 731.)
    if (now < this.closingUntil + TALL_MS && innerH > this.full) return (this.h = this.full);
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
