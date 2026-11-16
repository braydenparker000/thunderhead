// @ts-check
// The editor's adjustments where they start, with no photo needed to know them: each one's zero, those the GPU applies
// today, the white balance presets, where a JPEG starts that a RAF does not, and where Noise starts for an ISO. Kept
// here, apart from the session that uses them (app/session.js), which re-exports them as the boards have always read them.
import { START } from '../../engine/grade.js';

/** Each adjustment's starting value (display units: EV, K, or −100..100). */
export const ZERO = /** @type {Record<string, number>} */ ({ Amount: 100, Cube: 100, Exposure: 0, Contrast: 0, Highlights: 0, Shadows: 0, Whites: 0, Blacks: 0, Temp: 0, Tint: 0, Vibrance: 0, Saturation: 0, Texture: 0, Clarity: 0, Dehaze: 0, Vignette: 0, Grain: 0, 'Grain size': 25, Sharpening: 40, Radius: 1, Detail: 25, Noise: 0, 'Color noise': 25, Distortion: 0, Vignetting: 0, Defringe: 0, ...START });
/** What the GPU applies today; the rest are kept with the edit and wait for their stage. */
export const LIVE = new Set(['Exposure', 'Contrast', 'Highlights', 'Shadows', 'Whites', 'Blacks', 'Temp', 'Tint', 'Vibrance', 'Saturation', 'Distortion', 'Vignetting', 'Texture', 'Clarity', 'Dehaze', 'Sharpening', 'Radius', 'Detail', 'Noise', 'Color noise', 'Vignette', 'Grain', 'Grain size', 'Defringe', ...Object.keys(START)]);
export const WB = /** @type {Record<string, [number, number] | null>} */ ({ 'As shot': null, Auto: null, Daylight: [5500, 10], Cloudy: [6500, 10], Shade: [7500, 10], Tungsten: [2850, 0], Fluorescent: [3800, 21], Flash: [5500, 0] });
export const BASELINE_EV = 0.25;   // measured against the camera's JPEG (/lab/engine/'s colour check)
/** Where a JPEG starts that a RAF does not: the camera sharpened it and cleaned its colour already. */
export const STILL = /** @type {Record<string, number>} */ ({ Sharpening: 0, 'Color noise': 0 });
/** Where Noise starts for a photo shot at an ISO: nothing up to 400, then 20 more for each doubling, to 40 from 1600 up. @param {number} iso */
export const noiseStart = (iso) => Math.max(0, Math.min(40, Math.round(20 * Math.log2((iso || 100) / 400))));
