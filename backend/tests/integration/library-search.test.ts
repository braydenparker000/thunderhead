// Study's search by word forms (STUDY.md §6, schema step 4): the stemmed index finds other forms of
// a word with accents ignored; when no page has every word, pages with some of them come back,
// marked `any`, and the cursor goes on past 50 hits the same way. Pages stored before the step are
// entered by the daily pass's backfill, a chunk at a time and none while the rows guard holds; until
// the last of them is in, search reads the exact index, and a page rewritten meanwhile is entered once.
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { LibrarySearchResponse, PageIn } from '../../../shared/contract/library.ts';
import { putPage } from '../../src/areas/library/store';
import { uuidv7 } from '../../src/lib/ids';
import type { Db } from '../../src/objects/base';
import type { Library } from '../../src/objects/library';
import { apiJson } from '../helpers';
import { type Principals, principals } from '../memory-helpers';

let p: Principals;
const lib = () => env.LIBRARY.get(env.LIBRARY.idFromName('owner')) as unknown as DurableObjectStub<Library>;
const BOOK = uuidv7();
const search = async (q: string, cursor = '') =>
  (
    await apiJson<LibrarySearchResponse>(
      'GET',
      `/v1/library/search?q=${encodeURIComponent(q)}&limit=50${cursor ? `&cursor=${cursor}` : ''}`,
      { token: p.D },
    )
  ).body;
const page = (n: number, text: string): PageIn => ({
  pdf_page: n,
  page_label: null,
  text,
  blocks: [[0, text.length]],
  ocr: false,
  ocr_conf: null,
  refs: [],
});
const inDb = <T>(fn: (db: Db, sql: SqlStorage) => T) =>
  runInDurableObject(lib(), (o, s) => fn((o as unknown as { db: Db }).db, s.storage.sql));

beforeAll(async () => {
  p = await principals();
  await inDb((db) => {
    db.run(
      `INSERT INTO books (id, title, kind, language, bytes, r2_key, state, added_at, updated_at)
       VALUES (?, 'Sermones', 'book', 'spa', 10, 'books/x.pdf', 'ready', 1, 1)`,
      BOOK,
    );
    putPage(db, BOOK, page(1, 'Las oraciones de la mañana y los cantos.'));
    putPage(db, BOOK, page(2, 'He prayed for an hour, and his prayers were answered.'));
    for (let n = 3; n <= 62; n++) putPage(db, BOOK, page(n, `A garden page ${n}, with olives.`));
  });
});

describe('search by word forms', () => {
  it('finds other forms of a word, accents ignored', async () => {
    expect((await search('praying')).items.map((h) => h.pdf_page)).toEqual([2]);
    const es = await search('oracion manana');
    expect(es.items.map((h) => h.pdf_page)).toEqual([1]);
    expect(es.items[0].snippet).toContain('<mark>oraciones</mark>');
    expect(es.any).toBeUndefined();
  });

  it('falls back to any word when no page has them all, and says so', async () => {
    const r = await search('prayers olivetrees cantos');
    expect(r.any).toBe(true);
    expect(r.items.map((h) => h.pdf_page).sort()).toEqual([1, 2]);
    expect((await search('nothing-like-this')).items).toEqual([]);
  });

  it('goes on past 50 hits through the cursor', async () => {
    const first = await search('garden');
    expect([first.items.length, first.next]).toEqual([50, 'o50']);
    const rest = await search('garden', first.next as string);
    expect([rest.items.length, rest.next]).toEqual([10, null]);
    const either = await search('garden unknownword');
    expect([either.any, either.next]).toEqual([true, 'r50']);
    expect((await search('garden unknownword', 'r50')).items).toHaveLength(10);
  });
});

describe('the backfill of pages stored before the step', () => {
  it('enters them a chunk at a time, never while the rows guard holds; search waits for the last', async () => {
    // As if every page had been stored before step 4: none in the stemmed index yet.
    await inDb((db, sql) => {
      sql.exec("INSERT INTO pages_stem (pages_stem) VALUES ('delete-all')");
      db.run('UPDATE stem_fill SET after = 0, until = (SELECT max(seq) FROM pages)');
    });
    // Until then, the exact index: no word forms.
    expect((await search('praying')).items).toEqual([]);
    expect((await search('prayers')).items.map((h) => h.pdf_page)).toEqual([2]);
    // A page rewritten before the backfill reaches it is entered once, by the backfill.
    await inDb((db) => putPage(db, BOOK, page(1, 'Las oraciones nuevas.')));
    expect((await lib().daily(Date.now(), true)).stemmed).toBe(0);
    let n = 0;
    for (let i = 0; i < 3 && (await search('praying')).items.length === 0; i++) n += (await lib().daily()).stemmed;
    expect(n).toBe(62);
    expect((await search('praying')).items.map((h) => h.pdf_page)).toEqual([2]);
    expect((await search('oracion')).items.map((h) => h.snippet)).toEqual(['Las <mark>oraciones</mark> nuevas.']);
    expect(
      await inDb(
        (_db, sql) => sql.exec("SELECT count(*) AS n FROM pages_stem WHERE pages_stem MATCH 'nuevas'").one().n,
      ),
    ).toBe(1);
    // Pages written after it are entered at once.
    await inDb((db) => putPage(db, BOOK, page(63, 'They pray again.')));
    expect((await search('prayed')).items.map((h) => h.pdf_page).sort()).toEqual([2, 63]);
    expect((await lib().daily()).stemmed).toBe(0);
  });
});
