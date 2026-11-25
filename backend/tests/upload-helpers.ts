// Helpers for the upload tools' suites: a fresh tool key, requests signed with it as the tools sign
// them (Ed25519 over jarvis-r2-upload-v1, upload.ts), a tiny Ogg Opus look-alike uploaded through the
// Worker, and the phone's catalog read. Every song is invented.
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { app } from '../src/app';
import { signatureMessage } from '../src/areas/music/validate';

const hex = (b: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
export const sha = async (b: Uint8Array) => hex(await crypto.subtle.digest('SHA-256', b));
export const WAVE = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i * 7)));
const enc = new TextEncoder();

/** A tiny Ogg Opus look-alike: the magic and the Opus head where the Worker looks, then noise. */
export const ogg = (seed: number) => {
  const b = new Uint8Array(400 + seed);
  b.set(enc.encode('OggS'), 0);
  b.set(enc.encode('OpusHead'), 28);
  for (let i = 40; i < b.length; i++) b[i] = (i * 37 + seed) % 251;
  return b;
};

export type Answer = Record<string, unknown> & { error?: { code: string; details?: { path: string }[] } };

/** A signer with its own key, and the environment that trusts it. */
export async function uploader() {
  const keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const key = hex((await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer);
  const E = { ...env, MUSIC_UPLOAD_PUBLIC_KEYS: JSON.stringify([key]) } as Env;
  async function send(method: string, path: string, bytes: Uint8Array, type: string) {
    const time = String(Math.floor(Date.now() / 1000));
    const hash = await sha(bytes);
    const url = `https://api.example.test/v1/music/uploads/${path}`;
    const message = signatureMessage({
      method,
      origin: 'https://api.example.test',
      path: new URL(url).pathname,
      type,
      hash,
      size: bytes.length,
      time,
      key,
    });
    const sig = hex(await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, enc.encode(message)));
    const headers = {
      'Content-Type': type,
      'X-Music-Public-Key': key,
      'X-Music-Signature': sig,
      'X-Music-Timestamp': time,
      'X-Music-Size': String(bytes.length),
      'X-Music-Sha256': hash,
    };
    return app.fetch(new Request(url, { method, headers, body: bytes }), E, createExecutionContext());
  }
  const op = async (name: string, body: object) => {
    const r = await send('POST', name, enc.encode(JSON.stringify(body)), 'application/json');
    return { status: r.status, body: (await r.json()) as Answer };
  };
  /** Song `seed`'s audio, uploaded; its registration with these tags (title, artist and dur given). */
  const song = async (seed: number, meta: Record<string, unknown> = {}, extra: object = {}) => {
    const bytes = ogg(seed);
    const h = await sha(bytes);
    const put = await send('PUT', `audio/${h}.opus`, bytes, 'audio/ogg');
    if (put.status !== 200) throw new Error(`audio: ${put.status}`);
    const metadata = { title: `Invented ${seed}`, artist: 'The Paper Boats', dur: 150 + seed, ...meta };
    return { sha256: h, size: bytes.length, name: `Invented ${seed}.opus`, metadata, ...extra };
  };
  return { E, send, op, song };
}

/** The phone's catalog read, as the owner's device. */
export async function catalogGet(E: Env, token: string, query = '', headers: Record<string, string> = {}) {
  const r = await app.fetch(
    new Request(`https://api.example.test/v1/music/catalog${query}`, {
      headers: { Authorization: `Bearer ${token}`, ...headers },
    }),
    E,
    createExecutionContext(),
  );
  const text = await r.text();
  return { status: r.status, etag: r.headers.get('ETag'), text, body: text ? JSON.parse(text) : null };
}
