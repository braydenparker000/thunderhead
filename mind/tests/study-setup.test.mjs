// The mind's setup for reading books (mind/jobs/study-setup.sh, STUDY.md §3.3): a session whose
// Tesseract has only English gets the Spanish data too, so a Spanish book's scans are read in
// Spanish (study_extract.py --lang spa); one that has both installs nothing. Stub commands on PATH.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const SETUP = fileURLToPath(new URL('../jobs/study-setup.sh', import.meta.url));

function run(langs) {
  const bin = mkdtempSync(join(tmpdir(), 'study-setup-'));
  const log = join(bin, 'apt.log');
  const stub = (name, body) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  stub('python3', 'exit 0');
  stub('tesseract', `printf 'List of available languages (%s):\\n${langs.join('\\n')}\\n' ${langs.length}`);
  stub('apt-get', `echo "$@" >> '${log}'`);
  const r = spawnSync('bash', [SETUP], {encoding: 'utf8', env: {PATH: `${bin}:/usr/bin:/bin`, PYTHON: join(bin, 'python3')}});
  return {out: r.stdout, apt: existsSync(log) ? readFileSync(log, 'utf8') : ''};
}

test('English only: the Spanish data is installed', () => {
  const r = run(['eng', 'osd']);
  assert.match(r.apt, /tesseract-ocr-spa/);
  assert.match(r.out, /"setup":"ready"/);
});

test('English and Spanish there: nothing is installed', () => {
  assert.equal(run(['eng', 'spa']).apt, '');
});
