// @ts-check
// Two fingers tapped on the photo undo a step; three redo one (docs/design/EDITOR.md), said by the line over the
// photo (told.js). A tap is quick and still: every finger down within a moment of the first, all up within 250 ms,
// none moved 10 pixels. So the end of a pinch or of a two-finger pan is never one, nor is a finger already at work
// with a board's tool (Masks, Heal) when another lands. zoom.js hands on every pointer event the frame hears.
import { redo, undo } from './told.js';

const QUICK = 250, STILL = 10, TOGETHER = 120;   // ms from the first finger down to the last up; pixels a finger may move; ms within which every finger lands
const down = /** @type {Map<number, { x: number, y: number }>} */ (new Map());
let t0 = 0, most = 0, spoiled = false;

/** What the frame heard. `photo`: a finger landing there lands on the photo (not on a board's control).
 * @param {PointerEvent} e @param {boolean} photo */
export function hear(e, photo) {
  const now = e.timeStamp, p = down.get(e.pointerId);
  if (e.type === 'pointerdown') {
    if (down.size && now - t0 > 2000) down.clear();   // a lift never heard (the finger left the page) is not held against the next tap
    if (!down.size) { t0 = now; most = 0; spoiled = false; }
    if (!photo || e.pointerType === 'mouse' || now - t0 > TOGETHER) spoiled = true;
    down.set(e.pointerId, { x: e.clientX, y: e.clientY }); most = Math.max(most, down.size);
    return;
  }
  if (!p) return;
  if (e.type === 'pointercancel' || Math.hypot(e.clientX - p.x, e.clientY - p.y) >= STILL) spoiled = true;
  if (e.type === 'pointermove') return;
  down.delete(e.pointerId);
  if (down.size || spoiled || now - t0 > QUICK) return;
  if (most === 2) undo(); else if (most === 3) redo();
}
