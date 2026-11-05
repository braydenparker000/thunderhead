// /v1/photos/drive and the upload token (PHOTOS.md §3.1, §3.7; API.md §11.26): Settings › Photos
// links the owner's Google Drive with one consent (scope drive.file: only files this app makes),
// Google comes back to the public callback with a one-use state, the Worker trades the code for a
// refresh token, seals it in the Auth object, finds or makes the folder "Thunderhead Photos" and
// sends the browser back to /photos/. The phone uploads originals itself with a short-lived token
// from POST /v1/photos/upload-token: their bytes never pass through the Worker. Files the owner
// picks in Google's picker (with the public picker key GET /v1/photos/drive hands the phone) are
// registered by reference through POST /v1/photos/from-drive (pick.ts).
import { Hono } from 'hono';
import { DRIVE_FOLDER, type DriveStatus, type UploadTokenResponse } from '../../../../shared/contract/photos.ts';
import { type AppEnv, guard } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { json } from '../../http/validate';
import { authObject } from '../../objects/auth';
import { account, consentUrl, exchange, folder, GoogleError, revoke } from './google';
import { fromDrive, pickBody } from './pick';
import { randomState, stateHash } from './seal';
import { accessToken, clientOf } from './token';

const origins = (env: Env) =>
  env.SITE_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
const notConnected = (why: string) => new ApiError('conflict', [{ path: 'drive', issue: why }]);

export const driveRoutes = new Hono<AppEnv>()
  .get('/photos/drive', guard('GET /v1/photos/drive'), async (c) => {
    const s = await authObject(c.env).driveStatus(clientOf(c.env) !== null);
    // Public by design (restricted at Google to the Picker API and the site's origin): never a secret.
    const picker_key = (c.env.GOOGLE_PICKER_KEY ?? '').trim();
    const picker_app = /^(\d{4,20})-/.exec(clientOf(c.env)?.id ?? '')?.[1] ?? '';
    return c.json({ ...s, picker_key, picker_app } satisfies DriveStatus);
  })
  .post('/photos/from-drive', guard('POST /v1/photos/from-drive'), async (c) =>
    c.json(await fromDrive(c.env, (await json(c, pickBody)).ids)),
  )
  .post('/photos/drive/connect', guard('POST /v1/photos/drive/connect'), async (c) => {
    const client = clientOf(c.env);
    if (!client) throw new ApiError('not_configured');
    // Back to the site the owner tapped Connect on (a preview build's or the live one), never elsewhere.
    const from = c.req.header('Origin') ?? '';
    const back = origins(c.env).includes(from) ? from : (origins(c.env)[0] ?? '');
    const state = randomState();
    await authObject(c.env).driveStateNew(await stateHash(state), back);
    return c.json({ url: consentUrl(client, state) });
  })
  // Public: Google's redirect carries no bearer; the one-use state is the check.
  .get('/photos/drive/callback', async (c) => {
    const state = c.req.query('state') ?? '';
    const back = state ? await authObject(c.env).driveStateTake(await stateHash(state)) : null;
    if (!back) return c.text('This link has expired. Start again from Settings › Photos.', 400);
    const to = (result: string) => c.redirect(`${back}/photos/?drive=${result}`, 302);
    const code = c.req.query('code');
    const client = clientOf(c.env);
    if (!code || !client) return to(c.req.query('error') === 'access_denied' ? 'declined' : 'failed');
    try {
      const now = Date.now();
      const t = await exchange(client, code, now);
      if (!t.refresh_token) return to('failed');
      const folderId = await folder(t.access_token, DRIVE_FOLDER);
      // Which Google account consented, so a consent someone else finished shows at once.
      const who = await account(t.access_token).catch(() => null);
      await authObject(c.env).drivePut(
        { refresh: t.refresh_token, folder_id: folderId, folder_name: DRIVE_FOLDER, account: who },
        { token: t.access_token, expires_at: t.expires_at },
      );
      return to('connected');
    } catch (e) {
      if (e instanceof GoogleError) return to('failed');
      throw e;
    }
  })
  .delete('/photos/drive', guard('DELETE /v1/photos/drive'), async (c) => {
    const auth = authObject(c.env);
    const g = await auth.driveGrant(0);
    await auth.driveForget();
    // Google forgets it too (best effort): the files stay in the owner's Drive.
    if (g) await revoke(g.refresh);
    return c.body(null, 204);
  })
  .post('/photos/upload-token', guard('POST /v1/photos/upload-token'), async (c) => {
    let a: Awaited<ReturnType<typeof accessToken>>;
    try {
      a = await accessToken(c.env);
    } catch {
      throw new ApiError('upstream');
    }
    if (a === 'not_configured') throw new ApiError('not_configured');
    if (a === 'not_connected') throw notConnected('Google Drive is not connected');
    if (a === 'revoked') throw notConnected('Google Drive was disconnected in your Google account');
    return c.json({
      access_token: a.token,
      expires_at: a.expires_at,
      folder_id: a.folder_id,
    } satisfies UploadTokenResponse);
  });
