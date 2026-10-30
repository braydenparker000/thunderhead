// Chat files from th (RUNTIME.md §5.3, API.md §11.7): `th say --attach` uploads each file through
// PUT /v1/files/:id (its type, URL-encoded name, SHA-256) within the contract's limits and names the
// refs on the message; `th file` reads the record and the bytes through GET /v1/files/:id with the
// role's own token (no signed link, no bucket host), saves `$TMPDIR/th/files/<id>.<ext>` and prints
// path, type, name and a memo's words; `th wait` and `th history` hand over each message's
// attachments as the Worker sent them. Against the fake Worker; synthetic files only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, truncateSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {CONTRACT} from '../cli/lib/contract.mjs';
import {TOKENS, env, errCode, startFake, th} from './helpers.mjs';

const withFake = fn => async () => {
  const fake = await startFake({holdUnitMs: 20});
  try { await fn(fake); } finally { await fake.stop(); }
};
const puts = fake => fake.state.requests.filter(r => r.method === 'PUT' && r.path.startsWith('/v1/files/'));
const ID = '0192f0c4-1111-7000-8000-000000000001';

test('the files limits come from the contract', () => {
  assert.deepEqual(CONTRACT.files.limits, {bytes: 26_214_400, owner_per_message: 4, mind_per_message: 10, name: 120, memo_seconds: 600});
});

test('say --attach uploads each file through PUT /v1/files/:id and names the refs on the message', withFake(async fake => {
  const e = env(fake);
  const note = join(e.TMPDIR, 'Ünïcode note.txt');
  const chart = join(e.TMPDIR, 'chart.PNG');
  writeFileSync(note, 'synthetic attachment');
  writeFileSync(chart, 'synthetic png bytes');
  const r = await th(['say', 'today', '--attach', note, '--attach', chart, 'See attached.'], e);
  assert.equal(r.code, 0, r.stderr);
  const [a, b] = puts(fake);
  assert.deepEqual([a.headers['content-type'], b.headers['content-type']], ['text/plain', 'image/png']);
  assert.equal(a.headers['th-file-name'], encodeURIComponent('Ünïcode note.txt'));
  assert.equal(a.headers['th-sha256'], createHash('sha256').update('synthetic attachment').digest('hex'));
  assert.equal(a.headers.authorization, `Bearer ${TOKENS.chat}`);
  assert.deepEqual(fake.state.messages.at(-1).attachments, [`file:${a.path.slice(10)}`, `file:${b.path.slice(10)}`]);
}));

test('a long name keeps its extension within 120 characters; too big, empty or too many is refused before the network', withFake(async fake => {
  const e = env(fake);
  const long = join(e.TMPDIR, `${'n'.repeat(130)}.pdf`);
  writeFileSync(long, 'synthetic pdf');
  assert.equal((await th(['say', 'today', '--attach', long, 'A long name.'], e)).code, 0);
  const sent = decodeURIComponent(puts(fake)[0].headers['th-file-name']);
  assert.equal(sent, `${'n'.repeat(116)}.pdf`);
  const before = fake.state.requests.length;
  const big = join(e.TMPDIR, 'big.bin');
  writeFileSync(big, '');
  truncateSync(big, CONTRACT.files.limits.bytes + 1);
  const empty = join(e.TMPDIR, 'empty.txt');
  writeFileSync(empty, '');
  for (const args of [['--attach', big], ['--attach', empty], ...[Array(11).fill(['--attach', long]).flat()]]) {
    const r = await th(['say', 'today', ...args, 'Refused.'], e);
    assert.equal(r.code, 8, r.stderr);
  }
  assert.equal(fake.state.requests.length, before, 'nothing reached the Worker');
}));

test('th file reads the record and the bytes with the token, saves <id>.<ext> and prints path, type and name', withFake(async fake => {
  const e = env(fake);
  const note = join(e.TMPDIR, 'note.txt');
  writeFileSync(note, 'synthetic attachment');
  await th(['say', 'today', '--attach', note, 'See attached.'], e);
  const ref = fake.state.messages.at(-1).attachments[0];
  const id = ref.slice(5);
  const d = await th(['file', id], e);
  assert.equal(d.code, 0, d.stderr);
  assert.deepEqual(d.json, {path: join(e.TMPDIR, 'th', 'files', `${id}.txt`), type: 'text/plain', name: 'note.txt'});
  assert.equal(readFileSync(d.json.path, 'utf8'), 'synthetic attachment');
  const gets = fake.state.requests.filter(r => r.method === 'GET' && r.path === `/v1/files/${id}`);
  assert.deepEqual(gets.map(g => g.query), [{meta: '1'}, {}]);
  for (const g of gets) {
    assert.equal(g.headers.authorization, `Bearer ${TOKENS.chat}`);
    assert.match(g.headers['th-client'], /^th\//);
  }
  const out = join(e.TMPDIR, 'elsewhere', 'copy.txt');
  const again = await th(['file', ref, '--out', out], {...e, TH_ROLE: 'night', TH_TOKEN: TOKENS.night});
  assert.equal(again.code, 0, again.stderr);
  assert.equal(readFileSync(again.json.path, 'utf8'), 'synthetic attachment');
}));

test('th file prints a voice memo’s words; an unknown id exits 8, a malformed one before the network', withFake(async fake => {
  const e = env(fake);
  fake.state.files.set(ID, {bytes: Buffer.from('synthetic webm'), sha: 'x', type: 'audio/webm', name: 'Memo.webm', seconds: 42,
    text: 'Pick up the synthetic parcel at noon.'});
  const d = await th(['file', `file:${ID}`], e);
  assert.equal(d.code, 0, d.stderr);
  assert.deepEqual(d.json, {path: join(e.TMPDIR, 'th', 'files', `${ID}.webm`), type: 'audio/webm', name: 'Memo.webm',
    text: 'Pick up the synthetic parcel at noon.'});
  const missing = await th(['file', '0192f0c4-1111-7000-8000-000000000002'], e);
  assert.deepEqual([missing.code, errCode(missing)], [8, 'not_found']);
  const before = fake.state.requests.length;
  assert.equal((await th(['file', 'not-an-id'], e)).code, 8);
  assert.equal(fake.state.requests.length, before);
}));

test('wait and history hand over each message’s attachments as the Worker sent them', withFake(async fake => {
  const e = env(fake);
  const attachments = [{ref: `file:${ID}`, name: 'Memo.webm', type: 'audio/webm', bytes: 14, seconds: 42, text: 'Pick up the synthetic parcel at noon.'}];
  await th(['brief', '--claim'], e);
  setTimeout(() => fake.addOwnerMessage('', {kind: 'voice', attachments}), 100);
  const w = await th(['wait', '--minutes', '0.2'], e);
  assert.equal(w.code, 0, w.stderr);
  assert.deepEqual(w.json.messages[0].attachments, attachments);
  const h = await th(['history', 'today'], e);
  assert.deepEqual(h.json.items.at(-1).attachments, attachments);
}));
