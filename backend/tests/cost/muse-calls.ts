// Muse's upload operations in the cost suite (cost.test.ts checks every budget; areas/music/upload.ts),
// with the 12,000-song catalog of music-calls.ts, each the operation alone in its object (the route's
// signature check reads nothing; its hold check asks Core at most once a minute): a batch of 20 new
// songs with waveforms (the catalog's counts already kept, so a few rows a song and one version move),
// 20 waveforms in bulk, one track's record by id and by its audio, a page of 2,000 records without
// waveforms, and the day's quota in Core. Invented songs only.
import { env } from 'cloudflare:workers';
import type { Core } from '../../src/objects/core';
import { core } from '../helpers';
import { music, songId } from '../music-helpers';

type Cost = (name: string, fn: () => Promise<Response>, status: number, stub?: never) => Promise<void>;

const WAVE = btoa(String.fromCharCode(...Array.from({ length: 64 }, (_, i) => (i * 5) % 256)));
const answered = (status = 200) => new Response(null, { status });
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

/** A new song's registration, its audio already in the bucket as an upload leaves it. */
async function song(i: number) {
  const bytes = new TextEncoder().encode(`OggS invented cost song ${i} `.repeat(20));
  const h = hex(await crypto.subtle.digest('SHA-256', bytes));
  await env.MEDIA.put(`native/audio/${h}.opus`, bytes, {
    customMetadata: { 'verified-sha256': h, verification: 'worker-upload-sha256-v1' },
  });
  return {
    sha256: h,
    size: bytes.length,
    name: `Cost upload ${i}.opus`,
    metadata: { title: `Cost upload ${i}`, artist: 'An Invented Duo', dur: 200 + i },
    waveform: WAVE,
    waveformKind: 'rms',
  };
}

export async function museCalls(cost: Cost, m: never) {
  const write = (op: string, body: Record<string, unknown>) => async () =>
    answered(((await music().write(op, body)) as unknown as { status: number }).status);
  // One registration first, so the catalog's count and size are kept (read once per start).
  expect200(await write('register', await song(0))());
  const tracks = [];
  for (let i = 1; i <= 20; i++) tracks.push(await song(i));
  await cost(
    'POST /v1/music/uploads/register-batch, 20 new songs with waveforms (Music, the operation alone)',
    write('register-batch', { tracks }),
    200,
    m,
  );
  const items = Array.from({ length: 20 }, (_, i) => ({ id: songId(2_001 + i), waveform: WAVE, kind: 'peak' }));
  await cost(
    'POST /v1/music/uploads/waveforms, 20 (Music, the operation alone)',
    write('waveforms', { items }),
    200,
    m,
  );
  await cost(
    'POST /v1/music/uploads/track, by id (Music, the operation alone)',
    async () => answered((await music().trackRecord(songId(2_001), '', 0)) ? 200 : 404),
    200,
    m,
  );
  await cost(
    'POST /v1/music/uploads/track, by sha256 and size (Music, the operation alone)',
    async () => answered((await music().trackRecord(null, tracks[3].sha256, tracks[3].size)) ? 200 : 404),
    200,
    m,
  );
  await cost(
    'POST /v1/music/uploads/export, a page of 2,000 without waveforms (Music, the operation alone)',
    async () => answered((await music().exportPage(2_000, null, false)) ? 200 : 404),
    200,
    m,
  );
  const k = core() as unknown as DurableObjectStub<Core>;
  await cost(
    'POST /v1/music/uploads/quota (Core, the operation alone)',
    async () => answered((await k.museQuota(Date.now(), [])).day ? 200 : 500),
    200,
    k as unknown as never,
  );
}

function expect200(r: Response) {
  if (r.status !== 200) throw new Error(`the priming registration answered ${r.status}`);
}
