// Photos' calls of the cost suite (cost.test.ts checks every budget), metered in Core: an import
// (the photo's row, then its preview's), the shelf's first page of 14 days with four photos each,
// one whole day, a rating, a recipe saved (a change, then the same again) and a delete. The shelf holds 15 days of 6 invented photos first.
import { exports } from 'cloudflare:workers';
import type { SignedIn } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import { api, core, PASSWORD } from '../helpers';
import { connectDrive, fakeGoogle, photoBody, previewBytes } from '../photos-helpers';

type Cost = (
  name: string,
  fn: () => Promise<Response>,
  status: number,
  stub?: ReturnType<typeof core>,
) => Promise<void>;

export async function photosCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  const d = { token: (await grant('192.0.2.253', `${PASSWORD} new`)).token };
  // Registration checks the file with Drive (a fake Google here; the Worker never calls Google in tests).
  fakeGoogle();
  await connectDrive(d.token);
  for (let day = 0; day < 15; day++)
    for (let i = 0; i < 6; i++)
      await api('PUT', `/v1/photos/${uuidv7()}`, {
        ...d,
        body: photoBody({ taken: Date.UTC(2026, 2, 1 + day, 9, i) }),
      });
  const id = uuidv7();
  const k = core();
  await cost(
    'PUT /v1/photos/:id (an import) (Core)',
    () => api('PUT', `/v1/photos/${id}`, { ...d, body: photoBody() }),
    201,
    k,
  );
  const bytes = previewBytes(300 * 1024);
  await cost(
    'PUT /v1/photos/:id/preview (Core)',
    () =>
      exports.default.fetch(
        new Request(`https://api.example.test/v1/photos/${id}/preview`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${d.token}`,
            'CF-Connecting-IP': '192.0.2.10',
            'Content-Type': 'image/jpeg',
          },
          body: bytes,
        }),
      ),
    200,
    k,
  );
  await cost('GET /v1/photos (14 days of 6) (Core)', () => api('GET', '/v1/photos', d), 200, k);
  await cost('GET /v1/photos?day= (6 photos) (Core)', () => api('GET', '/v1/photos?day=2026-03-02', d), 200, k);
  await cost(
    'PATCH /v1/photos/:id (Core)',
    () => api('PATCH', `/v1/photos/${id}`, { ...d, body: { rating: 3 } }),
    200,
    k,
  );
  const recipe = { Exposure2012: 0.4, Contrast2012: 12, Shadows2012: 30, Vibrance: 15, Texture: 10, Sharpness: 50 };
  await cost(
    'PUT /v1/photos/:id/recipe (a change) (Core)',
    () => api('PUT', `/v1/photos/${id}/recipe`, { ...d, body: { recipe } }),
    200,
    k,
  );
  await cost(
    'PUT /v1/photos/:id/recipe (the same again) (Core)',
    () => api('PUT', `/v1/photos/${id}/recipe`, { ...d, body: { recipe } }),
    200,
    k,
  );
  await cost('DELETE /v1/photos/:id (Core)', () => api('DELETE', `/v1/photos/${id}`, d), 200, k);
}
