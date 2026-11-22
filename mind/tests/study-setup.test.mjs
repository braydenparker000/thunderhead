// The mind's setup for reading books (mind/jobs/study-setup.sh, STUDY.md §3.3) and the ingest's
// first moves. A session whose Tesseract has only English gets the Spanish data too, so a Spanish
// book's scans are read in Spanish (study_extract.py --lang spa); one that has both installs
// nothing. The reader's Python is one known venv (2026-11-21: a user-site pypdf the isolated
// reader never saw, a system cryptography that panicked on import, a claim held through the
// failure): the setup builds it with pinned pypdf and cryptography and never touches the user site;
// the ingest checks its imports the reader's way before it claims, and releases a claim it can't
// finish. Stub commands on PATH and a stub Worker.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const SETUP = fileURLToPath(new URL('../jobs/study-setup.sh', import.meta.url));
const INGEST = fileURLToPath(new URL('../jobs/study-ingest.mjs', import.meta.url));

const stub = (path, body) => {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
};

/** A venv's python: logs every call; pip install marks it installed; -c passes once installed. */
const venvPython = (dir, log) => `echo "venv $*" >> '${log}'
case "$*" in *"-m pip install"*) touch '${dir}/installed'; exit 0;; esac
case "$*" in *"-c "*) [ -f '${dir}/installed' ]; exit $?;; esac
exit 0`;

function run(langs, {venvReady = false} = {}) {
  const bin = mkdtempSync(join(tmpdir(), 'study-setup-'));
  const venv = join(bin, 'venv');
  const log = join(bin, 'calls.log');
  const apt = join(bin, 'apt.log');
  // The base python3 only makes the venv; anything else it is asked (the user site) is logged.
  stub(join(bin, 'python3'), `echo "base $*" >> '${log}'
if [ "$1" = "-m" ] && [ "$2" = "venv" ]; then mkdir -p "$3/bin"; cat > "$3/bin/python" <<'PY'
${venvPython(venv, log)}
PY
chmod +x "$3/bin/python"; fi
exit 0`);
  if (venvReady) {
    mkdirSync(join(venv, 'bin'), {recursive: true});
    stub(join(venv, 'bin', 'python'), venvPython(venv, log));
    writeFileSync(join(venv, 'installed'), '');
  }
  stub(join(bin, 'tesseract'), `printf 'List of available languages (%s):\\n${langs.join('\\n')}\\n' ${langs.length}`);
  stub(join(bin, 'apt-get'), `echo "$@" >> '${apt}'`);
  const r = spawnSync('bash', [SETUP], {encoding: 'utf8', env: {PATH: `${bin}:/usr/bin:/bin`, PYTHON: join(bin, 'python3'), TH_STUDY_VENV: venv, HOME: bin}});
  return {out: r.stdout, apt: existsSync(apt) ? readFileSync(apt, 'utf8') : '', calls: existsSync(log) ? readFileSync(log, 'utf8') : ''};
}

test('English only: the Spanish data is installed', () => {
  const r = run(['eng', 'osd']);
  assert.match(r.apt, /tesseract-ocr-spa/);
  assert.match(r.out, /"setup":"ready"/);
});

test('English and Spanish there: nothing is installed', () => {
  assert.equal(run(['eng', 'spa']).apt, '');
});

test('the reader gets its own venv: pinned pypdf and cryptography, checked isolated, never the user site', () => {
  const r = run(['eng', 'spa']);
  assert.match(r.calls, /^base -m venv .*\/venv$/m);
  const pip = r.calls.split('\n').find(l => l.includes('-m pip install'));
  assert.match(pip, /^venv -I -m pip install /);
  for (const pin of ['pypdf==6.21.4', 'cryptography==44.0.2', 'pypdfium2==5.14.0', 'pytesseract==0.3.13']) assert.ok(pip.includes(pin), pin);
  assert.doesNotMatch(r.calls, /--user|--break-system-packages/);
  assert.match(r.calls, /^venv -I -c import pypdf, cryptography$/m, 'the ingest\'s own check, isolated');
  assert.match(r.out, /"setup":"ready"/);
  const again = run(['eng', 'spa'], {venvReady: true});
  assert.doesNotMatch(again.calls, /pip install|-m venv/, 'a venv that imports is left as it is');
  assert.match(again.out, /"setup":"ready"/);
});

/** A Worker that hands out one run and records the claims and what the job sends. */
async function worker() {
  const seen = {claims: 0, patches: []};
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const json = (status, data) => { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(data === undefined ? '' : JSON.stringify(data)); };
      const url = req.url.split('?')[0];
      if (url === '/v1/library/scripture') return json(404, {error: {code: 'not_found'}});
      if (url === '/v1/library/ingest/claim') {
        if (seen.claims++) return json(204);
        return json(200, {job: {id: 'job1', cursor: 3}, book: {id: 'book1', bytes: 4, language: 'eng', pdf_pages: null}});
      }
      if (url === '/v1/library/ingest/job1/file') { res.writeHead(200, {'Content-Type': 'application/pdf'}); return res.end('%PDF'); }
      if (url === '/v1/library/ingest/job1' && req.method === 'PATCH') { seen.patches.push(JSON.parse(body)); return json(200, {book: {state: 'queued'}}); }
      json(404, {error: {code: 'not_found'}});
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {seen, url: `http://127.0.0.1:${server.address().port}`, stop: () => new Promise(r => server.close(r))};
}

/** The ingest as its own process (async: the stub Worker answers from this one), in a minimal env. */
const ingest = (w, python) => new Promise(resolve => {
  const child = spawn(process.execPath, [INGEST, '--python', python, '--books', '1'], {env: {PATH: process.env.PATH, HOME: tmpdir(),
    TH_API: w.url, TH_TOKEN: 'thm_test_key', TH_ROLE: 'night', TMPDIR: mkdtempSync(join(tmpdir(), 'th-')), TH_RETRY_BASE_MS: '5'}});
  let stdout = '', stderr = '';
  child.stdout.on('data', d => { stdout += d; });
  child.stderr.on('data', d => { stderr += d; });
  child.on('close', status => resolve({status, stdout, stderr}));
});

test('the ingest checks its imports the reader\'s way before it claims; a run that fails releases its claim', async () => {
  const bin = mkdtempSync(join(tmpdir(), 'study-ingest-'));
  const broken = join(bin, 'broken');
  stub(broken, 'case "$*" in "-I -c import pypdf, cryptography") exit 1;; esac\nexit 0');
  const w = await worker();
  try {
    const r = await ingest(w, broken);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /"books":0,"skipped":"the page reader's Python is not set up here/);
    assert.equal(w.seen.claims, 0, 'nothing claimed');
    // Imports fine, then the reader itself fails: the claim goes back at the cursor it had.
    const failing = join(bin, 'failing');
    stub(failing, 'case "$*" in "-I -c import pypdf, cryptography") exit 0;; esac\necho \'{"error":"boom"}\'; exit 1');
    const f = await ingest(w, failing);
    assert.equal(f.status, 4);
    assert.equal(w.seen.claims, 1);
    assert.deepEqual(w.seen.patches.at(-1), {state: 'released', cursor: 3});
  } finally { await w.stop(); }
});
