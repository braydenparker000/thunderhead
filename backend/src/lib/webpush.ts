// Web Push with WebCrypto only (SECURITY.md §10): the VAPID signature (RFC 8292, ES256, `sub` the
// site, never an email) and the payload encryption (RFC 8291, aes128gcm, one record). A payload is
// only `{"k":"<kind>","id":"<id>"}`; the phone fetches the words. Endpoint addresses are capability
// URLs: never logged.

const enc = new TextEncoder();

export function b64u(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64u(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export interface Vapid {
  key: CryptoKey;
  /** The uncompressed P-256 point, base64url: what the phone subscribes with. */
  publicKey: string;
}

/** The VAPID pair from the Worker secret `VAPID_PRIVATE_JWK` (a P-256 private JWK), or null while it is unset or `none`. */
export async function vapid(secret: string | undefined): Promise<Vapid | null> {
  if (!secret || secret === 'none') return null;
  const j = JSON.parse(secret) as JsonWebKey;
  if (j.kty !== 'EC' || j.crv !== 'P-256' || !j.d || !j.x || !j.y) return null;
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: j.x, y: j.y, d: j.d },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  return { key, publicKey: b64u(concat(Uint8Array.of(4), fromB64u(j.x), fromB64u(j.y))) };
}

/** The public key alone, without importing the private one (GET /v1/push/key), or null while unset. */
export function vapidPublic(secret: string | undefined): string | null {
  if (!secret || secret === 'none') return null;
  const j = JSON.parse(secret) as JsonWebKey;
  return j.x && j.y ? b64u(concat(Uint8Array.of(4), fromB64u(j.x), fromB64u(j.y))) : null;
}

/** The Authorization header for one push service: a JWT for its origin, valid 12 hours. */
export async function vapidHeader(v: Vapid, endpoint: string, sub: string, now: number): Promise<string> {
  const part = (o: object) => b64u(enc.encode(JSON.stringify(o)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub })}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, v.key, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64u(sig)}, k=${v.publicKey}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** RFC 8291 §3–4 with RFC 8188's aes128gcm: salt, record size 4096, this push's own public key, then one sealed record. */
export async function encrypt(
  payload: string,
  p256dh: string,
  auth: string,
  salt: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(16)),
): Promise<Uint8Array<ArrayBuffer>> {
  const ua = fromB64u(p256dh);
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const as = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // Workers' types name the peer key `$public`; the runtime reads `public`.
  const ecdh = { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, pair.privateKey, 256));
  const ikm = await hkdf(fromB64u(auth), shared, concat(enc.encode('WebPush: info\0'), ua, as), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // The last (only) record ends with the delimiter 0x02 and no padding.
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    concat(enc.encode(payload), Uint8Array.of(2)),
  );
  const header = new Uint8Array(21 + as.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = as.length;
  header.set(as, 21);
  return concat(header, new Uint8Array(sealed));
}

export interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** One push to one phone; the push service's status (201 taken; 404 and 410: the subscription is gone). */
export async function sendPush(
  v: Vapid,
  to: Subscription,
  payload: string,
  o: { sub: string; ttl: number; urgency: 'normal' | 'high'; now: number },
  f: typeof fetch = fetch,
): Promise<number> {
  const body = await encrypt(payload, to.p256dh, to.auth);
  const r = await f(to.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(v, to.endpoint, o.sub, o.now),
      TTL: String(o.ttl),
      Urgency: o.urgency,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
    },
    body,
  });
  await r.body?.cancel();
  return r.status;
}

/** The push services a subscription may point at (the phone's browser chose it; nothing else is ever asked). */
export function pushService(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  return (
    u.protocol === 'https:' &&
    !u.port &&
    endpoint.length <= 1024 &&
    /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/.test(
      u.hostname,
    )
  );
}
