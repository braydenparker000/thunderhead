// @ts-check
// Crop and geometry on the GPU (geometry.js is the same on the CPU), in the subset both dialects share
// (develop-body.js): the output point q is flipped and cropped into the straightened frame, zoomed,
// rotated, put through perspective and the lens's distortion to the photo's uv; lv is the lens
// vignetting's gain there. Then, after the first tap, the lateral colour fix: red and blue sampled
// at their own radial scale.

/** @param {(s: string) => string} t the dialect's rewrite */
export const geoBody = (t) => t(`
  D2 qf = V2(mix(q.x, 1.0 - q.x, U(29).x), mix(q.y, 1.0 - q.y, U(29).y));
  D2 cc = mix(U(26).xy, U(26).zw, qf);
  D1 gx = (cc.x - 0.5) * U(27).w / U(27).z;
  D1 gy = (cc.y - 0.5) / U(27).z;
  D1 rx = U(27).x * gx + U(27).y * gy;
  D1 ry = U(27).x * gy - U(27).y * gx;
  D1 pw = 1.0 - U(28).x * ry - U(28).y * rx / U(27).w;
  rx = rx / pw;
  ry = ry / pw;
  D1 r2 = (rx * rx + ry * ry) / (U(28).w * U(28).w);
  D1 df = 1.0 + U(28).z * r2;
  D2 uv = V2(rx * df / U(27).w + 0.5, ry * df + 0.5);
  D1 lv = max(1.0 + U(29).z * r2, 0.05);
`);

/** @param {(s: string) => string} t */
export const caBody = (t) => t(`
  if (U(30).x != 0.0 || U(30).y != 0.0) {
    D2 ur = V2(0.5) + (uv - V2(0.5)) * (1.0 + U(30).x);
    D2 ub = V2(0.5) + (uv - V2(0.5)) * (1.0 + U(30).y);
    D2 sr2 = ur;
    D2 sb2 = ub;
    if (t) {
      sr2 = (ur - U(19).zw) / (U(20).xy - U(19).zw);
      sb2 = (ub - U(19).zw) / (U(20).xy - U(19).zw);
    }
    c0.r = TAP(sr2).r;
    c0.b = TAP(sb2).b;
  }
`);
