// Chat files (API.md §11.7, SECURITY.md §9): PUT /v1/files/:id stores the raw bytes in the private
// bucket under chat/files/<YYYY>/<MM>/<id>.<ext>, then the row; the same id with the same bytes is
// the same file (200), with other bytes a conflict (409); over 25 MiB is 413; a wrong digest, a bad
// name or a memo length off audio is 422; a form body is 415; without the bucket 503. GET serves
// the bytes only through the Worker: its type and length, an ETag from the SHA-256 (304 on a
// match), nosniff, a sandboxing CSP, inline or attachment with the exact name; night may read,
// Muse may not. Synthetic bytes only.
import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Attachment, ErrorBody } from '../../../shared/contract/api';
import { FILE_LIMITS } from '../../../shared/contract/files.ts';
import { uuidv7 } from '../../src/lib/ids';
import { download, fileRequest, shaOf, upload, uploaded } from '../files-helpers';
import { api, core, coreSql, makeAgent, rowsDuring, SITE, setupOwner } from '../helpers';

let D = '';
let C = '';
let N = '';
let M = '';
const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode('synthetic jpeg bytes')]);
const keyOf = async (id: string) =>
  (await coreSql<{ key: string }>('SELECT key FROM files WHERE id = ?', id))[0]?.key ?? null;
const code = async (res: Response) => ((await res.json()) as ErrorBody).error.code;

beforeAll(async () => {
  D = (await setupOwner()).token;
  C = await makeAgent(D, 'mind:chat');
  N = await makeAgent(D, 'mind:night');
  M = await makeAgent(D, 'muse');
});

describe('PUT /v1/files/:id', () => {
  it('stores the bytes, then the row, and answers the attachment (201)', async () => {
    const r = await upload({ token: D, bytes: photo, name: 'Beach day ☀.jpg' });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ ref: `file:${r.id}`, name: 'Beach day ☀.jpg', type: 'image/jpeg', bytes: photo.length });
    const d = new Date(Number.parseInt(r.id.slice(0, 8) + r.id.slice(9, 13), 16));
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const key = `chat/files/${d.getUTCFullYear()}/${month}/${r.id}.jpg`;
    expect(await keyOf(r.id)).toBe(key);
    const obj = await env.VAULT.get(key);
    expect(new Uint8Array(await (obj as R2ObjectBody).arrayBuffer())).toEqual(photo);
    expect(obj?.httpMetadata?.contentType).toBe('image/jpeg');
    const [row] = await coreSql('SELECT uploaded_by, message_id, sha256, seconds, text FROM files WHERE id = ?', r.id);
    expect(row).toEqual({
      uploaded_by: 'owner',
      message_id: null,
      sha256: await shaOf(photo),
      seconds: null,
      text: null,
    });
  });

  it('the same id with the same bytes is a retry (200, the same file); other bytes are a conflict', async () => {
    const first = await upload({ token: D, bytes: photo });
    const again = await upload({ token: D, bytes: photo, id: first.id, name: 'another name.jpg' });
    expect([again.status, again.body]).toEqual([200, first.body]);
    const other = await upload({ token: D, bytes: new Uint8Array([1, 2, 3]), id: first.id });
    expect([other.status, other.body.error.code]).toEqual([409, 'conflict']);
    expect((await coreSql('SELECT id FROM files WHERE id = ?', first.id)).length).toBe(1);
  });

  it('refuses more than 25 MiB with 413, an empty body and a wrong digest with 422, storing nothing', async () => {
    const big = new Uint8Array(FILE_LIMITS.bytes + 1);
    const over = await upload({ token: D, bytes: big, sha: '0'.repeat(64) });
    expect([over.status, over.body.error.code]).toEqual([413, 'too_large']);
    const empty = await upload({ token: D, bytes: new Uint8Array(0) });
    expect([empty.status, empty.body.error.details]).toEqual([422, [{ path: 'body', issue: 'the file is empty' }]]);
    const wrong = await upload({ token: D, bytes: photo, sha: 'a'.repeat(64) });
    expect([wrong.status, wrong.body.error.details]).toEqual([
      422,
      [{ path: 'TH-Sha256', issue: 'does not match the body' }],
    ]);
    expect((await upload({ token: D, bytes: photo, sha: 'xyz' })).status).toBe(422);
    for (const r of [over, empty, wrong]) expect(await keyOf(r.id)).toBeNull();
    expect((await env.VAULT.list({ prefix: 'chat/files/' })).objects.some((o) => o.key.includes(wrong.id))).toBe(false);
  });

  it('decodes the name and makes it safe; refuses one undecodable, empty or over 120 characters', async () => {
    const safe = await upload({ token: D, bytes: photo, raw: '%2E%2E%2Fsecret%2Fplan%0A%E2%80%AE.txt' });
    expect([safe.status, safe.body.name]).toEqual([201, '_secret_plan.txt']);
    const spaced = await upload({ token: D, bytes: photo, raw: '%20.hidden%20notes.md' });
    expect(spaced.body.name).toBe('hidden notes.md');
    for (const raw of ['%E0%A4%A', '...', '%00%01', encodeURIComponent('a'.repeat(121))]) {
      const r = await upload({ token: D, bytes: photo, raw });
      expect([r.status, r.body.error.details?.[0]?.path], raw).toEqual([422, 'TH-File-Name']);
    }
    expect((await upload({ token: D, bytes: photo, name: null })).status).toBe(422);
    const longest = await upload({ token: D, bytes: photo, name: `${'é'.repeat(116)}.jpg` });
    expect(longest.status).toBe(201);
  });

  it('stores the type without parameters (octet-stream by default) and refuses a form body (415)', async () => {
    const memo = await upload({ token: D, bytes: photo, type: 'Audio/WebM; codecs=opus', name: 'memo.webm' });
    expect([memo.status, memo.body.type]).toEqual([201, 'audio/webm']);
    expect(await keyOf(memo.id)).toMatch(/\.webm$/);
    const plain = await upload({ token: D, bytes: photo, type: null, name: 'data' });
    expect(plain.body.type).toBe('application/octet-stream');
    expect(await keyOf(plain.id)).toMatch(/\.bin$/);
    const odd = await upload({ token: D, bytes: photo, type: 'not a type', name: 'x.doc' });
    expect(odd.body.type).toBe('application/octet-stream');
    const form = await upload({ token: D, bytes: photo, type: 'multipart/form-data; boundary=x' });
    expect([form.status, form.body.error.code]).toEqual([415, 'unsupported_media_type']);
  });

  it('takes TH-Seconds on audio only, more than 0 and at most 600', async () => {
    const ok = await upload({ token: D, bytes: photo, type: 'audio/webm', name: 'memo.webm', seconds: '42.5' });
    expect([ok.status, ok.body.seconds, ok.body.text]).toEqual([201, 42.5, undefined]);
    for (const [type, seconds] of [
      ['image/jpeg', '3'],
      ['audio/webm', '0'],
      ['audio/webm', '601'],
      ['audio/webm', 'ten'],
      ['audio/webm', '-1'],
    ]) {
      const r = await upload({ token: D, bytes: photo, type, seconds });
      expect([r.status, r.body.error.details?.[0]?.path], `${type} ${seconds}`).toEqual([422, 'TH-Seconds']);
    }
  });

  it('the chat mind uploads as the mind; night, Muse and no token are refused', async () => {
    const r = await upload({ token: C, bytes: photo, name: 'chart.png', type: 'image/png' });
    expect(r.status).toBe(201);
    expect((await coreSql('SELECT uploaded_by FROM files WHERE id = ?', r.id))[0]).toEqual({ uploaded_by: 'mind' });
    expect((await upload({ token: N, bytes: photo })).status).toBe(403);
    expect((await upload({ token: M, bytes: photo })).status).toBe(403);
    expect((await api('PUT', `/v1/files/${uuidv7()}`, { headers: { 'Content-Type': 'image/jpeg' } })).status).toBe(401);
  });

  it('refuses a bad id (422) and the eval sandbox (422: the bucket is the owner’s)', async () => {
    const bad = await fileRequest({ token: D, bytes: photo, id: 'not-an-id' });
    expect((await exports.default.fetch(bad.request)).status).toBe(422);
    const r = await upload({ token: C, bytes: photo, headers: { 'TH-Sandbox': 'eval' } });
    expect([r.status, r.body.error.details?.[0]?.path]).toEqual([422, 'TH-Sandbox']);
    expect(await keyOf(r.id)).toBeNull();
  });
});

describe('GET /v1/files/:id', () => {
  let id = '';
  beforeAll(async () => {
    id = (await uploaded({ token: D, bytes: photo, name: 'Ünïcode "quoted" (1).jpg' })).slice(5);
  });

  it('streams the bytes with their type, length, ETag, nosniff, a sandboxing CSP and the exact name', async () => {
    const res = await download(D, id);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(photo);
    const h = Object.fromEntries(res.headers);
    expect(h['content-type']).toBe('image/jpeg');
    expect(h['content-length']).toBe(String(photo.length));
    expect(h.etag).toBe(`"${await shaOf(photo)}"`);
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['content-security-policy']).toBe("sandbox; default-src 'none'");
    expect(h['content-disposition']).toBe(
      `inline; filename="_n_code _quoted_ (1).jpg"; filename*=UTF-8''%C3%9Cn%C3%AFcode%20%22quoted%22%20%281%29.jpg`,
    );
  });

  it('answers 304 to a matching If-None-Match, and the bytes to any other', async () => {
    const etag = `"${await shaOf(photo)}"`;
    for (const tag of [etag, `W/${etag}`, `"x", ${etag}`, '*']) {
      const res = await download(D, id, { 'If-None-Match': tag });
      expect([res.status, res.headers.get('ETag')], tag).toEqual([304, etag]);
      expect(await res.text()).toBe('');
    }
    expect((await download(D, id, { 'If-None-Match': '"other"' })).status).toBe(200);
  });

  it('a file not shown in place is an attachment; ?meta=1 answers the record', async () => {
    const other = await uploaded({ token: C, bytes: photo, type: 'text/html', name: 'page.html' });
    const res = await download(N, other.slice(5));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="page.html"/);
    const meta = await download(C, `${id}?meta=1`);
    expect((await meta.json()) as Attachment).toEqual({
      ref: `file:${id}`,
      name: 'Ünïcode "quoted" (1).jpg',
      type: 'image/jpeg',
      bytes: photo.length,
    });
  });

  it('404 for an unknown or malformed id; night may read, Muse may not', async () => {
    expect((await download(D, uuidv7())).status).toBe(404);
    expect((await download(D, 'nope')).status).toBe(404);
    expect((await download(N, id)).status).toBe(200);
    expect((await download(M, id)).status).toBe(403);
  });

  it('the site reads it from its own origin: CORS exposes the ETag (type and length are safelisted)', async () => {
    const res = await download(D, id, { Origin: SITE });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('ETag');
    const pre = await api('OPTIONS', `/v1/files/${id}`, {
      headers: {
        Origin: SITE,
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'authorization,content-type,th-client,th-file-name,th-sha256',
      },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Headers')).toMatch(/TH-File-Name.*TH-Sha256/);
  });
});

describe('without the private bucket', () => {
  const bare = { ...env, VAULT: undefined } as unknown as Env;
  it('both routes answer 503 not_configured', async () => {
    const put = await upload({ token: D, bytes: photo }, bare);
    expect([put.status, put.body.error.code]).toEqual([503, 'not_configured']);
    const get = await download(D, uuidv7(), {}, bare);
    expect([get.status, await code(get)]).toEqual([503, 'not_configured']);
  });
});

describe('rows', () => {
  it('an upload writes its one row and reads none; a download reads one', async () => {
    const put = await rowsDuring(core(), async () => {
      expect((await upload({ token: D, bytes: photo })).status).toBe(201);
    });
    expect(put).toEqual({ read: 0, written: 1 });
    const id = (await uploaded({ token: D, bytes: photo })).slice(5);
    const get = await rowsDuring(core(), async () => {
      expect((await download(D, id)).status).toBe(200);
    });
    expect(get).toEqual({ read: 1, written: 0 });
  });
});
