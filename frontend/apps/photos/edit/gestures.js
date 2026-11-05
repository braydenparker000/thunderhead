// @ts-check
// The photo's gestures in the editor (PHOTOS.md, the editor; GESTURES.md): hold for before/after
// (the as-shot recipe while the finger stays), two fingers for the histogram, pinch to zoom up to
// 1:1 and drag to pan when zoomed, a double tap between fit and 1:1, and, when a tool asks for the
// photo (the white balance picker, Mix's targeted drag), a tap or a vertical drag on it instead. What a
// pinch, a drag and a double tap do to the view is zoom.js's: this reads the fingers.

const HOLD_MS = 350;
const MOVE_PX = 8;
const PINCH_PX = 12;
const DOUBLE_MS = 300;

/**
 * @param {HTMLElement} stage
 * @param {{ before: (on: boolean) => void, histogram: (on: boolean) => void, down: () => void,
 *   pinch: (phase: 'start' | 'move' | 'end', ratio: number, x: number, y: number) => void,
 *   pan: (dx: number, dy: number, t: number) => void, release: () => void, doubleTap: (x: number, y: number) => void,
 *   mode: () => 'view' | 'pick' | 'target', tap: (x: number, y: number) => void, target: (x: number, y: number, dy: number, done: boolean) => void }} on
 */
export function photoGestures(stage, on) {
  /** @type {Map<number, { x: number, y: number, x0: number, y0: number }>} */
  const down = new Map();
  /** @type {ReturnType<typeof setTimeout> | null} */
  let hold = null;
  let holding = false, moved = false, pinching = false, two = false, lastTap = { t: 0, x: 0, y: 0 }, dist0 = 0;
  const stopHold = () => { if (hold) clearTimeout(hold); hold = null; };
  const spread = () => { const [a, b] = [...down.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const mid = () => { const [a, b] = [...down.values()]; return [(a.x + b.x) / 2, (a.y + b.y) / 2]; };
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    down.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    on.down();
    if (down.size === 1) {
      moved = false;
      if (on.mode() === 'view') hold = setTimeout(() => { holding = true; on.before(true); }, HOLD_MS);
    } else if (down.size === 2) {
      stopHold();
      if (holding) { holding = false; on.before(false); }
      two = true;
      dist0 = spread();
      on.histogram(true);
    }
  });
  stage.addEventListener('pointermove', (e) => {
    const p = down.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (down.size === 2) {
      const d = spread();
      const [x, y] = mid();
      // The pinch starts where the fingers are once they part: from there, the spread is the zoom.
      if (!pinching && Math.abs(d - dist0) > PINCH_PX) { pinching = true; dist0 = d; on.histogram(false); on.pinch('start', 1, x, y); }
      else if (pinching) on.pinch('move', d / Math.max(1, dist0), x, y);
      return;
    }
    if (!moved && Math.hypot(p.x - p.x0, p.y - p.y0) > MOVE_PX) { moved = true; stopHold(); }
    if (!moved || holding || two) return;
    if (on.mode() === 'target') on.target(p.x0, p.y0, p.y - p.y0, false);
    else on.pan(dx, dy, e.timeStamp);
  });
  const up = (/** @type {PointerEvent} */ e) => {
    const p = down.get(e.pointerId);
    if (!p) return;
    down.delete(e.pointerId);
    if (pinching && down.size < 2) { pinching = false; on.pinch('end', 1, p.x, p.y); }
    if (down.size > 0) return;
    stopHold();
    on.release();
    if (holding) { holding = false; on.before(false); return; }
    if (two) { two = false; on.histogram(false); return; }
    if (moved) { if (on.mode() === 'target') on.target(p.x0, p.y0, p.y - p.y0, true); return; }
    if (on.mode() !== 'view') { on.tap(p.x, p.y); return; }
    if (e.timeStamp - lastTap.t < DOUBLE_MS && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) { lastTap.t = 0; on.doubleTap(p.x, p.y); return; }
    lastTap = { t: e.timeStamp, x: p.x, y: p.y };
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
}
