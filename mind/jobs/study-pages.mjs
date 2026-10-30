#!/usr/bin/env node
// A book's stored page text, saved for the mind's own session (SETUP.md O2: building the owner's
// verse text from their licensed scripture copies once Study has read them). One JSON line a page,
// `{pdf_page, page_label, text}`, written to a file outside this checkout (inside it is refused,
// so a book can't be committed by mistake). It prints counts only, never text or a title.
//
//   node mind/jobs/study-pages.mjs --book <book_id> --out <file>
//
// Environment as `th` (mind/cli/lib/http.mjs). Exit: 0 saved, 2 usage, 4 a call failed.
import {closeSync, openSync, realpathSync, writeSync} from 'node:fs';
import {basename, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {request} from '../cli/lib/http.mjs';
import {outside} from './scripture-import.mjs';

const say = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function parseArgs(argv) {
  const o = {book: '', out: ''};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book') o.book = argv[++i] ?? '';
    else if (a === '--out') o.out = argv[++i] ?? '';
    else throw Object.assign(new Error(`unknown argument ${a}`), {exit: 2});
  }
  if (!ID.test(o.book) || !o.out) throw Object.assign(new Error('--book <book_id> and --out <file> are required'), {exit: 2});
  return o;
}

export async function main(argv) {
  const o = parseArgs(argv);
  const out = join(outside(dirname(o.out)), basename(o.out));
  const fd = openSync(out, 'w', 0o600);
  let pages = 0;
  let chars = 0;
  try {
    for (let from = 1; from !== null; ) {
      const r = await request('GET', `/v1/library/books/${o.book}/pages`, {query: {from, limit: 50}});
      for (const p of r.data.items) {
        writeSync(fd, `${JSON.stringify(p)}\n`);
        pages++;
        chars += p.text.length;
      }
      from = r.data.next;
    }
  } finally {
    closeSync(fd);
  }
  say({done: true, pages, chars});
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
      process.stderr.write(`study-pages: ${e.exit === 2 ? e.message : (e.code ?? e.message)}\n`);
      process.exitCode = e.exit ?? 4;
    },
  );
