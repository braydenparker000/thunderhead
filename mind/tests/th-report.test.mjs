// th report against the fake Worker (night step 12, BRIEFING.md "The report card"): the headline
// and the lines from the flags, each line's kind and ref (`<kind>[@ledger:<id>|@app:<id>]:<text>`),
// PUT to the run's day; the same report again answers the stored one; refusals (exit 8) before the
// network, as the Worker's own check.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reportBody} from '../cli/lib/night-report.mjs';
import {env, startFake, th} from './helpers.mjs';

const ID = '0190aaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee';

test('reportBody: kinds and refs from each line; the Worker\'s limits and lint, checked here', () => {
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
    {headline: 'A great night!'},
    {headline: 'x'.repeat(61)},
    {headline: 'Fine', line: Array.from({length: 7}, () => 'note:One more')},
    {headline: 'Fine', line: ['gossip:Plain words']},
    {headline: 'Fine', line: ['note@song:abc:Plain words']},
    {headline: 'Fine', line: ['note:**Bold** words']},
    {headline: 'Fine', line: ['no kind at all']},
  ])
    assert.throws(() => reportBody(flags), /./, JSON.stringify(flags));
});

test('th report puts the report for the run\'s day; the same again answers the stored one', async () => {
  const fake = await startFake();
  try {
    const e = env(fake, {TH_ROLE: 'night'});
    const args = ['report', '--day', '2026-11-03', '--headline', 'A quiet night', '--line', `memory@ledger:${ID}:Kept one thing`];
    const r = await th(args, e);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json, {day: '2026-11-03', ledger_id: 'led-2026-11-03-1', message_id: 'msg-2026-11-03', lines: 1,
      counts: {facts_added: 0, facts_confirmed: 0, loose_ends_closed: 0, loose_ends_added: 0, pages_read: null, songs_noted: null, mixes: null, predictions: 0, steps_cut: []}});
    const sent = fake.state.requests.find(q => q.method === 'PUT' && q.path === '/v1/briefing/report/2026-11-03');
    assert.deepEqual(sent.body, {headline: 'A quiet night', lines: [{kind: 'memory', text: 'Kept one thing', ref: `ledger:${ID}`}]});
    assert.equal((await th(args, e)).json.ledger_id, 'led-2026-11-03-1');
    assert.equal((await th(['report', '--day', '2026-11-03', '--headline', 'Fine!'], e)).code, 8);
    assert.equal(fake.state.requests.filter(q => q.method === 'PUT').length, 2);
    assert.equal((await th(['report', '--day', '2026-11-03', '--headline', 'Fine'], env(fake))).code, 6);
    assert.match((await th(['help'], e)).stdout, /report --headline/);
  } finally {
    await fake.stop();
  }
});
