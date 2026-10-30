#!/usr/bin/env node
// Storing the owner's scripture book table and verse text in the private bucket (STUDY.md §7.1,
// §7.6; SETUP.md O2), from files the mind built in its own session from the owner's licensed
// copies. Neither is ever in the repository (owner rulings 2026-10-27 and 2026-10-28): files inside
// this checkout are refused, so one can't be committed by mistake. The table is checked here by the
// same parser the Worker checks it with; each book's text is `<code>.json`, `{chapters: {"3": {"12":
// "…"}}}`, checked by the Worker against the table. It prints counts only: never a book's name,
// a verse or a link.
//
//   node mind/jobs/scripture-import.mjs --table <file> [--text <folder>]
//
// Environment as `th` (mind/cli/lib/http.mjs). Exit: 0 stored, 2 usage or a file problem, 4 a call failed.
import {readFileSync, readdirSync, realpathSync} from 'node:fs';
import {join, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkTable} from '../../frontend/apps/study/scripture/parse.js';
import {request} from '../cli/lib/http.mjs';

const REPO = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const say = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const usage = (m) => Object.assign(new Error(m), {exit: 2});

export function parseArgs(argv) {
  const o = {table: '', text: ''};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--table') o.table = argv[++i] ?? '';
    else if (a === '--text') o.text = argv[++i] ?? '';
    else throw usage(`unknown argument ${a}`);
  }
  if (!o.table) throw usage('--table <file> is required');
  return o;
}

/** A path outside this checkout, else a refusal (the owner's copies never sit in the repo). */
export function outside(path, repo = REPO) {
  const real = realpathSync(path);
  if (real === repo || real.startsWith(repo.endsWith(sep) ? repo : repo + sep))
    throw usage('the scripture files must be outside the repository');
  return real;
}

const json = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw usage('a scripture file is not JSON');
  }
};

export async function main(argv) {
  const o = parseArgs(argv);
  const table = json(outside(o.table));
  const problems = checkTable(table);
  if (problems.length) {
    // The problems name books; only their count is printed.
    say({stored: false, table_problems: problems.length});
    return 2;
  }
  const t = await request('PUT', '/v1/library/scripture', {body: table});
  say({table: true, books: t.data.books});
  let books = 0;
  let verses = 0;
  if (o.text) {
    const dir = outside(o.text);
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const code = name.slice(0, -'.json'.length);
      if (!table.books.some((b) => b.code === code)) throw usage('a text file is named for no book in the table');
      const text = json(join(dir, name));
      await request('PUT', `/v1/library/scripture/text/${code}`, {body: text});
      books++;
      for (const ch of Object.values(text.chapters ?? {})) verses += Object.keys(ch ?? {}).length;
    }
  }
  say({done: true, text_books: books, verses});
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
      process.stderr.write(`scripture-import: ${e.exit === 2 ? e.message : (e.code ?? e.message)}\n`);
      process.exitCode = e.exit ?? 4;
    },
  );
