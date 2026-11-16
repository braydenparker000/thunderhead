// @ts-check
// Between a third of the sensor's size and 100 %, where the screen shows more of the sensor than one full-size view
// holds: the sensor's own pixels are made a tile at a time and laid on the still canvas at the screen's scale (app/zoom.js).
// The tiles sit on a grid of the sensor, so a pan back over one already made at this scale and for this edit takes it
// from what is kept instead of making it again (the owner, 2026-11-16: "remembered for panning back"); what is kept is
// each tile at the size it shows, the last few dozen.

const KEEP = 24, LAP = 8;
const kept = /** @type {Map<string, { bm: ImageBitmap, x: number, y: number }>} */ (new Map());   // each tile as it shows, and the sensor place it was made at

/** Draws the sensor rectangle X..X1 x Y..Y1 at scale `p` onto `still` (its context `ctx`), tile by tile from `v`
 * (a full-size view, `tw` x `th` sensor pixels a tile); `make(x, y, w, h)` makes one tile's ImageData with the engine to
 * itself (or null where the job was left). False if left part-way. `key` names the edit and the scale (a tile kept for
 * another is never laid).
 * @param {{ ctx: CanvasRenderingContext2D, X: number, Y: number, X1: number, Y1: number, p: number, tw: number, th: number, key: string,
 *   make: (x: number, y: number, w: number, h: number) => Promise<{ im: ImageData, X: number, Y: number } | null>, mine: () => boolean }} o */
export async function tiles(o) {
  const { ctx, X, Y, X1, Y1, p, tw, th } = o;
  for (let y = Math.floor(Y / th) * th; y < Y1; y += th) for (let x = Math.floor(X / tw) * tw; x < X1; x += tw) {
    const k = `${o.key}|${x}|${y}`;
    let t = kept.get(k);
    if (t) { kept.delete(k); kept.set(k, t); }   // (the most recent last)
    else {
      const made = await o.make(x, y, tw + LAP, th + LAP);
      if (!made || !o.mine()) return false;
      t = { bm: await createImageBitmap(made.im, { resizeWidth: Math.max(1, Math.round(made.im.width * p)), resizeHeight: Math.max(1, Math.round(made.im.height * p)), resizeQuality: 'high' }), x: made.X, y: made.Y };
      kept.set(k, t); while (kept.size > KEEP) { const [old, d] = /** @type {[string, { bm: ImageBitmap }]} */ (kept.entries().next().value); d.bm.close(); kept.delete(old); }
    }
    ctx.drawImage(t.bm, (t.x - X) * p, (t.y - Y) * p);
  }
  return true;
}
/** Lets every kept tile go (another photo, or memory wanted). */
export function forget() { for (const t of kept.values()) t.bm.close(); kept.clear(); }
