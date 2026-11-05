// Looks' calls of the cost suite (cost.test.ts checks every budget), metered in Core: one look saved,
// 20 presets imported in one PUT (each a new id, so each is counted against the cap), the list of 21,
// a rename, a delete, and a look applied to a photo that has an edit of its own (the phone's recipe
// put, with its ledger row). Runs after photosCalls, which linked the invented Drive (photoCalls: both).
import type { SignedIn } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import { api, core, PASSWORD } from '../helpers';
import { fakeGoogle, photoBody } from '../photos-helpers';
import { photosCalls } from './photos-calls';

type Cost = (
  name: string,
  fn: () => Promise<Response>,
  status: number,
  stub?: ReturnType<typeof core>,
) => Promise<void>;

const look = (i: number) => ({
  id: uuidv7(),
  name: `Invented preset ${i}`,
  source: 'xmp',
  tag: 'Invented pack',
  panels: ['light', 'color', 'effects'],
  recipe: { Exposure2012: 0.2, Contrast2012: 10 + i, Vibrance: 8, SaturationAdjustmentBlue: -10, GrainAmount: 20 },
});

export async function looksCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  const d = { token: (await grant('192.0.2.251', `${PASSWORD} new`)).token };
  fakeGoogle();
  const pid = uuidv7();
  await api('PUT', `/v1/photos/${pid}`, { ...d, body: photoBody() });
  await api('PUT', `/v1/photos/${pid}/recipe`, { ...d, body: { recipe: { Exposure2012: 0.5, CropAngle: 2 } } });
  const k = core();
  const mine = { ...look(0), source: 'mine', name: 'Soft evening' };
  await cost('PUT /v1/photos/looks (a look saved) (Core)', () => api('PUT', '/v1/photos/looks', { ...d, body: { items: [mine] } }), 201, k);
  const twenty = Array.from({ length: 20 }, (_, i) => look(i + 1));
  await cost('PUT /v1/photos/looks (20 presets) (Core)', () => api('PUT', '/v1/photos/looks', { ...d, body: { items: twenty } }), 201, k);
  await cost('GET /v1/photos/looks (21) (Core)', () => api('GET', '/v1/photos/looks', d), 200, k);
  await cost(
    'PATCH /v1/photos/looks/:lid (Core)',
    () => api('PATCH', `/v1/photos/looks/${mine.id}`, { ...d, body: { name: 'Soft evening, warmer' } }),
    200,
    k,
  );
  await cost('DELETE /v1/photos/looks/:lid (Core)', () => api('DELETE', `/v1/photos/looks/${twenty[0]?.id}`, d), 200, k);
  // Applying a look is the phone's recipe put: the look's panels replaced, the crop kept.
  const applied = { ...mine.recipe, CropAngle: 2 };
  await cost(
    'PUT /v1/photos/:id/recipe (a look applied) (Core)',
    () => api('PUT', `/v1/photos/${pid}/recipe`, { ...d, body: { recipe: applied } }),
    200,
    k,
  );
}

/** Photos' calls, then the looks'. */
export const photoCalls: typeof looksCalls = (cost, grant) => photosCalls(cost, grant).then(() => looksCalls(cost, grant));
