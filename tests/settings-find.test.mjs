// Settings' one index (frontend/apps/settings/finder.js), without a browser: what Settings' search and
// the menu's "Search everything" find for the words people type (owner, 2026-11-21), each result on
// its page with the row it opens at; every catalogue setting and listed page is in it; the grouped
// list (pages.js) has its headings in order, Agents a plain row under Account and data, and leaves
// Quiet hours out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entries, find } from '../frontend/apps/settings/finder.js';
import { PAGES, SECTIONS } from '../frontend/apps/settings/pages.js';
import { SETTINGS } from '../shared/contract/settings.ts';

const first = (q) => { const [e] = find(q); return e && [e.title, e.page, e.focus]; };

test('the words people type find what they look for, first', () => {
  assert.deepEqual(first('text size'), ['Text size', 'settings', 'text']);
  assert.deepEqual(first('font'), ['Text size', 'settings', 'text']);
  assert.deepEqual(first('theme'), ['Theme', 'settings', 'theme']);
  assert.deepEqual(first('dark'), ['Theme', 'settings', 'theme']);
  assert.deepEqual(first('night'), ['Theme', 'settings', 'theme']);
  assert.deepEqual(first('light'), ['Theme', 'settings', 'theme']);
  assert.deepEqual(first('sign out'), ['Sign out', 'devices', 'sign-out']);
  assert.deepEqual(first('logout'), ['Sign out', 'devices', 'sign-out']);
  assert.deepEqual(first('log out'), ['Sign out', 'devices', 'sign-out']);
  assert.deepEqual(first('recovery'), ['New recovery code', 'devices', 'recovery']);
  assert.deepEqual(first('password'), ['Password', 'account', undefined]);
  assert.deepEqual(find('backup').slice(0, 2).map((e) => e.title).sort(), ['Export', 'New recovery code']);
  assert.deepEqual(first('notifications'), ['Notifications', 'notifications', undefined]);
  assert.ok(find('notifications').some((e) => e.focus === 'mind.pushes'));
  assert.ok(find('sound').some((e) => e.focus === 'appearance.haptics'));
  assert.deepEqual(first('quiet hours'), ['Quiet hours', 'notifications', 'quiet']);
  assert.deepEqual(first('bring data'), ['Bring data from the old site', 'privacy', 'import']);
  assert.deepEqual(first('look'), ['Look', 'appearance', 'appearance.look']);
  assert.deepEqual(first('repair'), ['Repair', 'about', 'repair']);
  assert.deepEqual(first('broken'), ['Repair', 'about', 'repair']);
  assert.deepEqual(first('copy report'), ['Copy report', 'about', 'report']);
  assert.deepEqual(first('diagnostics'), ['Copy report', 'about', 'report']);
  // Word starts only: "size" starts a word of Text size, "ize" starts none.
  assert.deepEqual(find('ize'), []);
});

test('every catalogue setting and every listed page is in the index, on its page', () => {
  const all = entries();
  for (const s of SETTINGS) assert.ok(all.some((e) => e.focus === s.key && e.page === s.group), s.key);
  for (const [page] of PAGES) assert.ok(all.some((e) => e.page === page && !e.focus), page);
});

test('Settings lists its pages under six headings, Agents a plain row, without Quiet hours', () => {
  assert.deepEqual(SECTIONS.map(([h]) => h), ['Look', 'Home and gestures', 'Apps', 'The mind', 'Account and data', 'About']);
  assert.deepEqual(PAGES.map(([p]) => p), ['appearance', 'chat', 'gestures', 'music', 'photos', 'island', 'briefing', 'mind', 'memory', 'notifications', 'account', 'devices', 'agents', 'privacy', 'data', 'phone', 'export', 'deleted', 'workshop', 'about', 'builder']);
  assert.deepEqual(PAGES.find(([p]) => p === 'agents'), ['agents', 'Agents', 'plugs-connected']);
  assert.deepEqual(first('agents'), ['Agents', 'agents', undefined]);
  assert.deepEqual(first('tokens'), ['Agents', 'agents', undefined]);
});
