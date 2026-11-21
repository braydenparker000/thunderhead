// A scanned book finishes (STUDY.md §3.3): study_extract.py stops at a page boundary when --until
// has passed (the first page always read) or at the first page that needs OCR when OCR isn't here,
// keeping what it read; study-ingest.mjs posts those pages, moves the cursor and reports paused
// (with the reason the cover shows when OCR is missing), never ready. A tiny fixture, a fake Worker,
// and a deadline already past instead of a clock. Runs where python3 has pypdf and Pillow.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {makePdf} from '../../tests/fixtures/make-pdf.mjs';
import {OCR_MISSING} from '../jobs/study-ingest.mjs';

const PYTHON = process.env.PYTHON || 'python3';
const EXTRACT = fileURLToPath(new URL('../jobs/study_extract.py', import.meta.url));
const JOB = fileURLToPath(new URL('../jobs/study-ingest.mjs', import.meta.url));
const ready = spawnSync(PYTHON, ['-c', 'import pypdf, PIL'], {stdio: 'ignore'}).status === 0;
const skip = ready ? false : 'needs python3 with pypdf and Pillow';

/** Text pages, with page `scan` (1-based) swapped for an image-only page. */
function fixture(dir, pages, scan) {
  const text = join(dir, 'text.pdf');
  writeFileSync(text, makePdf({pages, text: n => `Page ${n} of an invented book about rivers and stones.`}));
  const out = join(dir, 'book.pdf');
  const made = spawnSync(PYTHON, ['-c', `
import sys
from PIL import Image, ImageDraw
from pypdf import PdfReader, PdfWriter
src, out, scan = sys.argv[1], sys.argv[2], int(sys.argv[3])
img = Image.new("L", (400, 500), 255)
ImageDraw.Draw(img).rectangle((40, 40, 360, 120), fill=0)
img.save(out + ".scan.pdf", "PDF", resolution=72)
w = PdfWriter()
for i, page in enumerate(PdfReader(src).pages, 1):
    w.add_page(PdfReader(out + ".scan.pdf").pages[0] if i == scan else page)
w.write(out)
`, text, out, String(scan)], {encoding: 'utf8'});
  assert.equal(made.status, 0, made.stderr);
  return out;
}

const extract = (pdf, out, ...args) => {
  const r = spawnSync(PYTHON, ['-I', EXTRACT, pdf, '--out', out, ...args], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr);
  const lines = readFileSync(out, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  return {counts: JSON.parse(r.stdout.trim().split('\n').at(-1)), lines};
};

test('study_extract.py: --until past reads one page and stops; OCR missing stops before the scan', {skip}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'study-pause-'));
  try {
    const pdf = fixture(dir, 5, 4);
    const out = join(dir, 'pages.jsonl');
    const late = extract(pdf, out, '--from', '1', '--until', '1', '--no-ocr');
    assert.deepEqual([late.counts.done, late.counts.stopped, late.counts.next], [1, 'time', 2]);
    assert.deepEqual(late.lines.map(l => l.pdf_page), [2], 'the page it read is written');
    const all = extract(pdf, out, '--from', '0', '--until', String(Date.now() + 600_000), '--no-ocr');
    assert.deepEqual([all.counts.done, all.counts.stopped, all.counts.ocr_missing, all.counts.next], [3, 'ocr_missing', 1, 3]);
    assert.deepEqual(all.lines.map(l => l.pdf_page), [1, 2, 3], 'the scan (page 4) is not written empty');
    const none = extract(pdf, out, '--from', '3', '--no-ocr');
    assert.deepEqual([none.counts.done, none.counts.stopped, none.lines.length], [0, 'ocr_missing', 0]);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

/** A Worker that hands out one run of `pdf` from `cursor` and records what the job sends. */
async function fakeWorker(pdf, cursor) {
  const bytes = readFileSync(pdf);
  const seen = {patches: [], pages: [], claims: 0};
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const json = (status, data) => { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(data === undefined ? '' : JSON.stringify(data)); };
      const url = req.url.split('?')[0];
      if (url === '/v1/library/scripture') return json(404, {error: {code: 'not_found'}});
      if (url === '/v1/library/ingest/claim') {
        if (seen.claims++) return json(204);
        return json(200, {job: {id: 'job1', cursor}, book: {id: 'book1', bytes: bytes.length, language: 'eng', pdf_pages: null}});
      }
      if (url === '/v1/library/ingest/job1/file') { res.writeHead(200, {'Content-Type': 'application/pdf'}); return res.end(bytes); }
      if (url === '/v1/library/ingest/job1' && req.method === 'PATCH') {
        const b = JSON.parse(body);
        seen.patches.push(b);
        return json(200, {book: {state: b.state === 'paused' ? 'indexing' : b.state}});
      }
      if (url === '/v1/library/books/book1/pages') {
        const b = JSON.parse(body);
        seen.pages.push(...b.pages.map(p => p.pdf_page));
        return json(200, {written: b.pages.length, refs: 0});
      }
      json(404, {error: {code: 'not_found'}});
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {seen, url: `http://127.0.0.1:${server.address().port}`, stop: () => new Promise(r => server.close(r))};
}

function runJob(w, args) {
  const env = {...process.env, TH_API: w.url, TH_TOKEN: 'thm_test_key', TH_ROLE: 'night', TMPDIR: mkdtempSync(join(tmpdir(), 'th-')), PYTHON, TH_RETRY_BASE_MS: '5'};
  return new Promise(resolve => {
    const child = spawn(process.execPath, [JOB, '--books', '1', ...args], {env});
    let out = '';
    let err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', code => resolve({code, out, err, lines: out.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))}));
  });
}

test('the job posts what was read before the deadline, moves the cursor and reports paused', {skip}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'study-pause-'));
  const w = await fakeWorker(fixture(dir, 5, 0), 1);
  try {
    const r = await runJob(w, ['--minutes', '0.01', '--no-ocr']); // a deadline already a minute past the posting margin
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(w.seen.pages, [2], 'the one page read is posted');
    assert.deepEqual(w.seen.patches.at(-1), {state: 'paused', cursor: 2});
    assert.ok(!w.seen.patches.some(p => p.state === 'ready'));
    assert.equal(r.lines[0].paused, 'time');
  } finally { await w.stop(); rmSync(dir, {recursive: true, force: true}); }
});

test('OCR missing: the pages before the scan are posted, then paused with the reason, never ready', {skip}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'study-pause-'));
  const w = await fakeWorker(fixture(dir, 5, 3), 0);
  try {
    const r = await runJob(w, ['--minutes', '10', '--no-ocr']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(w.seen.pages, [1, 2]);
    assert.deepEqual(w.seen.patches.at(-1), {state: 'paused', cursor: 2, reason: OCR_MISSING});
    assert.ok(!w.seen.patches.some(p => p.state === 'ready'));
    assert.deepEqual([r.lines[0].paused, r.lines[0].ocr_missing], ['ocr_missing', 1]);
    assert.ok(OCR_MISSING.length <= 200 && !/please|we /i.test(OCR_MISSING));
    assert.ok(!r.out.includes('rivers and stones'), 'counts only');
  } finally { await w.stop(); rmSync(dir, {recursive: true, force: true}); }
});

test('a text book read in time is ready', {skip}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'study-pause-'));
  const w = await fakeWorker(fixture(dir, 3, 0), 0);
  try {
    const r = await runJob(w, ['--minutes', '10', '--no-ocr']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(w.seen.pages, [1, 2, 3]);
    assert.equal(w.seen.patches.at(-1).state, 'ready');
  } finally { await w.stop(); rmSync(dir, {recursive: true, force: true}); }
});
