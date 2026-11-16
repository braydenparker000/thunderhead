// @ts-check
// The GPU memory the editor holds, counted, and the budget it keeps under (the owner, 2026-11-16, after a photo opened
// over and over on a Galaxy A35: the copy made again and the zoomed-out view's full-size passes, both new that day, had
// asked more of the phone's graphics memory than it had, the device was lost, and the session opened the photo again
// into the same loss). Every buffer and texture made on the device is counted here as it is made and let go as it is
// destroyed, so `used` is what the editor holds and `peak` the most it has held. The budget is the phone's: from the
// memory it says it has (navigator.deviceMemory, in steps of 4 and 8 GB on these phones), lowered and kept lower if the
// GPU ever says it ran out (an out-of-memory error, heard without a scope: the editor's jobs run at once, and scopes are
// a stack the jobs would pop for each other). Heavy work that may wait or be left (the copy made again, Starfish, a
// zoomed view's full-size passes) asks `room` first; what the photo cannot do without (its copy, its frame) is not asked.

const KEY = 'th.editor.gpuBudget', MB = 1 << 20;
/** Bytes a texel, by format (those the engine makes; anything else counts 4). */
const BPP = /** @type {Record<string, number>} */ ({ r8unorm: 1, r8uint: 1, r16uint: 2, r16float: 2, r32float: 4, r32uint: 4, rg16float: 4, rgba8unorm: 4, bgra8unorm: 4, rg32float: 8, rgba16float: 8, rgba16uint: 8, rgba32float: 16, rgba32uint: 16 });

/** What is held now, the most held, the budget, and how many times the GPU ran out. */
export const memory = { used: 0, peak: 0, budget: 0, oom: 0 };

/** The budget in bytes: `?budget=` (MB, the checks' way to hold a phone's), else one learnt here, else by the phone's memory. */
function budgetOf() {
  const asked = Number(new URLSearchParams(globalThis.location?.search || '').get('budget'));
  if (asked > 0) return asked * MB;
  let learnt = 0; try { learnt = Number(localStorage.getItem(KEY)) || 0; } catch { /* a private window */ }
  const ram = /** @type {any} */ (globalThis.navigator)?.deviceMemory || 4;   // GB, rounded down to 4 or 8 on these phones
  const own = (ram >= 8 ? 720 : ram >= 4 ? 480 : 240) * MB;   // measured on the owner's 40 MP RAF: the photo itself about 190 MB, a zoomed view's full-size passes 130 more, Starfish's 210
  return learnt > 0 ? Math.min(learnt, own) : own;
}
memory.budget = budgetOf();

/** Whether `bytes` more fit under the budget now. @param {number} bytes */
export const room = (bytes) => memory.used + bytes <= memory.budget;

/** A texture's bytes from how it was asked for. @param {GPUTextureDescriptor} d */
function texBytes(d) {
  const s = /** @type {any} */ (d.size), w = s.width ?? s[0] ?? 1, h = s.height ?? s[1] ?? 1, z = s.depthOrArrayLayers ?? s[2] ?? 1;
  return w * h * z * (BPP[d.format] || 4) * (d.sampleCount || 1) * ((d.mipLevelCount || 1) > 1 ? 4 / 3 : 1);
}

/** Counts what `device` makes from now on, and hears it run out. A lost device's memory is gone with it. @param {GPUDevice} device */
export function count(device) {
  memory.used = 0;
  const buffer = device.createBuffer.bind(device), texture = device.createTexture.bind(device);
  /** @template {GPUBuffer | GPUTexture} T @param {T} o @param {number} bytes @returns {T} */
  const held = (o, bytes) => {
    memory.used += bytes; memory.peak = Math.max(memory.peak, memory.used);
    const destroy = o.destroy.bind(o); let gone = false;
    o.destroy = () => { if (!gone) { gone = true; memory.used -= bytes; } destroy(); };
    return o;
  };
  device.createBuffer = (d) => held(buffer(d), d.size);
  device.createTexture = (d) => held(texture(d), texBytes(d));
  device.addEventListener('uncapturederror', (e) => {
    if (!(/** @type {GPUUncapturedErrorEvent} */ (e).error instanceof GPUOutOfMemoryError)) return;
    memory.oom++;   // the budget comes down to below what was held when it ran out, and stays down on this phone
    memory.budget = Math.max(96 * MB, Math.min(memory.budget, Math.round(memory.used * 0.85)));
    try { localStorage.setItem(KEY, String(memory.budget)); } catch { /* a private window */ }
    dispatchEvent(new Event('th-gpu-oom'));
  });
  device.lost.then(() => { memory.used = 0; });
}

/** The numbers in MB, for the timings. */
export const inMB = () => ({ mb: Math.round(memory.used / MB), peakMb: Math.round(memory.peak / MB), budgetMb: Math.round(memory.budget / MB) });
