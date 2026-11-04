// Night step 13 in the cost suite (cost.test.ts checks every budget; growth.ts): a week of invented
// practice and reading (3 sessions with 60 marked passes, 4 new bests, 3 reading stints), then the
// step's PUT from the report's claimed night session: first (the week's two questions in Senses,
// the book's place in the Library, then two tiles and two arrangements in Core, each with its
// ledger row), the same again (reads only), and what each question reads in Senses. Run from
// night-report-calls.ts.
import { env } from 'cloudflare:workers';
import type { SignedIn } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import { dayBefore, zonedInstant } from '../../src/lib/time';
import { libraryObject } from '../../src/objects/library';
import { sensesObject } from '../../src/objects/senses';
import { api, core } from '../helpers';
import { as } from '../memory-helpers';

type Cost = (
  name: string,
  fn: () => Promise<Response>,
  status: number,
  stub?: ReturnType<typeof core>,
) => Promise<void>;

export async function growthCalls(cost: Cost, d: SignedIn, N: string, S: string, day: string) {
  const at = (back: number) => zonedInstant(dayBefore(day, back), 12, 'UTC') + Math.floor(Math.random() * 60_000);
  const e = (type: string, ref: string, data: object, back: number) => ({
    id: uuidv7(),
    at: at(back),
    type,
    ref,
    data,
  });
  const events = [
    ...[0, 1, 2].map((b) => e('guitar.session', 'tab:s9', { seconds: 1500, sections: ['0-3', '4-7'], bpm: 96 }, b)),
    ...Array.from({ length: 60 }, (_, i) =>
      e(
        `guitar.pass`,
        `tab:s9#b${i % 2 ? 5 : 1}-${i % 2 ? 8 : 4}`,
        { bpm: 80 + (i % 16), speed_pct: 80 + (i % 16), clean: i % 3 > 0, by: 'owner' },
        i % 3,
      ),
    ),
    ...[12, 6, 1, 0].map((b, i) => e('guitar.bpm', 'tab:s9#b1-4', { bpm: 84 + i * 3 }, b)),
    ...[0, 1, 2].map((b) => e('study.read', 'book:cost-book-1', { pages: 12, ms: 900_000 }, b)),
  ];
  await api('PUT', `/v1/senses/batches/${uuidv7()}`, { token: d.token, body: { events } });
  const put = () => api('PUT', `/v1/mind/growth/${day}`, { ...as(N, S), body: {} });
  await cost('PUT /v1/mind/growth/:day (Core, first: 2 tiles, 1 plan)', put, 200, core());
  await cost('PUT /v1/mind/growth/:day (Core, the same again)', put, 200, core());
  await cost(
    'PUT /v1/mind/growth/:day (Senses, a week: 3 sessions, 60 passes, 4 bests, 3 reads)',
    put,
    200,
    sensesObject(env) as unknown as never,
  );
  await cost(
    'PUT /v1/mind/growth/:day (Library, one book never opened)',
    put,
    200,
    libraryObject(env) as unknown as never,
  );
}
