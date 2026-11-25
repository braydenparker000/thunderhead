// GET /v1/ops/diag in the cost suite (cost.test.ts checks every budget), from report-calls.ts's `it`
// (cost.test.ts stays under 300 lines): measured once in Music, whose knowledge counts it may count
// again (every album and facts row, at most every 10 minutes) besides its one pass over the facts
// rows, and once in Core, which reads its jobs table, the lane, and the meter as GET /v1/ops/meter does.
import type { SignedIn } from '../../../shared/contract/api';
import { api, core, PASSWORD, type rowsDuring } from '../helpers';
import { music } from '../music-helpers';

type Cost = (
  name: string,
  fn: () => Promise<Response>,
  status: number,
  stub?: Parameters<typeof rowsDuring>[0],
) => Promise<void>;

export async function diagCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  const d = await grant('192.0.2.232', `${PASSWORD} new`);
  await api('GET', '/v1/auth/me', d);
  await cost('GET /v1/ops/diag (Music)', () => api('GET', '/v1/ops/diag', d), 200, music() as never);
  await cost('GET /v1/ops/diag (Core)', () => api('GET', '/v1/ops/diag', d), 200, core());
}
