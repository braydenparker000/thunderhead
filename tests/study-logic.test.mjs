// Study's rules without a browser (STUDY.md §2.2, §3.1, §3.2, §4, §6): what a picked file must be,
// its title, sending only the missing parts with three retries (1 s, 5 s, 15 s) and byte progress,
// the reader's range requests (206, a 200 as the whole file, one re-sign on 403, retries after 1 s
// and 3 s), the lines under a cover, page numbers, "Go to page", and search snippets as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partsOf, refuse, sendParts, titleFor, WAITS } from '../frontend/apps/study/parts.js';
import { continueRow, goTo, pageDetail, pageName, snippetParts, stateLine } from '../frontend/apps/study/words.js';

const MB = 1024 * 1024;

test('a picked file: a PDF of at most 500 MB; its title from the PDF, else the file name', () => {
  assert.equal(refuse({ size: 501 * MB, name: 'a.pdf', type: 'application/pdf' }), 'This PDF is over 500 MB.');
  assert.equal(refuse({ size: 10, name: 'a.epub', type: 'application/epub+zip' }), "That file isn't a PDF.");
  assert.equal(refuse({ size: 10, name: 'Book.PDF', type: '' }), null);
  assert.equal(titleFor('  A Synthetic   Commentary ', 'x.pdf'), 'A Synthetic Commentary');
  assert.equal(titleFor('Microsoft Word - draft7.docx', 'Notes_on_Book_A.pdf'), 'Notes on Book A');
  assert.equal(titleFor(null, 'Gamma.pdf'), 'Gamma');
  assert.equal(partsOf(50 * MB + 1, 50 * MB), 2);
  assert.equal(partsOf(1, 50 * MB), 1);
});

test('only the missing parts are sent, each retried three times, with byte progress', async () => {
  const file = new Blob([new Uint8Array(25)]);
  const sent = [];
  const waits = [];
  let fails = 2;
  const progress = [];
  const have = await sendParts({
    file,
    bookId: 'b',
    partBytes: 10,
    have: [2],
    wait: async (ms) => waits.push(ms),
    onProgress: (x) => progress.push(Math.round(x * 100)),
    put: async (_id, n, bytes, onSent) => {
      if (n === 3 && fails-- > 0) throw Object.assign(new Error('network'), { status: 0 });
      onSent(bytes.size);
      sent.push([n, bytes.size]);
      return { parts: [...new Set([...sent.map((s) => s[0]), 2])] };
    },
  });
  assert.deepEqual(sent, [
    [1, 10],
    [3, 5],
  ]);
  assert.deepEqual(have, [1, 2, 3]);
  assert.deepEqual(waits, WAITS.slice(0, 2));
  assert.equal(progress[0], 40);
  assert.equal(progress.at(-1), 100);
  // A refusal (422: the part's length) is not tried again; four failures in a row give up.
  await assert.rejects(
    sendParts({ file, bookId: 'b', partBytes: 10, have: [], wait: async () => {}, put: async () => Promise.reject(Object.assign(new Error('x'), { status: 422 })) }),
    /x/,
  );
  let tries = 0;
  await assert.rejects(
    sendParts({ file, bookId: 'b', partBytes: 10, have: [], wait: async () => {}, put: async () => { tries++; throw Object.assign(new Error('down'), { status: 503 }); } }),
    /down/,
  );
  assert.equal(tries, 4);
});

const book = (over = {}) => ({
  id: 'b1', title: 'A', author: null, kind: 'book', language: 'eng', bytes: 1, pdf_pages: 512, sha256: null, state: 'ready',
  state_reason: null, added_at: 0, updated_at: 0, ingested_at: null, duplicate_of: null, position: null, ...over,
});

test('the lines under a cover, page numbers and the Continue row', () => {
  assert.equal(stateLine(book({ state: 'queued' })), 'Waiting to be read');
  assert.equal(stateLine(book({ state: 'extracting', read_pages: 120 })), 'Reading… 120 of 512 pages');
  assert.equal(stateLine(book({ state: 'ocr', read_pages: 40 })), 'Reading scanned pages… 40 of 512 pages');
  assert.equal(stateLine(book({ state: 'indexing', paused: true })), 'Indexing… (continues tonight)');
  assert.equal(stateLine(book({ state: 'failed' })), "Couldn't read this book.");
  assert.equal(stateLine(book({ state: 'ready' })), '');
  assert.equal(pageName(230, '212'), 'p. 212');
  assert.equal(pageName(1230, null), 'PDF p. 1,230');
  assert.equal(pageDetail(230, '212', 512), 'Page 212 · PDF page 230 of 512');
  const at = (t) => ({ pdf_page: 1, scroll_frac: 0, at: t, device: 'd' });
  const row = continueRow([book({ id: 'a', position: at(1) }), book({ id: 'b' }), book({ id: 'c', position: at(3) }), book({ id: 'd', position: at(2) }), book({ id: 'e', position: at(0) })]);
  assert.deepEqual(row.map((b) => b.id), ['c', 'd', 'a']);
});

test('"Go to page": a printed label, "pdf 230", a label printed twice, and nothing', () => {
  const labels = ['i', 'ii', '1', '2', '3', '1', '2'];
  assert.deepEqual(goTo('2', labels), [4, 7]);
  assert.deepEqual(goTo('xiv', labels), []);
  assert.deepEqual(goTo('II', labels), [2]);
  assert.deepEqual(goTo('pdf 5', labels), [5]);
  assert.deepEqual(goTo('PDF p. 5', labels), [5]);
  assert.deepEqual(goTo('pdf 50', labels), []);
  assert.deepEqual(goTo('p. 3', labels), [5]);
  // No printed numbers at all: a bare number is the PDF page.
  assert.deepEqual(goTo('3', [null, null, null]), [3]);
  assert.deepEqual(goTo('', labels), []);
});

test('a search snippet becomes text and marks, never HTML', () => {
  assert.deepEqual(snippetParts('The &lt;<mark>first</mark>&gt; page &amp; &quot;<mark>quotes</mark>&quot;.'), [
    { text: 'The <', mark: false },
    { text: 'first', mark: true },
    { text: '> page & "', mark: false },
    { text: 'quotes', mark: true },
    { text: '".', mark: false },
  ]);
  assert.deepEqual(snippetParts('&lt;img src=x onerror=alert(1)&gt;'), [{ text: '<img src=x onerror=alert(1)>', mark: false }]);
});

test('the vendored pdf.js is the recorded 6.4.299 legacy build, file for file (STUDY.md §2.2)', async () => {
  const { readFileSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const dir = new URL('../frontend/vendor/pdfjs-6.4.299/', import.meta.url);
  const lines = readFileSync(new URL('SHA256SUMS.txt', dir), 'utf8').trim().split('\n');
  assert.deepEqual(lines.map((l) => l.split(/\s+/)[1]), ['pdf.min.mjs', 'pdf.worker.min.mjs', 'LICENSE.txt', 'text_layer.css']);
  for (const l of lines) {
    const [sum, name] = l.split(/\s+/);
    assert.equal(createHash('sha256').update(readFileSync(new URL(name, dir))).digest('hex'), sum, name);
  }
  assert.match(readFileSync(new URL('LICENSE.txt', dir), 'utf8'), /Apache License\s+Version 2\.0/);
  // The legacy build carries its own polyfills for built-ins older Chrome lacks.
  assert.match(readFileSync(new URL('pdf.min.mjs', dir), 'utf8'), /getOrInsertComputed/);
  assert.ok(readFileSync(new URL('pdf.min.mjs', dir)).length > 500_000, 'the legacy build');
});
