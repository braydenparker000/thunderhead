// The Briefing page's call of the cost suite (cost.test.ts checks every budget; BRIEFING.md §2):
// GET /v1/briefing with the tiles the Worker fills itself (2026-11-02). In Core: the waiting
// cards, the reminders due today and tomorrow (12 set, 4 of them due; the partial index reads the
// due ones and stops), the night's surfaces, the follows the night checked (after podcast-calls.ts),
// the settings it reads (place, forecast, country, zone) and the night's run. In Music: the songs
// added in the last day, walked back from the newest log row (40 that day, 300 older ones never
// read). No place is set, so Open-Meteo isn't asked.
import { runInDurableObject } from 'cloudflare:test';
import type { SignedIn } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import type { Music } from '../../src/objects/music';
import { api, core, coreSql, PASSWORD } from '../helpers';
import { music } from '../music-helpers';

type Cost = (
  name: string,
  fn: () => Promise<Response>,
  status: number,
  stub?: ReturnType<typeof core>,
) => Promise<void>;

const H = 3_600_000;

export async function briefingCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  const d = await grant('192.0.2.254', `${PASSWORD} new`);
  await api('GET', '/v1/auth/me', d);
  const now = Date.now();
  // Made-up reminders: 4 due within the next 30 hours, 8 later.
  for (let i = 0; i < 12; i++)
    await api('PUT', `/v1/reminders/${uuidv7()}`, {
      ...d,
      body: { text: `Reminder ${i}`, at: now + (i < 4 ? (i + 1) * 6 * H : (3 + i) * 24 * H) },
    });
  await coreSql(
    `INSERT INTO settings (key, value_json, updated_at, actor) VALUES ('owner.country', '"GB"', ?, 'cost')
     ON CONFLICT (key) DO NOTHING`,
    now,
  );
  await runInDurableObject(music(), (_o: Music, st) => {
    for (let i = 0; i < 300; i++)
      st.storage.sql.exec(
        `INSERT INTO catalog_log (at, op, track_id, before_json) VALUES (?, 'register', 'cost', NULL)`,
        now - 3 * 24 * H + i,
      );
    for (let i = 0; i < 40; i++)
      st.storage.sql.exec(
        `INSERT INTO catalog_log (at, op, track_id, before_json) VALUES (?, 'register', 'cost', NULL)`,
        now - 12 * H + i * 60_000,
      );
  });
  await cost('GET /v1/briefing (Core)', () => api('GET', '/v1/briefing', d), 200, core());
  await cost(
    'GET /v1/briefing (Music: 40 songs added today)',
    () => api('GET', '/v1/briefing', d),
    200,
    music() as unknown as ReturnType<typeof core>,
  );
}
