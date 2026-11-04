// @ts-check
// Which GPU path draws the photo: WebGPU where the phone has it, else WebGL2 (iOS before 26, or
// `?gpu=webgl2` to try the fallback). Both give the same five calls: source, detail, clearDetail,
// draw and read.

/** @typedef {{ kind: 'planar', width: number, height: number, data: Uint16Array, x?: number, y?: number } | { kind: 'bitmap', width: number, height: number, bitmap: ImageBitmap }} Source */
/** @typedef {Awaited<ReturnType<typeof import('./gl.js').webgl2>> | Awaited<ReturnType<typeof import('./webgpu.js').webgpu>>} Renderer */

/** @param {HTMLCanvasElement} canvas @returns {Promise<{ r: Renderer, canvas: HTMLCanvasElement }>} */
export async function makeRenderer(canvas) {
  const want = new URLSearchParams(location.search).get('gpu');
  if (want !== 'webgl2' && 'gpu' in navigator) {
    try {
      return { r: await (await import('./webgpu.js')).webgpu(canvas), canvas };
    } catch {
      // A canvas that asked for WebGPU cannot become WebGL2: a fresh one takes its place.
      const fresh = /** @type {HTMLCanvasElement} */ (canvas.cloneNode());
      canvas.replaceWith(fresh);
      canvas = fresh;
    }
  }
  return { r: await (await import('./gl.js')).webgl2(canvas), canvas };
}
