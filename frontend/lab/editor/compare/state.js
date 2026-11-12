// @ts-check
// What the compare page knows, shared by its modules: the photo's size, the methods (each a layer of tiles), which
// two are being compared and which of them shows, and the toggles. A module that changes it calls `changed`, and
// the page draws the chips, the status line and the layers again from it.

/** @typedef {NonNullable<ReturnType<typeof import('../app/session.js').whole>>} Big */
/** @typedef {Awaited<ReturnType<Big['view']>>} View */
/** One way of making the photo's pixels: the engine's (a view of the sensor) or a picture laid over the photo
 * (the camera's JPEG, a file added here).
 * @typedef {{ id: string, name: string, kind: string, view?: View, src?: ImageBitmap, off?: boolean }} Method */

export const S = {
  W: 0, H: 0,   // the photo's size, in photo pixels
  methods: /** @type {Method[]} */ ([]),
  a: '', b: '', shown: '',   // the last chip tapped, the one before it, and which of the two shows
  split: false, cut: 0.5, diff: false, blind: false,   // the toggles; where the split's divider stands (0..1 of the viewport)
  letters: /** @type {Record<string, string>} */ ({}), revealed: /** @type {Set<string>} */ (new Set()),   // blind: each method's letter, and those named after a pick
  renders: 0,   // how many tiles the engine has made
  busy: '',   // the method a tile is being made for now
};

export const bus = new EventTarget();
/** Tells the page something changed. */
export const changed = () => bus.dispatchEvent(new Event('change'));
/** A method by id. @param {string} id */
export const method = (id) => S.methods.find((m) => m.id === id);
/** The method that does not show of the two being compared. */
export const other = () => (S.shown === S.a ? S.b : S.a);
/** What a method is called on screen: blind, a letter until a pick names it. @param {Method} m */
export const label = (m) => (S.blind && !S.revealed.has(m.id) ? `${S.letters[m.id] || '?'}` : m.off ? `${m.name} (not on this GPU)` : m.name);
