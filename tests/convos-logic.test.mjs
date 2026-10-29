// The menu's conversations and search without a browser (frontend/th/convos/model.js and
// prose.js): grouping by the calendar against the Worker's today (MENU-AND-SETTINGS.md M3),
// titles and their fallback, row metas and second lines, the past view's "when", which replies
// read as text, and search's folding, snippets, ranking and appending.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../frontend/th/convos/model.js';

const TODAY = '2026-10-29';
const t = (id, day, fields = {}) => ({ id, day, kind: 'daily', status: 'filed', title: null, title_source: 'auto', summary: null, continues: null, message_count: 1, started_at: 0, updated_at: Date.parse(`${day}T12:00:00Z`), filed_at: 0, ...fields });

test('M3: groups follow the calendar: Now, Yesterday, Earlier this week (since Monday), Last week, then older', () => {
  // 2026-10-29 is a Thursday; its week began Monday 26, the one before on Monday 19.
  const open = t('now', TODAY, { status: 'open' });
  const g = m.grouped([t('old', '2026-09-19'), t('y', '2026-10-28'), open, t('w', '2026-10-26'), t('sat', '2026-10-24'), t('lmon', '2026-10-19'), t('sun2', '2026-10-18')], TODAY, 'now');
  assert.deepEqual(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.map((x) => x.id)])), { today: [], yesterday: ['y'], week: ['w'], last: ['sat', 'lmon'], older: ['sun2', 'old'] });
  // The owner's report: a Saturday is never "this week" on a Thursday, however few days ago.
  assert.equal(m.groupOf('2026-10-24', TODAY), 'last');
  // An imported chat goes by its own day; one of today sits under Now, and today's open thread is
  // Now even before the list knows its id.
  const more = m.grouped([t('imp', '2026-10-27', { kind: 'imported' }), t('impToday', TODAY, { kind: 'imported' }), open], TODAY, null);
  assert.deepEqual([more.today, more.week].map((x) => x.map((y) => y.id)), [['impToday'], ['imp']]);
  // On a Monday, yesterday (Sunday) is Yesterday, and the rest of the week before is Last week.
  assert.deepEqual(['2026-10-25', '2026-10-24', '2026-10-19', '2026-10-18'].map((d) => m.groupOf(d, '2026-10-26')), ['yesterday', 'last', 'last', 'older']);
  // On a Sunday, Monday to Friday are earlier this week; across a month and a year the same holds.
  assert.deepEqual(['2026-11-02', '2026-11-06', '2026-10-31'].map((d) => m.groupOf(d, '2026-11-08')), ['week', 'week', 'last']);
  assert.deepEqual(['2025-12-29', '2025-12-28', '2025-12-22'].map((d) => m.groupOf(d, '2026-01-01')), ['week', 'last', 'last']);
  assert.equal(m.mondayOf('2026-11-01'), '2026-10-26');
  assert.deepEqual(m.GROUPS.map(([, name]) => name), ['Yesterday', 'Earlier this week', 'Last week']);
});

test('groups sort newest day first, then the latest message; months read "September", or with the year outside this one', () => {
  const a = t('a', '2026-10-26', { updated_at: 1 });
  const b = t('b', '2026-10-26', { updated_at: 2 });
  assert.deepEqual(m.grouped([a, b, t('c', '2026-10-27')], TODAY, null).week.map((x) => x.id), ['c', 'b', 'a']);
  const months = m.byMonth([t('x', '2025-12-03'), t('y', '2026-09-02'), t('z', '2026-09-19'), t('w', '2026-08-31')], TODAY);
  assert.deepEqual(months.map((x) => [x.key, x.label, x.items.map((i) => i.id)]), [['2026-09', 'September', ['z', 'y']], ['2026-08', 'August', ['w']], ['2025-12', 'December 2025', ['x']]]);
});

test('titles: the thread title on one line, else its date', () => {
  assert.equal(m.titleOf(t('a', '2026-10-26', { title: '  A calm\nplaylist  ' })), 'A calm playlist');
  assert.equal(m.titleOf(t('a', '2026-10-26', { title: '   ' })), 'Monday 26 October');
  assert.equal(m.titleOf(t('a', '2026-09-12')), 'Saturday 12 September');
});

test('metas: part of the day for Now, the time yesterday, the weekday and date otherwise; the second line', () => {
  const at = (h) => new Date(2026, 9, 29, h, 30).getTime();
  assert.deepEqual([5, 11, 12, 17, 18, 21, 22, 4].map((h) => m.partOfDay(at(h))), ['this morning', 'this morning', 'this afternoon', 'this afternoon', 'this evening', 'this evening', 'tonight', 'tonight']);
  assert.equal(m.metaOf(t('y', '2026-10-28', { updated_at: new Date(2026, 9, 28, 21, 40).getTime() }), 'yesterday'), '21:40');
  assert.deepEqual([['2026-10-26', 'week'], ['2026-10-24', 'last'], ['2026-09-12', 'older']].map(([d, g]) => m.metaOf(t('x', d), g)), ['Mon 26', 'Sat 24', 'Sat 12']);
  assert.deepEqual(['2026-10-28', '2026-10-26', '2026-09-12', '2025-12-03', TODAY].map((d) => m.whenOf(d, TODAY)), ['Yesterday', 'Monday 26 October', 'Saturday 12 September', 'Wednesday 3 December 2025', 'Today']);
  assert.equal(m.subOf(t('s', '2026-10-24', { summary: ' Scales first,\n then bars 9 to 12. ' })), 'Scales first, then bars 9 to 12.');
  assert.deepEqual([0, 1, 14].map((n) => m.subOf(t('c', '2026-10-24', { message_count: n }))), ['0 messages', '1 message', '14 messages']);
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

test('a reply reads as text when imported, long, or written in Markdown; short ones keep the voice', async () => {
  const { isProse, LONG } = await import('../frontend/th/convos/prose.js');
  assert.equal(isProse('It is in Music, under Evening.', false), false);
  assert.equal(isProse('It is in Music, under Evening.', true), true);
  assert.equal(isProse('x'.repeat(LONG), false), true);
  assert.deepEqual(['## Plan', '- one\n- two', '1. first', 'a **bold** word', 'run `npm test`', '| a | b |', '```\ncode\n```'].map((b) => isProse(b, false)), [true, true, true, true, true, true, true]);
  assert.equal(isProse('A dash - in the middle, and 3.5 bars', false), false);
});
