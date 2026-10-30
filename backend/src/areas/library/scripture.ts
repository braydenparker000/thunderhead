// The scripture book table and verse text (STUDY.md §7.1, §7.6; owner rulings 2026-10-27 and
// 2026-10-28): the owner's own, kept only in the private bucket, never in the repo, a log or
// Actions. The mind builds them in its session from the owner's licensed copies and stores them
// here (C N); the phone reads them after sign-in and keeps them for offline use (D). The same
// parser as the phone's checks the table, and every verse ref the Worker stores is checked
// against it: no table yet, no refs.
import { Hono } from 'hono';
import {
  checkTable,
  type Index,
  makeIndex,
  type ScriptureTable,
  splitRef,
  validRef,
} from '../../../../frontend/apps/study/scripture/parse.js';
import {
  LIBRARY_LIMITS as L,
  type ScriptureTextRequest,
  type VerseResponse,
  type VerseTextResponse,
} from '../../../../shared/contract/library.ts';
import { type AppEnv, guard } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { libraryObject } from '../../objects/library';
import { fresh } from '../../objects/rpc';

export const TABLE_KEY = 'study/scripture.json';
const textKey = (code: string) => `study/text/${code}.json`;
const HOLD_MS = 10 * 60_000;
const CODE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** This isolate's parsed table, checked against the bucket's ETag every 10 minutes. */
let held: { etag: string; index: Index; until: number } | null = null;

/** The table made ready for parsing, or null before the mind has stored one. */
export async function scriptureIndex(env: Env): Promise<Index | null> {
  if (held && held.until > Date.now()) return held.index;
  const head = await env.VAULT.head(TABLE_KEY);
  if (!head) {
    held = null;
    return null;
  }
  if (held?.etag === head.etag) {
    held.until = Date.now() + HOLD_MS;
    return held.index;
  }
  const obj = await env.VAULT.get(TABLE_KEY);
  if (!obj) return null;
  const index = makeIndex((await obj.json()) as ScriptureTable);
  held = { etag: obj.etag, index, until: Date.now() + HOLD_MS };
  return index;
}

/** A ref the Worker is asked to store: valid against the owner's table, else a 422 naming `path`. */
export async function checkRefs(env: Env, refs: { path: string; ref: string }[]): Promise<void> {
  if (!refs.length) return;
  const ix = await scriptureIndex(env);
  const bad = refs.filter((r) => !ix || !validRef(r.ref, ix));
  if (bad.length)
    throw new ApiError(
      'validation',
      bad
        .slice(0, 20)
        .map((r) => ({ path: r.path, issue: ix ? 'not a verse in the table' : 'no scripture table yet' })),
    );
}

async function bodyOf(c: { req: { text(): Promise<string> } }, max: number): Promise<unknown> {
  const text = await c.req.text();
  if (text.length > max) throw new ApiError('too_large');
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('bad_request');
  }
}

export const scriptureRoutes = new Hono<AppEnv>()
  .get('/library/scripture', guard('GET /v1/library/scripture'), async (c) => {
    const head = await c.env.VAULT.head(TABLE_KEY);
    if (!head) throw new ApiError('not_found');
    const etag = `"${head.etag}"`;
    c.header('ETag', etag);
    if (c.req.header('If-None-Match') === etag) return c.body(null, 304);
    const obj = await c.env.VAULT.get(TABLE_KEY);
    if (!obj) throw new ApiError('not_found');
    return c.body(await obj.text(), 200, { 'Content-Type': 'application/json; charset=utf-8' });
  })
  .put('/library/scripture', guard('PUT /v1/library/scripture'), async (c) => {
    const table = (await bodyOf(c, L.table_bytes)) as ScriptureTable;
    const problems = checkTable(table);
    if (problems.length)
      throw new ApiError(
        'validation',
        problems.slice(0, 20).map((issue) => ({ path: 'table', issue })),
      );
    await c.env.VAULT.put(TABLE_KEY, JSON.stringify(table), { httpMetadata: { contentType: 'application/json' } });
    held = null;
    return c.json({ books: table.books.length, totals: table.totals ?? {} });
  })
  .get('/library/scripture/text/:code/:chapter', guard('GET /v1/library/scripture/text/:code/:chapter'), async (c) => {
    const code = c.req.param('code');
    const chapter = Number(c.req.param('chapter'));
    if (!CODE.test(code) || !Number.isInteger(chapter) || chapter < 1) throw new ApiError('not_found');
    const obj = await c.env.VAULT.get(textKey(code));
    if (!obj) throw new ApiError('not_found');
    const text = (await obj.json()) as ScriptureTextRequest;
    const verses = text.chapters[String(chapter)];
    if (!verses) throw new ApiError('not_found');
    return c.json({ code, chapter, verses } satisfies VerseTextResponse);
  })
  .put('/library/scripture/text/:code', guard('PUT /v1/library/scripture/text/:code'), async (c) => {
    const code = c.req.param('code');
    const ix = await scriptureIndex(c.env);
    const book = ix?.byCode.get(code);
    if (!book)
      throw new ApiError('validation', [
        { path: 'code', issue: ix ? 'not a book in the table' : 'no scripture table yet' },
      ]);
    const body = (await bodyOf(c, L.text_bytes)) as ScriptureTextRequest;
    const issues: { path: string; issue: string }[] = [];
    for (const [ch, verses] of Object.entries(body?.chapters ?? {})) {
      const n = Number(ch);
      if (!Number.isInteger(n) || n < 1 || n > book.chapters)
        issues.push({ path: `chapters.${ch}`, issue: 'a chapter of the book' });
      else
        for (const [v, t] of Object.entries(verses ?? {}))
          if (!(Number(v) >= 1 && Number(v) <= book.verses[n - 1]) || typeof t !== 'string' || t.length > L.verse_chars)
            issues.push({ path: `chapters.${ch}.${v}`, issue: 'a verse of the chapter, as text' });
    }
    if (!body?.chapters || issues.length) throw new ApiError('validation', issues.slice(0, 20));
    await c.env.VAULT.put(textKey(code), JSON.stringify({ chapters: body.chapters }), {
      httpMetadata: { contentType: 'application/json' },
    });
    return c.json({ code, chapters: Object.keys(body.chapters).length });
  })
  .get('/library/verses/:code/:chapter', guard('GET /v1/library/verses/:code/:chapter'), async (c) => {
    const ix = await scriptureIndex(c.env);
    const v = /^(\d{1,4})(?:-(\d{1,4}))?$/.exec(c.req.query('v') ?? '');
    const ref = `verse:${c.req.param('code')}/${c.req.param('chapter')}${v ? `/${v[1]}${v[2] ? `-${v[2]}` : ''}` : ''}`;
    if (!ix || !validRef(ref, ix)) throw new ApiError('not_found');
    const p = splitRef(ref) as NonNullable<ReturnType<typeof splitRef>>;
    const limit = c.req.query('all') === '1' ? L.cited_all : L.cited;
    const r = (await fresh(
      libraryObject(c.env).cited(p.code, p.chapter, p.v_start, p.v_end, limit),
    )) as unknown as Omit<VerseResponse, 'ref'>;
    return c.json({ ref, ...r } satisfies VerseResponse);
  });
