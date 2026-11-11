// @ts-check
// The demosaic's second look (demosaic.js makes the first: green four ways, the smoothest kept, then red and
// blue as a ratio to it). With a whole picture in hand, three of the four greens at each red or blue site are
// made again the way Frank Markesteijn's X-Trans method does on its second pass (dcraw 9.20, as darktable
// carries it in src/iop/demosaicing/xtrans.c, GPL 3): from the two greens along that way and how the site's own
// colour differs from that colour there. Markesteijn takes that colour from his own red and blue, made once
// for each way; here it is the first look's, which carries less false colour. Then the smoothest ways are
// chosen again, this time by brightness and both colour differences (his measure), not by green alone, and red
// and blue follow the new green by the first look's ratio.
//
// Measured on five scenes from four 40 MP X-Trans bodies (engine/raw/quality/README.md, "The second look"):
// green gains 1.0 to 2.4 dB over the first look alone and 0.3 to 1.7 dB over Markesteijn's own three passes,
// the whole picture 0.4 to 1.2 dB, with false colour as low as the first look's.
//
// These three passes are appended to demosaic.js's shader and use its names (colour, raw, nearby, HEX, WAY,
// waysAt, the buffers). Margins: the estimate reaches 6 pixels past the rectangle, the greens made again 4,
// how level each way is 2.

/** How far past the rectangle the first look's picture must reach for the second. */
export const REACH = 6;

/** How far a red or blue site's own colour stays as the first look had it when its green is made again. The new
 * green carries that site's own reading, noise and all, so a colour that followed it all the way (0) would take the
 * noise twice: at ISO 6400 that cost 0.3 dB. Half is best without noise and within 0.1 dB of best with it. */
const KEEP = 0.5;

export const AGAIN = /* wgsl */ `
@group(0) @binding(7) var<storage, read_write> est: array<u32>;   // the first look's picture, two a pixel: the rectangle and ${REACH} more each way
fn estAt(q: vec2i) -> vec3f { let s = q - d.at.xy + ${REACH}; let n = u32(s.y * (d.at.z + ${2 * REACH}) + s.x) * 2u; let a = est[n]; return vec3f(f32(a & 0xffffu), f32(a >> 16u), f32(est[n + 1u] & 0xffffu)) / 65535.0; }
@compute @workgroup_size(8, 8)
fn again(@builtin(global_invocation_id) id: vec3u) {
  if (i32(id.x) >= d.at.z + 8 || i32(id.y) >= d.at.w + 8) { return; }
  let q = d.at.xy - 4 + vec2i(id.xy); let k = colour(q);
  if (k == 1u) { return; }
  nearby(vec2f(q) + 0.5, 12.0);
  let s = q + d.phase + 6; let m = s - (s / 3) * 3; let h = u32(m.y * 3 + m.x) * 6u; let wb = d.wb[k];
  var lo = 1e9; var hi = 0.0;
  for (var i = 0u; i < 6u; i++) { let v = raw(q + HEX[h + i]); lo = min(lo, v); hi = max(hi, v); }
  let mine = raw(q) * wb;
  var r: vec3f;   // the second, third and fourth guesses of guess(), made again
  for (var c = 0u; c < 3u; c++) {
    let hx = HEX[h + 3u + c]; let a = q - 2 * hx; let b = q + hx;
    r[c] = clamp((raw(a) + 2.0 * raw(b) - (estAt(a)[k] + 2.0 * estAt(b)[k]) * wb + 3.0 * mine) / 3.0, lo, hi);
  }
  var w = waysAt(q);
  if (m.y == 1) { w.x = r.x; w.z = r.z; w.w = r.y; } else { w.y = r.x; w.z = r.y; w.w = r.z; }   // where guess() put each (the lone greens' rows lie the other way round)
  let n = ((id.y + 8u) * u32(d.at.z + 24) + id.x + 8u) * 2u;
  ways[n] = pack2x16float(w.xy); ways[n + 1u] = pack2x16float(w.zw);
}
// the picture at a place, once for each way: that way's green, red and blue by the first look's ratio to its
// green (the site's own colour as read), on one scale, as brightness and two colour differences
fn looks(x: vec2i) -> array<vec3f, 4> {
  let k = colour(x); let e = estAt(x); let own = raw(x);
  let g4 = select(waysAt(x), vec4f(own), k == 1u);
  var o: array<vec3f, 4>;
  for (var w = 0; w < 4; w++) {
    let g = g4[w]; let t = g / (e.g + 1e-5);
    let red = select(e.r * t, own, k == 0u) * d.wb.x; let blue = select(e.b * t, own, k == 2u) * d.wb.z;
    let y = 0.2627 * red + 0.678 * g + 0.0593 * blue;
    o[w] = vec3f(y, (blue - y) * 0.56433, (red - y) * 0.67815);
  }
  return o;
}
@compute @workgroup_size(8, 8)
fn level2(@builtin(global_invocation_id) id: vec3u) {
  if (i32(id.x) >= d.at.z + 4 || i32(id.y) >= d.at.w + 4) { return; }
  let q = d.at.xy - 2 + vec2i(id.xy);
  nearby(vec2f(q) + 0.5, 12.0);
  var g: array<array<vec3f, 4>, 25>;
  for (var j = 0; j < 5; j++) { for (var i = 0; i < 5; i++) { g[j * 5 + i] = looks(q + vec2i(i - 2, j - 2)); } }
  var bend: array<vec4f, 9>;   // how much each way's picture bends along its own line, here and at the eight around
  for (var j = 0; j < 3; j++) { for (var i = 0; i < 3; i++) {
    let o = (j + 1) * 5 + i + 1; var v = vec4f(0.0);
    for (var w = 0; w < 4; w++) { let st = WAY[w].y * 5 + WAY[w].x; let t = 2.0 * g[o][w] - g[o + st][w] - g[o - st][w]; v[w] = dot(t, t); }
    bend[j * 3 + i] = v;
  } }
  let least = max(8.0 * min(min(bend[4].x, bend[4].y), min(bend[4].z, bend[4].w)), 1e-10);
  var n = vec4u(0u);
  for (var i = 0; i < 9; i++) { n += vec4u(bend[i] <= vec4f(least)); }
  calm[(id.y + 8u) * u32(d.at.z + 20) + id.x + 8u] = n.x | (n.y << 8u) | (n.z << 16u) | (n.w << 24u);
}
@compute @workgroup_size(8, 8)
fn pick(@builtin(global_invocation_id) id: vec3u) {
  if (any(vec2i(id.xy) >= d.at.zw)) { return; }
  let q = d.at.xy + vec2i(id.xy); let e = estAt(q); var g = e.g;
  if (colour(q) != 1u && d.wb.w < 0.5) {   // the first look alone when asked to be quick (demosaic.js, quick)
    var n = vec4u(0u); let s = q - d.at.xy + 10;
    for (var j = -2; j <= 2; j++) { for (var i = -2; i <= 2; i++) { let f = calm[u32((s.y + j) * (d.at.z + 20) + s.x + i)]; n += vec4u(f & 255u, (f >> 8u) & 255u, (f >> 16u) & 255u, f >> 24u); } }
    var most = max(max(n.x, n.y), max(n.z, n.w)); most -= most >> 3u;
    let take = vec4f(n >= vec4u(most));
    g = dot(waysAt(q), take) / (take.x + take.y + take.z + take.w);
  }
  let t = g / (e.g + 1e-5); var c3 = vec3f(e.r * t, g, e.b * t);
  let me = colour(q); if (me != 1u) { c3[me] = mix(c3[me], e[me], ${KEEP}); }   // its own colour follows the new green by half
  let u = vec3u(clamp(c3, vec3f(0.0), vec3f(1.0)) * 65535.0 + 0.5);
  let n = (id.y * u32(d.at.z) + id.x) * 2u; let m = (u32(id.y + ${REACH}u) * u32(d.at.z + ${2 * REACH}) + id.x + ${REACH}u) * 2u + 1u;
  rgb[n] = u.x | (u.y << 16u); rgb[n + 1u] = u.z | (est[m] & 0xffff0000u);   // the clipped colours, as the first look flagged them
}`;
