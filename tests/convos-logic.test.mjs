// The menu's conversations and search without a browser (frontend/th/convos/model.js): grouping
// by day against the Worker's today (MENU-AND-SETTINGS.md M3), titles and their fallback, row
// metas, the past view's "when", and search's folding, snippets, ranking and appending.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../frontend/th/convos/model.js';

const TODAY = '2026-10-29';
const t = (id, day, fields = {}) => ({ id, day, kind: 'daily', status: 'filed', title: null, title_source: 'auto', summary: null, continues: null, message_count: 1, started_at: 0, updated_at: Date.parse(`${day}T12:00:00Z`), filed_at: 0, ...fields });

test('M3: today, yesterday, 3 days ago and 40 days ago land in Now, Yesterday, This week and All conversations', () => {
  const open = t('now', TODAY, { status: 'open' });
  const g = m.grouped([t('old', '2026-09-19'), t('y', '2026-10-28'), open, t('w', '2026-10-26')], TODAY, 'now');
  assert.deepEqual(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.map((x) => x.id)])), { today: [], yesterday: ['y'], week: ['w'], older: ['old'] });
  // Six days ago is still this week; seven is older. An imported chat goes by its own day; one of
  // today sits under Now, and today's open thread is Now even before the list knows its id.
  const more = m.grouped([t('six', '2026-10-23'), t('seven', '2026-10-22'), t('imp', '2026-10-27', { kind: 'imported' }), t('impToday', TODAY, { kind: 'imported' }), open], TODAY, null);
  assert.deepEqual([more.today, more.week, more.older].map((x) => x.map((y) => y.id)), [['impToday'], ['imp', 'six'], ['seven']]);
});

test('groups sort newest day first, then the latest message; months read "September 2026"', () => {
  const a = t('a', '2026-10-26', { updated_at: 1 });
  const b = t('b', '2026-10-26', { updated_at: 2 });
  assert.deepEqual(m.grouped([a, b, t('c', '2026-10-27')], TODAY, null).week.map((x) => x.id), ['c', 'b', 'a']);
  const months = m.byMonth([t('x', '2025-12-03'), t('y', '2026-09-02'), t('z', '2026-09-19'), t('w', '2026-08-31')]);
  assert.deepEqual(months.map((x) => [x.label, x.items.map((i) => i.id)]), [['September 2026', ['z', 'y']], ['August 2026', ['w']], ['December 2025', ['x']]]);
});

test('titles: the thread title on one line, else its date', () => {
  assert.equal(m.titleOf(t('a', '2026-10-26', { title: '  A calm\nplaylist  ' })), 'A calm playlist');
  assert.equal(m.titleOf(t('a', '2026-10-26', { title: '   ' })), 'Monday 26 October');
  assert.equal(m.titleOf(t('a', '2026-09-12')), 'Saturday 12 September');
});

test('metas: part of the day for Now, the time for Yesterday, the weekday this week, the date older', () => {
  const at = (h) => new Date(2026, 9, 29, h, 30).getTime();
  assert.deepEqual([5, 11, 12, 17, 18, 21, 22, 4].map((h) => m.partOfDay(at(h))), ['this morning', 'this morning', 'this afternoon', 'this afternoon', 'this evening', 'this evening', 'tonight', 'tonight']);
  assert.equal(m.metaOf(t('y', '2026-10-28', { updated_at: new Date(2026, 9, 28, 21, 40).getTime() }), 'yesterday'), '21:40');
  assert.equal(m.metaOf(t('w', '2026-10-26'), 'week'), 'Mon');
  assert.equal(m.metaOf(t('o', '2026-09-12'), 'older'), '12 Sep');
  assert.deepEqual(['2026-10-28', '2026-10-26', '2026-09-12', '2025-12-03'].map((d) => m.whenOf(d, TODAY)), ['Yesterday', 'Monday', '12 Sep', '3 Dec 2025']);
});

test('search folds accents and case, so "cancion" and "canción" find the same', () => {
  assert.deepEqual(m.find('Can you find the canción?', 'cancion'), [17, 24]);
  assert.deepEqual(m.find('Can you find the canción?', 'CANCIÓN'), [17, 24]);
  assert.deepEqual(m.find('Straße', 'STRASSE'), null, 'only accents and case fold');
  // A decomposed accent keeps the original positions.
  const nfd = 'café au lait';
  assert.deepEqual(m.find(nfd, 'café'), [0, 5]);
  assert.equal(m.find('nothing here', 'x y'), null);
});

test('snippets: ±40 characters around the match, cut with "…", the match bold', () => {
  const long = `${'a'.repeat(60)} the «calm» one ${'b'.repeat(60)}`;
  const parts = m.snippetParts(long);
  assert.deepEqual(parts.map((p) => p.bold), [false, true, false]);
  assert.equal(parts[1].text, 'calm');
  assert.ok(parts[0].text.startsWith('…') && parts[0].text.length === 41);
  assert.ok(parts[2].text.endsWith('…') && parts[2].text.length === 41);
  assert.deepEqual(m.snippetParts('no marks here'), [{ text: 'no marks here', bold: false }]);
  assert.deepEqual(m.around('short calm', 6, 10), [{ text: 'short ', bold: false }, { text: 'calm', bold: true }]);
});

test('ranking puts exact, then prefix, then word prefix, then inside; rows only append', () => {
  assert.deepEqual(['Devices', 'Device list', 'My devices', 'Undevised', 'Music'].map((n) => m.rank(n, 'devices')), [0, -1, 2, -1, -1]);
  assert.deepEqual(['Music', 'My Media', 'Quiet hours'].map((n) => m.rank(n, 'mu')), [1, -1, -1]);
  assert.equal(m.rank('Connected apps', 'apps'), 2);
  assert.equal(m.rank('Undevised', 'devi'), 3);
  const rows = m.append([{ ref: 'a' }, { ref: 'b' }], [{ ref: 'c' }, { ref: 'a' }, { ref: 'c' }]);
  assert.deepEqual(rows.map((r) => r.ref), ['a', 'b', 'c']);
  assert.equal(m.refId('msg:0192-x'), '0192-x');
});
