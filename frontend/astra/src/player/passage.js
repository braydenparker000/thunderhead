// How the player comes and goes (FEEL.md "Stream → player"). Opening: the tapped card (`origin`,
// handed in by the stream list or a Continue Watching card) presses in and stays pressed, and the
// screen dims to black over 220 ms with the title's backdrop still under it: the player's loading
// layer (backdrop, logo, the status line) fades in over the app, which stays where it was. The
// picture stays hidden until its first frame, then cross-fades in over 180 ms as that layer leaves
// (reveal()). Leaving reverses it: the picture fades back to the backdrop (180 ms), the dim lifts off
// the screen it came from (220 ms) and the card lets go. Back during the opening turns it round from
// where it is. Nothing waits: the player's state changes at once, and while it leaves the app behind
// already takes touches (the root is out of reach from the first frame).

import {T, EASE, spring, level, go, stop, handle, holdIn, release, arrive} from './feel.js';
import {timed} from '../ui/feel-log.js';

export const DIM_MS = T.normal; // 220: the screen dims
export const PICTURE_MS = 180; // the first picture cross-fades in; leaving, it fades back to the backdrop

const isElement = v => typeof Element !== 'undefined' && v instanceof Element;

export class Passage {
  constructor(p) {
    this.p = p;
    this.origin = null;
    this.exiting = null; // the leave under way: {cancel(), finish()}
  }

  /** The player opens (from closed). `origin`: the element tapped, which presses in. */
  enter(origin) {
    const p = this.p;
    this.finish(); // a leave still under way ends now (its engine reset included)
    this.origin = isElement(origin) && origin.isConnected ? origin : null;
    if (this.origin) holdIn(this.origin, {name: 'press:origin'});
    p.root.classList.add('opening'); // the picture waits for its first frame
    arrive(p.loading, {ms: 0});
    const veiled = p.veiled; // the app's veil already dimmed the screen (the player's first load)
    p.veiled = false;
    timed('player:open', () => {
      const lv = level();
      if (lv === 'off' || veiled) { stop(p.loading); return handle([]); }
      const anims = [go(p.loading, {opacity: 1}, {from: {opacity: 0}, duration: lv === 'full' ? DIM_MS : T.fade, easing: EASE})];
      // The logo and the status rise a little into place as the dim settles (Full only).
      if (lv === 'full') for (const [i, el] of [p.loadingLogo, p.loadingStatus.parentElement].entries())
        anims.push(go(el, {transform: 'none'}, {from: {transform: 'translateY(12px)'}, duration: T.screen, easing: spring('smooth'), delay: 40 + i * 30}));
      return handle(anims);
    });
  }

  /** The loading layer has gone (the first frame, an error, a source to pick): the picture shows, cross-fading in. */
  reveal() {
    const p = this.p;
    if (!p.root.classList.contains('opening')) return;
    p.root.classList.remove('opening');
    if (level() === 'off') return;
    timed('player:picture', () => handle([go(p.stage, {opacity: 1}, {from: {opacity: 0}, duration: level() === 'full' ? PICTURE_MS : T.fade, easing: EASE})]));
  }

  /**
   * The player has closed (its parts are already stopped): the picture fades to the backdrop, the dim
   * lifts, then the engine lets go of the film and the player hides. `done` runs at the end.
   */
  exit(done) {
    const p = this.p, lv = level(), origin = this.origin;
    this.origin = null;
    let over = false;
    const finish = () => {
      if (over) return;
      over = true;
      this.exiting = null;
      for (const el of [p.root, p.loading, p.stage]) stop(el);
      p.root.classList.remove('leaving', 'opening');
      p.root.inert = false;
      p.loading.classList.remove('parting');
      p.root.hidden = true;
      done();
    };
    if (lv === 'off' || p.root.hidden || p.root.classList.contains('mini')) { finish(); return; }
    p.root.classList.add('leaving'); // out of reach at once: the app behind takes touches now
    p.root.inert = true;
    const opening = p.root.classList.contains('opening'), shown = !p.loading.hidden && p.loading.dataset.leaving == null;
    const from = p.loading.hidden ? 0 : Number(getComputedStyle(p.loading).opacity);
    p.loading.classList.add('parting'); // the backdrop and the logo; not the status, the clock or Close
    arrive(p.loading, {ms: 0});
    const anims = timed('player:close', () => {
      const list = [];
      let at = 0;
      if (!opening && !shown) { // the picture is showing: it fades back to the backdrop first
        list.push(go(p.loading, {opacity: 1}, {from: {opacity: from}, duration: lv === 'full' ? PICTURE_MS : T.fade, easing: EASE, keep: true}));
        at = lv === 'full' ? PICTURE_MS : T.fade;
      }
      // Then the dim lifts from the screen it came from (the root fades as one, from where it is).
      list.push(go(p.root, {opacity: 0}, {duration: lv === 'full' ? DIM_MS : T.fade, easing: EASE, delay: at, keep: true}));
      if (origin) release(origin, {delay: at});
      return handle(list);
    });
    this.exiting = {cancel: () => anims.cancel(), finish};
    anims.finished.then(finish);
  }

  /** Ends a leave under way at once (the player opens again). */
  finish() { const x = this.exiting; if (x) { x.cancel(); x.finish(); } }
}
