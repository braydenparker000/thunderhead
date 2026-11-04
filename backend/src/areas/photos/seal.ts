// The Drive refresh token at rest in the Auth object (SECURITY.md §11): AES-GCM under a key HKDF
// derives from AUTH_PEPPER, so the row alone (a backup, an export, a leak of the table) is useless
// without the Worker's secret. A fresh 12-byte nonce for every seal; the text is never logged.
const enc = new TextEncoder();
const b64 = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function keyOf(pepper: string): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', enc.encode(pepper), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('thunderhead'), info: enc.encode('photos.drive.refresh') },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function seal(pepper: string, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const out = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyOf(pepper), enc.encode(text)),
  );
  return `v1.${b64(iv)}.${b64(out)}`;
}

/** The text, or null when the seal is not ours (another pepper, a damaged row). */
export async function open(pepper: string, sealed: string): Promise<string | null> {
  const [v, iv, body] = sealed.split('.');
  if (v !== 'v1' || !iv || !body) return null;
  try {
    const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await keyOf(pepper), unb64(body));
    return new TextDecoder().decode(out);
  } catch {
    return null;
  }
}

/** A one-use state's stored form: its SHA-256, so the row never holds what Google echoes back. */
export async function stateHash(state: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(state)));
  return b64(d);
}

export const randomState = (): string => b64(crypto.getRandomValues(new Uint8Array(32)));
