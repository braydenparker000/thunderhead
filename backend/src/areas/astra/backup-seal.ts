// The owner's Astra copy at rest (ASTRA.md §5.3, SECURITY.md §11): AES-256-GCM under a key HKDF-SHA-256
// derives from AUTH_PEPPER, as the Drive grant's is (photos/seal.ts), with its own info string, so the
// bucket alone (a leak, an export, a stolen R2 token) is useless without the Worker's secret, and this
// key can never open the Drive grant or the other way round. A fresh 12-byte nonce for every seal. The
// additional data names the copy's place and version, so a sealed copy opens only where and as what it
// was written: moved to another name, given another version, or changed by one bit, it does not open.
// Nothing here logs or keeps the text.
const enc = new TextEncoder();
/** The format byte that starts every sealed copy. */
const FORMAT = 1;
const NONCE = 12;

async function keyOf(pepper: string): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', enc.encode(pepper), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('thunderhead'), info: enc.encode('astra.backup') },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** The additional data: the object's name and the copy's version. */
const placeOf = (name: string, version: string) => enc.encode(`${name}\n${version}`);

/** The sealed bytes: the format byte, the nonce, then the ciphertext with GCM's tag. */
export async function sealBackup(pepper: string, name: string, version: string, text: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(NONCE));
  const out = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: placeOf(name, version) },
      await keyOf(pepper),
      enc.encode(text),
    ),
  );
  const sealed = new Uint8Array(1 + NONCE + out.length);
  sealed[0] = FORMAT;
  sealed.set(iv, 1);
  sealed.set(out, 1 + NONCE);
  return sealed;
}

/** The text, or null when it does not open here: damaged, moved, another version, another pepper. */
export async function openBackup(pepper: string, name: string, version: string, sealed: Uint8Array) {
  if (sealed.length < 1 + NONCE + 16 || sealed[0] !== FORMAT) return null;
  try {
    const out = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.subarray(1, 1 + NONCE), additionalData: placeOf(name, version) },
      await keyOf(pepper),
      sealed.subarray(1 + NONCE),
    );
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(out);
  } catch {
    return null;
  }
}
