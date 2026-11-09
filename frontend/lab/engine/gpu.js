// @ts-check
// The engine test page's GPU stage (docs/engineering/ENGINE-RESEARCH.md). The binned proxy goes to the GPU
// once; every change re-runs one compute pass, in the order the DNG specification and Camera Raw use for a
// camera profile: white-balanced camera RGB → linear ProPhoto (ForwardMatrix) → HueSatMap → exposure →
// LookTable → the profile's tone curve (hue-preserving "RGB tone") → a look's RGB table (Adobe RGB, γ 2.2)
// → sRGB on screen, turned upright. Without a profile it falls back to the camera matrix and a filmic curve.
import { PROPHOTO_TO_SRGB, PROPHOTO_TO_ADOBE, cameraToProPhoto, inv } from './dcp.js';

const WGSL = /* wgsl */ `
struct P { m0: vec4f, m1: vec4f, m2: vec4f, o0: vec4f, o1: vec4f, o2: vec4f, a0: vec4f, a1: vec4f, a2: vec4f, b0: vec4f, b1: vec4f, b2: vec4f,
  f: vec4f,      // ev, contrast, table amount, unused
  size: vec4u,   // w, h, rotation (0..3), flags (1 hsm, 2 look, 4 tone, 8 table, 16 hsm sRGB value, 32 look sRGB value)
  hsm: vec4u, look: vec4u, tab: vec4u };   // dims h, s, v, offset · same · tone offset, table n, table offset, unused
@group(0) @binding(0) var<storage, read> src: array<u32>;
@group(0) @binding(1) var<uniform> p: P;
@group(0) @binding(2) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<storage, read> t: array<f32>;
fn mv(r0: vec4f, r1: vec4f, r2: vec4f, c: vec3f) -> vec3f { return vec3f(dot(r0.xyz, c), dot(r1.xyz, c), dot(r2.xyz, c)); }
fn enc(x: f32) -> f32 { return select(1.055 * pow(x, 1.0 / 2.4) - 0.055, 12.92 * x, x <= 0.0031308); }
fn dec(x: f32) -> f32 { return select(pow((x + 0.055) / 1.055, 2.4), x / 12.92, x <= 0.04045); }
fn hsv(c: vec3f) -> vec3f {
  let mx = max(c.r, max(c.g, c.b)); let mn = min(c.r, min(c.g, c.b)); let d = mx - mn;
  if (mx <= 0.0) { return vec3f(0.0); }
  var h = 0.0;
  if (d > 0.0) { if (mx == c.r) { h = (c.g - c.b) / d; } else if (mx == c.g) { h = 2.0 + (c.b - c.r) / d; } else { h = 4.0 + (c.r - c.g) / d; } }
  if (h < 0.0) { h += 6.0; }
  return vec3f(h, d / mx, mx);
}
fn rgb(x: vec3f) -> vec3f {
  let h = x.x - 6.0 * floor(x.x / 6.0); let i = floor(h); let f = h - i; let v = x.z;
  let p1 = v * (1.0 - x.y); let q = v * (1.0 - x.y * f); let r = v * (1.0 - x.y * (1.0 - f));
  switch (u32(i)) { case 0u: { return vec3f(v, r, p1); } case 1u: { return vec3f(q, v, p1); } case 2u: { return vec3f(p1, v, r); }
    case 3u: { return vec3f(p1, q, v); } case 4u: { return vec3f(r, p1, v); } default: { return vec3f(v, p1, q); } }
}
fn cell(o: u32, d: vec3u, h: u32, s: u32, v: u32) -> vec3f { let k = o + ((v * d.x + h) * d.y + s) * 3u; return vec3f(t[k], t[k + 1u], t[k + 2u]); }
// a HueSatMap or LookTable: hue wraps, saturation and value clamp; entries are (hue shift °, sat scale, value scale)
fn hsd(c: vec3f, d: vec4u, srgbV: bool) -> vec3f {
  var x = hsv(max(c, vec3f(0.0)));
  if (x.z <= 0.0) { return c; }
  let vv = select(x.z, enc(min(x.z, 1.0)), srgbV);
  let hf = x.x * f32(d.x) / 6.0; let h0 = u32(floor(hf)) % d.x; let h1 = (h0 + 1u) % d.x; let fh = fract(hf);
  let sf = x.y * f32(d.y - 1u); let s0 = min(u32(floor(sf)), d.y - 1u); let s1 = min(s0 + 1u, d.y - 1u); let fs = sf - floor(sf);
  let vf = clamp(vv, 0.0, 1.0) * f32(max(d.z, 1u) - 1u); let v0 = min(u32(floor(vf)), max(d.z, 1u) - 1u); let v1 = min(v0 + 1u, max(d.z, 1u) - 1u); let fv = vf - floor(vf);
  let a = mix(mix(cell(d.w, d.xyz, h0, s0, v0), cell(d.w, d.xyz, h1, s0, v0), fh), mix(cell(d.w, d.xyz, h0, s1, v0), cell(d.w, d.xyz, h1, s1, v0), fh), fs);
  let b = mix(mix(cell(d.w, d.xyz, h0, s0, v1), cell(d.w, d.xyz, h1, s0, v1), fh), mix(cell(d.w, d.xyz, h0, s1, v1), cell(d.w, d.xyz, h1, s1, v1), fh), fs);
  let e = mix(a, b, fv);
  x.x = x.x + e.x / 60.0; x.y = clamp(x.y * e.y, 0.0, 1.0);
  if (srgbV && x.z <= 1.0) { x.z = dec(clamp(vv * e.z, 0.0, 1.0)); } else { x.z = x.z * e.z; }
  return rgb(x);
}
fn curve(x: f32) -> f32 { let f = clamp(x, 0.0, 1.0) * 1023.0; let i = u32(floor(f)); let j = min(i + 1u, 1023u); return mix(t[p.tab.x + i], t[p.tab.x + j], f - floor(f)); }
// Adobe's hue-preserving tone: the curve on the largest and smallest channel, the middle one in proportion
fn tone(c0: vec3f) -> vec3f {
  let c = clamp(c0, vec3f(0.0), vec3f(1.0)); let mx = max(c.r, max(c.g, c.b)); let mn = min(c.r, min(c.g, c.b));
  let tx = curve(mx); let tn = curve(mn); let k = select((tx - tn) / (mx - mn), 0.0, mx - mn <= 1e-6);
  return vec3f(tn + (c.r - mn) * k, tn + (c.g - mn) * k, tn + (c.b - mn) * k);
}
fn film(c: vec3f) -> vec3f { let y = dot(c, vec3f(0.2126, 0.7152, 0.0722)); let ty = y / (1.0 + y * 0.6) * 1.6; return c * (ty / max(y, 1e-6)); }
fn tab(c: vec3f) -> vec3f {
  let n = p.tab.y; let a = clamp(mv(p.a0, p.a1, p.a2, c), vec3f(0.0), vec3f(1.0));
  let g = pow(a, vec3f(1.0 / 2.2)) * f32(n - 1u); let i = min(vec3u(floor(g)), vec3u(n - 2u)); let f = g - vec3f(i);
  var acc = vec3f(0.0);
  for (var k = 0u; k < 8u; k++) {
    let o = vec3u(k & 1u, (k >> 1u) & 1u, (k >> 2u) & 1u); let w = select(1.0 - f, f, o == vec3u(1u));
    let q = p.tab.z + (((i.x + o.x) * n + (i.y + o.y)) * n + (i.z + o.z)) * 3u;
    acc += vec3f(t[q], t[q + 1u], t[q + 2u]) * w.x * w.y * w.z;
  }
  let lin = pow(acc, vec3f(2.2));
  return mix(c, mv(p.b0, p.b1, p.b2, lin), p.f.z);
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let w = p.size.x; let h = p.size.y; let fl = p.size.w;
  if (id.x >= w || id.y >= h) { return; }
  let i = (id.y * w + id.x) * 2u;
  let rg = unpack2x16unorm(src[i]); let ba = unpack2x16unorm(src[i + 1u]);
  var c = max(mv(p.m0, p.m1, p.m2, vec3f(rg.x, rg.y, ba.x)), vec3f(0.0));
  if ((fl & 1u) != 0u) { c = hsd(c, p.hsm, (fl & 16u) != 0u); }
  c = c * exp2(p.f.x);
  let y = max(dot(c, vec3f(0.288, 0.712, 0.0)), 1e-6);
  c = c * (0.18 * pow(y / 0.18, p.f.y) / y);
  if ((fl & 2u) != 0u) { c = hsd(c, p.look, (fl & 32u) != 0u); }
  if ((fl & 4u) != 0u) { c = tone(c); } else { c = film(c); }
  if ((fl & 8u) != 0u) { c = tab(c); }
  let o = clamp(mv(p.o0, p.o1, p.o2, c), vec3f(0.0), vec3f(1.0));
  var at = vec2u(id.x, id.y);
  switch (p.size.z) { case 1u: { at = vec2u(h - 1u - id.y, id.x); } case 2u: { at = vec2u(w - 1u - id.x, h - 1u - id.y); } case 3u: { at = vec2u(id.y, w - 1u - id.x); } default: {} }
  textureStore(dst, vec2i(at), vec4f(enc(o.r), enc(o.g), enc(o.b), 1.0));
}`;

const ROT = /** @type {Record<string, number>} */ ({ Rotate90: 1, Rotate180: 2, Rotate270: 3 });
const rows = (/** @type {number[]} */ m) => [m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0];
/** The profile's tables in one buffer, and what the shader needs to find them. @param {null | { profile: import('./dcp.js').Profile, table: any }} pick @param {number} w */
function tables(pick, w) {
  const parts = /** @type {Float32Array[]} */ ([]); let off = 0;
  const add = (/** @type {Float32Array} */ a) => { parts.push(a); const o = off; off += a.length; return o; };
  const p = pick?.profile, u = { hsm: [0, 0, 0, 0], look: [0, 0, 0, 0], tab: [0, 0, 0, 0], flags: 0, offset: p?.expOffset || 0 };
  if (p?.hsm) {
    const d = p.hsm.d2 ? p.hsm.d1.map((x, k) => x * w + /** @type {Float32Array} */ (p.hsm?.d2)[k] * (1 - w)) : p.hsm.d1;
    u.hsm = [p.hsm.dims[0], p.hsm.dims[1], p.hsm.dims[2] || 1, add(d)]; u.flags |= 1 | (p.hsm.srgb ? 16 : 0);
  }
  if (p?.look) { u.look = [p.look.dims[0], p.look.dims[1], p.look.dims[2] || 1, add(p.look.d)]; u.flags |= 2 | (p.look.srgb ? 32 : 0); }
  if (p?.tone) {
    const pts = p.tone, n = pts.length / 2, out = new Float32Array(1024);
    for (let k = 0, j = 0; k < 1024; k++) { const x = k / 1023; while (j < n - 2 && pts[(j + 1) * 2] < x) j++; const x0 = pts[j * 2], x1 = pts[j * 2 + 2]; out[k] = pts[j * 2 + 1] + (pts[j * 2 + 3] - pts[j * 2 + 1]) * Math.min(1, Math.max(0, (x - x0) / (x1 - x0 || 1))); }
    u.tab[0] = add(out); u.flags |= 4;
  }
  if (pick?.table) { u.tab[1] = pick.table.n; u.tab[2] = add(pick.table.d); u.flags |= 8; }
  const all = new Float32Array(Math.max(4, off)); let o = 0; for (const a of parts) { all.set(a, o); o += a.length; }
  return { all, u };
}

/** Sets up the device and uploads the proxy; returns setProfile(pick) and render(ev, contrast) → GPU ms.
 * @param {HTMLCanvasElement} canvas @param {{ width: number, height: number, proxy: Uint16Array, meta: any }} img @param {boolean} readback */
export async function engine(canvas, img, readback = false) {
  if (!navigator.gpu) throw new Error('This browser has no WebGPU.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No GPU adapter.');
  const device = await adapter.requestDevice();
  device.lost.then((l) => console.warn('GPU device lost:', l.message));
  const { width: w, height: h } = img, rot = ROT[img.meta.orientation] || 0, [ow, oh] = rot % 2 ? [h, w] : [w, h];
  canvas.width = ow; canvas.height = oh;
  const ctx = readback ? null : /** @type {GPUCanvasContext} */ (canvas.getContext('webgpu'));
  ctx?.configure({ device, format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT, alphaMode: 'opaque' });
  const t0 = performance.now();
  const src = device.createBuffer({ size: img.proxy.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(src, 0, img.proxy.buffer, img.proxy.byteOffset, img.proxy.byteLength);
  const uni = device.createBuffer({ size: 288, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const out = device.createTexture({ size: [ow, oh], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
  const pipe = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: WGSL }), entryPoint: 'main' } });
  const row = Math.ceil((ow * 4) / 256) * 256;
  const back = readback ? device.createBuffer({ size: row * oh, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) : null;
  await device.queue.onSubmittedWorkDone();
  const uploadMs = performance.now() - t0;
  const neutral = img.meta.wb[1] ? [1 / img.meta.wb[0], 1, 1 / img.meta.wb[2]] : [0.5, 1, 0.6];
  const fallback = { cm1: img.meta.xyzToCamD65, cm2: null, fm1: null, fm2: null, t1: 6504, t2: 6504, hsm: null, look: null, tone: null, expOffset: 0, name: 'Camera matrix', model: '' };
  let tab = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE }), bind = /** @type {GPUBindGroup | null} */ (null), state = { m: [], u: tables(null, 1).u, kelvin: 0 };
  /** @param {null | { profile: import('./dcp.js').Profile, table: any }} pick */
  const setProfile = (pick) => {
    const conv = cameraToProPhoto(/** @type {any} */ (pick?.profile || fallback), neutral), t = tables(pick, conv.weight);
    tab.destroy();
    tab = device.createBuffer({ size: t.all.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(tab, 0, t.all);
    bind = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: src } }, { binding: 1, resource: { buffer: uni } }, { binding: 2, resource: out.createView() }, { binding: 3, resource: { buffer: tab } }] });
    state = { m: conv.matrix, u: t.u, kelvin: Math.round(conv.kelvin) };
    return state.kelvin;
  };
  setProfile(null);
  /** @param {number} ev @param {number} contrast */
  const render = async (ev, contrast) => {
    const t = performance.now(), u = new ArrayBuffer(288), f = new Float32Array(u), n = new Uint32Array(u);
    f.set([...rows(state.m), ...rows(PROPHOTO_TO_SRGB), ...rows(PROPHOTO_TO_ADOBE), ...rows(inv(PROPHOTO_TO_ADOBE)), ev + state.u.offset, contrast, 1, 0]);
    n.set([w, h, rot, state.u.flags, ...state.u.hsm, ...state.u.look, ...state.u.tab], 52);
    device.queue.writeBuffer(uni, 0, u);
    const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
    pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8)); pass.end();
    if (ctx) enc.copyTextureToTexture({ texture: out }, { texture: ctx.getCurrentTexture() }, [ow, oh]);
    if (back) enc.copyTextureToBuffer({ texture: out }, { buffer: back, bytesPerRow: row }, [ow, oh]);
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
    const gpuMs = performance.now() - t;
    if (back) {
      await back.mapAsync(GPUMapMode.READ);
      const b8 = new Uint8Array(back.getMappedRange()), px = new Uint8ClampedArray(ow * oh * 4);
      for (let y = 0; y < oh; y++) px.set(b8.subarray(y * row, y * row + ow * 4), y * ow * 4);
      back.unmap();
      /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')).putImageData(new ImageData(px, ow, oh), 0, 0);
    }
    return gpuMs;
  };
  return { render, setProfile, uploadMs, adapter: adapter.info?.description || adapter.info?.architecture || adapter.info?.vendor || 'GPU', keep: [adapter, device] };
}
