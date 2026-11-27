// @ts-check
// Sharpening as the fitted photo shows it (the owner, 2026-11-16: the photo zoomed out showed no Sharpening at all, so
// it looked softer than any export of it). An export sharpens at full resolution (deconv.js) and is then made small;
// the fitted photo is the editing copy, a third of the sensor's size, where that sharpening would be a third of a pixel
// wide. So the copy's frame is sharpened at its own size, in brightness alone (no colour fringes), by an amount measured
// so that the fitted frame of the owner's RAF holds as much fine detail as its export made at the copy's size
// (`STRENGTH`), each step of Sharpening as much again; the finest wobbles (noise at that size) are left alone, the more so
// the lower Detail is. Only the editor's own frames (`fitSharpen`): an export's and the engine's checks are untouched.

/** The fitted frame's sharpening for Sharpening at its start (40), measured against the export (see the header): on the
 * owner's RAF at the copy's size, fine detail (the rms of each pixel's brightness against its 3 x 3 mean, levels of 255)
 * 7.42 in the copy's frame and 8.44 in the export; 0.24 brings the frame to 8.44 (2026-11-16). */
export const STRENGTH = 0.24;

const SHADER = /* wgsl */ `
struct P { size: vec2u, amount: f32, floor: f32 }
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> p: P;
const LUMA = vec3f(0.2126, 0.7152, 0.0722);
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= p.size.x || id.y >= p.size.y) { return; }
  let q = vec2i(id.xy); let n = vec2i(p.size) - 1; let c = textureLoad(src, q, 0);
  var b = 0.0;   // the brightness round it, blurred (1 2 1 each way)
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) { b += f32((2 - abs(i)) * (2 - abs(j))) * dot(textureLoad(src, clamp(q + vec2i(i, j), vec2i(0), n), 0).rgb, LUMA); } }
  let d = dot(c.rgb, LUMA) - b / 16.0;
  let k = select(p.amount * smoothstep(p.floor, 2.0 * p.floor, abs(d)), p.amount, p.floor <= 0.0);
  textureStore(dst, q, vec4f(clamp(c.rgb + k * d, vec3f(0.0), vec3f(1.0)), c.a));
}`;

/** The pass, for one device: `run` sharpens `out` (the frame, w x h, rgba8unorm) in place, by way of a texture of its own.
 * @param {GPUDevice} device */
export function fitSharpener(device) {
  const pipe = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: SHADER }), entryPoint: 'main' } });
  const uni = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  let tmp = /** @type {GPUTexture | null} */ (null), bg = /** @type {GPUBindGroup | null} */ (null), bgOut = /** @type {GPUTexture | null} */ (null), bgTmp = /** @type {GPUTexture | null} */ (null);
  return {
    /** @param {GPUCommandEncoder} enc @param {GPUTexture} out @param {number} w @param {number} h @param {number} sharpen Sharpening / 40 @param {number} detail 0..1 */
    run(enc, out, w, h, sharpen, detail) {
      if (!tmp || tmp.width !== w || tmp.height !== h) { tmp?.destroy(); tmp = device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC }); }
      if (!bg || bgOut !== out || bgTmp !== tmp) {
        bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: out.createView() }, { binding: 1, resource: tmp.createView() }, { binding: 2, resource: { buffer: uni } }] });
        bgOut = out; bgTmp = tmp;
      }
      const u = new ArrayBuffer(16); new Uint32Array(u).set([w, h]); new Float32Array(u).set([STRENGTH * sharpen, 0.012 * (1 - Math.min(1, Math.max(0, detail)))], 2);
      device.queue.writeBuffer(uni, 0, u);
      const pass = enc.beginComputePass();
      pass.setPipeline(pipe); pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8)); pass.end();
      return tmp;
    },
    destroy() { tmp?.destroy(); uni.destroy(); bg = bgOut = bgTmp = null; },
  };
}
