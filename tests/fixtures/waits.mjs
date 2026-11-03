// Waits for the browser suites (TESTING.md, "Browser tests: waits and timing"): a test waits for the
// condition it needs (an element, an attribute, a stored key, a call the mock saw, the springs at
// rest), never for a guessed number of milliseconds, and a timing read is a diagnostic on CI.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

/** Timing reads (milliseconds, frames, audio levels) measure the machine as much as the product: they
 * are enforced with TH_STRICT_TIMING=1 and otherwise reported, so a loaded runner cannot fail them. */
export const strictTiming = Boolean(process.env.TH_STRICT_TIMING);
/** @param {unknown} ok @param {string} message */
export function timing(ok, message) {
  if (strictTiming) assert.ok(ok, message);
  else if (!ok) console.log(`# timing (not enforced on CI): ${message}`);
}

/** Resolves once `ok()` is truthy, reading every 25 ms; fails with `message` after `timeout` ms.
 * @template T @param {() => T | Promise<T>} ok @param {{ timeout?: number, message?: string }} [o] */
export async function until(ok, { timeout = 15_000, message = 'the condition never held' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const got = await ok();
    if (got) return got;
    if (Date.now() > end) throw new assert.AssertionError({ message: `${message} (waited ${timeout} ms)` });
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Reads until the value is `want` (15 s at most), then asserts it, so a slow page fails with the
 * value it had. @param {() => unknown} read @param {unknown} want @param {string} [message] */
export async function eventually(read, want, message) {
  const end = Date.now() + 15_000;
  let got = await read();
  while (!isDeepStrictEqual(got, want) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 25));
    got = await read();
  }
  assert.deepEqual(got, want, message);
}

/** Every spring on the page at rest (th/motion.js). @param {import('playwright').Page} page */
export const resting = (page) => page.evaluate(async () => (await import('/th/motion.js')).whenResting());

/** The tap guard (th/ui.js: taps within 500 ms of the page appearing are ignored) has let go, on the
 * page's own clock; a page whose clock a test holds moves it in 100 ms steps until it has.
 * @param {import('playwright').Page} page @param {{ held?: boolean }} [o] */
export async function guardOpen(page, { held = false } = {}) {
  const soon = () => page.evaluate(async () => (await import('/th/ui.js')).tooSoon());
  if (held) {
    for (let i = 0; i < 20 && (await soon()); i++) await page.clock.runFor(100);
    assert.equal(await soon(), false, 'the tap guard let go');
    return;
  }
  await until(async () => !(await soon()), { message: 'the tap guard never let go' });
}

/** Outlasts a product timer shorter than `ms` that is already set (a hold, an idle close), on the
 * page's own timer queue: a timer set earlier with an earlier deadline always runs first there, however
 * loaded the runner, which a wait in the test process cannot promise. For "nothing happens" reads only.
 * @param {import('playwright').Page | import('playwright').Frame} page @param {number} ms */
export const outlast = (page, ms) => page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms);

/** The shell's first-paint work has run: the shell queues it as an animation frame and then a task
 * (boot.js, home.js), so a frame and a task queued after load run after it.
 * @param {import('playwright').Page} page */
export const afterFirstPaint = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r))));
