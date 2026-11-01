// Podcasts' sync calls of the cost suite (cost.test.ts checks every budget; NEXT-BATCH.md part 7):
// the phone's usual sync while an episode plays (one position, new or newer), a stale one, a first
// sync of 100, the reads on open with 1,000 positions kept (nothing new, then 3 new: each reads the
// rows it returns), a follow, the night's check of 20 shows, its feed admission (counted in a
// stored row), and the daily prune over 1,003.
import { runInDurableObject } from 'cloudflare:test';
import type { NewAgentResponse, SignedIn } from '../../../shared/contract/api';
import type { Core } from '../../src/objects/core';
import { api, apiJson, core, coreSql, PASSWORD } from '../helpers';

type Cost = (
  name: string,
  fn: () => Promise<Response>,
  status: number,
  stub?: ReturnType<typeof core>,
) => Promise<void>;

const FEED = 'https://feeds.example.org/cost.xml';
const item = (n: number, position_s: number, updated_at: number) => ({
  key: `${FEED}#${n.toString(16).padStart(16, '0')}`,
  position_s,
  duration_s: 3600,
  played: false,
  updated_at,
});

export async function podcastCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  const d = await grant('192.0.2.251', `${PASSWORD} new`);
  await api('GET', '/v1/auth/me', d);
  const agent = await apiJson<NewAgentResponse>('POST', '/v1/auth/agents', {
    token: d.token,
    body: { name: 'night-cost-podcasts', role: 'mind:night', current_password: `${PASSWORD} new` },
  });
  // The night reads from its claimed session, which the Worker marks tainted (the first read writes it).
  const session = 'cse_cost_podcasts_night';
  const night = { token: agent.body.token, headers: { 'TH-Session': session } };
  await api('POST', '/v1/mind/brief', {
    ...night,
    body: { claim: true, session_id: session, role: 'night', constitution_sha256: 'a'.repeat(64), th_version: '0.1.0' },
  });
  const at = Date.now() - 60_000;
  const put = (items: unknown[]) => () => api('PUT', '/v1/podcasts/progress', { ...d, body: { items } });
  await cost('PUT /v1/podcasts/progress (1 new) (Core)', put([item(1, 30, at)]), 200, core());
  await cost('PUT /v1/podcasts/progress (1 newer) (Core)', put([item(1, 90, at + 1)]), 200, core());
  await cost('PUT /v1/podcasts/progress (1 stale) (Core)', put([item(1, 60, at)]), 200, core());
  await cost(
    'PUT /v1/podcasts/progress (100 new, a first sync) (Core)',
    put(Array.from({ length: 100 }, (_, i) => item(100 + i, i, at))),
    200,
    core(),
  );
  await coreSql(
    `INSERT INTO podcast_progress (key, position_s, duration_s, played, updated_at, synced_at)
     SELECT ? || '#s' || printf('%015d', value), 1, 2, 0, ? - value, ? FROM json_each(?)`,
    FEED,
    at,
    at,
    JSON.stringify([...Array(899).keys()]),
  );
  const since = Date.now() + 1;
  await new Promise((r) => setTimeout(r, 5));
  await cost(
    'GET /v1/podcasts/progress (nothing new of 1,000) (Core)',
    () => api('GET', `/v1/podcasts/progress?since=${since}`, d),
    200,
    core(),
  );
  await put([item(2, 1, at), item(3, 1, at), item(4, 1, at)])();
  await cost(
    'GET /v1/podcasts/progress (3 new of 1,003) (Core)',
    () => api('GET', `/v1/podcasts/progress?since=${since}`, d),
    200,
    core(),
  );
  const show = (n: number) => ({
    feed_url: `https://feeds.example.org/show-${n}.xml`,
    title: `Show ${n}`,
    author: 'A host',
    artwork: '',
    followed: true,
    updated_at: at,
  });
  await api('PUT', '/v1/podcasts/follows', { ...d, body: { items: Array.from({ length: 19 }, (_, i) => show(i)) } });
  await cost(
    'PUT /v1/podcasts/follows (1) (Core)',
    () => api('PUT', '/v1/podcasts/follows', { ...d, body: { items: [show(19)] } }),
    200,
    core(),
  );
  await cost(
    'GET /v1/podcasts/follows (20 shows, the night: no titles, nothing marked) (Core)',
    () => api('GET', '/v1/podcasts/follows?since=0', night),
    200,
    core(),
  );
  // The positions carry feed addresses: a mind's read marks its session (the first time writes it).
  await cost(
    'GET /v1/podcasts/progress (the night, marking its session) (Core)',
    () => api('GET', `/v1/podcasts/progress?since=${Date.now() + 1}`, night),
    200,
    core(),
  );
  await cost(
    'GET /v1/podcasts/progress (the night, already marked) (Core)',
    () => api('GET', `/v1/podcasts/progress?since=${Date.now() + 1}`, night),
    200,
    core(),
  );
  const checked = Array.from({ length: 20 }, (_, i) => ({ feed_url: show(i).feed_url, latest_at: at, new_n: 1 }));
  await cost(
    'POST /v1/podcasts/follows/checked (20) (Core)',
    () => api('POST', '/v1/podcasts/follows/checked', { ...night, body: { items: checked } }),
    200,
    core(),
  );
  // The night's feed reads (GET /v1/podcasts/feed as mind:night): Core admits a followed show's and
  // counts it in a stored row; another address costs one row read and no count.
  const admit = (url: string) => async () => {
    const ok = await runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) =>
      o.admitNightFeed(url),
    );
    return new Response(null, { status: ok.ok ? 204 : 403 });
  };
  await cost(
    'GET /v1/podcasts/feed, the night admitted (a followed show) (Core)',
    admit(show(3).feed_url),
    204,
    core(),
  );
  await cost(
    'GET /v1/podcasts/feed, the night refused (not followed) (Core)',
    admit('https://elsewhere.example.org/x.xml'),
    403,
    core(),
  );
  // Counts mode leaves out what a phone started: one lookup per new episode.
  await cost(
    'GET /v1/podcasts/feed, counts: started episodes looked up (3) (Core)',
    async () => {
      await runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) =>
        o.podcastsStarted(
          FEED,
          [1, 2, 3].map((n) => n.toString(16).padStart(16, '0')),
        ),
      );
      return new Response(null, { status: 204 });
    },
    204,
    core(),
  );
  await coreSql("DELETE FROM settings WHERE key = 'prune.day'");
  await cost(
    'cron tick, the daily prune pass with 1,003 positions (Core)',
    async () => {
      await runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.tick());
      return new Response(null, { status: 204 });
    },
    204,
    core(),
  );
}
