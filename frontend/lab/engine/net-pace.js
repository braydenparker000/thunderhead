// @ts-check
// The network made for the screen a little at a time. An export gives the GPU a whole window in one submission and
// waits; on the slower phone that is two seconds, and its two heavy passes are each one dispatch of 0.6 s that
// nothing can interrupt. While it ran, a pan or a pinch could not be shown: the GPU that draws the page was busy.
// For what shows on the screen, a pass is given to the GPU a few of its output blocks at a time (a way's
// workgroups along z are its output blocks, and a sliced way starts at the block its window's settings name),
// each submission about a frame long and waited for, so the page is drawn in between and the rest can be left
// undone the moment a finger comes down. The sums are the same sums in the same order: the picture is the same
// to the last bit as the window made in one go.

/** A way's code, able to start at any of its output blocks: its window's settings gain `z0`, added to the
 * workgroup's place along z (`wg.z`, or `g.z` where a way goes by the invocation's own place: its workgroups are
 * one deep). (A pass as exported has no such place in its code and is run whole.) @param {string} code */
export const sliced = (code) => code.replace('struct Valid { h: u32, w: u32 }', 'struct Valid { h: u32, w: u32, z0: u32 }').replace(/\b(wg|g)\.z\b/g, '($1.z + valid.z0)');
/** Whether a pass's code can be run a part at a time. @param {string} code */
export const canSlice = (code) => code.includes('valid.z0');

/** About how long a submission should take, ms: under a frame at 60 a second, so one is never missed for it. */
export const SLICE_MS = 12;
/** @typedef {[GPUComputePipeline, GPUBindGroup, number, number, number, boolean?]} Paced a pass, its bindings, its workgroups, and whether it can be run a part at a time */
/** Runs the passes in order, a part at a time, each part waited for. `stop` is asked after each: when it says
 * yes, the rest is left undone and false is given (what was written so far is of no use). How many blocks go in a
 * submission is found as it goes: more while they take under half the aim, fewer when over one and a half times.
 * @param {GPUDevice} device @param {Paced[]} passes @param {GPUBuffer} valid the window's settings (z0 is its third word)
 * @param {{ stop?: () => boolean, note?: (ms: number) => void }} [o] `note`: told how long each submission took
 * @returns {Promise<boolean>} whether all of it was made */
export async function paced(device, passes, valid, o = {}) {
  const z0 = (/** @type {number} */ z) => device.queue.writeBuffer(valid, 8, new Uint32Array([z]));
  try {
    for (const [pipe, bind, a, b, c, can] of passes) {
      let take = can ? 1 : c;
      for (let z = 0; z < c;) {
        const n = Math.min(take, c - z), enc = device.createCommandEncoder(), pass = enc.beginComputePass();
        if (can) z0(z);
        pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(a, b, n); pass.end();
        const t = performance.now();
        device.queue.submit([enc.finish()]); await device.queue.onSubmittedWorkDone();
        const ms = performance.now() - t;
        o.note?.(ms);
        z += n;
        if (can) take = ms < SLICE_MS / 2 ? Math.min(c, take * 2) : ms > SLICE_MS * 1.5 ? Math.max(1, take >> 1) : take;
        if (o.stop?.()) return false;
      }
    }
    return true;
  } finally { z0(0); }   // the window's settings are as a whole run needs them again
}
