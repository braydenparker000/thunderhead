// @ts-check
// White balance read from the photo itself: the colour under a tap, for the eyedropper. It reads the proxy's
// sensor colours and answers with a camera neutral (what a white thing reads there, G = 1), which dcp.js
// turns into Temp and Tint.
//
// There is no Auto here yet. Three ways of estimating the light from the whole frame were measured against
// the cameras' own white balance on ten sample scenes (nine for the last): grey world, shades of grey
// (Finlayson and Trezzi, 2004) and the Grayness Index (Qian and others, CVPR 2019). They missed by 29, 36 and
// 48 mired on average, always towards a bluer light (a warmer picture), and by far more with sky in the frame:
// worse than leaving the photo as shot.

/** @typedef {{ width: number, height: number, proxy: Uint16Array }} Img */

/** The neutral under a point of the proxy: the mean colour of the unclipped pixels within `r` of it; null when
 * they are all clipped, or black. @param {Img} img @param {number} x @param {number} y @param {number} [r] */
export function neutralAt(img, x, y, r = 10) {
  const { width: w, height: h, proxy: p } = img, s = [0, 0, 0];
  for (let j = Math.max(0, y - r); j <= Math.min(h - 1, y + r); j++) {
    for (let i = Math.max(0, x - r); i <= Math.min(w - 1, x + r); i++) {
      const k = (j * w + i) * 4; if (p[k + 3]) continue;
      s[0] += p[k]; s[1] += p[k + 1]; s[2] += p[k + 2];
    }
  }
  return s[0] > 0 && s[1] > 0 && s[2] > 0 ? [s[0] / s[1], 1, s[2] / s[1]] : null;
}
