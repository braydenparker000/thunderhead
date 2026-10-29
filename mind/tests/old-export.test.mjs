// The old-Worker export driver (mind/jobs/old-export.mjs, MIGRATION.md §3–4) against two in-memory
// fakes: the old Worker's export routes (as in Missionarytube- backend/export.js: parts of N rows by
// rowid, X-Rows, X-Next-Cursor '' at the end, X-Sha256, X-Rows-Written, 403 for never-exported
// tables) and the new Worker's import routes. It waits out the deploy, posts every part unchanged,
// counts never-exported and virtual tables only, writes the manifest last, starts the imports in
// order, prints counts only, and stops at once if the old Worker ever reports a row written. Last,
// the whole pull and import against the real Worker under `wrangler dev`, its alarm running the jobs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {ROOT, freshTmp, runNode} from './helpers.mjs';
import {PASSWORD, available, setupOwner, startWorker} from './worker-dev.mjs';

const DRIVER = join(ROOT, 'mind/jobs/old-export.mjs');
const OLD_KEY = 'old_fake_agent_key';
const NEW_KEY = 'thm_fake_import_key';
const sha = b => createHash('sha256').update(b).digest('hex');
const LONG_AGO = '2000-01-01T00:00:00Z';

// Synthetic old tables: 3 threads, 4 messages (two full parts of 2, then an empty end), the
// notebook row, a credential table and an FTS table.
const AT = Date.parse('2026-09-01T12:00:00Z');
const TABLES = {
  cc_threads: {rows: [1, 2, 3].map(i => ({id: `t${i}`, title: `Lantern chat ${i}`, created_ms: AT + i, updated_ms: AT + 10 + i,
    archived: 0, session_url: null}))},
  cc_messages: {rows: [1, 2, 3, 4].map(i => ({seq: i, id: `m${i}`, thread_id: 't1', role: i % 2 ? 'owner' : 'claude', kind: 'text',
    body: `lantern body ${i}`, meta: null, reply_to: null, created_ms: AT + 100 * i, delivered_ms: null, answered_ms: null,
    attachments: null}))},
  cc_state: {rows: [{key: 'notebook', value: '{"body":"lantern notebook"}'}]},
  relay_owner_credentials: {rows: [{id: 1, hash: 'x'}, {id: 2, hash: 'y'}], never: true},
  cc_messages_fts: {rows: [{body: 'lantern'}], virtual: true},
};

function listen(handler) {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => handler(req, res, Buffer.concat(chunks)));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, stop: () => new Promise(r => server.close(r)),
  })));
}
const json = (res, status, body) => { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(body)); };

async function fakes({partRows = 2, wroteOnStep = 0, failDataset = null} = {}) {
  const log = [];
  let steps = 0;
  const old = await listen((req, res, body) => {
    log.push({at: Date.now(), side: 'old', path: req.url});
    if (req.headers.authorization !== `Bearer ${OLD_KEY}`) return json(res, 401, {error: 'Agent key required'});
    const b = JSON.parse(body.toString() || '{}');
    const here = b.instance === 'claude-chat-v1' ? TABLES : {};
    if (req.url === '/ops/export/tables') {
      return json(res, 200, {instance: b.instance, rows_written: 0, tables: Object.entries(here).map(([table, t]) => ({
        table, rows: t.rows.length, columns: Object.keys(t.rows[0]), never_export: !!t.never, virtual: !!t.virtual}))});
    }
    const t = here[b.table];
    log.at(-1).table = b.table;
    if (t.never) return json(res, 403, {error: 'This table is never exported; it is counted only'});
    steps++;
    const list = t.rows.map((r, i) => ({__rowid__: i + 1, ...r})).filter(r => r.__rowid__ > b.cursor).slice(0, partRows);
    const part = gzipSync(list.map(r => JSON.stringify(r)).join('\n') + (list.length ? '\n' : ''));
    res.writeHead(200, {'Content-Type': 'application/gzip', 'X-Rows': String(list.length),
      'X-Next-Cursor': list.length === partRows ? String(list.at(-1).__rowid__) : '', 'X-Sha256': sha(part),
      'X-Rows-Written': steps === wroteOnStep ? '1' : '0'});
    res.end(part);
  });
  const stored = {parts: new Map(), manifest: null, runs: []};
  const api = await listen((req, res, body) => {
    log.push({at: Date.now(), side: 'new', path: req.url});
    if (req.headers.authorization !== `Bearer ${NEW_KEY}`) return json(res, 401, {error: {code: 'unauthorized'}});
    if (req.url === '/v1/ops/import/parts') {
      if (sha(body) !== req.headers['th-sha256']) return json(res, 422, {error: {code: 'validation'}});
      stored.parts.set(req.headers['th-import'], {bytes: body, rows: Number(req.headers['th-rows'])});
      return json(res, 201, {key: req.headers['th-import']});
    }
    if (req.url.startsWith('/v1/ops/import/manifest/')) {
      stored.manifest = JSON.parse(body.toString());
      res.writeHead(201);
      return res.end();
    }
    if (req.url === '/v1/import/runs') {
      const r = JSON.parse(body.toString());
      stored.runs.push(r);
      return json(res, 202, {import_id: r.id});
    }
    const r = stored.runs.find(x => req.url === `/v1/import/runs/${x.id}`);
    const failed = r.dataset === failDataset;
    return json(res, 200, {id: r.id, run_id: r.run_id, dataset: r.dataset, state: failed ? 'failed' : 'done',
      counts: {expected: 3, imported: 3, skipped: 0, skip_reasons: {}, files_waiting: 0},
      report: {spot_checks: {seed: 1, checked: 3, passed: 3, failed: []}, thread_shapes: null, rows_changed: 3, rerun_delta: null},
      last_error: failed ? 'count_mismatch' : null, started_at: 1, finished_at: 2});
  });
  return {old, api, log, stored, stop: () => Promise.all([old.stop(), api.stop()])};
}

const env = (f, extra = {}) => ({PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: freshTmp(), OLD_API: f.old.url,
  TH_API: f.api.url, OLD_TOKEN: OLD_KEY, TH_TOKEN: NEW_KEY, TH_RETRY_BASE_MS: '5', TH_POLL_MS: '5', ...extra});
const drive = (f, args, extra) => runNode(DRIVER, args, {env: env(f, extra)});

test('pulls each table part by part, posts the parts unchanged, writes the manifest last and imports in order', async () => {
  const f = await fakes();
  try {
    const r = await drive(f, ['--run', 'run-t1', '--deployed', LONG_AGO, '--old-version', 'v-synthetic']);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual([...f.stored.parts.keys()], ['run-t1/claude-chat-v1/cc_threads/0001', 'run-t1/claude-chat-v1/cc_threads/0002',
      'run-t1/claude-chat-v1/cc_messages/0001', 'run-t1/claude-chat-v1/cc_messages/0002', 'run-t1/claude-chat-v1/cc_state/0001']);
    const m = f.stored.manifest;
    assert.equal(m.run_id, 'run-t1');
    assert.equal(m.worker_version, 'v-synthetic');
    assert.equal(Object.keys(m.instances).length, 7);
    const t = m.instances['claude-chat-v1'].tables;
    const parts = name => [...f.stored.parts].filter(([k]) => k.includes(`/${name}/`)).map(([, p]) => p);
    assert.deepEqual(t.cc_threads, {rows: 3, parts: 2, columns: ['id', 'title', 'created_ms', 'updated_ms', 'archived', 'session_url'],
      sha256s: parts('cc_threads').map(p => sha(p.bytes)), part_rows: [2, 1]});
    assert.deepEqual(t.cc_messages.part_rows, [2, 2], 'the empty end is not a part');
    assert.deepEqual(t.relay_owner_credentials, {rows: 2, parts: 0, columns: [], sha256s: [], part_rows: [], never_export: true});
    assert.deepEqual(t.cc_messages_fts, {rows: 1, parts: 0, columns: ['body'], sha256s: [], part_rows: []});
    assert.deepEqual(m.instances['jarvis-shared-v2'], {tables: {}});
    // Never a step for the credential or virtual table; the manifest after the last part; the runs after it.
    assert.ok(!f.log.some(l => l.table === 'relay_owner_credentials' || l.table === 'cc_messages_fts'));
    const at = path => f.log.findIndex(l => l.path.startsWith(path));
    const lastPart = f.log.findLastIndex(l => l.path === '/v1/ops/import/parts');
    assert.ok(at('/v1/ops/import/manifest/run-t1') > lastPart);
    assert.ok(at('/v1/import/runs') > at('/v1/ops/import/manifest/run-t1'));
    assert.deepEqual(f.stored.runs.map(x => x.dataset), ['threads', 'messages', 'notebook']);
    assert.ok(f.stored.runs.every(x => x.run_id === 'run-t1' && /^[0-9a-f-]{36}$/.test(x.id)));
    // Counts only: no title, body or key ever reaches the output.
    assert.doesNotMatch(r.stdout + r.stderr, /lantern|Lantern|old_fake|thm_fake/);
    assert.match(r.stdout, /claude-chat-v1\/cc_messages: 4 rows in 2 parts/);
    assert.match(r.stdout, /relay_owner_credentials: 2 rows, counted only \(never exported\)/);
    assert.match(r.stdout, /import messages: done, 3 of 3 imported, 0 skipped, 3 of 3 spot checks matched/);
    assert.deepEqual({...r.json, imports: undefined}, {run_id: 'run-t1', tables: 5, rows: 11, parts: 5, manifest: 'written', imports: undefined});
  } finally { await f.stop(); }
});

test('stops at once when the old Worker reports a row written: no further step, no manifest, no import', async () => {
  const f = await fakes({wroteOnStep: 2});
  try {
    const r = await drive(f, ['--run', 'run-t2', '--deployed', LONG_AGO]);
    assert.equal(r.code, 3);
    assert.equal(JSON.parse(r.stderr.trim().split('\n').pop()).error.code, 'rows_written');
    assert.equal(f.stored.parts.size, 1);
    assert.equal(f.stored.manifest, null);
    assert.equal(f.stored.runs.length, 0);
    assert.equal(f.log.filter(l => l.side === 'old' && l.table).length, 2);
  } finally { await f.stop(); }
});

test('waits until 5 minutes after the deploy before its first call to the old Worker', async () => {
  const f = await fakes();
  try {
    const began = Date.now();
    const r = await drive(f, ['--run', 'run-t3', '--deployed', String(began - 5 * 60_000 + 600), '--no-runs',
      '--instances', 'jarvis-makima-v1']);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(f.log[0].at - began >= 500, `first call after ${f.log[0].at - began} ms`);
    assert.match(r.stdout, /^waiting 1 s/m);
    assert.deepEqual(f.stored.manifest.instances, {'jarvis-makima-v1': {tables: {}}});
    assert.equal(f.stored.runs.length, 0);
  } finally { await f.stop(); }
});

test('a failed import stops with its code and runs again alone; bad arguments and a missing host are refused before any call', async () => {
  const f = await fakes({failDataset: 'messages'});
  try {
    const r = await drive(f, ['--run', 'run-t4', '--deployed', LONG_AGO, '--instances', 'claude-chat-v1']);
    assert.equal(r.code, 5);
    const err = JSON.parse(r.stderr.trim().split('\n').pop());
    assert.equal(err.error.code, 'import_failed');
    assert.deepEqual(Object.keys(err.imports), ['threads', 'messages']);
    const again = await drive(f, ['--run', 'run-t4', '--imports-only']);
    assert.equal(again.code, 5, 'the imports again, without the export');
    assert.equal(f.log.filter(l => l.side === 'old').length, 1 + 6, 'no old call the second time');
    assert.deepEqual(f.stored.runs.map(x => x.dataset), ['threads', 'messages', 'threads', 'messages']);
    const calls = f.log.length;
    for (const [args, extra] of [[['--run', 'bad id']], [['--run', 'ok', '--instances', 'nope']], [['--run', 'ok'], {OLD_API: ''}],
      [['--run', 'ok', '--no-runs', '--imports-only']]]) {
      const bad = await drive(f, args, extra);
      assert.equal(bad.code, 2, args.join(' '));
    }
    assert.equal(f.log.length, calls);
  } finally { await f.stop(); }
});

test('the pull and the import against the real Worker, its alarm running the jobs', {timeout: 240_000,
  skip: available() ? false : 'wrangler is not installed'}, async t => {
  const w = await startWorker();
  t.after(() => w.stop());
  const {device, keys} = await setupOwner(w, ['mind:chat']);
  // Only the key named exactly import-once may write the import; the routine's chat key is refused.
  const once = await w.call('POST', '/v1/auth/agents', {token: device, body: {name: 'import-once', role: 'mind:chat', current_password: PASSWORD}});
  assert.equal(once.status, 201);
  const f = await fakes();
  t.after(() => f.stop());
  const routine = await runNode(DRIVER, ['--run', 'run-e2e', '--deployed', LONG_AGO, '--instances', 'claude-chat-v1'],
    {env: {...env(f), TH_API: w.url, TH_TOKEN: keys['mind:chat']}});
  assert.equal(routine.code, 4);
  assert.equal(JSON.parse(routine.stderr.trim().split('\n').pop()).error.code, 'forbidden');
  const r = await runNode(DRIVER, ['--run', 'run-e2e', '--deployed', LONG_AGO, '--instances', 'claude-chat-v1'],
    {env: {...env(f), TH_API: w.url, TH_TOKEN: once.body.token, TH_POLL_MS: '200'}});
  assert.equal(r.code, 0, `${r.stderr}\n${r.stdout}`);
  assert.deepEqual(Object.fromEntries(Object.entries(r.json.imports).map(([k, v]) => [k, [v.state, v.imported, v.skipped]])),
    {threads: ['done', 3, 0], messages: ['done', 4, 0], notebook: ['done', 1, 0]});
  const status = await w.call('GET', `/v1/import/runs/${r.json.imports.messages.id}`, {token: device});
  assert.deepEqual(status.body.report.spot_checks, {seed: status.body.report.spot_checks.seed, checked: 4, passed: 4, failed: []});
  assert.deepEqual(status.body.report.thread_shapes, {checked: 1, failed: []});
  const found = await w.call('GET', '/v1/search?q=lantern', {token: device});
  assert.equal(found.body.items.filter(i => i.source === 'messages').length, 4);
  // The same part again is stored once; other bytes under its name are refused.
  const again = await runNode(DRIVER, ['--run', 'run-e2e', '--deployed', LONG_AGO, '--instances', 'claude-chat-v1', '--no-runs'],
    {env: {...env(f), TH_API: w.url, TH_TOKEN: once.body.token}});
  assert.equal(again.code, 4);
  assert.equal(JSON.parse(again.stderr.trim().split('\n').pop()).error.code, 'conflict', 'the manifest of a run is written once');
});
