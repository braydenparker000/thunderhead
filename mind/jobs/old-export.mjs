#!/usr/bin/env node
// The one-time pull of the old Worker's data into the Thunderhead (MIGRATION.md §3–4, SETUP.md L2).
// Run once, by hand, in a session of the owner's existing Claude environment, whose network
// secrets add `Authorization` for both hosts: the old Worker's agent key (CLAUDE_CHAT_AGENT_KEY)
// and the new Worker's `import-once` mind:chat key. No token is ever read, printed or put in a URL;
// OLD_TOKEN and TH_TOKEN are used only when set (local runs, tests).
//
//   node mind/jobs/old-export.mjs --run <run_id> [--deployed <time>] [--old-version <id>]
//                                 [--instances a,b] [--datasets a,b] [--no-runs | --imports-only]
//
// 1. Waits until 5 minutes after the old Worker's export deploy (`--deployed`, else 5 minutes from
//    now): a Durable Object keeps its old code for about 4 minutes after a deploy.
// 2. For each named object, lists its tables (POST /ops/export/tables), then pulls each exportable
//    table part by part (POST /ops/export/step) and posts every part unchanged to the new Worker
//    (POST /v1/ops/import/parts). Never-exported, virtual and rowid-less tables are counted only,
//    and so is a table one of whose parts the new Worker finds too large (413: base64 BLOBs such as
//    the old attachments): it is listed as `deferred` and stays in the old Worker for now
//    (MIGRATION.md §8); its parts posted before are left unlisted. It stops at once if the old
//    Worker ever reports a row written, or a part's SHA-256 differs.
// 3. Writes the manifest last (PUT /v1/ops/import/manifest/:run_id).
// 4. Unless --no-runs: starts the import of threads, then messages, then the notebook
//    (POST /v1/import/runs) and waits for each (GET /v1/import/runs/:id). --imports-only does only
//    this, for a run whose parts and manifest are stored (after a fix, the same parts again).
//    --datasets names others, in order: the music catalog runs on its own day (MIGRATION.md §4),
//    `--instances music-catalog-v1 --datasets music,music_log` (SETUP.md N3).
// It prints counts only: never a row, a title or a body. The last line is one JSON summary.
// Exit: 0 done, 2 usage, 3 the old Worker wrote a row, 4 a call failed, 5 an import failed or
// did not finish in time.
import {spawnSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const INSTANCES = ['claude-chat-v1', 'music-catalog-v1', 'jarvis-shared-v2', 'jarvis-makima-v1',
  'jarvis-coordination-v2', 'public-coordination-v2', 'jarvis-publication-v1'];
/** The datasets built so far, in the order they must run (IMPORT_DATASETS in shared/contract), and
 * the ones a run imports unless told otherwise: the old Chats. */
export const ALL_DATASETS = ['threads', 'messages', 'notebook', 'music', 'music_log'];
export const DATASETS = ['threads', 'messages', 'notebook'];
const DEPLOY_WAIT_MS = 5 * 60_000;
const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;

class Stop extends Error {
  constructor(exit, code, message) { super(message); this.exit = exit; this.code = code; }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const num = (v, fallback) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const say = line => process.stdout.write(`${line}\n`);

export function parseArgs(argv) {
  const o = {runs: true, instances: INSTANCES, datasets: DATASETS};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Stop(2, 'usage', `${a} needs a value`);
      return v;
    };
    if (a === '--run') o.run = value();
    else if (a === '--deployed') o.deployed = value();
    else if (a === '--old-version') o.oldVersion = value();
    else if (a === '--instances') o.instances = value().split(',').filter(Boolean);
    else if (a === '--datasets') o.datasets = value().split(',').filter(Boolean);
    else if (a === '--no-runs') o.runs = false;
    else if (a === '--imports-only') o.importsOnly = true;
    else throw new Stop(2, 'usage', `unknown argument ${a}`);
  }
  if (o.importsOnly && !o.runs) throw new Stop(2, 'usage', '--imports-only and --no-runs exclude each other');
  if (!RUN_ID.test(o.run ?? '')) throw new Stop(2, 'usage', '--run <run_id>: letters, digits, _ and -, at most 64');
  const unknown = o.instances.filter(n => !INSTANCES.includes(n));
  if (unknown.length || !o.instances.length) throw new Stop(2, 'usage', `--instances: some of ${INSTANCES.join(', ')}`);
  if (!o.datasets.length || o.datasets.some(d => !ALL_DATASETS.includes(d)))
    throw new Stop(2, 'usage', `--datasets: some of ${ALL_DATASETS.join(', ')}`);
  if (o.deployed !== undefined) {
    const t = /^\d+$/.test(o.deployed) ? Number(o.deployed) : Date.parse(o.deployed);
    if (!Number.isFinite(t)) throw new Stop(2, 'usage', '--deployed: an ISO time or epoch ms');
    o.deployed = t;
  }
  return o;
}

function settings(env = process.env) {
  const base = v => (v || '').replace(/\/+$/, '');
  const s = {old: base(env.OLD_API), api: base(env.TH_API), oldToken: env.OLD_TOKEN || '', token: env.TH_TOKEN || '',
    retryMs: num(env.TH_RETRY_BASE_MS, 1000), pollMs: num(env.TH_POLL_MS, 15_000),
    runLimitMs: num(env.TH_RUN_LIMIT_MS, 60 * 60_000)};
  if (!/^https?:\/\//.test(s.old)) throw new Stop(2, 'usage', 'OLD_API is not set (the old Worker, https://…)');
  if (!/^https?:\/\//.test(s.api)) throw new Stop(2, 'usage', 'TH_API is not set (the new Worker, https://…)');
  return s;
}

/** One call, retried on network errors, 429 and 5xx (1 s, 2 s, 4 s). A 4xx answer is returned. */
async function call(s, url, init, what) {
  let last = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(s.retryMs * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, {...init, signal: AbortSignal.timeout(60_000)});
      if (res.status < 500 && res.status !== 429) return res;
      last = `HTTP ${res.status}`;
      await res.arrayBuffer().catch(() => null);
    } catch (error) {
      last = error?.cause?.code || error?.name || 'network error';
    }
  }
  throw new Stop(4, 'unreachable', `${what}: ${last}`);
}

async function fail(res, what) {
  const body = await res.json().catch(() => ({}));
  const code = body?.error?.code || `http_${res.status}`;
  return new Stop(4, code, `${what}: HTTP ${res.status} ${code}`);
}

const headers = (token, extra = {}) => ({'TH-Client': 'old-export/1', ...(token ? {Authorization: `Bearer ${token}`} : {}), ...extra});
const oldPost = (s, path, body, what) => call(s, `${s.old}${path}`,
  {method: 'POST', headers: headers(s.oldToken, {'Content-Type': 'application/json'}), body: JSON.stringify(body)}, what);
const newCall = (s, method, path, body, what, extra = {}) => call(s, `${s.api}${path}`, {method,
  headers: headers(s.token, body instanceof Uint8Array ? extra : {'Content-Type': 'application/json', ...extra}),
  body: body === undefined || body instanceof Uint8Array ? body : JSON.stringify(body)}, what);

const wrote = (n, what) => {
  if (Number(n) !== 0) throw new Stop(3, 'rows_written', `${what}: the old Worker reported ${n} rows written; stopped`);
};

/** One table, part by part; returns its manifest entry. */
async function exportTable(s, o, instance, t) {
  const where = `${instance}/${t.table}`;
  const counted = (why, never = false) => {
    say(`${where}: ${t.rows} rows, counted only (${why})`);
    if (why.startsWith('too large')) o.deferred.push(where);
    return {rows: t.rows, parts: 0, columns: never ? [] : t.columns, sha256s: [], part_rows: [], ...(never ? {never_export: true} : {})};
  };
  if (t.never_export) return counted('never exported', true);
  if (t.virtual) return counted('virtual');
  const entry = {rows: 0, parts: 0, columns: t.columns, sha256s: [], part_rows: []};
  let cursor = 0;
  for (;;) {
    const res = await oldPost(s, '/ops/export/step', {run_id: o.run, instance, table: t.table, cursor}, `step ${where}`);
    if (res.status === 403) return counted('never exported', true);
    if (res.status === 422) return counted('no rowid');
    if (!res.ok) throw await fail(res, `step ${where}`);
    wrote(res.headers.get('x-rows-written'), `step ${where}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const sha = sha256(bytes);
    if (sha !== res.headers.get('x-sha256')) throw new Stop(4, 'bad_part', `step ${where}: the part's SHA-256 differs from X-Sha256`);
    const rows = Number(res.headers.get('x-rows'));
    if (!Number.isInteger(rows) || rows < 0) throw new Stop(4, 'bad_part', `step ${where}: X-Rows is not a count`);
    // An empty part (an empty table, or the end of one of exactly 2,000 × n rows) is not posted.
    if (rows > 0) {
      const n = entry.parts + 1;
      const path = `${o.run}/${instance}/${t.table}/${String(n).padStart(4, '0')}`;
      const put = await newCall(s, 'POST', '/v1/ops/import/parts', bytes, `part ${path}`,
        {'Content-Type': 'application/gzip', 'TH-Import': path, 'TH-Sha256': sha, 'TH-Rows': String(rows)});
      if (put.status === 413) {
        await put.arrayBuffer().catch(() => null);
        return counted('too large to post; stays in the old Worker for now');
      }
      if (put.status !== 201) throw await fail(put, `part ${path}`);
      await put.arrayBuffer().catch(() => null);
      entry.parts = n;
      entry.rows += rows;
      entry.sha256s.push(sha);
      entry.part_rows.push(rows);
    }
    const next = res.headers.get('x-next-cursor') ?? '';
    if (next === '') break;
    const after = Number(next);
    if (!Number.isSafeInteger(after) || after <= cursor) throw new Stop(4, 'bad_cursor', `step ${where}: X-Next-Cursor does not move on`);
    cursor = after;
  }
  const moved = entry.rows === t.rows ? '' : ` (${t.rows} when listed; a live table)`;
  say(`${where}: ${entry.rows} rows in ${entry.parts} parts${moved}`);
  return entry;
}

async function runImports(s, o) {
  const out = {};
  for (const dataset of o.datasets) {
    const id = randomUUID();
    const res = await newCall(s, 'POST', '/v1/import/runs', {id, run_id: o.run, dataset}, `import ${dataset}`);
    if (res.status !== 202) throw await fail(res, `import ${dataset}`);
    await res.arrayBuffer().catch(() => null);
    const until = Date.now() + s.runLimitMs;
    let st;
    for (;;) {
      const got = await newCall(s, 'GET', `/v1/import/runs/${id}`, undefined, `import ${dataset}`);
      if (!got.ok) throw await fail(got, `import ${dataset}`);
      st = await got.json();
      if (st.state === 'done' || st.state === 'failed' || Date.now() >= until) break;
      await sleep(s.pollMs);
    }
    const c = st.counts ?? {};
    const r = st.report;
    const checks = r ? `, ${r.spot_checks.passed} of ${r.spot_checks.checked} spot checks matched` : '';
    const shapes = r?.thread_shapes ? `, ${r.thread_shapes.checked - r.thread_shapes.failed.length} of ${r.thread_shapes.checked} threads matched` : '';
    const delta = r && r.rerun_delta !== null ? `, rerun changed ${r.rerun_delta}` : '';
    say(`import ${dataset}: ${st.state}, ${c.imported} of ${c.expected} imported, ${c.skipped} skipped${checks}${shapes}${delta}` +
      `${st.last_error ? ` (${st.last_error})` : ''}`);
    out[dataset] = {id, state: st.state, expected: c.expected, imported: c.imported, skipped: c.skipped, last_error: st.last_error ?? null};
    if (st.state !== 'done') {
      const late = st.state !== 'failed';
      throw Object.assign(new Stop(5, late ? 'not_finished' : 'import_failed',
        `import ${dataset}: ${late ? `still ${st.state}; read GET /v1/import/runs/${id} later` : st.last_error}`), {imports: out});
    }
  }
  return out;
}

export async function main(argv, env = process.env) {
  const started = Date.now();
  const o = parseArgs(argv);
  const s = settings(env);
  if (o.importsOnly) return {run_id: o.run, imports: await runImports(s, o)};
  const wait = Math.max(0, (o.deployed ?? started) + DEPLOY_WAIT_MS - Date.now());
  if (wait) {
    say(`waiting ${Math.ceil(wait / 1000)} s for the old Worker's objects to run the export's code`);
    await sleep(wait);
  }
  const manifest = {run_id: o.run, worker_version: o.oldVersion ?? null, started_at: Date.now(), finished_at: 0, instances: {}};
  o.deferred = [];
  const total = {tables: 0, rows: 0, parts: 0};
  for (const instance of o.instances) {
    const res = await oldPost(s, '/ops/export/tables', {instance}, `tables ${instance}`);
    if (!res.ok) throw await fail(res, `tables ${instance}`);
    const listed = await res.json();
    wrote(listed.rows_written, `tables ${instance}`);
    const tables = {};
    for (const t of listed.tables ?? []) {
      tables[t.table] = await exportTable(s, o, instance, t);
      total.tables++;
      total.rows += tables[t.table].rows;
      total.parts += tables[t.table].parts;
    }
    if (!listed.tables?.length) say(`${instance}: no tables`);
    manifest.instances[instance] = {tables};
  }
  manifest.finished_at = Date.now();
  const put = await newCall(s, 'PUT', `/v1/ops/import/manifest/${o.run}`, manifest, 'manifest');
  if (put.status !== 201) throw await fail(put, 'manifest');
  say(`manifest ${o.run}: ${total.tables} tables, ${total.rows} rows, ${total.parts} parts` +
    (o.deferred.length ? `; ${o.deferred.length} deferred (too large to post)` : ''));
  const imports = o.runs ? await runImports(s, o) : null;
  return {run_id: o.run, ...total, manifest: 'written', deferred: o.deferred, imports};
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };

if (isMain()) {
  // Node's fetch skips HTTPS_PROXY (and with it the network secrets) unless NODE_USE_ENV_PROXY=1.
  if ((process.env.HTTPS_PROXY || process.env.https_proxy) && process.env.NODE_USE_ENV_PROXY !== '1') {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      {stdio: 'inherit', env: {...process.env, NODE_USE_ENV_PROXY: '1'}});
    process.exit(child.status ?? 4);
  }
  main(process.argv.slice(2)).then(summary => { say(JSON.stringify(summary)); }, error => {
    const stop = error instanceof Stop ? error : new Stop(4, 'unexpected', error?.message ?? String(error));
    process.stderr.write(`${JSON.stringify({error: {code: stop.code, message: stop.message}, ...(error.imports ? {imports: error.imports} : {})})}\n`);
    process.exitCode = stop.exit;
  });
}
