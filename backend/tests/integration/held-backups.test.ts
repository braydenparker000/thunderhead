// Backups and "download everything" leave held conversations out (held-store.ts `heldRows`): no
// weekly backup and no export holds a conversation off the record, its messages or its files' rows,
// so none keeps it past its 7 days; nor one deleted before it ran. A live conversation is all there.
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  BackupManifest,
  BackupRunResponse,
  ExportStartResponse,
  ExportStatus,
} from '../../../shared/contract/backups.ts';
import { backupJob } from '../../src/areas/backups/job';
import { gunzip } from '../../src/areas/backups/rows';
import { MINUTE } from '../../src/lib/time';
import type { Core } from '../../src/objects/core';
import { fileOf, offRecord, say, stub } from '../held-helpers';
import { api, apiJson, coreSql, makeAgent, PASSWORD, SITE } from '../helpers';
import { runJobsWith } from '../import-helpers';
import { ownerSays, type Principals, principals } from '../memory-helpers';

let p: Principals;
let otr = '';
let otrFile = '';
let deleted = '';
let kept = '';

beforeAll(async () => {
  p = await principals();
  otr = (await offRecord(p.D)).id;
  const ref = await fileOf(p.D, 'a synthetic scan');
  otrFile = ref.slice('file:'.length);
  await say({ token: p.D }, 'the albatross word, off the record', { thread_id: otr, attachments: [ref] });
  const gone = (await say({ token: p.D }, 'the marmalade word, soon deleted')).body.thread_id;
  await coreSql("UPDATE threads SET day = '2026-09-30', status = 'filed' WHERE id = ?", gone);
  deleted = gone;
  expect((await api('DELETE', `/v1/threads/${deleted}`, { token: p.D })).status).toBe(200);
  kept = await ownerSays(p.D, 'the lighthouse word, kept');
});

/** Every line of a backed-up table, from its parts in the bucket. */
async function backedUp(m: BackupManifest, table: string): Promise<Record<string, unknown>[]> {
  const t = m.tables.find((x) => x.name === table);
  const out: Record<string, unknown>[] = [];
  for (const part of t?.parts ?? []) {
    const obj = (await env.VAULT.get(part.key)) as R2ObjectBody;
    for (const l of (await gunzip(await obj.arrayBuffer())).split('\n').filter(Boolean)) out.push(JSON.parse(l));
  }
  return out;
}

describe('the weekly backup', () => {
  it('holds no conversation off the record and none deleted; the live one whole', async () => {
    const I = await makeAgent(p.D, 'ci');
    const r = await apiJson<BackupRunResponse>('POST', '/v1/ops/backups/run', { token: I, body: {} });
    expect(r.status).toBe(202);
    let manifest: BackupManifest | undefined;
    for (let i = 0; i < 40 && !manifest; i++) {
      await runJobsWith({ [backupJob.kind]: backupJob }, Date.now() + i * MINUTE);
      const list = await env.VAULT.list({ prefix: 'backups/' });
      const key = list.objects.map((o) => o.key).find((k) => k.endsWith('/core/manifest.json'));
      if (key) manifest = (await (await env.VAULT.get(key))?.json()) as BackupManifest;
    }
    const m = manifest as BackupManifest;
    const threads = await backedUp(m, 'threads');
    const messages = await backedUp(m, 'messages');
    const files = await backedUp(m, 'files');
    expect(threads.map((t) => t.id)).not.toContain(otr);
    expect(threads.map((t) => t.id)).not.toContain(deleted);
    expect(messages.some((x) => /albatross|marmalade/.test(String(x.body)))).toBe(false);
    expect(messages.map((x) => x.id)).toContain(kept);
    expect(files.map((f) => f.id)).not.toContain(otrFile);
    // The counts agree with what was written (the drill checks a restore against them).
    expect(m.tables.find((t) => t.name === 'messages')?.rows).toBe(messages.length);
  });
});

describe('download everything', () => {
  it('leaves them out too, and says so in its README', async () => {
    const r = await apiJson<ExportStartResponse>('POST', '/v1/export', { token: p.D, body: { password: PASSWORD } });
    expect(r.status).toBe(202);
    let s: ExportStatus | null = null;
    for (let i = 0; i < 40; i++) {
      s = (await apiJson<ExportStatus>('GET', `/v1/export/${r.body.export_id}`, { token: p.D })).body;
      if (s.status !== 'building') break;
      await runInDurableObject(stub(), (o: Core) => o.alarm());
    }
    expect(s?.status).toBe('ready');
    const res = await api('GET', s?.items[0].url as string, { token: p.D, headers: { Origin: SITE } });
    const text = await inflateAll(new Uint8Array(await res.arrayBuffer()));
    expect(text.get('tables/messages.jsonl')).toContain('lighthouse');
    for (const [name, body] of text)
      if (name.startsWith('tables/')) expect(body, name).not.toMatch(/albatross|marmalade|synthetic scan/);
    expect(text.get('tables/threads.jsonl')).not.toContain(otr);
    expect(text.get('README.md')).toContain('conversations off the record');
  });
});

/** Each file of a ZIP by name, inflated (stored as raw deflate by backups/zip.ts). */
async function inflateAll(zip: Uint8Array): Promise<Map<string, string>> {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  let at = v.getUint32(end + 16, true);
  const out = new Map<string, string>();
  for (let i = 0; i < v.getUint16(end + 10, true); i++) {
    const csize = v.getUint32(at + 20, true);
    const nameLen = v.getUint16(at + 28, true);
    const local = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = new Blob([zip.subarray(start, start + csize)])
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    out.set(name, await new Response(raw).text());
    at += 46 + nameLen + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
  }
  return out;
}
