#!/usr/bin/env node
// Reading the owner's books for Study (STUDY.md §3.3), in the mind's own session (the night task,
// or a chat session when the owner asks "read my new book"); never in GitHub Actions. For each
// waiting book, at most 2 a run and 45 minutes a book:
//  1. claims it (an hour's lease, renewed by each call) and downloads its PDF through the Worker
//     into a temporary folder that is always removed;
//  2. reports the file's SHA-256 and page count (a file another book has is a duplicate: the
//     Worker says so, and the run moves on);
//  3. reads its pages with study_extract.py (text, printed page numbers, OCR where needed);
//  4. splits each page into blocks and posts pages in batches of 50 from where the last run
//     stopped; when the day's bulk rows are used up (429) the run pauses until tomorrow;
//  5. reports ready, or failed with a plain sentence for the owner.
// It prints counts and timings only: never page text, a title or a file name.
//
//   node mind/jobs/study-ingest.mjs [--books 2] [--minutes 45] [--python python3] [--no-ocr]
//
// Environment as `th` (mind/cli/lib/http.mjs): TH_API, and the session's network secret adds the
// key (TH_TOKEN only in local runs and tests). Exit: 0 done (or nothing waiting), 2 usage, 4 a call
// failed.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createWriteStream, mkdtempSync, readFileSync, realpathSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import {request, settings} from '../cli/lib/http.mjs';
import {VERSION} from '../cli/lib/io.mjs';
import {blocksOf} from './study-blocks.mjs';

const EXTRACT = fileURLToPath(new URL('./study_extract.py', import.meta.url));
const BATCH = 50;
const LABEL_CHARS = 24;
const say = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

export function parseArgs(argv) {
  const o = {books: 2, minutes: 45, python: process.env.PYTHON || 'python3', ocr: true};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--books') o.books = Number(argv[++i]);
    else if (a === '--minutes') o.minutes = Number(argv[++i]);
    else if (a === '--python') o.python = argv[++i];
    else if (a === '--no-ocr') o.ocr = false;
    else throw Object.assign(new Error(`unknown argument ${a}`), {exit: 2});
  }
  if (!(o.books >= 1 && o.minutes > 0)) throw Object.assign(new Error('--books and --minutes must be positive'), {exit: 2});
  return o;
}

/** The claimed book's PDF, streamed to `dest` through the Worker. */
async function download(jobId, dest) {
  const s = settings();
  const headers = {'TH-Client': `th/${VERSION}`};
  if (s.role) headers['TH-Role'] = s.role;
  if (s.session) headers['TH-Session'] = s.session;
  if (s.token) headers.Authorization = `Bearer ${s.token}`;
  const res = await fetch(`${s.api}/v1/library/ingest/${jobId}/file`, {headers});
  if (!res.ok) throw Object.assign(new Error(`file: HTTP ${res.status}`), {exit: 4});
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function extract(python, args) {
  const r = spawnSync(python, ['-I', EXTRACT, ...args], {encoding: 'utf8', maxBuffer: 1 << 20});
  let out = {};
  try {
    out = JSON.parse(r.stdout.trim().split('\n').at(-1) || '{}');
  } catch {}
  return {status: r.status, out};
}

const REASONS = {
  3: 'This PDF is password-protected. Remove the password and add it again.',
  4: "This file isn't a readable PDF.",
};

/** One page as the Worker takes it. Refs come with the scripture parser (P7 step 4). */
export function pageIn(line) {
  const text = String(line.text ?? '');
  return {
    pdf_page: line.pdf_page,
    page_label: line.page_label ? String(line.page_label).slice(0, LABEL_CHARS) : null,
    text,
    blocks: blocksOf(text),
    ocr: Boolean(line.ocr),
    ocr_conf: typeof line.ocr_conf === 'number' ? line.ocr_conf : null,
    refs: [],
  };
}

/** Reads one claimed book; returns its counts. */
async function readBook(claim, o, until) {
  const {job, book} = claim;
  const started = Date.now();
  const dir = mkdtempSync(join(tmpdir(), 'study-'));
  const counts = {pages: 0, written: 0, ocr: 0, ocr_missing: 0, refs: 0, state: ''};
  const report = async (body) => (await request('PATCH', `/v1/library/ingest/${job.id}`, {body})).data.book;
  try {
    const pdf = join(dir, 'book.pdf');
    await download(job.id, pdf);
    if (statSync(pdf).size !== book.bytes) throw Object.assign(new Error('the file is not the size the Worker gave'), {exit: 4});
    const sha = sha256(pdf);
    const count = extract(o.python, [pdf, '--count']);
    if (count.status === 3 || count.status === 4) {
      counts.state = (await report({state: 'failed', sha256: sha, reason: REASONS[count.status]})).state;
      return counts;
    }
    if (count.status !== 0) throw Object.assign(new Error(`the page reader failed (${count.out.error ?? count.status})`), {exit: 4});
    counts.pages = count.out.pages;
    const first = await report({state: 'extracting', sha256: sha, pdf_pages: counts.pages, cursor: job.cursor});
    if (first.state === 'duplicate') {
      counts.state = 'duplicate';
      return counts;
    }
    const lines = join(dir, 'pages.jsonl');
    const read = extract(o.python, [pdf, '--out', lines, '--from', String(job.cursor), '--lang', book.language || 'eng', ...(o.ocr ? [] : ['--no-ocr'])]);
    if (read.status !== 0) {
      counts.state = (await report({state: 'failed', reason: REASONS[read.status] ?? "This file isn't a readable PDF."})).state;
      return counts;
    }
    counts.ocr = read.out.ocr ?? 0;
    counts.ocr_missing = read.out.ocr_missing ?? 0;
    await report({state: counts.ocr ? 'ocr' : 'indexing', cursor: job.cursor});
    const pages = readFileSync(lines, 'utf8').split('\n').filter(Boolean).map((l) => pageIn(JSON.parse(l)));
    let cursor = job.cursor;
    for (let i = 0; i < pages.length; i += BATCH) {
      if (Date.now() > until) {
        counts.state = (await report({state: 'paused', cursor})).state + ' (time)';
        return counts;
      }
      const batch = pages.slice(i, i + BATCH);
      try {
        const r = await request('PUT', `/v1/library/books/${book.id}/pages`, {body: {job_id: job.id, pages: batch}});
        counts.written += r.data.written;
        counts.refs += r.data.refs;
      } catch (e) {
        if (e.code !== 'rate_limited') throw e;
        counts.state = (await report({state: 'paused', cursor})).state + ' (the day’s rows are used)';
        counts.lane = true;
        return counts;
      }
      cursor = batch.at(-1).pdf_page;
      if (i + BATCH < pages.length) await report({state: 'indexing', cursor});
    }
    counts.state = (await report({state: 'ready', cursor, sha256: sha, pdf_pages: counts.pages})).state;
    return counts;
  } finally {
    rmSync(dir, {recursive: true, force: true});
    counts.seconds = Math.round((Date.now() - started) / 1000);
  }
}

export async function main(argv) {
  const o = parseArgs(argv);
  // Without the page reader nothing is claimed: a claim that can't be read would lapse and count.
  if (spawnSync(o.python, ['-c', 'import pypdf'], {stdio: 'ignore'}).status !== 0) {
    say({done: true, books: 0, skipped: 'pypdf is not installed here (bash mind/jobs/study-setup.sh)'});
    return 0;
  }
  let n = 0;
  for (; n < o.books; n++) {
    const r = await request('POST', '/v1/library/ingest/claim', {body: {}});
    if (r.status === 204 || !r.data?.job) break;
    const counts = await readBook(r.data, o, Date.now() + o.minutes * 60_000);
    say({book: n + 1, ...counts});
    if (counts.lane) break;
  }
  say({done: true, books: n});
  return 0;
}

const isMain = () => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};
if (process.argv[1] && isMain())
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (e) => {
      process.stderr.write(`study-ingest: ${e.code ?? e.message}\n`);
      process.exitCode = e.exit ?? 4;
    },
  );
