// Music's transitions in motion (frontend/music/src/view/motion.js, MUSIC.md §5.11) as plain logic in Node:
// a change marked while a transition moves is never lost, and work put off until no transition moves is
// the newest asked for when a second transition starts first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginMove, endMove, syncMoving, whenStill } from '../frontend/music/src/view/motion.js';

const VISIBLE = 0;
/** A view that counts its own writes; `shows` is what syncSelf reports (shown again after display:none). */
const view = (parent = null, children = undefined) => {
  const v = { parent, children, visibility: VISIBLE, writes: 0, shows: false };
  v.syncSelf = () => { v.writes++; return v.shows; };
  v.sync = () => { v.syncSelf(); for (const c of v.children ?? []) c.sync(); };
  return v;
};

test('a view changed while out of the tree is written once it is back, while the transition still moves', () => {
  const root = view(null, []);
  const ctx = { root, dirty: new Set(), moving: new Set() };
  const group = view(null, []), icon = view(group);
  group.children.push(icon);
  beginMove(ctx, 'scene');
  // The icon changes (its alpha, say) while its group is out of the tree for a moment (a pooled row, a
  // layout taken out and put back).
  ctx.dirty.add(icon);
  syncMoving(ctx);
  assert.equal(icon.writes, 0, 'not reached: not written');
  // The group is back (addView marks it); it was never display:none, so it writes only itself.
  group.parent = root;
  root.children.push(group);
  ctx.dirty.add(group);
  syncMoving(ctx);
  assert.equal(icon.writes, 1, 'the icon takes the write it missed, in the next frame of the same transition');
  syncMoving(ctx);
  assert.equal(icon.writes, 1, 'written once: no longer marked');
});

test('a view changed under a gone view stays marked until it is reached', () => {
  const root = view(null, []);
  const ctx = { root, dirty: new Set(), moving: new Set(['scene']) };
  const screen = view(root, []), bar = view(screen);
  screen.children.push(bar);
  root.children.push(screen);
  screen.visibility = 8; // GONE
  ctx.dirty.add(bar);
  syncMoving(ctx);
  syncMoving(ctx);
  assert.equal(bar.writes, 0);
  assert.ok(ctx.dirty.has(bar), 'still marked');
  screen.visibility = VISIBLE;
  syncMoving(ctx);
  assert.equal(bar.writes, 1);
  assert.equal(ctx.dirty.size, 0);
});

test('work asked for again during a second transition runs as last asked, once', async () => {
  const ctx = { moving: new Set() };
  const ran = [];
  beginMove(ctx, 'first');
  whenStill(ctx, () => ran.push('older'), 'art');
  endMove(ctx, 'first');
  // A second transition starts before the waiting work ran, and the same work is asked for again.
  beginMove(ctx, 'second');
  whenStill(ctx, () => ran.push('newer'), 'art');
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(ran, [], 'waits for the second transition');
  endMove(ctx, 'second');
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(ran, ['newer'], 'the newer request, not the older one in its place');
});
