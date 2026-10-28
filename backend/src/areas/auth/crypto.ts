// Sign-in cryptography: the password KDF, token hashes, codes, fingerprints and source keys.
// node:crypto (not WebCrypto) because workerd implements scrypt only there, and its sync forms
// keep the Durable Object's critical section free of awaits.
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export interface KdfParams {
  n: number;
  r: number;
  p: number;
}

/** scrypt N=2^15, r=8, p=3 (32 MiB): an OWASP-listed setting, decided in decisions.md. It costs
 * ~250 ms of CPU, so it runs only inside the Auth object (see MEASUREMENTS.md and test X3).
 * Each credential stores its own parameters, and a weaker hash is redone at the next sign-in. */
export const KDF_CURRENT: KdfParams = { n: 2 ** 15, r: 8, p: 3 };

// workerd caps N*r*p at 2^20 and Node's default maxmem (32 MiB) is exactly 128*N*r here.
const MAXMEM = 64 * 1024 * 1024;

/** HMAC-SHA256(pepper, scrypt(NFKC(password), salt)). The pepper is a Worker secret that never
 * reaches the database, so a stolen backup alone cannot be brute-forced offline. */
export function hashPassword(password: string, salt: Uint8Array, params: KdfParams, pepper: string): Buffer {
  const raw = scryptSync(password.normalize('NFKC'), salt, 32, {
    N: params.n,
    r: params.r,
    p: params.p,
    maxmem: MAXMEM,
  });
  return createHmac('sha256', pepper).update(raw).digest();
}

export function weakerThanCurrent(p: KdfParams): boolean {
  return p.n * p.r * p.p < KDF_CURRENT.n * KDF_CURRENT.r * KDF_CURRENT.p;
}

export function newSalt(): Buffer {
  return randomBytes(16);
}

/** Constant-time equality; different lengths are simply unequal. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Constant-time comparison of two strings through their SHA-256 digests (equal lengths). */
export function sameText(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

// --- token hashes ----------------------------------------------------------------------------

/** Only this hash is stored. A 256-bit random token needs no salt or slow hash. */
export function tokenHash(token: string): string {
  return sha256Hex(token);
}

// --- recovery codes --------------------------------------------------------------------------

// Crockford base32: no I, L, O or U, so a code read off paper is unambiguous.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 25 characters x 5 bits = 125 bits, shown as five groups of five. */
export function newRecoveryCode(): string {
  const chars = Array.from(randomBytes(25), (b) => CROCKFORD[b & 31]).join('');
  return chars.match(/.{5}/g)?.join('-') ?? chars;
}

/** Folds case, hyphens, spaces and look-alikes (O→0, I/L→1). Null when it cannot be a code.
 * Recovery, setup and reset codes share this format (SIGN-IN.md §7.1). */
export function normalizeCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{25}$/.test(s) ? s : null;
}

/** A 125-bit secret needs only a keyed fast hash (NIST: look-up secrets of 112+ bits). */
export function recoveryHash(normalized: string, pepper: string): Buffer {
  return createHmac('sha256', pepper).update(`recovery:${normalized}`).digest();
}

/** Lets the owner confirm the last 5 characters without the server keeping the code. */
export function last5Hash(normalized: string, pepper: string): Buffer {
  return createHmac('sha256', pepper)
    .update(`last5:${normalized.slice(-5)}`)
    .digest();
}

/** `thfp_` + base64url(SHA-256(code)), over the code's normalized 25 characters. Public. */
export function fingerprint(normalized: string): string {
  return `thfp_${createHash('sha256').update(normalized).digest('base64url')}`;
}

export const FINGERPRINT_RE = /^thfp_[A-Za-z0-9_-]{43}$/;

// --- source keys for back-off ----------------------------------------------------------------

/** The network a request comes from: the whole IPv4 address, or the IPv6 /64. */
export function ipPrefix(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = ip.includes('::') && tail ? tail.split(':') : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return groups
    .slice(0, 4)
    .map((g) => g.toLowerCase().replace(/^0+(?=.)/, ''))
    .join(':');
}

/** A keyed hash of the source network with IP_HASH_KEY, rotating daily (the UTC date is in the
 * message), so raw addresses are never stored. */
export function sourceKey(ip: string, ipHashKey: string, day: string): string {
  return createHmac('sha256', ipHashKey)
    .update(`src:${day}:${ipPrefix(ip)}`)
    .digest('hex')
    .slice(0, 32);
}
