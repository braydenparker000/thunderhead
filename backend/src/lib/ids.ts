// UUIDv7 (RFC 9562): 48-bit ms timestamp, then random bits. Ids sort by creation time, which
// keeps primary-key inserts appending. Workers has no crypto.randomUUIDv7, so it is built here.

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export function uuidv7(at: number = Date.now()): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return format(b, at);
}

/** An imported row's id (DATA.md §2.1): a UUIDv7 whose time is the old row's creation time and
 * whose other bits come from sha256("<dataset>:<old id>"), so a re-run makes the same id with no
 * mapping table. */
export async function importedId(dataset: string, oldId: string, createdAt: number): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${dataset}:${oldId}`));
  const b = new Uint8Array(16);
  b.set(new Uint8Array(digest).subarray(0, 10), 6);
  return format(b, createdAt);
}

function format(b: Uint8Array, at: number): string {
  // 48-bit big-endian timestamp. Division, not bit shifts: JS shifts are 32-bit.
  let t = Math.floor(at);
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b[6] = (b[6] & 0x0f) | 0x70; // version 7
  b[8] = (b[8] & 0x3f) | 0x80; // RFC variant
  const h = Array.from(b, (x) => HEX[x]).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The ms timestamp inside a UUIDv7. */
export function uuidv7Time(id: string): number {
  return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}
