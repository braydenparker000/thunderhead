// Pinch to zoom: two fingers enlarge the picture from 1× to 4×, a one-finger
// drag then moves it within its edges, and a pinch back to (nearly) 1× or the
// aspect button puts it back. The zoom is a transform on the stage, the
// element that holds the video and the layers over it (the picture filter's
// canvas and the subtitles), so they all move together. The fingers are read
// by gestures.js; surface.js hands the results here.

import {pinchZoom, clampPan} from './rules.js';
import {put} from './view.js';

export class Zoom {
  constructor(p) {
    this.p = p;
    this.scale = 1; this.x = 0; this.y = 0;
    this.from = null; // the zoom when a pinch or a pan started
  }

  get zoomed() { return this.scale > 1; }

  size() { const s = this.p.stage; return [s.clientWidth || 1, s.clientHeight || 1]; }

  apply() {
    const {scale, x, y} = this;
    put(this.p.stage, 'transform', scale === 1 ? '' : `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(3)})`);
    this.p.root.classList.toggle('zoomed', scale > 1);
  }

  startPinch() { this.from = {scale: this.scale, x: this.x, y: this.y}; }

  /** `focus` and `mid` are surface pixels: where the fingers started and where they are now (moving both pans too). */
  pinch({ratio, focus, mid}) {
    if (!this.from) return;
    const [w, h] = this.size(), c = {x: focus.x - w / 2, y: focus.y - h / 2};
    const z = pinchZoom(this.from, ratio, c, w, h);
    const moved = clampPan({x: z.x + mid.x - focus.x, y: z.y + mid.y - focus.y}, z.scale, w, h);
    Object.assign(this, {scale: z.scale}, moved);
    this.apply();
    this.p.flash(`${z.scale.toFixed(1)}×`);
  }

  /** A pinch that ends near 1× goes back to the whole picture. */
  endPinch() {
    this.from = null;
    if (this.scale < 1.08) this.reset();
  }

  startPan() { this.from = {scale: this.scale, x: this.x, y: this.y}; }

  pan(dx, dy) {
    if (!this.from) return;
    const [w, h] = this.size();
    Object.assign(this, clampPan({x: this.from.x + dx, y: this.from.y + dy}, this.scale, w, h));
    this.apply();
  }

  endPan() { this.from = null; }

  reset() {
    this.from = null;
    if (this.scale === 1 && !this.x && !this.y) return;
    this.scale = 1; this.x = 0; this.y = 0;
    this.apply();
  }
}
