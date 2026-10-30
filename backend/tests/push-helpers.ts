// A phone for the push tests (SECURITY.md §10): its own keys, and what it does with a push it
// receives, by RFC 8291's steps on the receiving side (aes128gcm, one record).
import { b64u } from '../src/lib/webpush';

const enc = new TextEncoder();

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

export interface Phone {
  pair: CryptoKeyPair;
  /** Its public key, raw. */
  ua: Uint8Array;
  secret: Uint8Array;
  keys: { p256dh: string; auth: string };
}

export async function phone(): Promise<Phone> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const ua = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const secret = crypto.getRandomValues(new Uint8Array(16));
  return { pair, ua, secret, keys: { p256dh: b64u(ua), auth: b64u(secret) } };
}

/** The payload a push carries, as the phone reads it. */
export async function received(p: Phone, body: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16);
  const as = body.slice(21, 21 + body[20]);
  const server = await crypto.subtle.importKey('raw', as, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = { name: 'ECDH', public: server } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, p.pair.privateKey, 256));
  const ikm = await hkdf(p.secret, shared, new Uint8Array([...enc.encode('WebPush: info\0'), ...p.ua, ...as]), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + body[20])),
  );
  if (plain.at(-1) !== 2) throw new Error('not the last record');
  return new TextDecoder().decode(plain.slice(0, -1));
}
