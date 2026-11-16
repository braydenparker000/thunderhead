// @ts-check
// The editing copy made again, better, once the sensor's own pixels are on the GPU (full.js). The decoder makes the
// copy the photo opens with by taking each 3 x 3 cell's mean of each colour (engine/raw/src/lib.rs): quick, but a
// box is a poor filter, and on an X-Trans sensor a cell's reds, greens and blues sit in different places, so a line
// thinner than the cell lands on them unevenly and comes out coloured (AUDIT.md 8.5: 3.5 times the sensor's own
// fine colour, on a fitted crop). Here each colour of each copy pixel is a weighted mean of that colour's sites
// round the cell's middle (a Gaussian, the same for all three), so the three describe the same place and detail
// past the copy's limit is taken out rather than folded back. A picture (a JPEG) is made over again the same way.
// The clipped flags are the decoder's own (any clipped site in the cell), which the highlight rebuild reads.

const SHADER = /* wgsl */ `
struct D { size: vec2u, phase: vec2i, black: f32, scale: f32, clip: f32, sensor: u32 }
@group(0) @binding(0) var<uniform> d: D;
@group(0) @binding(1) var<storage, read_write> outp: array<u32>;   // RGBA, 16 bits each: the editing copy's own layout
@group(0) @binding(2) var mos: texture_2d<u32>;
@group(0) @binding(3) var pic: texture_2d<f32>;
fn colour(q: vec2i) -> u32 {   // 0 red, 1 green, 2 blue: demosaic.js's layout
  let s = q + d.phase + 6000; let b = s / 3; let m = s - b * 3;
  if (((m.x + m.y) & 1) == 0) { return 1u; }
  return select(0u, 2u, (((b.x + b.y) & 1) == 1) != (m.y == 1));
}
fn lin(c: vec3f) -> vec3f { return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045)); }
const R = 4; const S2 = ${2 * 1.1 * 1.1};   // the Gaussian's reach, in sites, and twice its variance (sigma 1.1 sites)
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= d.size.x || id.y >= d.size.y) { return; }
  var n = vec2i(textureDimensions(pic)); if (d.sensor == 1u) { n = vec2i(textureDimensions(mos)); }
  let c = vec2i(id.xy) * 3 + 1;
  var s = vec3f(0.0); var w = vec3f(0.0); var flags = 0u;
  for (var dy = -R; dy <= R; dy++) { for (var dx = -R; dx <= R; dx++) {
    let q = clamp(c + vec2i(dx, dy), vec2i(0), n - 1); let wt = exp(-f32(dx * dx + dy * dy) / S2);
    if (d.sensor == 1u) {
      let k = colour(q); let v = f32(textureLoad(mos, q, 0).r);
      s[k] += wt * v; w[k] += wt;
      if (abs(dx) <= 1 && abs(dy) <= 1 && v >= d.clip) { flags |= 1u << k; }
    } else { s += wt * lin(textureLoad(pic, q, 0).rgb); w += vec3f(wt); }
  } }
  var v = s / max(w, vec3f(1e-9));
  v = select(v * 65535.0, (v - d.black) * d.scale, d.sensor == 1u);
  let u = vec3u(clamp(v, vec3f(0.0), vec3f(65535.0)));
  outp[(id.y * d.size.x + id.x) * 2u] = u.x | (u.y << 16u);
  outp[(id.y * d.size.x + id.x) * 2u + 1u] = u.z | (flags << 16u);
}`;

/** Makes the editing copy from the sensor's pixels (`mos`, r16uint) or a picture's (`pic`, rgba8unorm) into `dst`, the
 * engine's own copy (w x h, four 16-bit values a pixel), and gives the new copy read back for the page's own uses
 * (the eyedropper, Auto, the heal's search), or null where it could not be made.
 * @param {GPUDevice} device @param {GPUBuffer} dst @param {number} w @param {number} h
 * @param {{ mos?: GPUTexture, pic?: GPUTexture, phase?: number[], black?: number, white?: number }} from */
export async function remake(device, dst, w, h, from) {
  const pipe = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: device.createShaderModule({ code: SHADER }), entryPoint: 'main' } });
  const sensor = !!from.mos, black = from.black ?? 0, white = from.white ?? 65535;
  const dummyU = sensor ? null : device.createTexture({ size: [1, 1], format: 'r16uint', usage: GPUTextureUsage.TEXTURE_BINDING });
  const dummyF = sensor ? device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING }) : null;
  const u = new ArrayBuffer(32); new Uint32Array(u).set([w, h]); new Int32Array(u).set(from.phase || [0, 0], 2); new Float32Array(u).set([black, 65535 / Math.max(1, white - black), black + 0.97 * (white - black)], 4); new Uint32Array(u).set([sensor ? 1 : 0], 7);
  const uni = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), bytes = w * h * 8;
  const back = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeBuffer(uni, 0, u);
  const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
  pass.setPipeline(pipe);
  pass.setBindGroup(0, device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uni } }, { binding: 1, resource: { buffer: dst } },
    { binding: 2, resource: (from.mos || /** @type {GPUTexture} */ (dummyU)).createView() }, { binding: 3, resource: (from.pic || /** @type {GPUTexture} */ (dummyF)).createView() }] }));
  pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8)); pass.end();
  enc.copyBufferToBuffer(dst, 0, back, 0, bytes);
  device.queue.submit([enc.finish()]);
  await back.mapAsync(GPUMapMode.READ);
  const copy = new Uint16Array(back.getMappedRange().slice(0));
  back.destroy(); uni.destroy(); dummyU?.destroy(); dummyF?.destroy();
  return copy;
}
