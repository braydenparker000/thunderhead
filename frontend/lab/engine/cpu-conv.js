// @ts-check
// The network's heaviest pass for the CPU (engine/netcpu, built into cpu/conv.wasm and cpu/conv-fused.wasm): one
// instance of it with a made-up layer in its memory, run as often as asked. cpu-worker.js runs one of these on each
// of a phone's cores for the engine test page; tests/lab-engine-cpu.test.mjs checks its sums against plain ones.

/** A layer's shape: channels in and out, and the picture's height and width (the width a multiple of 4, the
 * channels out of 8). @typedef {{ cin: number, cout: number, h: number, w: number }} Shape */
/** The multiply-adds one run of a layer is. @param {Shape} s */
export const macs = (s) => s.cin * s.cout * 9 * s.h * s.w;

/** Small numbers that are the same every time (a seeded generator), about -1 to 1. @param {number} seed */
export function noise(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2147483648 - 1; };
}

/** An instance with a made-up layer laid in its memory: the input with its ring of zeros, the weights, the biases.
 * `run` makes the layer once (0: done); `input`, `weights`, `bias` and `output` are its memory, to read or fill.
 * @param {WebAssembly.Module} module @param {Shape} shape @param {number} [seed] */
export function layer(module, shape, seed = 7) {
  const { cin, cout, h, w } = shape, x = /** @type {any} */ (new WebAssembly.Instance(module, {}).exports);
  const sizes = [(h + 2) * (w + 2) * cin, (cout / 8) * 9 * cin * 8, cout, h * w * cout], at = x.room(4 * sizes.reduce((a, b) => a + b, 0) + 64);
  if (!at) throw new Error('no room for the layer');
  let p = at;
  const [input, weights, bias, output] = sizes.map((n) => { const a = new Float32Array(x.memory.buffer, p, n); p += n * 4; return a; });
  const rnd = noise(seed), scale = 1 / Math.sqrt(9 * cin);   // weights of a size that keeps the sums about as large as the input
  for (let y = 0; y < h; y++) for (let i = 0; i < w * cin; i++) input[((y + 1) * (w + 2) + 1) * cin + i] = rnd();
  for (let i = 0; i < weights.length; i++) weights[i] = rnd() * scale;
  for (let i = 0; i < cout; i++) bias[i] = rnd() * 0.1;
  return { input, weights, bias, output, run: () => /** @type {number} */ (x.conv3(input.byteOffset, weights.byteOffset, bias.byteOffset, output.byteOffset, cin, cout, h, w)) };
}

/** The same layer summed plainly, one multiply and one add at a time, in the order the vectors take them: what the
 * WebAssembly must agree with. @param {Shape} shape @param {Float32Array} input @param {Float32Array} weights @param {Float32Array} bias */
export function plain(shape, input, weights, bias) {
  const { cin, cout, h, w } = shape, out = new Float32Array(h * w * cout), row = (w + 2) * cin;
  for (let ob = 0; ob < cout / 8; ob++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let o = 0; o < 8; o++) {
    let a = bias[ob * 8 + o];
    for (let k = 0; k < 9; k++) {
      const p = (y + Math.floor(k / 3)) * row + (x + (k % 3)) * cin, wt = (ob * 9 + k) * cin * 8 + o;
      for (let c = 0; c < cin; c++) a = Math.fround(a + Math.fround(input[p + c] * weights[wt + c * 8]));
    }
    out[(y * w + x) * cout + ob * 8 + o] = Math.max(a, Math.fround(a * Math.fround(0.1)));
  }
  return out;
}
