// P4 stage F, "download everything" (MENU-AND-SETTINGS.md §4.9): the password again, only the
// owner's device and only the one that asked, every exported table in files of 5,000 rows with a
// README and the counts, the ZIP checked file by file against its CRC-32 and size, and gone after
// its hour (the tick removes its files from the bucket).

import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ExportStartResponse, ExportStatus } from '../../../shared/contract/backups.ts';
import { crc32 } from '../../src/areas/backups/zip';
import type { Core } from '../../src/objects/core';
import { api, apiJson, core, coreSql, loginOk, PASSWORD, SITE } from '../helpers';
import { ownerSays, type Principals, principals } from '../memory-helpers';

let p: Principals;
const stub = () => core() as unknown as DurableObjectStub<Core>;
const alarm = () => runInDurableObject(stub(), (o: Core) => o.alarm());
const watch = (now = Date.now()) => runInDurableObject(stub(), (o: Core) => o.tick(now));

async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, rounds = 40): Promise<T> {
  for (let i = 0; i < rounds; i++) {
    const v = await read();
    if (done(v)) return v;
    await alarm();
  }
  throw new Error('did not finish');
}

beforeAll(async () => {
  p = await principals();
  await ownerSays(p.D, 'A message that the backup keeps');
  // 6,000 ledger rows: two files (tables/ledger.jsonl and tables/ledger-2.jsonl).
  await coreSql(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 6000)
     INSERT INTO ledger (id, at, actor, kind, what, why, undoable, status, tainted)
     SELECT printf('l-ex-%05d', i), i, 'owner', 'note', 'row ' || i, 'an export fixture', 0, 'done', 0 FROM n`,
  );
});

describe('download everything', () => {
  const status = (token: string, id: string) => apiJson<ExportStatus>('GET', `/v1/export/${id}`, { token });
  let id = '';
  it('asks for the password again; only the owner device may start it', async () => {
    expect((await api('POST', '/v1/export', { token: p.C, body: { password: PASSWORD } })).status).toBe(403);
    expect((await api('POST', '/v1/export', { token: p.D, body: {} })).status).toBe(422);
    expect((await api('POST', '/v1/export', { token: p.D, body: { password: 'not it at all' } })).status).toBe(401);
    const r = await apiJson<ExportStartResponse>('POST', '/v1/export', { token: p.D, body: { password: PASSWORD } });
    expect(r.status).toBe(202);
    id = r.body.export_id;
    expect(
      (await apiJson<ExportStartResponse>('POST', '/v1/export', { token: p.D, body: { password: PASSWORD } })).body
        .export_id,
    ).toBe(id);
    expect((await status(p.D, id)).body).toMatchObject({ status: 'building', items: [] });
    // Another signed-in device of the owner sees nothing of it.
    const other = (await loginOk('192.0.2.77')).token;
    expect((await status(other, id)).status).toBe(404);
    expect((await api('GET', `/v1/export/${id}/zip`, { token: other })).status).toBe(404);
  });

  it('builds a ZIP whose every file matches its CRC-32: the tables, a README and the counts', async () => {
    const s = await until(
      async () => (await status(p.D, id)).body,
      (x) => x.status !== 'building',
    );
    expect(s.status).toBe('ready');
    expect(s.items).toHaveLength(1);
    expect(s.items[0].url).toBe(`/v1/export/${id}/zip`);
    expect(s.last_backup).toBeNull();
    const res = await api('GET', s.items[0].url, { token: p.D, headers: { Origin: SITE } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(SITE);
    expect(res.headers.get('content-type')).toBe('application/zip');
    const zip = new Uint8Array(await res.arrayBuffer());
    expect(zip.length).toBe(Number(res.headers.get('content-length')));
    const files = await unzip(zip);
    const names = [...files.keys()];
    expect(names).toContain('README.md');
    expect(names).toContain('export.json');
    expect(names).toContain('tables/messages.jsonl');
    expect(names).toContain('tables/ledger.jsonl');
    expect(names).toContain('tables/ledger-2.jsonl');
    // The music catalog's tables, from the Music object (empty here: one empty file each).
    for (const t of ['tracks', 'catalog_log', 'music_state']) expect(names).toContain(`tables/music.${t}.jsonl`);
    // The senses' daily counts and Study's library (the PDFs stay in the bucket, the index is rebuilt).
    expect(names).toContain('tables/senses.rollups.jsonl');
    for (const t of ['books', 'pages', 'verse_refs', 'highlights', 'positions'])
      expect(names).toContain(`tables/library.${t}.jsonl`);
    expect(names.some((n) => /auth|sessions|jobs|_fts/.test(n))).toBe(false);
    const messages = (files.get('tables/messages.jsonl') as string)
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(messages.some((m) => m.body === 'A message that the backup keeps')).toBe(true);
    const counts = JSON.parse(files.get('export.json') as string).tables as Record<string, number>;
    const [{ n: msgRows }] = await coreSql<{ n: number }>('SELECT count(*) AS n FROM messages');
    expect(counts.messages).toBe(msgRows);
    expect(files.get('README.md')).toMatch(/^# Thunderhead export, \d{4}-\d{2}-\d{2}/);
    const notes = await coreSql<{ what: string }>('SELECT what FROM ledger WHERE ref = ?', `export:${id}`);
    expect(notes).toEqual([{ what: 'started "download everything"' }]);
  });

  it('is gone after its hour, and the tick removes its files from the bucket', async () => {
    await coreSql('UPDATE exports SET expires_at = ? WHERE id = ?', Date.now() - 1, id);
    expect((await status(p.D, id)).body).toMatchObject({ status: 'expired', items: [] });
    expect((await api('GET', `/v1/export/${id}/zip`, { token: p.D })).status).toBe(404);
    expect((await env.VAULT.list({ prefix: `exports/${id}/` })).objects.length).toBeGreaterThan(0);
    await watch();
    expect((await env.VAULT.list({ prefix: `exports/${id}/` })).objects).toEqual([]);
    expect((await status(p.D, id)).body.status).toBe('expired');
  });
});

/** A ZIP's files by name, each inflated and checked against its CRC-32 and size. */
async function unzip(zip: Uint8Array): Promise<Map<string, string>> {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(at, true)).toBe(0x02014b50);
    const crc = v.getUint32(at + 16, true);
    const csize = v.getUint32(at + 20, true);
    const size = v.getUint32(at + 24, true);
    const nameLen = v.getUint16(at + 28, true);
    const local = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLen));
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = new Uint8Array(
      await new Response(
        new Blob([zip.subarray(start, start + csize)]).stream().pipeThrough(new DecompressionStream('deflate-raw')),
      ).arrayBuffer(),
    );
    expect(raw.length, name).toBe(size);
    expect(crc32(raw), name).toBe(crc);
    out.set(name, new TextDecoder().decode(raw));
    at += 46 + nameLen;
  }
  return out;
}
