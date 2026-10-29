// Presigned R2 GETs (SECURITY.md §9, API.md §11.15): AWS Signature V4 in the query string, on
// WebCrypto, path style (`https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`, region
// `auto`). The signing time is floored to the hour and every link expires 3 h after it, so a link
// handed out is good for at least 2 h and the same key signs to the same link all hour (the phone's
// cache works). The key is a read-only R2 API token (`R2_SIGN_ACCESS_KEY_ID`, `R2_SIGN_SECRET`,
// Worker secrets the owner sets); while either holds `none`, nothing is signed. A link is never
// logged, stored or put in an event.
import { MUSIC_LIMITS } from '../../../../shared/contract/music.ts';
import { HOUR } from '../../lib/time';

export const SIGN_TTL_S = MUSIC_LIMITS.sign_ttl_s;
const enc = new TextEncoder();

export interface SignKey {
  account: string;
  id: string;
  secret: string;
}

/** The signing key from the Worker's settings, or null while it isn't set up. */
export function signKey(env: Env): SignKey | null {
  const account = env.R2_ACCOUNT_ID;
  const id = env.R2_SIGN_ACCESS_KEY_ID;
  const secret = env.R2_SIGN_SECRET;
  if (!/^[0-9a-f]{32}$/.test(account ?? '') || !id || id === 'none' || !secret || secret === 'none') return null;
  return { account, id, secret };
}

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
async function hmac(key: ArrayBuffer | Uint8Array, text: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(text));
}
/** RFC 3986 encoding, as SigV4 wants it; `/` kept in a path. */
function uri(s: string, path = false): string {
  const e = encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return path ? e.replace(/%2F/g, '/') : e;
}

export interface Presign {
  host: string;
  path: string;
  region: string;
  id: string;
  secret: string;
  /** Signing time, ms. */
  at: number;
  expires: number;
}

/** A presigned GET URL (SigV4, `UNSIGNED-PAYLOAD`, only `host` signed). */
export async function presign(p: Presign): Promise<string> {
  const amz = new Date(p.at)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const day = amz.slice(0, 8);
  const scope = `${day}/${p.region}/s3/aws4_request`;
  const query = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${p.id}/${scope}`],
    ['X-Amz-Date', amz],
    ['X-Amz-Expires', String(p.expires)],
    ['X-Amz-SignedHeaders', 'host'],
  ]
    .map(([k, v]) => `${uri(k)}=${uri(v)}`)
    .join('&');
  const path = uri(p.path, true);
  const canonical = `GET\n${path}\n${query}\nhost:${p.host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const toSign = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${hex(await crypto.subtle.digest('SHA-256', enc.encode(canonical)))}`;
  let key: ArrayBuffer = await hmac(enc.encode(`AWS4${p.secret}`), day);
  for (const part of [p.region, 's3', 'aws4_request']) key = await hmac(key, part);
  const signature = hex(await hmac(key, toSign));
  return `https://${p.host}${path}?${query}&X-Amz-Signature=${signature}`;
}

/** A link to one object of an R2 bucket, signed at the start of the hour; with when it expires. */
export async function signR2(
  k: SignKey,
  bucket: string,
  key: string,
  now: number,
): Promise<{ url: string; expires_at: number }> {
  const at = Math.floor(now / HOUR) * HOUR;
  const url = await presign({
    host: `${k.account}.r2.cloudflarestorage.com`,
    path: `/${bucket}/${key}`,
    region: 'auto',
    id: k.id,
    secret: k.secret,
    at,
    expires: SIGN_TTL_S,
  });
  return { url, expires_at: at + SIGN_TTL_S * 1000 };
}
