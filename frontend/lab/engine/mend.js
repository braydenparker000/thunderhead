// @ts-check
// Retouching (heal.js), the part the two passes that do it share: warp.js for the editing copy, demosaic.js for the
// sensor's own pixels. It imports nothing, so both can.

/** The spots a pass can carry, and the rows each takes (heal.js `spotRows` fills them). */
export const SPOTS = 32, SPOT_ROWS = 8;
/** The rule both passes share. `rows` is where the pass keeps the spots' rows and `count` how many there are; the
 * pass sets `near` once for each pixel it makes (`nearby`), then asks `spot` for each value it reads.
 * @param {string} rows @param {string} count */
export const mendWGSL = (rows, count) => /* wgsl */ `
var<private> near: u32;   // the spots near the pixel being made, a bit each: most pixels are near none and pay nothing more
fn nearby(s: vec2f, pad: f32) {
  near = 0u;
  for (var i = 0u; i < ${count}; i++) { let a = ${rows}[i * ${SPOT_ROWS}u]; if (distance(s, a.xy) < a.z + pad) { near |= 1u << i; } }
}
// What spot i does to the value at sensor position s of colour c (0 red, 1 green, 2 blue): how much of the source's
// value to take (0: none), and what to multiply it by. The multiplier is what brings the source to the spot's own
// surroundings: stops that vary across the spot the way a membrane stretched on its rim would (a level, then a
// tilt, a saddle and a three-fold bend: the disc's harmonic functions, fitted to a ring of samples by heal.js).
fn spot(i: u32, s: vec2f, c: u32) -> vec2f {
  let a = ${rows}[i * ${SPOT_ROWS}u]; let e = (s - a.xy) / a.z; let t = length(e);   // (names here must not be a pass's own: the rows live in its settings)
  if (t >= 1.0) { return vec2f(0.0, 1.0); }
  let f = ${rows}[i * ${SPOT_ROWS}u + 2u + c * 2u]; let h = ${rows}[i * ${SPOT_ROWS}u + 3u + c * 2u]; let xx = e.x * e.x; let yy = e.y * e.y;
  let stops = f.x + f.y * e.x + f.z * e.y + f.w * (xx - yy) + h.x * 2.0 * e.x * e.y + h.y * e.x * (xx - 3.0 * yy) + h.z * e.y * (3.0 * xx - yy);
  return vec2f((1.0 - smoothstep(1.0 - a.w, 1.0001, t)) * ${rows}[i * ${SPOT_ROWS}u + 1u].z, exp2(stops));
}`;
