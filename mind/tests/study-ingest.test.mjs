// Reading the owner's books (STUDY.md §3.3, §4). The block rules on their own; then the whole run
// against the real Worker under wrangler dev: a book of text (its printed page labels kept, its
// words searchable, a canary phrase never printed), a scanned page read by OCR when Tesseract is
// here, the same file again a duplicate, and a password-protected file failed with the sentence
// the owner reads. Runs where python3 has pypdf and wrangler is installed (PYTHON names another
// interpreter); skipped otherwise.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {makePdf} from '../../tests/fixtures/make-pdf.mjs';
import {uuidv7} from '../cli/lib/ids.mjs';
import {MAX_BLOCK, MIN_BLOCK, blocksOf} from '../jobs/study-blocks.mjs';
import {pageIn, parseArgs} from '../jobs/study-ingest.mjs';
import {available, setupOwner, startWorker} from './worker-dev.mjs';

const PYTHON = process.env.PYTHON || 'python3';
const JOB = fileURLToPath(new URL('../jobs/study-ingest.mjs', import.meta.url));
const has = (cmd, args) => spawnSync(cmd, args, {stdio: 'ignore'}).status === 0;
const ready = available() && has(PYTHON, ['-c', 'import pypdf']);
const ocrHere = ready && has(PYTHON, ['-c', 'import pypdfium2, pytesseract; pytesseract.get_tesseract_version()']);
const CANARY = 'Zephyrine marmalade orchestra';

test('blocks: split on blank lines, short ones merged, long ones cut at a sentence, trimmed', () => {
  const para = (n, w) => Array.from({length: n}, (_, i) => `${w}${i}.`).join(' ');
  const text = `Heading\n\n${para(30, 'word')}\n \n${para(20, 'more')}\n\n  tail end  `;
  const blocks = blocksOf(text);
  // "Heading" (short) joins the next block; "tail end" (short, last) joins the one before.
  assert.equal(blocks.length, 2);
  assert.equal(text.slice(...blocks[0]).startsWith('Heading'), true);
  assert.equal(text.slice(...blocks[1]).endsWith('tail end'), true);
  for (const [a, b] of blocks) assert.equal(text.slice(a, b), text.slice(a, b).trim());
  const long = Array.from({length: 120}, (_, i) => `Sentence number ${i} goes here.`).join(' ');
  const cut = blocksOf(long);
  assert.ok(cut.length >= 3);
  for (const [a, b] of cut) {
    assert.ok(b - a <= MAX_BLOCK && b - a >= MIN_BLOCK, `${b - a}`);
    assert.match(long.slice(a, b), /\.$/);
  }
  assert.deepEqual(blocksOf(''), []);
  assert.deepEqual(blocksOf('   \n\n  '), []);
  const page = pageIn({pdf_page: 3, page_label: 'x'.repeat(40), text: 'A page.', ocr: true, ocr_conf: 91.2});
  assert.deepEqual(page, {pdf_page: 3, page_label: 'x'.repeat(24), text: 'A page.', blocks: [[0, 7]], ocr: true, ocr_conf: 91.2, refs: []});
  assert.throws(() => parseArgs(['--books', '0']), /positive/);
  assert.deepEqual(parseArgs([]).books, 2);
});

test('a waiting book is read: pages, printed labels, search, a duplicate, a locked file; nothing printed but counts', {
  timeout: 300_000,
  skip: ready ? false : 'needs python3 with pypdf and wrangler',
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'study-ingest-'));
  const w = await startWorker();
  try {
    const {device, keys} = await setupOwner(w, ['mind:night']);
    const add = async (title, bytes) => {
      const id7 = uuidv7();
      const c = await w.call('POST', '/v1/library/books', {token: device, body: {id: id7, title, bytes: bytes.length}});
      assert.equal(c.status, 201, JSON.stringify(c.body));
      const p = await fetch(`${w.url}/v1/library/books/${id7}/parts/1`, {method: 'PUT', headers: {Authorization: `Bearer ${device}`, 'Content-Length': String(bytes.length)}, body: bytes});
      assert.equal(p.status, 200, await p.text());
      assert.equal((await w.call('POST', `/v1/library/books/${id7}/complete`, {token: device})).status, 200);
      return id7;
    };
    const text = makePdf({pages: 7, title: 'Secret Title Of A Book', text: (n) => (n === 5 ? `On this page the ${CANARY} plays at dawn.` : `Page ${n} of a synthetic commentary.`)});
    const book = await add('Secret Title Of A Book', text);
    const twin = await add('A second copy', text);
    let scanned = null;
    if (ocrHere) {
      const pdf = join(dir, 'scan.pdf');
      const made = spawnSync(PYTHON, ['-c', `
from PIL import Image, ImageDraw, ImageFont
img = Image.new("L", (1240, 1754), 255)
d = ImageDraw.Draw(img)
f = ImageFont.load_default(size=44)
for i, t in enumerate(["The quiet valley at dawn.", "A scanned page about patience."]):
    d.text((120, 200 + i * 80), t, fill=0, font=f)
img.save(${JSON.stringify(pdf)}, "PDF", resolution=150)
`]);
      assert.equal(made.status, 0, String(made.stderr));
      scanned = await add('A scan', new Uint8Array((await import('node:fs')).readFileSync(pdf)));
    }
    const locked = await add('A locked file', new TextEncoder().encode('%PDF-1.7\nnot really a pdf at all\n%%EOF\n'));
    const run = spawnSync(process.execPath, [JOB, '--books', '5'], {
      env: {...process.env, TH_API: w.url, TH_TOKEN: keys['mind:night'], TH_ROLE: 'night', PYTHON},
      encoding: 'utf8',
      timeout: 240_000,
    });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    const out = run.stdout + run.stderr;
    // Counts only: no page text, no title, no file name.
    for (const secret of [CANARY, 'Zephyrine', 'Secret Title', 'synthetic commentary', 'book.pdf']) assert.ok(!out.includes(secret), secret);
    const lines = run.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.at(-1), {done: true, books: ocrHere ? 4 : 3});
    const state = async (id) => (await w.call('GET', `/v1/library/books/${id}`, {token: device})).body.book;
    assert.equal(lines[0].pages, 7);
    assert.equal(lines[0].written, 7);
    assert.match((await state(book)).state, /^ready$/);
    assert.equal((await state(book)).pdf_pages, 7);
    assert.equal((await state(twin)).state, 'duplicate');
    assert.equal((await state(twin)).duplicate_of, book);
    const l = await state(locked);
    assert.deepEqual([l.state, l.state_reason], ['failed', "This file isn't a readable PDF."]);
    // Searchable, with the page's printed number (the first page is "i", so PDF page 5 is "4").
    const hit = await w.call('GET', `/v1/library/search?q=${encodeURIComponent('marmalade orchestra')}`, {token: device});
    assert.deepEqual(hit.body.items.map((h) => [h.book_id, h.pdf_page, h.page_label]), [[book, 5, '4']]);
    if (scanned) {
      assert.equal((await state(scanned)).state, 'ready');
      const s = await w.call('GET', '/v1/library/search?q=patience', {token: device});
      assert.deepEqual(s.body.items.map((h) => h.book_id), [scanned]);
      assert.ok(lines.some((x) => x.ocr === 1));
    }
  } finally {
    await w.stop();
    rmSync(dir, {recursive: true, force: true});
  }
});
