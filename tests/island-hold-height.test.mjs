// The height an app's frame takes as it comes to the front (frontend/th/island/hold-height.js, MUSIC.md
// §5.10): with the keyboard up, the height settled last in this orientation (keyed by the window's width),
// never one held in the other orientation; with none, the window's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontHeight } from '../frontend/th/island/hold-height.js';

test('with the keyboard up the frame takes this orientation\'s settled height only', () => {
  const settled = new Map([[390, 731]]);
  assert.equal(frontHeight(settled, 390, 759, false), 759, 'no keyboard: the window now');
  assert.equal(frontHeight(settled, 390, 424, true), 731, 'keyboard up: the settled portrait height');
  // Turned to landscape (width 844) with the keyboard up: never the portrait 731.
  assert.equal(frontHeight(settled, 844, 300, true), 300, 'no settled landscape height: the window');
  settled.set(844, 360);
  assert.equal(frontHeight(settled, 844, 180, true), 360);
});
