// The listening pass's calls of the cost suite (cost.test.ts checks every budget), metered in the Music
// object (and Core where it writes): issuing a job of 50 from a catalog of 600, its spec, an upload, the
// collect, applying one part of 50 results with the job's end and the phone file, the phone file built
// again, the phone's read of it, a status, and the mind's read of one song. DATA.md §8.2 takes a full
// run's cost from these: about one row written per song, a few per job.
import { env } from 'cloudflare:workers';
import type { NewAgentResponse, SignedIn } from '../../../shared/contract/api';
import { JOBS_KEY } from '../../../shared/contract/routes.ts';
import { api, apiJson, core, PASSWORD } from '../helpers';
import { drain, manifest, music, pack, put, result, seedTracks } from '../listen-helpers';

type Stub = ReturnType<typeof core>;
type Cost = (name: string, fn: () => Promise<Response>, status: number, stub?: Stub) => Promise<void>;

export async function listenCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  const d = await grant('192.0.2.251', `${PASSWORD} new`);
  const agent = async (role: string, name: string) =>
    (
      await apiJson<NewAgentResponse>('POST', '/v1/auth/agents', {
        token: d.token,
        body: { name, role, current_password: `${PASSWORD} new` },
      })
    ).body.token;
  const night = await agent('mind:night', 'night-cost-listen');
  const ci = await agent('ci', JOBS_KEY);
  const m = music() as unknown as Stub;
  const shas = await seedTracks(600);
  let jobId = '';
  await cost(
    'GET /v1/jobs/next audio.analysis, 50 of 600 (Music)',
    async () => {
      const r = await api('GET', '/v1/jobs/next?kind=audio.analysis&max=50', { token: night });
      jobId = ((await r.clone().json()) as { job_id: string }).job_id;
      return r;
    },
    200,
    m,
  );
  await cost('GET /v1/jobs/:id/spec (Music)', () => api('GET', `/v1/jobs/${jobId}/spec`, { token: ci }), 200, m);
  const up = await pack(shas.slice(0, 50).map((s, i) => result(s, i)));
  await cost('PUT /v1/jobs/:id/files/:name (Music)', () => put(ci, jobId, 'part-001.jsonl', up.parts[0]), 201, m);
  await put(ci, jobId, 'manifest.json', JSON.stringify(manifest(jobId, up.files)));
  await cost(
    'POST /v1/jobs/:id/collect (Music)',
    () => api('POST', `/v1/jobs/${jobId}/collect`, { token: ci, body: {} }),
    202,
    m,
  );
  const applied = async () => {
    await drain();
    return new Response(null, { status: 204 });
  };
  // Rows written in Music by the apply job: 50 results, the job's counts, its end, the epoch, the pack's state.
  await cost('alarm: one part of 50 results applied, the job ended, the phone file built (Music)', applied, 204, m);
  await cost('GET /v1/jobs/:id (Music)', () => api('GET', `/v1/jobs/${jobId}`, { token: night }), 200, m);
  await cost(
    'music.listen.pack, the phone file again (Music)',
    async () => {
      await music().buildPack();
      return new Response(null, { status: 204 });
    },
    204,
    m,
  );
  await cost('GET /v1/music/pack (Music)', () => api('GET', '/v1/music/pack', { token: d.token }), 200, m);
  await cost(
    'GET /v1/music/analysis/:id (Music)',
    () => api('GET', `/v1/music/analysis/r2_native_${shas[3]}?like=10`, { token: night }),
    200,
    m,
  );
  // The apply job's own Core rows for one more part: its job row, its steps and the lane's count.
  const j = await api('GET', '/v1/jobs/next?kind=audio.analysis&max=50', { token: night });
  const id2 = ((await j.json()) as { job_id: string }).job_id;
  const up2 = await pack(shas.slice(50, 100).map((s, i) => result(s, 50 + i)));
  await put(ci, id2, 'part-001.jsonl', up2.parts[0]);
  await put(ci, id2, 'manifest.json', JSON.stringify(manifest(id2, up2.files)));
  await cost(
    'POST /v1/jobs/:id/collect (Core)',
    () => api('POST', `/v1/jobs/${id2}/collect`, { token: ci, body: {} }),
    202,
    core(),
  );
  await cost('alarm: one part of 50 results applied, the job ended, the phone file built (Core)', applied, 204, core());
  if ((await env.VAULT.list({ prefix: 'jobs/incoming/' })).objects.length) throw new Error('uploads left behind');
}
