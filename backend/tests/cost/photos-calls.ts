// Photos' calls of the cost suite (cost.test.ts checks every budget), metered in Core: an import
// (the photo's row, then its preview's), 1 and 20 files picked in Drive, the shelf's first page of 14 days with four photos each,
// one whole day, a rating, a recipe saved (a change, then the same again), versions and a delete;
// then, after the ledger's own reads are measured, a paste onto 1 and onto 12 photos (pasteCalls). The shelf holds 15 days of 6 invented photos first.
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
  const g = fakeGoogle();
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
  // Import from Drive: files picked in Google's picker, registered by reference (1, then 20 a request).
  for (let i = 0; i < 21; i++)
    g.picked[`picked-${i}`] = {
      name: `DSCF${1000 + i}.RAF`,
      size: '30000000',
      mimeType: 'application/octet-stream',
      createdTime: '2026-03-20T09:00:00.000Z',
    };
  await cost(
    'POST /v1/photos/from-drive (1 file) (Core)',
    () => api('POST', '/v1/photos/from-drive', { ...d, body: { ids: ['picked-0'] } }),
    200,
    k,
  );
  const twenty = Array.from({ length: 20 }, (_, i) => `picked-${i + 1}`);
  await cost(
    'POST /v1/photos/from-drive (20 files) (Core)',
    () => api('POST', '/v1/photos/from-drive', { ...d, body: { ids: twenty } }),
    200,
    k,
  );
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
  // Versions: an automatic one (and the same again, which writes nothing), a named one, the list, a
  // rename and a delete.
  const auto = { id: uuidv7(), kind: 'auto', recipe };
  await cost(
    'POST /v1/photos/:id/versions (automatic) (Core)',
    () => api('POST', `/v1/photos/${id}/versions`, { ...d, body: auto }),
    201,
    k,
  );
  await cost(
    'POST /v1/photos/:id/versions (the same again) (Core)',
    () => api('POST', `/v1/photos/${id}/versions`, { ...d, body: { ...auto, id: uuidv7() } }),
    200,
    k,
  );
  const named = { id: uuidv7(), kind: 'named', name: 'A look', recipe: { Exposure2012: -0.3 } };
  await cost(
    'POST /v1/photos/:id/versions (named) (Core)',
    () => api('POST', `/v1/photos/${id}/versions`, { ...d, body: named }),
    201,
    k,
  );
  await cost('GET /v1/photos/:id/versions (2) (Core)', () => api('GET', `/v1/photos/${id}/versions`, d), 200, k);
  await cost(
    'PATCH /v1/photos/:id/versions/:vid (Core)',
    () => api('PATCH', `/v1/photos/${id}/versions/${named.id}`, { ...d, body: { name: 'Another look' } }),
    200,
    k,
  );
  await cost(
    'DELETE /v1/photos/:id/versions/:vid (Core)',
    () => api('DELETE', `/v1/photos/${id}/versions/${named.id}`, d),
    200,
    k,
  );
  await cost('DELETE /v1/photos/:id (Core)', () => api('DELETE', `/v1/photos/${id}`, d), 200, k);
}

/** Paste a copied edit (Light and Color) onto 1 and onto 12 photos, each with an edit of its own (one
 * setup paste gave them that, so the ledger grows by three rows only), so each gets an automatic version
 * first; then the same 12 again, which writes nothing. Run last: the ledger reads before count rows. */
export async function pasteCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  const d = { token: (await grant('192.0.2.252', `${PASSWORD} new`)).token };
  fakeGoogle();
  const many: string[] = [];
  for (let i = 0; i < 13; i++) {
    const pid = uuidv7();
    await api('PUT', `/v1/photos/${pid}`, { ...d, body: photoBody() });
    many.push(pid);
  }
  await api('POST', '/v1/photos/paste', {
    ...d,
    body: { ids: many, panels: ['light', 'effects'], recipe: { Exposure2012: 0.3, Texture: 5 } },
  });
  const k = core();
  const look = {
    ids: many.slice(12),
    panels: ['light', 'color'],
    recipe: { Exposure2012: 0.8, Contrast2012: 20, Vibrance: 12 },
  };
  await cost(
    'POST /v1/photos/paste (1 photo) (Core)',
    () => api('POST', '/v1/photos/paste', { ...d, body: look }),
    200,
    k,
  );
  const twelve = { ...look, ids: many.slice(0, 12) };
  await cost(
    'POST /v1/photos/paste (12 photos) (Core)',
    () => api('POST', '/v1/photos/paste', { ...d, body: twelve }),
    200,
    k,
  );
  await cost(
    'POST /v1/photos/paste (the same 12 again) (Core)',
    () => api('POST', '/v1/photos/paste', { ...d, body: twelve }),
    200,
    k,
  );
}
