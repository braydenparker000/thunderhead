// th report against the fake Worker (night step 12, BRIEFING.md "The report card"): the headline,
// the morning note on stdin (2026-11-22: 1 to 1,200 characters, paragraphs kept, never refused for
// style; an unknown kind becomes note, a long line is cut at a word with an ellipsis) and the lines, each line's kind and ref (`<kind>[@ledger:<id>|@app:<id>]:<text>`),
// PUT to the run's day; the same report again answers the stored one; refusals (exit 8) before the
// network, as the Worker's own check.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reportBody} from '../cli/lib/night-report.mjs';
import {env, startFake, th} from './helpers.mjs';

const ID = '0190aaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee';

test('reportBody: kinds and refs from each line; the Worker\'s limits checked here; no refusal for style', () => {
  assert.deepEqual(reportBody({headline: 'A quiet night', line: [`memory@ledger:${ID}:Kept that you like calm music`, 'music@app:music:Music is ready', 'note:Nothing else']}), {
    headline: 'A quiet night',
    lines: [
      {kind: 'memory', text: 'Kept that you like calm music', ref: `ledger:${ID}`},
      {kind: 'music', text: 'Music is ready', ref: 'app:music'},
      {kind: 'note', text: 'Nothing else', ref: null},
    ],
  });
  for (const flags of [
    {line: ['note:No headline']},
    {headline: 'x'.repeat(61)},
    {headline: 'Fine', line: Array.from({length: 7}, () => 'note:One more')},
    {headline: 'Fine', line: ['note@song:abc:Plain words']},
    {headline: 'Fine', line: ['note:**Bold** words']},
  ])
    assert.throws(() => reportBody(flags), /./, JSON.stringify(flags));
  assert.equal(reportBody({headline: 'A great night! 🌙'}).headline, 'A great night! 🌙', 'an emoji and an exclamation mark pass');
});

test('reportBody: the note kept with its paragraphs; an unknown kind is a note; a long line is cut, not refused', () => {
  const long = `Read the new chapter and placed a study tile for it ${'with more words '.repeat(6)}`;
  const body = reportBody({headline: 'A quiet night', line: ['gossip:Plain words', 'no kind at all', `memory:${long}`, 'predictions:Odds']},
    '  It was calm here!  Nothing pressing 🙂\n\n\n\nYour playlist is ready.\n');
  assert.equal(body.note, 'It was calm here! Nothing pressing 🙂\n\nYour playlist is ready.');
  assert.deepEqual(body.lines.map(l => l.kind), ['note', 'note', 'memory', 'note']);
  assert.equal(body.lines[1].text, 'no kind at all');
  assert.ok(body.lines[2].text.length <= 100 && body.lines[2].text.endsWith('…') && !/\s…$/.test(body.lines[2].text), body.lines[2].text);
  assert.throws(() => reportBody({headline: 'Fine'}, 'x'.repeat(1201)), /1200/);
  assert.throws(() => reportBody({headline: 'Fine'}, ' \n '), /empty/);
  assert.equal('note' in reportBody({headline: 'Fine'}), false, 'no note given: none sent');
});

test('th report --note - reads the morning note on stdin and sends it with the report', async () => {
  const fake = await startFake();
  try {
    const e = env(fake, {TH_ROLE: 'night'});
    const r = await th(['report', '--day', '2026-11-04', '--headline', 'A calm night', '--note', '-'], e, 'Placed a tile for the chapter.\n\nThe new mix is waiting 🙂');
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.note, true);
    const sent = fake.state.requests.find(q => q.method === 'PUT' && q.path === '/v1/briefing/report/2026-11-04');
    assert.deepEqual(sent.body, {headline: 'A calm night', note: 'Placed a tile for the chapter.\n\nThe new mix is waiting 🙂', lines: []});
    assert.equal((await th(['report', '--day', '2026-11-04', '--headline', 'A calm night', '-'], e, 'Inline dash works too.')).code, 0);
    assert.equal((await th(['report', '--day', '2026-11-04', '--headline', 'A calm night', '--note', 'As a flag.'], e)).code, 0);
    const help = (await th(['help', 'all'], e)).stdout;
    assert.match(help, /report --headline .*--note -/);
    assert.doesNotMatch(help.split('\nRoutes')[0], /\bpredict\b/);
  } finally {
    await fake.stop();
  }
});

test('th report puts the report for the run\'s day; the same again answers the stored one', async () => {
  const fake = await startFake();
  try {
    const e = env(fake, {TH_ROLE: 'night'});
    const args = ['report', '--day', '2026-11-03', '--headline', 'A quiet night', '--line', `memory@ledger:${ID}:Kept one thing`];
    const r = await th(args, e);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json, {day: '2026-11-03', ledger_id: 'led-2026-11-03-1', message_id: 'msg-2026-11-03', note: false, lines: 1,
      counts: {facts_added: 0, facts_confirmed: 0, loose_ends_closed: 0, loose_ends_added: 0, pages_read: null, songs_noted: null, mixes: null, steps_cut: []}});
    const sent = fake.state.requests.find(q => q.method === 'PUT' && q.path === '/v1/briefing/report/2026-11-03');
    assert.deepEqual(sent.body, {headline: 'A quiet night', lines: [{kind: 'memory', text: 'Kept one thing', ref: `ledger:${ID}`}]});
    assert.equal((await th(args, e)).json.ledger_id, 'led-2026-11-03-1');
    assert.equal((await th(['report', '--day', '2026-11-03', '--headline', '**Fine**'], e)).code, 8);
    assert.equal(fake.state.requests.filter(q => q.method === 'PUT').length, 2);
    assert.equal((await th(['report', '--day', '2026-11-03', '--headline', 'Fine'], env(fake))).code, 6);
    assert.match((await th(['help', 'all'], e)).stdout, /report --headline/);
  } finally {
    await fake.stop();
  }
});
