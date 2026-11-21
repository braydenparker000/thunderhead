// frontend/assets/shown.js, which error-report.js uses to send a ported app's `<app>.open` sense: a
// top-level page is shown at once; a frame home preloaded in its layer (inert, th/island/frames.js)
// only once home brings it to the front (inert taken off, th/island/island.js `expand`), and once;
// another site's frame (no frameElement to read) as before. Fakes only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whenShown } from '../frontend/assets/shown.js';

/** A frame element whose `inert` attribute home sets, and the observers watching it. */
function frameElement(inert) {
  const attrs = new Set(inert ? ['inert'] : []), watchers = new Set();
  return {
    hasAttribute: (n) => attrs.has(n),
    set inert(on) { on ? attrs.add('inert') : attrs.delete('inert'); for (const w of watchers) w.cb([{ attributeName: 'inert' }]); },
    watchers,
  };
}
function framed(el) {
  const win = { frameElement: el, top: {}, self: null };
  win.self = win;
  win.MutationObserver = class {
    constructor(cb) { this.cb = cb; }
    observe(node, o) { assert.deepEqual(o.attributeFilter, ['inert']); node.watchers.add(this); this.node = node; }
    disconnect() { this.node.watchers.delete(this); }
  };
  return win;
}

test('a top-level page is shown at once', () => {
  const win = {};
  win.top = win.self = win;
  let n = 0;
  whenShown(win, () => n++);
  assert.equal(n, 1);
});

test('a frame home preloaded is not shown until home brings it to the front, then once', () => {
  const el = frameElement(true), win = framed(el);
  let n = 0;
  whenShown(win, () => n++);
  assert.equal(n, 0, 'preloaded, hidden: no open');
  el.inert = true;
  assert.equal(n, 0);
  el.inert = false; // home's expand()
  assert.equal(n, 1);
  el.inert = true; // collapse, then in front again: still one open for this page
  el.inert = false;
  assert.equal(n, 1);
});

test('a frame already in front is shown at once; another site’s frame as before', () => {
  let n = 0;
  whenShown(framed(frameElement(false)), () => n++);
  assert.equal(n, 1);
  const other = { top: {}, get frameElement() { throw new Error('cross-origin'); } };
  other.self = other;
  whenShown(other, () => n++);
  assert.equal(n, 2);
});
